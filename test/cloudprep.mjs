// The person's own cloud (src/service/cloudprep.js, the ComfyUI client's hook, resources/cloud/ivcloud.py and the
// gate's model routes), without a cloud: stand-in providers and a stand-in ComfyUI.
//   node test/cloudprep.mjs [python-with-aiohttp]
// The Python part (ivcloud_test.py, and gate.py's /iv/files and /iv/fetch) runs when a Python with aiohttp is
// given or found (IV Studio's voice engine on Windows).
import { spawn, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CloudPrep, augmentInfo, cloudCatalog, graphFiles, planFor, roomOnVolume, snapshotFiles } from '../src/service/cloudprep.js'
import { Comfy } from '../src/service/comfy.js'
import { RunPod } from '../src/service/runpod.js'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const RES = path.join(ROOT, 'resources')
const PY = process.argv[2] || path.join(process.env.APPDATA || '', 'IV Studio', 'voiceengine', 'venv', 'Scripts', 'python.exe')
let pass = 0
let fail = 0
const ok = (cond, what) => (cond ? (pass++, console.log(`  ok   ${what}`)) : (fail++, console.log(`  FAIL ${what}`)))
const read = (f) => JSON.parse(fs.readFileSync(path.join(RES, f), 'utf8'))
const manifest = read('models.json')
const cloudJson = read(path.join('cloud', 'cloud.json'))
const catalog = cloudCatalog(manifest, cloudJson)

// a saved /object_info from a fresh cloud: H3's files only, as setup leaves it
const combo = (list) => [list]
const snapshot = {
  UNETLoader: { input: { required: { unet_name: combo(['Minimax H3/minimax_h3_fl2va_pruned_int8_convrot.safetensors']) } } },
  CLIPLoader: { input: { required: { clip_name: combo(['qwen3vl_32b_minimax_h3_int4_convrot.safetensors']), type: combo(['minimax', 'flux2', 'qwen_image']) } } },
  VAELoader: { input: { required: { vae_name: combo(['minimax_h3_video_vae_fp16.safetensors']) } } },
  LoraLoaderModelOnly: { input: { required: { lora_name: combo(['MiniMax H3/Turbo/DMAD.safetensors', 'tess_mmh3-000040.safetensors']) } } },
  CheckpointLoaderSimple: { input: { required: { ckpt_name: combo([]) } } },
  SeedVR2LoadDiTModel: { input: { required: { model: ['COMBO', { options: [] }] } } },
  MiniMaxH3RefModsLoader: { input: { required: { mod_1: combo(['(none)', 'tess_visual']) } } },
  KSampler: { input: { required: { sampler_name: combo(['euler']) } } }
}

function catalogTests() {
  console.log('catalog and model lists')
  const ids = catalog.map((e) => e.id)
  ok(new Set(ids).size === ids.length, `catalog: ${ids.length} downloadable models, ids unique`)
  const files = catalog.map((e) => e.file)
  ok(new Set(files).size === files.length && ids.includes('qwen21_te') && !ids.includes('describer') && ids.includes('krea2_vae') && !ids.includes('relight_vae'), 'catalog: a file both lists name is one entry, with the cloud’s label (Qwen Image 2.1’s text encoder, not “describer”)')
  const flux = catalog.find((e) => e.id === 'flux2_unet')
  ok(flux.root === 'diffusion_models' && flux.rel === 'Flux 2/flux-2-klein-9b-fp8.safetensors' && flux.gated, 'catalog: a model is listed under its ComfyUI folder, by the name ComfyUI shows')
  ok(catalog.find((e) => e.id === 'ff_ltx_2_5_video_vae_bf16').gated && !catalog.find((e) => e.id === 'qwen21_unet').gated, 'catalog: LTX files are gated (cloud.json gatedRepos), Qwen Image is not')
  ok(catalog.filter((e) => e.required).every((e) => !manifest.models.find((m) => m.id === e.id)?.optional), 'catalog: only setup models are required')

  const info = augmentInfo(snapshot, { catalog, loras: ['Styles\\Cinematic.safetensors'], refmods: ['theo_visual'] })
  const unets = info.UNETLoader.input.required.unet_name[0]
  ok(unets.includes('Flux 2/flux-2-klein-9b-fp8.safetensors') && unets.includes('Qwen/qwen_image_2.1_int8_convrot.safetensors') && unets.includes('Minimax H3/minimax_h3_fl2va_pruned_int8_convrot.safetensors'), 'augment: diffusion models the cloud can download are offered beside the ones it has')
  ok(info.CheckpointLoaderSimple.input.required.ckpt_name[0].includes('SDXL/sd_xl_base_1.0.safetensors'), 'augment: an empty folder on a new volume still gets its models (checkpoints)')
  ok(info.SeedVR2LoadDiTModel.input.required.model[1].options.includes('seedvr2_ema_3b_fp16.safetensors'), 'augment: the new COMBO form is filled too (SeedVR2)')
  const loras = info.LoraLoaderModelOnly.input.required.lora_name[0]
  ok(loras.includes('Styles/Cinematic.safetensors') && loras.includes('Qwen 2.1/qwen-image-2.1-outpaint-v2.safetensors') && loras.filter((l) => l === 'MiniMax H3/Turbo/DMAD.safetensors').length === 1, 'augment: this PC’s LoRAs and the cloud’s are offered once each')
  const mods = info.MiniMaxH3RefModsLoader.input.required.mod_1[0]
  ok(mods.includes('theo_visual') && mods.includes('tess_visual') && mods.every((m) => !m.endsWith('.safetensors')), 'augment: RefMods are listed by name, as their loader does')
  ok(info.KSampler.input.required.sampler_name[0].length === 1, 'augment: lists that aren’t model folders are left alone')
  ok(snapshot.UNETLoader.input.required.unet_name[0].length === 1, 'augment: the saved lists themselves are not changed')
  const have = snapshotFiles(snapshot, catalog)
  ok(have.has('diffusion_models/Minimax H3/minimax_h3_fl2va_pruned_int8_convrot.safetensors') && have.has('loras/tess_mmh3-000040.safetensors') && have.has('refmods/tess_visual.safetensors') && !have.has('refmods/(none)'), 'snapshot: what the volume holds, read from its lists')
}

function graphTests() {
  console.log('what a graph needs')
  const graph = {
    1: { class_type: 'UNETLoader', inputs: { unet_name: 'Flux 2\\flux-2-klein-9b-fp8.safetensors' } },
    2: { class_type: 'CLIPLoader', inputs: { clip_name: 'qwen_3_8b_fp8mixed.safetensors', type: 'flux2' } },
    3: { class_type: 'VAELoader', inputs: { vae_name: 'flux2-vae.safetensors' } },
    4: { class_type: 'LoraLoaderModelOnly', inputs: { lora_name: 'Styles\\Cinematic.safetensors', model: ['1', 0] } },
    5: { class_type: 'PixaromaLoraLoader', inputs: { lora_state: JSON.stringify({ loras: [{ name: 'MiniMax H3\\tess\\tess.safetensors', on: true }, { name: 'off.safetensors', on: false }] }) } },
    6: { class_type: 'MiniMaxH3RefModsLoader', inputs: { mod_1: 'theo_visual', mod_2: '(none)' } },
    7: { class_type: 'VAELoader', inputs: { vae_name: 'minimax_h3_video_vae_fp16.safetensors' } },
    8: { class_type: 'SaveImage', inputs: { filename_prefix: 'x.png' } }
  }
  const files = graphFiles(graph)
  ok(files.some((f) => f.value === 'MiniMax H3/tess/tess.safetensors') && !files.some((f) => f.value === 'off.safetensors'), 'graph: LoRAs inside a Pixaroma state are found, switched-off ones skipped')
  const plan = planFor(graph, { catalog, have: snapshotFiles(snapshot, catalog) })
  ok(plan.download.map((e) => e.id).sort().join() === 'flux2_te,flux2_unet,flux2_vae', 'plan: the Flux.2 files the volume lacks are downloaded; H3’s VAE it has is not')
  ok(plan.upload.map((u) => u.remote).sort().join() === 'loras/MiniMax H3/tess/tess.safetensors,loras/Styles/Cinematic.safetensors,refmods/theo_visual.safetensors', 'plan: this PC’s LoRAs and RefMods the volume lacks are uploaded')
}

async function prepTests() {
  console.log('before a render')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-prep-'))
  const lora = path.join(dir, 'Cinematic.safetensors')
  fs.writeFileSync(lora, Buffer.alloc(4096, 7))
  const calls = []
  const provider = {
    name: 'runpod',
    download: async (entries, onEvent) => (calls.push(['download', entries.map((e) => e.id)]), onEvent({ id: entries[0].id, percent: 50 })),
    upload: async (file, remote, sha) => calls.push(['upload', remote, sha]),
    changed: async () => calls.push(['changed']),
    room: async (bytes) => roomOnVolume({ sizeGb: 100, usedBytes: 60e9, bytes, perGbMonth: 0.07 }),
    grow: async (toGb) => calls.push(['grow', toGb])
  }
  let answer = false
  const asked = []
  const events = []
  let hf = null
  const prep = new CloudPrep({
    dataDir: dir,
    provider,
    catalog,
    stamp: 's1',
    ask: async (q) => (asked.push(q), answer),
    localFile: async (kind, name) => (kind === 'loras' && name === 'Styles/Cinematic.safetensors' ? lora : null),
    localNames: async () => ({ loras: ['Styles/Cinematic.safetensors'], refmods: [] }),
    hfToken: () => hf,
    fetchInfo: async () => snapshot,
    onEvent: (e) => events.push(e)
  })
  const qwen = {
    1: { class_type: 'UNETLoader', inputs: { unet_name: 'Qwen/qwen_image_2.1_int8_convrot.safetensors' } },
    2: { class_type: 'CLIPLoader', inputs: { clip_name: 'qwen3vl_8b_int8_convrot.safetensors', type: 'qwen_image' } },
    3: { class_type: 'VAELoader', inputs: { vae_name: 'qwen_image_2.1_vae_bf16.safetensors' } },
    4: { class_type: 'LoraLoaderModelOnly', inputs: { lora_name: 'Styles\\Cinematic.safetensors' } }
  }
  const info = await prep.objectInfo('UNETLoader')
  ok(Object.keys(info).join() === 'UNETLoader' && info.UNETLoader.input.required.unet_name[0].includes('Qwen/qwen_image_2.1_int8_convrot.safetensors'), 'lists: one class, with what the cloud can download, from the saved lists (first time fetched once)')

  const declined = await prep.prepare(qwen).then(() => null, (e) => e)
  ok(declined?.code === 'declined' && !calls.some((c) => c[0] === 'download' || c[0] === 'upload'), 'a “no” downloads and uploads nothing, and the render isn’t sent')
  const q = asked[0]
  ok(q.downloads.length === 3 && Math.round(q.bytes / 1e9) === 17 && q.grow?.toGb > 100 && q.grow.monthlyUsd > 0, `the question names the 3 files, about 17 GB, and growing the storage from 100 to ${q.grow?.toGb} GB (+$${q.grow?.monthlyUsd} a month)`)

  answer = true
  const r = await prep.prepare(qwen)
  ok(r.downloaded.length === 3 && r.uploaded.join() === 'Styles/Cinematic.safetensors', 'a “yes” downloads the 3 models and uploads the LoRA')
  const order = calls.map((c) => c[0]).join(',')
  ok(order === 'grow,download,upload,changed', `storage grows first, then the download, the upload, then the provider hears the volume changed (${order})`)
  const sha = createHash('sha256').update(fs.readFileSync(lora)).digest('hex')
  ok(calls.find((c) => c[0] === 'upload')[2] === sha && prep.ledger().uploads['loras/Styles/Cinematic.safetensors']?.sha256 === sha, 'the upload is checked by SHA-256 and recorded')
  ok(events.some((e) => e.percent === 50) && events.at(-1).state === 'done', 'the window hears the progress, then done')

  calls.length = 0
  asked.length = 0
  const again = await prep.prepare(qwen)
  ok(!again.downloaded.length && !again.uploaded.length && !calls.length && !asked.length, 'the same render again: nothing downloaded, uploaded or asked')

  const flux = { 1: { class_type: 'UNETLoader', inputs: { unet_name: 'Flux 3/flux3-image-klein-int8-convrot.safetensors' } } }
  const gated = await prep.prepare(flux).then(() => null, (e) => e)
  ok(gated?.code === 'needs_hf_token' && /licence/.test(gated.message) && /huggingface\.co\/black-forest-labs/.test(gated.message) && !asked.length, 'a gated model without a Hugging Face token: says what to do, asks nothing, downloads nothing')
  hf = 'hf_x'
  ok((await prep.prepare(flux)).downloaded.join() === 'flux3_unet', 'with a token it downloads')

  const missing = await prep.prepare({ 1: { class_type: 'LoraLoaderModelOnly', inputs: { lora_name: 'nowhere.safetensors' } } }).then(() => null, (e) => e)
  ok(missing?.code === 'missing_file' && /nowhere/.test(missing.message), 'a LoRA neither in the cloud nor on this PC stops the render with its name')

  // two renders at once wait for each other: one download, not two
  calls.length = 0
  const sdxl = { 1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'SDXL/sd_xl_base_1.0.safetensors' } } }
  await Promise.all([prep.prepare(sdxl), prep.prepare(sdxl)])
  ok(calls.filter((c) => c[0] === 'download').length === 1, 'two renders needing the same model at once download it once')
  fs.rmSync(dir, { recursive: true, force: true })

  ok(roomOnVolume({ sizeGb: 350, usedBytes: 60e9, bytes: 20e9, perGbMonth: 0.07 }) === null, 'room: what fits needs no growing')
  const g = roomOnVolume({ sizeGb: 100, usedBytes: 60e9, bytes: 43e9, perGbMonth: 0.07 })
  ok(g.toGb === 150 && g.monthlyUsd === 3.5 && g.totalMonthlyUsd === 10.5, 'room: 60 + 43 GB + 25 GB for ComfyUI, with 10% to spare, grows 100 → 150 GB, $3.50 more a month')
}

async function comfyTests() {
  console.log('the ComfyUI client in the person’s own cloud')
  const seen = []
  const srv = await new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      seen.push(req.url)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ prompt_id: 'p1' }))
    })
    s.listen(0, '127.0.0.1', () => resolve(s))
  })
  try {
    const c = new Comfy(`http://127.0.0.1:${srv.address().port}`, 'test', 'tok')
    ok(c.ownCloud && !c.hosted && !new Comfy('x', 'y', null, 'k').ownCloud && !new Comfy('x').ownCloud, 'ownCloud: a gate token, not Comfy Cloud, not this PC')
    const order = []
    c.prep = { objectInfo: async () => (order.push('lists'), { UNETLoader: {} }), prepare: async () => order.push('prepare') }
    ok(Object.keys(await c.objectInfo()).join() === 'UNETLoader' && !seen.length, 'model lists come from the prep, not the cloud (no GPU woken)')
    await c.submit({ 1: { class_type: 'SaveImage', inputs: {} } })
    ok(order.join() === 'lists,prepare' && seen.join() === '/prompt', 'submit: the models are made ready first, then the prompt is sent')
    c.prep = { objectInfo: async () => ({}), prepare: async () => Promise.reject(Object.assign(new Error('no'), { code: 'declined' })) }
    seen.length = 0
    ok((await c.submit({}).then(() => false, (e) => e.code === 'declined')) && !seen.length, 'submit: a declined download sends nothing')
  } finally {
    srv.close()
  }
}

function bundleTests() {
  console.log('what the cloud is given')
  const rp = new RunPod({ resourcesDir: RES, key: () => 'k' })
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-bundle-'))
  fs.writeFileSync(path.join(dir, 'b.tgz'), Buffer.from(rp.bundle(), 'base64'))
  const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar'
  execFileSync(tar, ['-xzf', path.join(dir, 'b.tgz'), '-C', dir])
  ok(['ivcloud.py', 'gate.py', 'runpod_boot.py', 'models.json', 'cloud.json', path.join('ComfyUI-IV-Studio', '__init__.py'), path.join('ComfyUI-Viggle-Remake', 'nodes.py')].every((f) => fs.existsSync(path.join(dir, f))), 'RunPod: the pod gets ivcloud.py and both packs that ship inside IV Studio')
  fs.rmSync(dir, { recursive: true, force: true })
  const body = rp.podBody({ gpu: 'NVIDIA L40S', volume: { id: 'v', dataCenter: 'X' }, token: 't', idleSeconds: 300, hf: 'hf_x' })
  ok(body.env.HF_TOKEN === 'hf_x' && !('HF_TOKEN' in rp.podBody({ gpu: 'NVIDIA L40S', volume: { id: 'v', dataCenter: 'X' }, token: 't', idleSeconds: 300 }).env), 'RunPod: the Hugging Face token goes to the pod only when there is one')
  const app = fs.readFileSync(path.join(RES, 'cloud', 'modal_app.py'), 'utf8')
  ok(/add_local_python_source\("ivcloud"\)/.test(app) && /iv-studio-hf/.test(app) && /fetch_models\(ids: str = ""\)/.test(app) && /def list_models/.test(app), 'Modal: CPU functions carry ivcloud.py; downloads by id, with the Hugging Face secret; a listing')
}

async function pythonTests() {
  console.log('Python: ivcloud.py and the gate’s model routes')
  if (!fs.existsSync(PY)) return console.log(`  skip (no Python with aiohttp at ${PY})`)
  const port = 18600 + Math.floor(Math.random() * 300)
  try {
    const out = execFileSync(PY, [path.join(ROOT, 'test', 'ivcloud_test.py'), String(port)], { encoding: 'utf8' })
    const m = out.match(/(\d+) passed, (\d+) failed/)
    ok(m && m[2] === '0', `ivcloud_test.py: ${m ? m[0] : out.slice(-300)}`)
  } catch (e) {
    ok(false, `ivcloud_test.py:\n${e.stdout || ''}${e.stderr || ''}`)
  }

  // the gate in RunPod mode, with manifests that point at a local file host
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-gate-fetch-'))
  const body = Buffer.from(Array.from({ length: 2 * 1024 * 1024 }, (_, i) => (i * 31) % 256))
  const host = await new Promise((resolve) => {
    const s = http.createServer((req, res) => (res.writeHead(200, { 'Content-Length': body.length }), res.end(body)))
    s.listen(0, '127.0.0.1', () => resolve(s))
  })
  const sha = createHash('sha256').update(body).digest('hex')
  fs.writeFileSync(path.join(tmp, 'models.json'), JSON.stringify({ models: [{ id: 'm1', label: 'Test model', folder: 'checkpoints/Test', match: 'm1.safetensors', url: `http://127.0.0.1:${host.address().port}/m1`, size: body.length, sha256: sha, optional: true }], node_packs: [] }))
  fs.writeFileSync(path.join(tmp, 'cloud.json'), JSON.stringify({ extraModels: [] }))
  const models = path.join(tmp, 'models')
  const gport = 18000 + Math.floor(Math.random() * 500)
  const url = `http://127.0.0.1:${gport}`
  const gate = spawn(PY, [path.join(RES, 'cloud', 'gate.py')], { env: { ...process.env, PYTHONPATH: path.join(RES, 'cloud'), IV_MANIFEST_DIR: tmp, IV_TOKEN: 'tok', IV_PLATFORM: 'runpod', IV_STATUS_FILE: path.join(tmp, 'status.json'), IV_MODELS_DIR: models, IV_GATE_PORT: String(gport), IV_UPSTREAM: 'http://127.0.0.1:9' }, windowsHide: true })
  let err = ''
  gate.stderr.on('data', (d) => (err += d))
  try {
    const rp = new RunPod({ resourcesDir: RES, key: () => 'unused' })
    for (let i = 0; i < 50 && !(await rp.health(url)); i++) await new Promise((r) => setTimeout(r, 200))
    ok((await fetch(`${url}/iv/files`)).status === 401 && (await fetch(`${url}/iv/fetch`, { method: 'POST', body: '{}' })).status === 401, 'files and fetch need the token')
    const unknown = await fetch(`${url}/iv/fetch`, { method: 'POST', headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: ['nope'] }) })
    ok(unknown.status === 400, 'fetch: an id that isn’t in the manifests is refused')
    const progress = []
    const done = await rp.fetchModels(url, 'tok', ['m1'], { pollMs: 200, onProgress: (f) => progress.push(f.state) })
    const landed = path.join(models, 'checkpoints', 'Test', 'm1.safetensors')
    ok(done.join() === 'm1' && fs.existsSync(landed) && fs.readFileSync(landed).equals(body), 'fetch: the model downloads onto the volume, byte for byte, checked')
    ok(progress.at(-1) === 'done', 'fetch: IV Studio follows it until done')
    const files = await rp.files(url, 'tok')
    ok(files['checkpoints/Test/m1.safetensors'] === body.length, 'files: the volume’s model files, with sizes')
    const h = await rp.health(url)
    ok(h.fetch?.state === 'done' && !JSON.stringify(h).includes('tok'), 'health: shows the last download, and no token')
  } finally {
    gate.kill()
    host.close()
    fs.rmSync(tmp, { recursive: true, force: true })
  }
  if (err.includes('Traceback')) ok(false, `gate printed a traceback:\n${err}`)
  for (const f of ['modal_app.py', 'ivcloud.py']) {
    try {
      execFileSync(PY, ['-c', `import ast,sys; ast.parse(open(sys.argv[1], encoding='utf-8').read())`, path.join(RES, 'cloud', f)])
      ok(true, `${f} compiles`)
    } catch (e) {
      ok(false, `${f}: ${e.stderr}`)
    }
  }
}

catalogTests()
graphTests()
await prepTests()
await comfyTests()
bundleTests()
await pythonTests()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
