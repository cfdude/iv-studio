// Window channels new in upstream v1.1.3 for clip effects, sounds, picture tools, the Recommended LoRAs shelf, turnaround
// sheets, Library descriptions, soft mouth, the editor hand-off and Seedance prices. Each test runs the service call the
// channel's handler in src/main/index.js makes, in this process, on the fake ComfyUI, the fake Ollama or a loopback
// stand-in, on temp folders and the bundled ffmpeg. Where the handler is more than one line, the test carries a copy of
// its glue and pins the copy to main's source (test/unit/main-source.mjs), so changing the handler fails the test.
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/fakes/guard.mjs --test test/unit/ipc-v113-media.test.mjs
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import ffmpegStatic from 'ffmpeg-ffprobe-static'
import { Comfy } from '../../src/service/comfy.js'
import { Describer } from '../../src/service/describe.js'
import { Edits } from '../../src/service/edits.js'
import { CLIP_FX, FreefieldApps, loadApp, offeredFx, withoutPromptWriter } from '../../src/service/freefield.js'
import { Images } from '../../src/service/images.js'
import { exportInterchange } from '../../src/service/interchange.js'
import { MediaTools } from '../../src/service/media.js'
import { ModelInstaller } from '../../src/service/models.js'
import { setOllamaSource } from '../../src/service/prompter.js'
import { cleanStretchFile } from '../../src/service/ranking.js'
import { RECOMMENDED, recommendedManifest, recommendedOnDisk } from '../../src/service/recommended.js'
import { SOUND_ENGINE, SOUND_KINDS, SOUND_LIMITS, Sounds } from '../../src/service/sounds.js'
import { SoftMouth } from '../../src/service/softmouth.js'
import { Studio } from '../../src/service/studio.js'
import { TURNAROUND_LORA, Turnarounds } from '../../src/service/turnaround.js'
import { startFakeComfy } from '../fakes/comfyui.mjs'
import { startFakeOllama } from '../fakes/outside.mjs'
import { registerPort, unregisterPort } from '../fakes/ports.mjs'
import { tempDirReal } from '../fakes/tmp.mjs'
import { assertCopiesMain, assertHandlerNames, assertMainSends } from './main-source.mjs'

const tmp = () => tempDirReal('iv-v113-')
const resources = path.resolve('resources')
const ffmpeg = ffmpegStatic.ffmpegPath
const ffprobe = ffmpegStatic.ffprobePath
const ff = (...args) => execFileSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', ...args])
const node = (required = {}) => ({ input: { required } })
const combo = (name, options) => node({ [name]: [options] })
const PARTNER = JSON.parse(fs.readFileSync(new URL('../fixtures/partner-info.json', import.meta.url), 'utf8'))

// a loopback stand-in HTTP server the guard lets the code reach
async function serve(handler) {
  const server = http.createServer(handler)
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const { port } = server.address()
  registerPort(port)
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve) => {
        unregisterPort(port)
        server.closeAllConnections?.()
        server.close(() => resolve())
      })
  }
}

// every node class a graph names, with no combo lists: ComfyUI "has" the nodes and the model files are not checked
const classesOf = (graph) => Object.fromEntries([...new Set(Object.values(graph).map((n) => n.class_type))].map((c) => [c, node()]))

describe('window channels: clip effects', () => {
  let fake, dir, studio, clipfx, edits, clip, still, saves
  const sent = []
  const send = (channel, payload) => sent.push([channel, payload])
  // what ComfyUI saved: one mp4 per SaveVideo node of the graph
  const savesEveryNode = () =>
    fake.setOutputs((prompt) => {
      const out = {}
      for (const [id, n] of Object.entries(prompt)) {
        if (n.class_type === 'SaveVideo') {
          const f = path.join(dir, `saved${++saves}.mp4`)
          ff('-f', 'lavfi', '-i', 'color=c=blue:s=64x64:d=1', '-pix_fmt', 'yuv420p', f)
          out[id] = { videos: [{ filename: path.basename(f), subfolder: 'iv_studio/clipfx', type: 'output', fullpath: f }] }
        }
      }
      return out
    })
  const withInfo = async (info, fn) => {
    fake.setObjectInfo(info)
    try {
      return await fn()
    } finally {
      fake.setObjectInfo({})
      fake.setOutputs(null)
    }
  }
  // main's clipStretch, copied: a clip's own stretch (the edit's in point and length) as its own file, made once
  const clipStretch = async (file, start, length) => {
    if (!length || /\.(png|jpe?g|webp|bmp)$/i.test(file)) return file
    const folder = path.join(dir, 'data', 'clipfx', '_sources')
    fs.mkdirSync(folder, { recursive: true })
    const src = path.join(folder, `${path.basename(file).replace(/\.[^.]+$/, '')}_${Math.round((start || 0) * 1000)}_${Math.round(length * 1000)}.mp4`)
    if (!fs.existsSync(src)) await edits.run(['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(start || 0), '-i', file, '-t', String(length), '-c:v', 'libx264', '-crf', '14', '-preset', 'fast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', src])
    return src
  }

  before(async () => {
    fake = await startFakeComfy({ devices: 'mps', os: 'darwin' })
    dir = tmp()
    studio = new Studio({ dataDir: path.join(dir, 'data'), resourcesDir: resources, comfyUrl: fake.url })
    clipfx = new FreefieldApps({ resourcesDir: resources, dataDir: path.join(dir, 'data'), studio: () => studio })
    edits = new Edits({ dataDir: path.join(dir, 'data'), ffmpeg, ffprobe })
    saves = 0
    clip = path.join(dir, 'walk.mp4')
    still = path.join(dir, 'fox.png')
    ff('-f', 'lavfi', '-i', 'color=c=red:s=64x64:r=24:d=2', '-pix_fmt', 'yuv420p', clip)
    ff('-f', 'lavfi', '-i', 'color=c=orange:s=64x64', '-frames:v', '1', still)
  })
  after(() => fake.close())

  test('[ipc:clipfx:meta] gives one effect\'s inputs, outputs and models when asked for it, all ten offered effects when not, and names the choices for one that is unknown', () => {
    assertCopiesMain(assert, 'clipfx:meta', '(fx) => (fx ? clipfx.meta(fx) : offeredFx().map((k) => clipfx.meta(k)))')
    const meta = (fx) => (fx ? clipfx.meta(fx) : offeredFx().map((k) => clipfx.meta(k)))
    const one = meta('removebg')
    assert.deepEqual([one.fx, one.app, one.media, one.label], ['removebg', 'video-remove-bg', 'video', 'Remove background'])
    assert.deepEqual(one.inputs.map((i) => [i.id, i.type]), [['clip', 'video'], ['background', 'select'], ['seconds', 'slider']])
    assert.deepEqual(one.outputs.map((o) => o.label), ['Cutout', 'Matte'])
    const all = meta()
    assert.deepEqual(all.map((m) => m.fx), ['dub', 'cleanplate', 'night', 'water', 'hdr', 'removebg', 'smooth', 'effects', 'morph', 'transitions'])
    assert.ok(!all.some((m) => m.fx === 'reshoot'), 'New angle is left out of the list')
    assert.throws(() => meta('nonsense'), /^Error: Unknown effect "nonsense"\. One of: reshoot, dub/)
  })

  test('[ipc:clipfx:status] says what each effect lacks on a bare ComfyUI, one effect or all of them, and ready once ComfyUI has its nodes', async () => {
    assertCopiesMain(assert, 'clipfx:status', '(fx) => (fx ? clipfx.status(fx) : clipfx.statusAll())')
    const status = (fx) => (fx ? clipfx.status(fx) : clipfx.statusAll())
    const one = await status('removebg')
    assert.equal(one.ready, false)
    assert.ok(one.missingNodes.includes('LoadBackgroundRemovalModel'))
    const all = await status()
    assert.deepEqual(Object.keys(all), offeredFx())
    assert.ok(Object.values(all).every((s) => s.ready === false && s.missingNodes.length > 0))
    await withInfo(classesOf(withoutPromptWriter(loadApp(resources, CLIP_FX.removebg.app).graph)), async () => {
      const ready = await status('removebg')
      assert.deepEqual([ready.ready, ready.missingNodes, ready.missingModels], [true, [], []])
    })
  })

  test('[ipc:clipfx:run][event:clipfx:progress] cuts the clip\'s own stretch out first, runs the effect on it, adds the result to the edit\'s media and tells the window the job status as it goes', async () => {
    assertCopiesMain(assert, 'clipfx:run', `const src = await clipStretch(file, start, length)
    const r = await clipfx.run({ fx, file: src, last, values, camera, size, name, onProgress: (j) => send('clipfx:progress', { fx, status: j.status, progress: j.progress }) })
    const main = r.files.find((f) => f.kind === 'video') || r.files[0]
    return { ...r, media: main ? await edits.addMedia(main.file, { type: 'clipfx', fx, from: file, label: r.title }) : null }`)
    assertMainSends(assert, `const clipStretch = async (file, start, length) => {
    if (!length || /\\.(png|jpe?g|webp|bmp)$/i.test(file)) return file
    const dir = path.join(DATA, 'clipfx', '_sources')
    fs.mkdirSync(dir, { recursive: true })
    const src = path.join(dir, \`\${path.basename(file).replace(/\\.[^.]+$/, '')}_\${Math.round((start || 0) * 1000)}_\${Math.round(length * 1000)}.mp4\`)
    if (!fs.existsSync(src)) await edits.run(['-y', '-hide_banner', '-loglevel', 'error', '-ss', String(start || 0), '-i', file, '-t', String(length), '-c:v', 'libx264', '-crf', '14', '-preset', 'fast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', src])
    return src
  }`)
    await withInfo(classesOf(withoutPromptWriter(loadApp(resources, CLIP_FX.removebg.app).graph)), async () => {
      savesEveryNode()
      sent.length = 0
      const uploads = fake.uploads.length
      const [fx, file, last, start, length, values, camera, size, name] = ['removebg', clip, null, 0.5, 1, { background: 'white', seconds: 5 }, null, null, 'Cutout of the walk']
      const src = await clipStretch(file, start, length)
      const r = await clipfx.run({ fx, file: src, last, values, camera, size, name, onProgress: (j) => send('clipfx:progress', { fx, status: j.status, progress: j.progress }) })
      const main = r.files.find((f) => f.kind === 'video') || r.files[0]
      const done = { ...r, media: main ? await edits.addMedia(main.file, { type: 'clipfx', fx, from: file, label: r.title }) : null }
      assert.match(path.basename(src), /^walk_500_1000\.mp4$/)
      assert.equal(execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src]).toString().trim().startsWith('1.0'), true, 'one second of the clip')
      assert.deepEqual(fake.uploads.slice(uploads).map((u) => [u.name, u.subfolder]), [['walk_500_1000.mp4', 'iv_studio/clipfx']], 'the effect saw only the stretch')
      assert.deepEqual([done.fx, done.title], ['removebg', 'Cutout of the walk'])
      assert.deepEqual(done.files.map((f) => f.label), ['Cutout', 'Matte'])
      assert.equal(done.media.path, done.files[0].file, 'the main video is what joins the edit')
      assert.equal(done.media.kind, 'video')
      assert.ok(sent.length >= 1 && sent.every(([c, p]) => c === 'clipfx:progress' && p.fx === 'removebg' && !('preview' in p) && p.status === 'success'), JSON.stringify(sent))
      assert.equal((await clipStretch(file, start, length)), src, 'the same stretch is made once')
      assert.equal(await clipStretch(still, 0, 1), still, 'a picture is used as it is')
      assert.equal(await clipStretch(clip, 0, null), clip, 'no length means the whole clip')
    })
  })

  test('[ipc:clipfx:runs][ipc:clipfx:deleteRun] lists the runs newest first with their files, deletes one with its files and keeps the others, and names a run that is not there', async () => {
    assertCopiesMain(assert, 'clipfx:runs', '() => clipfx.runs()')
    assertCopiesMain(assert, 'clipfx:deleteRun', '(id) => clipfx.deleteRun(id)')
    await withInfo(classesOf(withoutPromptWriter(loadApp(resources, CLIP_FX.smooth.app).graph)), async () => {
      savesEveryNode()
      await new Promise((r) => setTimeout(r, 5))
      const made = await clipfx.run({ fx: 'smooth', file: clip, values: { factor: 3 }, name: 'To delete' })
      const runs = clipfx.runs()
      assert.equal(runs[0].id, made.id, 'newest first')
      assert.deepEqual([runs[0].fx, runs[0].status, runs[0].values], ['smooth', 'success', { factor: 3 }])
      assert.ok(runs.length >= 2, 'the run from the other test is still listed')
      const file = made.files[0].file
      assert.ok(fs.existsSync(file))
      const before = runs.length
      assert.deepEqual(clipfx.deleteRun(made.id), { deleted: made.id })
      assert.ok(!fs.existsSync(file), 'its file is gone')
      assert.equal(clipfx.runs().length, before - 1)
      assert.ok(!clipfx.runs().some((r) => r.id === made.id))
      assert.throws(() => clipfx.deleteRun(made.id), /^Error: No run /)
    })
  })

  test('[ipc:clipfx:preview][event:clipfx:progress] runs only the depth and warp half on the first seconds of the clip, keeps the preview in the data folder and tells the window it is a preview', async () => {
    assertCopiesMain(assert, 'clipfx:preview', `return clipfx.previewAngle({ fx, file: await clipStretch(file, start, length), values, camera, size, onProgress: (j) => send('clipfx:progress', { fx, preview: true, status: j.status, progress: j.progress }) })`)
    await withInfo(classesOf(loadApp(resources, 'reshoot').graph), async () => {
      savesEveryNode()
      sent.length = 0
      const queued = fake.prompts.length
      const fx = 'reshoot'
      const r = await clipfx.previewAngle({ fx, file: await clipStretch(clip, 0, null), values: { azimuth: 30 }, camera: { hfov: 40 }, size: null, onProgress: (j) => send('clipfx:progress', { fx, preview: true, status: j.status, progress: j.progress }) })
      assert.equal(fake.prompts.length, queued + 1)
      const kinds = Object.values(fake.prompts.at(-1).prompt).map((n) => n.class_type)
      assert.ok(kinds.includes('CrossViewWarp') && kinds.includes('MoGeInference'))
      assert.ok(!kinds.some((k) => /KSampler|SamplerCustom/.test(k)), 'no H3 in the preview')
      assert.equal(fake.prompts.at(-1).prompt['5'].inputs.azimuth, 30)
      assert.equal(fake.prompts.at(-1).prompt['5'].inputs.hfov, 40)
      assert.equal(fake.prompts.at(-1).extra_data.iv_studio.kind, 'clipfx:reshoot-preview')
      assert.equal(path.dirname(r.file), path.join(dir, 'data', 'clipfx', '_previews'))
      assert.ok(fs.existsSync(r.file) && fs.statSync(r.file).size > 0)
      assert.equal(r.camera.azimuth, 30)
      assert.ok(sent.length >= 1 && sent.every(([c, p]) => c === 'clipfx:progress' && p.preview === true && p.fx === 'reshoot' && p.status === 'success'), JSON.stringify(sent))
    })
    await assert.rejects(() => clipfx.previewAngle({ fx: 'smooth', file: clip }), /^Error: Smooth or slow motion has no preview\.$/)
    await assert.rejects(() => clipfx.previewAngle({ fx: 'reshoot', file: path.join(dir, 'gone.mp4') }), /^Error: Pick a clip\.$/)
  })

  test('[ipc:clipfx:live] asks the warp node for a picture at the camera given and hands back a data URL with the frame; says stale with no cached clip, unavailable on an older node or a cloud ComfyUI, and passes on the node\'s own error', async () => {
    assertCopiesMain(assert, 'clipfx:live', '(opts) => clipfx.liveAngle(opts)')
    const seen = []
    let answer = { status: 200 }
    const stand = await serve(async (req, res) => {
      const chunks = []
      for await (const c of req) chunks.push(c)
      seen.push({ method: req.method, url: req.url, body: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') })
      if (answer.status === 200) {
        res.writeHead(200, { 'Content-Type': 'image/jpeg', 'x-preview-info': JSON.stringify({ frame: 3, count: 48 }) })
        return res.end(Buffer.from('jpegbytes'))
      }
      res.writeHead(answer.status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(answer.body || {}))
    })
    try {
      const live = new FreefieldApps({ resourcesDir: resources, dataDir: path.join(dir, 'data'), studio: () => ({ comfy: { url: stand.url, remote: false, headers: (h) => h } }) })
      const got = await live.liveAngle({ fx: 'reshoot', frame: 3, params: { azimuth: 20, elevation: -5, junk: 'dropped' } })
      assert.deepEqual(got, { image: `data:image/jpeg;base64,${Buffer.from('jpegbytes').toString('base64')}`, frame: 3, count: 48 })
      assert.equal(seen[0].url, '/crossview_preview/render')
      assert.deepEqual(seen[0].body, { node_id: '5', frame: 3, params: { azimuth: 20, elevation: -5 } }, 'only the warp node\'s own settings go')
      answer = { status: 409 }
      assert.deepEqual(await live.liveAngle({}), { stale: true })
      answer = { status: 404 }
      assert.deepEqual(await live.liveAngle({}), { unavailable: true })
      answer = { status: 500, body: { error: 'warp blew up (fake)' } }
      await assert.rejects(() => live.liveAngle({}), /^Error: warp blew up \(fake\)$/)
      const cloud = new FreefieldApps({ resourcesDir: resources, dataDir: path.join(dir, 'data'), studio: () => ({ comfy: { url: stand.url, remote: true } }) })
      const calls = seen.length
      assert.deepEqual(await cloud.liveAngle({}), { unavailable: true })
      assert.equal(seen.length, calls, 'a cloud ComfyUI is not asked')
    } finally {
      await stand.close()
    }
  })
})

describe('window channels: sounds', () => {
  const CKPT = 'stable_audio_3_medium.safetensors'
  const TE = 't5gemma_b_b_ul2.safetensors'
  const NODES = { EmptyLatentAudio: node(), VAEDecodeAudio: node(), SaveAudio: node() }
  const soundInfo = () => ({ ...NODES, CheckpointLoaderSimple: combo('ckpt_name', [CKPT]), CLIPLoader: node({ clip_name: [[TE]], type: [['stable_audio', 'lumina2']] }) })
  let fake, ollama, dir, studio, edits, sounds, oldData, n
  let written = { description: 'A heavy wooden door slams shut in a stone hallway, a short echo after.', seconds: 3 }
  const flac = (seconds = 2) => {
    const f = path.join(dir, `take${++n}.flac`)
    ff('-f', 'lavfi', '-i', `sine=f=440:d=${seconds}`, f)
    return f
  }
  // ComfyUI saves these audio files for each sound it makes
  const savesAudio = (takes = 1) =>
    fake.setOutputs(() => ({ 8: { audio: Array.from({ length: takes }, () => { const f = flac(); return { filename: path.basename(f), subfolder: 'iv_studio/sounds', type: 'output', fullpath: f } }) } }))
  const withInfo = async (info, fn) => {
    fake.setObjectInfo(info)
    try {
      return await fn()
    } finally {
      fake.setObjectInfo({})
      fake.setOutputs(null)
      fake.releaseHeld()
    }
  }

  before(async () => {
    n = 0
    fake = await startFakeComfy({ devices: 'mps', os: 'darwin' })
    ollama = await startFakeOllama({ answer: () => written })
    setOllamaSource(() => ollama.url)
    dir = tmp()
    // the prompt writer reads Settings from the data folder: a local writer on the fake Ollama
    oldData = process.env.IV_STUDIO_DATA
    process.env.IV_STUDIO_DATA = path.join(dir, 'settings-home')
    fs.mkdirSync(process.env.IV_STUDIO_DATA, { recursive: true })
    fs.writeFileSync(path.join(process.env.IV_STUDIO_DATA, 'settings.json'), JSON.stringify({ promptEngine: 'local', ollamaModel: 'fake-vl:8b' }))
    studio = new Studio({ dataDir: path.join(dir, 'data'), resourcesDir: resources, comfyUrl: fake.url })
    edits = new Edits({ dataDir: path.join(dir, 'data'), ffmpeg, ffprobe })
    sounds = new Sounds({ studio, dataDir: path.join(dir, 'data'), probe: (f) => edits.probe(f) })
  })
  after(async () => {
    if (oldData === undefined) delete process.env.IV_STUDIO_DATA
    else process.env.IV_STUDIO_DATA = oldData
    setOllamaSource(() => '')
    await ollama.close()
    await fake.close()
  })

  test('[ipc:sounds:meta] hands over the five kinds with their lengths, the 1 to 120 second limit with up to four takes, and the engine\'s name, maker and licence', () => {
    assertCopiesMain(assert, 'sounds:meta', '() => ({ kinds: SOUND_KINDS, limits: SOUND_LIMITS, engine: SOUND_ENGINE })')
    const meta = { kinds: SOUND_KINDS, limits: SOUND_LIMITS, engine: SOUND_ENGINE }
    assert.ok(meta.kinds.length >= 3 && meta.kinds.every((k) => k.id && k.label && k.seconds >= 1 && k.seconds <= 120), JSON.stringify(meta.kinds))
    assert.equal(meta.kinds[0].id, 'sfx')
    assert.deepEqual(meta.limits, { min: 1, max: 120, takes: 4 })
    assert.deepEqual(meta.engine, { label: 'Stable Audio 3', by: 'Stability AI', licence: 'Stable Audio Community License', models: ['sa3', 'sa3_te'] })
  })

  test('[ipc:sounds:status] says what a bare ComfyUI lacks (both models by label and size, and the audio nodes) and is ready once both files and the nodes are listed', async () => {
    const bare = await sounds.status()
    assert.equal(bare.ready, false)
    assert.deepEqual(bare.missing.map((m) => [m.id, m.label, m.folder]), [['sa3', 'Stable Audio 3 (medium)', 'checkpoints'], ['sa3_te', 'Stable Audio 3 text encoder (T5Gemma)', 'text_encoders']])
    assert.ok(bare.missing.every((m) => m.size > 0))
    assert.deepEqual(bare.missingNodes, ['EmptyLatentAudio', 'VAEDecodeAudio', 'SaveAudio', 'CLIPLoader (stable_audio)'])
    await withInfo(soundInfo(), async () => {
      const ready = await sounds.status()
      assert.deepEqual([ready.ready, ready.missing, ready.missingNodes, ready.files], [true, [], [], { sa3: CKPT, sa3_te: TE }])
    })
  })

  test('[ipc:sounds:write] has the prompt writer turn a few words into a description and a length in that kind\'s way, keeps the length within 1 to 120 seconds, and asks for words when given none', async () => {
    const before = ollama.requests.length
    assert.deepEqual(await sounds.write({ idea: 'a door slamming', kind: 'sfx' }), { description: written.description, seconds: 3 })
    const asked = ollama.requests.slice(before).find((r) => r.path === '/api/chat' && r.json?.messages)
    assert.ok(asked, 'the writer was asked on the fake Ollama')
    assert.match(JSON.stringify(asked.json.messages), /Describe one sound effect for a generative audio model/)
    assert.match(JSON.stringify(asked.json.messages), /The sound: a door slamming/)
    const keep = written
    try {
      written = { description: 'Steady rain on a tin roof.', seconds: 400 }
      assert.deepEqual(await sounds.write({ idea: 'rain', kind: 'ambience' }), { description: 'Steady rain on a tin roof.', seconds: 120 })
      written = { description: 'A deep boom.' }
      assert.equal((await sounds.write({ idea: 'boom', kind: 'oneshot' })).seconds, 3, 'a length the writer left out falls back to the kind\'s own')
    } finally {
      written = keep
    }
    await assert.rejects(() => sounds.write({ idea: '   ' }), /^Error: Write a few words about the sound first\.$/)
  })

  test('[ipc:sounds:create][ipc:sounds:list] queues the Stable Audio 3 graph, then lists the sound with its takes copied into the data folder and their lengths once ComfyUI has saved them', async () => {
    assertCopiesMain(assert, 'sounds:create', 'return sounds.create(opts)')
    assert.deepEqual(await sounds.list(), [], 'no sounds yet')
    await assert.rejects(() => sounds.create({ description: 'A door.' }), /^Error: This ComfyUI has no EmptyLatentAudio, VAEDecodeAudio, SaveAudio, CLIPLoader \(stable_audio\)\. Update ComfyUI\.$/)
    await withInfo({ ...NODES, CheckpointLoaderSimple: combo('ckpt_name', ['other.safetensors']), CLIPLoader: node({ clip_name: [['other.safetensors']], type: [['stable_audio']] }) }, () =>
      assert.rejects(() => sounds.create({ description: 'A door.' }), /^Error: Sounds need Stable Audio 3 \(medium\) and Stable Audio 3 text encoder \(T5Gemma\)\. Download them on the Sounds page\.$/)
    )
    await withInfo(soundInfo(), async () => {
      savesAudio(2)
      const queued = fake.prompts.length
      const made = await sounds.create({ description: 'A heavy door slams in a stone hall.', kind: 'sfx', seconds: 3, takes: 2, seed: 7, name: 'Door slam' })
      assert.equal(fake.prompts.length, queued + 1)
      const g = Object.values(fake.prompts.at(-1).prompt)
      assert.equal(g.find((x) => x.class_type === 'CheckpointLoaderSimple').inputs.ckpt_name, CKPT)
      assert.equal(g.find((x) => x.class_type === 'CLIPLoader').inputs.type, 'stable_audio')
      assert.match(g.find((x) => x.class_type === 'SaveAudio').inputs.filename_prefix, /^iv_studio\/sounds\/door_slam_[0-9a-f]{8}$/)
      assert.deepEqual([made.name, made.kind, made.seconds, made.takes, made.seed, made.files], ['Door slam', 'sfx', 3, 2, 7, []])
      const [done] = await sounds.list()
      assert.equal(done.id, made.id)
      assert.equal(done.status, 'success')
      assert.equal(done.files.length, 2)
      for (const f of done.files) {
        assert.equal(path.dirname(f.file), path.join(dir, 'data', 'sounds'))
        assert.ok(fs.existsSync(f.file) && f.duration > 1.5 && f.duration < 2.5, JSON.stringify(f))
      }
      assert.match(path.basename(done.files[1].file), /^door_slam_[0-9a-f]{8}_2\.flac$/)
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'data', 'sounds', 'sounds.json'), 'utf8')).map((s) => s.id), [made.id], 'kept in the data folder')
      await assert.rejects(() => sounds.create({ description: '' }), /^Error: Describe the sound first/)
      await assert.rejects(() => sounds.create({ description: 'x', seconds: 500 }), /^Error: Sounds are 1 to 120 seconds\.$/)
      await assert.rejects(() => sounds.create({ description: 'x', takes: 9 }), /^Error: Make 1 to 4 takes at once\.$/)
    })
  })

  test('[ipc:sounds:rename] renames a sound, refuses an empty name, and names a sound that is not there', async () => {
    const [s] = await sounds.list()
    assert.equal(sounds.rename(s.id, '  Heavy door  ').name, 'Heavy door')
    assert.equal(sounds.all().find((x) => x.id === s.id).name, 'Heavy door', 'saved')
    assert.throws(() => sounds.rename(s.id, '   '), /^Error: Give the sound a name\.$/)
    assert.throws(() => sounds.rename('nope', 'x'), /^Error: No sound nope\.$/)
  })

  test('[ipc:sounds:cancel][ipc:sounds:delete] takes a waiting sound out of the queue and marks it cancelled; deleting removes its takes, its project and its record, and names a sound that is not there', async () => {
    await withInfo(soundInfo(), async () => {
      fake.holdNextPrompt(1)
      const waiting = await sounds.create({ description: 'A slow wind.', kind: 'ambience', seconds: 10, name: 'Wind' })
      assert.equal(waiting.status, 'queued')
      const cancelled = await sounds.cancel(waiting.id)
      assert.equal(cancelled.status, 'cancelled')
      assert.equal(sounds.all().find((s) => s.id === waiting.id).status, 'cancelled', 'saved')
      await assert.rejects(() => sounds.cancel('nope'), /^Error: No sound nope\.$/)
      const done = (await sounds.list()).find((s) => s.files.length)
      const files = done.files.map((f) => f.file)
      assert.ok(files.every((f) => fs.existsSync(f)))
      assert.deepEqual(await sounds.delete(done.id), { deleted: done.id })
      assert.ok(files.every((f) => !fs.existsSync(f)), 'its takes are gone')
      assert.ok(!sounds.all().some((s) => s.id === done.id))
      assert.ok(!fs.existsSync(path.join(dir, 'data', 'projects', `${done.projectId}.json`)), 'its project is gone')
      assert.deepEqual(await sounds.delete(waiting.id), { deleted: waiting.id })
      await assert.rejects(() => sounds.delete(waiting.id), /^Error: No sound /)
    })
  })
})

describe('window channels: picture tools', () => {
  const FLUX3 = 'Flux3/flux3_image_klein_9b.safetensors'
  let fake, dir, studio, images, pic, clip
  const withInfo = async (info, fn) => {
    fake.setObjectInfo(info)
    try {
      return await fn()
    } finally {
      fake.setObjectInfo({})
    }
  }
  before(async () => {
    fake = await startFakeComfy({ devices: 'mps', os: 'darwin' })
    dir = tmp()
    studio = new Studio({ dataDir: path.join(dir, 'data'), resourcesDir: resources, comfyUrl: fake.url })
    images = new Images({ studio, dataDir: path.join(dir, 'data') })
    pic = path.join(dir, 'fox.png')
    clip = path.join(dir, 'walk.mp4')
    ff('-f', 'lavfi', '-i', 'color=c=orange:s=64x64', '-frames:v', '1', pic)
    ff('-f', 'lavfi', '-i', 'testsrc=s=64x48:r=24:d=1', '-pix_fmt', 'yuv420p', clip)
  })
  after(() => fake.close())

  test('[ipc:images:toolsStatus] lists the five tools, none ready on a bare ComfyUI with what each is missing, and says an Apple GPU cannot run Upscale; ready once the models and nodes are there', async () => {
    const bare = await images.toolsStatus()
    assert.deepEqual(bare.tools.map((t) => [t.id, t.ready]), [['inpaint', false], ['relight', false], ['removebg', false], ['upscale', false], ['depth', false]])
    assert.deepEqual(bare.tools.find((t) => t.id === 'removebg').missing.map((m) => m.id), ['birefnet'])
    assert.deepEqual(bare.tools.find((t) => t.id === 'depth').missing.map((m) => m.id), ['moge'])
    assert.match(bare.tools.find((t) => t.id === 'upscale').note, /SeedVR2 isn't available on an Apple GPU yet/)
    assert.deepEqual(bare.depthOutputs.map(([v]) => v), ['depth_colored', 'depth', 'normal_opengl', 'normal_directx'])
    await withInfo({ LoadBackgroundRemovalModel: combo('bg_removal_name', ['birefnet.safetensors']), RemoveBackground: node() }, async () => {
      const s = await images.toolsStatus()
      assert.equal(s.tools.find((t) => t.id === 'removebg').ready, true)
      assert.equal(s.files.birefnet, 'birefnet.safetensors')
    })
  })

  test('[ipc:images:tool] removebg: uploads the picture, queues BiRefNet with the matte onto the alpha, records the set in the gallery; refuses an unknown tool, a missing picture and a tool the ComfyUI is not ready for', async () => {
    assertCopiesMain(assert, 'images:tool', 'return images.tool(opts)')
    await assert.rejects(() => images.tool({ tool: 'sharpen', image: pic }), /^Error: Tool is one of inpaint, relight, removebg, upscale, depth\.$/)
    await assert.rejects(() => images.tool({ tool: 'removebg', image: path.join(dir, 'gone.png') }), /^Error: Pick the picture first\.$/)
    await assert.rejects(() => images.tool({ tool: 'removebg', image: pic }), /^Error: Remove background needs BiRefNet/)
    await withInfo({ LoadBackgroundRemovalModel: combo('bg_removal_name', ['birefnet.safetensors']), RemoveBackground: node(), InvertMask: node(), JoinImageWithAlpha: node() }, async () => {
      const uploads = fake.uploads.length
      const set = await images.tool({ tool: 'removebg', image: pic })
      assert.deepEqual(fake.uploads.slice(uploads).map((u) => [u.name, u.subfolder]), [['fox.png', 'iv_studio/images']])
      const g = Object.values(fake.prompts.at(-1).prompt)
      assert.equal(g.find((x) => x.class_type === 'LoadBackgroundRemovalModel').inputs.bg_removal_name, 'birefnet.safetensors')
      assert.match(g.find((x) => x.class_type === 'SaveImage').inputs.filename_prefix, new RegExp(`^iv_studio/images/remove_background_fox_${set.id}$`))
      assert.deepEqual([set.mode, set.tool, set.familyLabel, set.name, set.status, set.refs], ['tool', 'removebg', 'Remove background', 'Remove background · fox', 'queued', [pic]])
      assert.equal(fake.prompts.at(-1).extra_data.iv_studio.kind, 'picture:tool-removebg')
      assert.equal((await images.list())[0].id, set.id, 'it is in the gallery')
    })
  })

  test('[ipc:images:saveMask] saves a painted PNG data URL as a file beside the gallery and refuses anything that is not a PNG', () => {
    const png = fs.readFileSync(pic)
    const file = images.saveMask(`data:image/png;base64,${png.toString('base64')}`)
    assert.equal(path.dirname(file), path.join(dir, 'data', 'images', '_masks'))
    assert.match(path.basename(file), /^mask_[0-9a-f]{8}\.png$/)
    assert.ok(fs.readFileSync(file).equals(png), 'the same bytes')
    assert.notEqual(images.saveMask(`data:image/png;base64,${png.toString('base64')}`), file, 'each mask is its own file')
    assert.throws(() => images.saveMask('data:image/jpeg;base64,AAAA'), /^Error: That mask isn’t a PNG picture\.$/)
    assert.throws(() => images.saveMask(''), /^Error: That mask isn’t a PNG picture\.$/)
  })

  test('[ipc:images:lastFrame] saves a video\'s last frame as a picture set in the gallery, uses the same one again for the same video, and refuses a video that is not there', async () => {
    const set = await images.lastFrame({ file: clip })
    assert.deepEqual([set.mode, set.familyLabel, set.status, set.source], ['frame', 'Last frame', 'success', clip])
    assert.equal(set.name, 'walk · last frame')
    assert.equal(path.dirname(set.files[0]), path.join(dir, 'data', 'images'))
    assert.deepEqual([set.width, set.height], [64, 48])
    assert.equal(fs.readFileSync(set.files[0]).subarray(1, 4).toString(), 'PNG')
    assert.equal((await images.lastFrame({ file: clip })).id, set.id, 'the same video\'s frame is not saved twice')
    assert.equal((await images.lastFrame({ file: clip, name: 'Again' })).id, set.id)
    await assert.rejects(() => images.lastFrame({ file: path.join(dir, 'gone.mp4') }), /^Error: That file is not on this computer\.$/)
  })
})

describe('window channels: Recommended LoRAs', () => {
  let fake, comfy, dir, stand, installer, original
  const updates = []
  const body = Buffer.from('pretend lora weights '.repeat(2000))
  const sha = createHash('sha256').update(body).digest('hex')
  const until = async (done, ms = 5000) => {
    for (let t = 0; t < ms && !done(); t += 10) await new Promise((r) => setTimeout(r, 10))
    assert.ok(done(), 'timed out')
  }
  before(async () => {
    fake = await startFakeComfy({ devices: 'mps', os: 'darwin', models: { loras: [] } })
    comfy = new Comfy(fake.url)
    dir = tmp()
    // The shelf's URLs are pinned to Hugging Face, but RECOMMENDED is a plain exported list: the stand-in host takes the
    // place of two entries for this file only (the same way the Civitai tests move CIVITAI_SITES).
    stand = await serve((req, res) => {
      if (req.url === '/slow.safetensors') {
        res.writeHead(200, { 'content-length': body.length })
        if (req.method === 'HEAD') return res.end()
        return void res.write(body.subarray(0, 1000)) // then holds the rest back until the test is over
      }
      res.writeHead(200, { 'content-length': body.length })
      res.end(req.method === 'HEAD' ? undefined : body)
    })
    original = RECOMMENDED.slice(0, 2).map((r) => ({ ...r }))
    Object.assign(RECOMMENDED[0], { url: `${stand.url}/fast.safetensors`, sha256: sha, size: body.length })
    Object.assign(RECOMMENDED[1], { url: `${stand.url}/slow.safetensors`, sha256: sha, size: body.length })
    // main's wiring: a new installer on the shelf's manifest, every change sent to the window
    installer = new ModelInstaller({ comfy, manifest: recommendedManifest(), onUpdate: (u) => updates.push(u) })
  })
  after(async () => {
    for (const [i, o] of original.entries()) Object.assign(RECOMMENDED[i], o)
    await stand.close()
    await fake.close()
  })

  test('[ipc:loras:recommended] hands over the shelf, which of its LoRAs ComfyUI already lists (by file name, in any folder) and the installer\'s state; ComfyUI being down just means none are on disk', async () => {
    assertCopiesMain(assert, 'loras:recommended', `const names = await new Comfy(url).objectInfo('LoraLoaderModelOnly').then((i) => i.LoraLoaderModelOnly?.input?.required?.lora_name?.[0] || [], () => [])
    return { list: RECOMMENDED, onDisk: recommendedOnDisk(names), state: installer.status() }`, { 'readSettings(BASE).comfyUrl': 'url', recInstaller: 'installer' })
    const shelf = async (url) => {
      const names = await new Comfy(url).objectInfo('LoraLoaderModelOnly').then((i) => i.LoraLoaderModelOnly?.input?.required?.lora_name?.[0] || [], () => [])
      return { list: RECOMMENDED, onDisk: recommendedOnDisk(names), state: installer.status() }
    }
    fake.setObjectInfo({ LoraLoaderModelOnly: combo('lora_name', ['MiniMax H3\\Enhancements\\Motion_Repair_V2.safetensors', 'other.safetensors']) })
    const got = await shelf(fake.url)
    assert.equal(got.list, RECOMMENDED)
    assert.ok(got.list.length >= 8 && got.list.every((r) => r.id && r.name && r.sha256 && r.what && r.how))
    assert.deepEqual(got.onDisk, { 'rec-motion-repair': 'MiniMax H3\\Enhancements\\Motion_Repair_V2.safetensors' })
    assert.deepEqual(got.state, {})
    fake.setObjectInfo({})
    assert.deepEqual((await shelf(fake.url)).onDisk, {}, 'no list of LoRAs: none on disk')
    assert.deepEqual((await shelf('http://127.0.0.1:9')).onDisk, {}, 'ComfyUI not answering: none on disk')
  })

  test('[ipc:loras:recommendedDownload][event:recommended:update] downloads a shelf LoRA into ComfyUI\'s loras folder after checking its pinned SHA-256, telling the window each step with the id, and refuses an id not on the shelf', async () => {
    assertCopiesMain(assert, 'loras:recommendedDownload', '(id) => installer.enqueue([id])', { recInstaller: 'installer' })
    assertMainSends(assert, "onUpdate: (u) => send('recommended:update', u)")
    assert.throws(() => installer.enqueue(['rec-nothing']), /^Error: Unknown model "rec-nothing"\.$/)
    const state = installer.enqueue([RECOMMENDED[0].id])
    assert.equal(state[RECOMMENDED[0].id].status, 'queued')
    await until(() => installer.status()[RECOMMENDED[0].id].status === 'done')
    const target = path.join(fake.dataDir, 'models', 'loras', 'MiniMax H3', 'Recommended', RECOMMENDED[0].match)
    assert.ok(fs.readFileSync(target).equals(body), 'the file is where ComfyUI will list it')
    const mine = updates.filter((u) => u.id === RECOMMENDED[0].id)
    assert.deepEqual(mine.map((u) => u.status)[0], 'queued')
    assert.equal(mine.at(-1).status, 'done')
    assert.equal(mine.at(-1).path, target)
    assert.ok(mine.every((u) => typeof u.id === 'string' && typeof u.status === 'string'), 'each update says which LoRA and how it stands')
    assert.ok(mine.some((u) => u.status === 'verifying' || u.status === 'downloading') || mine.length >= 2)
  })

  test('[ipc:loras:recommendedCancel][event:recommended:update] stops a download in progress and leaves it paused for later, and a LoRA that was only waiting is paused without starting', async () => {
    assertCopiesMain(assert, 'loras:recommendedCancel', '(id) => installer.cancel(id)', { recInstaller: 'installer' })
    const slow = RECOMMENDED[1].id
    installer.enqueue([slow])
    await until(() => installer.running?.id === slow)
    await new Promise((r) => setTimeout(r, 100))
    installer.cancel(slow)
    await until(() => installer.status()[slow].status === 'paused')
    assert.ok(updates.some((u) => u.id === slow && u.status === 'paused'), 'the window is told')
    assert.ok(!fs.existsSync(path.join(fake.dataDir, 'models', 'loras', 'MiniMax H3', 'Recommended', RECOMMENDED[1].match)), 'nothing half-finished is left under the real name')
    assert.equal(installer.running, null)
  })
})

describe('window channels: turnaround sheets', () => {
  const READY = { H3ContactSheet: node(), H3ContactSheetDecode: node(), LoraLoaderModelOnly: combo('lora_name', [`MiniMax H3/Recommended/${TURNAROUND_LORA.match}`]) }
  let fake, dir, studio, turnarounds, face, made
  const savesViews = (count = 5) =>
    fake.setOutputs((prompt, id) => {
      const mk = (name) => {
        const f = path.join(dir, `${id}_${name}.png`)
        ff('-f', 'lavfi', '-i', 'color=c=gray:s=32x32', '-frames:v', '1', f)
        return { filename: path.basename(f), subfolder: 'iv_studio/turnaround', type: 'output', fullpath: f }
      }
      return { s1views: { images: Array.from({ length: count }, (_, i) => mk(`view_${i + 1}`)) }, s2strip: { images: [mk('strip')] } }
    })
  const withInfo = async (info, fn) => {
    fake.setObjectInfo(info)
    try {
      return await fn()
    } finally {
      fake.setObjectInfo({})
      fake.setOutputs(null)
    }
  }
  before(async () => {
    fake = await startFakeComfy({ devices: 'mps', os: 'darwin' })
    dir = tmp()
    studio = new Studio({ dataDir: path.join(dir, 'data'), resourcesDir: resources, comfyUrl: fake.url })
    turnarounds = new Turnarounds({ dataDir: path.join(dir, 'data'), studio: () => studio })
    face = path.join(dir, 'face.png')
    ff('-f', 'lavfi', '-i', 'color=c=orange:s=64x64', '-frames:v', '1', face)
  })
  after(() => fake.close())

  test('[ipc:turnaround:status] says what is missing on a bare ComfyUI (the contact-sheet nodes and the LoRA) and is ready once both are there, with the LoRA as ComfyUI lists it', async () => {
    assertCopiesMain(assert, 'turnaround:status', '() => turnarounds.status()')
    const bare = await turnarounds.status()
    assert.deepEqual([bare.nodes, bare.lora, bare.ready, bare.lora_id, bare.size], [false, null, false, 'rec-turnaround', TURNAROUND_LORA.size])
    await withInfo(READY, async () => {
      const s = await turnarounds.status()
      assert.deepEqual([s.nodes, s.lora, s.ready], [true, `MiniMax H3/Recommended/${TURNAROUND_LORA.match}`, true])
    })
    await withInfo({ ...READY, H3ContactSheetDecode: undefined }, async () => {
      assert.equal((await turnarounds.status()).ready, false, 'both contact-sheet nodes are needed')
    })
  })

  test('[ipc:turnaround:make] queues the five-view graph from a picture, waits, and keeps five views and a strip in the data folder; says what is missing or wrong and queues nothing', async () => {
    await withInfo(READY, async () => {
      savesViews()
      const uploads = fake.uploads.length
      made = await turnarounds.make({ picture: face, size: 512, seed: 99, strength: 1.3 })
      assert.deepEqual(fake.uploads.slice(uploads).map((u) => [u.name, u.subfolder]), [['face.png', 'iv_studio/turnaround']])
      const g = fake.prompts.at(-1).prompt
      assert.equal(g.ref.inputs.image, 'iv_studio/turnaround/face.png')
      assert.equal(g.lora.inputs.lora_name, `MiniMax H3/Recommended/${TURNAROUND_LORA.match}`)
      assert.equal(fake.prompts.at(-1).extra_data.iv_studio.kind, 'turnaround')
      assert.equal(made.views.length, 5)
      assert.match(made.strip, /_strip\.png$/)
      for (const f of [...made.views, made.strip]) {
        assert.equal(path.dirname(f), path.join(dir, 'data', 'turnarounds', made.id))
        assert.ok(fs.existsSync(f))
      }
      assert.deepEqual([made.characterId, made.size, made.seed, made.name], [null, 512, 99, 'face.png'])
      const queued = fake.prompts.length
      await assert.rejects(() => turnarounds.make({}), /^Error: Pick a picture of the character\.$/)
      await assert.rejects(() => turnarounds.make({ characterId: 'nobody' }), /^Error: No such character\.$/)
      await assert.rejects(() => turnarounds.make({ picture: face, size: 640 }), /^Error: Size is 512, 768, 1024 pixels a view\.$/)
      savesViews(3)
      await assert.rejects(() => turnarounds.make({ picture: face }), /^Error: The sheet came back with 3 views instead of 5\.$/)
      assert.equal(fake.prompts.length, queued + 1, 'only the short one was queued')
    })
    await assert.rejects(() => turnarounds.make({ picture: face }), /^Error: Turnaround sheets need the H3 Contact Sheet node pack\./)
    await withInfo({ H3ContactSheet: node(), H3ContactSheetDecode: node() }, () => assert.rejects(() => turnarounds.make({ picture: face }), /^Error: Turnaround sheets need the Turnaround LoRA \(63 MB\)\./))
  })

  test('[ipc:turnaround:list] lists the sheets made, newest first, and only one character\'s own when given its id', async () => {
    const other = { ...made, id: 'ta-other', characterId: 'tess', name: 'Tess', at: new Date(Date.parse(made.at) + 1000).toISOString() }
    fs.mkdirSync(path.join(dir, 'data', 'turnarounds', other.id), { recursive: true })
    fs.writeFileSync(path.join(dir, 'data', 'turnarounds', other.id, 'sheet.json'), JSON.stringify(other))
    assert.deepEqual(turnarounds.list().map((s) => s.id), ['ta-other', made.id], 'newest first')
    assert.deepEqual(turnarounds.list('tess').map((s) => s.id), ['ta-other'])
    assert.deepEqual(turnarounds.list('nobody'), [])
    assertCopiesMain(assert, 'turnaround:list', '(characterId) => turnarounds.list(characterId)')
  })

  test('[ipc:turnaround:delete] removes a sheet with its pictures, keeps the others, and refuses an id that could reach outside the folder', () => {
    assertCopiesMain(assert, 'turnaround:delete', '(id) => turnarounds.remove(id)')
    const files = [...made.views, made.strip]
    assert.equal(turnarounds.remove(made.id), true)
    assert.ok(files.every((f) => !fs.existsSync(f)))
    assert.deepEqual(turnarounds.list().map((s) => s.id), ['ta-other'])
    assert.throws(() => turnarounds.remove('../data'), /^Error: No such sheet\.$/)
    assert.ok(fs.existsSync(path.join(dir, 'data', 'turnarounds', 'ta-other', 'sheet.json')))
  })
})

describe('window channels: Library descriptions', () => {
  let dir, clip, pic, describer
  const sent = []
  before(() => {
    dir = tmp()
    clip = path.join(dir, 'red car.mp4')
    pic = path.join(dir, 'beach.png')
    ff('-f', 'lavfi', '-i', 'testsrc2=s=160x90:r=24:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clip)
    ff('-f', 'lavfi', '-i', 'color=c=orange:s=160x90', '-frames:v', '1', pic)
    describer = new Describer({
      dataDir: dir,
      ffmpeg,
      files: () => [{ path: clip, type: 'video' }, { path: pic, type: 'image' }],
      idle: async () => true,
      enabled: () => true,
      writer: async () => ({ name: 'stand-in', vision: true }),
      chat: async () => ({ sentence: 'A red car drives past a beach.', tags: ['car', 'beach'] }),
      onChange: (st) => sent.push(st)
    })
  })

  test('[ipc:library:describeStatus][event:library:describe] says how many files are described, which one is being read and any error, and sends the window that status when a description starts and when it ends', async () => {
    assertCopiesMain(assert, 'library:describeStatus', '() => describer.status()')
    assertMainSends(assert, "onChange: (st) => send('library:describe', st)")
    assert.deepEqual(describer.status(), { enabled: true, described: 0, total: 2, running: null, error: null })
    const r = await describer.tick()
    assert.ok(r.described, JSON.stringify(r))
    assert.equal(sent.length, 2, 'once at the start, once at the end')
    assert.equal(sent[0].running, r.described)
    assert.deepEqual([sent[0].described, sent[0].total], [0, 2])
    assert.deepEqual(sent[1], { enabled: true, described: 1, total: 2, running: null, error: null })
    assert.deepEqual(describer.status(), sent[1])
    assert.deepEqual(describer.about(r.described), { sentence: 'A red car drives past a beach.', tags: ['car', 'beach'] })
  })
})

describe('window channels: soft mouth', () => {
  let dir, src, maskSource, softMouth
  const track = { frames: 48, withFace: 48, width: 160, height: 90 }
  before(() => {
    dir = tmp()
    src = path.join(dir, 'talk.mp4')
    maskSource = path.join(dir, 'mask-source.mkv')
    ff('-f', 'lavfi', '-i', 'testsrc2=s=160x90:r=24:d=2', '-f', 'lavfi', '-i', 'sine=f=440:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', src)
    ff('-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=24:d=2', '-vf', 'drawbox=x=60:y=30:w=40:h=30:color=white:t=fill,format=gray', '-c:v', 'ffv1', maskSource)
    // The face tracker is Python in Shinobi's environment. A node script stands in for it: it writes the mask video the
    // test made and prints the same JSON the tracker prints.
    const res = path.join(dir, 'resources')
    // (a folder named mouth_track.py with an index.js in it: node will not run a file with that extension under the guard)
    fs.mkdirSync(path.join(res, 'python', 'mouth_track.py'), { recursive: true })
    fs.writeFileSync(path.join(res, 'python', 'mouth_track.py', 'index.js'), `const fs = require('node:fs')\nconst mask = process.argv[5]\nif (process.env.TRACK_FAILS) { console.log(JSON.stringify({ error: 'The tracker fell over (fake).' })); process.exit(0) }\nfs.copyFileSync(process.env.MASK_SOURCE, mask)\nconsole.log(JSON.stringify(JSON.parse(process.env.TRACK)))\n`)
    softMouth = new SoftMouth({ dataDir: dir, ffmpeg, resourcesDir: res, shinobi: () => ({ installed: () => true, faceModelsReady: () => true, python: process.execPath, faceDir: path.join(dir, 'faces'), env: () => ({ ...process.env, MASK_SOURCE: maskSource, TRACK: JSON.stringify(track) }) }) })
  })

  test('[ipc:softmouth:ready] says to set up Shinobi first, then the face models, and is ready once both are there', () => {
    assertCopiesMain(assert, 'softmouth:ready', '() => softMouth.ready()')
    const of = (shinobi) => new SoftMouth({ dataDir: dir, ffmpeg, resourcesDir: 'resources', shinobi: () => shinobi }).ready()
    assert.match(of({ installed: () => false }).why, /Set up Shinobi once \(Workflows → Shinobi\)\./)
    assert.equal(of({ installed: () => false }).ready, false)
    assert.match(of({ installed: () => true, faceModelsReady: () => false }).why, /needs the face models/)
    assert.deepEqual(of({ installed: () => true, faceModelsReady: () => true }), { ready: true })
    assert.equal(softMouth.ready().ready, true)
  })

  test('[ipc:softmouth:make] has the tracker find the face, blurs only the mask under the picture and keeps the sound, makes the copy once per file version, and says when there is no face, no file, or the face models are missing', async () => {
    assertCopiesMain(assert, 'softmouth:make', '(file) => softMouth.make(file)')
    const r = await softMouth.make(src)
    assert.deepEqual({ frames: r.frames, withFace: r.withFace, width: r.width, height: r.height }, track)
    assert.equal(path.dirname(r.path), path.join(dir, 'softmouth'))
    assert.match(path.basename(r.path), /^talk_softmouth_[0-9a-f]{10}\.mp4$/)
    const streams = execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', r.path]).toString().trim().split(/\s+/).sort()
    assert.deepEqual(streams, ['audio', 'video'], 'the sound is kept')
    assert.ok(!fs.readdirSync(path.join(dir, 'softmouth')).some((f) => f.endsWith('_mask.mkv')), 'the mask is removed')
    const again = await softMouth.make(src)
    assert.equal(again.path, r.path, 'made once')
    await assert.rejects(() => softMouth.make(path.join(dir, 'gone.mp4')), /^Error: File not found: /)
    const noFace = new SoftMouth({ dataDir: path.join(dir, 'other'), ffmpeg, resourcesDir: path.join(dir, 'resources'), shinobi: () => ({ installed: () => true, faceModelsReady: () => true, python: process.execPath, faceDir: 'x', env: () => ({ ...process.env, MASK_SOURCE: maskSource, TRACK: JSON.stringify({ ...track, withFace: 0 }) }) }) })
    await assert.rejects(() => noFace.make(src), /^Error: No face was found in that video, so there’s no mouth to soften\.$/)
    const broken = new SoftMouth({ dataDir: path.join(dir, 'other2'), ffmpeg, resourcesDir: path.join(dir, 'resources'), shinobi: () => ({ installed: () => true, faceModelsReady: () => true, python: process.execPath, faceDir: 'x', env: () => ({ ...process.env, TRACK_FAILS: '1' }) }) })
    await assert.rejects(() => broken.make(src), /^Error: The tracker fell over \(fake\)\.$/)
    const none = new SoftMouth({ dataDir: dir, ffmpeg, resourcesDir: 'resources', shinobi: () => ({ installed: () => true, faceModelsReady: () => false }) })
    await assert.rejects(() => none.make(src), /needs the face models/)
  })
})

describe('window channels: the editor hand-off and takes', () => {
  let fake, dir, studio, edits, clip
  before(async () => {
    fake = await startFakeComfy({ devices: 'mps', os: 'darwin' })
    dir = tmp()
    studio = new Studio({ dataDir: path.join(dir, 'data'), resourcesDir: resources, comfyUrl: fake.url })
    edits = new Edits({ dataDir: path.join(dir, 'data'), ffmpeg, ffprobe })
    clip = path.join(dir, 'shot one.mp4')
    ff('-f', 'lavfi', '-i', 'testsrc2=s=128x72:r=24:d=3', '-f', 'lavfi', '-i', 'sine=f=440:d=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', clip)
  })
  after(() => fake.close())

  test('[ipc:media:localCopy] gives a file on this computer as it is, downloads a render ComfyUI holds once into the folder given, and says when it is neither', async () => {
    assertCopiesMain(assert, 'media:localCopy', "(file) => studio.localCopy(file, path.join(data, 'cache', 'versions'))", { DATA: 'data' })
    const versions = path.join(dir, 'data', 'cache', 'versions')
    assert.equal(await studio.localCopy(clip, versions), clip)
    assert.equal(await studio.localCopy({ path: clip }, versions), clip)
    assert.ok(!fs.existsSync(versions), 'nothing copied for a file already here')
    const url = `${fake.url}/view?filename=take_1.mp4&subfolder=iv_studio&type=output`
    const got = await studio.localCopy({ url }, versions)
    assert.equal(got, path.join(versions, 'take_1.mp4'))
    assert.equal(fs.readFileSync(got, 'utf8'), 'fake-bytes')
    const views = fake.requests.filter((r) => r.path === '/view').length
    assert.equal(await studio.localCopy({ url }, versions), got)
    assert.equal(fake.requests.filter((r) => r.path === '/view').length, views, 'downloaded once')
    await assert.rejects(() => studio.localCopy({ path: path.join(dir, 'gone.mp4') }, versions), /^Error: That file is not on this computer\.$/)
    fake.failRoute('/view', 500)
    try {
      await assert.rejects(() => studio.localCopy({ url: `${fake.url}/view?filename=other.mp4&type=output` }, versions), /^Error: Download failed \(500\)\.$/)
    } finally {
      fake.failRoute('/view', null)
    }
  })

  test('[ipc:edits:interchange] writes the timeline as FCP 7 XML, FCPXML and an EDL with the media copied beside them and zipped; zip false leaves the zip out; an empty timeline is refused', async () => {
    assertCopiesMain(assert, 'edits:interchange', "(id, opts = {}) => exportInterchange(edits.get(id), path.join(videos, 'Edits'), { zip: opts.zip !== false })", { 'videosDir()': 'videos' })
    const e = edits.create('Interchange cut')
    const media = await edits.addMedia(clip)
    edits.save(e.id, { media: { [media.id]: media }, clips: [{ id: 'c1', track: 'V1', media: media.id, start: 0, in: 0, out: 2, fadeIn: 0, fadeOut: 0, volume: 1, muted: false }] })
    const videos = path.join(dir, 'videos')
    const handle = (id, opts = {}) => exportInterchange(edits.get(id), path.join(videos, 'Edits'), { zip: opts.zip !== false })
    const r = await handle(e.id)
    assert.equal(path.dirname(r.folder), path.join(videos, 'Edits'))
    assert.match(path.basename(r.folder), /^Interchange cut - for Premiere and Resolve \d{4}-\d\d-\d\d-\d\d-\d\d$/)
    for (const f of [r.xml, r.fcpxml, r.readme, r.zip]) assert.ok(fs.existsSync(f), f)
    assert.deepEqual(r.media.map((f) => path.basename(f)), ['shot one.mp4'])
    assert.ok(fs.readFileSync(r.media[0]).equals(fs.readFileSync(clip)), 'the media is copied whole')
    assert.match(fs.readFileSync(r.xml, 'utf8'), /<xmeml version="4">/)
    assert.match(fs.readFileSync(r.fcpxml, 'utf8'), /<fcpxml version="1\.10">/)
    const plain = await handle(e.id, { zip: false })
    assert.ok(!plain.zip, 'no zip when asked not to')
    await assert.rejects(() => handle(edits.create('Nothing yet').id), /^Error: The timeline is empty\.$/)
  })

  test('[ipc:rank:clean] saves a take\'s longest stretch without a cut as its own video, frame-exact, cut down to the 17n+5 grid for Continue; names a take with no cut, one that is gone, and one too short to carry on from', async () => {
    assertCopiesMain(assert, 'rank:clean', "(id, candidate, opts = {}) => cleanStretchFile({ studio, mediaTools, dir: videos, jobId: id, candidate, forContinue: !!opts.forContinue })", { 'videosDir()': 'videos' })
    const take = path.join(dir, 'cut.mp4')
    ff('-f', 'lavfi', '-i', 'testsrc=s=128x96:r=24:d=2.5', '-f', 'lavfi', '-i', 'color=c=red:s=128x96:r=24:d=1', '-filter_complex', '[0:v][1:v]concat=n=2:v=1[v]', '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', take)
    const jobs = path.join(dir, 'data', 'jobs')
    fs.mkdirSync(jobs, { recursive: true })
    const job = (id, raw, outputs = [{ kind: 'preview', candidate: 1, path: take }]) => fs.writeFileSync(path.join(jobs, `${id}.json`), JSON.stringify({ id, kind: 'previews', status: 'success', plan: {}, outputs, ranking: { takes: [{ candidate: 1, raw }] } }))
    job('ranked1', { cuts: [{ frame: 60 }], clean: { from: 0, to: 2.5, start: 0, end: 60, seconds: 2.5 }, cleanH3: { from: 0, to: 2.333, frames: 56 } })
    job('short1', { cuts: [{ frame: 12 }], clean: { from: 0, to: 0.5, start: 0, end: 12, seconds: 0.5 }, cleanH3: null })
    job('uncut1', { cuts: [] })
    job('gone1', { cuts: [{ frame: 60 }], clean: { from: 0, to: 2.5, start: 0, end: 60, seconds: 2.5 }, cleanH3: null }, [])
    const mediaTools = new MediaTools({ dataDir: path.join(dir, 'data'), ffmpeg, ffprobe })
    const handle = (id, candidate, opts = {}) => cleanStretchFile({ studio, mediaTools, dir: path.join(dir, 'videos'), jobId: id, candidate, forContinue: !!opts.forContinue })
    const frames = (file) => Number(execFileSync(ffprobe, ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', file]).toString().trim())
    const plain = await handle('ranked1', 1)
    assert.deepEqual({ from: plain.from, to: plain.to, seconds: plain.seconds, frames: plain.frames }, { from: 0, to: 2.5, seconds: 2.5, frames: 60 })
    assert.equal(path.dirname(plain.path), path.join(dir, 'data', 'media'))
    assert.equal(frames(plain.path), 60, 'exactly the frames before the cut')
    assert.equal(frames(take), 84, 'the take itself is as it was')
    const forContinue = await handle('ranked1', 1, { forContinue: true })
    assert.deepEqual([forContinue.frames, (forContinue.frames - 5) % 17], [56, 0])
    assert.equal(frames(forContinue.path), 56)
    await assert.rejects(() => handle('short1', 1, { forContinue: true }), /^Error: The part without a cut is only 0\.5 s, too short to carry on from \(H3 needs about 1 s\)\.$/)
    assert.equal((await handle('short1', 1)).seconds, 0.5, 'the plain stretch still works')
    await assert.rejects(() => handle('uncut1', 1), /^Error: That take has no cut to cut around\. Rank the takes first\.$/)
    await assert.rejects(() => handle('ranked1', 2), /^Error: That take has no cut to cut around\./)
    await assert.rejects(() => handle('gone1', 1), /^Error: That take is gone\.$/)
  })
})

describe('window channels: Seedance prices', () => {
  let fake, dir, studio
  const near = (a, b, d = 0.0005) => assert.ok(Math.abs(a - b) < d, `${a} is not ${b}`)
  const job = (id, plan) => {
    fs.mkdirSync(path.join(dir, 'data', 'jobs'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'data', 'jobs', `${id}.json`), JSON.stringify({ id, kind: 'previews', plan, outputs: [] }))
  }
  before(async () => {
    fake = await startFakeComfy({ devices: 'mps', os: 'darwin', objectInfo: PARTNER })
    dir = tmp()
    studio = new Studio({ dataDir: path.join(dir, 'data'), resourcesDir: resources, comfyUrl: fake.url })
  })
  after(() => fake.close())

  test('[ipc:render:price] says a render on this computer is free and a Seedance take costs what ComfyUI\'s own formula gives, doubled for two takes and more for longer or bigger, queuing nothing', async () => {
    assertCopiesMain(assert, 'render:price', '(request) => studio.priceRender(request)')
    const ask = (over = {}) => studio.priceRender({ engine: 'seedance', prompt: 'x', character: 'none', mode: 'text', aspect: '16:9', tier: '720p', seconds: 5, previews: 1, ...over })
    assert.deepEqual(await studio.priceRender({ engine: 'h3' }), { paid: false, label: 'Free on this computer', min: 0, max: 0, nodes: [], unknown: [] })
    const one = await ask()
    assert.equal(one.paid, true)
    near(one.max, 1.6663)
    assert.equal(one.label, 'about $1.67 · 352 credits')
    assert.deepEqual(one.credits, { min: 352, max: 352 })
    const two = await ask({ previews: 2 })
    near(two.max, one.max * 2)
    assert.equal(two.credits.max, 703)
    assert.ok((await ask({ seconds: 10 })).max > one.max * 1.5)
    assert.ok((await ask({ tier: '1080p' })).max > one.max)
    await assert.rejects(() => ask({ seconds: 3 }), /^Error: Seedance makes 4 to 30 seconds\.$/)
    assert.equal(fake.prompts.length, 0, 'pricing queues nothing')
  })

  test('[ipc:render:priceFinish] prices finishing a Seedance draft at 1080p as a flat range the OK has to cover the top of, and says a take that is not a Seedance draft is free', async () => {
    assertCopiesMain(assert, 'render:priceFinish', '(opts) => studio.priceFinish(opts)')
    job('draftjob1', { engine: 'seedance', resolved: { draft: true, seconds: 5 }, request: { aspect: '16:9', audio: true } })
    job('h3job1', { engine: 'h3', resolved: {}, request: {} })
    job('seedfinal', { engine: 'seedance', resolved: { draft: false, seconds: 5 }, request: {} })
    const p = await studio.priceFinish({ jobId: 'draftjob1', way: 'seedance' })
    assert.equal(p.paid, true)
    near(p.min, 3.2864)
    near(p.max, 29.3964)
    assert.equal(p.label, '$3.29 to $29.40 · 693 to 6,203 credits')
    assert.ok(p.likelyUsd > 0 && p.likelyUsd < p.max, 'the likely 1080p figure is shown beside the range')
    for (const jobId of ['h3job1', 'seedfinal']) assert.deepEqual(await studio.priceFinish({ jobId, way: 'seedance' }), { paid: false, label: 'Free', min: 0, max: 0, nodes: [], unknown: [] }, jobId)
    assert.equal((await studio.priceFinish({ jobId: 'draftjob1', way: 'take' })).paid, false, 'using a take as it is costs nothing')
    await assert.rejects(() => studio.priceFinish({ jobId: 'nope' }), /^Error: No job nope$/)
    assert.equal(fake.prompts.length, 0)
  })
})
