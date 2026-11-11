// Character training on RunPod without RunPod: a mock of RunPod's REST API, and the real runpod_train.py run on
// this computer with a stand-in trainer. Drives IV Studio's own code: the training volume and pod, waiting for the
// pod, uploading the set, starting, following the log to the end, listing and downloading checkpoints, Train more
// finding the last saved state, stopping, and the pod's token and path guards.
//   node test/training-runpod.mjs [python]
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { RunPod } from '../src/service/runpod.js'
import { FIZGIG, Trainings, trainScript } from '../src/service/training.js'

const RES = path.resolve('resources')
const PY =
  process.argv[2] ||
  [path.join(process.env.USERPROFILE || '', 'Fizgig', 'venv', 'Scripts', 'python.exe'), path.join(process.env.APPDATA || '', 'IV Studio', 'voiceengine', 'venv', 'Scripts', 'python.exe')].find((p) => fs.existsSync(p)) ||
  (process.platform === 'win32' ? 'python' : 'python3')
let n = 0
const ok = (cond, name) => {
  assert.ok(cond, name)
  n++
  console.log('ok', name)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-train-rp-'))
const ws = path.join(tmp, 'workspace')
const port = 18700 + Math.floor(Math.random() * 200)
const RUN = 'theo_x_1'

// the stand-in trainer: log lines like Fizgig's, a checkpoint each epoch, a saved state at the end
const fake = path.join(tmp, 'fake_train.py')
fs.writeFileSync(
  fake,
  `import os, time
RUN = os.environ["IV_RUN"]
os.makedirs("loras", exist_ok=True)
for e in range(1, 4):
    for s in range(1, 3):
        print(f"epoch {e}/3 step={(e - 1) * 2 + s}", flush=True)
        time.sleep(0.3)
    open(f"loras/{RUN}_mmh3-{e:06d}.safetensors", "wb").write(b"lora" * 1000 + bytes([e]))
os.makedirs(f"loras/{RUN}_mmh3-000003-state", exist_ok=True)
print("done", flush=True)
`
)

// the real pod script, started like RunPod would: with the env the pod was created with
let gate = null
const startPod = (env) => {
  gate?.kill()
  gate = spawn(PY, [path.join(RES, 'cloud', 'runpod_train.py')], {
    env: { ...process.env, ...env, IV_WORKSPACE: ws, IV_PORT: String(port), IV_TRAIN_CMD: `"${PY}" "${fake}"`, IV_SKIP_SETUP: '1', IV_IDLE_SECONDS: '600' },
    windowsHide: true
  })
}
startPod({ IV_TOKEN: 'tok-123', IV_RUN: RUN, IV_MODE: 'train' })
const local = `http://127.0.0.1:${port}`

// RunPod's REST API, mocked; the pod's public address is routed to the local script
const calls = []
const fetchImpl = async (url, init = {}) => {
  url = String(url)
  if (url.includes('.proxy.runpod.net')) return fetch(url.replace(/^https:\/\/[^/]+/, local), init)
  // pods from a template go through REST v1 (they stay linked to it); the rest through v2
  if (url === 'https://rest.runpod.io/v1/pods' && init.method === 'POST') {
    calls.push('POST v1 /pods')
    const body = JSON.parse(init.body)
    const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } })
    calls.push(`pod ${body.gpuTypeIds[0]} template=${body.templateId} commit=${body.env.IV_FIZGIG_COMMIT} vol=${body.networkVolumeId} ${body.env.IV_MODE} run=${body.env.IV_RUN}`)
    if (body.gpuTypeIds[0] === 'NVIDIA H100 80GB HBM3') return json({ error: 'There are no longer any instances available with the requested specifications.' }, 400)
    startPod({ IV_TOKEN: body.env.IV_TOKEN, IV_RUN: body.env.IV_RUN, IV_MODE: body.env.IV_MODE })
    return json({ id: 'pod1', costPerHr: 1.09, templateId: body.templateId })
  }
  const route = url.replace('https://api.runpod.io/v2', '')
  calls.push(`${init.method || 'GET'} ${route.split('?')[0]}`)
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  if (route === '/network-volumes' && (init.method || 'GET') === 'GET') return json(calls.filter((c) => c === 'POST /network-volumes').length ? [{ id: 'vol1', name: 'iv-studio-train', dataCenter: 'EU-RO-1' }] : [])
  if (route === '/network-volumes') return json({ id: 'vol1', name: 'iv-studio-train', dataCenter: 'EU-RO-1', ...JSON.parse(init.body) })
  if (route.startsWith('/catalog/datacenters')) return json([{ id: 'EU-RO-1', networkVolumeTypes: ['standard'], gpuAvailability: [{ id: 'NVIDIA L40S', availability: 'HIGH' }] }])
  if (route === '/pods' && init.method === 'POST') {
    const body = JSON.parse(init.body)
    calls.push(`pod ${body.gpu.id} ${body.image} ${body.env.IV_MODE} run=${body.env.IV_RUN}`)
    if (body.gpu.id === 'NVIDIA H100 80GB HBM3') return json({ detail: 'no GPU available with the requested capacity' }, 400)
    startPod({ IV_TOKEN: body.env.IV_TOKEN, IV_RUN: body.env.IV_RUN, IV_MODE: body.env.IV_MODE })
    return json({ id: 'pod1', cost: 1.09 })
  }
  if (route.startsWith('/pods/') && init.method === 'DELETE') return json({})
  return json({ error: 'unexpected ' + route }, 404)
}
const rp = new RunPod({ resourcesDir: RES, key: () => 'rpa_test', fetchImpl })

// a training record ready to go, with a small set on disk
const data = path.join(tmp, 'data')
const tr = new Trainings({ dataDir: data, resourcesDir: RES, studio: { loraRoot: async () => path.join(tmp, 'comfy-loras') }, onLog: () => {} })
tr.runpod = rp
const id = 'abc123'
const ds = path.join(tmp, 'ds')
fs.mkdirSync(ds)
for (let k = 1; k <= 5; k++) {
  fs.writeFileSync(path.join(ds, `still_${k}.png`), Buffer.alloc(3000, k))
  fs.writeFileSync(path.join(ds, `still_${k}.txt`), `th30l16, a man, scene ${k}`)
}
tr.buildDataset = async () => ({ dir: ds, stills: 5, clips: 3, items: 8 })
tr.write({ id, name: 'Theo X', trigger: 'th30l16', who: 'a man', stills: [], clips: [], tests: [], faceCandidates: [], checkpoints: [], jobs: {} })

try {
  for (let k = 0; k < 60; k++) {
    try {
      if ((await fetch(`${local}/iv/health`)).ok) break
    } catch {}
    await sleep(250)
  }
  const h0 = await (await fetch(`${local}/iv/health`)).json()
  ok(h0.gate === 'ok' && h0.stage === 'waiting' && h0.run === RUN, 'pod: health says it waits for the set, without a token')
  ok((await fetch(`${local}/iv/log`)).status === 401, 'pod: everything else needs the token')
  const auth = { Authorization: 'Bearer tok-123' }
  ok((await fetch(`${local}/iv/upload?path=${encodeURIComponent('datasets/other_run/x.png')}&offset=0`, { method: 'PUT', headers: auth, body: 'x' })).status === 400, 'pod: uploads only into this run’s folders')
  ok((await fetch(`${local}/iv/upload?path=${encodeURIComponent(`train/${RUN}/../../etc/x.sh`)}&offset=0`, { method: 'PUT', headers: auth, body: 'x' })).status === 400, 'pod: no climbing out of the workspace')
  ok((await fetch(`${local}/iv/file?path=${encodeURIComponent('models/x.safetensors')}`, { headers: auth })).status === 404, 'pod: files come only from train/')
  ok((await fetch(`${local}/iv/start`, { method: 'POST', headers: auth })).status === 400, 'pod: no start before train.sh is there')

  gate.kill()
  await sleep(500)
  // the real path: volume, pod (the taken GPU falls back), wait, upload, start, follow to the end
  await tr.startTraining(id, { gpu: 'NVIDIA H100 80GB HBM3', epochs: 3, options: { where: 'runpod', checkpoints: 10 } })
  await tr.runs.get(id)
  const t = tr.get(id)
  ok(t.train.state === 'done', `run: ends done (${t.train.state} ${t.train.error || ''})`)
  ok(calls.includes('POST /network-volumes') && calls.some((c) => c.startsWith(`pod NVIDIA L40S template=${FIZGIG.template} commit=${FIZGIG.commit} vol=vol1 train run=theo_x_abc123_1`)), 'run: makes the training volume, and a pod from Fizgig’s RunPod template (v1, so it stays linked) on the next free GPU')
  // the image is pinned by digest, and Modal trains on the same one
  const app = fs.readFileSync(new URL('../resources/cloud/train_app.py', import.meta.url), 'utf8')
  ok(
    new RegExp(`^ghcr\\.io/shootthesound/fizgig:${FIZGIG.version.replace(/\./g, '\\.')}@sha256:[0-9a-f]{64}$`).test(FIZGIG.image) && app.includes(`from_registry("${FIZGIG.image}")`) && app.includes(`FIZGIG_COMMIT = "${FIZGIG.commit}"`) && /^[0-9a-f]{40}$/.test(FIZGIG.commit),
    'Modal builds on the same pinned Fizgig image and commit as RunPod'
  )
  ok(t.train.gpu === 'NVIDIA L40S' && t.train.pod?.id === 'pod1', 'run: records the GPU it got and the pod')
  // the files the pod got
  const runDir = path.join(ws, 'train', 'theo_x_abc123_1')
  ok(fs.readdirSync(path.join(ws, 'datasets', 'theo_x_abc123_1')).length === 10, 'upload: the whole set reached the pod, checksummed')
  const shGot = fs.readFileSync(path.join(runDir, 'train.sh'), 'utf8')
  ok(shGot === trainScript({ name: 'theo_x_abc123_1', epochs: 3, saveEvery: 1, options: t.train.options, base: '/workspace' }).replace(/\r\n/g, '\n'), 'upload: train.sh is the /workspace version of the recipe')
  ok(fs.readFileSync(path.join(runDir, 'dataset.toml'), 'utf8').includes('image_directory = "/workspace/datasets/theo_x_abc123_1"'), 'upload: dataset.toml points at the pod’s copy')
  ok(t.train.progress?.epoch === 3 && t.train.progress?.epochs === 3, 'follow: progress read from the pod’s log')
  ok(t.checkpoints.map((c) => c.epoch).join(',') === '1,2,3', 'checkpoints: listed from the pod')
  // download two of them into ComfyUI's loras folder
  await tr.fetchCheckpoints(id, [2, 3])
  const got = path.join(tmp, 'comfy-loras', 'MiniMax H3', 'theo_x', 'theo_x_abc123_1_mmh3-000003.safetensors')
  ok(fs.existsSync(got) && fs.readFileSync(got).equals(fs.readFileSync(path.join(runDir, 'loras', 'theo_x_abc123_1_mmh3-000003.safetensors'))), 'download: checkpoints arrive byte for byte')
  ok(tr.get(id).checkpoints.filter((c) => c.lora).length === 2, 'download: they become usable LoRAs')
  // Train more finds the saved state on the pod
  const last = await tr.lastState(id)
  ok(last?.epoch === 3 && last.dir.endsWith('-000003-state'), 'train more: finds the last saved state')
  // stop: the pod is told, then deleted
  await tr.stopRunPod(id)
  ok(calls.includes('DELETE /pods/pod1') && tr.get(id).train.state === 'stopped', 'stop: deletes the pod and marks it stopped')
} finally {
  gate?.kill()
  await sleep(300)
  fs.rmSync(tmp, { recursive: true, force: true })
}
console.log(`training-runpod: ${n} checks passed`)
