// dsh-drama-studio 浏览器半片：侧栏入口 + main 全局面板「短剧工作台」。
import React from 'react'
import { api, generate, getState, goHome, jobFor, loadList, openProject, safe, setState, undo, useStudio } from './api.js'
import { CharactersStep, ClipsStep, PlanStep, ReviewStep, ScriptStep, ShotsStep } from './steps.jsx'
import { Area, Btn, Field } from './ui.jsx'
import css from './styles.css'

const PANEL_ID = 'drama-studio'
const STEPS = [
  { id: 'plan', label: '策划', view: PlanStep },
  { id: 'characters', label: '人物', view: CharactersStep },
  { id: 'rhythm', label: '剧本', view: ScriptStep, ep: true },
  { id: 'shots', label: '分镜', view: ShotsStep, ep: true },
  { id: 'clips', label: '视频提示词', view: ClipsStep, ep: true },
  { id: 'review', label: '体检导出', view: ReviewStep, ep: true },
]
const GENRES = ['逆袭打脸', '重生复仇', '甜宠恋爱', '战神归来', '穿越古言', '悬疑反转', '萌宝', '家庭伦理', '玄幻修仙', '末日科幻']
const STYLES = ['国漫 3D 写实风格，电影感光影', '日系二次元动漫，明亮色彩', '真人电影质感，写实摄影', '古风水墨国潮', '赛博朋克霓虹', '韩漫精致厚涂']

function NewProject() {
  const [f, setF] = React.useState({ idea: '', genre: '', episodes: 10, epSeconds: 90, style: STYLES[0], ratio: '9:16', videoTarget: 'flow', notes: '', reference: '' })
  const [busy, setBusy] = React.useState(false)
  const set = (k, v) => setF({ ...f, [k]: v })
  const start = async (auto) => {
    if (!f.idea.trim()) return
    setBusy(true)
    const res = await safe(() => api('project/create', { idea: f.idea, config: f }))
    setBusy(false)
    if (!res) return
    await openProject(res.id)
    if (auto) await generate({ steps: ['plan', 'characters'] })
  }
  return (
    <div className="ds-card ds-new">
      <h2>新建短剧</h2>
      <Field label="一句话创意" hint="越具体越好：主角是谁 + 处境 + 反转"><Area rows={3} value={f.idea} onChange={v => set('idea', v)} placeholder="例：被豪门退婚的外卖小哥，其实是隐世首富的唯一继承人，订婚宴上他当众掏出了黑卡" /></Field>
      <Field label="题材"><div className="ds-chips">{GENRES.map(g => <button type="button" key={g} className={f.genre === g ? 'is-on' : ''} onClick={() => set('genre', f.genre === g ? '' : g)}>{g}</button>)}</div></Field>
      <div className="ds-grid4">
        <Field label="集数"><input className="ds-input" type="number" min="1" max="100" value={f.episodes} onChange={e => set('episodes', Number(e.target.value))} /></Field>
        <Field label="单集时长"><select className="ds-input" value={f.epSeconds} onChange={e => set('epSeconds', Number(e.target.value))}>{[60, 90, 120, 180, 300].map(s => <option key={s} value={s}>{s} 秒</option>)}</select></Field>
        <Field label="画幅"><select className="ds-input" value={f.ratio} onChange={e => set('ratio', e.target.value)}>{['9:16', '16:9', '1:1', '3:4'].map(r => <option key={r}>{r}</option>)}</select></Field>
        <Field label="视频工具"><select className="ds-input" value={f.videoTarget} onChange={e => set('videoTarget', e.target.value)}><option value="flow">Google Flow</option><option value="seedance">Seedance 2.0</option></select></Field>
      </div>
      <Field label="画风"><div className="ds-chips">{STYLES.map(s => <button type="button" key={s} className={f.style === s ? 'is-on' : ''} onClick={() => set('style', s)}>{s}</button>)}</div><input className="ds-input" value={f.style} onChange={e => set('style', e.target.value)} /></Field>
      <Field label="补充要求（可选）"><Area value={f.notes} onChange={v => set('notes', v)} placeholder="例：女频向，男主高冷；避免血腥" /></Field>
      <details className="ds-more">
        <summary>进阶：参考一部爆款（可选，强烈推荐）</summary>
        <Field label="爆款拉片参考" hint="贴一段你在拉的爆款短剧：每个镜头的景别、运镜、这一段说什么。AI 会照搬它的节奏和镜头结构，换成你的故事"><Area rows={4} value={f.reference} onChange={v => set('reference', v)} placeholder={'例：\n镜1 特写 女主被泼红酒（0-2秒）\n镜2 中景 婆婆指着鼻子骂「你也配进我家门？」\n镜3 全景 宾客哄笑……'} /></Field>
      </details>
      <div className="ds-row">
        <Btn kind="primary" busy={busy} disabled={!f.idea.trim()} onClick={() => start(true)}>开始创作（AI 自动出策划+人物）</Btn>
        <Btn busy={busy} disabled={!f.idea.trim()} onClick={() => start(false)}>只建项目</Btn>
      </div>
    </div>
  )
}

function Home() {
  const list = useStudio(s => s.list)
  const model = useStudio(s => s.model)
  React.useEffect(() => { safe(loadList) }, [])
  const remove = (p) => { if (confirm(`删除「${p.title}」？可点撤销恢复`)) safe(async () => { await api('project/delete', { id: p.id }); await loadList() }) }
  return (
    <div className="ds-page">
      <div className="ds-hero">
        <h1>短剧工作台</h1>
        <p>一句话创意 → 爆款策划 → 人物 → 剧本 → 拉片分镜表 → Google Flow 视频提示词。每一步都能 AI 重写、提意见修改或手动改。</p>
        {list && !model ? <p className="ds-warn">还没有可用的文字模型：请先在 DeepSeek Harness 设置里配置模型。</p> : null}
      </div>
      <NewProject />
      {list?.length ? <h2>我的短剧</h2> : null}
      <div className="ds-plist">
        {(list ?? []).map(p => (
          <div className="ds-card ds-pcard" key={p.id} onClick={() => openProject(p.id)}>
            <b>{p.title}</b>
            <p className="ds-muted">{p.idea}</p>
            <div className="ds-row ds-muted"><span>{p.progress.plan ? '✓策划' : '○策划'} · 人物{p.progress.characters} · 剧本{p.progress.scripts}/{p.episodes} · 分镜{p.progress.shots} · 视频{p.progress.clips}</span><span style={{ flex: 1 }} /><button type="button" className="ds-link" onClick={e => { e.stopPropagation(); remove(p) }}>删除</button></div>
          </div>
        ))}
      </div>
    </div>
  )
}

function stepDone(project, id, ep) {
  const d = project.episodeData?.[ep] ?? {}
  return { plan: Boolean(project.plan), characters: project.characters.length > 0, rhythm: Boolean(d.script), shots: d.shots?.length > 0, clips: d.clips?.length > 0, review: Boolean(d.review) }[id]
}

function ProjectView() {
  const project = useStudio(s => s.project)
  const step = useStudio(s => s.step)
  const ep = useStudio(s => s.ep)
  const jobs = useStudio(s => s.jobs)
  if (!project) return <div className="ds-page ds-muted">加载中…</div>
  const active = STEPS.find(s => s.id === step || (s.id === 'rhythm' && step === 'script')) ?? STEPS[0]
  const View = active.view
  const episodes = project.plan?.episodes?.length || project.config.episodes
  const chainRunning = jobs.some(j => j.status === 'running' && j.steps.length > 1)
  const failed = jobs.filter(j => j.status === 'error' && Date.now() - j.finishedAt < 60000)
  return (
    <div className="ds-page">
      <div className="ds-steps">
        {STEPS.map((s, i) => (
          <button type="button" key={s.id} className={`${active.id === s.id ? 'is-on' : ''} ${stepDone(project, s.id, ep) ? 'is-done' : ''}`} onClick={() => setState({ step: s.id })}>
            <i>{stepDone(project, s.id, ep) ? '✓' : i + 1}</i>{s.label}{jobFor(jobs, s.id, ep) || (s.id === 'rhythm' && jobFor(jobs, 'script', ep)) ? <span className="ds-dot" /> : null}
          </button>
        ))}
      </div>
      {active.ep ? (
        <div className="ds-epbar">
          <span>第</span>
          <select className="ds-select" value={ep} onChange={e => setState({ ep: Number(e.target.value) })}>{Array.from({ length: episodes }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</select>
          <span>集</span>
          <span className="ds-muted">{project.plan?.episodes?.[ep - 1]?.title}</span>
          <span style={{ flex: 1 }} />
          <Btn kind="primary" busy={chainRunning} disabled={!project.plan} onClick={() => generate({ steps: ['rhythm', 'script', 'shots', 'clips'], ep })}>一键生成本集（节奏→剧本→分镜→视频提示词）</Btn>
        </div>
      ) : null}
      {chainRunning ? <div className="ds-banner">{(() => { const j = jobs.find(x => x.status === 'running' && x.steps.length > 1); return `一键生成中：${j.done.length + 1}/${j.steps.length}（${{ plan: '策划', characters: '人物', rhythm: '节奏表', script: '剧本', shots: '分镜表', clips: '视频提示词' }[j.step]}）` })()}<pre className="ds-stream">{jobs.find(x => x.status === 'running' && x.steps.length > 1).text.slice(-800)}</pre></div> : null}
      {failed.map(j => <div key={j.key} className="ds-banner is-error">生成失败：{j.error}</div>)}
      <View />
    </div>
  )
}

function Studio() {
  const view = useStudio(s => s.view)
  const project = useStudio(s => s.project)
  const canUndo = useStudio(s => s.canUndo)
  const undoLabel = useStudio(s => s.undoLabel)
  const toastMsg = useStudio(s => s.toast)
  return (
    <div className="ds-root">
      <style>{css}</style>
      <header className="ds-top" data-window-drag="">
        {view === 'project' ? <button type="button" className="ds-link" onClick={goHome}>← 我的短剧</button> : <b>短剧工作台</b>}
        {project && view === 'project' ? <b className="ds-title">{project.title}</b> : null}
        <span style={{ flex: 1 }} />
        {canUndo ? <Btn kind="sm" title={undoLabel} onClick={undo}>撤销{undoLabel ? `「${undoLabel}」` : ''}</Btn> : null}
      </header>
      <main className="ds-main">{view === 'project' ? <ProjectView /> : <Home />}</main>
      {toastMsg ? <div className={`ds-toast ${toastMsg.kind === 'error' ? 'is-error' : ''}`}>{toastMsg.message}</div> : null}
    </div>
  )
}

function PanelIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 9h18M7 5l2 4M12 5l2 4M17 5l2 4" />
    </svg>
  )
}

export const inject = ['slots']

export function apply(ctx) {
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, Studio))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 6, label: () => '短剧工作台' }, PanelIcon))
}

export { getState }
