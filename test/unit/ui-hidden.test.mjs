// The page tier runs with its windows hidden (IV_STUDIO_UI_HIDDEN=1, set only by test/ui/driver.mjs). A real install
// can never hide itself: the switch counts only together with IV_STUDIO_DATA, which the page tier always sets.
//   node --test test/unit/ui-hidden.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { uiHidden } from '../../src/service/uihidden.js'
import { electronEnv } from '../ui/driver.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const main = fs.readFileSync(path.join(root, 'src/main/index.js'), 'utf8')

test('the switch hides only with the data folder set too', () => {
  assert.equal(uiHidden({ IV_STUDIO_UI_HIDDEN: '1', IV_STUDIO_DATA: '/tmp/d' }), true)
  assert.equal(uiHidden({ IV_STUDIO_UI_HIDDEN: '1' }), false)
  assert.equal(uiHidden({ IV_STUDIO_DATA: '/tmp/d' }), false)
  assert.equal(uiHidden({ IV_STUDIO_UI_HIDDEN: '0', IV_STUDIO_DATA: '/tmp/d' }), false)
  assert.equal(uiHidden({}), false)
})

test('the page tier driver sets the switch in Electron\'s environment', () => {
  const env = electronEnv({}, { home: '/h', data: '/d', userData: '/u', runDir: '/r' })
  assert.equal(env.IV_STUDIO_UI_HIDDEN, '1')
  assert.equal(uiHidden(env), true)
})

test('main never shows, focuses or full-screens a window except through the hidden-aware helper', () => {
  // the only direct window calls allowed are inside reveal() and the full-screen handler's own guard
  const stripped = main.replace(/function reveal\([\s\S]*?\n}\n/, '')
  assert.ok(/function reveal\(/.test(main), 'main has no reveal() helper')
  const hits = [...stripped.matchAll(/\b(win|chatWin|w)\.(show|focus|moveTop|restore)\(/g)].map((m) => m[0])
  assert.deepEqual(hits, [], `direct window show/focus outside reveal(): ${hits.join(', ')}`)
  assert.match(main, /if \(!UI_HIDDEN\) win\.setFullScreen/)
  assert.match(main, /UI_HIDDEN[\s\S]{0,80}app\.dock\?\.hide\(\)/)
})

test('every window main creates starts hidden', () => {
  const creations = [...main.matchAll(/new BrowserWindow\(\{[\s\S]*?\n  \}\)/g)].map((m) => m[0])
  assert.equal(creations.length, 2)
  for (const c of creations) assert.match(c, /show: false/)
})

test('ready-to-show goes through reveal, so a hidden run never shows', () => {
  const shows = [...main.matchAll(/'ready-to-show', \(\) => ([^\n]*)/g)].map((m) => m[1])
  assert.equal(shows.length, 2)
  for (const s of shows) assert.match(s, /reveal\(/)
})
