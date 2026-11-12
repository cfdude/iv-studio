// Freefield's apps (github.com/neuregex/freefield, MIT, Sammir Femat), run by IV Studio. Each app is a ComfyUI API
// workflow with a manifest that says which node and field each input fills (resources/workflows/freefield/<app>/,
// copied unchanged at the commit in COMMIT). IV Studio fills them in from its own windows (the editor's right-click,
// Workflows → Effects) and its MCP tools, swaps in this PC's own builds of models it already has under other names,
// runs the job and copies the results into the data folder.
import fs from 'node:fs'
import path from 'node:path'
import { comboOptions } from './setup.js'
import { resolveModel } from './setup.js'

// What IV Studio offers, and which Freefield app each runs.
export const CLIP_FX = {
  // New angle starts gentler than Freefield's app (-30° / 20°, a 50° lens): tested on a 4090 with 64 GB, a 15° / 5° move
  // with the lens read from the clip gave a warp H3 follows, while 30° / 15° left most of the frame for H3 to invent
  // and it fell back to the original shot. 0.35 MP fits 5 s in 64 GB of RAM; 0.5 MP ran out of memory there.
  reshoot: { app: 'reshoot', label: 'New angle', what: 'The same clip filmed from another angle', media: 'video', preview: '41', off: 'New angle is left out of 1.1: on a 24 GB card with 64 GB of RAM it fits only short clips at low size, and moves big enough to matter left H3 inventing or falling back to the original angle.', defaults: { azimuth: -15, elevation: 5 }, cameraDefaults: { hfov: 0, keep_source_aim: true }, size: { node: '2', field: 'megapixels', choices: [[0.35, 'Standard'], [0.5, 'Sharper']], default: 0.35 } },
  dub: { app: 'dub', label: 'Dub', what: 'The person says new words, in any language, with new lip movement', media: 'video' },
  cleanplate: { app: 'vfx-clean-plate', label: 'Clean plate', what: 'People and moving things taken out, the background rebuilt', media: 'video' },
  night: { app: 'vfx-day-to-night', label: 'Day to night', what: 'The same shot at night', media: 'video' },
  water: { app: 'vfx-water', label: 'Add water', what: 'Simulated water that follows the scene', media: 'video' },
  hdr: { app: 'sdr-hdr', label: 'SDR to HDR', what: 'A 10-bit HLG HDR master and a tone-mapped preview', media: 'video' },
  removebg: { app: 'video-remove-bg', label: 'Remove background', what: 'The subject over a solid colour, and its matte', media: 'video' },
  smooth: { app: 'smooth', label: 'Smooth or slow motion', what: 'In-between frames: smoother at the same length, or real slow motion', media: 'video' },
  effects: { app: 'effects', label: 'Effects', what: 'A photo becomes a 5-second effect clip', media: 'image' },
  morph: { app: 'morph', label: 'Transformations', what: 'A photo morphs into a new version of itself, keeping the face', media: 'image' },
  transitions: { app: 'transitions', label: 'Transition', what: 'A first frame morphs into a last frame', media: 'image' }
}

// Freefield's model files that this PC may have as another build: the manifest id IV Studio resolves it through.
const SAME_AS = [
  [/^qwen3vl_32b_minimax_h3_/, 'text_encoder'],
  [/^minimax_h3_video_vae_/, 'video_vae'],
  [/^minimax_h3_audio_vae_/, 'audio_vae'],
  [/^minimax_h3_ref2va_/, 'ref2va'],
  [/^minimax_h3_fl2va_/, 'fl2va']
]
// and ones matched by a pattern against what ComfyUI lists (Flux 3 Klein's int8 or fp8 builds)
const SAME_LIKE = [
  [/^qwen3vl_4b_/, /^qwen3vl_4b_/i],
  [/^flux3-image-klein/, /flux3.*klein/i]
]
const MODEL_FILE = /\.(safetensors|gguf|pt|pth|ckpt|bin|onnx)$/i
const base = (p) => String(p).replace(/\\/g, '/').split('/').pop()

// New angle's advanced camera: CrossView Warp's own settings (node 5 of Freefield's reshoot graph) a filmmaker may
// set beyond orbit, height and distance. Field: [min, max] for numbers, or 'bool'.
export const CAMERA_NODE = '5'
// what CrossView's live preview route reads (its _PARAMS)
export const LIVE_PARAMS = ['azimuth', 'elevation', 'distance', 'hfov', 'vertical_shift', 'depth_ratio', 'smooth_depth', 'invert_depth', 'pivot_override', 'pivot_x', 'pivot_y', 'pivot_z', 'keep_source_aim']
export const CAMERA_FIELDS = {
  hfov: [0, 120], // the assumed lens, horizontal field of view in degrees (50 is normal; 0 reads it from MoGe)
  vertical_shift: [-1, 1], // the camera raised or lowered without tilting
  depth_ratio: [1, 20], // how deep the scene reads: lower flattens, higher exaggerates parallax
  keep_source_aim: 'bool', // keep looking at what the original shot looked at
  smooth_depth: 'bool',
  roll_lock: 'bool'
}
export function cameraOverrides(camera = {}) {
  const out = {}
  for (const [k, v] of Object.entries(camera || {})) {
    const rule = CAMERA_FIELDS[k]
    if (!rule || v === undefined || v === null || v === '') continue
    if (rule === 'bool') out[k] = !!v
    else {
      const n = Number(v)
      if (!Number.isFinite(n) || n < rule[0] || n > rule[1]) throw new Error(`Camera ${k} is ${rule[0]} to ${rule[1]}.`)
      out[k] = n
    }
  }
  return out
}

// Only the nodes an output needs: the output and everything upstream of it (New angle's preview stops at the warp,
// before H3).
// The picture size an effect renders at: one of its size choices, else its default.
export function sizeOf(spec, size) {
  const n = Number(size)
  return spec.size?.choices?.some(([v]) => v === n) ? n : spec.size?.default
}

// Freefield's LTX apps rewrite the prompt inside ComfyUI with a small Gemma model (TextGenerateLTX2Prompt), behind a
// switch. IV Studio takes that out: whatever read the switch reads the plain prompt instead, and the rewriter and its
// model leave the graph (ComfyUI checks every model in a graph before it starts, used or not). Prompts come from the
// person, or IV Studio's own writer, as written.
export function withoutPromptWriter(graph) {
  const gens = new Set(Object.entries(graph).filter(([, n]) => n.class_type === 'TextGenerateLTX2Prompt').map(([k]) => k))
  if (!gens.size) return graph
  const g = JSON.parse(JSON.stringify(graph))
  const isGen = (x) => Array.isArray(x) && gens.has(String(x[0]))
  const plainOf = (x) => (isGen(x) ? g[String(x[0])].inputs.prompt : x)
  const rewire = (from, to) => {
    for (const m of Object.values(g)) for (const [k, v] of Object.entries(m.inputs || {})) if (Array.isArray(v) && String(v[0]) === from) m.inputs[k] = to
  }
  for (const [id, n] of Object.entries(g)) {
    if (n.class_type !== 'ComfySwitchNode' || !(isGen(n.inputs.on_true) || isGen(n.inputs.on_false))) continue
    rewire(id, plainOf(isGen(n.inputs.on_false) ? n.inputs.on_true : n.inputs.on_false))
    delete g[id]
  }
  for (const id of gens) rewire(id, g[id].inputs.prompt)
  // only what the outputs still need
  const outs = Object.keys(g).filter((k) => 'filename_prefix' in (g[k].inputs || {}))
  return upstream(g, outs)
}

export function upstream(graph, outIds) {
  const keep = new Set()
  const walk = (id) => {
    id = String(id)
    if (keep.has(id) || !graph[id]) return
    keep.add(id)
    for (const v of Object.values(graph[id].inputs || {})) if (Array.isArray(v) && v.length === 2 && graph[String(v[0])]) walk(v[0])
  }
  for (const id of [].concat(outIds)) walk(id)
  return Object.fromEntries(Object.entries(graph).filter(([k]) => keep.has(k)))
}

// Unload before the video model loads: an IV Free Memory node (IV Studio's own pack) on the first sampling
// stage's conditioning, waiting for every prompt branch, so the text encoder (and MoGe, a VAE...) leave the GPU
// before the sampler loads the big model. Later stages (an upscale pass with the same model) are left alone, so
// that model isn't loaded twice. Only when this ComfyUI has the node (info), else the graph is unchanged.
// any guider (BasicGuider, CFGGuider, LTXVDualCFGGuider...) or KSampler-like node, by its conditioning inputs
const SAMPLING_NODE = /Guider$|^KSampler(Advanced)?$|^SamplerCustom$/
const COND_FIELDS = ['positive', 'conditioning', 'cond1', 'cond2', 'negative']
const SAMPLERS = /^(KSampler|KSamplerAdvanced|SamplerCustom|SamplerCustomAdvanced)$/
export function withFreeMemory(graph, info = null) {
  if (info && !info.IVFreeMemory) return graph
  const g = { ...graph }
  for (const [id, n] of Object.entries(graph)) {
    if (!SAMPLING_NODE.test(n.class_type || '')) continue
    const linked = COND_FIELDS.filter((f) => Array.isArray(n.inputs?.[f]))
    if (!linked.length) continue
    // a later stage: something upstream of it already samples
    const above = upstream(graph, linked.map((f) => n.inputs[f][0]))
    if (Object.values(above).some((x) => SAMPLERS.test(x.class_type))) continue
    const fid = `ivfree_${id}`
    g[fid] = { class_type: 'IVFreeMemory', inputs: { value: n.inputs[linked[0]], ...(linked[1] ? { after_1: n.inputs[linked[1]] } : {}), ...(linked[2] ? { after_2: n.inputs[linked[2]] } : {}) } }
    g[id] = { ...n, inputs: { ...n.inputs, [linked[0]]: [fid, 0] } }
  }
  return g
}

// The effects IV Studio offers (CLIP_FX minus those switched off)
export const offeredFx = () => Object.keys(CLIP_FX).filter((k) => !CLIP_FX[k].off)

export function loadApp(resourcesDir, id) {
  const dir = path.join(resourcesDir, 'workflows', 'freefield', id)
  const app = JSON.parse(fs.readFileSync(path.join(dir, 'app.json'), 'utf8'))
  const graph = JSON.parse(fs.readFileSync(path.join(dir, app.workflow || 'workflow.api.json'), 'utf8'))
  return { app, graph }
}

// Fill a workflow from values { inputId: value }, as Freefield's schema says (schema/app.schema.json): every input's
// value is settled first (its default when not given; a seed of -1 becomes random; a multiple select is joined),
// then each input's binds write it (a template writes a sentence instead, its {input_id} placeholders filled with
// any input's value), then the chosen option of each select writes its sets (the LoRA and the prompt that go with
// an effect), placeholders filled the same way.
export function fillGraph(app, graph, values = {}) {
  const g = JSON.parse(JSON.stringify(graph))
  const inputs = app.inputs || []
  const v = {}
  for (const input of inputs) {
    let x = values[input.id] !== undefined ? values[input.id] : input.default
    if (input.type === 'seed' && (x === -1 || x === '' || x == null)) x = Math.floor(Math.random() * 2 ** 31)
    if (x === undefined) continue
    if (input.type === 'select' && input.options && !input.multiple && !input.options.some((o) => o.value === x)) throw new Error(`${input.label || input.id} is one of: ${input.options.map((o) => o.label || o.value).join(', ')}.`)
    if (input.type === 'slider' && (Number(x) < input.min || Number(x) > input.max)) throw new Error(`${input.label || input.id} is ${input.min} to ${input.max}.`)
    if (input.multiple && Array.isArray(x)) x = x.length ? `${input.multiple.prefix || ''}${x.join(input.multiple.join ?? ', ')}${input.multiple.suffix || ''}` : ''
    v[input.id] = ['slider', 'seed', 'number'].includes(input.type) ? Number(x) : x
  }
  const fill = (s) => (typeof s === 'string' ? s.replace(/\{([a-z][a-z0-9_]*)\}/g, (all, k) => (k in v ? String(v[k] ?? '') : all)) : s)
  const write = (nodeId, field, val, why) => {
    const node = g[nodeId]
    if (!node) throw new Error(`${app.id}: no node ${nodeId} for ${why}`)
    node.inputs[field] = val
  }
  for (const input of inputs) {
    if (!(input.id in v)) continue
    for (const b of input.bind || []) write(b.node, b.field, b.template ? fill(b.template) : v[input.id], input.id)
  }
  for (const input of inputs) {
    const chosen = input.type === 'select' && (input.options || []).find((o) => o.value === v[input.id])
    for (const s of chosen?.sets || []) write(s.node, s.field, fill(s.value), `${input.id}=${chosen.value}`)
  }
  return g
}

// Every model file a workflow names that this ComfyUI doesn't list, swapped for this PC's build of the same model
// where IV Studio knows one. Returns { graph, missing: [file] }.
export function swapModels(graph, info, manifest) {
  const g = JSON.parse(JSON.stringify(graph))
  const missing = []
  for (const node of Object.values(g)) {
    for (const [field, v] of Object.entries(node.inputs || {})) {
      if (typeof v !== 'string' || !MODEL_FILE.test(v)) continue
      const opts = comboOptions(info, node.class_type, field)
      if (!opts) continue
      if (opts.includes(v) || opts.some((o) => base(o) === base(v))) {
        node.inputs[field] = opts.includes(v) ? v : opts.find((o) => base(o) === base(v))
        continue
      }
      const id = SAME_AS.find(([re]) => re.test(base(v)))?.[1]
      const m = id && manifest.models.find((x) => x.id === id)
      const r = m && resolveModel(m, opts)
      const like = SAME_LIKE.find(([re]) => re.test(base(v)))?.[1]
      const alt = r?.file || (like && opts.find((o) => like.test(base(o))))
      if (alt) node.inputs[field] = alt
      else missing.push(base(v))
    }
  }
  return { graph: g, missing: [...new Set(missing)] }
}

const slug = (s) => String(s || 'clip').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'clip'

export class FreefieldApps {
  // studio: () => Studio. resourcesDir: the app's resources folder.
  constructor({ resourcesDir, dataDir, studio }) {
    this.resourcesDir = resourcesDir
    this.dir = path.join(dataDir, 'clipfx')
    this.studio = studio
  }

  runsFile = () => path.join(this.dir, 'runs.json')
  runs() {
    try {
      return JSON.parse(fs.readFileSync(this.runsFile(), 'utf8'))
    } catch {
      return []
    }
  }
  record(r) {
    fs.mkdirSync(this.dir, { recursive: true })
    fs.writeFileSync(this.runsFile(), JSON.stringify([r, ...this.runs().filter((x) => x.id !== r.id)].slice(0, 500), null, 1))
  }
  deleteRun(id) {
    const r = this.runs().find((x) => x.id === id)
    if (!r) throw new Error(`No run ${id}.`)
    for (const f of r.files || []) fs.rmSync(f.file, { force: true })
    fs.writeFileSync(this.runsFile(), JSON.stringify(this.runs().filter((x) => x.id !== id), null, 1))
    return { deleted: id }
  }

  meta(fx) {
    const spec = CLIP_FX[fx]
    if (!spec) throw new Error(`Unknown effect "${fx}". One of: ${Object.keys(CLIP_FX).join(', ')}.`)
    const { app, graph } = loadApp(this.resourcesDir, spec.app)
    const cam = spec.preview && graph[CAMERA_NODE]?.class_type === 'CrossViewWarp' ? graph[CAMERA_NODE].inputs : null
    // New angle: the warp node's own settings as Freefield's graph has them, which the live preview must repeat
    const camera = cam ? Object.fromEntries(LIVE_PARAMS.filter((k) => k in cam).map((k) => [k, cam[k]])) : undefined
    // IV Studio's own starting values (spec.defaults, cameraDefaults) over the app's
    const inputs = (app.inputs || []).map((i) => (spec.defaults && i.id in spec.defaults ? { ...i, default: spec.defaults[i.id] } : i))
    return { fx, ...spec, name: app.name, summary: app.summary, inputs, outputs: app.outputs, models: app.models, nodes: (app.custom_nodes || []).map((n) => n.repo), camera: camera && { ...camera, ...(spec.cameraDefaults || {}) } }
  }

  // New angle's live picture: once a preview has run, CrossView's own render route (comfyrob/ComfyUI-CrossViewWarp,
  // crossview_preview_node.py) re-warps its cached clip for any camera in ~50 ms, the same code as a full run.
  async liveAngle({ fx = 'reshoot', frame = 1, params = {} } = {}) {
    const c = this.studio().comfy
    if (c.remote) return { unavailable: true }
    const body = { node_id: CAMERA_NODE, frame, params: Object.fromEntries(Object.entries(params).filter(([k]) => LIVE_PARAMS.includes(k))) }
    const res = await fetch(`${c.url}/crossview_preview/render`, { method: 'POST', headers: c.headers({ 'Content-Type': 'application/json' }), body: JSON.stringify(body), signal: AbortSignal.timeout(10000) })
    if (res.status === 409) return { stale: true } // no cached clip: run the preview again
    if (res.status === 404) return { unavailable: true } // an older CrossView without the route
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `The live preview failed (${res.status}).`)
    const buf = Buffer.from(await res.arrayBuffer())
    let info = {}
    try {
      info = JSON.parse(res.headers.get('x-preview-info') || '{}')
    } catch {}
    return { image: `data:image/jpeg;base64,${buf.toString('base64')}`, frame: info.frame ?? frame, count: info.count ?? null }
  }

  // Whether this ComfyUI can run it: missing node classes and model files.
  async status(fx) {
    const spec = CLIP_FX[fx]
    const studio = this.studio()
    const info = await studio.comfy.objectInfo()
    const graph = withoutPromptWriter(loadApp(this.resourcesDir, spec.app).graph)
    const missingNodes = [...new Set(Object.values(graph).map((n) => n.class_type).filter((c) => !info[c]))]
    const { missing } = swapModels(graph, info, studio.manifest)
    const out = { fx, ready: !missingNodes.length && !missing.length, missingNodes, missingModels: missing }
    if (spec.preview) {
      // the preview needs only the warp half (MoGe + CrossView), not H3
      const part = upstream(graph, spec.preview)
      const pn = [...new Set(Object.values(part).map((n) => n.class_type).filter((c) => !info[c]))]
      const pm = swapModels(part, info, studio.manifest).missing
      out.preview = { ready: !pn.length && !pm.length, missingNodes: pn, missingModels: pm }
    }
    return out
  }

  // New angle's preview: only the depth and warp half of the graph (MoGe + CrossView Warp), the guide H3 is given,
  // on the first seconds of the clip. Seconds, not minutes; shows the new camera position and the gaps H3 will fill.
  async previewAngle({ fx = 'reshoot', file, values = {}, camera = null, size = null, seconds = 2, onProgress = () => {} }) {
    const spec = CLIP_FX[fx]
    if (!spec?.preview) throw new Error(`${spec?.label || fx} has no preview.`)
    if (!file || !fs.existsSync(file)) throw new Error('Pick a clip.')
    const studio = this.studio()
    if (studio.comfy.remote) throw new Error(`${spec.label} runs on this computer’s ComfyUI.`)
    const { app, graph } = loadApp(this.resourcesDir, spec.app)
    const info = await studio.comfy.objectInfo()
    const vals = { ...(spec.defaults || {}), ...values }
    const media = (app.inputs || []).find((i) => i.type === 'video')
    vals[media.id] = await studio.comfy.upload(file, 'iv_studio/clipfx')
    // the preview's own length: the input's slider minimum or more, never past what was asked for
    const dur = (app.inputs || []).find((i) => i.id === 'duration')
    if (dur) vals.duration = Math.max(dur.min ?? 1, Math.min(Number(vals.duration ?? dur.default ?? seconds), seconds))
    const filled = fillGraph(app, graph, vals)
    if (filled[CAMERA_NODE]?.class_type === 'CrossViewWarp') Object.assign(filled[CAMERA_NODE].inputs, cameraOverrides({ ...(spec.cameraDefaults || {}), ...(camera || {}) }))
    if (spec.size && filled[spec.size.node]) filled[spec.size.node].inputs[spec.size.field] = sizeOf(spec, size)
    const part = upstream(filled, spec.preview)
    const missingNodes = [...new Set(Object.values(part).map((n) => n.class_type).filter((c) => !info[c]))]
    if (missingNodes.length) throw new Error(`The preview needs ComfyUI nodes this one doesn’t have (${missingNodes.join(', ')}). Install missing node packs on Setup, then restart ComfyUI.`)
    const { graph: g, missing } = swapModels(part, info, studio.manifest)
    if (missing.length) throw new Error(`The preview needs ${missing.join(', ')}. Download on Setup.`)
    const stamp = Date.now().toString(36)
    for (const n of Object.values(g)) if (n.inputs && 'filename_prefix' in n.inputs) n.inputs.filename_prefix = `iv_studio/clipfx/preview_${stamp}`
    const job = await studio.submitGraph({ kind: `clipfx:${fx}-preview`, graph: g, name: `${spec.label} preview`, plan: { clipfx: { fx, app: spec.app, from: file, outputs: app.outputs, preview: true } } })
    let j = job
    for (const end = Date.now() + 10 * 60e3; Date.now() < end; await new Promise((r) => setTimeout(r, 1000))) {
      j = await studio.refreshJob(job.id)
      onProgress(j)
      if (['success', 'error', 'cancelled'].includes(j.status)) break
    }
    if (j.status !== 'success') throw new Error(j.error || `The preview ${j.status || 'took too long'}.`)
    const dir = path.join(this.dir, '_previews')
    fs.mkdirSync(dir, { recursive: true })
    for (const o of j.outputs || []) {
      const src = await studio.localCopy(o, path.join(this.dir, '_comfy'))
      if (!src || !fs.existsSync(src)) continue
      const dest = path.join(dir, `angle_${stamp}${path.extname(src)}`)
      fs.copyFileSync(src, dest)
      if (path.dirname(src) === path.join(this.dir, '_comfy')) fs.rmSync(src, { force: true })
      // keep the last 12 previews
      const old = fs.readdirSync(dir).map((f) => path.join(dir, f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs).slice(12)
      for (const f of old) fs.rmSync(f, { force: true })
      return { file: dest, seconds: j.seconds, camera: { ...values, ...cameraOverrides(camera) } }
    }
    throw new Error('The preview finished but saved nothing.')
  }

  async statusAll() {
    const out = {}
    for (const fx of offeredFx()) out[fx] = await this.status(fx).catch((err) => ({ fx, ready: false, error: err.message }))
    return out
  }

  // Runs one: file (a video or a picture on this PC), last (transitions: the last frame), values (the app's inputs).
  // Resolves when ComfyUI finishes, with { files: [{ label, file, kind }] } copied into clipfx/.
  async run({ fx, file, last = null, values = {}, camera = null, size = null, name, onProgress = () => {} }) {
    const spec = CLIP_FX[fx]
    if (!spec) throw new Error(`Unknown effect "${fx}".`)
    if (spec.off) throw new Error(spec.off)
    if (!file || !fs.existsSync(file)) throw new Error(spec.media === 'image' ? 'Pick a picture.' : 'Pick a clip.')
    const studio = this.studio()
    if (studio.comfy.hosted) throw new Error(`${spec.label} runs on this computer’s ComfyUI or on your own cloud (RunPod, Modal).`)
    const { app, graph: raw } = loadApp(this.resourcesDir, spec.app)
    const graph = withoutPromptWriter(raw)
    const info = await studio.comfy.objectInfo()
    const missingNodes = [...new Set(Object.values(graph).map((n) => n.class_type).filter((c) => !info[c]))]
    if (missingNodes.length) throw new Error(`${spec.label} needs ComfyUI nodes this one doesn’t have (${missingNodes.slice(0, 4).join(', ')}). Install missing node packs on Setup, then restart ComfyUI.`)
    // the media inputs: the first video or image input takes the file, a second image input the last frame
    const vals = { ...(spec.defaults || {}), ...values }
    const media = (app.inputs || []).filter((i) => i.type === 'video' || i.type === 'image')
    if (!media.length) throw new Error(`${spec.label} takes no picture or clip.`)
    vals[media[0].id] = await studio.comfy.upload(file, 'iv_studio/clipfx')
    if (media[1]) {
      if (!last || !fs.existsSync(last)) throw new Error(`${spec.label} needs a ${media[1].label?.toLowerCase() || 'second picture'} too.`)
      vals[media[1].id] = await studio.comfy.upload(last, 'iv_studio/clipfx')
    }
    const filled = fillGraph(app, graph, vals)
    if (filled[CAMERA_NODE]?.class_type === 'CrossViewWarp') Object.assign(filled[CAMERA_NODE].inputs, cameraOverrides({ ...(spec.cameraDefaults || {}), ...(camera || {}) }))
    if (spec.size && filled[spec.size.node]) filled[spec.size.node].inputs[spec.size.field] = sizeOf(spec, size)
    const swapped = swapModels(filled, info, studio.manifest)
    const missing = swapped.missing
    const g = withFreeMemory(swapped.graph, info)
    if (missing.length) throw new Error(`${spec.label} needs ${missing.join(', ')}. Download on Setup.`)
    const stamp = Date.now().toString(36)
    const title = String(name || '').trim() || `${spec.label} · ${path.basename(file).replace(/\.[^.]+$/, '')}`.slice(0, 60)
    // every Save node writes under IV Studio's own folder in ComfyUI's output
    for (const n of Object.values(g)) if (n.inputs && 'filename_prefix' in n.inputs) n.inputs.filename_prefix = `iv_studio/clipfx/${slug(title)}_${stamp}`
    const job = await studio.submitGraph({ kind: `clipfx:${fx}`, graph: g, name: title, plan: { clipfx: { fx, app: spec.app, from: file, outputs: app.outputs } } })
    const run = { id: `${fx}_${stamp}`, fx, label: spec.label, title, from: file, ...(last ? { last } : {}), values, jobId: job.id, status: 'running', files: [], createdAt: new Date().toISOString() }
    this.record(run)
    let j = job
    for (const end = Date.now() + 60 * 60e3; Date.now() < end; await new Promise((r) => setTimeout(r, 3000))) {
      j = await studio.refreshJob(job.id)
      onProgress(j)
      if (['success', 'error', 'cancelled'].includes(j.status)) break
    }
    if (j.status !== 'success') {
      this.record({ ...run, status: 'error', error: j.error || j.status })
      throw new Error(j.error || `${spec.label} ${j.status || 'took too long'}.`)
    }
    fs.mkdirSync(this.dir, { recursive: true })
    const files = []
    for (const o of j.outputs || []) {
      const src = await studio.localCopy(o, path.join(this.dir, '_comfy'))
      if (!src || !fs.existsSync(src)) continue
      const label = app.outputs?.find((x) => String(x.node) === String(o.node))?.label || (o.kind === 'image' ? 'Picture' : 'Video')
      const dest = path.join(this.dir, `${slug(title)}_${stamp}_${slug(label)}${path.extname(src)}`)
      if (!fs.existsSync(dest)) fs.copyFileSync(src, dest)
      if (path.dirname(src) === path.join(this.dir, '_comfy')) fs.rmSync(src, { force: true })
      files.push({ label, file: dest, kind: /\.(png|jpe?g|webp)$/i.test(dest) ? 'image' : 'video' })
    }
    if (!files.length) throw new Error(`${spec.label} finished but saved nothing.`)
    // the app's first output is the result; others (a matte, a warp guide) follow
    const order = (app.outputs || []).map((x) => x.label)
    files.sort((a, b) => (order.indexOf(a.label) + 99) % 99 - (order.indexOf(b.label) + 99) % 99)
    this.record({ ...run, status: 'success', files, seconds: j.seconds, finishedAt: new Date().toISOString() })
    return { fx, id: run.id, title, jobId: job.id, files }
  }
}
