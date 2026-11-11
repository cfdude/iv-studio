// Minimal ComfyUI HTTP client: prompt submission, history, queue, targeted interrupt, uploads, schemas.
import fs from 'node:fs'
import path from 'node:path'
import { cleanFolder, outputsUnder } from './paths.js'
import { checkSpend, infoFor, priceGraph } from './pricing.js'
import { checkH3Terms } from './terms.js'

export class Comfy {
  // token: a cloud ComfyUI sits behind IV Studio's gate (resources/cloud/gate.py), which wants it as a
  // Bearer header. A local ComfyUI has none.
  // apiKey: Comfy Cloud (cloud.comfy.org), Comfy's own hosted ComfyUI: the person's API key from
  // platform.comfy.org, sent as X-API-Key, with url COMFY_CLOUD (its routes are ComfyUI's under /api).
  // folders: where in ComfyUI's output what it saves goes, and where in input what it uploads goes
  // (Settings -> Folders; see comfyFolders). '' = as the graph says.
  constructor(url = 'http://127.0.0.1:8188', clientId = 'iv-studio', token = null, apiKey = null) {
    this.url = url.replace(/\/$/, '')
    this.clientId = clientId
    this.token = token
    this.apiKey = apiKey
    this.folders = { output: '', input: '' }
    // RunPod (runpod.js): async () => the address of a pod started because the last one shut itself off,
    // or null when the current one is fine. Called once when a request can't reach the cloud.
    this.waker = null
    // Studio: async () => { IV Studio's model file: the version this ComfyUI has } (setup.js modelFileMap), so a
    // ComfyUI set up from ComfyUI's own templates (an fp8 or NVFP4 build) renders without the exact files.
    this.fileMapper = null
    this.fileMap = null
    // The person's own cloud (Modal, RunPod): a CloudPrep (cloudprep.js), set by the app. It answers model lists
    // without waking the GPU and puts a graph's models and LoRAs in the cloud's storage before it's queued.
    this.prep = null
  }

  // The model names to swap into a graph, asked for again after a minute (the person may add files meanwhile).
  async filesFor() {
    if ((this.remote && !this.hosted) || !this.fileMapper) return {}
    if (!this.fileMap || Date.now() - this.fileMap.at > 60000) this.fileMap = { at: Date.now(), map: await this.fileMapper().catch(() => ({})) }
    return this.fileMap.map
  }

  get remote() {
    return !!(this.token || this.apiKey)
  }

  // The person's own cloud GPU (Modal, RunPod): ComfyUI behind IV Studio's gate. Asking it anything wakes the GPU,
  // so model lists come from cloudprep.js instead.
  get ownCloud() {
    return !!this.token && !this.apiKey
  }

  // Comfy Cloud: always on and billed per run, so asking it what it has costs nothing (unlike waking a GPU of our own)
  get hosted() {
    return !!this.apiKey
  }

  headers(extra = {}) {
    return { ...extra, ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}), ...(this.apiKey ? { 'X-API-Key': this.apiKey } : {}) }
  }

  async req(route, opts = {}) {
    try {
      return await this.once(route, opts)
    } catch (err) {
      // a pod that idled off: RunPod's proxy answers 404/502/52x, or the name no longer resolves
      const gone = err.status === 404 || err.status === 502 || (err.status >= 520 && err.status < 530) || /fetch failed|ENOTFOUND|ECONNRESET/.test(`${err.message} ${err.cause?.code || ''}`)
      if (!this.waker || !gone) throw err
      this.waking ||= this.waker().finally(() => (this.waking = null))
      const url = await this.waking
      if (!url) throw err
      this.url = url.replace(/\/$/, '')
      return this.once(route, opts)
    }
  }

  async once(route, { method = 'GET', body, json, timeout = 15000 } = {}) {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), timeout)
    try {
      const res = await fetch(this.url + route, {
        method,
        signal: ctl.signal,
        headers: this.headers(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
        body: json !== undefined ? JSON.stringify(json) : body
      })
      const text = await res.text()
      if (!res.ok) {
        let detail = text
        try {
          const j = JSON.parse(text)
          detail = j.error?.message ? `${j.error.message}${j.node_errors ? ' ' + summariseNodeErrors(j.node_errors) : ''}` : text
        } catch {}
        throw Object.assign(new Error(`ComfyUI ${route} ${res.status}: ${detail.slice(0, 800)}`), { status: res.status })
      }
      return text ? JSON.parse(text) : {}
    } catch (err) {
      // busy: the server took the connection (so ComfyUI is running) but didn't reply in time; down: nothing listens
      if (err.name === 'AbortError')
        throw Object.assign(
          new Error(this.remote ? `ComfyUI did not answer ${route} within ${timeout / 1000} s` : `ComfyUI is running at ${this.url} but didn’t answer within ${timeout / 1000} s. It’s probably busy loading a model, rendering, or short on memory. Wait for it to settle, then try again.`),
          { busy: true }
        )
      if (err.cause?.code === 'ECONNREFUSED') throw Object.assign(new Error(`ComfyUI is not running at ${this.url}`), { down: true })
      if (this.hosted && COMFY_CLOUD_ERRORS[err.status]) throw Object.assign(new Error(COMFY_CLOUD_ERRORS[err.status]), { status: err.status })
      if (err.status === 503 && this.remote) throw Object.assign(new Error('The cloud GPU is still starting up.'), { status: 503, starting: true })
      throw err
    } finally {
      clearTimeout(t)
    }
  }

  // A ComfyUI loading a big model or rendering can hold its server up for many seconds (much longer when it's short on
  // memory), so readiness checks wait 20 s; the title bar's meter asks with a short timeout and just skips a beat.
  systemStats = ({ timeout = 20000 } = {}) => this.req('/system_stats', { timeout })
  queue = () => this.req('/queue')
  // Comfy Cloud keeps ComfyUI's history shape under history_v2 (its /jobs is the newer form)
  history = (id) => this.req(this.hosted ? `/history_v2/${id}` : `/history/${id}`)
  objectInfo = (cls) => (this.prep ? this.prep.objectInfo(cls) : this.realObjectInfo(cls))
  // The ComfyUI's own answer (on the cloud, this wakes the GPU; a cold start can take a few minutes).
  realObjectInfo = (cls) => this.req(cls ? `/object_info/${encodeURIComponent(cls)}` : '/object_info', { timeout: this.remote && !this.hosted ? 600000 : 60000 })

  // front: put it ahead of waiting renders (used for quick jobs such as writing a prompt).
  // A graph that runs MiniMax H3 waits for the person's OK to its terms first (terms.js).
  // spend: the person's OK for paid partner nodes ({ approvedUsd, unknownOk }, see pricing.js checkSpend). A graph
  // that can spend Comfy.org credits (a key attached, or Comfy Cloud) is priced first and refused without it.
  async submit(prompt, extra = {}, { front = false, spend = null } = {}) {
    // MiniMax H3 only after the person has accepted its terms (terms.js)
    await checkH3Terms(prompt)
    outputsUnder(prompt, this.folders.output)
    renameFiles(prompt, await this.filesFor())
    // the person's own cloud: its models downloaded and this PC's LoRAs uploaded first (asks before downloading)
    if (this.prep) await this.prep.prepare(prompt)
    let price = null
    if (extra.api_key_comfy_org || this.hosted) {
      price = await priceGraph(prompt, await infoFor(this, prompt))
      checkSpend(price, spend)
    }
    const r = await this.req('/prompt', { method: 'POST', json: { prompt, client_id: this.clientId, extra_data: extra, ...(front ? { front: true } : {}) } })
    if (price?.paid) Comfy.onPaid?.({ comfy: this, promptId: r.prompt_id, price })
    // what that cost (the job records it; the Library shows it)
    this.lastPrice = price?.paid ? { usd: price.max, label: price.label, rate: !!price.rate } : null
    return r.prompt_id
  }

  // Cancels only this prompt: drops it from the queue, or interrupts it if it is the one running.
  async cancel(promptId) {
    const q = await this.queue()
    if (q.queue_pending.some((item) => item[1] === promptId)) {
      await this.req('/queue', { method: 'POST', json: { delete: [promptId] } })
      return 'removed from queue'
    }
    if (q.queue_running.some((item) => item[1] === promptId)) {
      await this.req('/interrupt', { method: 'POST', json: { prompt_id: promptId } })
      return 'interrupted'
    }
    return 'not queued'
  }

  // Removes finished prompts from ComfyUI's history (its queue panel shows their pictures and settings).
  async deleteHistory(promptIds) {
    if (promptIds.length) await this.req('/history', { method: 'POST', json: { delete: promptIds } })
  }

  // Asks ComfyUI to unload its models and free memory. ComfyUI does it between prompts, never inside one,
  // so nothing running is disturbed; the next prompt just loads what it needs.
  async freeMemory() {
    if (this.hosted) return // Comfy Cloud manages its own GPUs
    await this.req('/free', { method: 'POST', json: { unload_models: true, free_memory: true } })
  }

  // Copies a local file into ComfyUI's input folder (any type) and returns its name relative to input.
  async upload(filePath, subfolder = 'iv_studio') {
    const into = cleanFolder(this.folders.input)
    if (into) subfolder = `${into}/${subfolder}`
    const form = new FormData()
    const name = path.basename(filePath)
    form.append('image', new Blob([fs.readFileSync(filePath)]), name)
    form.append('subfolder', subfolder)
    form.append('type', 'input')
    form.append('overwrite', 'true')
    const r = await this.req('/upload/image', { method: 'POST', body: form, timeout: 120000 })
    return r.subfolder ? `${r.subfolder}/${r.name}` : r.name
  }

  viewUrl(file) {
    const q = new URLSearchParams({ filename: file.filename, subfolder: file.subfolder || '', type: file.type || 'output' })
    return `${this.url}/view?${q}`
  }
}

export const COMFY_CLOUD = 'https://cloud.comfy.org/api'
// What Comfy Cloud's own error codes mean, in words
export const COMFY_CLOUD_ERRORS = {
  401: 'Comfy Cloud refused the API key. Make a new one at platform.comfy.org and paste it on the Cloud page.',
  402: 'Your Comfy Cloud credits have run out. Add credits at comfy.org.',
  429: 'Comfy Cloud’s API needs an active paid subscription (comfy.org/cloud/pricing).'
}

function summariseNodeErrors(errs) {
  return Object.entries(errs)
    .map(([id, e]) => `[${e.class_type} #${id}: ${(e.errors || []).map((x) => x.details || x.message).join('; ')}]`)
    .join(' ')
}

// Swaps model file names in a graph's inputs (IV Studio's own build -> the version this ComfyUI has).
export function renameFiles(prompt, map) {
  if (!map || !Object.keys(map).length) return prompt
  for (const node of Object.values(prompt)) for (const [k, v] of Object.entries(node.inputs || {})) if (typeof v === 'string' && map[v]) node.inputs[k] = map[v]
  return prompt
}
