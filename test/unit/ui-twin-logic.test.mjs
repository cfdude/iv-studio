// The mocked twin's logic (task 7.6, design D10), on fixture traces and a small made-up app: in trace order, each
// channel must be exposed to the window, handled by main, mapped to a service method, and that method covered by a
// default-suite test. A page-only channel is only checked for the first two. Tests naming a real page or journey are
// in ui-twins.test.mjs; these prove the checks themselves can fail.
//   node --test test/unit/ui-twin-logic.test.mjs
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { checkTrace, runFixtures, twinContext, twinRow } from './ui-twin.mjs'

const c = (channel, args = '[]') => ({ channel, args })
const ctx = {
  exposed: new Set(['queue:list', 'setup:check', 'render:plan', 'data:open', 'shinobi:presets', 'voices:list', 'sizzle:create']),
  handled: new Map([
    ['queue:list', { kind: 'mapped', className: 'Studio', method: 'renderQueue' }],
    ['setup:check', { kind: 'mapped', className: 'Studio', method: 'checkSetup' }],
    ['render:plan', { kind: 'mapped', className: 'Studio', method: 'planRender' }],
    ['data:open', { kind: 'hand' }],
    ['shinobi:presets', { kind: 'hand' }],
    ['voices:list', { kind: 'hand' }],
    ['sizzle:create', { kind: 'mapped', className: 'Sizzles', method: 'create' }],
    ['not:exposed', { kind: 'mapped', className: 'Studio', method: 'nothing' }]
  ]),
  pageOnly: new Set(['data:open']),
  covered: new Set(['ipc:queue:list', 'ipc:setup:check', 'ipc:voices:list']),
  gaps: { 'ipc:shinobi:presets': 'spawns python', 'ipc:render:plan': 'pending 6.2', 'ipc:sizzle:create': 'spawns a browser' }
}

describe('twin: a trace is checked in order', () => {
  test('a trace of exposed, handled and covered channels passes, and each step is reported in trace order', () => {
    const r = checkTrace([c('setup:check'), c('voices:list'), c('queue:list')], ctx)
    assert.deepEqual(r.problems, [])
    assert.deepEqual(r.steps.map((s) => s.channel), ['setup:check', 'voices:list', 'queue:list'])
    assert.deepEqual(r.steps.map((s) => s.status), ['checked', 'checked', 'checked'])
  })

  test('a fixture trace naming a channel the window is not given fails, naming the channel', () => {
    const r = checkTrace([c('setup:check'), c('ghost:channel')], ctx)
    assert.equal(r.problems.length, 1)
    assert.match(r.problems[0], /ghost:channel/)
    assert.match(r.problems[0], /not exposed|not given to the window/)
  })

  test('a channel that is exposed but that main does not handle fails, naming the channel', () => {
    const open = { ...ctx, exposed: new Set([...ctx.exposed, 'orphan:call']) }
    const r = checkTrace([c('orphan:call')], open)
    assert.match(r.problems.join('\n'), /orphan:call.*not handled/)
  })

  test('a channel that is handled but not exposed fails too', () => {
    const r = checkTrace([c('not:exposed')], ctx)
    assert.match(r.problems.join('\n'), /not:exposed.*not (exposed|given to the window)/)
  })

  test('a fixture trace naming a channel with no covered method fails, naming the channel and its method', () => {
    const r = checkTrace([c('setup:check'), c('render:plan')], ctx)
    assert.equal(r.problems.length, 1)
    assert.match(r.problems[0], /render:plan/)
    assert.match(r.problems[0], /Studio\.planRender/)
    assert.match(r.problems[0], /no default-suite test/)
  })

  test('a fixture trace naming a page-only channel passes, and says the method and coverage checks were skipped', () => {
    const r = checkTrace([c('data:open')], ctx)
    assert.deepEqual(r.problems, [])
    assert.equal(r.steps[0].status, 'page-only')
    assert.match(r.steps[0].note, /skipped/)
  })

  test('a page-only channel that is not exposed or not handled still fails', () => {
    const r = checkTrace([c('data:open')], { ...ctx, exposed: new Set(), handled: new Map() })
    assert.equal(r.problems.length, 1)
    assert.match(r.problems[0], /data:open/)
  })

  test('a channel whose only default-suite proof is a refusal (a gaps reason that says spawns or needs) is skipped, saying why', () => {
    const r = checkTrace([c('shinobi:presets'), c('sizzle:create')], ctx)
    assert.deepEqual(r.problems, [])
    assert.deepEqual(r.steps.map((s) => s.status), ['refused', 'refused'])
    assert.match(r.steps[0].note, /spawns python/)
  })

  test('a gaps reason that is not a refusal (pending) does not excuse a missing test', () => {
    const r = checkTrace([c('render:plan')], ctx)
    assert.equal(r.problems.length, 1)
  })

  test('every problem is reported, not just the first', () => {
    const r = checkTrace([c('ghost:one'), c('render:plan'), c('ghost:two')], ctx)
    assert.equal(r.problems.length, 3)
  })

  test('an empty trace passes with no steps', () => {
    assert.deepEqual(checkTrace([], ctx), { steps: [], problems: [] })
  })
})

describe('twin: fixtures call the service method on the fake, in trace order', () => {
  const steps = [{ channel: 'setup:check' }, { channel: 'data:open' }, { channel: 'render:plan' }, { channel: 'setup:check' }, { channel: 'queue:list' }]
  const fixtures = { 'setup:check': { args: [] }, 'render:plan': { args: [{ prompt: 'a' }, 'x'] } }

  test('each channel with a fixture is called with its arguments, in the order of the trace, once per place it appears', async () => {
    const calls = []
    const studio = new Proxy({}, { get: (_t, method) => async (...args) => (calls.push([method, args]), { ok: true }) })
    const done = await runFixtures(steps, fixtures, ctx, { Studio: studio })
    assert.deepEqual(calls, [['checkSetup', []], ['planRender', [{ prompt: 'a' }, 'x']], ['checkSetup', []]])
    assert.deepEqual(done.map((d) => d.channel), ['setup:check', 'render:plan', 'setup:check'])
  })

  test('a channel with no fixture is not called, and a page-only channel is never called even if it has one', async () => {
    const calls = []
    const studio = new Proxy({}, { get: (_t, method) => async () => void calls.push(method) })
    await runFixtures([{ channel: 'data:open' }, { channel: 'queue:list' }], { 'data:open': { args: [] } }, ctx, { Studio: studio })
    assert.deepEqual(calls, [])
  })

  test('a fixture whose service was not built on the fake fails, naming the channel', async () => {
    await assert.rejects(() => runFixtures([{ channel: 'sizzle:create' }], { 'sizzle:create': { args: [] } }, ctx, { Studio: {} }), /sizzle:create.*Sizzles/)
  })

  test('a service method that throws fails with the channel named', async () => {
    const studio = { checkSetup: async () => { throw new Error('boom') } }
    await assert.rejects(() => runFixtures([{ channel: 'setup:check' }], fixtures, ctx, { Studio: studio }), /setup:check.*boom/)
  })
})

describe('twin: the context is read from source', () => {
  // v1.1.3's setup:check handler spans lines (it is hand-listed now), so the one-line example is sequences:list
  test('it knows the real channels: ipc:sequences:list is exposed, handled by Studio.listSequences, setup:check is hand-listed, and data:open is page-only', () => {
    const real = twinContext()
    assert.ok(real.exposed.has('sequences:list'))
    assert.deepEqual(real.handled.get('sequences:list'), { kind: 'mapped', className: 'Studio', method: 'listSequences', receiver: 'studio', line: real.handled.get('sequences:list').line })
    assert.equal(real.handled.get('setup:check').kind, 'hand')
    assert.equal(real.handled.get('data:info').kind, 'hand')
    assert.ok(real.pageOnly.has('data:open'))
    assert.ok(real.covered.has('ipc:sequences:list'))
    assert.ok(!real.exposed.has('ghost:channel'))
  })
})

describe('twin: a whole row', () => {
  const studio = { checkSetup: async () => ({ ready: true }) }
  const env = (traces) => ({ traces, ctx, fixtures: { 'setup:check': { args: [] } }, services: { Studio: studio } })

  test('a row with no trace fails, saying how to record one', async () => {
    await assert.rejects(() => twinRow('page:new', env({})), /page:new has no trace.*--update-traces/)
  })

  test('a row whose trace names an unexposed channel fails with the row and the channel named', async () => {
    await assert.rejects(() => twinRow('page:x', env({ 'page:x': [c('setup:check'), c('ghost:channel')] })), /page:x.*ghost:channel/s)
  })

  test('a row of covered and page-only channels passes and returns its steps in trace order', async () => {
    const steps = await twinRow('page:x', env({ 'page:x': [c('data:open'), c('setup:check')] }))
    assert.deepEqual(steps.map((s) => s.channel), ['data:open', 'setup:check'])
  })
})
