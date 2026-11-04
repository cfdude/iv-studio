// Mac app shell helpers in src/shared/platform.js: editor keys, menu, window options, updates switch.
//   node --test test/unit/platform-shell.test.mjs
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
    assert.match(src, /menuTemplateFor\(process\.platform\)/)
    assert.match(src, /setApplicationMenu\(/)
  })
})

describe('windowOptions', () => {
  test('win32 and linux add nothing, so today’s options stay byte-identical', () => {
    const base = { titleBarStyle: 'hidden', titleBarOverlay: { color: '#000', symbolColor: '#fff', height: 40 } }
    for (const p of ['win32', 'linux']) {
      assert.deepEqual(shared.windowOptions(p), {})
      assert.equal(JSON.stringify({ ...base, ...shared.windowOptions(p) }), JSON.stringify(base))
    }
  })
  test('darwin adds only trafficLightPosition, centred in the 40 px title bar', () => {
    const o = shared.windowOptions('darwin')
    assert.deepEqual(Object.keys(o), ['trafficLightPosition'])
    const { x, y } = o.trafficLightPosition
    assert.ok(Number.isInteger(x) && x >= 0)
    // The buttons are about 16 px tall, so y puts them mid-bar.
    assert.ok(y >= 8 && y + 16 <= 32)
  })
  test('index.js merges it over the window options, after the title bar settings', () => {
    const src = fs.readFileSync('src/main/index.js', 'utf8')
    const at = (re) => src.search(re)
    assert.ok(at(/titleBarOverlay:/) > 0 && at(/\.\.\.windowOptions\(process\.platform\)/) > at(/titleBarOverlay:/))
  })
})

describe('updates switch', () => {
  test('darwin is off by default; win32 and linux are on', () => {
    assert.equal(shared.MAC_UPDATES, false)
    assert.equal(shared.updatesEnabled('darwin'), false)
    assert.equal(shared.updatesEnabled('win32'), true)
    assert.equal(shared.updatesEnabled('linux'), true)
  })
  test('with the switch on, darwin follows the same decision as the others', () => {
    assert.equal(shared.updatesEnabled('darwin', true), true)
    assert.equal(shared.updatesEnabled('win32', true), true)
  })
  test('updater.js has no module-level autoUpdater, and gates before it is built', () => {
    const src = fs.readFileSync('src/main/updater.js', 'utf8')
    const lines = src.split('\n')
    const uses = lines.map((l, i) => [i, l]).filter(([, l]) => /autoUpdater/.test(l) && !/^\s*\/\//.test(l))
    assert.ok(uses.length > 0)
    for (const [, l] of uses) assert.match(l, /^\s+/, `module-level use: ${l}`)
    const init = lines.findIndex((l) => /export function initUpdater/.test(l))
    const gate = lines.findIndex((l) => /updatesEnabled\(/.test(l))
    const first = uses[0][0]
    assert.ok(init < gate && gate < first, 'the updatesEnabled gate must come before the first autoUpdater use')
    assert.match(src, /status: 'off'/)
  })
  test('updateView: off shows nothing, everything else is unchanged', () => {
    assert.equal(shared.updateView('off'), 'none')
    assert.equal(shared.updateView({ status: 'off' }), 'none')
    for (const s of ['dev', 'idle', 'checking', 'current', 'downloading', 'ready', 'error', undefined]) {
      assert.equal(shared.updateView(s), 'show', String(s))
    }
    assert.equal(shared.updateView(null), 'show')
    assert.equal(shared.updateView({ status: 'dev' }), 'show')
  })
})
