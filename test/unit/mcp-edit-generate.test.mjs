// MCP tools that make new footage for an edit (task 5.6, part 3): generate_in_edit and the three that follow a
// generation, reframe and cut_out. Called through the real MCP server on source under the test guard, against the fake
// ComfyUI (design D1, D8). reframe and cut_out wait for their own ComfyUI job, so the fake is told what each finished
// job saved (setOutputs) before the call; a generation's jobs are finished by the test writing their saved videos into
// the fake's history between calls, as in mcp-render.test.mjs. An NVIDIA fake with DLSS 5, as Extend finishes at once.
//   node --test test/unit/mcp-edit-generate.test.mjs
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { after, afterEach, before, describe, test } from 'node:test'
import ffmpegStatic from 'ffmpeg-ffprobe-static'
import { startFakeComfy } from '../fakes/comfyui.mjs'
import { startMcp } from '../fakes/mcp.mjs'

describe('MCP edit generation, reframe and cut-out tools', () => {
  let fake, mcp, clip, square, still, long, maskVideo, maskPng, blankPng
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
  const ff = (...args) => execFileSync(ffmpegStatic.ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args])
  const probe = (file, entries) => execFileSync(ffmpegStatic.ffprobePath, ['-v', 'error', '-show_entries', entries, '-of', 'csv=p=0', file]).toString().trim()
  const lastGraph = () => fake.prompts.at(-1).prompt
  const classes = (g) => Object.values(g).map((n) => n.class_type)
  const node = (g, cls) => Object.values(g).find((n) => n.class_type === cls)
  const gif = (file, subfolder = 'H3/previews') => ({ gifs: [{ filename: path.basename(file), subfolder, type: 'output', fullpath: file }] })
  const saveOutputs = (promptId, outputs) => (fake.state.history[promptId].outputs = outputs)
  // an edit with a 2 s video clip on V1 (and a 2 s one after it), and the ids to talk about them
  const edit = async (name = 'Generate') => {
    const e = await ok('create_edit', { name })
    const { media } = await ok('add_media', { editId: e.id, files: [clip, still] })
    const r = await ok('edit_timeline', { editId: e.id, ops: [{ op: 'add_clip', media: media[0].id }, { op: 'add_clip', media: media[0].id, start: 4 }, { op: 'add_clip', media: media[1].id, track: 'V1', start: 10 }] })
    const [a, b, pic] = r.results.map((x) => x.clip)
    return { id: e.id, a, b, pic, media }
  }
  const gens = async (editId) => (await ok('list_generations', { editId })).items
  const lastPromptId = () => fake.prompts.at(-1).id
  const clipsOf = async (editId, track = 'V1') => (await ok('get_edit', { editId })).tracks[track].map((c) => [c.name, c.start, c.end])

  before(async () => {
    fake = await startFakeComfy({ devices: 'cuda', os: 'win32', objectInfo: { DLSS5_Enhance_Video: { input: { required: {} } } } })
    mcp = await startMcp({ comfyUrl: fake.url })
    const dir = path.join(path.dirname(mcp.dataDir), 'fixtures')
    fs.mkdirSync(dir, { recursive: true })
    clip = path.join(dir, 'clip.mp4')
    long = path.join(dir, 'new.mp4')
    still = path.join(dir, 'still.png')
    square = path.join(dir, 'square.mp4')
    maskVideo = path.join(dir, 'mask.mp4')
    maskPng = path.join(dir, 'mask.png')
    blankPng = path.join(dir, 'blank.png')
    const h264 = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p']
    ff('-f', 'lavfi', '-i', 'testsrc=s=128x72:r=24:d=2', '-f', 'lavfi', '-i', 'sine=f=440:d=2', '-shortest', ...h264, '-c:a', 'aac', clip)
    ff('-f', 'lavfi', '-i', 'testsrc2=s=128x72:r=24:d=8', '-f', 'lavfi', '-i', 'sine=f=220:d=8', '-shortest', ...h264, '-c:a', 'aac', long)
    ff('-f', 'lavfi', '-i', 'color=c=blue:s=128x72', '-frames:v', '1', still)
    ff('-f', 'lavfi', '-i', 'testsrc=s=64x64:r=24:d=1', ...h264, square)
    // a mask that keeps the left half of the frame, one that keeps nothing, and the first as a video
    ff('-f', 'lavfi', '-i', 'color=c=black:s=128x72', '-vf', 'drawbox=x=0:y=0:w=64:h=72:color=white:t=fill', '-frames:v', '1', maskPng)
    ff('-f', 'lavfi', '-i', 'color=c=black:s=128x72', '-frames:v', '1', blankPng)
    ff('-f', 'lavfi', '-i', 'color=c=black:s=128x72:r=24:d=2', '-vf', 'drawbox=x=0:y=0:w=64:h=72:color=white:t=fill', ...h264, maskVideo)
  })
  afterEach(() => fake.setOutputs(null))
  after(async () => {
    await mcp?.close()
    await fake?.close()
  })

  // ---------- generate_in_edit: extend ----------
  test('[mcp:generate_in_edit] extend cuts the end of the clip, starts Continue from it and records a generation placed after the clip', async () => {
    const e = await edit('Extend')
    const before = fake.uploads.length
    const gen = await ok('generate_in_edit', { editId: e.id, kind: 'extend', clip: e.a, prompt: 'The woman keeps walking.', seconds: 5, seed: 8 })
    assert.equal(gen.kind, 'extend')
    assert.equal(gen.status, 'rendering')
    assert.deepEqual([gen.track, gen.at, gen.length, gen.anchor, gen.insert], ['V1', 2, 5, e.a, true])
    assert.match(gen.name, /^Extend: /)
    // Continue's request: the clip's last seconds as the source video, 5 s plus the overlap, the clip's shape
    const queued = fake.prompts.at(-1)
    assert.equal(queued.extra_data.iv_studio.kind, 'previews')
    assert.deepEqual(fake.uploads.slice(before).map((u) => u.subfolder), ['minimax_h3'])
    assert.match(fake.uploads[before].name, /_source\.mp4$/)
    const job = JSON.parse(fs.readFileSync(path.join(mcp.dataDir, 'jobs', `${gen.previewsJob}.json`), 'utf8'))
    assert.deepEqual([job.plan.request.mode, job.plan.request.prompt, job.plan.request.overlapFrames, job.plan.request.aspect, job.plan.request.seed], ['continue', 'The woman keeps walking.', 22, '16:9', 8])
    assert.equal(job.plan.resolved.seconds, 6.583, '5 s plus the overlap, rounded to a whole H3 length (158 frames)')
    assert.ok(fs.existsSync(path.join(mcp.dataDir, 'edits', 'gen', `${gen.id}_source.mp4`)), 'the cut source is kept beside the edit')
    assert.equal(probe(path.join(mcp.dataDir, 'edits', 'gen', `${gen.id}_source.mp4`), 'stream=codec_name').split('\n').sort().join(), 'aac,h264')
    const [listed] = await gens(e.id)
    assert.equal(listed.id, gen.id)
  })

  test('[mcp:list_generations] moves a generation on: finishing the previews starts the finish, and the finished video lands on the timeline', async () => {
    const e = await edit('Extend lands')
    const gen = await ok('generate_in_edit', { editId: e.id, kind: 'extend', clip: e.a, prompt: 'The woman keeps walking.', seconds: 5 })
    saveOutputs(lastPromptId(), { 42: gif(long) })
    const queued = fake.prompts.length
    const [mid] = await gens(e.id)
    assert.equal(mid.status, 'finishing')
    assert.ok(mid.finishJob)
    assert.equal(fake.prompts.length, queued + 1, 'the finish was queued')
    assert.equal(fake.prompts.at(-1).extra_data.iv_studio.kind, 'finish')
    saveOutputs(lastPromptId(), { 51: { text: [long] } })
    const [done] = await gens(e.id)
    assert.equal(done.status, 'done')
    assert.ok(done.placedClip && done.media && done.doneAt)
    // inserted after the clip it came from: the footage after the 2 s of source Continue replays, 5 s of it, and the later clip moved right
    assert.deepEqual((await clipsOf(e.id)).slice(0, 2), [['clip.mp4', 0, 2], ['new.mp4', 2, 7]])
    assert.deepEqual((await clipsOf(e.id)).slice(2).map((c) => c[0]), ['clip.mp4', 'still.png'])
    assert.equal((await ok('get_edit', { editId: e.id })).tracks.V1[2].start, 9, 'the clip that was at 4 s moved right by the 5 s inserted')
  })

  test('[mcp:list_generations] reports a generation whose render failed as an error with the reason, and lists nothing for an edit with none', async () => {
    const empty = await ok('create_edit')
    assert.deepEqual(await gens(empty.id), [])
    const e = await edit('Extend fails')
    await ok('generate_in_edit', { editId: e.id, kind: 'extend', clip: e.a, prompt: 'Keeps walking.' })
    fake.state.history[lastPromptId()] = { ...fake.state.history[lastPromptId()], outputs: {}, status: { status_str: 'error', completed: false, messages: [['execution_error', { exception_message: 'Out of memory' }]] } }
    const [g] = await gens(e.id)
    assert.equal(g.status, 'error')
    assert.match(g.error, /Out of memory/)
    await fails('list_generations', { editId: 'nope0000' }, /No edit nope0000/)
  })

  // ---------- generate_in_edit: bridge, pick_generation ----------
  test('[mcp:generate_in_edit] bridge starts three previews from the last frame of one clip to the first of the next, then waits for a pick', async () => {
    const e = await edit('Bridge')
    const before = fake.uploads.length
    const gen = await ok('generate_in_edit', { editId: e.id, kind: 'bridge', clip: e.a, next: e.b, prompt: 'She turns to the door.', seconds: 4 })
    assert.deepEqual([gen.kind, gen.track, gen.at, gen.length, gen.insert, gen.gap], ['bridge', 'V1', 2, 4, true, false])
    assert.deepEqual(fake.uploads.slice(before).map((u) => u.name.replace(/^[0-9a-f]+_/, '')), ['first.png', 'last.png'], 'the two frames go to ComfyUI')
    const job = JSON.parse(fs.readFileSync(path.join(mcp.dataDir, 'jobs', `${gen.previewsJob}.json`), 'utf8'))
    assert.deepEqual([job.plan.request.mode, job.plan.resolved.previews, job.plan.request.media.length, job.plan.request.seconds], ['frames', 3, 2, 4])
    saveOutputs(lastPromptId(), { 42: gif(long), 118: gif(long), 128: gif(long) })
    const [picking] = await gens(e.id)
    assert.equal(picking.status, 'pick')
    assert.deepEqual(picking.candidates.map((c) => [c.n, c.path]), [[1, long], [2, long], [3, long]])
    assert.deepEqual([picking.track, picking.at], ['V1', 2])
  })

  test('[mcp:pick_generation] finishes the picked preview at 2 MP and the result lands between the two clips', async () => {
    const e = await edit('Bridge lands')
    const gen = await ok('generate_in_edit', { editId: e.id, kind: 'bridge', clip: e.a, next: e.b, prompt: 'She turns to the door.', seconds: 4 })
    saveOutputs(lastPromptId(), { 42: gif(long), 118: gif(long), 128: gif(long) })
    await gens(e.id)
    const queued = fake.prompts.length
    fake.holdNextPrompt(1)
    const view = await ok('pick_generation', { editId: e.id, genId: gen.id, candidate: 2 })
    assert.equal(fake.prompts.length, queued + 1)
    assert.equal(view.items[0].status, 'finishing', view.items[0].error)
    assert.equal(view.items[0].picked, 2)
    const finish = JSON.parse(fs.readFileSync(path.join(mcp.dataDir, 'jobs', `${view.items[0].finishJob}.json`), 'utf8'))
    assert.deepEqual([finish.kind, finish.parent, finish.plan.finish.candidate, finish.plan.finish.megapixels], ['finish', gen.previewsJob, 2, 2])
    fake.releaseHeld()
    saveOutputs(lastPromptId(), { 51: { text: [long] } })
    const done = (await gens(e.id))[0]
    assert.equal(done.status, 'done')
    // the bridge is inserted at the end of the first clip, from just after its first frame, 4 s long
    assert.deepEqual((await clipsOf(e.id)).slice(0, 3), [['clip.mp4', 0, 2], ['new.mp4', 2, 6], ['clip.mp4', 8, 10]], 'the clip after it moved right by the 4 s')
  })

  test('[mcp:pick_generation] refuses a generation that is not waiting for a pick, one that is not there, and a candidate outside 1 to 3', async () => {
    const e = await edit('Pick errors')
    const gen = await ok('generate_in_edit', { editId: e.id, kind: 'extend', clip: e.a, prompt: 'Keeps walking.' })
    await fails('pick_generation', { editId: e.id, genId: gen.id, candidate: 1 }, /That generation is not waiting for a pick\./)
    await fails('pick_generation', { editId: e.id, genId: 'nogen000', candidate: 1 }, /That generation is not waiting for a pick\./)
    await fails('pick_generation', { editId: e.id, genId: gen.id, candidate: 4 }, /candidate/i)
  })

  // ---------- generate_in_edit: fill a gap, retake ----------
  test('[mcp:generate_in_edit] bridge can fill a gap on a track from the clip before it to the clip after, over the gap', async () => {
    const e = await edit('Gap')
    const gen = await ok('generate_in_edit', { editId: e.id, kind: 'bridge', gap: { track: 'V1', from: 2, to: 4 }, prompt: 'Rain falls on the street.' })
    assert.deepEqual([gen.kind, gen.gap, gen.insert, gen.track, gen.at, gen.length, gen.anchor], ['bridge', true, false, 'V1', 2, 2, e.a])
    assert.match(gen.name, /^Fill: /)
    saveOutputs(lastPromptId(), { 42: gif(long), 118: gif(long), 128: gif(long) })
    await gens(e.id)
    fake.holdNextPrompt(1)
    await ok('pick_generation', { editId: e.id, genId: gen.id, candidate: 1 })
    fake.releaseHeld()
    saveOutputs(lastPromptId(), { 51: { text: [long] } })
    const fin = (await gens(e.id))[0]
    assert.equal(fin.status, 'done', fin.error)
    assert.deepEqual((await clipsOf(e.id)).slice(0, 3), [['clip.mp4', 0, 2], ['new.mp4', 2, 4], ['clip.mp4', 4, 6]], 'the gap is filled and nothing moved')
  })

  test('[mcp:generate_in_edit] retake cuts a stretch around the window, starts H3 Retake on it and replaces that stretch of the clip', async () => {
    const e = await edit('Retake')
    const before = fake.uploads.length
    const gen = await ok('generate_in_edit', { editId: e.id, kind: 'retake', clip: e.a, from: 0.5, to: 1.5, mode: 'audio', prompt: 'She says hello.', seed: 3 })
    assert.deepEqual([gen.kind, gen.at, gen.length, gen.mode, gen.insert], ['retake', 0.5, 1, 'audio', false])
    const g = lastGraph()
    assert.ok(classes(g).includes('H3Retake'))
    const r = node(g, 'H3Retake').inputs
    assert.equal(r.prompt, 'She says hello.')
    assert.deepEqual([r.start_seconds, r.end_seconds], [0.5, 1.5], 'the window, in the cut source\'s own time (it starts at the clip\'s start)')
    assert.equal(fake.uploads.length, before, 'the cut source is read from disk by ComfyUI, not uploaded')
    assert.equal(fake.prompts.at(-1).extra_data.iv_studio.kind, 'retake')
    saveOutputs(lastPromptId(), { save: gif(long, 'H3/sequences') })
    const [done] = await gens(e.id)
    assert.equal(done.status, 'done')
    const clips = await clipsOf(e.id)
    assert.deepEqual(clips.slice(0, 3), [['clip.mp4', 0, 0.5], ['new.mp4', 0.5, 1.5], ['clip.mp4', 1.5, 2]], 'the retake replaces its stretch and the clip is kept either side')
  })

  test('[mcp:generate_in_edit] refuses what cannot be made: no prompt, an unknown clip, a length H3 does not take, a window too short, a gap too long', async () => {
    const e = await edit('Refusals')
    const queued = fake.prompts.length
    await fails('generate_in_edit', { editId: e.id, kind: 'extend', clip: e.a, prompt: '  ' }, /Describe what should happen\./)
    await fails('generate_in_edit', { editId: e.id, kind: 'extend', clip: 'noclip00', prompt: 'x' }, /No clip noclip00/)
    await fails('generate_in_edit', { editId: e.id, kind: 'extend', clip: e.a, prompt: 'x', seconds: 7 }, /An extension is 5, 10, 15 seconds\./)
    await fails('generate_in_edit', { editId: e.id, kind: 'extend', clip: e.a, prompt: 'x', overlap: 7 }, /The overlap is 5, 22, 39, 56 frames\./)
    await fails('generate_in_edit', { editId: e.id, kind: 'retake', clip: e.a, prompt: 'x', from: 1, to: 1.2 }, /Retake at least half a second, inside the clip\./)
    await fails('generate_in_edit', { editId: e.id, kind: 'retake', clip: e.a, prompt: 'x', from: 0, to: 1, mode: 'sideways' }, /mode/i)
    await fails('generate_in_edit', { editId: e.id, kind: 'bridge', gap: { track: 'V1', from: 2, to: 20 }, prompt: 'x' }, /A gap is filled up to 15 seconds at a time/)
    await fails('generate_in_edit', { editId: e.id, kind: 'bridge', gap: { track: 'V2', from: 0, to: 2 }, prompt: 'x' }, /A gap needs a clip before it\./)
    await fails('generate_in_edit', { editId: e.id, kind: 'dance', clip: e.a, prompt: 'x' }, /kind/i)
    await fails('generate_in_edit', { editId: 'nope0000', kind: 'extend', clip: e.a, prompt: 'x' }, /No edit nope0000/)
    assert.equal(fake.prompts.length, queued, 'nothing was queued')
    assert.deepEqual(await gens(e.id), [])
    // a locked track refuses
    await ok('edit_timeline', { editId: e.id, ops: [{ op: 'update_track', track: 'V1', locked: true }] })
    await fails('generate_in_edit', { editId: e.id, kind: 'extend', clip: e.a, prompt: 'x' }, /Track V1 is locked\. Unlock it first\./)
  })

  // ---------- cancel_generation ----------
  test('[mcp:cancel_generation] stops the generation, cancels its jobs and takes its placeholder off the edit', async () => {
    const e = await edit('Cancel')
    fake.holdNextPrompt(1)
    const gen = await ok('generate_in_edit', { editId: e.id, kind: 'extend', clip: e.a, prompt: 'Keeps walking.' })
    assert.equal((await gens(e.id))[0].status, 'rendering')
    assert.equal(fake.state.pending.length, 1)
    const r = await ok('cancel_generation', { editId: e.id, genId: gen.id })
    assert.equal(r.removed, true)
    assert.deepEqual(await gens(e.id), [])
    assert.equal(fake.state.pending.length, 0, 'the held job was taken out of the ComfyUI queue')
    const job = JSON.parse(fs.readFileSync(path.join(mcp.dataDir, 'jobs', `${gen.previewsJob}.json`), 'utf8'))
    assert.equal(job.status, 'cancelled')
    await fails('cancel_generation', { editId: e.id, genId: gen.id }, /No such generation\./)
    await fails('cancel_generation', { editId: 'nope0000', genId: gen.id }, /No edit nope0000/)
  })

  // ---------- reframe ----------
  test('[mcp:reframe] draws the bars of a video with H3\'s masked edit, holds the original sound and returns the file and how much was drawn', async () => {
    fake.setOutputs((g) => (g.edit?.class_type === 'MiniMaxH3FantasticVideoEditLatent' ? { save: gif(long, 'iv_studio/reframes') } : undefined))
    const before = fake.uploads.length
    const r = await ok('reframe', { file: clip, shape: '9:16', about: 'A woman in the rain.', seed: 11 })
    assert.deepEqual([r.shape, r.file, typeof r.jobId], ['9:16', long, 'string'])
    assert.ok(r.width < r.height && Math.abs(r.width / r.height - 9 / 16) < 0.03, `${r.width}x${r.height}`)
    assert.ok(r.filled > 0.5 && r.filled < 0.8, `filled ${r.filled}`)
    const g = lastGraph()
    assert.equal(g.noise.inputs.noise_seed, 11)
    assert.equal(g.edit.inputs.keep_audio, true)
    assert.match(g.text.inputs.prompt, /vertical 9:16 frame/)
    assert.match(g.text.inputs.prompt, /The shot: A woman in the rain\./)
    assert.equal(g.load.inputs.video, r.padded)
    assert.deepEqual(probe(r.padded, 'stream=width,height').split('\n')[0], `${r.width},${r.height}`, 'the padded video is the new frame')
    assert.equal(r.seconds, 1.625, 'a whole H3 length: 17n+5 frames (39 of the 49)')
    assert.equal(fake.uploads.slice(before).map((u) => u.name).join(), path.basename(r.mask))
    assert.equal(fake.prompts.at(-1).extra_data.iv_studio.kind, 'reframe')
  })

  test('[mcp:reframe] refuses a missing file, a shot that already has the shape and a picture when the outpaint model is not installed', async () => {
    const queued = fake.prompts.length
    await fails('reframe', { file: path.join(path.dirname(clip), 'gone.mp4') }, /Pick a video\./)
    await fails('reframe', { file: square, shape: '1:1' }, /The shot already has that shape\./)
    await fails('reframe', { file: clip, shape: '5:4' }, /shape/i)
    await fails('reframe', { file: still, shape: '9:16' }, /Reframing a picture needs Qwen Image 2\.1 and its outpaint LoRA/)
    await fails('reframe', { file: clip, zoom: 3 }, /zoom/i)
    assert.equal(fake.prompts.length, queued)
  })

  test('[mcp:reframe] reports the reason when ComfyUI fails the render, and when it saved no video', async () => {
    fake.failNextPrompt('Out of memory')
    await fails('reframe', { file: clip, shape: '1:1' }, /Out of memory/)
    await fails('reframe', { file: clip, shape: '1:1' }, /The reframe saved no video\./)
  })

  // ---------- cut_out ----------
  test('[mcp:cut_out] cuts a picture out with SAM 3 and returns a PNG with a see-through background and how much of the frame stays', async () => {
    fake.setView(fs.readFileSync(maskPng))
    fake.setOutputs((g) => (g.find?.class_type === 'SAM3_Detect' ? { mask: { images: [{ filename: 'mask_00001_.png', subfolder: 'iv_studio/cutouts', type: 'output' }] } } : undefined))
    const before = fake.uploads.length
    const r = await ok('cut_out', { file: still, what: 'the woman', soften: 0 })
    assert.deepEqual([r.kind, r.what], ['image', 'the woman'])
    assert.ok(r.coverage > 0.4 && r.coverage < 0.6, `coverage ${r.coverage}`)
    assert.ok(r.file.startsWith(path.join(mcp.dataDir, 'cutouts')) && r.file.endsWith('.png'), r.file)
    assert.equal(probe(r.file, 'stream=pix_fmt'), 'rgba')
    const g = lastGraph()
    assert.equal(g.words.inputs.text, 'the woman')
    assert.equal(g.find.inputs.threshold, 0.4)
    assert.equal(fake.prompts.at(-1).extra_data.iv_studio.kind, 'cutout')
    assert.deepEqual(fake.uploads.slice(before).map((u) => u.name), ['still.png'], 'the picture goes to ComfyUI, the video does not')
    assert.ok(fs.existsSync(path.join(mcp.dataDir, 'cutouts', '_masks', 'mask_00001_.png')), 'the mask is fetched from ComfyUI')
  })

  test('[mcp:cut_out] cuts a video out frame by frame into a WebM with a see-through background and the video\'s sound', async () => {
    fake.setOutputs((g) => (g.track?.class_type === 'SAM3_VideoTrack' ? { mask: gif(maskVideo, 'iv_studio/cutouts') } : undefined))
    const before = fake.uploads.length
    const r = await ok('cut_out', { file: clip })
    assert.deepEqual([r.kind, r.what], ['video', 'person'], 'person is the default')
    assert.ok(r.coverage > 0.4 && r.coverage < 0.6, `coverage ${r.coverage}`)
    assert.ok(r.file.endsWith('.webm'))
    const codecs = probe(r.file, 'stream=codec_name').split('\n')
    assert.ok(codecs.includes('vp9') && codecs.length === 2, `a VP9 picture and a sound: ${codecs}`)
    assert.match(probe(r.file, 'stream_tags=alpha_mode'), /1/, 'the picture carries an alpha channel')
    assert.equal(lastGraph().track.inputs.detection_threshold, 0.4)
    assert.equal(lastGraph().load.inputs.video, clip, 'ComfyUI reads the video from disk')
    assert.equal(fake.uploads.length, before)
  })

  test('[mcp:cut_out] says so when SAM 3 found nothing, when the mask was not saved, and refuses a missing file and a softness out of range', async () => {
    fake.setView(fs.readFileSync(blankPng))
    fake.setOutputs((g) => (g.find?.class_type === 'SAM3_Detect' ? { mask: { images: [{ filename: 'blank_00001_.png', subfolder: 'iv_studio/cutouts', type: 'output' }] } } : undefined))
    await fails('cut_out', { file: still, what: 'unicorn' }, /SAM 3 found no "unicorn" in it\. Try other words, like "person" or "the dog"\./)
    fake.setOutputs(null)
    await fails('cut_out', { file: still }, /The cut-out made no mask\./)
    await fails('cut_out', { file: path.join(path.dirname(still), 'gone.png') }, /Pick a picture or a video\./)
    await fails('cut_out', { file: still, soften: 9 }, /soften/i)
    fake.failNextPrompt('Out of memory')
    await fails('cut_out', { file: still }, /Out of memory/)
  })
})
