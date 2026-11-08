import React from 'react'
import { download, downloadClipPack, exportCanvas, importCanvas, fileUrl, generate, saveStep, setState, uploadImage, useStudio, api, loadProject, safe } from './api.js'
import { imageRequest } from '../src/image-request.js'
import { clipRefs, missingShots } from '../src/clip-refs.js'
import { AiBar, Area, Btn, CopyBtn, Empty, Field, History, SaveBar, useDraft } from './ui.jsx'

const FLOW_URL = 'https://labs.google/fx/tools/flow'
const MODE = { frames: '首尾帧（上传分镜图）', ingredients: '参考图（上传定妆图）', text: '纯文字', reference: '@素材引用' }

function StepHead({ title, desc, step, ep, children }) {
  return (
    <div className="ds-stephead">
      <div><h2>{title}</h2><p className="ds-muted">{desc}</p></div>
      <div className="ds-row">{children}<History step={step} ep={ep} /></div>
    </div>
  )
}

export function PlanStep() {
  const project = useStudio(s => s.project)
  const [draft, setDraft, dirty] = useDraft(project.plan)
  const set = (k, v) => setDraft({ ...draft, [k]: v })
  const setEp = (i, k, v) => set('episodes', draft.episodes.map((e, j) => (j === i ? { ...e, [k]: v } : e)))
  return (
    <section>
      <StepHead step="plan" title="① 爆款策划" desc="AI 按爆款逻辑（强钩子·先压后爆·集集卡点）拆出卖点和分集大纲。满意再往下走，不满意就提意见或直接改字。" />
      <AiBar step="plan" has={Boolean(project.plan)} label="策划" />
      {!draft ? <Empty>点「AI 生成策划」，约 1 分钟出一份完整策划案。</Empty> : (
        <div className="ds-card">
          <div className="ds-grid2">
            <Field label="剧名"><input className="ds-input" value={draft.title} onChange={e => set('title', e.target.value)} /></Field>
            <Field label="画风（后续所有提示词沿用）"><input className="ds-input" value={draft.visualStyle} onChange={e => set('visualStyle', e.target.value)} /></Field>
          </div>
          <Field label="一句话卖点"><Area value={draft.logline} onChange={v => set('logline', v)} /></Field>
          <Field label="开场 3 秒钩子"><Area value={draft.hook} onChange={v => set('hook', v)} /></Field>
          <Field label="爆款卖点" hint="一行一条"><Area value={(draft.sellingPoints ?? []).join('\n')} onChange={v => set('sellingPoints', v.split('\n'))} /></Field>
          <div className="ds-grid2">
            <Field label="核心冲突"><Area value={draft.mainConflict} onChange={v => set('mainConflict', v)} /></Field>
            <Field label="目标观众"><Area value={draft.audience} onChange={v => set('audience', v)} /></Field>
          </div>
          <Field label="情绪曲线 / 付费卡点"><Area value={draft.emotionCurve} onChange={v => set('emotionCurve', v)} /></Field>
          <Field label="世界观"><Area value={draft.world} onChange={v => set('world', v)} /></Field>
          <h3>分集大纲</h3>
          {(draft.episodes ?? []).map((ep, i) => (
            <div className="ds-epcard" key={i}>
              <div className="ds-row"><b>第{i + 1}集</b><input className="ds-input" value={ep.title} onChange={e => setEp(i, 'title', e.target.value)} /></div>
              <Area value={ep.summary} onChange={v => setEp(i, 'summary', v)} />
              <div className="ds-grid3">
                <Field label="钩子"><Area value={ep.hook} onChange={v => setEp(i, 'hook', v)} /></Field>
                <Field label="爽点"><Area value={ep.climax} onChange={v => setEp(i, 'climax', v)} /></Field>
                <Field label="卡点"><Area value={ep.cliffhanger} onChange={v => setEp(i, 'cliffhanger', v)} /></Field>
              </div>
            </div>
          ))}
          <SaveBar dirty={dirty} onSave={() => saveStep('plan', { ...draft, sellingPoints: draft.sellingPoints.filter(Boolean) })} onReset={() => setDraft(project.plan)} />
        </div>
      )}
      {project.plan ? <NextBtn step="characters" label="下一步：人物" /> : null}
    </section>
  )
}

function ImageSlot({ image, slot, prompt, ratio = '9:16', genRatio = ratio }) {
  const input = React.useRef(null)
  const [over, setOver] = React.useState(false)
  const pick = files => files?.[0] && uploadImage(files[0], slot)
  const clear = () => safe(async () => { await api('image/clear', { id: useStudioId(), ...slot }); await loadProject() })
  return (
    <div className={`ds-slot ${over ? 'is-over' : ''}`} style={{ aspectRatio: ratio.replace(':', '/') }}
      onDragOver={e => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
      onDrop={e => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files) }}
      onPaste={e => pick(e.clipboardData.files)} tabIndex={0}>
      {image ? <img src={fileUrl(image)} alt="" /> : <div className="ds-slot-empty"><span>复制提示词去网页生图<br />再把图片拖到/粘贴到这里</span></div>}
      <div className="ds-slot-actions">
        <Btn kind="sm" onClick={() => input.current.click()}>{image ? '换图' : '上传'}</Btn>
        {prompt ? <CopyBtn text={imageRequest(prompt, genRatio)} label="复制提示词" /> : null}
        {image ? <Btn kind="sm" onClick={clear}>移除</Btn> : null}
      </div>
      <input ref={input} type="file" accept="image/*" hidden onChange={e => { pick(e.target.files); e.target.value = '' }} />
    </div>
  )
}

let currentId = null
function useStudioId() { return currentId }

export function CharactersStep() {
  const project = useStudio(s => s.project)
  currentId = project.id
  return (
    <section>
      <StepHead step="characters" title="② 人物小传 + 定妆图" desc="按「人物小传 skill」写出可视觉化的人设。复制定妆图提示词去网页生图，上传后后面的分镜和视频都按它保持人物一致。" />
      <AiBar step="characters" has={project.characters.length > 0} label="人物" />
      {!project.characters.length ? <Empty>需要先有策划。点「AI 生成人物」。</Empty> : project.characters.map(ch => <CharacterCard key={ch.id} ch={ch} />)}
      {project.characters.length ? <NextBtn step="rhythm" label="下一步：写第 1 集" /> : null}
    </section>
  )
}

function CharacterCard({ ch }) {
  const [d, setD, dirty] = useDraft(ch)
  const set = (k, v) => setD({ ...d, [k]: v })
  const setSub = (g, k, v) => setD({ ...d, [g]: { ...d[g], [k]: v } })
  const [more, setMore] = React.useState(false)
  return (
    <div className="ds-card ds-char">
      <ImageSlot image={ch.image} slot={{ kind: 'character', cid: ch.id }} prompt={ch.imagePrompt} ratio="3:4" genRatio="16:9" />
      <div className="ds-char-body">
        <div className="ds-grid3">
          <Field label="姓名"><input className="ds-input" value={d.name} onChange={e => set('name', e.target.value)} /></Field>
          <Field label="定位"><input className="ds-input" value={d.role} onChange={e => set('role', e.target.value)} /></Field>
          <Field label="年龄"><input className="ds-input" value={d.age} onChange={e => set('age', e.target.value)} /></Field>
        </div>
        <Field label="外貌不可变特征" hint="全剧固定，保证 AI 人物一致"><Area value={d.appearance} onChange={v => set('appearance', v)} /></Field>
        <Field label="核心标签"><Area value={d.tags} onChange={v => set('tags', v)} /></Field>
        <Field label="定妆图提示词" hint="复制到网页生图"><Area mono value={d.imagePrompt} onChange={v => set('imagePrompt', v)} /></Field>
        <button type="button" className="ds-link" onClick={() => setMore(!more)}>{more ? '收起小传' : '展开完整小传'}</button>
        {more ? (
          <div>
            <div className="ds-grid2">
              <Field label="声音"><Area value={d.voice} onChange={v => set('voice', v)} /></Field>
              <Field label="道具"><Area value={d.prop} onChange={v => set('prop', v)} /></Field>
            </div>
            {[['background', '核心背景', [['experience', '关键经历'], ['obsession', '核心执念'], ['motive', '行为动机']]],
              ['personality', '性格与行为逻辑', [['explicit', '显性性格'], ['contrast', '隐性反差'], ['trigger', '触发点']]],
              ['dynamic', '动态设定', [['habit', '标志动作'], ['micro', '微动态'], ['voiceDetail', '口头禅/语气']]],
              ['story', '剧情关联', [['function', '剧情功能'], ['relations', '人物关系'], ['arc', '成长弧线']]]].map(([g, title, keys]) => (
              <div key={g}><h4>{title}</h4><div className="ds-grid3">{keys.map(([k, l]) => <Field key={k} label={l}><Area value={d[g]?.[k]} onChange={v => setSub(g, k, v)} /></Field>)}</div></div>
            ))}
          </div>
        ) : null}
        <SaveBar dirty={dirty} onSave={() => saveStep('characters', d, { scope: { id: ch.id } })} onReset={() => setD(ch)} />
        <AiBar step="characters" scope={{ id: ch.id }} has quick="characters" compact />
      </div>
    </div>
  )
}

function TextStep({ step, title, desc, label, placeholder, next }) {
  const project = useStudio(s => s.project)
  const ep = useStudio(s => s.ep)
  const value = project.episodeData?.[ep]?.[step] ?? ''
  const [d, setD, dirty] = useDraft(value)
  return (
    <section>
      <StepHead step={step} ep={ep} title={title} desc={desc} />
      <AiBar step={step} ep={ep} has={Boolean(value)} label={label} />
      {value || dirty ? <div className="ds-card"><Area mono rows={16} value={d} onChange={setD} /><SaveBar dirty={dirty} onSave={() => saveStep(step, d)} onReset={() => setD(value)} /></div> : <Empty>{placeholder}</Empty>}
      {value ? next : null}
    </section>
  )
}

export function ScriptStep() {
  const ep = useStudio(s => s.ep)
  return (
    <div>
      <TextStep step="rhythm" label="节奏表" title={`③ 第${ep}集 · 节奏爽点`} desc="先定好本集每一段的节奏、爽点和动态等级（爽点节奏 skill），剧本照着写，效果才稳。" placeholder="点「AI 生成节奏表」。" />
      <TextStep step="script" label="剧本" title={`第${ep}集 · 详细剧本`} desc="按「剧本详细写作 skill」：场景头、动作、台词、动态和音效全部结构化，可直接拆分镜。" placeholder="建议先生成节奏表，再生成剧本。" next={<NextBtn step="shots" label="下一步：拆分镜" />} />
    </div>
  )
}

export function ShotsStep() {
  const project = useStudio(s => s.project)
  const ep = useStudio(s => s.ep)
  currentId = project.id
  const shots = project.episodeData?.[ep]?.shots ?? []
  const total = shots.reduce((s, x) => s + (x.seconds || 0), 0)
  const done = shots.filter(s => s.image).length
  return (
    <section>
      <StepHead step="shots" ep={ep} title={`④ 第${ep}集 · 拉片分镜表`} desc="每一镜都有分镜图提示词：复制去网页生图（Flow / 即梦 / Midjourney 都行），再拖回来。每镜都能单独让 AI 改或手动改。">
                      {shots.length ? <span className="ds-pill">{shots.length} 镜 · {total} 秒 · 分镜图 {done}/{shots.length}</span> : null}
              {shots.length ? <CanvasBtns ep={ep} /> : null}
      </StepHead>
      <AiBar step="shots" ep={ep} has={shots.length > 0} label="分镜表" />
      {!shots.length ? <Empty>需要先有本集剧本。点「AI 生成分镜表」。</Empty> : shots.map(s => <ShotCard key={`${ep}-${s.no}`} shot={s} ep={ep} ratio={project.config.ratio} />)}
      {shots.length ? <NextBtn step="clips" label="下一步：视频提示词" /> : null}
    </section>
  )
}

const SHOT_FIELDS = [['scene', '场景'], ['time', '时间/光线'], ['characters', '人物'], ['size', '景别'], ['camera', '机位/运镜'], ['dynamic', '动态'], ['transition', '转场']]

function ShotCard({ shot, ep, ratio }) {
  const [d, setD, dirty] = useDraft(shot)
  const set = (k, v) => setD({ ...d, [k]: v })
  return (
    <div className="ds-card ds-shot">
      <div className="ds-shot-side">
        <div className="ds-shot-no">{shot.no}<small>{shot.seconds}s</small></div>
        <ImageSlot image={shot.image} slot={{ kind: 'shot', ep, no: shot.no }} prompt={shot.imagePrompt} ratio={ratio} />
      </div>
      <div className="ds-shot-body">
        <div className="ds-grid4">
          {SHOT_FIELDS.map(([k, l]) => <Field key={k} label={l}><input className="ds-input" value={d[k]} onChange={e => set(k, e.target.value)} /></Field>)}
          <Field label="时长(秒)"><input className="ds-input" type="number" min="1" max="60" value={d.seconds} onChange={e => set('seconds', Number(e.target.value))} /></Field>
        </div>
        <Field label="画面内容"><Area value={d.visual} onChange={v => set('visual', v)} /></Field>
        <div className="ds-grid2">
          <Field label="人物站位/朝向" hint="多人镜头写清左右前后，避免穿帮"><Area value={d.blocking ?? ''} onChange={v => set('blocking', v)} /></Field>
          <Field label="表情/眼神表演"><Area value={d.acting ?? ''} onChange={v => set('acting', v)} /></Field>
        </div>
        <div className="ds-grid2">
          <Field label="台词/旁白"><Area value={d.dialogue} onChange={v => set('dialogue', v)} /></Field>
          <Field label="音效/音乐"><Area value={d.sound} onChange={v => set('sound', v)} /></Field>
        </div>
        <Field label="分镜图提示词"><Area mono value={d.imagePrompt} onChange={v => set('imagePrompt', v)} /></Field>
        <Field label="备注"><input className="ds-input" value={d.note} onChange={e => set('note', e.target.value)} /></Field>
        <SaveBar dirty={dirty} onSave={() => saveStep('shots', d, { scope: { no: shot.no } })} onReset={() => setD(shot)} />
        <AiBar step="shots" ep={ep} scope={{ no: shot.no }} has quick="shot" compact />
      </div>
    </div>
  )
}

export function ClipsStep() {
  const project = useStudio(s => s.project)
  const ep = useStudio(s => s.ep)
  const data = project.episodeData?.[ep] ?? {}
  const clips = data.clips ?? []
  const shots = data.shots ?? []
  const target = project.config.videoTarget
  const setTarget = v => safe(async () => { await api('project/update', { id: project.id, config: { videoTarget: v } }); await loadProject() })
  return (
    <section>
      <StepHead step="clips" ep={ep} title={`⑤ 第${ep}集 · 视频提示词`} desc={target === 'seedance' ? 'Seedance 2.0：按 @素材 引用上传的分镜图/定妆图，每段 4-15 秒。' : 'Google Flow（Veo）：每段 8 秒。有分镜图的用「首尾帧」，人物用定妆图做「参考图」，复制提示词粘贴即可。'}>
        <div className="ds-seg">{[['flow', 'Google Flow'], ['seedance', 'Seedance 2.0']].map(([k, l]) => <button type="button" key={k} className={target === k ? 'is-on' : ''} onClick={() => setTarget(k)}>{l}</button>)}</div>
        {target === 'flow' ? <a className="ds-btn" href={FLOW_URL} target="_blank" rel="noreferrer">打开 Google Flow</a> : null}
        {clips.length ? <Btn onClick={() => downloadClipPack(ep)}>下载本集全部素材</Btn> : null}
      </StepHead>
      <AiBar step="clips" ep={ep} has={clips.length > 0} label="视频提示词" />
      {!clips.length ? <Empty>需要先有分镜表。点「AI 生成视频提示词」。</Empty> : clips.map(c => <ClipCard key={`${ep}-${c.no}`} clip={c} ep={ep} shots={shots} chars={project.characters} />)}
      {clips.length ? <NextBtn step="review" label="下一步：爆款体检" /> : null}
    </section>
  )
}

function ClipCard({ clip, ep, shots, chars }) {
  const [d, setD, dirty] = useDraft(clip)
  const set = (k, v) => setD({ ...d, [k]: v })
  const refs = clipRefs(d, shots, chars)
  const missing = missingShots(d, shots)
  return (
    <div className="ds-card">
      <div className="ds-row ds-between">
        <b>第 {clip.no} 段 · 镜头 {clip.shots.join('、')} · {clip.seconds} 秒 · {MODE[clip.mode] || clip.mode}</b>
        <div className="ds-row">
          <CopyBtn text={d.prompt} label="复制提示词" />
          <Btn kind="sm" onClick={() => downloadClipPack(ep, clip.no)}>下载本段素材（提示词+参考图）</Btn>
        </div>
      </div>
      {refs.length ? (
        <div className="ds-thumbs">{refs.map(r => <figure key={r.name}><a href={fileUrl(r.file)} download={r.name} title={`下载 ${r.name}`}><img src={fileUrl(r.file)} alt="" /></a><figcaption>{r.name.replace(/\.\w+$/, '').replace('-', ' ')}</figcaption></figure>)}</div>
      ) : null}
      {missing.length ? <p className="ds-tip">镜 {missing.join('、')} 还没上传分镜图，只靠提示词画面会不准，建议先回「分镜」步骤上传。</p> : null}
      <Field label="需要上传的素材"><Area value={d.refs} onChange={v => set('refs', v)} /></Field>
      <Field label="提示词"><Area mono rows={6} value={d.prompt} onChange={v => set('prompt', v)} /></Field>
      <Field label="宫格连贯分镜图提示词（可选）" hint="先用它在网页生成一张多宫格分镜，人物/场景更统一，再逐格当首帧"><Area mono rows={3} value={d.gridPrompt ?? ''} onChange={v => set('gridPrompt', v)} /></Field>
      {d.gridPrompt ? <div className="ds-row"><CopyBtn text={imageRequest(d.gridPrompt)} label="复制宫格提示词" /></div> : null}
      {clip.tips ? <p className="ds-tip">💡 {clip.tips}</p> : null}
      <SaveBar dirty={dirty} onSave={() => saveStep('clips', d, { scope: { no: clip.no } })} onReset={() => setD(clip)} />
      <AiBar step="clips" ep={ep} scope={{ no: clip.no }} has quick="clip" compact />
    </div>
  )
}

const STEP_NAME = { rhythm: '节奏表', script: '剧本', shots: '分镜表', clips: '视频提示词' }

export function ReviewStep() {
  const project = useStudio(s => s.project)
  const ep = useStudio(s => s.ep)
  const review = project.episodeData?.[ep]?.review
  const fixAll = () => {
    const groups = {}
    for (const it of review.issues) (groups[it.step] ??= []).push(`${it.problem} → ${it.fix}`)
    for (const [step, list] of Object.entries(groups)) generate({ steps: step, ep, revise: true, comment: list.join('\n') })
  }
  return (
    <section>
      <StepHead step="review" ep={ep} title={`⑥ 第${ep}集 · 爆款体检 & 导出`} desc="用各 skill 的审核标准给本集打分，问题可以一键交给 AI 修改。改完再体检一次，分数上来了再去生成视频。">
        <Btn onClick={() => download('xlsx')}>导出 Excel 拉片表</Btn>
        <Btn onClick={() => download('md')}>导出 Markdown</Btn>
      </StepHead>
      <AiBar step="review" ep={ep} has={Boolean(review)} label="体检" />
      {!review ? <Empty>点「AI 生成体检」获取评分和修改建议。</Empty> : (
        <div className="ds-card">
          <div className="ds-score"><b>{review.score}</b><span>{review.verdict}</span></div>
          <div className="ds-dims">{review.dimensions.map(d => <div key={d.name} className="ds-dim"><div className="ds-row ds-between"><span>{d.name}</span><b>{d.score}/10</b></div><i style={{ width: `${d.score * 10}%` }} /><small>{d.comment}</small></div>)}</div>
          {review.issues.length ? <div className="ds-row ds-between"><h3>修改建议</h3><Btn kind="primary" onClick={fixAll}>全部交给 AI 修改</Btn></div> : null}
          {review.issues.map((it, i) => (
            <div key={i} className="ds-issue">
              <span className="ds-pill">{STEP_NAME[it.step]}</span>
              <div><b>{it.problem}</b><p>{it.fix}</p></div>
              <Btn kind="sm" onClick={() => generate({ steps: it.step, ep, revise: true, comment: `${it.problem} → ${it.fix}` })}>按这条改</Btn>
            </div>
          ))}
          {review.strengths.length ? <><h3>亮点</h3><ul>{review.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul></> : null}
        </div>
      )}
      <div className="ds-card">
        <h3>发布前检查清单</h3>
        <ul className="ds-checklist">{PUBLISH_CHECKS.map(t => <li key={t}><label><input type="checkbox" /> {t}</label></li>)}</ul>
      </div>
    </section>
  )
}

const PUBLISH_CHECKS = [
  '每段视频多生成 2-3 次，挑最好的片段截取拼接，再补音效和配乐',
  '前 3 秒有冲突画面，30 秒内交代清楚冲突（开头慢就剪掉铺垫）',
  '主角和配角的脸都是原创形象，不像任何真实明星/演员（拿截图问一下 AI 自查）',
  '没有乱码字幕、平台水印和 logo',
  '视频前 5 秒标注「AI 生成」或加 AI 水印，发布时勾选平台 AI 内容声明',
  '不恶搞他人动漫/影视 IP',
]

function CanvasBtns({ ep }) {
  const input = React.useRef(null)
  return (
    <>
      <Btn kind="sm" onClick={() => exportCanvas(ep)} title="导出成无限画布工程包：每镜「提示词→生图配置」已连好，角色定妆图自动连成参考图">导出到无限画布</Btn>
      <Btn kind="sm" onClick={() => input.current?.click()} title="在无限画布里生成好图后，点画布「导出」得到 zip，再从这里导回">从画布导回图片</Btn>
      <input ref={input} type="file" accept=".zip,application/zip" hidden onChange={e => { importCanvas(e.target.files?.[0], ep); e.target.value = '' }} />
    </>
  )
}

function NextBtn({ step, label }) {
  return <div className="ds-next"><Btn kind="primary" onClick={() => setState({ step })}>{label} →</Btn></div>
}
