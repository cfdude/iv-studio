// Hermes in IV Studio's chat (src/service/hermesacp.js, agentchat.js): a stand-in Hermes ACP server streams words,
// an IV Studio tool call, a usage update and an approval request; the chat must show them as its own events, decline
// the approval, keep the session and resume it on the next message without replaying history.
//   node test/hermes-acp.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { acpErrorText, findHermes, hermesTool, hermesTurn, modelOption } from '../src/service/hermesacp.js'
import { applyChatEvent, newChat, startChatTurn } from '../src/service/agentchat.js'

let n = 0
let failed = 0
const ok = async (name, fn) => {
  n++
  try {
    await fn()
    console.log('ok', name)
  } catch (err) {
    failed++
    console.log('FAIL', name, '-', err.message)
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-hermes-acp-'))
// the stand-in: a node script speaking ACP over stdio; it logs what it was asked to a file
const fake = path.join(tmp, 'fake-acp.mjs')
const log = path.join(tmp, 'acp-log.jsonl')
fs.writeFileSync(fake, `
import fs from 'node:fs'
const log = ${JSON.stringify(log)}
const say = (m) => process.stdout.write(JSON.stringify(m) + '\\n')
let buf = ''
let permId = 900
const waiting = new Map()
process.stdin.on('data', (d) => {
  buf += d
  let i
  while ((i = buf.indexOf('\\n')) >= 0) {
    const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1)
    fs.appendFileSync(log, JSON.stringify(m) + '\\n')
    if (m.id != null && !m.method) { const w = waiting.get(m.id); if (w) w(m.result); continue }
    const up = (u) => say({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 's-1', update: u } })
    if (m.method === 'initialize') say({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: 1, agentCapabilities: { loadSession: true } } })
    else if (m.method === 'session/new') say({ jsonrpc: '2.0', id: m.id, result: { sessionId: 's-1', configOptions: [{ id: 'model', category: 'model', type: 'select', currentValue: 'a:one', options: [{ value: 'a:one' }, { value: 'b:two' }] }] } })
    else if (m.method === 'session/resume') {
      up({ sessionUpdate: 'agent_message_chunk', messageId: 'old', content: { type: 'text', text: 'OLD HISTORY' } })
      say({ jsonrpc: '2.0', id: m.id, result: { configOptions: [] } })
    } else if (m.method === 'session/set_config_option') say({ jsonrpc: '2.0', id: m.id, result: {} })
    else if (m.method === 'session/prompt') {
      up({ sessionUpdate: 'agent_message_chunk', messageId: 'a', content: { type: 'text', text: 'Looking ' } })
      up({ sessionUpdate: 'agent_message_chunk', messageId: 'a', content: { type: 'text', text: 'now.' } })
      up({ sessionUpdate: 'tool_call', toolCallId: 't0', title: 'tool_describe: Reading tool details · 1 tool', kind: 'other' })
      up({ sessionUpdate: 'tool_call', toolCallId: 't1', title: 'mcp__editor_iv_studio_036afaa6__list_characters', kind: 'other' })
      up({ sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed' })
      up({ sessionUpdate: 'usage_update', used: 1200, size: 500000 })
      const pid = ++permId
      waiting.set(pid, (r) => {
        fs.appendFileSync(log, JSON.stringify({ permissionAnswer: r }) + '\\n')
        up({ sessionUpdate: 'agent_message_chunk', messageId: 'b', content: { type: 'text', text: 'Tess and Theo.' } })
        say({ jsonrpc: '2.0', id: m.id, result: { stopReason: 'end_turn', usage: { inputTokens: 100, cachedReadTokens: 50, outputTokens: 20 } } })
      })
      say({ jsonrpc: '2.0', id: pid, method: 'session/request_permission', params: { sessionId: 's-1', toolCall: { title: 'terminal: rm -rf something' }, options: [{ optionId: 'yes', kind: 'allow_once' }, { optionId: 'no', kind: 'reject_once' }] } })
    }
  }
})
process.stdin.on('end', () => process.exit(0))
`)
// on Windows the stand-in runs through node; hermesTurn spawns exe with no arguments, so wrap it
const exe = process.platform === 'win32' ? path.join(tmp, 'fake-acp.cmd') : path.join(tmp, 'fake-acp.sh')
if (process.platform === 'win32') fs.writeFileSync(exe, `@"${process.execPath}" "${fake}"\r\n`)
else fs.writeFileSync(exe, `#!/bin/sh\nexec "${process.execPath}" "${fake}"\n`, { mode: 0o755 })
const reqs = () => fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l))

await ok('tool titles become IV Studio tool names', () => {
  assert.equal(hermesTool('mcp__editor_iv_studio_036afaa6__list_characters'), 'list_characters')
  assert.equal(hermesTool('mcp__iv-studio__generate_previews'), 'generate_previews')
  assert.equal(hermesTool('skill_view: iv-studio'), 'skill_view')
  assert.equal(hermesTool('mcp__editor_iv_studio_81db0e8f__speak_line: Tess, Same time tomorrow?'), 'speak_line')
  assert.equal(hermesTool('mcp__editor_iv_studio_81db0e8f__speak_line (2)'), 'speak_line')
})

await ok('the model option is found by category', () => {
  assert.equal(modelOption([{ id: 'x', category: 'mode', options: [] }, { id: 'm', category: 'model', options: [{ value: 'a' }] }]).id, 'm')
  assert.equal(modelOption([]), null)
})

await ok('findHermes looks in the Hermes install folder on Windows', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-hermes-home-'))
  const bin = path.join(home, 'AppData', 'Local', 'hermes', 'bin')
  fs.mkdirSync(bin, { recursive: true })
  fs.writeFileSync(path.join(bin, 'hermes-acp.exe'), '')
  assert.equal(findHermes({ PATH: '' }, home, 'win32'), path.join(bin, 'hermes-acp.exe'))
  assert.equal(findHermes({ PATH: '' }, fs.mkdtempSync(path.join(os.tmpdir(), 'iv-nohermes-')), 'win32'), null)
})

const server = { command: 'iv', args: ['mcp.js'], env: { ELECTRON_RUN_AS_NODE: '1' } }
const runShell = (session, model = '') => {
  const events = []
  const t = hermesTurn({ exe, cwd: tmp, server, session, text: 'hi', model, emit: (e) => events.push(e) })
  return t.done.then((r) => ({ r, events }))
}

let first
await ok('a turn streams words, an IV Studio step, usage and the end', async () => {
  first = await runShell(null, 'b:two')
  assert.equal(first.r.ok, true, first.r.error)
  assert.equal(first.r.session, 's-1')
  const says = first.events.filter((e) => e.type === 'say').map((e) => e.text)
  assert.deepEqual(says, ['Looking now.', 'Tess and Theo.'])
  assert.ok(first.events.some((e) => e.type === 'step' && e.tool === 'list_characters'))
  assert.ok(!first.events.some((e) => e.type === 'step' && e.tool === 'tool_describe'), 'Hermes bookkeeping shown as a step')
  assert.ok(first.events.some((e) => e.type === 'usage' && e.context === 1200 && e.window === 500000))
  assert.ok(first.events.some((e) => e.type === 'usage' && e.turn?.input === 100))
  assert.ok(first.events.some((e) => e.type === 'end' && e.ok))
})

await ok('IV Studio passes its own MCP server and picks the model', () => {
  const r = reqs()
  const nw = r.find((m) => m.method === 'session/new')
  assert.deepEqual(nw.params.mcpServers, [{ name: 'iv-studio', command: 'iv', args: ['mcp.js'], env: [{ name: 'ELECTRON_RUN_AS_NODE', value: '1' }] }])
  const set = r.find((m) => m.method === 'session/set_config_option')
  assert.deepEqual(set.params, { sessionId: 's-1', configId: 'model', value: 'b:two' })
})

await ok("Hermes's approval request is declined and shown as a declined step", () => {
  const ans = reqs().find((m) => m.permissionAnswer)
  assert.deepEqual(ans.permissionAnswer, { outcome: { outcome: 'selected', optionId: 'no' } })
  const err = first.events.find((e) => e.type === 'stepError' && /declines/.test(e.text))
  assert.ok(err, 'no declined step')
})

await ok('the next message resumes the session without replaying its history', async () => {
  fs.writeFileSync(log, '')
  const second = await runShell('s-1')
  assert.equal(second.r.ok, true, second.r.error)
  assert.ok(reqs().some((m) => m.method === 'session/resume' && m.params.sessionId === 's-1'))
  assert.ok(!reqs().some((m) => m.method === 'session/new'))
  assert.ok(!second.events.some((e) => e.type === 'say' && /OLD HISTORY/.test(e.text)))
})

await ok('the chat runs a Hermes turn and keeps it as a conversation', async () => {
  fs.writeFileSync(log, '')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-hermes-chat-'))
  const chat = newChat({ id: 'c1', engine: 'hermes' })
  assert.equal(chat.name, 'Hermes')
  const turn = startChatTurn({ engine: 'hermes', exe, dir, message: 'who is there', mcp: server, onEvent: (e) => applyChatEvent(chat, e), pollMs: 50 })
  const r = await turn.promise
  assert.equal(r.ok, true, r.error)
  assert.equal(r.session, 's-1')
  assert.equal(chat.session, 's-1')
  const agentSaid = chat.entries.filter((e) => e.kind === 'agent').map((e) => e.text)
  assert.deepEqual(agentSaid, ['Looking now.', 'Tess and Theo.'])
  const step = chat.entries.find((e) => e.kind === 'step' && e.tool === 'list_characters')
  assert.ok(step && step.label, 'no labelled step')
  // the first message carries the chat's instructions and the Hermes note
  const prompt = reqs().find((m) => m.method === 'session/prompt').params.prompt[0].text
  assert.match(prompt, /You're Hermes here/)
  assert.match(prompt, /who is there$/)
  // the MCP server gets the chat's flags
  const env = reqs().find((m) => m.method === 'session/new').params.mcpServers[0].env.map((e) => e.name)
  assert.ok(env.includes('IV_STUDIO_AGENT_RUN') && env.includes('IV_STUDIO_AGENT_ASK'))
})

await ok("#31: Hermes's error.data.details shows with its message", () => {
  assert.equal(acpErrorText({ code: -32603, message: 'Internal error', data: { details: 'PermissionError: [WinError 5] Access is denied' } }), 'Internal error: PermissionError: [WinError 5] Access is denied')
  assert.equal(acpErrorText({ message: 'Internal error', data: 'boom' }), 'Internal error: boom')
  assert.equal(acpErrorText({ message: 'Invalid params', data: { field: 'cwd' } }), 'Invalid params: {"field":"cwd"}')
  // the shapes the real hermes-acp sends (probed 2026-11-12)
  assert.equal(acpErrorText({ code: -32603, message: 'Internal error', data: { details: 'not_found' } }), 'Internal error: not_found')
  assert.equal(acpErrorText({ code: -32602, message: 'Invalid params', data: { errors: [{ type: 'missing', loc: ['cwd'], msg: 'Field required', input: {} }] } }), 'Invalid params: cwd: Field required')
  assert.equal(acpErrorText({ message: 'Internal error' }), 'Internal error')
  assert.equal(acpErrorText({}), 'Hermes refused.')
  assert.ok(acpErrorText({ message: 'x', data: { details: 'y'.repeat(2000) } }).length < 820)
})

console.log(`${n - failed}/${n} passed`)
process.exit(failed ? 1 : 0)
