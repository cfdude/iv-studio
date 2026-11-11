// What agents did in IV Studio: every step that changes something, spends or fails, from any agent (the chat inside
// IV Studio, a Dashboard idea, or Claude Desktop, Codex, Claude Code or Hermes using IV Studio's MCP server from
// outside), written by the MCP server as it runs (src/mcp/server.js) and shown in the chat panel's Activity tab.
// One JSON line per step, a file per day, in the data folder's activity\. Looking things up (get_, list_, check_ and
// the like) isn't written down: an agent waiting on a render would fill the log with get_job. Steps that change an
// edit keep the edit as it was, so the log can offer Undo for any agent's change, not only the chat's.
import fs from 'node:fs'
import path from 'node:path'
import { CHAT_READS, stepLabel } from './agentrun.js'

export const ACTIVITY_FOLDER = 'activity'
export const KEEP_DAYS = 30
const LOOKS_TOO = new Set(['get_job', 'get_outputs', 'get_guide', 'get_menu', 'list_activity'])

// a step that only looks: not written down unless it failed
export const looksOnly = (tool) => CHAT_READS.test(tool) || LOOKS_TOO.has(tool)

// Who did it, in words, from how the MCP server was started (env) and the client's own name (MCP initialize).
const CLIENTS = [
  [/claude[- ]?desktop|claude-ai/i, 'Claude Desktop'],
  [/claude[- ]?code/i, 'Claude Code'],
  [/codex/i, 'Codex'],
  [/hermes/i, 'Hermes'],
  [/openclaw/i, 'OpenClaw'],
  [/cursor/i, 'Cursor'],
  [/smoke|test/i, 'A test']
]
export function whoOf({ env = process.env, client = null } = {}) {
  const agent = env.IV_STUDIO_AGENT_NAME || null
  if (env.IV_STUDIO_AGENT_RUN === 'chat') return { kind: 'chat', name: agent || 'The chat', chatId: env.IV_STUDIO_CHAT_ID || null }
  if (env.IV_STUDIO_AGENT_RUN === '1') return { kind: 'idea', name: agent || 'A Dashboard idea' }
  const raw = String(client?.name || '').trim()
  const known = CLIENTS.find(([re]) => re.test(raw))
  return { kind: 'outside', name: known ? known[1] : raw || 'An agent', client: raw || null }
}

// the ids a step's result points at: what "Open" goes to
const REFS = ['jobId', 'projectId', 'editId', 'filmId', 'sequenceId', 'imageId', 'songId', 'voiceId', 'lineId', 'characterId', 'batchId', 'trainingId', 'sizzleId', 'rebuildId', 'shinobiId']
// a tool that makes something returns it as itself: its own id is that thing's
const MADE = { create_edit: 'editId', create_film: 'filmId', save_sequence: 'sequenceId', make_image: 'imageId', picture_tool: 'imageId', last_frame: 'imageId', make_music: 'songId', remix_music: 'songId', create_voice: 'voiceId', design_voice: 'voiceId', speak_line: 'lineId', make_reel: 'editId', build_rough_cut: 'editId' }
export function refsOf(args = {}, value = null, tool = '') {
  const out = {}
  if (MADE[tool] && value && typeof value === 'object' && typeof value.id === 'string') out[MADE[tool]] = value.id
  const from = (o) => {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return
    for (const k of REFS) if (o[k] && typeof o[k] === 'string' && !out[k]) out[k] = o[k]
  }
  from(value)
  // a job or record returned as itself: its id is the job's (or the record's) own
  if (value && typeof value === 'object' && typeof value.id === 'string') {
    if (value.promptId || value.kind === 'previews' || value.kind === 'finish' || value.plan) out.jobId ??= value.id
  }
  from(args)
  return out
}

// what the step was about, in a few words: a name or the start of a prompt or message
const ABOUT = ['name', 'title', 'idea', 'prompt', 'text', 'url', 'instruction', 'message', 'query']
export function aboutOf(args = {}) {
  for (const k of ABOUT) {
    const v = args?.[k]
    if (typeof v === 'string' && v.trim()) {
      const t = v.replace(/\s+/g, ' ').trim()
      return t.length > 120 ? `${t.slice(0, 117)}…` : t
    }
  }
  return null
}

const day = (at) => at.slice(0, 10)
export const fileFor = (dataDir, at) => path.join(dataDir, ACTIVITY_FOLDER, `${day(at)}.jsonl`)
const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`

// One step, written down. Returns the entry, or null when it isn't kept (a look that worked).
export function record(dataDir, { tool, args = {}, value = null, error = null, ms = null, who, spend = null, undo = null, at = new Date().toISOString() }) {
  if (looksOnly(tool) && !error) return null
  const entry = {
    id: newId(),
    at,
    who,
    tool,
    label: stepLabel(tool),
    about: aboutOf(args),
    refs: refsOf(args, value, tool),
    ok: !error,
    ...(error ? { error: String(error).split('\n')[0].slice(0, 300) } : {}),
    ...(ms != null ? { ms: Math.round(ms) } : {}),
    ...(spend ? { spend } : {}),
    ...(undo ? { undo } : {})
  }
  try {
    const file = fileFor(dataDir, at)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.appendFileSync(file, `${JSON.stringify(entry)}\n`)
  } catch {
    /* the log is a help, never a reason for the step to fail */
  }
  return entry
}

// An edit as it was before an agent changed it, so the log's Undo can put it back (agentchat.js undoEditChange reads
// the same file shape from <dir>\undo\<id>.json).
export function keepUndo(dataDir, before) {
  const id = newId()
  const dir = path.join(dataDir, ACTIVITY_FOLDER, 'undo')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(before))
  return id
}

// Steps that have been undone, kept beside the day files
const undoneFile = (dataDir) => path.join(dataDir, ACTIVITY_FOLDER, 'undone.json')
export function markUndone(dataDir, undoId) {
  const f = undoneFile(dataDir)
  let list = []
  try {
    list = JSON.parse(fs.readFileSync(f, 'utf8'))
  } catch {}
  if (!list.includes(undoId)) list.push(undoId)
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, JSON.stringify(list.slice(-2000)))
}

// The newest entries first, from the last `days` days. who: only one kind ('chat', 'idea', 'outside');
// problems: only failed steps.
export function readActivity(dataDir, { days = 7, limit = 300, who = null, problems = false, now = Date.now() } = {}) {
  const dir = path.join(dataDir, ACTIVITY_FOLDER)
  if (!fs.existsSync(dir)) return []
  let undone = new Set()
  try {
    undone = new Set(JSON.parse(fs.readFileSync(undoneFile(dataDir), 'utf8')))
  } catch {}
  const since = new Date(now - days * 86400000).toISOString().slice(0, 10)
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f) && f.slice(0, 10) >= since)
    .sort()
    .reverse()
  const out = []
  for (const f of files) {
    const lines = fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean).reverse()
    for (const line of lines) {
      let e
      try {
        e = JSON.parse(line)
      } catch {
        continue
      }
      if (who && e.who?.kind !== who) continue
      if (problems && e.ok) continue
      if (e.undo && undone.has(e.undo)) e.undone = true
      out.push(e)
      if (out.length >= limit) return out
    }
  }
  return out
}

// Day files older than KEEP_DAYS, and undo points older than that, go.
export function pruneActivity(dataDir, { now = Date.now(), keepDays = KEEP_DAYS } = {}) {
  const dir = path.join(dataDir, ACTIVITY_FOLDER)
  if (!fs.existsSync(dir)) return 0
  const cut = new Date(now - keepDays * 86400000).toISOString().slice(0, 10)
  let n = 0
  for (const f of fs.readdirSync(dir)) {
    if (/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f) && f.slice(0, 10) < cut) fs.rmSync(path.join(dir, f), { force: true }), n++
  }
  const undo = path.join(dir, 'undo')
  if (fs.existsSync(undo)) {
    for (const f of fs.readdirSync(undo)) {
      const p = path.join(undo, f)
      if (fs.statSync(p).mtimeMs < now - keepDays * 86400000) fs.rmSync(p, { force: true }), n++
    }
  }
  return n
}
