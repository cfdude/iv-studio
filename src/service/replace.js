// Replace: swap people or objects in a video while the camera, cuts, motion and soundtrack stay. It runs
// OpenJutsu's ComfyUI workflows (github.com/D3voz/openjutsu, MIT, commit 47c3724): SAM 3.1 tracks who or what
// to replace, Qwen3-VL describes the shots, MiniMax H3 reference-to-video redraws only the masked area, clip by
// clip through the H3 Context Loop. OpenJutsu's mode logic is vendored unchanged in ./replace/*.ts; this file
// is the part its Next.js app did: inputs, models, the node check and submitting through IV Studio's queue.
//   person   one character replaces the main person          (simple.api.json)
//   people   1-4 characters, each matched to a role           (advanced.api.json, advanced_maxq.api.json)
//   object   change, remove, or replace the background        (object.api.json)
//   mask     a quick preview of what would be regenerated     (mask.api.json)
//   faces    redraw small faces at close-up size              (face.api.json)
//   colours  soften H3's look without an H3 run               (color.api.json)
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { MAX_CHARACTERS, nodeByTitle, pruneAdvanced, VIDEO } from './replace/advanced.ts'
import { DEFAULT_TONE, pruneColor, COLOR_VIDEO } from './replace/color.ts'
import { FACE_PICTURE, FACE_VIDEO, pruneFace } from './replace/face.ts'
import { applyModel } from './replace/model.ts'
import { OBJECT_PICTURE, OBJECT_VIDEO, pruneObject } from './replace/object.ts'
import { MASK_NODES, NODES, pruneMask, pruneSimple, setSection } from './replace/simple.ts'
import { probe } from './media.js'
import { comboOptions } from './setup.js'

export const OPENJUTSU = { repo: 'https://github.com/D3voz/openjutsu', commit: '47c3724', licence: 'MIT' }
export { MAX_CHARACTERS, DEFAULT_TONE }

// The node packs OpenJutsu's workflows use (from its lib/setup.ts, MIT), for telling the person what to install.
const PACKS = [
  { name: 'ComfyUI-MiniMaxH3-Context-Loop (0.7.3+)', url: 'https://github.com/ethanfel/ComfyUI-MiniMaxH3-Context-Loop', nodes: ['MiniMaxH3GenerationProfile', 'MiniMaxH3SourceTimeline', 'MiniMaxH3ChainPlanModern', 'MiniMaxH3ChainLoopStart', 'MiniMaxH3ChainCurrent', 'MiniMaxH3ChainContext', 'MiniMaxH3ChainSegmentSave', 'MiniMaxH3ChainReview', 'MiniMaxH3ChainLoopEnd', 'MiniMaxH3ChainAssemble', 'MiniMaxH3ContexLoopMaskSlice', 'MiniMaxH3ContexMaskedTarget', 'MiniMaxH3ContexMaskGridPreview', 'MiniMaxH3LoopTrim'] },
  { name: 'comfyui-h3-oneclick-swap', url: 'https://github.com/D3voz/comfyui-h3-oneclick-swap', nodes: ['H3OneClickSwapPlan', 'H3AdvancedSwapPlan', 'H3ObjectSwapPlan', 'H3ObjectPlacementMask', 'H3AddFitCheck', 'H3AddMovingArea', 'H3PaintedEditArea', 'H3SoundtrackOrSilence', 'H3SourceSlice', 'H3PeopleMask', 'H3GreyMannequins', 'H3ClipShots', 'H3FillShots', 'H3TrackCrops', 'H3TrackRoles', 'H3RoleMask', 'H3SubjectPrompt', 'H3FaceChunks', 'H3FaceJoin'] },
  { name: 'ComfyUI-Fantastic-MiniMaxH3-PromptBuilder', url: 'https://github.com/Adudeguyman/ComfyUI-Fantastic-MiniMaxH3-PromptBuilder', nodes: ['MiniMaxH3FantasticVideoEditLatent'] },
  { name: 'ComfyUI-KJNodes', url: 'https://github.com/kijai/ComfyUI-KJNodes', nodes: ['GrowMaskWithBlur', 'ImageAndMaskPreview', 'VRAM_Debug'] },
  { name: 'ComfyUI-VideoHelperSuite', url: 'https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite', nodes: ['VHS_LoadVideo', 'VHS_SelectEveryNthImage', 'VHS_VideoCombine'] },
  { name: 'ComfyUI-H3-FaceRefine', url: 'https://github.com/Carasibana/ComfyUI-H3-FaceRefine', nodes: ['H3FaceTrackCrop', 'H3FaceMaskSAM', 'H3FaceStitch'] },
  { name: 'ComfyUI-Impact-Pack', url: 'https://github.com/ltdrdata/ComfyUI-Impact-Pack', nodes: ['SAMLoader'] },
  { name: 'comfyui-image-detail-contrast', url: 'https://github.com/D3voz/comfyui-image-detail-contrast', nodes: ['ImageDetailContrast'] },
  { name: 'Orion4D_FXMax', url: 'https://github.com/orion4d/Orion4D_FXMax', nodes: ['Orion4D_FXMax_DCTLToneMapper'] }
]
const WORKFLOW = { person: 'simple', people: 'advanced', people_maxq: 'advanced_maxq', object: 'object', mask: 'mask', faces: 'face', colours: 'color' }
// The describer writes the prompts from the frames; any Qwen3-VL with vision weights works, 8B INT8 is OpenJutsu's default.
const DESCRIBERS = [/^qwen3vl_8b_int8_convrot\.safetensors$/i, /^qwen3vl_4b_fp8_scaled\.safetensors$/i, /^qwen3vl_8b.*\.safetensors$/i]
export const RESOLUTIONS = ['480p', '576p', '736p', '768p', '1080p']

export class Replace {
  constructor({ studio, resourcesDir, dataDir, ffmpeg, ffprobe }) {
    this.studio = studio
    this.dir = path.join(resourcesDir, 'workflows', 'replace')
    this.cache = path.join(dataDir, 'media', 'replace')
    this.ffmpeg = ffmpeg
    this.ffprobe = ffprobe
  }

  // The workflows read the soundtrack in step with the picture: a video with no sound fails, and so does one
  // whose sound ends a few milliseconds before its picture (seen 2026-10-28: 164,864 of 165,333 samples). A
  // copy with the picture untouched and the sound padded with silence to the picture's length fixes both.
  async conform(video) {
    const info = await probe(this.ffprobe, video)
    const key = createHash('sha1').update(`${video}|${fs.statSync(video).mtimeMs}`).digest('hex').slice(0, 10)
    const out = path.join(this.cache, `${path.basename(video).replace(/\.[^.]+$/, '').replace(/[^\w -]+/g, '_')}_${key}.mp4`)
    if (fs.existsSync(out)) return out
    fs.mkdirSync(this.cache, { recursive: true })
    const dur = info.duration.toFixed(3)
    const args = ['-y', '-hide_banner', '-loglevel', 'error', '-i', video]
    if (!info.hasAudio) args.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-map', '0:v:0', '-map', '1:a:0')
    else args.push('-map', '0:v:0', '-map', '0:a:0', '-af', 'apad')
    args.push('-t', dur, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-movflags', '+faststart', out)
    await new Promise((resolve, reject) => {
      const p = spawn(this.ffmpeg, args, { windowsHide: true })
      let err = ''
      p.stderr.on('data', (d) => (err += d))
      p.on('error', reject)
      p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Couldn't prepare the video: ${err.trim().split('\n').pop()}`))))
    })
    return out
  }

  graph = (name) => JSON.parse(fs.readFileSync(path.join(this.dir, `${name}.api.json`), 'utf8'))

  // IV Studio's own H3 files (Settings -> Models for References), plus the describer this ComfyUI has.
  async models(extraLoras = []) {
    const t = this.studio.template
    const info = await this.studio.comfy.objectInfo('CLIPLoader')
    const clips = comboOptions(info, 'CLIPLoader', 'clip_name') || []
    const describer = DESCRIBERS.map((re) => clips.find((c) => re.test(c.replace(/\\/g, '/').split('/').pop()))).find(Boolean)
    return {
      model: this.studio.models.reference || t['301'].inputs.unet_name,
      loras: [{ name: t['5'].inputs.lora_name, strength: 1, speed: true }, ...extraLoras],
      steps: 6,
      textEncoder: t['2'].inputs.clip_name,
      videoVae: t['3'].inputs.vae_name,
      audioVae: t['4'].inputs.vae_name,
      describer: describer || null
    }
  }

  // What this ComfyUI lacks for a mode: node packs (with links) and models (with where to get them).
  async check(mode = 'person') {
    // the old engine's node packs are installed on PCs only (models.json "cloud": false); Remake runs in the cloud
    if (this.studio.comfy.remote) return { ready: false, cloud: true, error: 'The old engine runs on this computer only. In the cloud, Replace uses Remake (Swap people, Change the scene).', packs: [], models: [] }
    const g = this.graph(WORKFLOW[mode])
    const info = await this.studio.comfy.objectInfo()
    const classes = [...new Set(Object.values(g).map((n) => n.class_type))].map((c) => (c === 'H3SourceSlice' && !info[c] && info.MiniMaxH3ContexLoopSourceSlice ? 'MiniMaxH3ContexLoopSourceSlice' : c))
    const missing = classes.filter((c) => !info[c])
    const packs = []
    for (const c of missing) {
      const p = PACKS.find((x) => x.nodes.includes(c)) || { name: 'ComfyUI itself (update it)', url: 'https://github.com/Comfy-Org/ComfyUI', nodes: [] }
      const found = packs.find((x) => x.url === p.url)
      if (found) found.missing.push(c)
      else packs.push({ name: p.name, url: p.url, missing: [c] })
    }
    const models = []
    if (['person', 'people', 'people_maxq', 'object', 'mask'].includes(mode)) {
      const sams = comboOptions(info, 'CheckpointLoaderSimple', 'ckpt_name') || []
      if (!sams.some((s) => /sam3\.1_multiplex/i.test(s))) models.push({ name: 'SAM 3.1 (sam3.1_multiplex_fp16)', where: 'checkpoints', setup: 'sam31' })
    }
    if (mode !== 'colours' && mode !== 'mask' && !(await this.models()).describer) models.push({ name: 'Qwen3-VL 8B describer (qwen3vl_8b_int8_convrot)', where: 'text_encoders', setup: 'describer' })
    return { ready: !packs.length && !models.length, packs, models }
  }

  // One run. input: { mode, video, section {start, length}, pictures [paths], settings, character (a preset whose
  // LoRA joins the run), name }. Returns the job.
  async run({ mode, video, section = { start: 0, length: 0 }, pictures = [], settings = {}, character = null, name }) {
    if (!WORKFLOW[mode]) throw new Error(`Unknown Replace mode "${mode}".`)
    if (!video || !fs.existsSync(video)) throw new Error('Choose the source video.')
    const check = await this.check(mode)
    if (!check.ready) throw new Error(`Replace needs ${[...check.packs.map((p) => p.name), ...check.models.map((m) => m.name)].join(', ')}. The Replace page lists where to get them.`)
    let g
    // motion 512 is OpenJutsu's default: the mannequin video H3 follows. 768 on a 24 GB card overflowed VRAM
    // and ran at 19 minutes a step (2026-10-28).
    const s = { resolution: '576p', motion: 512, hatFix: false, noLipSync: false, margin: 'normal', target: mode === 'object' ? '' : 'person', seed: Math.floor(Math.random() * 1e6), clipSeconds: 6, role: '', ...settings }
    if (mode === 'person') {
      if (pictures.length !== 1) throw new Error('Add one picture of the character.')
      g = pruneSimple(this.graph('simple'), s)
    } else if (mode === 'people' || mode === 'people_maxq') {
      if (pictures.length < 1 || pictures.length > MAX_CHARACTERS) throw new Error(`Add 1-${MAX_CHARACTERS} character pictures.`)
      if (mode === 'people_maxq' && pictures.length !== 2) throw new Error('One pass per person takes exactly two characters.')
      g = pruneAdvanced(this.graph(WORKFLOW[mode]), pictures.length, { ...s, roles: (s.roles || []).concat(Array(4).fill('')).slice(0, pictures.length) })
    } else if (mode === 'object') {
      Object.assign(s, { mode: settings.mode || 'change', changeTo: settings.changeTo || '', biggestOnly: !!settings.biggestOnly, keepOutline: !!settings.keepOutline })
      if (!['change', 'remove', 'background'].includes(s.mode)) throw new Error('Object mode is change, remove or background.')
      if (!s.target) throw new Error(s.mode === 'background' ? 'Say what stays, for example person.' : 'Say what to change, for example hair.')
      if (s.mode !== 'remove' && !s.changeTo && !pictures.length) throw new Error('Say what it becomes, or add a picture.')
      g = pruneObject(this.graph('object'), !!pictures.length && s.mode !== 'remove', s)
    } else if (mode === 'mask') {
      g = pruneMask(this.graph('mask'), s.hatFix, s.margin, s.target)
    } else if (mode === 'faces') {
      if (pictures.length !== 1) throw new Error('Add the picture of the face to restore.')
      g = pruneFace(this.graph('face'), { style: 'photo', chunkSeconds: 6.5, ...settings, seed: s.seed })
    } else if (mode === 'colours') {
      g = pruneColor(this.graph('color'), { detail: settings.detail ?? -0.2, tone: settings.tone === null ? null : { ...DEFAULT_TONE, ...(settings.tone || {}) } })
    }
    if (!['mask', 'colours'].includes(mode)) {
      // a RefMod character has no LoRA: Replace paints from its picture alone
      const extra = character?.lora ? [{ name: character.lora, strength: character.strength ?? 0.8 }] : []
      applyModel(g, await this.models(extra))
    }
    // the source: the part of the video to use (VHS cuts the soundtrack to match)
    const videoNode = { person: NODES.video, mask: MASK_NODES.video }[mode] || nodeByTitle(g, { object: OBJECT_VIDEO, faces: FACE_VIDEO, colours: COLOR_VIDEO }[mode] || VIDEO)
    if (!['faces', 'colours'].includes(mode)) setSection(g, videoNode, section)
    g[videoNode].inputs.video = await this.studio.stage(await this.conform(video), 'replace')
    // models other renders left loaded take VRAM H3 needs; ComfyUI drops them before this prompt starts
    if (!['colours'].includes(mode)) await this.studio.comfy.freeMemory().catch(() => {})
    const pictureNodes = mode === 'person' ? [NODES.picture] : mode === 'faces' ? [nodeByTitle(g, FACE_PICTURE)] : mode === 'object' ? (pictures.length && s.mode !== 'remove' ? [nodeByTitle(g, OBJECT_PICTURE)] : []) : pictures.map((_, i) => nodeByTitle(g, `Picture ${i + 1}`))
    for (const [i, id] of pictureNodes.entries()) g[id].inputs.image = await this.studio.stage(pictures[i], 'replace')
    // An older comfyui-h3-oneclick-swap has no H3SourceSlice; the Context-Loop shim's node takes the same inputs.
    const info = await this.studio.comfy.objectInfo()
    if (!info.H3SourceSlice && info.MiniMaxH3ContexLoopSourceSlice) for (const n of Object.values(g)) if (n.class_type === 'H3SourceSlice') n.class_type = 'MiniMaxH3ContexLoopSourceSlice'
    for (const n of Object.values(g)) delete n._meta
    const finalNode = Object.entries(g).find(([, n]) => n.class_type === 'MiniMaxH3ChainAssemble')?.[0] || Object.entries(g).filter(([, n]) => n.class_type === 'VHS_VideoCombine').pop()?.[0]
    const project = this.studio.createProject(name || `${{ person: 'Replace', people: 'Replace people', people_maxq: 'Replace people', object: 'Object', mask: 'Mask check', faces: 'Fix faces', colours: 'Fix colours' }[mode]} · ${path.basename(video).replace(/\.[^.]+$/, '')}`, null, null, 'replace')
    return this.studio.submitGraph({ kind: 'replace', graph: g, projectId: project.id, name: project.name, plan: { replace: { mode, finalNode, settings: s, section, video, pictures, character: character?.id || null }, request: { mode, prompt: '' } } })
  }

  // Past Replace runs, newest first, with their results; unfinished ones are refreshed from ComfyUI.
  async history() {
    const jobs = this.studio
      .listProjects()
      .filter((p) => p.tool === 'replace')
      .flatMap((p) => this.studio.listJobs(p.id).map((j) => ({ ...j, projectName: p.name })))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    const fresh = await Promise.all(jobs.map(async (j) => (['success', 'error', 'cancelled'].includes(j.status) ? j : { ...(await this.studio.refreshJob(j.id).catch(() => j)), projectName: j.projectName })))
    // a Remake take shows trimmed back to its source's length and shape (remake.js finalFile)
    return Promise.all(
      fresh.map(async (j) => {
        if (j.status !== 'success' || !this.remake || !this.studio.getJob(j.id).plan?.replace?.remake) return j
        const f = await this.remake.finalFile(this.studio.getJob(j.id)).catch(() => null)
        return f ? { ...j, engine: 'remake', outputs: [{ kind: 'final', path: f, filename: path.basename(f) }, ...(j.outputs || []).filter((o) => o.kind !== 'final')] } : { ...j, engine: 'remake' }
      })
    )
  }
}
