// The mocked twin's checks (task 7.6, design D10). A page's or journey's recorded trace (test/unit/ui-traces.json) is a
// list of channel calls in order; the twin, with no window, checks each one against the source:
//   exposed       src/preload/index.js gives the channel to the window,
//   handled       src/main/index.js handles it, and test/unit/ipc-map.mjs maps it to a service method (or lists it for
//                 hand mapping),
//   covered       a default-suite test names its `[ipc:<channel>]` row (6.2 and 6.3 put the id on the test that proves the
//                 service method), or, when the only proof is a refusal (the gaps reason says `spawns ...` or `needs ...`,
//                 and a row-less guard test proves the refusal), the step is skipped and says so.
// A channel in test/unit/page-only-channels.json is checked for the first two only: it needs a dialog, a shell open, a
// window or Electron-held state, so it has no service method to run here, and the step says it was skipped.
// A render-free channel with an entry in test/unit/ui-channel-fixtures.json is also called on the fake, in trace order.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mapIpc } from './ipc-map.mjs'
import { parsePreload } from './surfaces.mjs'
import { rowIdsIn, scanTestNames } from './test-names.mjs'

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8')

// What the source says, once: { exposed, handled, pageOnly, covered, gaps }.
export function twinContext(root = defaultRoot) {
  const exposed = new Set(parsePreload(read(root, 'src/preload/index.js')).filter((e) => e.kind === 'call').map((e) => e.channel))
  const { mapped, hand } = mapIpc(read(root, 'src/main/index.js'))
  const handled = new Map()
  for (const m of mapped) handled.set(m.channel, { kind: 'mapped', className: m.className, method: m.method, receiver: m.receiver, line: m.line })
  for (const h of hand) handled.set(h.channel, { kind: 'hand', line: h.line })
  const pageOnly = new Set(JSON.parse(read(root, 'test/unit/page-only-channels.json')).channels)
  const covered = new Set()
  const dir = path.join(root, 'test/unit')
  for (const f of fs.readdirSync(dir).filter((n) => /\.test\.mjs$/.test(n))) {
    for (const t of scanTestNames(fs.readFileSync(path.join(dir, f), 'utf8'), f).tests) if (t.kind === 'test' && !t.skipped) for (const id of rowIdsIn(t.name)) covered.add(id)
  }
  const gaps = JSON.parse(read(root, 'test/unit/coverage-gaps.json'))
  return { exposed, handled, pageOnly, covered, gaps }
}

// One trace against the context. Returns { steps: [{ channel, status, note }], problems: [line] }, both in trace order.
// status: 'checked' | 'page-only' | 'refused'.
export function checkTrace(calls, ctx) {
  const steps = []
  const problems = []
  for (const { channel } of calls) {
    const entry = ctx.handled.get(channel)
    const here = []
    if (!ctx.exposed.has(channel)) here.push('not exposed (src/preload/index.js does not give it to the window)')
    if (!entry) here.push('not handled (src/main/index.js has no handler for it)')
    if (here.length) {
      const why = `${channel}: ${here.join('; ')}`
      problems.push(why)
      steps.push({ channel, status: 'failed', note: why })
      continue
    }
    if (ctx.pageOnly.has(channel)) {
      steps.push({ channel, status: 'page-only', note: 'page-only: exposed and handled; the service method and coverage checks are skipped' })
      continue
    }
    const target = entry.kind === 'mapped' ? `${entry.className}.${entry.method}` : 'its hand-listed handler'
    if (ctx.covered.has(`ipc:${channel}`)) {
      steps.push({ channel, status: 'checked', note: `exposed, handled, ${target}, covered` })
      continue
    }
    const reason = ctx.gaps[`ipc:${channel}`]
    if (/^(spawns|needs) /.test(reason || '')) {
      steps.push({ channel, status: 'refused', note: `skipped: cannot run free (${reason}); its refusal is proven by a guard test` })
      continue
    }
    const why = `${channel}: no default-suite test covers ${target} (no test names [ipc:${channel}]${reason ? `; gaps entry: ${reason}` : ''})`
    problems.push(why)
    steps.push({ channel, status: 'failed', note: why })
  }
  return { steps, problems }
}

// Calls the service method of every step that has a fixture, in trace order. `services` is { ClassName: instance } built
// on the fake. A page-only channel is never called. Returns [{ channel, method, result }] for the calls made.
export async function runFixtures(steps, fixtures, ctx, services) {
  const done = []
  for (const { channel } of steps) {
    const fixture = fixtures[channel]
    if (!fixture || ctx.pageOnly.has(channel)) continue
    const entry = ctx.handled.get(channel)
    if (entry?.kind !== 'mapped') throw new Error(`${channel}: has a fixture but no service method (main handles it itself)`)
    const service = services[entry.className]
    if (!service) throw new Error(`${channel}: no ${entry.className} was built on the fake for its fixture`)
    let result
    try {
      result = await service[entry.method](...(fixture.args || []))
    } catch (e) {
      throw new Error(`${channel}: ${entry.className}.${entry.method} failed on the fake: ${e.message}`)
    }
    done.push({ channel, method: `${entry.className}.${entry.method}`, result })
  }
  return done
}

// A whole twin: the row's trace (a row with none fails, naming how to record one), each channel checked in trace order,
// then the fixtures called on the fake in trace order. Returns the checked steps. Throws on any problem.
export async function twinRow(id, { traces, ctx, fixtures, services }) {
  const calls = traces[id]
  if (!Array.isArray(calls)) throw new Error(`${id} has no trace in test/unit/ui-traces.json: run \`npm run test:ui -- --update-traces\` and commit the file`)
  const { steps, problems } = checkTrace(calls, ctx)
  if (problems.length) throw new Error(`${id}: the trace names a channel the app cannot serve:\n  ${problems.join('\n  ')}`)
  const done = await runFixtures(steps, fixtures, ctx, services)
  const wanted = steps.filter((s) => s.status === 'checked' && fixtures[s.channel]).map((s) => s.channel)
  if (done.map((d) => d.channel).join() !== wanted.join()) throw new Error(`${id}: the fixtures did not run in trace order`)
  return steps
}
