// Wording outside the launcher (task 3.4): macOS names macOS places, Windows and Linux text is unchanged.
//   node --test test/unit/wording-sweep.test.mjs
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import * as shared from '../../src/shared/platform.js'

describe('wording outside the launcher', () => {
  test('darwin: Movies, Keychain, Finder, forward slashes', () => {
    assert.equal(shared.rendersFolderText('darwin'), '~/Movies/IV Studio')
    assert.equal(shared.editsFolderText('darwin'), '~/Movies/IV Studio/Edits')
    assert.equal(shared.secretStoreName('darwin'), 'Keychain')
    assert.equal(shared.fileManagerName('darwin'), 'Finder')
    assert.equal(shared.sepText('darwin'), '/')
    assert.match(shared.keyStoreMissingText('darwin'), /Keychain/)
    assert.doesNotMatch(shared.keyStoreMissingText('darwin'), /GNOME|KWallet|Windows/)
  })

  test('no darwin text shows Windows path syntax', () => {
    for (const t of [shared.rendersFolderText('darwin'), shared.editsFolderText('darwin'), shared.dataFolderText('darwin'), shared.sepText('darwin')]) {
      assert.doesNotMatch(t, /\\|%APPDATA%|Videos/)
    }
  })

  test('windows and linux text is byte-identical to before', () => {
    for (const p of ['win32', 'linux']) {
      assert.equal(shared.rendersFolderText(p), 'Videos\\IV Studio')
      assert.equal(shared.editsFolderText(p), 'Videos\\IV Studio\\Edits')
      assert.equal(shared.sepText(p), '\\')
    }
    assert.equal(shared.keyStoreMissingText('win32'), 'Windows encryption is not available, so the key cannot be stored safely.')
    assert.equal(shared.keyStoreMissingText('linux'), 'No system keyring (GNOME Keyring or KWallet) is available, so the key cannot be stored safely.')
  })
})
