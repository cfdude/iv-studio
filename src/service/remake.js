// Remake: Replace's engine for swapping people and changing the scene, on Viggle Remake
// (huggingface.co/Viggle/Viggle-Remake, revision 21665fa): two LoRAs on MiniMax H3 (fl2va), merged into int8 files,
// swap (recast people) and edit (remove or add things, weather, light, setting, style). The source keeps its motion,
// camera, timing and soundtrack; painted frames of the target ("keyframes") decide the look, and a six-section prompt
// says what changes. Its ComfyUI nodes and prompt guide are Apache-2.0 and bundled (resources/comfy-nodes,
// resources/remake); the weights are under the MiniMax H3 Community License and come from Setup.
//
// What Viggle leaves to a person (or a paid image API), IV Studio does on this PC:
//   prepare   the source at 24 fps on Remake's canvas (short edge 480, both edges multiples of 32, the source's own
//             shape, stretched by a few percent at most, never cropped), cut to 17n+5 frames (a short one padded
//             with its last frames played backwards, trimmed off again after), and a frame per shot to paint
//   paint     each keyframe painted by IV Studio's picture editor (Qwen Image 2.1 edit, else Flux), from the
//             character's face for a swap or from the person's words for a change; the person approves them
//   write     the six-section prompt by the person's writer (local, Claude Code or Codex), from the source frames,
//             the painted frames and Viggle's guide
//   render    one ComfyUI graph per take (Viggle's own, with the int8 file in place of base + LoRA), then trimmed
//             back to the source's length and shape
// Tested on an RTX 4090 at 832x480 (2026-11-04): 226 frames in about 5 min with the first load, 124 in 143 s.
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { harnessJson } from './harness.js'
import { IMAGE_ASPECTS } from './images.js'
import { probe } from './media.js'
import { localChat, localWriterModel } from './prompter.js'
import { comboOptions } from './setup.js'

export const REMAKE_KINDS = ['swap', 'change']
export const FPS = 24
export const MIN_FRAMES = 90
export const MAX_FRAMES = 345
export const SHORT_EDGE = 480
const MAX_LONG = 1088 // 2.27:1 at 480
const MAX_KEYFRAMES = 4
export const MAX_PEOPLE = 2 // the frame plus two faces: Qwen Image 2.1 edit takes three pictures
const SIGMAS = { swap: '1.0, 0.990476, 0.965243, 0.923077, 0.8, 0.631579, 0.0', change: '1.0, 0.983607, 0.96, 0.923077, 0.857143, 0.705882, 0.0' }
const MODEL = { swap: 'viggle_remake_swap_pruned_int8_convrot.safetensors', change: 'viggle_remake_edit_pruned_int8_convrot.safetensors' }
const NODES = ['RemakeConditioning', 'RemakeKeyframeUntil', 'RemakeNoise']
export const SECTIONS = ['subject_definitions', 'summary', 'retention_analysis', 'detailed_description', 'overall_soundscape', 'non_diegetic_music']
export const CREDIT = 'Powered by Viggle Remake (https://huggingface.co/Viggle/Viggle-Remake), on MiniMax H3'

// ---------- pure parts (tested in test/remake.mjs) ----------

// The render length for a source of n frames: the smallest 17k+5 that holds it, at least 90. null when it is too
// long for one render (over 345 frames, 14.4 s).
export function remakeLength(n) {
  if (n > MAX_FRAMES) return null
  for (let f = MIN_FRAMES; f <= MAX_FRAMES; f += 17) if (f >= n) return f
  return null
}

// Remake's canvas for a w x h source: the short edge 480, the long edge the source's shape rounded to 32 (the node
// cover-crops anything else onto 16:9). Shapes past 2.27:1 are squeezed.
export function remakeCanvas(w, h) {
  const r = Math.max(w, h) / Math.min(w, h)
  const long = Math.min(MAX_LONG, Math.max(SHORT_EDGE, Math.round((SHORT_EDGE * r) / 32) * 32))
  return w >= h ? { width: long, height: SHORT_EDGE } : { width: SHORT_EDGE, height: long }
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
// The frames to paint: one per shot (12 frames in, as Viggle's examples pin, or the middle of a short shot), plus a
// second late in a long single shot, where a character can turn or the camera has moved on. At most four, inside the
// source's own frames (never in the backwards padding). cuts: frame numbers where a new shot starts.
export function pickKeyframes(frames, cuts = []) {
  const starts = [0, ...cuts.filter((c) => c > 8 && c < frames - 8)].sort((a, b) => a - b)
  const shots = starts.map((s, i) => ({ start: s, end: (starts[i + 1] ?? frames) - 1 }))
  const picks = []
  for (const s of shots) {
    const len = s.end - s.start + 1
    picks.push(clamp(s.start + Math.min(12, Math.floor(len / 2)), 0, frames - 1))
    if (shots.length === 1 && len >= 150) picks.push(clamp(s.start + Math.round(len * 0.8), 0, frames - 1))
  }
  // too many shots: keep the longest ones' frames, in order
  if (picks.length > MAX_KEYFRAMES) {
    const ranked = shots.map((s, i) => ({ i, len: s.end - s.start })).sort((a, b) => b.len - a.len).slice(0, MAX_KEYFRAMES).map((x) => x.i)
    return ranked.sort((a, b) => a - b).map((i) => picks[i])
  }
  return [...new Set(picks)]
}

// A painted swap passes when nobody was added and the person now shows: a face that looks like them (0.3+), and more
// so than before (someone in the source may already look like them: swapping Tess and Theo, Theo was there).
export const paintOk = (c) => !c.added && (c.score == null || (c.score >= 0.3 && (c.before == null || c.before < 0.3 || c.score >= c.before + 0.05)))

// The picture shape nearest the canvas, for the painter (it paints at a named aspect).
export const nearestAspect = (r) => Object.entries(IMAGE_ASPECTS).sort((a, b) => Math.abs(Math.log(a[1] / r)) - Math.abs(Math.log(b[1] / r)))[0][0]

export const stamp = (frame) => {
  const t = frame / FPS
  const m = Math.floor(t / 60)
  return `${String(m).padStart(2, '0')}:${(t - m * 60).toFixed(3).padStart(6, '0')}`
}

// The six sections as Remake reads them: each header on its own line, in order.
export function assemblePrompt(s) {
  return SECTIONS.map((k) => `${k}:\n${String(s[k] || (k === 'non_diegetic_music' ? 'N/A' : '')).trim()}`).join('\n\n') + '\n'
}

// What's wrong with a Remake prompt before it renders: the six sections in order, a <Picture N> for each painted
// frame, no edit orders ("replace", "change", "make"), times inside the render, no "dim" (it darkens the render).
export function checkRemakePrompt(text, { pictures = 0, frames = MAX_FRAMES } = {}) {
  const problems = []
  const at = SECTIONS.map((k) => text.search(new RegExp(`^${k}:`, 'm')))
  if (at.some((i) => i < 0)) problems.push(`missing ${SECTIONS.filter((_, i) => at[i] < 0).join(', ')}`)
  else if (at.some((v, i) => i && v < at[i - 1])) problems.push('the sections are out of order')
  for (let i = 1; i <= pictures; i++) if (!text.includes(`<Picture ${i}>`)) problems.push(`<Picture ${i}> isn't named`)
  if (new RegExp(`<Picture ${pictures + 1}>`).test(text)) problems.push(`names <Picture ${pictures + 1}>, but there are only ${pictures} painted frames`)
  const body = text.slice(Math.max(0, at[1]))
  if (/\b(replace|change|make|turn) (the|him|her|them|it|everyone)\b/i.test(body.replace(/\breplaces\b/gi, ''))) problems.push('gives an order instead of describing the result')
  if (/\bdim(ly)?\b/i.test(text)) problems.push('says "dim", which darkens the whole render')
  const end = (frames - 1) / FPS
  for (const m of text.matchAll(/\b(\d{2}):(\d{2}\.\d{3})\b/g)) if (Number(m[1]) * 60 + Number(m[2]) > end + 0.05) problems.push(`time ${m[0]} is past the end (${stamp(frames - 1)})`)
  return problems
}

// The ComfyUI graph for one take: Viggle's own workflow (comfyui/workflows/remake_*_api.json) with the merged int8
// file in place of the base model and the LoRA. Files are ComfyUI input names; lora: an optional character LoRA.
export function remakeGraph({ kind, unet, clip, vae, audioVae, source, refs, pins = [], frames, prompt, seed = 0, prefix = 'H3/remake/take', lora = null }) {
  const g = {
    1: { class_type: 'UNETLoader', inputs: { unet_name: unet, weight_dtype: 'default' } },
    3: { class_type: 'RemakeKeyframeUntil', inputs: { model: lora ? ['2', 0] : ['1', 0], keyframe_until: 0.9 } },
    4: { class_type: 'CLIPLoader', inputs: { clip_name: clip, type: 'minimax' } },
    5: { class_type: 'VAELoader', inputs: { vae_name: vae } },
    6: { class_type: 'VAELoader', inputs: { vae_name: audioVae } },
    7: { class_type: 'LoadVideo', inputs: { file: source } },
    8: { class_type: 'GetVideoComponents', inputs: { video: ['7', 0] } },
    11: {
      class_type: 'RemakeConditioning',
      inputs: { clip: ['4', 0], vae: ['5', 0], audio_vae: ['6', 0], source: ['8', 0], audio: ['8', 1], prompt, pins: pins.join(', '), frames, short_edge: SHORT_EDGE }
    },
    12: { class_type: 'RemakeNoise', inputs: { positive: ['11', 0], seed } },
    13: { class_type: 'BasicGuider', inputs: { model: ['3', 0], conditioning: ['11', 0] } },
    14: { class_type: 'KSamplerSelect', inputs: { sampler_name: 'euler' } },
    15: { class_type: 'ManualSigmas', inputs: { sigmas: SIGMAS[kind] } },
    16: { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['12', 0], guider: ['13', 0], sampler: ['14', 0], sigmas: ['15', 0], latent_image: ['11', 1] } },
    17: { class_type: 'VAEDecode', inputs: { samples: ['16', 0], vae: ['5', 0] } },
    18: { class_type: 'VAEDecodeAudio', inputs: { samples: ['16', 0], vae: ['6', 0] } },
    19: { class_type: 'CreateVideo', inputs: { images: ['17', 0], audio: ['18', 0], fps: FPS } },
    save: { class_type: 'SaveVideo', inputs: { video: ['19', 0], filename_prefix: prefix, format: 'mp4', codec: 'h264' } }
  }
  if (lora) g[2] = { class_type: 'LoraLoaderModelOnly', inputs: { model: ['1', 0], lora_name: lora.name, strength_model: lora.strength ?? 0.8 } }
  refs.forEach((r, i) => {
    g[`ref${i + 1}`] = { class_type: 'LoadImage', inputs: { image: r } }
    g[11].inputs[`ref_${i + 1}`] = [`ref${i + 1}`, 0]
  })
  return g
}

// What the picture editor is asked for, per keyframe. people: [{ who (whom they replace, in words), name,
// description }], each one's face the next picture after the frame. A swap is asked for as a change to someone
// already in the frame, never an addition: asked to "replace" her, Qwen put Theo beside Tess in a close-up
// (2026-11-04), and dropped the umbrella she held in the wide shot.
export function paintPrompt({ kind, ask, people = [] }) {
  if (kind === 'swap') {
    const one = people.length === 1
    return [
      'Picture 1 is a frame from a film.',
      ...people.map((p, i) => `Change ${p.who || (one ? 'the main person' : `person ${i + 1}`)} in picture 1 into ${p.name || 'the person'} from picture ${i + 2}: give them the face, hairstyle, hair colour, skin and build of picture ${i + 2}${p.description ? ` (${String(p.description).replace(/[.\s]+$/, '')})` : ''}, in the clothes they wear in picture 1.`),
      `Do not add anyone: picture 1's people stay exactly where they are, as many as before, with ${one ? 'that person' : 'those people'} now looking like ${one ? `picture 2` : 'their pictures'}.`,
      'Keep the pose, the hands and everything they hold, the expression, the camera framing, the background, the light and the style of picture 1 exactly.',
      'One single frame: no split screen, no collage, no text, no borders.'
    ].join(' ')
  }
  return [
    `Edit this video frame: ${String(ask).replace(/[.\s]+$/, '')}.`,
    'Keep everything else exactly as it is: the people, their poses and faces, the camera framing, the composition and the style.',
    'One single frame: no split screen, no collage, no text, no borders.'
  ].join(' ')
}

const run = (cmd, args) =>
  new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true })
    let err = ''
    let out = ''
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (err += d))
    p.on('error', reject)
    p.on('close', (code) => (code === 0 ? resolve(out + err) : reject(new Error(err.trim().split('\n').slice(-3).join(' ') || `${path.basename(cmd)} exited ${code}`))))
  })

const SCHEMA = { type: 'object', properties: Object.fromEntries(SECTIONS.map((k) => [k, { type: 'string' }])), required: SECTIONS }

export class Remake {
  // images: IV Studio's picture tools (images.js). writer: () => { engine, model } (Settings → Prompt writer).
  // faces: Shinobi's face model runner (likeness), to check painted swaps; optional.
  constructor({ studio, images, faces = null, dataDir, resourcesDir, ffmpeg, ffprobe, writer }) {
    this.studio = studio
    this.images = images
    this.faces = faces
    this.dir = path.join(dataDir, 'remake')
    this.resourcesDir = resourcesDir
    this.ffmpeg = ffmpeg
    this.ffprobe = ffprobe
    this.writer = writer || (() => ({ engine: 'local' }))
  }

  sessionFile = (id) => path.join(this.dir, id, 'session.json')
  get(id) {
    try {
      return JSON.parse(fs.readFileSync(this.sessionFile(id), 'utf8'))
    } catch {
      throw new Error(`No Remake ${id}.`)
    }
  }
  save(s) {
    fs.mkdirSync(path.join(this.dir, s.id), { recursive: true })
    fs.writeFileSync(this.sessionFile(s.id), JSON.stringify(s, null, 1))
    return s
  }

  // The int8 file for a kind on this ComfyUI (any folder), and what else Remake needs that it lacks.
  async check(kind = 'swap') {
    // Comfy Cloud has no Viggle Remake; the person's own cloud (RunPod, Modal) downloads it the first time it's used
    if (this.studio.comfy.hosted) return { ready: false, cloud: true, error: 'Replace doesn’t run on Comfy Cloud: it needs Viggle Remake. Use this computer, or your own cloud on RunPod or Modal.', packs: [], models: [], unet: null }
    const info = await this.studio.comfy.objectInfo()
    const unets = comboOptions(info, 'UNETLoader', 'unet_name') || []
    const unet = unets.find((u) => u.replace(/\\/g, '/').split('/').pop() === MODEL[kind]) || null
    const packs = NODES.filter((c) => !info[c]).length ? [{ name: 'Viggle Remake nodes (Settings → Setup → Install missing node packs)', url: null, missing: NODES.filter((c) => !info[c]) }] : []
    const models = unet ? [] : [{ name: `Viggle Remake ${kind === 'swap' ? 'swap' : 'edit'} (${MODEL[kind]}, 21 GB)`, where: 'diffusion_models', setup: kind === 'swap' ? 'remake_swap' : 'remake_edit' }]
    return { ready: !packs.length && !models.length, packs, models, unet }
  }

  // 1. The source on Remake's canvas, and the frames to paint. section: {start, length} in seconds.
  async prepare({ video, section = { start: 0, length: 0 }, kind = 'swap' }) {
    if (!video || !fs.existsSync(video)) throw new Error('Choose the source video.')
    if (!REMAKE_KINDS.includes(kind)) throw new Error('kind is swap or change.')
    const info = await probe(this.ffprobe, video)
    if (info.kind !== 'video') throw new Error('That isn’t a video.')
    const start = Math.max(0, section.start || 0)
    const span = Math.max(0, Math.min(section.length || info.duration - start, info.duration - start))
    const n = Math.round(span * FPS)
    const frames = remakeLength(n)
    if (!frames) throw new Error(`Remake takes up to ${(MAX_FRAMES / FPS).toFixed(1)} s at a time; this part is ${span.toFixed(1)} s. Trim it (click the video), or remake it in parts.`)
    if (n < 24) throw new Error('That part is under a second.')
    const canvas = remakeCanvas(info.width, info.height)
    const id = randomUUID().slice(0, 8)
    const dir = path.join(this.dir, id)
    fs.mkdirSync(dir, { recursive: true })
    const source = path.join(dir, 'source.mp4')
    // the source's own frames, then (when 17n+5 needs more) its last ones played backwards; sound padded with silence
    const pad = frames - n
    const scale = `scale=${canvas.width}:${canvas.height}:flags=lanczos,setsar=1,fps=${FPS}`
    const v = pad ? `[0:v]${scale},trim=end_frame=${n},setpts=PTS-STARTPTS,split[a][b];[b]reverse,trim=start_frame=1:end_frame=${pad + 1},setpts=PTS-STARTPTS[r];[a][r]concat=n=2:v=1:a=0[v]` : `[0:v]${scale},trim=end_frame=${n},setpts=PTS-STARTPTS[v]`
    const a = info.hasAudio ? `[0:a]aresample=48000,apad,atrim=end=${(frames / FPS).toFixed(4)}[s]` : `anullsrc=r=48000:cl=stereo,atrim=end=${(frames / FPS).toFixed(4)}[s]`
    await run(this.ffmpeg, ['-y', '-v', 'error', '-ss', start.toFixed(3), '-t', (span + 0.5).toFixed(3), '-i', video, '-filter_complex', `${v};${a}`, '-map', '[v]', '-map', '[s]', '-c:v', 'libx264', '-crf', '12', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', source])
    // shots: where the picture jumps (ffmpeg's scene score)
    const scd = await run(this.ffmpeg, ['-v', 'info', '-i', source, '-vf', `trim=end_frame=${n},select='gt(scene,0.35)',showinfo`, '-f', 'null', '-']).catch(() => '')
    const cuts = [...scd.matchAll(/n:\s*\d+\s+pts:\s*\d+\s+pts_time:([\d.]+)/g)].map((m) => Math.round(Number(m[1]) * FPS))
    const keyframes = []
    for (const f of pickKeyframes(n, cuts)) {
      const file = path.join(dir, `frame_${f}.png`)
      await run(this.ffmpeg, ['-y', '-v', 'error', '-i', source, '-vf', `select=eq(n\\,${f})`, '-frames:v', '1', file])
      keyframes.push({ frame: f, time: stamp(f), file, painted: null })
    }
    return this.save({ id, kind, video, section: { start, length: span }, source, n, frames, canvas, original: { width: info.width, height: info.height }, cuts, keyframes, createdAt: new Date().toISOString() })
  }

  // The picture editor IV Studio uses here: Qwen Image 2.1 (it kept the shot and its style in the 2026-11-04 test),
  // else Flux.2 or Flux 3 Klein.
  async painter() {
    if (!this.images) throw new Error('Painting needs IV Studio’s picture tools.')
    const st = await this.images.status()
    if (st.error) throw new Error(st.error)
    const fam = ['qwen21', 'flux2', 'flux3'].map((id) => st.families.find((f) => f.id === id && f.edit && f.models.length)).find(Boolean)
    if (!fam) throw new Error('Painting needs a picture editor: Qwen Image 2.1, Flux.2 Klein or Flux 3 Klein. Set one up in Settings → Setup.')
    return { family: fam.id, model: fam.models.find((m) => !/uc-/i.test(m)) || fam.models[0] }
  }

  // 2. Paints the keyframes (all, or the frame numbers in only). swap: people [{ picture (their face), name,
  // description, who (whom they replace) }], up to 2 (or picture/name/who for one). change: ask, the change in plain
  // words. Waits for the pictures.
  async paint(id, { ask = '', people = null, who = '', picture = null, name = '', description = '', only = null, seed = null, onProgress } = {}) {
    let s = this.get(id)
    const cast = (people?.length ? people : picture ? [{ picture, name, description, who }] : []).filter((p) => p.picture)
    if (s.kind === 'swap' && !cast.length) throw new Error('Add a picture of who goes in.')
    if (cast.length > MAX_PEOPLE) throw new Error(`Remake swaps up to ${MAX_PEOPLE} people at once.`)
    if (s.kind === 'change' && !String(ask).trim()) throw new Error('Say what changes, for example "a snowy winter evening" or "remove the wind turbines".')
    s = this.save({ ...s, ask, people: cast })
    const { model } = await this.painter()
    const aspect = nearestAspect(s.canvas.width / s.canvas.height)
    const checking = s.kind === 'swap' && this.faces?.faceModelsReady?.()
    // a swap paints one person per pass, the next into the last one's result: asked for two at once, Qwen made the
    // woman into Theo but never put Tess in for the man (2026-11-04)
    const passes = s.kind === 'swap' ? cast.map((p) => [p]) : [[]]
    for (const k of s.keyframes) {
      if (only && !only.includes(k.frame)) continue
      onProgress?.({ frame: k.frame, step: 'painting' })
      let current = k.file
      let check = null
      for (const pass of passes) {
        const prompt = paintPrompt({ kind: s.kind, ask, people: pass })
        // each swap pass is checked with the face model (InsightFace, as take ranking uses): no face added, and with
        // one person, that it looks like them; otherwise painted again with a new seed, twice at most, keeping the best
        let best = null
        for (let attempt = 0; attempt < (checking ? 3 : 1); attempt++) {
          const set = await this.images.create({ mode: 'edit', model, prompt, refs: [current, ...pass.map((p) => p.picture)], count: 1, seed: seed != null && !attempt ? seed : Math.floor(Math.random() * 1e9), keepAspect: true, aspect, megapixels: 1, name: `Remake · frame ${k.frame}`, tag: `remake:${id}` })
          const done = await this.waitPictures(set.id)
          const file = path.join(this.dir, id, `painted_${k.frame}_${Date.now()}.png`)
          // on the canvas exactly, so the node stretches nothing and crops nothing
          await run(this.ffmpeg, ['-y', '-v', 'error', '-i', done, '-vf', `scale=${s.canvas.width}:${s.canvas.height}:flags=lanczos`, file])
          const c = checking ? await this.checkPaint(current, file, pass[0], cast.length === 1).catch(() => null) : null
          const rank = c ? (c.added ? -1 : 0) + (c.score ?? 0) : 0
          if (!best || rank > best.rank) best = { file, check: c, rank }
          if (!c || paintOk(c)) break
          onProgress?.({ frame: k.frame, step: 'painting again', why: c.added ? 'it added a person' : `it didn't look enough like ${pass[0].name || 'them'}` })
        }
        current = best.file
        check = best.check && check ? { ...best.check, added: best.check.added || check.added } : best.check
      }
      s = this.get(id)
      s.keyframes = s.keyframes.map((x) => (x.frame === k.frame ? { ...x, painted: current, own: false, check } : x))
      this.save(s)
      onProgress?.({ frame: k.frame, step: 'painted', file: current })
    }
    return this.get(id)
  }

  // A painted swap frame against the frame it was painted from: faces counted in both (more faces = someone was
  // added), and the person's likeness: the largest face alone, or with several people (single false) whichever face
  // looks most like them. null without the face models.
  async checkPaint(source, painted, person, single = true) {
    if (!this.faces?.faceModelsReady?.()) return null
    const [src, pnt] = await this.faces.likeness(person.picture, [source, painted])
    return { score: single ? pnt.score : pnt.best ?? null, before: single ? src.score : src.best ?? null, faces: pnt.faces, sourceFaces: src.faces, added: pnt.faces > src.faces }
  }

  async waitPictures(setId) {
    for (let i = 0; i < 600; i++) {
      const r = await this.images.get(setId)
      if (r.status === 'success' && r.files?.length) return r.files[0]
      if (['error', 'cancelled'].includes(r.status)) throw new Error(`Painting failed: ${r.error || r.status}`)
      await new Promise((res) => setTimeout(res, 2000))
    }
    throw new Error('Painting took over 20 minutes.')
  }

  // A picture of your own for a keyframe (painted elsewhere), fitted to the canvas.
  async usePicture(id, frame, file) {
    const s = this.get(id)
    const out = path.join(this.dir, id, `own_${frame}_${Date.now()}.png`)
    await run(this.ffmpeg, ['-y', '-v', 'error', '-i', file, '-vf', `scale=${s.canvas.width}:${s.canvas.height}:flags=lanczos`, out])
    s.keyframes = s.keyframes.map((x) => (x.frame === frame ? { ...x, painted: out, own: true } : x))
    return this.save(s)
  }

  // Leaves a keyframe out (or brings it back): fewer pins give the model more room.
  setKeyframe(id, frame, { skip }) {
    const s = this.get(id)
    s.keyframes = s.keyframes.map((x) => (x.frame === frame ? { ...x, skip: !!skip } : x))
    return this.save(s)
  }

  // 3. The six-section prompt, by the person's writer, from the source frames and the painted ones.
  async write(id) {
    const s = this.get(id)
    const keys = s.keyframes.filter((k) => k.painted && !k.skip)
    if (!keys.length) throw new Error('Paint at least one frame first.')
    const guide = ['short_guide.md', s.kind === 'swap' ? 'example_swap_prompt.txt' : 'example_edit_prompt.txt'].map((f) => fs.readFileSync(path.join(this.resourcesDir, 'remake', f), 'utf8'))
    const seconds = (s.n - 1) / FPS
    const system = [
      'You write prompts for Viggle Remake, a MiniMax H3 video model that re-renders a source video (<Video 1>) so it matches painted frames of the target (<Picture N>), keeping the motion, camera, timing and soundtrack.',
      'Answer with JSON: one string per section, the section text only, without its header.',
      s.kind === 'swap' ? 'This is a swap: people are recast.' : 'This is a scene edit (not a swap): the people stay; things are removed, added or changed, or the weather, light, setting or style changes. Start the summary with "[video editing]". Each <Picture N> is "a frame of the target video, exactly as the target video shows it at that moment", and in retention_analysis "fully_preserved - the target video passes through this exact frame". Give the changed things and the setting their own <Subject N>, and in retention_analysis say exactly what is removed or changed.',
      `Times are MM:SS.mmm inside 00:00.000-${stamp(s.n - 1)}. Say when the scene matches each picture, at the times given.`,
      'Describe what you see in the frames. Never guess spoken words. Write the target as it plays; never write orders like "replace" or "change".',
      '',
      'GUIDE:',
      guide[0],
      '',
      'FORMAT EXAMPLE (another video):',
      guide[1]
    ].join('\n')
    const wanted = s.kind === 'swap' ? (s.people || []).map((p, i) => `Character ${i + 1}: ${p.name || 'the character'} (as painted${p.description ? `: ${p.description}` : ''}) replaces ${p.who || 'the main person'}.`).join(' ') : `What changes: ${s.ask}.`
    // what the writer sees: 6 source frames across the clip, then each painted frame
    const shots = [0, 0.2, 0.4, 0.6, 0.8, 1].map((f) => Math.min(s.n - 1, Math.round(f * (s.n - 1))))
    const images = []
    for (const [i, f] of shots.entries()) images.push({ name: `source-${i + 1}.jpg`, label: `<Video 1> at ${stamp(f)}`, data: await this.jpeg(s.source, f) })
    for (const [i, k] of keys.entries()) images.push({ name: `picture-${i + 1}.jpg`, label: `<Picture ${i + 1}>, the target video at ${k.time}`, data: (await this.jpegFile(k.painted)).toString('base64') })
    const cutsText = s.cuts.length ? `Cuts at ${s.cuts.map(stamp).join(', ')}.` : 'One continuous shot, no cuts.'
    const user = [`The source is ${seconds.toFixed(2)} s at 24 fps (${s.n} frames). ${cutsText}`, wanted, `Painted frames: ${keys.map((k, i) => `<Picture ${i + 1}> at ${k.time}`).join(', ')}.`, '', 'Images, in order:', ...images.map((im, i) => `Image ${i + 1} (${im.name}): ${im.label}`)].join('\n')
    const { engine, model } = this.writer()
    let data
    if (engine === 'claude' || engine === 'codex') data = await harnessJson({ engine, model, system, user: `${user}\n${engine === 'claude' ? 'Open each image file with the Read tool before you write.\n' : ''}\nAnswer with the JSON object only.`, schema: SCHEMA, images, timeoutMs: 600000 })
    else data = await this.local({ system, user, images, model })
    let prompt = assemblePrompt(data)
    let problems = checkRemakePrompt(prompt, { pictures: keys.length, frames: s.frames })
    // one repair pass with the problems named
    if (problems.length) {
      const note = `Your answer had these problems: ${problems.join('; ')}. Answer again with every problem fixed.`
      data = engine === 'claude' || engine === 'codex' ? await harnessJson({ engine, model, system, user: `${user}\n\n${note}\n\nAnswer with the JSON object only.`, schema: SCHEMA, images, timeoutMs: 600000 }) : await this.local({ system, user: `${user}\n\n${note}`, images, model })
      prompt = assemblePrompt(data)
      problems = checkRemakePrompt(prompt, { pictures: keys.length, frames: s.frames })
    }
    return this.save({ ...this.get(id), prompt, promptProblems: problems, writer: engine })
  }

  async local({ system, user, images, model }) {
    const { name } = await localWriterModel(model, { needsEyes: 'write a Remake prompt' })
    return localChat({ model: name, system, schema: SCHEMA, temperature: 0.4, ctx: 24576, maxTokens: 6000, timeoutMs: 900000, messages: [{ role: 'user', content: user, images: images.map((i) => i.data) }] })
  }

  async jpeg(file, frame) {
    const out = path.join(this.dir, `tmp_${randomUUID().slice(0, 6)}.jpg`)
    await run(this.ffmpeg, ['-y', '-v', 'error', '-i', file, '-vf', `select=eq(n\\,${frame}),scale='min(1024,iw)':-2`, '-frames:v', '1', '-q:v', '4', out])
    const data = fs.readFileSync(out).toString('base64')
    fs.rmSync(out, { force: true })
    return data
  }
  async jpegFile(file) {
    const out = path.join(this.dir, `tmp_${randomUUID().slice(0, 6)}.jpg`)
    await run(this.ffmpeg, ['-y', '-v', 'error', '-i', file, '-vf', "scale='min(1024,iw)':-2", '-q:v', '4', out])
    const data = fs.readFileSync(out)
    fs.rmSync(out, { force: true })
    return data
  }

  // The prompt as the person edited it.
  setPrompt(id, prompt) {
    const s = this.get(id)
    return this.save({ ...s, prompt, promptProblems: checkRemakePrompt(prompt, { pictures: s.keyframes.filter((k) => k.painted && !k.skip).length, frames: s.frames }) })
  }

  // 4. Renders the takes. takes: 1-3 (seeds seed, seed+1000, ...). character: a preset whose LoRA joins the run.
  async render(id, { takes = 1, seed = null, character = null } = {}) {
    let s = this.get(id)
    if (!s.prompt) s = await this.write(id)
    const keys = s.keyframes.filter((k) => k.painted && !k.skip)
    if (!keys.length) throw new Error('Paint at least one frame first.')
    const check = await this.check(s.kind)
    if (!check.ready) throw new Error(`Remake needs ${[...check.packs.map((p) => p.name), ...check.models.map((m) => m.name)].join(', ')}.`)
    const t = this.studio.template
    const source = await this.studio.stage(s.source, 'remake')
    const refs = []
    for (const k of keys) refs.push(await this.studio.stage(k.painted, 'remake'))
    const project = s.projectId ? this.studio.getProject(s.projectId) : this.studio.createProject(`${s.kind === 'swap' ? 'Swap' : 'Change'} · ${path.basename(s.video).replace(/\.[^.]+$/, '')}`, null, null, 'replace')
    s = this.save({ ...s, projectId: project.id })
    const base = seed ?? Math.floor(Math.random() * 1e6)
    const jobs = []
    for (let i = 0; i < Math.max(1, Math.min(3, takes)); i++) {
      const graph = remakeGraph({ kind: s.kind, unet: check.unet, clip: t['2'].inputs.clip_name, vae: t['3'].inputs.vae_name, audioVae: t['4'].inputs.vae_name, source, refs, pins: keys.map((k) => k.frame), frames: s.frames, prompt: s.prompt, seed: base + i * 1000, prefix: `H3/remake/${s.id}_s${base + i * 1000}`, lora: character?.lora ? { name: character.lora, strength: character.strength ?? 0.8 } : null })
      jobs.push(await this.studio.submitGraph({ kind: 'replace', graph, projectId: project.id, name: project.name, plan: { replace: { mode: s.kind === 'swap' ? 'remake-swap' : 'remake-change', engine: 'remake', finalNode: 'save', remake: s.id, video: s.video, section: s.section, seed: base + i * 1000 }, request: { mode: 'remake', prompt: s.prompt } } }))
    }
    return { session: this.save({ ...this.get(id), jobs: [...(s.jobs || []), ...jobs.map((j) => j.id)] }), jobs }
  }

  // A finished take back at the source's length and shape: the backwards padding cut off, stretched back to the
  // source's aspect at the canvas's long edge. Made once, next to the take; returns its path.
  async finalFile(job) {
    const r = job.plan?.replace
    if (!r?.remake) return null
    const take = job.outputs?.find((o) => o.kind === 'final')
    if (!take) return null
    const s = this.get(r.remake)
    const out = path.join(this.dir, s.id, `${job.id}_final.mp4`)
    if (fs.existsSync(out)) return out
    const local = await this.studio.localCopy(take, path.join(this.dir, s.id))
    const long = Math.max(s.canvas.width, s.canvas.height)
    const ratio = s.original.width / s.original.height
    const w = ratio >= 1 ? long : Math.round((long * ratio) / 2) * 2
    const h = ratio >= 1 ? Math.round(long / ratio / 2) * 2 : long
    await run(this.ffmpeg, ['-y', '-v', 'error', '-i', local, '-vf', `trim=end_frame=${s.n},setpts=PTS-STARTPTS,scale=${w}:${h}:flags=lanczos`, '-af', `atrim=end=${(s.n / FPS).toFixed(4)}`, '-c:v', 'libx264', '-crf', '16', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', out])
    return out
  }
}
