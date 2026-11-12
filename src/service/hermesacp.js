// Hermes in IV Studio's chat (agentchat.js), through Hermes's own Agent Client Protocol server (`hermes-acp`, JSON-RPC
// over stdio, one message a line). Claude Code and Codex are run once per message with flags; Hermes is spoken to the
// way an editor speaks to it: initialize, a session (new, or resumed by id) given IV Studio's MCP server, then the
// message. Its streamed updates become the chat's events (parseLine's shapes: session, say, step, stepError, usage,
// end), so the chat panel shows Hermes like the others.
//
// The chat only offers IV Studio's tools. Hermes keeps its own tools (they come from the person's Hermes config), so the
// first message tells it to use IV Studio's, and anything Hermes asks the person's approval for (a shell command, a
// file edit) is declined here and shown as a declined step: nothing runs that nobody approved.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { onPath } from './harness.js'

export const ACP_PROTOCOL = 1

// Where Hermes's installer puts hermes-acp: %LOCALAPPDATA%\hermes\bin on Windows, ~/.local/bin (or on PATH) elsewhere.
// HERMES_HOME moves the whole install on Windows.
export function findHermes(env = process.env, home = os.homedir(), platform = process.platform) {
  const exists = (p) => {
    try {
      return !!p && fs.statSync(p).isFile()
    } catch {
      return false
    }
  }
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local')
    const roots = [env.HERMES_HOME, path.join(local, 'hermes')].filter(Boolean)
    for (const r of roots) for (const name of ['hermes-acp.exe']) if (exists(path.join(r, 'bin', name))) return path.join(r, 'bin', name)
    return onPath('hermes-acp', env, home) || null
  }
  return [path.join(home, '.local', 'bin', 'hermes-acp'), path.join(home, '.hermes', 'bin', 'hermes-acp')].find(exists) || onPath('hermes-acp', env, home) || null
}

// A Hermes tool title as IV Studio's tool name: an MCP tool is mcp__<server>[_<hash>]__<tool>, and only the tool counts.
export function hermesTool(title = '') {
  const t = String(title).trim()
  const m = /^mcp__.*?__([a-z0-9_]+)/i.exec(t)
  if (m) return m[1]
  return t.split(':')[0].trim() || 'tool'
}

export const HERMES_INTERNAL = new Set(['tool_describe', 'tool_search', 'skill_view', 'skills_list', 'todo', 'memory', 'session_search'])

// The model choice on a session: Hermes lists its models as a select config option ("provider:model" values).
export function modelOption(configOptions = []) {
  return (configOptions || []).find((o) => o && (o.category === 'model' || o.id === 'model') && Array.isArray(o.options)) || null
}

// One message's turn with Hermes. server: IV Studio's MCP server ({ command, args, env }). session: Hermes's session
// id to continue, or null. text: the message (the first one carries the chat's instructions). model: a "provider:model"
// value from Hermes's list, or '' for the person's Hermes default. emit(e) gets the chat's events. Returns
// { child, done } where done resolves { ok, error, session }.
// A .cmd (a wrapper, or a test's stand-in) only runs through the shell on Windows.
const startExe = (exe, args, opts) => {
  const viaShell = process.platform === 'win32' && /\.cmd$/i.test(exe)
  return spawn(viaShell ? `"${exe}"` : exe, args, { ...opts, shell: viaShell })
}

// A JSON-RPC error from Hermes in words: its message plus error.data.details (or data.message, data.errors' field
// problems, or data as text) when there is one, since "Internal error" alone hides the real cause, like a Windows
// permissions problem (GitHub #31). Hermes sends { message: 'Internal error', data: { details: 'not_found' } }, and
// for a bad request pydantic's { data: { errors: [{ loc: ['cwd'], msg: 'Field required' }] } }.
export function acpErrorText(error) {
  const head = String(error?.message || '').trim() || 'Hermes refused.'
  const d = error?.data
  const fields = Array.isArray(d?.errors) ? d.errors.map((e) => [[].concat(e?.loc || []).join('.'), e?.msg].filter(Boolean).join(': ')).filter(Boolean).join('; ') : ''
  const raw = typeof d === 'string' ? d : d?.details ?? d?.detail ?? d?.message ?? (fields || (d && typeof d === 'object' && Object.keys(d).length ? JSON.stringify(d) : ''))
  const details = String(raw || '').trim()
  if (!details || head.includes(details)) return head
  const short = details.length > 800 ? `${details.slice(0, 800)}…` : details
  return `${head.replace(/[.:\s]+$/, '')}: ${short}`
}

// server: IV Studio's MCP server for the chat, or null for a plain answer (the prompt writer). images: [{ data, mimeType }]
// sent with the text when Hermes says its model takes pictures (promptCapabilities.image); otherwise left out.
export function hermesTurn({ exe, cwd, server, session = null, text, images = [], model = '', emit = () => {}, env = process.env, spawnFn = startExe }) {
  const child = spawnFn(exe, [], { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  let buf = ''
  let id = 0
  const pending = new Map()
  let replaying = false
  let sessionId = session
  // the agent's words arrive in pieces, each message under its own id: shown as one bubble each
  let words = { id: null, text: '' }
  const flushWords = () => {
    const t = words.text.trim()
    if (t) emit({ type: 'say', text: t })
    words = { id: null, text: '' }
  }
  const steps = new Map() // toolCallId -> tool
  let err = ''
  let resolveDone
  const done = new Promise((r) => (resolveDone = r))
  let finished = false
  const finish = (r) => {
    if (finished) return
    finished = true
    for (const p of pending.values()) p.reject(new Error(r.error || 'Hermes stopped.'))
    pending.clear()
    try {
      child.stdin.end()
    } catch {}
    resolveDone({ ...r, session: sessionId })
  }
  const send = (m) => {
    try {
      child.stdin.write(`${JSON.stringify(m)}\n`)
    } catch {}
  }
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const i = ++id
      pending.set(i, { resolve, reject })
      send({ jsonrpc: '2.0', id: i, method, params })
    })

  const onUpdate = (u = {}) => {
    if (replaying) return // a resumed session's history, already in the chat
    const kind = u.sessionUpdate
    if (kind === 'agent_message_chunk') {
      const piece = u.content?.type === 'text' ? u.content.text || '' : ''
      if (words.id && u.messageId && u.messageId !== words.id) flushWords()
      words.id = u.messageId || words.id || 'm'
      words.text += piece
    } else if (kind === 'tool_call') {
      flushWords()
      const tool = hermesTool(u.title)
      // Hermes's own bookkeeping (reading a tool's details, loading a skill, its to-do list) isn't a step to show
      if (HERMES_INTERNAL.has(tool)) return
      steps.set(u.toolCallId, tool)
      emit({ type: 'step', tool, id: u.toolCallId })
      if (u.status === 'failed') emit({ type: 'stepError', id: u.toolCallId, text: 'Failed' })
    } else if (kind === 'tool_call_update') {
      if (u.status === 'failed' && steps.has(u.toolCallId)) {
        const said = (u.content || []).map((c) => c?.content?.text || '').join(' ').trim()
        emit({ type: 'stepError', id: u.toolCallId, text: said.slice(0, 300) || 'Failed' })
      }
    } else if (kind === 'usage_update') {
      if (u.used != null) emit({ type: 'usage', context: u.used, window: u.size || null })
    }
  }
  const onRequest = (m) => {
    if (m.method === 'session/request_permission') {
      // nothing outside IV Studio's own Allow cards runs from the chat
      const opts = m.params?.options || []
      const no = opts.find((o) => /reject/.test(o.kind || '')) || null
      const what = m.params?.toolCall?.title || 'something'
      flushWords()
      emit({ type: 'step', tool: hermesTool(what), id: `perm-${m.id}` })
      emit({ type: 'stepError', id: `perm-${m.id}`, text: `Hermes asked to run this outside IV Studio; IV Studio's chat declines anything that isn't an IV Studio tool.` })
      send({ jsonrpc: '2.0', id: m.id, result: { outcome: no ? { outcome: 'selected', optionId: no.optionId } : { outcome: 'cancelled' } } })
    } else send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: `IV Studio doesn't offer ${m.method}` } })
  }
  child.stdout.on('data', (d) => {
    buf += d
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (!line) continue
      let m
      try {
        m = JSON.parse(line)
      } catch {
        continue
      }
      if (m.id != null && !m.method && pending.has(m.id)) {
        const p = pending.get(m.id)
        pending.delete(m.id)
        if (m.error) p.reject(new Error(acpErrorText(m.error)))
        else p.resolve(m.result)
      } else if (m.method === 'session/update') onUpdate(m.params?.update)
      else if (m.method && m.id != null) onRequest(m)
    }
  })
  child.stderr.on('data', (d) => (err = (err + d).slice(-2000)))
  child.on('error', (e) => finish({ ok: false, error: `Hermes couldn't start: ${e.message}` }))
  child.on('close', (code) => finish({ ok: false, error: err.trim().split('\n').filter(Boolean).pop() || `Hermes stopped (code ${code}).` }))

  const mcpServers = server ? [{ name: 'iv-studio', command: server.command, args: server.args, env: Object.entries(server.env || {}).map(([name, value]) => ({ name, value: String(value) })) }] : []
  let seesPictures = false
  ;(async () => {
    try {
      const init = await request('initialize', { protocolVersion: ACP_PROTOCOL, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false }, clientInfo: { name: 'iv-studio', version: '1' } })
      seesPictures = !!init?.agentCapabilities?.promptCapabilities?.image
      let opened = null
      if (sessionId) {
        replaying = true
        try {
          opened = await request('session/resume', { cwd, sessionId, mcpServers })
        } catch {
          opened = null
        }
        replaying = false
      }
      if (!opened) {
        opened = await request('session/new', { cwd, mcpServers })
        sessionId = opened?.sessionId || sessionId
      }
      emit({ type: 'session', id: sessionId })
      const option = modelOption(opened?.configOptions)
      if (model && option && option.currentValue !== model && option.options.some((o) => o.value === model)) {
        await request('session/set_config_option', { sessionId, configId: option.id, value: model }).catch(() => null)
      }
      const pictures = seesPictures ? images.map((im) => ({ type: 'image', mimeType: im.mimeType || 'image/jpeg', data: im.data })) : []
      emit({ type: 'pictures', sent: pictures.length })
      const r = await request('session/prompt', { sessionId, prompt: [{ type: 'text', text }, ...pictures] })
      flushWords()
      const u = r?.usage
      if (u) emit({ type: 'usage', turn: { input: u.inputTokens || 0, cached: u.cachedReadTokens || 0, output: u.outputTokens || 0 } })
      const ok = r?.stopReason === 'end_turn' || r?.stopReason === 'max_tokens' || r?.stopReason === 'max_turn_requests'
      const why = { refusal: 'Hermes declined to answer that.', cancelled: 'Stopped.' }[r?.stopReason]
      emit({ type: 'end', ok, text: ok ? null : why || `Hermes stopped (${r?.stopReason || 'no reason'}).` })
      finish({ ok, error: ok ? null : why || `Hermes stopped (${r?.stopReason}).` })
    } catch (e) {
      flushWords()
      finish({ ok: false, error: /auth|credential|sign/i.test(e.message) ? `Hermes needs a model it can use: ${e.message} (run hermes model, or pick a model in Settings).` : e.message })
    }
  })()

  return {
    child,
    done,
    // the person's Stop: Hermes cancels the turn (renders it started keep going)
    cancel() {
      if (sessionId) send({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId } })
    }
  }
}

export const HERMES_NOTE = `\n\nYou're Hermes here, inside IV Studio's chat. Use IV Studio's tools (the iv-studio MCP server) for everything; don't use your shell, files, browser or other tools in this chat, and don't load other skills for IV Studio work.`
