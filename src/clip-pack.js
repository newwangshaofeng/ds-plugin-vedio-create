import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { clipRefs, missingShots } from './clip-refs.js'

const HOW = {
  frames: '首尾帧：在 Flow 选 Frames to Video，第一张分镜图当首帧（有多张时最后一张当尾帧），再粘贴提示词。',
  ingredients: '参考图：在 Flow 选 Ingredients to Video，按编号顺序上传参考图（定妆图保证人物一致），再粘贴提示词。',
  text: '纯文字：在 Flow 选 Text to Video；如有参考图，建议改用 Ingredients to Video 一起上传，画面更准。',
  reference: '@素材引用：在即梦 Seedance 按编号顺序上传，图1 对应 @图片1、图2 对应 @图片2，依此类推。'
}

async function addClip(zip, dir, clip, shots, chars, filesDir) {
  const refs = clipRefs(clip, shots, chars)
  for (const r of refs) {
    const buf = await readFile(join(filesDir, r.file)).catch(() => null)
    if (buf) zip[`${dir}${r.name}`] = new Uint8Array(buf)
  }
  zip[`${dir}提示词.txt`] = strToU8(clip.prompt ?? '')
  const missing = missingShots(clip, shots)
  zip[`${dir}说明.txt`] = strToU8([
    `第 ${clip.no} 段 · 镜头 ${(clip.shots ?? []).join('、')} · ${clip.seconds ?? ''} 秒`,
    '',
    HOW[clip.mode] ?? HOW.ingredients,
    '',
    '本包里的参考图（按编号上传）：',
    ...(refs.length ? refs.map(r => `- ${r.name}`) : ['- （还没有上传分镜图或定妆图，画面会不准，建议先回工作台上传）']),
    ...(missing.length ? ['', `提醒：镜 ${missing.join('、')} 还没上传分镜图，先在网页生图后上传，再重新下载素材包。`] : []),
    '',
    `需要上传的素材（AI 建议）：${clip.refs ?? ''}`,
    ...(clip.gridPrompt ? ['', '宫格连贯分镜图提示词（可选，先生成一张多宫格图再逐格当首帧）：', clip.gridPrompt] : []),
    ...(clip.tips ? ['', `提示：${clip.tips}`] : [])
  ].join('\n'))
}

export async function clipPack(project, ep, no, filesDir) {
  const data = project.episodeData?.[ep] ?? {}
  const clips = (data.clips ?? []).filter(c => no == null || c.no === no)
  if (!clips.length) throw Object.assign(new Error('这一段还没有视频提示词'), { status: 404 })
  const zip = {}
  for (const c of clips) await addClip(zip, no == null ? `第${c.no}段/` : '', c, data.shots ?? [], project.characters ?? [], filesDir)
  return Buffer.from(zipSync(zip, { level: 0 }))
}
