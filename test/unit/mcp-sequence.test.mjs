// MCP sequence tools (task 5.6, part 2): several shots that play as one video, rendered as one take, shot by shot, as
// a retake of a finished version and as a render-out, called through the real MCP server on source under the test guard
// against the fake ComfyUI (design D1, D8). An NVIDIA fake with DLSS 5 installed, so the render-out keeps its DLSS pass.
// A finished render is made by the test writing the saved videos into the fake's history, as in mcp-render.test.mjs.
//   node --test test/unit/mcp-sequence.test.mjs
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import ffmpegStatic from 'ffmpeg-ffprobe-static'
import { startFakeComfy } from '../fakes/comfyui.mjs'
import { startMcp } from '../fakes/mcp.mjs'

const SHOT_A = 'A woman walks into a rainy bus stop and sits down.'
const SHOT_B = 'She opens an umbrella and looks up at the sky.'

describe('MCP sequence tools', () => {
  let fake, mcp, video, voice
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
  const dataFile = (...p) => path.join(mcp.dataDir, ...p)
  const readData = (...p) => JSON.parse(fs.readFileSync(dataFile(...p), 'utf8'))
  const lastGraph = () => fake.prompts.at(-1).prompt
  const lastExtra = () => fake.prompts.at(-1).extra_data
  const classes = (g) => Object.values(g).map((n) => n.class_type)
  const node = (g, cls) => Object.values(g).find((n) => n.class_type === cls)
  const gif = (file, subfolder = 'H3/sequences') => ({ gifs: [{ filename: path.basename(file), subfolder, type: 'output', fullpath: file }] })
  // a sequence of two shots with no character (so nothing depends on which presets are installed)
  const sequence = (extra = {}) => ok('save_sequence', { name: 'Bus stop', character: 'none', shots: [{ prompt: SHOT_A }, { prompt: SHOT_B }], ...extra })
  // the version of a sequence whose take has finished on the fake and been read back
  const finishedTake = async (extra = {}) => {
    const s = await sequence(extra)
    const job = await ok('render_take', { sequenceId: s.id })
    fake.state.history[job.promptId].outputs = { save: gif(video) }
    const view = await ok('get_sequence', { sequenceId: s.id })
    return { id: s.id, job, view }
  }
  // shot `index` hunted, its previews finished on the fake, and read back
  const huntedShot = async (id, index) => {
    const job = await ok('hunt_shot', { sequenceId: id, index })
    fake.state.history[job.promptId].outputs = { 42: gif(video, 'H3/previews'), 118: gif(video, 'H3/previews'), 128: gif(video, 'H3/previews') }
    await ok('get_sequence', { sequenceId: id })
    return job
  }
  const finishedShot = async (id, index, candidate = 1) => {
    const job = await ok('finish_shot', { sequenceId: id, index, candidate })
    fake.state.history[job.promptId].outputs = { [index === 0 ? 30 : 619]: gif(video, 'H3/finals') }
    return { job, view: await ok('get_sequence', { sequenceId: id }) }
  }

  before(async () => {
    fake = await startFakeComfy({ devices: 'cuda', os: 'win32', objectInfo: { DLSS5_Enhance_Video: { input: { required: {} } } } })
    mcp = await startMcp({ comfyUrl: fake.url })
    const dir = path.join(path.dirname(mcp.dataDir), 'fixtures')
    fs.mkdirSync(dir, { recursive: true })
    video = path.join(dir, 'take.mp4')
    voice = path.join(dir, 'voice.wav')
    const ff = (...args) => execFileSync(ffmpegStatic.ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args])
    ff('-f', 'lavfi', '-i', 'testsrc=s=128x72:r=24:d=2', '-f', 'lavfi', '-i', 'sine=f=440:d=2', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video)
    ff('-f', 'lavfi', '-i', 'sine=f=300:d=2', voice)
  })
  after(async () => {
    await mcp?.close()
    await fake?.close()
  })

  // ---------- list_sequences, save_sequence, get_sequence ----------
  test('[mcp:list_sequences] is empty on a fresh data folder', async () => {
    assert.deepEqual((await ok('list_sequences')).items, [])
  })

  test('[mcp:save_sequence][ipc:sequences:create] creates a sequence with the tested defaults and one empty shot when given nothing', async () => {
    const s = await ok('save_sequence')
    assert.match(s.id, /^[0-9a-f]{8}$/)
    assert.deepEqual({ name: s.name, method: s.method, character: s.character, aspect: s.aspect, megapixels: s.megapixels, shotSeconds: s.shotSeconds, steps: s.steps, seed: s.seed, voiceRef: s.voiceRef, loras: s.loras }, { name: 'Untitled sequence', method: 'take', character: 'tess', aspect: '16:9', megapixels: 0.9, shotSeconds: 10, steps: 8, seed: 4242, voiceRef: null, loras: [] })
    assert.equal(s.shots.length, 1)
    assert.deepEqual({ prompt: s.shots[0].prompt, mode: s.shots[0].mode, media: s.shots[0].media }, { prompt: '', mode: 'text', media: [] })
    assert.deepEqual(readData('sequences', `${s.id}.json`).versions, [])
  })

  test('[mcp:save_sequence] creates a sequence with the settings and shots it is given, giving each shot an id', async () => {
    const s = await sequence({ method: 'shots', aspect: '9:16', megapixels: 0.5, shotSeconds: 15, steps: 6, seed: 9 })
    assert.deepEqual({ name: s.name, method: s.method, character: s.character, aspect: s.aspect, megapixels: s.megapixels, shotSeconds: s.shotSeconds, steps: s.steps, seed: s.seed }, { name: 'Bus stop', method: 'shots', character: 'none', aspect: '9:16', megapixels: 0.5, shotSeconds: 15, steps: 6, seed: 9 })
    assert.deepEqual(s.shots.map((x) => [x.prompt, x.mode, x.media]), [[SHOT_A, 'text', []], [SHOT_B, 'text', []]])
    assert.ok(s.shots.every((x) => /^[0-9a-f]{6}$/.test(x.id)))
    assert.equal(readData('sequences', `${s.id}.json`).shots.length, 2)
  })

  test('[mcp:save_sequence][ipc:sequences:save] updates only what it is given, keeps shot ids the caller passes back, and keeps versions', async () => {
    const { id, view } = await finishedTake()
    const before = view.sequence.shots
    const s = await ok('save_sequence', { sequenceId: id, name: 'Renamed', shots: [{ id: before[0].id, prompt: 'Changed.' }, { prompt: SHOT_B, mode: 'text' }] })
    assert.equal(s.name, 'Renamed')
    assert.equal(s.character, 'none', 'what was not given stays')
    assert.equal(s.shots[0].id, before[0].id)
    assert.equal(s.shots[0].prompt, 'Changed.')
    assert.equal(s.versions.length, 1, 'renders already made stay')
    assert.equal((await ok('list_sequences')).items.filter((x) => x.id === id).length, 1, 'an update is not a second sequence')
    await fails('save_sequence', { sequenceId: 'nope0000', name: 'x' }, /No sequence nope0000/)
  })

  test('[mcp:save_sequence] refuses a shot length H3 does not take, a size outside range and a mode that does not exist', async () => {
    await fails('save_sequence', { shotSeconds: 7 }, /shotSeconds|Invalid/i)
    await fails('save_sequence', { megapixels: 3 }, /megapixels/i)
    await fails('save_sequence', { steps: 2 }, /steps/i)
    await fails('save_sequence', { method: 'loop' }, /method/i)
    await fails('save_sequence', { shots: [{ prompt: 'x', mode: 'sideways' }] }, /mode/i)
  })

  test('[mcp:list_sequences][ipc:sequences:list] lists sequences newest first with their shot, version and render counts', async () => {
    const { id } = await finishedTake({ name: 'Newest' })
    const { items } = await ok('list_sequences')
    assert.equal(items[0].id, id)
    assert.deepEqual({ name: items[0].name, method: items[0].method, shots: items[0].shots, versions: items[0].versions, renders: items[0].renders }, { name: 'Newest', method: 'take', shots: 2, versions: 1, renders: 0 })
    const times = items.map((i) => i.updatedAt)
    assert.deepEqual(times, [...times].sort().reverse())
  })

  test('[mcp:get_sequence][ipc:sequences:get] shows the sequence, its shots, versions and render-outs, and names one that is not there', async () => {
    const s = await sequence()
    const view = await ok('get_sequence', { sequenceId: s.id })
    assert.deepEqual(Object.keys(view).sort(), ['renders', 'sequence', 'shots', 'versions'])
    assert.equal(view.sequence.id, s.id)
    assert.deepEqual(view.shots.map((x) => [x.fresh, x.stale, x.ready]), [[false, false, true], [false, false, false]], 'only the first shot can start')
    assert.deepEqual(view.versions, [])
    await fails('get_sequence', { sequenceId: 'nope0000' }, /No sequence nope0000/)
  })

  // ---------- render_take ----------
  test('[mcp:render_take][ipc:sequences:take] queues one Multishot render of every shot, with the size, frames and seed, and records version 1', async () => {
    const s = await sequence({ seed: 77, steps: 6, shotSeconds: 15 })
    const queued = fake.prompts.length
    const job = await ok('render_take', { sequenceId: s.id })
    assert.equal(fake.prompts.length, queued + 1)
    assert.equal(job.kind, 'take')
    assert.equal(job.sequenceId, s.id)
    assert.deepEqual(job.plan.resolved, { width: 1280, height: 736, framesPerShot: 362, shots: 2, seconds: 30.2 })
    const g = lastGraph()
    const sampler = node(g, 'H3MultishotSampler').inputs
    assert.equal(sampler.script, `${SHOT_A}\n---\n${SHOT_B}`)
    assert.deepEqual([sampler.width, sampler.height, sampler.frames_per_shot, sampler.seed, sampler.steps, sampler.seed_per_shot], [1280, 736, 362, 77, 6, true])
    assert.ok(!classes(g).includes('LoadAudio'), 'no voice sample')
    assert.equal(classes(g).filter((c) => c === 'LoraLoaderModelOnly').length, 1, 'the turbo LoRA only, no character')
    assert.match(g.save.inputs.filename_prefix, new RegExp(`^H3/sequences/bus_stop_${s.id}_v1_take$`))
    assert.deepEqual(lastExtra().iv_studio, { kind: 'take', project: null, sequence: s.id })
    const saved = readData('sequences', `${s.id}.json`)
    assert.deepEqual(saved.versions.map((v) => [v.id, v.kind, v.label, v.jobId, v.seed]), [['v1', 'take', 'Take 1', job.id, 77]])
    assert.deepEqual(saved.jobs, [job.id])
    const second = await ok('render_take', { sequenceId: s.id })
    assert.match(second.name, /_v2$/)
    assert.deepEqual(readData('sequences', `${s.id}.json`).versions.map((v) => v.label), ['Take 1', 'Take 2'])
  })

  test('[mcp:render_take] puts the character LoRA and a voice sample into the graph and uploads the sample to ComfyUI', async () => {
    const characters = (await ok('list_characters')).items
    const lora = characters.find((c) => c.lora)
    assert.ok(lora, 'the seeded presets include one with a LoRA')
    const s = await sequence({ character: lora.id, voiceRef: voice })
    const before = fake.uploads.length
    await ok('render_take', { sequenceId: s.id })
    const g = lastGraph()
    assert.ok(Object.values(g).some((n) => n.class_type === 'LoraLoaderModelOnly' && n.inputs.lora_name === lora.lora && n.inputs.strength_model === lora.strength))
    assert.equal(node(g, 'LoadAudio').inputs.audio, 'iv_studio/voice.wav')
    assert.deepEqual(fake.uploads.slice(before).map((u) => [u.name, u.subfolder]), [['voice.wav', 'iv_studio']])
    assert.deepEqual(node(g, 'H3MultishotSampler').inputs.voice_ref, [Object.keys(g).find((k) => g[k].class_type === 'LoadAudio'), 0])
  })

  test('[mcp:render_take] refuses a sequence with an empty shot, too many shots, an unknown character or a refmod one, and queues nothing', async () => {
    const queued = fake.prompts.length
    const empty = await ok('save_sequence', { name: 'Empty', character: 'none' })
    await fails('render_take', { sequenceId: empty.id }, /Shot 1 has no prompt\./)
    const many = await ok('save_sequence', { name: 'Many', character: 'none', shots: Array.from({ length: 9 }, () => ({ prompt: 'A shot.' })) })
    await fails('render_take', { sequenceId: many.id }, /At most 8 shots in one take\./)
    const ghost = await sequence({ character: 'ghost' })
    await fails('render_take', { sequenceId: ghost.id }, /Unknown character "ghost"\./)
    const refmod = (await ok('list_characters')).items.find((c) => !c.lora && c.id !== 'none')
    if (refmod) {
      const r = await sequence({ character: refmod.id })
      await fails('render_take', { sequenceId: r.id }, /RefMod character; sequences need a character with a LoRA/)
    }
    await fails('render_take', { sequenceId: 'nope0000' }, /No sequence nope0000/)
    assert.equal(fake.prompts.length, queued)
  })

  test('[mcp:get_sequence] shows a version\'s video once ComfyUI has finished the take', async () => {
    const { view, job } = await finishedTake()
    assert.deepEqual(view.versions.map((v) => [v.id, v.label, v.job.status]), [['v1', 'Take 1', 'success']])
    assert.equal(view.versions[0].file.kind, 'master')
    assert.equal(view.versions[0].file.path, video)
    assert.equal(view.versions[0].job.id, job.id)
  })

  // ---------- retake ----------
  test('[mcp:retake][ipc:sequences:retake] redoes a stretch of a finished version and adds a version that records what was asked', async () => {
    const { id } = await finishedTake()
    const queued = fake.prompts.length
    const job = await ok('retake', { sequenceId: id, versionId: 'v1', prompt: 'She laughs.', start: 0.5, end: 1.5, mode: 'video', seed: 5 })
    assert.equal(fake.prompts.length, queued + 1)
    assert.equal(job.kind, 'retake')
    assert.deepEqual(job.plan.resolved, { start: 0.5, end: 1.5, mode: 'video' })
    const g = lastGraph()
    assert.equal(node(g, 'VHS_LoadVideoPath').inputs.video, video, 'the finished version is the source')
    const r = node(g, 'H3Retake').inputs
    assert.equal(r.prompt, 'She laughs.')
    assert.deepEqual([r.start_seconds, r.end_seconds], [0.5, 1.5])
    const v = readData('sequences', `${id}.json`).versions[1]
    assert.deepEqual({ id: v.id, kind: v.kind, label: v.label, source: v.source, start: v.start, end: v.end, mode: v.mode, prompt: v.prompt }, { id: 'v2', kind: 'retake', label: 'Retake of Take 1, 0.5–1.5 s', source: 'v1', start: 0.5, end: 1.5, mode: 'video', prompt: 'She laughs.' })
    const again = await ok('retake', { sequenceId: id, versionId: 'v1', prompt: 'Again.', start: 0, end: 1 })
    assert.equal(again.plan.resolved.mode, 'both', 'both picture and sound by default')
  })

  test('[mcp:retake] refuses a version with no finished video, a window that ends first, an empty prompt and an unknown mode', async () => {
    const s = await sequence()
    await ok('render_take', { sequenceId: s.id })
    await fails('retake', { sequenceId: s.id, versionId: 'v1', prompt: 'x', start: 0, end: 1 }, /Version v1 has no finished video yet\./)
    const { id } = await finishedTake()
    const queued = fake.prompts.length
    await fails('retake', { sequenceId: id, versionId: 'v1', prompt: 'x', start: 2, end: 1 }, /The retake must end after it starts\./)
    await fails('retake', { sequenceId: id, versionId: 'v1', prompt: '  ', start: 0, end: 1 }, /Describe what should happen in the retake\./)
    await fails('retake', { sequenceId: id, versionId: 'v9', prompt: 'x', start: 0, end: 1 }, /Version v9 has no finished video yet\./)
    await fails('retake', { sequenceId: id, versionId: 'v1', prompt: 'x', start: 0, end: 1, mode: 'sideways' }, /mode/i)
    assert.equal(fake.prompts.length, queued)
  })

  // ---------- render_out ----------
  test('[mcp:render_out][ipc:sequences:renderOut] finishes a version with DLSS at the scale and frame rate asked and records the render-out', async () => {
    const { id } = await finishedTake()
    const job = await ok('render_out', { sequenceId: id, versionId: 'v1', scale: 2, fps: 48 })
    assert.equal(job.kind, 'renderout')
    assert.deepEqual(job.plan.resolved, { normalize: false, scale: 2, fps: 48 })
    const g = lastGraph()
    assert.ok(!classes(g).includes('H3ChainNormalize'))
    const d = node(g, 'DLSS5_Enhance_Video').inputs
    assert.deepEqual([d['Video Path'] && g[d['Video Path'][0]].inputs.value, d.Scale, d['Target FPS']], [video, 2, 48])
    assert.match(d['Filename Prefix'], new RegExp(`^bus_stop_${id}_v1_final$`))
    const saved = readData('sequences', `${id}.json`)
    assert.deepEqual(saved.renders.map(({ versionId, jobId, normalize, scale, fps }) => ({ versionId, jobId, normalize, scale, fps })), [{ versionId: 'v1', jobId: job.id, normalize: false, scale: 2, fps: 48 }])
    // the final video DLSS answers with is the render-out's file
    const out = path.join(path.dirname(video), 'final.mp4')
    fs.copyFileSync(video, out)
    fake.state.history[job.promptId].outputs = { final: { text: [out] } }
    const view = await ok('get_sequence', { sequenceId: id })
    assert.equal(view.renders[0].file.kind, 'final')
    assert.equal(view.renders[0].file.path, out)
    assert.equal((await ok('list_sequences')).items.find((x) => x.id === id).renders, 1)
  })

  test('[mcp:render_out] smooths the joins first when asked to, and refuses a version with no video, and a scale of 3', async () => {
    const { id } = await finishedTake()
    await ok('render_out', { sequenceId: id, versionId: 'v1', normalize: true })
    const g = lastGraph()
    assert.equal(node(g, 'H3ChainNormalize').inputs.images[0], Object.keys(g).find((k) => g[k].class_type === 'VHS_LoadVideoPath'))
    assert.equal(node(g, 'VHS_LoadVideoPath').inputs.video, video)
    const queued = fake.prompts.length
    await fails('render_out', { sequenceId: id, versionId: 'v1', scale: 3 }, /scale/i)
    await fails('render_out', { sequenceId: id, versionId: 'v7' }, /Version v7 has no finished video yet\./)
    const fresh = await sequence()
    await fails('render_out', { sequenceId: fresh.id, versionId: 'v1' }, /Version v1 has no finished video yet\./)
    assert.equal(fake.prompts.length, queued)
  })

  // ---------- hunt_shot, finish_shot ----------
  test('[mcp:hunt_shot][ipc:sequences:huntShot] starts three previews for shot 1 in a project of its own and links the run to the shot', async () => {
    const s = await sequence({ method: 'shots', seed: 100 })
    const job = await ok('hunt_shot', { sequenceId: s.id, index: 0 })
    assert.equal(job.kind, 'previews')
    assert.equal(job.plan.request.mode, 'text')
    assert.equal(job.plan.request.prompt, SHOT_A)
    assert.deepEqual([job.plan.resolved.previews, job.plan.resolved.seeds], [3, [100, 1100, 2100]])
    const saved = readData('sequences', `${s.id}.json`)
    assert.ok(saved.projectId)
    assert.equal(readData('projects', `${saved.projectId}.json`).name, 'Bus stop (sequence)')
    assert.equal(saved.shotJobs[saved.shots[0].id].previews, job.id)
    assert.deepEqual(lastExtra().iv_studio, { kind: 'previews', project: saved.projectId, sequence: null })
    const seeded = await ok('hunt_shot', { sequenceId: s.id, index: 0, seed: 9 })
    assert.deepEqual(seeded.plan.resolved.seeds.slice(0, 1), [9])
    assert.equal(readData('sequences', `${s.id}.json`).projectId, saved.projectId, 'one project for the sequence')
  })

  test('[mcp:hunt_shot] waits for the shot before it to be finished, and refuses a shot that is not there', async () => {
    const s = await sequence({ method: 'shots' })
    const queued = fake.prompts.length
    await fails('hunt_shot', { sequenceId: s.id, index: 1 }, /Finish shot 1 first; shot 2 continues from it\./)
    await fails('hunt_shot', { sequenceId: s.id, index: 5 }, /No shot 6\./)
    await fails('hunt_shot', { sequenceId: s.id, index: -1 }, /index/i)
    await fails('hunt_shot', { sequenceId: 'nope0000', index: 0 }, /No sequence nope0000/)
    assert.equal(fake.prompts.length, queued)
  })

  test('[mcp:finish_shot][ipc:sequences:finishShot] finishes the picked candidate at the sequence size, then the next shot continues from that video', async () => {
    const s = await sequence({ method: 'shots', megapixels: 0.9 })
    await fails('finish_shot', { sequenceId: s.id, index: 0 }, /Hunt shot 1 first\./)
    await huntedShot(s.id, 0)
    const queued = fake.prompts.length
    const { job, view } = await finishedShot(s.id, 0, 2)
    assert.equal(fake.prompts.length, queued + 1)
    assert.equal(job.kind, 'finish')
    assert.deepEqual([job.plan.finish.candidate, job.plan.finish.megapixels, job.plan.finish.fps, job.plan.finish.upscale2x], [2, 0.9, 0, false])
    assert.equal(view.shots[0].fresh, true)
    assert.equal(view.shots[0].raw.kind, 'before_dlss')
    assert.equal(view.shots[1].ready, true, 'shot 2 can start now')
    // shot 2 continues from shot 1's finished video
    const next = await ok('hunt_shot', { sequenceId: s.id, index: 1 })
    assert.equal(next.plan.request.mode, 'continue')
    assert.deepEqual(next.plan.request.media.map((m) => m.kind), ['video'])
    assert.equal(next.plan.request.prompt, SHOT_B)
    assert.equal(next.plan.request.overlapFrames, 22)
    assert.equal(readData('sequences', `${s.id}.json`).shotJobs[view.sequence.shots[1].id].previews, next.id)
  })

  test('[mcp:finish_shot] marks a finished shot stale when its prompt changes afterwards, and refuses a candidate outside 1 to 3', async () => {
    const s = await sequence({ method: 'shots' })
    await huntedShot(s.id, 0)
    await finishedShot(s.id, 0)
    await fails('finish_shot', { sequenceId: s.id, index: 0, candidate: 4 }, /candidate/i)
    await fails('finish_shot', { sequenceId: s.id, index: 0, candidate: 0 }, /candidate/i)
    const view = await ok('get_sequence', { sequenceId: s.id })
    await ok('save_sequence', { sequenceId: s.id, shots: [{ id: view.sequence.shots[0].id, prompt: 'A different shot.' }, { id: view.sequence.shots[1].id, prompt: SHOT_B }] })
    const after = await ok('get_sequence', { sequenceId: s.id })
    assert.deepEqual([after.shots[0].fresh, after.shots[0].stale], [false, true])
    assert.equal(after.shots[1].ready, false, 'the next shot has nothing to continue from')
    await fails('finish_shot', { sequenceId: s.id, index: 9 }, /Hunt shot 10 first\./)
  })

  // ---------- delete_sequence (last) ----------
  test('[mcp:delete_sequence][ipc:sequences:delete] removes the sequence and its record and leaves the rendered videos on disk', async () => {
    const { id } = await finishedTake({ name: 'Doomed' })
    const r = await ok('delete_sequence', { sequenceId: id })
    assert.equal(r.items, true)
    assert.ok(!fs.existsSync(dataFile('sequences', `${id}.json`)))
    assert.ok(!(await ok('list_sequences')).items.some((x) => x.id === id))
    await fails('get_sequence', { sequenceId: id }, /No sequence/)
    assert.ok(fs.existsSync(video), 'the video stays')
    assert.equal((await ok('delete_sequence', { sequenceId: id })).items, true, 'deleting twice is harmless')
  })
})
