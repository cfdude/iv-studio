// Soft mouth (src/service/softmouth.js): the blur goes only where the mask is, the sound is kept, and a shot that
// speaks never gets it. The face tracker (resources/python/mouth_track.py) needs Shinobi's Python and the face
// models; pass that Python and the buffalo_l folder to run it on a clip too:
//   node test/softmouth.mjs [python] [buffalo_l folder] [a video with a face]
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import ffmpegStatic from 'ffmpeg-ffprobe-static'
import { blurFor, SoftMouth, softMouthArgs, speaks } from '../src/service/softmouth.js'

let n = 0
const ok = async (name, fn) => {
  await fn()
  n++
  console.log(`ok  ${name}`)
}
const ff = ffmpegStatic.ffmpegPath.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`)
const ffprobe = ffmpegStatic.ffprobePath.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`)
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ivs-soft-'))
const mk = (name, args) => {
  const r = spawnSync(ff, ['-y', '-hide_banner', '-loglevel', 'error', ...args, path.join(root, name)], { windowsHide: true })
  assert.equal(r.status, 0, String(r.stderr))
  return path.join(root, name)
}
// one frame as grey bytes
const grey = (file, at = 0.5) => spawnSync(ff, ['-v', 'error', '-ss', String(at), '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { windowsHide: true, maxBuffer: 1 << 26 }).stdout
const detail = (buf, w, x0, y0, x1, y1) => {
  // how much neighbouring pixels differ: high for a sharp pattern, low once blurred
  let s = 0
  let c = 0
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1 - 1; x++) {
      s += Math.abs(buf[y * w + x] - buf[y * w + x + 1])
      c++
    }
  return s / c
}

await ok('a shot that speaks keeps its mouth', () => {
  assert.equal(speaks({ prompt: 'She (S1) says: <d>[English] Hello.</d>' }), true)
  assert.equal(speaks({ prompt: 'No words here.', voiceLine: 'C:/line.wav' }), true)
  assert.equal(speaks({ prompt: 'A woman waits at a bus stop. No one speaks.' }), false)
  assert.equal(speaks({ prompt: '<d></d>' }), false, 'an empty tag says nothing')
})
await ok('the blur sits under the mask only, and the sound is kept', async () => {
  const W = 320
  const H = 180
  const src = mk('src.mp4', ['-f', 'lavfi', '-i', `testsrc2=s=${W}x${H}:r=24:d=2`, '-f', 'lavfi', '-i', 'sine=f=440:d=2', '-c:v', 'libx264', '-crf', '10', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest'])
  // a white ellipse-ish box on the right half, black elsewhere, as mouth_track.py would write it
  const mask = mk('mask.mkv', ['-f', 'lavfi', '-i', `color=c=black:s=${W}x${H}:r=24:d=2`, '-vf', `drawbox=x=200:y=40:w=100:h=100:color=white:t=fill,format=gray`, '-c:v', 'ffv1'])
  const out = path.join(root, 'out.mp4')
  const r = spawnSync(ff, softMouthArgs({ src, mask, out, width: W }), { windowsHide: true })
  assert.equal(r.status, 0, String(r.stderr))
  const a = grey(src)
  const b = grey(out)
  const inside = [detail(a, W, 215, 55, 285, 125), detail(b, W, 215, 55, 285, 125)]
  const outside = [detail(a, W, 20, 55, 90, 125), detail(b, W, 20, 55, 90, 125)]
  assert.ok(inside[1] < inside[0] * 0.5, `blurred under the mask: ${inside.map((x) => x.toFixed(2))}`)
  assert.ok(Math.abs(outside[1] - outside[0]) < outside[0] * 0.15, `untouched elsewhere: ${outside.map((x) => x.toFixed(2))}`)
  const streams = spawnSync(ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', out], { encoding: 'utf8' }).stdout.trim().split(/\s+/)
  assert.deepEqual(streams.sort(), ['audio', 'video'])
  assert.equal(blurFor(320), 8)
  assert.equal(blurFor(1920), 43)
})
await ok('without Shinobi’s Python or the face models it says what to set up', async () => {
  const none = new SoftMouth({ dataDir: root, ffmpeg: ff, shinobi: () => ({ installed: () => false }), resourcesDir: 'resources' })
  assert.match(none.ready().why, /Shinobi/)
  const noFaces = new SoftMouth({ dataDir: root, ffmpeg: ff, shinobi: () => ({ installed: () => true, faceModelsReady: () => false }), resourcesDir: 'resources' })
  assert.match(noFaces.ready().why, /face models/)
  await assert.rejects(() => noFaces.make(path.join(root, 'src.mp4')), /face models/)
})
const [py, faces, clip] = process.argv.slice(2)
if (py && faces && clip)
  await ok('a real clip: the tracker finds the face and the copy is made', async () => {
    const s = new SoftMouth({ dataDir: root, ffmpeg: ff, shinobi: () => ({ installed: () => true, faceModelsReady: () => true, python: py, faceDir: faces, env: () => process.env }), resourcesDir: path.resolve('resources') })
    const r = await s.make(clip)
    assert.ok(r.withFace > 0 && fs.existsSync(r.path), JSON.stringify(r))
    console.log(`    ${path.basename(clip)}: a face in ${r.withFace} of ${r.frames} frames`)
    assert.equal((await s.make(clip)).path, r.path, 'made once')
  })
fs.rmSync(root, { recursive: true, force: true })
console.log(`${n} checks passed`)
