#!/usr/bin/env node
// 自我进化：按 Harness² 的 Propose–Probe–Compose 思路迭代 src/knowledge/evolved.md（插件 harness 的可编辑部分）。
// 每轮：在固定的几个创意上跑真实流水线 → 评审打分 → 编辑器提出若干候选规则 → 每个候选在同样任务上重跑（Probe）
// → 对比行为差异，把真正带来提升的规则合成新的 harness（Compose），并把经验写进 evolve/lessons.md（改进 harness）。
// 用法：DEEPSEEK_API_KEY=sk-... node scripts/evolve.mjs --rounds 3 [--model deepseek-flash] [--base-url https://api.deepseek.com]
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createProject, buildPrompts, normalizeStep, setValue } from '../src/studio.js'
import { extractJson } from '../src/ai.js'
import { evolvedRules, setEvolvedOverride } from '../src/prompts.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const EVOLVED = join(ROOT, 'src/knowledge/evolved.md')
const OUT = join(ROOT, 'evolve')
const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback }
const ROUNDS = Number(arg('rounds', 3))
const CANDIDATES = Number(arg('candidates', 3))
const MODEL = arg('model', process.env.EVOLVE_MODEL || 'deepseek-flash')
const BASE_URL = arg('base-url', process.env.EVOLVE_BASE_URL || 'https://api.deepseek.com')
const KEY = process.env.DEEPSEEK_API_KEY
if (!KEY) { console.error('需要环境变量 DEEPSEEK_API_KEY'); process.exit(1) }

const TASKS = [
  { idea: '外卖小哥在订婚宴上被豪门千金当众羞辱，其实他是隐藏的集团继承人', genre: '都市逆袭' },
  { idea: '替嫁的哑女被全家当成弃子，新婚夜她开口说出了冷面总裁家族的惊天秘密', genre: '女频甜宠' },
  { idea: '被宗门废掉修为的杂役弟子，在宗门大比当天觉醒了上古血脉', genre: '玄幻爽文' },
]
const EP_STEPS = ['rhythm', 'script', 'shots', 'clips']
const DIMS = ['前3秒钩子', '30秒留人', '冲突与爽点', '结尾卡点', '台词质量', '人物一致性', '分镜可拍性', '视频提示词可用性']

let active = 0
const queue = []
async function limit(fn) {
  if (active >= 6) await new Promise(r => queue.push(r))
  active++
  try { return await fn() } finally { active--; queue.shift()?.() }
}

async function chat(system, user, maxTokens = 16000) {
  return limit(async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetch(`${BASE_URL}/chat/completions`, { method: 'POST', headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }) })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error?.message || res.status)
        return data.choices[0].message.content
      } catch (err) {
        if (attempt >= 2) throw err
        await new Promise(r => setTimeout(r, 3000 * (attempt + 1)))
      }
    }
  })
}

/** 模型偶尔输出坏 JSON：重试两次。 */
async function chatJson(system, user, maxTokens) {
  for (let attempt = 0; ; attempt++) {
    try { return extractJson(await chat(system, user, maxTokens)) } catch (err) { if (attempt >= 2) throw err }
  }
}

async function runStep(project, step, ep, rules) {
  setEvolvedOverride(rules)
  const prompts = buildPrompts(project, step, ep)
  setEvolvedOverride(null)
  const raw = prompts.json ? await chatJson(prompts.system, prompts.user, prompts.maxTokens) : await chat(prompts.system, prompts.user, prompts.maxTokens)
  setValue(project, step, ep, normalizeStep(step, raw, project, ep), 'evolve')
}

/** 上游（策划+人物）每个任务只生成一次并缓存，候选规则只影响分集流水线，这样对比更干净。 */
async function upstream(task, rules) {
  const project = createProject({ idea: task.idea, config: { genre: task.genre, episodes: 6, epSeconds: 60 } })
  await runStep(project, 'plan', 1, rules)
  await runStep(project, 'characters', 1, rules)
  return project
}

async function episodeRun(base, rules) {
  const project = structuredClone(base)
  for (const step of EP_STEPS) await runStep(project, step, 1, rules)
  return project
}

function ruleChecks(project) {
  const ep = project.episodeData[1]
  const shots = ep.shots ?? []
  const clips = ep.clips ?? []
  const total = shots.reduce((s, x) => s + x.seconds, 0)
  const issues = []
  if (Math.abs(total - 60) > 12) issues.push(`镜头总时长 ${total} 秒，偏离目标 60 秒`)
  if (shots.some(s => s.seconds > 6 || s.seconds < 1)) issues.push('存在单镜超过 6 秒或少于 1 秒')
  const noBlocking = shots.filter(s => s.characters && !s.blocking).length
  if (noBlocking) issues.push(`${noBlocking} 个有人物的镜头没写站位`)
  const covered = new Set(clips.flatMap(c => c.shots))
  const missing = shots.filter(s => !covered.has(s.no)).length
  if (missing) issues.push(`${missing} 个镜头没有进入任何视频段`)
  if (clips.some(c => c.seconds > 8)) issues.push('有视频段超过 Flow 的 8 秒')
  if (clips.some(c => !/no subtitles/i.test(c.prompt))) issues.push('有视频提示词缺少 no subtitles')
  return { score: Math.max(0, 10 - issues.length * 2), issues }
}

async function judge(project) {
  const ep = project.episodeData[1]
  const system = `你是抖音/红果短剧的资深制片人兼 AI 视频导演，负责在投流前把关第 1 集。严格打分（1-10，7 分=能上线，9 分=爆款水准），不要客气。
只输出 JSON：{"scores":{${DIMS.map(d => `"${d}":0`).join(',')}},"critique":["最影响效果的 3-5 个具体问题，指出在哪一镜/哪句台词"]}`
  const user = `<plan>${JSON.stringify(project.plan)}</plan>
<characters>${JSON.stringify(project.characters.map(c => ({ name: c.name, appearance: c.appearance })))}</characters>
<script>${ep.script}</script>
<shots>${JSON.stringify(ep.shots.map(({ image, ...s }) => s))}</shots>
<clips>${JSON.stringify(ep.clips.map(c => ({ no: c.no, shots: c.shots, seconds: c.seconds, prompt: c.prompt })))}</clips>`
  const out = await chatJson(system, user, 12000)
  const scores = Object.fromEntries(DIMS.map(d => [d, Number(out.scores?.[d]) || 0]))
  const rules = ruleChecks(project)
  const avg = DIMS.reduce((s, d) => s + scores[d], 0) / DIMS.length
  return { total: Math.round((avg * 0.85 + rules.score * 0.15) * 100) / 10, scores, critique: out.critique ?? [], rules: rules.issues }
}

async function evaluate(bases, rules) {
  const runs = await Promise.all(bases.map(async base => { const project = await episodeRun(base, rules); return { project, review: await judge(project) } }))
  const mean = runs.reduce((s, r) => s + r.review.total, 0) / runs.length
  const dims = Object.fromEntries(DIMS.map(d => [d, runs.reduce((s, r) => s + r.review.scores[d], 0) / runs.length]))
  return { mean: Math.round(mean * 10) / 10, dims, runs }
}

const summary = ev => ev.runs.map((r, i) => `任务${i + 1}《${r.project.title}》总分 ${r.review.total}\n各维度：${JSON.stringify(r.review.scores)}\n问题：${r.review.critique.join('；')}\n硬性检查：${r.review.rules.join('；') || '通过'}\n第一集剧本开头：${r.project.episodeData[1].script.slice(0, 400)}\n前 3 镜：${JSON.stringify(r.project.episodeData[1].shots.slice(0, 3).map(({ image, imagePrompt, ...s }) => s))}`).join('\n\n')

async function propose(rules, ev, lessons) {
  const system = `你是 Harness² 中的 harness 编辑器。被优化的系统是一个「短剧创作插件」的提示词，流水线：rhythm(节奏表) → script(剧本) → shots(分镜表 JSON) → clips(Google Flow 视频提示词 JSON)。
你能改的只有「迭代规则」：每条规则挂在某一步，追加到该步系统提示词末尾。根据评审结果提出 ${CANDIDATES} 个互相独立的候选修改，每个候选 1-3 条规则，针对最低分维度、要求具体可执行（不要空话，比如「台词更好」不行，要写清怎么做）。可以删除或改写已有规则。
只输出 JSON：{"candidates":[{"hypothesis":"想解决什么问题、为什么有效","edits":[{"step":"rhythm|script|shots|clips","op":"add|replace_all","rules":["规则1","规则2"]}]}]}`
  const user = `<current_rules>\n${rules}\n</current_rules>\n<lessons>\n${lessons}\n</lessons>\n<evaluation mean="${ev.mean}">\n${summary(ev)}\n</evaluation>`
  return (await chatJson(system, user, 16000)).candidates ?? []
}

function apply(rules, edits) {
  const steps = ['plan', 'characters', 'rhythm', 'script', 'shots', 'clips', 'review']
  const map = Object.fromEntries(steps.map(s => [s, evolvedRules(s, rules).split('\n').filter(Boolean)]))
  for (const e of edits ?? []) {
    if (!map[e.step]) continue
    const lines = (e.rules ?? []).map(r => `- ${String(r).replace(/^[-\s]+/, '')}`)
    map[e.step] = e.op === 'replace_all' ? lines : [...map[e.step], ...lines]
  }
  const head = rules.split(/^## /m)[0].trimEnd()
  return `${head}\n\n${steps.map(s => `## ${s}\n${map[s].join('\n')}`).join('\n\n')}\n`
}

async function compose(rules, baseline, probes) {
  const system = `你是 Harness² 中的 compose 步骤。下面是同一批任务上：基线 harness 的得分，以及每个候选修改单独应用后的得分（按维度）。
请根据行为对比合成新的规则集：保留带来提升且不造成明显退步的修改，丢弃无效或有害的；可以合并、精简措辞；总规则每步不超过 6 条。
同时写 1-3 条「经验教训」，供以后提出修改时参考（例如：哪类规则有效/无效）。
只输出 JSON：{"edits":[{"step":"...","op":"replace_all","rules":["..."]}],"lessons":["..."],"reason":"..."}（edits 只需包含有变化的步骤；没有任何候选有效时 edits 为空数组）`
  const user = `<current_rules>\n${rules}\n</current_rules>\n<baseline mean="${baseline.mean}">${JSON.stringify(baseline.dims)}</baseline>\n${probes.map((p, i) => `<candidate id="${i + 1}" mean="${p.ev.mean}" delta="${(p.ev.mean - baseline.mean).toFixed(1)}">\n假设：${p.c.hypothesis}\n修改：${JSON.stringify(p.c.edits)}\n各维度：${JSON.stringify(p.ev.dims)}\n评审问题：${p.ev.runs.flatMap(r => r.review.critique).slice(0, 6).join('；')}\n</candidate>`).join('\n')}`
  return chatJson(system, user, 16000)
}

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

async function main() {
  await mkdir(OUT, { recursive: true })
  let rules = await readFile(EVOLVED, 'utf8')
  const lessonsFile = join(OUT, 'lessons.md')
  let lessons = await readFile(lessonsFile, 'utf8').catch(() => '# 改进经验（Harness² 改进 harness）\n')
  const history = []
  log(`模型 ${MODEL}，${TASKS.length} 个任务，${ROUNDS} 轮，每轮 ${CANDIDATES} 个候选`)
  const bases = await Promise.all(TASKS.map(t => upstream(t, rules)))
  log('策划+人物已生成：', bases.map(b => b.title).join(' / '))
  let baseline = await evaluate(bases, rules)
  log(`基线 ${baseline.mean}`, JSON.stringify(baseline.dims))
  history.push({ round: 0, mean: baseline.mean, dims: baseline.dims })
  for (let round = 1; round <= ROUNDS; round++) {
    const candidates = await propose(rules, baseline, lessons)
    log(`第 ${round} 轮：${candidates.length} 个候选`, candidates.map(c => c.hypothesis).join(' | '))
    const probes = await Promise.all(candidates.map(async c => ({ c, ev: await evaluate(bases, apply(rules, c.edits)) })))
    probes.forEach((p, i) => log(`  候选 ${i + 1}: ${p.ev.mean}（${(p.ev.mean - baseline.mean).toFixed(1)}）`))
    const composed = await compose(rules, baseline, probes)
    const next = apply(rules, composed.edits)
    let adopted = false
    if (composed.edits?.length) {
      const ev = await evaluate(bases, next)
      log(`  合成后 ${ev.mean}（基线 ${baseline.mean}）`)
      if (ev.mean >= baseline.mean) { rules = next; baseline = ev; adopted = true; await writeFile(EVOLVED, rules) }
    }
    // 合成反而退步时，退回到单独提升最多的那个候选（它已经在同样任务上测过）。
    const best = probes.reduce((a, b) => (b.ev.mean > (a?.ev.mean ?? -1) ? b : a), null)
    if (!adopted && best && best.ev.mean > baseline.mean) {
      rules = apply(rules, best.c.edits); baseline = best.ev; adopted = true; await writeFile(EVOLVED, rules)
      log(`  合成未通过，改用最佳单一候选 ${best.ev.mean}`)
    }
    lessons += `\n## 第 ${round} 轮（${adopted ? '采纳' : '未采纳'}，${baseline.mean} 分）\n${(composed.lessons ?? []).map(l => `- ${l}`).join('\n')}\n`
    await writeFile(lessonsFile, lessons)
    history.push({ round, adopted, mean: baseline.mean, dims: baseline.dims, candidates: probes.map(p => ({ hypothesis: p.c.hypothesis, edits: p.c.edits, mean: p.ev.mean })), reason: composed.reason })
    await writeFile(join(OUT, 'history.json'), JSON.stringify(history, null, 2))
    await writeFile(join(OUT, `round-${round}-sample.md`), summary(baseline))
  }
  log('完成：', history.map(h => `R${h.round}=${h.mean}`).join(' → '))
}

main().catch(err => { console.error(err); process.exit(1) })
