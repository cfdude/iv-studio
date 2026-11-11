// Words and folders the MCP server tells an agent about what the person sees.
//   node --test test/unit/mcp-wording.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { mcpVideosBase, videosFolderOf } from '../../src/service/paths.js'
import { editsFolderText, liveEditText, rendersFolderText } from '../../src/shared/platform.js'
import { readGuide } from '../../src/service/agent.js'

test('the undo hint names the platform key', () => {
  assert.match(liveEditText('darwin'), /⌘Z/)
  assert.doesNotMatch(liveEditText('darwin'), /Ctrl/)
  for (const p of ['win32', 'linux']) assert.match(liveEditText(p), /undo your change with Ctrl\+Z\.$/)
})

test('the MCP server uses the helpers rather than fixed Windows text', () => {
  const src = fs.readFileSync('src/mcp/server.js', 'utf8')
  assert.match(src, /liveEditText\(process\.platform\)/)
  assert.doesNotMatch(src, /Ctrl\+Z/)
  assert.doesNotMatch(src, /Videos\\\\IV Studio/)
  assert.match(src, /rendersFolderText\(process\.platform\)/)
  assert.match(src, /editsFolderText\(process\.platform\)/)
})

test('folder text: Movies on a Mac, today\'s text elsewhere', () => {
  assert.equal(rendersFolderText('darwin'), '~/Movies/IV Studio')
  assert.equal(editsFolderText('darwin'), '~/Movies/IV Studio/Edits')
  for (const p of ['win32', 'linux']) {
    assert.equal(rendersFolderText(p), 'Videos\\IV Studio')
    assert.equal(editsFolderText(p), 'Videos\\IV Studio\\Edits')
  }
})

test('the MCP server saves under ~/Movies on a Mac, where the app does, and under Videos elsewhere', () => {
  assert.equal(path.join(mcpVideosBase({ platform: 'darwin', home: '/Users/me' }), 'IV Studio'), path.join('/Users/me', 'Movies', 'IV Studio'))
  assert.equal(videosFolderOf({}, { videos: mcpVideosBase({ platform: 'darwin', home: '/Users/me' }) }), path.join('/Users/me', 'Movies', 'IV Studio'))
  assert.equal(mcpVideosBase({ platform: 'win32', env: { USERPROFILE: 'C:\\Users\\me' }, home: 'C:\\home' }), path.join('C:\\Users\\me', 'Videos'))
  assert.equal(mcpVideosBase({ platform: 'linux', env: {}, home: '/home/me' }), path.join('/home/me', 'Videos'))
})

test('the agent guide names no Windows-only folder for exports', () => {
  const resources = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'resources')
  assert.doesNotMatch(readGuide(resources), /Videos[\\/]+IV Studio/)
})
