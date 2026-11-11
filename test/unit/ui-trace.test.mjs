// The page tier's channel trace (task 7.5, design D10): how a row's live sequence is normalised, compared with the
// checked-in test/unit/ui-traces.json, and when that file may change. Everything here runs on fixture traces in temp
// files; the real ui-traces.json is never written by a test. The window itself is `npm run test:ui`.
//   node --test test/unit/ui-trace.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'
import { checkRow, compareTraces, normalize, POLLED, readTraces } from '../ui/trace.mjs'
import { tempDirReal } from '../fakes/tmp.mjs'

const c = (channel, args = '[]') => ({ channel, args })
const temp = () => path.join(tempDirReal('iv-traces-'), 'ui-traces.json')
const put = (file, body) => fs.writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`)

describe('trace: what is kept of a live sequence', () => {
  test('consecutive repeats of one call collapse to one, so a poll that fires twice or five times is the same trace', () => {
    const live = [c('setup:check'), c('music:status'), c('music:status'), c('music:status'), c('setup:check')]
    assert.deepEqual(normalize(live), [c('setup:check'), c('music:status'), c('setup:check')])
  })

  test('the two channels the always-on title bar polls are left out, wherever they fall, so timing cannot change a trace', () => {
    assert.deepEqual(POLLED, ['queue:list', 'system:stats'])
    const live = [c('system:stats'), c('setup:check'), c('queue:list'), c('system:stats'), c('queue:list'), c('data:info')]
    assert.deepEqual(normalize(live), [c('setup:check'), c('data:info')])
    // a poll between two identical calls does not stop them collapsing
    assert.deepEqual(normalize([c('a'), c('queue:list'), c('a')]), [c('a')])
  })

  test('the same channel with a different argument shape is a different call and is kept', () => {
    const live = [c('render:plan', '[{prompt:string}]'), c('render:plan', '[{character:string,prompt:string}]')]
    assert.deepEqual(normalize(live), live)
  })

  test('the order of different calls is kept, and an empty sequence stays empty', () => {
    assert.deepEqual(normalize([c('b'), c('a')]), [c('b'), c('a')])
    assert.deepEqual(normalize([]), [])
  })
})

describe('trace: comparing a live sequence with the checked-in one', () => {
  test('equal sequences are the same and have no difference to show', () => {
    const r = compareTraces([c('a'), c('b')], [c('a'), c('b')])
    assert.deepEqual(r, { same: true, diff: '' })
  })

  test('a fixture trace with one channel removed fails, and the difference names that channel', () => {
    const r = compareTraces([c('a'), c('b'), c('c')], [c('a'), c('c')])
    assert.equal(r.same, false)
    assert.match(r.diff, /- b \[\]/)
    assert.doesNotMatch(r.diff, /\+ /)
    assert.match(r.diff, /not seen/i)
  })

  test('a channel the live run made that the trace lacks is shown as added, with the one it follows', () => {
    const r = compareTraces([c('a'), c('c')], [c('a'), c('b'), c('c')])
    assert.equal(r.same, false)
    assert.match(r.diff, /\+ b \[\]/)
    assert.doesNotMatch(r.diff, /- /)
  })

  test('a changed argument shape shows as one removed and one added', () => {
    const r = compareTraces([c('x', '[string]')], [c('x', '[number]')])
    assert.match(r.diff, /- x \[string\]/)
    assert.match(r.diff, /\+ x \[number\]/)
  })

  test('the same calls in another order are different', () => {
    assert.equal(compareTraces([c('a'), c('b')], [c('b'), c('a')]).same, false)
  })
})

describe('trace: when ui-traces.json is read and when it is written', () => {
  test('a normal run that matches leaves the file byte for byte as it was', () => {
    const file = temp()
    put(file, { 'page:home': [c('a'), c('b')] })
    const before = fs.readFileSync(file)
    const mtime = fs.statSync(file).mtimeMs
    assert.deepEqual(checkRow({ file, id: 'page:home', calls: [c('a'), c('b'), c('b')], update: false }), { updated: false })
    assert.deepEqual(fs.readFileSync(file), before)
    assert.equal(fs.statSync(file).mtimeMs, mtime)
  })

  test('a normal run whose sequence differs fails that row, shows the difference, and leaves the file untouched', () => {
    const file = temp()
    put(file, { 'page:home': [c('a'), c('b'), c('c')], 'journey:x': [c('z')] })
    const before = fs.readFileSync(file)
    assert.throws(
      () => checkRow({ file, id: 'page:home', calls: [c('a'), c('c')], update: false }),
      (e) => {
        assert.match(e.message, /page:home/)
        assert.match(e.message, /- b \[\]/)
        assert.match(e.message, /--update-traces/)
        return true
      }
    )
    assert.deepEqual(fs.readFileSync(file), before)
  })

  test('a normal run for a row with no checked-in trace fails and says how to record one, writing nothing', () => {
    const file = temp()
    put(file, {})
    assert.throws(() => checkRow({ file, id: 'page:new', calls: [c('a')], update: false }), /page:new has no checked-in trace.*--update-traces/s)
    assert.deepEqual(readTraces(file), {})
  })

  test('a normal run with no ui-traces.json at all fails the same way and does not create it', () => {
    const file = temp()
    assert.throws(() => checkRow({ file, id: 'page:new', calls: [], update: false }), /has no checked-in trace/)
    assert.equal(fs.existsSync(file), false)
  })

  test('an update run rewrites the file with the live sequence, keeps the other rows, and keeps the keys sorted', () => {
    const file = temp()
    put(file, { 'page:b': [c('old')], 'page:z': [c('keep')] })
    assert.deepEqual(checkRow({ file, id: 'page:a', calls: [c('x'), c('x'), c('y')], update: true }), { updated: true })
    assert.deepEqual(checkRow({ file, id: 'page:b', calls: [c('new')], update: true }), { updated: true })
    assert.deepEqual(readTraces(file), { 'page:a': [c('x'), c('y')], 'page:b': [c('new')], 'page:z': [c('keep')] })
    assert.deepEqual(Object.keys(readTraces(file)), ['page:a', 'page:b', 'page:z'])
    assert.ok(fs.readFileSync(file, 'utf8').endsWith('}\n'))
  })

  test('an update run drops rows that no test names any more, when it is told which rows exist', () => {
    const file = temp()
    put(file, { 'page:gone': [c('a')], 'page:here': [c('b')] })
    checkRow({ file, id: 'page:here', calls: [c('b')], update: true, known: new Set(['page:here']) })
    assert.deepEqual(Object.keys(readTraces(file)), ['page:here'])
  })

  test('an update run creates the file when there is none', () => {
    const file = temp()
    checkRow({ file, id: 'journey:y', calls: [c('a')], update: true })
    assert.deepEqual(readTraces(file), { 'journey:y': [c('a')] })
  })
})
