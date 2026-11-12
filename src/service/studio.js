import { isHarness } from './harness.js'
// IV Studio service: the one place both the studio window and the MCP server go through.
// Projects, jobs and characters live as JSON in the data folder, so either process can pick up the
// other's work. ComfyUI does the rendering; this records what was asked, what ran and what came out.
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { speaks } from './softmouth.js'
import path from 'node:path'
import ffmpegStatic from 'ffmpeg-ffprobe-static'
import { Comfy } from './comfy.js'
import { probe } from './media.js'
import { buildPrompt, checkPrompt } from './graph.js'
import { planFinish, planPreviews } from './plan.js'
import { applyFinishSpeed, applySpeed } from './speed.js'
import { adaptGraph, capabilities, LIVE_NODE, withLivePreview } from './remote.js'
import { Cast, resolveMentions, withCast } from './cast.js'
import { contextIrGraph, fromContextIr, writeHarness, writeLocal, writeStoryLocal } from './prompter.js'
import { cleanSequenceLoras, renderOutGraph, retakeGraph, SAVES, SEQUENCE_DEFAULTS, takeGraph, validateSequence } from './sequence.js'
import { checkSetup, comboOptions, fileBase, modelFileMap, whyUnreached } from './setup.js'
import { comfyPlace, installPacks, missingPacks } from './nodepacks.js'
import { checkUpdates, copySnapshot, MANAGER_PACK, packFolders, readRecord, reenable, restart, undo, update, writeRecord } from './comfyupdate.js'
import { comfyUp, isDesktopLauncher, isLocalUrl } from './comfylauncher.js'
import { finalFrom, finalGraph, graphProblems, NODES as SEEDANCE_NODES, planSeedance, SEEDANCE, seedanceGraph, seedanceMentions, sizeOf, takesFrom, FINAL_FROM_DRAFT } from './seedance.js'
import { infoFor, priceGraph } from './pricing.js'
import { writeSeedance } from './seedwriter.js'
import { REFINE_DEFAULTS, refineGraph } from './h3refine.js'
import { explainFailure } from './failures.js'

const SHOT_BOILERPLATE = [/^there is no (?:writing|text|lettering)/i, /^no (?:signs|text|labels|captions|writing|lettering)\b/i, /^(?:one|a single) (?:continuous|unbroken)\b/i, /^(?:filmed|shot) (?:on|with)\b/i, /^the camera\b/i, /^(?:handheld|static|locked[- ]off)\b/i]
// A new shot's name from its prompt: the first words of [Shot 1] (not "subject_definitions" or the frames line),
// without the style opener, with {char} as the character's first name.
export function shotName(prompt, character) {
  const text = String(prompt || '')
  // where the shot itself starts, not "(appears in [Shot 1])"
  const first = text.match(/(?:^|\n|description:)\s*\[Shot 1\]\s*([^\n]+)/)?.[1] ?? text.replace(/^[a-z_]+:\s*/gim, '')
  let s = first.replace(/\{char\}/g, character?.name?.split(/\s+/)[0] || 'Someone').replace(/<[^>]+>|\s*\(S\d+\)/g, '').replace(/\s+/g, ' ').trim()
  for (let i = 0; i < 4; i++) s = s.replace(/^(?:3d\s+)?(?:live-action|cinematic|realistic|photorealistic|animated|documentary|film(?:ic)?|natural)[^,.;]*[,.;]\s*/i, '')
  // then the first sentence that says what happens, past the house rules ("There is no writing…", "One continuous
  // take", "Filmed on a smartphone", a sentence only about the camera)
  const sentences = s.split(/(?<=[.!?])\s+/).filter(Boolean)
  const said = sentences.find((x) => !SHOT_BOILERPLATE.some((rx) => rx.test(x)))
  if (said) s = said
  s = s.charAt(0).toUpperCase() + s.slice(1)
  return s.length > 40 ? `${s.slice(0, 40).replace(/\s+\S*$/, '')}…` : s || 'Untitled shot'
}

// the bundled ffprobe, outside the asar in a packaged app
const FFPROBE = ffmpegStatic.ffprobePath?.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`)

const DEFAULT_CHARACTERS = [
  { id: 'tess', name: 'Tess Marlow', lora: 'MiniMax H3\\tess\\tess_mmh3-000040.safetensors', strength: 0.8, trigger: 't3ss4', voiceRefmod: 'characters/tess_audio', visualRefmod: 'characters/tess_visual' }
]
const PREVIEW_SAVES = { 1: '42', 2: '118', 3: '128' }
// The model family a job loads. Before a job, ComfyUI drops what a job of another family left loaded, so two
// big models never share the GPU (Z-Image or MiniMax Music next to H3 overflows a 24 GB card and 64 GB of RAM).
// Jobs of the same family keep their models: a finish reuses its preview's cached latent.
// Create -> Image jobs are 'picture:<family>' (see images.js), so switching image models unloads too.
// A turnaround sheet (turnaround.js) loads its own H3 with the five-view LoRA patched in; kept beside a shot's H3 it
// filled 64 GB of RAM and a 0.4 MP draft crawled for 10 minutes (2026-11-10), so it's a family of its own.
const FAMILIES = { music: 'music', sound: 'sound', still: 'image', enhance: 'seedvr2', cutout: 'sam', 'clipfx:reshoot': 'h3', turnaround: 'turnaround' }
// Clip effects (freefield.js) are their own families too: LTX-2.5 or Wan next to H3 would overflow the card.
const familyOf = (kind) => FAMILIES[kind] || (/^(picture|clipfx):/.test(String(kind)) ? String(kind) : 'h3')
// The UNETLoader each mode of the IV Studio workflow uses (Settings can swap its model).
// How hard the free finish's H3 pass works on a take it didn't make (h3refine.js). Likeness to Tess's face on a
// Seedance draft (2026-11-08): the draft 0.51-0.68; SeedVR2 1080p 0.52-0.64; H3 at 0.1 0.44-0.48, 0.2 0.38-0.44,
// 0.4 (H3's own finish strength) 0.12-0.27; DLSS 5 to 1080p (2.25x) 0.48-0.63 in 15 s, with a speckled skin
// texture. So SeedVR2 is the free finish's default, DLSS 5 the quick one, and H3 stays light.
export const REFINE_STRENGTH = { light: 0.1, medium: 0.2 }
// DLSS 5's look: its noise-reduction intensity (0-2) and style, as node inputs (or, short, for a job's record)
export const DLSS_STYLES = ['Default', 'Natural', 'Cinematic']
export function dlssLook({ strength = null, style = null } = {}, record = false) {
  const out = {}
  if (strength != null && Number.isFinite(Number(strength))) out[record ? 'strength' : 'NR Intensity'] = Math.min(2, Math.max(0, Math.round(Number(strength) * 100) / 100))
  if (style && DLSS_STYLES.includes(style)) out[record ? 'style' : 'NR Style'] = style
  return out
}
export const MODEL_NODES = { text: '101', frames: '201', reference: '301', continue: '601' }

const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2))
  fs.renameSync(`${file}.tmp`, file)
}
const slug = (s) => (s || 'shot').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'shot'
const now = () => new Date().toISOString()

// SeedVR2 models for Enhance, best first: what's in ComfyUI's SEEDVR2 folder decides.
const ENHANCE_MODELS = ['seedvr2_ema_3b_fp16.safetensors', 'seedvr2_ema_3b_fp8_e4m3fn.safetensors', 'seedvr2_ema_3b-Q8_0.gguf']
// Frames per SeedVR2 batch (4n+1) by output size, sized for a 24 GB card: 21 at 1440 spilled into shared memory
// (16 min for 5 s) and ran out of memory at 2160 after 41 min. Bigger outputs take smaller batches and, at 4K,
// swap half the DiT's blocks to the CPU.
export const seedvr2Batch = (resolution) =>
  resolution > 1440 ? { batch: 5, overlap: 1, swap: 16 } : resolution > 1080 ? { batch: 9, overlap: 2, swap: 0 } : { batch: 21, overlap: 3, swap: 0 }

// What the Library tells about one render (a shot's preview, final or enhanced copy), from its job and the jobs
// above it: facts as [label, value] rows for the viewer, a short line for its tile, the prompt as asked, and its
// size, length, model and the time it took for sorting and filtering. Nothing is guessed: a fact the job didn't
// record is left out.
export function renderFacts({ job, jobs = [], output = {}, request = {}, characters = [] }) {
  const up = (x) => jobs.find((y) => y.id === x?.parent)
  const run = job.kind === 'previews' ? job : job.kind === 'finish' ? up(job) : up(up(job))
  const fin = job.kind === 'finish' ? job : job.kind === 'enhance' ? up(job) : null
  const r = job.plan?.resolved || {}
  const rr = run?.plan?.resolved || {}
  const engine = job.plan?.engine || run?.plan?.engine || request.engine || 'h3'
  const seedance = engine === 'seedance'
  const candidate = output.candidate || fin?.plan?.finish?.candidate || null
  const facts = []
  const add = (k, v) => v != null && v !== '' && facts.push([k, String(v)])
  const width = r.width || rr.width
  const height = r.height || rr.height
  const seconds = r.seconds || rr.seconds
  const fps = (job.kind === 'finish' && fin?.plan?.finish?.fps) || r.fps || rr.fps
  const model = seedance ? rr.model || 'Seedance 2.5' : 'MiniMax H3'
  const MODES = { text: 'Text', reference: 'References', frames: 'First / last frame', continue: 'Continue a video' }
  add('Model', model)
  add('Kind', MODES[request.mode] || request.mode)
  add('Size', width && height ? `${width} × ${height}` : null)
  add('Length', seconds ? `${Math.round(seconds * 10) / 10} s${fps ? ` at ${fps} fps` : ''}` : null)
  const ch = request.character && request.character !== 'none' ? characters.find((c) => c.id === request.character) : null
  add('Character', ch?.name || null)
  const loras = (request.extraLoras || []).filter((l) => l?.name).map((l) => `${String(l.name).split(/[\\/]/).pop().replace(/\.safetensors$/, '')}${l.strength != null && l.strength !== 1 ? ` ${l.strength}` : ''}`)
  add('LoRAs', loras.join(', ') || null)
  const refmods = (request.refmods || []).filter((x) => x?.name).map((x) => String(x.name).split(/[\\/]/).pop())
  add('RefMods', refmods.join(', ') || null)
  const seed = rr.seeds && candidate ? rr.seeds[candidate - 1] : null
  add('Seed', seed)
  if (!seedance && (request.steps || rr.steps)) add('Steps', request.steps || rr.steps)
  if (job.kind === 'previews') add('Take', candidate ? `Preview ${candidate} of ${rr.previews || '?'}` : null)
  // how it was finished, and enhanced
  const f = fin?.plan?.finish
  if (f) {
    if (seedance) add('Finish', f.way === 'seedance' ? 'Seedance 1080p' : f.way === 'take' ? 'The take, as it is' : f.refiner === 'h3' || f.refiner === 'h3seedvr2' ? `H3 at ${f.megapixels || 2} MP, strength ${f.strength ?? 'light'}${f.refiner === 'h3seedvr2' ? ', then SeedVR2' : ', then DLSS 5'}` : f.refiner === 'dlss' ? 'DLSS 5' : `SeedVR2 ${f.resolution || 1080}p`)
    else add('Finish', `${f.megapixels || 2} MP from preview ${f.candidate || 1}${f.enhancer === 'seedvr2' ? ', then SeedVR2' : f.upscale2x ? ', DLSS 5 and RTX 2×' : ', DLSS 5'}${f.dlssStrength != null ? ` (strength ${f.dlssStrength}${f.dlssStyle && f.dlssStyle !== 'Default' ? `, ${f.dlssStyle}` : ''})` : ''}${f.fps ? `, ${f.fps} fps` : ''}`)
  }
  const e = job.kind === 'enhance' ? job.plan?.enhance : null
  if (e) add('Enhanced', e.engine === 'dlss' ? `DLSS 5 ${e.scale}×${e.strength != null ? `, strength ${e.strength}` : ''}${e.style && e.style !== 'Default' ? `, ${e.style}` : ''}` : `SeedVR2 ${e.resolution}p${e.detail ? `, detail ${e.detail}` : ''}`)
  if (job.seconds) add('Render time', job.seconds >= 90 ? `${Math.floor(job.seconds / 60)} min ${job.seconds % 60} s` : `${job.seconds} s`)
  const cost = job.plan?.cost
  add('Cost', cost?.usd != null ? `$${cost.usd.toFixed(2)} of Comfy credits` : seedance ? null : 'Free, on this PC')
  const prompt = run?.plan?.asked?.prompt || request.prompt || null
  const tile = [width && height ? `${width}×${height}` : null, seconds ? `${Math.round(seconds)} s` : null, seedance ? 'Seedance' : 'H3'].filter(Boolean).join(' · ')
  return { facts, tile, prompt, model: seedance ? 'seedance' : 'h3', width: width || null, height: height || null, duration: seconds || null, renderSeconds: job.seconds || null, cost: cost?.usd ?? null }
}

export class Studio {
  // models: { text, frames, reference, continue, take, retake } -> a UNET name per workflow (Settings).
  constructor({ dataDir, resourcesDir, comfyUrl, comfyToken = null, comfyApiKey = null, outputDir, models = null }) {
    this.models = models || {}
    this.dataDir = dataDir
    this.resourcesDir = resourcesDir
    this.template = JSON.parse(fs.readFileSync(path.join(resourcesDir, 'workflows', 'iv_studio_api.json'), 'utf8'))
    this.meta = JSON.parse(fs.readFileSync(path.join(resourcesDir, 'workflows', 'iv_studio_api.groups.json'), 'utf8'))
    this.manifest = JSON.parse(fs.readFileSync(path.join(resourcesDir, 'models.json'), 'utf8'))
    this.comfy = new Comfy(comfyUrl, `iv-studio-${randomUUID().slice(0, 8)}`, comfyToken, comfyApiKey)
    this.comfy.fileMapper = () => this.modelFiles()
    this.outputDir = outputDir || null
    this.progress = new Map() // promptId -> {value, max, node}
    this.live = new Map() // promptId -> the latest live preview step { image (data URL), step, total, take, at }
    this.running = null // the prompt ComfyUI is executing now, from its websocket
    this.cast = new Cast({ dataDir, characters: () => this.characters(), facePicture: (c) => this.facePicture(c, resourcesDir) })
  }

  // A character's face picture: its own, else the ready-made catalogue's (resources/characters).
  facePicture(ch, resourcesDir) {
    if (ch?.picture && fs.existsSync(ch.picture)) return ch.picture
    try {
      const dir = path.join(resourcesDir, 'characters')
      const ready = JSON.parse(fs.readFileSync(path.join(dir, 'catalog.json'), 'utf8')).characters.find((c) => c.id === ch?.id)
      const file = ready?.picture && path.join(dir, ready.picture)
      return file && fs.existsSync(file) ? file : null
    } catch {
      return null
    }
  }

  // ---------- characters ----------
  characters() {
    return readJson(path.join(this.dataDir, 'characters.json'), DEFAULT_CHARACTERS)
  }
  saveCharacters(list) {
    writeJson(path.join(this.dataDir, 'characters.json'), list)
    return list
  }

  // ---------- projects ----------
  projectFile = (id) => path.join(this.dataDir, 'projects', `${id}.json`)
  listProjects() {
    const dir = path.join(this.dataDir, 'projects')
    if (!fs.existsSync(dir)) return []
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => readJson(path.join(dir, f), null))
      .filter(Boolean)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }
  getProject(id) {
    const p = readJson(this.projectFile(id), null)
    if (!p) throw new Error(`No project ${id}`)
    return p
  }
  // sequenceId / trainingId / tool: the project holds a sequence's shots, a character training's renders or a
  // workflow's runs (tool 'replace'), and stays out of Shots.
  createProject(name, sequenceId = null, trainingId = null, tool = null) {
    const p = { id: randomUUID().slice(0, 8), name: name || 'Untitled shot', createdAt: now(), updatedAt: now(), jobs: [], sequenceId, ...(trainingId && { trainingId }), ...(tool && { tool }) }
    writeJson(this.projectFile(p.id), p)
    return p
  }
  touchProject(id, jobId) {
    const p = this.getProject(id)
    if (jobId && !p.jobs.includes(jobId)) p.jobs.push(jobId)
    p.updatedAt = now()
    writeJson(this.projectFile(id), p)
    return p
  }
  // A shot and its run history. The rendered videos stay in ComfyUI's output folder.
  deleteProject(id) {
    const p = this.getProject(id)
    for (const j of p.jobs) fs.rmSync(this.jobFile(j), { force: true })
    fs.rmSync(this.projectFile(id), { force: true })
    return true
  }
  renameProject(id, name) {
    const p = this.getProject(id)
    p.name = name
    writeJson(this.projectFile(id), p)
    return p
  }

  // ---------- setup ----------
  // The name this ComfyUI lists each model under (setup.js modelFileMap), read from just their loader nodes.
  async modelFiles() {
    const classes = [...new Set(this.manifest.models.flatMap((m) => [m.loader, m.altLoader].filter(Boolean).map((l) => l.split('.')[0])))]
    const info = Object.assign({}, ...(await Promise.all(classes.map((c) => this.comfy.objectInfo(c).catch(() => ({}))))))
    return modelFileMap(this.manifest, info, this.models)
  }

  // An unreachable ComfyUI still reports remote, so the title bar keeps its cloud badge and GPU meter.
  async checkSetup() {
    let result
    try {
      result = await checkSetup({ comfy: this.comfy, template: this.template, manifest: this.manifest, characters: this.characters(), chosen: this.models })
      this.comfy.fileMap = null
    } catch (err) {
      return { ready: false, items: [{ id: 'comfyui', label: 'ComfyUI', status: 'missing', detail: err.message }], remote: this.comfy.remote, hosted: this.comfy.hosted }
    }
    if (result.items[0]?.status === 'ok') result.caps = await this.capabilities(true).catch(() => null)
    return { ...result, remote: this.comfy.remote, hosted: this.comfy.hosted }
  }

  // Adds the node packs this ComfyUI is missing (nodepacks.js), at the versions IV Studio is tested with. folder: the
  // ComfyUI folder picked in Settings, used when ComfyUI doesn't say where custom_nodes is. Restart ComfyUI afterwards.
  async installNodePacks({ folder, onProgress } = {}) {
    if (this.comfy.remote) throw new Error('Node packs for the cloud are installed by IV Studio’s cloud setup, not here.')
    // object_info says which nodes it has. Only a ComfyUI that isn't there is "start it": a busy one is told to wait,
    // and one on another port is named.
    let info
    try {
      info = await this.comfy.objectInfo()
    } catch (err) {
      const why = await whyUnreached(this.comfy, err)
      if (why.busy) throw new Error(err.message)
      if (why.address) throw new Error(`${why.detail} Set that address in Settings → ComfyUI, then press Install again.`)
      if (why.down) throw new Error(`Start ComfyUI first (${err.message}): IV Studio asks it which nodes it already has and where its custom_nodes folder is.`)
      throw new Error(`ComfyUI couldn’t list its nodes: ${err.message}`)
    }
    // only for which packs suit Linux; this ComfyUI is on this PC, so this PC's system stands in if it's slow to say
    const stats = await this.comfy.systemStats().catch(() => null)
    const os = stats?.system?.os || process.platform
    const packs = missingPacks(this.manifest, info, { linux: !['nt', 'win32'].includes(os) })
    if (!packs.length) return { results: [], restart: false }
    const place = await comfyPlace(this.comfy, folder)
    const results = await installPacks(packs, { ...place, resourcesDir: this.resourcesDir, onProgress })
    return { customNodes: place.customNodes, python: place.python, results, restart: results.some((r) => r.status === 'installed' || r.status === 'skipped') }
  }

  // ---------- updating ComfyUI, its node packs and ComfyUI-Manager (comfyupdate.js) ----------
  // Only a ComfyUI on this PC. launcher: the one IV Studio starts ComfyUI with (comfylauncher.js launcherFor), to tell
  // the ComfyUI Desktop app (which updates ComfyUI and Manager itself) from the rest.
  localOnly() {
    if (this.comfy.remote || !isLocalUrl(this.comfy.url)) throw new Error('Updates run on this PC’s ComfyUI only.')
  }

  // A ComfyUI without ComfyUI-Manager answers { manager: { present: false } } (the window offers to install it).
  async comfyUpdates({ launcher = null } = {}) {
    this.localOnly()
    const desktop = isDesktopLauncher(launcher)
    try {
      return { ...(await checkUpdates(this.comfy, { desktop })), last: readRecord(this.dataDir) }
    } catch (err) {
      if (err.code === 'missing') return { manager: { present: false, version: null, policy: null }, desktop, last: readRecord(this.dataDir) }
      throw err
    }
  }

  // Snapshot, update everything, restart, and record what happened for Undo. onProgress: { phase, done, total }.
  async updateComfy({ folder = null, launcher = null, onProgress = () => {} } = {}) {
    this.localOnly()
    await this.beforeRender?.() // the voice engine gives its GPU back, as before a render
    const place = await comfyPlace(this.comfy, folder)
    const comfyRoot = path.dirname(place.customNodes)
    const before = (await this.comfy.systemStats()).system?.comfyui_version || null
    // the packs switched on now: Undo switches back on any that Manager's restore switches off (comfyupdate.js reenable)
    const enabledPacks = packFolders(place.customNodes)
    const { snapshot, results, reported } = await update(this.comfy, { desktop: isDesktopLauncher(launcher), onProgress })
    const record = { snapshot, snapshotCopy: copySnapshot(this.dataDir, comfyRoot, snapshot), comfyRoot, customNodes: place.customNodes, enabledPacks, at: new Date().toISOString(), comfyuiBefore: before, comfyuiAfter: null, results, reported }
    writeRecord(this.dataDir, record) // before the restart, so Undo works even if ComfyUI doesn't come back
    onProgress({ phase: 'restarting' })
    const { version } = await restart(this.comfy)
    record.comfyuiAfter = version
    // Manager says success-stable-vX for ComfyUI even when it was on vX already
    const core = record.results.find((r) => r.pack === 'comfyui')
    if (core?.status === 'updated' && before && before === version) Object.assign(core, { status: 'current', message: null })
    writeRecord(this.dataDir, record)
    await this.capabilities(true).catch(() => null)
    onProgress({ phase: 'done' })
    return record
  }

  // Puts the last update's snapshot back and restarts ComfyUI, then switches back on the packs Manager's restore
  // switched off (plain folders a snapshot can't track, IV Studio's own pack among them) and restarts once more.
  // start: starts ComfyUI with the person's launcher (the app passes its own); without it, a ComfyUI that was down
  // reports startNeeded, and calling this again once ComfyUI is up finishes the job.
  async undoComfyUpdate({ folder = null, start = null, onProgress = () => {} } = {}) {
    this.localOnly()
    const record = readRecord(this.dataDir)
    if (!record?.snapshot) throw new Error('There’s no update to undo.')
    const isUp = await comfyUp(this.comfy.url, 2000)
    let comfyRoot = record.comfyRoot || null
    if (isUp) comfyRoot = path.dirname((await comfyPlace(this.comfy, folder)).customNodes)
    else if (!comfyRoot && folder) comfyRoot = fs.existsSync(path.join(folder, 'ComfyUI')) ? path.join(folder, 'ComfyUI') : folder
    const customNodes = record.customNodes || (comfyRoot && path.join(comfyRoot, 'custom_nodes'))
    // after the restore ran: switch the packs back on, restart if any moved
    const finish = async (via) => {
      const reenabled = customNodes ? reenable(customNodes, record.enabledPacks || []) : []
      let version = (await this.comfy.systemStats()).system?.comfyui_version || null
      if (reenabled.length) {
        onProgress({ phase: 'restarting' })
        version = (await restart(this.comfy)).version
      }
      writeRecord(this.dataDir, { ...record, restorePending: false, undoneAt: new Date().toISOString() })
      await this.capabilities(true).catch(() => null)
      onProgress({ phase: 'done' })
      return { via, version, snapshot: record.snapshot, reenabled }
    }
    if (isUp && record.restorePending) return finish('file') // the restore ran when ComfyUI last started
    onProgress({ phase: 'restoring' })
    const { via } = await undo(this.comfy, record, { comfyRoot })
    if (via === 'api') {
      onProgress({ phase: 'restarting' })
      await restart(this.comfy)
      return finish(via)
    }
    writeRecord(this.dataDir, { ...record, restorePending: true })
    if (!start) return { via, startNeeded: true, snapshot: record.snapshot }
    onProgress({ phase: 'restarting' })
    await start()
    return finish(via)
  }

  // ComfyUI-Manager itself, for a ComfyUI that hasn't got it (it registers no nodes, so Setup's node check can't see it).
  async installManager({ folder = null, onProgress } = {}) {
    this.localOnly()
    const place = await comfyPlace(this.comfy, folder)
    const results = await installPacks([MANAGER_PACK], { ...place, resourcesDir: this.resourcesDir, onProgress })
    return { results, restart: results.some((r) => r.status === 'installed') }
  }

  // What the connected ComfyUI can do (Linux paths, DLSS or the cloud's upscale + RIFE); cached.
  async capabilities(refresh = false) {
    if (!this._caps || refresh) {
      const [info, stats] = await Promise.all([this.comfy.objectInfo(), this.comfy.systemStats()])
      this._caps = capabilities(info, stats)
    }
    return this._caps
  }

  // ---------- planning ----------
  // With @ mentions resolved as a render would (cast.js); notes says what they turned into.
  planRender(given, finish) {
    if (given.engine === SEEDANCE) return this.planSeedanceRender(given)
    const members = this.cast.members()
    const { request, notes } = resolveMentions(withCast(applySpeed(given), members), members)
    const plan = planPreviews(request, this.characters())
    const out = { resolved: plan.resolved, groups: plan.groups, notes, mode: request.mode }
    if (finish !== false) out.finish = planFinish(plan, { candidate: 1, ...(finish || {}) }).resolved
    return out
  }

  // Local files (absolute paths) are uploaded into ComfyUI's input folder; names already in input pass through.
  async stage(file, sub) {
    if (!file) return file
    if (/^[a-zA-Z]:[\\/]|^\//.test(file)) {
      if (!fs.existsSync(file)) throw new Error(`File not found: ${file}`)
      return this.comfy.upload(file, sub)
    }
    return file
  }

  // characterOverride: a character that isn't a saved preset (a training's checkpoint under test).
  async generatePreviews(input) {
    if (input.engine === SEEDANCE) return this.seedancePreviews(input)
    const { projectId, projectName, characterOverride, ...given } = input
    // a speed preset (speed.js) fills the preview size, steps and takes the request leaves out
    const asked = applySpeed(given)
    // @ mentions (cast.js): the picked character's becomes {char}; anyone or anywhere else with a picture is attached
    const members = this.cast.members()
    const { request, notes } = resolveMentions(withCast(asked, members), members)
    const unknown = notes.filter((n) => n.level === 'error')
    if (unknown.length) throw new Error(unknown.map((n) => n.message).join(' '))
    const project = projectId ? this.getProject(projectId) : this.createProject(projectName || shotName(request.prompt, this.characters().find((c) => c.id === request.character)))
    const media = []
    // soft mouth (softmouth.js): a video reference's mouths blurred, so the new face doesn't mouth its words; only
    // when the shot has no spoken line
    const softMouth = (m) => m.kind === 'video' && m.softMouth && !speaks(request)
    if ((request.media || []).some(softMouth) && !this.softMouth) throw new Error('Soft mouth isn’t available here.')
    for (const m of request.media || []) {
      // H3's media loader refuses a video without sound when it's told to pair it (a previs, a silent clip)
      const local = softMouth(m) ? (await this.softMouth(m.file || m.path)).path : m.file || m.path
      const sound = m.kind === 'video' && m.hasAudio === undefined && local && fs.existsSync(local) ? { hasAudio: (await probe(FFPROBE, local).catch(() => null))?.hasAudio ?? true } : {}
      media.push({ ...m, ...sound, file: await this.stage(local, 'minimax_h3') })
    }
    const voiceLine = request.voiceLine ? await this.stage(request.voiceLine, 'iv_studio') : null
    const characters = characterOverride ? [...this.characters(), characterOverride] : this.characters()
    const plan = planPreviews({ ...request, media, voiceLine, ...(characterOverride && { character: characterOverride.id }) }, characters)
    const unet = this.models[plan.request.mode]
    if (unet) plan.values[`${MODEL_NODES[plan.request.mode]}.unet_name`] = unet
    // the run keeps what was asked as written (mentions and all, media as local files), for "Edit and run again"
    plan.asked = { prompt: asked.prompt, mode: asked.mode, media: (asked.media || []).map((m) => ({ kind: m.kind, file: m.file || m.path, ...(m.softMouth ? { softMouth: true } : {}) })), voiceLine: asked.voiceLine || null, ...(asked.with?.length ? { with: asked.with } : {}) }
    const run = project.jobs.length + 1
    const name = `${slug(project.name)}_${project.id}_r${run}`
    plan.values['80'] = name
    return this.submit({ kind: 'previews', project, plan, name })
  }

  // What a finish of this previews job would produce, without rendering.
  planFinishJob(jobId, finish) {
    const source = this.getJob(jobId)
    if (source.kind !== 'previews') throw new Error('Needs a previews job id.')
    if (source.plan?.engine === SEEDANCE) return this.seedanceFinishPlan(source, finish)
    return planFinish(source.plan, finish).resolved
  }

  // fallbackSpeed: the saved preset, for a shot made without one; the shot's own preset wins
  async finishCandidate({ jobId, speed, fallbackSpeed, ...given }) {
    const source = this.getJob(jobId, { refresh: false })
    if (source.kind !== 'previews') throw new Error('finish_candidate needs a previews job id.')
    if (source.plan?.engine === SEEDANCE) return this.seedanceFinish(source, given)
    const caps = await this.capabilities()
    const finish = applyFinishSpeed(given, speed || source.plan.request?.speed || fallbackSpeed, caps)
    if (finish.fps && !caps.fps.includes(finish.fps)) throw new Error(`This ComfyUI can make ${caps.fps.filter(Boolean).join(', ') || 'no other'} fps.`)
    if (finish.upscale2x && !caps.upscale2x && finish.enhancer !== 'seedvr2') throw new Error('This ComfyUI has no 2x upscaler.')
    if (finish.enhancer === 'seedvr2' && this.comfy.hosted) throw new Error('SeedVR2 runs on this PC\'s ComfyUI or your own cloud (RunPod, Modal), not on Comfy Cloud.')
    const plan = planFinish(source.plan, finish)
    plan.values['80'] = source.name
    return this.submit({ kind: 'finish', project: this.getProject(source.projectId), plan, name: source.name, parent: source.id, previewPlan: source.plan })
  }

  // ---------- Seedance 2.5 (seedance.js): the same shots on ComfyUI's ByteDance partner nodes ----------
  // partnerKey: () => the person's Comfy.org API key (the app's sealed key, or the MCP server's environment).
  seedanceRequest(asked) {
    const { request, notes } = seedanceMentions(asked, this.cast.members())
    const unknown = notes.filter((n) => n.level === 'error')
    if (unknown.length) throw new Error(unknown.map((n) => n.message).join(' '))
    const character = request.character && request.character !== 'none' ? this.characters().find((c) => c.id === request.character) : null
    const plan = planSeedance(request, this.characters(), { face: character ? this.facePicture(character, this.resourcesDir) : null })
    plan.notes = [...notes.map((n) => n.message), ...plan.notes]
    return plan
  }

  planSeedanceRender(asked) {
    const plan = this.seedanceRequest({ ...asked, prompt: asked.prompt || 'x' })
    const { resolved, request } = plan
    const finish = resolved.draft ? { ...sizeOf(FINAL_FROM_DRAFT.short, request.aspect), seconds: resolved.seconds, fps: 24 } : { width: resolved.width, height: resolved.height, seconds: resolved.seconds, fps: 24 }
    return { resolved, groups: [], notes: plan.notes.map((message) => ({ level: 'warning', message })), mode: request.mode, engine: SEEDANCE, finish }
  }

  // The graph for a request, with the references staged into ComfyUI (or, to price it, only named).
  async seedanceBuild(plan, name, { stage = true } = {}) {
    const put = (f) => (stage ? this.stage(f, 'seedance') : Promise.resolve(path.basename(f || '')))
    const staged = { pictures: [], videos: [], audios: [] }
    for (const k of Object.keys(staged)) for (const f of plan.refs[k]) staged[k].push(await put(f))
    const probe = { a: { class_type: plan.node.cls }, b: { class_type: 'SaveVideo' }, c: { class_type: 'PreviewAny' }, d: { class_type: 'LoadImage' }, e: { class_type: 'LoadVideo' }, f: { class_type: 'LoadAudio' } }
    const info = await infoFor(this.comfy, probe)
    if (!info[plan.node.cls]) throw new Error(`This ComfyUI has no ${plan.node.cls}. Seedance 2.5 needs ComfyUI 0.44 or newer (Settings → Setup → Updates).`)
    const graph = seedanceGraph(plan, staged, info, name)
    if (stage) {
      const problems = graphProblems(graph, info)
      if (problems.length) throw new Error(`Internal graph error: ${problems.join('; ')}`)
    }
    return { graph, info }
  }

  // What a Seedance request (Create's form) would cost: { paid, min, max, credits, label, nodes, unknown }.
  async priceRender(asked) {
    if (asked.engine !== SEEDANCE) return { paid: false, label: 'Free on this PC', min: 0, max: 0, nodes: [], unknown: [] }
    const plan = this.seedanceRequest({ ...asked, prompt: asked.prompt || 'x' })
    const { graph, info } = await this.seedanceBuild(plan, 'price', { stage: false })
    return priceGraph(graph, info)
  }

  // What finishing a take would cost: Draft to Final for a draft, nothing for a take used as it is.
  async priceFinish({ jobId, way = 'seedance' }) {
    const source = this.getJob(jobId)
    if (source.plan?.engine !== SEEDANCE || !source.plan.resolved.draft || way !== 'seedance') return { paid: false, label: 'Free', min: 0, max: 0, nodes: [], unknown: [] }
    const graph = finalGraph('x', null, 'price')
    const price = await priceGraph(graph, await infoFor(this.comfy, graph))
    // ComfyUI prices Draft to Final as one flat range (any length); a 1080p Seedance 2.5 take of this draft's length
    // and shape is the likely figure, shown beside it (the OK still has to cover the top of ComfyUI's range)
    try {
      const { request, resolved } = source.plan
      const like = { t: { class_type: SEEDANCE_NODES.text, inputs: { model: 'Seedance 2.5', 'model.resolution': '1080p', 'model.ratio': request.aspect, 'model.duration': resolved.seconds, 'model.generate_audio': request.audio !== false } } }
      const likely = await priceGraph(like, await infoFor(this.comfy, like))
      if (likely.paid && !likely.unknown.length) price.likelyUsd = likely.max
    } catch {}
    return price
  }

  async seedancePreviews(input) {
    const { projectId, projectName, spend, ...asked } = input
    const plan = this.seedanceRequest(asked)
    const key = this.partnerKey?.()
    if (!key) throw new Error('Seedance runs on your Comfy.org credits: add your Comfy.org API key in Settings → Comfy account.')
    const character = this.characters().find((c) => c.id === plan.request.character)
    // named from the prompt as written (the role lines IV Studio adds in front would name every shot "@image1 defines…")
    const project = projectId ? this.getProject(projectId) : this.createProject(projectName || shotName(String(asked.prompt || '').replace(/@(image|video|audio)\d+/gi, ''), character))
    const run = project.jobs.length + 1
    const name = `${slug(project.name)}_${project.id}_r${run}`
    const { graph } = await this.seedanceBuild(plan, name)
    plan.asked = { prompt: asked.prompt, mode: asked.mode, media: (asked.media || []).map((m) => ({ kind: m.kind, file: m.file || m.path })), voiceLine: asked.voiceLine || null, engine: SEEDANCE, tier: asked.tier, audio: asked.audio }
    const promptId = await this.comfy.submit(graph, { api_key_comfy_org: key, iv_studio: { kind: 'previews', project: project.id, engine: SEEDANCE } }, { spend })
    return this.recordJob({ kind: 'previews', projectId: project.id, name, promptId, plan: { ...plan, engine: SEEDANCE, cost: this.comfy.lastPrice || null } })
  }

  seedanceFinishPlan(source, finish = {}) {
    const { resolved, request } = source.plan
    const way = finish.way || (resolved.draft ? 'seedance' : 'take')
    if (way === 'seedance' && resolved.draft) return { ...sizeOf(FINAL_FROM_DRAFT.short, request.aspect), seconds: resolved.seconds, fps: 24, way, engine: SEEDANCE }
    if (way === 'local' && (finish.engine === 'h3' || finish.engine === 'h3seedvr2')) {
      const then = finish.engine === 'h3seedvr2' ? 'seedvr2' : 'dlss'
      const r = refineGraph(this.template, { source: { path: 'x', width: resolved.width, height: resolved.height, frames: resolved.frames }, prompt: 'x', name: 'x', ...this.refineOptions({ ...finish, then }) }).resolved
      if (then === 'dlss') return { ...r, way, engine: SEEDANCE, refiner: 'h3' }
      // H3's pass, then SeedVR2 to a short side of `resolution`
      const short = [1080, 1440].includes(finish.resolution) ? finish.resolution : 1080
      const k = short / Math.min(r.width, r.height)
      return { ...r, width: Math.round((r.width * k) / 2) * 2, height: Math.round((r.height * k) / 2) * 2, h3Width: r.width, h3Height: r.height, way, engine: SEEDANCE, refiner: 'h3seedvr2' }
    }
    if (way === 'local') {
      // SeedVR2 to a short side of `resolution` (1080 or 1440)
      const short = [1080, 1440].includes(finish.resolution) ? finish.resolution : 1080
      const k = short / Math.min(resolved.width, resolved.height)
      return { width: Math.round((resolved.width * k) / 2) * 2, height: Math.round((resolved.height * k) / 2) * 2, seconds: resolved.seconds, fps: 24, way, engine: SEEDANCE, refiner: finish.engine === 'dlss' ? 'dlss' : 'seedvr2' }
    }
    return { width: resolved.width, height: resolved.height, seconds: resolved.seconds, fps: 24, way: 'take', engine: SEEDANCE }
  }

  // Finishing a Seedance take. way 'seedance' (a draft only): Draft to Final at 1080p, paid. way 'take': the take
  // itself becomes the shot's final as it is, at once and free (Enhance can then run DLSS 5 or SeedVR2 on it here).
  async seedanceFinish(source, { candidate = 1, way, spend, ...finishOpts } = {}) {
    const take = (source.outputs || []).find((o) => o.kind === 'preview' && o.candidate === candidate)
    if (!take) throw new Error(`Take ${candidate} hasn't finished.`)
    const resolved = this.seedanceFinishPlan(source, { way, ...finishOpts })
    if (resolved.way === 'take') {
      const final = { ...take, kind: 'final' }
      delete final.candidate
      return this.recordJob({ kind: 'finish', projectId: source.projectId, name: source.name, parent: source.id, promptId: null, status: 'success', outputs: [final], plan: { engine: SEEDANCE, finish: { candidate, way: 'take' }, request: source.plan.request, resolved } })
    }
    if (resolved.way === 'local' && (finishOpts.engine === 'h3' || finishOpts.engine === 'h3seedvr2')) return this.refineTake(source, take, { candidate, ...finishOpts, then: finishOpts.engine === 'h3seedvr2' ? 'seedvr2' : 'dlss' })
    if (resolved.way === 'local') {
      // the free finish's default: the take becomes the final, and SeedVR2 (or, quicker, DLSS 5) brings it to 1080p
      // or 1440p on this PC
      if (this.comfy.hosted) throw new Error('The free finish runs on this PC\'s ComfyUI or your own cloud. Use Seedance 1080p, or keep the take as it is.')
      if (this.comfy.ownCloud && resolved.refiner === 'dlss') throw new Error('DLSS 5 runs on Windows PCs only. In the cloud, finish with SeedVR2, Seedance 1080p, or keep the take as it is.')
      const final = { ...take, kind: 'final' }
      delete final.candidate
      const short = Math.min(resolved.width, resolved.height)
      const job = this.recordJob({ kind: 'finish', projectId: source.projectId, name: source.name, parent: source.id, promptId: null, status: 'success', outputs: [final], plan: { engine: SEEDANCE, finish: { candidate, way: 'local', refiner: resolved.refiner, resolution: short }, request: source.plan.request, resolved: { width: source.plan.resolved.width, height: source.plan.resolved.height, seconds: resolved.seconds, fps: 24 } } })
      const takeShort = Math.min(source.plan.resolved.width, source.plan.resolved.height)
      const enhance = resolved.refiner === 'dlss' ? await this.enhanceFinal({ jobId: job.id, engine: 'dlss', scale: Math.round((short / takeShort) * 100) / 100, strength: finishOpts.dlssStrength, style: finishOpts.dlssStyle }) : await this.enhanceFinal({ jobId: job.id, engine: 'seedvr2', resolution: short, detail: finishOpts.detail })
      return this.updateJob(job.id, { enhanceJob: enhance.id })
    }
    if (!take.draftTaskId) throw new Error("That take has no draft task id, so Seedance can't finish it. Use it as it is, or make it again.")
    const key = this.partnerKey?.()
    if (!key) throw new Error('Seedance runs on your Comfy.org credits: add your Comfy.org API key in Settings → Comfy account.')
    const name = `${source.name}_c${candidate}`
    const info = await infoFor(this.comfy, finalGraph('x', null, name))
    if (!info[SEEDANCE_NODES.final]) throw new Error('This ComfyUI has no Seedance 2.5 Draft to Final node. Update ComfyUI (Settings → Setup → Updates).')
    const graph = finalGraph(take.draftTaskId, info, name)
    const promptId = await this.comfy.submit(graph, { api_key_comfy_org: key, iv_studio: { kind: 'finish', project: source.projectId, engine: SEEDANCE } }, { spend })
    return this.recordJob({ kind: 'finish', projectId: source.projectId, name, parent: source.id, promptId, plan: { engine: SEEDANCE, finish: { candidate, way: 'seedance' }, request: source.plan.request, resolved, cost: this.comfy.lastPrice || null } })
  }

  // The free finish on this PC for any take that isn't H3's own (h3refine.js): H3 refines it at the finish size at
  // a light strength, then DLSS 5. strength: 'light' keeps the face Seedance made; 'medium' adds more of H3's detail
  // and changes faces more. character: the shot's character LoRA joins the pass when asked (useLora).
  // strength: 'light', 'medium', or a number from 0.05 to 0.5. dlssStrength / dlssStyle: DLSS 5 after it.
  // then: 'dlss' (DLSS 5 in the same graph) or 'seedvr2' (no DLSS; SeedVR2 runs as its own job once H3 is done)
  refineOptions({ megapixels = REFINE_DEFAULTS.megapixels, strength = 'light', upscale2x = false, dlssStrength = null, dlssStyle = null, then = 'dlss' } = {}) {
    if (![1, 1.5, 2].includes(megapixels)) throw new Error('The finish size is 1, 1.5 or 2 MP.')
    const denoise = typeof strength === 'number' ? Math.min(0.5, Math.max(0.05, strength)) : REFINE_STRENGTH[strength] ?? REFINE_STRENGTH.light
    if (then === 'seedvr2') return { megapixels, denoise, upscale2x: false, dlss: false }
    return { megapixels, denoise, upscale2x: !!upscale2x, dlss: dlssLook({ strength: dlssStrength, style: dlssStyle }) }
  }

  async refineTake(source, take, { candidate, megapixels, strength, upscale2x, useLora = false, dlssStrength = null, dlssStyle = null, then = 'dlss', resolution = 1080, detail = 0 } = {}) {
    if (this.comfy.remote) throw new Error('The H3 pass runs on this PC\'s ComfyUI. In the cloud, finish with SeedVR2 or Seedance 1080p, or keep the take as it is.')
    if (!take.path || !fs.existsSync(take.path)) throw new Error('That take isn\'t on this PC yet.')
    const caps = await this.capabilities()
    if (then === 'dlss' && !caps.dlss) throw new Error('The free finish needs DLSS 5 in ComfyUI (Settings → Setup).')
    const info = await probe(FFPROBE, take.path)
    const frames = Math.round((info.duration || source.plan.resolved.seconds) * (info.fps || 24))
    const request = source.plan.request
    const character = request.character && request.character !== 'none' ? this.characters().find((c) => c.id === request.character) : null
    const name = `${source.name}_c${candidate}_h3`
    let silence = null
    if (!info.hasAudio) silence = await this.stage(await this.silentWav(frames / 24), 'iv_studio')
    const { graph, resolved } = refineGraph(this.template, {
      source: { path: take.path, width: info.width, height: info.height, frames, fps: 24 },
      prompt: source.plan.asked?.prompt || request.prompt,
      character: useLora && character?.lora ? character : null,
      trigger: useLora && character?.trigger ? character.trigger : '',
      name,
      seed: (request.seed || 4242) + 444,
      unet: this.models?.text || null,
      silence,
      ...this.refineOptions({ megapixels, strength, upscale2x, dlssStrength, dlssStyle, then })
    })
    const seedvr2 = then === 'seedvr2' ? { enhancer: 'seedvr2', enhanceResolution: [1080, 1440].includes(resolution) ? resolution : 1080, ...(detail ? { enhanceDetail: Math.min(1, Math.max(0, Number(detail) || 0)) } : {}) } : {}
    await this.makeRoom('finish')
    const promptId = await this.comfy.submit(graph, { iv_studio: { kind: 'finish', project: source.projectId, engine: SEEDANCE } })
    return this.recordJob({ kind: 'finish', projectId: source.projectId, name, parent: source.id, promptId, plan: { engine: SEEDANCE, finish: { candidate, way: 'local', refiner: then === 'seedvr2' ? 'h3seedvr2' : 'h3', megapixels, strength, upscale2x: then === 'dlss' && !!upscale2x, useLora: !!(useLora && character?.lora), ...(then === 'dlss' && dlssStrength != null ? { dlssStrength } : {}), ...seedvr2 }, request, resolved: { ...resolved, way: 'local' } } })
  }

  // A silent WAV of `seconds`, for a take without sound (made once per length, in the data folder).
  async silentWav(seconds) {
    const file = path.join(this.dataDir, 'seedance', `silence_${Math.ceil(seconds * 10)}.wav`)
    if (fs.existsSync(file)) return file
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const ffmpeg = ffmpegStatic.ffmpegPath.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`)
    await new Promise((resolve, reject) => {
      const p = spawn(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', String(Math.ceil(seconds * 10) / 10), file], { windowsHide: true })
      p.on('error', reject)
      p.on('close', (code) => (code === 0 ? resolve() : reject(new Error('Could not make a silent track.'))))
    })
    return file
  }

  // Saves a job record (as submitGraph does for H3 graphs) and returns it as the window sees it.
  recordJob({ kind, projectId, name, promptId, plan, parent = null, status = 'queued', outputs = [] }) {
    const job = { id: randomUUID().slice(0, 12), kind, projectId, sequenceId: null, parent, name, promptId, status, createdAt: now(), where: this.comfy.remote ? 'cloud' : 'local', plan, outputs, ...(status === 'success' ? { finishedAt: now() } : {}) }
    writeJson(this.jobFile(job.id), job)
    if (projectId) this.touchProject(projectId, job.id)
    return this.publicJob(job)
  }

  // Seedance's SaveVideo reports no file path, so its videos are copied into the data folder's seedance folder
  // (also from a remote ComfyUI), where the editor, Enhance and the Library can use them.
  async keepLocal(job) {
    const dir = path.join(this.dataDir, 'seedance')
    for (const o of job.outputs) {
      if (o.path && fs.existsSync(o.path)) continue
      try {
        o.path = await this.localCopy(o, dir)
      } catch {}
    }
  }

  async submit({ kind, project, plan, name, parent, previewPlan }) {
    let prompt = buildPrompt(this.template, this.meta, plan.groups, plan.values)
    // live previews of each step (remote.js), on this PC only: the cloud has no websocket to send them over
    // (a finish shows its 2 MP pass, a little larger)
    if (['previews', 'finish'].includes(kind) && this.livePreview !== false && !this.comfy.remote && (await this.capabilities()).livePreview) {
      prompt = withLivePreview(prompt, kind === 'finish' ? { guiders: ['14', '26'], size: 640 } : {})
    }
    return this.submitGraph({ kind, graph: prompt, projectId: project.id, plan, name, parent, previewPlan })
  }

  // Before a render on this PC: IV Studio's own GPU users stop (beforeRender, set by the app and the MCP
  // server: the voice engine), and ComfyUI unloads if the job before this one, IV Studio's or anyone's, was
  // another model family. ComfyUI applies the unload between prompts, never inside one.
  async makeRoom(kind) {
    if (this.comfy.remote) return
    await this.beforeRender?.()
    if ((await this.lastFamily().catch(() => null)) !== familyOf(kind)) await this.comfy.freeMemory().catch(() => {})
  }
  // The family of the last job queued on ComfyUI, or of the last one it ran; 'other' for work that isn't IV Studio's.
  async lastFamily() {
    const q = await this.comfy.queue()
    const queued = [...q.queue_running, ...q.queue_pending].sort((a, b) => a[0] - b[0]).at(-1)
    const last = queued || Object.values(await this.comfy.req('/history?max_items=1'))[0]?.prompt
    if (!last) return null
    const kind = last[3]?.iv_studio?.kind
    return kind ? familyOf(kind) : 'other'
  }

  // Queues any graph and records it as a job. Sequence graphs carry plan.saves so their outputs can be read.
  async submitGraph({ kind, graph: built, projectId = null, sequenceId = null, plan, name, parent, previewPlan }) {
    const caps = await this.capabilities()
    // a finish SeedVR2 will enhance skips DLSS 5 (remote.js swaps its node for a plain save, as on the cloud)
    const graph = adaptGraph(built, plan?.finish?.enhancer === 'seedvr2' ? { ...caps, dlss: false, upscale2x: false, rife: false } : caps, { upscaleSize: plan?.resolved?.upscaleSize })
    const problems = checkPrompt(graph)
    if (problems.length) throw new Error(`Internal graph error: ${problems.join('; ')}`)
    await this.makeRoom(kind)
    const promptId = await this.comfy.submit(graph, { iv_studio: { kind, project: projectId, sequence: sequenceId } })
    const job = {
      id: randomUUID().slice(0, 12),
      kind,
      projectId,
      sequenceId,
      parent: parent || null,
      name,
      promptId,
      status: 'queued',
      createdAt: now(),
      where: this.comfy.remote ? 'cloud' : 'local',
      plan: kind === 'previews' ? plan : { ...plan, preview: undefined },
      previewPlan: previewPlan || undefined,
      outputs: []
    }
    writeJson(this.jobFile(job.id), job)
    if (projectId) this.touchProject(projectId, job.id)
    return this.publicJob(job)
  }

  // ---------- Enhance: SeedVR2 over a finished video ----------
  // A final (or any finished video of a shot) through SeedVR2 3B (numz's ComfyUI-SeedVR2_VideoUpscaler, Apache-2.0)
  // to a short side of `resolution`, with its sound kept, as a new job of kind enhance in the same shot. On this PC or
  // the person's own cloud (SeedVR2 is downloaded there the first time); DLSS 5 on Windows PCs only.
  // engine dlss: DLSS 5 with the finish's own settings (noise reduction Default 0.8), at scale 1 or 2.
  // strength (DLSS 5): its noise reduction, 0-2 (the finish uses 0.8); style: Default, Natural or Cinematic.
  // detail (SeedVR2): its latent noise, 0-1 (0 restores faithfully; more lets it invent detail).
  async enhanceFinal({ jobId, engine = 'seedvr2', resolution = 1080, scale = 1, strength = null, style = null, detail = 0 }) {
    if (this.comfy.hosted) throw new Error('Enhance runs on this PC\'s ComfyUI or your own cloud (RunPod, Modal).')
    const source = this.getJob(jobId)
    const out = source.outputs.find((o) => o.kind === 'final') || source.outputs.find((o) => o.kind === 'master')
    const here = !!(out?.path && fs.existsSync(out.path))
    // in the person's own cloud a render made there is read where it is (its output name); others are uploaded
    if (!here && !(this.comfy.ownCloud && out?.url)) throw new Error('That render has no finished video on this PC to enhance.')
    if (engine === 'dlss') {
      if (this.comfy.ownCloud) throw new Error('DLSS 5 runs on Windows PCs only. In the cloud, enhance with SeedVR2.')
      return this.enhanceDlss(source, out, scale, { strength, style })
    }
    const noise = Math.min(1, Math.max(0, Number(detail) || 0))
    const info = await this.comfy.objectInfo('SeedVR2LoadDiTModel').catch(() => null)
    const dits = info?.SeedVR2LoadDiTModel?.input?.required?.model?.[1]?.options || info?.SeedVR2LoadDiTModel?.input?.required?.model?.[0] || []
    if (!info?.SeedVR2LoadDiTModel) throw new Error('SeedVR2 isn\'t installed in ComfyUI (ComfyUI-SeedVR2_VideoUpscaler).')
    const dit = ENHANCE_MODELS.find((m) => dits.includes(m)) || dits[0]
    const fps = source.plan?.resolved?.fps || 24
    const name = `${path.basename(out.path).replace(/\.[^.]+$/, '').replace(/-audio$/, '')}_enhanced_${resolution}`
    const { batch, overlap, swap } = seedvr2Batch(resolution)
    const src = await this.videoSource(this.comfy.ownCloud && out.url ? out : out.path)
    const graph = {
      load: { class_type: src.cls, inputs: { video: src.video, force_rate: 0, custom_width: 0, custom_height: 0, frame_load_cap: 0, skip_first_frames: 0, select_every_nth: 1, format: 'AnimateDiff' } },
      dit: { class_type: 'SeedVR2LoadDiTModel', inputs: { model: dit, device: 'cuda:0', blocks_to_swap: swap, offload_device: 'cpu', cache_model: false, attention_mode: 'sdpa' } },
      vae: { class_type: 'SeedVR2LoadVAEModel', inputs: { model: 'ema_vae_fp16.safetensors', device: 'cuda:0', encode_tiled: true, decode_tiled: true, offload_device: 'cpu', cache_model: false } },
      up: { class_type: 'SeedVR2VideoUpscaler', inputs: { image: ['load', 0], dit: ['dit', 0], vae: ['vae', 0], seed: 42, resolution, max_resolution: 0, batch_size: batch, uniform_batch_size: false, color_correction: 'lab', temporal_overlap: overlap, offload_device: 'cpu', ...(noise ? { latent_noise_scale: noise } : {}) } },
      save: { class_type: 'VHS_VideoCombine', inputs: { images: ['up', 0], audio: ['load', 2], frame_rate: fps, loop_count: 0, filename_prefix: `H3/enhanced/${name}`, format: 'video/h264-mp4', pix_fmt: 'yuv420p', crf: 16, save_metadata: true, trim_to_audio: false, pingpong: false, save_output: true } }
    }
    const project = source.projectId ? this.getProject(source.projectId) : null
    return this.submitGraph({ kind: 'enhance', graph, projectId: project?.id || null, plan: { enhance: { engine: 'seedvr2', resolution, model: dit, from: out.path || out.url, ...(noise ? { detail: noise } : {}) }, resolved: { ...source.plan?.resolved, fps } }, name, parent: source.id })
  }

  async enhanceDlss(source, out, scale, { strength = null, style = null } = {}) {
    if (!(await this.capabilities()).dlss) throw new Error('DLSS 5 isn\'t installed in ComfyUI.')
    const name = `${path.basename(out.path).replace(/\.[^.]+$/, '').replace(/-audio$/, '')}_dlss_${scale}x`
    const t = this.template['50'].inputs
    // DLSS 5 only reads videos inside ComfyUI's input or output folders, and ComfyUI doesn't say where those are. A
    // video in IV Studio's own data folder (a Seedance take) is first saved into ComfyUI's output by VHS (which reports
    // the path), near-lossless, and DLSS reads that copy.
    const outside = path.resolve(out.path).toLowerCase().startsWith(path.resolve(this.dataDir).toLowerCase())
    const fps = source.plan?.resolved?.fps || 24
    const graph = {
      ...(outside
        ? {
            load: { class_type: 'VHS_LoadVideoPath', inputs: { video: out.path, force_rate: 0, custom_width: 0, custom_height: 0, frame_load_cap: 0, skip_first_frames: 0, select_every_nth: 1, format: 'AnimateDiff' } },
            copy: { class_type: 'VHS_VideoCombine', inputs: { images: ['load', 0], audio: ['load', 2], frame_rate: fps, loop_count: 0, filename_prefix: `H3/enhanced/source_${name}`, format: 'video/h264-mp4', pix_fmt: 'yuv420p', crf: 10, save_metadata: false, trim_to_audio: false, pingpong: false, save_output: true } },
            pick: { class_type: 'VHS_SelectFilename', inputs: { filenames: ['copy', 0], index: -1 } }
          }
        : {}),
      dlss: { class_type: 'DLSS5_Enhance_Video', inputs: { ...t, 'Video Path': outside ? ['pick', 0] : out.path, Scale: scale, 'Target FPS': 0, 'Filename Prefix': name, 'Output Directory': 'H3/enhanced', 'Input FPS': fps, ...dlssLook({ strength, style }) } },
      out: { class_type: 'PreviewAny', inputs: { source: ['dlss', 0] } }
    }
    const project = source.projectId ? this.getProject(source.projectId) : null
    return this.submitGraph({ kind: 'enhance', graph, projectId: project?.id || null, plan: { enhance: { engine: 'dlss', scale, from: out.path, ...dlssLook({ strength, style }, true) }, resolved: source.plan?.resolved }, name, parent: source.id })
  }

  // ---------- renders, files and models (shared by the window and the MCP server) ----------
  // An output as a file on this PC: its own path when local, else downloaded from the (cloud)
  // ComfyUI into dir under the same name.
  // A video for a graph's video loader: on this PC's ComfyUI, its path (VHS_LoadVideoPath). On the person's own cloud,
  // a render already there by its output name ("sub/name.mp4 [output]", VHS_LoadVideo reads ComfyUI's folders), or this
  // PC's file uploaded into ComfyUI's input. file: a path, or an output ({path, url}).
  async videoSource(file) {
    const p = typeof file === 'string' ? file : file?.path
    if (!this.comfy.ownCloud) return { cls: 'VHS_LoadVideoPath', video: p }
    if (typeof file === 'object' && file?.url) {
      const q = new URL(file.url).searchParams
      const sub = q.get('subfolder')
      return { cls: 'VHS_LoadVideo', video: `${sub ? `${sub}/` : ''}${q.get('filename')} [${q.get('type') || 'output'}]` }
    }
    if (!p || !fs.existsSync(p)) throw new Error('That video isn\'t on this PC.')
    return { cls: 'VHS_LoadVideo', video: await this.comfy.upload(p, 'iv_studio/sources') }
  }

  async localCopy(file, dir) {
    const p = typeof file === 'string' ? file : file?.path
    if (p && fs.existsSync(p)) return p
    if (!file?.url) throw new Error('That file is not on this PC.')
    const u = new URL(file.url)
    const dest = path.join(dir, u.searchParams.get('filename'))
    if (!fs.existsSync(dest)) {
      const res = await fetch(`${this.comfy.url}/view${u.search}`, { headers: this.comfy.headers() })
      if (!res.ok) throw new Error(`Download failed (${res.status}).`)
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(`${dest}.part`, Buffer.from(await res.arrayBuffer()))
      fs.renameSync(`${dest}.part`, dest)
    }
    return dest
  }

  // Every IV Studio render, newest first: shot finals and previews, sequence versions and finals.
  library() {
    const items = []
    const chars = this.characters()
    for (const p of this.listProjects()) {
      if (p.trainingId) continue // a character training's test renders
      const jobs = this.listJobs(p.id)
      // a shot hunted more than once numbers its runs, so two takes never share the label "Preview 1"
      const byAge = (a, b) => String(a.createdAt).localeCompare(String(b.createdAt))
      const runs = new Map(jobs.filter((j) => j.kind === 'previews').sort(byAge).map((j, i) => [j.id, i + 1]))
      // several finishes of one run read Final, Final 2...; an enhanced final keeps its finish's name plus how
      const finishes = new Map()
      for (const j of jobs.filter((x) => x.kind === 'finish').sort(byAge)) {
        const n = jobs.filter((x) => x.kind === 'finish' && x.parent === j.parent && byAge(x, j) < 0).length + 1
        finishes.set(j.id, { run: j.parent, name: n > 1 ? `Final ${n}` : 'Final' })
      }
      const enhanced = (e) => (e?.engine === 'dlss' ? `DLSS 5 ${e.scale}×` : `SeedVR2 ${e?.resolution || ''}p`)
      for (const j of jobs) {
        // what was asked for (a finish or an enhance asks through its run), for the Library's filters
        const up = (x) => jobs.find((y) => y.id === x?.parent)
        const req = j.plan?.request || up(j)?.plan?.request || up(up(j))?.plan?.request || {}
        for (const o of j.outputs || []) {
          if (!['final', 'preview'].includes(o.kind)) continue
          // a finish whose cached latent was dropped renders its preview again: the run already shows that take
          if (o.kind === 'preview' && j.kind !== 'previews' && runs.has(j.parent)) continue
          // set: the shot (or the sequence a shot render belongs to), so its takes show as one tile
          const fin = finishes.get(j.kind === 'enhance' ? j.parent : j.id)
          const runRaw = runs.size > 1 && runs.get(j.kind === 'previews' ? j.id : fin?.run ?? j.parent)
          const run = runRaw || 0
          const name = o.kind !== 'final' ? `Preview ${o.candidate}` : j.kind === 'enhance' ? `${fin?.name || 'Final'} · ${enhanced(j.plan?.enhance)}` : fin?.name || 'Final'
          const variant = `${run ? `Run ${run} · ` : ''}${name}`
          const about = renderFacts({ job: j, jobs, output: o, request: req, characters: chars })
          items.push({ ...about, key: `${j.id}:${o.kind}:${o.candidate || ''}`, label: `${p.name} · ${variant.toLowerCase()}`, group: p.tool === 'replace' ? 'Replace' : p.sequenceId ? 'Sequence shots' : 'Shots', at: j.finishedAt || j.createdAt, file: { path: o.path, url: o.url, filename: o.filename }, set: p.sequenceId ? `sequence:${p.sequenceId}` : `project:${p.id}`, setName: p.name.replace(/ \(sequence\)$/, ''), variant: p.sequenceId ? `Shot ${variant.toLowerCase()}` : variant, rank: (o.kind === 'final' ? 0 : 10 + (o.candidate || 0)) + (run ? (runs.size - run) * 100 : 0), projectId: p.sequenceId ? null : p.id, sequenceId: p.sequenceId || null, mode: req.mode || null, character: req.character || null, aspect: req.aspect || null })
        }
      }
    }
    for (const sq of this.listSequences()) {
      const v = this.sequenceView(sq.id)
      const set = { set: `sequence:${sq.id}`, setName: sq.name, sequenceId: sq.id, projectId: null }
      for (const x of v.versions) if (x.file) items.push({ key: `${sq.id}:${x.id}`, label: `${sq.name} · ${x.label}`, group: 'Sequences', at: x.createdAt, file: x.file, ...set, variant: x.label, rank: 5 })
      for (const r of v.renders) if (r.file) items.push({ key: `${sq.id}:r:${r.id}`, label: `${sq.name} · final`, group: 'Sequences', at: r.createdAt, file: r.file, ...set, variant: 'Final', rank: 0 })
    }
    const seen = new Set() // a finish job lists its picked preview again
    const out = items.filter((i) => !seen.has(i.file.path || i.file.url) && seen.add(i.file.path || i.file.url)).sort((a, b) => String(b.at).localeCompare(String(a.at)))
    const named = new Map() // the same version made twice (a SeedVR2 run repeated) reads "… (2)" for the newer one
    for (const i of [...out].reverse()) {
      const k = `${i.set}|${i.variant}`
      const n = (named.get(k) || 0) + 1
      named.set(k, n)
      if (n > 1) Object.assign(i, { variant: `${i.variant} (${n})`, label: `${i.label} (${n})` })
    }
    return out
  }

  // H3 models the ComfyUI can load, and each workflow's default (Settings -> Models).
  async h3Models() {
    const all = comboOptions(await this.comfy.objectInfo('UNETLoader'), 'UNETLoader', 'unet_name') || []
    const t = this.template
    // a default names the file as this ComfyUI lists it (top of the folder or in a subfolder; GitHub #29)
    const listed = (n) => all.find((o) => fileBase(o) === fileBase(n)) || n
    return {
      models: all.filter((n) => /h3|minimax/i.test(n)),
      defaults: Object.fromEntries(Object.entries({ text: t['101'].inputs.unet_name, frames: t['201'].inputs.unet_name, reference: t['301'].inputs.unet_name, continue: t['601'].inputs.unet_name, take: t['301'].inputs.unet_name, retake: t['301'].inputs.unet_name }).map(([k, v]) => [k, listed(v)]))
    }
  }

  // LoRA names ComfyUI lists, and the loras folder new character LoRAs go in: the one already holding
  // "MiniMax H3" (ComfyUI may list its install's own folder first, ahead of a shared one).
  async loraNames() {
    return comboOptions(await this.comfy.objectInfo('LoraLoaderModelOnly'), 'LoraLoaderModelOnly', 'lora_name') || []
  }
  async loraRoot() {
    const folders = (await fetch(`${this.comfy.url}/experiment/models`, { headers: this.comfy.headers() }).then((r) => r.json())).find((f) => f.name === 'loras')?.folders || []
    const real = folders.filter((f) => fs.existsSync(f))
    const root = real.find((f) => fs.existsSync(path.join(f, 'MiniMax H3'))) || real[0]
    if (!root) throw new Error("Couldn't find this ComfyUI's loras folder (character downloads need a ComfyUI on this PC).")
    return root
  }

  // Character LoRAs and RefMods the ComfyUI can load (for new characters and refmods in a request).
  async choices() {
    const refmod = this.template['1101'].class_type
    const [l, r] = await Promise.all([this.comfy.objectInfo('LoraLoaderModelOnly'), this.comfy.objectInfo(refmod)])
    return { loras: comboOptions(l, 'LoraLoaderModelOnly', 'lora_name') || [], refmods: (comboOptions(r, refmod, 'mod_1') || []).filter((n) => n !== '(none)') }
  }

  // ---------- prompt writer ----------
  // request: {idea, mode, seconds, aspect, character, media, sequence, previous}. engine: local | claude | codex |
  // contextir; model: the local model, or the Claude Code or Codex model ('' for the person's own default).
  async writePrompt(request, { engine = 'local', apiKey = null, model } = {}) {
    let { idea, character: charId = 'none', mode = 'text', seconds = 5, aspect = '16:9', media = [], sequence = false, previous = null } = request
    if (!idea?.trim()) throw new Error('Describe the idea first.')
    // a Seedance 2.5 shot: its own guide and reference names (seedwriter.js); Context IR is H3's own rewriter
    if (request.engine === SEEDANCE) {
      const character = charId === 'none' ? null : this.characters().find((c) => c.id === charId) || null
      const files = media.map((m) => ({ kind: m.kind, file: m.file || m.path }))
      return writeSeedance({ engine: engine === 'contextir' ? 'local' : engine, model: engine === 'contextir' ? undefined : model, idea, mode, seconds, character, face: character ? this.facePicture(character, this.resourcesDir) : null, media: files, voiceLine: request.voiceLine || null, resourcesDir: this.resourcesDir, cpu: engine === 'local' && (await this.gpuBusy()) })
    }
    const character = charId === 'none' ? null : this.characters().find((c) => c.id === charId) || null
    const files = media.map((m) => ({ kind: m.kind, file: m.file || m.path }))
    // the others picked in "Who's in it" (GitHub #30): the writer names them, and the render attaches their faces
    const also = (request.with || []).filter((id) => id !== charId).map((id) => this.characters().find((c) => c.id === id)?.name).filter(Boolean)
    if (also.length) idea = `${idea.trim()}\n\nAlso in the shot: ${also.join(', ')}. Name them by first name; never describe their face, hair or voice (their pictures carry those).`
    if (engine === 'local') return writeLocal({ idea, mode, seconds, character, sequence, previous, media: files, model, cpu: await this.gpuBusy() })
    if (isHarness(engine)) return writeHarness({ engine, model, idea, mode, seconds, character, sequence, previous, media: files })
    if (engine !== 'contextir') throw new Error(`Unknown writer "${engine}".`)
    if (!apiKey) throw new Error('MiniMax Context IR needs a Comfy.org API key. Add it in Settings → Prompt writer.')
    const staged = []
    for (const m of files) staged.push({ kind: m.kind, name: await this.stage(m.file, 'iv_studio') })
    const graph = contextIrGraph({ idea, mode, seconds, aspect, character, media: staged, sequence })
    // Choosing Context IR in Settings (which shows its price, a few cents a prompt) is the OK for each prompt.
    const promptId = await this.comfy.submit(graph, { api_key_comfy_org: apiKey, iv_studio: { kind: 'write_prompt' } }, { front: true, spend: { approvedUsd: 0.25 } })
    for (let i = 0; i < 150; i++) {
      await new Promise((r) => setTimeout(r, 2000))
      const h = (await this.comfy.history(promptId))[promptId]
      if (!h) continue
      const err = h.status?.messages?.find((m) => m[0] === 'execution_error')
      if (err) throw new Error(`Context IR: ${err[1].exception_message}`.slice(0, 600))
      const text = h.outputs?.out?.text?.[0]
      if (!text) throw new Error('Context IR returned no prompt.')
      return fromContextIr(text, character)
    }
    throw new Error('Context IR took too long. Try again.')
  }

  // engine: local, claude or codex (Context IR writes one shot at a time, so a story falls back to local).
  async writeStory({ story, shots = 3, seconds = 10, character: charId = 'none' }, { engine = 'local', model } = {}) {
    if (!story?.trim()) throw new Error('Write the story first.')
    const character = charId === 'none' ? null : this.characters().find((c) => c.id === charId) || null
    const harness = isHarness(engine)
    return writeStoryLocal({ story, shots: Math.min(8, Math.max(1, shots)), seconds, character, engine: harness ? engine : 'local', model, cpu: harness ? false : await this.gpuBusy() })
  }

  // True while ComfyUI is rendering; the local writer then stays on the CPU so it can't take H3's VRAM.
  async gpuBusy() {
    try {
      return (await this.comfy.queue()).queue_running.length > 0
    } catch {
      return false
    }
  }

  // ---------- sequences ----------
  // A sequence is a list of shots that plays as one video. Each render (a whole take, the last shot of a
  // shot-by-shot chain, or a retake) is a version; a render-out finishes one version with DLSS.
  sequenceFile = (id) => path.join(this.dataDir, 'sequences', `${id}.json`)
  listSequences() {
    const dir = path.join(this.dataDir, 'sequences')
    if (!fs.existsSync(dir)) return []
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => readJson(path.join(dir, f), null))
      .filter(Boolean)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((s) => ({ id: s.id, name: s.name, method: s.method, shots: s.shots.length, versions: s.versions.length, renders: s.renders.length, updatedAt: s.updatedAt }))
  }
  getSequence(id) {
    const s = readJson(this.sequenceFile(id), null)
    if (!s) throw new Error(`No sequence ${id}`)
    return s
  }
  writeSequence(s) {
    s.updatedAt = now()
    writeJson(this.sequenceFile(s.id), s)
    return s
  }
  createSequence(init = {}) {
    const s = { ...SEQUENCE_DEFAULTS, name: 'Untitled sequence', shots: [{ id: randomUUID().slice(0, 6), prompt: '', mode: 'text', media: [] }], ...init, id: randomUUID().slice(0, 8), createdAt: now(), projectId: null, shotJobs: {}, versions: [], renders: [], jobs: [] }
    return this.writeSequence(s)
  }
  // Edits name, settings and shots. Renders already made stay; shot-by-shot shots go stale when their inputs change.
  saveSequence(id, patch) {
    const s = this.getSequence(id)
    const allowed = ['name', 'method', 'character', 'aspect', 'megapixels', 'shotSeconds', 'steps', 'seed', 'voiceRef', 'shots', 'loras']
    for (const k of allowed) if (k in (patch || {})) s[k] = patch[k]
    s.loras = cleanSequenceLoras(s.loras)
    s.shots = s.shots.map((sh) => ({ id: sh.id || randomUUID().slice(0, 6), prompt: sh.prompt || '', mode: sh.mode || 'text', media: sh.media || [] }))
    return this.writeSequence(s)
  }
  deleteSequence(id) {
    fs.rmSync(this.sequenceFile(id), { force: true })
    return true
  }

  // The sequence plus everything derived from its jobs: version files, shot-by-shot state, render-outs.
  sequenceView(id) {
    const s = this.getSequence(id)
    const job = (jid) => (jid ? readJson(this.jobFile(jid), null) : null)
    const out = (j, kind) => j?.outputs?.find((o) => o.kind === kind) || null

    // Shot by shot: a shot is fresh when its finish succeeded from the inputs it has now,
    // including the previous shot's video.
    const shots = []
    let prevRaw = null
    for (const [i, sh] of s.shots.entries()) {
      const rec = s.shotJobs[sh.id] || {}
      const pj = job(rec.previews)
      const fj = job(rec.finish)
      const raw = out(fj, i === 0 ? 'before_dlss' : 'continued_before_dlss')
      const key = this.shotKey(s, i, prevRaw)
      const fresh = !!(raw && rec.key === key)
      shots.push({ id: sh.id, previews: pj ? this.publicJob(pj) : null, finish: fj ? this.publicJob(fj) : null, raw, fresh, stale: !!rec.key && rec.key !== key, ready: i === 0 || !!prevRaw })
      prevRaw = fresh ? raw.path : null
    }

    const versions = s.versions.map((v) => {
      const j = job(v.jobId)
      return { ...v, job: j ? this.publicJob(j) : null, file: out(j, 'master') }
    })
    if (prevRaw && shots.length) versions.unshift({ id: 'shots', kind: 'shots', label: 'Shot by shot', createdAt: shots.at(-1).finish?.createdAt, job: shots.at(-1).finish, file: shots.at(-1).raw })
    const renders = s.renders.map((r) => {
      const j = job(r.jobId)
      return { ...r, job: j ? this.publicJob(j) : null, file: out(j, 'final') }
    })
    return { sequence: s, shots, versions, renders }
  }

  // sequenceView after asking ComfyUI about any of the sequence's jobs that haven't finished.
  async refreshSequence(id) {
    for (const jid of this.getSequence(id).jobs) {
      const j = readJson(this.jobFile(jid), null)
      if (j && !['success', 'error', 'cancelled'].includes(j.status)) await this.refreshJob(jid).catch(() => {})
    }
    return this.sequenceView(id)
  }

  shotKey(s, i, prevRaw) {
    const sh = s.shots[i]
    const parts = [sh.prompt, sh.mode, sh.media, s.character, s.aspect, s.megapixels, s.shotSeconds, s.steps, i ? prevRaw : null]
    // LoRAs only count once a sequence has some, so shots rendered before sequences had LoRAs stay fresh
    if (s.loras?.length) parts.push(s.loras.map((l) => [l.name, l.strength]))
    return JSON.stringify(parts)
  }

  sequenceCharacter(s) {
    return validateSequence(s, this.characters())
  }
  sequenceJob(s, j) {
    s.jobs.push(j.id)
    this.writeSequence(s)
    return j
  }

  async renderTake(id) {
    const s = this.getSequence(id)
    const character = this.sequenceCharacter(s)
    const voiceRef = s.voiceRef ? await this.stage(s.voiceRef, 'iv_studio') : null
    const n = s.versions.length + 1
    const name = `${slug(s.name)}_${s.id}_v${n}`
    const { graph, resolved } = takeGraph({ template: this.template, seq: s, character, name, voiceRef, unet: this.models.take })
    const j = await this.submitGraph({ kind: 'take', graph, sequenceId: s.id, name, plan: { saves: SAVES, resolved } })
    s.versions.push({ id: `v${n}`, kind: 'take', label: `Take ${s.versions.filter((v) => v.kind === 'take').length + 1}`, jobId: j.id, createdAt: j.createdAt, seed: s.seed })
    return this.sequenceJob(s, j)
  }

  versionPath(id, versionId) {
    const v = this.sequenceView(id).versions.find((x) => x.id === versionId)
    if (!v?.file?.path) throw new Error(`Version ${versionId} has no finished video yet.`)
    return { v, path: v.file.path }
  }

  // A retake of any video file (the editor's Retake): the graph Sequences use, at their defaults. The file must
  // be on the PC that runs ComfyUI.
  async retakeFile({ name, sourcePath, start, end, mode = 'both', prompt, character = 'none', seed }) {
    if (this.comfy.hosted) throw new Error('Retake in the editor runs on this PC\'s ComfyUI or your own cloud (RunPod, Modal).')
    if (!(end > start)) throw new Error('The retake must end after it starts.')
    const ch = character === 'none' ? null : this.characters().find((c) => c.id === character) || null
    const base = `${slug(name)}_${randomUUID().slice(0, 6)}`
    // the person's own cloud reads the clip from ComfyUI's input folder (uploaded), not from this PC's path
    const src = await this.videoSource(sourcePath)
    const { graph } = retakeGraph({ template: this.template, seq: { ...SEQUENCE_DEFAULTS }, character: ch, name: base, sourcePath: src.video, prompt, start, end, mode, seed: seed ?? SEQUENCE_DEFAULTS.seed, unet: this.models.retake })
    graph.src.class_type = src.cls
    return this.submitGraph({ kind: 'retake', graph, name: base, plan: { saves: SAVES, resolved: { start, end, mode } } })
  }

  async retakeSequence(id, { versionId, prompt, start, end, mode = 'both', seed }) {
    const s = this.getSequence(id)
    const character = this.sequenceCharacter(s)
    if (!prompt?.trim()) throw new Error('Describe what should happen in the retake.')
    if (!(end > start)) throw new Error('The retake must end after it starts.')
    const { v, path: sourcePath } = this.versionPath(id, versionId)
    const n = s.versions.length + 1
    const name = `${slug(s.name)}_${s.id}_v${n}`
    const { graph } = retakeGraph({ template: this.template, seq: s, character, name, sourcePath, prompt, start, end, mode, seed: seed ?? s.seed + n, unet: this.models.retake })
    const j = await this.submitGraph({ kind: 'retake', graph, sequenceId: s.id, name, plan: { saves: SAVES, resolved: { start, end, mode } } })
    s.versions.push({ id: `v${n}`, kind: 'retake', label: `Retake of ${v.label}, ${start}–${end} s`, jobId: j.id, createdAt: j.createdAt, source: versionId, start, end, mode, prompt })
    return this.sequenceJob(s, j)
  }

  async renderOutSequence(id, { versionId, normalize = false, scale = 1, fps = 0 }) {
    const s = this.getSequence(id)
    const { path: sourcePath } = this.versionPath(id, versionId)
    const name = `${slug(s.name)}_${s.id}_${versionId}_final`
    const { graph } = renderOutGraph({ template: this.template, name, sourcePath, normalize, scale, fps })
    const j = await this.submitGraph({ kind: 'renderout', graph, sequenceId: s.id, name, plan: { saves: SAVES, resolved: { normalize, scale, fps } } })
    s.renders.push({ id: j.id, versionId, jobId: j.id, createdAt: j.createdAt, normalize, scale, fps })
    return this.sequenceJob(s, j)
  }

  // Shot by shot: shot 1 is hunted like any shot; every later shot continues from the previous shot's video.
  async huntShot(id, index, { seed } = {}) {
    const s = this.getSequence(id)
    this.sequenceCharacter(s)
    const view = this.sequenceView(id)
    const sh = s.shots[index]
    if (!sh) throw new Error(`No shot ${index + 1}.`)
    const prev = index > 0 ? view.shots[index - 1] : null
    if (prev && !prev.fresh) throw new Error(`Finish shot ${index} first; shot ${index + 1} continues from it.`)
    if (!s.projectId) s.projectId = this.createProject(`${s.name} (sequence)`, s.id).id
    const base = { prompt: sh.prompt, character: s.character, aspect: s.aspect, seconds: s.shotSeconds, steps: s.steps, seed: seed ?? s.seed + index * 100, extraLoras: s.loras || [] }
    const request = prev
      ? { ...base, mode: 'continue', media: [{ kind: 'video', file: prev.raw.path }], megapixels: s.megapixels, overlapFrames: 22 }
      : { ...base, mode: sh.mode || 'text', media: sh.media || [], megapixels: 0.4, previews: 3 }
    const j = await this.generatePreviews({ projectId: s.projectId, ...request })
    s.shotJobs[sh.id] = { previews: j.id, finish: null, key: this.shotKey(s, index, prev?.raw?.path || null) }
    return this.sequenceJob(s, j)
  }

  async finishShot(id, index, { candidate = 1 } = {}) {
    const s = this.getSequence(id)
    const sh = s.shots[index]
    const rec = s.shotJobs[sh?.id]
    if (!rec?.previews) throw new Error(`Hunt shot ${index + 1} first.`)
    const j = await this.finishCandidate({ jobId: rec.previews, candidate, megapixels: Math.max(0.5, s.megapixels), audio: 'pass', fps: 0, upscale2x: false })
    rec.finish = j.id
    return this.sequenceJob(s, j)
  }

  // The shot-by-shot runs of a sequence live in its own project. For each of that project's preview runs: the shot
  // it belongs to (linked), or the shot it could be linked to (a run made from the project's page with "Edit and run
  // again" before those edits went through the sequence), or why it can't be.
  sequenceRunsOf(projectId) {
    const project = this.getProject(projectId)
    if (!project.sequenceId) return null
    let s
    try {
      s = this.getSequence(project.sequenceId)
    } catch {
      return null
    }
    const view = this.sequenceView(s.id)
    const runs = {}
    for (const jid of project.jobs) {
      const j = readJson(this.jobFile(jid), null)
      if (j?.kind !== 'previews') continue
      const linked = s.shots.findIndex((sh) => s.shotJobs[sh.id]?.previews === jid)
      if (linked >= 0) {
        runs[jid] = { index: linked, linked: true }
        continue
      }
      const req = j.plan?.request || {}
      let index = -1
      if (req.mode !== 'continue') index = 0
      else {
        const src = req.media?.[0]?.file
        index = view.shots.findIndex((x, i) => i > 0 && view.shots[i - 1].fresh && view.shots[i - 1].raw?.path === src)
      }
      const problem = index < 0 ? 'It continues from a shot that has changed since, so it no longer fits the sequence.' : this.shotRunMismatch(s, index, j)
      runs[jid] = { index, linked: false, ...(problem && { problem }) }
    }
    return { sequenceId: s.id, sequenceName: s.name, method: s.method, runs }
  }

  // Why a preview run can't stand as shot `index` of a sequence (its settings differ), or null.
  shotRunMismatch(s, index, j) {
    if (j.status !== 'success') return 'It has not finished rendering.'
    const req = j.plan?.request || {}
    const diff = []
    if ((req.character || 'none') !== (s.character || 'none')) diff.push('character')
    if (req.aspect !== s.aspect) diff.push('frame shape')
    if (Number(req.seconds) !== Number(s.shotSeconds)) diff.push('shot length')
    if (Number(req.steps) !== Number(s.steps)) diff.push('steps')
    if (index > 0 && req.mode !== 'continue') diff.push('mode (later shots continue the one before)')
    if (index === 0 && req.mode === 'continue') diff.push('mode (the first shot starts fresh)')
    if (index > 0 && Number(req.megapixels) !== Number(s.megapixels)) diff.push('size')
    if (JSON.stringify((req.extraLoras || []).map((l) => [l.name, l.strength])) !== JSON.stringify((s.loras || []).map((l) => [l.name, l.strength]))) diff.push('LoRAs')
    return diff.length ? `Its ${diff.join(', ')} differ${diff.length === 1 ? 's' : ''} from the sequence's.` : null
  }

  // Makes a preview run of the sequence's project shot `index`: the shot takes the run's prompt (and, for shot 1,
  // its mode and pictures), and the run's latest good finish, if any, becomes the shot's finish.
  linkShotRun(id, { jobId, index }) {
    const s = this.getSequence(id)
    const sh = s.shots[index]
    if (!sh) throw new Error(`No shot ${index + 1}.`)
    const j = readJson(this.jobFile(jobId), null)
    if (!j || j.kind !== 'previews' || !s.projectId || j.projectId !== s.projectId) throw new Error("That run isn't one of this sequence's.")
    const view = this.sequenceView(id)
    const req = j.plan?.request || {}
    if (index > 0) {
      const prev = view.shots[index - 1]
      if (!prev.fresh || prev.raw?.path !== req.media?.[0]?.file) throw new Error(`That run doesn't continue from shot ${index}'s current video.`)
    }
    const problem = this.shotRunMismatch(s, index, j)
    if (problem) throw new Error(`That run can't be shot ${index + 1}. ${problem}`)
    const asked = j.plan?.asked || {}
    sh.prompt = asked.prompt ?? req.prompt
    if (index === 0) {
      sh.mode = asked.mode || req.mode || 'text'
      sh.media = (asked.media || req.media || []).map((m) => ({ kind: m.kind, file: m.file || m.path }))
    }
    const rawKind = index === 0 ? 'before_dlss' : 'continued_before_dlss'
    const finishes = this.getProject(s.projectId)
      .jobs.map((fid) => readJson(this.jobFile(fid), null))
      .filter((f) => f?.kind === 'finish' && f.parent === jobId && f.status === 'success' && f.outputs?.some((o) => o.kind === rawKind))
    s.shotJobs[sh.id] = { previews: jobId, finish: finishes.at(-1)?.id || null, key: this.shotKey(s, index, index > 0 ? view.shots[index - 1].raw.path : null) }
    this.writeSequence(s)
    return this.sequenceView(id)
  }

  // ---------- jobs ----------
  jobFile = (id) => path.join(this.dataDir, 'jobs', `${id}.json`)

  getJob(id, { refresh = true } = {}) {
    const job = readJson(this.jobFile(id), null)
    if (!job) throw new Error(`No job ${id}`)
    return refresh ? job : job
  }
  // The newest render that failed in the last `withinMs` (30 minutes), for the chat's context: its name, kind,
  // how long ago, and the reason in words (failures.js) or ComfyUI's own first line. Looks at the 40 newest jobs.
  recentProblem({ withinMs = 30 * 60 * 1000, now = Date.now() } = {}) {
    const dir = path.join(this.dataDir, 'jobs')
    if (!fs.existsSync(dir)) return null
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
      .filter((x) => x.t > now - withinMs)
      .sort((a, b) => b.t - a.t)
      .slice(0, 40)
    for (const { f, t } of files) {
      const job = readJson(path.join(dir, f), null)
      if (job?.status !== 'error') continue
      const ex = explainFailure(job.error, { where: job.where, kind: job.kind })
      return { jobId: job.id, name: job.name || null, kind: job.kind || null, minutesAgo: Math.max(0, Math.round((now - t) / 60000)), reason: ex?.title || String(job.error || 'it failed').split('\n')[0].slice(0, 200) }
    }
    return null
  }
  // Adds fields to a saved job (its take ranking); returns the job as the window sees it.
  updateJob(id, patch) {
    const job = { ...this.getJob(id), ...patch }
    writeJson(this.jobFile(id), job)
    return this.publicJob(job)
  }

  async refreshJob(id) {
    const job = this.getJob(id)
    if (['success', 'error', 'cancelled'].includes(job.status)) return this.publicJob(job)
    let h
    try {
      h = (await this.comfy.history(job.promptId))[job.promptId]
    } catch (err) {
      return this.publicJob({ ...job, note: err.message })
    }
    if (h) {
      const msgs = h.status?.messages || []
      const err = msgs.find((m) => m[0] === 'execution_error')
      const interrupted = msgs.find((m) => m[0] === 'execution_interrupted')
      job.status = err ? 'error' : interrupted ? 'cancelled' : h.status?.status_str === 'success' ? 'success' : 'error'
      if (err) job.error = `${err[1].node_type}: ${err[1].exception_message}`.slice(0, 1200)
      const t = msgs.filter((m) => ['execution_start', 'execution_success', 'execution_error'].includes(m[0])).map((m) => m[1].timestamp)
      if (t.length > 1) job.seconds = Math.round((t.at(-1) - t[0]) / 1000)
      job.outputs = this.collectOutputs(job, h.outputs || {})
      if (job.plan?.engine === SEEDANCE) await this.keepLocal(job)
      job.finishedAt = now()
      writeJson(this.jobFile(job.id), job)
      // a finish whose enhancer is SeedVR2: its enhance step starts as soon as the finish is done
      if (job.kind === 'finish' && job.status === 'success' && job.plan?.finish?.enhancer === 'seedvr2' && !job.enhanceJob) {
        try {
          const e = await this.enhanceFinal({ jobId: job.id, engine: 'seedvr2', resolution: job.plan.finish.enhanceResolution, detail: job.plan.finish.enhanceDetail || 0 })
          job.enhanceJob = e.id
        } catch (err) {
          job.enhanceError = err.message
        }
        writeJson(this.jobFile(job.id), job)
      }
      return this.publicJob(job)
    }
    const q = await this.comfy.queue()
    if (q.queue_running.some((i) => i[1] === job.promptId)) job.status = 'running'
    else {
      const pos = q.queue_pending.findIndex((i) => i[1] === job.promptId)
      job.status = pos >= 0 ? 'queued' : job.status
      job.queuePosition = pos >= 0 ? pos + 1 + q.queue_running.length : undefined
    }
    return this.publicJob({ ...job, progress: this.progress.get(job.promptId) })
  }

  async cancelJob(id) {
    const job = this.getJob(id)
    if (['success', 'error', 'cancelled'].includes(job.status)) return { job: this.publicJob(job), result: 'already finished' }
    const result = await this.comfy.cancel(job.promptId)
    if (result === 'removed from queue') {
      job.status = 'cancelled'
      writeJson(this.jobFile(job.id), job)
    }
    return { job: this.publicJob(job), result }
  }

  collectOutputs(job, outputs) {
    const list = []
    const file = (f, kind, extra = {}) => ({ kind, path: f.fullpath || null, url: this.comfy.viewUrl(f), filename: f.filename, subfolder: f.subfolder, ...extra })
    const videoOf = (o) => (o?.gifs || []).filter((f) => /\.mp4$/i.test(f.filename)).sort((a, b) => /-audio/.test(b.filename) - /-audio/.test(a.filename))[0]
    if (job.plan?.engine === SEEDANCE) {
      // Seedance 2.5 (seedance.js): its takes, each with the draft task id a 1080p finish needs, or the final
      if (job.kind === 'previews') for (const t of takesFrom(outputs, job.plan.resolved.previews)) list.push(file(t.file, 'preview', { candidate: t.candidate, seed: job.plan.resolved.seeds[t.candidate - 1], draftTaskId: t.draftTaskId }))
      else if (job.plan.finish?.way === 'local') {
        // the free finish on this PC (h3refine.js): H3's pass saved by VHS, then the path DLSS 5 answers with
        const v = videoOf(outputs.save)
        const p = outputs.out?.text?.[0]
        if (v) list.push(file(v, p ? 'before_dlss' : 'final'))
        if (p) list.push(this.fileFromPath(p, 'final'))
      } else {
        const f = finalFrom(outputs)
        if (f) list.push(file(f, 'final'))
      }
      return list
    }
    if (job.plan?.replace) {
      // OpenJutsu's workflows: the final video (Context Loop assembly or VHS), plus mask and "who is who" previews
      const fin = job.plan.replace.finalNode
      for (const [nid, out] of Object.entries(outputs)) {
        for (const f of [...(out.gifs || []), ...(out.videos || []), ...(out.video || [])]) if (/\.(mp4|webm|mov)$/i.test(f.filename)) list.push(file(f, nid === fin ? 'final' : 'video'))
        // a path, or (Context Loop 0.7.x) a sentence about it: "assembled 2 generated clips with ffmpeg; hard cuts -> F:\...\x.mp4; generated audio -> ..."
        for (const t of out.text || []) {
          const p = typeof t === 'string' && (t.match(/->\s*([^;]+?\.(?:mp4|webm|mov))\s*(?:;|$)/i)?.[1] || (/\.(mp4|webm|mov)$/i.test(t.trim()) ? t.trim() : null))
          if (p) list.push(this.fileFromPath(p, nid === fin ? 'final' : 'video'))
        }
        for (const img of out.images || []) {
          if (/\.(png|jpe?g|webp)$/i.test(img.filename)) list.push(file(img, 'image'))
          // core SaveVideo (Remake) lists its video under images; a LoadVideo's preview of the source is an input
          else if (/\.(mp4|webm|mov)$/i.test(img.filename) && img.type !== 'input') list.push(file(img, nid === fin ? 'final' : 'video'))
        }
      }
      return list
    }
    if (job.plan?.clipfx) {
      // a Freefield app (freefield.js): every saved video or picture, with the node that saved it
      for (const [nid, out] of Object.entries(outputs)) {
        for (const f of [...(out.gifs || []), ...(out.videos || []), ...(out.images || [])]) {
          if (f.type === 'input' || f.type === 'temp') continue
          if (/\.(mp4|webm|mov|mkv)$/i.test(f.filename)) list.push(file(f, 'video', { node: nid }))
          else if (/\.(png|jpe?g|webp)$/i.test(f.filename)) list.push(file(f, 'image', { node: nid }))
        }
      }
      return list
    }
    if (job.plan?.cutout) {
      // a cut-out's mask (cutout.js): a picture from SaveImage, or the mask video
      const o = outputs.mask
      const img = (o?.images || [])[0]
      const vid = (o?.gifs || []).find((f) => /\.mp4$/i.test(f.filename))
      if (img || vid) list.push(file(img || vid, 'mask'))
      return list
    }
    if (job.plan?.reframe) {
      // a reframed shot (reframe.js): the saved video with its sound
      const v = videoOf(outputs.save)
      if (v) list.push(file(v, 'final'))
      return list
    }
    if (job.plan?.enhance) {
      // Enhance: SeedVR2's saved video (with its sound), or the path DLSS 5 answers with
      const v = (o) => (o?.gifs || []).filter((f) => /\.mp4$/i.test(f.filename)).sort((a, b) => /-audio/.test(b.filename) - /-audio/.test(a.filename))[0]
      const saved = v(outputs.save)
      if (saved) list.push(file(saved, 'final'))
      const p = outputs.out?.text?.[0]
      if (p) list.push(this.fileFromPath(p, 'final'))
      return list
    }
    if (job.plan?.music || job.plan?.sound) {
      // a song (Music) or a sound (Sounds): the SaveAudio outputs
      for (const nid of Object.keys(outputs).sort()) for (const a of outputs[nid].audio || []) list.push(file(a, 'audio'))
      return list
    }
    if (job.plan?.images) {
      // a picture graph (character design stills): every SaveImage output, in node order
      for (const nid of Object.keys(outputs).sort()) for (const img of outputs[nid].images || []) list.push(file(img, 'image'))
      return list
    }
    if (job.plan?.saves) {
      const master = videoOf(outputs[SAVES.master])
      if (master) list.push(file(master, 'master'))
      const p = outputs[SAVES.final]?.text?.[0]
      if (p) list.push(this.fileFromPath(p, 'final'))
      return list
    }
    for (const [k, nid] of Object.entries(PREVIEW_SAVES)) {
      const v = videoOf(outputs[nid])
      if (v) list.push(file(v, 'preview', { candidate: Number(k), seed: job.kind === 'previews' ? job.plan.resolved.seeds[k - 1] : undefined }))
    }
    const twoMp = videoOf(outputs['30'])
    if (twoMp) list.push(file(twoMp, 'before_dlss'))
    const cont = videoOf(outputs['619'])
    if (cont) list.push(file(cont, 'continued_before_dlss'))
    for (const nid of ['51', '704']) {
      const p = outputs[nid]?.text?.[0]
      if (p) list.push(this.fileFromPath(p, 'final'))
    }
    return list
  }

  fileFromPath(p, kind) {
    const norm = p.replace(/\\/g, '/')
    const m = norm.match(/\/output\/(.*)\/([^/]+)$/)
    const subfolder = m ? m[1] : ''
    const filename = m ? m[2] : norm.split('/').pop()
    return { kind, path: p, filename, subfolder, url: this.comfy.viewUrl({ filename, subfolder, type: 'output' }) }
  }

  publicJob(job) {
    const { previewPlan, ...rest } = job
    // a failed job also says what went wrong in plain words (failures.js); job.error stays as ComfyUI wrote it
    const explain = job.status === 'error' && job.error ? explainFailure(job.error, { where: job.where, kind: job.kind }) : null
    // the request goes out whole: the shot page shows its prompt in full
    return { ...rest, ...(explain ? { explain } : {}), plan: { resolved: job.plan?.resolved, request: job.plan?.request, finish: job.plan?.finish, asked: job.plan?.asked, enhance: job.plan?.enhance, engine: job.plan?.engine, refs: job.plan?.refs } }
  }

  listJobs(projectId) {
    const ids = projectId ? this.getProject(projectId).jobs : []
    return ids.map((id) => readJson(this.jobFile(id), null)).filter(Boolean).map((j) => this.publicJob(j))
  }

  // The render queue in the sidebar: everything running or waiting on ComfyUI, IV Studio's own work named from
  // its job records (with live step progress from the websocket), anyone else's as "other". A cloud ComfyUI is
  // only asked while IV Studio has a job in flight, so the queue never keeps a cloud GPU awake.
  async renderQueue() {
    const known = this.queueIndex()
    if (this.comfy.remote && ![...known.values()].some((j) => j.open)) return { items: [] }
    const q = await this.comfy.queue()
    const seen = new Set()
    const items = [
      ...q.queue_running.map((i) => ['running', i]),
      ...[...q.queue_pending].sort((a, b) => a[0] - b[0]).map((i) => ['queued', i])
    ].map(([state, i], n) => {
      const promptId = i[1]
      const ours = i[3]?.iv_studio
      const job = known.get(promptId)
      seen.add(promptId)
      if (state === 'running' && !this.runningSince.has(promptId)) this.runningSince.set(promptId, Date.now())
      return {
        promptId,
        state,
        position: n + 1,
        ours: !!ours,
        // whether this prompt sends step pictures (withLivePreview added its node): not in the cloud, and not
        // without H3's small preview model (taeh3) on this PC
        live: !!i[2]?.[LIVE_NODE],
        jobId: job?.id || null,
        kind: job?.kind || ours?.kind || null,
        name: job?.name || null,
        projectId: job?.projectId || ours?.project || null,
        sequenceId: job?.sequenceId || ours?.sequence || null,
        startedAt: state === 'running' ? this.runningSince.get(promptId) : null,
        progress: state === 'running' ? this.progress.get(promptId) || null : null
      }
    })
    for (const id of this.runningSince.keys()) if (!seen.has(id)) this.runningSince.delete(id)
    return { items }
  }

  // promptId -> the job's name, kind and links, from the job files; only files written since the last look are read.
  queueIndex() {
    this.jobIndex ||= new Map()
    this.runningSince ||= new Map()
    const dir = path.join(this.dataDir, 'jobs')
    const since = this.jobIndexAt || 0
    this.jobIndexAt = Date.now()
    let files = []
    try {
      files = fs.readdirSync(dir)
    } catch {
      return this.jobIndex
    }
    for (const f of files) {
      const file = path.join(dir, f)
      try {
        if (fs.statSync(file).mtimeMs < since - 2000) continue
        const j = readJson(file, null)
        if (j?.promptId) this.jobIndex.set(j.promptId, { id: j.id, name: j.name, kind: j.kind, projectId: j.projectId, sequenceId: j.sequenceId, open: !['success', 'error', 'cancelled'].includes(j.status) })
      } catch {}
    }
    return this.jobIndex
  }

  // Cancels a queue item IV Studio started: through its job when there is one, else by prompt id.
  async cancelQueued(promptId) {
    const job = this.queueIndex().get(promptId)
    if (job?.id) return this.cancelJob(job.id)
    return this.comfy.cancel(promptId)
  }

  // Live progress from ComfyUI's websocket (the studio window keeps one open; the MCP server polls). ComfyUI sends
  // step progress only to the client id that queued the prompt, so this listens as that same id.
  // A render an agent started through the MCP server is queued under that server's client id, and the MCP server
  // polls instead of listening, so its step pictures would go nowhere. While such a render of this data folder runs,
  // the window also listens as its client (a guest socket) and shows the pictures like its own.
  watch(onEvent) {
    // A cloud ComfyUI shuts down when idle; an open websocket would keep it (and its bill) running.
    if (this.comfy.remote) return () => {}
    let ws
    let stopped = false
    const guests = new Map() // client id -> websocket
    const open = (clientId) => new WebSocket(`${this.comfy.url.replace(/^http/, 'ws')}/ws?clientId=${encodeURIComponent(clientId)}`)
    const connect = () => {
      if (stopped) return
      try {
        ws = open(this.comfy.clientId)
      } catch {
        return setTimeout(connect, 3000)
      }
      ws.onmessage = (ev) => handle(ev)
      ws.onclose = () => setTimeout(connect, 3000)
      ws.onerror = () => {}
    }
    const scanGuests = async () => {
      if (stopped) return
      try {
        const q = await this.comfy.queue()
        const known = this.queueIndex()
        const want = new Map() // client id -> its running prompt
        for (const item of q.queue_running || []) {
          const client = item[3]?.client_id
          if (client && client !== this.comfy.clientId && /^iv-studio-/.test(client) && known.has(item[1])) want.set(client, item[1])
        }
        for (const [client, promptId] of want) {
          if (guests.has(client)) continue
          // joining mid-render misses ComfyUI's 'executing' message, so the running prompt comes from the queue
          if (!this.running) this.running = promptId
          try {
            const g = open(client)
            g.onmessage = (ev) => handle(ev)
            g.onclose = () => guests.get(client) === g && guests.delete(client)
            g.onerror = () => {}
            guests.set(client, g)
          } catch {}
        }
        for (const [client, g] of guests) if (!want.has(client)) (guests.delete(client), g.close())
      } catch {}
      if (!stopped) setTimeout(scanGuests, 2000)
    }
    const handle = (ev) => {
      if (typeof ev.data !== 'string') return
        let msg
        try {
          msg = JSON.parse(ev.data)
        } catch {
          return
        }
        const d = msg.data || {}
        if (msg.type === 'progress' && d.prompt_id) this.progress.set(d.prompt_id, { value: d.value, max: d.max, node: d.node })
        if (msg.type === 'executing' && d.prompt_id) this.running = d.node == null ? null : d.prompt_id
        if (msg.type === 'executing' && d.prompt_id && d.node == null) (this.progress.delete(d.prompt_id), this.live.delete(d.prompt_id))
        // a live preview step (remote.js withLivePreview): it carries no prompt id, so it belongs to the running one;
        // its step count starting again means the next preview take has begun
        if (msg.type === 'kj_preview_override' && d.image && this.running) {
          const prev = this.live.get(this.running)
          const take = !prev ? 1 : d.step < prev.step ? prev.take + 1 : prev.take
          const live = { promptId: this.running, image: `data:${d.mime || 'image/jpeg'};base64,${d.image}`, step: d.step, total: d.total, take, at: Date.now() }
          this.live.set(this.running, live)
          msg = { type: 'iv_live', data: live }
        }
      onEvent?.(msg)
    }
    connect()
    scanGuests()
    return () => {
      stopped = true
      ws?.close()
      for (const g of guests.values()) g.close()
      guests.clear()
    }
  }
}

