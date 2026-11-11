// writeSettings keeps only keys DEFAULT_SETTINGS knows (src/service/paths.js), so a new saved setting must be listed
// there or it never reaches disk. The Hugging Face token (cloud:hfToken) and the Comfy Cloud key and survey
// (cloud:comfyCloudKey) were missing from it in v1.1.3.
//   node --test test/unit/settings-keys.test.mjs
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { readSettings, writeSettings } from '../../src/service/paths.js'
import { SECRET_NAMES } from '../../src/service/secrets.js'
import { tempDir } from '../fakes/tmp.mjs'

describe('saved settings', () => {
  test('the Hugging Face token and when it was saved reach disk', () => {
    const dir = tempDir('iv-settings-')
    writeSettings({ hfToken: 'sealed', hfTokenAt: '2026-11-11T00:00:00.000Z' }, dir)
    const s = readSettings(dir)
    assert.equal(s.hfToken, 'sealed')
    assert.equal(s.hfTokenAt, '2026-11-11T00:00:00.000Z')
  })
  test('every saved secret is a key writeSettings keeps', () => {
    const dir = tempDir('iv-settings-')
    writeSettings(Object.fromEntries(SECRET_NAMES.map((k) => [k, `sealed-${k}`])), dir)
    const s = readSettings(dir)
    for (const k of SECRET_NAMES) assert.equal(s[k], `sealed-${k}`, k)
  })
  test('the Comfy Cloud survey reaches disk', () => {
    const dir = tempDir('iv-settings-')
    writeSettings({ comfycloud: { survey: { ok: true }, checkedAt: '2026-11-11T00:00:00.000Z' } }, dir)
    assert.deepEqual(readSettings(dir).comfycloud, { survey: { ok: true }, checkedAt: '2026-11-11T00:00:00.000Z' })
  })
})
