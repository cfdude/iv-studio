// src/shared/platform.js: the platform helpers the renderer and the main process both use. No Node imports.
//   node --test test/unit/platform-shared.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { describe, test } from 'node:test'
import * as shared from '../../src/shared/platform.js'

describe('shared/platform.js is renderer-safe', () => {
  test('imports no node: module and nothing but relative files', () => {
    const src = fs.readFileSync('src/shared/platform.js', 'utf8')
    assert.doesNotMatch(src, /node:/)
    assert.doesNotMatch(src, /\brequire\(/)
    const specs = [...src.matchAll(/(?:import|export)[^'"\n]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1] || m[2])
    for (const s of specs) assert.match(s, /^\.{1,2}\//, `non-relative import: ${s}`)
  })

  test('exports every helper the design lists', () => {
    for (const name of ['modKey', 'modLabel', 'editorKeyAction', 'updateView', 'dataFolderText', 'rendersFolderText', 'secretStoreName', 'fileManagerName', 'macMenuTemplate', 'windowOptions', 'MAC_UPDATES', 'updatesEnabled']) {
      assert.ok(name in shared, `missing export ${name}`)
    }
  })
})

describe('modKey and modLabel', () => {
  test('darwin uses Cmd', () => {
    assert.equal(shared.modKey({ metaKey: true, ctrlKey: false }, 'darwin'), true)
    assert.equal(shared.modKey({ metaKey: false, ctrlKey: true }, 'darwin'), false)
    assert.equal(shared.modLabel('darwin'), '⌘')
  })
  for (const p of ['win32', 'linux']) {
    test(`${p} uses Ctrl`, () => {
      assert.equal(shared.modKey({ metaKey: false, ctrlKey: true }, p), true)
      assert.equal(shared.modKey({ metaKey: true, ctrlKey: false }, p), false)
      assert.equal(shared.modLabel(p), 'Ctrl')
    })
  }
})

describe('wording helpers', () => {
  test('data folder', () => {
    assert.equal(shared.dataFolderText('darwin'), '~/Library/Application Support/IV Studio')
    assert.equal(shared.dataFolderText('win32'), '%APPDATA%\\IV Studio')
    assert.equal(shared.dataFolderText('linux'), '~/.config/IV Studio')
  })
  test("renders folder names the Movies folder on a Mac, today's text elsewhere", () => {
    assert.equal(shared.rendersFolderText('darwin'), '~/Movies/IV Studio')
    assert.equal(shared.rendersFolderText('win32'), 'Videos\\IV Studio')
    assert.equal(shared.rendersFolderText('linux'), 'Videos\\IV Studio')
    assert.doesNotMatch(shared.rendersFolderText('darwin'), /\\/)
  })
  test('secret store', () => {
    assert.equal(shared.secretStoreName('darwin'), 'Keychain')
    assert.equal(shared.secretStoreName('win32'), 'Windows encryption')
    assert.equal(shared.secretStoreName('linux'), 'GNOME Keyring or KWallet')
  })
  test('file manager', () => {
    assert.equal(shared.fileManagerName('darwin'), 'Finder')
    assert.equal(shared.fileManagerName('win32'), 'Explorer')
    assert.equal(shared.fileManagerName('linux'), 'your file manager')
  })
})

// Stubs: later tasks fill these in (7.1, 7.2, 7.3, 8.1). They pin only the minimal behaviour for now.
describe('stubs for later tasks', () => {
  test('editorKeyAction passes every key through until task 7.3', () => {
    for (const p of ['darwin', 'win32', 'linux']) assert.equal(shared.editorKeyAction({ key: 'z', metaKey: true, ctrlKey: true }, p), 'pass')
  })
  test('macMenuTemplate is an empty template until task 7.1', () => {
    assert.deepEqual(shared.macMenuTemplate(), [])
  })
  test('windowOptions adds nothing until task 7.2', () => {
    for (const p of ['darwin', 'win32', 'linux']) assert.deepEqual(shared.windowOptions(p), {})
  })
  test('updateView shows the update section until task 8.1', () => {
    assert.equal(shared.updateView({ status: 'idle' }), 'show')
  })
  test('MAC_UPDATES is off, and updatesEnabled follows it only on darwin', () => {
    assert.equal(shared.MAC_UPDATES, false)
    assert.equal(shared.updatesEnabled('darwin'), false)
    assert.equal(shared.updatesEnabled('win32'), true)
    assert.equal(shared.updatesEnabled('linux'), true)
  })
})
