// MCP tools upstream added in v1.1.3 for what a render costs and how fast it goes: price_shot, price_workflow, get_speeds.
// Called through the real MCP server on source under the test guard, against a fake ComfyUI on an Apple GPU whose
// /object_info carries ComfyUI 0.44.1's own partner-node definitions (test/fixtures/partner-info.json), so the prices
// are the ones ComfyUI's own price formulas give. Nothing is queued, nothing is spent, nothing reaches api.comfy.org.
// Upstream's own scripts for the same ground: test/pricing.mjs, test/speed.mjs.
//   node --test test/unit/mcp-edits-v113-pricing.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { startFakeComfy } from '../fakes/comfyui.mjs'
import { startMcp } from '../fakes/mcp.mjs'

const PARTNER = JSON.parse(fs.readFileSync(new URL('../fixtures/partner-info.json', import.meta.url), 'utf8'))
const PROMPT = 'integrated_multimodal_description: [Shot 1] A woman walks along a rainy street.\n\noverall_soundscape: Rain on stone.\n\nnon_diegetic_music: N/A'
// a partner node that shows no price, and an ordinary free node
const NO_BADGE = { input: { required: {} }, output: ['VIDEO'], name: 'MysteryPartnerNode', display_name: 'Mystery partner', api_node: true, category: 'api node' }
const FREE_NODE = { input: { required: {} }, output: ['IMAGE'], name: 'SaveImage', display_name: 'Save Image', category: 'image' }
const seedanceGraph = (over = {}) => ({
  1: { class_type: 'ByteDance2TextToVideoNode', inputs: { model: 'Seedance 2.5', 'model.prompt': 'a fox', 'model.resolution': '720p', 'model.ratio': '16:9', 'model.duration': 5, 'model.generate_audio': true, 'model.output_format': 'mp4', seed: 0, watermark: false, ...over } },
  2: { class_type: 'SaveVideo', inputs: { video: ['1', 0], filename_prefix: 'x', format: 'auto', codec: 'auto' } }
})

describe('MCP pricing and speed tools on an Apple GPU', () => {
  let fake, mcp, dir
  const call = (name, args = {}) => mcp.client.callTool({ name, arguments: args })
  const ok = async (name, args = {}) => {
    const r = await call(name, args)
    assert.ok(!r.isError, `${name}: ${JSON.stringify(r.content)}`)
    return r.structuredContent
  }
  const fails = async (name, args, pattern) => {
    const r = await call(name, args)
    assert.equal(r.isError, true, `${name} should have failed`)
    assert.match(r.content[0].text, pattern)
  }
  const near = (a, b, d = 0.0005) => assert.ok(Math.abs(a - b) < d, `${a} is not ${b}`)
  const settingsFile = () => path.join(mcp.dataDir, 'settings.json')
  const setSettings = (patch) => fs.writeFileSync(settingsFile(), JSON.stringify({ ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')), ...patch }, null, 2))
  const writeGraph = (name, graph) => {
    const file = path.join(dir, name)
    fs.writeFileSync(file, typeof graph === 'string' ? graph : JSON.stringify(graph))
    return file
  }

  before(async () => {
    fake = await startFakeComfy({ devices: 'mps', os: 'darwin', objectInfo: { ...PARTNER, MysteryPartnerNode: NO_BADGE, SaveImage: FREE_NODE } })
    mcp = await startMcp({ comfyUrl: fake.url })
    dir = path.join(path.dirname(mcp.dataDir), 'graphs')
    fs.mkdirSync(dir, { recursive: true })
  })
  after(async () => {
    await mcp?.close()
    await fake?.close()
  })

  // ---------- price_workflow ----------
  test('[mcp:price_workflow] prices a Seedance 2.5 graph from ComfyUI\'s own formula: 720p, 16:9, 5 s is $1.6663, 352 credits', async () => {
    const queued = fake.prompts.length
    const p = await ok('price_workflow', { graph: seedanceGraph() })
    assert.equal(p.paid, true)
    near(p.minUsd, 1.6663)
    assert.equal(p.minUsd, p.maxUsd, 'one price, not a range')
    assert.deepEqual(p.credits, { min: 352, max: 352 })
    assert.equal(p.label, 'about $1.67 · 352 credits')
    assert.deepEqual(p.noPrice, [])
    assert.equal(p.nodes.length, 1, 'only the paid node is listed, not SaveVideo')
    assert.deepEqual(p.nodes[0], { id: '1', class: 'ByteDance2TextToVideoNode', title: 'ByteDance Seedance 2.5 Text to Video', minUsd: p.minUsd, maxUsd: p.maxUsd })
    assert.equal(fake.prompts.length, queued, 'pricing queues nothing')
  })

  test('[mcp:price_workflow] reprices when the settings change: 1080p for 10 s costs more than four times 720p for 5 s', async () => {
    const a = await ok('price_workflow', { graph: seedanceGraph() })
    const b = await ok('price_workflow', { graph: seedanceGraph({ 'model.resolution': '1080p', 'model.duration': 10 }) })
    assert.ok(b.maxUsd > a.maxUsd * 4, `${b.maxUsd} vs ${a.maxUsd}`)
  })

  test('[mcp:price_workflow] reads a path to an API-form .json file the same as the graph itself', async () => {
    const file = writeGraph('seedance_api.json', seedanceGraph())
    const viaPath = await ok('price_workflow', { path: file })
    assert.deepEqual(viaPath, await ok('price_workflow', { graph: seedanceGraph() }))
  })

  test('[mcp:price_workflow] keeps a fixed range (Draft to Final) as a range with both ends in the label', async () => {
    const p = await ok('price_workflow', { graph: { 1: { class_type: 'ByteDance2DraftToFinalVideoNode', inputs: { draft_task_id: 'abc' } } } })
    assert.equal(p.paid, true)
    near(p.minUsd, 3.2864)
    near(p.maxUsd, 29.3964)
    assert.deepEqual(p.credits, { min: 693, max: 6203 })
    assert.equal(p.label, '$3.29 to $29.40 · 693 to 6,203 credits')
  })

  test('[mcp:price_workflow] says free for a graph with no paid nodes, and for one that names a node ComfyUI does not have', async () => {
    for (const graph of [{}, { 1: { class_type: 'SaveImage', inputs: {} } }, { 1: { class_type: 'SomeNodeNobodyInstalled', inputs: {} } }]) {
      const p = await ok('price_workflow', { graph })
      assert.deepEqual({ paid: p.paid, label: p.label, minUsd: p.minUsd, maxUsd: p.maxUsd, nodes: p.nodes, noPrice: p.noPrice }, { paid: false, label: 'Free: no paid nodes', minUsd: 0, maxUsd: 0, nodes: [], noPrice: [] }, JSON.stringify(graph))
      assert.deepEqual(p.credits, { min: 0, max: 0 })
    }
  })

  test('[mcp:price_workflow] lists a paid node that shows no price, and adds up only the ones that do', async () => {
    const graph = { ...seedanceGraph(), 7: { class_type: 'MysteryPartnerNode', inputs: {}, _meta: { title: 'Mystery shot' } } }
    const p = await ok('price_workflow', { graph })
    assert.equal(p.paid, true)
    near(p.maxUsd, 1.6663, 0.001)
    assert.deepEqual(p.noPrice, ['Mystery shot'])
    assert.match(p.label, /plus 1 node with no price shown$/)
    const mystery = p.nodes.find((n) => n.id === '7')
    assert.deepEqual(mystery, { id: '7', class: 'MysteryPartnerNode', title: 'Mystery shot', unknown: true, why: 'This node does not say what it costs.' })
    const only = await ok('price_workflow', { graph: { 7: { class_type: 'MysteryPartnerNode', inputs: {} } } })
    assert.equal(only.label, 'Price not shown by these nodes')
    assert.deepEqual(only.noPrice, ['Mystery partner'], 'the node\'s display name when the graph gives no title')
  })

  test('[mcp:price_workflow] refuses with exact words: nothing given, a window-saved (UI form) workflow, a missing file, a file that is not JSON', async () => {
    await fails('price_workflow', {}, /^Pass graph or path\.$/)
    await fails('price_workflow', { graph: { nodes: [], links: [] } }, /^This is a workflow saved from ComfyUI’s window \(UI form\)\. Save it with Export \(API\), or pass the API form\.$/)
    await fails('price_workflow', { path: path.join(dir, 'ui_form.json') }, /ENOENT/)
    await fails('price_workflow', { path: writeGraph('ui_form.json', { nodes: [{ id: 1 }], links: [] }) }, /UI form/)
    await fails('price_workflow', { path: writeGraph('broken.json', '{ not json') }, /JSON/)
    await fails('price_workflow', { graph: 'a string' }, /Invalid arguments/)
    assert.equal(fake.prompts.length, 0, 'every refusal queued nothing')
  })

  // ---------- price_shot ----------
  test('[mcp:price_shot] says an H3 render on this computer is free, and queues nothing', async () => {
    const p = await ok('price_shot', { prompt: PROMPT, character: 'none' })
    assert.deepEqual(p, { paid: false, label: 'Free on this computer', minUsd: 0, maxUsd: 0, noPrice: [] })
    assert.equal(fake.prompts.length, 0)
  })

  test('[mcp:price_shot] prices a Seedance shot per take: one 720p 5 s take is $1.6663, and the default two takes cost double', async () => {
    const one = await ok('price_shot', { engine: 'seedance', tier: '720p', seconds: 5, previews: 1 })
    near(one.maxUsd, 1.6663)
    assert.deepEqual(one.credits, { min: 352, max: 352 })
    assert.equal(one.label, 'about $1.67 · 352 credits')
    assert.equal(one.paid, true)
    assert.deepEqual(one.noPrice, [])
    const two = await ok('price_shot', { engine: 'seedance', tier: '720p', seconds: 5 })
    near(two.maxUsd, one.maxUsd * 2)
    assert.equal(two.credits.max, 703)
    const three = await ok('price_shot', { engine: 'seedance', tier: '720p', seconds: 5, previews: 3 })
    near(three.maxUsd, one.maxUsd * 3, 0.001)
    // it matches what price_workflow says for the same node
    near(one.maxUsd, (await ok('price_workflow', { graph: seedanceGraph() })).maxUsd)
    assert.equal(fake.prompts.length, 0)
  })

  test('[mcp:price_shot] a longer, bigger, taller shot costs more, and the draft tier costs less than final quality', async () => {
    const base = await ok('price_shot', { engine: 'seedance', tier: '720p', seconds: 5, previews: 1 })
    const long = await ok('price_shot', { engine: 'seedance', tier: '720p', seconds: 10, previews: 1 })
    const big = await ok('price_shot', { engine: 'seedance', tier: '1080p', seconds: 5, previews: 1 })
    const draft = await ok('price_shot', { engine: 'seedance', tier: 'draft', seconds: 5, previews: 1 })
    assert.ok(long.maxUsd > base.maxUsd * 1.5, `10 s ${long.maxUsd} vs 5 s ${base.maxUsd}`)
    assert.ok(big.maxUsd > base.maxUsd, `1080p ${big.maxUsd} vs 720p ${base.maxUsd}`)
    assert.ok(draft.maxUsd < base.maxUsd, `draft ${draft.maxUsd} vs 720p ${base.maxUsd}`)
  })

  test('[mcp:price_shot] with a jobId it prices finishing a Seedance draft at 1080p, a flat range the OK has to cover the top of', async () => {
    fs.mkdirSync(path.join(mcp.dataDir, 'jobs'), { recursive: true })
    fs.writeFileSync(path.join(mcp.dataDir, 'jobs', 'draftjob1.json'), JSON.stringify({ id: 'draftjob1', kind: 'previews', plan: { engine: 'seedance', resolved: { draft: true, seconds: 5 }, request: { aspect: '16:9', audio: true } }, outputs: [] }))
    const p = await ok('price_shot', { jobId: 'draftjob1' })
    assert.equal(p.paid, true)
    near(p.minUsd, 3.2864)
    near(p.maxUsd, 29.3964)
    assert.equal(p.label, '$3.29 to $29.40 · 693 to 6,203 credits')
    assert.equal(fake.prompts.length, 0)
  })

  test('[mcp:price_shot] finishing a take that is not a Seedance draft is free', async () => {
    fs.writeFileSync(path.join(mcp.dataDir, 'jobs', 'h3job1.json'), JSON.stringify({ id: 'h3job1', kind: 'previews', plan: { engine: 'h3', resolved: {}, request: {} }, outputs: [] }))
    fs.writeFileSync(path.join(mcp.dataDir, 'jobs', 'seedfinal.json'), JSON.stringify({ id: 'seedfinal', kind: 'previews', plan: { engine: 'seedance', resolved: { draft: false, seconds: 5 }, request: {} }, outputs: [] }))
    for (const jobId of ['h3job1', 'seedfinal']) {
      const p = await ok('price_shot', { jobId })
      assert.deepEqual({ paid: p.paid, label: p.label, minUsd: p.minUsd, maxUsd: p.maxUsd }, { paid: false, label: 'Free', minUsd: 0, maxUsd: 0 }, jobId)
    }
  })

  test('[mcp:price_shot] refuses with exact words: an unknown job, a length Seedance does not make, a mode missing its pictures, a ComfyUI too old for Seedance', async () => {
    await fails('price_shot', { jobId: 'nope' }, /^No job nope$/)
    await fails('price_shot', { engine: 'seedance', seconds: 3 }, /^Seedance makes 4 to 30 seconds\.$/)
    await fails('price_shot', { engine: 'seedance', mode: 'frames' }, /^First \/ last frame needs 1 picture \(the first frame\) or 2 \(first and last\)\.$/)
    await fails('price_shot', { engine: 'seedance', mode: 'continue' }, /^Continue a video needs exactly one source video\.$/)
    const old = await startFakeComfy({ devices: 'mps', os: 'darwin' })
    const oldMcp = await startMcp({ comfyUrl: old.url })
    try {
      await fails2(oldMcp, 'price_shot', { engine: 'seedance', tier: '720p' }, /^This ComfyUI has no ByteDance2ReferenceNodeV2\. Seedance 2\.5 needs ComfyUI 0\.44 or newer \(Settings → Setup → Updates\)\.$/)
      assert.equal(old.prompts.length, 0)
    } finally {
      await oldMcp.close()
      await old.close()
    }
    assert.equal(fake.prompts.length, 0)
  })
  const fails2 = async (who, name, args, pattern) => {
    const r = await who.client.callTool({ name, arguments: args })
    assert.equal(r.isError, true, `${name} should have failed`)
    assert.match(r.content[0].text, pattern)
  }

  // ---------- get_speeds ----------
  const SPEEDS = {
    quality: { label: 'Quality', previewMp: 0.4, steps: 8, previews: 3, finalMp: 2, upscale2x: false, estimate: { hunt: 180, finish: 194 } },
    balanced: { label: 'Balanced', previewMp: 0.4, steps: 8, previews: 2, finalMp: 1, upscale2x: true, estimate: { hunt: 135, finish: 116 } },
    fast: { label: 'Fast', previewMp: 0.3, steps: 4, previews: 2, finalMp: 1, upscale2x: true, estimate: { hunt: 60, finish: 116 } },
    low: { label: 'Low memory', previewMp: 0.3, steps: 4, previews: 1, finalMp: 1, upscale2x: true, maxFinalMp: 1, estimate: { hunt: 40, finish: 116 } }
  }

  test('[mcp:get_speeds] lists the four speed presets in order with what each sets for previews and the finish, and Quality saved when nothing is', async () => {
    const s = await ok('get_speeds')
    assert.equal(s.saved, 'quality')
    assert.deepEqual(s.speeds.map((x) => x.id), ['quality', 'balanced', 'fast', 'low'])
    for (const x of s.speeds) {
      const { say, trade, id, ...numbers } = x
      assert.deepEqual(numbers, SPEEDS[id], id)
      assert.ok(say.length > 10 && trade.length > 10, `${id} says what it does and what it trades`)
    }
  })

  test('[mcp:get_speeds] reports the saved preset: the one in Settings, else the older Check my computer pick, else Quality', async () => {
    setSettings({ speed: 'fast', shotPrefs: null })
    assert.equal((await ok('get_speeds')).saved, 'fast')
    setSettings({ speed: 'turbo', shotPrefs: null })
    assert.equal((await ok('get_speeds')).saved, 'quality', 'a name that is not a preset is not believed')
    setSettings({ speed: null, shotPrefs: { speed: 'low' } })
    assert.equal((await ok('get_speeds')).saved, 'low')
    for (const [finalMp, want] of [[2, 'quality'], [1.5, 'balanced'], [1, 'low']]) {
      setSettings({ speed: null, shotPrefs: { finalMp } })
      assert.equal((await ok('get_speeds')).saved, want, `older pick of a ${finalMp} MP finish`)
    }
    setSettings({ speed: null, shotPrefs: null })
    assert.equal((await ok('get_speeds')).saved, 'quality')
  })

  test('[mcp:get_speeds] on a Mac names no finish that needs an NVIDIA card: no DLSS 5, SeedVR2, RTX or CUDA in any preset', async () => {
    assert.equal((await ok('get_speeds')).saved, 'quality')
    const text = JSON.stringify(await ok('get_speeds'))
    assert.doesNotMatch(text, /dlss|seedvr2|rtx|cuda|nvidia|geforce/i)
    // and the card the fake reports really is an Apple GPU
    const stats = await (await fetch(`${fake.url}/system_stats`)).json()
    assert.equal(stats.devices[0].type, 'mps')
    assert.equal(stats.system.os, 'darwin')
  })

  test('a speed preset\'s finish on a Mac uses the upscale enhancer (Real-ESRGAN 2x and RIFE), never DLSS 5 or SeedVR2, at the size the preset names', async () => {
    const want = { quality: [1952, 1088, null], balanced: [2752, 1536, [1376, 768]], fast: [2752, 1536, [1376, 768]], low: [2752, 1536, [1376, 768]] }
    for (const speed of Object.keys(SPEEDS)) {
      const plan = await ok('plan_render', { prompt: PROMPT, character: 'none', speed, finish: { enhancer: 'upscale' } })
      assert.equal(plan.finish.enhancer, 'upscale', speed)
      assert.notEqual(plan.finish.enhancer, 'dlss')
      assert.notEqual(plan.finish.enhancer, 'seedvr2')
      const [w, h, up] = want[speed]
      assert.deepEqual([plan.finish.width, plan.finish.height], [w, h], `${speed} finished size`)
      if (up) assert.deepEqual(plan.finish.upscaleSize, { width: up[0], height: up[1] }, `${speed} is a 1 MP pass then 2x`)
      else assert.deepEqual(plan.finish.upscaleSize, { width: w, height: h }, `${speed} is a single 2 MP pass`)
      // the previews follow the preset too
      assert.equal(plan.resolved.previews, SPEEDS[speed].previews, `${speed} takes`)
    }
    assert.equal(fake.prompts.length, 0, 'planning queues nothing')
  })

  test('the saved speed sets the previews of a plan that names none, and a plan\'s own speed wins over it', async () => {
    setSettings({ speed: 'low' })
    const saved = await ok('plan_render', { prompt: PROMPT, character: 'none' })
    assert.equal(saved.resolved.previews, 1)
    assert.deepEqual([saved.resolved.width, saved.resolved.height], [736, 416])
    const own = await ok('plan_render', { prompt: PROMPT, character: 'none', speed: 'balanced' })
    assert.equal(own.resolved.previews, 2)
    assert.deepEqual([own.resolved.width, own.resolved.height], [864, 480])
    await fails('plan_render', { prompt: PROMPT, speed: 'turbo' }, /speed/i)
    setSettings({ speed: null })
  })
})
