// Audio -> Sounds: sound effects, ambiences, one-shots and short loops from a description, with Stability AI's
// Stable Audio 3 (medium) on this PC's ComfyUI. The graph is ComfyUI's own Stable Audio 3 template (the one Freefield's
// Sound Effects app is built from, github.com/neuregex/freefield, MIT), without its Qwen prompt expander: IV Studio's
// own writer expands a description instead (Write it for me). Each sound is a ComfyUI job of kind 'sound' with one
// to four takes, copied into the data folder's sounds/ when finished.
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { readSettings, writerOf } from './paths.js'
import { harnessJson } from './harness.js'
import { ollamaJson } from './prompter.js'

export const SOUND_KINDS = [
  { id: 'sfx', label: 'Sound effect', example: 'A heavy wooden door slams shut in a stone hallway, a short echo after.', seconds: 4 },
  { id: 'ambience', label: 'Ambience', example: 'Steady rain on a tin roof, distant rolling thunder, water dripping from a gutter close by.', seconds: 15 },
  { id: 'oneshot', label: 'One-shot', example: 'A deep cinematic boom with a long sub tail, dry and close.', seconds: 3 },
  { id: 'loop', label: 'Music loop', example: 'A warm Rhodes chord loop with soft tape saturation, laid-back, 84 BPM.', seconds: 10 }
]
export const SOUND_LIMITS = { min: 1, max: 120, takes: 4 }
export const SOUND_ENGINE = { label: 'Stable Audio 3', by: 'Stability AI', licence: 'Stable Audio Community License', models: ['sa3', 'sa3_te'] }

// How the writer expands a description, per kind (IV Studio's own wording).
const WRITE_RULES = {
  sfx: 'Describe one sound effect for a generative audio model: the source, what it is made of (metal, wood, glass, skin, water), the space it happens in (a small room, a hall, outdoors, underwater, close or far), and how it moves through time (the attack, what follows, how it ends). One or two dense sentences, no lists.',
  ambience: 'Describe a background ambience for a generative audio model: the place, the steady bed of sound, two or three details that come and go over it, and how near or far each one is. It should loop naturally. One or two dense sentences, no lists.',
  oneshot: 'Describe one short, isolated sample for music production: the instrument or source, how it is struck or played, its tone and texture, and how it is recorded (dry or roomy, close-miked). One sentence.',
  loop: 'Describe a short instrumental music loop for a generative audio model: the instrument or groove, how it is played, its tone, the style and mood, and its tempo in BPM. It should loop seamlessly. One or two sentences.'
}
const WRITE_SCHEMA = { type: 'object', properties: { description: { type: 'string' }, seconds: { type: 'integer' } }, required: ['description', 'seconds'] }

// ComfyUI's Stable Audio 3 template, as an API graph: 8 steps of lcm at CFG 1, an empty negative.
export function soundGraph({ ckpt, te, text, seconds, seed, takes = 1, prefix }) {
  return {
    1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: ckpt } },
    2: { class_type: 'CLIPLoader', inputs: { clip_name: te, type: 'stable_audio', device: 'default' } },
    3: { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text } },
    4: { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: '' } },
    5: { class_type: 'EmptyLatentAudio', inputs: { seconds, batch_size: takes } },
    6: { class_type: 'KSampler', inputs: { model: ['1', 0], positive: ['3', 0], negative: ['4', 0], latent_image: ['5', 0], seed, steps: 8, cfg: 1, sampler_name: 'lcm', scheduler: 'simple', denoise: 1 } },
    7: { class_type: 'VAEDecodeAudio', inputs: { samples: ['6', 0], vae: ['1', 2] } },
    8: { class_type: 'SaveAudio', inputs: { audio: ['7', 0], filename_prefix: prefix } }
  }
}

const now = () => new Date().toISOString()
const slug = (s) => String(s || 'sound').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'sound'
const base = (p) => String(p).split(/[\\/]/).pop()
const comboOptions = (info, cls, input) => {
  const spec = info?.[cls]?.input?.required?.[input] || info?.[cls]?.input?.optional?.[input]
  return Array.isArray(spec?.[0]) ? spec[0] : spec?.[1]?.options || null
}
const readJson = (f, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'))
  } catch {
    return fallback
  }
}

export class Sounds {
  constructor({ studio, dataDir, probe }) {
    this.studio = studio
    this.dir = path.join(dataDir, 'sounds')
    this.probe = probe
  }

  file = () => path.join(this.dir, 'sounds.json')
  all = () => readJson(this.file(), [])
  saveAll = (list) => (fs.mkdirSync(this.dir, { recursive: true }), fs.writeFileSync(this.file(), JSON.stringify(list, null, 1)))

  // Stable Audio 3's two files on this ComfyUI, by file name (the manifest's name or one of its alts).
  async status() {
    let info
    try {
      info = await this.studio.comfy.objectInfo()
    } catch (err) {
      return { error: err.message, ready: false, missing: [] }
    }
    const files = {}
    const missing = []
    for (const id of SOUND_ENGINE.models) {
      const m = this.studio.manifest.models.find((x) => x.id === id)
      const [cls, input] = m.loader.split('.')
      const opts = comboOptions(info, cls, input) || []
      const found = [m.match, ...(m.alt || [])].map((n) => opts.find((o) => base(o) === n)).find(Boolean)
      if (found) files[id] = found
      else missing.push({ id, label: m.label, size: m.size, folder: m.folder })
    }
    const missingNodes = ['EmptyLatentAudio', 'VAEDecodeAudio', 'SaveAudio'].filter((n) => !info[n])
    if (!comboOptions(info, 'CLIPLoader', 'type')?.includes('stable_audio')) missingNodes.push('CLIPLoader (stable_audio)')
    return { ready: !missing.length && !missingNodes.length, missing, missingNodes, files, engine: SOUND_ENGINE }
  }

  // The person's writer (Settings → Prompt writer) turns a few words into a full description and a length.
  async write({ idea, kind = 'sfx' }) {
    const k = SOUND_KINDS.find((x) => x.id === kind) || SOUND_KINDS[0]
    const words = String(idea || '').trim()
    if (!words) throw new Error('Write a few words about the sound first.')
    const s = readSettings()
    const system = `${WRITE_RULES[k.id]}\nAlso give its length in whole seconds (${SOUND_LIMITS.min} to ${SOUND_LIMITS.max}): impacts and clicks 1-3, actions 3-6, ambiences 10-30, loops one or two bars.\nAnswer as JSON: {"description": "...", "seconds": n}.`
    const user = `The sound: ${words}`
    const w = writerOf(s)
    const engine = w.engine === 'claude' || w.engine === 'codex' ? w.engine : 'local'
    const out = engine === 'local' ? await ollamaJson({ system, user, schema: WRITE_SCHEMA, model: s.ollamaModel || undefined, cpu: await this.studio.gpuBusy?.().catch(() => false) }) : await harnessJson({ engine, model: w.model, system, user, schema: WRITE_SCHEMA })
    const description = String(out?.description || '').trim()
    if (!description) throw new Error('The writer gave nothing back. Try again.')
    const seconds = Math.min(SOUND_LIMITS.max, Math.max(SOUND_LIMITS.min, Math.round(Number(out.seconds) || k.seconds)))
    return { description, seconds }
  }

  // Queues one sound (1-4 takes). Returns the record; it fills in as the job runs (see list()).
  async create({ description, kind = 'sfx', seconds, takes = 1, seed = null, name } = {}) {
    const text = String(description || '').trim()
    if (!text) throw new Error('Describe the sound first: what it is, what it is made of, where it happens.')
    const k = SOUND_KINDS.find((x) => x.id === kind) || SOUND_KINDS[0]
    const secs = Math.round(Number(seconds ?? k.seconds) * 10) / 10
    if (!(secs >= SOUND_LIMITS.min && secs <= SOUND_LIMITS.max)) throw new Error(`Sounds are ${SOUND_LIMITS.min} to ${SOUND_LIMITS.max} seconds.`)
    const n = Math.round(Number(takes) || 1)
    if (n < 1 || n > SOUND_LIMITS.takes) throw new Error(`Make 1 to ${SOUND_LIMITS.takes} takes at once.`)
    const st = await this.status()
    if (st.error) throw new Error(st.error)
    if (st.missingNodes?.length) throw new Error(`This ComfyUI has no ${st.missingNodes.join(', ')}. Update ComfyUI.`)
    if (st.missing.length) throw new Error(`Stable Audio 3 needs ${st.missing.map((m) => m.label).join(' and ')}. Download ${st.missing.length === 1 ? 'it' : 'them'} on the Sounds page.`)
    const id = randomUUID().slice(0, 8)
    const s = seed == null || seed === '' ? Math.floor(Math.random() * 2 ** 31) : Math.floor(Number(seed))
    const title = String(name || '').trim() || text.split(/[.,;\n]/)[0].slice(0, 48)
    const prefix = `iv_studio/sounds/${slug(title)}_${id}`
    const graph = soundGraph({ ckpt: st.files.sa3, te: st.files.sa3_te, text, seconds: secs, seed: s, takes: n, prefix })
    const project = this.studio.createProject(`Sound · ${title}`, null, null, 'sound')
    const job = await this.studio.submitGraph({ kind: 'sound', graph, projectId: project.id, name: title, plan: { sound: { soundId: id }, request: { prompt: text } } })
    const sound = { id, name: title, kind: k.id, description: text, seconds: secs, takes: n, seed: s, projectId: project.id, jobId: job.id, status: job.status, files: [], createdAt: now() }
    this.saveAll([sound, ...this.all()])
    return sound
  }

  // A sound, brought up to date: a finished job's takes are copied into sounds/ once.
  async refresh(sound) {
    if (['success', 'error', 'cancelled'].includes(sound.status) && (sound.status !== 'success' || sound.files?.length)) return sound
    let job
    try {
      job = await this.studio.refreshJob(sound.jobId)
    } catch (err) {
      return { ...sound, note: err.message }
    }
    const next = { ...sound, status: job.status, progress: job.progress, queuePosition: job.queuePosition, seconds_taken: job.seconds }
    if (job.status === 'error') next.error = job.error
    if (job.status === 'success') {
      const outs = (job.outputs || []).filter((o) => o.kind === 'audio')
      if (!outs.length) Object.assign(next, { status: 'error', error: 'ComfyUI finished but saved no sound.' })
      else {
        fs.mkdirSync(this.dir, { recursive: true })
        const files = []
        for (const [i, out] of outs.entries()) {
          const src = await this.studio.localCopy(out, path.join(this.dir, '_comfy'))
          const file = path.join(this.dir, `${slug(sound.name)}_${sound.id}${outs.length > 1 ? `_${i + 1}` : ''}${path.extname(src) || '.flac'}`)
          if (!fs.existsSync(file)) fs.copyFileSync(src, file)
          if (path.dirname(src) === path.join(this.dir, '_comfy')) fs.rmSync(src, { force: true })
          files.push({ file, duration: (await this.probe(file).catch(() => null))?.duration ?? null })
        }
        next.files = files
        next.finishedAt = now()
      }
    }
    if (['success', 'error', 'cancelled'].includes(next.status)) {
      delete next.progress
      delete next.queuePosition
      this.saveAll(this.all().map((x) => (x.id === sound.id ? next : x)))
    }
    return next
  }

  async list() {
    return Promise.all(this.all().map((s) => this.refresh(s)))
  }

  async get(id) {
    const s = this.all().find((x) => x.id === id)
    if (!s) throw new Error(`No sound ${id}.`)
    return this.refresh(s)
  }

  rename(id, name) {
    if (!String(name || '').trim()) throw new Error('Give the sound a name.')
    const list = this.all()
    const s = list.find((x) => x.id === id)
    if (!s) throw new Error(`No sound ${id}.`)
    s.name = String(name).trim()
    this.saveAll(list)
    return s
  }

  async cancel(id) {
    const s = this.all().find((x) => x.id === id)
    if (!s) throw new Error(`No sound ${id}.`)
    await this.studio.cancelJob(s.jobId)
    return this.refresh(s)
  }

  // Removes the sound and its copies in sounds/ (a sound still being made is stopped first). ComfyUI's own copy stays.
  async delete(id) {
    const s = this.all().find((x) => x.id === id)
    if (!s) throw new Error(`No sound ${id}.`)
    if (!['success', 'error', 'cancelled'].includes(s.status)) await this.studio.cancelJob(s.jobId).catch(() => {})
    for (const f of s.files || []) fs.rmSync(f.file, { force: true })
    try {
      this.studio.deleteProject(s.projectId)
    } catch {}
    this.saveAll(this.all().filter((x) => x.id !== id))
    return { deleted: id }
  }
}
