// The Apple Silicon build must never update itself on a Mac (our signed build once replaced itself with upstream's
// unsigned one). These fail if the Mac path would check, download or install without IV_STUDIO_MAC_UPDATES=1.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { macUpdatesOn, offUpdater, selectUpdater } from '../../src/service/updateplan.js'
import { buildSha, shortSha, versionLabel } from '../../src/service/buildinfo.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8')

// stand-ins for electron-updater, macupdater and the portable updater: each records that it was started
function spies() {
  const calls = []
  const mk = (name) => () => (calls.push(name), { check: async () => calls.push(`${name}:check`), install: () => calls.push(`${name}:install`) })
  return { calls, impls: { mac: mk('mac'), portable: mk('portable'), standard: mk('standard'), off: () => (calls.push('off'), { check: async () => ({}), install: () => false }) } }
}

test('a Mac copy starts no updater, so nothing is checked, downloaded or installed', () => {
  const { calls, impls } = spies()
  selectUpdater({ mac: true, portable: false, env: {}, impls })
  assert.deepEqual(calls, ['off'])
  for (const env of [{ IV_STUDIO_MAC_UPDATES: '0' }, { IV_STUDIO_MAC_UPDATES: 'true' }, { IV_STUDIO_UPDATE_FEED: 'http://127.0.0.1:1' }, { IV_STUDIO_UPDATE_SELFTEST: '1' }]) {
    const s = spies()
    selectUpdater({ mac: true, portable: false, env, impls: s.impls })
    assert.deepEqual(s.calls, ['off'], JSON.stringify(env))
  }
})

test('the off updater says so and its check and install do nothing', async () => {
  const seen = []
  const u = offUpdater({ set: (p) => seen.push(p) })
  assert.equal(seen.length, 1)
  assert.equal(seen[0].status, 'off')
  assert.match(seen[0].why, /off on this build/)
  assert.equal((await u.check()).status, 'off')
  assert.equal(u.install(), false)
})

test('IV_STUDIO_MAC_UPDATES=1 turns the Mac updater back on, and only the Mac one', () => {
  const { calls, impls } = spies()
  selectUpdater({ mac: true, portable: false, env: { IV_STUDIO_MAC_UPDATES: '1' }, impls })
  assert.deepEqual(calls, ['mac'])
  assert.equal(macUpdatesOn({}), false)
  assert.equal(macUpdatesOn({ IV_STUDIO_MAC_UPDATES: '1' }), true)
})

test('Windows, Linux and the portable copy keep their own updaters', () => {
  const a = spies()
  selectUpdater({ mac: false, portable: false, env: {}, impls: a.impls })
  assert.deepEqual(a.calls, ['standard'])
  const b = spies()
  selectUpdater({ mac: false, portable: true, env: {}, impls: b.impls })
  assert.deepEqual(b.calls, ['portable'])
})

test('updater.js reaches the Mac updater only through selectUpdater (a drift check on the wiring)', () => {
  const src = read('src/main/updater.js')
  assert.match(src, /selectUpdater\(\{/)
  const uses = [...src.matchAll(/initMacUpdater\(/g)]
  assert.equal(uses.length, 1, 'initMacUpdater must be called in exactly one place')
  assert.match(src, /mac:\s*\(\)\s*=>\s*initMacUpdater\(/, 'the one call must sit inside the gated mac impl')
  assert.match(src, /off:\s*\(\)\s*=>\s*offUpdater\(/)
  // nothing before the gate may start an updater or a timer
  const before = src.slice(src.indexOf('export function initUpdater'), src.indexOf('selectUpdater({'))
  assert.doesNotMatch(before, /autoUpdater\.|setTimeout|setInterval|checkForUpdates/)
})

test('the version label marks this as the silicon build, with the commit', () => {
  assert.equal(versionLabel('1.1.3', 'f1c2e7e40b1b'), '1.1.3 · silicon f1c2e7e')
  assert.equal(versionLabel('1.1.3', ''), '1.1.3 · silicon dev')
  assert.equal(shortSha('not a sha'), null)
  assert.equal(buildSha({ IV_STUDIO_BUILD_SHA: 'ABCDEF1234' }, 'f1c2e7e'), 'abcdef1')
  assert.equal(buildSha({}, 'f1c2e7e\n'), 'f1c2e7e')
  assert.equal(buildSha({}, ''), '')
})

test('the build injects the commit and the sidebar and About show the label', () => {
  assert.match(read('electron.vite.config.mjs'), /__IV_BUILD_SHA__/)
  const update = read('src/renderer/src/components/Update.jsx')
  assert.match(update, /versionLabel\(u\.version, BUILD_SHA\)/)
  assert.match(read('src/renderer/src/components/Settings.jsx'), /versionLabel\(info\?\.version, BUILD_SHA\)/)
})
