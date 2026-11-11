// Voices: a voice for each character, and lines spoken in it for H3 to lip-sync.
// IV Studio keeps every voice itself, as a short reference recording plus the words in it (the data
// folder's voices/<id>/), so a voice belongs to the person, not to an engine. The speaking is done by IV
// Studio's own voice engine (./voiceengine.js): VoxCPM2 (Apache-2.0) designs, clones and speaks, and Whisper
// (MIT) reads the words in a recording. Voices made earlier with VoiceStudio keep working as they are.
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { VOICE_SETUP, VoiceEngine } from './voiceengine.js'

export const VOICE_ENGINES = [{ id: 'voxcpm2', label: 'VoxCPM2', design: true, maxRef: 30, note: 'Designs voices from a description and clones them. Apache-2.0.' }]
// A reference longer than this only slows every line down.
const REF_SECONDS = 20
// After this long without a line, the engine stops and gives the GPU back (a render on this PC stops it at
// once). Loading VoxCPM2 again takes a little while, so not too eagerly.
const IDLE_RELEASE_MS = 10 * 60 * 1000

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
const hash = (...parts) => createHash('sha1').update(parts.join('\u0000')).digest('hex').slice(0, 12)
const WAV_SECONDS = (buf) => {
  // RIFF header: byte rate at 28, the data chunk's size follows the "data" tag
  const rate = buf.readUInt32LE(28)
  const at = buf.indexOf('data', 12)
  return rate && at > 0 ? +(buf.readUInt32LE(at + 4) / rate).toFixed(2) : null
}

export class Voices {
  // comfy: this PC's ComfyUI. When its queue is empty, it is asked to unload its models before the voice
  // model loads; VoxCPM2 next to a full GPU loads several times slower.
  // cloud: () => the voice engine on the person's own cloud (cloudvoice.js) while IV Studio renders there, else
  // null. It has the same calls as the engine on this PC.
  constructor({ dataDir, resourcesDir, ffmpeg, onLog, comfy = null, cloud = null }) {
    this.dir = path.join(dataDir, 'voices')
    this.ffmpeg = ffmpeg
    this.comfy = comfy
    this.cloud = cloud
    this.engine = new VoiceEngine({ dataDir, resourcesDir, onLog, beforeLoad: () => this.makeRoom() })
    this.idle = null
  }
  // the engine voices use now: the cloud's while rendering there, else this PC's
  eng() {
    return this.cloud?.() || this.engine
  }

  // ---------- the engine ----------
  // ready: set up and able to speak (the models load on the first line).
  status() {
    const e = this.eng().status()
    return { ...e, ready: e.installed, engines: VOICE_ENGINES.map((x) => ({ ...x, available: e.installed })), setup: e.setup || VOICE_SETUP }
  }
  setup = () => this.eng().install().then(() => this.status())
  async makeRoom() {
    const comfy = typeof this.comfy === 'function' ? this.comfy() : this.comfy
    if (!comfy || comfy.remote) return
    const q = await comfy.queue()
    if (!q.queue_running.length && !q.queue_pending.length) await comfy.freeMemory()
  }

  // Stops the engine so the GPU's memory goes back to ComfyUI.
  async release() {
    clearTimeout(this.idle)
    this.engine.release()
    this.cloud?.()?.release()
  }
  releaseSoon() {
    clearTimeout(this.idle)
    this.idle = setTimeout(() => this.release(), IDLE_RELEASE_MS)
    this.idle.unref?.()
  }

  // The words in a recording. Any format: it goes to the engine as a 16 kHz WAV.
  async transcribe(file) {
    const wav = path.join(os.tmpdir(), `ivs-asr-${randomUUID().slice(0, 8)}.wav`)
    try {
      await this.ffmpegTo(file, wav, ['-ac', '1', '-ar', '16000'])
      const out = await this.eng().call('transcribe', { file: wav })
      this.releaseSoon()
      return String(out.text || '').trim()
    } finally {
      fs.rmSync(wav, { force: true })
    }
  }

  // ---------- the library ----------
  folder = (id) => path.join(this.dir, id)
  list() {
    if (!fs.existsSync(this.dir)) return []
    return fs
      .readdirSync(this.dir)
      .map((id) => readJson(path.join(this.dir, id, 'voice.json'), null))
      .filter(Boolean)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }
  get(id) {
    const v = readJson(path.join(this.folder(id), 'voice.json'), null)
    if (!v) throw new Error(`No voice ${id}.`)
    return v
  }
  write(v) {
    writeJson(path.join(this.folder(v.id), 'voice.json'), v)
    return v
  }
  update(id, patch) {
    const v = this.get(id)
    for (const k of ['name', 'text', 'description', 'engine', 'seed']) if (patch[k] !== undefined) v[k] = patch[k]
    return this.write(v)
  }
  delete(id) {
    this.get(id)
    fs.rmSync(this.folder(id), { recursive: true, force: true })
    writeJson(this.linesFile(), this.allLines().filter((l) => l.voiceId !== id))
    return { deleted: id }
  }

  // Up to `count` candidate voices from a written description (VoxCPM2 voice design), each saying `text`.
  // They wait in voices/_drafts until one is kept with create().
  async design({ description, text, seed = 1, count = 3 }) {
    if (!String(description || '').trim()) throw new Error('Describe the voice first: age, accent, pitch, manner.')
    const say = String(text || '').trim() || "Hi. So this is what I sound like when I'm just talking, nothing rehearsed. Give it a listen and tell me what you think."
    const dir = path.join(this.dir, '_drafts')
    fs.mkdirSync(dir, { recursive: true })
    const out = []
    for (let i = 0; i < Math.min(Math.max(1, count), 4); i++) {
      const s = Number(seed) + i * 7
      const file = path.join(dir, `${hash(description, say, s)}.wav`)
      if (!fs.existsSync(file)) {
        await this.eng().call('design', { text: say, description, out: file, seed: s })
      }
      out.push({ file, seed: s, text: say, description, duration: WAV_SECONDS(fs.readFileSync(file)) })
    }
    this.releaseSoon()
    return out
  }

  // A voice from a recording: a design candidate, or someone's own recording (clone). The recording is cut
  // to its first 20 seconds, mono, as the voice's reference. Words: given, or read from it by Whisper.
  async create({ name, file, text = '', description = '', seed = null, kind = 'clone', consent = false }) {
    if (!name?.trim()) throw new Error('Give the voice a name.')
    if (!file || !fs.existsSync(file)) throw new Error('Pick the recording first.')
    if (kind === 'clone' && !consent) throw new Error("Only clone your own voice, an invented one, or someone who agreed to it: tick the box to confirm.")
    const id = randomUUID().slice(0, 8)
    const ref = path.join(this.folder(id), 'reference.wav')
    fs.mkdirSync(path.dirname(ref), { recursive: true })
    await this.convert(file, ref)
    let words = String(text || '').trim()
    if (!words) words = await this.transcribe(ref).catch(() => '')
    return this.write({ id, name: name.trim(), kind, engine: 'voxcpm2', seed, description, text: words, reference: ref, source: file, duration: WAV_SECONDS(fs.readFileSync(ref)), createdAt: now() })
  }

  convert(from, to) {
    return this.ffmpegTo(from, to, ['-t', String(REF_SECONDS), '-ac', '1', '-ar', '24000'])
  }
  ffmpegTo(from, to, opts) {
    return new Promise((resolve, reject) => {
      const p = spawn(this.ffmpeg, ['-y', '-v', 'error', '-i', from, ...opts, '-vn', '-c:a', 'pcm_s16le', to], { windowsHide: true })
      let err = ''
      p.stderr.on('data', (d) => (err += d))
      p.on('error', reject)
      p.on('close', (code) => (code === 0 ? resolve(to) : reject(new Error(`Couldn't read that recording. ${err.trim().split('\n').pop() || ''}`))))
    })
  }

  // ---------- lines ----------
  linesFile = () => path.join(this.dir, 'lines.json')
  allLines() {
    return readJson(this.linesFile(), [])
  }
  lines(voiceId = null) {
    return this.allLines().filter((l) => !voiceId || l.voiceId === voiceId)
  }
  deleteLine(id) {
    const all = this.allLines()
    const line = all.find((l) => l.id === id)
    if (!line) throw new Error(`No line ${id}.`)
    writeJson(this.linesFile(), all.filter((l) => l.id !== id))
    if (!all.some((l) => l.id !== id && l.file === line.file)) fs.rmSync(line.file, { force: true })
    return { deleted: id }
  }

  // `text` said in a voice: a WAV in voices/lines, kept in the history. The same words, voice, engine and
  // seed give back the same file without asking the engine again.
  // keep: false says it without adding it to Lines (the chat reading its replies aloud); those files sit in
  // lines/_said and are replaced as new ones come.
  async speak({ voiceId, text, seed = null, keep = true }) {
    const say = String(text || '').trim()
    if (!say) throw new Error('Type the line first.')
    const v = this.get(voiceId)
    const eng = 'voxcpm2'
    const s = seed ?? v.seed ?? 41
    if (!v.text) this.update(v.id, { text: (v.text = await this.transcribe(v.reference)) })
    const file = path.join(this.dir, 'lines', keep ? '' : '_said', `${v.id}_${hash(say, eng, s, v.text)}.wav`)
    if (!keep) {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      // only the last few read-alouds are kept
      const old = fs.readdirSync(path.dirname(file)).map((f) => path.join(path.dirname(file), f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
      for (const f of old.slice(20)) fs.rmSync(f, { force: true })
    }
    if (!fs.existsSync(file)) await this.eng().call('speak', { text: say, out: file, ref_wav: v.reference, ref_text: v.text, seed: s })
    this.releaseSoon()
    if (!keep) return { voiceId: v.id, voice: v.name, text: say, file, duration: WAV_SECONDS(fs.readFileSync(file)) }
    const line = { id: randomUUID().slice(0, 8), voiceId: v.id, voice: v.name, text: say, engine: eng, seed: s, file, duration: WAV_SECONDS(fs.readFileSync(file)), createdAt: now() }
    writeJson(this.linesFile(), [line, ...this.allLines()].slice(0, 500))
    return line
  }
}
