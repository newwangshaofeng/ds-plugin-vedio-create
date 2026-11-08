// 复制到网页（ChatGPT / GPT Image、即梦等）的生图请求：
// 只粘一段英文描述时，对话模型常把它当成要点评的文字，回复「提示词很完整」却不出图，所以前面加一句明确的出图指令。
export function imageRequest(prompt, ratio) {
  const text = prompt?.trim()
  if (!text) return ''
  const size = ratio ? `，画幅 ${ratio}` : ''
  return `请直接生成一张图片${size}。不要只回复文字，不要评价或改写提示词，照下面的描述出图：\n\nGenerate an image${ratio ? ` (aspect ratio ${ratio})` : ''}: ${text}`
}
