// Captions for an edit ("put captions on", from IV Studio's chat or any agent): the voice engine's Whisper hears each
// clip with sound, and its words become short title lines at the bottom of the picture, spread over the clip by
// word count. Whisper here gives the words without timings, so this is clip by clip, which suits edits made of
// shots: a line said in a shot is captioned while that shot plays. Captions are titles on T1 marked caption: true,
// so doing it again replaces them and leaves the edit's other titles alone.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { applyOps, clipEnd, clipLength, tracksOf } from './timeline.js'

export const CAPTION_STYLE = { position: 'bottom', size: 6, box: true, color: '#ffffff' }
const round = (v) => Math.round(v * 1000) / 1000
// words that read wrong at the end of a caption line
const SMALL = new Set(['the', 'a', 'an', 'to', 'of', 'and', 'or', 'but', 'in', 'on', 'at', 'for', 'with', 'from', 'by', 'my', 'your', 'our', 'their', 'his', 'her', 'its', 'this', 'that', 'is', 'are', 'was', 'i', 'we', 'you', 'they', 'he', 'she', 'it', 'if', 'so', 'as'])

// Words over a clip's time: lines of up to maxWords words (split at sentence ends where it can), each on screen for a
// share of the time by its word count, at least minSeconds. [{ start, duration, content }]
export function captionLines(text, start, length, { maxWords = 7, minSeconds = 0.8 } = {}) {
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
  if (!words.length || !(length > 0)) return []
  const lines = []
  let line = []
  for (const w of words) {
    line.push(w)
    // a sentence end closes a line; so does a comma once the line has a few words; otherwise it closes at maxWords,
    // but never on a small word that belongs with the next ("the", "to"): that word starts the next line instead
    if (/[.!?…]["”’)]?$/.test(w) && line.length >= 2) {
      lines.push(line)
      line = []
    } else if (/[,;:]$/.test(w) && line.length >= Math.min(4, maxWords - 1)) {
      lines.push(line)
      line = []
    } else if (line.length >= maxWords) {
      const carry = []
      while (line.length > 2 && SMALL.has(line.at(-1).toLowerCase().replace(/[^a-z’']/g, ''))) carry.unshift(line.pop())
      lines.push(line)
      line = carry
    }
  }
  if (line.length) {
    // a last word or two joins the line before it rather than flashing up alone
    if (line.length < 3 && lines.length && lines.at(-1).length + line.length <= maxWords + 2) lines.at(-1).push(...line)
    else lines.push(line)
  }
  // more lines than fit at minSeconds each: merge neighbours until they do
  while (lines.length > 1 && lines.length * minSeconds > length) {
    const i = lines.reduce((best, l, k) => (k < lines.length - 1 && l.length + lines[k + 1].length < lines[best].length + lines[best + 1].length ? k : best), 0)
    lines.splice(i, 2, [...lines[i], ...lines[i + 1]])
  }
  const total = lines.reduce((s, l) => s + l.length, 0)
  let t = start
  return lines.map((l, i) => {
    const d = i === lines.length - 1 ? start + length - t : (length * l.length) / total
    const out = { start: round(t), duration: round(d), content: l.join(' ') }
    t += d
    return out
  })
}

// What Whisper says it hears in silence or room tone ("you", "Thank you."), when that's all it heard
const PHANTOMS = new Set(['you', 'thank you', 'thanks', 'thank you for watching', 'thanks for watching', 'bye', 'okay', 'oh', 'hmm', 'mm', 'uh', 'um', 'so'])
export const phantom = (text) => PHANTOMS.has(String(text || '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim())

// The loudest moment of a WAV in dB (ffmpeg volumedetect); -91 for digital silence.
export function peakDb(ffmpeg, wav) {
  return new Promise((resolve) => {
    const p = spawn(ffmpeg, ['-hide_banner', '-nostats', '-i', wav, '-af', 'volumedetect', '-f', 'null', '-'], { windowsHide: true })
    let log = ''
    p.stderr.on('data', (d) => (log += d))
    p.on('error', () => resolve(null))
    p.on('close', () => {
      const m = /max_volume:\s*(-?[\d.]+|-inf) dB/.exec(log)
      resolve(m ? (m[1] === '-inf' ? -91 : Number(m[1])) : null)
    })
  })
}
export const QUIET_DB = -45

// The clips to hear: on the given tracks (default every video track), not hidden or muted, with sound.
export function spokenClips(edit, tracks = null) {
  const list = tracksOf(edit)
  const pick = tracks?.length ? new Set(tracks) : new Set(list.filter((t) => t.kind === 'video' && t.id !== 'T1').map((t) => t.id))
  const quiet = new Set(list.filter((t) => t.hidden || t.muted).map((t) => t.id))
  return edit.clips
    .filter((c) => pick.has(c.track) && !quiet.has(c.track) && !c.muted && c.track !== 'T1')
    .filter((c) => {
      const m = edit.media[c.media]
      return m && m.kind !== 'image' && (m.kind === 'audio' || m.hasAudio !== false) && clipLength(c) >= 0.5
    })
    .sort((a, b) => a.start - b.start)
}

// One clip's sound as a 16 kHz mono WAV (the part the timeline plays).
export function clipAudio(ffmpeg, file, inS, lengthS) {
  const wav = path.join(os.tmpdir(), `ivs-cap-${randomUUID().slice(0, 8)}.wav`)
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, ['-v', 'error', '-y', '-ss', inS.toFixed(3), '-t', lengthS.toFixed(3), '-i', file, '-vn', '-ac', '1', '-ar', '16000', wav], { windowsHide: true })
    let err = ''
    p.stderr.on('data', (d) => (err += d))
    p.on('error', reject)
    p.on('close', (code) => (code === 0 && fs.existsSync(wav) ? resolve(wav) : reject(new Error(`Couldn't read the sound of ${path.basename(file)}: ${err.trim().split('\n').pop() || code}`))))
  })
}

// Captions the edit. hear(clip, media) → the words said in that clip ('' for none). Returns { clips, heard, lines }:
// the edit's clips afterwards (its old captions replaced), what was heard in each clip, and how many lines went on.
export async function captionEdit(edit, hear, { tracks = null, style = {}, maxWords = 7 } = {}) {
  const look = { ...CAPTION_STYLE, ...Object.fromEntries(Object.entries(style || {}).filter(([, v]) => v !== undefined)) }
  const heard = []
  const ops = []
  for (const c of spokenClips(edit, tracks)) {
    const said = String((await hear(c, edit.media[c.media])) || '').trim()
    // a lone "you" or "Thank you." is Whisper hearing silence, not a line
    const words = phantom(said) ? '' : said
    heard.push({ clip: c.id, start: round(c.start), end: round(clipEnd(c)), words })
    for (const l of captionLines(words, c.start, clipLength(c), { maxWords })) ops.push({ op: 'add_title', content: l.content, start: l.start, duration: l.duration, ...look, fadeIn: 0, fadeOut: 0 })
  }
  // the old captions go; the edit's own titles stay
  const kept = { ...edit, clips: edit.clips.filter((c) => !c.caption) }
  if (!ops.length) return { clips: kept.clips, heard, lines: 0 }
  const { clips, results } = applyOps(kept, ops)
  const added = new Set(results.map((r) => r.clip))
  return { clips: clips.map((c) => (added.has(c.id) ? { ...c, caption: true } : c)), heard, lines: ops.length }
}
