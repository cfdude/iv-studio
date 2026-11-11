// MCP character-training tools (task 5.7, part 4): the design steps (faces, scenes, stills, clips, the person's own files),
// the cost estimate, and the checkpoint steps for a run that finished on this PC. Called through the real MCP server on
// source under the test guard, against the fake ComfyUI (Z-Image Turbo for the stills; H3's reference mode for the clips).
// Starting and stopping a run need Modal (or Fizgig's Python on this PC), and likeness scoring needs Shinobi's Python:
// start_training, stop_training, rank_likeness and score_checkpoints have gaps entries and row-less guard tests in
// mcp-training-guard.test.mjs.
//   node --test test/unit/mcp-training.test.mjs
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { after, afterEach, before, describe, test } from 'node:test'
import ffmpegStatic from 'ffmpeg-ffprobe-static'
import { startFakeComfy } from '../fakes/comfyui.mjs'
import { startMcp } from '../fakes/mcp.mjs'

const combo = (name, options) => ({ input: { required: { [name]: [options] } } })
// Z-Image Turbo, its text encoder and VAE, and the Snapshot Photo Reality LoRA that is added when present
const OBJECT_INFO = {
  UNETLoader: combo('unet_name', ['z_image_turbo_bf16.safetensors']),
  CLIPLoader: combo('clip_name', ['qwen_3_4b.safetensors']),
  VAELoader: combo('vae_name', ['ae.safetensors']),
  LoraLoaderModelOnly: combo('lora_name', ['SmartphoneSnapshotPhotoReality_v8.safetensors'])
}

describe('MCP character training tools', () => {
  let fake, mcp, dir, still, clipFile, voice
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
  const readTraining = (id) => JSON.parse(fs.readFileSync(dataFile('trainings', id, 'training.json'), 'utf8'))
  const graphs = (since) => fake.prompts.slice(since).map((p) => p.prompt)
  const byClass = (g, cls) => Object.values(g).find((n) => n.class_type === cls)
  // ComfyUI saves a picture for each still, as a real file
  const answerStills = () =>
    fake.setOutputs((g) => (byClass(g, 'EmptySD3LatentImage') ? { 11: { images: [{ filename: 'face.png', subfolder: 'IV Studio/characters', type: 'output', fullpath: still }] } } : undefined))
  afterEach(() => fake.setOutputs(null))
  // a training with a face picked (the four candidates finished at once on the fake)
  const withFace = async (name = 'Mira') => {
    answerStills()
    const t = await ok('create_character_training', { name })
    await ok('design_faces', { trainingId: t.id, faceText: 'round face, grey eyes, short dark hair' })
    return ok('pick_face', { trainingId: t.id, index: 1 })
  }

  before(async () => {
    fake = await startFakeComfy({ devices: 'cuda', os: 'win32', objectInfo: OBJECT_INFO })
    mcp = await startMcp({ comfyUrl: fake.url })
    dir = path.join(path.dirname(mcp.dataDir), 'fixtures')
    fs.mkdirSync(dir, { recursive: true })
    still = path.join(dir, 'still.png')
    clipFile = path.join(dir, 'clip.mp4')
    voice = path.join(dir, 'voice.wav')
    ff('-f', 'lavfi', '-i', 'color=c=orange:s=64x96', '-frames:v', '1', still)
    ff('-f', 'lavfi', '-i', 'testsrc=s=128x96:r=24:d=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clipFile)
    ff('-f', 'lavfi', '-i', 'sine=f=300:d=2', voice)
  })
  after(async () => {
    await mcp?.close()
    await fake?.close()
  })

  // ---------- create_character_training ----------
  test('[mcp:create_character_training] starts a character with a made-up trigger word and a project of its own', async () => {
    const t = await ok('create_character_training', { name: '  Mira  ' })
    assert.equal(t.name, 'Mira')
    assert.equal(t.trigger, 'm1ra4', 'Mira with its e, i and o swapped for 3, 1 and 0, and its length')
    assert.equal(t.who, 'a woman in her thirties')
    assert.deepEqual([t.faceText, t.consent, t.face, t.faceCandidates, t.stills, t.clips, t.train, t.characterId], ['', false, null, [], [], [], null, null])
    assert.match(t.id, /^[0-9a-f]{8}$/)
    const saved = readTraining(t.id)
    assert.equal(JSON.parse(fs.readFileSync(dataFile('projects', `${saved.projectId}.json`), 'utf8')).name, 'Training · Mira')
    const man = await ok('create_character_training', { name: 'Theo', who: 'a man in his fifties' })
    assert.equal(man.who, 'a man in his fifties')
    await fails('create_character_training', { name: '' }, /name/i)
  })

  // ---------- list_character_trainings ----------
  test('[mcp:list_character_trainings] lists the trainings newest first with the step each is at', async () => {
    const a = await ok('create_character_training', { name: 'Listed Old' })
    const old = readTraining(a.id)
    old.updatedAt = '2020-01-01T00:00:00.000Z'
    fs.writeFileSync(dataFile('trainings', a.id, 'training.json'), JSON.stringify(old))
    const b = await withFace('Listed New')
    const { items } = await ok('list_character_trainings')
    const ids = items.map((i) => i.id)
    assert.ok(ids.indexOf(b.id) < ids.indexOf(a.id))
    const row = (id) => items.find((i) => i.id === id)
    assert.deepEqual({ ...row(a.id), updatedAt: undefined }, { id: a.id, name: 'Listed Old', trigger: 'l1st3d6', step: 'design', cover: null, state: null, characterId: null, updatedAt: undefined })
    assert.equal(row(b.id).step, 'design', 'a face is picked but no still is kept yet')
    assert.equal(row(b.id).cover.path, still)
  })

  // ---------- get_character_training ----------
  test('[mcp:get_character_training] gives the face candidates, stills, clips, estimate and checkpoints, with each render\'s state and file', async () => {
    answerStills()
    const t = await ok('create_character_training', { name: 'Gotten' })
    await ok('design_faces', { trainingId: t.id, faceText: 'freckles, green eyes' })
    const r = await ok('get_character_training', { trainingId: t.id })
    assert.equal(r.faceCandidates.length, 4)
    assert.deepEqual(r.faceCandidates.map((c) => c.index), [0, 1, 2, 3])
    assert.ok(r.faceCandidates.every((c) => c.status === 'success' && c.path === still && c.jobId))
    assert.deepEqual([r.stills, r.clips, r.checkpoints, r.tests], [[], [], [], []])
    assert.equal(r.voice, null)
    assert.deepEqual([r.estimate.items, r.estimate.epochs, r.estimate.gpu, r.estimate.where], [0, 120, 'H200', 'modal'], 'an empty set still prices the start-up')
    await fails('get_character_training', { trainingId: 'nope' }, /No character training nope/)
  })

  // ---------- update_character_training ----------
  test('[mcp:update_character_training] changes the name, trigger, who, face description, consent and voice sample', async () => {
    const t = await ok('create_character_training', { name: 'Updated' })
    const r = await ok('update_character_training', { trainingId: t.id, name: 'Renamed', trigger: 'zq9x2', who: 'a boy of ten', faceText: 'gap-toothed grin', consent: true, voice })
    assert.deepEqual([r.name, r.trigger, r.who, r.faceText, r.consent, r.voice], ['Renamed', 'zq9x2', 'a boy of ten', 'gap-toothed grin', true, voice])
    const cleared = await ok('update_character_training', { trainingId: t.id, voice: null })
    assert.equal(cleared.voice, null)
    assert.equal(cleared.name, 'Renamed', 'the rest is kept')
    assert.equal(readTraining(t.id).voice, null)
  })

  test('[mcp:update_character_training] turns down a trigger word that is not 3-12 letters and numbers, and an unknown training', async () => {
    const t = await ok('create_character_training', { name: 'Strict' })
    await fails('update_character_training', { trainingId: t.id, trigger: 'no' }, /The trigger word is 3-12 letters and numbers, made up so H3 has no idea what it means \(like t3ss4\)\./)
    await fails('update_character_training', { trainingId: t.id, trigger: 'has space' }, /trigger word is 3-12/)
    await fails('update_character_training', { trainingId: 'nope', name: 'x' }, /No character training nope/)
    assert.equal(readTraining(t.id).trigger, 'str1ct6', 'the trigger it had is kept')
  })

  // ---------- design_faces ----------
  test('[mcp:design_faces] renders four face candidates from the description, each on its own seed, with the Snapshot look when it is installed', async () => {
    const t = await ok('create_character_training', { name: 'Faces', who: 'a man in his fifties' })
    const before = fake.prompts.length
    const r = await ok('design_faces', { trainingId: t.id, faceText: 'square jaw, grey stubble, kind eyes' })
    const queued = graphs(before)
    assert.equal(queued.length, 4)
    const seeds = queued.map((g) => byClass(g, 'KSampler').inputs.seed)
    assert.deepEqual(seeds.map((s, k) => s - seeds[0] - k), [0, 0, 0, 0], 'seeds in a row')
    assert.equal(seeds[0] % 10, 0)
    const g = queued[0]
    assert.equal(byClass(g, 'CLIPTextEncode').inputs.text, 'amateur photo, a man in his fifties, square jaw, grey stubble, kind eyes, close-up portrait looking at the camera, soft natural window light, a plain wall behind, candid phone photo')
    assert.equal(byClass(g, 'LoraLoaderModelOnly').inputs.lora_name, 'SmartphoneSnapshotPhotoReality_v8.safetensors')
    assert.deepEqual([byClass(g, 'EmptySD3LatentImage').inputs.width, byClass(g, 'EmptySD3LatentImage').inputs.height], [832, 1216])
    assert.match(byClass(g, 'SaveImage').inputs.filename_prefix, new RegExp(`^IV Studio/characters/faces_${t.id}/face_${seeds[0]}$`))
    assert.equal(r.faceText, 'square jaw, grey stubble, kind eyes')
    assert.deepEqual(r.faceCandidates.map((c) => c.seed), seeds)
    assert.deepEqual(readTraining(t.id).faceCandidates.map((c) => c.seed), seeds)
  })

  test('[mcp:design_faces] needs a face description and Z-Image Turbo on the ComfyUI, and queues nothing without them', async () => {
    const t = await ok('create_character_training', { name: 'Nothing' })
    const before = fake.prompts.length
    await fails('design_faces', { trainingId: t.id }, /Describe the face first: age, face shape, hair, eyes, skin, anything distinctive\./)
    fake.setObjectInfo({})
    try {
      await fails('design_faces', { trainingId: t.id, faceText: 'round face' }, /Designing a character needs Z-Image Turbo, its text encoder \(qwen_3_4b\) and VAE \(ae\)\. Download them on the Setup page/)
    } finally {
      fake.setObjectInfo(OBJECT_INFO)
    }
    assert.equal(fake.prompts.length, before)
  })

  // ---------- pick_face ----------
  test('[mcp:pick_face] keeps a finished candidate as the character\'s face, with its seed and picture', async () => {
    const t = await withFace('Picked')
    assert.equal(t.face.seed, t.faceCandidates[1].seed)
    assert.equal(t.face.jobId, t.faceCandidates[1].jobId)
    assert.equal(t.face.file.path, still)
    assert.equal(readTraining(t.id).face.seed, t.face.seed)
    await fails('pick_face', { trainingId: t.id, index: 9 }, /No face candidate with that index\./)
  })

  test('[mcp:pick_face] says when the candidate has not finished rendering yet', async () => {
    fake.holdNextPrompt(4)
    answerStills()
    const t = await ok('create_character_training', { name: 'Waiting' })
    await ok('design_faces', { trainingId: t.id, faceText: 'a face' })
    await fails('pick_face', { trainingId: t.id, index: 0 }, /That render has not finished yet; check get_character_training\./)
    fake.releaseHeld()
    const r = await ok('pick_face', { trainingId: t.id, index: 0 })
    assert.equal(r.face.file.path, still)
  })

  // ---------- design_scenes ----------
  test('[mcp:design_scenes] needs a face, then renders the picked face\'s seed across eight scenes, four candidates each', async () => {
    const t = await ok('create_character_training', { name: 'Scenes' })
    await fails('design_scenes', { trainingId: t.id }, /Pick a face first\./)
    const picked = await withFace('Scened')
    const before = fake.prompts.length
    const r = await ok('design_scenes', { trainingId: picked.id })
    const queued = graphs(before)
    assert.equal(queued.length, 32)
    assert.equal(r.stills.length, 8)
    assert.ok(r.stills.every((s) => s.source === 'generated' && s.candidates.length === 4 && s.pick === null && s.inSet === false))
    const seeds = queued.slice(0, 4).map((g) => byClass(g, 'KSampler').inputs.seed)
    assert.deepEqual(seeds, [0, 7, 14, 21].map((d) => picked.face.seed + d))
    assert.match(byClass(queued[0], 'CLIPTextEncode').inputs.text, /^amateur photo, a woman in her thirties, round face, grey eyes, short dark hair, standing by a kitchen window in soft morning light/)
    assert.match(r.stills[0].caption, new RegExp(`^${picked.trigger}, a woman in her thirties, standing by a kitchen window`))
  })

  // ---------- pick_still ----------
  test('[mcp:pick_still] keeps one candidate of a scene in the set, leaves a scene out, or asks for two more candidates', async () => {
    const picked = await withFace('Stilled')
    const scenes = await ok('design_scenes', { trainingId: picked.id })
    const id = scenes.stills[0].id
    const kept = await ok('pick_still', { trainingId: picked.id, stillId: id, index: 2 })
    assert.deepEqual([kept.stills[0].pick, kept.stills[0].inSet], [2, true])
    assert.equal(readTraining(picked.id).stills[0].file.path, still)
    const left = await ok('pick_still', { trainingId: picked.id, stillId: id, index: null })
    assert.deepEqual([left.stills[0].pick, left.stills[0].inSet], [null, false])
    const before = fake.prompts.length
    const more = await ok('pick_still', { trainingId: picked.id, stillId: id, reroll: true })
    assert.equal(more.stills[0].candidates.length, 6)
    assert.equal(fake.prompts.length - before, 2)
    const seeds = graphs(before).map((g) => byClass(g, 'KSampler').inputs.seed)
    assert.deepEqual(seeds, [picked.face.seed + 13 * 5, picked.face.seed + 13 * 6])
    await fails('pick_still', { trainingId: picked.id, stillId: 'nope', index: 0 }, /No still with that id\./)
    await fails('pick_still', { trainingId: picked.id, stillId: 'nope', reroll: true }, /That still is gone\./)
  })

  // ---------- add_training_files ----------
  test('[mcp:add_training_files] needs the person\'s confirmation first, then adds their own pictures and clips with the trigger in the caption', async () => {
    const t = await ok('create_character_training', { name: 'Own files', who: 'a man in his forties' })
    await fails('add_training_files', { trainingId: t.id, kind: 'still', files: [still] }, /Confirm the pictures are of an invented person, or of someone who agreed to this\./)
    await fails('add_training_files', { trainingId: t.id, kind: 'clip', files: [clipFile] }, /Confirm the clips are of an invented person, or of someone who agreed to this\./)
    await ok('update_character_training', { trainingId: t.id, consent: true })
    const stills = await ok('add_training_files', { trainingId: t.id, kind: 'still', files: [still, still], caption: 'in a red coat, on a street' })
    assert.equal(stills.stills.length, 2)
    assert.deepEqual(stills.stills.map((s) => [s.source, s.pick, s.inSet]), [['upload', 0, true], ['upload', 0, true]])
    assert.equal(stills.stills[0].caption, `${t.trigger}, a man in his forties, in a red coat, on a street`)
    const clips = await ok('add_training_files', { trainingId: t.id, kind: 'clip', files: [clipFile] })
    assert.deepEqual(clips.clips.map((c) => [c.source, c.keep, c.file, c.caption]), [['upload', true, clipFile, `${t.trigger}, a man in his forties`]])
    await fails('add_training_files', { trainingId: t.id, kind: 'still', files: [] }, /files/i)
  })

  // ---------- set_training_item ----------
  test('[mcp:set_training_item] puts the trigger first in a caption, keeps or drops a clip and removes an uploaded item', async () => {
    const t = await ok('create_character_training', { name: 'Items' })
    await ok('update_character_training', { trainingId: t.id, consent: true })
    const added = await ok('add_training_files', { trainingId: t.id, kind: 'still', files: [still, still] })
    await ok('add_training_files', { trainingId: t.id, kind: 'clip', files: [clipFile] })
    const [s1, s2] = added.stills
    const clipId = (await ok('get_character_training', { trainingId: t.id })).clips[0].id
    const a = await ok('set_training_item', { trainingId: t.id, kind: 'still', itemId: s1.id, caption: 'wearing a green scarf' })
    assert.equal(a.stills[0].caption, `${t.trigger}, wearing a green scarf`)
    const b = await ok('set_training_item', { trainingId: t.id, kind: 'still', itemId: s2.id, caption: `${t.trigger}, already first` })
    assert.equal(b.stills[1].caption, `${t.trigger}, already first`)
    const c = await ok('set_training_item', { trainingId: t.id, kind: 'clip', itemId: clipId, keep: false })
    assert.equal(c.clips[0].keep, false)
    const d = await ok('set_training_item', { trainingId: t.id, kind: 'still', itemId: s1.id, remove: true })
    assert.deepEqual(d.stills.map((s) => s.id), [s2.id])
    await fails('set_training_item', { trainingId: t.id, kind: 'still', itemId: 'nope', caption: 'x' }, /That item is gone\./)
  })

  // ---------- make_training_clips ----------
  test('[mcp:make_training_clips] needs a face and a kept still, then renders eight talking clips from them in H3\'s reference mode', async () => {
    const t = await ok('create_character_training', { name: 'Clips none' })
    await fails('make_training_clips', { trainingId: t.id }, /Pick a face, or keep at least two stills, first: the clips use them as the face\./)
    const picked = await withFace('Clipped')
    await fails('make_training_clips', { trainingId: picked.id }, /Keep at least one still first\./)
    const scenes = await ok('design_scenes', { trainingId: picked.id })
    await ok('pick_still', { trainingId: picked.id, stillId: scenes.stills[0].id, index: 0 })
    const before = fake.prompts.length
    const r = await ok('make_training_clips', { trainingId: picked.id })
    const queued = graphs(before)
    assert.equal(queued.length, 8)
    assert.equal(r.clips.length, 8)
    assert.ok(r.clips.every((c) => c.source === 'generated' && c.keep === true))
    assert.match(r.clips[0].caption, new RegExp(`^${picked.trigger}, a woman in her thirties, in a kitchen in the morning, wearing a grey knitted jumper, waist-up, talking to the camera, handheld phone video\\. \\(S1\\) says: <d>\\[English\\] Okay, so I finally tried that recipe`))
    const text = JSON.stringify(queued[0])
    assert.match(text, /<Subject 1> is the person in <Picture 1> and <Picture 2>: a woman in her thirties\./)
    assert.match(text, /There is no writing anywhere in the picture\./)
    assert.equal(fake.uploads.filter((u) => /still/.test(u.name) || /face/.test(u.name)).length >= 2, true, 'the face and a kept still went to ComfyUI as the references')
  })

  test('[mcp:make_training_clips] writes the given lines into the first clips and renders chosen clips again on a new seed', async () => {
    const picked = await withFace('Lined')
    const scenes = await ok('design_scenes', { trainingId: picked.id })
    await ok('pick_still', { trainingId: picked.id, stillId: scenes.stills[0].id, index: 0 })
    const r = await ok('make_training_clips', { trainingId: picked.id, lines: ['Hello there.', 'Second line.'] })
    assert.equal(r.clips.length, 2)
    assert.match(r.clips[0].caption, /says: <d>\[English\] Hello there\.<\/d>/)
    const before = readTraining(picked.id).clips
    const jobBefore = before[0].jobId
    const queued = fake.prompts.length
    const again = await ok('make_training_clips', { trainingId: picked.id, redo: [before[0].id] })
    assert.equal(fake.prompts.length - queued, 1)
    const after = readTraining(picked.id).clips
    assert.equal(after[0].seed, before[0].seed + 1000)
    assert.notEqual(after[0].jobId, jobBefore)
    assert.equal(after[1].jobId, before[1].jobId, 'the other clip is left alone')
    assert.equal(again.clips.length, 2)
    await fails('make_training_clips', { trainingId: picked.id, redo: ['nope'] }, /Only generated clips can be rendered again\./)
  })

  // ---------- estimate_training ----------
  test('[mcp:estimate_training] gives steps, minutes and dollars for Modal\'s H200 from the stills and clips kept, with each preset', async () => {
    const t = await ok('create_character_training', { name: 'Priced' })
    await ok('update_character_training', { trainingId: t.id, consent: true })
    await ok('add_training_files', { trainingId: t.id, kind: 'still', files: Array(8).fill(still) })
    await ok('add_training_files', { trainingId: t.id, kind: 'clip', files: [clipFile, clipFile] })
    const e = await ok('estimate_training', { trainingId: t.id })
    // 8 stills + 2 clips counted twice = 12 items; the standard preset's 2800 steps over 12 items, kept to 120 epochs
    assert.deepEqual([e.items, e.epochs, e.steps, e.gpu, e.where, e.perHour], [12, 120, 1440, 'H200', 'modal', 4.54])
    assert.deepEqual([e.minutes, e.dollars], [34, 2.68], '1440 steps at 1.1 s is 26.4 min, plus 7 to start; at $4.54 an hour and 15 cents')
    assert.equal(e.rank, 16)
    assert.equal(e.checkpoints, 20)
    assert.deepEqual(Object.keys(e.presets), ['quick', 'standard', 'thorough'])
    assert.deepEqual(e.presets.quick, { epochs: 60, minutes: 21, dollars: 1.68 }, 'quick is 1500 steps, 125 epochs, held to the preset\'s 60')
    assert.deepEqual([e.presets.standard.epochs, e.presets.thorough.epochs], [120, 160])
    assert.equal(e.capped, false)
  })

  test('[mcp:estimate_training] prices this PC at nothing, RunPod by its own GPU list, and says when a budget will stop the run early', async () => {
    const t = await ok('create_character_training', { name: 'Priced2' })
    await ok('update_character_training', { trainingId: t.id, consent: true })
    await ok('add_training_files', { trainingId: t.id, kind: 'still', files: Array(8).fill(still) })
    const local = await ok('estimate_training', { trainingId: t.id, options: { where: 'local' } })
    assert.deepEqual([local.where, local.gpu, local.dollars, local.perHour], ['local', 'local', 0, 0])
    const runpod = await ok('estimate_training', { trainingId: t.id, options: { where: 'runpod' }, gpu: 'NVIDIA L40S' })
    assert.deepEqual([runpod.where, runpod.gpu, runpod.perHour], ['runpod', 'NVIDIA L40S', 1.09])
    const modal = await ok('estimate_training', { trainingId: t.id, gpu: 'B200' })
    assert.equal(modal.gpu, 'B200')
    assert.ok(modal.dollars > 0)
    const capped = await ok('estimate_training', { trainingId: t.id, options: { budget: 0.5 } })
    assert.deepEqual([capped.options.budget, capped.capped], [0.5, true])
    const bad = await ok('estimate_training', { trainingId: t.id, gpu: 'Voodoo' })
    assert.equal(bad.gpu, 'H200', 'a GPU Modal does not have falls back to the default')
    await fails('estimate_training', { trainingId: t.id, epochs: 5 }, /epochs/i)
    await fails('estimate_training', { trainingId: 'nope' }, /No character training nope/)
  })

  test('[mcp:estimate_training] prices Train more by the extra epochs only', async () => {
    const t = await ok('create_character_training', { name: 'Priced3' })
    await ok('update_character_training', { trainingId: t.id, consent: true })
    await ok('add_training_files', { trainingId: t.id, kind: 'still', files: Array(8).fill(still) })
    const more = await ok('estimate_training', { trainingId: t.id, more: 20 })
    assert.deepEqual([more.more, more.epochs, more.steps], [true, 20, 160])
    assert.equal(more.presets, undefined)
  })

  // ---------- test_checkpoints and adopt_checkpoint ----------
  // a training that finished on this PC: its LoRA files are in its own run folder
  const trained = async (name = 'Trained') => {
    answerStills()
    const picked = await withFace(name)
    const id = picked.id
    const t = readTraining(id)
    t.train = { where: 'local', name: 'run1', state: 'done', gpu: 'local', options: {}, epochs: 20 }
    fs.writeFileSync(dataFile('trainings', id, 'training.json'), JSON.stringify(t))
    const loras = dataFile('trainings', id, 'train', 'run1', 'loras')
    fs.mkdirSync(loras, { recursive: true })
    for (const epoch of ['000010', '000020']) fs.writeFileSync(path.join(loras, `${name.toLowerCase()}_mmh3-${epoch}.safetensors`), `lora ${epoch}`)
    fs.writeFileSync(path.join(loras, `${name.toLowerCase()}_mmh3-000020-state`), 'x')
    return { id, loras }
  }

  test('[mcp:test_checkpoints] copies the chosen epochs next to the other character LoRAs and renders one test of each on the same seed', async () => {
    fake.setModels({ loras: [] })
    const { id, loras } = await trained('Tested')
    const before = fake.prompts.length
    const r = await ok('test_checkpoints', { trainingId: id, epochs: [10, 20] })
    assert.deepEqual(r.checkpoints.map((c) => c.epoch), [10, 20], 'the checkpoints found in the run folder')
    const folder = path.join(fake.dataDir, 'models', 'loras', 'MiniMax H3', 'tested')
    assert.deepEqual(fs.readdirSync(folder).sort(), ['tested_mmh3-000010.safetensors', 'tested_mmh3-000020.safetensors'])
    assert.equal(fs.readFileSync(path.join(folder, 'tested_mmh3-000020.safetensors'), 'utf8'), 'lora 000020', 'copied, not moved')
    assert.ok(fs.existsSync(path.join(loras, 'tested_mmh3-000020.safetensors')))
    assert.deepEqual(r.checkpoints.map((c) => c.lora), ['MiniMax H3\\tested\\tested_mmh3-000010.safetensors', 'MiniMax H3\\tested\\tested_mmh3-000020.safetensors'])
    assert.equal(fake.prompts.length - before, 2, 'one test render for each epoch')
    const queued = graphs(before)
    for (const [k, g] of queued.entries()) assert.ok(JSON.stringify(g).includes(`tested_mmh3-0000${k ? 20 : 10}.safetensors`), 'the LoRA is in the graph')
    assert.deepEqual(r.tests.map((t) => t.epoch), [10, 20])
    assert.match(JSON.stringify(queued[0]), /A medium close-up of \{char\}/)
    assert.deepEqual(readTraining(id).tests.map((t) => t.seed), [4242, 4242], 'the same seed for every checkpoint')
  })

  test('[mcp:test_checkpoints] takes a prompt of the person\'s own and renders only the epochs asked for', async () => {
    fake.setModels({ loras: [] })
    const { id } = await trained('Prompted')
    const prompt = 'integrated_multimodal_description: [Shot 1] {char} laughs. There is no writing anywhere in the picture.\n\noverall_soundscape: Laughter.\n\nnon_diegetic_music: N/A'
    const before = fake.prompts.length
    const r = await ok('test_checkpoints', { trainingId: id, epochs: [20], prompt })
    assert.equal(fake.prompts.length - before, 1)
    assert.ok(JSON.stringify(fake.prompts.at(-1).prompt).includes('laughs'))
    assert.deepEqual(r.tests.map((t) => t.epoch), [20])
    await fails('test_checkpoints', { trainingId: id, epochs: [] }, /epochs/i)
    await fails('test_checkpoints', { trainingId: id, epochs: [10, 20, 30, 40, 50, 60, 70] }, /epochs/i)
    await fails('test_checkpoints', { trainingId: id, epochs: [99] }, /Download some checkpoints first\./)
  })

  test('[mcp:adopt_checkpoint] saves the chosen epoch as a character preset with the face as its picture, and marks the training done', async () => {
    fake.setModels({ loras: [] })
    const { id } = await trained('Adopted')
    await fails('adopt_checkpoint', { trainingId: id, epoch: 20 }, /Download that checkpoint first\./)
    await ok('test_checkpoints', { trainingId: id, epochs: [20] })
    const r = await ok('adopt_checkpoint', { trainingId: id, epoch: 20 })
    assert.equal(r.characterId, 'adopted')
    const t = readTraining(id)
    assert.equal(t.chosenEpoch, 20)
    const { items } = await ok('list_characters')
    const c = items.find((x) => x.id === 'adopted')
    assert.ok(c, 'the preset is in the character list')
    assert.deepEqual([c.name, c.lora, c.strength, c.trigger], ['Adopted', 'MiniMax H3\\adopted\\adopted_mmh3-000020.safetensors', 0.8, t.trigger])
    assert.ok(c.picture && fs.existsSync(c.picture), 'the picked face is the preset\'s picture')
    const step = (await ok('list_character_trainings')).items.find((x) => x.id === id)
    assert.deepEqual([step.step, step.characterId], ['done', 'adopted'])
    await fails('adopt_checkpoint', { trainingId: id, epoch: 10 }, /Download that checkpoint first\./)
  })
})
