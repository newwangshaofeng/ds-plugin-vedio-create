// 导出：Excel（拉片分镜表 + 视频提示词，嵌入已上传的分镜图）与 Markdown。
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import ExcelJS from 'exceljs'

export const SHOT_COLUMNS = [
  ['no', '镜号', 6], ['image', '分镜图', 18], ['scene', '场景', 14], ['time', '时间/光线', 10], ['characters', '人物', 12], ['size', '景别', 8],
  ['camera', '机位/运镜', 18],
  ['blocking', '站位/朝向', 18], ['visual', '画面内容', 36],
  ['acting', '表演', 20], ['dialogue', '台词/旁白', 28], ['sound', '音效/音乐', 20], ['seconds', '时长(秒)', 8],
  ['dynamic', '动态', 10], ['transition', '转场', 8], ['note', '备注', 16], ['imagePrompt', '分镜图提示词', 50],
]
const CLIP_COLUMNS = [['no', '段落', 6], ['shots', '包含镜头', 10], ['seconds', '时长(秒)', 8], ['mode', '生成方式', 12], ['refs', '需要上传的素材', 28], ['prompt', '视频提示词（直接复制）', 80], ['gridPrompt', '宫格分镜图提示词', 50], ['tips', '操作提示', 30]]
export const MODE_LABEL = { frames: '首尾帧', ingredients: '参考图', text: '纯文字', reference: '@素材引用' }

function styleSheet(sheet, widths) {
  sheet.columns = widths.map(([key, header, width]) => ({ key, header, width }))
  const head = sheet.getRow(1)
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7C3AED' } }
  head.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
  head.height = 22
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
}

const wrap = row => row.eachCell(cell => { cell.alignment = { vertical: 'top', wrapText: true } })

function kvSheet(book, name, rows) {
  const sheet = book.addWorksheet(name)
  styleSheet(sheet, [['k', '项目', 18], ['v', '内容', 100]])
  for (const [k, v] of rows) if (v) wrap(sheet.addRow({ k, v }))
  return sheet
}

export async function exportXlsx(project, filesDir) {
  const book = new ExcelJS.Workbook()
  book.creator = 'dsh-drama-studio'
  const plan = project.plan ?? {}
  kvSheet(book, '爆款策划', [
    ['剧名', project.title], ['一句话创意', project.idea], ['一句话卖点', plan.logline], ['开场钩子', plan.hook], ['爆款卖点', (plan.sellingPoints ?? []).join('\n')],
    ['目标观众', plan.audience], ['世界观', plan.world], ['核心冲突', plan.mainConflict], ['情绪曲线/卡点', plan.emotionCurve], ['画风', plan.visualStyle],
    ...(plan.episodes ?? []).map(ep => [`第${ep.no}集 ${ep.title}`, `${ep.summary}\n钩子：${ep.hook}\n爽点：${ep.climax}\n卡点：${ep.cliffhanger}`]),
  ])
  const chars = book.addWorksheet('人物小传')
  styleSheet(chars, [['name', '姓名', 10], ['role', '定位', 10], ['age', '年龄', 6], ['appearance', '外貌不可变特征', 30], ['tags', '标签', 20], ['voice', '声音', 20], ['bio', '小传', 60], ['imagePrompt', '定妆图提示词', 60]])
  for (const ch of project.characters ?? []) {
    wrap(chars.addRow({ ...ch, bio: [ch.background?.experience, ch.background?.obsession, ch.personality?.explicit, ch.personality?.contrast, ch.dynamic?.habit, ch.story?.arc].filter(Boolean).join('\n') }))
  }
  const eps = Object.keys(project.episodeData ?? {}).map(Number).sort((a, b) => a - b)
  for (const no of eps) {
    const data = project.episodeData[no]
    if (data.shots?.length) {
      const sheet = book.addWorksheet(`第${no}集-拉片分镜表`)
      styleSheet(sheet, SHOT_COLUMNS)
      for (const shot of data.shots) {
        const row = sheet.addRow({ ...shot, image: '' })
        wrap(row)
        const ext = extname(shot.image || '').toLowerCase().replace('.', '').replace('jpg', 'jpeg')
        if (shot.image && ['png', 'jpeg', 'gif'].includes(ext)) {
          try {
            const id = book.addImage({ buffer: await readFile(join(filesDir, shot.image)), extension: ext })
            row.height = 90
            sheet.addImage(id, { tl: { col: 1, row: row.number - 1 }, ext: { width: 120, height: 116 } })
          } catch {}
        }
      }
      const total = data.shots.reduce((sum, s) => sum + (s.seconds || 0), 0)
      sheet.addRow({ visual: `合计 ${data.shots.length} 镜 / ${total} 秒` }).font = { bold: true }
    }
    if (data.clips?.length) {
      const sheet = book.addWorksheet(`第${no}集-视频提示词`)
      styleSheet(sheet, CLIP_COLUMNS)
      for (const clip of data.clips) wrap(sheet.addRow({ ...clip, shots: clip.shots.join(','), mode: MODE_LABEL[clip.mode] || clip.mode }))
    }
    if (data.script) kvSheet(book, `第${no}集-剧本`, [['节奏爽点', data.rhythm], ['剧本', data.script]])
  }
  return Buffer.from(await book.xlsx.writeBuffer())
}

const cell = v => String(v ?? '').replace(/\|/g, '｜').replace(/\n/g, '<br>')

export function exportMarkdown(project) {
  const plan = project.plan ?? {}
  const out = [`# ${project.title}`, '', `> ${plan.logline || project.idea || ''}`, '']
  if (project.plan) {
    out.push('## 爆款策划', '', `- 开场钩子：${plan.hook}`, `- 卖点：${(plan.sellingPoints ?? []).join('；')}`, `- 核心冲突：${plan.mainConflict}`, `- 情绪曲线：${plan.emotionCurve}`, `- 画风：${plan.visualStyle}`, '')
    for (const ep of plan.episodes ?? []) out.push(`- **第${ep.no}集 ${ep.title}**：${ep.summary}（爽点：${ep.climax}；卡点：${ep.cliffhanger}）`)
    out.push('')
  }
  if (project.characters?.length) {
    out.push('## 人物', '')
    for (const ch of project.characters) out.push(`### ${ch.name}（${ch.role}，${ch.age}）`, '', `- 外貌：${ch.appearance}`, `- 标签：${ch.tags}`, `- 声音：${ch.voice}`, `- 动作习惯：${ch.dynamic?.habit}`, `- 定妆图提示词：\`${ch.imagePrompt}\``, '')
  }
  for (const no of Object.keys(project.episodeData ?? {}).map(Number).sort((a, b) => a - b)) {
    const data = project.episodeData[no]
    out.push(`## 第${no}集`, '')
    if (data.rhythm) out.push('### 节奏爽点', '', data.rhythm, '')
    if (data.script) out.push('### 剧本', '', data.script.replace(/^# .*\n/, ''), '')
    if (data.shots?.length) {
      const cols = SHOT_COLUMNS.filter(([k]) => k !== 'image')
      out.push('### 拉片分镜表', '', `| ${cols.map(c => c[1]).join(' | ')} |`, `| ${cols.map(() => '---').join(' | ')} |`)
      for (const s of data.shots) out.push(`| ${cols.map(([k]) => cell(s[k])).join(' | ')} |`)
      out.push('')
    }
    if (data.clips?.length) {
      out.push('### 视频提示词', '')
      for (const c of data.clips) out.push(`#### 第${c.no}段（镜头 ${c.shots.join(',')}，${c.seconds}秒，${MODE_LABEL[c.mode] || c.mode}）`, '', `素材：${c.refs}`, '', '```', c.prompt, '```', '')
    }
  }
  return out.join('\n')
}
