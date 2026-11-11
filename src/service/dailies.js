// Dailies after an overnight batch (batches.js): one reel of every take, each after a title card with its shot,
// take, seed and checks (ranking.js: the words heard, likeness, cuts, frames held, freezes), the best take of each
// shot first; and notes.md saying what to look at first and why. Into Videos\IV Studio\Dailies\<batch> <date>\.
// The plan and the notes are pure; the reel is ffmpeg, one segment per take, joined without re-encoding.
// Idea from keys + Sam Wasserman's Imagination Studio; our own code.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { bestTake } from './batches.js'

const clean = (s, n = 90) => {
  const t = String(s || '').replace(/<[^>]+>/g, '').replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}
// a reason that's a problem, as ranking.js words them
export const isProblem = (r) => /cuts away|doesn't open|doesn't end|freezes|misses|comes out wrong|doesn't look|the softest/.test(r)

// Every take of every shot that rendered, the best of each shot first: [{ shot, label, jobId, candidate, seed, file,
// best, score, reasons, problems }]. jobs: { [jobId]: job }.
export function dailiesPlan(batch, jobs) {
  const out = []
  batch.jobs.forEach((j, i) => {
    const job = jobs[j.jobId]
    if (job?.status !== 'success') return
    const best = bestTake(job)
    const takes = (job.outputs || []).filter((o) => o.kind === 'preview')
    const order = [...takes].sort((a, b) => (b.candidate === best?.candidate) - (a.candidate === best?.candidate) || a.candidate - b.candidate)
    for (const o of order) {
      const r = job.ranking?.takes?.find((t) => t.candidate === o.candidate)
      const reasons = r?.reasons || []
      out.push({ shot: i + 1, label: clean(j.label || j.prompt || job.name, 70), jobId: j.jobId, projectId: job.projectId || batch.projectId || null, candidate: o.candidate, seed: o.seed ?? r?.seed ?? null, file: o.path || null, out: o, best: o.candidate === best?.candidate, clear: o.candidate === best?.candidate && !!best?.clear, score: r?.score ?? null, reasons, problems: reasons.filter(isProblem) })
    }
  })
  return out
}

// notes.md: the batch, what to look at first, then shot by shot.
export function dailiesNotes(batch, jobs, plan = dailiesPlan(batch, jobs), { reel = null } = {}) {
  const pct = (s) => (s == null ? '' : ` · score ${Math.round(s * 100)}`)
  const first = plan.filter((p) => p.best).sort((a, b) => (b.score ?? -1) - (a.score ?? -1)).slice(0, 3)
  const trouble = plan.filter((p) => p.best && p.problems.length)
  const failed = batch.jobs.map((j, i) => ({ i: i + 1, j, job: jobs[j.jobId] })).filter((r) => r.job?.status !== 'success')
  const lines = [`# Dailies: ${batch.name}`, '', `Started ${batch.createdAt?.slice(0, 16).replace('T', ' ')}. ${batch.jobs.length - failed.length} of ${batch.jobs.length} shots rendered, ${plan.length} takes.${reel ? ` The reel: ${path.basename(reel)}.` : ''}`, '']
  lines.push('## Look at these first', '')
  if (!first.length) lines.push('Nothing rendered.', '')
  for (const p of first) lines.push(`- Shot ${p.shot}, take ${p.candidate}${pct(p.score)}: ${p.label}${p.reasons.length ? `. ${p.reasons.join('; ')}` : ''}`)
  if (trouble.length) {
    lines.push('', '## Best takes with something to check', '')
    for (const p of trouble) lines.push(`- Shot ${p.shot}, take ${p.candidate}: ${p.problems.join('; ')}`)
  }
  lines.push('', '## Shot by shot', '')
  for (const shot of [...new Set(plan.map((p) => p.shot))]) {
    const takes = plan.filter((p) => p.shot === shot)
    lines.push(`### Shot ${shot}: ${takes[0].label}`, '')
    for (const p of takes) lines.push(`- Take ${p.candidate}${p.best ? (p.clear ? ' (best)' : ' (top score)') : ''}, seed ${p.seed ?? '?'}${pct(p.score)}${p.reasons.length ? `: ${p.reasons.join('; ')}` : ''}`)
    lines.push('')
  }
  if (failed.length) {
    lines.push('## Didn’t render', '')
    for (const r of failed) lines.push(`- Shot ${r.i}: ${clean(r.j.label || r.j.prompt, 70)}${r.job?.error ? ` (${clean(r.job.error, 120)})` : ''}`)
    lines.push('')
  }
  lines.push('Checks: the words heard back, likeness to the character, cuts inside a one-shot take (hard cuts only; slow dissolves aren’t caught), first and last frames held, freezes and sharpness. They point at what to look at; they don’t replace watching.')
  return lines.join('\n') + '\n'
}

// ffmpeg arguments for one segment: a title card (1.6 s, silent), then the take fitted into 1280x720 with a small
// label in the corner. Card text goes through files, so no quoting of a prompt's words is needed.
export const CARD_SECONDS = 1.6
// silent: a take with no sound gets silence as long as it (duration, seconds).
export function segmentArgs({ clip, hasAudio, duration = 5, texts, font, out, problem = false }) {
  const f = font.replace(/\\/g, '/').replace(':', '\\:')
  const tf = (p) => p.replace(/\\/g, '/').replace(':', '\\:')
  const card = [
    `drawtext=fontfile='${f}':textfile='${tf(texts.title)}':fontsize=60:fontcolor=#f4ecdc:x=90:y=230`,
    `drawtext=fontfile='${f}':textfile='${tf(texts.line)}':fontsize=30:fontcolor=#f4ecdc@0.8:x=90:y=320`,
    `drawtext=fontfile='${f}':textfile='${tf(texts.checks)}':fontsize=28:fontcolor=${problem ? '#ff6f91' : '#9fd8a8'}:x=90:y=372`
  ].join(',')
  const label = `drawtext=fontfile='${f}':textfile='${tf(texts.corner)}':fontsize=24:fontcolor=white@0.85:box=1:boxcolor=black@0.5:boxborderw=8:x=24:y=h-56`
  return [
    '-y', '-hide_banner', '-v', 'error',
    '-f', 'lavfi', '-i', `color=c=0x0d0b0a:s=1280x720:r=24:d=${CARD_SECONDS}`,
    '-f', 'lavfi', '-t', String(CARD_SECONDS), '-i', 'anullsrc=r=48000:cl=stereo',
    '-i', clip,
    ...(hasAudio ? [] : ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo']),
    '-filter_complex',
    `[0:v]${card},format=yuv420p,setsar=1[cv];[2:v]fps=24,scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,${label},format=yuv420p[tv];${hasAudio ? '[2:a]' : '[3:a]'}aresample=48000,aformat=channel_layouts=stereo${hasAudio ? '' : `,atrim=0:${Number(duration).toFixed(3)}`}[ta];[1:a]aformat=channel_layouts=stereo[ca];[cv][ca][tv][ta]concat=n=2:v=1:a=1[v][a]`,
    '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-r', '24', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', out
  ]
}

const safe = (s) => String(s || 'batch').replace(/[^\w -]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'batch'
const run = (bin, args) =>
  new Promise((resolve, reject) => {
    const p = spawn(bin, args, { windowsHide: true })
    let err = ''
    p.stderr.on('data', (d) => (err += d))
    p.on('error', reject)
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg: ${err.trim().split('\n').pop()}`))))
  })

// The reel and the notes: { folder, reel, notes, takes }. localCopy(output, dir) brings a take to this PC;
// probe(file) says whether it has sound.
export async function makeDailies({ batch, jobs, outDir, ffmpeg, font, localCopy, probe, reel = true, stamp = new Date() }) {
  const plan = dailiesPlan(batch, jobs)
  const folder = path.join(outDir, `${safe(batch.name)} ${stamp.toISOString().slice(0, 10)} ${batch.id.slice(-4)}`)
  fs.mkdirSync(folder, { recursive: true })
  let reelFile = null
  if (reel && plan.length) {
    const work = path.join(folder, '.work')
    fs.mkdirSync(work, { recursive: true })
    const segs = []
    for (const [k, p] of plan.entries()) {
      const clip = p.file && fs.existsSync(p.file) ? p.file : await localCopy(p.out, work).catch(() => null)
      if (!clip) continue
      const texts = { title: `Shot ${p.shot} · take ${p.candidate}${p.best ? (p.clear ? ' · best' : ' · top score') : ''}`, line: p.label || ' ', checks: [p.seed != null && `seed ${p.seed}`, p.score != null && `score ${Math.round(p.score * 100)}`, ...p.reasons].filter(Boolean).join(' · ') || 'not ranked', corner: `Shot ${p.shot} · take ${p.candidate}` }
      const files = {}
      for (const [key, t] of Object.entries(texts)) fs.writeFileSync((files[key] = path.join(work, `${k}_${key}.txt`)), t)
      const out = path.join(work, `seg${String(k).padStart(3, '0')}.mp4`)
      const info = await probe(clip).catch(() => null)
      await run(ffmpeg, segmentArgs({ clip, hasAudio: info?.hasAudio !== false, duration: info?.duration || 5, texts: files, font, out, problem: p.problems.length > 0 }))
      segs.push(out)
    }
    if (segs.length) {
      const list = path.join(work, 'list.txt')
      fs.writeFileSync(list, segs.map((s) => `file '${s.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'))
      reelFile = path.join(folder, 'dailies.mp4')
      await run(ffmpeg, ['-y', '-hide_banner', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', reelFile])
    }
    fs.rmSync(work, { recursive: true, force: true })
  }
  const notes = path.join(folder, 'notes.md')
  fs.writeFileSync(notes, dailiesNotes(batch, jobs, plan, { reel: reelFile }))
  return { folder, reel: reelFile, notes, takes: plan.length }
}
