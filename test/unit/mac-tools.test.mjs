// Finding a browser, command-line tools and ollama (Mac install places), and voice setup on a Mac.
// Linux and Windows results are pinned so they stay as they were. Every path is under a temp tree.
//   node --test test/unit/mac-tools.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { onPath } from '../../src/service/harness.js'
import { ollamaExe } from '../../src/service/prompter.js'
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

describe('onPath', () => {
  test('linux: finds a tool in ~/.local/bin, not in the Homebrew folder', () => {
    const home = dir()
    const root = dir()
    touch(path.join(root, 'opt', 'homebrew', 'bin', 'ivtool'))
    assert.equal(onPath('ivtool', { PATH: '' }, home, { platform: 'linux', root }), null)
    const t = touch(path.join(home, '.local', 'bin', 'ivtool'))
    assert.equal(onPath('ivtool', { PATH: '' }, home, { platform: 'linux', root }), t)
  })
  test('darwin: the Homebrew folder is searched', () => {
    const root = dir()
    const t = touch(path.join(root, 'opt', 'homebrew', 'bin', 'ivtool'))
    assert.equal(onPath('ivtool', { PATH: '' }, dir(), { platform: 'darwin', root }), t)
  })
  test('darwin: PATH still wins over the extra folders', () => {
    const root = dir()
    const bin = dir()
    touch(path.join(root, 'opt', 'homebrew', 'bin', 'ivtool'))
    const t = touch(path.join(bin, 'ivtool'))
    assert.equal(onPath('ivtool', { PATH: bin }, dir(), { platform: 'darwin', root }), t)
  })
  test('darwin: nothing found gives null', () => assert.equal(onPath('ivtool', { PATH: '' }, dir(), { platform: 'darwin', root: dir() }), null))
})

describe('ollamaExe', () => {
  test('darwin: Ollama.app only', () => {
    const root = dir()
    const exe = touch(path.join(root, 'Applications', 'Ollama.app', 'Contents', 'Resources', 'ollama'))
    assert.equal(ollamaExe({ platform: 'darwin', home: dir(), root, env: { PATH: '' } }), exe)
  })
  test('darwin: Homebrew only', () => {
    const root = dir()
    const exe = touch(path.join(root, 'opt', 'homebrew', 'bin', 'ollama'))
    assert.equal(ollamaExe({ platform: 'darwin', home: dir(), root, env: { PATH: '' } }), exe)
  })
  test('linux: ollama on PATH is found, an app bundle and Homebrew folder are not', () => {
    const root = dir()
    touch(path.join(root, 'Applications', 'Ollama.app', 'Contents', 'Resources', 'ollama'))
    touch(path.join(root, 'opt', 'homebrew', 'bin', 'ollama'))
    const bin = dir()
    const exe = touch(path.join(bin, 'ollama'))
    assert.equal(ollamaExe({ platform: 'linux', home: dir(), root, env: { PATH: bin } }), exe)
    const none = ollamaExe({ platform: 'linux', home: dir(), root, env: { PATH: '' } })
    assert.ok(none === null || !none.startsWith(root))
  })
  test('win32: the per-user Programs\\Ollama install', () => {
    const local = dir()
    const env = { LOCALAPPDATA: local }
    assert.equal(ollamaExe({ platform: 'win32', home: dir(), root: dir(), env }), null)
    const exe = touch(path.join(local, 'Programs', 'Ollama', 'ollama.exe'))
    assert.equal(ollamaExe({ platform: 'win32', home: dir(), root: dir(), env }), exe)
  })
})
