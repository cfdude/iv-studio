// The full tour walks the sidebar in the sidebar's own order (Projects, then Shots, then Edit).
//   node --test test/unit/tours-order.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { describe, test } from 'node:test'
import { TOURS } from '../../src/renderer/src/tours.js'

describe('full tour order', () => {
  test('visits the video pages in the order the sidebar lists them', () => {
    const app = fs.readFileSync('src/renderer/src/App.jsx', 'utf8')
    const side = [...app.matchAll(/^\s*\['(\w+)', '[^']+'\],?$/gm)].map((m) => m[1])
    const tour = TOURS.full.steps.map((s) => s.go?.page).filter(Boolean)
    const shared = (list) => list.filter((p) => ['create', 'projects', 'library', 'edits', 'workflows', 'characters'].includes(p))
    const want = shared(side)
    assert.ok(want.indexOf('projects') < want.indexOf('library'), 'the sidebar lists Projects before Shots')
    assert.deepEqual([...new Set(shared(tour))], [...new Set(want)].filter((p) => tour.includes(p)))
  })
})
