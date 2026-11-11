// Edits: IV Studio's own timeline editor. An edit is media (files on this PC) plus clips on tracks;
// the window plays it live, and export turns the whole timeline into one ffmpeg run.
//   tracks  T1 (titles), V1..Vn (video, a higher number drawn over a lower one), A1..An (audio); each can be
//           hidden, locked, muted or soloed (edit.tracks, see timeline.js tracksOf)
//   clip    { id, track, media, start, in, out, fadeIn, fadeOut, volume, muted, text? }
//   marker  { id, t, label, color }
//           start = where it sits on the timeline; in/out = the part of the media it plays (seconds).
// Video clips carry their own sound (mixed with the audio tracks) unless muted.
import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { probe } from './media.js'
import { audible, clipEnd, clipLength, shown, tracksOf, videoLayers } from './timeline.js'

export const FORMATS = {
  '1080p': { width: 1920, height: 1080, label: '1080p 16:9' },
  '4k': { width: 3840, height: 2160, label: '4K 16:9' },
  vertical: { width: 1080, height: 1920, label: 'Vertical 9:16' },
  square: { width: 1080, height: 1080, label: 'Square 1:1' }
}
// How loud an export comes out (settings.loudness; web when unset): measured over the whole film and brought to
// the target with ffmpeg's loudnorm in two passes. The short films came out near -19.5 LUFS, quiet on a phone.
export const LOUDNESS = {
  web: { label: 'Online', lufs: -14, peak: -1.5 },
  tv: { label: 'TV', lufs: -23, peak: -1 },
  off: { label: 'As mixed' }
}

const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}
const now = () => new Date().toISOString()

// FFmpeg 7 replaced -filter_complex_script with -/filter_complex (read the option from a file), and FFmpeg 8 dropped
// the old one; Windows and Linux bundle 6.1.2, the Mac app 9.0.2. Asked once per ffmpeg; old form when unsure.
const scriptFlags = new Map()
export function filterScriptFlag(ffmpeg) {
  if (!scriptFlags.has(ffmpeg)) {
    let major = 0
    try {
      major = Number(/ffmpeg version n?(\d+)\./i.exec(spawnSync(ffmpeg, ['-hide_banner', '-version'], { encoding: 'utf8', windowsHide: true }).stdout || '')?.[1] || 0)
    } catch {}
    scriptFlags.set(ffmpeg, major >= 7 ? '-/filter_complex' : '-filter_complex_script')
  }
  return scriptFlags.get(ffmpeg)
}

export const editLength = (e) => e.clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0)

// The end card (settings.endCard, off unless the person turns it on in the editor): "Made with IV Studio" on black
// for a moment after the last clip, as one more title. It is added to the export only, never saved into the
// timeline, and it shows even when the titles track is hidden.
export const END_CARD = { text: 'Made with IV Studio', seconds: 2.5, fade: 0.4, size: 7 }
export function withEndCard(e) {
  if (!e.settings?.endCard || !e.clips.length) return e
  const start = editLength(e)
  const card = { id: 'end-card', track: 'T1', media: null, start, in: 0, out: END_CARD.seconds, fadeIn: END_CARD.fade, fadeOut: END_CARD.fade, endCard: true, text: { content: END_CARD.text, size: END_CARD.size, position: 'center', box: false } }
  return { ...e, clips: [...e.clips, card] }
}

// An edit's picture for the list: the first video or picture on a video track (earliest first), if its file is there.
function coverOf(e) {
  const clip = [...(e.clips || [])].filter((c) => String(c.track || '').startsWith('V') && e.media?.[c.media]).sort((a, b) => a.start - b.start).find((c) => ['video', 'picture', 'image'].includes(e.media[c.media].kind) || /\.(mp4|mov|webm|m4v|png|jpe?g|webp)$/i.test(e.media[c.media].path || ''))
  const m = clip && e.media[clip.media]
  if (!m?.path || !fs.existsSync(m.path)) return null
  return { path: m.path, kind: /\.(png|jpe?g|webp)$/i.test(m.path) ? 'picture' : 'video', at: clip.in || 0 }
}

// The title font is Latin only: words in another script (a Chinese caption a rebuild brought in) are drawn with
// one of the system's fonts for that script, or ffmpeg prints every character as "?". The first one on this PC
// wins; none found keeps the Latin font.
const SCRIPT_FONTS = {
  hangul: ['C:/Windows/Fonts/malgunbd.ttf', 'C:/Windows/Fonts/malgun.ttf', '/System/Library/Fonts/AppleSDGothicNeo.ttc', '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc', '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'],
  cjk: ['C:/Windows/Fonts/msyhbd.ttc', 'C:/Windows/Fonts/msyh.ttc', 'C:/Windows/Fonts/YuGothB.ttc', 'C:/Windows/Fonts/simhei.ttf', '/System/Library/Fonts/PingFang.ttc', '/System/Library/Fonts/Hiragino Sans GB.ttc', '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc', '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc']
}
export function titleFont(text, latinFont, exists = fs.existsSync) {
  const script = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/.test(text) ? 'hangul' : /[\u2e80-\u2fdf\u3000-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(text) ? 'cjk' : null
  return (script && SCRIPT_FONTS[script].find((f) => exists(f))) || latinFont
}

export class Edits {
  constructor({ dataDir, ffmpeg, ffprobe, fontFile }) {
    this.dir = path.join(dataDir, 'edits')
    this.ffmpeg = ffmpeg
    this.ffprobe = ffprobe
    this.fontFile = fontFile
    this.exports = new Map() // edit id -> child process
    this.cancelled = new Set() // edit ids whose running export was asked to stop
  }

  file = (id) => path.join(this.dir, `${id}.json`)
  list() {
    if (!fs.existsSync(this.dir)) return []
    return fs
      .readdirSync(this.dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => readJson(path.join(this.dir, f), null))
      .filter(Boolean)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((e) => ({ id: e.id, name: e.name, clips: e.clips.length, seconds: +editLength(e).toFixed(1), format: e.settings.format, updatedAt: e.updatedAt, exports: e.exports?.length || 0, cover: coverOf(e) }))
  }
  get(id) {
    const e = readJson(this.file(id), null)
    if (!e) throw new Error(`No edit ${id}`)
    return e
  }
  write(e) {
    e.updatedAt = now()
    fs.mkdirSync(this.dir, { recursive: true })
    fs.writeFileSync(`${this.file(e.id)}.tmp`, JSON.stringify(e, null, 2))
    fs.renameSync(`${this.file(e.id)}.tmp`, this.file(e.id))
    return e
  }
  create(name = 'Untitled edit') {
    return this.write({ id: randomUUID().slice(0, 8), name, createdAt: now(), settings: { format: '1080p', fps: 24 }, media: {}, clips: [], exports: [] })
  }
  // The window saves the whole edit (it keeps its own undo history); media and settings come with it.
  save(id, { name, settings, media, clips, tracks, markers }) {
    const e = this.get(id)
    Object.assign(e, { name: name ?? e.name, settings: settings ?? e.settings, media: media ?? e.media, clips: clips ?? e.clips, tracks: tracks ?? e.tracks, markers: markers ?? e.markers ?? [] })
    return this.write(e)
  }
  remove(id) {
    fs.rmSync(this.file(id), { force: true })
    return true
  }

  probe = (file) => probe(this.ffprobe, file)

  async addMedia(file, source = { type: 'file' }) {
    if (!fs.existsSync(file)) throw new Error(`File not found: ${file}`)
    const info = await this.probe(file)
    return { id: randomUUID().slice(0, 8), name: path.basename(file), path: file, source, ...info }
  }

  // ---------- export ----------
  // ffmpeg arguments for the whole timeline: a black canvas, the video clips overlaid in track order
  // (V1 up to the top track) with their fades as alpha, titles drawn on top, every sound mixed with its fades.
  // Hidden tracks are left out of the picture, and muted (or not soloed) tracks out of the sound.
  exportArgs(e, outFile, textDir) {
    const fmt = FORMATS[e.settings.format] || FORMATS['1080p']
    const { width: W, height: H } = fmt
    const fps = e.settings.fps || 24
    const total = Math.max(0.1, editLength(e))
    const args = ['-y', '-hide_banner', '-loglevel', 'error', '-progress', 'pipe:1']
    const filters = [`color=c=black:s=${W}x${H}:r=${fps}:d=${total.toFixed(3)},format=yuv420p[base]`]
    const audio = []
    let input = 0
    const tracks = tracksOf(e)
    const order = Object.fromEntries(videoLayers(tracks).map((t, k) => [t.id, k]))
    const hears = (c) => !c.muted && audible(tracks, c.track)
    const videoClips = e.clips.filter((c) => order[c.track] !== undefined && e.media[c.media] && (shown(tracks, c.track) || (e.media[c.media].hasAudio && hears(c)))).sort((a, b) => order[a.track] - order[b.track] || a.start - b.start)
    let last = 'base'
    // A shown clip's sound is read from a second, sound-only input of its file. From the same input, the mix
    // (which wants every sound from the start) made ffmpeg decode each clip's pictures long before their turn and
    // hold them all: a 26 s film of four full-sound shots took over 30 minutes instead of 5 seconds.
    const sounds = []
    for (const c of videoClips) {
      const m = e.media[c.media]
      const len = clipLength(c)
      if (m.kind === 'image') args.push('-loop', '1', '-t', len.toFixed(3), '-i', m.path)
      // a cut-out's see-through background survives only ffmpeg's libvpx decoder
      else if (m.alpha) args.push('-c:v', m.codec === 'vp8' ? 'libvpx' : 'libvpx-vp9', '-i', m.path)
      else args.push('-i', m.path)
      const i = input++
      if (m.kind === 'video' && m.hasAudio && hears(c)) shown(tracks, c.track) ? sounds.push(c) : audio.push({ i, c })
      if (!shown(tracks, c.track)) continue
      const fades = [c.fadeIn > 0 && `fade=t=in:st=0:d=${c.fadeIn}:alpha=1`, c.fadeOut > 0 && `fade=t=out:st=${Math.max(0, len - c.fadeOut).toFixed(3)}:d=${c.fadeOut}:alpha=1`].filter(Boolean)
      const trim = m.kind === 'image' ? '' : `trim=start=${c.in.toFixed(3)}:end=${c.out.toFixed(3)},`
      filters.push(`[${i}:v]${trim}setpts=PTS-STARTPTS,fps=${fps},scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black@0,format=yuva420p${fades.length ? ',' + fades.join(',') : ''},setpts=PTS+${c.start.toFixed(3)}/TB[v${i}]`)
      filters.push(`[${last}][v${i}]overlay=eof_action=pass:enable='between(t,${c.start.toFixed(3)},${clipEnd(c).toFixed(3)})'[o${i}]`)
      last = `o${i}`
    }
    for (const c of sounds) {
      args.push('-vn', '-i', e.media[c.media].path)
      audio.push({ i: input++, c })
    }
    for (const c of e.clips.filter((x) => x.track[0] === 'A' && e.media[x.media] && hears(x))) {
      args.push('-i', e.media[c.media].path)
      audio.push({ i: input++, c })
    }
    // Titles: each text goes through a file, so no quoting of the user's words is needed.
    const titles = e.clips.filter((c) => c.track === 'T1' && c.text?.content && (c.endCard || shown(tracks, 'T1')))
    titles.forEach((c, k) => {
      const tf = path.join(textDir, `title${k}.txt`)
      fs.writeFileSync(tf, c.text.content)
      const size = Math.round((c.text.size || 8) * H / 100)
      const y = { top: `h*0.08`, center: `(h-text_h)/2`, bottom: `h*0.92-text_h` }[c.text.position || 'bottom']
      const a = `if(lt(t-${c.start},${c.fadeIn || 0.001}),(t-${c.start})/${c.fadeIn || 0.001},if(gt(t,${clipEnd(c) - (c.fadeOut || 0.001)}),(${clipEnd(c)}-t)/${c.fadeOut || 0.001},1))`
      const font = titleFont(c.text.content, this.fontFile).replace(/\\/g, '/').replace(':', '\\:')
      const tfile = tf.replace(/\\/g, '/').replace(':', '\\:')
      const box = c.text.box ? `:box=1:boxcolor=black@0.55:boxborderw=${Math.round(size * 0.35)}` : ''
      filters.push(`[${last}]drawtext=fontfile='${font}':textfile='${tfile}':fontsize=${size}:fontcolor=${c.text.color || '#f4ecdc'}:x=(w-text_w)/2:y=${y}${box}:alpha='${a}':enable='between(t,${c.start.toFixed(3)},${clipEnd(c).toFixed(3)})'[t${k}]`)
      last = `t${k}`
    })
    filters.push(`[${last}]null[vout]`)
    if (audio.length) {
      for (const { i, c } of audio) {
        const len = clipLength(c)
        const fades = [c.fadeIn > 0 && `afade=t=in:st=0:d=${c.fadeIn}`, c.fadeOut > 0 && `afade=t=out:st=${Math.max(0, len - c.fadeOut).toFixed(3)}:d=${c.fadeOut}`].filter(Boolean)
        const ms = Math.round(c.start * 1000)
        filters.push(`[${i}:a]atrim=start=${c.in.toFixed(3)}:end=${c.out.toFixed(3)},asetpts=PTS-STARTPTS,volume=${(c.volume ?? 1).toFixed(2)}${fades.length ? ',' + fades.join(',') : ''},adelay=${ms}|${ms},aformat=sample_rates=48000:channel_layouts=stereo[a${i}]`)
      }
      filters.push(`${audio.map(({ i }) => `[a${i}]`).join('')}amix=inputs=${audio.length}:normalize=0:duration=longest,apad,atrim=end=${total.toFixed(3)}[aout]`)
    } else {
      filters.push(`anullsrc=r=48000:cl=stereo,atrim=end=${total.toFixed(3)}[aout]`)
    }
    const script = path.join(textDir, 'graph.txt')
    fs.writeFileSync(script, filters.join(';\n'))
    args.push(filterScriptFlag(this.ffmpeg), script, '-map', '[vout]', '-map', '[aout]', '-t', total.toFixed(3), '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(fps), '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', outFile)
    return { args, total }
  }

  // Renders the edit to outDir; onProgress(0..1). Resolves with the file path.
  async export(id, outDir, onProgress) {
    const e = this.get(id)
    if (!e.clips.length) throw new Error('The timeline is empty.')
    if (this.exports.has(id)) throw new Error('This edit is already exporting.')
    const missing = Object.values(e.media).filter((m) => e.clips.some((c) => c.media === m.id) && !fs.existsSync(m.path))
    if (missing.length) throw new Error(`Missing files: ${missing.map((m) => m.name).join(', ')}`)
    fs.mkdirSync(outDir, { recursive: true })
    const base = `${e.name.replace(/\s*·\s*/g, ' - ').replace(/[^\w -]+/g, '').replace(/\s+/g, ' ').trim() || 'edit'}_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}`
    const outFile = path.join(outDir, `${base}.mp4`)
    const work = path.join(this.dir, 'work', id)
    fs.rmSync(work, { recursive: true, force: true })
    fs.mkdirSync(work, { recursive: true })
    const { args, total } = this.exportArgs(withEndCard(e), outFile, work)
    const t0 = Date.now()
    await new Promise((resolve, reject) => {
      const p = spawn(this.ffmpeg, args, { windowsHide: true })
      this.exports.set(id, p)
      let err = ''
      p.stdout.on('data', (d) => {
        const us = String(d).match(/out_time_us=(\d+)/g)?.pop()
        if (us) onProgress?.(Math.min(1, Number(us.split('=')[1]) / 1e6 / total))
      })
      p.stderr.on('data', (d) => (err += d))
      p.on('error', reject)
      p.on('close', (code, signal) => {
        this.exports.delete(id)
        // ffmpeg catches the stop signal and exits with a code of its own, so a cancel is remembered here
        const asked = this.cancelled.delete(id)
        if (code === 0) resolve()
        else reject(new Error(asked || signal || code === null ? 'Export cancelled.' : `Export failed: ${err.trim().split('\n').slice(-3).join(' ')}`))
      })
    })
    fs.rmSync(work, { recursive: true, force: true })
    const loudness = await this.normalize(outFile, e.settings.loudness || 'web')
    const fresh = this.get(id)
    fresh.exports = [...(fresh.exports || []), { file: outFile, at: now(), seconds: Math.round((Date.now() - t0) / 1000), format: e.settings.format, fps: e.settings.fps, loudness }]
    this.write(fresh)
    return outFile
  }

  // Brings an exported film's sound to a loudness target (LOUDNESS) in place: measure the whole film, then one gain
  // with a peak limiter under the ceiling, and measure again (a second, smaller correction when the limiter took
  // too much). loudnorm's own second pass stopped at -16.1 on a -16.9 film whose peaks sat near the ceiling. The
  // picture is copied. Returns { target, before, after } in LUFS, or null when off or silent.
  async normalize(file, preset = 'web') {
    const t = LOUDNESS[preset]
    if (!t?.lufs) return null
    const measure = async (f) => {
      const err = await this.runErr(['-hide_banner', '-nostats', '-i', f, '-vn', '-af', `loudnorm=I=${t.lufs}:TP=${t.peak}:print_format=json`, '-f', 'null', '-'])
      return Number(JSON.parse(err.slice(err.lastIndexOf('{'), err.lastIndexOf('}') + 1)).input_i)
    }
    const before = await measure(file)
    if (!Number.isFinite(before) || before < -70) return null // no sound to normalize
    const limit = Math.pow(10, (t.peak - 0.5) / 20).toFixed(4) // sample peaks a little under the true-peak ceiling
    const tmp = file.replace(/\.mp4$/i, '.loud.mp4')
    if (Math.abs(t.lufs - before) <= 0.4) return { target: t.lufs, before: +before.toFixed(1), after: +before.toFixed(1) }
    // A film whose loud parts already touch the ceiling (Last Watch: -16.6 LUFS, peaks at -0.1) can't reach the
    // target without crushing them: more gain only goes into the limiter (+5.5 dB gave -14.9). So a second pass
    // tries a little more gain, and is kept only if it got at least 0.3 LU louder for it.
    const pass = async (gain, out) => {
      await this.run(['-y', '-hide_banner', '-loglevel', 'error', '-i', file, '-map', '0', '-c:v', 'copy', '-af', `volume=${gain.toFixed(2)}dB,alimiter=limit=${limit}:level=false:attack=5:release=60,aresample=48000`, '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out])
      return measure(out)
    }
    const gain = t.lufs - before
    let now = await pass(gain, tmp)
    if (t.lufs - now > 0.4) {
      const more = tmp.replace(/\.loud\.mp4$/, '.louder.mp4')
      const again = await pass(gain + Math.min(3, t.lufs - now), more)
      if (again - now >= 0.3) {
        fs.renameSync(more, tmp)
        now = again
      } else fs.rmSync(more, { force: true })
    }
    fs.renameSync(tmp, file)
    return { target: t.lufs, before: +before.toFixed(1), after: +now.toFixed(1) }
  }
  // ffmpeg's report (stderr), for filters that print what they measured.
  runErr(args) {
    return new Promise((resolve, reject) => {
      const p = spawn(this.ffmpeg, args, { windowsHide: true })
      let err = ''
      p.stderr.on('data', (d) => (err += d))
      p.on('error', reject)
      p.on('close', (code) => (code === 0 ? resolve(err) : reject(new Error(err.trim().split('\n').pop() || `ffmpeg exited ${code}`))))
    })
  }

  cancelExport(id) {
    const p = this.exports.get(id)
    if (p) {
      this.cancelled.add(id)
      p.kill()
    }
    return !!p
  }

  // ---------- what the timeline draws on clips (cached in edits/cache, keyed by file, size and date) ----------
  cachePath(file, ext) {
    const st = fs.statSync(file)
    const key = createHash('sha1').update(`${file}|${st.size}|${st.mtimeMs}`).digest('hex').slice(0, 16)
    fs.mkdirSync(path.join(this.dir, 'cache'), { recursive: true })
    return path.join(this.dir, 'cache', `${key}.${ext}`)
  }
  run(args) {
    return new Promise((resolve, reject) => {
      const p = spawn(this.ffmpeg, args, { windowsHide: true })
      const out = []
      let err = ''
      p.stdout.on('data', (d) => out.push(d))
      p.stderr.on('data', (d) => (err += d))
      p.on('error', reject)
      p.on('close', (code) => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(err.trim().split('\n').pop() || `ffmpeg exited ${code}`))))
    })
  }
  // A filmstrip: one row of small frames, one every `every` seconds of the video.
  async filmstrip(file, duration) {
    const W = 96
    const H = 54
    const every = Math.max(0.5, (duration || 4) / 120)
    const count = Math.max(1, Math.floor((duration || 4) / every))
    const jpg = this.cachePath(file, `strip${count}.jpg`)
    if (!fs.existsSync(jpg)) {
      await this.run(['-v', 'error', '-y', '-i', file, '-an', '-vf', `fps=1/${every},scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,tile=${count}x1`, '-frames:v', '1', '-q:v', '6', `${jpg}.tmp.jpg`])
      fs.renameSync(`${jpg}.tmp.jpg`, jpg)
    }
    return { file: jpg, every, count, w: W, h: H }
  }
  // Waveform peaks: the loudest sample in every 10 ms, 0..255.
  async peaks(file) {
    const cached = this.cachePath(file, 'peaks')
    if (fs.existsSync(cached)) return { rate: 100, peaks: [...fs.readFileSync(cached)] }
    const pcm = await this.run(['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '8000', '-f', 's16le', 'pipe:1'])
    const n = Math.floor(pcm.length / 2)
    const out = Buffer.alloc(Math.ceil(n / 80))
    for (let k = 0; k < out.length; k++) {
      let m = 0
      for (let j = k * 80, end = Math.min(n, j + 80); j < end; j++) m = Math.max(m, Math.abs(pcm.readInt16LE(j * 2)))
      out[k] = Math.min(255, Math.round(Math.sqrt(m / 32768) * 255))
    }
    fs.writeFileSync(cached, out)
    return { rate: 100, peaks: [...out] }
  }
}
