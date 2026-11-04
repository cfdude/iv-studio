// Mac app shell helpers in src/shared/platform.js: editor keys, menu, window options, updates switch.
//   node --test test/unit/platform-shell.test.mjs
import assert from 'node:assert/strict'
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
    for (const k of ['c', 'q', 'w', 'a', 'v', 'x', 'h', 'm', 's', 'j', 'l', ',', '.']) {
      assert.equal(shared.editorKeyAction(key(k, { metaKey: true }), 'darwin'), 'none', `Cmd+${k}`)
    }
  })
  test('darwin: Ctrl is not the modifier, and still hits the guard', () => {
    assert.equal(shared.editorKeyAction(key('z', { ctrlKey: true }), 'darwin'), 'none')
    assert.equal(shared.editorKeyAction(key('k', { ctrlKey: true }), 'darwin'), 'none')
  })
  for (const p of ['win32', 'linux']) {
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
