// The page-only list (tasks 6.3 and 6.4): the channels and events that only the page tier can prove (they need a native
// dialog, a shell open, a window or Electron-held state). page-only-channels.json is { channels, events }; the twins
// (7.6) read it. It must say the same as the gaps file and the page tests. A listed name is in one of three states:
// `pending 7.x page:<id>` in the gaps file (its page test is not written yet), `needs ...` in the gaps file (it cannot
// run free), or proven by a test under test/ui whose name carries both `[page:<id>]` and its own id (no gaps entry).
// Every `ipc:` or `event:` row still `pending 7.` must be in the list, and nothing else is.
//   node --test test/unit/page-only-channels.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { rowIdsIn, scanTestNames } from './test-names.mjs'
import { parsePreload, parseRoutes } from './surfaces.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const list = JSON.parse(fs.readFileSync(path.join(root, 'test/unit/page-only-channels.json'), 'utf8'))
const gaps = JSON.parse(fs.readFileSync(path.join(root, 'test/unit/coverage-gaps.json'), 'utf8'))
const routes = parseRoutes(fs.readFileSync(path.join(root, 'src/renderer/src/App.jsx'), 'utf8')).map((r) => r.route)
const PENDING_PAGE = /^pending (7\.\d+) page:(\S+)$/

describe('page-only channels', () => {
  test('the list has a channels array and an events array with no repeats', () => {
    assert.deepEqual(Object.keys(list).sort(), ['channels', 'events'])
    for (const key of ['channels', 'events']) {
      assert.ok(Array.isArray(list[key]), key)
      assert.equal(new Set(list[key]).size, list[key].length, `${key} repeats a name`)
    }
  })

  const pageTests = () => {
    const dir = path.join(root, 'test/ui')
    const out = []
    for (const f of fs.readdirSync(dir).filter((n) => /\.test\.mjs$/.test(n))) {
      for (const t of scanTestNames(fs.readFileSync(path.join(dir, f), 'utf8'), f).tests) if (t.kind === 'test' && !t.skipped) out.push({ ...t, ids: rowIdsIn(t.name) })
    }
    return out
  }
  const stateOf = (id, tests) => {
    const reason = gaps[id]
    if (reason) return /^pending 7\./.test(reason) ? 'pending' : /^needs /.test(reason) ? 'needs' : `a gaps reason that is neither pending nor needs: ${reason}`
    return tests.some((t) => t.ids.includes(id) && t.ids.some((x) => x.startsWith('page:'))) ? 'proven' : 'nothing: no gaps entry and no page test names it'
  }

  test('every listed name is pending, needs something, or is proven by a page test, and the pending rows are all listed', () => {
    const tests = pageTests()
    for (const [prefix, names] of [['ipc', list.channels], ['event', list.events]]) {
      for (const name of names) assert.ok(['pending', 'needs', 'proven'].includes(stateOf(`${prefix}:${name}`, tests)), `${prefix}:${name} is ${stateOf(`${prefix}:${name}`, tests)}`)
      const pending = Object.keys(gaps).filter((k) => k.startsWith(`${prefix}:`) && /^pending 7\./.test(gaps[k])).map((k) => k.slice(prefix.length + 1))
      for (const name of pending) assert.ok(names.includes(name), `${prefix}:${name} is pending 7.x but is not in the page-only list`)
    }
  })

  test('a name with no gaps entry and no page test is reported, and a proven one is not', () => {
    const tests = [{ ids: ['page:settings', 'ipc:data:open'] }]
    assert.equal(stateOf('ipc:data:open', tests), 'proven')
    assert.match(stateOf('ipc:data:restart', tests), /^nothing/)
    assert.match(stateOf('ipc:data:restart', [{ ids: ['ipc:data:restart'] }]), /^nothing/, 'a test with no page id does not count')
  })

  test('each pending reason names a real page and the 7.x of that page\'s own row', () => {
    const own = (page) => /^pending (7\.\d+)$/.exec(gaps[`page:${page}`] || '')?.[1]
    for (const [prefix, names] of [['ipc', list.channels], ['event', list.events]]) {
      for (const name of names.filter((n) => /^pending 7\./.test(gaps[`${prefix}:${n}`] || ''))) {
        const m = PENDING_PAGE.exec(gaps[`${prefix}:${name}`])
        assert.ok(m, `${prefix}:${name} has a reason that is not "pending 7.x page:<id>"`)
        assert.ok(routes.includes(m[2]), `${prefix}:${name} names page ${m[2]}, which is not a page`)
        if (own(m[2])) assert.equal(m[1], own(m[2]), `${prefix}:${name} says ${m[1]} but page:${m[2]} is ${own(m[2])}`)
      }
    }
  })
})

describe('window events', () => {
  test('the channels main sends to the window are exactly the 28 event rows', () => {
    const main = fs.readFileSync(path.join(root, 'src/main/index.js'), 'utf8')
    const sent = [...new Set([...main.matchAll(/(?<![.\w])send\('([^']+)'/g)].map((m) => m[1]))].sort()
    const exposed = parsePreload(fs.readFileSync(path.join(root, 'src/preload/index.js'), 'utf8')).filter((e) => e.kind === 'on').map((e) => e.channel).sort()
    assert.equal(sent.length, 28)
    assert.deepEqual(sent, exposed)
  })
})
