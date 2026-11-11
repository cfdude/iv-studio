// The third enhancer, "upscale": the finish's own 2× Real-ESRGAN upscale and RIFE frame interpolation, never DLSS 5 and
// never SeedVR2. It is what a Mac gets (SeedVR2 is refused on an Apple GPU, DLSS 5 is Windows-only) (SB-23).
//   node --test test/unit/upscale-enhancer.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { planFinish } from '../../src/service/plan.js'
import { capabilities, CLOUD_FPS, CLOUD_UPSCALER, finishCaps, NO_RIFE, NO_UPSCALER } from '../../src/service/remote.js'
import { Studio } from '../../src/service/studio.js'
import { startFakeComfy } from '../fakes/comfyui.mjs'
import { startMcp } from '../fakes/mcp.mjs'

const GB = 1024 ** 3
const mps = { name: 'mps', type: 'mps', vram_total: 64 * GB }
const cuda = { name: 'cuda:0 NVIDIA GeForce RTX 4090 : cudaMallocAsync', type: 'cuda', vram_total: 24 * GB }
const combo = (name, options) => ({ input: { required: { [name]: [options] } } })
const BOTH = { UpscaleModelLoader: combo('model_name', [CLOUD_UPSCALER]), 'RIFE VFI': {} }
const PROMPT = 'integrated_multimodal_description: [Shot 1] A woman walks along a rainy street.\n\noverall_soundscape: Rain on stone.\n\nnon_diegetic_music: N/A'

describe('planFinish with the upscale enhancer', () => {
  const preview = { request: { mode: 'text', seed: 1 }, groups: ['x'], values: {}, resolved: { width: 864, height: 480, frames: 124, seconds: 5.167, previews: 3 } }
  test('keeps the 2× and the frame rate the person asked for (SeedVR2 would zero them)', () => {
    const p = planFinish(preview, { enhancer: 'upscale', upscale2x: true, fps: 48 })
    assert.deepEqual([p.finish.enhancer, p.finish.upscale2x, p.finish.fps, p.resolved.enhancer, p.resolved.fps], ['upscale', true, 48, 'upscale', 48])
    assert.deepEqual([p.values['511'], p.values['512']], [2, 48])
    assert.equal(p.groups.at(-1), 'upscale')
  })
  test('an unknown enhancer names all three', () => {
    assert.throws(() => planFinish(preview, { enhancer: 'magic' }), /enhancer must be dlss, seedvr2 or upscale\./)
  })
})

describe('finishCaps: what a finish with each enhancer can use', () => {
  const sys = (devices) => ({ system: { os: 'posix' }, devices })
  test('upscale never uses DLSS 5, even where it is installed, and takes the RIFE frame rates', () => {
    const c = capabilities({ DLSS5_Enhance_Video: {}, ...BOTH }, sys([cuda]))
    const u = finishCaps(c, 'upscale')
    assert.deepEqual([u.dlss, u.upscale2x, u.rife, u.fps], [false, true, true, CLOUD_FPS])
    assert.equal(finishCaps(c, 'dlss'), c)
  })
  test('upscale with neither Real-ESRGAN x2 nor RIFE can make neither', () => {
    const u = finishCaps(capabilities({ DLSS5_Enhance_Video: {} }, sys([cuda])), 'upscale')
    assert.deepEqual([u.upscale2x, u.rife, u.fps], [false, false, [0]])
  })
  test('seedvr2 turns the DLSS-side finish off, as before', () => {
    const s = finishCaps(capabilities({ DLSS5_Enhance_Video: {}, ...BOTH }, sys([cuda])), 'seedvr2')
    assert.deepEqual([s.dlss, s.upscale2x, s.rife], [false, false, false])
  })
})

describe('Studio.finishCandidate with the upscale enhancer', () => {
  const stub = (objectInfo) => ({
    comfy: { remote: false },
    capabilities: async () => capabilities(objectInfo, { system: { os: 'posix' }, devices: [mps] }),
    getJob: () => ({ kind: 'previews', plan: {} })
  })
  const fin = (objectInfo, finish) => Studio.prototype.finishCandidate.call(stub(objectInfo), { jobId: 'j', enhancer: 'upscale', ...finish })
  test('[mcp:finish_candidate] 2× without Real-ESRGAN x2 says so and points at Setup', async () => {
    await assert.rejects(fin({ 'RIFE VFI': {} }, { upscale2x: true }), { message: NO_UPSCALER })
  })
  test('[mcp:finish_candidate] a frame rate without RIFE says so and points at Setup', async () => {
    await assert.rejects(fin({ UpscaleModelLoader: combo('model_name', [CLOUD_UPSCALER]) }, { fps: 48 }), (e) => e.message.includes(NO_RIFE) && /^This ComfyUI can make no other fps\./.test(e.message))
  })
  test('[mcp:finish_candidate] only the RIFE multiples of 24 are offered, not the DLSS rates', async () => {
    await assert.rejects(fin(BOTH, { fps: 60 }), { message: `This ComfyUI can make ${CLOUD_FPS.filter(Boolean).join(', ')} fps.` })
  })
})

describe('Studio.finishCandidate with no enhancer named (the MCP default)', () => {
  const preview = { request: { mode: 'text', seed: 1 }, groups: ['x'], values: {}, resolved: { width: 864, height: 480, frames: 124, seconds: 5.167, previews: 3 } }
  // what an agent that names no enhancer gets, by the machine's ComfyUI
  const picked = async (objectInfo, device, remote = false) => {
    let queued = null
    const stub = {
      comfy: { remote, hosted: remote },
      capabilities: async () => capabilities(objectInfo, { system: { os: 'posix' }, devices: [device] }),
      getJob: () => ({ kind: 'previews', plan: preview, name: 'n', projectId: 'p', id: 'j' }),
      getProject: () => ({}),
      submit: async (job) => ((queued = job), job)
    }
    await Studio.prototype.finishCandidate.call(stub, { jobId: 'j' })
    return queued.plan.finish.enhancer
  }
  test('[mcp:finish_candidate] an Apple GPU finishes with the upscale, not DLSS 5', async () => {
    assert.equal(await picked(BOTH, mps), 'upscale')
    assert.equal(await picked({ DLSS5_Enhance_Video: {}, ...BOTH }, mps), 'upscale')
  })
  test('[mcp:finish_candidate] a machine without DLSS 5 finishes with the upscale; one with it keeps DLSS 5', async () => {
    assert.equal(await picked(BOTH, cuda), 'upscale')
    assert.equal(await picked({ DLSS5_Enhance_Video: {}, ...BOTH }, cuda), 'dlss')
  })
  test('the schema leaves the enhancer to the machine instead of defaulting it to dlss', () => {
    assert.doesNotMatch(fs.readFileSync('src/mcp/server.js', 'utf8'), /enhancer: z\.enum\(\['dlss', 'seedvr2', 'upscale'\]\)\.default\('dlss'\)/)
  })
})

describe('MCP finish_candidate with the upscale enhancer on an Apple GPU ComfyUI that has both finishers', () => {
  let fake, mcp
  const call = (name, args = {}) => mcp.client.callTool({ name, arguments: args })
  const ok = async (name, args = {}) => {
    const r = await call(name, args)
    assert.ok(!r.isError, `${name}: ${JSON.stringify(r.content)}`)
    return r.structuredContent
  }
  before(async () => {
    fake = await startFakeComfy({ devices: 'mps', os: 'darwin', objectInfo: BOTH })
    mcp = await startMcp({ comfyUrl: fake.url })
  })
  after(async () => {
    await mcp?.close()
    await fake?.close()
  })

  test('[mcp:finish_candidate] queues Real-ESRGAN x2 then RIFE over the finish, with no DLSS and no SeedVR2', async () => {
    const take = path.join(path.dirname(mcp.dataDir), 'take.mp4')
    const job = await ok('generate_previews', { prompt: PROMPT, character: 'none' })
    const gif = { gifs: [{ filename: 'take.mp4', subfolder: 'H3/previews', type: 'output', fullpath: take }] }
    fake.state.history[job.promptId].outputs = { 42: gif, 118: gif, 128: gif }
    const source = await ok('get_job', { jobId: job.id })
    const queued = fake.prompts.length
    const finish = await ok('finish_candidate', { jobId: source.id, enhancer: 'upscale', upscale2x: true, fps: 48 })
    assert.equal(fake.prompts.length, queued + 1)
    assert.deepEqual([finish.plan.finish.enhancer, finish.plan.finish.upscale2x, finish.plan.finish.fps, finish.enhanceJob], ['upscale', true, 48, undefined])
    const g = fake.prompts.at(-1).prompt
    const classes = Object.values(g).map((n) => n.class_type)
    assert.ok(!classes.includes('DLSS5_Enhance_Video') && !classes.some((c) => /SeedVR2/.test(c)))
    assert.deepEqual(classes.filter((c) => /UpscaleModelLoader|ImageUpscaleWithModel|RIFE/.test(c)), ['UpscaleModelLoader', 'ImageUpscaleWithModel', 'RIFE VFI'])
    const rife = Object.values(g).find((n) => n.class_type === 'RIFE VFI')
    assert.equal(rife.inputs.multiplier, 2)
    assert.equal(Object.values(g).find((n) => n.class_type === 'UpscaleModelLoader').inputs.model_name, CLOUD_UPSCALER)
  })
})

describe('the MCP schema and the guides name the upscale enhancer', () => {
  test('the finish tools accept it and both agent guides say what it is', () => {
    const server = fs.readFileSync('src/mcp/server.js', 'utf8')
    assert.match(server, /enhancer: z\.enum\(\['dlss', 'seedvr2', 'upscale'\]\)/)
    for (const f of ['resources/agent-guide.md', 'skills/iv-studio/SKILL.md']) assert.match(fs.readFileSync(f, 'utf8'), /`upscale`.*Real-ESRGAN/s)
  })
})
