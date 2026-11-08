// 本地模拟模型（OpenAI 兼容流式接口），只用于开发时验证流水线和界面，不消耗真实额度。
// 用法：node scripts/mock-llm.mjs [端口]，然后在 DSH 里加一个 OpenAI 兼容提供者指向 http://127.0.0.1:端口/v1。
import { createServer } from 'node:http'

const PORT = Number(process.argv[2] ?? 4399)

const shot = (no, size, visual, dialogue, seconds = 3) => ({ no, scene: '内景·订婚宴大厅', time: '夜·水晶灯暖光', characters: '林墨、苏婉', size, camera: no % 2 ? '平视，起幅中景缓慢推近至近景' : '低角度仰拍', blocking: '林墨画面左侧面朝右，苏婉画面右侧面朝左', acting: '林墨视线下垂，抬眼瞬间眼神转冷', visual, dialogue, sound: '【环境】宾客窃窃私语', seconds, dynamic: no === 5 ? '动・特效' : '动・基础', transition: '切', note: no === 5 ? '▲爽点' : '', imagePrompt: `vertical 9:16, ${size} shot, Lin Mo (young man, short black hair, faded delivery jacket) in a luxury banquet hall, cinematic lighting, 3D Chinese animation style, no text` })

export function answer(system, user) {
  const scoped = /只修改第 (\d+) (镜|段视频)/.exec(system)
  const scopedRole = /只修改角色「(.+?)」/.exec(system)
  if (system.includes('爆款评估专家')) {
    return JSON.stringify({ score: 72, verdict: '钩子够强，爽点释放偏快，卡点可以更狠。', dimensions: ['开场钩子', '冲突与压抑', '爽点爆发', '结尾卡点', '人设一致与记忆点', '台词传播力', '画面可拍性与动态分级', 'AI生成可行性'].map((name, i) => ({ name, score: 6 + (i % 4), comment: `${name}的模拟点评` })), issues: [{ step: 'script', problem: '压抑段太短', fix: '在退婚台词后加一段宾客嘲笑的反应镜头' }, { step: 'shots', problem: '第3-5镜都是中景', fix: '第4镜改成大特写' }], strengths: ['开场反差强'] })
  }
  if (system.includes('AI 视频导演')) {
    const clips = [{ no: 1, shots: [1, 2], seconds: 6, mode: 'frames', refs: '首帧=第1镜分镜图；参考=林墨定妆图', gridPrompt: '2-panel storyboard grid, same banquet hall, same characters, no text, no watermark', prompt: 'Vertical 9:16, 3D Chinese animation style. A luxury banquet hall at night... The young man says in Mandarin, coldly: "这婚，我退了。" No subtitles, no on-screen text.', tips: '在 Flow 选 Frames to Video，上传第1镜图片作为首帧' }, { no: 2, shots: [3, 4, 5], seconds: 8, mode: 'ingredients', refs: '参考=林墨定妆图、苏婉定妆图', prompt: 'Vertical 9:16... Cut to: extreme close-up of a black card... No subtitles.', tips: '选 Ingredients to Video，上传两张定妆图' }]
    return JSON.stringify({ clips: scoped ? [{ ...clips[0], no: Number(scoped[1]), prompt: `${clips[0].prompt} (revised)` }] : clips })
  }
  if (system.includes('资深分镜师')) {
    const shots = [shot(1, '特写', '外卖头盔摔在红毯上', '无', 2), shot(2, '中景', '苏婉把退婚书甩到林墨脸上', '【苏婉（轻蔑）】你也配？'), shot(3, '全景', '宾客哄笑，林墨低头不语', '【环境】哄笑'), shot(4, '近景', '林墨缓缓抬头，眼神一冷', '【林墨（平静）】说完了？'), shot(5, '大特写', '黑卡拍在桌上，金光一闪', '【林墨（冷）】这婚，我退了。', 4)]
    return JSON.stringify({ shots: scoped ? [{ ...shots[0], visual: '（AI 修改）黑卡特写，镜头急推', no: Number(scoped[1]) }] : shots })
  }
  if (system.includes('竖屏短剧编剧')) return '# 第1集 退婚宴上的黑卡\n\n## 场景1：订婚宴大厅 内 夜\n\n**人物**：林墨、苏婉\n\n▲外卖头盔砸在红毯上。【动・中度】\n\n【苏婉（轻蔑）】你也配？\n\n【林墨（平静）】说完了？\n\n▲黑卡拍桌，金光一闪。【动・特效】\n\n【林墨（冷）】这婚，我退了。\n'
  if (system.includes('节奏把控与爽点设计专家')) return '## 本集一句话\n外卖小哥被当众退婚，掏出黑卡反杀。\n\n## 节奏表\n| 时间段 | 节奏 | 剧情内容 | 情绪 | 动态等级 | 爽点/冲突 |\n|---|---|---|---|---|---|\n| 0-3秒 | 快 | 头盔落地 | 震惊 | 中度 | 钩子 |\n| 3-60秒 | 慢 | 当众羞辱 | 压抑 | 基础 | 冲突 |\n| 60-90秒 | 快 | 黑卡反杀 | 爽 | 特效 | 核心爽点 |\n'
  if (system.includes('角色设计师')) {
    const chars = [{ name: '林墨', role: '主角', age: '24', appearance: '短黑发、褪色蓝色外卖服、左手腕旧红绳', tags: '隐忍·反差·隐世继承人', voice: '低沉平稳', background: { experience: '家族考验隐姓三年', obsession: '证明自己', motive: '守护母亲' }, personality: { explicit: '少言', contrast: '被逼急时眼神骤冷', trigger: '家人被辱' }, dynamic: { habit: '转动红绳', micro: '嘴角轻扬', voiceDetail: '"说完了？"' }, story: { function: '核心爽点承载者', relations: '与苏婉：被轻视→打脸', arc: '隐忍→锋芒' }, imagePrompt: 'character turnaround sheet, young Chinese man, 24, short black hair, faded blue delivery jacket, red string on left wrist, 3D animation style, plain background, no text' }, { name: '苏婉', role: '前未婚妻', age: '23', appearance: '大波浪长发、红色礼服、珍珠项链', tags: '势利·骄纵', voice: '尖细上扬', imagePrompt: 'character sheet, young woman, red evening gown, pearl necklace, 3D animation style, no text' }]
    return JSON.stringify({ characters: scopedRole ? [{ ...chars.find(c => c.name === scopedRole[1]) ?? chars[0], tags: '（AI 修改）更可恨' }] : chars })
  }
  if (system.includes('总编剧兼爆款策划')) {
    return JSON.stringify({ title: '退婚宴上的黑卡', logline: '被豪门当众退婚的外卖小哥，其实是隐世首富继承人，一张黑卡让全场跪下。', hook: '外卖头盔砸在订婚宴红毯上', sellingPoints: ['身份反差', '当众打脸', '隐藏大佬'], audience: '18-40 岁男频，追求逆袭爽感', world: '现实都市', mainConflict: '底层身份 vs 豪门势利', emotionCurve: '压抑→小爽→大虐→大爽，第 5 集付费卡点', visualStyle: '国漫 3D 写实风格，电影感光影', episodes: Array.from({ length: 3 }, (_, i) => ({ no: i + 1, title: ['退婚宴上的黑卡', '首富的电话', '跪下的岳父'][i], summary: '本集剧情的模拟摘要。', hook: '开场钩子', climax: '打脸', cliffhanger: '神秘来电' })) })
  }
  return '模拟回复'
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  createServer((req, res) => {
    const chunks = []
    req.on('data', c => chunks.push(c))
    req.on('end', async () => {
      if (req.url.endsWith('/models')) {
        res.setHeader('content-type', 'application/json')
        return res.end(JSON.stringify({ data: [{ id: 'mock-model' }] }))
      }
      const body = JSON.parse(Buffer.concat(chunks).toString() || '{}')
      const flat = m => (typeof m.content === 'string' ? m.content : (m.content ?? []).map(p => p.text ?? '').join(''))
      const messages = body.messages ?? []
      const system = messages.filter(m => m.role === 'system' || m.role === 'developer').map(flat).join('\n')
      const user = messages.filter(m => m.role === 'user').map(flat).join('\n')
      const text = answer(system, user)
      console.log(JSON.stringify({ url: req.url, model: body.model, systemHead: system.slice(0, 30) }))
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      const base = { id: 'mock', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: body.model }
      const send = choice => res.write(`data: ${JSON.stringify({ ...base, choices: [choice] })}\n\n`)
      send({ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null })
      for (let i = 0; i < text.length; i += 24) {
        send({ index: 0, delta: { content: text.slice(i, i + 24) }, finish_reason: null })
        await new Promise(r => setTimeout(r, 30))
      }
      send({ index: 0, delta: {}, finish_reason: 'stop' })
      res.write(`data: ${JSON.stringify({ ...base, choices: [], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } })}\n\n`)
      res.write('data: [DONE]\n\n')
      res.end()
    })
  }).listen(PORT, '127.0.0.1', () => console.log(`mock llm on ${PORT}`))
}
