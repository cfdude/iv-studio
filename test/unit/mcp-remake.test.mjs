// MCP Remake tools (task 5.7, part 3): prepare a clip and paint its keyframes, set your own keyframe, write the prompt and
// render takes, and read a finished take back from the Replace history. Called through the real MCP server on source under
// the test guard, against the fake ComfyUI (a Flux.2 Klein picture editor and Viggle Remake's nodes and model) and the
// claude shim (design D1, D8). A painted frame and a finished take are what the test writes into the fake's history.
//   node --test test/unit/mcp-remake.test.mjs
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { after, afterEach, before, describe, test } from 'node:test'
import ffmpegStatic from 'ffmpeg-ffprobe-static'
import { startFakeComfy } from '../fakes/comfyui.mjs'
import { startMcp } from '../fakes/mcp.mjs'
import { guardState } from '../fakes/ports.mjs'

const combo = (name, options) => ({ input: { required: { [name]: [options] } } })
const node = () => ({ input: { required: {} } })
const OBJECT_INFO = {
  UNETLoader: combo('unet_name', ['Flux2/flux2_klein_9b.safetensors', 'viggle_remake_swap_pruned_int8_convrot.safetensors']),
  CLIPLoader: { input: { required: { clip_name: [['qwen_3_8b.safetensors']], type: [['flux2']] } } },
  VAELoader: combo('vae_name', ['flux2-vae.safetensors']),
  LoraLoaderModelOnly: combo('lora_name', ['mia_lora.safetensors']),
  RemakeConditioning: node(),
  RemakeKeyframeUntil: node(),
  RemakeNoise: node()
}
// six sections that pass Remake's own check: in order, <Picture 1> named, times inside the clip, no orders
const SECTIONS = {
  subject_definitions: '<Video 1> is the source video. <Picture 1> is a frame of the target video.\n<Subject 1> is Mia, a woman with short red hair.',
  summary: '[video editing + character replacement] The target video is an edited version of <Video 1> in which the man becomes <Subject 1>.',
  retention_analysis: '<Video 1> (source video editing): fully_preserved - the camera, timing and sound.\n<Picture 1> (appears in [Shot 1]): reference - a frame of the target video.',
  detailed_description: '[Shot 1] A plain test pattern, matching <Picture 1>. <Subject 1> stands still.',
  overall_soundscape: 'A steady tone.',
  non_diegetic_music: 'N/A'
}

describe('MCP remake tools', () => {
  let fake, mcp, shimDir, dir, video, long, face, painted, own, take
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
  const probe = (file, entries) => execFileSync(ffmpegStatic.ffprobePath, ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', entries, '-of', 'csv=p=0', file]).toString().trim()
  const readSession = (id) => JSON.parse(fs.readFileSync(path.join(mcp.dataDir, 'remake', id, 'session.json'), 'utf8'))
  const has = (g, cls) => Object.values(g).some((n) => n.class_type === cls)
  const claudeAnswers = (obj) => {
    const file = path.join(shimDir, 'claude')
    fs.writeFileSync(file, `#!/bin/sh\ncat > "$0.stdin"\ncat <<'JSON'\n${JSON.stringify({ is_error: false, result: '', structured_output: obj })}\nJSON\n`, { mode: 0o755 })
  }
  // ComfyUI saves a painted frame for a picture edit, and a take for Remake's graph
  const answers = () =>
    fake.setOutputs((g) => {
      if (has(g, 'RemakeConditioning')) return { save: { images: [{ filename: 'take.mp4', subfolder: 'H3/remake', type: 'output', fullpath: take }] } }
      if (has(g, 'LoadImage') && has(g, 'SaveImage')) return { 11: { images: [{ filename: 'painted.png', subfolder: 'iv_studio/images', type: 'output', fullpath: painted }] } }
      return undefined
    })
  afterEach(() => fake.setOutputs(null))
  // a session with its keyframe painted
  const painted1 = async (extra = {}) => {
    answers()
    return ok('remake_paint', { kind: 'swap', video, who: 'the man', picture: face, name: 'Mia', ...extra })
  }

  before(async () => {
    fake = await startFakeComfy({ devices: 'cuda', os: 'win32', objectInfo: OBJECT_INFO })
    mcp = await startMcp({ comfyUrl: fake.url, shims: true, settings: { promptEngine: 'claude' } })
    shimDir = [...guardState().shimDirs].at(-1)
    dir = path.join(path.dirname(mcp.dataDir), 'fixtures')
    fs.mkdirSync(dir, { recursive: true })
    video = path.join(dir, 'man.mp4')
    long = path.join(dir, 'long.mp4')
    face = path.join(dir, 'mia.png')
    painted = path.join(dir, 'painted.png')
    own = path.join(dir, 'own.png')
    take = path.join(dir, 'take.mp4')
    const h264 = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p']
    ff('-f', 'lavfi', '-i', 'testsrc=s=128x72:r=24:d=4', '-f', 'lavfi', '-i', 'sine=f=440:d=4', '-shortest', ...h264, '-c:a', 'aac', video)
    ff('-f', 'lavfi', '-i', 'color=c=black:s=64x36:r=2:d=16', ...h264, long)
    ff('-f', 'lavfi', '-i', 'color=c=orange:s=64x64', '-frames:v', '1', face)
    ff('-f', 'lavfi', '-i', 'color=c=purple:s=300x200', '-frames:v', '1', painted)
    ff('-f', 'lavfi', '-i', 'color=c=teal:s=100x100', '-frames:v', '1', own)
    ff('-f', 'lavfi', '-i', 'testsrc2=s=864x480:r=24:d=4.5', '-f', 'lavfi', '-i', 'sine=f=330:d=4.5', '-shortest', ...h264, '-c:a', 'aac', take)
  })
  after(async () => {
    await mcp?.close()
    await fake?.close()
  })

  // ---------- remake_paint ----------
  test('[mcp:remake_paint][ipc:remake:prepare][ipc:remake:paint] prepares the clip on Remake\'s canvas and paints one frame with the picture editor, the way a swap is asked for', async () => {
    answers()
    const before = fake.prompts.length
    const s = await ok('remake_paint', { kind: 'swap', video, who: 'the man', picture: face, name: 'Mia' })
    assert.equal(s.kind, 'swap')
    assert.deepEqual([s.n, s.frames], [96, 107], 'a 4 s clip is 96 frames, rendered as 17n+5')
    assert.deepEqual(s.canvas, { width: 864, height: 480 }, 'the short edge 480, the long edge in the source\'s shape')
    assert.deepEqual(s.original, { width: 128, height: 72 })
    assert.deepEqual(s.cuts, [])
    assert.equal(probe(s.source, 'stream=width,height'), '864,480')
    assert.equal(probe(s.source, 'stream=nb_read_frames'), '107')
    assert.deepEqual(s.keyframes.map((k) => [k.frame, k.time, k.own]), [[12, '00:00.500', false]])
    assert.ok(fs.existsSync(s.keyframes[0].file), 'the source frame')
    const k = s.keyframes[0]
    assert.ok(k.painted.startsWith(path.join(mcp.dataDir, 'remake', s.id)) && fs.existsSync(k.painted), 'painted frame')
    assert.equal(probe(k.painted, 'stream=width,height'), '864,480', 'painted frames are put on the canvas exactly')
    assert.equal(fake.prompts.length - before, 1)
    const g = fake.prompts.at(-1).prompt
    const text = Object.values(g).find((n) => n.class_type === 'CLIPTextEncode').inputs.text
    assert.match(text, /^Picture 1 is a frame from a film\. Change the man in picture 1 into Mia from picture 2:/)
    assert.match(text, /Do not add anyone/)
    assert.equal(Object.values(g).filter((n) => n.class_type === 'LoadImage').length, 2, 'the frame and the face')
    assert.deepEqual(s.people.map((p) => [p.name, p.who, p.picture]), [['Mia', 'the man', face]])
    assert.equal(readSession(s.id).keyframes[0].painted, k.painted)
    assert.deepEqual(await mcp.refusals(), [])
  })

  test('[mcp:remake_paint][ipc:remake:get] paints a scene change from the person\'s words and repaints just one frame in an existing session', async () => {
    answers()
    const s = await ok('remake_paint', { kind: 'change', video, ask: 'a snowy winter evening' })
    const g = fake.prompts.at(-1).prompt
    assert.equal(Object.values(g).find((n) => n.class_type === 'CLIPTextEncode').inputs.text.startsWith('Edit this video frame: a snowy winter evening.'), true)
    assert.equal(Object.values(g).filter((n) => n.class_type === 'LoadImage').length, 1, 'only the frame')
    const before = fake.prompts.length
    const again = await ok('remake_paint', { kind: 'change', session: s.id, ask: 'a rainy night', only: [12] })
    assert.equal(again.id, s.id, 'the same session')
    assert.equal(fake.prompts.length - before, 1)
    assert.notEqual(again.keyframes[0].painted, s.keyframes[0].painted, 'a new painted frame')
    assert.equal(again.ask, 'a rainy night')
    const none = fake.prompts.length
    await ok('remake_paint', { kind: 'change', session: s.id, ask: 'x', only: [999] })
    assert.equal(fake.prompts.length, none, 'a frame number that is not a keyframe paints nothing')
  })

  test('[mcp:remake_paint] says what is missing: the video, who goes in, what changes, a clip that is too long, an unknown session or no picture editor', async () => {
    const before = fake.prompts.length
    await fails('remake_paint', { kind: 'swap', video: path.join(dir, 'gone.mp4'), picture: face }, /Choose the source video\./)
    await fails('remake_paint', { kind: 'swap', video }, /Add a picture of who goes in\./)
    await fails('remake_paint', { kind: 'change', video }, /Say what changes, for example/)
    await fails('remake_paint', { kind: 'swap', video: long, picture: face }, /Remake takes up to 14\.4 s at a time; this part is 16\.0 s\./)
    await fails('remake_paint', { kind: 'swap', video: face, picture: face }, /isn’t a video/)
    await fails('remake_paint', { kind: 'swap', session: 'nope', picture: face }, /No Remake nope\./)
    await fails('remake_paint', { kind: 'teleport', video }, /kind/i)
    assert.equal(fake.prompts.length, before)
    // a ComfyUI with no picture editor: the clip is prepared, then painting is refused
    fake.setObjectInfo({})
    try {
      await fails('remake_paint', { kind: 'change', video, ask: 'x' }, /Painting needs a picture editor: Qwen Image 2\.1, Flux\.2 Klein or Flux 3 Klein\. Set one up in Settings → Setup\./)
      assert.equal(fake.prompts.length, before)
    } finally {
      fake.setObjectInfo(OBJECT_INFO)
    }
  })

  // ---------- remake_use_picture ----------
  test('[mcp:remake_use_picture][ipc:remake:usePicture] puts the person\'s own picture on a keyframe, fitted to the canvas, and marks it as their own', async () => {
    answers()
    const s = await ok('remake_paint', { kind: 'change', video, ask: 'night' })
    const r = await ok('remake_use_picture', { session: s.id, frame: 12, picture: own })
    const k = r.keyframes[0]
    assert.equal(k.own, true)
    assert.match(path.basename(k.painted), /^own_12_\d+\.png$/)
    assert.equal(probe(k.painted, 'stream=width,height'), '864,480', 'stretched to the canvas so nothing is cropped')
    assert.equal(readSession(s.id).keyframes[0].painted, k.painted)
    await fails('remake_use_picture', { session: 'nope', frame: 12, picture: own }, /No Remake nope\./)
    await fails('remake_use_picture', { session: s.id, frame: 12, picture: path.join(dir, 'gone.png') }, /gone\.png|No such file|Invalid argument/)
  })

  // ---------- remake_render ----------
  test('[mcp:remake_render][ipc:remake:setPrompt][ipc:remake:render] queues a take from Viggle\'s graph with the clip, the painted frame pinned at its frame number and the person\'s own prompt', async () => {
    const s = await painted1()
    const prompt = Object.entries(SECTIONS).map(([k, v]) => `${k}:\n${v}`).join('\n\n') + '\n'
    const before = fake.prompts.length
    const r = await ok('remake_render', { session: s.id, prompt, seed: 500 })
    assert.equal(fake.prompts.length - before, 1)
    const g = fake.prompts.at(-1).prompt
    const cond = Object.values(g).find((n) => n.class_type === 'RemakeConditioning').inputs
    assert.deepEqual([cond.prompt, cond.pins, cond.frames, cond.short_edge], [prompt, '12', 107, 480])
    assert.equal(Object.values(g).find((n) => n.class_type === 'RemakeNoise').inputs.seed, 500)
    assert.equal(Object.values(g).find((n) => n.class_type === 'UNETLoader').inputs.unet_name, 'viggle_remake_swap_pruned_int8_convrot.safetensors')
    assert.equal(g.save.class_type, 'SaveVideo')
    assert.match(g.save.inputs.filename_prefix, new RegExp(`^H3/remake/${s.id}_s500$`))
    assert.equal(g.ref1.class_type, 'LoadImage')
    assert.match(g.ref1.inputs.image, /^remake\/painted_12_\d+\.png$/)
    assert.equal(g['7'].inputs.file, 'remake/source.mp4')
    assert.equal(r.jobs.length, 1)
    assert.equal(r.jobs[0].kind, 'replace')
    assert.deepEqual(r.session.jobs, [r.jobs[0].id])
    assert.deepEqual(readSession(s.id).promptProblems, [])
    assert.equal(readSession(s.id).projectId.length > 0, true)
  })

  test('[mcp:remake_render] renders up to three takes, each with its own seed, and adds a character\'s LoRA', async () => {
    const s = await painted1()
    await ok('save_character', { id: 'miatest', name: 'Mia', lora: 'mia_lora.safetensors', strength: 0.7, trigger: 'mi4a' })
    const prompt = Object.entries(SECTIONS).map(([k, v]) => `${k}:\n${v}`).join('\n\n') + '\n'
    const before = fake.prompts.length
    const r = await ok('remake_render', { session: s.id, prompt, seed: 10, takes: 3, characterId: 'miatest' })
    const queued = fake.prompts.slice(before).map((p) => p.prompt)
    assert.deepEqual(queued.map((g) => Object.values(g).find((n) => n.class_type === 'RemakeNoise').inputs.seed), [10, 1010, 2010])
    for (const g of queued) {
      const lora = Object.values(g).find((n) => n.class_type === 'LoraLoaderModelOnly')
      assert.deepEqual([lora.inputs.lora_name, lora.inputs.strength_model], ['mia_lora.safetensors', 0.7])
    }
    assert.equal(r.jobs.length, 3)
    await fails('remake_render', { session: s.id, prompt, takes: 4 }, /takes/i)
  })

  test('[mcp:remake_render][ipc:remake:check][ipc:remake:write] has the person\'s writer write the six sections from the frames when no prompt is given, and says what the writer got wrong', async () => {
    const s = await painted1()
    claudeAnswers(SECTIONS)
    const r = await ok('remake_render', { session: s.id })
    const saved = readSession(s.id)
    assert.equal(saved.writer, 'claude')
    assert.deepEqual(saved.promptProblems, [])
    assert.ok(saved.prompt.startsWith('subject_definitions:\n<Video 1> is the source video.'))
    assert.ok(saved.prompt.endsWith('non_diegetic_music:\nN/A\n'))
    assert.equal(Object.values(fake.prompts.at(-1).prompt).find((n) => n.class_type === 'RemakeConditioning').inputs.prompt, saved.prompt)
    assert.match(fs.readFileSync(path.join(shimDir, 'claude.stdin'), 'utf8'), /Painted frames: <Picture 1> at 00:00\.500\./)
    assert.equal(r.jobs.length, 1)
    // a prompt with a problem is still rendered, and the problems are kept with the session
    const t = await painted1()
    const bad = { ...SECTIONS, summary: 'Replace the man with Mia. It is dim.' }
    claudeAnswers(bad)
    await ok('remake_render', { session: t.id })
    assert.deepEqual(readSession(t.id).promptProblems, ['gives an order instead of describing the result', 'says "dim", which darkens the whole render'])
  })

  test('[mcp:remake_render] needs a painted frame, and says what the ComfyUI lacks before it queues anything', async () => {
    // a session that was prepared and never painted: the picture editor failed
    fake.failNextPrompt('no memory')
    const failed = await call('remake_paint', { kind: 'change', video, ask: 'night' })
    assert.equal(failed.isError, true)
    assert.match(failed.content[0].text, /Painting failed: /)
    const id = fs.readdirSync(path.join(mcp.dataDir, 'remake')).find((d) => readSessionOrNull(d)?.keyframes?.every((k) => !k.painted))
    assert.ok(id, 'an unpainted session was left behind')
    const prompt = Object.entries(SECTIONS).map(([k, v]) => `${k}:\n${v}`).join('\n\n') + '\n'
    const queued = fake.prompts.length
    await fails('remake_render', { session: id, prompt }, /Paint at least one frame first\./)
    await fails('remake_render', { session: 'nope' }, /No Remake nope\./)
    // painted, but Viggle Remake's nodes and model are not on this ComfyUI
    const s = await painted1()
    const painting = fake.prompts.length
    fake.setObjectInfo({ ...OBJECT_INFO, UNETLoader: combo('unet_name', ['Flux2/flux2_klein_9b.safetensors']), RemakeConditioning: undefined, RemakeKeyframeUntil: undefined, RemakeNoise: undefined })
    try {
      await fails('remake_render', { session: s.id, prompt }, /Remake needs Viggle Remake nodes \(Settings → Setup → Install missing node packs\), Viggle Remake swap \(viggle_remake_swap_pruned_int8_convrot\.safetensors, 21 GB\)\./)
    } finally {
      fake.setObjectInfo(OBJECT_INFO)
    }
    assert.equal(fake.prompts.length, painting, 'nothing was queued')
    assert.ok(painting > queued)
  })
  const readSessionOrNull = (id) => {
    try {
      return readSession(id)
    } catch {
      return null
    }
  }

  // ---------- replace_history (a Remake take) ----------
  test('[mcp:replace_history] shows a Remake take cut back to the clip\'s length and shape, ahead of the take as ComfyUI made it', async () => {
    const s = await painted1()
    const prompt = Object.entries(SECTIONS).map(([k, v]) => `${k}:\n${v}`).join('\n\n') + '\n'
    const r = await ok('remake_render', { session: s.id, prompt, seed: 77 })
    const { items } = await ok('replace_history')
    const entry = items.find((i) => i.job === r.jobs[0].id)
    assert.equal(entry.status, 'success')
    assert.match(entry.name, /^Swap · man/)
    const final = entry.outputs[0]
    assert.equal(final.kind, 'final')
    assert.equal(final.path, path.join(mcp.dataDir, 'remake', s.id, `${r.jobs[0].id}_final.mp4`))
    assert.equal(probe(final.path, 'stream=width,height'), '864,486', 'the source\'s own 16:9 shape at the canvas\'s long edge')
    assert.equal(probe(final.path, 'stream=nb_read_frames'), '96', 'the padding is cut off')
    assert.ok(entry.outputs.length >= 1 && entry.outputs.filter((o) => o.kind === 'final').length === 1, 'the trimmed take replaces the raw one as the final')
  })
})
