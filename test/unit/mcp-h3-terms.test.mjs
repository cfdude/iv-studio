// MiniMax H3's terms gate through the real MCP server (upstream 86cd42b): an agent can't agree for the person, so an
// H3 render is refused and nothing reaches ComfyUI until the terms are agreed in the window. The other MCP tests are
// seeded with the terms agreed (test/fakes/mcp.mjs seedSettings); this one seeds them not agreed.
//   node --test test/unit/mcp-h3-terms.test.mjs
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { H3_TERMS_NEEDED } from '../../src/service/terms.js'
import { startFakeComfy } from '../fakes/comfyui.mjs'
import { startMcp } from '../fakes/mcp.mjs'

const PROMPT = 'integrated_multimodal_description: [Shot 1] A woman walks along a rainy street.\n\noverall_soundscape: Rain on stone.\n\nnon_diegetic_music: N/A'

describe('MiniMax H3 terms gate on an Apple GPU', () => {
  let fake, mcp
  before(async () => {
    fake = await startFakeComfy({ devices: 'mps', os: 'darwin' })
    mcp = await startMcp({ comfyUrl: fake.url, settings: { h3Terms: null } })
  })
  after(async () => {
    await mcp?.close()
    await fake?.close()
  })

  test('[mcp:generate_previews] refuses an H3 render until the person has agreed to the terms, and queues nothing', async () => {
    const r = await mcp.client.callTool({ name: 'generate_previews', arguments: { prompt: PROMPT, character: 'none' } })
    assert.equal(r.isError, true)
    assert.equal(r.content[0].text, H3_TERMS_NEEDED)
    assert.equal(fake.prompts.length, 0)
  })

  test('[mcp:check_setup] still answers while the terms are not agreed (only rendering waits for them)', async () => {
    const r = await mcp.client.callTool({ name: 'check_setup', arguments: {} })
    assert.ok(!r.isError, JSON.stringify(r.content))
  })
})
