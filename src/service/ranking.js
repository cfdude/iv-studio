// Ranks a previews job's takes (agentY's output checks, done IV Studio's way): each take is scored on what can be
// measured and the best is marked, with the reasons in words.
//   words     every spoken line heard back (the voice engine's Whisper), when the prompt has lines; squared,
//             because a take that drops part of its line is rarely usable however good it looks
//   likeness  the picked character's face against its face picture (InsightFace through Shinobi's Python)
//   motion    no frozen stretches (ffmpeg freezedetect)
//   sharpness the least blurred of the takes (ffmpeg blurdetect), relative to the others
// Picks teach it: each part's weight moves towards what the person keeps choosing (rank-weights.json).
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

//   cuts      no cut away inside a take whose prompt asks for one shot (ffmpeg scdet; idea from keys + Sam
//             Wasserman's Imagination Studio, who found H3 cutting to an unasked close-up in 9 of 32 clips). It
//             catches hard cuts only: a slow dissolve changes too little from one frame to the next to stand out.
//   frames    in First / last frame mode, the take opens on the first picture and ends on the last
export const DEFAULT_WEIGHTS = { words: 4, likeness: 2, cuts: 2, frames: 1.5, motion: 1.5, sharpness: 1 }

// A hard cut: one frame far unlike the one before it, standing out from the frames around it. scores are scdet's
// per-frame scores (0..100); the first and last few frames are skipped (H3 settles in and out there).
// A flash or a burst (bright, fast effects) changes several frames in a row; a cut changes one, so the next biggest
// change nearby must be well below it (isolate).
export const CUT = { min: 6, ratio: 5, floor: 1.2, edge: 3, gap: 6, isolate: 2.5 }
// mafd: scdet's raw difference from the frame before. A one-frame flicker jumps away and straight back, so the frame
// after it differs as much again; a cut stays on its new picture, so the frame after it barely differs.
export function findCuts(scores, fps = 24, mafd = null) {
  const out = []
  for (let i = CUT.edge; i < scores.length - CUT.edge; i++) {
    const s = scores[i]
    if (!(s >= CUT.min)) continue
    if (mafd && mafd[i + 1] != null && mafd[i] && mafd[i + 1] >= 0.5 * mafd[i]) continue
    const near = [...scores.slice(Math.max(0, i - 6), i), ...scores.slice(i + 1, i + 7)].filter((x) => x != null).sort((a, b) => a - b)
    const median = near.length ? near[Math.floor(near.length / 2)] : 0
    if (s < CUT.ratio * Math.max(median, CUT.floor)) continue
    if (near.length && near[near.length - 1] * CUT.isolate > s) continue
    if (out.length && i - out[out.length - 1].frame < CUT.gap) {
      if (s > out[out.length - 1].score) out[out.length - 1] = { frame: i, time: +(i / fps).toFixed(2), score: +s.toFixed(1) }
      continue
    }
    out.push({ frame: i, time: +(i / fps).toFixed(2), score: +s.toFixed(1) })
  }
  return out
}
// The longest stretch with no cut, in frames [start, end) and seconds.
export function cleanStretch(cuts, frames, fps = 24) {
  const edges = [0, ...cuts.map((c) => c.frame), frames]
  let best = { start: 0, end: frames }
  if (cuts.length) {
    best = { start: 0, end: 0 }
    for (let i = 0; i < edges.length - 1; i++) if (edges[i + 1] - edges[i] > best.end - best.start) best = { start: edges[i], end: edges[i + 1] }
  }
  return { ...best, from: +(best.start / fps).toFixed(3), to: +(best.end / fps).toFixed(3), seconds: +((best.end - best.start) / fps).toFixed(2) }
}
// A stretch cut down to H3's 17n+5 frame grid (for Continue), kept at its start when it's the take's opening,
// else at its end (the frames nearest the cut are the ones most likely to blend into it). null below 22 frames.
export function h3Stretch(stretch, fps = 24) {
  const n = stretch.end - stretch.start
  if (n < 22) return null
  const frames = Math.floor((n - 5) / 17) * 17 + 5
  const start = stretch.start === 0 ? 0 : stretch.end - frames
  return { start, end: start + frames, from: +(start / fps).toFixed(3), to: +((start + frames) / fps).toFixed(3), frames }
}
// A prompt that asks for more than one shot: cuts in its takes are wanted.
export const asksForCuts = (prompt) => /\[\s*shot\s*[2-9]\s*\]|\b(hard |smash |jump )?cuts? (to|away)\b|\bcut:/i.test(String(prompt || ''))
// Mean difference between two grey pictures of the same size (0..255). Above HELD it isn't the same picture.
export const HELD = 12
export function greyDiff(a, b) {
  const n = Math.min(a?.length || 0, b?.length || 0)
  if (!n) return null
  let s = 0
  for (let i = 0; i < n; i++) s += Math.abs(a[i] - b[i])
  return +(s / n).toFixed(1)
}
export const heldScore = (d) => (d == null ? null : +Math.max(0, Math.min(1, 1 - (d - HELD / 2) / (HELD * 2))).toFixed(3))
const PARTS = Object.keys(DEFAULT_WEIGHTS)

// Numbers as words, so "20 minutes" (Whisper) matches "twenty minutes" (the prompt), up to 9999.
const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']
export function numberWords(n) {
  if (n < 20) return ONES[n]
  if (n < 100) return `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`
  if (n < 1000) return `${ONES[Math.floor(n / 100)]} hundred${n % 100 ? ` ${numberWords(n % 100)}` : ''}`
  return `${numberWords(Math.floor(n / 1000))} thousand${n % 1000 ? ` ${numberWords(n % 1000)}` : ''}`
}
const words = (t) =>
  String(t || '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/\d+/g, (d) => (d.length <= 4 ? ` ${numberWords(Number(d))} ` : d))
    .replace(/\ba (hundred|thousand)\b/g, 'one $1')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((w) => w && w !== 'and')
// How much of the wanted words were heard (0..1), lightly marked down when much more was said than written.
export function heardScore(want, heard) {
  const w = words(want)
  const got = words(heard)
  if (!w.length) return null
  const left = [...got]
  let n = 0
  for (const x of w) {
    const i = left.indexOf(x)
    if (i >= 0) (n++, left.splice(i, 1))
  }
  const extra = Math.max(0, got.length - w.length * 1.5) / Math.max(1, w.length)
  return Math.max(0, n / w.length - Math.min(0.3, extra * 0.15))
}
export const spokenLines = (prompt) => [...String(prompt || '').matchAll(/<d>\s*(?:\[[^\]]+\])?\s*([\s\S]*?)<\/d>/g)].map((m) => m[1].trim()).filter(Boolean)

// The parts -> one score, over the parts that could be measured; with the best take's reasons.
export function combine(takes, weights = DEFAULT_WEIGHTS) {
  const scored = takes.map((t) => {
    let sum = 0
    let wsum = 0
    for (const p of PARTS) if (t.parts[p] != null) (sum += t.parts[p] * weights[p], (wsum += weights[p]))
    return { ...t, score: wsum ? +(sum / wsum).toFixed(3) : null }
  })
  // the best only when it stands out: takes within 0.02 of each other are a tie, and a tie has no winner
  const [best, next] = scored.filter((t) => t.score != null).sort((a, b) => b.score - a.score)
  const clear = best && (!next || best.score - next.score >= 0.02)
  return scored.map((t) => ({ ...t, best: !!clear && t.candidate === best.candidate && scored.length > 1 }))
}

// Sharpness relative to the other takes: the sharpest 1, the softest 0 (all 1 when they barely differ).
export function relativeSharpness(blurs) {
  const known = blurs.filter((b) => b != null)
  if (!known.length) return blurs.map(() => null)
  const lo = Math.min(...known)
  const hi = Math.max(...known)
  return blurs.map((b) => (b == null ? null : hi - lo < 0.15 * hi || hi === 0 ? 1 : +(1 - (b - lo) / (hi - lo)).toFixed(3)))
}

function reasons(t, all) {
  const out = []
  const p = t.parts
  const r = t.raw
  if (p.words != null) out.push(r.coverage >= 0.95 ? 'says every word' : r.coverage >= 0.7 ? `misses some words (heard "${r.heard.slice(0, 50)}")` : `the line comes out wrong (heard "${r.heard.slice(0, 50)}")`)
  if (p.likeness != null) out.push(r.likeness >= 0.6 ? `clearly ${r.name} (${r.likeness.toFixed(2)})` : r.likeness >= 0.4 ? `looks like ${r.name} (${r.likeness.toFixed(2)})` : `doesn't look much like ${r.name} (${r.likeness.toFixed(2)})`)
  if (p.cuts != null && r.cuts?.length) out.push(r.cuts.length === 1 ? `cuts away at ${r.cuts[0].time.toFixed(1)} s` : `cuts away ${r.cuts.length} times (${r.cuts.map((c) => `${c.time.toFixed(1)} s`).join(', ')})`)
  if (r.opens) out.push(r.opens.held ? 'opens on your first frame' : `doesn't open on your first frame (${r.opens.diff} apart)`)
  if (r.ends) out.push(r.ends.held ? 'ends on your last frame' : `doesn't end on your last frame (${r.ends.diff} apart)`)
  if (p.motion != null && r.frozen >= 0.5) out.push(`freezes for ${r.frozen.toFixed(1)} s`)
  if (p.sharpness != null && all.filter((x) => x.parts.sharpness != null).length > 1) {
    if (p.sharpness === 1 && all.some((x) => x.parts.sharpness < 1)) out.push('the sharpest')
    else if (p.sharpness === 0) out.push('the softest')
  }
  return out
}

export class Ranker {
  // studio: () => the Studio (jobs, characters, face pictures); voices / shinobi: () => the service or null
  constructor({ studio, voices = () => null, shinobi = () => null, ffmpeg, dataDir }) {
    this.studio = studio
    this.voices = voices
    this.shinobi = shinobi
    this.ffmpeg = ffmpeg
    this.dataDir = dataDir
    this.busy = new Set()
  }
  weightsFile = () => path.join(this.dataDir, 'rank-weights.json')
  weights() {
    try {
      return { ...DEFAULT_WEIGHTS, ...JSON.parse(fs.readFileSync(this.weightsFile(), 'utf8')).weights }
    } catch {
      return { ...DEFAULT_WEIGHTS }
    }
  }

  run(args) {
    return new Promise((resolve) => {
      const p = spawn(this.ffmpeg, args, { windowsHide: true })
      let err = ''
      p.stderr.on('data', (d) => (err += d))
      p.on('error', () => resolve(''))
      p.on('close', () => resolve(err))
    })
  }
  // Mean blur (0 sharp .. higher softer) over a few frames a second, and the seconds the picture freezes.
  async measure(file) {
    const log = await this.run(['-hide_banner', '-v', 'info', '-i', file, '-vf', 'fps=4,blurdetect=block_width=32:block_height=32,freezedetect=n=0.002:d=0.75,metadata=print', '-an', '-f', 'null', '-'])
    const blurs = [...log.matchAll(/lavfi\.blur=([\d.]+)/g)].map((m) => Number(m[1]))
    const frozen = [...log.matchAll(/freeze_duration:\s*([\d.]+)/g)].reduce((n, m) => n + Number(m[1]), 0)
    const open = /freeze_start:\s*([\d.]+)(?![\s\S]*freeze_end)/.exec(log)
    const dur = Number(/Duration: (\d+):(\d+):([\d.]+)/.exec(log)?.slice(1).reduce((s, x, i) => s + Number(x) * [3600, 60, 1][i], 0)) || 0
    const tail = open ? Math.max(0, dur - Number(open[1])) : 0
    return { blur: blurs.length ? blurs.reduce((a, b) => a + b, 0) / blurs.length : null, frozen: frozen + tail, duration: dur }
  }

  // scdet's score for every frame (0 for the first), the frame rate and the frame count.
  async sceneScores(file) {
    const log = await this.run(['-hide_banner', '-v', 'info', '-i', file, '-vf', 'scale=256:-2,scdet=threshold=100,metadata=print', '-an', '-f', 'null', '-'])
    const fps = Number(/, ([\d.]+) fps/.exec(log)?.[1]) || 24
    const scores = [...log.matchAll(/lavfi\.scd\.score=([\d.]+)/g)].map((m) => Number(m[1]))
    const mafd = [...log.matchAll(/lavfi\.scd\.mafd=([\d.]+)/g)].map((m) => Number(m[1]))
    return { scores, mafd: mafd.length === scores.length ? mafd : null, fps, frames: scores.length }
  }
  // Hard cuts in a take, and its longest stretch without one.
  async cuts(file) {
    const { scores, mafd, fps, frames } = await this.sceneScores(file)
    if (!frames) return null
    const cuts = findCuts(scores, fps, mafd)
    const clean = cleanStretch(cuts, frames, fps)
    return { cuts, clean, fps, frames, h3: cuts.length ? h3Stretch(clean, fps) : null }
  }
  // A frame of a video (first, or last) or a picture, as w x h grey bytes. A picture is scaled to cover the frame and
  // centred, the way H3 fits a first or last picture into its frame.
  grey(file, { w, h, last = false, picture = false }) {
    return new Promise((resolve) => {
      const fit = picture ? `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}` : `scale=${w}:${h}`
      const args = ['-hide_banner', '-v', 'error', ...(last ? ['-sseof', '-0.5'] : []), '-i', file, '-vf', fit, ...(last ? [] : ['-frames:v', '1']), '-f', 'rawvideo', '-pix_fmt', 'gray', '-']
      const p = spawn(this.ffmpeg, args, { windowsHide: true })
      const chunks = []
      p.stdout.on('data', (d) => chunks.push(d))
      p.on('error', () => resolve(null))
      p.on('close', () => {
        const all = Buffer.concat(chunks)
        resolve(all.length >= w * h ? all.subarray(all.length - w * h) : null)
      })
    })
  }
  // Frames mode: how far the take's first frame is from the first picture, and its last from the last picture.
  async heldFrames(take, first, last, size) {
    const w = 64
    const h = Math.max(16, Math.round((64 * (size?.height || 9)) / (size?.width || 16)))
    const pair = async (pic, end) => {
      if (!pic || !fs.existsSync(pic)) return null
      const [a, b] = await Promise.all([this.grey(take, { w, h, last: end }), this.grey(pic, { w, h, picture: true })])
      const diff = greyDiff(a, b)
      return diff == null ? null : { diff, held: diff <= HELD }
    }
    return { opens: await pair(first, false), ends: await pair(last, true) }
  }

  // Scores a previews job's takes and saves them on the job (job.ranking). Parts that can't be measured are left out.
  async rank(jobId) {
    if (this.busy.has(jobId)) return null
    this.busy.add(jobId)
    try {
      const job = this.studio().getJob(jobId, { refresh: false })
      if (job.kind !== 'previews' || job.status !== 'success') return null
      const req = job.plan?.request || {}
      const takes = job.outputs.filter((o) => o.kind === 'preview' && o.path && fs.existsSync(o.path))
      if (!takes.length) return null
      const lines = spokenLines(req.prompt).join(' ')
      const ch = req.character && req.character !== 'none' ? this.studio().characters().find((c) => c.id === req.character) : null
      const face = ch ? this.studio().facePicture(ch, this.studio().resourcesDir) : null

      const measured = await Promise.all(takes.map((t) => this.measure(t.path)))
      // cuts: only when the prompt asks for one shot (Seedance prompts direct their own cuts)
      const oneShot = job.plan?.engine !== 'seedance' && !asksForCuts(req.prompt)
      const cutsOf = oneShot ? await Promise.all(takes.map((t) => this.cuts(t.path).catch(() => null))) : takes.map(() => null)
      // frames mode: the first and last pictures as given (plan.asked keeps local paths)
      const pics = req.mode === 'frames' ? (job.plan?.asked?.media || []).filter((m) => m.kind === 'picture').map((m) => m.file) : []
      const held = pics.length ? await Promise.all(takes.map((t) => this.heldFrames(t.path, pics[0], pics[1], job.plan?.resolved).catch(() => ({})))) : takes.map(() => ({}))
      let likeness = []
      const sh = this.shinobi()
      if (face && sh?.faceModelsReady?.()) likeness = await sh.likeness(face, takes.map((t) => t.path)).catch(() => [])
      const heard = []
      const v = this.voices()
      if (lines && v?.engine?.installed?.()) for (const t of takes) heard.push(await v.transcribe(t.path).catch(() => null))

      const sharp = relativeSharpness(measured.map((m) => m.blur))
      const raw = takes.map((t, i) => {
        const like = likeness.find((x) => x.file === t.path)?.score ?? null
        const coverage = lines && heard[i] != null ? heardScore(lines, heard[i]) : null
        const cut = cutsOf[i]
        const frameParts = [held[i]?.opens, held[i]?.ends].filter(Boolean).map((x) => heldScore(x.diff))
        return {
          candidate: t.candidate,
          seed: t.seed,
          raw: {
            heard: heard[i] ?? '',
            coverage,
            likeness: like,
            name: ch?.name.split(/\s+/)[0],
            frozen: measured[i].frozen,
            blur: measured[i].blur,
            ...(cut ? { cuts: cut.cuts, clean: cut.clean, cleanH3: cut.h3, fps: cut.fps, frames: cut.frames } : {}),
            ...(held[i]?.opens ? { opens: held[i].opens } : {}),
            ...(held[i]?.ends ? { ends: held[i].ends } : {})
          },
          parts: {
            words: coverage == null ? null : +(coverage * coverage).toFixed(3),
            likeness: like == null ? null : +Math.min(1, Math.max(0, (like - 0.2) / 0.5)).toFixed(3),
            // a cut costs most of the take: what's left is the longest clean stretch, at half value
            cuts: cut ? (cut.cuts.length ? +((0.5 * cut.clean.end - 0.5 * cut.clean.start) / cut.frames).toFixed(3) : 1) : null,
            frames: frameParts.length ? +(frameParts.reduce((a, b) => a + b, 0) / frameParts.length).toFixed(3) : null,
            motion: measured[i].duration ? +Math.max(0, 1 - (2 * measured[i].frozen) / measured[i].duration).toFixed(3) : null,
            sharpness: sharp[i]
          }
        }
      })
      const ranked = combine(raw, this.weights()).map((t, _, all) => ({ ...t, reasons: reasons(t, all) }))
      const ranking = { at: new Date().toISOString(), takes: ranked, measured: PARTS.filter((p) => ranked.some((t) => t.parts[p] != null)) }
      this.studio().updateJob(jobId, { ranking })
      return ranking
    } finally {
      this.busy.delete(jobId)
    }
  }

  // The person picked a take: each part's weight leans towards what set it apart from the others.
  learn(jobId, candidate) {
    const job = this.studio().getJob(jobId, { refresh: false })
    const takes = job.ranking?.takes || []
    const picked = takes.find((t) => t.candidate === candidate)
    if (!picked || takes.length < 2) return this.weights()
    const others = takes.filter((t) => t !== picked)
    const w = this.weights()
    for (const p of PARTS) {
      const mine = picked.parts[p]
      const rest = others.map((t) => t.parts[p]).filter((x) => x != null)
      if (mine == null || !rest.length) continue
      const mean = rest.reduce((a, b) => a + b, 0) / rest.length
      if (Math.abs(mine - mean) < 0.05) continue
      w[p] = +Math.min(5, Math.max(0.3, w[p] * (mine > mean ? 1.08 : 0.94))).toFixed(3)
    }
    let picks = 0
    try {
      picks = JSON.parse(fs.readFileSync(this.weightsFile(), 'utf8')).picks || 0
    } catch {}
    fs.writeFileSync(this.weightsFile(), JSON.stringify({ weights: w, picks: picks + 1 }, null, 2))
    return w
  }
}

// The longest stretch of a take without a cut, as a file of its own (MediaTools.prepare, frame-exact). forContinue:
// cut down to H3's 17n+5 grid, to carry on from in Continue mode. dir: where a cloud take is copied first.
export async function cleanStretchFile({ studio, mediaTools, dir, jobId, candidate, forContinue = false }) {
  const job = studio.getJob(jobId, { refresh: false })
  const take = job.ranking?.takes?.find((t) => t.candidate === candidate)
  if (!take?.raw?.cuts?.length) throw new Error('That take has no cut to cut around. Rank the takes first.')
  const stretch = forContinue ? take.raw.cleanH3 : take.raw.clean
  if (!stretch) throw new Error(`The part without a cut is only ${take.raw.clean.seconds} s, too short to carry on from (H3 needs about 1 s).`)
  const out = job.outputs.find((o) => o.kind === 'preview' && o.candidate === candidate)
  if (!out) throw new Error('That take is gone.')
  const file = out.path && fs.existsSync(out.path) ? out.path : await studio.localCopy(out, dir)
  const made = await mediaTools.prepare({ file, start: stretch.from, end: stretch.to })
  return { path: made.path, from: stretch.from, to: stretch.to, seconds: +(stretch.to - stretch.from).toFixed(2), frames: forContinue ? stretch.frames : stretch.end - stretch.start }
}
