// 一段视频要上传到 Google Flow / Seedance 的参考图，按「图1、图2…」编号：先本段各镜分镜图，再出场角色定妆图。
export function clipRefs(clip, shots = [], chars = []) {
  const clipShots = (clip.shots ?? []).map(n => shots.find(s => s.no === n) ?? shots[n - 1]).filter(Boolean)
  const text = [clip.refs, ...clipShots.map(s => `${s.visual ?? ''}${s.dialogue ?? ''}`)].join('\n')
  const refs = [
    ...clipShots.filter(s => s.image).map(s => ({ file: s.image, label: `镜${s.no}分镜图`, kind: 'shot', no: s.no })),
    ...chars.filter(c => c.image && c.name && text.includes(c.name)).map(c => ({ file: c.image, label: `${c.name}定妆图`, kind: 'character', id: c.id }))
  ]
  return refs.map((r, i) => ({ ...r, name: `图${i + 1}-${r.label}${r.file.match(/\.\w+$/)?.[0] ?? '.png'}` }))
}

export const missingShots = (clip, shots = []) => (clip.shots ?? []).filter(n => !(shots.find(s => s.no === n) ?? shots[n - 1])?.image)
