// IV Studio 1.1.3's chat extras without an agent or a window: the activity log (activity.js), who took a step, the
// context meter's numbers (agentchat.js applyUsage), the fuller context line, and replies read aloud (spokenText).
//   node test/chat-extras.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ACTIVITY_FOLDER, aboutOf, keepUndo, looksOnly, markUndone, pruneActivity, readActivity, record, refsOf, whoOf } from '../src/service/activity.js'
import { applyUsage, contextLine, spokenText, undoEditChange } from '../src/service/agentchat.js'

let n = 0
let failed = 0
const ok = (name, fn) => {
  n++
  try {
    fn()
    console.log('ok', name)
  } catch (err) {
    failed++
    console.log('FAIL', name, '-', err.message)
  }
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-activity-'))

ok('looking things up is not logged; changes and failures are', () => {
  assert.ok(looksOnly('get_job') && looksOnly('list_renders') && looksOnly('check_setup') && looksOnly('write_prompt'))
  assert.ok(!looksOnly('generate_previews') && !looksOnly('edit_timeline') && !looksOnly('delete_project'))
  assert.equal(record(dir, { tool: 'get_job', args: { jobId: 'j1' }, who: { kind: 'chat' } }), null)
  assert.ok(record(dir, { tool: 'get_job', args: { jobId: 'j1' }, error: 'No job j1', who: { kind: 'chat' } }))
})

ok('who took the step, from how the server started and the client’s name', () => {
  assert.deepEqual(whoOf({ env: { IV_STUDIO_AGENT_RUN: 'chat', IV_STUDIO_AGENT_NAME: 'Claude Code in the chat', IV_STUDIO_CHAT_ID: 'c1' } }), { kind: 'chat', name: 'Claude Code in the chat', chatId: 'c1' })
  assert.equal(whoOf({ env: { IV_STUDIO_AGENT_RUN: '1' } }).kind, 'idea')
  assert.equal(whoOf({ env: {}, client: { name: 'claude-ai' } }).name, 'Claude Desktop')
  assert.equal(whoOf({ env: {}, client: { name: 'codex-mcp-client' } }).name, 'Codex')
  assert.equal(whoOf({ env: {}, client: { name: 'hermes-agent' } }).name, 'Hermes')
  assert.equal(whoOf({ env: {}, client: { name: 'my-bot' } }).name, 'my-bot')
  assert.equal(whoOf({ env: {} }).name, 'An agent')
})

ok('what a step was about, and what it touched', () => {
  assert.equal(aboutOf({ prompt: 'A fox   crossing\n a frozen lake' }), 'A fox crossing a frozen lake')
  assert.equal(aboutOf({ name: 'Trailer' }), 'Trailer')
  assert.ok(aboutOf({ prompt: 'x'.repeat(400) }).length <= 120)
  assert.deepEqual(refsOf({ editId: 'e1' }, { projectId: 'p1', id: 'j9', plan: {} }), { projectId: 'p1', jobId: 'j9', editId: 'e1' })
  assert.deepEqual(refsOf({ name: 'Cut' }, { id: 'e7', name: 'Cut' }, 'create_edit'), { editId: 'e7' })
})

ok('the log reads newest first, by who and by problems only', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-activity-'))
  record(d, { tool: 'generate_previews', args: { prompt: 'fox' }, value: { id: 'j1', projectId: 'p1', plan: {} }, who: { kind: 'chat', name: 'Claude Code in the chat' }, at: '2026-11-10T10:00:00.000Z' })
  record(d, { tool: 'edit_timeline', args: { editId: 'e1' }, who: { kind: 'outside', name: 'Claude Desktop' }, at: '2026-11-11T09:00:00.000Z' })
  record(d, { tool: 'make_music', args: { name: 'Song' }, error: 'ComfyUI is down', who: { kind: 'outside', name: 'Codex' }, at: '2026-11-11T09:30:00.000Z' })
  const now = Date.parse('2026-11-11T12:00:00.000Z')
  const all = readActivity(d, { now })
  assert.deepEqual(all.map((e) => e.tool), ['make_music', 'edit_timeline', 'generate_previews'])
  assert.equal(all[2].label, 'Started the previews')
  assert.equal(all[2].refs.projectId, 'p1')
  assert.deepEqual(readActivity(d, { now, who: 'outside' }).map((e) => e.tool), ['make_music', 'edit_timeline'])
  assert.deepEqual(readActivity(d, { now, problems: true }).map((e) => e.error), ['ComfyUI is down'])
  // a month later the day files go
  assert.equal(pruneActivity(d, { now: Date.parse('2026-12-30T00:00:00.000Z') }), 2)
  assert.equal(readActivity(d, { now: Date.parse('2026-12-30T00:00:00.000Z'), days: 60 }).length, 0)
})

ok('any agent’s change to an edit can be undone from the log', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-activity-'))
  const undo = keepUndo(d, { editId: 'e1', name: 'Cut', fields: { clips: [{ id: 'c1' }] } })
  const at = new Date().toISOString()
  record(d, { tool: 'edit_timeline', args: { editId: 'e1' }, who: { kind: 'outside', name: 'Codex' }, undo, at })
  let saved = null
  const r = undoEditChange(path.join(d, ACTIVITY_FOLDER), undo, (editId, fields) => (saved = { editId, fields }))
  assert.equal(r.name, 'Cut')
  assert.deepEqual(saved, { editId: 'e1', fields: { clips: [{ id: 'c1' }] } })
  markUndone(d, undo)
  assert.equal(readActivity(d)[0].undone, true)
})

ok('Claude Code’s context is exact; Codex’s is estimated from its turn', () => {
  const c = { engine: 'claude', entries: [] }
  applyUsage(c, { context: 7502 })
  applyUsage(c, { turn: { input: 100, cached: 90, output: 20, apiUsd: 0.5 }, window: 1000000, model: 'claude-opus-5-5' })
  assert.deepEqual([c.usage.context, c.usage.window, c.usage.approx, c.usage.input, c.usage.output, c.usage.turns, c.usage.apiUsd], [7502, 1000000, false, 100, 20, 1, 0.5])
  const x = { engine: 'codex', entries: [], turnCalls: 3 }
  applyUsage(x, { window: 475000, model: 'gpt-6.1-sol' })
  applyUsage(x, { turn: { input: 40000, cached: 20000, output: 300 } })
  assert.equal(x.usage.context, 10000)
  assert.equal(x.usage.approx, true)
  assert.equal(x.turnCalls, 0)
})

ok('the context line says what’s selected, rendering and the last failure', () => {
  const line = contextLine({ page: 'edit', editId: 'e1', selection: { playhead: '12.5 s', clip: 'fox.mp4 on V1, 3.0 to 8.0 s' }, renders: [{ state: 'running', name: 'Fox lake', percent: 40, ours: true }, { state: 'queued', kind: 'finish', ours: false }], problem: { jobId: 'j7', name: 'Night car', minutesAgo: 3, reason: 'Out of graphics memory' } })
  const lines = line.split('\n')
  assert.equal(lines.length, 4)
  assert.match(lines[0], /^\[IV Studio is showing .*edit id e1\]$/)
  assert.match(lines[1], /\[Selected: playhead: 12.5 s; clip: fox.mp4 on V1/)
  assert.match(lines[2], /Fox lake rendering 40%; finish \(not IV Studio’s\) waiting/)
  assert.match(lines[3], /Night car \(job j7\), 3 min ago: Out of graphics memory/)
  assert.equal(contextLine({ page: 'home', renders: [] }).split('\n')[1], '[Renders: nothing rendering or waiting]')
  assert.equal(contextLine({ page: 'home' }).split('\n').length, 1)
})

ok('a reply read aloud has no markdown, links or code, and stops at a sentence', () => {
  assert.equal(spokenText('## Done\n\nI made **two takes**. See [the shot](http://x). `code`'), 'Done I made two takes. See the shot. code')
  assert.equal(spokenText('```js\nlet x = 1\n```\nAll set.'), 'All set.')
  const long = spokenText(`${'This is a sentence. '.repeat(60)}`)
  assert.ok(long.length <= 600 && long.endsWith('.'))
})

fs.rmSync(dir, { recursive: true, force: true })
console.log(`${n - failed}/${n} passed`)
process.exit(failed ? 1 : 0)
