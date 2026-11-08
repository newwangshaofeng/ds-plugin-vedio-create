# 虾蹬生图（ai01.teleapi.top/draw）额度判断机制 & 生图接口文档

> 分析对象：`https://ai01.teleapi.top/draw/#job=8ef542f0d7`
> 分析工具：[REA (morluto/rea)](https://github.com/morluto/rea) v6.8.0 `analyze-web-bundle`（通过 Chrome CDP 抓取页面脚本并静态分析）+ curl 实测接口
> 分析时间：2026-11-08

---

## 0. 结论速览

| 问题 | 结论 | 依据 |
|---|---|---|
| 有没有"每用户额度"？ | **没有。** 前端和接口里都找不到额度、次数、余额相关的字段或接口；页面写的是"公益免费 · 不限张数"。 | 前端源码 + 接口返回字段 |
| 有没有登录 / Token / Cookie？ | **没有。** 所有接口都不需要鉴权，返回头里也没有 `Set-Cookie`；前端 `fetch` 不带任何自定义 Header。 | 响应头 + 源码 |
| 服务端怎么区分"用户"？ | **按客户端 IP（服务端可见的源 IP）。** 点赞的 `liked` 状态随出口 IP 变化，跟 Cookie、UA 无关；伪造 `X-Forwarded-For` 也不起作用。 | 实测（见 §2.3） |
| "我画过的"怎么记录？ | **纯前端**：`localStorage["draw_my"]` 里存最近 40 个工单 ID，展示前 20 个，再逐个调 `api/job/{id}` 拉详情。换浏览器或清缓存就没了。 | 源码 `myIds()/saveMine()` |
| 有没有并发/排队限制？ | 只有**全局排队**（大概 3 个 worker 并行），**没看到按 IP 的并发限制**：同一 IP 连续提交 2 单都返回 200，并且同时处于 `generating`。 | 实测 + 前端 ETA 公式 `ceil((ahead+1)/3)` |
| 公开展示的"额度"数字 | 页面顶栏只显示**全站**统计 `api/stats`（今日完成数、排队数），不是个人额度。 | 源码 `loadStats()` |

> 说明：服务端是闭源的，"按 IP 识别用户"是根据黑盒实测推断的（证据很强，但看不到服务端代码）。如果服务端对 IP 做了频率限制（例如每分钟 N 次返回 429），前端会把 `error` 字段原样提示出来，但这次少量正常调用没有触发。为了不给公益站加负担，**没有做压测或逼近限额的探测**。

---

## 1. 前端结构（REA 分析结果）

REA 命令：

```bash
# 1. 用 CDP 打开目标页面
curl -X PUT "http://localhost:29229/json/new?https://ai01.teleapi.top/draw/%23job=8ef542f0d7"
# 2. 抓取页面脚本并静态分析
rea analyze-web-bundle http://127.0.0.1:29229 <targetId> --observation-ms 5000 --fetch-source-maps --format json
```

REA 输出要点：

- `scripts_observed: 1`：整个应用只有 **1 段内联脚本**（15,042 字节），没有打包产物、没有 source map、没有第三方 SDK。
- `endpoints`（静态识别到的 fetch 调用）：`api/submit`、`api/like`、`api/stats`；另外人工阅读源码补充了用字符串拼接构造的 `api/job/{id}`、`api/gallery?page=`。
- `webmcp_declarations: []`，`routes: []`：单页，没有前端路由，只靠 `location.hash` 里的 `#job=<id>` 恢复工单。

所有接口都是**相对路径**，Base URL 为：

```
https://ai01.teleapi.top/draw/
```

---

## 2. 用户识别 / "额度"相关逻辑详解

### 2.1 前端没有任何身份凭证

源码里所有请求都长这样（没有 Authorization、没有 token、没有 `credentials` 配置）：

```js
fetch("api/submit",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...})})
```

各接口的响应头只有：`server: nginx`、`content-type`、`cache-control: no-cache`，**没有 `Set-Cookie`**。

### 2.2 "我画过的" = localStorage

```js
function myIds(){ return JSON.parse(localStorage.getItem("draw_my")||"[]"); }
function saveMine(id){ var a=myIds().filter(x=>x!==id); a.unshift(id); a=a.slice(0,40); localStorage.setItem("draw_my",JSON.stringify(a)); }
// renderMine(): ids.slice(0,20) 逐个 GET api/job/{id}，只展示 status==="done" 的
```

工单 ID 是 10 位小写十六进制（例如 `8ef542f0d7`），**拿到 ID 就能查看**这张工单（没有归属校验），页面也提示"凭链接随时回来看这张图"。

### 2.3 服务端按 IP 区分用户（实测）

`api/like` 是按"用户"切换点赞的，所以可以用它来观察服务端用什么识别用户：

1. 本机出口在 `140.232.64.2` 和 `140.232.64.6` 之间轮换（用 ipify 确认过）。
2. 不带 Cookie 的 curl，对同一张图连续 `POST api/like`：
   - 落在 IP A → `{"likes":1,"liked":true}`
   - 落在 IP B → `{"likes":2,"liked":true}`（B 被当成另一个用户，又点了一次赞）
   - 再次落在 IP A → `likes` 减 1、`liked:false`（A 取消点赞）
3. 在**同一 TCP 连接**里（出口 IP 固定）先点赞再请求 `api/gallery`，这张图返回 `liked:true`；换成另一个 IP 请求则是 `liked:false`。
4. 改 `User-Agent`、加 `X-Forwarded-For: 1.2.3.4` 对结果没有影响 → 服务端用的是 nginx 看到的真实源 IP（或者它信任的上游 IP），不信任客户端自己传的 XFF。

> 测试用的点赞已经全部撤销（likes 已回到 0）。
> 另外：`api/job/{id}` 返回的 `liked` 好像固定是 `false`，只有 `api/gallery` 和 `api/like` 会反映当前 IP 的点赞状态。

### 2.4 全局排队，不是个人配额

- `api/stats` 返回的是全站数据：`today_done / queued / generating / total_done`。
- 前端预估排队时间：`eta = max(1, ceil((ahead + 1) / 3))` 分钟 → 推断后端大约 **3 个生图 worker** 并行，每张约 1 分钟。
- 实测同一 IP 先后提交 2 单，两单都立即返回 id，并且同时处于 `generating`（当时 `generating: 3`）。

---

## 3. 生图接口文档（详细入参 / 返回结构）

### 3.0 通用约定

| 项 | 值 |
|---|---|
| Base URL | `https://ai01.teleapi.top/draw/`（所有接口都是相对路径） |
| 鉴权 | 无（服务端按源 IP 识别用户，见 §2） |
| 请求体 | `Content-Type: application/json`，UTF-8 |
| 响应 | `application/json; charset=utf-8`，`cache-control: no-cache` |
| 错误格式 | HTTP 4xx + `{"error": "<中文说明>"}`；路由不存在时 `{"error":"not found"}` |
| 支持的方法 | 只有 `GET` / `POST`。`HEAD`、`OPTIONS` 都返回 **501**（服务端像是 Python `http.server` 风格的实现，`created` 是 `time.time()` 浮点数，这一点是推断） |
| CORS | 不返回 `Access-Control-*` 头，`OPTIONS` 预检也 501 → **浏览器跨域没法直接调**，需要服务端代理 |
| 时间 | `created` 为 Unix 秒（float） |
| ID | 10 位小写 hex，正则 `^[a-f0-9]{10}$`（前端 hash 匹配用的是 `[a-z0-9]+`） |

**全局错误码（实测）**

| 场景 | HTTP | body |
|---|---|---|
| body 不是合法 JSON / 空 body | 400 | `{"error":"请求格式不对"}` |
| `prompt` trim 后不足 2 个字符 | 400 | `{"error":"提示词太短了"}` |
| `prompt` 传了非字符串（比如数字） | **502**（nginx 返回 HTML） | 后端异常，调用方务必保证是 string |
| 工单不存在或已过期 | 404 | `{"error":"找不到这张工单"}` |
| 点赞目标不存在 / 缺少 `id` | 404 | `{"error":"找不到这张图"}` |
| 方法不对（例如 GET `api/submit`）或路径不对 | 404 | `{"error":"not found"}` |
| HEAD / OPTIONS | 501 | nginx/后端 HTML |

> 校验顺序：先校验 `prompt`，所以 `prompt` 不合法时，`style` 或 `ref_b64` 的错误不会报出来。`style`、`ratio` 传了非法值会怎样**没有测**（合法 prompt 会真的触发生图，所以没做这类探测），网关侧要先做白名单校验。

---

### 3.1 `POST api/submit` 提交生图

**Request Body**

```jsonc
{
  "prompt":   "string",   // 必填，trim 后长度 2~500（前端 maxlength=500，服务端上限未测）
  "style":    "string",   // 可选，枚举见 StyleEnum，前端默认 "none"
  "ratio":    "string",   // 可选，枚举见 RatioEnum，前端默认 "square"
  "negative": "string",   // 可选，前端 maxlength=200；空字符串时前端不传
  "enhance":  true,       // 可选，只传 true；false 时前端直接省略这个字段
  "ref_b64":  "string"    // 可选，参考图 JPEG 的纯 base64（不带 data: 前缀）
}
```

| 字段 | 类型 | 必填 | 约束 | 说明 |
|---|---|---|---|---|
| `prompt` | string | ✔ | 2 ≤ len(trim) ≤ 500 | 正向提示词，中文可用 |
| `style` | string | | StyleEnum | 风格预设 |
| `ratio` | string | | RatioEnum | 画幅 |
| `negative` | string | | ≤ 200 | 负面提示词 |
| `enhance` | bool | | | 智能润色（LLM 扩写），任务里会体现为 `enhanced: true` |
| `ref_b64` | string | | 前端：最长边 ≤ 1536px，JPEG q=0.85 | 图生图参考，任务里会体现为 `has_ref: true`，不进入公共画廊 |

**StyleEnum**

| key | style_name | key | style_name |
|---|---|---|---|
| `none` | 无预设 | `poster` | 电影海报 |
| `photo` | 写实摄影 | `pixel` | 像素风 |
| `ecom` | 电商海报 | `watercolor` | 水彩 |
| `anime` | 动漫 | `render3d` | 3D渲染 |
| `guofeng` | 国风 | `cyber` | 赛博朋克 |
| `avatar` | 头像 | `ghibli` | 吉卜力风 |

**RatioEnum**

| key | ratio_name | 说明 |
|---|---|---|
| `square` | 方形 1:1 | 原图实测 1600×1600 |
| `portrait` | 竖版 3:4 | |
| `tall` | 竖长 9:16 | 适合短剧竖屏 |
| `landscape` | 横版 16:9 | |
| `cinema` | 宽幅 21:9 | |

**Response 200**

```json
{"id": "bf129bc48c"}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 工单 ID，后续用它轮询 |

**Response 4xx**：`{"error": "..."}`，见全局错误码。

---

### 3.2 `GET api/job/{id}` 查询工单

**Path 参数**：`id` — 工单 ID。

**Response 200 — Job 对象**

| 字段 | 类型 | 何时出现 | 说明 |
|---|---|---|---|
| `id` | string | 总是 | 工单 ID |
| `prompt` | string | 总是 | 用户原始提示词（润色后的文本不返回） |
| `negative` | string | 总是 | 没传时为 `""` |
| `style` | string | 总是 | StyleEnum key |
| `style_name` | string | 总是 | 风格中文名 |
| `ratio` | string | 总是 | RatioEnum key |
| `ratio_name` | string | 总是 | 例如 `方形 1:1` |
| `private` | bool | 总是 | 实测都是 `false`，前端没有入口设置 |
| `status` | string | 总是 | `queued` / `generating` / `done` / `failed` |
| `created` | number | 总是 | Unix 秒（float） |
| `error` | string | 总是 | 正常时为 `""`，`failed` 时是失败原因 |
| `has_ref` | bool | 总是 | 是否带参考图 |
| `enhanced` | bool | 总是 | 是否开了润色 |
| `likes` | int | 总是 | 点赞数 |
| `liked` | bool | 总是 | 这个接口里实测总是 `false` |
| `ahead` | int | 仅 `queued` | 前面还有几张；前端预估等待时间 = `max(1, ceil((ahead+1)/3))` 分钟 |
| `image` | string | 仅 `done` | 原图路径 `/draw/img/{id}.jpg` |
| `view` | string | 仅 `done` | 预览图 `/draw/img/{id}_view.jpg` |
| `thumb` | string | 仅 `done` | 缩略图 `/draw/img/{id}_thumb.jpg` |

**状态机**

```
submit ─▶ queued ──(worker 取到)──▶ generating ──▶ done
                                         └──────▶ failed (error 有值)
done 之后 7 天清理 ─▶ 404 找不到这张工单
```

实测耗时：queued 约 10~30s，generating 约 30~60s（当时队列很空）。

**示例**

```json
// queued
{"id":"bf129bc48c","prompt":"一只橘猫坐在窗边晒太阳，水彩画","style":"watercolor","style_name":"水彩","ratio":"square","ratio_name":"方形 1:1","private":false,"status":"queued","created":1794129142.236676,"error":"","has_ref":false,"negative":"","enhanced":false,"likes":0,"liked":false,"ahead":0}

// generating（没有 ahead，也没有图片字段）
{"id":"199eec4846","prompt":"清晨的雪山湖泊，倒影如镜","style":"photo","style_name":"写实摄影","ratio":"landscape","ratio_name":"横版 16:9","private":false,"status":"generating","created":1794129240.9200947,"error":"","has_ref":false,"negative":"","enhanced":false,"likes":0,"liked":false}

// done
{"id":"bf129bc48c","prompt":"一只橘猫坐在窗边晒太阳，水彩画","style":"watercolor","style_name":"水彩","ratio":"square","ratio_name":"方形 1:1","private":false,"status":"done","created":1794129142.236676,"error":"","has_ref":false,"negative":"","enhanced":false,"likes":0,"liked":false,"image":"/draw/img/bf129bc48c.jpg","thumb":"/draw/img/bf129bc48c_thumb.jpg","view":"/draw/img/bf129bc48c_view.jpg"}
```

**Response 404**：`{"error":"找不到这张工单"}`（ID 格式不对时为 `{"error":"not found"}`）。

---

### 3.3 `GET /draw/img/{id}{suffix}.jpg` 图片下载

| suffix | 用途 | 1:1 实测 |
|---|---|---|
| `` | 原图 | 1600×1600，约 550 KB |
| `_view` | 预览 | 1280×1280，约 280 KB |
| `_thumb` | 缩略图 | 480×480，约 50 KB |

- 只能用 `GET`，`HEAD` 返回 501。`Content-Type: image/jpeg`。
- 保留 7 天，需要长期使用就**自己转存**。

---

### 3.4 `GET api/gallery` 公共画廊

**Query**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `page` | int | | 从 1 开始；超出最后一页时**夹到最后一页**；传 0 或非数字也返回 200 |
| `sort` | string | | 只认 `hot`；不传时按最新排序 |

**Response 200**

```jsonc
{
  "items": [ /* Job 对象（同 3.2，只包含 status=done 且非 private 的），每页 50 条 */ ],
  "page": 1,      // 实际返回的页码
  "pages": 5,     // 总页数
  "total": 222    // 总条数
}
```

`items[].liked` 表示**当前请求源 IP** 有没有点过赞。

---

### 3.5 `POST api/like` 点赞 / 取消（按 IP 切换）

**Request**：`{"id": "bf129bc48c"}`

**Response 200**

| 字段 | 类型 | 说明 |
|---|---|---|
| `likes` | int | 最新点赞数 |
| `liked` | bool | 切换后当前 IP 是否处于"已赞" |

**Response 404**：`{"error":"找不到这张图"}`

---

### 3.6 `GET api/stats` 全站统计

```json
{"today_done": 88, "queued": 2, "generating": 3, "total_done": 228}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `today_done` | int | 今日完成数 |
| `queued` | int | 当前排队数 |
| `generating` | int | 当前生成中的数量（实测最多见到 3） |
| `total_done` | int | 历史完成数（7 天内） |

---

### 3.7 Go 类型定义（可以直接用）

```go
package teleapi

type Style string
type Ratio string
type JobStatus string

const (
	StyleNone Style = "none"; StylePhoto Style = "photo"; StyleEcom Style = "ecom"
	StyleAnime Style = "anime"; StyleGuofeng Style = "guofeng"; StyleAvatar Style = "avatar"
	StylePoster Style = "poster"; StylePixel Style = "pixel"; StyleWatercolor Style = "watercolor"
	StyleRender3D Style = "render3d"; StyleCyber Style = "cyber"; StyleGhibli Style = "ghibli"

	RatioSquare Ratio = "square"; RatioPortrait Ratio = "portrait"; RatioTall Ratio = "tall"
	RatioLandscape Ratio = "landscape"; RatioCinema Ratio = "cinema"

	StatusQueued JobStatus = "queued"; StatusGenerating JobStatus = "generating"
	StatusDone JobStatus = "done"; StatusFailed JobStatus = "failed"
)

type SubmitRequest struct {
	Prompt   string `json:"prompt"`
	Style    Style  `json:"style,omitempty"`
	Ratio    Ratio  `json:"ratio,omitempty"`
	Negative string `json:"negative,omitempty"`
	Enhance  bool   `json:"enhance,omitempty"`
	RefB64   string `json:"ref_b64,omitempty"`
}

type SubmitResponse struct {
	ID string `json:"id"`
}

type Job struct {
	ID        string    `json:"id"`
	Prompt    string    `json:"prompt"`
	Negative  string    `json:"negative"`
	Style     Style     `json:"style"`
	StyleName string    `json:"style_name"`
	Ratio     Ratio     `json:"ratio"`
	RatioName string    `json:"ratio_name"`
	Private   bool      `json:"private"`
	Status    JobStatus `json:"status"`
	Created   float64   `json:"created"`
	Error     string    `json:"error"`
	HasRef    bool      `json:"has_ref"`
	Enhanced  bool      `json:"enhanced"`
	Likes     int       `json:"likes"`
	Liked     bool      `json:"liked"`
	Ahead     *int      `json:"ahead,omitempty"`
	Image     string    `json:"image,omitempty"`
	View      string    `json:"view,omitempty"`
	Thumb     string    `json:"thumb,omitempty"`
}

type GalleryResponse struct {
	Items []Job `json:"items"`
	Page  int   `json:"page"`
	Pages int   `json:"pages"`
	Total int   `json:"total"`
}

type LikeResponse struct {
	Likes int  `json:"likes"`
	Liked bool `json:"liked"`
}

type Stats struct {
	TodayDone  int `json:"today_done"`
	Queued     int `json:"queued"`
	Generating int `json:"generating"`
	TotalDone  int `json:"total_done"`
}

type ErrorResponse struct {
	Error string `json:"error"`
}
```

---

## 4. 调用流程（伪代码）

```js
const BASE = "https://ai01.teleapi.top/draw/";
async function draw({prompt, style="none", ratio="square", negative, enhance, refB64}) {
  const r = await fetch(BASE + "api/submit", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({prompt, style, ratio, negative: negative || undefined,
                          enhance: enhance || undefined, ref_b64: refB64 || undefined})
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error);
  while (true) {
    await new Promise(s => setTimeout(s, 4000));
    const job = await (await fetch(BASE + "api/job/" + j.id)).json();
    if (job.error && !job.status) throw new Error(job.error);
    if (job.status === "done") return "https://ai01.teleapi.top" + job.image;
    if (job.status === "failed") throw new Error(job.error || "生成失败");
  }
}
```

---

## 5. 注意事项

- 这是别人运营的**公益站**，没有公开 API 协议和 SLA，接口随时可能改或者加限流。如果要接进自己的产品（例如短剧插件），建议控制好频率、加好失败兜底，最好先联系站长确认。
- 生成的图**默认进公共画廊**（`private` 一直是 false），提示词和图片都对所有人可见；只有参考图不公开。不适合放敏感或商业保密的素材。
- 图片只保留 7 天，需要的话要自己及时下载。
