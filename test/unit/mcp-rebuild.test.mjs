// MCP Rebuild tools (task 5.7, part 3): read a video into shots, say what each is, plan, paint frames, render the H3
// shots, cut them back into an edit. Called through the real MCP server on source under the test guard, against the
// fake ComfyUI and the claude shim (design D1, D8). The source video is made with ffmpeg: three solid shots (black, white, grey)
// (3 s, 6 s, 2 s) over a 120 BPM click track, so the reader finds three shots. A painted frame and a finished take
// are made by the test writing what ComfyUI would have saved into the fake (setOutputs), as in mcp-render.test.mjs.
//   node --test test/unit/mcp-rebuild.test.mjs
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { after, afterEach, before, describe, test } from 'node:test'
import ffmpegStatic from 'ffmpeg-ffprobe-static'
import { startFakeComfy } from '../fakes/comfyui.mjs'
import { startMcp } from '../fakes/mcp.mjs'
import { guardState } from '../fakes/ports.mjs'
import { alignmentLine, CLEAN_TEXT, GUIDE_WARNING, h3Length, NO_TEXT } from '../../src/service/rebuild.js'

const combo = (name, options) => ({ input: { required: { [name]: [options] } } })
// Flux.2 Klein is the installed picture editor
const OBJECT_INFO = {
  UNETLoader: combo('unet_name', ['Flux2/flux2_klein_9b.safetensors']),
  CLIPLoader: { input: { required: { clip_name: [['qwen_3_8b.safetensors']], type: [['flux2']] } } },
  VAELoader: combo('vae_name', ['flux2-vae.safetensors'])
}

describe('MCP rebuild tools', () => {
  let fake, mcp, shimDir, dir, source, face, painted, preview, final
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
  const dataFile = (...p) => path.join(mcp.dataDir, ...p)
  const readRebuild = (id) => JSON.parse(fs.readFileSync(dataFile('rebuild', id, 'rebuild.json'), 'utf8'))
  const has = (g, cls) => Object.values(g).some((n) => n.class_type === cls)
  // replaces the claude shim with one that records how it was called and answers with `obj` in the app's shape
  const claudeAnswers = (obj) => {
    const file = path.join(shimDir, 'claude')
    fs.rmSync(`${file}.args`, { force: true })
    fs.writeFileSync(file, `#!/bin/sh\necho "$@" >> "$0.args"\ncat > "$0.stdin"\ncat <<'JSON'\n${JSON.stringify({ is_error: false, result: '', structured_output: obj })}\nJSON\n`, { mode: 0o755 })
  }
  // The reader takes about 0.4 s a video, so only the first tests run it. The others start from a copy of what it made
  // (same shots, frames, sheets and tempo) under a new id, which is all the later steps depend on.
  let base = null
  const read = async ({ name = null } = {}) => {
    if (!base) base = (await ok('rebuild_read', { file: source, rights: true, name: 'Base' })).id
    const id = Math.random().toString(16).slice(2, 10)
    fs.cpSync(dataFile('rebuild', base), dataFile('rebuild', id), { recursive: true })
    const text = fs.readFileSync(dataFile('rebuild', id, 'rebuild.json'), 'utf8').replaceAll(base, id)
    const copy = JSON.parse(text)
    if (name) copy.name = name
    fs.writeFileSync(dataFile('rebuild', id, 'rebuild.json'), JSON.stringify(copy, null, 2))
    return ok('get_rebuild', { rebuildId: id })
  }
  // a prompt that opens with the frames line H3 needs for a shot of this length and says there is no writing
  const h3prompt = (duration) => `${alignmentLine(h3Length(duration))}\n\nintegrated_multimodal_description: [Shot 1] A man in a grey suit walks along a quiet street, the camera holds a static shot. ${NO_TEXT}\n\noverall_soundscape: Soft footsteps.\n\nnon_diegetic_music: N/A`
  // a plan: shot 1 and 2 are made again by H3, shot 3 stays as it is
  const planFor = (r, extra = {}) => ({
    shots: [
      { index: 1, route: 'h3', prompt: h3prompt(r.shots[0].duration) },
      { index: 2, route: 'h3', prompt: h3prompt(r.shots[1].duration) },
      { index: 3, route: 'keep' }
    ],
    ...extra
  })
  const reading = (index, extra = {}) => ({ index, kind: 'live', why: 'Filmed.', description: 'A plain coloured wall.', ...extra })
  // a rebuild that is read, understood and planned
  const planned = async (args = {}, planExtra = {}) => {
    const r = await read(args)
    await ok('save_rebuild_reading', { rebuildId: r.id, shots: r.shots.map((s) => reading(s.index)) })
    await ok('save_rebuild_plan', { rebuildId: r.id, plan: planFor(r, planExtra) })
    return r
  }
  const approvedPlan = async (args = {}, planExtra = {}) => {
    const r = await planned(args, planExtra)
    await ok('approve_rebuild_plan', { rebuildId: r.id })
    return r
  }
  const withFrames = async (args = {}, planExtra = {}) => {
    const r = await approvedPlan(args, planExtra)
    await ok('make_rebuild_frames', { rebuildId: r.id })
    await ok('approve_rebuild_frames', { rebuildId: r.id })
    return r
  }
  const gif = (file) => ({ gifs: [{ filename: path.basename(file), subfolder: 'H3/previews', type: 'output', fullpath: file }] })
  // ComfyUI saves a picture, a take's candidates and a finished video where the graph says
  const answers = () =>
    fake.setOutputs((g) => {
      if (has(g, 'SaveImage') && has(g, 'LoadImage')) return { 11: { images: [{ filename: 'painted.png', subfolder: 'iv_studio/images', type: 'output', fullpath: painted }] } }
      if (has(g, 'VHS_LoadVideoPath')) return { 51: { text: [final] } }
      if (has(g, 'MiniMaxH3ImageToVideo')) return { 42: gif(preview), 118: gif(preview), 128: gif(preview) }
      return undefined
    })
  afterEach(() => fake.setOutputs(null))

  before(async () => {
    fake = await startFakeComfy({ devices: 'mps', os: 'darwin', objectInfo: OBJECT_INFO })
    mcp = await startMcp({ comfyUrl: fake.url, shims: true, settings: { promptEngine: 'claude' } })
    shimDir = [...guardState().shimDirs].at(-1)
    dir = path.join(path.dirname(mcp.dataDir), 'fixtures')
    fs.mkdirSync(dir, { recursive: true })
    source = path.join(dir, 'source.mp4')
    face = path.join(dir, 'face.png')
    painted = path.join(dir, 'painted.png')
    preview = path.join(dir, 'preview.mp4')
    final = path.join(dir, 'final.mp4')
    const h264 = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p']
    // three solid shots over a click every half second
    ff('-f', 'lavfi', '-i', 'color=c=black:s=192x108:r=24:d=3', '-f', 'lavfi', '-i', 'color=c=white:s=192x108:r=24:d=6', '-f', 'lavfi', '-i', 'color=c=gray:s=192x108:r=24:d=2', '-f', 'lavfi', '-i', "aevalsrc='if(lt(mod(t,0.5),0.03),sin(2*PI*1000*t),0)':s=22050:d=11", '-filter_complex', '[0][1][2]concat=n=3:v=1:a=0[v]', '-map', '[v]', '-map', '3:a', ...h264, '-c:a', 'aac', source)
    ff('-f', 'lavfi', '-i', 'color=c=orange:s=64x64', '-frames:v', '1', face)
    ff('-f', 'lavfi', '-i', 'color=c=purple:s=192x108', '-frames:v', '1', painted)
    ff('-f', 'lavfi', '-i', 'testsrc=s=192x108:r=24:d=5', ...h264, preview)
    ff('-f', 'lavfi', '-i', 'testsrc2=s=192x108:r=24:d=5', ...h264, final)
  })
  after(async () => {
    await mcp?.close()
    await fake?.close()
  })

  // ---------- rebuild_read ----------
  test('[mcp:rebuild_read] takes a video apart into its three shots with frames, a contact sheet each, the tempo and the sound', async () => {
    const r = await call('rebuild_read', { file: source, rights: true, name: 'My film' })
    assert.ok(!r.isError, JSON.stringify(r.content))
    assert.equal(r.content.find((c) => c.type === 'image').mimeType, 'image/jpeg', 'a sheet of every shot\'s middle frame')
    const s = r.structuredContent
    assert.equal(s.name, 'My film')
    assert.equal(s.status, 'reading')
    assert.deepEqual([s.source.width, s.source.height, s.source.hasAudio], [192, 108, true])
    assert.equal(s.shots.length, 3)
    assert.deepEqual(s.shots.map((x) => Math.round(x.duration)), [3, 6, 2])
    assert.deepEqual(s.shots.map((x) => x.index), [1, 2, 3])
    for (const shot of s.shots) for (const f of [shot.first, shot.middle, shot.last, shot.sheet]) assert.ok(fs.existsSync(f) && f.startsWith(dataFile('rebuild', s.id)), f)
    assert.equal(s.shots[0].reading, null)
    assert.equal(s.shots[1].suggested, null)
    assert.ok(Math.abs(s.music.bpm - 120) < 4, `tempo ${s.music.bpm}`)
    assert.equal(typeof s.music.beats, 'number', 'the beat list is counted, not sent')
    assert.equal(s.speechState, 'not_set_up')
    assert.equal(s.rightsConfirmedAt.slice(0, 2), '20')
    assert.ok(fs.existsSync(dataFile('rebuild', s.id, 'source.mp4')) && fs.existsSync(dataFile('rebuild', s.id, 'reading.json')))
    assert.deepEqual(await mcp.refusals(), [])
  })

  test('[mcp:rebuild_read] asks for the person\'s rights first, and turns down a missing file, a picture and a video over two minutes', async () => {
    await fails('rebuild_read', { file: source }, /Confirm that \(rights: true\) to go on\./)
    await fails('rebuild_read', { file: path.join(dir, 'gone.mp4'), rights: true }, /File not found/)
    await fails('rebuild_read', { file: face, rights: true }, /isn't a video\./)
    const long = path.join(dir, 'long.mp4')
    ff('-f', 'lavfi', '-i', 'color=c=black:s=16x16:r=1:d=130', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', long)
    await fails('rebuild_read', { file: long, rights: true }, /up to 2 minutes; this one is 130 s/)
    await fails('rebuild_read', { file: source, rights: true, swap: { ask: '  ' } }, /swap: say what changes/)
    await fails('rebuild_read', { file: source, rights: true, swap: { ask: 'Make her a man', picture: path.join(dir, 'nobody.png') } }, /swap: picture not found/)
    const folders = fs.existsSync(dataFile('rebuild')) ? fs.readdirSync(dataFile('rebuild')).length : 0
    await fails('rebuild_read', { file: source }, /rights/)
    assert.equal(fs.existsSync(dataFile('rebuild')) ? fs.readdirSync(dataFile('rebuild')).length : 0, folders, 'a refused read leaves nothing behind')
  })

  test('[mcp:rebuild_read] keeps the swap the person already asked for, and with writer: true has Claude Code read every shot', async () => {
    claudeAnswers({ kind: 'live', why: 'Filmed on a phone.', description: 'A red wall, static.', captions: [{ text: 'Hello', from: 0.5, to: 99, where: 'top' }], stickers: [], camera: 'static', light: 'flat' })
    const r = await ok('rebuild_read', { file: source, rights: true, swap: { ask: 'Make her a man in a grey suit', picture: face }, writer: true })
    assert.deepEqual(r.swap, { ask: 'Make her a man in a grey suit', picture: face })
    assert.equal(r.status, 'planning', 'every shot has a reading, so the plan is next')
    assert.deepEqual(r.shots.map((s) => s.reading.kind), ['live', 'live', 'live'])
    assert.deepEqual(r.shots[0].reading.captions, [{ text: 'Hello', from: 0.5, to: r.shots[0].duration, where: 'top' }], 'a caption cannot run past its shot')
    assert.deepEqual(r.shots.map((s) => s.suggested), ['keep', 'keep', 'keep'])
    const args = fs.readFileSync(path.join(shimDir, 'claude.args'), 'utf8').trim().split('\n')
    assert.equal(args.length, 3, 'one call per shot')
    assert.deepEqual(await mcp.refusals(), [])
  })

  // ---------- view_rebuild_shot ----------
  test('[mcp:view_rebuild_shot] shows one shot\'s sheet and first and last frames with what the reader measured and its reading', async () => {
    const r = await read()
    await ok('save_rebuild_reading', { rebuildId: r.id, shots: [reading(2, { description: 'A green wall.' })] })
    const res = await call('view_rebuild_shot', { rebuildId: r.id, index: 2 })
    assert.ok(!res.isError, JSON.stringify(res.content))
    assert.deepEqual(res.content.filter((c) => c.type === 'image').map((c) => c.mimeType), ['image/jpeg', 'image/jpeg'])
    const s = res.structuredContent
    assert.equal(s.rebuildId, r.id)
    assert.equal(s.index, 2)
    assert.equal(s.reading.description, 'A green wall.')
    assert.equal(s.suggested, 'keep')
    assert.deepEqual(s.bandTop, [])
    assert.equal(s.words, null)
    assert.equal(s.sheet, r.shots[1].sheet)
    await fails('view_rebuild_shot', { rebuildId: r.id, index: 4 }, /There's no shot 4; the shots run 1 to 3\./)
    await fails('view_rebuild_shot', { rebuildId: 'nope', index: 1 }, /No rebuild nope/)
  })

  // ---------- save_rebuild_reading ----------
  test('[mcp:save_rebuild_reading] saves a few shots at a time and moves to planning once every shot has been read', async () => {
    const r = await read()
    const first = await ok('save_rebuild_reading', { rebuildId: r.id, shots: [reading(1, { kind: 'ai_video', captions: [{ text: ' Hi ', from: -1, to: 400, where: 'middle' }, { text: '   ', from: 0, to: 1, where: 'top' }], stickers: ['🔥'], camera: 'push in', light: 'warm' })] })
    assert.equal(first.status, 'reading', 'two shots are still unread')
    assert.deepEqual(first.shots[0].reading, { kind: 'ai_video', why: 'Filmed.', description: 'A plain coloured wall.', captions: [{ text: 'Hi', from: 0, to: first.shots[0].duration, where: 'middle' }], stickers: ['🔥'], camera: 'push in', light: 'warm' })
    assert.equal(first.shots[0].suggested, 'h3', 'an AI video is made again with H3')
    assert.equal(first.shots[0].h3.frames, 124)
    const all = await ok('save_rebuild_reading', { rebuildId: r.id, shots: [reading(2), reading(3, { kind: 'still' })] })
    assert.equal(all.status, 'planning')
    assert.equal(all.shots[2].suggested, 'still')
    assert.equal(readRebuild(r.id).status, 'planning')
  })

  test('[mcp:save_rebuild_reading] turns down a kind that is not one of the seven and a shot that is not there, and saves nothing', async () => {
    const r = await read()
    await fails('save_rebuild_reading', { rebuildId: r.id, shots: [reading(1, { kind: 'cartoon' })] }, /kind/i)
    await fails('save_rebuild_reading', { rebuildId: r.id, shots: [reading(9)] }, /There's no shot 9; the shots run 1 to 3\./)
    assert.ok(readRebuild(r.id).shots.every((s) => s.reading === null))
  })

  // ---------- save_rebuild_plan ----------
  test('[mcp:save_rebuild_plan] saves a route for every shot with how H3 makes each one and leaves the plan unapproved', async () => {
    const r = await read()
    const s = await ok('save_rebuild_plan', { rebuildId: r.id, plan: planFor(r, { notes: 'Keep the last shot.', swap: { ask: 'Make her a man' } }) })
    assert.equal(s.status, 'planning')
    assert.equal(s.planApprovedAt, null)
    assert.deepEqual(s.plan.shots.map((p) => [p.index, p.route, p.character]), [[1, 'h3', 'none'], [2, 'h3', 'none'], [3, 'keep', 'none']])
    assert.deepEqual(s.plan.shots[0].h3, h3Length(s.shots[0].duration))
    assert.equal(s.plan.shots[0].h3.useLast, false, 'a 3 s shot renders 5.17 s from the first frame only')
    assert.equal(s.plan.shots[1].h3.useLast, true, 'a 6 s shot gets its first and last frame')
    assert.deepEqual(s.plan.swap, { ask: 'Make her a man', picture: null })
    assert.equal(s.plan.notes, 'Keep the last shot.')
    assert.deepEqual(s.shots.map((x) => x.route), ['h3', 'h3', 'keep'])
  })

  test('[mcp:save_rebuild_plan] turns down a plan H3 would misread and says which shot and why', async () => {
    const r = await read()
    const p = (shot1, ...rest) => ({ shots: [shot1, { index: 2, route: 'keep' }, { index: 3, route: 'keep' }, ...rest] })
    await fails('save_rebuild_plan', { rebuildId: r.id, plan: { shots: [{ index: 1, route: 'keep' }] } }, /Shot 2 has no route in the plan/)
    await fails('save_rebuild_plan', { rebuildId: r.id, plan: p({ index: 1, route: 'keep' }, { index: 9, route: 'keep' }) }, /There's no shot 9/)
    await fails('save_rebuild_plan', { rebuildId: r.id, plan: p({ index: 1, route: 'keep' }, { index: 3, route: 'keep' }) }, /Shot 3 is in the plan twice\./)
    await fails('save_rebuild_plan', { rebuildId: r.id, plan: p({ index: 1, route: 'teleport' }) }, /route/i)
    await fails('save_rebuild_plan', { rebuildId: r.id, plan: p({ index: 1, route: 'h3' }) }, /Shot 1: an h3 shot needs its prompt\./)
    await fails('save_rebuild_plan', { rebuildId: r.id, plan: p({ index: 1, route: 'h3', prompt: 'A man walks. ' + NO_TEXT }) }, /Shot 1: the prompt must open with H3's frames line for this shot \(first frame only\)/)
    await fails('save_rebuild_plan', { rebuildId: r.id, plan: p({ index: 1, route: 'h3', prompt: h3prompt(r.shots[0].duration).replace(NO_TEXT, '') }) }, /Shot 1: the prompt must say "There is no writing anywhere in the picture\."/)
    await fails('save_rebuild_plan', { rebuildId: r.id, plan: p({ index: 1, route: 'own', file: path.join(dir, 'gone.mp4') }) }, /Shot 1: your own clip wasn't found/)
    await fails('save_rebuild_plan', { rebuildId: r.id, plan: { ...p({ index: 1, route: 'keep' }), swap: { ask: 'x', picture: path.join(dir, 'gone.png') } } }, /plan\.swap: picture not found/)
    assert.equal(readRebuild(r.id).plan, null)
  })

  test('[mcp:save_rebuild_plan] takes the person\'s own clip, a still and a Replace route, and saving again takes the approval back', async () => {
    const r = await approvedPlan()
    assert.equal(readRebuild(r.id).status, 'approved')
    const s = await ok('save_rebuild_plan', { rebuildId: r.id, plan: { shots: [{ index: 1, route: 'own', file: preview }, { index: 2, route: 'still' }, { index: 3, route: 'replace', note: 'swap the man' }] } })
    assert.deepEqual(s.plan.shots.map((p) => [p.route, p.file, p.note]), [['own', preview, null], ['still', null, null], ['replace', null, 'swap the man']])
    assert.equal(s.planApprovedAt, null)
    assert.equal(s.status, 'planning')
  })

  // ---------- approve_rebuild_plan ----------
  test('[mcp:approve_rebuild_plan] needs a plan first, then records the approval', async () => {
    const r = await read()
    await fails('approve_rebuild_plan', { rebuildId: r.id }, /Write the plan first\./)
    await ok('save_rebuild_plan', { rebuildId: r.id, plan: planFor(r) })
    const a = await ok('approve_rebuild_plan', { rebuildId: r.id })
    assert.equal(a.status, 'approved')
    assert.match(a.planApprovedAt, /^\d{4}-/)
  })

  // ---------- make_rebuild_frames ----------
  test('[mcp:make_rebuild_frames] needs the plan\'s OK first and queues nothing without it', async () => {
    const r = await planned()
    const queued = fake.prompts.length
    await fails('make_rebuild_frames', { rebuildId: r.id }, /The plan needs the person's OK first/)
    assert.equal(fake.prompts.length, queued)
  })

  test('[mcp:make_rebuild_frames] keeps the original frames of a shot with no writing and no swap, and asks ComfyUI for nothing', async () => {
    const r = await approvedPlan()
    const queued = fake.prompts.length
    const res = await call('make_rebuild_frames', { rebuildId: r.id })
    assert.ok(!res.isError, JSON.stringify(res.content))
    assert.equal(fake.prompts.length, queued, 'nothing to paint')
    assert.equal(res.content.filter((c) => c.type === 'image').length, 2, 'a before and after picture for each of the two H3 shots')
    const s = res.structuredContent
    assert.deepEqual(Object.keys(s.frames), ['1', '2'])
    assert.equal(s.frames[1].edited, false)
    assert.equal(s.frames[1].first, s.shots[0].first)
    assert.equal(s.frames[1].last, null, 'a short shot starts on its first frame only')
    assert.equal(s.frames[2].last, s.shots[1].last, 'a long shot has its last frame too')
    assert.equal(s.status, 'frames')
  })

  test('[mcp:make_rebuild_frames] paints writing and the swap out of and into the frames with the picture editor, both ends on one seed', async () => {
    answers()
    const r = await planned({}, { swap: { ask: 'Make her a man in a grey suit', picture: face } })
    await ok('save_rebuild_reading', { rebuildId: r.id, shots: [reading(2, { captions: [{ text: 'Buy now', from: 1, to: 3, where: 'bottom' }] })] })
    await ok('approve_rebuild_plan', { rebuildId: r.id })
    const before = fake.prompts.length
    const s = await ok('make_rebuild_frames', { rebuildId: r.id, only: [2] })
    const queued = fake.prompts.slice(before).map((p) => p.prompt)
    assert.equal(queued.length, 2, 'the first and the last frame of shot 2')
    for (const g of queued) {
      const text = Object.values(g).find((n) => n.class_type === 'CLIPTextEncode').inputs.text
      assert.ok(text.startsWith(CLEAN_TEXT), text)
      assert.match(text, /Then: Make her a man in a grey suit$/)
      assert.equal(Object.values(g).filter((n) => n.class_type === 'LoadImage').length, 2, 'the frame and the swap picture')
    }
    const seeds = queued.map((g) => Object.values(g).find((n) => n.inputs?.seed !== undefined || n.inputs?.noise_seed !== undefined))
    assert.equal(seeds[0].inputs.seed ?? seeds[0].inputs.noise_seed, seeds[1].inputs.seed ?? seeds[1].inputs.noise_seed)
    assert.deepEqual(Object.keys(s.frames), ['2'], 'only was asked for')
    assert.equal(s.frames[2].edited, true)
    for (const end of ['first', 'last']) assert.ok(s.frames[2][end].startsWith(dataFile('rebuild', r.id, 'frames')) && fs.existsSync(s.frames[2][end]), s.frames[2][end])
    assert.equal(s.frames[2].seed > 0, true)
  })

  // ---------- approve_rebuild_frames ----------
  test('[mcp:approve_rebuild_frames] needs the plan approved and every H3 shot\'s frames made, then records the approval', async () => {
    const r = await planned()
    await fails('approve_rebuild_frames', { rebuildId: r.id }, /The plan needs the person's OK first\./)
    await ok('approve_rebuild_plan', { rebuildId: r.id })
    await fails('approve_rebuild_frames', { rebuildId: r.id }, /Make the frames first \(shot 1, 2\)\./)
    await ok('make_rebuild_frames', { rebuildId: r.id, only: [1] })
    await fails('approve_rebuild_frames', { rebuildId: r.id }, /Make the frames first \(shot 2\)\./)
    await ok('make_rebuild_frames', { rebuildId: r.id })
    const a = await ok('approve_rebuild_frames', { rebuildId: r.id })
    assert.match(a.framesApprovedAt, /^\d{4}-/)
  })

  // ---------- make_rebuild_shots ----------
  test('[mcp:make_rebuild_shots] needs the frames\' OK first', async () => {
    const r = await approvedPlan()
    await ok('make_rebuild_frames', { rebuildId: r.id })
    const queued = fake.prompts.length
    await fails('make_rebuild_shots', { rebuildId: r.id }, /The frames need the person's OK first/)
    assert.equal(fake.prompts.length, queued)
  })

  test('[mcp:make_rebuild_shots] renders each H3 shot in frames mode from its frames, two previews each', async () => {
    fake.holdNextPrompt(2)
    const r = await withFrames()
    const before = fake.prompts.length
    const s = await ok('make_rebuild_shots', { rebuildId: r.id })
    const queued = fake.prompts.slice(before)
    assert.equal(queued.length, 2, 'one render per H3 shot')
    assert.deepEqual(Object.keys(s.takes), ['1', '2'])
    assert.equal(s.status, 'rendering')
    assert.ok(queued.every((p) => has(p.prompt, 'MiniMaxH3ImageToVideo')), 'H3 graphs')
    assert.equal(fake.uploads.filter((u) => /shot_00[12]_(first|last)/.test(u.name)).length >= 3, true, 'shot 1\'s first frame and shot 2\'s first and last frames went to ComfyUI')
    const t = readRebuild(r.id).takes
    const jobOf = (index) => JSON.parse(fs.readFileSync(dataFile('jobs', `${t[index].previewJob}.json`), 'utf8'))
    assert.deepEqual([jobOf(1).plan.resolved.previews, jobOf(1).plan.resolved.seconds, jobOf(1).plan.request.mode, jobOf(2).plan.resolved.previews], [2, 5.167, 'frames', 2], 'two previews of 5.17 s in frames mode')
    assert.deepEqual([t[1].previewJob === t[2].previewJob, Boolean(t[1].previewJob && t[2].previewJob)], [false, true], 'a job for each take')
    const again = fake.prompts.length
    await ok('make_rebuild_shots', { rebuildId: r.id })
    assert.equal(fake.prompts.length, again, 'a take already under way is not started twice')
  })

  test('[mcp:make_rebuild_shots] renders three previews of a shot when the film has a swap, from the painted frames', async () => {
    answers()
    const r = await read()
    await ok('save_rebuild_plan', { rebuildId: r.id, plan: { swap: { ask: 'Make her a man in a grey suit' }, shots: [{ index: 1, route: 'h3', prompt: h3prompt(r.shots[0].duration) }, { index: 2, route: 'keep' }, { index: 3, route: 'keep' }] } })
    await ok('approve_rebuild_plan', { rebuildId: r.id })
    await ok('make_rebuild_frames', { rebuildId: r.id })
    await ok('approve_rebuild_frames', { rebuildId: r.id })
    const s = await ok('make_rebuild_shots', { rebuildId: r.id })
    const job = JSON.parse(fs.readFileSync(dataFile('jobs', `${s.takes[1].previewJob}.json`), 'utf8'))
    assert.equal(job.plan.resolved.previews, 3)
  })

  test('[mcp:make_rebuild_shots] finishes the picked preview of each shot at 1 MP and has every shot done once the finishes are in', async () => {
    answers()
    const r = await withFrames()
    const made = await ok('make_rebuild_shots', { rebuildId: r.id })
    assert.deepEqual(Object.values(made.takes).map((t) => t.status), ['pick', 'pick'], 'both previews are ready to look at')
    assert.deepEqual(made.takes[2].previews.map((p) => p.candidate), [1, 2, 3].slice(0, made.takes[2].previews.length))
    await fails('make_rebuild_shots', { rebuildId: r.id, picks: [{ index: 9, candidate: 1 }] }, /Shot 9 has no takes yet\./)
    await fails('make_rebuild_shots', { rebuildId: r.id, picks: [{ index: 1, candidate: 4 }] }, /candidate/i)
    const before = fake.prompts.length
    const done = await ok('make_rebuild_shots', { rebuildId: r.id, picks: [{ index: 1, candidate: 1 }, { index: 2, candidate: 2 }] })
    assert.equal(fake.prompts.length - before, 2, 'a 1 MP finish for each picked preview')
    assert.deepEqual(Object.values(done.takes).map((t) => [t.candidate, t.status]), [[1, 'finishing'], [2, 'finishing']])
    const ready = await ok('get_rebuild', { rebuildId: r.id })
    assert.deepEqual(Object.values(ready.takes).map((t) => [t.candidate, t.status]), [[1, 'done'], [2, 'done']])
    assert.equal(ready.status, 'ready')
    for (const t of Object.values(ready.takes)) assert.equal(t.final, final, 'the finished video ComfyUI saved (already on this PC, so not copied)')
  })

  // ---------- rebuild_first_cut ----------
  test('[mcp:rebuild_first_cut] puts every shot back in its slot in an edit: new takes retimed, the original kept, captions as titles, the old sound as a guide', async () => {
    answers()
    const r = await planned({}, {})
    await ok('save_rebuild_reading', { rebuildId: r.id, shots: [reading(1, { captions: [{ text: 'Day one', from: 0.2, to: 2, where: 'top' }] }), reading(3, { captions: [{ text: 'The end', from: 0, to: 1, where: 'bottom' }] })] })
    await ok('approve_rebuild_plan', { rebuildId: r.id })
    await ok('make_rebuild_frames', { rebuildId: r.id })
    await ok('approve_rebuild_frames', { rebuildId: r.id })
    await ok('make_rebuild_shots', { rebuildId: r.id })
    await ok('make_rebuild_shots', { rebuildId: r.id, picks: [{ index: 1, candidate: 1 }] })
    const cut = await ok('rebuild_first_cut', { rebuildId: r.id })
    assert.equal(cut.format, '1080p')
    assert.deepEqual(cut.placed, [1], 'shot 1 has its new take')
    assert.deepEqual(cut.kept, [3])
    assert.deepEqual(cut.missing, [2], 'shot 2 was never picked, so the original stands in')
    assert.equal(cut.warnings[0], GUIDE_WARNING)
    assert.match(cut.warnings[1], /Shot 3 is still the original footage\./)
    assert.match(cut.warnings[2], /Shot 2 has no new take yet/)
    const e = await ok('get_edit', { editId: cut.editId })
    assert.equal(e.name, `${r.name} · rebuild`)
    assert.deepEqual(e.tracks.V1.map((c) => [c.start, c.end]), r.shots.map((s) => [s.start, s.end].map((x) => Math.round(x * 10) / 10)).map(([a, b]) => [a, b]), 'one clip in each shot\'s slot')
    assert.equal(e.tracks.A1.length, 1, 'the original sound as a guide')
    assert.deepEqual(e.tracks.T1.map((c) => [c.title.content, c.start, c.end]), [['Day one', 0.2, 2]], 'a caption only over a shot made new; shot 3 is the original and already carries its writing')
    assert.equal((await ok('get_rebuild', { rebuildId: r.id })).editId, cut.editId)
    assert.equal(readRebuild(r.id).status, 'editing')
  })

  test('[mcp:rebuild_first_cut] needs a plan, and cuts a still route as a slow push over the first frame', async () => {
    const r = await read()
    await fails('rebuild_first_cut', { rebuildId: r.id }, /Write and approve the plan first\./)
    await ok('save_rebuild_plan', { rebuildId: r.id, plan: { shots: [{ index: 1, route: 'still' }, { index: 2, route: 'keep' }, { index: 3, route: 'keep' }] } })
    const cut = await ok('rebuild_first_cut', { rebuildId: r.id })
    assert.deepEqual([cut.placed, cut.kept, cut.missing], [[1], [2, 3], []])
    const e = await ok('get_edit', { editId: cut.editId })
    assert.equal(e.tracks.V1.length, 3)
  })

  // ---------- get_rebuild ----------
  test('[mcp:get_rebuild] gives the rebuild with each shot\'s route and frames and take, and counts the beats instead of sending them', async () => {
    const r = await withFrames()
    const s = await ok('get_rebuild', { rebuildId: r.id })
    assert.equal(s.id, r.id)
    assert.deepEqual(s.shots.map((x) => x.route), ['h3', 'h3', 'keep'])
    assert.ok(s.shots[0].frames && s.shots[1].frames && s.shots[2].frames === null)
    assert.equal(s.shots[0].take, null)
    assert.equal(typeof s.music.beats, 'number')
    assert.ok(s.framesApprovedAt && s.planApprovedAt)
    await fails('get_rebuild', { rebuildId: 'nope' }, /nope/)
  })

  // ---------- list_rebuilds ----------
  test('[mcp:list_rebuilds] lists rebuilds newest first with name, status, shots, length and a cover', async () => {
    const a = await read({ name: 'Listed first' })
    const j = readRebuild(a.id)
    j.updatedAt = '2020-01-01T00:00:00.000Z'
    fs.writeFileSync(dataFile('rebuild', a.id, 'rebuild.json'), JSON.stringify(j))
    const b = await read({ name: 'Listed second' })
    const { items } = await ok('list_rebuilds')
    const ids = items.map((i) => i.id)
    assert.ok(ids.indexOf(b.id) < ids.indexOf(a.id), 'newest first')
    const item = items.find((i) => i.id === b.id)
    assert.deepEqual({ ...item, updatedAt: undefined }, { id: b.id, name: 'Listed second', status: 'reading', shots: 3, seconds: 11, cover: b.shots[0].middle, editId: null, updatedAt: undefined })
  })

  // ---------- delete_rebuild ----------
  test('[mcp:delete_rebuild] removes the rebuild and everything made for it, and the list no longer shows it', async () => {
    const r = await read({ name: 'Delete me' })
    assert.ok(fs.existsSync(dataFile('rebuild', r.id, 'shots')))
    assert.deepEqual(await ok('delete_rebuild', { rebuildId: r.id }), { items: true })
    assert.ok(!fs.existsSync(dataFile('rebuild', r.id)))
    assert.ok(!(await ok('list_rebuilds')).items.some((i) => i.id === r.id))
    await fails('get_rebuild', { rebuildId: r.id }, /rebuild[\\/]/)
  })
})
