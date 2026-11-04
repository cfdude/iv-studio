// Finding a browser, command-line tools and ollama (Mac install places), and voice setup on a Mac.
// Linux and Windows results are pinned so they stay as they were. Every path is under a temp tree.
//   node --test test/unit/mac-tools.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { findBrowser } from '../../src/service/shinobi.js'

let tmp
let n = 0
const touch = (p) => {
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, '')
  return p
}
const dir = () => fs.mkdtempSync(path.join(tmp, `d${n++}-`))
before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-mactools-'))
})
after(() => fs.rmSync(tmp, { recursive: true, force: true }))

describe('findBrowser', () => {
  test('darwin: Chrome inside its bundle', () => {
    const root = dir()
    const chrome = touch(path.join(root, 'Applications', 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome'))
    assert.equal(findBrowser('darwin', { PATH: '' }, { home: dir(), root }), chrome)
  })
  test('darwin: Brave under ~/Applications', () => {
    const home = dir()
    const brave = touch(path.join(home, 'Applications', 'Brave Browser.app', 'Contents', 'MacOS', 'Brave Browser'))
    assert.equal(findBrowser('darwin', { PATH: '' }, { home, root: dir() }), brave)
  })
  test('darwin: none found gives null', () => assert.equal(findBrowser('darwin', { PATH: '' }, { home: dir(), root: dir() }), null))
  test('linux: a browser on PATH is found', () => {
    const bin = dir()
    const chromium = touch(path.join(bin, 'chromium'))
    assert.equal(findBrowser('linux', { PATH: bin }), chromium)
  })
  test('linux ignores app bundles', () => {
    const root = dir()
    touch(path.join(root, 'Applications', 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome'))
    const got = findBrowser('linux', { PATH: dir() }, { home: dir(), root })
    assert.ok(got === null || !got.includes('.app'))
  })
  test('win32: Edge under Program Files, none gives null', () => {
    const pf = dir()
    assert.equal(findBrowser('win32', { ProgramFiles: pf }), null)
    const edge = touch(path.join(pf, 'Microsoft/Edge/Application/msedge.exe'))
    assert.equal(findBrowser('win32', { ProgramFiles: pf }), edge)
  })
  test('win32 ignores app bundles', () => {
    const root = dir()
    touch(path.join(root, 'Applications', 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome'))
    assert.equal(findBrowser('win32', {}, { home: dir(), root }), null)
  })
})
