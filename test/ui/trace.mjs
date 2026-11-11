// The page tier's channel trace (task 7.5, design D10). The guard, loaded in Electron's main process, records every
// channel call the window makes (channel and argument shape, never values) in test/fakes/guard.mjs. This module turns
// that into one sequence per page or journey row, compares it with the checked-in test/unit/ui-traces.json, and is the
// only thing that may write that file.
//
//   npm run test:ui                      compares each row's live sequence with the checked-in one and fails a row that differs,
//                                        showing the difference. The file is never touched.
//   npm run test:ui -- --update-traces   rewrites the file from the live sequences (a person runs this on purpose and
//                                        commits the diff).
//
// Determinism. A row's sequence is every channel call made while that row's tests ran, in order. Polling makes the
// raw count vary from run to run (a status poll fires twice or five times, depending on timing), so the raw sequence is
// normalised before it is kept or compared, by one rule:
//   * queue:list and system:stats are left out. The always-on title bar polls them (RenderQueue.jsx every 2 s,
//     SystemMeter.jsx every few seconds) on every page, so how many land inside a row, and in what order against the
//     row's own calls, is timing. (A row cannot be proved to have called one of them; both are covered as ipc rows.)
//   * a plain read that takes no argument (a channel ending in :list or :status, called with no arguments) is kept once
//     per row, at its first call. A page re-reads such a list whenever a prop it watches changes (Create.jsx calls cast:list
//     again when the characters prop arrives), so whether the second read lands inside a row is timing too. A call
//     that does carry arguments is never collapsed this way.
//   * consecutive identical calls (same channel, same argument shape) collapse to one, after the polls are gone.
// An argument shape never holds a value, and a key that is a generated id is written <id> (test/fakes/guard.mjs).
// Order is otherwise kept, and a call with a different argument shape is a different call. Calls the window makes
// between tests, or while the app starts, are not part of any row. A row that has several tests (a page with one test per
// channel it proves) is those tests' calls joined, in the order the tests ran.
// A row whose test did not pass (a todo, a failure) is neither compared nor recorded.
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach } from 'node:test'
import { fileURLToPath } from 'node:url'
import { rowIdsIn, scanTestNames } from '../unit/test-names.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
export const TRACE_FILE = process.env.IV_UI_TRACES || path.resolve(here, '../unit/ui-traces.json')
export const updating = () => process.env.IV_UPDATE_TRACES === '1'
const KEY = (c) => `${c.channel} ${c.args}`

// the channels the title bar polls on every page
export const POLLED = ['queue:list', 'system:stats']

// a read with no arguments: only its first call in a row is kept
const PLAIN_READ = (c) => /:(list|status)$/.test(c.channel) && c.args === '[]'

// the rule in the header: polls dropped, repeat plain reads dropped, then consecutive identical calls collapsed
export function normalize(calls) {
  const out = []
  const read = new Set()
  for (const c of calls) {
    if (POLLED.includes(c.channel)) continue
    if (PLAIN_READ(c)) {
      if (read.has(c.channel)) continue
      read.add(c.channel)
    }
    const last = out.at(-1)
    if (!last || last.channel !== c.channel || last.args !== c.args) out.push({ channel: c.channel, args: c.args })
  }
  return out
}

// A line-by-line difference of two sequences (longest common subsequence): `- call` for one the checked-in trace has
// and the run did not make, `+ call` for one the run made that the trace lacks.
export function compareTraces(expected, live) {
  const a = expected.map(KEY)
  const b = live.map(KEY)
  const n = a.length
  const m = b.length
  const len = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) len[i][j] = a[i] === b[j] ? len[i + 1][j + 1] + 1 : Math.max(len[i + 1][j], len[i][j + 1])
  const removed = []
  const added = []
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) (i++, j++)
    else if (j < m && (i === n || len[i][j + 1] >= len[i + 1][j])) added.push(`  + ${b[j]}   (call ${j + 1} of the run, after ${j ? b[j - 1] : 'the start'})`), j++
    else removed.push(`  - ${a[i]}   (call ${i + 1} of the checked-in trace, not seen in the run)`), i++
  }
  if (!removed.length && !added.length) return { same: true, diff: '' }
  return { same: false, diff: [...removed, ...added].join('\n') }
}

// The calls a row owns: everything from its mark on, and, for the first row after a launch that asks for it
// (`startup` = how many calls had landed when the window's start-up settled), those start-up calls first. The calls other
// tests made in between belong to no row.
export const rowCalls = (trace, { mark, startup = 0 }) => [...trace.slice(0, startup), ...trace.slice(mark)]

// Returns once the window has stopped making calls: the main process has none open, and a few turns of the page in a
// row brought no new call (the polls do not count). It is a barrier, not a sleep: each turn lets the page run what it
// has queued (an effect that fires after an answer arrives). It cannot see a timer the page set for later, which is why
// the polls are left out of a row and the rest are not allowed to be long. Throws after `maxMs` of wall clock, saying
// whether calls were still arriving or still open (a loop of calls, or a handler that never answers, is worth a failure).
//   w: { trace() the calls so far, inflight() the calls open in the main process, turn() one turn of the page }
export async function untilCallsSettle(w, { quiet = 5, maxTurns = Infinity, maxMs = 30000 } = {}) {
  const made = () => w.trace().filter((c) => !POLLED.includes(c.channel)).length
  const until = Date.now() + maxMs
  let last = -1
  let still = 0
  let open = 0
  for (let i = 0; i < maxTurns && Date.now() < until; i++) {
    await w.turn()
    const n = made()
    open = await w.inflight()
    if (n === last && open === 0) still++
    else still = 0
    last = n
    if (still >= quiet) return
  }
  throw new Error(`the window was still making calls (last: ${w.trace().at(-1)?.channel}) or the main process still had ${open} open after ${maxMs} ms`)
}

export function readTraces(file = TRACE_FILE) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (e) {
    if (e.code === 'ENOENT') return null
    throw e
  }
}

// One row's live calls against the file. A normal run (update false) compares and throws on a difference or a missing
// row, and never writes. An update run writes the normalised calls under the row id, keeps the other rows, sorts the
// keys, and (given `known`, the set of rows some test names) drops rows nothing names any more.
export function checkRow({ file = TRACE_FILE, id, calls, update, known = null }) {
  const live = normalize(calls)
  const all = readTraces(file)
  if (update) {
    const next = { ...(all || {}), [id]: live }
    if (known) for (const k of Object.keys(next)) if (!known.has(k)) delete next[k]
    const sorted = Object.fromEntries(Object.keys(next).sort().map((k) => [k, next[k]]))
    const text = `${JSON.stringify(sorted, null, 2)}\n`
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) fs.writeFileSync(file, text)
    return { updated: true }
  }
  const expected = all?.[id]
  if (!expected) throw new Error(`${id} has no checked-in trace in ${file}. If its calls are what you expect, run \`npm run test:ui -- --update-traces\` and commit the file.`)
  const { same, diff } = compareTraces(expected, live)
  if (!same) throw new Error(`${id}: the window's channel calls differ from the checked-in trace in ${file}:\n${diff}\nIf the change is intended, run \`npm run test:ui -- --update-traces\` and commit the file.`)
  return { updated: false }
}

// ---------- in a page-tier test file ----------

const isRow = (id) => /^(page|journey):/.test(id)

// Every page and journey id a non-skipped test under test/ui names (the rows an update run keeps).
export function knownRows(dir = here) {
  const ids = new Set()
  for (const f of fs.readdirSync(dir).filter((n) => /\.test\.mjs$/.test(n))) {
    for (const t of scanTestNames(fs.readFileSync(path.join(dir, f), 'utf8'), f).tests) if (t.kind === 'test' && !t.skipped) for (const id of rowIdsIn(t.name).filter(isRow)) ids.add(id)
  }
  return ids
}

// Call inside a describe, with import.meta.url and a function returning that describe's launched app. Each test whose
// name carries a `[page:<id>]` or `[journey:<id>]` has the calls made during it added to that row; when the row's last
// test ends, the row is compared (or, on an update run, recorded). A mismatch fails that last test, naming the row.
export function traceRows(fileUrl, getApp, { file = TRACE_FILE, update = updating(), startup = false } = {}) {
  const tests = scanTestNames(fs.readFileSync(fileURLToPath(fileUrl), 'utf8'), 'file').tests.filter((t) => t.kind === 'test' && !t.skipped)
  const left = new Map()
  for (const t of tests) for (const id of rowIdsIn(t.name).filter(isRow)) left.set(id, (left.get(id) || 0) + 1)
  const rows = new Map()
  const known = update ? knownRows() : null
  let mark = 0
  let first = true // the first row test after the launch owns the start-up calls, when `startup` is set
  // Both ends wait for the window to stop calling first, so a call the page makes late (its start-up, an effect after an
  // answer) is in the row whose test caused it and never in the next one, whatever the machine's speed.
  beforeEach(async () => {
    await getApp().calmed()
    mark = getApp().ipcTrace().length
  })
  afterEach(async (t) => {
    const ids = rowIdsIn(t.name).filter(isRow)
    if (!ids.length) return
    await getApp().calmed()
    const own = first && startup
    first = false
    const calls = rowCalls(getApp().ipcTrace(), { mark, startup: own ? getApp().startupCalls : 0 })
    const problems = []
    for (const id of ids) {
      const row = rows.get(id) || { calls: [], failed: false }
      rows.set(id, row)
      row.calls.push(...calls)
      if (!t.passed) row.failed = true
      left.set(id, left.get(id) - 1)
      if (left.get(id) > 0 || row.failed) continue
      try {
        checkRow({ file, id, calls: row.calls, update, known })
      } catch (e) {
        problems.push(e.message)
      }
    }
    if (problems.length) throw new Error(problems.join('\n\n'))
  })
}
