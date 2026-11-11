// The person's own cloud (Modal, RunPod) holds only what it has been given: H3's models from setup, and the rest
// the first time a render needs it. This makes that work for every feature without each one knowing about it:
//
//  - Model lists without a GPU. The ComfyUI client answers /object_info from a copy saved the last time the cloud
//    was up (snapshot), with every model the cloud can download (models.json and cloud.json's extraModels) and the
//    LoRAs and RefMods on this PC added to its file lists. So pages show what will work, and features pick their
//    files as they do on a PC, without waking a GPU just to draw a page.
//  - Before a render (Comfy.submit): the graph's model files are looked up. A cloud model the volume doesn't have
//    yet is downloaded there, after the person agrees to the size (and, on RunPod, to growing the storage when it
//    won't fit). A LoRA or RefMod from this PC is uploaded, checked by SHA-256 and recorded, once.
//
// The provider (Modal or RunPod) is an adapter set up by the app (src/main): download(entries, onEvent),
// upload(file, remotePath), list() -> {path: bytes} (optional), changed() after the volume changed (Modal stops an
// idle container so the next one sees the new files), room(bytes) -> null or {toGb, monthlyUsd}, grow(toGb).
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const MODEL_FILE = /\.(safetensors|gguf|sft|pth|pt|ckpt|bin)$/i

// Loader inputs a folder's files are offered in, besides the manifests' own loader/altLoader. A folder can be
// empty on a new volume, so its inputs can't be found from what they list.
const FOLDER_INPUTS = {
  diffusion_models: [['UNETLoader', 'unet_name']],
  text_encoders: [['CLIPLoader', 'clip_name'], ['DualCLIPLoader', 'clip_name1'], ['DualCLIPLoader', 'clip_name2']],
  vae: [['VAELoader', 'vae_name']],
  loras: [['LoraLoaderModelOnly', 'lora_name'], ['LoraLoader', 'lora_name']],
  checkpoints: [['CheckpointLoaderSimple', 'ckpt_name']],
  upscale_models: [['UpscaleModelLoader', 'model_name']],
  SEEDVR2: [['SeedVR2LoadDiTModel', 'model'], ['SeedVR2LoadVAEModel', 'model']],
  refmods: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => ['MiniMaxH3RefModsLoader', `mod_${i}`])
}
const REFMOD_INPUT = /^mod_\d+$/

const slash = (v) => String(v).replace(/\\/g, '/')
const base = (v) => slash(v).split('/').pop()

// Every model the cloud can download: {id, label, size, root (ComfyUI's folder), rel (the name ComfyUI lists it
// by), file (its path on the volume), sha256, gated, required}.
export function cloudCatalog(manifest, cloud) {
  const out = []
  const entry = (m, required) => {
    if (!m.url) return
    const [root, ...sub] = slash(m.folder).split('/')
    const rel = [...sub, m.match].join('/')
    out.push({ id: m.id, label: m.label, size: m.size || 0, root, rel, file: `${root}/${rel}`, sha256: m.sha256 || null, gated: m.gated || null, required, loader: m.loader, altLoader: m.altLoader })
  }
  // cloud.json's own entries first: where both lists name the same file (Qwen Image 2.1's text encoder is also
  // Replace's describer), one entry stays, with the cloud's label
  for (const m of cloud?.extraModels || []) entry(m, !!m.required)
  for (const m of manifest?.models || []) if (!out.some((e) => e.file === `${slash(m.folder)}/${m.match}`)) entry(m, !m.optional)
  // models.json's own entries from a gated Hugging Face repo (cloud.json gatedRepos)
  for (const e of out) {
    const repo = (manifest?.models || []).find((m) => m.id === e.id)?.url?.match(/huggingface\.co\/([^/]+\/[^/]+)\//)?.[1]
    if (!e.gated && repo && (cloud?.gatedRepos || []).includes(repo)) e.gated = `https://huggingface.co/${repo}`
  }
  return out
}

// The combo inputs each folder's files appear in: the static table, the catalog's loaders, and any input whose
// options already list a file from that folder.
export function folderInputs(info, catalog) {
  const by = new Map()
  const add = (root, cls, input) => {
    if (!info?.[cls]) return
    const list = by.get(root) || by.set(root, []).get(root)
    if (!list.some(([c, i]) => c === cls && i === input)) list.push([cls, input])
  }
  for (const [root, pairs] of Object.entries(FOLDER_INPUTS)) for (const [c, i] of pairs) add(root, c, i)
  for (const e of catalog) for (const l of [e.loader, e.altLoader].filter(Boolean)) add(e.root, ...l.split('.'))
  const rels = new Map()
  for (const e of catalog) (rels.get(e.root) || rels.set(e.root, new Set()).get(e.root)).add(e.rel)
  for (const [cls, spec] of Object.entries(info || {})) {
    for (const group of ['required', 'optional']) {
      for (const [input, def] of Object.entries(spec?.input?.[group] || {})) {
        const opts = comboOf(def)
        if (!opts) continue
        for (const [root, set] of rels) if (opts.some((o) => set.has(slash(o)))) add(root, cls, input)
      }
    }
  }
  return by
}

// A combo input's options (old [list] and new ['COMBO', {options}] forms), or null.
export function comboOf(def) {
  if (Array.isArray(def?.[0])) return def[0]
  if (def?.[0] === 'COMBO' && Array.isArray(def?.[1]?.options)) return def[1].options
  return null
}
function setCombo(def, list) {
  if (Array.isArray(def?.[0])) def[0] = list
  else if (def?.[0] === 'COMBO') def[1].options = list
}

// The files a snapshot shows on the volume, as root-relative paths ("loras/x.safetensors").
export function snapshotFiles(info, catalog) {
  const have = new Set()
  for (const [root, pairs] of folderInputs(info, catalog)) {
    for (const [cls, input] of pairs) {
      const def = info[cls]?.input?.required?.[input] || info[cls]?.input?.optional?.[input]
      for (const o of comboOf(def) || []) if (o && o !== '(none)' && o !== 'None') have.add(`${root}/${root === 'refmods' && !MODEL_FILE.test(o) ? `${slash(o)}.safetensors` : slash(o)}`)
    }
  }
  return have
}

// info with every downloadable model, and this PC's LoRAs and RefMods, added to the lists they belong in. Gated
// models are listed too: a render that needs one without a Hugging Face token says what to do (prepareNow).
export function augmentInfo(info, { catalog, loras = [], refmods = [] }) {
  const out = structuredClone(info || {})
  const extra = new Map()
  for (const e of catalog) (extra.get(e.root) || extra.set(e.root, []).get(e.root)).push(e.rel)
  extra.set('loras', [...(extra.get('loras') || []), ...loras.map(slash)])
  extra.set('refmods', [...(extra.get('refmods') || []).map((r) => r.replace(/\.safetensors$/, '')), ...refmods])
  for (const [root, pairs] of folderInputs(out, catalog)) {
    const add = extra.get(root) || []
    for (const [cls, input] of pairs) {
      for (const group of ['required', 'optional']) {
        const def = out[cls]?.input?.[group]?.[input]
        const opts = comboOf(def)
        if (!opts) continue
        const seen = new Set(opts.map(slash))
        setCombo(def, [...opts, ...add.filter((a) => !seen.has(slash(a)) && (seen.add(slash(a)), true))])
      }
    }
  }
  return out
}

// The model files a graph names: {value, kind: 'model' | 'refmod'}. Also the LoRAs inside a Pixaroma state string.
export function graphFiles(graph) {
  const out = []
  const push = (value, kind = 'model') => out.push({ value: slash(value), kind })
  for (const node of Object.values(graph || {})) {
    for (const [k, v] of Object.entries(node?.inputs || {})) {
      if (typeof v !== 'string' || !v) continue
      if (node.class_type === 'MiniMaxH3RefModsLoader' && REFMOD_INPUT.test(k)) {
        if (v !== '(none)' && v !== 'None') push(v, 'refmod')
      } else if (MODEL_FILE.test(v)) push(v)
      else if (v.startsWith('{') && v.includes('"loras"')) {
        try {
          for (const l of JSON.parse(v).loras || []) if (l?.name && l.on !== false) push(l.name)
        } catch {}
      }
    }
  }
  return out
}

// What a graph needs before it can run on the volume: downloads (catalog entries the volume lacks) and uploads
// (this PC's LoRAs and RefMods it lacks). have: root-relative paths known to be on the volume.
export function planFor(graph, { catalog, have }) {
  const download = new Map()
  const upload = new Map()
  for (const f of graphFiles(graph)) {
    if (f.kind === 'refmod') {
      const remote = `refmods/${f.value}.safetensors`
      if (!have.has(remote)) upload.set(remote, { name: f.value, kind: 'refmods', remote })
      continue
    }
    const e = catalog.find((x) => x.rel === f.value) || catalog.find((x) => x.rel.split('/').pop() === base(f.value) && !f.value.includes('/'))
    if (e) {
      if (!have.has(e.file)) download.set(e.id, e)
      continue
    }
    // not a cloud model: a LoRA from this PC (other folders hold only what IV Studio puts there)
    const remote = `loras/${f.value}`
    const known = [...have].some((h) => h.endsWith(`/${f.value}`))
    if (!known) upload.set(remote, { name: f.value, kind: 'loras', remote })
  }
  return { download: [...download.values()], upload: [...upload.values()] }
}

export const gb = (bytes) => Math.round((bytes / 1e9) * 10) / 10

export class CloudPrep {
  // provider: the adapter (see the top). ask({downloads, bytes, grow}) -> true to go ahead. localFile(kind, name)
  // -> a path on this PC or null. localNames() -> {loras, refmods} on this PC. hfToken() -> the person's token or
  // null. fetchInfo() -> the cloud's real /object_info (wakes it). onEvent(event) for the window's progress.
  constructor({ dataDir, provider, catalog, ask, localFile, localNames, hfToken, fetchInfo, onEvent, stamp }) {
    this.file = path.join(dataDir, 'cloud', `ledger-${provider.name}.json`)
    this.provider = provider
    this.catalog = catalog
    this.ask = ask
    this.localFile = localFile
    this.localNames = localNames || (async () => ({ loras: [], refmods: [] }))
    this.hfToken = hfToken || (() => null)
    this.fetchInfo = fetchInfo
    this.onEvent = onEvent || (() => {})
    this.stamp = stamp || ''
    this.queue = Promise.resolve()
  }

  // ---------- the ledger: what's on the volume, and the saved model lists ----------
  ledger() {
    try {
      const l = JSON.parse(fs.readFileSync(this.file, 'utf8'))
      return { files: l.files || {}, uploads: l.uploads || {}, info: l.stamp === this.stamp ? l.info || null : null, stamp: l.stamp }
    } catch {
      return { files: {}, uploads: {}, info: null }
    }
  }
  saveLedger(patch) {
    const l = { ...this.ledger(), ...patch, stamp: this.stamp }
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    fs.writeFileSync(this.file, JSON.stringify(l))
    this.cached = null
    return l
  }
  have() {
    const l = this.ledger()
    const set = new Set(Object.keys(l.files))
    if (l.info) for (const f of snapshotFiles(l.info, this.catalog)) set.add(f)
    return set
  }
  // about how much the volume holds: listed sizes, else the catalog's
  usedBytes() {
    let sum = 0
    for (const [f, v] of Object.entries(this.ledger().files)) sum += typeof v === 'number' ? v : this.catalog.find((e) => e.file === f)?.size || 0
    return sum
  }
  // what's known to be on the volume, merged in from a listing or a download ({path: bytes} or [paths])
  record(files) {
    const l = this.ledger()
    const add = Array.isArray(files) ? Object.fromEntries(files.map((f) => [f, true])) : files
    return this.saveLedger({ files: { ...l.files, ...add } })
  }

  // ---------- model lists without a GPU ----------
  // The saved lists (fetched from the cloud the first time, which wakes it), with what can be downloaded added.
  async objectInfo(cls) {
    let raw = this.ledger().info
    if (!raw) {
      raw = await this.fetchInfo()
      this.saveLedger({ info: raw })
    }
    const now = Date.now()
    if (!this.cached || now - this.cached.at > 60000) {
      const names = await this.localNames().catch(() => ({ loras: [], refmods: [] }))
      this.cached = { at: now, info: augmentInfo(raw, { catalog: this.catalog, ...names }) }
    }
    const info = this.cached.info
    return cls ? (info[cls] ? { [cls]: info[cls] } : {}) : info
  }
  // after the cloud answered for real (setup, or a render): its lists replace the saved ones
  remember(info) {
    if (info && Object.keys(info).length > 50) this.saveLedger({ info })
  }

  // ---------- before a render ----------
  // One at a time: two renders at once wait for each other's downloads rather than starting them twice.
  prepare(graph) {
    const run = this.queue.then(() => this.prepareNow(graph))
    this.queue = run.catch(() => {})
    return run
  }

  async prepareNow(graph) {
    let { download, upload } = planFor(graph, { catalog: this.catalog, have: this.have() })
    if (!download.length && !upload.length) return { downloaded: [], uploaded: [] }
    // the volume may hold more than the ledger knows (another PC, an older IV Studio): ask it when it can say
    if (download.length && this.provider.list) {
      try {
        this.record(await this.provider.list())
        ;({ download, upload } = planFor(graph, { catalog: this.catalog, have: this.have() }))
      } catch {}
    }
    const gated = download.filter((e) => e.gated && !this.hfToken())
    if (gated.length) throw Object.assign(new Error(`${gated.map((e) => e.label).join(', ')} ${gated.length === 1 ? 'is' : 'are'} behind a licence on Hugging Face. Accept it at ${gated[0].gated}, then add your Hugging Face token on the Cloud page to use ${gated.length === 1 ? 'it' : 'them'} in the cloud.`), { code: 'needs_hf_token' })
    // this PC's files first, so a missing one stops the render before anything is downloaded
    const files = []
    for (const u of upload) {
      const file = await this.localFile(u.kind, u.name)
      if (!file) throw Object.assign(new Error(`${u.name} isn't in your cloud storage, and IV Studio can't find it on this PC to upload it.`), { code: 'missing_file' })
      files.push({ ...u, file, size: fs.statSync(file).size })
    }
    if (download.length) {
      const bytes = download.reduce((s, e) => s + (e.size || 0), 0)
      const grow = (await this.provider.room?.(bytes + files.reduce((s, f) => s + f.size, 0))) || null
      const ok = await this.ask({ downloads: download.map((e) => ({ id: e.id, label: e.label, size: e.size })), bytes, grow, provider: this.provider.name })
      if (!ok) throw Object.assign(new Error('Not started: the models it needs weren’t downloaded to your cloud storage.'), { code: 'declined' })
      if (grow) await this.provider.grow(grow.toGb)
      this.onEvent({ state: 'downloading', items: download.map((e) => ({ id: e.id, label: e.label, size: e.size })) })
      try {
        await this.provider.download(download, (e) => this.onEvent({ state: 'downloading', ...e }))
      } catch (err) {
        this.onEvent({ state: 'error', error: err.message })
        throw err
      }
      this.record(download.map((e) => e.file))
    }
    for (const [i, f] of files.entries()) {
      this.onEvent({ state: 'uploading', label: f.name, index: i + 1, count: files.length })
      const sha256 = await sha256Of(f.file)
      await this.provider.upload(f.file, f.remote, sha256)
      this.record({ [f.remote]: true })
      this.saveLedger({ uploads: { ...this.ledger().uploads, [f.remote]: { sha256, size: f.size, at: new Date().toISOString() } } })
    }
    await this.provider.changed?.()
    this.onEvent({ state: 'done' })
    return { downloaded: download.map((e) => e.id), uploaded: files.map((f) => f.name) }
  }
}

export function sha256Of(file) {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256')
    fs.createReadStream(file)
      .on('data', (d) => h.update(d))
      .on('error', reject)
      .on('end', () => resolve(h.digest('hex')))
  })
}

// RunPod: whether `bytes` more fit on a volume of `sizeGb` that holds `usedBytes`, keeping 25 GB for ComfyUI, its
// Python and renders; else the size to grow to (to the next 10 GB, with 10% to spare) and what it adds a month.
export function roomOnVolume({ sizeGb, usedBytes, bytes, perGbMonth }) {
  const needGb = (usedBytes + bytes) / 1e9 + 25
  if (needGb <= sizeGb) return null
  const toGb = Math.min(4096, Math.ceil((needGb * 1.1) / 10) * 10)
  return { fromGb: sizeGb, toGb, monthlyUsd: Math.round((toGb - sizeGb) * perGbMonth * 100) / 100, totalMonthlyUsd: Math.round(toGb * perGbMonth * 100) / 100 }
}
