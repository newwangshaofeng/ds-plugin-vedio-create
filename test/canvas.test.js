import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { exportCanvas, importCanvas, imageSize } from '../src/canvas.js'
import { extractJson, splitMergedItems } from '../src/ai.js'

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
  for (const n of canvas.nodes.filter(n => n.type === 'image')) assert.ok(n.metadata.content, 'infinite-canvas only hydrates image nodes with non-empty content')
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

test('extractJson tolerates unescaped quotes and newlines inside Chinese dialogue', () => {
  const text = '{"shots":[{"no":1,"dialogue":"他冷笑："你也配？"","note":"第一行\n第二行"},{"no":2,"dialogue":"她说"走"'
  const shots = extractJson(text).shots
  assert.equal(shots[0].dialogue, '他冷笑："你也配？"')
  assert.equal(shots[0].note, '第一行\n第二行')
})

test('splitMergedItems restores shots the model glued together without },{', () => {
  const text = '{"shots":[{"no":1,"visual":"a","seconds":2,"no":2,"visual":"b"}]}'
  assert.equal(extractJson(text).shots.length, 1)
  assert.deepEqual(extractJson(splitMergedItems(text)).shots.map(s => s.visual), ['a', 'b'])
})

test('imageRequest wraps a copied prompt with an explicit generate-image instruction', async () => {
  const { imageRequest } = await import('../src/image-request.js')
  const text = imageRequest('  A 3D character sheet of a burly man. ', '16:9')
  assert.match(text, /^请直接生成一张图片，画幅 16:9/)
  assert.match(text, /Generate an image \(aspect ratio 16:9\): A 3D character sheet of a burly man\.$/)
  assert.equal(imageRequest(''), '')
})

test('clipPack bundles the segment prompt with numbered reference images', async () => {
  const { mkdtemp, writeFile: write } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join: pjoin } = await import('node:path')
  const { unzipSync: unzip, strFromU8: str } = await import('fflate')
  const { clipPack } = await import('../src/clip-pack.js')
  const dir = await mkdtemp(pjoin(tmpdir(), 'clip-pack-'))
  for (const f of ['s1.png', 's2.jpg', 'c1.png', 'c2.png']) await write(pjoin(dir, f), Buffer.from(f))
  const project = {
    characters: [{ id: 'a', name: '林渊', image: 'c1.png' }, { id: 'b', name: '王梦瑶', image: 'c2.png' }, { id: 'c', name: '赵四海' }],
    episodeData: { 1: {
      shots: [{ no: 1, visual: '林渊推门', image: 's1.png' }, { no: 2, visual: '特写', image: 's2.jpg' }, { no: 3, visual: '王梦瑶冷笑' }],
      clips: [{ no: 1, shots: [1, 2], mode: 'frames', refs: '首帧=镜1；参考=林渊定妆图', prompt: 'Vertical 9:16 ...' }, { no: 2, shots: [3], mode: 'ingredients', refs: '', prompt: 'P2' }]
    } }
  }
  const one = unzip(new Uint8Array(await clipPack(project, 1, 1, dir)))
  assert.deepEqual(Object.keys(one).sort(), ['图1-镜1分镜图.png', '图2-镜2分镜图.jpg', '图3-林渊定妆图.png', '提示词.txt', '说明.txt'].sort())
  assert.equal(str(one['提示词.txt']), 'Vertical 9:16 ...')
  assert.equal(str(one['图2-镜2分镜图.jpg']), 's2.jpg')
  const all = unzip(new Uint8Array(await clipPack(project, 1, null, dir)))
  assert.ok(all['第2段/图1-王梦瑶定妆图.png'])
  assert.match(str(all['第2段/说明.txt']), /镜 3 还没上传分镜图/)
  await assert.rejects(clipPack(project, 1, 9, dir), /还没有视频提示词/)
})
