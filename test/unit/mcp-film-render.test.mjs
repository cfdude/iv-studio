// MCP film tools that draw and render (task 5.6, part 5): storyboard sketches, faces, place angles, previews for a shot
// or a scene, finishing, the animatic and the rough cut, called through the real MCP server on source under the test
// guard, against the fake ComfyUI (design D1, D8). An NVIDIA fake with Flux.2 Klein, Qwen Image 2.1 and its angles
// LoRA installed and DLSS 5. What a finished prompt saved is set with the fake's setOutputs, because the tools that
// draw wait for their own picture. The brief, script and shot tools are in mcp-film.test.mjs.
//   node --test test/unit/mcp-film-render.test.mjs
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import ffmpegStatic from 'ffmpeg-ffprobe-static'
import { startFakeComfy } from '../fakes/comfyui.mjs'
import { startMcp } from '../fakes/mcp.mjs'

const FLUX2 = 'Flux2/flux2_klein_9b.safetensors'
const QWEN = 'Qwen/qwen-image-2.1-edit.safetensors'
const ANGLES = 'qwen-image-2.1-qma-camera-angles-v1.safetensors'
const combo = (name, options) => ({ input: { required: { [name]: [options] } } })
const OBJECT_INFO = {
  DLSS5_Enhance_Video: { input: { required: {} } },
  UNETLoader: combo('unet_name', [FLUX2, QWEN]),
  CLIPLoader: { input: { required: { clip_name: [['qwen_3_8b.safetensors', 'qwen3vl_8b_int8_convrot.safetensors']], type: [['flux2', 'qwen_image']] } } },
  VAELoader: combo('vae_name', ['flux2-vae.safetensors', 'qwen_image_2.1_vae_bf16.safetensors']),
  LoraLoaderModelOnly: combo('lora_name', [ANGLES])
}
const PROMPT = 'integrated_multimodal_description: [Shot 1] A woman waits at a rainy bus stop.\n\noverall_soundscape: Rain.\n\nnon_diegetic_music: N/A'

describe('MCP film drawing and rendering tools', () => {
  let fake, mcp, picture, take, final
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
  const ff = (...args) => execFileSync(ffmpegStatic.ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args])
  const probe = (file, entries) => execFileSync(ffmpegStatic.ffprobePath, ['-v', 'error', '-show_entries', entries, '-of', 'csv=p=0', file]).toString().trim()
  const lastGraph = () => fake.prompts.at(-1).prompt
  const classes = (g) => Object.values(g).map((n) => n.class_type)
  const gif = (file, subfolder = 'H3/previews') => ({ gifs: [{ filename: path.basename(file), subfolder, type: 'output', fullpath: file }] })
  // what ComfyUI saves for a prompt: a picture for any picture graph, the three takes for a previews graph
  const saves = (g) => (classes(g).includes('SaveImage') ? { 11: { images: [{ filename: path.basename(picture), subfolder: 'iv_studio/images', type: 'output', fullpath: picture }] } } : g['87'] ? { 42: gif(take), 118: gif(take), 128: gif(take) } : undefined)
  // a picture the product keeps in its own folder, a copy of what ComfyUI saved
  const kept = (file) => file.startsWith(dataFile('images') + path.sep) && fs.existsSync(file)
  const view = (filmId) => ok('get_film', { filmId })
  const shotOf = async (filmId, shotId) => (await view(filmId)).scenes.flatMap((s) => s.shots).find((s) => s.id === shotId)
  // a film with one scene and two shots written by hand, both with a prompt, and the ids to talk about them
  const film = async ({ shotSeconds = 4, prompt = PROMPT, extra = {} } = {}) => {
    const f = await ok('create_film', { name: 'Rain Check', script: 'INT. BUS STOP - NIGHT\n\nA woman waits.\n', ...extra })
    const sceneId = f.scenes[0].id
    const a = await ok('edit_film_shot', { filmId: f.id, sceneId, add: true, action: 'A woman waits at the bus stop.', camera: 'Wide', seconds: shotSeconds, prompt })
    const b = await ok('edit_film_shot', { filmId: f.id, sceneId, shotId: a.scenes[0].shots[0].id, add: true, action: 'A bus arrives.', camera: 'Medium', seconds: shotSeconds, prompt })
    return { id: f.id, sceneId, a: b.scenes[0].shots[0].id, b: b.scenes[0].shots[1].id }
  }
  // sets a field of a shot straight in the film's file (a sketch that was drawn, say)
  const patchShot = (filmId, shotId, patch) => {
    const file = dataFile('productions', `${filmId}.json`)
    const p = JSON.parse(fs.readFileSync(file, 'utf8'))
    for (const sc of p.scenes) for (const sh of sc.shots) if (sh.id === shotId) Object.assign(sh, patch)
    fs.writeFileSync(file, JSON.stringify(p))
  }

  before(async () => {
    fake = await startFakeComfy({ devices: 'cuda', os: 'win32', objectInfo: OBJECT_INFO })
    fake.setOutputs(saves)
    mcp = await startMcp({ comfyUrl: fake.url })
    const dir = path.join(path.dirname(mcp.dataDir), 'fixtures')
    fs.mkdirSync(dir, { recursive: true })
    picture = path.join(dir, 'drawn.png')
    take = path.join(dir, 'take.mp4')
    final = path.join(dir, 'final.mp4')
    ff('-f', 'lavfi', '-i', 'color=c=orange:s=128x72', '-frames:v', '1', picture)
    ff('-f', 'lavfi', '-i', 'testsrc=s=128x72:r=24:d=2', '-f', 'lavfi', '-i', 'sine=f=440:d=2', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', take)
    ff('-f', 'lavfi', '-i', 'testsrc2=s=128x72:r=24:d=3', '-f', 'lavfi', '-i', 'sine=f=220:d=3', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', final)
  })
  after(async () => {
    await mcp?.close()
    await fake?.close()
  })
  // ---------- sketch_film_shots ----------
  test('[mcp:sketch_film_shots][ipc:productions:sketch] draws the place first, then a sketch of each shot that keeps the place, and get_film shows each sketch once drawn', async () => {
    const h = await film()
    const before = fake.prompts.length
    const { items } = await ok('sketch_film_shots', { filmId: h.id })
    assert.deepEqual(items.map((i) => i.shot), [h.a, h.b])
    assert.ok(items.every((i) => /^[0-9a-f]{8}$/.test(i.set)))
    assert.equal(fake.prompts.length - before, 3, 'the place, then one picture per shot')
    const v = await view(h.id)
    assert.ok(v.locations[0].pictures.length === 1 && kept(v.locations[0].pictures[0]), 'the place now has a picture')
    assert.deepEqual(v.scenes[0].shots.map((s) => [kept(s.sketch), s.sketchStale]), [[true, false], [true, false]])
    const g = lastGraph()
    assert.ok(classes(g).includes('SaveImage'))
    assert.ok(Object.values(g).some((n) => n.class_type === 'LoadImage'), 'the place picture is a reference for the sketch')
    // shots that have a sketch are left alone; redo draws them again; shotIds draws only those
    const quiet = await ok('sketch_film_shots', { filmId: h.id })
    assert.deepEqual(quiet.items, [])
    const some = await ok('sketch_film_shots', { filmId: h.id, shotIds: [h.b] })
    assert.deepEqual(some.items.map((i) => i.shot), [h.b])
    const again = await ok('sketch_film_shots', { filmId: h.id, redo: true })
    assert.deepEqual(again.items.map((i) => i.shot), [h.a, h.b])
  })

  test('[mcp:sketch_film_shots] refuses when no picture model is installed, and for a film that is not there', async () => {
    const bare = await startFakeComfy({ devices: 'cuda', os: 'win32' })
    const off = await startMcp({ comfyUrl: bare.url })
    try {
      const f = (await off.client.callTool({ name: 'create_film', arguments: { script: 'INT. BUS STOP - NIGHT\n\nA woman waits.\n' } })).structuredContent
      const r = await off.client.callTool({ name: 'sketch_film_shots', arguments: { filmId: f.id } })
      assert.equal(r.isError, true)
      assert.match(r.content[0].text, /Sketches need a picture model\. Set one up in Settings → Setup \(Flux\.2 Klein or Z-Image Turbo\)\./)
      assert.equal(bare.prompts.length, 0)
    } finally {
      await off.close()
      await bare.close()
    }
    await fails('sketch_film_shots', { filmId: 'nope0000' }, /No project nope0000/)
  })

  // ---------- draw_film_face ----------
  test('[mcp:draw_film_face][ipc:productions:drawFace] draws a face for a role no preset plays, keeps it on the cast entry and marks their sketches to redraw', async () => {
    const h = await film()
    await ok('update_film', { filmId: h.id, cast: [{ characterId: null, as: 'Driver', description: 'A tired man in a cap.' }] })
    await ok('edit_film_shot', { filmId: h.id, sceneId: h.sceneId, shotId: h.b, speaker: 'Driver', characters: ['Driver'] })
    patchShot(h.id, h.b, { sketch: picture })
    const before = fake.prompts.length
    const r = await ok('draw_film_face', { filmId: h.id, role: 'Driver' })
    assert.equal(fake.prompts.length, before + 1)
    assert.deepEqual([r.as, r.characterId, kept(r.face), r.description], ['Driver', null, true, 'A tired man in a cap.'])
    assert.equal((await shotOf(h.id, h.b)).sketchStale, true)
    // a face that is already there is kept, and again draws a new one
    await ok('draw_film_face', { filmId: h.id, role: 'driver' })
    assert.equal(fake.prompts.length, before + 1, 'nothing new was drawn')
    await ok('draw_film_face', { filmId: h.id, role: 'Driver', again: true })
    assert.equal(fake.prompts.length, before + 2)
    assert.equal((await view(h.id)).cast.filter((c) => !c.characterId).length, 1)
  })

  test('[mcp:draw_film_face] refuses when no picture model is installed', async () => {
    const bare = await startFakeComfy({ devices: 'cuda', os: 'win32' })
    const off = await startMcp({ comfyUrl: bare.url })
    try {
      const f = (await off.client.callTool({ name: 'create_film', arguments: {} })).structuredContent
      const r = await off.client.callTool({ name: 'draw_film_face', arguments: { filmId: f.id, role: 'Driver' } })
      assert.equal(r.isError, true)
      assert.match(r.content[0].text, /Faces need a picture model/)
    } finally {
      await off.close()
      await bare.close()
    }
  })

  // ---------- draw_place_angles ----------
  test('[mcp:draw_place_angles][ipc:productions:drawAngles] draws the views asked for from the place\'s photo with the camera angles LoRA and keeps them on the place', async () => {
    const h = await film()
    const f = await ok('update_film', { filmId: h.id, locations: [{ name: 'Bus Stop', description: 'A glass shelter.', pictures: [picture] }] })
    const loc = f.locations[0]
    const before = fake.prompts.length
    const r = await ok('draw_place_angles', { filmId: h.id, locationId: loc.id, views: ['wide', 'side'] })
    assert.equal(fake.prompts.length - before, 2, 'one picture a view')
    assert.deepEqual(r.angles.map((a) => [a.view, kept(a.file), a.from]), [['wide', true, picture], ['side', true, picture]])
    const g = lastGraph()
    assert.ok(Object.values(g).some((n) => n.class_type === 'LoraLoaderModelOnly' && n.inputs.lora_name === ANGLES && n.inputs.strength_model === 1))
    // asking for one again replaces that view and keeps the others; with no views every view is drawn
    const again = await ok('draw_place_angles', { filmId: h.id, locationId: loc.id, views: ['wide'] })
    assert.deepEqual(again.angles.map((a) => a.view).sort(), ['side', 'wide'])
    const all = await ok('draw_place_angles', { filmId: h.id, locationId: loc.id })
    assert.deepEqual(all.angles.map((a) => a.view).sort(), ['quarter', 'side', 'wide'])
    assert.deepEqual((await view(h.id)).locations[0].angles.length, 3)
  })

  test('[mcp:draw_place_angles] refuses a place that is not there and one with no photo', async () => {
    const h = await film()
    const f = await ok('update_film', { filmId: h.id, locations: [{ name: 'Empty', description: '' }] })
    await fails('draw_place_angles', { filmId: h.id, locationId: 'noloc0' }, /No such place\./)
    await fails('draw_place_angles', { filmId: h.id, locationId: f.locations[0].id }, /Add or draw a photo of the place first; the angles are drawn from it\./)
    await fails('draw_place_angles', { filmId: h.id, locationId: f.locations[0].id, views: ['behind'] }, /views/i)
  })

  // ---------- render_film_shot ----------
  test('[mcp:render_film_shot][ipc:productions:render] hunts three previews for a shot with no sketch from its prompt, in a shot project of its own', async () => {
    const h = await film()
    const job = await ok('render_film_shot', { filmId: h.id, shotId: h.a, seed: 5 })
    assert.equal(job.kind, 'previews')
    assert.deepEqual([job.plan.request.mode, job.plan.resolved.previews, job.plan.request.aspect, job.plan.request.seconds, job.plan.request.seed], ['text', 3, '16:9', 4, 5])
    assert.match(job.plan.request.prompt, /A woman waits at a rainy bus stop/)
    assert.match(job.plan.request.prompt, /nobody speaks/i, 'a shot with no line is told so')
    const sh = await shotOf(h.id, h.a)
    assert.equal(sh.projectId, job.projectId)
    assert.equal(sh.filmedFrom, 'prompt')
    assert.equal(readData('projects', `${job.projectId}.json`).name, 'Rain Check · Bus Stop · 1')
    // the shot is its own shot in Shots, and its state follows the job
    assert.equal(sh.state.status, 'pick')
    assert.deepEqual(sh.state.candidates.map((c) => [c.n, c.path]), [[1, take], [2, take], [3, take]])
    // a second hunt reuses the shot's project
    const again = await ok('render_film_shot', { filmId: h.id, shotId: h.a, previews: 1 })
    assert.equal(again.projectId, job.projectId)
    assert.equal(again.plan.resolved.previews, 1)
  })

  test('[mcp:render_film_shot] opens on the shot\'s sketch in Frames mode, with the place picture as a second reference, unless asked not to', async () => {
    const h = await film()
    const f = await ok('update_film', { filmId: h.id, locations: [{ name: 'Bus Stop', description: 'A shelter.', pictures: [picture] }] })
    assert.equal(f.locations.length, 1)
    patchShot(h.id, h.a, { sketch: picture })
    const room = await ok('render_film_shot', { filmId: h.id, shotId: h.a })
    assert.equal(room.plan.request.mode, 'reference', 'a place picture keeps the room the same')
    assert.equal(room.plan.request.media.length, 2)
    assert.match(room.plan.request.prompt, /<Picture 1>/)
    const flat = await ok('render_film_shot', { filmId: h.id, shotId: h.a, room: false })
    assert.equal(flat.plan.request.mode, 'frames')
    assert.equal(flat.plan.request.media.length, 1)
    assert.equal((await shotOf(h.id, h.a)).filmedFrom, 'sketch')
    const prompt = await ok('render_film_shot', { filmId: h.id, shotId: h.a, fromSketch: false })
    assert.equal(prompt.plan.request.mode, 'text')
    assert.equal((await shotOf(h.id, h.a)).filmedFrom, 'prompt')
  })

  test('[mcp:render_film_shot] refuses a shot with no prompt, a shot that is not there and a shot that continues from one not filmed yet', async () => {
    const h = await film({ prompt: '' })
    const queued = fake.prompts.length
    await fails('render_film_shot', { filmId: h.id, shotId: h.a }, /This shot has no prompt yet\. Write it first\./)
    await fails('render_film_shot', { filmId: h.id, shotId: 'noshot' }, /No shot noshot\./)
    await ok('edit_film_shot', { filmId: h.id, sceneId: h.sceneId, shotId: h.b, prompt: PROMPT, continues: true })
    await fails('render_film_shot', { filmId: h.id, shotId: h.b }, /Film shot 1 first: shot 2 carries straight on from its take\./)
    await fails('render_film_shot', { filmId: h.id, shotId: h.a, previews: 4 }, /previews/i)
    assert.equal(fake.prompts.length, queued)
  })

  // ---------- render_film_scene ----------
  test('[mcp:render_film_scene][ipc:productions:renderScene] hunts previews for every shot in the scene that has a prompt and nothing rendered, and leaves the rest', async () => {
    const h = await film()
    await ok('edit_film_shot', { filmId: h.id, sceneId: h.sceneId, add: true, action: 'No prompt yet.' })
    const before = fake.prompts.length
    const { items } = await ok('render_film_scene', { filmId: h.id, sceneId: h.sceneId, previews: 2 })
    assert.equal(items.length, 2, 'the third shot has no prompt')
    assert.deepEqual(items.map((j) => j.plan.resolved.previews), [2, 2])
    assert.equal(fake.prompts.length - before, 2)
    assert.deepEqual((await view(h.id)).scenes[0].shots.map((s) => s.state.status), ['pick', 'pick', 'draft'])
    assert.deepEqual((await ok('render_film_scene', { filmId: h.id })).items, [], 'with no scene it does the whole film, and everything is already rendered')
    await fails('render_film_scene', { filmId: h.id, sceneId: 'nosc00' }, /No such scene\./)
  })

  test('[mcp:render_film_scene] holds a continuing shot back until the shot before it has a take', async () => {
    const h = await film()
    await ok('edit_film_shot', { filmId: h.id, sceneId: h.sceneId, shotId: h.b, continues: true })
    const { items } = await ok('render_film_scene', { filmId: h.id, sceneId: h.sceneId })
    assert.equal(items.length, 1, 'only the first shot')
    assert.equal((await shotOf(h.id, h.b)).state.status, 'ready')
    await view(h.id)
    const next = await ok('render_film_scene', { filmId: h.id })
    assert.equal(next.items.length, 1, 'now the first shot has takes to carry on from')
    assert.equal(next.items[0].plan.request.mode, 'continue')
    assert.equal(next.items[0].plan.request.media[0].kind, 'video')
  })

  // ---------- finish_film_shot ----------
  test('[mcp:finish_film_shot][ipc:productions:finish] finishes the chosen take of the latest hunt at 2 MP and the finished video becomes the shot\'s final', async () => {
    const h = await film()
    await ok('render_film_shot', { filmId: h.id, shotId: h.a })
    await view(h.id)
    fake.holdNextPrompt(1)
    const job = await ok('finish_film_shot', { filmId: h.id, shotId: h.a, candidate: 2 })
    assert.equal(job.kind, 'finish')
    assert.deepEqual([job.plan.finish.candidate, job.plan.finish.megapixels, job.plan.finish.upscale2x], [2, 2, false])
    const sh = await shotOf(h.id, h.a)
    assert.equal(sh.state.finishJob, job.id)
    assert.equal(sh.state.picked, 2)
    fake.releaseHeld()
    fake.state.history[job.promptId].outputs = { 51: { text: [final] } }
    const done = await shotOf(h.id, h.a)
    assert.deepEqual([done.state.status, done.state.final.path], ['finished', final])
    const big = await ok('finish_film_shot', { filmId: h.id, shotId: h.a, candidate: 1, megapixels: 1, upscale2x: true })
    assert.deepEqual([big.plan.finish.megapixels, big.plan.finish.upscale2x], [1, true])
  })

  test('[mcp:finish_film_shot] refuses a shot whose previews have not been hunted or have not finished, and a take outside 1 to 3', async () => {
    const h = await film()
    await fails('finish_film_shot', { filmId: h.id, shotId: h.a, candidate: 1 }, /Render its previews first\./)
    fake.holdNextPrompt(1)
    await ok('render_film_shot', { filmId: h.id, shotId: h.a })
    await fails('finish_film_shot', { filmId: h.id, shotId: h.a, candidate: 1 }, /Render its previews first\./)
    fake.releaseHeld()
    await fails('finish_film_shot', { filmId: h.id, shotId: h.a, candidate: 4 }, /candidate/i)
    await fails('finish_film_shot', { filmId: h.id, shotId: 'noshot', candidate: 1 }, /No shot noshot\./)
  })

  // ---------- make_animatic ----------
  test('[mcp:make_animatic][ipc:productions:animatic] plays the storyboard as a film, each sketch held for its shot with a card for a shot without one, and keeps it on the film', async () => {
    const h = await film({ shotSeconds: 1 })
    patchShot(h.id, h.a, { sketch: picture })
    const r = await ok('make_animatic', { filmId: h.id })
    assert.deepEqual([r.shots, r.sketched, r.voiced, r.seconds], [2, 1, 0, 2])
    assert.ok(r.file.startsWith(dataFile('productions', 'animatics')) && r.file.endsWith('.mp4'), r.file)
    assert.equal(probe(r.file, 'stream=width,height').split('\n')[0], '1280,720')
    assert.ok(Math.abs(Number(probe(r.file, 'format=duration')) - 2) < 0.2)
    assert.equal(probe(r.file, 'stream=codec_name').split('\n').sort().join(), 'aac,h264')
    assert.equal(r.plan.length, 2)
    assert.equal((await view(h.id)).animatic.file, r.file, 'kept on the film')
  })

  test('[mcp:make_animatic] is vertical for a vertical film, and refuses a film with no shots', async () => {
    const empty = await ok('create_film', { script: 'INT. BUS STOP - NIGHT\n\nA woman waits.\n' })
    await fails('make_animatic', { filmId: empty.id }, /Plan the storyboard first\./)
    const h = await film({ shotSeconds: 1, extra: { aspect: '9:16' } })
    const r = await ok('make_animatic', { filmId: h.id, voice: true })
    assert.equal(probe(r.file, 'stream=width,height').split('\n')[0], '720,1280')
    assert.equal(r.voiced, 0, 'no shot has a voice to say its line with')
    await fails('make_animatic', { filmId: 'nope0000' }, /No project nope0000/)
  })

  // ---------- build_rough_cut ----------
  test('[mcp:build_rough_cut][ipc:productions:roughCut] puts the shots on V1 in script order in an edit of the film\'s own, and says which have nothing to show yet', async () => {
    const h = await film()
    await ok('render_film_shot', { filmId: h.id, shotId: h.a })
    await view(h.id)
    const r = await ok('build_rough_cut', { filmId: h.id })
    assert.deepEqual([r.placed, r.missing.length, r.seconds], [1, 1, 2])
    assert.deepEqual(r.missing[0], { scene: 'INT. BUS STOP - NIGHT', shot: h.b, status: 'ready' })
    const e = await ok('get_edit', { editId: r.editId })
    assert.equal(e.name, 'Rain Check · rough cut')
    assert.deepEqual(e.settings, { format: '1080p', fps: 24 })
    assert.deepEqual(e.tracks.V1.map((c) => [c.name, c.start, c.end]), [['take.mp4', 0, 2]], 'the first preview stands in until the person picks one')
    assert.equal((await view(h.id)).editId, r.editId)
  })

  test('[mcp:build_rough_cut] rebuilds V1 in the same edit with the finished take where there is one, and leaves other tracks alone', async () => {
    const h = await film()
    await ok('render_film_shot', { filmId: h.id, shotId: h.a })
    await ok('render_film_shot', { filmId: h.id, shotId: h.b })
    await view(h.id)
    const first = await ok('build_rough_cut', { filmId: h.id })
    assert.deepEqual([first.placed, first.missing], [2, []])
    await ok('edit_timeline', { editId: first.editId, ops: [{ op: 'add_title', content: 'Rain Check', start: 0, duration: 2 }] })
    const fin = await ok('finish_film_shot', { filmId: h.id, shotId: h.a, candidate: 1 })
    fake.state.history[fin.promptId].outputs = { 51: { text: [final] } }
    const again = await ok('build_rough_cut', { filmId: h.id })
    assert.equal(again.editId, first.editId, 'the same edit')
    assert.equal(again.seconds, 5, 'the 3 s final and the 2 s preview')
    const e = await ok('get_edit', { editId: again.editId })
    assert.deepEqual(e.tracks.V1.map((c) => [c.name, c.start, c.end]), [['final.mp4', 0, 3], ['take.mp4', 3, 5]])
    assert.equal(e.tracks.T1.length, 1, 'the title is still there')
    await fails('build_rough_cut', { filmId: 'nope0000' }, /No project nope0000/)
  })
})
