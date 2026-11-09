// Mac editor keys and menu in src/shared/platform.js.
//   node --test test/unit/platform-keys.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { describe, test } from 'node:test'
import * as shared from '../../src/shared/platform.js'

const key = (k, mods = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods })

describe('modChord', () => {
  test('⌘K on darwin, Ctrl+K elsewhere', () => {
    assert.equal(shared.modChord('darwin', 'K'), '⌘K')
    assert.equal(shared.modChord('win32', 'K'), 'Ctrl+K')
    assert.equal(shared.modChord('linux', 'K'), 'Ctrl+K')
  })
})

describe('editorKeyAction', () => {
  test('darwin: Cmd maps to the editor actions', () => {
    assert.equal(shared.editorKeyAction(key('z', { metaKey: true }), 'darwin'), 'undo')
    assert.equal(shared.editorKeyAction(key('Z', { metaKey: true, shiftKey: true }), 'darwin'), 'redo')
    assert.equal(shared.editorKeyAction(key('y', { metaKey: true }), 'darwin'), 'redo')
    assert.equal(shared.editorKeyAction(key('k', { metaKey: true }), 'darwin'), 'splitAll')
    assert.equal(shared.editorKeyAction(key('M', { metaKey: true, shiftKey: true }), 'darwin'), 'prevMarker')
  })
  test('darwin: every other Cmd combination runs nothing', () => {
    for (const k of ['c', 'q', 'w', 'v', 'x', 'h', 'm', 's', 'j', 'l', ',', '.']) {
      assert.equal(shared.editorKeyAction(key(k, { metaKey: true }), 'darwin'), 'none', `Cmd+${k}`)
    }
  })
  test('darwin: Cmd+A is stopped so the menu cannot select the page text', () => {
    assert.equal(shared.editorKeyAction(key('a', { metaKey: true }), 'darwin'), 'stop')
    assert.equal(shared.editorKeyAction(key('A', { metaKey: true }), 'darwin'), 'stop')
    assert.equal(shared.editorKeyAction(key('A', { metaKey: true, shiftKey: true }), 'darwin'), 'none')
    assert.equal(shared.editorKeyAction(key('a', { ctrlKey: true }), 'darwin'), 'none')
  })
  test('darwin: Ctrl is not the modifier, and still hits the guard', () => {
    assert.equal(shared.editorKeyAction(key('z', { ctrlKey: true }), 'darwin'), 'none')
    assert.equal(shared.editorKeyAction(key('k', { ctrlKey: true }), 'darwin'), 'none')
  })
  for (const p of ['win32', 'linux']) {
    test(`${p}: Ctrl+A keeps today's behaviour`, () => {
      assert.equal(shared.editorKeyAction(key('a', { ctrlKey: true }), p), 'none')
    })
    test(`${p}: Ctrl maps to the editor actions`, () => {
      assert.equal(shared.editorKeyAction(key('z', { ctrlKey: true }), p), 'undo')
      assert.equal(shared.editorKeyAction(key('Z', { ctrlKey: true, shiftKey: true }), p), 'redo')
      assert.equal(shared.editorKeyAction(key('y', { ctrlKey: true }), p), 'redo')
      assert.equal(shared.editorKeyAction(key('k', { ctrlKey: true }), p), 'splitAll')
      assert.equal(shared.editorKeyAction(key('m', { ctrlKey: true, shiftKey: true }), p), 'prevMarker')
    })
    test(`${p}: other modified keys run nothing, Meta included`, () => {
      assert.equal(shared.editorKeyAction(key('c', { ctrlKey: true }), p), 'none')
      assert.equal(shared.editorKeyAction(key('z', { metaKey: true }), p), 'none')
    })
  }
  test('the line-284 guard: Alt alone runs nothing; Alt never blocked a mapped key', () => {
    for (const p of ['darwin', 'win32', 'linux']) {
      assert.equal(shared.editorKeyAction(key('s', { altKey: true }), p), 'none')
      // The old chain never looked at Alt in the mapped branches: Ctrl+Alt+Z undid on Windows.
      const mod = p === 'darwin' ? { metaKey: true } : { ctrlKey: true }
      assert.equal(shared.editorKeyAction(key('z', { ...mod, altKey: true }), p), 'undo')
    }
  })
  test('Ctrl+Shift+M needs Shift: Ctrl+M alone is none', () => {
    assert.equal(shared.editorKeyAction(key('m', { ctrlKey: true }), 'win32'), 'none')
  })
  test('unmodified keys pass, with or without Shift', () => {
    for (const p of ['darwin', 'win32', 'linux']) {
      assert.equal(shared.editorKeyAction(key(' '), p), 'pass')
      assert.equal(shared.editorKeyAction(key('j'), p), 'pass')
      assert.equal(shared.editorKeyAction(key('ArrowLeft', { shiftKey: true }), p), 'pass')
    }
  })
})

describe('macMenuTemplate', () => {
  test('lists the four required roles in order', () => {
    assert.deepEqual(shared.macMenuTemplate().map((i) => i.role), ['appMenu', 'fileMenu', 'editMenu', 'windowMenu'])
  })
  test('menuTemplateFor: the template on darwin, null on win32 and linux', () => {
    assert.deepEqual(shared.menuTemplateFor('darwin'), shared.macMenuTemplate())
    assert.equal(shared.menuTemplateFor('win32'), null)
    assert.equal(shared.menuTemplateFor('linux'), null)
  })
  test('index.js installs it through menuTemplateFor, so only darwin gets a menu', () => {
    const src = fs.readFileSync('src/main/index.js', 'utf8')
    assert.match(src, /import \{[^}]*\bmenuTemplateFor\b[^}]*\} from '\.\.\/shared\/platform'/)
    assert.match(src, /menuTemplateFor\(process\.platform\)/)
    assert.match(src, /setApplicationMenu\(/)
  })
})

describe('editor tooltips', () => {
  test('the Split tooltip keeps its space after the semicolon', () => {
    const src = fs.readFileSync('src/renderer/src/components/edit/Editor.jsx', 'utf8')
    assert.match(src, /\(S\); every track: \$\{modChord\(platform, 'K'\)\}/)
  })
})

describe('focusKey', () => {
  test('F11 and the backtick toggle the workspace; Cmd+backtick on a Mac is the window cycle', () => {
    assert.equal(shared.focusKey({ key: 'F11' }, 'darwin'), true)
    assert.equal(shared.focusKey({ key: '`' }, 'darwin'), true)
    assert.equal(shared.focusKey({ key: '`', metaKey: true }, 'darwin'), false)
    assert.equal(shared.focusKey({ key: '`', ctrlKey: true }, 'darwin'), true)
    for (const p of ['win32', 'linux']) {
      assert.equal(shared.focusKey({ key: '`', metaKey: true }, p), true)
      assert.equal(shared.focusKey({ key: '`', ctrlKey: true }, p), true)
      assert.equal(shared.focusKey({ key: 'a' }, p), false)
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

describe('shared/platform.js is renderer-safe', () => {
  test('imports no node: module', () => {
    assert.doesNotMatch(fs.readFileSync('src/shared/platform.js', 'utf8'), /node:|\brequire\(/)
  })
})

describe('comfyLauncherHelp', () => {
  test('a Mac names Comfy Desktop.app; Windows and Linux keep their text', () => {
    assert.match(shared.comfyLauncherHelp('darwin'), /Comfy Desktop\.app/)
    assert.match(shared.comfyLauncherHelp('linux'), /^A \.sh script beside ComfyUI/)
    assert.match(shared.comfyLauncherHelp('win32'), /\.bat/)
    assert.equal(shared.comfyLauncherHelp(null), shared.comfyLauncherHelp('win32'))
  })
  test('Settings reads the platform from the main process, not the user agent', () => {
    assert.match(fs.readFileSync('src/renderer/src/components/Settings.jsx', 'utf8'), /comfyLauncherHelp\(platform\)/)
  })
})
