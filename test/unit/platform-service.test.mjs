// src/service/platform.js (finders, with { platform, home, root, env }) and the data/renders folders.
// Every path is under a temp root/home so this Mac's real apps never leak in.
//   node --test test/unit/platform-service.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import * as plat from '../../src/service/platform.js'

let tmp, root, home
const touch = (p) => {
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, '')
}
before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-platform-'))
  root = path.join(tmp, 'root')
  home = path.join(tmp, 'home')
  fs.mkdirSync(root)
  fs.mkdirSync(home)
})
after(() => fs.rmSync(tmp, { recursive: true, force: true }))

describe('macVideosDir', () => {
  test('~/Movies/IV Studio', () => assert.equal(plat.macVideosDir({ home: '/Users/me' }), path.join('/Users/me', 'Movies', 'IV Studio')))
})

describe('comfyBundles', () => {
  test('darwin finds the app in /Applications and ~/Applications, labelled', () => {
    const r = fs.mkdtempSync(path.join(tmp, 'r-'))
    const h = fs.mkdtempSync(path.join(tmp, 'h-'))
    fs.mkdirSync(path.join(r, 'Applications', 'Comfy Desktop.app'), { recursive: true })
    fs.mkdirSync(path.join(h, 'Applications', 'ComfyUI.app'), { recursive: true })
    const got = plat.comfyBundles({ platform: 'darwin', home: h, root: r })
    assert.deepEqual(got, [
      { path: path.join(r, 'Applications', 'Comfy Desktop.app'), label: 'Comfy Desktop (app)' },
      { path: path.join(h, 'Applications', 'ComfyUI.app'), label: 'Comfy Desktop (app)' }
    ])
  })
  test('darwin with no bundle gives an empty list', () => assert.deepEqual(plat.comfyBundles({ platform: 'darwin', home, root }), []))
  for (const p of ['linux', 'win32']) {
    test(`${p} never lists bundles`, () => {
      const r = fs.mkdtempSync(path.join(tmp, 'r-'))
      fs.mkdirSync(path.join(r, 'Applications', 'Comfy Desktop.app'), { recursive: true })
      assert.deepEqual(plat.comfyBundles({ platform: p, home, root: r }), [])
    })
  }
})

describe('browser finder', () => {
  const chrome = (r) => path.join(r, 'Applications', 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome')
  test('darwin: Chrome found', () => {
    const r = fs.mkdtempSync(path.join(tmp, 'r-'))
    touch(chrome(r))
    assert.equal(plat.findBrowser({ platform: 'darwin', home, root: r }), chrome(r))
  })
  test('darwin: Edge, Chromium and Brave are candidates, in ~/Applications too', () => {
    const c = plat.browserCandidates({ platform: 'darwin', home: '/h', root: '/r' })
    for (const name of ['Google Chrome', 'Microsoft Edge', 'Chromium', 'Brave Browser']) {
      assert.ok(c.includes(path.join('/r', 'Applications', `${name}.app`, 'Contents', 'MacOS', name)), name)
      assert.ok(c.includes(path.join('/h', 'Applications', `${name}.app`, 'Contents', 'MacOS', name)), `~ ${name}`)
    }
  })
  test('darwin: none found gives null', () => assert.equal(plat.findBrowser({ platform: 'darwin', home, root }), null))
  for (const p of ['linux', 'win32']) {
    test(`${p} has no bundle candidates`, () => {
      const r = fs.mkdtempSync(path.join(tmp, 'r-'))
      touch(chrome(r))
      assert.deepEqual(plat.browserCandidates({ platform: p, home, root: r }), [])
      assert.equal(plat.findBrowser({ platform: p, home, root: r }), null)
    })
  }
})

describe('tool dirs and ollama', () => {
  test('darwin adds Homebrew and /usr/local/bin under root', () => {
    assert.deepEqual(plat.toolDirs({ platform: 'darwin', root: '/r' }), [path.join('/r', 'opt', 'homebrew', 'bin'), path.join('/r', 'usr', 'local', 'bin')])
  })
  for (const p of ['linux', 'win32']) test(`${p} adds none`, () => assert.deepEqual(plat.toolDirs({ platform: p, root: '/r' }), []))
  test('ollama: the app executable comes first, then the Homebrew one', () => {
    const c = plat.ollamaCandidates({ platform: 'darwin', root: '/r' })
    assert.equal(c[0], path.join('/r', 'Applications', 'Ollama.app', 'Contents', 'Resources', 'ollama'))
    assert.ok(c.includes(path.join('/r', 'opt', 'homebrew', 'bin', 'ollama')))
  })
  test('ollama: found from Ollama.app only, and from Homebrew only', () => {
    const a = fs.mkdtempSync(path.join(tmp, 'r-'))
    touch(path.join(a, 'Applications', 'Ollama.app', 'Contents', 'Resources', 'ollama'))
    assert.equal(plat.findOllama({ platform: 'darwin', root: a }), path.join(a, 'Applications', 'Ollama.app', 'Contents', 'Resources', 'ollama'))
    const b = fs.mkdtempSync(path.join(tmp, 'r-'))
    touch(path.join(b, 'opt', 'homebrew', 'bin', 'ollama'))
    assert.equal(plat.findOllama({ platform: 'darwin', root: b }), path.join(b, 'opt', 'homebrew', 'bin', 'ollama'))
    assert.equal(plat.findOllama({ platform: 'darwin', root }), null)
  })
  for (const p of ['linux', 'win32']) test(`ollama on ${p} has no candidates`, () => assert.deepEqual(plat.ollamaCandidates({ platform: p, root: '/r' }), []))
})

test('the service module re-exports the shared helpers', () => {
  assert.equal(plat.modLabel('darwin'), '⌘')
  assert.equal(plat.updatesEnabled('win32'), true)
})
