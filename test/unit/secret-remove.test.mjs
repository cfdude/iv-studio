// Removing a saved secret that can't be opened (or that a refused Keychain hides).
//   node --test test/unit/secret-remove.test.mjs
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { projectSettings, removableSecrets, tokenClearPatch } from '../../src/service/secrets.js'

const junk = Buffer.from('garbage').toString('base64')
const store = (available) => ({
  isEncryptionAvailable: () => available,
  decryptString: () => {
    throw new Error('no')
  }
})

describe('removableSecrets', () => {
  test('nothing saved, or saved and readable, is not removable', () => {
    assert.deepEqual(removableSecrets({ comfyApiKey: 'absent', civitaiKey: 'ok', cloudToken: 'ok' }), [])
  })
  test('an unreadable key or token is removable', () => {
    assert.deepEqual(removableSecrets({ comfyApiKey: 'unreadable', cloudToken: 'unreadable', runpodToken: 'ok' }), ['comfyApiKey', 'cloudToken'])
  })
  test('a refused key is removable; a refused token is not (it may come back once access is allowed)', () => {
    assert.deepEqual(removableSecrets({ civitaiKey: 'refused', runpodKey: 'refused', cloudToken: 'refused', runpodToken: 'refused' }), ['civitaiKey', 'runpodKey'])
  })
})

describe('projectSettings lists what can be removed', () => {
  test('unreadable saved values', () => {
    const p = projectSettings({ comfyApiKey: junk, cloudToken: junk }, store(true), 'darwin')
    assert.deepEqual(p.removable, ['comfyApiKey', 'cloudToken'])
  })
  test('a refused Keychain lists the saved keys only', () => {
    const p = projectSettings({ comfyApiKey: junk, civitaiKey: junk, runpodToken: junk }, store(false), 'darwin')
    assert.equal(p.secretStoreRefused, true)
    assert.deepEqual(p.removable, ['comfyApiKey', 'civitaiKey'])
  })
})

describe('tokenClearPatch', () => {
  test('clears just the one unreadable token', () => {
    assert.deepEqual(tokenClearPatch('cloudToken', { cloudToken: 'unreadable' }), { cloudToken: null })
    assert.deepEqual(tokenClearPatch('runpodToken', { runpodToken: 'unreadable' }), { runpodToken: null })
  })
  test('refuses a token that can be read, and anything that is not one of the two tokens', () => {
    assert.throws(() => tokenClearPatch('cloudToken', { cloudToken: 'ok' }), /can be read/)
    assert.throws(() => tokenClearPatch('cloudToken', { cloudToken: 'refused' }), /can be read|allow/i)
    assert.throws(() => tokenClearPatch('cloudToken', {}), /nothing/i)
    for (const bad of ['comfyApiKey', 'cloud', 'runpod', 'target', undefined]) assert.throws(() => tokenClearPatch(bad, { [bad]: 'unreadable' }), /sign-in/)
  })
})
