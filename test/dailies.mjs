// Dailies after an overnight batch (src/service/dailies.js): the plan puts each shot's best take first, the notes say
// what to look at first and why, and the reel is a title card then the take, for every take, with sound throughout.
//   node test/dailies.mjs
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import ffmpegStatic from 'ffmpeg-ffprobe-static'
import { probe } from '../src/service/media.js'
import { CARD_SECONDS, dailiesNotes, dailiesPlan, isProblem, makeDailies } from '../src/service/dailies.js'

let n = 0
const ok = async (name, fn) => {
  await fn()
  n++
  console.log(`ok  ${name}`)
}
const ff = ffmpegStatic.ffmpegPath.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`)
const ffprobe = ffmpegStatic.ffprobePath.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`)
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ivs-dailies-'))
const mk = (name, args) => {
  const r = spawnSync(ff, ['-y', '-hide_banner', '-loglevel', 'error', ...args, path.join(root, name)], { windowsHide: true })
  assert.equal(r.status, 0, String(r.stderr))
  return path.join(root, name)
}
const take = (name, sound) => mk(name, ['-f', 'lavfi', '-i', 'testsrc2=s=480x270:r=24:d=2', ...(sound ? ['-f', 'lavfi', '-i', 'sine=f=330:d=2', '-c:a', 'aac', '-shortest'] : []), '-c:v', 'libx264', '-pix_fmt', 'yuv420p'])
const files = { a1: take('a1.mp4', true), a2: take('a2.mp4', true), b1: take('b1.mp4', false), b2: take('b2.mp4', true) }

const batch = { id: 'bk3x9zab', name: 'Rainy bus stop', createdAt: '2026-11-10T02:00:00.000Z', takes: 2, jobs: [{ jobId: 'j1', label: 'Tess waits at a bus stop in the rain' }, { jobId: 'j2', prompt: '[Shot 1] Tess runs for the bus <d>[English] Wait!</d>' }, { jobId: 'j3', label: 'A third that failed' }] }
const jobs = {
  j1: { status: 'success', projectId: 'p1', outputs: [{ kind: 'preview', candidate: 1, seed: 5151, path: files.a1 }, { kind: 'preview', candidate: 2, seed: 6151, path: files.a2 }], ranking: { takes: [{ candidate: 1, score: 0.61, reasons: ['looks like Tess (0.45)'] }, { candidate: 2, score: 0.8, best: true, reasons: ['clearly Tess (0.71)', 'says every word'] }] } },
  j2: { status: 'success', projectId: 'p1', outputs: [{ kind: 'preview', candidate: 1, seed: 7, path: files.b1 }, { kind: 'preview', candidate: 2, seed: 1007, path: files.b2 }], ranking: { takes: [{ candidate: 1, score: 0.4, reasons: ['cuts away at 2.4 s'] }, { candidate: 2, score: 0.3, reasons: ['freezes for 1.2 s'] }] } },
  j3: { status: 'error', error: 'Out of memory.' }
}

await ok('the plan: every take, the best of each shot first, problems picked out', () => {
  const plan = dailiesPlan(batch, jobs)
  assert.deepEqual(plan.map((p) => [p.shot, p.candidate, p.best]), [[1, 2, true], [1, 1, false], [2, 1, true], [2, 2, false]])
  assert.equal(plan[0].clear, true, 'a clear winner')
  assert.equal(plan[2].clear, false, 'shot 2 has only a top score')
  assert.equal(plan[2].label, 'Tess runs for the bus Wait!', 'the prompt, tidied')
  assert.deepEqual(plan[2].problems, ['cuts away at 2.4 s'])
  assert.equal(plan[0].seed, 6151)
  assert.ok(isProblem("doesn't open on your first frame (20 apart)") && !isProblem('says every word'))
})
await ok('the notes: what to look at first, what to check, shot by shot, what failed', () => {
  const t = dailiesNotes(batch, jobs)
  assert.match(t, /^# Dailies: Rainy bus stop/)
  assert.match(t, /2 of 3 shots rendered, 4 takes/)
  assert.match(t, /## Look at these first\n\n- Shot 1, take 2 · score 80: Tess waits at a bus stop in the rain\. clearly Tess \(0\.71\); says every word\n- Shot 2, take 1 · score 40/)
  assert.match(t, /## Best takes with something to check\n\n- Shot 2, take 1: cuts away at 2\.4 s/)
  assert.match(t, /- Take 2 \(best\), seed 6151 · score 80/)
  assert.match(t, /## Didn’t render\n\n- Shot 3: A third that failed \(Out of memory\.\)/)
  assert.match(t, /slow dissolves aren’t caught/)
})
await ok('the reel: a card then the take, four times, with sound throughout; the notes beside it', async () => {
  const font = path.resolve('resources/fonts/BarlowCondensed-SemiBold.ttf')
  const d = await makeDailies({ batch, jobs, outDir: path.join(root, 'out'), ffmpeg: ff, font, localCopy: async () => null, probe: (f) => probe(ffprobe, f), stamp: new Date('2026-11-10T08:00:00Z') })
  assert.equal(path.basename(d.folder), 'Rainy bus stop 2026-11-10 9zab')
  assert.equal(d.takes, 4)
  assert.ok(fs.existsSync(d.reel) && fs.existsSync(d.notes))
  assert.ok(!fs.existsSync(path.join(d.folder, '.work')), 'the work folder is cleared')
  const info = await probe(ffprobe, d.reel)
  assert.equal(info.hasAudio, true)
  assert.ok(Math.abs(info.duration - 4 * (CARD_SECONDS + 2)) < 0.3, `length ${info.duration}`)
  assert.equal(info.width, 1280)
  // the first card is dark, the take after it isn't
  const frame = (t) => spawnSync(ff, ['-v', 'error', '-ss', String(t), '-i', d.reel, '-frames:v', '1', '-vf', 'scale=32:18', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { windowsHide: true }).stdout
  const mean = (b) => b.reduce((s, x) => s + x, 0) / b.length
  assert.ok(mean(frame(0.3)) < 40 && mean(frame(CARD_SECONDS + 1)) > 60)
  assert.match(fs.readFileSync(d.notes, 'utf8'), /The reel: dailies\.mp4/)
})
fs.rmSync(root, { recursive: true, force: true })
console.log(`${n} checks passed`)
