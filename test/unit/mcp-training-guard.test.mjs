// What the test guard keeps from the MCP training tools that need something unfaked (task 5.7, part 4): start_training and
// stop_training need Modal (or Fizgig's Python on this computer), and rank_likeness and score_checkpoints need Shinobi's Python
// for InsightFace. Their rows have gaps entries (`needs Modal`, `spawns python`) and no row id here: these tests prove
// what each tool does on the way to the part it cannot run, and that nothing started or was spent.
//   node --test test/unit/mcp-training-guard.test.mjs
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { after, afterEach, before, describe, test } from 'node:test'
import ffmpegStatic from 'ffmpeg-ffprobe-static'
import { startFakeComfy } from '../fakes/comfyui.mjs'
import { startMcp } from '../fakes/mcp.mjs'

const combo = (name, options) => ({ input: { required: { [name]: [options] } } })
const OBJECT_INFO = {
  UNETLoader: combo('unet_name', ['z_image_turbo_bf16.safetensors']),
  CLIPLoader: combo('clip_name', ['qwen_3_4b.safetensors']),
  VAELoader: combo('vae_name', ['ae.safetensors']),
  LoraLoaderModelOnly: combo('lora_name', ['SmartphoneSnapshotPhotoReality_v8.safetensors'])
}

describe('guard and the MCP training tools that need Modal or Python', () => {
  let fake, mcp, dir, still
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
    return r.content[0].text
  }
  const dataFile = (...p) => path.join(mcp.dataDir, ...p)
  const readTraining = (id) => JSON.parse(fs.readFileSync(dataFile('trainings', id, 'training.json'), 'utf8'))
  const writeTraining = (t) => fs.writeFileSync(dataFile('trainings', t.id, 'training.json'), JSON.stringify(t))
  const refusedCount = async () => (await mcp.refusals()).length
  // a training with a face picked and eight kept stills and two kept clips (12 items, $2.68 on Modal's H200)
  const set = async (name) => {
    fake.setOutputs((g) => (Object.values(g).some((n) => n.class_type === 'EmptySD3LatentImage') ? { 11: { images: [{ filename: 'face.png', subfolder: 'x', type: 'output', fullpath: still }] } } : undefined))
    const t = await ok('create_character_training', { name })
    await ok('design_faces', { trainingId: t.id, faceText: 'round face' })
    await ok('pick_face', { trainingId: t.id, index: 0 })
    await ok('update_character_training', { trainingId: t.id, consent: true })
    await ok('add_training_files', { trainingId: t.id, kind: 'still', files: Array(8).fill(still) })
    await ok('add_training_files', { trainingId: t.id, kind: 'clip', files: [path.join(dir, 'clip.mp4'), path.join(dir, 'clip.mp4')] })
    return t.id
  }
  afterEach(() => fake.setOutputs(null))

  before(async () => {
    fake = await startFakeComfy({ devices: 'cuda', os: 'win32', objectInfo: OBJECT_INFO })
    mcp = await startMcp({ comfyUrl: fake.url })
    dir = path.join(path.dirname(mcp.dataDir), 'fixtures')
    fs.mkdirSync(dir, { recursive: true })
    still = path.join(dir, 'still.png')
    const ff = (...args) => execFileSync(ffmpegStatic.ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args])
    ff('-f', 'lavfi', '-i', 'color=c=orange:s=64x96', '-frames:v', '1', still)
    ff('-f', 'lavfi', '-i', 'testsrc=s=128x96:r=24:d=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(dir, 'clip.mp4'))
  })
  after(async () => {
    await mcp?.close()
    await fake?.close()
  })

  test('guard keeps start_training from spending: it wants the person\'s agreed cost, then a Modal sign-in, and starts nothing', async () => {
    const id = await set('Spender')
    const before = await refusedCount()
    const queued = fake.prompts.length
    await fails('start_training', { trainingId: id, confirm_cost: 1 }, /The estimate is \$2\.68; ask the person to agree to that first\./)
    await fails('start_training', { trainingId: id, confirm_cost: 2.68, options: { budget: 1 } }, /Sign in to Modal on the Cloud page first \(steps 1 and 2\)\./)
    await fails('start_training', { trainingId: id, confirm_cost: 3 }, /Sign in to Modal on the Cloud page first \(steps 1 and 2\)\./)
    await fails('start_training', { trainingId: id, confirm_cost: 3, more: 20 }, /Sign in to Modal on the Cloud page first/)
    await fails('start_training', { trainingId: id, confirm_cost: 3, epochs: 5 }, /epochs/i)
    assert.equal(await refusedCount(), before, 'the product stopped itself; nothing was started for the guard to refuse')
    assert.equal(readTraining(id).train, null, 'no run was recorded')
    assert.equal(fake.prompts.length, queued)
  })

  test('guard keeps start_training off this computer\'s Python: a run that was on this computer cannot carry on without Fizgig and its files', async () => {
    const id = await set('Local run')
    const t = readTraining(id)
    t.train = { where: 'local', name: 'run1', state: 'done', gpu: 'local', options: { where: 'local' }, epochs: 20 }
    writeTraining(t)
    const before = await refusedCount()
    await fails('start_training', { trainingId: id, confirm_cost: 0, more: 10 }, /Fizgig isn’t on this computer\. Install it/)
    assert.equal(await refusedCount(), before)
    assert.equal(readTraining(id).train.state, 'done', 'the finished run is left as it was')
  })

  test('guard keeps stop_training off Modal: without the cloud tools it says to set them up, and a run on this computer with no process is just marked stopped', async () => {
    const id = await set('Stopper')
    await fails('stop_training', { trainingId: id }, /Set up the cloud tools first \(Cloud page, step 1\)\./)
    const t = readTraining(id)
    t.train = { where: 'local', name: 'run1', state: 'training', pid: null, options: { where: 'local' } }
    writeTraining(t)
    const before = await refusedCount()
    const r = await ok('stop_training', { trainingId: id })
    assert.equal(r.train.state, 'stopped')
    assert.equal(await refusedCount(), before, 'with no process id nothing is killed')
    // a RunPod run with no pod yet is marked stopped without calling RunPod
    t.train = { where: 'runpod', name: 'run2', state: 'training', options: { where: 'runpod' } }
    writeTraining(t)
    assert.equal((await ok('stop_training', { trainingId: id })).train.state, 'stopped')
  })

  test('guard keeps rank_likeness off InsightFace\'s Python: it needs a picked face and the face models, then stops at the engine', async () => {
    const t = await ok('create_character_training', { name: 'Ranker' })
    await fails('rank_likeness', { trainingId: t.id }, /Pick a face first: the stills and clips are compared with it\./)
    const id = await set('Ranker two')
    await fails('rank_likeness', { trainingId: id }, /Download the face models first/)
    // the face models and the engine's Python look installed
    for (const f of ['det_10g.onnx', 'w600k_r50.onnx']) {
      fs.mkdirSync(dataFile('shinobi', 'models', 'buffalo_l'), { recursive: true })
      fs.writeFileSync(dataFile('shinobi', 'models', 'buffalo_l', f), 'x')
    }
    const before = await refusedCount()
    await fails('rank_likeness', { trainingId: id, pick: true }, /refused to start "python"/)
    const refused = (await mcp.refusals()).slice(before)
    assert.deepEqual(refused.map((r) => r.command), ['python'])
    assert.equal(readTraining(id).rankedAt, undefined, 'nothing was scored')
  })

  test('guard keeps score_checkpoints off InsightFace\'s Python: it needs a face and rendered tests, then stops at the engine', async () => {
    const id = await set('Scorer')
    const t = readTraining(id)
    await fails('score_checkpoints', { trainingId: id }, /Render the tests first: the scores come from them\./)
    // a test render that finished
    const job = await ok('generate_previews', { prompt: 'integrated_multimodal_description: [Shot 1] A person talks.\n\noverall_soundscape: Quiet.\n\nnon_diegetic_music: N/A', character: 'none' })
    const clip = path.join(dir, 'clip.mp4')
    fake.state.history[job.promptId].outputs = { 42: { gifs: [{ filename: 'clip.mp4', subfolder: 'H3/previews', type: 'output', fullpath: clip }] } }
    t.tests = [{ epoch: 10, jobId: job.id, seed: 4242 }]
    writeTraining(t)
    fs.rmSync(dataFile('shinobi', 'models'), { recursive: true, force: true })
    await fails('score_checkpoints', { trainingId: id }, /Download the face models first/)
    for (const f of ['det_10g.onnx', 'w600k_r50.onnx']) {
      fs.mkdirSync(dataFile('shinobi', 'models', 'buffalo_l'), { recursive: true })
      fs.writeFileSync(dataFile('shinobi', 'models', 'buffalo_l', f), 'x')
    }
    const before = await refusedCount()
    await fails('score_checkpoints', { trainingId: id }, /refused to start/)
    const refused = (await mcp.refusals()).slice(before)
    assert.ok(refused.length >= 1 && refused.every((r) => r.command === 'python'), JSON.stringify(refused))
    assert.equal(readTraining(id).bestEpoch, undefined)
  })

  test('guard: the cloud options start_training does not offer are not passed on, so a run asked for on RunPod or this computer through MCP still goes to Modal', async () => {
    const id = await set('Where')
    const queued = await refusedCount()
    // where is not in start_training's options; it is dropped and the Modal checks run
    await fails('start_training', { trainingId: id, confirm_cost: 3, options: { where: 'runpod' } }, /Sign in to Modal on the Cloud page first/)
    await fails('start_training', { trainingId: id, confirm_cost: 0, options: { where: 'local' } }, /The estimate is \$2\.68; ask the person to agree to that first\./)
    assert.equal(await refusedCount(), queued)
  })
})
