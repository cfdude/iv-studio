// MCP finish and enhance tools on an NVIDIA ComfyUI with DLSS 5 and SeedVR2 installed (task 5.4): the cases the Apple
// GPU file (mcp-render.test.mjs) cannot reach, because SeedVR2 is refused there and DLSS is replaced. Called through
// the real MCP server on source under the test guard, against the fake ComfyUI (design D1, D8). One fake and one
// server for the file. What this ComfyUI can do is read once per server run, so the fake is set up before the first
// call.
//   node --test test/unit/mcp-render-finish.test.mjs
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import ffmpegStatic from 'ffmpeg-ffprobe-static'
import { startFakeComfy } from '../fakes/comfyui.mjs'
import { startMcp } from '../fakes/mcp.mjs'

const PROMPT = 'integrated_multimodal_description: [Shot 1] A woman walks along a rainy street.\n\noverall_soundscape: Rain on stone.\n\nnon_diegetic_music: N/A'
const TEMP = fs.realpathSync(os.tmpdir())
const DIT = 'seedvr2_ema_3b_fp16.safetensors'
const combo = (name, options) => ({ input: { required: { [name]: [options] } } })
const OBJECT_INFO = { DLSS5_Enhance_Video: { input: { required: {} } }, SeedVR2LoadDiTModel: combo('model', [DIT, 'seedvr2_ema_7b_fp16.safetensors']) }

describe('MCP finish and enhance tools on an NVIDIA ComfyUI', () => {
  let fake, mcp, take, final
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
  const readData = (...p) => JSON.parse(fs.readFileSync(path.join(mcp.dataDir, ...p), 'utf8'))
  const lastGraph = () => fake.prompts.at(-1).prompt
  const lastExtra = () => fake.prompts.at(-1).extra_data
  const classes = (g) => Object.values(g).map((n) => n.class_type)
  // a previews job that has finished on the fake and been read back
  const finishedPreviews = async (args = {}) => {
    const job = await ok('generate_previews', { prompt: PROMPT, character: 'none', ...args })
    const gif = { gifs: [{ filename: 'take.mp4', subfolder: 'H3/previews', type: 'output', fullpath: take }] }
    fake.state.history[job.promptId].outputs = { 42: gif, 118: gif, 128: gif }
    return ok('get_job', { jobId: job.id })
  }
  // a finish job that has finished on the fake and been read back, with its final video saved under the temp folder
  const finishedFinish = async (finish = {}) => {
    const source = await finishedPreviews({ projectName: 'Enhance shot' })
    const job = await ok('finish_candidate', { jobId: source.id, ...finish })
    fake.state.history[job.promptId].outputs = { 51: { text: [final] } }
    return { source, job: await ok('get_job', { jobId: job.id }) }
  }

  before(async () => {
    fake = await startFakeComfy({ devices: 'cuda', os: 'win32', objectInfo: OBJECT_INFO })
    mcp = await startMcp({ comfyUrl: fake.url })
    const dir = path.join(path.dirname(mcp.dataDir), 'fixtures')
    fs.mkdirSync(dir, { recursive: true })
    take = path.join(dir, 'take.mp4')
    final = path.join(dir, 'final-audio.mp4')
    for (const file of [take, final]) execFileSync(ffmpegStatic.ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=s=128x96:r=24:d=2', '-f', 'lavfi', '-i', 'sine=f=440:d=2', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', file])
  })
  after(async () => {
    await mcp?.close()
    await fake?.close()
  })

  // ---------- finish_candidate ----------
  test('[mcp:finish_candidate] keeps the DLSS 5 pass in the graph with the frame rate and 2x it was asked for', async () => {
    const source = await finishedPreviews({ seed: 31 })
    const queued = fake.prompts.length
    const job = await ok('finish_candidate', { jobId: source.id, candidate: 3, upscale2x: true, fps: 60, megapixels: 1 })
    assert.equal(fake.prompts.length, queued + 1)
    assert.equal(job.kind, 'finish')
    assert.equal(job.parent, source.id)
    assert.deepEqual([job.plan.finish.candidate, job.plan.finish.upscale2x, job.plan.finish.fps, job.plan.finish.megapixels], [3, true, 60, 1])
    assert.deepEqual(job.plan.resolved, { width: 2752, height: 1536, enhancer: 'dlss', upscaleSize: { width: 1376, height: 768 }, fps: 60, frames: 310, seconds: 5.167, singlePass: false })
    assert.deepEqual(lastExtra().iv_studio, { kind: 'finish', project: source.projectId, sequence: null })
    const g = lastGraph()
    assert.equal(g['50'].class_type, 'DLSS5_Enhance_Video')
    assert.equal(g['511'].inputs.value, 2)
    assert.equal(g['512'].inputs.value, 60)
    assert.equal(g['504'].inputs.value, 1)
    assert.equal(g['80'].inputs.value, source.name)
    assert.equal(readData('jobs', `${job.id}.json`).previewPlan.resolved.seeds[0], 31)
  })

  test('[mcp:finish_candidate] queues the SeedVR2 enhancer\'s finish without DLSS and starts the enhance when the finish is done', async () => {
    const source = await finishedPreviews({ projectName: 'Seedvr shot' })
    const job = await ok('finish_candidate', { jobId: source.id, enhancer: 'seedvr2', enhanceResolution: 1440, upscale2x: true, fps: 60 })
    // SeedVR2 replaces 2x and frame generation, and the finish skips the DLSS node
    assert.deepEqual([job.plan.finish.enhancer, job.plan.finish.enhanceResolution, job.plan.finish.upscale2x, job.plan.finish.fps], ['seedvr2', 1440, false, 0])
    assert.ok(!classes(lastGraph()).includes('DLSS5_Enhance_Video'))
    assert.equal(lastGraph()['50_cl_save'].class_type, 'VHS_VideoCombine')
    const queued = fake.prompts.length
    fake.state.history[job.promptId].outputs = { 51: { text: [final] } }
    const done = await ok('get_job', { jobId: job.id })
    assert.equal(done.status, 'success')
    assert.deepEqual(done.outputs.map((o) => [o.kind, o.path]), [['final', final]])
    // reading the finished finish queued its enhance job, in the same project
    assert.equal(fake.prompts.length, queued + 1)
    assert.ok(done.enhanceJob)
    assert.ok(!done.enhanceError)
    const enhance = readData('jobs', `${done.enhanceJob}.json`)
    assert.deepEqual([enhance.kind, enhance.parent, enhance.projectId, enhance.plan.enhance.engine, enhance.plan.enhance.resolution], ['enhance', job.id, source.projectId, 'seedvr2', 1440])
    assert.equal(lastGraph().load.inputs.video, final)
    assert.equal(lastGraph().up.inputs.resolution, 1440)
  })

  test('[mcp:finish_candidate] says which frame rates this DLSS install can make and queues nothing for it', async () => {
    const source = await finishedPreviews()
    const queued = fake.prompts.length
    await fails('finish_candidate', { jobId: source.id, fps: 48 }, /^This ComfyUI can make 30, 50, 60, 120 fps\.$/)
    await fails('finish_candidate', { jobId: source.id, enhancer: 'seedvr2', enhanceResolution: 720 }, /enhanceResolution/i)
    await fails('finish_candidate', { jobId: source.id, audio: 'voice' }, /Final audio "voice" needs a voice line\./)
    assert.equal(fake.prompts.length, queued)
  })

  // ---------- enhance_final ----------
  test('[mcp:enhance_final] queues SeedVR2 over the final video with its sound kept, as a new job in the same shot', async () => {
    const { source, job: finish } = await finishedFinish()
    const queued = fake.prompts.length
    const job = await ok('enhance_final', { jobId: finish.id, resolution: 1440 })
    assert.equal(fake.prompts.length, queued + 1)
    assert.equal(job.kind, 'enhance')
    assert.equal(job.parent, finish.id)
    assert.equal(job.projectId, source.projectId)
    assert.deepEqual(job.plan.enhance, { engine: 'seedvr2', resolution: 1440, model: DIT, from: final })
    assert.deepEqual(lastExtra().iv_studio, { kind: 'enhance', project: source.projectId, sequence: null })
    const g = lastGraph()
    assert.equal(g.load.inputs.video, final)
    assert.equal(g.dit.inputs.model, DIT)
    assert.equal(g.dit.inputs.device, 'cuda:0')
    assert.equal(g.up.inputs.resolution, 1440)
    assert.deepEqual([g.up.inputs.batch_size, g.up.inputs.temporal_overlap], [9, 2])
    assert.equal(g.save.inputs.filename_prefix, 'H3/enhanced/final_enhanced_1440')
    assert.deepEqual(g.save.inputs.audio, ['load', 2])
    assert.deepEqual(readData('projects', `${source.projectId}.json`).jobs.slice(-1), [job.id])
    assert.ok(fs.realpathSync(g.load.inputs.video).startsWith(TEMP + path.sep), 'the video it reads is under the temp folder')
  })

  test('[mcp:enhance_final] queues DLSS 5 over the final video at scale 2 when asked for the dlss engine', async () => {
    const { job: finish } = await finishedFinish()
    const job = await ok('enhance_final', { jobId: finish.id, engine: 'dlss', scale: 2 })
    assert.deepEqual(job.plan.enhance, { engine: 'dlss', scale: 2, from: final })
    const g = lastGraph()
    assert.equal(g.dlss.class_type, 'DLSS5_Enhance_Video')
    assert.equal(g.dlss.inputs['Video Path'], final)
    assert.equal(g.dlss.inputs.Scale, 2)
    assert.equal(g.dlss.inputs['Output Directory'], 'H3/enhanced')
    assert.equal(g.dlss.inputs['Filename Prefix'], 'final_dlss_2x')
    assert.equal(g.out.class_type, 'PreviewAny')
    // the path DLSS answers with becomes the enhanced final
    fake.state.history[job.promptId].outputs = { out: { text: [path.join(path.dirname(final), 'final_dlss_2x.mp4')] } }
    const done = await ok('get_job', { jobId: job.id })
    assert.deepEqual(done.outputs.map((o) => [o.kind, path.basename(o.path)]), [['final', 'final_dlss_2x.mp4']])
  })

  test('[mcp:enhance_final] says when SeedVR2 is not installed in ComfyUI and queues nothing', async () => {
    const { job: finish } = await finishedFinish()
    const queued = fake.prompts.length
    fake.setObjectInfo({ DLSS5_Enhance_Video: OBJECT_INFO.DLSS5_Enhance_Video })
    try {
      await fails('enhance_final', { jobId: finish.id }, /SeedVR2 isn't installed in ComfyUI \(ComfyUI-SeedVR2_VideoUpscaler\)\./)
    } finally {
      fake.setObjectInfo(OBJECT_INFO)
    }
    assert.equal(fake.prompts.length, queued)
    assert.ok((await ok('enhance_final', { jobId: finish.id })).id, 'with the pack back it queues')
  })
})
