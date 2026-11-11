// How long a render will take on this machine, from how long its own renders took.
//
// Every finished job already records its seconds (Studio.refreshJob). This reads the recent ones and answers
// "about how long will this one take" for a hunt or a finish before it starts:
//   - the same settings were rendered before: the middle of those times ("from your last N like this")
//   - only different settings were: scaled from them by how much work each was ("from your other renders")
//   - nothing yet: null, and the page keeps its RTX 4090 reference figure
// A cloud estimate also says what it costs at the GPU's hourly price. Nothing here leaves the PC.

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const round2 = (n) => Math.round(n * 100) / 100

// What a job was, in the terms that decide its time. null for jobs this doesn't estimate.
export function shapeOf(job) {
  if (!job || job.plan?.engine === 'seedance') return null
  const where = job.where === 'cloud' ? 'cloud' : 'local'
  const r = job.plan?.resolved || {}
  if (job.kind === 'previews') {
    const q = job.plan?.request || {}
    const pixels = r.width && r.height ? r.width * r.height : (Number(q.megapixels) || 0) * 1e6
    const frames = r.frames || Math.round((Number(q.seconds) || 0) * (r.fps || 24))
    const takes = r.previews || Number(q.previews) || 1
    const steps = Number(q.steps) || 8
    if (!pixels || !frames) return null
    return { kind: 'previews', where, key: `${round2(pixels / 1e6)}mp|${frames}f|${takes}x|${steps}s`, work: (pixels / 1e6) * frames * takes * steps }
  }
  if (job.kind === 'finish') {
    const f = job.plan?.finish || {}
    if (f.way && f.way !== 'local') return null
    const pixels = r.width && r.height ? r.width * r.height : 0
    const frames = r.frames || 0
    if (!pixels || !frames) return null
    const how = `${f.megapixels || '?'}mp${f.upscale2x ? '+2x' : ''}|${f.enhancer || f.refiner || 'plain'}`
    return { kind: 'finish', where, key: `${how}|${frames}f`, how, work: (pixels / 1e6) * frames }
  }
  return null
}

// What a planned run would be, from the form's own values (before any job exists).
export function shapeOfPlan({ kind, where = 'local', megapixels, seconds, previews = 1, steps = 8, fps = 24, upscale2x = false, enhancer = 'plain' }) {
  const frames = Math.round((Number(seconds) || 0) * fps)
  const mp = Number(megapixels) || 0
  if (!frames || !mp) return null
  if (kind === 'previews') return { kind, where, mp, frames, takes: Number(previews) || 1, steps: Number(steps) || 8, work: mp * frames * (Number(previews) || 1) * (Number(steps) || 8) }
  if (kind === 'finish') return { kind, where, how: `${mp}mp${upscale2x ? '+2x' : ''}|${enhancer || 'plain'}`, frames, work: mp * (upscale2x ? 4 : 1) * frames }
  return null
}

// The finished jobs worth learning from: successful, timed, newest first.
export function samples(jobs) {
  return jobs
    .filter((j) => j && j.status === 'success' && j.seconds > 0)
    .sort((a, b) => String(b.finishedAt || b.createdAt || '').localeCompare(String(a.finishedAt || a.createdAt || '')))
    .map((j) => ({ ...shapeOf(j), seconds: j.seconds }))
    .filter((s) => s.kind)
}

// a + b·work through the points (least squares), kept sane: never a negative slope or start-up time
function fit(points) {
  const n = points.length
  const mx = points.reduce((s, p) => s + p.work, 0) / n
  const my = points.reduce((s, p) => s + p.seconds, 0) / n
  const sxx = points.reduce((s, p) => s + (p.work - mx) ** 2, 0)
  if (sxx < 1e-9) return null
  const b = points.reduce((s, p) => s + (p.work - mx) * (p.seconds - my), 0) / sxx
  const a = my - b * mx
  return b > 0 && a >= 0 ? { a, b } : null
}

// plan: shapeOfPlan's answer. history: samples(). perHour: the cloud GPU's price, for a cost.
// -> { seconds, basis: 'same' | 'similar', runs, cost } or null
export function estimate(plan, history, { perHour = null, recent = 8 } = {}) {
  if (!plan) return null
  const mine = history.filter((s) => s.kind === plan.kind && s.where === plan.where)
  // a form's 1 MP is 768x1376 once resolved (1.06 MP), so "the same" allows that much slack
  const tol = (a, b) => Math.abs(a - b) <= Math.max(a, b) * 0.12
  const same = mine.filter((s) => tol(s.work, plan.work) && (plan.kind !== 'finish' || s.how === plan.how)).slice(0, recent)
  let seconds = null
  let basis = null
  let runs = 0
  if (same.length) {
    seconds = median(same.map((s) => s.seconds))
    basis = 'same'
    runs = same.length
  } else {
    const pool = (plan.kind === 'finish' ? mine.filter((s) => s.how === plan.how) : mine).slice(0, recent * 2)
    if (pool.length >= 3) {
      const line = fit(pool)
      if (line) seconds = line.a + line.b * plan.work
    }
    // too few to draw a line through: scale the nearest ones by their work
    if (seconds === null && pool.length) seconds = median(pool.map((s) => (s.seconds * plan.work) / s.work))
    if (seconds !== null) {
      basis = 'similar'
      runs = pool.length
    }
  }
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) return null
  seconds = Math.max(5, Math.round(seconds))
  const cost = plan.where === 'cloud' && perHour > 0 ? round2((seconds / 3600) * perHour) : null
  return { seconds, basis, runs, cost }
}

// "about 2 minutes", "about 40 seconds", "about 1 hour 10 minutes"
export function roughly(seconds) {
  if (seconds < 50) return `about ${Math.max(10, Math.round(seconds / 10) * 10)} seconds`
  const m = Math.round(seconds / 60)
  if (m < 60) return `about ${m} minute${m === 1 ? '' : 's'}`
  const h = Math.floor(m / 60)
  const rest = Math.round((m % 60) / 5) * 5
  return `about ${h} hour${h === 1 ? '' : 's'}${rest ? ` ${rest} minutes` : ''}`
}

// The line under a Hunt or Finish button.
export function estimateLine(e, { where = 'local' } = {}) {
  if (!e) return null
  const place = where === 'cloud' ? 'in your cloud' : 'on this computer'
  const from = e.basis === 'same' ? `from your last ${e.runs === 1 ? 'render' : `${e.runs} renders`} like this` : 'worked out from your other renders'
  const cost = e.cost !== null ? (e.cost < 0.01 ? ', under $0.01' : `, about $${e.cost.toFixed(2)}`) : where === 'cloud' ? '' : ', free'
  return `${roughly(e.seconds)[0].toUpperCase()}${roughly(e.seconds).slice(1)} ${place}${cost} (${from}).`
}
