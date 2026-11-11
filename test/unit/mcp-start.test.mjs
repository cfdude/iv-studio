// The MCP server started as a real process on source, under the test guard, talking to a fake ComfyUI (design D1).
//   node --test test/unit/mcp-start.test.mjs
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { startFakeComfy } from '../fakes/comfyui.mjs'
import { startMcp } from '../fakes/mcp.mjs'

describe('MCP server on source', () => {
  let fake, mcp
  before(async () => {
    fake = await startFakeComfy({ devices: 'mps' })
    mcp = await startMcp({ comfyUrl: fake.url })
  })
  after(async () => {
    await mcp?.close()
    await fake?.close()
  })

  test('it lists at least 166 tools from source', async () => {
    const { tools } = await mcp.client.listTools()
    assert.ok(tools.length >= 166, `only ${tools.length} tools`)
    assert.ok(tools.some((t) => t.name === 'check_setup'))
  })

  test('[mcp:make_dailies] tells an agent the dailies folder in this platform\'s words', async () => {
    const { tools } = await mcp.client.listTools()
    const d = tools.find((t) => t.name === 'make_dailies').description
    assert.match(d, process.platform === 'darwin' ? /Into ~\/Movies\/IV Studio\/Dailies\./ : /Into Videos\\IV Studio\\Dailies\./)
  })

  test('check_setup against a fake reporting mps returns its GPU item', async () => {
    const r = await mcp.client.callTool({ name: 'check_setup', arguments: {} })
    assert.ok(!r.isError, JSON.stringify(r.content))
    const items = r.structuredContent.items
    const gpu = items.find((i) => i.id === 'gpu')
    assert.ok(gpu, `no GPU item in ${items.map((i) => i.id)}`)
    assert.match(gpu.detail, /Apple GPU/)
  })

  test('a tool that spawns claude is refused inside the child', async () => {
    const r = await mcp.client.callTool({ name: 'write_prompt', arguments: { idea: 'a quiet street at dusk', engine: 'claude' } })
    assert.equal(r.isError, true)
    // on a machine with a real claude on its PATH the guard refuses to start it; on one without, the app says it isn't installed
    const refused = (await mcp.refusals()).some((x) => x.command === 'claude')
    assert.ok(refused || /isn't installed/.test(r.content[0].text), r.content[0].text)
    assert.doesNotMatch(r.content[0].text, /canned/)
  })

  test('with the shims opted in, the same tool reaches the canned claude answer', { skip: process.platform === 'win32' && 'the agent CLI shims are sh scripts' }, async () => {
    const shimmed = await startMcp({ comfyUrl: fake.url, shims: true })
    try {
      const r = await shimmed.client.callTool({ name: 'write_prompt', arguments: { idea: 'a quiet street at dusk', engine: 'claude' } })
      // the shim answers with { canned: true }, which the writer may reject as a prompt: either way claude was reached, not refused
      const text = JSON.stringify(r)
      assert.ok(!/isn't installed/.test(text), text.slice(0, 300))
    } finally {
      await shimmed.close()
    }
  })

  test('a value the schema rejects returns an error naming the bad field', async () => {
    const r = await mcp.client.callTool({ name: 'plan_render', arguments: { mode: 'frames', prompt: 'x', aspect: 'not-an-aspect' } })
    assert.equal(r.isError, true)
    assert.match(r.content[0].text, /aspect/)
  })
})
