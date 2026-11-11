// The chat with the person's own agent (src/service/agentchat.js): what asks first, the launch arguments for the first
// message and for continuing (both agents, Mac and Linux too), session ids from both streams, a turn with the
// stand-in agent (reply, continuing, Allow, Don't allow, a render, Stop), saving chats, and the ask/answer round trip
// inside the built MCP server (out/main/mcp.js; run `npx electron-vite build` first).
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { chatAsk, claudeArgs, codexChatArgs, parseLine } from '../src/service/agentrun.js'
import { applyChatEvent, attachmentOf, contextLine, listChats, loadChat, newChat, pruneChats, saveChat, startChatTurn, withAttachments } from '../src/service/agentchat.js'

let failed = 0
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && extra ? ` -> ${extra}` : ''}`)
  if (!ok) failed++
}
const here = path.dirname(fileURLToPath(import.meta.url))

// what waits for the person
check('ask: deleting', /can’t be undone/.test(chatAsk('delete_project', { projectId: 'x' }) || ''))
check('ask: Seedance', /costs money/.test(chatAsk('generate_previews', { engine: 'seedance' }) || ''))
check('ask: a price', /about \$40\.00/.test(chatAsk('run_effect', { confirm_cost: 40 }) || ''))
check('ask: installing', /installs/.test(chatAsk('install_node_packs', {}) || '') && !!chatAsk('download_lora', {}) && !!chatAsk('update_comfy', {}))
check('ask: a setting', /setting/.test(chatAsk('set_workflow_model', {}) || ''))
check('ask: training', /training/.test(chatAsk('start_training', {}) || ''))
check('free: an H3 render on this PC', chatAsk('generate_previews', { engine: 'h3' }) === null)
check('free: reading and writing words', ['list_projects', 'get_job', 'check_setup', 'write_prompt', 'price_shot'].every((n) => chatAsk(n, {}) === null))
check('free: cancelling a render', chatAsk('cancel_job', { jobId: 'x' }) === null)
check('cloud: anything that starts work asks', /cloud/.test(chatAsk('generate_previews', { engine: 'h3' }, { settings: { target: 'cloud' } }) || ''))
check('cloud: reading still doesn’t', chatAsk('list_projects', {}, { settings: { target: 'cloud' } }) === null)

// launch arguments
const c1 = claudeArgs({ mcpConfigFile: 'm.json', promptFile: 'p.txt', persist: true })
check('claude chat: keeps its session', !c1.includes('--no-session-persistence') && !c1.includes('--resume'))
const c2 = claudeArgs({ mcpConfigFile: 'm.json', promptFile: 'p.txt', persist: true, resume: 'sess-1' })
check('claude chat: continues with --resume', c2[c2.indexOf('--resume') + 1] === 'sess-1')
check('claude chat: still only IV Studio’s tools', c2.includes('--strict-mcp-config') && c2[c2.indexOf('--tools') + 1] === '' && c2[c2.indexOf('--allowedTools') + 1] === 'mcp__iv-studio')
check('dashboard run: unchanged, keeps nothing', claudeArgs({ mcpConfigFile: 'm', promptFile: 'p' }).includes('--no-session-persistence'))
const mcp = { command: '/Applications/IV Studio.app/Contents/MacOS/IV Studio', args: ['/Applications/IV Studio.app/Contents/Resources/app.asar/out/main/mcp.js'], env: { ELECTRON_RUN_AS_NODE: '1' } }
const x1 = codexChatArgs({ mcp })
check('codex chat: first message is exec, kept (not ephemeral)', x1[0] === 'exec' && x1[1] === '--json' && !x1.includes('--ephemeral'))
check('codex chat: read-only sandbox as config, not --sandbox', x1.includes('sandbox_mode="read-only"') && !x1.includes('--sandbox') && !x1.includes('-C'))
check('codex chat: room to answer a card', x1.some((a) => a === 'mcp_servers.iv-studio.tool_timeout_sec=900'))
check('codex chat: a Mac path with spaces stays one value', x1.includes(`mcp_servers.iv-studio.command="/Applications/IV Studio.app/Contents/MacOS/IV Studio"`))
const x2 = codexChatArgs({ mcp, resume: 'thread-9' })
check('codex chat: continues with exec resume <thread> -', x2[0] === 'exec' && x2[1] === 'resume' && x2.at(-2) === 'thread-9' && x2.at(-1) === '-', x2.join(' '))

// session ids from the streams
check('session: Claude Code’s init line', parseLine('claude', JSON.stringify({ type: 'system', subtype: 'init', session_id: 's-1' }))[0]?.id === 's-1')
check('session: Codex’s thread.started', parseLine('codex', JSON.stringify({ type: 'thread.started', thread_id: 't-1' }))[0]?.id === 't-1')

// what IV Studio is showing
check('context: page and ids', contextLine({ page: 'shot', section: 'video', projectId: 'abc' }) === '[IV Studio is showing a shot (visual side); shot id abc]', contextLine({ page: 'shot', section: 'video', projectId: 'abc' }))
check('context: the editor', /the editor.*edit id e1/.test(contextLine({ page: 'edit', editId: 'e1' })))

// files attached to a message
check('attach: kinds by extension', ['a.PNG', 'b.mp4', 'c.wav', 'd.fountain', 'e.exe'].map((f) => attachmentOf(f).kind).join() === 'picture,video,sound,text,', ['a.PNG', 'b.mp4', 'c.wav', 'd.fountain', 'e.exe'].map((f) => attachmentOf(f).kind).join())
const texts = { 'C:/x/script.txt': 'INT. KITCHEN - DAY\nMAYA pours tea.', 'C:/x/long.md': 'w'.repeat(40000) }
const read = (f) => {
  if (!(f in texts)) throw new Error('no such file')
  return texts[f]
}
let msg = withAttachments('Make this', ['C:/x/still.png', 'C:/x/clip.mov', 'C:/x/script.txt', 'C:/x/app.exe'], read)
check('attach: the paths, with how to look at each', /picture: C:\/x\/still\.png \(look at it with grab_frame \(file, at 0\)\)/.test(msg) && /video: C:\/x\/clip\.mov/.test(msg))
check('attach: a script’s words go in, between markers', /text file script\.txt[\s\S]*<<<\nINT\. KITCHEN - DAY\nMAYA pours tea\.\n>>>/.test(msg))
check('attach: what the agent can’t use is left out', !/app\.exe/.test(msg))
check('attach: the person’s words come after', msg.endsWith('\n\nMake this'))
msg = withAttachments('x', ['C:/x/long.md'], read)
check('attach: long text is cut, and says so', msg.includes('(the first 30000 characters)') && msg.length < 30500)
check('attach: an unreadable file says so', /couldn't be read \(no such file\)/.test(withAttachments('x', ['C:/x/missing.txt'], read)))
check('attach: no usable files, no change', withAttachments('hello', ['C:/x/a.exe']) === 'hello')
check('attach: at most 10', (withAttachments('x', Array.from({ length: 14 }, (_, i) => `C:/x/p${i}.png`)).match(/picture:/g) || []).length === 10)

// turns with the stand-in agent
const stub = path.join(here, 'fixtures', process.platform === 'win32' ? 'chat-stub.cmd' : 'chat-stub.mjs')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ivs-chat-'))
const chat = newChat({ id: 'c1', engine: 'claude' })
const dir = path.join(root, chat.id)
const turn = async (message, { answerWith, stopAfterMs, context } = {}) => {
  const events = []
  const t = startChatTurn({ engine: 'claude', exe: stub, dir, session: chat.session, message, context, mcp: { command: 'node', args: ['x'], env: {} }, pollMs: 100, onEvent: (e) => {
    events.push(e)
    applyChatEvent(chat, e)
    if (e.type === 'ask' && answerWith !== undefined) setTimeout(() => t.answer(e.ask.id, answerWith), 200)
  } })
  chat.entries.push({ kind: 'you', text: message })
  if (stopAfterMs) setTimeout(() => t.stop(), stopAfterMs)
  const r = await t.promise
  return { r, events, t }
}
let { r } = await turn('hello there', { context: { page: 'shot', projectId: 'abc' } })
const firstSession = r.session
check('turn: replies', r.ok && /You said: hello there/.test(chat.entries.findLast((e) => e.kind === 'agent')?.text || ''), JSON.stringify(chat.entries))
check('turn: the agent saw what IV Studio shows', /shot id abc/.test(chat.entries.findLast((e) => e.kind === 'agent').text))
check('turn: a new session to continue', /^stub-session-/.test(firstSession || '') && chat.session === firstSession)
check('turn: the reply isn’t shown twice', chat.entries.filter((e) => e.kind === 'agent').length === 1)
;({ r } = await turn('and again'))
check('turn: the second message continues the same session', new RegExp(`continuing ${firstSession}`).test(chat.entries.findLast((e) => e.kind === 'agent').text))
;({ r } = await turn('delete that shot', { answerWith: true }))
let card = chat.entries.findLast((e) => e.kind === 'ask')
check('ask: a card with what and why', card?.label === 'Delete project' && /can’t be undone/.test(card.why) && card.args.projectId === 'p1', JSON.stringify(card))
check('ask: Allow lets it run', card?.answer === 'allow' && chat.entries.findLast((e) => e.kind === 'agent').text === 'Deleted it.')
;({ r } = await turn('delete it anyway', { answerWith: false }))
card = chat.entries.findLast((e) => e.kind === 'ask')
check('ask: Don’t allow tells the agent no', card?.answer === 'deny' && /left it/.test(chat.entries.findLast((e) => e.kind === 'agent').text))
check('ask: the refused step is marked', /Don't allow/.test(chat.entries.findLast((e) => e.kind === 'step' && e.tool === 'delete_project')?.error || ''))
;({ r } = await turn('render a fox'))
check('render: its job is known', r.jobs.join() === 'stub-job-1')
check('render: repeated get_job folds into one step', chat.entries.findLast((e) => e.kind === 'step')?.count === 3)
const t0 = Date.now()
;({ r } = await turn('slow please', { stopAfterMs: 1500 }))
check('stop: ends the turn quickly as Stopped', !r.ok && r.error === 'Stopped.' && Date.now() - t0 < 10000, JSON.stringify(r))
await new Promise((res) => setTimeout(res, 1500))
if (process.platform === 'win32') {
  const { execSync } = await import('node:child_process')
  const left = execSync('powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \\"name=\'node.exe\'\\" | Where-Object { $_.CommandLine -match \'chat-stub\' }).Count"').toString().trim()
  check('stop: the whole process tree is gone', left === '0' || left === '', `left: ${left}`)
}

// saving chats
saveChat(root, chat)
check('save: comes back the same', JSON.stringify(loadChat(root, 'c1')) === JSON.stringify(chat))
check('save: a bad id reads nothing', loadChat(root, '../x') === null)
for (let i = 0; i < 4; i++) saveChat(root, { ...newChat({ id: `old${i}`, engine: 'codex' }), updatedAt: `2026-01-0${i + 1}T00:00:00Z` })
check('list: newest first', listChats(root)[0].id === 'c1' && listChats(root).at(-1).id === 'old0')
pruneChats(root, 3)
check('prune: keeps the newest', listChats(root).map((c) => c.id).join() === 'c1,old3,old2')
fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 })

// the ask/answer round trip inside the real MCP server, in an isolated data folder
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'ivs-chatask-'))
const askDir = path.join(data, 'asks')
fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify({ comfyUrl: 'http://127.0.0.1:8199', ollamaUrl: 'http://127.0.0.1:9' }))
const transport = new StdioClientTransport({
  command: createRequire(import.meta.url)('electron'),
  args: [path.resolve(here, '..', 'out', 'main', 'mcp.js')],
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', IV_STUDIO_DATA: data, IV_STUDIO_AGENT_RUN: 'chat', IV_STUDIO_AGENT_ASK: askDir, IV_STUDIO_AGENT_ASK_MS: '4000' }
})
const client = new Client({ name: 'agent-chat', version: '1' })
await client.connect(transport)
const call = (name, args = {}) => client.callTool({ name, arguments: args })
const answerNext = (allow) =>
  new Promise((resolve) => {
    const iv = setInterval(() => {
      const f = fs.existsSync(askDir) && fs.readdirSync(askDir).find((n) => n.endsWith('.ask.json'))
      if (!f) return
      clearInterval(iv)
      const ask = JSON.parse(fs.readFileSync(path.join(askDir, f), 'utf8'))
      fs.writeFileSync(path.join(askDir, `${ask.id}.answer.json`), JSON.stringify({ allow }))
      resolve(ask)
    }, 100)
  })
let res = await call('list_projects')
check('server: reading goes ahead without a card', !res.isError && !(fs.existsSync(askDir) && fs.readdirSync(askDir).length), res.content?.[0]?.text)
let [ask, out] = await Promise.all([answerNext(false), call('delete_project', { projectId: 'nope' })])
check('server: a delete writes a card with the tool and why', ask.tool === 'delete_project' && /can’t be undone/.test(ask.why) && ask.args.projectId === 'nope')
check('server: Don’t allow comes back to the agent as a no', out.isError && /Don't allow/.test(out.content[0].text), out.content?.[0]?.text)
;[ask, out] = await Promise.all([answerNext(true), call('delete_project', { projectId: 'nope' })])
check('server: Allow runs the real tool', !/Don't allow|didn't answer/.test(out.content?.[0]?.text || ''), out.content?.[0]?.text)
check('server: the card files are cleaned up', fs.readdirSync(askDir).length === 0, fs.readdirSync(askDir).join())
out = await call('delete_project', { projectId: 'nope' })
check('server: no answer in time means it didn’t run', out.isError && /didn't answer/.test(out.content[0].text), out.content?.[0]?.text)
fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify({ comfyUrl: 'http://127.0.0.1:8199', ollamaUrl: 'http://127.0.0.1:9', target: 'cloud' }))
res = await call('list_projects')
check('server: on the cloud, reading still goes ahead', !res.isError, res.content?.[0]?.text)
;[ask, out] = await Promise.all([answerNext(false), call('generate_previews', { engine: 'h3', prompt: 'x', character: 'none' })])
check('server: on the cloud, a render asks first', /cloud/.test(ask.why) && out.isError)
const { tools } = await client.listTools()
check('server: get_job waits in a chat too', /waits up to 25 seconds/.test(tools.find((t) => t.name === 'get_job')?.description || ''))
// Show me where: list_places, then show_in_app writes a show file the app picks up (no Allow card: it only moves the view)
res = await call('list_places')
const places = JSON.parse(res.content[0].text).items || []
check('show: list_places names pages and their parts', places.length > 25 && places.every((p) => p.where && p.spot), `${places.length}`)
check('show: every page with a tour has places', new Set(places.map((p) => p.where)).size >= 20, `${new Set(places.map((p) => p.where)).size}`)
const place = places[0]
out = await call('show_in_app', { where: place.where, spot: place.spot, say: 'Click here.' })
const shows = fs.existsSync(askDir) ? fs.readdirSync(askDir).filter((n) => n.endsWith('.show.json')) : []
const shown = shows[0] && JSON.parse(fs.readFileSync(path.join(askDir, shows[0]), 'utf8'))
check('show: show_in_app runs without an Allow card', !out.isError && !fs.readdirSync(askDir).some((n) => n.endsWith('.ask.json')), out.content?.[0]?.text)
check('show: it writes where, the spot and the words', shows.length === 1 && shown.where === place.where && shown.spot === place.spot && shown.say === 'Click here.', JSON.stringify(shown))
out = await call('show_in_app', { where: place.where, spot: 'No such part' })
check('show: a spot that isn’t on the page is refused', out.isError && /list_places/.test(out.content[0].text), out.content?.[0]?.text)
await client.close()
fs.rmSync(data, { recursive: true, force: true, maxRetries: 3 })

console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
