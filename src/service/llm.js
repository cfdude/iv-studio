// The prompt writer on an OpenAI-compatible server (GitHub #15): llama.cpp's llama-server, llama-swap, vLLM,
// LM Studio, LiteLLM, LocalAI, OpenAI itself, or anything else that serves /v1/chat/completions.
// Settings → Prompt writer → OpenAI-compatible holds the address, model, whether it sees pictures, and an
// optional key and extra headers (both stored encrypted by the app). The app and the MCP server each set where
// the settings come from with setLlmSource; the MCP server reads the key and headers from its environment
// (IV_STUDIO_LLM_KEY or OPENAI_API_KEY, IV_STUDIO_LLM_HEADERS), because only the app can unseal them.
// Everything that writes with the "local" writer (prompts, stories, reviews, Projects, Remake, Rebuild, Sounds)
// goes through prompter.js localChat, which calls openaiChat here when this server is the chosen writer.

let source = () => ({})
export function setLlmSource(fn) {
  source = typeof fn === 'function' ? fn : () => ({})
}

// { provider: 'ollama' | 'openai', url, model, vision, key, headers }
export function llmConfig() {
  let c = {}
  try {
    c = source() || {}
  } catch {}
  let url = ''
  try {
    url = normalizeApiBase(c.url)
  } catch {}
  return { provider: c.provider === 'openai' ? 'openai' : 'ollama', url, model: String(c.model || '').trim(), vision: !!c.vision, key: String(c.key || '').trim(), headers: c.headers && typeof c.headers === 'object' ? c.headers : {} }
}

// "localhost:8080", "http://host:8080/v1/", "https://api.openai.com/v1/chat/completions" -> the API base that
// /models and /chat/completions hang off. A bare host gets /v1, which every server above uses.
export function normalizeApiBase(v) {
  let s = String(v ?? '').trim()
  if (!s) return ''
  // "localhost:8080" has no "://", and Node's URL would read "localhost:" as a scheme
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `http://${s.replace(/^\/+/, '')}`
  const u = new URL(s)
  if (!/^https?:$/.test(u.protocol)) throw new Error('bad protocol')
  let p = u.pathname.replace(/\/+$/, '').replace(/\/chat\/completions$/i, '').replace(/\/models$/i, '')
  if (!p) p = '/v1'
  if (u.hostname === '0.0.0.0') u.hostname = '127.0.0.1'
  return `${u.protocol}//${u.host}${p}`
}

// Extra headers, one per line as "Name: value". Returns { name: value }; throws on a line it can't read.
export function parseHeaders(text) {
  const out = {}
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const i = line.indexOf(':')
    const name = i > 0 ? line.slice(0, i).trim() : ''
    if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(name)) throw new Error(`"${line.slice(0, 40)}" isn't a header. Write one per line, like X-Api-Version: 2.`)
    out[name] = line.slice(i + 1).trim()
  }
  return out
}

const headersOf = (cfg) => ({ 'content-type': 'application/json', ...(cfg.key ? { authorization: `Bearer ${cfg.key}` } : {}), ...cfg.headers })
const say = (cfg) => `the OpenAI-compatible server at ${cfg.url || '(no address)'}`

async function errorText(r) {
  const t = await r.text().catch(() => '')
  try {
    const j = JSON.parse(t)
    return String(j.error?.message || j.error || j.message || t).slice(0, 300)
  } catch {
    return t.slice(0, 300)
  }
}

// The models the server offers (GET /models). Some servers don't list; that's an empty list, not an error.
export async function openaiModels(cfg = llmConfig(), { timeoutMs = 5000 } = {}) {
  if (!cfg.url) throw new Error('Enter the server address first, like http://localhost:8080/v1.')
  let r
  try {
    r = await fetch(`${cfg.url}/models`, { headers: headersOf(cfg), signal: AbortSignal.timeout(timeoutMs) })
  } catch (err) {
    throw new Error(`Nothing answered at ${cfg.url}. Check the address and that the server is running.${err?.name === 'TimeoutError' ? ' (It took too long.)' : ''}`)
  }
  if (r.status === 401 || r.status === 403) throw new Error(`${say(cfg)} refused the key (${r.status}): ${await errorText(r)}`)
  if (!r.ok) return []
  const j = await r.json().catch(() => ({}))
  const list = Array.isArray(j.data) ? j.data : Array.isArray(j.models) ? j.models : Array.isArray(j) ? j : []
  return list.map((m) => (typeof m === 'string' ? m : m.id || m.name || m.model)).filter(Boolean)
}

// Is the writer ready? { ok, url, models, error }. Used by Settings and before writing.
export async function openaiStatus(cfg = llmConfig()) {
  if (!cfg.url) return { ok: false, url: '', models: [], error: 'No address yet.' }
  try {
    const models = await openaiModels(cfg)
    return { ok: true, url: cfg.url, models, error: null }
  } catch (err) {
    return { ok: false, url: cfg.url, models: [], error: err.message }
  }
}

// What each server accepted for structured answers, by address, so the next call starts with what works:
// 'json_schema' (OpenAI, vLLM, llama.cpp, LM Studio), then 'json_object', then plain text.
const formatFor = new Map()
const FORMATS = ['json_schema', 'json_object', 'none']
const responseFormat = (f, schema) => (f === 'json_schema' ? { type: 'json_schema', json_schema: { name: 'answer', schema, strict: false } } : f === 'json_object' ? { type: 'json_object' } : undefined)

// One answer. messages: [{ role, content, images?: [base64 JPEG] }], Ollama's shape, turned into OpenAI's here.
// Returns the reply text (the JSON is parsed by the caller).
export async function openaiChat({ cfg = llmConfig(), model, system, messages, schema, temperature = 0.5, maxTokens = 6000, timeoutMs = 600000 }) {
  if (!cfg.url) throw new Error('The OpenAI-compatible writer has no address. Enter it in Settings → Prompt writer.')
  const name = model || cfg.model
  if (!name) throw new Error('Choose the model for the OpenAI-compatible writer in Settings → Prompt writer.')
  const jsonNote = schema ? `\n\nAnswer with one JSON object that matches this JSON schema, and nothing else:\n${JSON.stringify(schema)}` : ''
  const convert = (m) => {
    const imgs = cfg.vision ? m.images || [] : []
    if (!imgs.length) return { role: m.role, content: m.content }
    return { role: m.role, content: [{ type: 'text', text: m.content }, ...imgs.map((b) => ({ type: 'image_url', image_url: { url: String(b).startsWith('data:') ? b : `data:image/jpeg;base64,${b}` } }))] }
  }
  const start = schema ? Math.max(0, FORMATS.indexOf(formatFor.get(cfg.url) || 'json_schema')) : 2
  let last = ''
  for (let i = start; i < FORMATS.length; i++) {
    const f = FORMATS[i]
    const body = {
      model: name,
      stream: false,
      temperature,
      max_tokens: maxTokens,
      // the schema goes in the system message too: json_object and plain servers need it, and it helps the rest
      messages: [{ role: 'system', content: `${system || ''}${f === 'json_schema' ? '' : jsonNote}`.trim() }, ...messages.map(convert)]
    }
    const rf = schema && responseFormat(f, schema)
    if (rf) body.response_format = rf
    let r
    try {
      r = await fetch(`${cfg.url}/chat/completions`, { method: 'POST', headers: headersOf(cfg), body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) })
    } catch (err) {
      throw new Error(err?.name === 'TimeoutError' ? `${say(cfg)} took too long to answer.` : `Nothing answered at ${cfg.url}. Check the address in Settings → Prompt writer and that the server is running.`)
    }
    if (r.ok) {
      const j = await r.json().catch(() => ({}))
      const msg = j.choices?.[0]?.message || {}
      const text = typeof msg.content === 'string' ? msg.content : Array.isArray(msg.content) ? msg.content.map((p) => p.text || '').join('') : ''
      if (schema) formatFor.set(cfg.url, f)
      return text
    }
    last = await errorText(r)
    if (r.status === 401 || r.status === 403) throw new Error(`${say(cfg)} refused the key (${r.status}): ${last}`)
    if (r.status === 404 && /model/i.test(last)) throw new Error(`${say(cfg)} doesn't have the model "${name}": ${last}`)
    // a server that can't take pictures says so: tell the person to switch it off rather than guessing
    if (cfg.vision && /image|vision|multimodal|image_url/i.test(last) && !/response_format|json_schema|json_object|grammar|schema/i.test(last)) throw new Error(`${say(cfg)} can't take pictures with "${name}": ${last} Turn off "It can see pictures" in Settings → Prompt writer, or choose a vision model.`)
    // otherwise a 400/422/500 on the structured format: try the next, plainer one
    if (![400, 404, 415, 422, 500, 501].includes(r.status)) break
  }
  throw new Error(`${say(cfg)}: ${last || 'it refused the request.'}`)
}
