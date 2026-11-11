// An edit out to Premiere, Resolve and Final Cut (src/service/interchange.js): FCP 7 XML, FCPXML 1.10, a CMX3600 EDL,
// the media copied beside them and the folder zipped. The files are read back: well-formed XML, the right frames,
// tracks and paths, and a zip whose every entry matches its file.
//   node test/interchange.mjs
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import ffmpegStatic from 'ffmpeg-ffprobe-static'
import { cmx3600, exportInterchange, fcp7Xml, fcpxml, timecode } from '../src/service/interchange.js'

let n = 0
const ok = async (name, fn) => {
  await fn()
  n++
  console.log(`ok  ${name}`)
}
const ff = ffmpegStatic.ffmpegPath.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`)
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ivs-xchg-'))
const mk = (name, args) => {
  const r = spawnSync(ff, ['-y', '-hide_banner', '-loglevel', 'error', ...args, path.join(dir, name)], { windowsHide: true })
  assert.equal(r.status, 0, String(r.stderr))
  return path.join(dir, name)
}
const shot = mk('shot one.mp4', ['-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=24:d=5', '-f', 'lavfi', '-i', 'sine=f=440:d=5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest'])
const shot2 = mk('shot & two.mp4', ['-f', 'lavfi', '-i', 'mandelbrot=s=320x180:r=24', '-t', '4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p'])
const song = mk('song.wav', ['-f', 'lavfi', '-i', 'sine=f=220:d=8'])
const still = mk('still.png', ['-f', 'lavfi', '-i', 'color=c=blue:s=320x180', '-frames:v', '1'])

const edit = {
  id: 'e1',
  name: 'The Seed · rough cut',
  settings: { format: '1080p', fps: 24 },
  tracks: [
    { id: 'T1', kind: 'text' },
    { id: 'V2', kind: 'video', hidden: true },
    { id: 'V1', kind: 'video' },
    { id: 'A1', kind: 'audio', locked: true },
    { id: 'A2', kind: 'audio', muted: true }
  ],
  media: {
    m1: { id: 'm1', name: 'shot one.mp4', path: shot, kind: 'video', width: 320, height: 180, duration: 5, fps: 24, hasAudio: true },
    m2: { id: 'm2', name: 'shot & two.mp4', path: shot2, kind: 'video', width: 320, height: 180, duration: 4, fps: 24, hasAudio: false },
    m3: { id: 'm3', name: 'song.wav', path: song, kind: 'audio', duration: 8 },
    m4: { id: 'm4', name: 'still.png', path: still, kind: 'image', width: 320, height: 180 }
  },
  clips: [
    { id: 'c1', track: 'V1', media: 'm1', start: 0, in: 1, out: 4 }, // 3 s from 1 s in
    { id: 'c2', track: 'V1', media: 'm2', start: 4, in: 0, out: 2.5 }, // after a 1 s gap
    { id: 'c3', track: 'V2', media: 'm4', start: 1, in: 0, out: 1.5 },
    { id: 'c4', track: 'A1', media: 'm3', start: 0, in: 0, out: 6.5, volume: 0.5 },
    { id: 'c5', track: 'T1', start: 0.5, in: 0, out: 2, text: { content: 'The Seed <one>', size: 8 } }
  ],
  markers: [{ id: 'k1', t: 2, label: 'Look here' }]
}

// a tiny well-formedness check: every tag closes in order
function wellFormed(xml) {
  const body = xml.replace(/<\?xml[^>]*\?>/, '').replace(/<!DOCTYPE[^>]*>/, '')
  const stack = []
  for (const m of body.matchAll(/<(\/?)([A-Za-z][\w:-]*)([^>]*?)(\/?)>/g)) {
    if (m[4]) continue
    if (m[1]) assert.equal(stack.pop(), m[2], `</${m[2]}> closes the wrong tag`)
    else stack.push(m[2])
  }
  assert.deepEqual(stack, [], 'every tag closes')
  assert.ok(!/&(?!amp;|lt;|gt;|quot;|apos;)/.test(body), 'ampersands are escaped')
}
const all = (xml, re) => [...xml.matchAll(re)].map((m) => m[1])

await ok('timecode', () => {
  assert.equal(timecode(0, 24), '00:00:00:00')
  assert.equal(timecode(24 * 3661 + 5, 24), '01:01:01:05')
})
await ok('FCP 7 XML: tracks, frames, trims, the clip sound linked, volume, hidden and locked tracks, markers', () => {
  const x = fcp7Xml(edit)
  wellFormed(x)
  assert.match(x, /<xmeml version="4">/)
  assert.match(x, /<sequence id="sequence-1"><name>The Seed · rough cut<\/name><duration>156<\/duration>/, '6.5 s at 24 fps')
  const video = x.slice(x.indexOf('<video><format>'), x.indexOf('</video><audio><numOutputChannels>'))
  const tracks = video.split('<track>').slice(1)
  assert.equal(tracks.length, 2, 'V1 and V2')
  assert.match(tracks[0], /<start>0<\/start><end>72<\/end><in>24<\/in><out>96<\/out>/, 'V1 clip 1: 3 s from 1 s in')
  assert.match(tracks[0], /<start>96<\/start><end>156<\/end><in>0<\/in><out>60<\/out>/, 'V1 clip 2 after the gap')
  assert.match(tracks[1], /^<enabled>FALSE<\/enabled>/, 'V2 is hidden')
  assert.match(tracks[1], /<stillframe>TRUE<\/stillframe>/)
  const audio = x.slice(x.indexOf('</video><audio><numOutputChannels>'))
  const atracks = audio.split('<track>').slice(1)
  assert.equal(atracks.length, 3, 'V1 sound, A1, A2')
  assert.match(atracks[0], /<linkclipref>clipitem-c1-v<\/linkclipref>/, 'the shot\'s sound is linked to its picture')
  assert.match(atracks[1], /<locked>TRUE<\/locked>/)
  assert.match(atracks[1], /<value>0\.50000<\/value>/, 'A1 at half volume')
  assert.match(atracks[2], /^<enabled>FALSE<\/enabled>/, 'A2 is muted')
  assert.equal(all(x, /<pathurl>([^<]+)<\/pathurl>/g).length, 4, 'each file written once, then referred to')
  assert.ok(all(x, /<pathurl>([^<]+)<\/pathurl>/g).every((u) => u.startsWith('file://localhost/')))
  assert.match(x, /shot%20&amp;%20two\.mp4|shot%20%26%20two\.mp4/, 'paths are URLs')
  assert.match(x, /<marker><name>Look here<\/name><comment><\/comment><in>48<\/in>/)
  assert.match(x, /<name>Title: The Seed &lt;one&gt;<\/name>/)
})
await ok('FCPXML 1.10: V1 as the storyline with a gap, the rest connected in lanes, a title, volume in dB', () => {
  const x = fcpxml(edit)
  wellFormed(x)
  assert.match(x, /<fcpxml version="1\.10">/)
  assert.match(x, /<format id="r1"[^>]*frameDuration="1\/24s" width="1920" height="1080"/)
  const spine = x.slice(x.indexOf('<spine>'), x.indexOf('</spine>'))
  assert.match(spine, /^<spine><asset-clip ref="r\d+" offset="0s" name="shot one.mp4" start="24\/24s" duration="72\/24s">/)
  assert.match(spine, /<gap name="Gap" offset="72\/24s" start="0s" duration="24\/24s">/)
  assert.match(spine, /<asset-clip ref="r\d+" offset="96\/24s" name="shot &amp; two.mp4" start="0s" duration="60\/24s">/)
  assert.match(spine, /<video ref="r\d+" lane="1" offset="48\/24s"[^>]*enabled="0"\/>/, 'the picture on V2, hidden, offset in its parent\'s time (24 + 24)')
  assert.match(spine, /<asset-clip ref="r\d+" lane="-1" offset="24\/24s" name="song.wav" start="0s" duration="156\/24s"><adjust-volume amount="-6.02dB"\/>/)
  assert.match(spine, /<title ref="r\d+" lane="2" offset="36\/24s"[^>]*><text><text-style ref="ts1">The Seed &lt;one&gt;<\/text-style>/)
  assert.match(spine, /<marker start="72\/24s" duration="1\/24s" value="Look here"\/>/)
  assert.equal((x.match(/<asset id=/g) || []).length, 4, 'four files as assets; the picture too')
  assert.ok(all(x, /src="([^"]+)"/g).every((u) => u.startsWith('file:///')))
})
await ok('EDL: V1 only, source and record timecodes, the file named', () => {
  const t = cmx3600(edit)
  assert.match(t, /^TITLE: The Seed  rough cut\r\nFCM: NON-DROP FRAME/)
  assert.match(t, /001 {2}AX {7}V {5}C {8}00:00:01:00 00:00:04:00 00:00:00:00 00:00:03:00/)
  assert.match(t, /002 {2}AX {7}V {5}C {8}00:00:00:00 00:00:02:12 00:00:04:00 00:00:06:12/)
  assert.match(t, /\* FROM CLIP NAME: shot & two\.mp4/)
  assert.ok(!/song\.wav|still\.png/.test(t), 'only V1')
})
await ok('the folder, the media copies and the zip', async () => {
  const out = path.join(dir, 'out')
  const r = await exportInterchange(edit, out, { stamp: new Date('2026-11-10T12:00:00Z') })
  assert.equal(path.basename(r.folder), 'The Seed - rough cut - for Premiere and Resolve 2026-11-10-12-00')
  assert.equal(r.media.length, 4)
  const sizes = (list) => list.map((f) => fs.statSync(f).size).sort((a, b) => a - b)
  assert.deepEqual(sizes(r.media), sizes(Object.values(edit.media).map((m) => m.path)), 'every file copied whole')
  assert.ok(fs.readFileSync(r.xml, 'utf8').includes(`${path.basename(r.folder).replace(/ /g, '%20')}/Media/shot%20one.mp4`), 'the XML points at the copies')
  assert.ok(fs.readFileSync(r.fcpxml, 'utf8').includes('/Media/song.wav'))
  assert.match(fs.readFileSync(r.readme, 'utf8'), /Not carried over: fades/)
  // read the zip back: central directory, then each entry against its file
  const z = fs.readFileSync(r.zip)
  const end = z.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  const count = z.readUInt16LE(end + 10)
  let at = z.readUInt32LE(end + 16)
  assert.equal(count, 8, '4 timeline files and 4 media')
  for (let i = 0; i < count; i++) {
    assert.equal(z.readUInt32LE(at), 0x02014b50)
    const method = z.readUInt16LE(at + 10)
    const crc = z.readUInt32LE(at + 16)
    const comp = z.readUInt32LE(at + 20)
    const nlen = z.readUInt16LE(at + 28)
    const local = z.readUInt32LE(at + 42)
    const name = z.subarray(at + 46, at + 46 + nlen).toString('utf8')
    const lnlen = z.readUInt16LE(local + 26)
    const data = z.subarray(local + 30 + lnlen, local + 30 + lnlen + comp)
    const raw = method === 8 ? zlib.inflateRawSync(data) : data
    const src = name.includes('/Media/') ? path.join(r.folder, 'Media', path.basename(name)) : path.join(r.folder, path.basename(name))
    assert.ok(raw.equals(fs.readFileSync(src)), `${name} matches`)
    assert.equal(zlib.crc32 ? zlib.crc32(raw) : crc, crc)
    at += 46 + nlen
  }
})
await ok('an empty timeline and a missing file are refused', async () => {
  await assert.rejects(() => exportInterchange({ ...edit, clips: [] }, dir), /empty/)
  await assert.rejects(() => exportInterchange({ ...edit, media: { ...edit.media, m3: { ...edit.media.m3, path: path.join(dir, 'gone.wav') } } }, dir), /Missing files: song\.wav/)
})
fs.rmSync(dir, { recursive: true, force: true })
console.log(`${n} checks passed`)
