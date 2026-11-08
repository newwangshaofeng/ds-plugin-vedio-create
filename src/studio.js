// 短剧工作台流水线：生成、按意见修改、手动保存、历史版本和后台任务。
import { randomUUID } from 'node:crypto'
import { extractJson, splitMergedItems, stripFence } from './ai.js'
import {
  charactersPrompts, clipsPrompts, planPrompts, reviewPrompts, revisePrompts, rhythmPrompts, scriptPrompts, shotsPrompts, STEP_LABEL,
  withEvolved,
} from './prompts.js'

export const PROJECT_STEPS = ['plan', 'characters']
export const EPISODE_STEPS = ['rhythm', 'script', 'shots', 'clips', 'review']
export const STEPS = [...PROJECT_STEPS, ...EPISODE_STEPS]
const BUILDERS = { plan: planPrompts, characters: charactersPrompts, rhythm: rhythmPrompts, script: scriptPrompts, shots: shotsPrompts, clips: clipsPrompts, review: reviewPrompts }
const MAX_HISTORY = 12

export const DEFAULT_CONFIG = { genre: '', audience: '', episodes: 10, epSeconds: 90, style: '国漫 3D 写实风格，电影感光影', ratio: '9:16', videoTarget: 'flow', notes: '', reference: '' }

export const newId = (prefix = 'p') => `${prefix}_${randomUUID().slice(0, 8)}`
const text = (value, max = 4000) => (typeof value === 'string' ? value.trim().slice(0, max) : typeof value === 'number' ? String(value) : '')
const num = (value, min, max, fallback) => (Number.isFinite(Number(value)) && value !== '' && value !== null ? Math.max(min, Math.min(max, Math.round(Number(value)))) : fallback)
const asArray = value => (Array.isArray(value) ? value : [])

export function normalizeConfig(input = {}, base = DEFAULT_CONFIG) {
  return {
    genre: text(input.genre ?? base.genre, 60),
    audience: text(input.audience ?? base.audience, 80),
    episodes: num(input.episodes ?? base.episodes, 1, 100, 10),
    epSeconds: num(input.epSeconds ?? base.epSeconds, 15, 600, 90),
    style: text(input.style ?? base.style, 200),
    ratio: ['9:16', '16:9', '1:1', '3:4', '4:3'].includes(input.ratio) ? input.ratio : base.ratio,
    videoTarget: ['flow', 'seedance'].includes(input.videoTarget) ? input.videoTarget : base.videoTarget,
    notes: text(input.notes ?? base.notes, 1000),
    reference: text(input.reference ?? base.reference ?? '', 4000),
  }
}

export function createProject({ title, idea, config } = {}, now = new Date()) {
  const at = now.toISOString()
  return {
    id: newId('p'), title: text(title, 60) || '未命名短剧', idea: text(idea, 2000), config: normalizeConfig(config),
    plan: null, characters: [], episodeData: {}, history: {}, createdAt: at, updatedAt: at,
  }
}

export function normalizePlan(raw) {
  const plan = raw?.plan && typeof raw.plan === 'object' ? raw.plan : raw ?? {}
  return {
    title: text(plan.title, 60), logline: text(plan.logline, 300), hook: text(plan.hook, 400),
    sellingPoints: asArray(plan.sellingPoints).map(v => text(v, 200)).filter(Boolean).slice(0, 8),
    audience: text(plan.audience, 300), world: text(plan.world, 600), mainConflict: text(plan.mainConflict, 600),
    emotionCurve: text(plan.emotionCurve, 800), visualStyle: text(plan.visualStyle, 300),
    episodes: asArray(plan.episodes).map((ep, i) => ({
      no: i + 1, title: text(ep?.title, 40), summary: text(ep?.summary, 600), hook: text(ep?.hook, 300), climax: text(ep?.climax, 300), cliffhanger: text(ep?.cliffhanger, 300),
    })),
  }
}

const sub = (obj, keys) => Object.fromEntries(keys.map(k => [k, text(obj?.[k], 600)]))

export function normalizeCharacter(ch = {}, keep = {}) {
  return {
    id: keep.id || ch.id || newId('c'),
    name: text(ch.name, 30), alias: text(ch.alias, 60), age: text(ch.age, 20), role: text(ch.role, 40),
    appearance: text(ch.appearance, 300), tags: text(ch.tags, 120), voice: text(ch.voice, 200), prop: text(ch.prop, 200),
    background: sub(ch.background, ['experience', 'obsession', 'motive']),
    personality: sub(ch.personality, ['explicit', 'contrast', 'trigger']),
    dynamic: sub(ch.dynamic, ['habit', 'micro', 'voiceDetail']),
    story: sub(ch.story, ['function', 'relations', 'arc']),
    imagePrompt: text(ch.imagePrompt, 2000),
    image: typeof (ch.image ?? keep.image) === 'string' ? (ch.image ?? keep.image) : '',
  }
}

export function normalizeCharacters(raw, previous = []) {
  const list = Array.isArray(raw) ? raw : asArray(raw?.characters)
  return list.map(ch => normalizeCharacter(ch, previous.find(p => p.id === ch?.id || (p.name && p.name === text(ch?.name, 30))) ?? {})).filter(ch => ch.name)
}

export function normalizeShot(s = {}, keep = {}) {
  return {
    no: 0, scene: text(s.scene, 80), time: text(s.time, 40), characters: text(s.characters, 120),
    size: text(s.size, 20), camera: text(s.camera, 200), blocking: text(s.blocking, 300), acting: text(s.acting, 400), visual: text(s.visual, 600), dialogue: text(s.dialogue, 600), sound: text(s.sound, 300),
    seconds: num(s.seconds, 1, 60, 3), dynamic: text(s.dynamic, 20), transition: text(s.transition, 20), note: text(s.note, 300),
    imagePrompt: text(s.imagePrompt, 2000), image: typeof (s.image ?? keep.image) === 'string' ? (s.image ?? keep.image) : '',
  }
}

export function normalizeShots(raw, previous = []) {
  const list = Array.isArray(raw) ? raw : asArray(raw?.shots)
  return list.map((s, i) => ({ ...normalizeShot(s, previous[i] ?? {}), no: i + 1 })).filter(s => s.visual || s.imagePrompt)
}

export function normalizeClip(c = {}) {
  const shots = asArray(c.shots).map(Number).filter(Number.isFinite)
  return {
    no: 0, shots, seconds: num(c.seconds, 1, 30, 8), mode: text(c.mode, 20).split(/[（(\s]/)[0] || 'text',
    refs: text(c.refs, 400), prompt: text(c.prompt, 6000), gridPrompt: text(c.gridPrompt, 4000), tips: text(c.tips, 300),
  }
}

export function normalizeClips(raw) {
  const list = Array.isArray(raw) ? raw : asArray(raw?.clips)
  return list.map((c, i) => ({ ...normalizeClip(c), no: i + 1 })).filter(c => c.prompt)
}

export function normalizeReview(raw) {
  return {
    score: num(raw?.score, 0, 100, 0), verdict: text(raw?.verdict, 300),
    dimensions: asArray(raw?.dimensions).map(d => ({ name: text(d?.name, 30), score: num(d?.score, 0, 10, 0), comment: text(d?.comment, 400) })).filter(d => d.name),
    issues: asArray(raw?.issues).map(d => ({ step: EPISODE_STEPS.includes(d?.step) ? d.step : 'script', problem: text(d?.problem, 400), fix: text(d?.fix, 600) })).filter(d => d.problem).slice(0, 10),
    strengths: asArray(raw?.strengths).map(v => text(v, 200)).filter(Boolean).slice(0, 6),
    at: new Date().toISOString(),
  }
}

export function episode(project, ep) {
  project.episodeData ??= {}
  project.episodeData[ep] ??= { rhythm: '', script: '', shots: [], clips: [], review: null }
  return project.episodeData[ep]
}

export function getValue(project, step, ep) {
  if (step === 'plan') return project.plan
  if (step === 'characters') return project.characters
  return project.episodeData?.[ep]?.[step] ?? null
}

export function historyKey(step, ep) {
  return PROJECT_STEPS.includes(step) ? step : `${step}:${ep}`
}

/** 改写某一步的值；旧值进历史版本。 */
export function setValue(project, step, ep, value, label) {
  const old = getValue(project, step, ep)
  const empty = old == null || old === '' || (Array.isArray(old) && !old.length)
  if (!empty && JSON.stringify(old) !== JSON.stringify(value)) {
    project.history ??= {}
    const list = (project.history[historyKey(step, ep)] ??= [])
    list.unshift({ at: new Date().toISOString(), label: label || '修改前', value: old })
    list.length = Math.min(list.length, MAX_HISTORY)
  }
  if (step === 'plan') {
    project.plan = value
    if (value?.title && (!project.title || project.title === '未命名短剧')) project.title = value.title
  } else if (step === 'characters') project.characters = value
  else episode(project, ep)[step] = value
  project.updatedAt = new Date().toISOString()
}

/** 把用户手填的值规范化后写入；scope 指定只改某一镜/某一段/某个角色。 */
export function normalizeStep(step, raw, project, ep, scope) {
  const current = getValue(project, step, ep)
  if (scope && ['shots', 'clips', 'characters'].includes(step)) {
    const list = [...asArray(current)]
    const index = step === 'characters' ? list.findIndex(c => c.id === scope.id) : Number(scope.no) - 1
    if (index < 0 || index >= list.length) throw Object.assign(new Error('要修改的条目不存在'), { status: 400 })
    const item = Array.isArray(raw?.[step]) ? raw[step][0] : raw
    if (step === 'shots') list[index] = { ...normalizeShot(item, list[index]), no: index + 1 }
    else if (step === 'clips') list[index] = { ...normalizeClip(item), no: index + 1 }
    else list[index] = normalizeCharacter(item, list[index])
    return list
  }
  if (step === 'plan') return normalizePlan(raw)
  if (step === 'characters') return normalizeCharacters(raw, asArray(current))
  if (step === 'rhythm' || step === 'script') return stripFence(text(raw, 60000))
  if (step === 'shots') return normalizeShots(raw, asArray(current))
  if (step === 'clips') return normalizeClips(raw)
  if (step === 'review') return normalizeReview(raw)
  throw Object.assign(new Error(`未知步骤：${step}`), { status: 400 })
}

/** 上一步没做完时给出可读的提示。 */
export function missingInput(project, step, ep) {
  const data = project.episodeData?.[ep] ?? {}
  if (step === 'plan') return project.idea ? null : '先写一句话创意'
  if (step === 'characters') return project.plan ? null : '先生成爆款策划'
  if (!project.plan) return '先生成爆款策划'
  if (step === 'script' && !data.rhythm) return null
  if (step === 'shots') return data.script ? null : '先生成本集剧本'
  if (step === 'clips') return data.shots?.length ? null : '先生成分镜表'
  if (step === 'review') return data.script ? null : '先生成本集剧本'
  return null
}

function scopeText(step, scope, current) {
  if (!scope) return { scope: '', current }
  const list = asArray(current)
  if (step === 'characters') {
    const item = list.find(c => c.id === scope.id)
    return { scope: `只修改角色「${item?.name}」，输出格式为 {"characters":[一个角色对象]}`, current: { characters: [item] } }
  }
  const item = list[Number(scope.no) - 1]
  const label = step === 'shots' ? `第 ${scope.no} 镜` : `第 ${scope.no} 段视频`
  return { scope: `只修改${label}，输出格式为 {"${step}":[这一条]}，no 保持 ${scope.no}`, current: { [step]: [item] } }
}

export function buildPrompts(project, step, ep, { comment = '', scope = null, revise = false } = {}) {
  const base = withEvolved(step, BUILDERS[step](project, ep))
  const current = getValue(project, step, ep)
  const has = current && !(Array.isArray(current) && !current.length)
  if (!revise && !scope) return base
  if (!has) return base
  const scoped = scopeText(step, scope, current)
  const body = typeof scoped.current === 'string' ? scoped.current : JSON.stringify(stripImages(scoped.current))
  return revisePrompts(base, body, comment, scoped.scope)
}

function stripImages(value) {
  return JSON.parse(JSON.stringify(value ?? null, (key, v) => (key === 'image' || key === 'history' ? undefined : v)))
}

function recoverMergedItems(step, parsed, output) {
  if (!['shots', 'clips'].includes(step) || !Array.isArray(parsed?.[step])) return parsed
  const keys = output.match(/"no"\s*:/g)?.length ?? 0
  if (keys <= parsed[step].length) return parsed
  try {
    const split = extractJson(splitMergedItems(output))
    return split?.[step]?.length > parsed[step].length ? split : parsed
  } catch {
    return parsed
  }
}

/** 后台任务：模型调用可能要一两分钟，前端轮询进度并实时看到正在写的文字。 */
export class Studio {
  constructor({ store, callText }) {
    this.store = store
    this.callText = callText
    this.jobs = new Map()
  }

  jobKey(pid, step, ep, scope) {
    return [pid, step, PROJECT_STEPS.includes(step) ? '' : ep, scope ? scope.id || scope.no : ''].join('|')
  }

  listJobs(pid) {
    return [...this.jobs.values()].filter(j => !pid || j.pid === pid).map(({ controller, ...job }) => job)
  }

  cancel(key) {
    const job = this.jobs.get(key)
    if (job?.status === 'running') job.controller.abort()
    return Boolean(job)
  }

  /** 生成或修改一步；chain 依次跑多步。返回任务 key。 */
  start(pid, steps, ep, options = {}) {
    const list = Array.isArray(steps) ? steps : [steps]
    for (const step of list) if (!STEPS.includes(step)) throw Object.assign(new Error(`未知步骤：${step}`), { status: 400 })
    const key = this.jobKey(pid, list.length > 1 ? 'chain' : list[0], ep, options.scope)
    if (this.jobs.get(key)?.status === 'running') throw Object.assign(new Error('这一步正在生成，请稍等'), { status: 409 })
    for (const job of this.jobs.values()) {
      if (job.pid === pid && job.status === 'running' && (job.steps.some(s => list.includes(s)) && (job.ep === ep || PROJECT_STEPS.includes(list[0])))) throw Object.assign(new Error(`「${STEP_LABEL[job.step]}」正在生成，请稍等`), { status: 409 })
    }
    const job = { key, id: newId('j'), pid, steps: list, step: list[0], ep, scope: options.scope ?? null, status: 'running', text: '', error: null, done: [], startedAt: Date.now(), controller: new AbortController() }
    this.jobs.set(key, job)
    job.promise = this.run(job, options).catch(() => {})
    return key
  }

  async run(job, options) {
    try {
      for (const step of job.steps) {
        job.step = step
        job.text = ''
        const project = (await this.store.read()).projects.find(p => p.id === job.pid)
        if (!project) throw new Error('项目不存在')
        const missing = missingInput(project, step, job.ep)
        if (missing) throw new Error(missing)
        const first = job.steps.length === 1
        const prompts = buildPrompts(project, step, job.ep, first ? options : {})
        const { text: output } = await this.callText({ ...prompts, signal: job.controller.signal, onText: d => { job.text += d } })
        if (job.controller.signal.aborted) throw new Error('已取消')
        let parsed
        try {
          parsed = prompts.json ? extractJson(output) : output
          parsed = recoverMergedItems(step, parsed, output)
        } catch {
          throw new Error('模型输出格式不对，请重试一次（或换一个更强的模型）')
        }
        await this.store.mutate(`AI ${options.revise && first ? '修改' : '生成'}${STEP_LABEL[step]}`, state => {
          const p = state.projects.find(x => x.id === job.pid)
          if (!p) throw new Error('项目不存在')
          const value = normalizeStep(step, parsed, p, job.ep, first ? options.scope : null)
          if ((Array.isArray(value) && !value.length) || value === '') throw new Error('模型返回内容为空，请重试')
          setValue(p, step, job.ep, value, `AI ${options.revise ? '修改' : '重新生成'}前`)
        })
        job.done.push(step)
      }
      job.status = 'done'
    } catch (err) {
      job.status = 'error'
      job.error = job.controller.signal.aborted ? '已取消' : err.message
    } finally {
      job.finishedAt = Date.now()
      // 只保留最近的任务记录
      const finished = [...this.jobs.values()].filter(j => j.status !== 'running').sort((a, b) => b.finishedAt - a.finishedAt)
      for (const old of finished.slice(30)) this.jobs.delete(old.key)
    }
  }
}
