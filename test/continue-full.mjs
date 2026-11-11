// Continue a video from Create (plan.js continueFull): takes like any shot, and the full finish (the picked take's
// 2 MP pass with the source scaled up and joined back on). The app's own chains (Extend, one-take film shots,
// sequences) keep one take and the one-pass finish. Also the last frame of a video saved as a picture
// (images.js lastFrame), exact to the final frame.  node test/continue-full.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import ffmpegStatic from 'ffmpeg-ffprobe-static'
import { planFinish, planPreviews } from '../src/service/plan.js'
import { buildPrompt, checkPrompt } from '../src/service/graph.js'
import { Images } from '../src/service/images.js'

const template = JSON.parse(fs.readFileSync('resources/workflows/iv_studio_api.json', 'utf8'))
const meta = JSON.parse(fs.readFileSync('resources/workflows/iv_studio_api.groups.json', 'utf8'))
const chars = [{ id: 'tess', name: 'Tess', lora: 'tess.safetensors', strength: 0.8, trigger: 't3ss4' }]
const base = { mode: 'continue', prompt: '{char} keeps walking.', character: 'tess', media: [{ kind: 'video', file: 'iv_studio/src.mp4' }] }

let n = 0
let failed = 0
const ok = async (name, fn) => {
  n++
  try {
    await fn()
    console.log('ok', name)
  } catch (err) {
    failed++
    console.log('FAIL', name, '-', err.message)
  }
}
const graph = (plan) => {
  const g = buildPrompt(template, meta, plan.groups, plan.values)
  const problems = checkPrompt(g)
  assert.deepEqual(problems, [], problems.join('; '))
  return g
}

await ok("the app's own continue: one take, whatever was asked", () => {
  const p = planPreviews({ ...base, previews: 3 }, chars)
  assert.equal(p.resolved.previews, 1)
})

await ok('a Create continue (continueFull) hunts 1-3 takes', () => {
  for (const k of [1, 2, 3]) assert.equal(planPreviews({ ...base, continueFull: true, previews: k }, chars).resolved.previews, k)
  const g = graph(planPreviews({ ...base, continueFull: true, previews: 3 }, chars))
  for (const id of ['15', '115', '125', '42', '118', '128']) assert.ok(g[id], `preview node ${id}`)
})

await ok('the old one-pass finish is unchanged for the chains', () => {
  const pre = planPreviews(base, chars)
  const f = planFinish(pre, { candidate: 1, megapixels: 2 })
  assert.ok(f.groups.includes('single') && !f.groups.includes('upscale') && !f.groups.includes('continue_full'))
  assert.equal(f.resolved.singlePass, true)
  assert.equal(f.resolved.width, pre.resolved.width)
  const g = graph(f)
  assert.ok(g['703'] && !g['30'] && !g['632'])
})

await ok('a Create continue gets the full finish for any take, joined to the source', () => {
  for (const candidate of [1, 2, 3]) {
    const pre = planPreviews({ ...base, continueFull: true, previews: 3 }, chars)
    const f = planFinish(pre, { candidate, megapixels: 2 })
    assert.ok(f.groups.includes('upscale') && f.groups.includes('continue_full') && !f.groups.includes('single'))
    assert.equal(f.resolved.singlePass, false)
    assert.equal(f.resolved.continued, true)
    assert.ok(f.resolved.width > pre.resolved.width, 'finish size is larger than the preview')
    const g = graph(f)
    // the 2 MP save takes the joined pictures and sound; the source is scaled to the 2 MP size
    assert.deepEqual(g['30'].inputs.images, ['632', 0])
    assert.deepEqual(g['30'].inputs.audio, ['633', 0])
    assert.deepEqual(g['632'].inputs.image2, ['28', 0])
    assert.deepEqual(g['630'].inputs.image, ['613', 0])
    assert.deepEqual(g['633'].inputs.audio1, ['616', 0])
    // the preview-size continued video is built from the picked take, not take 1
    const decode = { 1: '40', 2: '116', 3: '126' }[candidate]
    assert.deepEqual(g['615'].inputs.image2, [decode, 0])
    // the 2 MP pass uses the frame-free continuation conditioning
    assert.deepEqual(g['404']?.inputs && Object.values(g['404'].inputs).filter(Array.isArray).map((v) => v[0]), ['611'])
    assert.equal(g['703'], undefined)
  }
})

await ok('continueFinish single keeps the one-pass finish for a Create continue', () => {
  const pre = planPreviews({ ...base, continueFull: true, previews: 2 }, chars)
  const f = planFinish(pre, { candidate: 2, continueFinish: 'single' })
  assert.ok(f.groups.includes('single') && !f.groups.includes('continue_full'))
  const g = graph(f)
  assert.deepEqual(g['615'].inputs.image2, ['116', 0])
})

await ok('other modes are untouched by the continue values', () => {
  const pre = planPreviews({ ...base, mode: 'text', media: [], previews: 2 }, chars)
  const f = planFinish(pre, { candidate: 2 })
  assert.equal(f.values['30.images'], undefined)
  assert.equal(f.values['615.image2'], undefined)
  assert.ok(!f.groups.includes('continue_full'))
})

await ok('the last frame of a video is saved as a Library picture, exactly', async () => {
  const ffmpeg = ffmpegStatic.ffmpegPath
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-lastframe-'))
  try {
    // 48 frames at 24 fps: red for the first 47, the last one pure blue
    const vid = path.join(dir, 'clip_00001.mp4')
    const r = spawnSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=320x180:r=24:d=1.9583333', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=24:d=0.0416667', '-filter_complex', '[0:v][1:v]concat=n=2:v=1[v]', '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv444p', '-qp', '0', vid])
    assert.equal(r.status, 0, String(r.stderr))
    const studio = { localCopy: async (f) => (typeof f === 'string' ? f : f.path) }
    const images = new Images({ studio, dataDir: dir })
    const rec = await images.lastFrame({ file: { path: vid }, name: 'Test shot · last frame' })
    assert.equal(rec.mode, 'frame')
    assert.equal(rec.status, 'success')
    assert.equal(rec.files.length, 1)
    assert.ok(fs.existsSync(rec.files[0]))
    assert.equal(rec.width, 320)
    // the centre pixel is blue: the very last frame, not one near the end
    const px = spawnSync(ffmpeg, ['-v', 'error', '-i', rec.files[0], '-vf', 'crop=1:1:160:90', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
    const [R, G, B] = px.stdout
    assert.ok(B > 200 && R < 50, `rgb ${R},${G},${B}`)
    // listed with the other picture sets, and refresh leaves it as it is
    assert.equal(images.all()[0].id, rec.id)
    assert.deepEqual(await images.refresh(rec), rec)
    // asking again for the same video gives the same picture, not a second copy
    assert.equal((await images.lastFrame({ file: { path: vid } })).id, rec.id)
    assert.equal(images.all().length, 1)
    await assert.rejects(() => images.lastFrame({ file: { path: path.join(dir, 'missing.mp4') } }), /not on this PC/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

console.log(`${n - failed}/${n} passed`)
process.exit(failed ? 1 : 0)
