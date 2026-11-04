// Music: songs and instrumentals made on this PC's ComfyUI, with its own nodes (no node packs).
//   minimax  MiniMax Music 3 (MiniMax-Music3 Community Licence): full songs up to 5 minutes, the clearest
//            sung words of the open models. A song takes minutes. Commercial use is allowed; a product
//            that uses it shows "MiniMax-Music3", and above $20M a year it needs MiniMax's written OK.
//   ace      ACE-Step 1.5 Turbo (Apache-2.0): a song in seconds, for drafts and background music.
// Each song is a ComfyUI job (a project with tool 'music'); once it finishes, its audio is copied into the
// data folder's music/, so Edit, Create and agents get a file on this PC whatever ComfyUI it ran on.
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { comboOptions } from './setup.js'
import { findGpu, gpuMemoryGb } from './gpu.js'

export const MUSIC_ENGINES = [
  {
    id: 'minimax',
    label: 'MiniMax Music 3',
    short: 'Best',
    maxSeconds: 300,
    note: 'Full songs up to 5 minutes with the clearest sung words. Takes a few minutes.',
    licence: 'MiniMax-Music3 Community Licence: commercial use is allowed; show "MiniMax-Music3" in a product that uses it, and get MiniMax\'s written permission above $20M a year.',
    models: ['music3_dit', 'music3_te', 'music3_vae']
  },
  {
    id: 'ace',
    label: 'ACE-Step 1.5 Turbo',
    short: 'Quick',
    maxSeconds: 600,
    note: 'A song in seconds. Good for drafts and background music.',
    licence: 'ACE-Step 1.5: Apache-2.0.',
    models: ['ace15']
  }
]
export const ACE_KEYS = ['C', 'C#', 'Db', 'D', 'D#', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'G#', 'Ab', 'A', 'A#', 'Bb', 'B'].flatMap((k) => [`${k} major`, `${k} minor`])
export const MUSIC_DEFAULTS = { engine: 'minimax', seconds: 60, bpm: 120, key: 'C major', timesignature: '4', language: 'en' }
const INSTRUMENTAL = '[Instrumental]'
// Below this much VRAM, MiniMax's audio is decoded in tiles (a little slower, a small risk of seams).
const TILED_BELOW_GB = 20

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
const now = () => new Date().toISOString()
const slug = (s) => (s || 'song').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'song'
const base = (n) => n.replace(/\\/g, '/').split('/').pop()

// MiniMax Music 3, as Comfy-Org's "Text to Music" template wires it: the text encoder plans the song and
// says how long it is, the DiT draws it in 30 steps at cfg 1.7, the DAV decodes 32 kHz stereo.
export function minimaxGraph({ dit, te, vae, caption, lyrics, seconds, seed, tiled, prefix }) {
  return {
    1: { class_type: 'UNETLoader', inputs: { unet_name: dit, weight_dtype: 'default' } },
    2: { class_type: 'CLIPLoader', inputs: { clip_name: te, type: 'minimax', device: 'default' } },
    3: { class_type: 'VAELoader', inputs: { vae_name: vae } },
    4: { class_type: 'MiniMaxMusic3TextEncode', inputs: { clip: ['2', 0], caption, lyrics, seed, max_duration: seconds, cfg_scale: 1.7, top_k: 50 } },
    5: { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['4', 0] } },
    6: { class_type: 'EmptyMiniMaxMusic3LatentAudio', inputs: { seconds: ['4', 1], batch_size: 1 } },
    7: { class_type: 'KSampler', inputs: { model: ['1', 0], positive: ['4', 0], negative: ['5', 0], latent_image: ['6', 0], seed, steps: 30, cfg: 1.7, sampler_name: 'euler', scheduler: 'simple', denoise: 1 } },
    8: tiled ? { class_type: 'VAEDecodeAudioTiled', inputs: { samples: ['7', 0], vae: ['3', 0], tile_size: 1536, overlap: 64 } } : { class_type: 'VAEDecodeAudio', inputs: { samples: ['7', 0], vae: ['3', 0] } },
    9: { class_type: 'SaveAudio', inputs: { audio: ['8', 0], filename_prefix: prefix } }
  }
}

// ACE-Step 1.5 Turbo, as Comfy-Org's AIO template wires it: 8 steps at cfg 1 with shift 3. Its text encoder
// also writes audio codes first (the slow, better path the template turns on).
export function aceGraph({ ckpt, tags, lyrics, seconds, seed, bpm, key, timesignature, language, prefix }) {
  return {
    1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: ckpt } },
    2: { class_type: 'ModelSamplingAuraFlow', inputs: { model: ['1', 0], shift: 3 } },
    3: { class_type: 'TextEncodeAceStepAudio1.5', inputs: { clip: ['1', 1], tags, lyrics, seed, bpm, duration: seconds, timesignature, language, keyscale: key, generate_audio_codes: true, cfg_scale: 2, temperature: 0.85, top_p: 0.9, top_k: 0, min_p: 0 } },
    4: { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['3', 0] } },
    5: { class_type: 'EmptyAceStep1.5LatentAudio', inputs: { seconds, batch_size: 1 } },
    6: { class_type: 'KSampler', inputs: { model: ['2', 0], positive: ['3', 0], negative: ['4', 0], latent_image: ['5', 0], seed, steps: 8, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: 1 } },
    7: { class_type: 'VAEDecodeAudio', inputs: { samples: ['6', 0], vae: ['1', 2] } },
    8: { class_type: 'SaveAudio', inputs: { audio: ['7', 0], filename_prefix: prefix } }
  }
}

export class Music {
  constructor({ studio, dataDir, probe }) {
    this.studio = studio
    this.dir = path.join(dataDir, 'music')
    this.probe = probe
  }

  songsFile = () => path.join(this.dir, 'songs.json')
  all = () => readJson(this.songsFile(), [])
  saveAll = (list) => writeJson(this.songsFile(), list)

  // Each engine's models, found on this ComfyUI by file name (the manifest's name or one of its alts).
  async status() {
    if (this.studio.comfy.remote) return { remote: true, ready: false, engines: MUSIC_ENGINES.map((e) => ({ ...e, ready: false, missing: [] })) }
    let info, stats
    try {
      ;[info, stats] = await Promise.all([this.studio.comfy.objectInfo(), this.studio.comfy.systemStats()])
    } catch (err) {
      return { error: err.message, ready: false, engines: MUSIC_ENGINES.map((e) => ({ ...e, ready: false, missing: [] })) }
    }
    const gpu = findGpu(stats.devices)
    const engines = MUSIC_ENGINES.map((e) => {
      const nodes = e.id === 'minimax' ? ['MiniMaxMusic3TextEncode', 'EmptyMiniMaxMusic3LatentAudio'] : ['TextEncodeAceStepAudio1.5', 'EmptyAceStep1.5LatentAudio']
      const files = {}
      const missing = []
      for (const id of e.models) {
        const m = this.studio.manifest.models.find((x) => x.id === id)
        const [cls, input] = m.loader.split('.')
        const names = [m.match, ...(m.alt || [])]
        const opts = comboOptions(info, cls, input) || []
        // the first name in the manifest's order wins, so fp16 is used over int8 when both are there
        const found = names.map((n) => opts.find((o) => base(o) === n)).find(Boolean)
        if (found) files[id] = found
        else missing.push({ id, label: m.label, size: m.size, folder: m.folder })
      }
      const missingNodes = nodes.filter((n) => !info[n])
      return { ...e, ready: !missing.length && !missingNodes.length, missing, missingNodes, files }
    })
    return { ready: engines.some((e) => e.ready), engines, vramGb: gpu ? Math.round(gpuMemoryGb(gpu)) : null }
  }

  // Queues one song. Returns the song record; it fills in as the job runs (see list()).
  async create({ engine = MUSIC_DEFAULTS.engine, name, caption = '', lyrics = '', instrumental = false, seconds = MUSIC_DEFAULTS.seconds, seed = null, bpm = MUSIC_DEFAULTS.bpm, key = MUSIC_DEFAULTS.key, timesignature = MUSIC_DEFAULTS.timesignature, language = MUSIC_DEFAULTS.language } = {}) {
    const spec = MUSIC_ENGINES.find((e) => e.id === engine)
    if (!spec) throw new Error(`Unknown music engine "${engine}". Use ${MUSIC_ENGINES.map((e) => e.id).join(' or ')}.`)
    const style = String(caption || '').trim()
    if (!style) throw new Error('Describe the music first: genre, mood, instruments, voice, tempo.')
    let words = String(lyrics || '').trim()
    if (instrumental || !words) words = INSTRUMENTAL
    const secs = Math.round(Number(seconds) || MUSIC_DEFAULTS.seconds)
    if (secs < 5 || secs > spec.maxSeconds) throw new Error(`${spec.label} makes 5 to ${spec.maxSeconds} seconds.`)
    if (engine === 'ace') {
      if (!ACE_KEYS.includes(key)) throw new Error(`Key must be one of: ${ACE_KEYS.join(', ')}.`)
      if (!['2', '3', '4', '6'].includes(String(timesignature))) throw new Error('Time signature is 2, 3, 4 or 6 beats.')
      if (!(bpm >= 30 && bpm <= 300)) throw new Error('Tempo is 30 to 300 BPM.')
    }
    const st = await this.status()
    if (st.remote) throw new Error('Music runs on this PC\'s ComfyUI. Switch to "This PC" in Settings to make music.')
    const eng = st.engines.find((e) => e.id === engine)
    if (eng.missingNodes?.length) throw new Error(`This ComfyUI has no ${eng.missingNodes.join(', ')} node. Update ComfyUI (0.33 or newer has it).`)
    if (eng.missing.length) throw new Error(`${spec.label} needs ${eng.missing.map((m) => m.label).join(', ')}. Download ${eng.missing.length === 1 ? 'it' : 'them'} on the Music page.`)

    const id = randomUUID().slice(0, 8)
    const s = seed == null || seed === '' ? Math.floor(Math.random() * 2 ** 31) : Math.floor(Number(seed))
    const title = String(name || '').trim() || style.split(/[.,\n]/)[0].slice(0, 48)
    const prefix = `iv_studio/music/${slug(title)}_${id}`
    const graph =
      engine === 'minimax'
        ? minimaxGraph({ dit: eng.files.music3_dit, te: eng.files.music3_te, vae: eng.files.music3_vae, caption: style, lyrics: words, seconds: secs, seed: s, tiled: (st.vramGb || 24) < TILED_BELOW_GB, prefix })
        : aceGraph({ ckpt: eng.files.ace15, tags: style, lyrics: words, seconds: secs, seed: s, bpm: Math.round(bpm), key, timesignature: String(timesignature), language, prefix })
    const project = this.studio.createProject(`Music · ${title}`, null, null, 'music')
    const job = await this.studio.submitGraph({ kind: 'music', graph, projectId: project.id, name: title, plan: { music: { songId: id }, request: { prompt: style } } })
    const song = { id, name: title, engine, caption: style, lyrics: words === INSTRUMENTAL ? '' : words, instrumental: words === INSTRUMENTAL, seconds: secs, seed: s, ...(engine === 'ace' && { bpm: Math.round(bpm), key, timesignature: String(timesignature), language }), projectId: project.id, jobId: job.id, status: job.status, file: null, duration: null, createdAt: now() }
    this.saveAll([song, ...this.all()])
    return song
  }

  // A song, brought up to date: a finished job's audio is copied into music/ once.
  async refresh(song) {
    if (['success', 'error', 'cancelled'].includes(song.status) && (song.status !== 'success' || song.file)) return song
    let job
    try {
      job = await this.studio.refreshJob(song.jobId)
    } catch (err) {
      return { ...song, note: err.message }
    }
    const next = { ...song, status: job.status, progress: job.progress, queuePosition: job.queuePosition, seconds_taken: job.seconds }
    if (job.status === 'error') next.error = job.error
    if (job.status === 'success') {
      const out = job.outputs?.find((o) => o.kind === 'audio')
      if (!out) Object.assign(next, { status: 'error', error: 'ComfyUI finished but saved no audio.' })
      else {
        const src = await this.studio.localCopy(out, path.join(this.dir, '_comfy'))
        const file = path.join(this.dir, `${slug(song.name)}_${song.id}${path.extname(src) || '.flac'}`)
        fs.mkdirSync(this.dir, { recursive: true })
        if (!fs.existsSync(file)) fs.copyFileSync(src, file)
        if (path.dirname(src) === path.join(this.dir, '_comfy')) fs.rmSync(src, { force: true })
        next.file = file
        next.duration = (await this.probe(file).catch(() => null))?.duration ?? null
        next.finishedAt = now()
      }
    }
    if (['success', 'error', 'cancelled'].includes(next.status)) {
      delete next.progress
      delete next.queuePosition
      this.saveAll(this.all().map((x) => (x.id === song.id ? next : x)))
    }
    return next
  }

  async list() {
    return Promise.all(this.all().map((s) => this.refresh(s)))
  }

  async get(id) {
    const s = this.all().find((x) => x.id === id)
    if (!s) throw new Error(`No song ${id}.`)
    return this.refresh(s)
  }

  rename(id, name) {
    if (!String(name || '').trim()) throw new Error('Give the song a name.')
    const list = this.all()
    const s = list.find((x) => x.id === id)
    if (!s) throw new Error(`No song ${id}.`)
    s.name = String(name).trim()
    this.saveAll(list)
    return s
  }

  async cancel(id) {
    const s = this.all().find((x) => x.id === id)
    if (!s) throw new Error(`No song ${id}.`)
    const r = await this.studio.cancelJob(s.jobId)
    return { ...(await this.refresh(s)), result: r.result }
  }

  // Removes the song and its copy in music/. A song still rendering is cancelled first. The file ComfyUI
  // saved in its own output folder stays.
  async delete(id) {
    const s = this.all().find((x) => x.id === id)
    if (!s) throw new Error(`No song ${id}.`)
    if (!['success', 'error', 'cancelled'].includes(s.status)) await this.studio.cancelJob(s.jobId).catch(() => {})
    if (s.file) fs.rmSync(s.file, { force: true })
    try {
      this.studio.deleteProject(s.projectId)
    } catch {}
    this.saveAll(this.all().filter((x) => x.id !== id))
    return { deleted: id }
  }
}
