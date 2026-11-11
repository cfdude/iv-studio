// The one derivation of "the surfaces" (test/unit/surfaces.mjs): MCP tools, window channels, events, pages and
// start-menu journeys, each with a source citation and a row id (design D4, D5).
//   node --test test/unit/surfaces.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { before, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { ROW_ID, parseHandled, parsePreload, surfaces } from './surfaces.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

// The counts on the pinned commit (silicon bc20f1f). tools is 168 from the server's own listTools; the design's 166 was a regex count that
// missed two. A snapshot: change these by hand, on purpose, when the code moves.
const SNAPSHOT = { tools: 168, handled: 280, exposed: 279, events: 28, routes: 29, journeys: 11 }

describe('surfaces', () => {
  let s
  before(async () => {
    s = await surfaces(root)
  })

  test('counts match the snapshot', () => {
    assert.equal(s.tools.length, SNAPSHOT.tools)
    assert.equal(s.handled.length, SNAPSHOT.handled)
    assert.equal(s.exposed.length, SNAPSHOT.exposed)
    assert.equal(s.events.length, SNAPSHOT.events)
    assert.equal(s.routes.length, SNAPSHOT.routes)
    assert.equal(s.journeys.length, SNAPSHOT.journeys)
  })

  test('protocol handlers are not channels', () => {
    const names = s.handled.map((h) => h.channel)
    assert.ok(!names.includes('ivfile') && !names.includes('ivmedia'))
  })

  test('one row per surface, every id matches the row pattern and is unique', () => {
    assert.equal(s.rows.length, SNAPSHOT.tools + SNAPSHOT.handled + SNAPSHOT.events + SNAPSHOT.routes + SNAPSHOT.journeys)
    for (const r of s.rows) assert.match(r.id, ROW_ID, r.id)
    assert.equal(new Set(s.rows.map((r) => r.id)).size, s.rows.length)
    assert.ok(s.rows.some((r) => r.id === 'mcp:check_setup'))
    assert.ok(s.rows.some((r) => r.id === 'ipc:app:info'))
    assert.ok(s.rows.some((r) => r.id === 'event:update:changed'))
    assert.ok(s.rows.some((r) => r.id === 'page:home'))
    assert.ok(s.rows.some((r) => r.id === 'journey:make_a_shot'))
  })

  test('every row cites a file:line whose text contains the surface name', () => {
    for (const r of s.rows) {
      const m = /^(.+):(\d+)$/.exec(r.source)
      assert.ok(m, `${r.id}: bad citation ${r.source}`)
      const lines = fs.readFileSync(path.join(root, m[1]), 'utf8').split('\n')
      assert.ok(lines[Number(m[2]) - 1]?.includes(r.name), `${r.id}: ${r.source} does not mention ${r.name}`)
    }
  })

  test('the only channel handled but not exposed is training:buildDataset', () => {
    const exposed = new Set(s.exposed.map((e) => e.channel))
    assert.deepEqual(s.handled.filter((h) => !exposed.has(h.channel)).map((h) => h.channel), ['training:buildDataset'])
  })
})

describe('surfaces: parsers on fixtures', () => {
  test('parsePreload follows nested object paths and tells call from on', () => {
    const text = `contextBridge.exposeInMainWorld('ivstudio', {\n  app: { info: call('app:info') },\n  update: { state: call('update:state'), onChange: on('update:changed') },\n  deep: {\n    inner: { go: call('deep:go') }\n  }\n})`
    const got = parsePreload(text).map((e) => `${e.path}=${e.kind}:${e.channel}`)
    assert.deepEqual(got, ['app.info=call:app:info', 'update.state=call:update:state', 'update.onChange=on:update:changed', 'deep.inner.go=call:deep:go'])
  })
  test('parseHandled skips protocol.handle and the handle() definition', () => {
    const text = `function handle(channel, fn) {}\nhandle('a:b', () => 1)\nprotocol.handle('ivfile', x)\n  handle("c:d", (x) => y.z(x))`
    assert.deepEqual(parseHandled(text).map((h) => h.channel), ['a:b', 'c:d'])
  })
})
