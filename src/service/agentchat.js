// A chat with the person's own Claude Code or Codex inside IV Studio (docs/superpowers/specs/2026-11-10-agent-chat-design.md):
// like adding IV Studio to Claude Desktop or Codex as an MCP server, but in the app. Every IV Studio tool, nothing
// else; anything that deletes, costs money, installs or changes Settings waits for the person's Allow (server.js
// askPerson, chatAsk). One headless turn per message, continuing the agent's own session.
import fs from 'node:fs'
import path from 'node:path'
import { AGENT_NAMES, SERVER, claudeArgs, codexChatArgs, killTree, parseLine, spawnAgent, stepLabel } from './agentrun.js'

export const TURN_LIMIT_MS = 45 * 60 * 1000
export const KEEP_CHATS = 20

export const chatPrompt = () => `You are the assistant inside IV Studio, the person's video app, talking with them in a chat panel at the side of the app.

You have IV Studio's tools (the iv-studio MCP server) and nothing else: no files, no shell. Use them the way you would if the person had added IV Studio to their own agent app: look things up, write H3 prompts, render on this computer, sequence shots, edit, make music and voices, and answer questions about their projects and about IV Studio. Call get_guide before the first thing you make in a chat, and check_setup when something might be missing.

Each message starts with a line in [brackets] saying what IV Studio is showing them right now (the page, and the ids of the open shot, film, sequence or edit). "This" and "it" usually mean that. Use the ids with the tools; never show raw ids to the person.

When the person attaches files, the message lists their paths (and a script's or note's words). Look at a picture, or a moment of a video, with grab_frame (file, at); use the paths with the tools: a picture as a shot's first frame or an image edit's reference, a script for a film, a sound or song in a shot or edit.

When the person asks where something is or how to get somewhere in IV Studio, find it with list_places and show it with show_in_app: the app goes there and lights it up, with your words beside it.

Anything that deletes, costs money, installs or downloads, trains, or changes a setting shows the person an Allow card and waits. If they choose Don't allow, accept it, don't try again unless they ask, and say what you could do instead.

Changing an edit by talking ("tighten the middle", "add a song", "put captions on"): get_edit first, then make the change with edit_timeline (trims, moves, ripple removes), add_media (a song made with the music tools, or a file), and caption_edit for captions. Every change you make to an edit gets an "Undo this change" button in the chat, and an open edit reloads at once, so make the change and say in a sentence what you did; don't ask first for ordinary edits.

When the person asks to save something as a recipe, call save_recipe: a short name for the button and the request written out in full so it works another day on its own ("a 15 second vertical teaser from my latest finished shot, fast speed"), never ids. It becomes a button on the Dashboard.

For many variations while they're away ("10 versions of this overnight, three takes each"), write each variation as its own full H3 prompt and call start_batch once. Tell them it's queued and that the report will be here in the morning; don't wait on it.

A short film in one conversation: go stage by stage and stop for the person's OK after each, saying what's next. 1) create_film with the idea, then write_film_script and show the script in a few lines. 2) The cast: who plays whom (list_characters, update_film cast), faces for made-up roles. 3) break_down_film (it sketches the board) and make_animatic, and show them the board on the Projects page (show_in_app). 4) Only after an OK on the board, render_film_scene (minutes of GPU time a shot), then rank_takes and finish the best takes with their OK. 5) build_rough_cut, and offer captions or music on its edit. Keep update_film step in line with where you are, so the Projects page shows the same stage.

To wait for a render, call get_job: it waits up to 25 seconds each time, so just call it again, without commentary in between. Renders take minutes; once one has started and you've checked it's running, you may tell the person it's on its way instead of waiting for all of it.

Keep replies short and plain, for someone who isn't technical: a few sentences, no tables, no code unless they ask.`

// Files the person drops into the chat (or picks with its paperclip): what each is, and the message with them. The
// agent has no file tools, so it gets the paths (for IV Studio's tools, and grab_frame to look at a picture or a
// moment of a video) and a script's or note's own text, inline.
export const MAX_ATTACH = 10
export const MAX_TEXT = 30000
const ATTACH_KINDS = [
  ['picture', /\.(png|jpe?g|webp|bmp|gif)$/i],
  ['video', /\.(mp4|mov|webm|mkv|avi|m4v)$/i],
  ['sound', /\.(wav|mp3|flac|m4a|ogg|aac)$/i],
  ['text', /\.(txt|md|fountain|srt|vtt|json|csv)$/i]
]
export const ATTACH_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v', 'wav', 'mp3', 'flac', 'm4a', 'ogg', 'aac', 'txt', 'md', 'fountain', 'srt', 'vtt', 'json', 'csv']
export function attachmentOf(file) {
  const kind = ATTACH_KINDS.find(([, re]) => re.test(file))?.[0] || null
  return { path: file, name: path.basename(file), kind }
}
export function withAttachments(message, files = [], readText = (f) => fs.readFileSync(f, 'utf8')) {
  const list = files.slice(0, MAX_ATTACH).map((f) => (typeof f === 'string' ? attachmentOf(f) : f)).filter((f) => f.kind)
  if (!list.length) return message
  const how = { picture: 'look at it with grab_frame (file, at 0)', video: 'see a moment with grab_frame (file, at seconds)', sound: 'use its path with the audio tools' }
  const lines = ['The person attached:']
  for (const f of list) {
    if (f.kind !== 'text') {
      lines.push(`- ${f.kind}: ${f.path} (${how[f.kind]})`)
      continue
    }
    let text = ''
    try {
      text = readText(f.path)
    } catch (e) {
      lines.push(`- text file ${f.path}: couldn't be read (${e.message})`)
      continue
    }
    const cut = text.length > MAX_TEXT
    lines.push(`- text file ${f.name} (${f.path}), its words${cut ? ` (the first ${MAX_TEXT} characters)` : ''}:`, '<<<', cut ? text.slice(0, MAX_TEXT) : text, '>>>')
  }
  return `${lines.join('\n')}\n\n${message}`
}

// The bracketed line at the top of each message: what IV Studio is showing. ctx from the app (App.jsx).
const PAGE_NAMES = {
  home: 'the Dashboard',
  create: 'Create',
  shot: 'a shot',
  library: 'Shots',
  media: 'the Library',
  projects: 'Projects (films)',
  project: 'a film project',
  sequences: 'Sequences',
  sequence: 'a sequence',
  edits: 'Edits',
  edit: 'the editor',
  characters: 'Characters',
  character: 'a character training',
  loras: 'LoRAs',
  workflows: 'Workflows',
  sizzle: 'Website films',
  'sizzle-project': 'a website film',
  rebuild: 'Rebuilds',
  'rebuild-project': 'a rebuild',
  audio: 'the Audio front page',
  voices: 'Voices',
  lines: 'Voice lines',
  music: 'Music',
  sounds: 'Sounds',
  cloud: 'Cloud',
  settings: 'Settings'
}
const CONTEXT_IDS = [
  ['projectId', 'shot id'],
  ['productionId', 'film id'],
  ['sequenceId', 'sequence id'],
  ['editId', 'edit id'],
  ['sizzleId', 'website film id'],
  ['rebuildId', 'rebuild id'],
  ['shinobiId', 'Shinobi film id'],
  ['trainingId', 'character training id']
]
export function contextLine(ctx = {}) {
  const parts = [`IV Studio is showing ${PAGE_NAMES[ctx.page] || ctx.page || 'a page'}`]
  if (ctx.section) parts[0] += ` (${ctx.section === 'audio' ? 'audio' : 'visual'} side)`
  for (const [key, label] of CONTEXT_IDS) if (ctx[key]) parts.push(`${label} ${ctx[key]}`)
  const lines = [`[${parts.join('; ')}]`]
  // what's picked on that page (selection.js): the version, the clip and playhead, the Library item, Create's setup
  const sel = ctx.selection && typeof ctx.selection === 'object' ? ctx.selection : null
  if (sel) {
    const said = Object.entries(sel)
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .slice(0, 8)
      .map(([k, v]) => `${k}: ${String(v).slice(0, 300)}`)
    if (said.length) lines.push(`[Selected: ${said.join('; ')}]`)
  }
  // what's rendering on ComfyUI now and what's waiting (not only this chat's)
  if (Array.isArray(ctx.renders)) {
    const r = ctx.renders.map((x) => `${x.name || x.kind || 'a render'}${x.ours === false ? ' (not IV Studio’s)' : ''} ${x.state === 'running' ? `rendering${x.percent != null ? ` ${x.percent}%` : ''}` : 'waiting'}`)
    lines.push(r.length ? `[Renders: ${r.join('; ')}]` : '[Renders: nothing rendering or waiting]')
  }
  // the newest failed render in the last half hour, so "why did that fail" has an answer
  if (ctx.problem?.jobId) lines.push(`[Last failed render: ${ctx.problem.name || ctx.problem.kind || 'a render'} (job ${ctx.problem.jobId}), ${ctx.problem.minutesAgo} min ago: ${ctx.problem.reason}]`)
  return lines.join('\n')
}

// One message's turn. dir: the chat's own folder (kept, so the agent's session can resume from the same place).
// session: the agent's session to continue, or null for the first message. onEvent(e) gets parseLine's events plus
// { type: 'ask', ask } and { type: 'asked', id, allow }. Resolves { ok, error, session, jobs } when the turn ends.
export function startChatTurn({ engine, exe, dir, session = null, message, context = null, mcp, model = '', extraEnv = {}, onEvent = () => {}, limitMs = TURN_LIMIT_MS, pollMs = 400 }) {
  if (!AGENT_NAMES[engine]) throw new Error(`Unknown agent "${engine}".`)
  const work = path.join(dir, 'work')
  const askDir = path.join(dir, 'asks')
  const undoDir = path.join(dir, 'undo')
  const jobsFile = path.join(dir, 'jobs.txt')
  for (const d of [work, askDir]) fs.mkdirSync(d, { recursive: true })
  for (const f of fs.readdirSync(askDir)) fs.rmSync(path.join(askDir, f), { force: true })
  fs.writeFileSync(jobsFile, '')
  const env = { ...mcp.env, ...extraEnv, IV_STUDIO_AGENT_RUN: 'chat', IV_STUDIO_AGENT_JOBS: jobsFile, IV_STUDIO_AGENT_ASK: askDir }
  const server = { command: mcp.command, args: mcp.args, env }
  const text = `${context ? `${contextLine(context)}\n` : ''}${message}`
  let args
  let input
  if (engine === 'claude') {
    const mcpConfigFile = path.join(dir, 'mcp.json')
    const promptFile = path.join(dir, 'prompt.txt')
    fs.writeFileSync(mcpConfigFile, JSON.stringify({ mcpServers: { [SERVER]: { type: 'stdio', ...server } } }))
    fs.writeFileSync(promptFile, chatPrompt())
    args = claudeArgs({ mcpConfigFile, promptFile, model, persist: true, resume: session })
    input = text
  } else {
    args = codexChatArgs({ mcp: server, model, resume: session })
    // Codex has no system prompt of its own here: the first message carries it, and the session keeps it
    input = session ? text : `${chatPrompt()}\n\n---\n\n${text}`
  }

  const jobs = () => {
    try {
      return [...new Set(fs.readFileSync(jobsFile, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean))]
    } catch {
      return []
    }
  }
  let newSession = session
  let ended = false
  let endEvent = null
  let stopped = false
  const seen = new Set()
  let resolveTurn
  const promise = new Promise((r) => (resolveTurn = r))
  const emit = (e) => {
    try {
      onEvent(e)
    } catch {
      /* a listener's problem isn't the turn's */
    }
  }

  // the agent's MCP server asks by writing a file; the card shows it until the person answers
  const pollAsks = () => {
    let names = []
    try {
      names = fs.readdirSync(askDir).filter((n) => n.endsWith('.ask.json'))
    } catch {
      return
    }
    // show_in_app: a place to show the person (the app goes there and lights it up)
    let shows = []
    try {
      shows = fs.readdirSync(askDir).filter((n) => n.endsWith('.show.json'))
    } catch {}
    for (const n of shows) {
      try {
        const show = JSON.parse(fs.readFileSync(path.join(askDir, n), 'utf8'))
        fs.rmSync(path.join(askDir, n), { force: true })
        emit({ type: 'show', show })
      } catch {
        /* still being written */
      }
    }
    // an edit the agent changed: the edit as it was, kept in the chat's undo folder for "Undo this change"
    let undos = []
    try {
      undos = fs.readdirSync(askDir).filter((n) => n.endsWith('.undo.json'))
    } catch {}
    for (const n of undos) {
      try {
        const u = JSON.parse(fs.readFileSync(path.join(askDir, n), 'utf8'))
        if (!/^[a-z0-9-]+$/i.test(u.id || '')) throw new Error('bad id')
        fs.mkdirSync(undoDir, { recursive: true })
        fs.writeFileSync(path.join(undoDir, `${u.id}.json`), JSON.stringify(u))
        fs.rmSync(path.join(askDir, n), { force: true })
        pruneUndo(undoDir)
        emit({ type: 'undo', undo: { id: u.id, editId: u.editId, name: u.name, tool: u.tool, label: stepLabel(u.tool) } })
      } catch {
        /* still being written */
      }
    }
    for (const n of names) {
      const id = n.slice(0, -'.ask.json'.length)
      if (seen.has(id)) continue
      try {
        const ask = JSON.parse(fs.readFileSync(path.join(askDir, n), 'utf8'))
        seen.add(id)
        emit({ type: 'ask', ask: { ...ask, label: stepLabel(ask.tool) } })
      } catch {
        /* still being written */
      }
    }
  }
  const poller = setInterval(pollAsks, pollMs)

  const child = spawnAgent(exe, args, { cwd: work, env: { ...process.env, NO_COLOR: '1', MCP_TOOL_TIMEOUT: String(15 * 60 * 1000) } })
  child.stdin.on('error', () => {})
  child.stdin.end(input)
  let buf = ''
  let err = ''
  child.stdout.on('data', (d) => {
    buf += d
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (!line) continue
      for (const e of parseLine(engine, line)) {
        if (e.type === 'session') newSession = e.id
        if (e.type === 'end') endEvent = e
        emit(e)
      }
    }
  })
  child.stderr.on('data', (d) => (err = (err + d).slice(-2000)))
  const finish = (ok, error) => {
    if (ended) return
    ended = true
    clearInterval(poller)
    // anything written in the turn's last moments (an undo point, a place to show)
    try {
      pollAsks()
    } catch {}
    clearTimeout(timer)
    // an unanswered card is moot once the turn is over
    for (const id of seen) emit({ type: 'asked', id, allow: null, moot: true })
    resolveTurn({ ok, error, session: newSession, jobs: jobs() })
  }
  const timer = setTimeout(() => {
    killTree(child)
    finish(false, `${AGENT_NAMES[engine]} worked for ${Math.round(limitMs / 60000)} minutes, the limit for one message, and was stopped.`)
  }, limitMs)
  child.on('error', (e) => finish(false, `${AGENT_NAMES[engine]} couldn't start: ${e.message}`))
  child.on('close', (code) => {
    if (stopped) return finish(false, 'Stopped.')
    if (endEvent) return finish(endEvent.ok, endEvent.ok ? null : endEvent.text || `${AGENT_NAMES[engine]} stopped with a problem.`)
    finish(code === 0, code === 0 ? null : err.trim().split('\n').filter(Boolean).pop() || `${AGENT_NAMES[engine]} stopped (code ${code}).`)
  })

  return {
    promise,
    jobs,
    // the person's click on a card: the server waiting on this answer goes ahead, or tells the agent no
    answer(id, allow) {
      if (ended || !seen.has(id)) return false
      const file = path.join(askDir, `${id}.answer.json`)
      fs.writeFileSync(`${file}.tmp`, JSON.stringify({ allow: !!allow }))
      fs.renameSync(`${file}.tmp`, file)
      emit({ type: 'asked', id, allow: !!allow })
      return true
    },
    stop() {
      if (ended) return
      stopped = true
      killTree(child)
    }
  }
}

// A chat as the app keeps it (chat.json in the chat's folder): who, the agent's session, and what was said and done.
//   entries: { kind: 'you', text } | { kind: 'agent', text } | { kind: 'step', tool, label, error, count }
//            | { kind: 'ask', id, tool, label, why, args, answer: 'allow' | 'deny' | 'moot' | null }
//            | { kind: 'problem', text }
export function newChat({ id, engine }) {
  return { id, engine, name: AGENT_NAMES[engine], session: null, title: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), entries: [], jobs: [] }
}

// A turn's event into the chat's entries (the folding the Dashboard panel does, kept as a conversation).
export function applyChatEvent(chat, e) {
  const last = chat.entries[chat.entries.length - 1]
  if (e.type === 'say') {
    // Claude Code repeats its last words in the final result: don't show them twice
    if (!(last?.kind === 'agent' && last.text === e.text)) chat.entries.push({ kind: 'agent', text: e.text, at: new Date().toISOString() })
  } else if (e.type === 'end') {
    if (!e.ok && e.text) chat.entries.push({ kind: 'problem', text: e.text.slice(0, 600) })
    else if (e.text && !chat.entries.some((x, i) => x.kind === 'agent' && x.text === e.text && i >= chat.entries.length - 6)) chat.entries.push({ kind: 'agent', text: e.text, at: new Date().toISOString() })
  } else if (e.type === 'step') {
    if (last?.kind === 'step' && last.tool === e.tool && e.tool === 'get_job') last.count = (last.count || 1) + 1
    else chat.entries.push({ kind: 'step', tool: e.tool, label: e.label, id: e.id, error: null })
  } else if (e.type === 'stepError') {
    const s = [...chat.entries].reverse().find((x) => x.kind === 'step' && (x.id === e.id || !e.id))
    if (s) s.error = (e.text || 'Refused').slice(0, 300)
  } else if (e.type === 'ask') {
    chat.entries.push({ kind: 'ask', id: e.ask.id, tool: e.ask.tool, label: e.ask.label, why: e.ask.why, args: e.ask.args || {}, answer: null })
  } else if (e.type === 'asked') {
    const a = chat.entries.find((x) => x.kind === 'ask' && x.id === e.id)
    if (a && !a.answer) a.answer = e.moot ? 'moot' : e.allow ? 'allow' : 'deny'
  } else if (e.type === 'undo') {
    chat.entries.push({ kind: 'undo', id: e.undo.id, editId: e.undo.editId, name: e.undo.name, label: e.undo.label, done: false })
  } else if (e.type === 'session') chat.session = e.id
  else if (e.type === 'usage') applyUsage(chat, e)
  else if (e.type === 'compact') {
    chat.entries.push({ kind: 'compact', trigger: e.trigger, before: e.before, at: new Date().toISOString() })
    if (chat.usage) chat.usage.context = null
  }
  // a tool call counts toward Codex's requests this turn (its context estimate)
  if (e.type === 'step') chat.turnCalls = (chat.turnCalls || 0) + 1
  chat.updatedAt = new Date().toISOString()
  return chat
}

// The chat's usage (ChatPanel's meter): how full the agent's context window is now, and the totals so far.
// Claude Code reports the window's contents after each reply (exact). Codex reports a turn's total over all its
// requests, so its context is estimated as that total over the requests (tool calls + 1), marked approx.
export function applyUsage(chat, e) {
  const u = (chat.usage ||= { context: null, window: null, approx: false, input: 0, cached: 0, output: 0, apiUsd: 0, turns: 0 })
  if (e.window) u.window = e.window
  if (e.model) u.model = e.model
  if (e.context != null) {
    u.context = e.context
    u.approx = false
  }
  if (e.turn) {
    u.input += e.turn.input || 0
    u.cached += e.turn.cached || 0
    u.output += e.turn.output || 0
    u.apiUsd = Math.round((u.apiUsd + (e.turn.apiUsd || 0)) * 10000) / 10000
    u.turns += 1
    if (chat.engine === 'codex') {
      u.context = Math.round((e.turn.input || 0) / ((chat.turnCalls || 0) + 1))
      u.approx = true
    }
    chat.turnCalls = 0
  }
  return u
}

// The edit as it was before an agent's change (chat dir's undo folder): the newest KEEP_UNDO are kept.
export const KEEP_UNDO = 30
function pruneUndo(dir) {
  const files = fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort()
  for (const n of files.slice(0, Math.max(0, files.length - KEEP_UNDO))) fs.rmSync(path.join(dir, n), { force: true })
}
// Puts an edit back as it was before the agent's change. save(editId, fields) writes it; returns the edit's name.
export function undoEditChange(chatDir, undoId, save) {
  if (!/^[a-z0-9-]+$/i.test(String(undoId || ''))) throw new Error('No such change.')
  let u
  try {
    u = JSON.parse(fs.readFileSync(path.join(chatDir, 'undo', `${undoId}.json`), 'utf8'))
  } catch {
    throw new Error('That change is too old to undo here (the chat keeps the last 30).')
  }
  save(u.editId, u.fields)
  return { editId: u.editId, name: u.name }
}

// Saved chats: one folder each under root (the data folder's chats), newest first, the oldest beyond KEEP_CHATS removed.
export function saveChat(root, chat) {
  const dir = path.join(root, chat.id)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'chat.json')
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(chat, null, 1))
  fs.renameSync(`${file}.tmp`, file)
}
export function loadChat(root, id) {
  if (!/^[a-z0-9-]+$/i.test(id)) return null
  try {
    return JSON.parse(fs.readFileSync(path.join(root, id, 'chat.json'), 'utf8'))
  } catch {
    return null
  }
}
export function listChats(root) {
  let ids = []
  try {
    ids = fs.readdirSync(root)
  } catch {
    return []
  }
  return ids
    .map((id) => loadChat(root, id))
    .filter(Boolean)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .map(({ id, engine, name, title, updatedAt }) => ({ id, engine, name, title, updatedAt }))
}
export function pruneChats(root, keep = KEEP_CHATS) {
  for (const c of listChats(root).slice(keep)) fs.rmSync(path.join(root, c.id), { recursive: true, force: true, maxRetries: 3 })
}

// A reply as it should be read aloud: no code, no markdown marks, links as their words, and no longer than about
// 600 characters (it stops at the end of a sentence), so a long answer doesn't keep talking.
export function spokenText(text, max = 600) {
  let t = String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/[*~]+|(?<![A-Za-z0-9])_+|_+(?![A-Za-z0-9])/g, '')
    .replace(/[>|#]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max)
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '))
  return end > max * 0.4 ? cut.slice(0, end + 1) : `${cut.replace(/\s+\S*$/, '')}…`
}
