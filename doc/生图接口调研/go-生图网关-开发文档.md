# Go 生图网关（Image Gateway）开发文档

> 目标：给短剧插件等内部业务提供**统一、稳定**的生图 API。业务方只对接网关，网关负责鉴权、配额、排队、限速、重试、结果转存，上游生图服务做成可插拔。
> 第一期上游：虾蹬生图公益站（`ai01.teleapi.top/draw`，接口详见《teleapi-draw-分析.md》§3）。
> 后续上游：有授权的商用生图 API（支持多 API Key 池）。

---

## 0. 设计边界（重要）

| 做 | 不做 |
|---|---|
| 单一固定出口访问上游，**全局礼貌限速**（默认同时最多 1 个在途任务、每分钟最多 N 单） | ❌ 代理池 / 出口 IP 轮换。上游按 IP 区分用户，轮换 IP 等于规避它的公平性控制，会把公益站的算力当批量资源用 |
| 自己的用户体系和配额（按业务方 API Key 计） | ❌ 伪造 `X-Forwarded-For`、伪造 UA 指纹之类规避识别的手段 |
| 结果图片转存到自己的存储（上游只保留 7 天） | ❌ 刷点赞、刷画廊 |
| 上游可插拔：公益站 → 商用 API；商用 API 可以配**自己名下的多个 Key** 做轮询、配额和故障切换 | |

> 生产业务量一上来，就应该切到商用 Provider。公益站 Provider 只适合低频试用，最好先征得站长同意。

---

## 1. 总体架构

```
          ┌──────────────── Image Gateway (Go) ────────────────┐
业务方 ──▶│ HTTP API ─▶ Auth/Quota ─▶ Job Store ─▶ Dispatcher   │
(插件)    │   ▲                          (DB)        │ 限速/并发   │
          │   │                                      ▼            │
          │   └── 查询/回调 ◀── Poller ◀── Provider 接口 ──────────┼──▶ 上游 A：teleapi 公益站（单出口）
          │                       │                               │──▶ 上游 B：商用 API（Key 池）
          │                       ▼                               │
          │                 Storage（本地/S3/OSS 转存图片）        │
          └────────────────────────────────────────────────────────┘
```

主要模块：

| 模块 | 职责 |
|---|---|
| `api` | 对外 REST：提交、查询、取消、文件下载；业务方 API Key 鉴权 |
| `quota` | 按业务方的日配额 / QPS（令牌桶），超限返回 429 |
| `store` | 任务持久化（SQLite 起步，可以换 Postgres），状态机 |
| `dispatcher` | 从队列取任务，按 Provider 的并发/速率上限下发 |
| `provider` | 统一接口 `Submit / Get / Download`；实现 `teleapi`、`commercial` |
| `poller` | 轮询上游任务状态（teleapi 间隔 ≥ 5s），完成后转存 |
| `storage` | 图片落盘或上传对象存储，生成自己的 URL |
| `breaker` | 上游熔断：连续 5xx 或超时就暂停下发，指数退避恢复 |
| `metrics` | Prometheus 指标 |

---

## 2. 对外 API（网关自己的协议）

统一：`Authorization: Bearer <gateway_api_key>`，JSON，错误格式 `{"code":"xxx","message":"..."}`。

### 2.1 `POST /v1/images/generations` 提交

```jsonc
{
  "prompt": "竖屏短剧封面，雨夜霓虹街头，女主回眸",
  "negative_prompt": "水印, 文字乱码, 多手指",
  "style": "photo",            // 网关枚举 = 上游 StyleEnum
  "aspect_ratio": "9:16",      // 网关用通用比例，Provider 自己映射
  "enhance": false,
  "reference_image": {          // 可选，二选一
    "url": "https://...",
    "b64": "..."
  },
  "provider": "auto",          // auto | teleapi | commercial
  "callback_url": "https://biz/cb",  // 可选，完成后 POST 回调
  "idempotency_key": "ep3-shot12-v1" // 可选，同一 key 24h 内返回同一任务
}
```

校验规则（在网关这层拦截，避免把非法请求打到上游）：

| 字段 | 规则 |
|---|---|
| `prompt` | string，trim 后 2~500 字符 |
| `negative_prompt` | ≤ 200 字符 |
| `style` | 白名单 12 个，默认 `none` |
| `aspect_ratio` | `1:1 / 3:4 / 9:16 / 16:9 / 21:9`，默认 `1:1` |
| `reference_image` | ≤ 10MB，网关统一缩到最长边 1536、转 JPEG q85，上游拿到的是纯 base64 |

响应 `202`：

```json
{"id":"gj_01JC8Z...","status":"pending","created_at":"2026-11-08T09:12:22Z"}
```

### 2.2 `GET /v1/jobs/{id}` 查询

```jsonc
{
  "id": "gj_01JC8Z...",
  "status": "pending | queued | generating | succeeded | failed | canceled",
  "provider": "teleapi",
  "queue_position": 0,          // 仅在排队时返回
  "request": { /* 回显请求（不含参考图） */ },
  "result": {                   // succeeded 时
    "images": [{
      "url": "https://gw.example.com/v1/files/gf_xxx.jpg",
      "preview_url": ".../gf_xxx_view.jpg",
      "thumb_url": ".../gf_xxx_thumb.jpg",
      "width": 1600, "height": 1600, "bytes": 561872, "sha256": "..."
    }]
  },
  "error": {"code":"upstream_failed","message":"..."},  // failed 时
  "created_at": "...", "finished_at": "...",
  "elapsed_ms": 52000
}
```

### 2.3 其他

| 接口 | 说明 |
|---|---|
| `POST /v1/jobs/{id}/cancel` | 只能取消还没下发到上游的任务（上游没有取消接口） |
| `GET /v1/files/{name}` | 读转存后的图片（或者 302 到 OSS 签名 URL） |
| `GET /v1/quota` | 当前 API Key 的配额使用情况 |
| `GET /healthz` / `GET /metrics` | 健康检查 / Prometheus |

### 2.4 错误码

| HTTP | code | 场景 |
|---|---|---|
| 400 | `invalid_request` | 参数校验失败 |
| 401 | `unauthorized` | API Key 无效 |
| 404 | `not_found` | 任务或文件不存在 |
| 409 | `idempotency_conflict` | 同一个 idempotency_key 但参数不同 |
| 429 | `quota_exceeded` / `rate_limited` | 业务方配额或 QPS 超限（带 `Retry-After`） |
| 503 | `provider_unavailable` | 所有 Provider 熔断中 |
| 502 | `upstream_failed` | 上游返回失败（写在任务的 error 里） |

---

## 3. Provider 抽象

```go
package provider

type Request struct {
	Prompt, Negative string
	Style            string
	Aspect           string // "1:1" ...
	Enhance          bool
	RefJPEG          []byte
}

type UpstreamStatus string // queued | generating | done | failed

type Result struct {
	Status   UpstreamStatus
	Ahead    int
	ImageURL string
	ViewURL  string
	ThumbURL string
	ErrMsg   string
}

type Limits struct {
	MaxInFlight  int           // 同时在途任务上限
	SubmitPerMin int           // 每分钟最多提交数
	PollInterval time.Duration // 轮询间隔
	JobTimeout   time.Duration // 单任务最长等待
}

type Provider interface {
	Name() string
	Limits() Limits
	Submit(ctx context.Context, r Request) (upstreamID string, err error)
	Get(ctx context.Context, upstreamID string) (Result, error)
	Download(ctx context.Context, url string) (io.ReadCloser, error)
}

// 可重试错误（5xx、超时、连接错误）和不可重试错误（4xx 参数类）要区分开
type Error struct {
	Retryable bool
	HTTP      int
	Msg       string
}
func (e *Error) Error() string { return e.Msg }
```

### 3.1 teleapi Provider

```go
package teleapi

var ratioMap = map[string]string{
	"1:1": "square", "3:4": "portrait", "9:16": "tall", "16:9": "landscape", "21:9": "cinema",
}

type Client struct {
	base string       // https://ai01.teleapi.top/draw/
	hc   *http.Client // 单一出口，Transport 不配置代理池
	ua   string       // 如实标识，例如 "ds-image-gateway/1.0 (+contact@example.com)"
}

func New(base, contact string) *Client {
	return &Client{
		base: strings.TrimRight(base, "/") + "/",
		hc: &http.Client{
			Timeout: 30 * time.Second,
			Transport: &http.Transport{MaxIdleConnsPerHost: 2, IdleConnTimeout: 90 * time.Second},
		},
		ua: "ds-image-gateway/1.0 (+" + contact + ")",
	}
}

func (c *Client) Limits() provider.Limits {
	return provider.Limits{MaxInFlight: 1, SubmitPerMin: 2, PollInterval: 5 * time.Second, JobTimeout: 15 * time.Minute}
}

func (c *Client) Submit(ctx context.Context, r provider.Request) (string, error) {
	body := SubmitRequest{
		Prompt: r.Prompt, Style: Style(r.Style), Ratio: Ratio(ratioMap[r.Aspect]),
		Negative: r.Negative, Enhance: r.Enhance,
	}
	if len(r.RefJPEG) > 0 {
		body.RefB64 = base64.StdEncoding.EncodeToString(r.RefJPEG) // 纯 base64，不带 data: 前缀
	}
	var out SubmitResponse
	if err := c.do(ctx, http.MethodPost, "api/submit", body, &out); err != nil {
		return "", err
	}
	return out.ID, nil
}

func (c *Client) Get(ctx context.Context, id string) (provider.Result, error) {
	var j Job
	if err := c.do(ctx, http.MethodGet, "api/job/"+url.PathEscape(id), nil, &j); err != nil {
		return provider.Result{}, err
	}
	res := provider.Result{Status: provider.UpstreamStatus(j.Status), ErrMsg: j.Error}
	if j.Ahead != nil { res.Ahead = *j.Ahead }
	if j.Status == StatusDone {
		res.ImageURL, res.ViewURL, res.ThumbURL = c.abs(j.Image), c.abs(j.View), c.abs(j.Thumb)
	}
	return res, nil
}

func (c *Client) abs(p string) string { return "https://ai01.teleapi.top" + p } // 上游返回 /draw/img/...

func (c *Client) do(ctx context.Context, method, path string, in, out any) error {
	var rd io.Reader
	if in != nil {
		b, _ := json.Marshal(in)
		rd = bytes.NewReader(b)
	}
	req, _ := http.NewRequestWithContext(ctx, method, c.base+path, rd)
	req.Header.Set("User-Agent", c.ua)
	if in != nil { req.Header.Set("Content-Type", "application/json") }
	resp, err := c.hc.Do(req)
	if err != nil { return &provider.Error{Retryable: true, Msg: err.Error()} }
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if resp.StatusCode >= 500 {
		return &provider.Error{Retryable: true, HTTP: resp.StatusCode, Msg: "upstream " + resp.Status}
	}
	if resp.StatusCode >= 400 {
		var e ErrorResponse
		_ = json.Unmarshal(data, &e)
		return &provider.Error{Retryable: resp.StatusCode == 429, HTTP: resp.StatusCode, Msg: e.Error}
	}
	return json.Unmarshal(data, out)
}
```

teleapi 的注意点（来自实测）：

- `prompt` 必须是 string，传别的类型上游直接 502。网关这层必须做类型和长度校验。
- 图片只能 `GET`（`HEAD` 返回 501），下载完要**立即转存**，上游只保留 7 天。
- 生成的图会**公开进上游画廊**，带敏感或商业保密内容的请求要路由到商用 Provider（见 §5 路由策略）。
- 上游 `api/job` 返回 404 = 已过期或不存在 → 标记 failed，不再重试。

### 3.2 commercial Provider（Key 池）

只用**自己合法持有**的多个 API Key，目的是分摊各 Key 的官方配额并做故障切换：

```go
type KeyPool struct {
	mu   sync.Mutex
	keys []*Key // {Value, RPM limiter, DailyQuota, Used, CoolDownUntil, Healthy}
	next int
}

// 加权轮询：跳过冷却中 / 配额用尽 / 不健康的 Key
func (p *KeyPool) Acquire() (*Key, error)
// 上游返回 401/403 → Healthy=false；429 → 按 Retry-After 设置 CoolDownUntil
func (p *KeyPool) Report(k *Key, httpStatus int, retryAfter time.Duration)
```

---

## 4. 任务状态机与调度

```
pending ──dispatch──▶ queued(上游已受理) ──▶ generating ──▶ succeeded
   │                      │                       └────────▶ failed
   └──cancel──▶ canceled  └── 超时 JobTimeout ──▶ failed(timeout)
```

调度器（每个 Provider 一个）：

```go
type Dispatcher struct {
	p        provider.Provider
	sem      chan struct{}   // 容量 = Limits.MaxInFlight
	limiter  *rate.Limiter   // golang.org/x/time/rate，SubmitPerMin/60 每秒，burst 1
	store    store.Store
	breaker  *gobreaker.CircuitBreaker // github.com/sony/gobreaker
}

func (d *Dispatcher) Run(ctx context.Context) {
	for {
		job, err := d.store.ClaimNextPending(ctx, d.p.Name()) // SELECT ... FOR UPDATE SKIP LOCKED / SQLite 事务
		if err != nil || job == nil { sleep(ctx, time.Second); continue }
		d.sem <- struct{}{}
		if err := d.limiter.Wait(ctx); err != nil { return }
		go func() {
			defer func() { <-d.sem }()
			d.handle(ctx, job) // Submit → 循环 Get(PollInterval) → 下载转存 → 更新状态 → 回调
		}()
	}
}
```

重试策略：

| 阶段 | 可重试错误 | 策略 |
|---|---|---|
| Submit | 网络错误、5xx、429 | 指数退避 5s→10s→20s，最多 3 次；429 遵守 `Retry-After` |
| Get 轮询 | 网络错误、5xx | 不计入失败，继续按间隔轮询，直到 JobTimeout |
| Download | 网络错误、5xx | 最多 3 次 |
| 上游 `failed` / 404 | 不重试 | 记录 `upstream_failed`；`provider=auto` 时可以 failover 到下一个 Provider |

熔断：同一 Provider 60s 内连续 5 次可重试错误 → open 2 分钟 → half-open 放 1 个探测请求。

**服务重启恢复**：启动时扫描 `queued/generating` 状态且带 `upstream_id` 的任务，重新挂到 poller 上，不重复提交（这也是为什么提交成功后要**先落库 upstream_id，再开始轮询**）。

---

## 5. 路由策略（provider=auto）

1. 带 `reference_image` 或标记为 `confidential` 的请求 → 只走商用 Provider（避免进公共画廊）。
2. 其余按配置的优先级列表选第一个**未熔断、并且有余量**的 Provider。
3. 公益站 Provider 默认**只在 `dev` / `trial` 租户开启**。

---

## 6. 数据模型（SQLite / Postgres）

```sql
CREATE TABLE api_keys (
  id TEXT PRIMARY KEY, name TEXT, key_hash TEXT UNIQUE NOT NULL,
  daily_quota INT NOT NULL DEFAULT 200, rps REAL NOT NULL DEFAULT 1,
  allow_providers TEXT NOT NULL DEFAULT 'commercial', created_at TIMESTAMP
);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,                 -- gj_ + ULID
  api_key_id TEXT NOT NULL REFERENCES api_keys(id),
  idempotency_key TEXT,
  provider TEXT NOT NULL,
  upstream_id TEXT,
  status TEXT NOT NULL,                -- pending/queued/generating/succeeded/failed/canceled
  request_json TEXT NOT NULL,          -- 不含参考图原文
  ref_path TEXT,                       -- 参考图暂存路径，完成后删除
  queue_position INT,
  attempts INT NOT NULL DEFAULT 0,
  error_code TEXT, error_msg TEXT,
  callback_url TEXT, callback_status TEXT,
  created_at TIMESTAMP NOT NULL, dispatched_at TIMESTAMP, finished_at TIMESTAMP
);
CREATE UNIQUE INDEX ux_jobs_idem ON jobs(api_key_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX ix_jobs_status ON jobs(provider, status, created_at);

CREATE TABLE files (
  id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id),
  variant TEXT NOT NULL,               -- original/view/thumb
  storage_key TEXT NOT NULL, width INT, height INT, bytes INT, sha256 TEXT,
  created_at TIMESTAMP
);

CREATE TABLE quota_usage (
  api_key_id TEXT, day DATE, used INT NOT NULL DEFAULT 0,
  PRIMARY KEY (api_key_id, day)
);
```

---

## 7. 工程结构

```
image-gateway/
├── cmd/gateway/main.go           # 读配置、组装依赖、启动 HTTP + dispatcher
├── internal/
│   ├── config/                   # viper / koanf 读 YAML + ENV
│   ├── api/                      # chi 路由、handler、中间件(auth, quota, requestid, recover)
│   ├── quota/                    # 令牌桶 + 日配额
│   ├── store/                    # Store 接口 + sqlite/postgres 实现（sqlc 生成）
│   ├── dispatcher/
│   ├── provider/
│   │   ├── provider.go           # 接口定义
│   │   ├── teleapi/              # §3.1 + 类型定义（见分析文档 §3.7）
│   │   └── commercial/           # §3.2 Key 池
│   ├── storage/                  # local / s3 (aws-sdk-go-v2) 实现
│   ├── imageutil/                # 参考图缩放与 JPEG 转码（golang.org/x/image/draw）
│   └── callback/                 # 回调投递，带 HMAC 签名和重试
├── migrations/
├── configs/config.example.yaml
├── Dockerfile
└── Makefile
```

推荐依赖：`go-chi/chi/v5`、`golang.org/x/time/rate`、`sony/gobreaker`、`oklog/ulid/v2`、`modernc.org/sqlite`（纯 Go 实现）或 `jackc/pgx/v5`、`prometheus/client_golang`、`log/slog`。

---

## 8. 配置示例

```yaml
server:
  addr: ":8080"
  public_base_url: "https://gw.example.com"

store:
  driver: sqlite
  dsn: "file:data/gateway.db?_pragma=journal_mode(WAL)"

storage:
  driver: local          # local | s3
  local_dir: "data/files"

providers:
  - name: teleapi
    enabled: true
    base_url: "https://ai01.teleapi.top/draw/"
    contact: "ops@example.com"
    max_in_flight: 1      # 礼貌限速，不建议调大
    submit_per_min: 2
    poll_interval: 5s
    job_timeout: 15m
    allow_tenants: ["dev", "trial"]
  - name: commercial
    enabled: false
    base_url: "https://api.vendor.example/v1"
    keys_env: "VENDOR_API_KEYS"   # 逗号分隔，从环境变量或 Secret 注入，不要写进配置文件
    max_in_flight: 8

routing:
  order: ["commercial", "teleapi"]
  confidential_providers: ["commercial"]
```

---

## 9. 可观测性

| 指标 | 类型 | 标签 |
|---|---|---|
| `gw_jobs_total` | counter | provider, status |
| `gw_job_duration_seconds` | histogram | provider, phase(queue/generate/download) |
| `gw_upstream_requests_total` | counter | provider, endpoint, http_code |
| `gw_inflight` | gauge | provider |
| `gw_breaker_state` | gauge | provider |
| `gw_quota_rejected_total` | counter | api_key |

日志用 `slog` JSON 输出，带 `job_id / upstream_id / provider / request_id`；**不打印**参考图内容和 API Key。

---

## 10. 测试计划

| 层 | 内容 |
|---|---|
| 单元 | 参数校验、ratio 映射、错误分类（Retryable）、KeyPool 冷却和切换、状态机迁移 |
| Provider | 用 `httptest.Server` 回放《分析文档》里的真实响应（queued/generating/done/404/400/502） |
| 集成 | SQLite 内存库 + 假 Provider，验证重启恢复、幂等、取消、超时、failover |
| 冒烟（手动） | 对 teleapi 真实提交 1 单，验证端到端转存；**不在 CI 里打真实公益站** |

---

## 11. 里程碑

| 阶段 | 内容 | 预估 |
|---|---|---|
| M1 | 骨架 + Store + teleapi Provider + 提交/查询/文件接口 + 本地存储 | 2 天 |
| M2 | 配额、限速、熔断、重启恢复、幂等、回调 | 2 天 |
| M3 | commercial Provider + Key 池 + 路由策略 + S3 | 2 天 |
| M4 | 指标、Docker、短剧插件接入（分镜一键出图） | 1~2 天 |
