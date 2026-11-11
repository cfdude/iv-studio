// The end card: off unless turned on, added to the export only, and really there in the exported file.
// Makes its own two-second test video with the bundled ffmpeg, so it needs no files passed in.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { END_CARD, Edits, editLength, withEndCard } from '../src/service/edits.js'

let failed = 0
const check = (name, ok, more = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !more ? '' : `: ${more}`}`)
  if (!ok) failed++
}

const bin = path.resolve('node_modules/ffmpeg-ffprobe-static')
const EXE = (name) => (process.platform === 'win32' ? `${name}.exe` : name)
const ffmpeg = path.join(bin, EXE('ffmpeg'))
const ffprobe = path.join(bin, EXE('ffprobe'))
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ivs-endcard-'))
const edits = new Edits({ dataDir, ffmpeg, ffprobe, fontFile: path.resolve('resources/fonts/BarlowCondensed-SemiBold.ttf') })

// a 2 s white test clip with a tone
const src = path.join(dataDir, 'white.mp4')
spawnSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=white:s=640x360:r=24:d=2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-shortest', '-pix_fmt', 'yuv420p', src])
check('the test clip was made', fs.existsSync(src))

const e = edits.create('End card test')
const m = await edits.addMedia(src)
const clips = [{ id: 'c1', track: 'V1', media: m.id, start: 0, in: 0, out: 2, fadeIn: 0, fadeOut: 0, volume: 1 }]
const save = (settings, tracks) => edits.save(e.id, { media: { [m.id]: m }, clips, settings: { format: '1080p', fps: 24, loudness: 'off', ...settings }, ...(tracks ? { tracks } : {}) })

// pure: what the export sees
save({})
check('off by default: the export is the timeline as it is', withEndCard(edits.get(e.id)) === undefined ? false : withEndCard(edits.get(e.id)).clips.length === 1)
save({ endCard: true })
const carded = withEndCard(edits.get(e.id))
const card = carded.clips.at(-1)
check('on: one title is added after the last clip', carded.clips.length === 2 && card.track === 'T1' && card.start === 2 && card.text.content === END_CARD.text)
check('…and it makes the export that much longer', Math.abs(editLength(carded) - (2 + END_CARD.seconds)) < 0.001)
check('…and it is never saved into the timeline', edits.get(e.id).clips.length === 1)
check('an empty edit gets no end card', withEndCard({ settings: { endCard: true }, clips: [] }).clips.length === 0)
check('the words have no em dash', !/—/.test(END_CARD.text))

const duration = (f) => Number(spawnSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).stdout.toString().trim())
// the brightest a frame gets (YMAX) and its average (YAVG), from ffmpeg's signalstats
const luma = (f, t) => {
  const r = spawnSync(ffmpeg, ['-v', 'error', '-ss', String(t), '-i', f, '-frames:v', '1', '-vf', 'signalstats,metadata=print:file=-', '-f', 'null', '-'])
  const s = r.stdout.toString()
  return { max: Number(/YMAX=(\d+)/.exec(s)?.[1]), avg: Number(/YAVG=([\d.]+)/.exec(s)?.[1]) }
}

// real exports
save({ endCard: false })
const plain = await edits.export(e.id, dataDir)
check('without the end card the export is the clip’s length', Math.abs(duration(plain) - 2) < 0.15, String(duration(plain)))

save({ endCard: true })
const withCard = await edits.export(e.id, dataDir)
const d = duration(withCard)
check('with it the export is 2.5 s longer', Math.abs(d - (2 + END_CARD.seconds)) < 0.15, String(d))
const during = luma(withCard, 1)
const mid = luma(withCard, 2 + END_CARD.seconds / 2)
check('the clip itself is untouched (still white)', during.avg > 200, JSON.stringify(during))
check('the card is words on black: mostly dark, with bright lettering', mid.avg < 40 && mid.max > 150, JSON.stringify(mid))

// the card shows even when the titles track is hidden
const tracks = edits.get(e.id).tracks || null
if (tracks?.some((t) => t.id === 'T1')) {
  save({ endCard: true }, tracks.map((t) => (t.id === 'T1' ? { ...t, hidden: true } : t)))
  const hidden = await edits.export(e.id, dataDir)
  const h = luma(hidden, 2 + END_CARD.seconds / 2)
  check('hiding the titles track doesn’t hide the end card', h.max > 150, JSON.stringify(h))
} else {
  const { DEFAULT_TRACKS } = await import('../src/service/timeline.js')
  save({ endCard: true }, DEFAULT_TRACKS.map((t) => (t.id === 'T1' ? { ...t, hidden: true } : t)))
  const hidden = await edits.export(e.id, dataDir)
  const h = luma(hidden, 2 + END_CARD.seconds / 2)
  check('hiding the titles track doesn’t hide the end card', h.max > 150, JSON.stringify(h))
}

fs.copyFileSync(withCard, path.join(os.tmpdir(), 'iv-end-card-sample.mp4'))
fs.rmSync(dataDir, { recursive: true, force: true })
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
