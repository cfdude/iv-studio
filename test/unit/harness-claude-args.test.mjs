// "Write it for me" starts the person's `claude` with their hooks switched off, so a notification hook (osascript on a
// Mac) can't make macOS ask whether IV Studio may control System Events. The flag was checked against
// `claude --help` (--settings <file-or-json>) and a real run: a project hook fired without it and not with it.
//   node --test test/unit/harness-claude-args.test.mjs
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { claudeWriterArgs } from '../../src/service/harness.js'

describe('claudeWriterArgs', () => {
  const args = claudeWriterArgs({ schema: { type: 'object' }, sysFile: '/tmp/system.txt', model: 'haiku' })

  test('turns every hook off through --settings, with a JSON value that parses', () => {
    const i = args.indexOf('--settings')
    assert.ok(i >= 0)
    assert.deepEqual(JSON.parse(args[i + 1]), { disableAllHooks: true })
  })
  test('keeps the rest of the call as it was', () => {
    assert.deepEqual(args.slice(0, 6), ['-p', '--output-format', 'json', '--json-schema', '{"type":"object"}', '--tools'])
    assert.equal(args[args.indexOf('--tools') + 1], '')
    assert.ok(args.includes('--strict-mcp-config') && args.includes('--no-session-persistence'))
    assert.equal(args[args.indexOf('--system-prompt-file') + 1], '/tmp/system.txt')
    assert.equal(args[args.indexOf('--model') + 1], 'haiku')
  })
  test('Read only when there are pictures, and no --model when none is chosen', () => {
    assert.equal(claudeWriterArgs({ schema: {}, sysFile: 'x', reads: true })[claudeWriterArgs({ schema: {}, sysFile: 'x', reads: true }).indexOf('--tools') + 1], 'Read')
    assert.ok(!claudeWriterArgs({ schema: {}, sysFile: 'x' }).includes('--model'))
  })
})
