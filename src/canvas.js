// 与「无限画布」(github.com/basketikun/infinite-canvas) 互通：导出画布工程包（projects.json v3 + 图片），以及把画布里生成的图片导回分镜/定妆。
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { strToU8, unzipSync, zipSync, strFromU8 } from 'fflate'

const COL = 420
const ROW = 300
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }
const EXT = Object.fromEntries(Object.entries(MIME).map(([ext, type]) => [type, ext]))

export function imageSize(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
  if (buf.toString('ascii', 0, 3) === 'GIF') return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) }
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const kind = buf.toString('ascii', 12, 16)
    if (kind === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) }
    if (kind === 'VP8L') { const b = buf.readUInt32LE(21); return { width: 1 + (b & 0x3fff), height: 1 + ((b >> 14) & 0x3fff) } }
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff }
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    for (let i = 2; i + 9 < buf.length;) {
      if (buf[i] !== 0xff) { i++; continue }
      const marker = buf[i + 1]
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) }
      i += 2 + buf.readUInt16BE(i + 2)
    }
  }
  return null
}

function ratioSize(ratio) {
  const [w, h] = String(ratio || '9:16').split(':').map(Number)
  return w && h ? { width: w * 100, height: h * 100 } : { width: 900, height: 1600 }
}

function fit({ width, height }, max = 340) {
  const scale = Math.min(1, max / width, max / height)
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

const node = (id, type, title, x, y, metadata, size = { width: 340, height: 240 }) => ({ id, type, title, position: { x, y }, ...size, metadata })

/** 节点 id 约定：导回时靠它（以及从配置节点连出去的图片节点）找到对应的分镜/角色。 */
export const ids = {
  char: (cid, part) => `ds-char-${cid}-${part}`,
  shot: (ep, no, part) => `ds-shot-${ep}-${no}-${part}`,
}

export async function exportCanvas(project, ep, filesDir) {
  const nodes = []
  const connections = []
  const files = []
  const zip = {}
  const ratio = project.config?.ratio || '9:16'
  const link = (from, to) => connections.push({ id: `${from}->${to}`, fromNodeId: from, toNodeId: to })
  const config = (id, x, y, title) => node(id, 'config', title, x, y, { generationMode: 'image', prompt: '', size: ratio, count: 1 })
  const addImage = async (id, file, title, x, y) => {
    if (!file) return false
    const buf = await readFile(join(filesDir, file)).catch(() => null)
    if (!buf) return false
    const mimeType = MIME[extname(file).toLowerCase()] || 'image/png'
    const natural = imageSize(buf) ?? ratioSize(ratio)
    const storageKey = `image:${id}`
    const path = `projects/${project.id}/files/${id}${extname(file).toLowerCase() || '.png'}`
    zip[path] = new Uint8Array(buf)
    files.push({ storageKey, path, mimeType, bytes: buf.length })
    nodes.push(node(id, 'image', title, x, y, { content: '', storageKey, naturalWidth: natural.width, naturalHeight: natural.height, bytes: buf.length, mimeType }, fit(natural)))
    return true
  }

  const plan = project.plan ?? {}
  nodes.push(node('ds-plan', 'text', `《${project.title}》策划`, 0, 0, { content: [`一句话卖点：${plan.logline || project.idea}`, plan.hook && `开场钩子：${plan.hook}`, `画风：${project.config?.style}　画幅：${ratio}`].filter(Boolean).join('\n') }))

  const charImage = {}
  for (const [i, ch] of (project.characters ?? []).entries()) {
    const x = (i + 1) * COL
    nodes.push(node(ids.char(ch.id, 'text'), 'text', `角色·${ch.name} 定妆图提示词`, x, 0, { content: ch.imagePrompt || ch.appearance || ch.name }))
    nodes.push(config(ids.char(ch.id, 'config'), x, ROW, `角色·${ch.name} 生图`))
    link(ids.char(ch.id, 'text'), ids.char(ch.id, 'config'))
    if (await addImage(ids.char(ch.id, 'image'), ch.image, `角色·${ch.name}`, x, ROW * 2)) {
      link(ids.char(ch.id, 'config'), ids.char(ch.id, 'image'))
      charImage[ch.name] = ids.char(ch.id, 'image')
    }
  }

  const data = project.episodeData?.[ep] ?? {}
  const y0 = ROW * 4
  for (const [i, s] of (data.shots ?? []).entries()) {
    const x = i * COL
    const tag = `第${ep}集·镜${String(s.no).padStart(2, '0')}`
    nodes.push(node(ids.shot(ep, s.no, 'text'), 'text', `${tag} ${s.size} ${s.seconds}秒`, x, y0, { content: s.imagePrompt || s.visual }))
    nodes.push(config(ids.shot(ep, s.no, 'config'), x, y0 + ROW, `${tag} 生图`))
    link(ids.shot(ep, s.no, 'text'), ids.shot(ep, s.no, 'config'))
    for (const [name, imageId] of Object.entries(charImage)) if (s.characters?.includes(name)) link(imageId, ids.shot(ep, s.no, 'config'))
    if (await addImage(ids.shot(ep, s.no, 'image'), s.image, tag, x, y0 + ROW * 2)) link(ids.shot(ep, s.no, 'config'), ids.shot(ep, s.no, 'image'))
  }

  const y1 = y0 + ROW * 4
  for (const [i, c] of (data.clips ?? []).entries()) {
    const x = i * COL * 2
    nodes.push(node(`ds-clip-${ep}-${c.no}`, 'text', `第${ep}集·视频第${c.no}段（镜${c.shots.join(',')}，${c.seconds}秒）复制到 Google Flow`, x, y1, { content: c.prompt }, { width: 340, height: 320 }))
    if (c.gridPrompt) {
      nodes.push(node(`ds-grid-${ep}-${c.no}-text`, 'text', `第${ep}集·第${c.no}段 宫格分镜提示词`, x + COL, y1, { content: c.gridPrompt }))
      nodes.push(config(`ds-grid-${ep}-${c.no}-config`, x + COL, y1 + ROW, `第${c.no}段 宫格分镜生图`))
      link(`ds-grid-${ep}-${c.no}-text`, `ds-grid-${ep}-${c.no}-config`)
    }
  }

  const now = new Date().toISOString()
  const canvasProject = { id: `ds-${project.id}-${ep}`, title: `${project.title} · 第${ep}集`, createdAt: now, updatedAt: now, nodes, connections, chatSessions: [], activeChatId: null, backgroundMode: 'dots', viewport: { x: 80, y: 80, k: 0.5 } }
  zip['projects.json'] = strToU8(JSON.stringify({ app: 'infinite-canvas', version: 3, exportedAt: now, projects: [{ project: canvasProject, files }] }, null, 2))
  return Buffer.from(zipSync(zip, { level: 0 }))
}

/** 解析画布导出包，返回要写回的图片：优先取从「生图配置节点」连出去的最新图片，其次是被替换过的原图片节点。 */
export function importCanvas(buffer, project, ep) {
  const entries = unzipSync(new Uint8Array(buffer))
  if (!entries['projects.json']) throw new Error('不是无限画布导出的工程包（缺少 projects.json）')
  const data = JSON.parse(strFromU8(entries['projects.json']))
  const items = []
  for (const { project: canvas, files = [] } of data.projects ?? []) {
    const byKey = new Map(files.map(f => [f.storageKey, f]))
    const byId = new Map((canvas.nodes ?? []).map(n => [n.id, n]))
    const keyOf = n => n?.type === 'image' ? (n.metadata?.images?.find(im => im.id === n.metadata?.primaryImageId)?.storageKey || n.metadata?.storageKey) : null
    const pick = (configId, imageId) => {
      const generated = (canvas.connections ?? []).filter(c => c.fromNodeId === configId && c.toNodeId !== imageId).map(c => byId.get(c.toNodeId)).filter(n => keyOf(n))
      const candidate = generated.at(-1) ?? byId.get(imageId)
      const key = keyOf(candidate)
      if (!key || key === `image:${imageId}` && candidate?.id === imageId) return null
      const file = byKey.get(key)
      const bytes = file && entries[file.path]
      return bytes ? { bytes: Buffer.from(bytes), ext: EXT[file.mimeType] || extname(file.path) || '.png' } : null
    }
    for (const ch of project.characters ?? []) {
      const got = pick(ids.char(ch.id, 'config'), ids.char(ch.id, 'image'))
      if (got) items.push({ slot: { kind: 'character', id: ch.id }, label: `角色·${ch.name}`, ...got })
    }
    for (const s of project.episodeData?.[ep]?.shots ?? []) {
      const got = pick(ids.shot(ep, s.no, 'config'), ids.shot(ep, s.no, 'image'))
      if (got) items.push({ slot: { kind: 'shot', ep, no: s.no }, label: `镜${s.no}`, ...got })
    }
  }
  return items
}
