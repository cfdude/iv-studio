// The guard that runs before anything is changed remotely or a new secret is sealed.
//   node --test test/unit/secret-guard.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { describe, test } from 'node:test'
import { sealBlockedText } from '../../src/service/secrets.js'
import { keychainRefusedText, keyStoreMissingText, runpodTokenMissingText } from '../../src/shared/platform.js'

const store = (available) => ({ isEncryptionAvailable: () => available })

describe('sealBlockedText', () => {
  test('a store that can seal blocks nothing', () => {
    for (const p of ['darwin', 'win32', 'linux']) assert.equal(sealBlockedText(store(true), p), null)
  })
  test('an unavailable store blocks, with the platform text', () => {
    for (const p of ['win32', 'linux']) assert.equal(sealBlockedText(store(false), p), keyStoreMissingText(p))
  })
  test('a store that throws counts as unavailable', () => {
    const bad = {
      isEncryptionAvailable: () => {
        throw new Error('x')
      }
    }
    assert.equal(sealBlockedText(bad, 'win32'), keyStoreMissingText('win32'))
  })
})

describe('words on a refused Keychain', () => {
  test('sealBlockedText on a Mac names the Keychain remedy', () => {
    assert.equal(sealBlockedText(store(false), 'darwin'), keychainRefusedText('darwin'))
  })
  test('a missing RunPod token on a refused Mac says allow the Keychain, not set up again', () => {
    const t = runpodTokenMissingText('darwin', false)
    assert.equal(t, keychainRefusedText('darwin'))
    assert.ok(!/set up runpod again/i.test(t))
  })
  test('an unreadable token with the store available keeps the set-up-again text', () => {
    for (const p of ['darwin', 'win32', 'linux']) assert.match(runpodTokenMissingText(p, true), /Set up RunPod again/)
  })
  test('Windows and Linux keep the set-up-again text', () => {
    for (const p of ['win32', 'linux']) assert.match(runpodTokenMissingText(p, false), /Set up RunPod again/)
  })
})

describe('wiring (source checks)', () => {
  const main = fs.readFileSync('src/main/index.js', 'utf8')
  test('each cloud task refuses before any remote work', async (t) => {
    for (const channel of ['cloud:deploy', 'cloud:setUp', 'cloud:runpodSetUp']) {
      await t.test(`${channel} refuses before any remote work`, () => {
        const start = main.indexOf(`handle('${channel}'`)
        const body = main.slice(start, main.indexOf('cloudTask(', start))
        assert.ok(body.includes('requireSealable()'), 'guard comes before cloudTask')
      })
    }
  })
  test('cloud:clearToken only writes what tokenClearPatch allows', () => {
    const start = main.indexOf("handle('cloud:clearToken'")
    assert.ok(main.slice(start, main.indexOf('\n', start + 40)).includes('tokenClearPatch(name, secretNow())'))
  })
  test('a refused save names the Keychain remedy on a Mac: main builds its store-missing text with keychainRefusedText', () => {
    assert.match(main, /const KEY_STORE_MISSING = keychainRefusedText\(process\.platform\)/)
    assert.doesNotMatch(main, /KEY_STORE_MISSING = keyStoreMissingText/)
  })
})
