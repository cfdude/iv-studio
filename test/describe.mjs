// Library search by what's in a file (src/service/describe.js): frames are read with the bundled ffmpeg, a stand-in
// writer answers, and the describer only works when it's on, ComfyUI is idle and the writer can see.
//   node test/describe.mjs
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import ffmpegStatic from 'ffmpeg-ffprobe-static'
import { Describer, kindOf, searchText, tidy } from '../src/service/describe.js'

let n = 0
const ok = async (name, fn) => {
  await fn()
  n++
  console.log(`ok  ${name}`)
}
const ff = ffmpegStatic.ffmpegPath.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`)
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ivs-desc-'))
const mk = (name, args) => {
  const r = spawnSync(ff, ['-y', '-hide_banner', '-loglevel', 'error', ...args, path.join(root, name)], { windowsHide: true })
  assert.equal(r.status, 0, String(r.stderr))
  return path.join(root, name)
}
const clip = mk('red car.mp4', ['-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=24:d=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p'])
const pic = mk('beach.png', ['-f', 'lavfi', '-i', 'color=c=orange:s=320x180', '-frames:v', '1'])
const song = path.join(root, 'song.wav')
fs.writeFileSync(song, 'x')

let idle = true
let on = true
let vision = true
const asked = []
let answer = { sentence: '  A red car  drives past a beach at night.  ', tags: ['Car', 'car', 'Beach!', 'night', ''] }
const d = new Describer({
  dataDir: root,
  ffmpeg: ff,
  files: () => [{ path: clip, type: 'video' }, { path: pic, type: 'image' }, { path: song, type: 'music' }],
  idle: async () => idle,
  enabled: () => on,
  writer: async () => ({ name: 'stand-in', vision }),
  chat: async (req) => (asked.push(req), typeof answer === 'function' ? answer(req) : answer)
})

await ok('which files, and a tidy answer', () => {
  assert.deepEqual([kindOf(clip), kindOf(pic), kindOf(song)], ['video', 'image', null])
  assert.deepEqual(tidy({ sentence: ' x  y ', tags: ['A', 'a', 'b c', '!!'] }), { sentence: 'x y', tags: ['a', 'b c'] })
  assert.throws(() => tidy({ sentence: '' }), /no description/)
  assert.equal(searchText({ sentence: 'A cat.', tags: ['cat', 'sofa'] }), 'A cat. cat sofa')
})
await ok('three frames from a clip, one from a picture', async () => {
  assert.equal((await d.frames(clip)).length, 3)
  assert.equal((await d.frames(pic)).length, 1)
  assert.ok(Buffer.from((await d.frames(pic))[0], 'base64').subarray(0, 2).equals(Buffer.from([0xff, 0xd8])), 'JPEG')
})
await ok('nothing while off or while ComfyUI is busy', async () => {
  on = false
  assert.deepEqual(await d.tick(), { skipped: 'off' })
  on = true
  idle = false
  assert.deepEqual(await d.tick(), { skipped: 'rendering' })
  idle = true
  assert.equal(asked.length, 0)
})
await ok('one file a tick, newest first, kept and found by search text', async () => {
  const r = await d.tick()
  assert.equal(r.described, clip)
  assert.equal(asked[0].messages[0].images.length, 3)
  assert.equal(asked[0].model, 'stand-in')
  assert.deepEqual(d.about(clip), { sentence: 'A red car drives past a beach at night.', tags: ['car', 'beach', 'night'] })
  assert.equal(d.status().described, 1)
  assert.equal(d.status().total, 2, 'sound files are left out')
  await d.tick()
  assert.equal(asked[1].messages[0].images.length, 1)
  assert.deepEqual(await d.tick(), { skipped: 'done' })
  const again = new Describer({ dataDir: root, ffmpeg: ff, files: () => [], idle: async () => true, enabled: () => true, writer: async () => ({}), chat: async () => ({}) })
  assert.ok(again.about(pic), 'the index is kept in the data folder')
})
await ok('a changed file is described again', async () => {
  const t = new Date(Date.now() + 5000)
  fs.utimesSync(pic, t, t)
  assert.equal(d.about(pic), null)
  assert.equal((await d.tick()).described, pic)
})
await ok('a render starting stops the description in flight; it is done later', async () => {
  fs.utimesSync(clip, new Date(Date.now() + 9000), new Date(Date.now() + 9000))
  answer = (req) => new Promise((resolve, reject) => req.signal.addEventListener('abort', () => reject(new Error('aborted'))))
  const p = d.tick()
  await new Promise((r) => setTimeout(r, 300))
  d.pause()
  assert.deepEqual(await p, { skipped: 'paused' })
  assert.equal(d.about(clip), null)
  answer = { sentence: 'Coloured test bars.', tags: ['test'] }
  assert.equal((await d.tick()).described, clip)
})
await ok('a writer that can’t see pictures: said once, then a rest', async () => {
  fs.utimesSync(clip, new Date(Date.now() + 15000), new Date(Date.now() + 15000))
  vision = false
  const r = await d.tick()
  assert.match(r.error, /can't see pictures/)
  assert.match(d.status().error, /Settings → Prompt writer/)
  assert.deepEqual(await d.tick(), { skipped: 'resting' })
})
fs.rmSync(root, { recursive: true, force: true })
console.log(`${n} checks passed`)
