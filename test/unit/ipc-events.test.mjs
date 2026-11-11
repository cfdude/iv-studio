// Events the window hears (task 6.4): each is a `send('<channel>', payload)` in src/main/index.js wired to a callback or
// emitter of a service. These tests attach the same hook to the same service in this process, on the fake ComfyUI and
// temp folders, drive it, and check the payload's shape. The event rows that carry a data folder move, a model
// download, a model pull, or a LoRA download are in ipc-data, ipc-hand and ipc-media.
//   node --test test/unit/ipc-events.test.mjs
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import ffmpegStatic from 'ffmpeg-ffprobe-static'
import { EditGen } from '../../src/service/editgen.js'
import { Edits } from '../../src/service/edits.js'
import { Images } from '../../src/service/images.js'
import { Productions } from '../../src/service/productions.js'
import { setOllamaSource } from '../../src/service/prompter.js'
import { Rebuilds } from '../../src/service/rebuild.js'
import { RefMods } from '../../src/service/refmods.js'
import { Remake } from '../../src/service/remake.js'
import { SetupProgress } from '../../src/service/setupprogress.js'
import { Sizzles } from '../../src/service/sizzle.js'
import { Studio } from '../../src/service/studio.js'
import { Trainings } from '../../src/service/training.js'
import { Voices } from '../../src/service/voices.js'
import { startFakeComfy } from '../fakes/comfyui.mjs'
import { startFakeOllama } from '../fakes/outside.mjs'
import { tempDirReal } from '../fakes/tmp.mjs'

const tmp = () => tempDirReal('iv-event-')
const ff = (...args) => execFileSync(ffmpegStatic.ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args])
const resources = path.resolve('resources')
const until = async (done, ms = 3000) => {
  for (let t = 0; t < ms && !done(); t += 10) await new Promise((r) => setTimeout(r, 10))
  assert.ok(done(), 'timed out')
}

describe('events from the services', () => {
  let fake, studio, dir
  before(async () => {
    fake = await startFakeComfy({ devices: 'mps', os: 'darwin' })
    dir = tmp()
    studio = new Studio({ dataDir: dir, resourcesDir: resources, comfyUrl: fake.url })
  })
  after(() => fake.close())

  test('[event:productions:changed] names the film each time its shots are broken down or its script is being written, and not for another film', async () => {
    const seen = []
    const films = new Productions({ dataDir: tmp(), studio: () => ({ characters: () => [] }), onChange: (id) => seen.push(id) })
    const a = films.create({ name: 'First' })
    const b = films.create({ name: 'Second' })
    films.setScript(a.id, 'INT. BUS STOP - NIGHT\n\nA woman waits in the rain.\n')
    assert.deepEqual(seen, [], 'a script alone is saved quietly')
    const started = films.breakDown(a.id)
    assert.equal(started.breakdown.state, 'running')
    assert.deepEqual(seen, [a.id], 'told as soon as the breakdown starts')
    await films.running.get(a.id) // the writer is not there under the guard, so it ends in an error, which is announced too
    assert.ok(seen.length >= 2 && seen.every((id) => id === a.id), `heard ${JSON.stringify(seen)}`)
    assert.ok(!seen.includes(b.id))
    assert.notEqual(films.get(a.id).breakdown.state, 'running', 'and the last one says it has stopped')
  })

  test('[event:training:changed] names the training each time one is made, edited or removed', () => {
    const seen = []
    const trainings = new Trainings({ dataDir: tmp(), resourcesDir: resources, studio, ffmpeg: ffmpegStatic.ffmpegPath, ffprobe: ffmpegStatic.ffprobePath, onChange: (id) => seen.push(id) })
    const t = trainings.create({ name: 'Eventful' })
    assert.deepEqual(seen, [t.id])
    trainings.save(t.id, { consent: true })
    assert.deepEqual(seen, [t.id, t.id])
    assert.ok(seen.every((id) => id === t.id), 'main wraps each as { id }')
  })

  test('[event:cloud:progress] gives the setup view a snapshot at each change: the steps with their state, the overall percent, and a finish that says ok', () => {
    const snaps = []
    const t = new SetupProgress('modal', { onChange: (s) => snaps.push(s) })
    t.changed()
    t.start('token', 'Saving the access token')
    t.start('image', 'Building the image Modal runs ComfyUI in')
    t.update('image', { percent: 40, detail: 'Installing nodes' })
    t.finish()
    assert.ok(snaps.length >= 5)
    const first = snaps[0]
    assert.deepEqual(Object.keys(first).sort(), ['elapsed', 'error', 'finishedAt', 'ok', 'overall', 'provider', 'remaining', 'startedAt', 'steps'])
    assert.equal(first.provider, 'modal')
    assert.ok(first.steps.length >= 4 && first.steps.every((s) => s.id && s.label && s.status === 'waiting'))
    const mid = snaps.find((s) => s.steps.some((x) => x.id === 'image' && x.percent === 40))
    assert.equal(mid.steps.find((x) => x.id === 'token').status, 'done', 'a step before the running one counts as done')
    assert.equal(mid.steps.find((x) => x.id === 'image').detail, 'Installing nodes')
    const last = snaps.at(-1)
    assert.equal(last.ok, true)
    assert.ok(last.finishedAt && last.steps.every((s) => ['done', 'skipped'].includes(s.status)))
    assert.equal(last.overall, 100)
  })

  test('[event:jobs:update] gives the window the job as it stands: still running while ComfyUI holds it, then finished with its outputs, or failed with the reason', async () => {
    const job = async () => (await studio.generatePreviews({ prompt: 'integrated_multimodal_description: [Shot 1] A bus stop.', seeds: [1], mode: 'text' })).id
    fake.holdNextPrompt(1)
    const held = await job()
    const waiting = await studio.refreshJob(held)
    assert.equal(waiting.id, held)
    assert.ok(!['success', 'error', 'cancelled'].includes(waiting.status), `still ${waiting.status}`)
    fake.releaseHeld()
    const ok = await studio.refreshJob(await job())
    assert.equal(ok.status, 'success')
    assert.equal(ok.kind, 'previews')
    assert.ok(Array.isArray(ok.outputs))
    assert.equal('previewPlan' in ok, false, 'the plan goes out trimmed')
    fake.failNextPrompt('node broke')
    const bad = await studio.refreshJob(await job())
    assert.equal(bad.status, 'error')
    assert.match(bad.error, /node broke/)
    assert.throws(() => studio.getJob('nope'), /No job nope/)
  })

  test('[event:jobs:live] passes a live preview step on with the prompt it belongs to, a picture to show, its step and how many there are, and counts the next take when the steps start over', async () => {
    const seen = []
    const stop = studio.watch((msg) => msg.type === 'iv_live' && seen.push(msg.data))
    try {
      const status = []
      const stop2 = studio.watch((msg) => status.push(msg))
      await until(() => (fake.wsSend({ type: 'status', data: {} }), status.length > 0))
      stop2()
      fake.wsSend({ type: 'executing', data: { prompt_id: 'p-live', node: '3' } })
      fake.wsSend({ type: 'kj_preview_override', data: { image: 'AAAA', mime: 'image/jpeg', step: 1, total: 4 } })
      fake.wsSend({ type: 'kj_preview_override', data: { image: 'BBBB', mime: 'image/jpeg', step: 2, total: 4 } })
      fake.wsSend({ type: 'kj_preview_override', data: { image: 'CCCC', mime: 'image/jpeg', step: 1, total: 4 } })
      await until(() => seen.length >= 3)
      assert.deepEqual(seen.map((s) => [s.promptId, s.step, s.total, s.take]), [['p-live', 1, 4, 1], ['p-live', 2, 4, 1], ['p-live', 1, 4, 2]])
      assert.equal(seen[0].image, 'data:image/jpeg;base64,AAAA')
      assert.ok(Number.isFinite(seen[0].at))
    } finally {
      stop()
    }
  })

  test('[event:edits:progress] says how far an export is, from 0 to 1, and ends at 1', async () => {
    const data = tmp()
    const video = path.join(data, 'clip.mp4')
    ff('-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=24:duration=2', '-pix_fmt', 'yuv420p', video)
    const edits = new Edits({ dataDir: data, ffmpeg: ffmpegStatic.ffmpegPath, ffprobe: ffmpegStatic.ffprobePath })
    const e = edits.create('Progress')
    const m = await edits.addMedia(video)
    edits.save(e.id, { media: { [m.id]: m }, clips: [{ id: 'c1', track: 'V1', media: m.id, start: 0, in: 0, out: m.duration || 2, fadeIn: 0, fadeOut: 0, volume: 1, muted: false }] })
    const seen = []
    const out = await edits.export(e.id, path.join(data, 'out'), (p) => seen.push({ id: e.id, progress: p }))
    assert.ok(fs.existsSync(out))
    assert.ok(seen.length >= 1)
    for (const s of seen) assert.ok(s.progress >= 0 && s.progress <= 1, `progress ${s.progress}`)
    assert.ok(seen.at(-1).progress > 0.9, 'it ends near the end')
  })

  test('[event:setup:nodes] says which node pack it is on and the step it is at: copying the one IV Studio ships, and downloading the rest', async () => {
    const steps = []
    const r = await studio.installNodePacks({ folder: null, onProgress: (u) => steps.push(u) })
    try {
      for (const u of steps) assert.ok(u.dir && u.label && u.step, JSON.stringify(u))
      const mine = steps.filter((u) => u.dir === 'ComfyUI-IV-Studio')
      assert.deepEqual(mine.map((u) => u.step), ['copying', 'done'])
      const download = steps.find((u) => u.step === 'downloading')
      assert.match(download.detail, /^(GitHub [0-9a-f]{7}|Comfy Registry .+)$/)
      assert.equal(r.results.find((x) => x.dir === 'ComfyUI-IV-Studio').status, 'installed')
    } finally {
      for (const x of r.results.filter((x) => x.status === 'installed')) fs.rmSync(path.join(r.customNodes, x.dir), { recursive: true, force: true })
    }
  })

  test('[event:setup:updates] reports each phase of a ComfyUI update: snapshot, updating with how many are done, restarting, done', async () => {
    fake.setManager({ downAfterReboot: 1 })
    const steps = []
    // update() leaves a 10 s timer pending after it hears Manager's done message (comfyupdate.js, the race with
    // listener.done; same as fake-comfyui-routes.test.mjs): unref the long ones so this process is not held open
    const realSetTimeout = globalThis.setTimeout
    globalThis.setTimeout = (fn, ms, ...a) => {
      const t = realSetTimeout(fn, ms, ...a)
      if (ms >= 10000) t.unref()
      return t
    }
    let r
    try {
      r = await studio.updateComfy({ folder: null, launcher: null, onProgress: (u) => steps.push(u) })
    } finally {
      globalThis.setTimeout = realSetTimeout
    }
    assert.ok(r.snapshot)
    const phases = steps.map((s) => s.phase)
    assert.equal(phases[0], 'snapshot')
    assert.ok(phases.includes('updating'))
    assert.deepEqual(phases.slice(-2), ['restarting', 'done'])
    const updating = steps.find((s) => s.phase === 'updating')
    assert.ok(Number.isFinite(updating.done) && Number.isFinite(updating.total))
  })
})

describe('events from the editor\'s generations', () => {
  test('[event:editgen:changed] tells the window the edit each time a generation starts or is cancelled, with the gens the page then shows', async () => {
    const fake = await startFakeComfy({ devices: 'cuda', os: 'win32', objectInfo: { DLSS5_Enhance_Video: { input: { required: {} } } } })
    try {
      const data = tmp()
      const clip = path.join(data, 'clip.mp4')
      ff('-f', 'lavfi', '-i', 'testsrc=s=128x72:r=24:d=2', '-f', 'lavfi', '-i', 'sine=f=440:d=2', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', clip)
      const studio = new Studio({ dataDir: data, resourcesDir: resources, comfyUrl: fake.url })
      const edits = new Edits({ dataDir: data, ffmpeg: ffmpegStatic.ffmpegPath, ffprobe: ffmpegStatic.ffprobePath })
      const heard = []
      let gen
      // what main sends: { id, gens: editgen.view(id) }
      gen = new EditGen({ edits, studio: () => studio, localCopy: async (f) => f, onChange: (id) => heard.push({ id, gens: gen.view(id) }) })
      const e = edits.create('Changes')
      const m = await edits.addMedia(clip)
      edits.save(e.id, { media: { [m.id]: m }, clips: [{ id: 'c1', track: 'V1', media: m.id, start: 0, in: 0, out: 2, fadeIn: 0, fadeOut: 0, volume: 1, muted: false }] })
      const started = await gen.start(e.id, { kind: 'extend', clip: 'c1', prompt: 'She keeps walking.', seconds: 5, seed: 8 })
      assert.ok(heard.length >= 1 && heard.every((h) => h.id === e.id))
      assert.deepEqual(heard.at(-1).gens.map((g) => [g.id, g.kind, g.status]), [[started.id, 'extend', 'rendering']])
      const before = heard.length
      await gen.cancel(e.id, started.id)
      assert.ok(heard.length > before, 'told again when it was cancelled')
      assert.deepEqual(heard.at(-1).gens.filter((g) => g.id === started.id), [], 'the generation is off the list the window shows')
    } finally {
      await fake.close()
    }
  })
})

const combo = (name, options) => ({ input: { required: { [name]: [options] } } })

describe('events from RefMod and Remake', () => {
  let dir, fake
  before(() => {
    dir = tmp()
  })
  after(() => fake?.close())

  test('[event:refmods:status] says what the RefMod maker is on, in words: uploading the pictures, then making it', async () => {
    fake = await startFakeComfy({ devices: 'mps', os: 'darwin', objectInfo: { MiniMaxH3RefModMasterExtract: { input: { required: {} } }, VAELoader: combo('vae_name', ['minimax_h3_video_vae_fp16.safetensors']) } })
    const studio = new Studio({ dataDir: dir, resourcesDir: resources, comfyUrl: fake.url })
    const face = path.join(dir, 'face.png')
    ff('-f', 'lavfi', '-i', 'color=c=orange:s=64x64', '-frames:v', '1', face)
    const maker = new RefMods({ studio, dataDir: dir })
    const said = []
    const r = await maker.make({ name: 'Eve Status', pictures: [face], who: 'a woman', consent: true, onStatus: (s) => said.push(s) })
    assert.equal(said[0], 'Uploading the pictures')
    assert.ok(said.includes('Making the RefMod'))
    assert.ok(said.every((x) => typeof x === 'string' && x.length > 0), 'main sends each as it is: a plain string')
    assert.equal(r.character.name, 'Eve Status')
    await assert.rejects(maker.make({ name: 'No Consent', pictures: [face], onStatus: (s) => said.push(s) }), /Tick that these are your own pictures/)
    assert.ok(!said.includes('No Consent'))
  })

  test('[event:remake:progress] says which keyframe is being painted and what it is doing, with the picture it made when it is done', async () => {
    const OBJECT_INFO = { UNETLoader: combo('unet_name', ['Flux2/flux2_klein_9b.safetensors']), CLIPLoader: { input: { required: { clip_name: [['qwen_3_8b.safetensors']], type: [['flux2']] } } }, VAELoader: combo('vae_name', ['flux2-vae.safetensors']) }
    fake.setObjectInfo(OBJECT_INFO)
    const video = path.join(dir, 'man.mp4')
    const face = path.join(dir, 'mia.png')
    const painted = path.join(dir, 'painted.png')
    ff('-f', 'lavfi', '-i', 'testsrc=s=128x72:r=24:d=4', '-f', 'lavfi', '-i', 'sine=f=440:d=4', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', video)
    ff('-f', 'lavfi', '-i', 'color=c=orange:s=64x64', '-frames:v', '1', face)
    ff('-f', 'lavfi', '-i', 'color=c=purple:s=300x200', '-frames:v', '1', painted)
    fake.setOutputs((g) => (Object.values(g).some((n) => n.class_type === 'SaveImage') ? { 11: { images: [{ filename: 'painted.png', subfolder: 'iv_studio/images', type: 'output', fullpath: painted }] } } : undefined))
    const studio = new Studio({ dataDir: dir, resourcesDir: resources, comfyUrl: fake.url })
    const remake = new Remake({ studio, images: new Images({ studio, dataDir: dir }), dataDir: dir, resourcesDir: resources, ffmpeg: ffmpegStatic.ffmpegPath, ffprobe: ffmpegStatic.ffprobePath })
    const s = await remake.prepare({ video, kind: 'swap', section: { start: 0, length: 0 } })
    const seen = []
    // what main sends: { id, ...update }
    await remake.paint(s.id, { who: 'the man', picture: face, name: 'Mia', onProgress: (u) => seen.push({ id: s.id, ...u }) })
    fake.setOutputs(null)
    assert.ok(seen.length >= 2)
    assert.ok(seen.every((u) => u.id === s.id && Number.isInteger(u.frame) && typeof u.step === 'string'), JSON.stringify(seen))
    assert.deepEqual(seen.map((u) => u.step), ['painting', 'painted'])
    assert.equal(seen[0].frame, 12)
    assert.ok(seen.at(-1).file && fs.existsSync(seen.at(-1).file), 'the painted step carries the picture')
  })
})

describe('events from Rebuild and Sizzle', () => {
  test('[event:rebuild:log] says which shot the writer is reading as it goes, one line each', async () => {
    const dir = tmp()
    const ollama = await startFakeOllama({ models: [{ name: 'gemma3:12b', size: 1 }], answer: () => ({ kind: 'live', why: 'Filmed.', description: 'A plain wall.' }) })
    setOllamaSource(() => ollama.url)
    try {
      const jpg = path.join(dir, 'f.jpg')
      ff('-f', 'lavfi', '-i', 'color=c=gray:s=64x36', '-frames:v', '1', jpg)
      const shot = (index, start, end) => ({ index, start, end, duration: end - start, sheet: jpg, first: jpg, last: jpg, middle: jpg, bandTop: [], bandBottom: [], words: '' })
      const lines = []
      const rebuilds = new Rebuilds({ dataDir: dir, writer: () => ({ engine: 'local', model: 'gemma3:12b' }), onLog: (line) => lines.push(line) })
      rebuilds.write({ id: 'rb000001', name: 'Log', status: 'reading', source: { width: 64, height: 36, duration: 5 }, shots: [shot(1, 0, 2), shot(2, 2, 5)], createdAt: new Date().toISOString() })
      const r = await rebuilds.readWithWriter('rb000001')
      assert.deepEqual(lines, ['Reading shot 1…', 'Reading shot 2…'])
      assert.equal(r.status, 'planning', 'every shot read, so it moves on')
      lines.length = 0
      await rebuilds.readWithWriter('rb000001')
      assert.deepEqual(lines, [], 'nothing left to read, nothing said')
    } finally {
      setOllamaSource(() => '')
      await ollama.close()
    }
  })

  test('[event:sizzle:log] says what the sizzle maker is on: speaking the voice-over first, before any picture or render, and then stops on a voice that is not there', async () => {
    const dir = tmp()
    const lines = []
    const voices = new Voices({ dataDir: dir, resourcesDir: resources, ffmpeg: ffmpegStatic.ffmpegPath, onLog: () => {} })
    const sizzles = new Sizzles({ dataDir: dir, studio: {}, music: {}, voices, trainings: {}, shinobi: {}, onLog: (line) => lines.push(line) })
    sizzles.write({ id: 'sz000001', name: 'Log', format: '16:9', status: 'approved', approvedAt: new Date().toISOString(), assets: {}, plan: { scenes: [], voiceover: { voiceId: 'v1', lines: ['Hello there.'] } } })
    await assert.rejects(sizzles.makeAssets('sz000001'), /No voice v1/)
    assert.deepEqual(lines, ['Speaking the voice-over…'])
    sizzles.write({ ...sizzles.get('sz000001'), approvedAt: null })
    await assert.rejects(sizzles.makeAssets('sz000001'), /needs the person's OK first/)
    assert.deepEqual(lines, ['Speaking the voice-over…'], 'an unapproved storyboard says nothing')
  })
})
