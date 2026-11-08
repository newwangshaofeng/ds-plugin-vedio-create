// 模型调用：用 DeepSeek Harness 里已经配好的模型（或工作台里指定的模型），插件本身不带密钥。
import { randomUUID } from 'node:crypto'

/** 插件在会话之外调模型，自己带一个会话标识；有些网关按会话路由。 */
export const PLUGIN_SESSION_ID = `dsh-drama-studio-${randomUUID()}`

/** 最近一次模型调用的结果。 */
export const modelStatus = { ok: null, error: null }

let override = null

export function setModelOverride(sel) {
  override = sel?.provider && sel?.model ? { provider: sel.provider, model: sel.model } : null
}

export function modelOverride() {
  return override
}

export function defaultSelection(ctx) {
  try {
    const selection = ctx.get('agentDefaultModel')?.currentSelection()
    return selection?.provider && selection?.model ? { provider: selection.provider, model: selection.model } : null
  } catch {
    return null
  }
}

export function modelInfo(ctx) {
  if (!ctx.get('llm')) return null
  const route = override ?? defaultSelection(ctx)
  return route ? { provider: route.provider, model: route.model, label: route.model } : null
}

/**
 * 调一次模型并流式回传文本。
 * @param {object} ctx - Cordis 上下文。
 * @param {{system: string, user: string, maxTokens?: number, signal?: AbortSignal, onText?: (delta: string) => void}} request
 * @returns {Promise<{text: string, model: string}>}
 */
export async function callModel(ctx, { system, user, maxTokens = 8000, signal, onText }) {
  const info = modelInfo(ctx)
  if (!info) throw new Error('当前没有可用的文字模型，请先在 DeepSeek Harness 里配置模型')
  const llm = ctx.get('llm')
  try {
    const call = await llm.prepareCall({ provider: info.provider, model: info.model, maxTokens }, signal, controls => controls)
    let text = ''
    for await (const chunk of call.stream({
      ...call.config,
      system,
      messages: [{ role: 'user', content: [{ type: 'text', text: user }], source: { kind: 'dsh-drama-studio' } }],
      sessionId: PLUGIN_SESSION_ID,
      signal,
    })) {
      if (chunk.type === 'text-delta') {
        text += chunk.text
        onText?.(chunk.text)
      } else if (chunk.type === 'finish' && ['error', 'aborted'].includes(chunk.reason?.kind)) {
        throw new Error(chunk.reason.failure?.message || '模型调用失败')
      }
    }
    Object.assign(modelStatus, { ok: true, error: null })
    return { text, model: info.label }
  } catch (err) {
    Object.assign(modelStatus, { ok: false, error: err.message })
    throw err
  }
}

/** 从模型输出里取出 JSON：容忍代码块、前后说明文字和中文引号外的尾逗号。 */
export function extractJson(text) {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  const body = fenced ? fenced[1] : text
  const start = body.search(/[{[]/)
  const end = Math.max(body.lastIndexOf('}'), body.lastIndexOf(']'))
  if (start < 0 || end < start) throw new Error('模型没有返回 JSON')
  const raw = body.slice(start, end + 1)
  const attempts = [
    () => raw,
    () => raw.replace(/,\s*([}\]])/g, '$1'),
    () => repairQuotes(raw),
    () => repairTruncated(body.slice(start)),
    () => repairTruncated(repairQuotes(body.slice(start))),
  ]
  let error
  for (const attempt of attempts) {
    const candidate = attempt()
    if (!candidate) continue
    try {
      return JSON.parse(candidate)
    } catch (err) {
      error ??= err
    }
  }
  throw error
}

/** 模型常在中文台词里直接用英文双引号（"他说"走""），或在字符串里换行；把这些引号转义、换行改成 \n。 */
const NON_SPACE = /\S/g

export function repairQuotes(text) {
  let out = ''
  let inString = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (!inString) {
      if (ch === '"') inString = true
      out += ch
      continue
    }
    if (ch === '\\') {
      out += ch + (text[i + 1] ?? '')
      i++
    } else if (ch === '\n') out += '\\n'
    else if (ch === '\r') continue
    else if (ch === '"') {
      NON_SPACE.lastIndex = i + 1
      const next = NON_SPACE.exec(text)?.[0]
      if (!next || ',:}]'.includes(next)) {
        inString = false
        out += ch
      } else out += '\\"'
    } else out += ch
  }
  return out
}

/** 模型偶尔漏写相邻两条之间的 `},{`，导致多镜挤进一个对象、只剩最后一镜；在第二个 "no" 键前补回。 */
export function splitMergedItems(text) {
  return text.replace(/([^{\s])(\s*),(\s*)"no"(\s*):/g, '$1},{$3"no"$4:')
}

/** 输出被截断时（长分镜表常见），保留到最后一个完整的数组元素，再补齐括号。 */
export function repairTruncated(text) {
  const stack = []
  let inString = false
  let cut = null
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (ch === '\\') i++
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{' || ch === '[') stack.push(ch)
    else if (ch === '}' || ch === ']') {
      stack.pop()
      if (!stack.length) return null
      if (stack.at(-1) === '[') cut = { at: i + 1, stack: [...stack] }
    }
  }
  if (!cut) return null
  return text.slice(0, cut.at) + cut.stack.reverse().map(c => (c === '[' ? ']' : '}')).join('')
}

/** 去掉模型偶尔包在 Markdown 外面的代码块。 */
export function stripFence(text) {
  const match = /^\s*```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/.exec(text)
  return (match ? match[1] : text).trim()
}
