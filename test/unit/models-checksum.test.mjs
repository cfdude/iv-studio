import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { expectedSha256 } from '../../src/service/models.js'

const manifest = JSON.parse(fs.readFileSync(new URL('../../resources/models.json', import.meta.url), 'utf8'))
const sha = 'a'.repeat(64)

test('a checksum pinned in models.json wins over the probed one', () => {
  assert.equal(expectedSha256({ sha256: sha }, 'b'.repeat(64)), sha)
})

test('with nothing pinned the probed Hugging Face checksum is used', () => {
  assert.equal(expectedSha256({}, sha), sha)
})

test('with nothing pinned or probed there is no checksum to check', () => {
  assert.equal(expectedSha256({}, null), null)
})

test('every model served from outside Hugging Face pins a checksum', () => {
  const unpinned = manifest.models.filter((m) => m.url && !new URL(m.url).hostname.endsWith('huggingface.co') && !/^[0-9a-f]{64}$/.test(m.sha256 || ''))
  assert.deepEqual(unpinned.map((m) => m.id), [])
})
