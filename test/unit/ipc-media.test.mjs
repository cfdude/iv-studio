// Window channels for voices, LoRAs and the editor whose service method no MCP tool reaches (task 6.2). Each test
// calls the service method the channel's one-line handler calls (src/main/index.js; test/unit/ipc-map.mjs), in this
// process, with the fake ComfyUI and Civitai. The channels that share a method with an MCP tool carry their id in
// that tool's test name instead.
//   node --test test/unit/ipc-media.test.mjs
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import ffmpegStatic from 'ffmpeg-ffprobe-static'
import { Civitai, CIVITAI_SITES } from '../../src/service/civitai.js'
import { Comfy } from '../../src/service/comfy.js'
import { EditGen } from '../../src/service/editgen.js'
import { Edits } from '../../src/service/edits.js'
import { Voices } from '../../src/service/voices.js'
import { startFakeComfy } from '../fakes/comfyui.mjs'
import { CIVITAI_FILE_BYTES, startFakeCivitai } from '../fakes/outside.mjs'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'iv-ipc-'))
const ff = (...args) => execFileSync(ffmpegStatic.ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args])

describe('window channels: voices', () => {
  test('[ipc:voices:transcribe] converts the recording, asks the engine, and without the voice engine says to set up voices and leaves no temp file', async () => {
    const dir = tmp()
    const wav = path.join(dir, 'hello.wav')
    ff('-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', wav)
    const voices = new Voices({ dataDir: path.join(dir, 'data'), resourcesDir: path.resolve('resources'), ffmpeg: ffmpegStatic.ffmpegPath, onLog: () => {} })
    const leftovers = () => fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('ivs-asr-'))
    const before = leftovers()
    await assert.rejects(() => voices.transcribe(wav), /Set up voices first/)
    assert.deepEqual(leftovers(), before, 'the 16 kHz copy is removed even when the engine is not there')
    await assert.rejects(() => voices.transcribe(path.join(dir, 'gone.wav')), /gone\.wav|No such file|Invalid argument/)
  })
})

describe('window channels: LoRAs from Civitai', () => {
  const sites = { ...CIVITAI_SITES }
  let comfy, civitai, fake, dir
  before(async () => {
    comfy = await startFakeComfy({ devices: 'mps', os: 'darwin', models: { loras: [] } })
    fake = await startFakeCivitai()
    dir = tmp()
    CIVITAI_SITES.safe = fake.url
    CIVITAI_SITES.mature = fake.url
    civitai = new Civitai({ dataDir: dir, comfy: new Comfy(comfy.url), key: () => 'test-key' })
  })
  after(async () => {
    Object.assign(CIVITAI_SITES, sites)
    await fake.close()
    await comfy.close()
  })

  test('[ipc:loras:downloads] is empty before anything is downloaded, then tells each version the progress and file of its download', async () => {
    assert.deepEqual(civitai.downloadState(), {})
    const done = await civitai.download({ modelId: 101, versionId: 2001 })
    const state = civitai.downloadState()
    assert.deepEqual(Object.keys(state), ['2001'])
    assert.equal(state[2001].status, 'done')
    assert.equal(state[2001].received, CIVITAI_FILE_BYTES.length)
    assert.equal(state[2001].name, 'Fake Neon Street')
    assert.ok(fs.existsSync(state[2001].path), 'the file is where the state says')
    assert.ok(state[2001].path.startsWith(comfy.dataDir), "under the fake ComfyUI's models folder")
    assert.equal(done.lora, state[2001].lora)
  })

  test('[ipc:loras:prefs] keeps favourite, strength, trigger words, auto-trigger and picture for a LoRA, merges later changes and ignores other keys', () => {
    const name = 'Civitai/neon/neon.safetensors'
    assert.deepEqual(civitai.setPrefs(name, { favourite: true, strength: 0.7, junk: 'no' }), { favourite: true, strength: 0.7 })
    assert.deepEqual(civitai.setPrefs(name, { strength: 0.5, triggers: 'neonstreet', autoTrigger: false }), { favourite: true, strength: 0.5, triggers: 'neonstreet', autoTrigger: false })
    assert.deepEqual(civitai.library().prefs[name], { favourite: true, strength: 0.5, triggers: 'neonstreet', autoTrigger: false }, 'saved in the library file')
    assert.deepEqual(new Civitai({ dataDir: dir, comfy: new Comfy(comfy.url) }).library().prefs[name].triggers, 'neonstreet', 'a new Civitai on the same folder sees it')
    assert.deepEqual(civitai.setPrefs('other.safetensors', {}), {}, 'another LoRA starts with none')
  })
})

describe('window channels: editor', () => {
  let dir, edits, video, sound
  before(() => {
    dir = tmp()
    video = path.join(dir, 'clip.mp4')
    sound = path.join(dir, 'tone.wav')
    ff('-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=24:duration=3', '-pix_fmt', 'yuv420p', video)
    ff('-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', sound)
    edits = new Edits({ dataDir: dir, ffmpeg: ffmpegStatic.ffmpegPath, ffprobe: ffmpegStatic.ffprobePath })
  })

  test('[ipc:edits:filmstrip] makes one strip picture of small frames for the clip and reuses it the next time', async () => {
    const strip = await edits.filmstrip(video, 3)
    assert.deepEqual([strip.w, strip.h, strip.every, strip.count], [96, 54, 0.5, 6])
    assert.ok(fs.existsSync(strip.file) && strip.file.endsWith('.jpg'))
    const first = fs.statSync(strip.file).mtimeMs
    const again = await edits.filmstrip(video, 3)
    assert.equal(again.file, strip.file)
    assert.equal(fs.statSync(again.file).mtimeMs, first, 'the picture is not made again')
    const longer = await edits.filmstrip(video, 120)
    assert.equal(longer.count, 120, 'a long clip gets about 120 frames')
    assert.notEqual(longer.file, strip.file)
  })

  test('[ipc:edits:peaks] gives a loudness value for every 10 ms, loud for a tone and zero for silence, and keeps them for the next call', async () => {
    const r = await edits.peaks(sound)
    assert.equal(r.rate, 100)
    assert.ok(Math.abs(r.peaks.length - 200) <= 2, `about 200 peaks for 2 s, got ${r.peaks.length}`)
    assert.ok(Math.max(...r.peaks) > 60, 'a tone is loud')
    const quiet = path.join(dir, 'quiet.wav')
    ff('-f', 'lavfi', '-i', 'anullsrc=r=8000:cl=mono', '-t', '1', quiet)
    assert.equal(Math.max(...(await edits.peaks(quiet)).peaks), 0, 'silence is zero')
    assert.deepEqual((await edits.peaks(sound)).peaks, r.peaks, 'the same answer from the saved copy')
  })

  test('[ipc:editgen:prepare] tells the dialog the clip\'s shape and, for a bridge, the last frame of this clip and the first of the next', async () => {
    const gen = new EditGen({ edits, studio: () => ({ dataDir: dir }), localCopy: async (f) => f })
    const e = edits.create('Prepare')
    const media = await edits.addMedia(video)
    const clips = [
      { id: 'c1', track: 'V1', media: media.id, start: 0, in: 0, out: 3, volume: 1 },
      { id: 'c2', track: 'V1', media: media.id, start: 3, in: 0, out: 3, volume: 1 }
    ]
    edits.save(e.id, { media: { [media.id]: media }, clips })
    const extend = await gen.prepare(e.id, { kind: 'extend', clip: 'c1' })
    assert.equal(extend.aspect, '16:9', 'a 320x180 clip is 16:9')
    assert.equal(extend.origin, null, 'not made by IV Studio, so no request to start from')
    assert.equal(extend.first, undefined)
    const bridge = await gen.prepare(e.id, { kind: 'bridge', clip: 'c1', next: 'c2' })
    for (const f of [bridge.first, bridge.last]) assert.ok(fs.existsSync(f) && f.endsWith('.png'), `${f} is a frame picture`)
    assert.notEqual(bridge.first, bridge.last)
    await assert.rejects(() => gen.prepare(e.id, { kind: 'extend', clip: 'nope' }), /Pick a video clip\./)
  })
})
