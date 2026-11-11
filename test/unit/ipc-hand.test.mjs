// Window channels whose handler in src/main/index.js is several lines (task 6.3). Each test runs the service calls the
// handler makes, in this process, on the fake ComfyUI and temp folders; what a handler adds in Electron (a dialog, the
// window) is the page tier's. Each test says in its name what it proves.
//   node --test test/unit/ipc-hand.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import ffmpegStatic from 'ffmpeg-ffprobe-static'
import { ModelInstaller } from '../../src/service/models.js'
import { comfyUp, startApp, waitUp } from '../../src/service/comfylauncher.js'
import { statsReadout } from '../../src/service/gpu.js'
import { harnessStatus } from '../../src/service/harness.js'
import { MODEL_GROUPS, recommend, scanHardware } from '../../src/service/hardware.js'
import { CONTEXT_IR_PRICE, ollamaStatus, pullModel, setOllamaSource, unloadOllama } from '../../src/service/prompter.js'
import { comboOptions } from '../../src/service/setup.js'
import { Studio } from '../../src/service/studio.js'
import { findFizgig, MODEL_FILES, Trainings } from '../../src/service/training.js'
import { startFakeComfy } from '../fakes/comfyui.mjs'
import { startFakeGithub, startFakeOllama } from '../fakes/outside.mjs'
import { tempDirReal } from '../fakes/tmp.mjs'
import { assertCopiesMain } from './main-source.mjs'

const tmp = () => tempDirReal('iv-hand-')
const write = (file, text = 'x') => (fs.mkdirSync(path.dirname(file), { recursive: true }), fs.writeFileSync(file, text), file)
const resources = path.resolve('resources')

describe('window channels: faces and Fizgig', () => {
  let fake, dir, studio, trainings
  before(async () => {
    fake = await startFakeComfy({ devices: 'mps', os: 'darwin', models: { diffusion_models: [], text_encoders: [], vae: [], loras: [] } })
    dir = tmp()
    studio = new Studio({ dataDir: dir, resourcesDir: resources, comfyUrl: fake.url })
    trainings = new Trainings({ dataDir: dir, resourcesDir: resources, studio, ffmpeg: ffmpegStatic.ffmpegPath, ffprobe: ffmpegStatic.ffprobePath })
  })
  after(() => fake.close())

  test('[ipc:remake:faces] offers each character that has a face picture, its own or the ready-made one, and leaves out one with none', () => {
    const own = write(path.join(dir, 'own-face.png'), 'png')
    studio.saveCharacters([
      { id: 'mine', name: 'Mine', picture: own, lora: 'mine.safetensors' },
      { id: 'blank', name: 'Blank', picture: path.join(dir, 'gone.png') },
      { id: 'tess', name: 'Tess' }
    ])
    // This is a copy of main's glue for remake:faces. main (src/main/index.js) starts Electron, so its handler cannot be imported;
    // the drift check below reads main's source and fails if the copied logic changes there.
    assertCopiesMain(assert, 'remake:faces', "studio.characters().map((c) => ({ id: c.id, name: c.name, characterId: c.id, picture: studio.facePicture(c, resources), lora: !!c.lora })).filter((f) => f.picture)", { "resourcesDir(path.join(app.getAppPath(), 'resources'))": 'resources' })
    const faces = studio.characters().map((c) => ({ id: c.id, name: c.name, characterId: c.id, picture: studio.facePicture(c, resources), lora: !!c.lora })).filter((f) => f.picture)
    assert.deepEqual(faces.map((f) => f.id), ['mine', 'tess'], 'the ready-made Tess shows through the catalogue; the character with a missing file does not')
    assert.equal(faces[0].picture, own)
    assert.equal(faces[0].lora, true)
    assert.equal(faces[1].lora, false)
    assert.ok(fs.existsSync(faces[1].picture), 'the catalogue picture is a real file')
    assert.ok(faces[1].picture.startsWith(path.join(resources, 'characters')))
  })

  test('[ipc:replace:characterFaces] lists the picked face of each trained character, copying one that lives in ComfyUI to the training\'s folder, and skips one with no face', async () => {
    const withLocal = trainings.create({ name: 'Local face' })
    const local = write(path.join(dir, 'local-face.png'), 'local')
    const t1 = trainings.get(withLocal.id)
    t1.face = { file: { path: local } }
    trainings.write(t1)
    const withView = trainings.create({ name: 'ComfyUI face' })
    fake.setView(Buffer.from('from comfyui'))
    const t2 = trainings.get(withView.id)
    t2.face = { file: { url: `${fake.url}/view?filename=face_00001_.png&subfolder=&type=output` } }
    trainings.write(t2)
    const noFace = trainings.create({ name: 'No face yet' })
    // A copy of main's glue for replace:characterFaces (main starts Electron, so it cannot be imported); the drift check
    // reads main's source and fails if the copied logic changes there. main's DATA folder is this test's dir.
    assertCopiesMain(assert, 'replace:characterFaces', "const out = [] for (const t of trainings.list()) { if (!t.cover) continue try { out.push({ id: t.id, name: t.name, characterId: t.characterId, picture: await studio.localCopy(t.cover, path.join(dir, 'trainings', t.id, 'stills')) }) } catch {} } return out", { DATA: 'dir' })
    const out = []
    for (const t of trainings.list()) {
      if (!t.cover) continue
      try {
        out.push({ id: t.id, name: t.name, characterId: t.characterId, picture: await studio.localCopy(t.cover, path.join(dir, 'trainings', t.id, 'stills')) })
      } catch {}
    }
    const by = Object.fromEntries(out.map((f) => [f.id, f]))
    assert.equal(by[withLocal.id].picture, local, 'a file on this computer is used where it is')
    assert.equal(by[withView.id].picture, path.join(dir, 'trainings', withView.id, 'stills', 'face_00001_.png'))
    assert.equal(fs.readFileSync(by[withView.id].picture, 'utf8'), 'from comfyui')
    assert.equal(by[noFace.id], undefined)
  })

  test('[ipc:training:localCheck] finds Fizgig by its venv, and says which of the five H3 training files this ComfyUI lacks until each is in a model folder', async () => {
    const home = tmp()
    assert.equal(findFizgig('', { home, platform: 'darwin' }), null)
    const fiz = path.join(tmp(), 'Fizgig')
    write(path.join(fiz, 'src', 'fizgig', 'families', 'train.py'))
    assert.equal(findFizgig(fiz, { home, platform: 'darwin' }), null, 'no venv, no Fizgig')
    write(path.join(fiz, 'venv', 'bin', 'python'))
    assert.deepEqual(findFizgig(fiz, { home, platform: 'darwin' }), { dir: fiz, python: path.join(fiz, 'venv', 'bin', 'python') })
    const all = Object.values(MODEL_FILES)
    const first = await trainings.localFiles()
    assert.deepEqual(first.missing.sort(), [...all].sort(), 'nothing is there yet')
    write(path.join(fake.dataDir, 'models', 'diffusion_models', 'sub', MODEL_FILES.dit))
    write(path.join(fake.dataDir, 'models', 'vae', MODEL_FILES.vvae))
    const some = await trainings.localFiles()
    assert.deepEqual(some.missing.sort(), [MODEL_FILES.te, MODEL_FILES.avae, MODEL_FILES.adapter].sort())
    assert.equal(some.files.dit, path.join(fake.dataDir, 'models', 'diffusion_models', 'sub', MODEL_FILES.dit), 'found a level down')
    fake.close()
    await assert.rejects(trainings.localFiles(), /Start ComfyUI first/)
  })
})

const combo = (name, options) => ({ input: { required: { [name]: [options] } } })

describe('window channels: writer, hardware and system', () => {
  let fake, ollama, studio
  before(async () => {
    fake = await startFakeComfy({ devices: 'mps', os: 'darwin', objectInfo: { KSamplerSelect: combo('sampler_name', ['euler', 'dpmpp_2m']), BasicScheduler: combo('scheduler', ['simple', 'karras']) } })
    ollama = await startFakeOllama({ models: [{ name: 'gemma3:12b', size: 8_000_000_000 }, { name: 'qwen3:8b', size: 5_000_000_000 }], loaded: ['gemma3:12b'] })
    setOllamaSource(() => ollama.url)
    studio = new Studio({ dataDir: tmp(), resourcesDir: resources, comfyUrl: fake.url })
  })
  after(async () => {
    setOllamaSource(() => '')
    await fake.close()
    await ollama.close()
  })

  test('[ipc:prompts:status] says Ollama is running at the saved address with its models and which can look at pictures, then that it is not when nothing answers; the writers\' install flags and the Context IR price come with it', async () => {
    const up = await ollamaStatus()
    assert.equal(up.url, ollama.url)
    assert.equal(up.running, true)
    assert.equal(up.local, true)
    assert.deepEqual(up.models.map((m) => [m.name, m.vision]), [['gemma3:12b', true], ['qwen3:8b', false]])
    const h = harnessStatus()
    assert.deepEqual(Object.keys(h), ['claude', 'codex'])
    for (const k of ['claude', 'codex']) assert.ok(typeof h[k].installed === 'boolean' && Array.isArray(h[k].models), k)
    assert.match(CONTEXT_IR_PRICE, /^about \$0\.02 a prompt/)
    const gone = await startFakeOllama()
    setOllamaSource(() => gone.url)
    await gone.close()
    const down = await ollamaStatus()
    assert.deepEqual([down.running, down.models], [false, []])
    setOllamaSource(() => ollama.url)
  })

  test('[ipc:prompts:pull][event:prompts:pull] reports each step of a model download as it arrives and ends true, and says what Ollama refused', async () => {
    const steps = []
    assert.equal(await pullModel('qwen3:8b', (ev) => steps.push({ model: 'qwen3:8b', ...ev })), true)
    assert.deepEqual(steps.map((e) => e.status), ['pulling manifest', 'downloading', 'downloading', 'success'])
    assert.deepEqual(steps[2], { model: 'qwen3:8b', status: 'downloading', total: 1000, completed: 1000 })
    assert.equal(ollama.requests.find((r) => r.path === '/api/pull').json.model, 'qwen3:8b')
    await assert.rejects(pullModel('missing', () => {}), /Ollama: pull model manifest: file does not exist/)
  })

  test('[ipc:h3:samplers] lists the samplers and schedulers ComfyUI offers for the Settings pickers, and none when its nodes are not there', async () => {
    const read = async () => {
      const [k, b] = await Promise.all([studio.comfy.objectInfo('KSamplerSelect'), studio.comfy.objectInfo('BasicScheduler')])
      return { samplers: comboOptions(k, 'KSamplerSelect', 'sampler_name') || [], schedulers: comboOptions(b, 'BasicScheduler', 'scheduler') || [] }
    }
    assert.deepEqual(await read(), { samplers: ['euler', 'dpmpp_2m'], schedulers: ['simple', 'karras'] })
    fake.setObjectInfo({})
    assert.deepEqual(await read(), { samplers: [], schedulers: [] })
  })

  test('[ipc:hardware:scan] reads this computer without a GPU tool and turns the scan into a tier, verdicts and downloads', async () => {
    const folder = tmp()
    const scan = await scanHardware({ platform: 'darwin', electronGpu: { gpuDevice: [{ vendorId: 0x106b, deviceString: 'Apple M3 Max', active: true }] }, installs: { comfyRunning: true, modelsKnown: false, modelsPresent: [], modelSizes: {} }, comfyFolder: folder, videosFolder: folder })
    assert.equal(scan.os.platform, 'darwin')
    assert.deepEqual(scan.gpus.map((g) => [g.vendor, g.name]), [['apple', 'Apple M3 Max']])
    assert.ok(scan.ram > 0 && scan.cpu.threads > 0)
    assert.equal(scan.modelsDrive.folder, folder)
    assert.ok(scan.modelsDrive.free > 0, 'the drive the folder is on has a free size')
    assert.equal(scan.installs.comfyRunning, true)
    const rec = recommend(scan)
    assert.ok(rec.tier.id && rec.tier.title)
    assert.ok(rec.verdicts.length > 0 && rec.verdicts.every((v) => v.id && v.say))
    assert.ok(Array.isArray(rec.downloads))
    assert.ok(MODEL_GROUPS.every((g) => g.ids.length > 0))
  })

  test('[ipc:system:stats] reads the GPU the title bar meter shows from ComfyUI\'s system stats, and nothing when ComfyUI is not answering', async () => {
    const stats = await studio.comfy.systemStats({ timeout: 4000 })
    const r = statsReadout(stats)
    assert.equal(r.gpu.name, 'Apple GPU')
    assert.ok(r.gpu.total > 0 && r.gpu.free >= 0 && r.gpu.free <= r.gpu.total)
    assert.deepEqual(statsReadout(null), { gpu: null })
    const off = new Studio({ dataDir: tmp(), resourcesDir: resources, comfyUrl: 'http://127.0.0.1:9' })
    assert.equal(await off.comfy.systemStats({ timeout: 500 }).catch(() => null), null)
  })

  test('[ipc:system:free] asks ComfyUI to unload its models, and Ollama to drop what it holds, and says what it unloaded', async () => {
    await studio.comfy.freeMemory()
    const asked = fake.requests.filter((r) => r.path === '/free')
    assert.equal(asked.length, 1)
    assert.deepEqual(asked[0].json, { unload_models: true, free_memory: true })
    assert.deepEqual(await unloadOllama(), ['gemma3:12b'])
    assert.ok(ollama.requests.some((r) => r.path === '/api/generate' && r.json.model === 'gemma3:12b' && r.json.keep_alive === 0))
    assert.deepEqual(await unloadOllama(), [], 'nothing left in memory the second time')
  })
})

describe('window channels: starting ComfyUI', () => {
  // The Start ComfyUI button runs a launcher (open -a on a ComfyUI.app, or its .sh script or main.py), which spawns a
  // program, so the row has a gaps reason (spawns the ComfyUI launcher) and no row id here. This proves what
  // startComfy does after the launch with the launcher given: it waits for the address, and says so when nothing answers.
  test('startApp opens the ComfyUI app through the launcher it is given and waits until the address answers, and a launcher that never brings it up ends in the Settings words', async () => {
    const fake = await startFakeComfy({ devices: 'mps', os: 'darwin' })
    try {
      const launched = []
      const up = await startApp('/Applications/ComfyUI.app', { launch: (file, opts) => launched.push([file, opts.platform]), wait: waitUp, url: fake.url })
      assert.deepEqual(launched, [['/Applications/ComfyUI.app', 'darwin']])
      assert.ok(up.seconds >= 0 && up.seconds < 5, `answered at once: ${JSON.stringify(up)}`)
      assert.equal(await comfyUp(fake.url), true)
      await assert.rejects(startApp('/Applications/ComfyUI.app', { launch: () => {}, wait: async () => { throw new Error('timed out') }, url: 'http://127.0.0.1:9' }), /The ComfyUI app opened, but nothing answered at http:\/\/127\.0\.0\.1:9 within 3 minutes/)
    } finally {
      await fake.close()
    }
  })
})

describe('window channels: model downloads', () => {
  let fake, host, studio, updates, installer
  const manifest = (url) => ({ models: [{ id: 'tiny', label: 'Tiny', match: 'tiny.safetensors', folder: 'diffusion_models/Test', url: `${url}/tiny.safetensors` }, { id: 'other', label: 'Other', match: 'other.safetensors', folder: 'vae', url: `${url}/other.safetensors` }, { id: 'blocked', label: 'Blocked', match: 'blocked.safetensors', folder: 'vae', url: 'https://models.example.invalid/blocked.safetensors' }] })
  const settled = async (id) => {
    for (let i = 0; i < 200 && !['done', 'error', 'paused'].includes(installer.status()[id]?.status); i++) await new Promise((r) => setTimeout(r, 10))
    return installer.status()[id]
  }
  before(async () => {
    fake = await startFakeComfy({ devices: 'mps', os: 'darwin', models: { diffusion_models: [], vae: [] } })
    host = await startFakeGithub({ raw: { '/tiny.safetensors': 'tiny weights', '/other.safetensors': 'other weights' } })
    studio = new Studio({ dataDir: tmp(), resourcesDir: resources, comfyUrl: fake.url })
  })
  after(async () => {
    await fake.close()
    await host.close()
  })
  const fresh = (url = host.url) => {
    updates = []
    installer = new ModelInstaller({ comfy: studio.comfy, manifest: manifest(url), onUpdate: (u) => updates.push(u) })
  }

  test('[ipc:models:status] says nothing about a model not asked for, then each asked-for one with its state', async () => {
    fresh()
    assert.deepEqual(installer.status(), {})
    installer.enqueue(['tiny'])
    assert.equal(installer.status().tiny.status === 'queued' || installer.status().tiny.status === 'downloading', true)
    assert.equal(installer.status().other, undefined)
    assert.equal((await settled('tiny')).status, 'done')
  })

  test('[ipc:models:download][event:models:update] puts the file in the ComfyUI folder for its kind, tells the window each step, skips one that is there, and says what is wrong with an unknown model or a host that refuses', async () => {
    const tiny = path.join(fake.dataDir, 'models', 'diffusion_models', 'Test', 'tiny.safetensors')
    fs.rmSync(tiny, { force: true })
    fresh()
    installer.enqueue(['tiny', 'other'])
    assert.equal((await settled('tiny')).status, 'done')
    assert.equal((await settled('other')).status, 'done')
    assert.equal(fs.readFileSync(tiny, 'utf8'), 'tiny weights')
    assert.equal(fs.readFileSync(path.join(fake.dataDir, 'models', 'vae', 'other.safetensors'), 'utf8'), 'other weights')
    assert.equal(installer.status().tiny.path, tiny)
    assert.ok(!fs.existsSync(`${tiny}.part`), 'no half-written file is left')
    // each update carries the model's id and its state: the payload main sends the window as models:update
    assert.deepEqual([...new Set(updates.filter((u) => u.id === 'tiny').map((u) => u.status))].sort(), ['done', 'downloading', 'queued', 'verifying'].sort())
    assert.ok(updates.every((u) => typeof u.id === 'string' && typeof u.status === 'string'))
    assert.ok(updates.find((u) => u.id === 'tiny' && u.status === 'done').verified === false, 'no published checksum to check against')
    const before = updates.length
    installer.enqueue(['tiny'])
    assert.equal((await settled('tiny')).status, 'done', 'a file already there is done at once')
    assert.ok(updates.length > before)
    assert.throws(() => installer.enqueue(['nope']), /Unknown model "nope"\./)
    installer.enqueue(['blocked'])
    const refused = await settled('blocked')
    assert.equal(refused.status, 'error')
    assert.ok(refused.error, 'with the reason')
    assert.ok(!fs.existsSync(path.join(fake.dataDir, 'models', 'vae', 'blocked.safetensors')))
  })

  test('[ipc:models:cancel] takes a waiting model off the queue and pauses it, and stops the one that is downloading', async () => {
    fs.rmSync(path.join(fake.dataDir, 'models', 'diffusion_models', 'Test', 'tiny.safetensors'), { force: true })
    fresh()
    installer.enqueue(['tiny', 'other'])
    assert.equal(installer.cancel('other')['other'].status, 'paused', 'the second one never started')
    assert.deepEqual(installer.queue, [])
    installer.cancel('tiny')
    assert.equal((await settled('tiny')).status, 'paused')
    assert.equal(installer.running, null)
    assert.ok(!fs.existsSync(path.join(fake.dataDir, 'models', 'diffusion_models', 'Test', 'tiny.safetensors')), 'the stopped download left no finished file')
  })
})
