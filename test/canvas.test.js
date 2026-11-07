import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { exportCanvas, importCanvas, imageSize } from '../src/canvas.js'
import { extractJson } from '../src/ai.js'

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000020000000308060000009a', 'hex')

function project() {
  return {
    id: 'p1', title: '测试剧', idea: 'x', config: { ratio: '9:16', style: '国漫' }, plan: { logline: 'L' },
    characters: [{ id: 'c1', name: '林墨', imagePrompt: 'Lin Mo', image: 'a.png' }],
    episodeData: { 1: { shots: [{ no: 1, size: '特写', seconds: 3, characters: '林墨', imagePrompt: 'shot1', image: '' }, { no: 2, size: '中景', seconds: 3, characters: '苏婉', imagePrompt: 'shot2', image: '' }], clips: [{ no: 1, shots: [1, 2], seconds: 6, prompt: 'flow', gridPrompt: 'grid' }] } },
  }
}

test('imageSize reads png header', () => {
  assert.deepEqual(imageSize(PNG), { width: 2, height: 3 })
})

test('exportCanvas builds an infinite-canvas v3 package and importCanvas reads generated images back', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ds-'))
  await writeFile(join(dir, 'a.png'), PNG)
  const p = project()
  const zip = unzipSync(new Uint8Array(await exportCanvas(p, 1, dir)))
  const data = JSON.parse(strFromU8(zip['projects.json']))
  assert.equal(data.app, 'infinite-canvas')
  assert.equal(data.version, 3)
  const canvas = data.projects[0].project
  const byId = Object.fromEntries(canvas.nodes.map(n => [n.id, n]))
  assert.equal(byId['ds-shot-1-1-text'].metadata.content, 'shot1')
  assert.equal(byId['ds-shot-1-1-config'].metadata.generationMode, 'image')
  assert.ok(canvas.connections.some(c => c.fromNodeId === 'ds-char-c1-image' && c.toNodeId === 'ds-shot-1-1-config'))
  assert.ok(!canvas.connections.some(c => c.fromNodeId === 'ds-char-c1-image' && c.toNodeId === 'ds-shot-1-2-config'))
  assert.ok(zip[data.projects[0].files[0].path])

  assert.equal(importCanvas(await exportCanvas(p, 1, dir), p, 1).length, 0, 'unchanged export imports nothing')

  canvas.nodes.push({ id: 'gen1', type: 'image', title: 'g', position: { x: 0, y: 0 }, width: 1, height: 1, metadata: { content: 'blob:x', storageKey: 'image:gen1', mimeType: 'image/png' } })
  canvas.connections.push({ id: 'k', fromNodeId: 'ds-shot-1-2-config', toNodeId: 'gen1' })
  data.projects[0].files.push({ storageKey: 'image:gen1', path: 'projects/x/files/gen1.png', mimeType: 'image/png', bytes: PNG.length })
  const back = Buffer.from(zipSync({ 'projects.json': strToU8(JSON.stringify(data)), 'projects/x/files/gen1.png': new Uint8Array(PNG) }))
  const items = importCanvas(back, p, 1)
  assert.equal(items.length, 1)
  assert.deepEqual(items[0].slot, { kind: 'shot', ep: 1, no: 2 })
  assert.equal(items[0].ext, '.png')
})

test('extractJson salvages a truncated shot list', () => {
  const text = '{"shots":[{"no":1,"visual":"a \\"q\\" }"},{"no":2,"visual":"b"},{"no":3,"vis'
  assert.deepEqual(extractJson(text).shots.map(s => s.no), [1, 2])
})
