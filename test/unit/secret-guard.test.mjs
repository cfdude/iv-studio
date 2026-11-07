// The guard that runs before anything is changed remotely or a new secret is sealed.
//   node --test test/unit/secret-guard.test.mjs
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { sealBlockedText } from '../../src/service/secrets.js'
import { keyStoreMissingText } from '../../src/shared/platform.js'

const store = (available) => ({ isEncryptionAvailable: () => available })

describe('sealBlockedText', () => {
  test('a store that can seal blocks nothing', () => {
    for (const p of ['darwin', 'win32', 'linux']) assert.equal(sealBlockedText(store(true), p), null)
  })
  test('an unavailable store blocks, with the platform text', () => {
    for (const p of ['darwin', 'win32', 'linux']) assert.equal(sealBlockedText(store(false), p), keyStoreMissingText(p))
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
