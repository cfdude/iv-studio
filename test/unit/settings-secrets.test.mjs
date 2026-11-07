// The public settings projection (design D8, task 6.3): unreadable secrets, and a refused secret store.
//   node --test test/unit/settings-secrets.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { describe, test } from 'node:test'
import { projectSettings, secretStates } from '../../src/service/secrets.js'
import { keychainRefusedText } from '../../src/shared/platform.js'

const sealed = (value) => Buffer.from(`ok:${value}`).toString('base64')
const junk = Buffer.from('garbage').toString('base64')
const makeStore = (available = true) => ({
  isEncryptionAvailable: () => available,
  decryptString(buf) {
    const text = buf.toString()
    if (!available) throw new Error('Decryption is not available.')
    if (!text.startsWith('ok:')) throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString.')
    return text.slice(3)
  }
})
const base = { comfyUrl: 'http://127.0.0.1:8188', comfyApiKey: null, civitaiKey: null, runpodKey: null, cloudToken: null, runpodToken: null }

describe('projectSettings', () => {
  test('readable and absent secrets keep today’s flags; the sealed values never leave', () => {
    const p = projectSettings({ ...base, comfyApiKey: sealed('a'), cloudToken: sealed('t') }, makeStore(), 'linux')
    assert.equal(p.hasComfyKey, true)
    assert.equal(p.hasCloudToken, true)
    assert.equal(p.hasCivitaiKey, false)
    assert.equal(p.hasRunpodKey, false)
    assert.deepEqual(p.unreadable, [])
    assert.equal(p.secretStoreRefused, false)
    for (const k of ['comfyApiKey', 'civitaiKey', 'runpodKey', 'cloudToken', 'runpodToken']) assert.equal(k in p, false)
    assert.equal(p.comfyUrl, base.comfyUrl)
  })

  test('an unreadable typed key is named and its has flag is false', () => {
    const p = projectSettings({ ...base, comfyApiKey: junk, civitaiKey: sealed('c') }, makeStore(), 'darwin')
    assert.deepEqual(p.unreadable, ['comfyApiKey'])
    assert.equal(p.hasComfyKey, false)
    assert.equal(p.hasCivitaiKey, true)
    assert.equal(p.secretStoreRefused, false)
  })

  test('an unreadable generated token is named, with its flag false', () => {
    const p = projectSettings({ ...base, cloudToken: junk, runpodToken: junk }, makeStore(), 'darwin')
    assert.deepEqual(p.unreadable, ['cloudToken', 'runpodToken'])
    assert.equal(p.hasCloudToken, false)
  })

  test('a deleted Keychain item (store available, decrypt throws) is unreadable, not refused', () => {
    const p = projectSettings({ ...base, runpodKey: junk }, makeStore(true), 'darwin')
    assert.deepEqual(p.unreadable, ['runpodKey'])
    assert.equal(p.hasRunpodKey, false)
    assert.equal(p.secretStoreRefused, false)
  })

  test('a refused store on darwin: nothing saved reads as present, nothing is re-enterable, the window is told', () => {
    const p = projectSettings({ ...base, comfyApiKey: sealed('a'), civitaiKey: sealed('c'), runpodKey: sealed('r'), cloudToken: sealed('t'), runpodToken: sealed('u') }, makeStore(false), 'darwin')
    assert.equal(p.secretStoreRefused, true)
    assert.deepEqual(p.unreadable, [])
    assert.equal(p.hasComfyKey || p.hasCivitaiKey || p.hasRunpodKey || p.hasCloudToken, false)
  })

  test('a refused store on darwin with nothing saved is still refused', () => {
    assert.equal(projectSettings(base, makeStore(false), 'darwin').secretStoreRefused, true)
  })

  test('an unavailable store on linux and win32 stays as it is today', () => {
    for (const platform of ['linux', 'win32']) {
      const p = projectSettings({ ...base, comfyApiKey: sealed('a'), cloudToken: sealed('t') }, makeStore(false), platform)
      assert.equal(p.hasComfyKey, true)
      assert.equal(p.hasCloudToken, true)
      assert.deepEqual(p.unreadable, [])
      assert.equal(p.secretStoreRefused, false)
    }
  })
})

describe('secretStates', () => {
  test('gives each secret one state the main process can gate on', () => {
    const s = secretStates({ ...base, comfyApiKey: sealed('a'), civitaiKey: junk }, makeStore(), 'darwin')
    assert.deepEqual(s, { comfyApiKey: 'ok', civitaiKey: 'unreadable', runpodKey: 'absent', cloudToken: 'absent', runpodToken: 'absent' })
  })
  test('refused on darwin is not ok for anything saved', () => {
    const s = secretStates({ ...base, comfyApiKey: sealed('a') }, makeStore(false), 'darwin')
    assert.equal(s.comfyApiKey, 'refused')
    assert.equal(s.civitaiKey, 'absent')
  })
})

describe('keychainRefusedText', () => {
  test('names the Keychain, Keychain Access, Allow and Always Allow, in plain words', () => {
    const t = keychainRefusedText('darwin')
    assert.match(t, /Keychain/)
    assert.match(t, /Keychain Access/)
    assert.match(t, /Always Allow/)
    assert.doesNotMatch(t, /GNOME|KWallet|Windows/)
  })
})

describe('index.js wiring', () => {
  const src = fs.readFileSync('src/main/index.js', 'utf8')
  test('prompts:status derives hasComfyKey through the projection, not the raw setting', () => {
    const line = src.split('\n').find((l) => l.includes("handle('prompts:status'"))
    assert.ok(line)
    assert.match(line, /hasComfyKey: publicSettings\(/)
    assert.doesNotMatch(line, /!!readSettings\(BASE\)\.comfyApiKey/)
  })
  test('publicSettings is the projection', () => {
    assert.match(src, /const publicSettings = \(s\) => projectSettings\(s, safeStorage, process\.platform\)/)
  })
  test('no raw truthiness check on a sealed secret is left in a status or gate', () => {
    assert.doesNotMatch(src, /!!\s*s\.(runpodKey|cloudToken|runpodToken|civitaiKey|comfyApiKey)/)
    assert.doesNotMatch(src, /!!\s*readSettings\(BASE\)\.(civitaiKey|comfyApiKey)/)
    assert.doesNotMatch(src, /&& s\.(runpodToken|cloudToken)\)/)
    assert.doesNotMatch(src, /s\.runpodKey \?/)
  })
})
