// What finish_candidate and the agent guide say the default enhancer is: DLSS 5 only on a Windows NVIDIA ComfyUI.
//   node --test test/unit/finish-default-wording.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { describe, test } from 'node:test'

describe('the default enhancer, as told to an agent', () => {
  const server = fs.readFileSync('src/mcp/server.js', 'utf8')
  const guide = fs.readFileSync('resources/agent-guide.md', 'utf8')
  test('the finish_candidate tool says DLSS 5 on a Windows NVIDIA ComfyUI, the 2× upscale and RIFE elsewhere', () => {
    assert.match(server, /Default: DLSS 5 on a Windows NVIDIA ComfyUI, the 2× upscale \+ RIFE elsewhere \(what a Mac uses\)/)
    assert.doesNotMatch(server, /dlss where DLSS 5 is installed/)
  })
  test('the agent guide says the same', () => {
    assert.match(guide, /`dlss` \(the default on a Windows NVIDIA ComfyUI; elsewhere `upscale`/)
    assert.doesNotMatch(guide, /the default where DLSS 5 is installed/)
  })
})
