// Take ranking (src/service/ranking.js) and the live preview wrap (src/service/remote.js).
//   node test/ranking.mjs [a video to measure]
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import ffmpegStatic from 'ffmpeg-ffprobe-static'
import { spawnSync } from 'node:child_process'
import { asksForCuts, cleanStretch, combine, DEFAULT_WEIGHTS, findCuts, greyDiff, h3Stretch, heardScore, HELD, Ranker, relativeSharpness, spokenLines } from '../src/service/ranking.js'
import { capabilities, withLivePreview } from '../src/service/remote.js'

let n = 0
const ok = async (name, fn) => {
  await fn()
  n++
  console.log(`ok  ${name}`)
}

await ok('spoken lines and how much of them was heard', () => {
  assert.deepEqual(spokenLines('A (S1) says: <d>[English] Bus is late.</d> B (S2): <d>Mine.</d>'), ['Bus is late.', 'Mine.'])
  assert.equal(heardScore('Bus is late. Mine.', 'Bus is late. Mine.'), 1)
  assert.equal(heardScore('Nope. Mine.', 'Nope.'), 0.5)
  assert.ok(heardScore("Bus's late, I'm here", "Hey, bus is late, I'm here. Hey, bus is late, I'm here.") < 1, 'a line said twice over is marked down a little')
  assert.equal(heardScore('', 'anything'), null)
  assert.equal(heardScore('Twenty minutes late again.', '20 minutes late again.'), 1, 'numbers match written either way')
  assert.equal(heardScore('Twenty-one days and a hundred and five nights.', '21 days and 105 nights'), 1)
})
await ok('sharpness relative to the other takes', () => {
  assert.deepEqual(relativeSharpness([4, 8, 6]), [1, 0, 0.5])
  assert.deepEqual(relativeSharpness([5, 5.2, null]), [1, 1, null], 'takes that barely differ are all sharp')
})
await ok('the parts combine over what was measured, and the best is marked', () => {
  const takes = [
    { candidate: 1, parts: { words: 1, likeness: 0.4, motion: 1, sharpness: 0 } },
    { candidate: 2, parts: { words: 0.25, likeness: 0.9, motion: 1, sharpness: 1 } },
    { candidate: 3, parts: { words: null, likeness: null, motion: null, sharpness: null } }
  ]
  const r = combine(takes, DEFAULT_WEIGHTS)
  assert.equal(r[0].best, true, 'hearing every word outweighs a better face when the other take drops half its line (0.5 heard, squared)')
  assert.equal(r[2].score, null)
  assert.equal(combine([takes[0]]).every((t) => !t.best), true, 'one take alone is not "best"')
  const tie = combine([{ candidate: 1, parts: { words: 0.5 } }, { candidate: 2, parts: { words: 0.51 } }])
  assert.ok(tie.every((t) => !t.best), 'a tie has no winner')
})
await ok('picks move the weights towards what set the pick apart', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ivs-rank-'))
  const job = { kind: 'previews', ranking: { takes: [{ candidate: 1, parts: { words: 1, likeness: 0.2, motion: 1, sharpness: 0.5 } }, { candidate: 2, parts: { words: 0.6, likeness: 0.9, motion: 1, sharpness: 0.5 } }] } }
  const r = new Ranker({ studio: () => ({ getJob: () => job }), dataDir: root, ffmpeg: '' })
  const w = r.learn('j', 2)
  assert.ok(w.likeness > DEFAULT_WEIGHTS.likeness && w.words < DEFAULT_WEIGHTS.words && w.motion === DEFAULT_WEIGHTS.motion)
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'rank-weights.json'), 'utf8')).picks, 1)
  fs.rmSync(root, { recursive: true, force: true })
})
await ok('cuts: one frame unlike the one before, standing alone', () => {
  const calm = Array.from({ length: 124 }, (_, i) => (i ? 0.8 + (i % 3) * 0.2 : 0))
  assert.deepEqual(findCuts(calm), [], 'steady motion has no cut')
  const cut = calm.slice()
  cut[72] = 13
  cut[73] = 2.4
  assert.deepEqual(findCuts(cut), [{ frame: 72, time: 3, score: 13 }])
  const flash = calm.slice()
  ;[110, 111, 112, 115, 116].forEach((i, k) => (flash[i] = [5.5, 10.4, 5.5, 6.3, 9.4][k]))
  assert.deepEqual(findCuts(flash), [], 'a burst of bright frames is not a cut')
  // a one-frame flicker: scdet scores the jump, not the jump back; the raw differences show both
  const flick = calm.slice()
  flick[53] = 8.4
  const mafd = calm.map((x) => x + 0.5)
  mafd[53] = 9
  mafd[54] = 8.8
  assert.deepEqual(findCuts(flick, 24, mafd), [], 'a flicker that jumps straight back is not a cut')
  const stays = mafd.slice()
  stays[54] = 0.9
  assert.equal(findCuts(flick, 24, stays).length, 1, 'a change that stays is')
  const edge = calm.slice()
  edge[1] = 30
  assert.deepEqual(findCuts(edge), [], 'the first frames are skipped')
})
await ok('the clean stretch, and the same cut to the 17n+5 grid', () => {
  assert.deepEqual(cleanStretch([], 124), { start: 0, end: 124, from: 0, to: 5.167, seconds: 5.17 })
  const c = cleanStretch([{ frame: 72 }], 124)
  assert.deepEqual([c.start, c.end, c.seconds], [0, 72, 3])
  assert.deepEqual(h3Stretch(c), { start: 0, end: 56, from: 0, to: 2.333, frames: 56 }, 'the opening stretch keeps its start')
  const late = cleanStretch([{ frame: 20 }], 124)
  assert.deepEqual([late.start, late.end], [20, 124])
  assert.deepEqual(h3Stretch(late), { start: 34, end: 124, from: 1.417, to: 5.167, frames: 90 }, 'a closing stretch keeps its end')
  assert.equal(h3Stretch({ start: 0, end: 21 }), null, 'too short for H3')
})
await ok('prompts that ask for cuts are left alone', () => {
  assert.equal(asksForCuts('[Shot 1] Wide. [Shot 2] Close-up.'), true)
  assert.equal(asksForCuts('At 00:03 it cuts to a close-up of her face.'), true)
  assert.equal(asksForCuts('[Shot 1] One continuous take of Tess at the bus stop.'), false)
  assert.equal(asksForCuts('She cuts the bread.'), false)
})
await ok('frames held: grey difference against the HELD line', () => {
  assert.equal(greyDiff(Buffer.from([10, 20, 30]), Buffer.from([12, 18, 30])), 1.3)
  assert.equal(greyDiff(null, Buffer.from([1])), null)
  assert.equal(HELD, 12)
})
const ff = ffmpegStatic.ffmpegPath.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`)
await ok('real clips: a hard cut is found, a dissolve is missed (as documented), a held first frame is seen', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ivs-cuts-'))
  const mk = (name, args) => {
    const r = spawnSync(ff, ['-y', '-hide_banner', '-loglevel', 'error', ...args, path.join(dir, name)], { windowsHide: true })
    assert.equal(r.status, 0, String(r.stderr))
    return path.join(dir, name)
  }
  const src = ['-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=24:d=2', '-f', 'lavfi', '-i', 'mandelbrot=s=320x180:r=24']
  const hard = mk('hard.mp4', [...src, '-filter_complex', '[1]trim=duration=2,setpts=PTS-STARTPTS[b];[0][b]concat=n=2:v=1[v]', '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p'])
  const dissolve = mk('dissolve.mp4', [...src, '-filter_complex', '[1]trim=duration=2,setpts=PTS-STARTPTS[b];[0][b]xfade=transition=fade:duration=1:offset=1[v]', '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p'])
  const first = mk('first.png', ['-i', hard, '-frames:v', '1'])
  const other = mk('other.png', ['-f', 'lavfi', '-i', 'color=c=red:s=320x180', '-frames:v', '1'])
  const r = new Ranker({ studio: () => null, dataDir: dir, ffmpeg: ff })
  const h = await r.cuts(hard)
  assert.equal(h.cuts.length, 1, JSON.stringify(h.cuts))
  assert.ok(Math.abs(h.cuts[0].time - 2) < 0.1)
  assert.deepEqual([h.clean.start, h.clean.end], [0, 48])
  assert.equal(h.h3.frames, 39)
  const d = await r.cuts(dissolve)
  assert.equal(d.cuts.length, 0, 'a dissolve is not caught')
  const held = await r.heldFrames(hard, first, other, { width: 320, height: 180 })
  assert.equal(held.opens.held, true, JSON.stringify(held))
  assert.equal(held.ends.held, false, JSON.stringify(held))
  fs.rmSync(dir, { recursive: true, force: true })
})
const clip = process.argv[2]
if (clip && fs.existsSync(clip))
  await ok('a real clip is measured: blur and frozen time', async () => {
    const r = new Ranker({ studio: () => null, dataDir: os.tmpdir(), ffmpeg: ffmpegStatic.ffmpegPath.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`) })
    const m = await r.measure(clip)
    assert.ok(m.blur > 0 && m.duration > 1 && m.frozen >= 0, JSON.stringify(m))
    console.log(`    ${path.basename(clip)}: ${JSON.stringify(m)}`)
  })
await ok('live previews: the preview guider gets the model through KJ\'s preview node; nothing else changes', () => {
  const g = { 8: { class_type: 'BlockSparseAttention', inputs: {} }, 14: { class_type: 'BasicGuider', inputs: { model: ['8', 0] } }, 26: { class_type: 'BasicGuider', inputs: { model: ['8', 0] } } }
  const out = withLivePreview(g)
  assert.deepEqual(out[14].inputs.model, ['iv_live', 0])
  assert.deepEqual(out.iv_live.inputs.model, ['8', 0])
  assert.equal(out.iv_live.inputs.tiny_vae, 'taeh3.safetensors')
  assert.deepEqual(out[26].inputs.model, ['8', 0], 'the 2 MP pass is untouched')
  assert.deepEqual(g[14].inputs.model, ['8', 0], 'the original graph is not changed')
  assert.deepEqual(withLivePreview(out), out, 'wrapping twice does nothing')
  const fin = withLivePreview(g, { guiders: ['14', '26'], size: 640 })
  assert.deepEqual(fin[14].inputs.model, ['iv_live', 0], 'a finish: the preview guider, for a re-rendered preview')
  assert.deepEqual(fin[26].inputs.model, ['iv_live', 0], 'a finish: the 2 MP pass')
  assert.equal(fin.iv_live.inputs.max_resolution, 640)
  assert.deepEqual(withLivePreview({ 8: g[8], 26: g[26] }, { guiders: ['14', '26'] })[26].inputs.model, ['iv_live', 0], 'a guider missing from the graph is skipped')
  const caps = (opts) => capabilities({ ModelPreviewOverrideKJ: { input: { optional: { tiny_vae: ['COMBO', { options: opts }] } } } }, { system: { os: 'win32' } })
  assert.equal(caps(['none', 'taeh3.safetensors']).livePreview, true)
  assert.equal(caps(['none']).livePreview, false)
})
console.log(`${n} checks passed`)
