import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { answer } from '../scripts/mock-llm.mjs'
import { exportMarkdown, exportXlsx } from '../src/export.js'
import { route } from '../src/host.js'
import { buildPrompts, createProject, normalizeShots, setValue, Studio } from '../src/studio.js'
import { Store } from '../src/store.js'

async function setup() {
  const store = new Store(await mkdtemp(join(tmpdir(), 'drama-')))
  const calls = []
  const studio = new Studio({ store, callText: async ({ system, user, onText }) => { calls.push({ system, user }); const text = answer(system, user); onText?.(text); return { text } } })
  const ctx = { get: () => null }
  const call = async (method, path, body, headers = {}) => {
    const raw = body === undefined ? Buffer.alloc(0) : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body))
    const req = { method, url: `/drama-studio/${path}`, headers, async *[Symbol.asyncIterator]() { if (raw.length) yield raw } }
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v }, end(b) { this.body = b }, headersSent: false }
    await route(ctx, store, studio, req, res)
    const text = Buffer.isBuffer(res.body) ? res.body : String(res.body ?? '')
    return { status: res.statusCode, res, json: () => JSON.parse(text) }
  }
  const settle = () => Promise.all([...studio.jobs.values()].map(j => j.promise))
  return { store, studio, call, settle, calls }
}

test('full pipeline: create → plan+characters → episode chain → review → export', async () => {
  const { call, settle, calls, store } = await setup()
  const { id } = (await call('POST', 'project/create', { idea: '外卖小哥被退婚', config: { episodes: 3, epSeconds: 60 } })).json()
  assert.equal((await call('POST', 'step/generate', { id, steps: ['plan', 'characters'] })).status, 200)
  await settle()
  let project = (await call('GET', `project?id=${id}`)).json().project
  assert.equal(project.title, '退婚宴上的黑卡')
  assert.equal(project.plan.episodes.length, 3)
  assert.equal(project.characters.length, 2)
  assert.match(calls[0].system, /<rhythm_skill>/)
  assert.match(calls[1].system, /人物小传/)

  await call('POST', 'step/generate', { id, steps: ['rhythm', 'script', 'shots', 'clips'], ep: 1 })
  await settle()
  project = (await call('GET', `project?id=${id}`)).json().project
  const ep = project.episodeData[1]
  assert.match(ep.rhythm, /节奏表/)
  assert.match(ep.script, /^# 第1集/)
  assert.equal(ep.shots.length, 5)
  assert.deepEqual(ep.shots.map(s => s.no), [1, 2, 3, 4, 5])
  assert.equal(ep.clips.length, 2)
  assert.match(calls.at(-2).system, /60 秒/)
  assert.match(calls.at(-1).system, /Google Flow/)

  await call('POST', 'step/generate', { id, step: 'review', ep: 1 })
  await settle()
  project = (await call('GET', `project?id=${id}`)).json().project
  assert.equal(project.episodeData[1].review.score, 72)

  const md = await call('GET', `export?id=${id}&format=md`)
  assert.match(String(md.res.body), /拉片分镜表/)
  const xlsx = await call('GET', `export?id=${id}&format=xlsx`)
  assert.equal(xlsx.res.body.subarray(0, 2).toString(), 'PK')
  assert.ok(store.filesDir)
})

test('scoped AI revision, manual edit, upload, history restore and undo', async () => {
  const { call, settle, calls } = await setup()
  const { id } = (await call('POST', 'project/create', { idea: 'x', config: { episodes: 3 } })).json()
  await call('POST', 'step/generate', { id, steps: ['plan', 'characters', 'rhythm', 'script', 'shots'], ep: 1 })
  await settle()

  const up = await call('POST', `upload?id=${id}&kind=shot&ep=1&no=2`, Buffer.from('89504e47', 'hex'), { 'content-type': 'image/png' })
  assert.equal(up.status, 200)
  await call('POST', 'step/generate', { id, step: 'shots', ep: 1, scope: { no: 2 }, revise: true, comment: '更有冲击力' })
  await settle()
  assert.match(calls.at(-1).system, /只修改第 2 镜/)
  assert.match(calls.at(-1).user, /更有冲击力/)
  assert.doesNotMatch(calls.at(-1).user, /img_/)
  let shots = (await call('GET', `project?id=${id}`)).json().project.episodeData[1].shots
  assert.match(shots[1].visual, /AI 修改/)
  assert.equal(shots[1].image, up.json().image, 'uploaded image survives AI revision')
  assert.equal(shots.length, 5)
  assert.doesNotMatch(shots[0].visual, /AI 修改/)

  await call('POST', 'step/save', { id, step: 'shots', ep: 1, scope: { no: 3 }, value: { ...shots[2], imagePrompt: '手动改的提示词', seconds: 99 } })
  shots = (await call('GET', `project?id=${id}`)).json().project.episodeData[1].shots
  assert.equal(shots[2].imagePrompt, '手动改的提示词')
  assert.equal(shots[2].seconds, 60)

  const history = (await call('GET', `project?id=${id}`)).json().project.history['shots:1']
  assert.equal(history.length, 2)
  await call('POST', 'step/restore', { id, step: 'shots', ep: 1, index: 1 })
  shots = (await call('GET', `project?id=${id}`)).json().project.episodeData[1].shots
  assert.doesNotMatch(shots[1].visual, /AI 修改/)
  assert.equal((await call('POST', 'undo', {})).json().label, '恢复历史版本')

  const role = (await call('GET', `project?id=${id}`)).json().project.characters[1]
  await call('POST', 'step/generate', { id, step: 'characters', scope: { id: role.id }, revise: true, comment: '反派更可恨' })
  await settle()
  const chars = (await call('GET', `project?id=${id}`)).json().project.characters
  assert.equal(chars[1].id, role.id)
  assert.match(chars[1].tags, /AI 修改/)
  assert.equal(chars[0].tags, '隐忍·反差·隐世继承人')
})

test('missing prerequisites and bad model output surface readable errors', async () => {
  const { call, settle, studio } = await setup()
  const { id } = (await call('POST', 'project/create', { idea: 'x' })).json()
  await call('POST', 'step/generate', { id, step: 'shots', ep: 1 })
  await settle()
  assert.equal(studio.listJobs(id)[0].error, '先生成爆款策划')
  studio.callText = async () => ({ text: '不是 JSON' })
  await call('POST', 'step/generate', { id, step: 'plan' })
  await settle()
  assert.match(studio.listJobs(id).find(j => j.step === 'plan').error, /格式不对/)
  assert.equal((await call('POST', `upload?id=${id}&kind=shot&ep=1&no=1`, Buffer.from('x'), { 'content-type': 'text/plain' })).status, 415)
})

test('revision prompt keeps base rules and output format', () => {
  const p = createProject({ idea: 'x' })
  setValue(p, 'plan', 1, { title: 't', episodes: [{ no: 1 }] })
  const prompts = buildPrompts(p, 'plan', 1, { revise: true, comment: '钩子更狠' })
  assert.match(prompts.system, /修改模式/)
  assert.match(prompts.system, /只输出一个 JSON 对象/)
  assert.match(prompts.user, /<current>/)
  assert.equal(prompts.json, true)
  assert.deepEqual(normalizeShots({ shots: [{ visual: 'a', seconds: 'x' }, {}] }).map(s => [s.no, s.seconds]), [[1, 3]])
  assert.match(exportMarkdown(p), /# t/)
  assert.ok(exportXlsx)
})
