# 短剧工作台（dsh-drama-studio）

DeepSeek Harness（DSH）插件：从一句话创意到可直接粘贴进 Google Flow 的视频提示词，面向新手的短剧/动态漫创作流水线。架构参考 [dsh-media-desk](https://github.com/woniuniuniu/dsh-media-desk)，写作规范来自 `doc/` 里的 5 个 skill 和《短视频拉片分镜头表格模板》。

不对接任何生图/生视频 API：插件只负责出提示词，图在网页（Flow / 即梦 / Midjourney / 无限画布）里生成后再传回来，视频在 Google Flow 里生成。

## 流程

| 步骤 | 产出 | 依据 |
| --- | --- | --- |
| ① 爆款策划 | 卖点、开场钩子、付费卡点、分集大纲 | 爽点-节奏 skill |
| ② 人物小传 | 小传 + 角色定妆图提示词，上传定妆图 | 人物小传 skill |
| ③ 节奏爽点 | 本集秒级节奏表 | 爽点-节奏 skill |
| ④ 分集剧本 | 详细剧本（台词/动作/镜头感） | 剧本详细写作 skill |
| ⑤ 拉片分镜表 | 景别/机位运镜(起幅→落幅)/人物站位/眼神表演/台词/音效/时长/动态/转场 + 分镜图提示词，上传分镜图 | 剧本转分镜 skill + 拉片模板 + AI 漫剧实战要点 |
| ⑥ 视频提示词 | 按 Google Flow 8 秒一段切好的提示词（可切换 Seedance 2.0），附宫格连贯分镜图提示词 | Seedance skill + Flow 规范 |
| ⑦ 爆款体检 | 评分 + 逐条修改建议（一键交给 AI 改）+ 发布前检查清单，导出 Excel 拉片表 / Markdown | 各 skill 审核清单 |

每一步、每一镜、每一段都支持：AI 生成 / 写修改意见让 AI 改 / 手动编辑 / 历史版本 / 撤销。新建项目时可粘贴一段爆款拉片，AI 会照搬它的节奏与镜头结构。

## 与无限画布互通

[无限画布](https://github.com/basketikun/infinite-canvas) 适合批量生图。分镜表页：

1. 「导出到无限画布」→ 得到 zip，在无限画布首页「导入」。每个镜头已摆好「分镜图提示词 → 生图配置节点」，角色定妆图自动连到出场镜头作为参考图。
2. 在画布里生成满意的图后，在画布首页选中该画布「导出」得到 zip。
3. 回插件点「从画布导回图片」，每镜/每个角色最新生成的图会自动填回。

## 安装与开发

```bash
npm install
npm run build      # 打包前端 dist/client.js
npm test
```

在 DSH 里安装本目录（或 git 地址）为插件即可，宿主路由前缀 `/drama-studio`，数据保存在 `$DSH_HOME/drama-studio/`。本地没有模型时可用 `node scripts/mock-llm.mjs 4399` 起一个 OpenAI 兼容的模拟模型。

## 自我进化（Harness² 式）

`src/prompts.js` + `src/knowledge/` 是插件的 harness。`scripts/evolve.mjs` 按 [Harness²](https://github.com/google-research/harness2) 的 Propose–Probe–Compose 思路迭代 `src/knowledge/evolved.md`：

1. 在 3 个固定创意上用真实模型跑完整流水线，由「制片人」评审按 8 个维度打分，并做硬性检查（时长、站位、Flow 8 秒、镜头覆盖等）。
2. 编辑器针对低分维度提出若干候选规则（Propose），每个候选在同样任务上重跑（Probe）。
3. 对比行为差异合成新规则集（Compose），复测不退步才采纳；经验写入 `evolve/lessons.md` 供下一轮参考。

```bash
DEEPSEEK_API_KEY=sk-... node scripts/evolve.mjs --rounds 3 --candidates 3
```

结果：`evolve/history.json`（每轮分数）、`evolve/lessons.md`、`evolve/round-N-sample.md`。
