// Words the MCP server tells an agent about what the person sees.
//   node --test test/unit/mcp-wording.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { test } from 'node:test'
import { liveEditText } from '../../src/shared/platform.js'

test('the undo hint names the platform key', () => {
  assert.match(liveEditText('darwin'), /⌘Z/)
  assert.doesNotMatch(liveEditText('darwin'), /Ctrl/)
  for (const p of ['win32', 'linux']) assert.match(liveEditText(p), /undo your change with Ctrl\+Z\.$/)
})

test('the MCP server uses it rather than a fixed Ctrl+Z', () => {
  const src = fs.readFileSync('src/mcp/server.js', 'utf8')
  assert.match(src, /liveEditText\(process\.platform\)/)
  assert.doesNotMatch(src, /Ctrl\+Z/)
})
