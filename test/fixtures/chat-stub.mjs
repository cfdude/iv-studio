// A stand-in for Claude Code in a chat turn (src/service/agentchat.js tests and test copies): prints Claude Code's
// stream-json for one message.
//   message with "delete": asks like IV Studio's MCP server does (an ask file in the chat's ask folder, read from the
//                          --mcp-config file) and waits for the answer
//   "render":              "starts" a render (its id into the chat's jobs file) and watches it
//   "slow":                waits 60 s (for Stop)
//   anything else:         answers with what it was told, the context line and the session it continued
import fs from 'node:fs'
import path from 'node:path'

const argv = process.argv.slice(2)
const opt = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : null)
const resumed = opt('--resume')
const session = resumed || `stub-session-${Math.random().toString(36).slice(2, 8)}`
const mcp = JSON.parse(fs.readFileSync(opt('--mcp-config'), 'utf8')).mcpServers['iv-studio']
const askDir = mcp.env.IV_STUDIO_AGENT_ASK
const jobsFile = mcp.env.IV_STUDIO_AGENT_JOBS
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`)
const say = (text) => out({ type: 'assistant', message: { content: [{ type: 'text', text }] } })
const use = (id, name, input = {}) => out({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name: `mcp__iv-studio__${name}`, input }] } })
const result = (id, text, isError = false) => out({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: isError, content: [{ type: 'text', text }] }] } })

let input = ''
for await (const chunk of process.stdin) input += chunk
const lines = input.trim().split('\n')
const context = lines[0].startsWith('[') ? lines[0] : null
const message = lines.filter((l) => !l.startsWith('[')).join(' ').trim()

out({ type: 'system', subtype: 'init', session_id: session })
await wait(300)
let last
if (/delete/i.test(message)) {
  use('t1', 'list_projects')
  result('t1', '{"items":[]}')
  use('t2', 'delete_project', { projectId: 'p1' })
  const id = `ask-${Date.now().toString(36)}`
  const askFile = path.join(askDir, `${id}.ask.json`)
  const answerFile = path.join(askDir, `${id}.answer.json`)
  fs.writeFileSync(askFile, JSON.stringify({ id, tool: 'delete_project', why: 'This deletes something and can’t be undone.', args: { projectId: 'p1' } }))
  let answer = null
  for (let i = 0; i < 300 && !answer; i++) {
    try {
      answer = JSON.parse(fs.readFileSync(answerFile, 'utf8'))
    } catch {
      await wait(200)
    }
  }
  if (answer?.allow) {
    result('t2', '{"deleted":true}')
    last = 'Deleted it.'
  } else {
    result('t2', "The person chose Don't allow for delete_project, so it didn't run.", true)
    last = 'Okay, I left it as it is.'
  }
} else if (/render/i.test(message)) {
  use('t1', 'generate_previews', { engine: 'h3' })
  fs.appendFileSync(jobsFile, 'stub-job-1\n')
  result('t1', '{"id":"stub-job-1","status":"queued","kind":"previews"}')
  for (let i = 0; i < 3; i++) {
    use(`g${i}`, 'get_job', { jobId: 'stub-job-1' })
    result(`g${i}`, '{"status":"running"}')
    await wait(150)
  }
  last = 'It’s rendering three takes now; they’ll be in Shots.'
} else if (/tighten/i.test(message)) {
  // Edit by talking: like the MCP server, the edit as it was into an undo file, then the change (the last clip goes)
  const editId = /edit id ([a-z0-9-]+)|edit ([a-z0-9-]{6,})\)/i.exec(input)?.slice(1).find(Boolean)
  const file = path.join(mcp.env.IV_STUDIO_DATA, 'edits', `${editId}.json`)
  const e = JSON.parse(fs.readFileSync(file, 'utf8'))
  use('t1', 'edit_timeline', { editId, ops: [{ op: 'remove_clip', clip: e.clips.at(-1).id, ripple: true }] })
  const id = `${Date.now().toString(36)}-stub`
  fs.mkdirSync(askDir, { recursive: true })
  fs.writeFileSync(path.join(askDir, `${id}.undo.json`), JSON.stringify({ id, tool: 'edit_timeline', editId, name: e.name, fields: { name: e.name, settings: e.settings, media: e.media, clips: e.clips, tracks: e.tracks ?? null, markers: e.markers ?? null } }))
  fs.writeFileSync(file, JSON.stringify({ ...e, clips: e.clips.slice(0, -1), updatedAt: new Date().toISOString() }))
  result('t1', '{"results":[{"op":"remove_clip"}]}')
  await wait(500)
  last = 'Took the last clip out to tighten it.'
} else if (/save (this|it) as a recipe/i.test(message)) {
  use('t1', 'save_recipe', { name: 'Vertical teaser' })
  const file = path.join(mcp.env.IV_STUDIO_DATA, 'recipes.json')
  fs.writeFileSync(file, JSON.stringify({ recipes: [{ id: 'rstub1', name: 'Vertical teaser', instruction: 'A 15 second vertical teaser from my latest finished shot, fast speed.', note: '15 s · 9:16', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }] }))
  result('t1', '{"id":"rstub1"}')
  last = 'Saved it as a recipe on your Dashboard.'
} else if (/overnight/i.test(message)) {
  // start_batch: two finished, ranked shots (job files) and the batch, reporting back to this chat
  const data = mcp.env.IV_STUDIO_DATA
  fs.mkdirSync(path.join(data, 'jobs'), { recursive: true })
  fs.mkdirSync(path.join(data, 'batches'), { recursive: true })
  const take = (candidate, score, best = false) => ({ candidate, score, best, reasons: best ? ['every word heard'] : [] })
  const job = (id, takes) => ({ id, kind: 'previews', projectId: 'stubproj', name: id, status: 'success', where: 'local', createdAt: new Date().toISOString(), finishedAt: new Date().toISOString(), plan: { request: { prompt: 'x' } }, outputs: [], ranking: { at: new Date().toISOString(), takes, measured: [] } })
  fs.writeFileSync(path.join(data, 'jobs', 'stubjob1.json'), JSON.stringify(job('stubjob1', [take(1, 0.6), take(2, 0.92, true), take(3, 0.5)])))
  fs.writeFileSync(path.join(data, 'jobs', 'stubjob2.json'), JSON.stringify(job('stubjob2', [take(1, 0.7), take(2, 0.4), take(3, 0.3)])))
  use('t1', 'start_batch', { name: 'Fox at dawn' })
  fs.writeFileSync(path.join(data, 'batches', 'bstub1.json'), JSON.stringify({ id: 'bstub1', name: 'Fox at dawn', chatId: mcp.env.IV_STUDIO_CHAT_ID, projectId: 'stubproj', takes: 3, status: 'running', createdAt: new Date().toISOString(), jobs: [{ jobId: 'stubjob1', prompt: 'A fox in snow', label: 'Snow' }, { jobId: 'stubjob2', prompt: 'A fox in fog', label: 'Fog' }] }))
  result('t1', '{"batch":"bstub1","queued":2}')
  last = 'Queued 2 variations; the report will be here in the morning.'
} else if (/seedance/i.test(message)) {
  // a paid step under the spending limit: like the MCP server, ask the app's spend desk, then record it
  use('t1', 'generate_previews', { engine: 'seedance' })
  const desk = { url: mcp.env.IV_STUDIO_AGENT_APP, token: mcp.env.IV_STUDIO_AGENT_TOKEN }
  const post = async (route, body) => (await fetch(`${desk.url}${route}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-iv-token': desk.token }, body: JSON.stringify(body) })).json()
  const step = { tool: 'generate_previews', credits: 120, usd: 0.57 }
  const d = desk.url ? await post('/check', step) : { auto: false, why: 'no desk' }
  if (d.auto) {
    await post('/record', { ...step, auto: true })
    result('t1', '{"id":"stub-seedance","status":"queued"}')
    last = 'Started it on Seedance, under your limit.'
  } else {
    result('t1', `It would ask: ${d.why}`, true)
    last = `It asks: ${d.why}`
  }
} else if (/show me/i.test(message)) {
  // Show me where: like IV Studio's MCP server's show_in_app, a show file in the chat's ask folder
  const place = { where: 'music', spot: 'Make it', say: 'Press Make it when your style and lyrics are ready.' }
  use('t1', 'show_in_app', place)
  fs.mkdirSync(askDir, { recursive: true })
  fs.writeFileSync(path.join(askDir, `${Date.now().toString(36)}-stub.show.json`), JSON.stringify(place))
  result('t1', '{"shown":true,"page":"Music","spot":"Make it"}')
  await wait(800)
  last = 'It’s lit up on the Music page.'
} else if (/slow/i.test(message)) {
  say('Working on it…')
  await wait(60000)
  last = 'Done after a long time.'
} else {
  last = `You said: ${message}.${context ? ` I can see ${context}.` : ''}${resumed ? ` (continuing ${resumed})` : ' (a new chat)'}`
}
say(last)
out({ type: 'result', subtype: 'success', is_error: false, result: last, session_id: session })
