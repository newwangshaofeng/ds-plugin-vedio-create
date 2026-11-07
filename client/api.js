// 浏览器半片的数据层：fetch 封装 + 一个很小的全局状态。
import React from 'react'

const BASE = 'drama-studio/'
let state = { view: 'home', projectId: null, step: 'plan', ep: 1, list: null, model: null, project: null, jobs: [], canUndo: false, undoLabel: null, toast: null, error: null }
const listeners = new Set()

export function getState() { return state }
export function setState(patch) {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }
  for (const fn of listeners) fn()
}
export function useStudio(select) {
  return React.useSyncExternalStore(fn => { listeners.add(fn); return () => listeners.delete(fn) }, () => select(state))
}

export async function api(path, body) {
  const res = await fetch(BASE + path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `请求失败（${res.status}）`)
  return data
}

let toastTimer
export function toast(message, kind = 'info') {
  clearTimeout(toastTimer)
  setState({ toast: { message, kind } })
  toastTimer = setTimeout(() => setState({ toast: null }), kind === 'error' ? 6000 : 2500)
}

export async function safe(fn) {
  try { return await fn() } catch (err) { toast(err.message, 'error'); return null }
}

export async function loadList() {
  const data = await api('state')
  setState({ list: data.projects, model: data.model, canUndo: data.canUndo, undoLabel: data.undoLabel })
}

let pollTimer = null
export async function loadProject(id = state.projectId) {
  if (!id) return
  const data = await api(`project?id=${encodeURIComponent(id)}`)
  if (state.projectId !== id) return
  setState({ project: data.project, jobs: data.jobs, canUndo: data.canUndo, undoLabel: data.undoLabel })
  clearTimeout(pollTimer)
  if (data.jobs.some(j => j.status === 'running')) pollTimer = setTimeout(() => loadProject(id).catch(() => {}), 1200)
}

export function openProject(id, step = 'plan') {
  setState({ view: 'project', projectId: id, project: null, step, ep: 1, jobs: [] })
  return safe(() => loadProject(id))
}

export function goHome() {
  clearTimeout(pollTimer)
  setState({ view: 'home', projectId: null, project: null })
  return safe(loadList)
}

/** 启动生成/修改任务。steps 可以是多步串行。 */
export async function generate({ steps, ep, comment, scope, revise }) {
  const list = Array.isArray(steps) ? steps : [steps]
  await safe(async () => {
    await api('step/generate', { id: state.projectId, steps: list, ep: ep ?? state.ep, comment, scope, revise })
    await loadProject()
  })
}

export async function saveStep(step, value, { ep, scope } = {}) {
  const ok = await safe(async () => {
    await api('step/save', { id: state.projectId, step, ep: ep ?? state.ep, value, scope })
    await loadProject()
    return true
  })
  if (ok) toast('已保存')
  return ok
}

export async function undo() {
  await safe(async () => {
    const { label } = await api('undo', {})
    if (label) toast(`已撤销：${label}`)
    if (state.projectId) await loadProject(); else await loadList()
  })
}

export async function uploadImage(file, slot) {
  if (!file || !file.type.startsWith('image/')) return toast('请选择图片文件', 'error')
  await safe(async () => {
    const params = new URLSearchParams({ id: state.projectId, ...Object.fromEntries(Object.entries(slot).map(([k, v]) => [k, String(v)])) })
    const res = await fetch(`${BASE}upload?${params}`, { method: 'POST', headers: { 'content-type': file.type }, body: file })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || '上传失败')
    await loadProject()
    toast('图片已上传')
  })
}

export const fileUrl = name => `${BASE}files/${name}`

export async function download(format) {
  await safe(async () => {
    const res = await fetch(`${BASE}export?id=${encodeURIComponent(state.projectId)}&format=${format}`)
    if (!res.ok) throw new Error('导出失败')
    const blob = await res.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${state.project?.title || '短剧'}.${format === 'md' ? 'md' : 'xlsx'}`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 5000)
  })
}

export async function copy(text) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    document.body.appendChild(area)
    area.select()
    document.execCommand('copy')
    area.remove()
  }
  toast('已复制，去网页粘贴即可')
}

export function jobFor(jobs, step, ep, scope) {
  return jobs.find(j => j.status === 'running' && (j.steps.includes(step)) && (['plan', 'characters'].includes(step) || j.ep === ep) && (!scope || (j.scope && (j.scope.no === scope.no && j.scope.id === scope.id))))
}
