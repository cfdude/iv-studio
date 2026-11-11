// Cloud mode on the user's own RunPod account, beside Modal (cloud.js). RunPod has no scale-to-zero web
// server, so IV Studio runs ComfyUI in an on-demand pod instead: a network volume in one data center holds
// ComfyUI, its node packs and the H3 models (installed by the first pod, kept for the next), and each wake
// starts a pod from RunPod's official PyTorch image with this app version's resources/cloud folder packed
// into an environment variable. The pod's gate (gate.py) asks for IV Studio's token, reports how far the boot
// got at /iv/health and deletes the pod once it has been idle, so the GPU is billed only while it's up.
// Everything goes through RunPod's REST API v2 with the user's API key (stored encrypted by the app).
import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const API = 'https://api.runpod.io/v2'
// REST v1, only to create a pod from a template and keep it linked to that template (training pods from Fizgig's)
export const API_V1 = 'https://rest.runpod.io/v1'
export const IMAGE = 'runpod/pytorch:1.0.2-cu1281-torch280-ubuntu2404'
export const VOLUME_NAME = 'iv-studio'
export const VOLUME_GB = 100 // the H3 models are about 60 GB; ComfyUI, its Python and renders take the rest
// RunPod's network storage price (per GB a month, under 1 TB; runpod.io/pricing, 2026-11-10), for the grow question
export const VOLUME_PER_GB_MONTH = 0.07
export const POD_PREFIX = 'iv-studio'
const PORT = 8189
const CHUNK = 64 * 1024 * 1024 // RunPod's proxy refuses request bodies over 100 MB

// GPUs that hold MiniMax H3 comfortably, in the order IV Studio falls back through when the chosen one is out
// of stock in the volume's data center. Prices are RunPod's Secure Cloud list prices (2026-11-03, per hour,
// billed by the second; the RTX 5090 checked 2026-11-06); the Cloud page shows the live ones from RunPod's
// catalog when it can reach it. The 5090 is Blackwell: the pod's torch comes from the CUDA 12.8 index, which has it.
export const GPUS = [
  { id: 'NVIDIA L40S', label: 'L40S · 48 GB', perHour: 1.09, note: 'Recommended: fits H3 in memory, best value' },
  { id: 'NVIDIA RTX 6000 Ada Generation', label: 'RTX 6000 Ada · 48 GB', perHour: 0.99, note: 'Same memory as the L40S, a little slower' },
  { id: 'NVIDIA A100 80GB PCIe', label: 'A100 · 80 GB', perHour: 1.79, note: 'More memory headroom for long sequences' },
  { id: 'NVIDIA H100 80GB HBM3', label: 'H100 · 80 GB', perHour: 3.99, note: 'About twice as fast, about four times the price' },
  { id: 'NVIDIA GeForce RTX 5090', label: 'RTX 5090 · 32 GB', perHour: 1.19, note: 'The newest GeForce: more memory than the 4090; often short on stock' },
  { id: 'NVIDIA GeForce RTX 4090', label: 'RTX 4090 · 24 GB', perHour: 0.89, note: 'The cheapest; the same card IV Studio is built on' }
]

export class RunPod {
  // key: () => the user's RunPod API key. fetchImpl and api are for tests.
  constructor({ resourcesDir, key, onLog, fetchImpl = fetch, api = API, chunk = CHUNK }) {
    this.chunk = chunk
    this.resourcesDir = resourcesDir
    this.key = key
    this.onLog = onLog || (() => {})
    this.fetch = fetchImpl
    this.api = api
  }

  async req(route, { method = 'GET', json, v1 = false } = {}) {
    const key = this.key()
    if (!key) throw new Error('Add your RunPod API key first.')
    const res = await this.fetch((v1 ? API_V1 : this.api) + route, {
      method,
      headers: { Authorization: `Bearer ${key}`, ...(json ? { 'Content-Type': 'application/json' } : {}) },
      body: json ? JSON.stringify(json) : undefined
    })
    const text = await res.text()
    let body = null
    try {
      body = text ? JSON.parse(text) : null
    } catch {}
    if (!res.ok) {
      const why = body?.detail || body?.title || body?.error || text.slice(0, 300)
      if (res.status === 401 || res.status === 403) throw Object.assign(new Error('RunPod refused the API key. Check it on RunPod’s Settings → API Keys page.'), { status: res.status })
      throw Object.assign(new Error(`RunPod ${method} ${route.split('?')[0]} ${res.status}: ${why}`), { status: res.status, body })
    }
    return body
  }

  static list(body, ...keys) {
    if (Array.isArray(body)) return body
    for (const k of keys) if (Array.isArray(body?.[k])) return body[k]
    return []
  }

  // Checks the key (any read works); returns how many network volumes the account has.
  async check() {
    const vols = RunPod.list(await this.req('/network-volumes'), 'networkVolumes', 'items', 'data')
    return { volumes: vols.length }
  }

  // The curated GPUs with RunPod's live price and stock, and which data centers have each.
  async catalog() {
    const body = await this.req('/catalog/gpus?include=AVAILABILITY&product=POD&cloud=SECURE&minCudaVersion=12.8')
    const live = new Map(RunPod.list(body, 'gpus').map((g) => [g.id, g]))
    return GPUS.map((g) => {
      const l = live.get(g.id)
      return { ...g, perHour: l?.price?.secure || g.perHour, inStock: !!l && l.availability !== 'NONE', dataCenters: (l?.dataCenters || []).map((d) => d.id) }
    })
  }

  // A data center that can hold a network volume and has the chosen GPU now (or, failing that, another of
  // ours), preferring the one with the most of our GPUs so later wakes have somewhere to fall back to.
  async pickDataCenter(gpu) {
    const dcs = RunPod.list(await this.req('/catalog/datacenters?include=GPU_AVAILABILITY'), 'dataCenters')
    const ours = new Set(GPUS.map((g) => g.id))
    const scored = dcs
      .filter((d) => (d.networkVolumeTypes || []).length)
      .map((d) => {
        const have = (d.gpuAvailability || []).filter((g) => g.availability !== 'NONE').map((g) => g.id)
        return { id: d.id, hasChosen: have.includes(gpu), count: have.filter((id) => ours.has(id)).length }
      })
      .filter((d) => d.count > 0)
      .sort((a, b) => b.hasChosen - a.hasChosen || b.count - a.count)
    if (!scored.length) throw new Error('No RunPod data center with network storage has an H3-ready GPU free right now. Try again in a few minutes.')
    return scored[0].id
  }

  // The account's iv-studio volume, or a new one (VOLUME_GB in dataCenter). Storage bills until it's deleted.
  async ensureVolume(dataCenter) {
    const vols = RunPod.list(await this.req('/network-volumes'), 'networkVolumes', 'items', 'data')
    const have = vols.find((v) => v.name === VOLUME_NAME)
    if (have) return have
    this.onLog(`Creating your ${VOLUME_GB} GB network volume "${VOLUME_NAME}" in ${dataCenter}…`)
    return this.req('/network-volumes', { method: 'POST', json: { name: VOLUME_NAME, size: VOLUME_GB, dataCenter } })
  }

  // resources/cloud (+ models.json and IV Studio's node pack) as a base64 .tar.gz, so the pod runs exactly
  // this version's files without IV Studio publishing anything. Windows' own tar writes it.
  // only: just these files of resources/cloud (the training pod needs runpod_train.py alone)
  bundle(only = null) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-runpod-'))
    try {
      for (const f of only || ['runpod_boot.py', 'gate.py', 'ivcloud.py', 'voicehost.py', 'extra_model_paths.yaml', 'cloud.json']) fs.copyFileSync(path.join(this.resourcesDir, 'cloud', f), path.join(dir, f))
      if (!only) {
        fs.copyFileSync(path.join(this.resourcesDir, 'models.json'), path.join(dir, 'models.json'))
        // the voice engine's worker, the same file the PC runs
        fs.copyFileSync(path.join(this.resourcesDir, 'python', 'voice_server.py'), path.join(dir, 'voice_server.py'))
        for (const p of bundledPacks(this.resourcesDir)) fs.cpSync(path.join(this.resourcesDir, p.bundled), path.join(dir, p.dir), { recursive: true, filter: (s) => !s.includes('__pycache__') })
      }
      const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar'
      const out = path.join(os.tmpdir(), `iv-runpod-${randomBytes(4).toString('hex')}.tgz`)
      execFileSync(tar, ['-czf', out, '-C', dir, '.'], { windowsHide: true })
      const b64 = fs.readFileSync(out).toString('base64')
      fs.rmSync(out, { force: true })
      return b64
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }

  // hf: the person's Hugging Face token, for gated model files (the pod's own downloads at boot)
  podBody({ gpu, volume, token, idleSeconds, hf = null }) {
    if (typeof token !== 'string' || !token) throw new Error('A cloud GPU needs an access token. Set up RunPod again.')
    return {
      name: `${POD_PREFIX}-${Date.now().toString(36)}`,
      image: IMAGE,
      cloud: 'SECURE',
      gpu: { id: gpu, count: 1, minCudaVersion: '12.8' },
      dataCenterIds: [volume.dataCenter],
      disk: 40,
      mounts: { network: [{ volumeId: volume.id, path: '/workspace' }] },
      ports: [`${PORT}/http`],
      env: { IV_TOKEN: token, IV_IDLE_SECONDS: String(idleSeconds), IV_BUNDLE: this.bundle(), ...(hf ? { HF_TOKEN: hf } : {}) },
      entrypoint: ['bash', '-c'],
      cmd: ['mkdir -p /opt/iv && echo "$IV_BUNDLE" | base64 -d | tar -xz -C /opt/iv && exec python3 /opt/iv/runpod_boot.py']
    }
  }

  static url = (podId) => `https://${podId}-${PORT}.proxy.runpod.net`

  // IV Studio's pods that are up or coming up.
  async pods() {
    const all = RunPod.list(await this.req('/pods'), 'pods', 'items', 'data')
    return all
      .filter((p) => String(p.name || '').startsWith(POD_PREFIX) && !['EXITED', 'TERMINATED'].includes(p.status))
      .map((p) => ({ id: p.id, status: p.status, gpu: p.gpu?.id, perHour: p.cost, startedAt: p.startedAt || p.createdAt, url: RunPod.url(p.id) }))
  }

  // Starts a pod on the chosen GPU, or the first of ours that's free in the volume's data center.
  async createPod({ gpu, volume, token, idleSeconds, hf = null }) {
    if (typeof token !== 'string' || !token) throw new Error('A cloud GPU needs an access token. Set up RunPod again.')
    const order = [gpu, ...GPUS.map((g) => g.id).filter((id) => id !== gpu)]
    let last
    for (const id of order) {
      try {
        const pod = await this.req('/pods', { method: 'POST', json: this.podBody({ gpu: id, volume, token, idleSeconds, hf }) })
        if (id !== gpu) this.onLog(`${GPUS.find((g) => g.id === gpu)?.label || gpu} was taken in ${volume.dataCenter}; started a ${GPUS.find((g) => g.id === id)?.label || id} instead.`)
        return { id: pod.id, gpu: id, perHour: pod.cost, url: RunPod.url(pod.id) }
      } catch (err) {
        last = err
        // out of capacity: try the next GPU; anything else (a bad key, a bad request) stops here
        if (!(err.status >= 400 && err.status < 500 && /capacity|available|no (gpu|machine|instance)|stock|resources/i.test(err.message))) throw err
      }
    }
    throw new Error(`No H3-ready GPU is free in ${volume.dataCenter} right now. Try again in a few minutes. (${last?.message})`)
  }

  // What the pod's gate says about the boot ({gate, stage, detail, percent}), or null while it's unreachable.
  async health(url) {
    try {
      const res = await this.fetch(`${url}/iv/health`, { signal: AbortSignal.timeout(15000) })
      if (!res.ok) return null
      const h = await res.json()
      return h?.gate === 'ok' ? h : null
    } catch {
      return null
    }
  }

  // Waits for the pod's ComfyUI, logging each new boot stage. The first boot installs and downloads (30+ min).
  async waitReady(url, { timeoutMs = 3 * 3600 * 1000, onStage } = {}) {
    const t0 = Date.now()
    let said = ''
    for (;;) {
      const h = await this.health(url)
      const line = h ? `${h.stage || 'booting'}: ${h.detail || ''}` : 'Waiting for the pod to boot…'
      if (line !== said) {
        this.onLog(line)
        onStage?.(h)
        said = line
      }
      // the setup's progress view follows every answer (model percentages change within a stage)
      this.onHealth?.(h)
      if (h?.stage === 'ready') return { seconds: Math.round((Date.now() - t0) / 1000) }
      if (h?.stage === 'error') throw new Error(`The cloud pod stopped: ${h.detail}`)
      if (Date.now() - t0 > timeoutMs) throw new Error('The cloud pod took too long to start.')
      await new Promise((r) => setTimeout(r, 5000))
    }
  }

  // Deletes IV Studio's pods now (Shut down GPU). The volume, and everything on it, stays.
  async stopAll() {
    const running = await this.pods()
    for (const p of running) {
      this.onLog(`Shutting down cloud GPU ${p.id}…`)
      await this.req(`/pods/${p.id}`, { method: 'DELETE' })
    }
    return { stopped: running.length }
  }

  // The account's iv-studio volume ({id, size (GB), dataCenter}), or null.
  async volume(id) {
    const vols = RunPod.list(await this.req('/network-volumes'), 'networkVolumes', 'items', 'data')
    return vols.find((v) => v.id === id) || null
  }

  // Makes the volume bigger (RunPod can't make one smaller). Only with the person's OK: storage bills monthly.
  async growVolume(id, sizeGb) {
    this.onLog(`Growing your network volume to ${sizeGb} GB…`)
    return this.req(`/network-volumes/${id}`, { method: 'PATCH', json: { size: sizeGb } })
  }

  // The model files on the volume ({path: bytes}), through the running pod's gate.
  async files(url, token) {
    const res = await this.fetch(`${url}/iv/files`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(120000) })
    if (!res.ok) throw new Error(`Listing your cloud storage failed (${res.status}).`)
    return res.json()
  }

  // Downloads models (by id) onto the volume in the running pod, and waits. onProgress gets the gate's report.
  async fetchModels(url, token, ids, { hf = null, onProgress, pollMs = 3000 } = {}) {
    const start = await this.fetch(`${url}/iv/fetch`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ids, hf: hf || '' }) })
    if (!start.ok && start.status !== 409) throw new Error(`Starting the download in the cloud failed (${start.status}): ${(await start.text()).slice(0, 300)}`)
    for (;;) {
      await new Promise((r) => setTimeout(r, pollMs))
      const res = await this.fetch(`${url}/iv/fetch`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) }).catch(() => null)
      if (!res?.ok) continue
      const f = await res.json()
      onProgress?.(f)
      if (f.state === 'done') return f.done || ids
      if (f.state === 'error') throw new Error(f.error || 'The download in the cloud stopped.')
    }
  }

  // A local file (a character LoRA or RefMod) into the volume's models folder, through the running pod's
  // gate in 64 MB chunks, then checked against its SHA-256 there.
  async uploadModel(url, token, localFile, remotePath) {
    this.onLog(`Uploading ${path.basename(localFile)}…`)
    const size = fs.statSync(localFile).size
    const hash = createHash('sha256')
    const fd = fs.openSync(localFile, 'r')
    try {
      for (let offset = 0; offset < size || offset === 0; offset += this.chunk) {
        const buf = Buffer.alloc(Math.min(this.chunk, size - offset))
        fs.readSync(fd, buf, 0, buf.length, offset)
        hash.update(buf)
        const res = await this.fetch(`${url}/iv/upload?path=${encodeURIComponent(remotePath)}&offset=${offset}`, { method: 'PUT', headers: { Authorization: `Bearer ${token}` }, body: buf })
        if (!res.ok) throw new Error(`Uploading ${path.basename(localFile)} failed (${res.status}): ${(await res.text()).slice(0, 200)}`)
        if (size === 0) break
      }
    } finally {
      fs.closeSync(fd)
    }
    const res = await this.fetch(`${url}/iv/upload?path=${encodeURIComponent(remotePath)}&sha256=${hash.digest('hex')}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) throw new Error(`Saving ${path.basename(localFile)} in the cloud failed (${res.status}): ${(await res.text()).slice(0, 200)}`)
    return res.json()
  }
}

// The node packs that ship inside IV Studio (its own, Viggle Remake's): models.json's node_packs with "bundled".
export function bundledPacks(resourcesDir) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(resourcesDir, 'models.json'), 'utf8'))
    return (m.node_packs || []).filter((p) => p.bundled && !p.windowsOnly && p.cloud !== false && fs.existsSync(path.join(resourcesDir, p.bundled)))
  } catch {
    return []
  }
}
