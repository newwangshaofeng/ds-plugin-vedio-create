import React from 'react'
import { copy, generate, jobFor, useStudio } from './api.js'

export function Btn({ kind = '', busy, children, ...rest }) {
  return <button type="button" className={`ds-btn ${kind}`} disabled={busy || rest.disabled} {...rest}>{busy ? '…' : children}</button>
}

export function CopyBtn({ text, label = '复制' }) {
  return <Btn kind="sm" disabled={!text} onClick={() => copy(text)}>{label}</Btn>
}

/** 自动撑高的文本框；失焦或点保存时由父组件决定写回。 */
export function Area({ value, onChange, rows = 2, placeholder, mono }) {
  const ref = React.useRef(null)
  React.useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight + 2, 900)}px`
  }, [value])
  return <textarea ref={ref} className={`ds-area ${mono ? 'is-mono' : ''}`} rows={rows} value={value ?? ''} placeholder={placeholder} onChange={e => onChange(e.target.value)} />
}

export function Field({ label, hint, children }) {
  return <label className="ds-field"><span className="ds-label">{label}{hint ? <em>{hint}</em> : null}</span>{children}</label>
}

export function useDraft(source) {
  const [draft, setDraft] = React.useState(source)
  const key = JSON.stringify(source ?? null)
  React.useEffect(() => { setDraft(source) }, [key])
  const dirty = JSON.stringify(draft ?? null) !== key
  return [draft, setDraft, dirty]
}

const QUICK = {
  plan: ['钩子更狠，前3秒就有冲突', '反转更出人意料', '加强付费卡点', '更适合女频/甜宠', '更适合男频/逆袭'],
  characters: ['反派更可恨', '主角反差更大', '外貌特征更好记', '定妆图提示词更具体'],
  rhythm: ['爽点再提前', '压抑再狠一点', '结尾卡点更勾人', '节奏再快'],
  script: ['补全剧情因果，前后台词接得上', '台词更短更狠', '增加金句', '打脸更爽', '减少旁白，用动作表现', '情绪拐点更密'],
  shots: ['按剧本补齐反应和衔接镜头', '景别变化更丰富', '爽点处加特写和强动态', '镜头再碎一点节奏更快', '分镜图提示词更具体', '人物外貌保持一致'],
  shot: ['更有冲击力', '换个机位/景别', '只重写分镜图提示词', '表情动作更具体', '加强光影氛围'],
  clips: ['段落之间剧情更连贯', '动作描述更具体', '加强对白情绪', '镜头运动更电影感', '人物一致性更强'],
  clip: ['更有电影感', '动作更连贯', '缩短为一个镜头', '加强音效'],
}

/** 每一步共用的「AI 生成 / 提意见修改」条。 */
export function AiBar({ step, ep, scope, has, quick, label, compact }) {
  const jobs = useStudio(s => s.jobs)
  const running = jobFor(jobs, step, ep, scope)
  const [open, setOpen] = React.useState(false)
  const [comment, setComment] = React.useState('')
  const send = async (revise, text = comment) => {
    await generate({ steps: step, ep, scope, revise, comment: text })
    setComment('')
    setOpen(false)
  }
  const chips = QUICK[quick || step] ?? []
  return (
    <div className={`ds-aibar ${compact ? 'is-compact' : ''}`}>
      <div className="ds-row">
        {!scope ? <Btn kind="primary" busy={Boolean(running)} onClick={() => send(false, '')}>{has ? `AI 重新生成${label || ''}` : `AI 生成${label || ''}`}</Btn> : null}
        {has ? <Btn kind={scope ? 'sm' : ''} busy={Boolean(running)} onClick={() => setOpen(!open)}>{scope ? 'AI 改这条' : '提意见让 AI 改'}</Btn> : null}
        {running ? <span className="ds-running">AI 正在写… <CancelJob job={running} /></span> : null}
      </div>
      {open ? (
        <div className="ds-revise">
          <div className="ds-chips">{chips.map(c => <button type="button" key={c} onClick={() => send(true, c)}>{c}</button>)}</div>
          <Area value={comment} onChange={setComment} placeholder="写下你的修改意见，例如：女主的反击再狠一点，台词要有记忆点。留空则让 AI 自己找问题优化一版" />
          <div className="ds-row"><Btn kind="primary" onClick={() => send(true)}>按意见修改</Btn><Btn onClick={() => setOpen(false)}>取消</Btn></div>
        </div>
      ) : null}
      {running && !scope ? <pre className="ds-stream">{running.text.slice(-1500) || '正在构思…'}</pre> : null}
    </div>
  )
}

function CancelJob({ job }) {
  return <button type="button" className="ds-link" onClick={() => import('./api.js').then(m => m.api('job/cancel', { key: job.key }).then(() => m.loadProject()))}>取消</button>
}

export function SaveBar({ dirty, onSave, onReset }) {
  if (!dirty) return null
  return <div className="ds-savebar"><span>有未保存的修改</span><Btn kind="primary" onClick={onSave}>保存</Btn><Btn onClick={onReset}>放弃</Btn></div>
}

export function History({ step, ep }) {
  const project = useStudio(s => s.project)
  const key = ['plan', 'characters'].includes(step) ? step : `${step}:${ep}`
  const list = project?.history?.[key] ?? []
  if (!list.length) return null
  return (
    <select className="ds-select" value="" onChange={e => import('./api.js').then(m => m.safe(async () => { await m.api('step/restore', { id: project.id, step, ep, index: Number(e.target.value) }); await m.loadProject(); m.toast('已恢复，可点撤销返回') }))}>
      <option value="">历史版本（{list.length}）</option>
      {list.map((h, i) => <option key={i} value={i}>{new Date(h.at).toLocaleString()} · {h.label}</option>)}
    </select>
  )
}

export function Empty({ children }) {
  return <div className="ds-empty">{children}</div>
}
