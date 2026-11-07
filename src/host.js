// dsh-drama-studio host 半片：/drama-studio/* 接口、上传文件服务和模型调用。
import { stat, unlink, writeFile } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { extname, join } from 'node:path'
import { callModel, defaultSelection, modelInfo, modelStatus } from './ai.js'
import { exportMarkdown, exportXlsx } from './export.js'
import { createProject, episode, EPISODE_STEPS, getValue, historyKey, newId, normalizeConfig, normalizeStep, setValue, STEPS, Studio } from './studio.js'
import { Store } from './store.js'

export const PREFIX = '/drama-studio'
const MAX_JSON = 4_000_000
const MAX_UPLOAD = 30_000_000
const MIME = { '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' }
const UPLOAD_EXT = Object.fromEntries(Object.entries(MIME).map(([ext, type]) => [type, ext]))

function json(res, status, body) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

const fail = (status, message) => Object.assign(new Error(message), { status })

async function readBuffer(req, limit) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw fail(413, '文件太大')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

async function readJson(req) {
  const raw = await readBuffer(req, MAX_JSON)
  if (!raw.length) return {}
  try {
    return JSON.parse(raw.toString('utf8'))
  } catch {
    throw fail(400, '请求不是有效的 JSON')
  }
}

async function sendFile(res, file) {
  const type = MIME[extname(file).toLowerCase()]
  if (!type) return json(res, 404, { error: '不支持的文件类型' })
  try {
    await stat(file)
  } catch {
    return json(res, 404, { error: '文件不存在' })
  }
  res.setHeader('content-type', type)
  res.setHeader('cache-control', 'private, max-age=86400')
  res.setHeader('x-content-type-options', 'nosniff')
  createReadStream(file).pipe(res)
}

function summary(p) {
  const eps = Object.entries(p.episodeData ?? {})
  return {
    id: p.id, title: p.title, idea: p.idea, updatedAt: p.updatedAt, episodes: p.config?.episodes,
    progress: { plan: Boolean(p.plan), characters: p.characters?.length ?? 0, scripts: eps.filter(([, d]) => d.script).length, shots: eps.filter(([, d]) => d.shots?.length).length, clips: eps.filter(([, d]) => d.clips?.length).length },
  }
}

function findProject(state, id) {
  const project = state.projects.find(p => p.id === id)
  if (!project) throw fail(404, '项目不存在')
  return project
}

function checkStep(step) {
  if (!STEPS.includes(step)) throw fail(400, `未知步骤：${step}`)
  return step
}

/** 定位一张图片挂在哪：角色定妆图或某一镜的分镜图。 */
function imageSlot(project, { kind, ep, no, id }) {
  if (kind === 'character') {
    const ch = project.characters.find(c => c.id === id)
    if (!ch) throw fail(404, '角色不存在')
    return ch
  }
  const shot = project.episodeData?.[ep]?.shots?.[Number(no) - 1]
  if (!shot) throw fail(404, '分镜不存在')
  return shot
}

export async function route(ctx, store, studio, req, res) {
  const url = new URL(req.url || '/', 'http://local')
  const path = url.pathname.replace(/^\/drama-studio\/?/, '')
  const method = req.method || 'GET'
  const q = Object.fromEntries(url.searchParams)

  if (method === 'GET' || method === 'HEAD') {
    if (path.startsWith('files/')) {
      const name = path.slice('files/'.length)
      if (!/^[\w.-]+$/.test(name)) return json(res, 400, { error: '路径无效' })
      await store.read()
      return sendFile(res, join(store.filesDir, name))
    }
    if (path === 'state') {
      const state = await store.read()
      return json(res, 200, { projects: state.projects.map(summary).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)), model: modelInfo(ctx), modelStatus, canUndo: store.undo.length > 0, undoLabel: store.undo.at(-1)?.label ?? null })
    }
    if (path === 'project') {
      const project = findProject(await store.read(), q.id)
      return json(res, 200, { project, jobs: studio.listJobs(project.id), canUndo: store.undo.length > 0, undoLabel: store.undo.at(-1)?.label ?? null })
    }
    if (path === 'jobs') return json(res, 200, { jobs: studio.listJobs(q.id) })
    if (path === 'export') {
      const state = await store.read()
      const project = findProject(state, q.id)
      const base = encodeURIComponent(project.title || 'drama')
      if (q.format === 'md') {
        res.setHeader('content-type', 'text/markdown; charset=utf-8')
        res.setHeader('content-disposition', `attachment; filename*=UTF-8''${base}.md`)
        return res.end(exportMarkdown(project))
      }
      const buffer = await exportXlsx(project, store.filesDir)
      res.setHeader('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      res.setHeader('content-disposition', `attachment; filename*=UTF-8''${base}.xlsx`)
      return res.end(buffer)
    }
    return json(res, 404, { error: '没有这个接口' })
  }
  if (method !== 'POST') return json(res, 405, { error: '不支持的请求方法' })

  if (path === 'upload') {
    const type = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase()
    const ext = UPLOAD_EXT[type === 'image/jpg' ? 'image/jpeg' : type]
    if (!ext) return json(res, 415, { error: '只支持 PNG / JPG / WebP / GIF 图片' })
    const buffer = await readBuffer(req, MAX_UPLOAD)
    await store.read()
    const name = `${newId('img')}${ext}`
    await writeFile(join(store.filesDir, name), buffer)
    const old = await store.mutate('上传图片', state => {
      const slot = imageSlot(findProject(state, q.id), q)
      const previous = slot.image
      slot.image = name
      return previous
    })
    return json(res, 200, { image: name, replaced: old || null })
  }

  const body = await readJson(req)
  if (path === 'project/create') {
    const project = createProject(body)
    await store.mutate('新建短剧', state => { state.projects.push(project) })
    return json(res, 200, { id: project.id })
  }
  if (path === 'project/update') {
    await store.mutate('修改项目设置', state => {
      const p = findProject(state, body.id)
      if (typeof body.title === 'string') p.title = body.title.trim().slice(0, 60) || p.title
      if (typeof body.idea === 'string') p.idea = body.idea.trim().slice(0, 2000)
      if (body.config) p.config = normalizeConfig(body.config, p.config)
      p.updatedAt = new Date().toISOString()
    })
    return json(res, 200, { ok: true })
  }
  if (path === 'project/delete') {
    await store.mutate('删除短剧', state => { state.projects = state.projects.filter(p => p.id !== body.id) })
    return json(res, 200, { ok: true })
  }
  if (path === 'step/save') {
    const step = checkStep(body.step)
    await store.mutate(`手动修改${step}`, state => {
      const p = findProject(state, body.id)
      setValue(p, step, Number(body.ep) || 1, normalizeStep(step, body.value, p, Number(body.ep) || 1, body.scope || null), '手动修改前')
    })
    return json(res, 200, { ok: true })
  }
  if (path === 'step/generate') {
    const steps = (Array.isArray(body.steps) ? body.steps : [body.step]).map(checkStep)
    const key = studio.start(body.id, steps, Number(body.ep) || 1, { comment: String(body.comment ?? '').slice(0, 4000), scope: body.scope || null, revise: Boolean(body.revise) })
    return json(res, 200, { key })
  }
  if (path === 'step/restore') {
    const step = checkStep(body.step)
    await store.mutate('恢复历史版本', state => {
      const p = findProject(state, body.id)
      const ep = Number(body.ep) || 1
      const entry = p.history?.[historyKey(step, ep)]?.[Number(body.index)]
      if (!entry) throw fail(404, '历史版本不存在')
      setValue(p, step, ep, entry.value, '恢复前')
    })
    return json(res, 200, { ok: true })
  }
  if (path === 'step/clear-episode') {
    await store.mutate('清空本集', state => {
      const p = findProject(state, body.id)
      const data = episode(p, Number(body.ep) || 1)
      for (const step of EPISODE_STEPS) if (getValue(p, step, body.ep)) setValue(p, step, body.ep, step === 'shots' || step === 'clips' ? [] : step === 'review' ? null : '', '清空前')
      Object.assign(data, {})
    })
    return json(res, 200, { ok: true })
  }
  if (path === 'image/clear') {
    const old = await store.mutate('移除图片', state => {
      const slot = imageSlot(findProject(state, body.id), body)
      const previous = slot.image
      slot.image = ''
      return previous
    })
    if (old) await unlink(join(store.filesDir, old)).catch(() => {})
    return json(res, 200, { ok: true })
  }
  if (path === 'job/cancel') return json(res, 200, { ok: studio.cancel(body.key) })
  if (path === 'undo') return json(res, 200, { label: await store.undoLast() })
  return json(res, 404, { error: '没有这个接口' })
}

/**
 * Web 服务不会替插件路由鉴权，所以每个请求都要自己走一遍 Host/Origin 和登录凭证检查。
 * 拿不到鉴权服务时一律拒绝。
 */
export function requestRejection(ctx, req) {
  const connection = ctx.get('connection')
  if (typeof connection?.requestRejection !== 'function') return 403
  return connection.requestRejection({ headers: req.headers })
}

export const name = 'dsh-drama-studio'

export default {
  inject: ['webServer', 'connection'],
  apply(ctx) {
    const store = new Store()
    const studio = new Studio({ store, callText: options => callModel(ctx, options) })
    ctx.effect(() => ctx.webServer.register({
      kind: 'prefix',
      path: PREFIX,
      handler: async (req, res) => {
        try {
          const rejection = requestRejection(ctx, req)
          if (rejection) return json(res, rejection, { error: '未授权' })
          await route(ctx, store, studio, req, res)
        } catch (err) {
          if (res.headersSent) return res.end()
          json(res, err.status || 500, { error: err.message })
        }
      },
    }), 'dsh-drama-studio: /drama-studio routes')
    ctx.on('dispose', () => { for (const job of studio.jobs.values()) job.controller?.abort() })
  },
}

export { defaultSelection }
