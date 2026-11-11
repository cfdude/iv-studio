// A stand-in for Claude Code in tests of the Dashboard's agent run (agentrun.js): it prints the stream-json lines a
// real run prints, writes a job id into the run's jobs file (as IV Studio's MCP server would) and finishes.
// AGENT_STUB_MODE: done (default), slow (waits for Stop), fail (exits 1 without a result).
import fs from 'node:fs'

const args = process.argv.slice(2)
const mode = process.env.AGENT_STUB_MODE || 'done'
const say = (o) => process.stdout.write(JSON.stringify(o) + '\n')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
let idea = ''
process.stdin.on('data', (d) => (idea += d))
await new Promise((r) => process.stdin.on('end', r))
const cfg = JSON.parse(fs.readFileSync(args[args.indexOf('--mcp-config') + 1], 'utf8')).mcpServers['iv-studio']
const tool = (id, name, input = {}) => say({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name: `mcp__iv-studio__${name}`, input }] } })
const result = (id, text, isError = false) => say({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text }], is_error: isError }] } })

say({ type: 'system', subtype: 'init', tools: [] })
await wait(300)
tool('t1', 'check_setup')
result('t1', '{"ready":true}')
await wait(300)
say({ type: 'assistant', message: { content: [{ type: 'text', text: `Making: ${idea.replace("The person's idea: ", '').trim()}` }] } })
tool('t2', 'delete_project', { projectId: 'x' })
result('t2', "delete_project isn't available in an agent run", true)
tool('t3', 'generate_previews', { engine: 'h3' })
fs.appendFileSync(cfg.env.IV_STUDIO_AGENT_JOBS, 'stub-job-1\n')
result('t3', '{"id":"stub-job-1","status":"queued","kind":"previews"}')
tool('t4', 'get_job', { jobId: 'stub-job-1' })
tool('t5', 'get_job', { jobId: 'stub-job-1' })
if (mode === 'slow') await wait(120000)
if (mode === 'fail') {
  process.stderr.write('stub: something went wrong\n')
  process.exit(1)
}
await wait(300)
say({ type: 'result', subtype: 'success', is_error: false, result: 'I made three takes of your idea. They are in Shots to pick from.' })
