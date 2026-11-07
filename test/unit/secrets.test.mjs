// Telling "nothing saved" from "saved but can't be read", and what to tell the user to do about it.
//   node --test test/unit/secrets.test.mjs
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { SECRET_NAMES, readSecret, secretRemedy } from '../../src/service/secrets.js'

// A stand-in for Electron's safeStorage: "sealed" text is base64 of `ok:<value>`; anything else won't open.
const fakeStore = {
  decryptString(buf) {
    const text = buf.toString()
    if (!text.startsWith('ok:')) throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString.')
    return text.slice(3)
  }
}
const sealed = (value) => Buffer.from(`ok:${value}`).toString('base64')

describe('readSecret', () => {
  test('nothing saved is absent, and never touches the store', () => {
    const store = { decryptString: () => assert.fail('must not be called') }
    for (const empty of [undefined, null, '']) assert.deepEqual(readSecret(store, empty), { state: 'absent' })
  })

  test('a value the store can open is ok, with the value', () => {
    assert.deepEqual(readSecret(fakeStore, sealed('abc123')), { state: 'ok', value: 'abc123' })
  })

  test('a saved value the store cannot open is unreadable, not absent', () => {
    const r = readSecret(fakeStore, Buffer.from('garbage').toString('base64'))
    assert.deepEqual(r, { state: 'unreadable' })
    assert.equal('value' in r, false)
  })
})

describe('secretRemedy', () => {
  test('keys the user typed say to enter them again', () => {
    for (const name of ['comfyApiKey', 'civitaiKey', 'runpodKey']) {
      const r = secretRemedy(name)
      assert.equal(r.action, 'reenter', name)
      assert.match(r.text, /enter it again/i, name)
    }
  })

  test('tokens IV Studio made say to set the cloud GPU up again', () => {
    for (const name of ['cloudToken', 'runpodToken']) {
      const r = secretRemedy(name)
      assert.equal(r.action, 'setup', name)
      assert.match(r.text, /set .*up again/i, name)
      assert.doesNotMatch(r.text, /enter it again|paste|type/i, name)
    }
  })

  test('every known name has a remedy and an unknown name throws', () => {
    for (const name of SECRET_NAMES) assert.ok(secretRemedy(name).text)
    assert.throws(() => secretRemedy('nope'), /nope/)
  })
})
