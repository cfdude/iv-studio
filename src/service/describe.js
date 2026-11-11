// Library search by what's in a file: while nothing renders, the local prompt writer (Ollama, or the OpenAI-compatible
// server when it can see pictures) looks at each new video or picture (three frames of a clip, a picture whole) and
// writes one sentence and a few tags, kept in the data folder (library-index.json). Library search matches them.
// It never runs while ComfyUI has work, stops at once when a render starts (Studio.beforeRender), does one file at a
// time, and can be turned off (settings.describeLibrary). Sound files are left out: their names and lines say enough.
// Idea from keys + Sam Wasserman's Imagination Studio; our own code.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const SYSTEM = `You label a person's own video and picture files so they can find them by searching.
You are shown frames from one file. Say what is in it: who or what is seen (by appearance, never guessing names), where, what happens, the light and look, and any text you can read.
Answer with JSON only: "sentence" is one plain sentence of at most 30 words; "tags" is 3 to 8 short lowercase search words (people, objects, place, action, mood, style).`
export const SCHEMA = { type: 'object', properties: { sentence: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } }, required: ['sentence', 'tags'] }
const VIDEO = /\.(mp4|mov|webm|mkv|m4v)$/i
const PICTURE = /\.(png|jpe?g|webp)$/i
export const kindOf = (file) => (VIDEO.test(file) ? 'video' : PICTURE.test(file) ? 'image' : null)
// Where in a clip the frames come from (fractions of its length).
export const FRAME_AT = [0.15, 0.5, 0.85]
// The answer, tidied: one sentence, up to 8 unique short tags.
export function tidy(a) {
  const sentence = String(a?.sentence || '').replace(/\s+/g, ' ').trim().slice(0, 300)
  const tags = [...new Set((Array.isArray(a?.tags) ? a.tags : []).map((t) => String(t).toLowerCase().replace(/[^\p{L}\p{N} '-]+/gu, '').trim()).filter((t) => t && t.length <= 30))].slice(0, 8)
  if (!sentence) throw new Error('The writer gave no description.')
  return { sentence, tags }
}
// What a search matches: the sentence and tags.
export const searchText = (about) => (about ? `${about.sentence} ${(about.tags || []).join(' ')}` : '')

export class Describer {
  // files(): [{ path, type }] in the Library, newest first; idle(): Promise<bool>, true when ComfyUI has nothing to do;
  // enabled(): the setting; writer(): Promise<{ name, vision }> (localWriterModel); chat: localChat
  constructor({ dataDir, ffmpeg, files, idle, enabled, writer, chat, onChange = () => {}, everyMs = 20000 }) {
    this.file = path.join(dataDir, 'library-index.json')
    Object.assign(this, { ffmpeg, files, idle, enabled, writer, chat, onChange, everyMs })
    this.index = this.read()
    this.running = null // { path, abort }
    this.timer = null
    this.error = null
    this.failed = new Map() // path -> tries, so one bad file isn't retried forever
  }
  read() {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8'))
    } catch {
      return {}
    }
  }
  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    fs.writeFileSync(`${this.file}.tmp`, JSON.stringify(this.index))
    fs.renameSync(`${this.file}.tmp`, this.file)
  }
  key = (p) => path.resolve(p).toLowerCase()
  // a file's description, while the file is the one that was described
  about(p) {
    const a = this.index[this.key(p)]
    if (!a) return null
    try {
      if (Math.round(fs.statSync(p).mtimeMs) !== a.mtime) return null
    } catch {
      return null
    }
    return { sentence: a.sentence, tags: a.tags }
  }
  waiting() {
    return this.files().filter((f) => kindOf(f.path) && !this.about(f.path) && (this.failed.get(this.key(f.path)) || 0) < 2 && fs.existsSync(f.path))
  }
  status() {
    const all = this.files().filter((f) => kindOf(f.path))
    return { enabled: !!this.enabled(), described: all.filter((f) => this.about(f.path)).length, total: all.length, running: this.running?.path || null, error: this.error }
  }
  start() {
    this.stop()
    const loop = async () => {
      await this.tick().catch(() => {})
      this.timer = setTimeout(loop, this.everyMs)
    }
    this.timer = setTimeout(loop, this.everyMs)
  }
  stop() {
    clearTimeout(this.timer)
    this.timer = null
    this.pause()
  }
  // a render is starting: stop the description in flight (it's done again later)
  pause() {
    this.running?.abort.abort()
  }

  // JPEG frames as base64: three from a clip, one from a picture, at most 448 px wide.
  frames(file) {
    const one = (args) =>
      new Promise((resolve) => {
        const p = spawn(this.ffmpeg, ['-hide_banner', '-v', 'error', ...args, '-vf', 'scale=448:-2', '-frames:v', '1', '-f', 'image2pipe', '-c:v', 'mjpeg', '-q:v', '4', '-'], { windowsHide: true })
        const out = []
        p.stdout.on('data', (d) => out.push(d))
        p.on('error', () => resolve(null))
        p.on('close', () => resolve(out.length ? Buffer.concat(out).toString('base64') : null))
      })
    if (kindOf(file) === 'image') return one(['-i', file]).then((f) => (f ? [f] : []))
    return this.duration(file).then(async (d) => (await Promise.all(FRAME_AT.map((at) => one(['-ss', (d * at).toFixed(2), '-i', file])))).filter(Boolean))
  }
  duration(file) {
    return new Promise((resolve) => {
      const p = spawn(this.ffmpeg, ['-hide_banner', '-i', file], { windowsHide: true })
      let err = ''
      p.stderr.on('data', (d) => (err += d))
      p.on('error', () => resolve(1))
      p.on('close', () => {
        const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(err)
        resolve(m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 1)
      })
    })
  }

  // One file, if it's quiet: returns what was described, or why nothing was.
  async tick() {
    if (this.running) return { skipped: 'busy' }
    if (!this.enabled()) return { skipped: 'off' }
    const next = this.waiting()[0]
    if (!next) return { skipped: 'done' }
    if (Date.now() < (this.restUntil || 0)) return { skipped: 'resting' }
    if (!(await this.idle())) return { skipped: 'rendering' }
    const abort = new AbortController()
    this.running = { path: next.path, abort }
    this.onChange(this.status())
    try {
      const w = await this.writer()
      if (!w.vision) throw new Error(`${w.name} can't see pictures, so the Library isn't described. Choose a vision model in Settings → Prompt writer.`)
      const images = await this.frames(next.path)
      if (!images.length) throw Object.assign(new Error('No frames could be read.'), { file: true })
      const answer = tidy(await this.chat({ model: w.name, system: SYSTEM, schema: SCHEMA, temperature: 0.2, ctx: 8192, maxTokens: 400, timeoutMs: 180000, signal: abort.signal, messages: [{ role: 'user', content: `${images.length > 1 ? `${images.length} frames from one video, in order.` : 'One picture.'} Describe it.`, images }] }))
      // the file may have moved on while it was looked at
      if (abort.signal.aborted) return { skipped: 'paused' }
      this.index[this.key(next.path)] = { file: next.path, mtime: Math.round(fs.statSync(next.path).mtimeMs), ...answer, model: w.name, at: new Date().toISOString() }
      this.save()
      this.error = null
      return { described: next.path, ...answer }
    } catch (err) {
      if (abort.signal.aborted) return { skipped: 'paused' }
      if (err.file) this.failed.set(this.key(next.path), (this.failed.get(this.key(next.path)) || 0) + 1)
      // the writer itself isn't there or can't see: try again in ten minutes, not every few seconds
      else this.restUntil = Date.now() + 10 * 60e3
      this.error = err.message
      return { error: err.message }
    } finally {
      this.running = null
      this.onChange(this.status())
    }
  }
}
