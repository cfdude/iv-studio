// Guided model install: downloads a manifest model from its upstream host straight into the ComfyUI
// models folder, one at a time. A download writes to <file>.part, resumes from it with an HTTP Range
// request, and is only renamed into place once its SHA-256 matches the one Hugging Face publishes
// (the X-Linked-ETag of an LFS/Xet file). Nothing is deleted except a .part that failed its check.
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable, Transform } from 'node:stream'

// The ComfyUI folder a model goes in: prefer the folder named exactly like the manifest's model type
// (ComfyUI lists unet before diffusion_models), from the first install ComfyUI reports.
export async function modelTarget(comfy, model) {
  const [kind, ...sub] = model.folder.split('/')
  const folders = await comfy.req('/experiment/models')
  const entry = folders.find((f) => f.name === kind)
  if (!entry?.folders?.length) throw new Error(`ComfyUI has no "${kind}" models folder.`)
  const dir = entry.folders.find((f) => path.basename(f) === kind) || entry.folders[0]
  return path.join(dir, ...sub, model.match)
}

// Size and SHA-256 as Hugging Face publishes them, without downloading.
export async function upstreamInfo(url) {
  const res = await fetch(url, { method: 'HEAD', redirect: 'manual' })
  const sha256 = res.headers.get('x-linked-etag')?.replace(/"/g, '')
  const size = Number(res.headers.get('x-linked-size') || res.headers.get('content-length')) || null
  if (res.status === 401 || res.status === 403) throw new Error('The host refused the download. The model may need its licence accepted on its page first.')
  if (res.status >= 400) throw new Error(`The host answered ${res.status}.`)
  return { sha256: /^[0-9a-f]{64}$/.test(sha256 || '') ? sha256 : null, size }
}

async function hashFile(file, hash) {
  await pipeline(fs.createReadStream(file), new Transform({ transform: (chunk, _e, cb) => (hash.update(chunk), cb()) }))
}

// A checksum pinned in models.json wins; Hugging Face's x-linked-etag covers the rest.
// GitHub release downloads send no checksum, so those entries must pin one.
export const expectedSha256 = (model, probed) => model.sha256 || probed || null

export class ModelInstaller {
  constructor({ comfy, manifest, onUpdate }) {
    this.comfy = comfy
    this.manifest = manifest
    this.onUpdate = onUpdate || (() => {})
    this.state = {} // id -> {status: queued|downloading|verifying|done|error|paused, received, total, error}
    this.queue = []
    this.running = null
  }

  set(id, patch) {
    this.state[id] = { ...this.state[id], ...patch }
    this.onUpdate({ id, ...this.state[id] })
  }

  status = () => this.state

  enqueue(ids) {
    for (const id of ids) {
      if (!this.manifest.models.some((m) => m.id === id)) throw new Error(`Unknown model "${id}".`)
      if (this.queue.includes(id) || this.running?.id === id) continue
      this.queue.push(id)
      this.set(id, { status: 'queued', error: null })
    }
    this.next()
    return this.state
  }

  cancel(id) {
    this.queue = this.queue.filter((q) => q !== id)
    if (this.running?.id === id) this.running.abort.abort()
    else if (this.state[id]) this.set(id, { status: 'paused' })
    return this.state
  }

  async next() {
    if (this.running || !this.queue.length) return
    const id = this.queue.shift()
    const abort = new AbortController()
    this.running = { id, abort }
    try {
      await this.download(this.manifest.models.find((m) => m.id === id), abort.signal)
    } catch (err) {
      this.set(id, abort.signal.aborted ? { status: 'paused' } : { status: 'error', error: err.message })
    } finally {
      this.running = null
      this.next()
    }
  }

  async download(model, signal) {
    const target = await modelTarget(this.comfy, model)
    if (fs.existsSync(target)) return this.set(model.id, { status: 'done', path: target })
    const info = await upstreamInfo(model.url)
    const sha256 = expectedSha256(model, info.sha256)
    const probed = info.size
    const size = probed || model.size || null // GitHub's redirect answers the probe with no length
    const part = `${target}.part`
    fs.mkdirSync(path.dirname(target), { recursive: true })

    const free = fs.statfsSync(path.dirname(target))
    const have = fs.existsSync(part) ? fs.statSync(part).size : 0
    if (size && free.bavail * free.bsize < size - have + 1024 ** 3) throw new Error(`Not enough free space on ${path.parse(target).root} for ${(size / 1024 ** 3).toFixed(1)} GB.`)

    // Resume: the bytes already on disk go into the hash first.
    const hash = createHash('sha256')
    let received = have
    if (have) {
      this.set(model.id, { status: 'verifying', received, total: size, path: target })
      await hashFile(part, hash)
    }
    if (!size || received < size) {
      const res = await fetch(model.url, { headers: received ? { Range: `bytes=${received}-` } : {}, signal })
      if (!res.ok) throw new Error(`Download failed: the host answered ${res.status}.`)
      if (received && res.status !== 206) throw new Error('The host would not resume this download. Delete the .part file and try again.')
      let last = 0
      const counter = new Transform({
        transform: (chunk, _e, cb) => {
          hash.update(chunk)
          received += chunk.length
          if (Date.now() - last > 500) {
            last = Date.now()
            this.set(model.id, { status: 'downloading', received, total: size, path: target })
          }
          cb(null, chunk)
        }
      })
      await pipeline(Readable.fromWeb(res.body), counter, fs.createWriteStream(part, { flags: have ? 'a' : 'w' }), { signal })
    }

    this.set(model.id, { status: 'verifying', received, total: size })
    const digest = hash.digest('hex')
    if (sha256 && digest !== sha256) {
      fs.rmSync(part, { force: true })
      throw new Error('The download did not match its published checksum and was removed. Try again.')
    }
    fs.renameSync(part, target)
    this.set(model.id, { status: 'done', received, total: size, path: target, sha256: digest, verified: !!sha256 })
  }
}
