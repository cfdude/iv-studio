// The agent guide is read on every platform, so it must not name one platform's folders.
//   node --test test/unit/agent-guide-paths.test.mjs
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { readGuide } from '../../src/service/agent.js'

const resources = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'resources')

test('the guide names no Windows-only folder for exports', () => {
  const guide = readGuide(resources)
  assert.ok(!/Videos\\IV Studio/.test(guide), 'Videos\\IV Studio is a Windows folder')
  assert.ok(!/Videos[\\/]IV Studio/.test(guide))
})
