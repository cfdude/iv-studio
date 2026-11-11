// Window channels for the agents: setting up Claude Code or Codex, a Dashboard idea run by the person's agent, the chat
// panel, the activity log, overnight batches and recipes (src/main/index.js, about lines 1117-1130 and 2290-2800). main
// starts Electron and cannot be imported, so buildDesk below is a COPY of main's glue for these channels: the same
// closures, the same handlers, with main's globals handed in (temp folders, the fake ComfyUI, `send` that writes the
// event down). Every copied handler and closure is pinned to main's source text (pinned()), so changing main fails the
// test that mirrors it. The agents are the stand-ins in test/fixtures (agent-stub.mjs, chat-stub.mjs, install-stub.mjs)
// run through tiny shell wrappers in a folder the guard allows; main's own test-copy switches (IV_STUDIO_TEST_AGENT,
// IV_STUDIO_TEST_CHAT, IV_STUDIO_TEST_INSTALL, IV_STUDIO_TEST_HOME, IV_STUDIO_TEST_BALANCE) point it at them.
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/fakes/guard.mjs --test test/unit/ipc-v113-agents.test.mjs
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import ffmpegStatic from 'ffmpeg-ffprobe-static'
import { ACTIVITY_FOLDER, keepUndo, markUndone, pruneActivity, readActivity, record } from '../../src/service/activity.js'
import { AGENT_INFO, openSignIn, runInstall, signedIn, signInCommands } from '../../src/service/agentinstall.js'
import { AGENT_NAMES, startAgentRun } from '../../src/service/agentrun.js'
import { applyChatEvent, applyUsage, spokenText as spoken, attachmentOf, listChats, loadChat, MAX_ATTACH, newChat, pruneChats, saveChat, startChatTurn, undoEditChange, withAttachments } from '../../src/service/agentchat.js'
import { Batches } from '../../src/service/batches.js'
import { makeDailies } from '../../src/service/dailies.js'
import { Edits } from '../../src/service/edits.js'
import { codexWindow, findHarnesses } from '../../src/service/harness.js'
import { readSettings, resourcesDir } from '../../src/service/paths.js'
import { listRecipes, removeRecipe, saveRecipe } from '../../src/service/recipes.js'
import { addSpend, budgetOf, readLedger, spentToday, startSpendDesk, todayLabel } from '../../src/service/spending.js'
import { Studio } from '../../src/service/studio.js'
import { Voices } from '../../src/service/voices.js'
import '../fakes/dirname.mjs' // paths.js's resourcesDir reads the CommonJS __dirname
import { startFakeComfy } from '../fakes/comfyui.mjs'
import { guardState, registerPort, registerShimDir, unregisterPort, unregisterShimDir } from '../fakes/ports.mjs'
import { withShims } from '../fakes/shims.mjs'
import { tempDirReal } from '../fakes/tmp.mjs'
import { assertCopiesMain, assertMainSends } from './main-source.mjs'

const tmp = () => tempDirReal('iv-agents-')
const root = path.resolve('.')
const until = async (done, ms = 6000) => {
  for (let t = 0; t < ms && !done(); t += 20) await new Promise((r) => setTimeout(r, 20))
  assert.ok(done(), 'timed out')
}

// Starts the stand-in program in test/fixtures as an executable: Mac has no .cmd, and the guard lets a script start only
// from a folder it was told about.
const binDir = tmp()
const wrap = (name, script) => {
  const file = path.join(binDir, name)
  fs.writeFileSync(file, `#!/bin/sh\nexec "${process.execPath}" "${path.join(root, 'test', 'fixtures', script)}" "$@"\n`)
  fs.chmodSync(file, 0o755)
  return file
}
const AGENT_EXE = () => wrap('agent-stub', 'agent-stub.mjs')
const CHAT_EXE = () => wrap('chat-stub', 'chat-stub.mjs')
const INSTALL_EXE = () => wrap('install-stub', 'install-stub.mjs')

// What one run of main's glue sends the window, and the handlers it registers.
function buildDesk({ BASE, DATA, studio, edits, voices, found = null, comfyKey = () => null, sent = [] }) {
  const TEST_COPY = true
  const handlers = {}
  const handle = (channel, fn) => (handlers[channel] = fn)
  const send = (channel, payload) => sent.push([channel, JSON.parse(JSON.stringify(payload ?? null))])
  // timers that don't hold the test process open (main's live as long as the app does)
  const setTimeout = (fn, ms, ...rest) => globalThis.setTimeout(fn, ms, ...rest).unref()
  const setInterval = (fn, ms, ...rest) => globalThis.setInterval(fn, ms, ...rest).unref()
  const app = { on: () => {}, getAppPath: () => root }
  const videosDir = () => path.join(DATA, 'Videos')
  const mcpCommand = () => ({ command: 'node', args: ['mcp.js'], env: { ELECTRON_RUN_AS_NODE: '1' } })
  const watchBatches = () => {}
  const getBalance = async () => ({ credits: 0 })
  let chatContext = null
  const setChatContext = (c) => (chatContext = c)
function agentHome() {
  const home = TEST_COPY && process.env.IV_STUDIO_TEST_HOME
  if (!home) return { home: os.homedir(), env: process.env, extra: {} }
  const extra = { USERPROFILE: home, HOME: home, LOCALAPPDATA: path.join(home, 'AppData', 'Local'), APPDATA: path.join(home, 'AppData', 'Roaming'), CODEX_HOME: path.join(home, '.codex'), CLAUDE_CONFIG_DIR: path.join(home, '.claude') }
  return { home, env: { ...process.env, ...extra, PATH: '' }, extra }
}
const realAgentsFound = () => {
  const { env, home } = agentHome()
  return findHarnesses(env, home)
}
  const agentsFound = () => (found ? found() : realAgentsFound())
  // Installing Claude Code or Codex for the person (agentinstall.js): the maker's own installer, one at a time, its
  // lines shown as it goes (agents:setupChanged); then a window to sign in. A test copy can stand in an installer
  // (IV_STUDIO_TEST_INSTALL, a .cmd taking the agent's name) and keeps "signed in" as a marker in its test home.
  let agentInstall = null // { engine, status: 'running' | 'done' | 'failed', lines, error, run }
  const installView = () => (agentInstall ? { engine: agentInstall.engine, status: agentInstall.status, lines: agentInstall.lines.slice(-6), error: agentInstall.error } : null)
  const testHome = () => TEST_COPY && !!process.env.IV_STUDIO_TEST_HOME
  const testSigned = (engine) => path.join(agentHome().home, `.iv-test-signed-in-${engine}`)
  const isSignedIn = (engine, exe) => (testHome() ? Promise.resolve(!!exe && fs.existsSync(testSigned(engine))) : signedIn(engine, exe, { env: agentHome().extra }))
  const agentSetup = async () => {
    const found = agentsFound()
    const one = async (engine) => ({ ...AGENT_INFO[engine], installed: !!found[engine], signedIn: found[engine] ? await isSignedIn(engine, found[engine]) : false })
    const [claude, codex] = await Promise.all([one('claude'), one('codex')])
    return { platform: process.platform, claude, codex, install: installView() }
  }
  const pushSetup = () => agentSetup().then((s) => send('agents:setupChanged', s), () => {})
  handle('agents:setup', () => agentSetup())
  handle('agents:install', (engine) => {
    if (!AGENT_INFO[engine]) throw new Error('IV Studio can install Claude Code or Codex.')
    if (agentInstall?.status === 'running') throw new Error(`${AGENT_INFO[agentInstall.engine].name} is still installing.`)
    const stand = TEST_COPY && process.env.IV_STUDIO_TEST_INSTALL
    const state = { engine, status: 'running', lines: [], error: null, run: null }
    agentInstall = state
    state.run = runInstall(engine, {
      env: agentHome().extra,
      override: stand ? { command: stand, args: [engine] } : null,
      onLine: (line) => {
        state.lines.push(line)
        if (state.lines.length > 50) state.lines.shift()
        if (agentInstall === state) send('agents:setupChanged', { install: installView() })
      }
    })
    pushSetup()
    state.run.promise.then((r) => {
      const there = !!agentsFound()[engine]
      state.status = r.ok && there ? 'done' : 'failed'
      state.error = r.ok && !there ? `The installer finished, but IV Studio can't find ${AGENT_INFO[engine].name} yet. Restart IV Studio, or install it from ${AGENT_INFO[engine].site}` : r.error
      if (agentInstall === state) pushSetup()
    })
    return true
  })
  handle('agents:stopInstall', () => {
    if (agentInstall?.status === 'running') agentInstall.run.stop()
    return true
  })
  handle('agents:signIn', (engine) => {
    if (!AGENT_INFO[engine]) throw new Error('IV Studio can sign in to Claude Code or Codex.')
    const exe = agentsFound()[engine]
    if (!exe) throw new Error(`${AGENT_INFO[engine].name} isn't installed yet.`)
    if (testHome()) fs.writeFileSync(testSigned(engine), 'test')
    else openSignIn(engine, exe, { env: agentHome().extra })
    return true
  })
  // The Dashboard's "Let Claude Code make it": the person's own agent makes their idea inside IV Studio (agentrun.js).
  // The writer chosen in Settings when it's Claude Code or Codex, else whichever is installed, Claude Code first. A test
  // copy can stand in a recorded agent (IV_STUDIO_TEST_AGENT, a .cmd or program printing an agent's stream).
  let agentRun = null
  let agentRenders = []
  let agentPoll = null
  const agentPick = () => {
    const found = TEST_COPY && process.env.IV_STUDIO_TEST_AGENT ? { claude: process.env.IV_STUDIO_TEST_AGENT, codex: null } : agentsFound()
    const s = readSettings(BASE)
    const pick = ['claude', 'codex'].includes(s.promptEngine) && found[s.promptEngine] ? s.promptEngine : found.claude ? 'claude' : found.codex ? 'codex' : null
    return { pick, exe: pick ? found[pick] : null, installed: { claude: !!found.claude, codex: !!found.codex } }
  }
  const agentView = () => (agentRun ? { ...agentRun.state(), renders: agentRenders } : null)
  const agentStatus = () => {
    const { pick, installed } = agentPick()
    return { pick, name: pick ? AGENT_NAMES[pick] : null, installed, cloud: readSettings(BASE).target === 'cloud', run: agentView() }
  }
  // the takes the run started, as the panel shows them: name, status and progress
  const refreshAgentRenders = async () => {
    if (!agentRun) return
    const out = []
    for (const id of agentRun.jobs()) {
      try {
        const j = await studio.refreshJob(id)
        out.push({ id, name: j.name, kind: j.kind, status: j.status, progress: j.progress ? Math.round((100 * j.progress.value) / Math.max(1, j.progress.max)) : null, projectId: j.projectId || null })
      } catch {
        out.push({ id, status: 'unknown' })
      }
    }
    agentRenders = out
    send('agentRun:changed', agentView())
    const running = agentRun.state().status === 'running' || out.some((r) => ['queued', 'running'].includes(r.status))
    if (!running) clearInterval(agentPoll), (agentPoll = null)
  }
  handle('agentRun:status', agentStatus)
  handle('agentRun:start', (idea) => {
    const text = String(idea || '').trim().slice(0, 2000)
    if (!text) throw new Error('Type what you want to make first.')
    if (agentRun && agentRun.state().status === 'running') throw new Error(`${agentRun.state().name} is still working on the last idea. Stop it first.`)
    if (chatTurn) throw new Error(`${chat.name} is answering in the chat. Wait for it, or stop it there.`)
    if (readSettings(BASE).target === 'cloud') throw new Error('IV Studio is set to render on the cloud. Your agent only renders on this computer (free): switch Cloud to This computer, or press Make it.')
    const { pick, exe } = agentPick()
    if (!pick) throw new Error('Neither Claude Code nor Codex is installed on this computer.')
    const mcp = mcpCommand()
    const extraEnv = {}
    for (const k of ['IV_STUDIO_DATA', 'IV_STUDIO_USER_DATA']) if (process.env[k]) extraEnv[k] = process.env[k]
    agentRenders = []
    const s = readSettings(BASE)
    agentRun = startAgentRun({
      engine: pick,
      exe,
      idea: text,
      mcp,
      model: pick === 'claude' ? s.claudeModel || '' : s.codexModel || '',
      extraEnv,
      onChange: (state) => {
        send('agentRun:changed', { ...state, renders: agentRenders })
        if (state.jobs.length && !agentPoll) agentPoll = setInterval(refreshAgentRenders, 3000)
        if (state.endedAt) refreshAgentRenders()
      }
    })
    return agentView()
  })
  handle('agentRun:stop', async () => {
    if (!agentRun) return null
    agentRun.stop()
    for (const id of agentRun.jobs()) await studio.cancelJob(id).catch(() => {})
    await refreshAgentRenders()
    return agentView()
  })
  // close the panel of a finished run
  handle('agentRun:dismiss', () => {
    if (agentRun && agentRun.state().status !== 'running') (agentRun = null), (agentRenders = [])
    send('agentRun:changed', agentView())
    return null
  })
  // The chat panel (agentchat.js): the person's own Claude Code or Codex with every IV Studio tool, asking first for
  // anything that deletes, costs money, installs or changes Settings. One open chat; one message at a time; chats
  // saved under the data folder's chats. A test copy can stand in an agent (IV_STUDIO_TEST_CHAT).
  const chatsRoot = path.join(DATA, 'chats')
  let chat = null
  let chatTurn = null
  let chatRenders = []
  let chatPoll = null
  const chatFound = () => (TEST_COPY && process.env.IV_STUDIO_TEST_CHAT ? { claude: process.env.IV_STUDIO_TEST_CHAT, codex: null } : agentsFound())
  const chatPreferred = (found) => {
    const s = readSettings(BASE)
    return ['claude', 'codex'].includes(s.promptEngine) && found[s.promptEngine] ? s.promptEngine : found.claude ? 'claude' : found.codex ? 'codex' : null
  }
  // The spending limit (spending.js): the chat's MCP server asks this desk before a paid step, and borrows the
  // Comfy.org key from it, with a token that only lives as long as one chat turn.
  let spendDesk = null
  const deskFor = () =>
    (spendDesk ||= startSpendDesk({
      dataDir: BASE,
      settings: () => readSettings(BASE),
      key: () => comfyKey() || null,
      // a test copy can stand in a balance (IV_STUDIO_TEST_BALANCE); it has no Comfy.org key of its own
      balance: async () => (TEST_COPY && process.env.IV_STUDIO_TEST_BALANCE ? Number(process.env.IV_STUDIO_TEST_BALANCE) : comfyKey() ? (await getBalance(comfyKey())).credits : null),
      onSpend: (turn, entry, { spent, budget }) => {
        const c = turn.chat
        if (!c) return
        c.entries.push({ kind: 'spent', credits: entry.credits, usd: entry.usd, auto: entry.auto, today: todayLabel(budget, spent) })
        if (chat === c) pushChat()
      }
    }))
  const spendToday = () => {
    const budget = budgetOf(readSettings(BASE))
    return { ...budget, spent: spentToday(readLedger(BASE)), label: todayLabel(budget, spentToday(readLedger(BASE))) }
  }
  const chatView = () => (chat ? { ...chat, busy: !!chatTurn, renders: chatRenders, spending: spendToday() } : null)
  const pushChat = () => send('chat:changed', chatView())
  const chatJobs = () => [...new Set([...(chat?.jobs || []), ...(chatTurn?.jobs() || [])])].slice(-4)
  const refreshChatRenders = async () => {
    const out = []
    for (const id of chatJobs()) {
      try {
        const j = await studio.refreshJob(id)
        out.push({ id, name: j.name, kind: j.kind, status: j.status, progress: j.progress ? Math.round((100 * j.progress.value) / Math.max(1, j.progress.max)) : null, projectId: j.projectId || null })
      } catch {
        out.push({ id, status: 'unknown' })
      }
    }
    chatRenders = out
    pushChat()
    if (!chatTurn && !out.some((r) => ['queued', 'running'].includes(r.status))) clearInterval(chatPoll), (chatPoll = null)
  }
  const watchChatRenders = () => {
    if (!chatPoll) chatPoll = setInterval(refreshChatRenders, 3000)
  }
  const chatId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const chatEngine = (engine) => {
    const found = chatFound()
    const e = engine || chatPreferred(found)
    if (!e || !AGENT_NAMES[e]) throw new Error('Install Claude Code or Codex first: the chat uses your own.')
    if (!found[e]) throw new Error(`${AGENT_NAMES[e]} isn't installed on this computer.`)
    return e
  }
  handle('chat:status', () => {
    const found = chatFound()
    return { installed: { claude: !!found.claude, codex: !!found.codex }, preferred: chatPreferred(found), chat: chatView(), chats: listChats(chatsRoot).slice(0, 10) }
  })
  handle('chat:new', (engine) => {
    if (chatTurn) throw new Error(`${chat.name} is still answering. Stop it first.`)
    chat = newChat({ id: chatId(), engine: chatEngine(engine) })
    chatRenders = []
    pushChat()
    return chatView()
  })
  handle('chat:open', (id) => {
    if (chatTurn) throw new Error(`${chat.name} is still answering. Stop it first.`)
    const c = loadChat(chatsRoot, String(id || ''))
    if (!c) throw new Error('That chat is gone.')
    chat = c
    chatRenders = []
    pushChat()
    refreshChatRenders()
    return chatView()
  })
  handle('chat:send', async ({ text, context, engine, files = [] } = {}) => {
    const attached = (Array.isArray(files) ? files : []).filter((p) => typeof p === 'string' && fs.existsSync(p)).map(attachmentOf).filter((a) => a.kind).slice(0, MAX_ATTACH)
    const message = String(text || '').trim().slice(0, 8000) || (attached.length ? 'Here are some files.' : '')
    if (!message) throw new Error('Type a message first.')
    // the spend desk's address, before anything else (the only wait here)
    let deskUrl = null
    try {
      deskUrl = await deskFor().url
    } catch {
      /* no desk: paid steps still ask, with the price, as before */
    }
    if (chatTurn) throw new Error(`${chat.name} is still answering. Stop it first, or wait.`)
    if (agentRun && agentRun.state().status === 'running') throw new Error(`${agentRun.state().name} is making the Dashboard idea. Wait for it, or stop it there.`)
    if (!chat) chat = newChat({ id: chatId(), engine: chatEngine(engine) })
    const exe = chatFound()[chat.engine]
    if (!exe) throw new Error(`${chat.name} isn't installed on this computer.`)
    const current = chat
    // Codex doesn't report its window: its models cache does (harness.js codexWindow)
    if (current.engine === 'codex') {
      const cw = codexWindow(readSettings(BASE).codexModel || '')
      if (cw) applyUsage(current, { window: cw.window, model: cw.model })
    }
    current.turnCalls = 0
    current.entries.push({ kind: 'you', text: message, at: new Date().toISOString(), ...(attached.length ? { files: attached.map((a) => ({ name: a.name, kind: a.kind, path: a.path })) } : {}) })
    if (!current.title) current.title = message.slice(0, 80)
    saveChat(chatsRoot, current)
    const s = readSettings(BASE)
    const extraEnv = {}
    for (const k of ['IV_STUDIO_DATA', 'IV_STUDIO_USER_DATA']) if (process.env[k]) extraEnv[k] = process.env[k]
    // this turn's own pass to the spend desk; dropped when the turn ends
    const deskToken = deskUrl ? spendDesk.issue({ chat: current }) : null
    if (deskToken) Object.assign(extraEnv, { IV_STUDIO_AGENT_APP: deskUrl, IV_STUDIO_AGENT_TOKEN: deskToken })
    // an overnight batch started in this turn reports back to this chat
    extraEnv.IV_STUDIO_CHAT_ID = current.id
    // who the activity log says took each step (activity.js)
    extraEnv.IV_STUDIO_AGENT_NAME = `${AGENT_NAMES[current.engine]} in the chat`
    setTimeout(watchBatches, 5000)
    // what the agent should know without asking: the page and what's picked on it (the window's), plus what's
    // rendering or waiting and the newest failure (here)
    const fullContext = context && typeof context === 'object' ? { ...context } : chatContext ? { ...chatContext } : {}
    try {
      const q = await Promise.race([studio.renderQueue(), new Promise((_, no) => setTimeout(() => no(new Error('slow')), 3000))])
      fullContext.renders = (q.items || []).slice(0, 6).map((i) => ({ state: i.state, name: i.name, kind: i.kind, ours: i.ours, percent: i.progress?.max ? Math.round((100 * i.progress.value) / i.progress.max) : null }))
    } catch {
      /* ComfyUI busy or down: the agent can still ask */
    }
    try {
      fullContext.problem = studio.recentProblem()
    } catch {}
    const turn = startChatTurn({
      engine: current.engine,
      exe,
      dir: path.join(chatsRoot, current.id),
      session: current.session,
      message: withAttachments(message, attached),
      context: fullContext,
      mcp: mcpCommand(),
      model: current.engine === 'claude' ? s.claudeModel || '' : s.codexModel || '',
      extraEnv,
      onEvent: (e) => {
        // show_in_app: the window goes there and lights it up (App.jsx)
        if (e.type === 'show') send('chat:show', e.show)
        applyChatEvent(current, e)
        if (chat === current) pushChat()
        if (turn && turn.jobs().length) watchChatRenders()
      }
    })
    chatTurn = turn
    pushChat()
    turn.promise.then((r) => {
      if (deskToken) spendDesk?.revoke(deskToken)
      current.jobs = [...new Set([...current.jobs, ...r.jobs])]
      if (r.session) current.session = r.session
      const last = current.entries[current.entries.length - 1]
      if (!r.ok && r.error && !(last?.kind === 'problem' && last.text === r.error)) current.entries.push({ kind: 'problem', text: r.error })
      current.updatedAt = new Date().toISOString()
      if (chatTurn === turn) chatTurn = null
      try {
        saveChat(chatsRoot, current)
        pruneChats(chatsRoot)
      } catch {
        /* a full drive shouldn't take the chat down */
      }
      if (current.jobs.length) watchChatRenders()
      refreshChatRenders()
    })
    return chatView()
  })
  handle('chat:spending', () => spendToday())
  // Overnight batches (batches.js): while any runs, the PC stays awake; each shot's takes are ranked as it finishes,
  // and when all are done the report goes into the chat that started it (and a notification, if the window is away)
  const batchStore = new Batches({ dir: path.join(DATA, 'batches') })
  let batchTimer = null
  let awake = null
  let batchBusy = false
  const jobOrNull = async (id) => {
    try {
      return await studio.refreshJob(id)
    } catch {
      try {
        return studio.getJob(id, { refresh: false })
      } catch {
        return null
      }
    }
  }
  const buildDailies = (b, jobs) => makeDailies({ batch: b, jobs, outDir: path.join(videosDir(), 'Dailies'), ffmpeg: edits.ffmpeg, font: path.join(resourcesDir(path.join(app.getAppPath(), 'resources')), 'fonts', 'BarlowCondensed-SemiBold.ttf'), localCopy: (o, dir) => studio.localCopy(o, dir), probe: (f) => edits.probe(f) })
  handle('batches:list', () => batchStore.list().slice(0, 20))
  // the dailies again (or for a batch from before they existed): the reel and the notes, then open the folder
  handle('batches:dailies', async (id) => {
    const b = batchStore.get(id)
    const jobs = {}
    for (const j of b.jobs) jobs[j.jobId] = await jobOrNull(j.jobId)
    const d = await buildDailies(b, jobs)
    batchStore.save({ ...batchStore.get(id), dailies: d })
    return d
  })
  // "Undo this change" on an edit the agent changed: the edit goes back as it was (an open edit reloads, and the
  // editor's own Ctrl+Z can still step back over it)
  handle('chat:undo', (undoId) => {
    if (!chat) throw new Error('No chat open.')
    const entry = chat.entries.find((x) => x.kind === 'undo' && x.id === undoId)
    if (!entry) throw new Error('No such change in this chat.')
    const r = undoEditChange(path.join(chatsRoot, chat.id), undoId, (editId, fields) => edits.save(editId, fields))
    entry.done = true
    saveChat(chatsRoot, chat)
    pushChat()
    return r
  })
  handle('chat:answer', ({ id, allow } = {}) => !!chatTurn?.answer(String(id || ''), !!allow))
  // ---------- talking to the chat (ChatPanel's mic): IV Studio's own Whisper, and its voices to read replies ----------
  // bytes: what the window recorded (webm/opus). The words come back; the window sends them as the message.
  handle('chat:hear', async (bytes) => {
    const st = voices.status()
    if (!st.installed) throw Object.assign(new Error('Talking to the chat needs IV Studio’s voices set up once: Audio → Voices → Set up voices (about 12 GB, free).'), { code: 'voices' })
    const buf = Buffer.from(bytes || [])
    if (buf.length < 2000) throw new Error('That was too short to hear. Hold the mic a little longer.')
    if (buf.length > 40 * 1024 * 1024) throw new Error('That recording is too long for one message.')
    const file = path.join(os.tmpdir(), `ivs-hear-${Date.now().toString(36)}.webm`)
    fs.writeFileSync(file, buf)
    try {
      const text = await voices.transcribe(file)
      return { text: text.replace(/\s+/g, ' ').trim() }
    } finally {
      fs.rmSync(file, { force: true })
    }
  })
  // A reply read aloud in one of the person's voices, not kept in Lines. Waits for no render: when ComfyUI is busy on
  // this PC the window is told, so the voice engine doesn't load next to a render on the same graphics card.
  handle('chat:say', async ({ text, voiceId } = {}) => {
    const st = voices.status()
    if (!st.installed) throw Object.assign(new Error('Reading replies aloud needs IV Studio’s voices set up once: Audio → Voices → Set up voices.'), { code: 'voices' })
    const local = readSettings(BASE).target !== 'cloud'
    if (local) {
      const q = await studio.comfy.queue().catch(() => null)
      if (q && (q.queue_running.length || q.queue_pending.length)) return { skipped: 'A render is using the graphics card, so this reply isn’t read aloud.' }
    }
    const list = voices.list()
    const v = list.find((x) => x.id === voiceId) || list[0]
    if (!v) throw new Error('Make or add a voice first (Audio → Voices), then pick it for reading replies.')
    return voices.speak({ voiceId: v.id, text: spoken(text), keep: false })
  })
  // ---------- the agents' activity log (activity.js): written by the MCP server, read here ----------
  try {
    pruneActivity(DATA)
  } catch {}
  handle('activity:list', (opts = {}) => readActivity(DATA, { days: Math.min(30, Number(opts.days) || 7), who: opts.who || null, problems: !!opts.problems, limit: 400 }))
  handle('activity:undo', (undoId) => {
    const r = undoEditChange(path.join(DATA, ACTIVITY_FOLDER), String(undoId || ''), (editId, fields) => edits.save(editId, fields))
    markUndone(DATA, String(undoId))
    send('activity:changed', { at: Date.now() })
    return r
  })
  let activityWatch = null
  let activityTick = null
  const watchActivity = () => {
    try {
      fs.mkdirSync(path.join(DATA, ACTIVITY_FOLDER), { recursive: true })
      activityWatch = fs.watch(path.join(DATA, ACTIVITY_FOLDER), () => {
        clearTimeout(activityTick)
        activityTick = setTimeout(() => send('activity:changed', { at: Date.now() }), 300)
      })
    } catch {
      /* no live updates: the tab still reads the log when opened */
    }
  }
  watchActivity()
  app.on('will-quit', () => activityWatch?.close())
  // keepRenders: the person talked over the agent (ChatPanel's mic): stop its turn so the new words go in, but leave the
  // renders it already started running; the agent can still cancel them if that's what they asked.
  handle('chat:stop', async ({ keepRenders = false } = {}) => {
    if (!chatTurn) return chatView()
    const turn = chatTurn
    const jobs = turn.jobs()
    turn.stop()
    if (!keepRenders) for (const id of jobs) await studio.cancelJob(id).catch(() => {})
    // wait (briefly) for the turn to end, so a message sent next isn't refused as "still answering"
    await Promise.race([turn.promise.catch(() => {}), new Promise((r) => setTimeout(r, 8000))])
    return chatView()
  })
  return {
    handlers,
    sent,
    setChatContext,
    parts: { agentHome, installView, testHome, testSigned, isSignedIn, agentSetup, pushSetup, agentPick, agentView, agentStatus, refreshAgentRenders, chatFound, chatPreferred, deskFor, spendToday, chatView, pushChat, chatJobs, refreshChatRenders, watchChatRenders, chatEngine, jobOrNull, buildDailies, watchActivity },
    close: () => (spendDesk?.close(), activityWatch?.close(), clearInterval(chatPoll), clearInterval(agentPoll))
  }
}

// ---------- the world each group of tests runs in ----------
const ENV = ['IV_STUDIO_TEST_HOME', 'IV_STUDIO_TEST_INSTALL', 'IV_STUDIO_TEST_AGENT', 'IV_STUDIO_TEST_CHAT', 'IV_STUDIO_DATA', 'IV_STUDIO_TEST_BALANCE', 'AGENT_STUB_MODE', 'INSTALL_STUB_MODE']
const savedEnv = Object.fromEntries(ENV.map((k) => [k, process.env[k]]))
const settings = (dir, s) => fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(s))
const pinned = (...fns) => {
  for (const fn of fns) assertMainSends(assert, fn.toString())
}
const events = (desk, channel) => desk.sent.filter(([c]) => c === channel).map(([, p]) => p)
const ff = (...args) => execFileSync(ffmpegStatic.ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args])

describe('agents, the chat, the activity log, batches and recipes', { concurrency: true }, () => {
  let fake
  const desks = []
  before(async () => {
    fake = await startFakeComfy({ devices: 'mps', os: 'darwin' })
    registerShimDir(binDir)
    process.env.IV_STUDIO_TEST_CHAT = CHAT_EXE()
    process.env.IV_STUDIO_TEST_BALANCE = '5000'
  })
  after(async () => {
    for (const d of desks) d.close()
    unregisterShimDir(binDir)
    await fake.close()
    assert.deepEqual(guardState().refusals, [], 'nothing the guard refuses was started')
    assert.deepEqual(guardState().netRefusals, [], 'nothing outside this machine was called')
    for (const k of ENV) savedEnv[k] === undefined ? delete process.env[k] : (process.env[k] = savedEnv[k])
  })
  const world = (extra = {}) => {
    const dir = tmp()
    const studio = new Studio({ dataDir: dir, resourcesDir: path.resolve('resources'), comfyUrl: fake.url })
    const edits = new Edits({ dataDir: dir, ffmpeg: ffmpegStatic.ffmpegPath, ffprobe: ffmpegStatic.ffprobePath })
    const voices = new Voices({ dataDir: dir, resourcesDir: path.resolve('resources'), ffmpeg: ffmpegStatic.ffmpegPath, onLog: () => {} })
    const desk = (more = {}) => {
      const d = buildDesk({ BASE: dir, DATA: dir, studio, edits, voices, ...extra, ...more })
      desks.push(d)
      return d
    }
    return { dir, studio, edits, voices, desk }
  }

  describe('setting up Claude Code and Codex', { concurrency: 1 }, () => {
    let w
    before(() => (w = world()))
    const desk = (more) => w.desk(more)

    test('[ipc:agents:setup] says for each agent whether it is installed and signed in: neither at first, then the one a test home has, until its sign-in marker is there', async () => {
      const home = tmp()
      process.env.IV_STUDIO_TEST_HOME = home
      const none = desk({ found: () => ({ claude: null, codex: null }) })
      pinned(none.handlers['agents:setup'], none.parts.agentSetup, none.parts.isSignedIn, none.parts.testSigned, none.parts.testHome, none.parts.agentHome, none.parts.installView)
      assertMainSends(assert, 'const agentsFound = () => { const { env, home } = agentHome() return findHarnesses(env, home) }')
      let s = await none.handlers['agents:setup']()
      assert.equal(s.platform, process.platform)
      assert.deepEqual([s.claude.installed, s.claude.signedIn, s.codex.installed, s.codex.signedIn], [false, false, false, false])
      assert.equal(s.claude.name, 'Claude Code')
      assert.equal(s.codex.maker, 'OpenAI')
      assert.equal(s.install, null, 'nothing is installing')
      const one = desk({ found: () => ({ claude: AGENT_EXE(), codex: null }) })
      s = await one.handlers['agents:setup']()
      assert.deepEqual([s.claude.installed, s.claude.signedIn, s.codex.installed], [true, false, false], 'found, but not signed in yet')
      fs.writeFileSync(path.join(home, '.iv-test-signed-in-claude'), 'test')
      s = await one.handlers['agents:setup']()
      assert.equal(s.claude.signedIn, true)
      // outside a test home, "signed in" is the agent's own status command: the stand-in `claude` exits 0 for yes
      const shims = withShims()
      try {
        assert.equal(await signedIn('claude', path.join(shims.dir, 'claude')), true)
        assert.equal(await signedIn('claude', null), false, 'not installed is not signed in')
      } finally {
        shims.restore()
      }
    })

    test('[ipc:agents:install] [event:agents:setupChanged] runs the installer one at a time, tells the window each line as it prints, then that the agent is installed', async () => {
      const home = tmp()
      process.env.IV_STUDIO_TEST_HOME = home
      process.env.IV_STUDIO_TEST_INSTALL = INSTALL_EXE()
      delete process.env.INSTALL_STUB_MODE
      const d = desk()
      pinned(d.handlers['agents:install'], d.parts.pushSetup)
      assertMainSends(assert, "if (agentInstall === state) send('agents:setupChanged', { install: installView() })")
      assertMainSends(assert, "const pushSetup = () => agentSetup().then((s) => send('agents:setupChanged', s), () => {})")
      assert.throws(() => d.handlers['agents:install']('cursor'), /can install Claude Code or Codex/)
      assert.equal(d.handlers['agents:install']('claude'), true)
      assert.equal(d.parts.installView().status, 'running')
      await until(() => d.parts.installView()?.status === 'done')
      assert.ok(fs.existsSync(path.join(home, '.local', 'bin', 'claude')), 'the stand-in installer put the program in the test home')
      await until(() => events(d, 'agents:setupChanged').some((p) => p.claude?.installed === true && p.install?.status === 'done'))
      const lines = events(d, 'agents:setupChanged').filter((p) => p.install && !p.claude).flatMap((p) => p.install.lines)
      assert.ok(lines.includes('==> Installing Claude Code'), `heard ${JSON.stringify(lines)}`)
      assert.ok(lines.includes('Installation complete!'))
      const first = events(d, 'agents:setupChanged').find((p) => p.install?.status === 'running')
      assert.equal(first.install.engine, 'claude')
      const after = await d.handlers['agents:setup']()
      assert.deepEqual([after.install.engine, after.install.status, after.install.error], ['claude', 'done', null])
    })

    test('[ipc:agents:stopInstall] ends an installer that is running and says it was stopped, refuses a second install meanwhile, and does nothing when none runs', async () => {
      const home = tmp()
      process.env.IV_STUDIO_TEST_HOME = home
      process.env.IV_STUDIO_TEST_INSTALL = INSTALL_EXE()
      process.env.INSTALL_STUB_MODE = 'slow'
      try {
        const d = desk()
        pinned(d.handlers['agents:stopInstall'])
        assert.equal(d.handlers['agents:stopInstall'](), true, 'nothing to stop is fine')
        assert.equal(d.handlers['agents:install']('codex'), true)
        await until(() => d.parts.installView().lines.length > 0)
        assert.throws(() => d.handlers['agents:install']('claude'), /Codex is still installing\./)
        const t0 = Date.now()
        assert.equal(d.handlers['agents:stopInstall'](), true)
        await until(() => d.parts.installView().status === 'failed')
        assert.equal(d.parts.installView().error, 'Stopped.')
        assert.ok(Date.now() - t0 < 5000, 'it did not wait out the installer')
        assert.ok(!fs.existsSync(path.join(home, '.local', 'bin', 'codex')))
      } finally {
        delete process.env.INSTALL_STUB_MODE
      }
    })

    test('[ipc:agents:signIn] refuses an unknown agent or one that is not installed, and for an installed one in a test home records the sign-in (the real window is Terminal running the agent\'s login)', async () => {
      const home = tmp()
      process.env.IV_STUDIO_TEST_HOME = home
      const d = desk({ found: () => ({ claude: AGENT_EXE(), codex: null }) })
      pinned(d.handlers['agents:signIn'])
      assert.throws(() => d.handlers['agents:signIn']('cursor'), /can sign in to Claude Code or Codex/)
      assert.throws(() => d.handlers['agents:signIn']('codex'), /Codex isn't installed yet\./)
      assert.equal(d.handlers['agents:signIn']('claude'), true)
      assert.ok(fs.existsSync(path.join(home, '.iv-test-signed-in-claude')))
      assert.equal((await d.handlers['agents:setup']()).claude.signedIn, true)
      // what a real sign-in opens on this Mac (openSignIn would start it): Terminal running the agent's own login
      const [mac] = signInCommands('claude', '/Users/pat/.local/bin/claude', 'darwin')
      assert.equal(mac.command, 'osascript')
      assert.ok(mac.args[1].includes(`do script "'/Users/pat/.local/bin/claude' auth login"`), mac.args[1])
    })
  })

  describe('a Dashboard idea run by the person\'s agent', { concurrency: 1 }, () => {
    let w
    before(() => {
      w = world()
      process.env.IV_STUDIO_TEST_AGENT = AGENT_EXE()
    })
    const writeJob = () => {
      fs.mkdirSync(path.join(w.dir, 'jobs'), { recursive: true })
      fs.writeFileSync(path.join(w.dir, 'jobs', 'stub-job-1.json'), JSON.stringify({ id: 'stub-job-1', kind: 'previews', name: 'Fox lake', status: 'success', projectId: 'p1', outputs: [] }))
    }
    const state = (d) => d.handlers['agentRun:status']().run
    const till = (d, status) => until(() => state(d)?.status === status && state(d).endedAt)

    test('[ipc:agentRun:status] names the agent that would run, what is installed, whether Settings renders on the cloud, and the run when there is one', async () => {
      const d = w.desk()
      pinned(d.handlers['agentRun:status'], d.parts.agentPick, d.parts.agentView)
      assert.deepEqual(d.handlers['agentRun:status'](), { pick: 'claude', name: 'Claude Code', installed: { claude: true, codex: false }, cloud: false, run: null })
      settings(w.dir, { target: 'cloud' })
      assert.equal(d.handlers['agentRun:status']().cloud, true)
      settings(w.dir, { promptEngine: 'codex' })
      assert.equal(d.handlers['agentRun:status']().pick, 'claude', 'Codex is the writer but is not installed: Claude Code runs it')
      const was = process.env.IV_STUDIO_TEST_AGENT
      delete process.env.IV_STUDIO_TEST_AGENT
      try {
        const none = w.desk({ found: () => ({ claude: null, codex: null }) })
        assert.deepEqual(none.handlers['agentRun:status'](), { pick: null, name: null, installed: { claude: false, codex: false }, cloud: false, run: null })
      } finally {
        process.env.IV_STUDIO_TEST_AGENT = was
      }
      settings(w.dir, {})
    })

    test('[ipc:agentRun:start] [event:agentRun:changed] refuses an empty idea, the cloud and a busy run, then runs the agent and tells the window each step, its takes and how it ended', async () => {
      writeJob()
      const d = w.desk()
      pinned(d.handlers['agentRun:start'], d.parts.refreshAgentRenders)
      assertMainSends(assert, "send('agentRun:changed', { ...state, renders: agentRenders })")
      assertMainSends(assert, "send('agentRun:changed', agentView())")
      assert.throws(() => d.handlers['agentRun:start']('   '), /Type what you want to make first\./)
      settings(w.dir, { target: 'cloud' })
      assert.throws(() => d.handlers['agentRun:start']('A fox'), /set to render on the cloud/)
      settings(w.dir, {})
      const none = w.desk({ found: () => ({ claude: null, codex: null }) })
      const was = process.env.IV_STUDIO_TEST_AGENT
      delete process.env.IV_STUDIO_TEST_AGENT
      try {
        assert.throws(() => none.handlers['agentRun:start']('A fox'), /Neither Claude Code nor Codex is installed/)
      } finally {
        process.env.IV_STUDIO_TEST_AGENT = was
      }
      process.env.AGENT_STUB_MODE = 'done'
      const view = d.handlers['agentRun:start']('A fox crossing a frozen lake')
      assert.equal(view.status, 'running')
      assert.equal(view.idea, 'A fox crossing a frozen lake')
      assert.throws(() => d.handlers['agentRun:start']('Another'), /Claude Code is still working on the last idea\. Stop it first\./)
      await assert.rejects(() => d.handlers['chat:send']({ text: 'hello' }), /making the Dashboard idea/, 'the chat waits for the idea')
      await till(d, 'done')
      await until(() => events(d, 'agentRun:changed').at(-1)?.renders?.length === 1)
      const last = events(d, 'agentRun:changed').at(-1)
      assert.deepEqual(last.steps.map((s) => s.tool), ['check_setup', 'delete_project', 'generate_previews', 'get_job'])
      assert.match(last.steps[1].error, /isn't available in an agent run/, 'the refused step is marked')
      assert.equal(last.steps[3].count, 2, 'repeated get_job folds into one step')
      assert.match(last.say, /three takes/)
      assert.deepEqual(last.jobs, ['stub-job-1'])
      assert.deepEqual(last.renders, [{ id: 'stub-job-1', name: 'Fox lake', kind: 'previews', status: 'success', progress: null, projectId: 'p1' }])
      assert.ok(events(d, 'agentRun:changed').some((p) => p.status === 'running' && p.steps.length === 0), 'told as soon as it started')
    })

    test('[ipc:agentRun:stop] ends the run as stopped, says so, keeps the jobs it started, and returns nothing when no run is open', async () => {
      writeJob()
      const d = w.desk()
      pinned(d.handlers['agentRun:stop'])
      assert.equal(await d.handlers['agentRun:stop'](), null)
      process.env.AGENT_STUB_MODE = 'slow'
      d.handlers['agentRun:start']('A fox crossing a frozen lake')
      await until(() => state(d)?.steps.length >= 3)
      const t0 = Date.now()
      const view = await d.handlers['agentRun:stop']()
      assert.equal(view.status, 'stopped')
      assert.equal(view.say, 'Stopped.')
      assert.deepEqual(view.jobs, ['stub-job-1'])
      assert.deepEqual(view.renders.map((r) => [r.id, r.status]), [['stub-job-1', 'success']], 'the render list is refreshed (this job had already finished, so nothing to cancel)')
      assert.ok(Date.now() - t0 < 5000)
      assert.equal(events(d, 'agentRun:changed').at(-1).status, 'stopped')
    })

    test('[ipc:agentRun:dismiss] closes the panel of a finished run and leaves a running one alone', async () => {
      writeJob()
      const d = w.desk()
      pinned(d.handlers['agentRun:dismiss'])
      process.env.AGENT_STUB_MODE = 'slow'
      d.handlers['agentRun:start']('A fox crossing a frozen lake')
      assert.equal(d.handlers['agentRun:dismiss'](), null)
      assert.equal(state(d).status, 'running', 'still running, so still shown')
      assert.equal(events(d, 'agentRun:changed').at(-1).status, 'running')
      await d.handlers['agentRun:stop']()
      assert.equal(d.handlers['agentRun:dismiss'](), null)
      assert.equal(state(d), null)
      assert.equal(events(d, 'agentRun:changed').at(-1), null, 'the window is told the panel is gone')
    })
  })

  describe('the chat: opening, sending and answering', { concurrency: 1 }, () => {
    let w, d, chatDir, port
    let firstId
    const view = () => d.parts.chatView()
    const settled = () => until(() => !view().busy)
    before(async () => {
      w = world()
      d = w.desk()
      chatDir = path.join(w.dir, 'chats')
      port = new URL(await d.parts.deskFor().url).port
      registerPort(port)
    })
    after(() => unregisterPort(port))

    test('[ipc:chat:status] says which agents are installed, which one the chat prefers, the open chat and the saved ones', () => {
      pinned(d.handlers['chat:status'], d.parts.chatFound, d.parts.chatPreferred)
      assert.deepEqual(d.handlers['chat:status'](), { installed: { claude: true, codex: false }, preferred: 'claude', chat: null, chats: [] })
    })


    test('[ipc:chat:new] [event:chat:changed] opens an empty chat with the agent the person has, refusing one that is not installed', () => {
      pinned(d.handlers['chat:new'], d.parts.chatEngine, d.parts.chatView, d.parts.pushChat, d.parts.spendToday)
      assertMainSends(assert, "const pushChat = () => send('chat:changed', chatView())")
      assert.throws(() => d.handlers['chat:new']('codex'), /Codex isn't installed on this computer\./)
      const v = d.handlers['chat:new']()
      assert.deepEqual([v.engine, v.name, v.entries, v.busy, v.renders], ['claude', 'Claude Code', [], false, []])
      assert.deepEqual(v.spending, { on: false, daily: 1000, perStep: 250, spent: 0, label: null })
      assert.deepEqual(events(d, 'chat:changed').at(-1), v)
    })


    test('[ipc:chat:send] runs one message through the agent with what IV Studio is showing and the attached files, refuses an empty or second message, and keeps the session for the next', async () => {
      pinned(d.handlers['chat:send'])
      const note = path.join(w.dir, 'note.txt')
      const pic = path.join(w.dir, 'still.png')
      fs.writeFileSync(note, 'INT. KITCHEN - DAY')
      fs.writeFileSync(pic, 'png')
      await assert.rejects(() => d.handlers['chat:send']({ text: '  ' }), /Type a message first\./)
      const started = await d.handlers['chat:send']({ text: 'hello there', context: { page: 'shot', projectId: 'abc' }, files: [pic, note, path.join(w.dir, 'missing.png')] })
      firstId = started.id
      assert.equal(started.busy, true)
      assert.deepEqual(started.entries[0].files.map((f) => [f.name, f.kind]), [['still.png', 'picture'], ['note.txt', 'text']], 'a file that is not there is left out')
      await assert.rejects(() => d.handlers['chat:send']({ text: 'again' }), /is still answering\. Stop it first, or wait\./)
      await settled()
      const said = view().entries.findLast((e) => e.kind === 'agent').text
      assert.match(said, /You said: .*hello there/)
      assert.match(said, /INT\. KITCHEN - DAY/, 'the note\'s words went to the agent')
      assert.match(said, /\[IV Studio is showing a shot; shot id abc\]/, 'and what is on screen')
      assert.match(view().session, /^stub-session-/)
      assert.equal(loadChat(chatDir, firstId).session, view().session, 'saved with its session')
      assert.equal(loadChat(chatDir, firstId).title, 'hello there')
      await d.handlers['chat:send']({ text: 'and again' })
      await settled()
      assert.match(view().entries.findLast((e) => e.kind === 'agent').text, new RegExp(`continuing ${view().session}`))
      assert.ok(events(d, 'chat:changed').some((p) => p.busy === true), 'the window hears it is busy, then not')
      assert.deepEqual(d.handlers['chat:status']().chats.map((c) => c.id), [firstId])
    })


    test('[ipc:chat:answer] lets a waiting Allow card go ahead, so the agent finishes the step, and says false for a card that is not there', async () => {
      pinned(d.handlers['chat:answer'])
      assert.equal(d.handlers['chat:answer']({ id: 'nope', allow: true }), false, 'no turn is running')
      await d.handlers['chat:send']({ text: 'delete that shot' })
      await until(() => view().entries.some((e) => e.kind === 'ask'))
      const card = view().entries.findLast((e) => e.kind === 'ask')
      assert.deepEqual([card.label, card.answer], ['Delete project', null])
      assert.match(card.why, /can’t be undone/)
      assert.equal(d.handlers['chat:answer']({ id: 'nope', allow: true }), false)
      assert.equal(d.handlers['chat:answer']({ id: card.id, allow: true }), true)
      await settled()
      assert.equal(view().entries.findLast((e) => e.kind === 'ask').answer, 'allow')
      assert.equal(view().entries.findLast((e) => e.kind === 'agent').text, 'Deleted it.')
    })


    test('[ipc:chat:open] brings back a saved chat with what was said in it, and says when it is gone', async () => {
      pinned(d.handlers['chat:open'])
      const fresh = d.handlers['chat:new']()
      assert.notEqual(fresh.id, firstId)
      const opened = d.handlers['chat:open'](firstId)
      assert.equal(opened.id, firstId)
      assert.equal(opened.entries[0].text, 'hello there')
      assert.equal(events(d, 'chat:changed').at(-1).id, firstId)
      assert.throws(() => d.handlers['chat:open']('nope'), /That chat is gone\./)
      assert.throws(() => d.handlers['chat:open']('../x'), /That chat is gone\./)
      assert.deepEqual(d.handlers['chat:status']().chats.map((c) => c.id), [firstId])
    })
  })

  describe('the chat: undoing an edit, showing where, the spending limit and stopping', { concurrency: 1 }, () => {
    let w, d, chatDir, port
    const view = () => d.parts.chatView()
    const settled = () => until(() => !view().busy)
    before(async () => {
      w = world()
      process.env.IV_STUDIO_DATA = w.dir
      d = w.desk()
      chatDir = path.join(w.dir, 'chats')
      port = new URL(await d.parts.deskFor().url).port
      registerPort(port)
      d.handlers['chat:new']()
    })
    after(() => unregisterPort(port))

    test('[ipc:chat:undo] puts an edit the agent changed back as it was, marks the change undone, and refuses one it does not know', async () => {
      pinned(d.handlers['chat:undo'])
      assert.throws(() => w.desk().handlers['chat:undo']('x1'), /No chat open\./)
      const e = w.edits.create('Interview')
      w.edits.save(e.id, { clips: [{ id: 'c1', track: 'V1', media: 'm', start: 0, in: 0, out: 3 }, { id: 'c2', track: 'V1', media: 'm', start: 3, in: 0, out: 4 }] })
      await d.handlers['chat:send']({ text: `tighten the middle (edit id ${e.id})` })
      await settled()
      assert.deepEqual(w.edits.get(e.id).clips.map((c) => c.id), ['c1'], 'the agent took the last clip out')
      const entry = view().entries.findLast((x) => x.kind === 'undo')
      assert.deepEqual([entry.editId, entry.name, entry.done], [e.id, 'Interview', false])
      assert.throws(() => d.handlers['chat:undo']('no-such-change'), /No such change in this chat\./)
      const before = events(d, 'chat:changed').length
      assert.deepEqual(d.handlers['chat:undo'](entry.id), { editId: e.id, name: 'Interview' })
      assert.deepEqual(w.edits.get(e.id).clips.map((c) => c.id), ['c1', 'c2'], 'the edit is back')
      assert.equal(view().entries.findLast((x) => x.kind === 'undo').done, true)
      assert.ok(events(d, 'chat:changed').length > before)
      assert.equal(loadChat(chatDir, view().id).entries.findLast((x) => x.kind === 'undo').done, true, 'and saved')
    })


    test('[event:chat:show] tells the window where the agent is pointing, from its show_in_app call', async () => {
      assertMainSends(assert, "if (e.type === 'show') send('chat:show', e.show)")
      await d.handlers['chat:send']({ text: 'show me where to make a song' })
      await settled()
      assert.deepEqual(events(d, 'chat:show'), [{ where: 'music', spot: 'Make it', say: 'Press Make it when your style and lyrics are ready.' }])
    })


    test('[ipc:chat:spending] says what today\'s limit and spending are, and counts a paid step the agent started under the limit', async () => {
      pinned(d.handlers['chat:spending'])
      assert.deepEqual(d.handlers['chat:spending'](), { on: false, daily: 1000, perStep: 250, spent: 0, label: null })
      settings(w.dir, { chatBudget: { on: true, daily: 1000, perStep: 250 } })
      assert.equal(d.handlers['chat:spending']().label, 'Today: 0 of 1,000 credits')
      await d.handlers['chat:send']({ text: 'try seedance please' })
      await settled()
      assert.deepEqual(d.handlers['chat:spending'](), { on: true, daily: 1000, perStep: 250, spent: 120, label: 'Today: 120 of 1,000 credits' })
      const spent = view().entries.findLast((e) => e.kind === 'spent')
      assert.deepEqual([spent.credits, spent.usd, spent.auto, spent.today], [120, 0.57, true, 'Today: 120 of 1,000 credits'])
      assert.equal(readLedger(w.dir).length, 1)
      settings(w.dir, {})
    })


    test('[ipc:chat:stop] stops the agent mid-answer, keeps what was said, says it was stopped, and the chat can be used again; the chat and a Dashboard idea wait for each other', async () => {
      pinned(d.handlers['chat:stop'])
      assert.equal((await d.handlers['chat:stop']()).busy, false, 'nothing to stop')
      await d.handlers['chat:send']({ text: 'slow please' })
      await until(() => view().entries.some((e) => e.text === 'Working on it…'))
      assert.throws(() => d.handlers['chat:new'](), /is still answering\. Stop it first\./)
      assert.throws(() => d.handlers['chat:open']('some-chat'), /is still answering\. Stop it first\./)
      assert.throws(() => d.handlers['agentRun:start']('A fox'), /is answering in the chat/)
      const t0 = Date.now()
      const v = await d.handlers['chat:stop']({})
      assert.equal(v.busy, false)
      assert.equal(v.entries.findLast((e) => e.kind === 'problem').text, 'Stopped.')
      assert.ok(Date.now() - t0 < 5000)
      assert.ok(v.entries.some((e) => e.text === 'Working on it…'), 'what it already said stays')
    })
  })

  describe('the activity log, overnight batches and recipes', { concurrency: 1 }, () => {
    let w, d
    before(() => {
      w = world()
      d = w.desk()
    })
    const day = new Date().toISOString().slice(0, 10)

    test('[ipc:activity:list] lists what agents did newest first, by who and by problems only, from the last week and never further back than 30 days', () => {
      pinned(d.handlers['activity:list'], d.parts.watchActivity)
      record(w.dir, { tool: 'generate_previews', args: { prompt: 'fox' }, value: { id: 'j1', projectId: 'p1', plan: {} }, who: { kind: 'chat', name: 'Claude Code in the chat' } })
      record(w.dir, { tool: 'make_music', args: { name: 'Song' }, error: 'ComfyUI is down', who: { kind: 'outside', name: 'Codex' } })
      const old = new Date(Date.now() - 40 * 86400000).toISOString()
      record(w.dir, { tool: 'create_edit', args: { name: 'Old' }, who: { kind: 'chat', name: 'Claude Code in the chat' }, at: old })
      const all = d.handlers['activity:list']()
      assert.deepEqual(all.map((e) => e.tool), ['make_music', 'generate_previews'])
      assert.equal(all[1].refs.projectId, 'p1')
      assert.equal(all[0].error, 'ComfyUI is down')
      assert.deepEqual(d.handlers['activity:list']({ who: 'chat' }).map((e) => e.tool), ['generate_previews'])
      assert.deepEqual(d.handlers['activity:list']({ problems: true }).map((e) => e.tool), ['make_music'])
      assert.deepEqual(d.handlers['activity:list']({ days: 90 }).map((e) => e.tool), ['make_music', 'generate_previews'], '90 days is cut to 30, so the 40-day-old step stays out')
      assert.ok(fs.existsSync(path.join(w.dir, ACTIVITY_FOLDER, `${day}.jsonl`)))
    })

    test('[ipc:activity:undo] [event:activity:changed] puts an edit back as an agent left it, marks the step undone, and the window hears of log changes', async () => {
      pinned(d.handlers['activity:undo'])
      assertMainSends(assert, "activityTick = setTimeout(() => send('activity:changed', { at: Date.now() }), 300)")
      assertMainSends(assert, "send('activity:changed', { at: Date.now() })")
      const e = w.edits.create('Cut')
      w.edits.save(e.id, { clips: [{ id: 'c1' }] })
      const undo = keepUndo(w.dir, { editId: e.id, name: 'Cut', fields: { clips: [{ id: 'c1' }, { id: 'c2' }] } })
      const before = events(d, 'activity:changed').length
      record(w.dir, { tool: 'edit_timeline', args: { editId: e.id }, who: { kind: 'outside', name: 'Codex' }, undo })
      // the system's file watcher can miss a write it has only just started watching for: write another step until it is heard
      for (let i = 0; i < 6 && events(d, 'activity:changed').length <= before; i++) {
        await until(() => events(d, 'activity:changed').length > before, 1200).catch(() => record(w.dir, { tool: 'create_edit', args: { name: `Again ${i}` }, who: { kind: 'outside', name: 'Codex' } }))
      }
      assert.ok(events(d, 'activity:changed').length > before, 'the window was told')
      assert.equal(typeof events(d, 'activity:changed').at(-1).at, 'number', 'a write in the log folder is announced once it settles')
      const told = events(d, 'activity:changed').length
      assert.deepEqual(d.handlers['activity:undo'](undo), { editId: e.id, name: 'Cut' })
      assert.deepEqual(w.edits.get(e.id).clips.map((c) => c.id), ['c1', 'c2'])
      assert.ok(events(d, 'activity:changed').length > told, 'told straight away')
      assert.equal(d.handlers['activity:list']().find((x) => x.undo === undo).undone, true)
      assert.throws(() => d.handlers['activity:undo']('../x'), /No such change\./)
      assert.throws(() => d.handlers['activity:undo']('gone-1'), /too old to undo/)
    })

    test('[ipc:batches:list] lists the newest 20 overnight batches first', () => {
      pinned(d.handlers['batches:list'])
      fs.mkdirSync(path.join(w.dir, 'batches'), { recursive: true })
      const store = new Batches({ dir: path.join(w.dir, 'batches') })
      for (let i = 0; i < 22; i++) store.save({ id: `b${String(i).padStart(2, '0')}`, name: `Batch ${i}`, status: 'reported', takes: 1, jobs: [], createdAt: new Date(Date.UTC(2026, 10, 1, 0, i)).toISOString() })
      const list = d.handlers['batches:list']()
      assert.equal(list.length, 20)
      assert.deepEqual([list[0].name, list[19].name], ['Batch 21', 'Batch 2'])
    })

    test('[ipc:batches:dailies] makes a batch\'s dailies again from its renders: a reel of every take and the notes, kept on the batch', async () => {
      pinned(d.handlers['batches:dailies'], d.parts.jobOrNull, d.parts.buildDailies)
      const takes = [1, 2].map((n) => path.join(w.dir, `take${n}.mp4`))
      for (const file of takes) ff('-f', 'lavfi', '-i', 'testsrc2=s=160x90:r=24:d=1', '-f', 'lavfi', '-i', 'sine=f=330:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file)
      fs.mkdirSync(path.join(w.dir, 'jobs'), { recursive: true })
      const job = { id: 'jd1', kind: 'previews', name: 'Fox in snow', status: 'success', projectId: 'p1', outputs: takes.map((p, i) => ({ kind: 'preview', candidate: i + 1, seed: 11 + i, path: p })), ranking: { takes: [{ candidate: 1, score: 0.5, reasons: [] }, { candidate: 2, score: 0.8, best: true, reasons: ['says every word'] }] } }
      fs.writeFileSync(path.join(w.dir, 'jobs', 'jd1.json'), JSON.stringify(job))
      fs.mkdirSync(path.join(w.dir, 'batches'), { recursive: true })
      new Batches({ dir: path.join(w.dir, 'batches') }).save({ id: 'bdaily1', name: 'Fox at dawn', createdAt: '2026-11-10T02:00:00.000Z', takes: 2, status: 'reported', jobs: [{ jobId: 'jd1', label: 'A fox in snow' }, { jobId: 'gone', label: 'A job that is gone' }] })
      const out = await d.handlers['batches:dailies']('bdaily1')
      assert.equal(out.takes, 2)
      assert.ok(out.folder.startsWith(path.join(w.dir, 'Videos', 'Dailies')), out.folder)
      assert.ok(fs.existsSync(out.reel) && fs.existsSync(out.notes))
      assert.match(fs.readFileSync(out.notes, 'utf8'), /Shot 1, take 2/)
      const info = await w.edits.probe(out.reel)
      assert.equal(info.hasAudio, true)
      assert.ok(info.duration > 4, `reel is ${info.duration} s`)
      assert.equal(JSON.parse(fs.readFileSync(path.join(w.dir, 'batches', 'bdaily1.json'), 'utf8')).dailies.reel, out.reel, 'kept on the batch')
      await assert.rejects(() => d.handlers['batches:dailies']('nope'), /No such batch\./)
    })

    test('[ipc:recipes:list] lists the saved recipes, none at first', () => {
      const BASE = w.dir
      const recipesList = () => listRecipes(BASE)
      assertCopiesMain(assert, 'recipes:list', recipesList.toString())
      assert.deepEqual(recipesList(), [])
      saveRecipe(BASE, { name: 'Vertical teaser', instruction: 'A 15 second vertical teaser from my latest finished shot, fast speed.', note: '15 s · 9:16' })
      saveRecipe(BASE, { name: 'Slow dolly', instruction: 'A slow dolly-in on my latest finished shot, ten seconds.' })
      assert.deepEqual(recipesList().map((r) => r.name), ['Vertical teaser', 'Slow dolly'])
    })

    test('[ipc:recipes:remove] removes one recipe and answers with the rest, and refuses one that is not there', () => {
      const BASE = w.dir
      const recipesRemove = (id) => (removeRecipe(BASE, String(id || '')), listRecipes(BASE))
      assertCopiesMain(assert, 'recipes:remove', recipesRemove.toString())
      const [first, second] = listRecipes(BASE)
      assert.deepEqual(recipesRemove(first.id).map((r) => r.id), [second.id])
      assert.throws(() => recipesRemove(first.id), /No such recipe\./)
      assert.throws(() => recipesRemove(''), /No such recipe\./)
    })

    test('[event:recipes:changed] tells the window the new list shortly after a recipe is saved or removed in the data folder', async () => {
      const BASE = tmp()
      saveRecipe(BASE, { name: 'Vertical teaser', instruction: 'A 15 second vertical teaser from my latest finished shot, fast speed.' })
      assertMainSends(assert, "if (name === 'recipes.json') later('recipes', () => send('recipes:changed', listRecipes(BASE)))")
      assertMainSends(assert, 'const later = (key, fn) => { clearTimeout(settle.get(key)) settle.set(key, setTimeout(fn, 200)) }')
      const sent = []
      const send = (channel, payload) => sent.push([channel, payload])
      const settle = new Map()
      const later = (key, fn) => {
        clearTimeout(settle.get(key))
        settle.set(key, setTimeout(fn, 200))
      }
      const watcher = fs.watch(BASE, (_, name) => {
        if (name === 'recipes.json') later('recipes', () => send('recipes:changed', listRecipes(BASE)))
      })
      // the system's file watcher can miss a write it has only just started watching for: write again until it is heard
      const heard = async (change, already) => {
        for (let i = 0; i < 6 && sent.length <= already; i++) {
          change()
          await until(() => sent.length > already, 1200).catch(() => {})
        }
        assert.ok(sent.length > already, 'the window was told')
      }
      try {
        await new Promise((r) => setTimeout(r, 150))
        const kept = listRecipes(BASE)[0]
        await heard(() => saveRecipe(BASE, { name: 'Night walk', instruction: 'A short night walk through a rainy street, fast speed.' }), 0)
        assert.deepEqual(sent.at(-1)[1].map((r) => r.name), [kept.name, 'Night walk'])
        const n = sent.length
        removeRecipe(BASE, kept.id)
        const file = path.join(BASE, 'recipes.json')
        await heard(() => fs.writeFileSync(file, fs.readFileSync(file)), n)
        assert.deepEqual(sent.at(-1)[1].map((r) => r.name), ['Night walk'])
        assert.ok(sent.every(([c]) => c === 'recipes:changed'))
      } finally {
        watcher.close()
      }
    })
  })

  describe('talking to the chat: hearing the person and reading replies aloud', { concurrency: 1 }, () => {
    let dir, sample, busyFake, on, off, voicesOn
    const engine = {
      calls: [],
      status: () => ({ installed: true }),
      release() {},
      async call(name, args) {
        this.calls.push([name, args])
        if (name === 'transcribe') return { text: '  hello   there  ' }
        fs.copyFileSync(sample, args.out)
        return {}
      }
    }
    before(async () => {
      busyFake = await startFakeComfy({ devices: 'mps', os: 'darwin' })
      dir = tmp()
      sample = path.join(dir, 'sample.wav')
      ff('-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-ar', '16000', '-ac', '1', sample)
      const studio = new Studio({ dataDir: dir, resourcesDir: path.resolve('resources'), comfyUrl: busyFake.url })
      const edits = new Edits({ dataDir: dir, ffmpeg: ffmpegStatic.ffmpegPath, ffprobe: ffmpegStatic.ffprobePath })
      const mk = (cloud) => new Voices({ dataDir: dir, resourcesDir: path.resolve('resources'), ffmpeg: ffmpegStatic.ffmpegPath, onLog: () => {}, cloud })
      voicesOn = mk(() => engine)
      off = buildDesk({ BASE: dir, DATA: dir, studio, edits, voices: mk(null) })
      on = buildDesk({ BASE: dir, DATA: dir, studio, edits, voices: voicesOn })
      desks.push(off, on)
    })
    after(() => busyFake.close())

    test('[ipc:chat:hear] turns what the window recorded into words with the voice engine, refuses until voices are set up and a clip too short to hear, and leaves no temp file', async () => {
      pinned(on.handlers['chat:hear'])
      await assert.rejects(() => off.handlers['chat:hear'](Array.from(fs.readFileSync(sample))), (e) => e.code === 'voices' && /Talking to the chat needs IV Studio’s voices set up once/.test(e.message))
      await assert.rejects(() => on.handlers['chat:hear']([1, 2, 3]), /too short to hear/)
      const leftovers = () => fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('ivs-hear-'))
      const before = leftovers()
      assert.deepEqual(await on.handlers['chat:hear'](Array.from(fs.readFileSync(sample))), { text: 'hello there' })
      assert.equal(engine.calls.at(-1)[0], 'transcribe')
      assert.deepEqual(leftovers(), before)
    })

    test('[ipc:chat:say] reads a reply aloud in the first voice without keeping it in Lines, refusing until voices are set up or made, and not while a render uses the graphics card', async () => {
      pinned(on.handlers['chat:say'])
      await assert.rejects(() => off.handlers['chat:say']({ text: 'Hi' }), (e) => e.code === 'voices' && /Reading replies aloud needs IV Studio’s voices set up once/.test(e.message))
      await assert.rejects(() => on.handlers['chat:say']({ text: 'Hi' }), /Make or add a voice first/)
      const voice = await voicesOn.create({ name: 'Mina', file: sample, text: 'Hello there.', consent: true })
      const said = await on.handlers['chat:say']({ text: '## Done\n\nI made **two takes**. See [the shot](http://x).', voiceId: 'no-such-voice' })
      assert.deepEqual([said.voiceId, said.voice, said.text], [voice.id, 'Mina', 'Done I made two takes. See the shot.'])
      assert.ok(fs.existsSync(said.file) && said.file.includes(`${path.sep}_said${path.sep}`), 'kept apart from Lines')
      assert.ok(said.duration > 0.5)
      assert.deepEqual(voicesOn.allLines(), [], 'not in Lines')
      assert.equal(engine.calls.at(-1)[0], 'speak')
      assert.equal(engine.calls.at(-1)[1].ref_text, 'Hello there.')
      busyFake.state.running.push([1, 'busy-prompt', {}, {}, []])
      try {
        assert.deepEqual(await on.handlers['chat:say']({ text: 'Another reply.', voiceId: voice.id }), { skipped: 'A render is using the graphics card, so this reply isn’t read aloud.' })
        settings(dir, { target: 'cloud' })
        assert.equal((await on.handlers['chat:say']({ text: 'Another reply.', voiceId: voice.id })).voice, 'Mina', 'on the cloud nothing local is busy')
      } finally {
        busyFake.state.running.length = 0
        settings(dir, {})
      }
    })
  })
})
