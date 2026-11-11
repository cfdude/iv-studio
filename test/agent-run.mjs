// The Dashboard's agent run (src/service/agentrun.js): the guard, the launch arguments, both stream parsers, a run
// with a stand-in agent (finish, failure, Stop), and the guard inside the built MCP server (out/main/mcp.js; run
// `npx electron-vite build` first).
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { AGENT_BLOCKED, agentGuard, applyEvent, claudeArgs, codexArgs, parseLine, startAgentRun, startedJobId, stepLabel } from '../src/service/agentrun.js'

let failed = 0
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && extra ? ` -> ${extra}` : ''}`)
  if (!ok) failed++
}
const here = path.dirname(fileURLToPath(import.meta.url))

// the guard
check('guard: a plain H3 render is allowed', agentGuard('generate_previews', { engine: 'h3', prompt: 'x' }) === null)
check('guard: reading is allowed', agentGuard('check_setup', {}) === null)
for (const name of ['delete_project', 'delete_sequence', 'install_node_packs', 'download_lora', 'start_training', 'set_workflow_model', 'cancel_music']) check(`guard: ${name} refused`, !!agentGuard(name, {}))
check('guard: every delete_ tool is in the list', ['delete_character', 'delete_edit', 'delete_image', 'delete_line', 'delete_music', 'delete_project', 'delete_rebuild', 'delete_sequence', 'delete_sizzle', 'delete_sound', 'delete_voice'].every((n) => AGENT_BLOCKED.has(n)))
check('guard: Seedance refused', /never spends|costs money/.test(agentGuard('generate_previews', { engine: 'seedance' }) || ''))
check('guard: a Seedance finish refused', !!agentGuard('finish_candidate', { jobId: 'a', way: 'seedance' }))
check('guard: any confirm_cost refused', !!agentGuard('price_shot', { confirm_cost: 0.5 }))
check('guard: confirm_cost 0 allowed', agentGuard('enhance_final', { confirm_cost: 0 }) === null)
check('guard: cloud rendering stops everything', /cloud/.test(agentGuard('check_setup', {}, { settings: { target: 'cloud' } }) || ''))
check('guard: cancel_job of someone else refused', !!agentGuard('cancel_job', { jobId: 'x' }, { started: new Set(['y']) }))
check('guard: cancel_job of its own job allowed', agentGuard('cancel_job', { jobId: 'y' }, { started: new Set(['y']) }) === null)

// which results started a job
check('started: a job record', startedJobId('generate_previews', { id: 'j1', status: 'queued', kind: 'previews' }) === 'j1')
check('started: get_job never counts', startedJobId('get_job', { id: 'j1', status: 'running', kind: 'previews' }) === null)
check('started: a list never counts', startedJobId('list_renders', { id: 'j1', status: 'x', kind: 'y' }) === null)
check('started: a plain object is not a job', startedJobId('check_setup', { ready: true }) === null)

// launch arguments
const ca = claudeArgs({ mcpConfigFile: 'C:\\t\\mcp.json', promptFile: 'C:\\t\\p.txt', model: 'claude-sonnet-5-5' })
const at = (a, flag) => a[a.indexOf(flag) + 1]
check('claude: stream-json with verbose', at(ca, '--output-format') === 'stream-json' && ca.includes('--verbose') && ca.includes('-p'))
check('claude: no built-in tools', at(ca, '--tools') === '')
check('claude: only IV Studio\'s server, pre-approved', ca.includes('--strict-mcp-config') && at(ca, '--allowedTools') === 'mcp__iv-studio' && at(ca, '--permission-mode') === 'dontAsk')
check('claude: model passed', at(ca, '--model') === 'claude-sonnet-5-5')
check('claude: no model, no flag', !claudeArgs({ mcpConfigFile: 'a', promptFile: 'b' }).includes('--model'))
const xa = codexArgs({ mcp: { command: 'C:\\Program Files\\IV Studio\\IV Studio.exe', args: ['C:\\x\\mcp.js'], env: { ELECTRON_RUN_AS_NODE: '1', IV_STUDIO_AGENT_RUN: '1' } }, dir: 'C:\\t' })
const cfg = xa.filter((_, i) => xa[i - 1] === '-c')
check('codex: exec --json, read-only, no user config', xa[0] === 'exec' && xa.includes('--json') && at(xa, '--sandbox') === 'read-only' && xa.includes('--ignore-user-config'))
check('codex: server command is a TOML string with escaped backslashes', cfg.includes('mcp_servers.iv-studio.command="C:\\\\Program Files\\\\IV Studio\\\\IV Studio.exe"'), cfg.join(' | '))
check('codex: server env is an inline table', cfg.includes('mcp_servers.iv-studio.env={ELECTRON_RUN_AS_NODE="1",IV_STUDIO_AGENT_RUN="1"}'))
check('codex: prompt from stdin', xa[xa.length - 1] === '-')

// stream parsing
const line = (o) => JSON.stringify(o)
let ev = parseLine('claude', line({ type: 'assistant', message: { content: [{ type: 'text', text: 'Checking.' }, { type: 'tool_use', id: 'a', name: 'mcp__iv-studio__check_setup' }] } }))
check('claude parse: words and a step', ev.length === 2 && ev[0].type === 'say' && ev[1].tool === 'check_setup' && ev[1].label === 'Checked your setup')
ev = parseLine('claude', line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'a', is_error: true, content: [{ type: 'text', text: 'refused' }] }] } }))
check('claude parse: a refused call', ev[0]?.type === 'stepError' && ev[0].text === 'refused')
ev = parseLine('claude', line({ type: 'result', subtype: 'success', is_error: false, result: 'Done.' }))
check('claude parse: the end', ev.find((e) => e.type === 'end')?.ok && ev.find((e) => e.type === 'end').text === 'Done.')
// usage and compaction (the chat's context meter, agentchat.js applyUsage)
ev = parseLine('claude', line({ type: 'assistant', message: { usage: { input_tokens: 2, cache_read_input_tokens: 7000, cache_creation_input_tokens: 500, output_tokens: 9 }, content: [] } }))
check('claude parse: the context now', ev.find((e) => e.type === 'usage')?.context === 7502)
ev = parseLine('claude', line({ type: 'result', subtype: 'success', is_error: false, result: 'ok', total_cost_usd: 0.5, usage: { input_tokens: 10, cache_read_input_tokens: 90, cache_creation_input_tokens: 0, output_tokens: 20 }, modelUsage: { 'claude-opus-5-5': { contextWindow: 1000000 } } }))
const u1 = ev.find((e) => e.type === 'usage')
check('claude parse: the turn and the window', u1?.turn?.input === 100 && u1.turn.cached === 90 && u1.turn.output === 20 && u1.window === 1000000 && u1.turn.apiUsd === 0.5)
ev = parseLine('claude', line({ type: 'system', subtype: 'compact_boundary', compact_metadata: { trigger: 'auto', pre_tokens: 820000 } }))
check('claude parse: compaction', ev[0]?.type === 'compact' && ev[0].before === 820000)
ev = parseLine('codex', line({ type: 'turn.completed', usage: { input_tokens: 33432, cached_input_tokens: 13696, output_tokens: 5, reasoning_output_tokens: 2 } }))
check('codex parse: the turn total, then the end', ev[0]?.type === 'usage' && ev[0].turn.input === 33432 && ev[0].turn.output === 7 && ev[1]?.type === 'end')
check('parse: junk ignored', parseLine('claude', 'not json').length === 0)
ev = parseLine('codex', line({ type: 'item.started', item: { id: 'i1', type: 'mcp_tool_call', server: 'iv-studio', tool: 'generate_previews', status: 'in_progress' } }))
check('codex parse: a step', ev[0]?.tool === 'generate_previews' && ev[0].label === 'Started the previews')
ev = parseLine('codex', line({ type: 'item.completed', item: { id: 'i2', type: 'agent_message', text: 'All set.' } }))
check('codex parse: its words', ev[0]?.type === 'say' && ev[0].text === 'All set.')
check('codex parse: turn.failed ends badly', parseLine('codex', line({ type: 'turn.failed', error: { message: 'x' } }))[0]?.ok === false)
check('label: unknown tools read as words', stepLabel('list_voices') === 'List voices')
const st = { steps: [], say: null, status: 'running' }
for (const e of [{ type: 'step', tool: 'get_job', label: 'x', id: '1' }, { type: 'step', tool: 'get_job', label: 'x', id: '2' }, { type: 'step', tool: 'check_prompt', label: 'y', id: '3' }]) applyEvent(st, e)
check('state: repeated get_job folds into one step', st.steps.length === 2 && st.steps[0].count === 2)

// a run with the stand-in agent
const stub = path.join(here, 'fixtures', 'agent-stub.cmd')
const mcp = { command: 'node', args: ['x'], env: { ELECTRON_RUN_AS_NODE: '1' } }
const runTo = (mode, { stopAfterMs = null } = {}) =>
  new Promise((resolve) => {
    process.env.AGENT_STUB_MODE = mode
    let last = null
    const run = startAgentRun({ engine: 'claude', exe: stub, idea: 'A fox crossing a frozen lake', mcp, onChange: (s) => {
      last = s
      if (s.endedAt) setTimeout(() => resolve({ last, run }), 50)
    } })
    if (stopAfterMs) setTimeout(() => run.stop(), stopAfterMs)
  })
let { last, run } = await runTo('done')
check('run: finishes done', last.status === 'done', JSON.stringify(last).slice(0, 300))
check('run: steps in order', last.steps.map((s) => s.tool).join(',') === 'check_setup,delete_project,generate_previews,get_job', last.steps.map((s) => s.tool).join(','))
check('run: the refused call is marked', !!last.steps.find((s) => s.tool === 'delete_project')?.error)
check('run: its jobs are known', run.jobs().join() === 'stub-job-1')
check('run: its last words kept', /three takes/.test(last.say || ''))
;({ last } = await runTo('fail'))
check('run: a crash ends failed with the reason', last.status === 'failed' && /something went wrong/.test(last.say || ''), JSON.stringify(last.say))
;({ last, run } = await runTo('slow', { stopAfterMs: 2500 }))
check('run: Stop ends it as stopped', last.status === 'stopped')
check('run: Stop still knows its jobs', run.jobs().join() === 'stub-job-1')
await new Promise((r) => setTimeout(r, 1500))
const { execSync } = await import('node:child_process')
const left = execSync('powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \\"name=\'node.exe\'\\" | Where-Object { $_.CommandLine -match \'agent-stub\' }).Count"').toString().trim()
check('run: Stop ends the whole process tree', left === '0' || left === '', `left: ${left}`)

// the guard inside the real MCP server, in an isolated data folder
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'ivs-agentguard-'))
fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify({ comfyUrl: 'http://127.0.0.1:8199', ollamaUrl: 'http://127.0.0.1:9' }))
const jobsFile = path.join(data, 'jobs.txt')
fs.writeFileSync(jobsFile, '')
const transport = new StdioClientTransport({
  command: createRequire(import.meta.url)('electron'),
  args: [path.resolve(here, '..', 'out', 'main', 'mcp.js')],
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', IV_STUDIO_DATA: data, IV_STUDIO_AGENT_RUN: '1', IV_STUDIO_AGENT_JOBS: jobsFile }
})
const client = new Client({ name: 'agent-guard', version: '1' })
await client.connect(transport)
const call = (name, args = {}) => client.callTool({ name, arguments: args })
const { tools } = await client.listTools()
check('server: get_job tells the agent it waits', /waits up to 25 seconds/.test(tools.find((t) => t.name === 'get_job')?.description || ''))
let r = await call('list_projects')
check('server: reading works in an agent run', !r.isError, r.content?.[0]?.text)
r = await call('delete_project', { projectId: 'nope' })
check('server: delete refused', r.isError && /isn't available in an agent run/.test(r.content[0].text), r.content?.[0]?.text)
r = await call('generate_previews', { engine: 'seedance', prompt: 'x', character: 'none' })
check('server: Seedance refused', r.isError && /never spends|costs money/.test(r.content[0].text), r.content?.[0]?.text)
r = await call('cancel_job', { jobId: 'someone-elses' })
check('server: cancelling another job refused', r.isError && /only cancel jobs it started/.test(r.content[0].text), r.content?.[0]?.text)
fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify({ comfyUrl: 'http://127.0.0.1:8199', ollamaUrl: 'http://127.0.0.1:9', target: 'cloud' }))
r = await call('list_projects')
check('server: everything stops when Settings renders on the cloud', r.isError && /cloud/.test(r.content[0].text), r.content?.[0]?.text)
await client.close()
fs.rmSync(data, { recursive: true, force: true })

console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
