// The renderer's one platform source (task 3.3).
//   node --test test/unit/renderer-platform.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { describe, test } from 'node:test'
import { getPlatform, loadPlatform, setPlatform } from '../../src/renderer/src/platform.js'

describe('renderer platform source', () => {
  test('loadPlatform takes the platform from app:info and marks the document root', async () => {
    const root = { dataset: {} }
    setPlatform(null, root)
    assert.equal(await loadPlatform(async () => ({ platform: 'darwin', version: '1' }), root), 'darwin')
    assert.equal(getPlatform(), 'darwin')
    assert.equal(root.dataset.platform, 'darwin')
  })

  test('a failed app:info leaves the platform unknown and does not throw', async () => {
    const root = { dataset: {} }
    setPlatform(null, root)
    const failing = async () => {
      throw new Error('no ipc')
    }
    assert.equal(await loadPlatform(failing, root), null)
    assert.equal(root.dataset.platform, undefined)
  })

  test('no renderer file infers the platform from the user agent', () => {
    const files = []
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = `${d}/${e.name}`
        if (e.isDirectory()) walk(p)
        else if (/\.jsx?$/.test(e.name)) files.push(p)
      }
    }
    walk('src/renderer/src')
    for (const f of files) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /userAgent|tempPlatform/, f)
  })
})
