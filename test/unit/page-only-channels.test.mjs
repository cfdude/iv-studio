// The page-only list (tasks 6.3 and 6.4): the channels and events that only the page tier can prove (they need a native
// dialog, a shell open, a window or Electron-held state). page-only-channels.json is { channels, events }; the twins
// (7.6) read it. It must say the same as the gaps file: every `ipc:` row whose reason starts `pending 7.` is a channel
// in the list, every `event:` row like it is an event in the list, and nothing else is.
//   node --test test/unit/page-only-channels.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { parseRoutes } from './surfaces.mjs'

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

  test('the channels are the ipc rows whose gaps reason says pending 7.x, and the events are the event rows that do', () => {
    const pendingPage = (prefix) => Object.keys(gaps).filter((k) => k.startsWith(`${prefix}:`) && /^pending 7\./.test(gaps[k])).map((k) => k.slice(prefix.length + 1))
    assert.deepEqual([...list.channels].sort(), pendingPage('ipc').sort())
    assert.deepEqual([...list.events].sort(), pendingPage('event').sort())
  })

  test('each reason names a real page and the 7.x of that page\'s own row', () => {
    const own = (page) => /^pending (7\.\d+)$/.exec(gaps[`page:${page}`] || '')?.[1]
    for (const [prefix, names] of [['ipc', list.channels], ['event', list.events]]) {
      for (const name of names) {
        const m = PENDING_PAGE.exec(gaps[`${prefix}:${name}`] || '')
        assert.ok(m, `${prefix}:${name} has a reason that is not "pending 7.x page:<id>"`)
        assert.ok(routes.includes(m[2]), `${prefix}:${name} names page ${m[2]}, which is not a page`)
        if (own(m[2])) assert.equal(m[1], own(m[2]), `${prefix}:${name} says ${m[1]} but page:${m[2]} is ${own(m[2])}`)
      }
    }
  })
})
