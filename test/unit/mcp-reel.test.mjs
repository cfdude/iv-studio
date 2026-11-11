// MCP make_reel (task 5.7, part 4): pictures and clips cut to a song's beat as a new edit, called through the real MCP
// server on source under the test guard. No ComfyUI is involved: the beat is found from the song by the bundled ffmpeg.
// The song is a click every half second (120 BPM); the pictures are small solid colours.
//   node --test test/unit/mcp-reel.test.mjs
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import ffmpegStatic from 'ffmpeg-ffprobe-static'
import { startMcp } from '../fakes/mcp.mjs'

describe('MCP make_reel', () => {
  let mcp, pics, clip, clicks, drone
  const call = (name, args = {}) => mcp.client.callTool({ name, arguments: args })
  const ok = async (name, args = {}) => {
    const r = await call(name, args)
    assert.ok(!r.isError, `${name}: ${JSON.stringify(r.content)}`)
    return r.structuredContent
  }
  const fails = async (name, args, pattern) => {
    const r = await call(name, args)
    assert.equal(r.isError, true, `${name} should have failed`)
    assert.match(r.content[0].text, pattern)
  }
  const ff = (...args) => execFileSync(ffmpegStatic.ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args])

  before(async () => {
    mcp = await startMcp({ comfyUrl: 'http://127.0.0.1:1' })
    const dir = path.join(path.dirname(mcp.dataDir), 'fixtures')
    fs.mkdirSync(dir, { recursive: true })
    pics = ['red', 'green', 'blue', 'yellow'].map((c) => path.join(dir, `${c}.png`))
    pics.forEach((p, i) => ff('-f', 'lavfi', '-i', `color=c=${['red', 'green', 'blue', 'yellow'][i]}:s=96x54`, '-frames:v', '1', p))
    clip = path.join(dir, 'clip.mp4')
    ff('-f', 'lavfi', '-i', 'testsrc=s=96x54:r=24:d=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clip)
    clicks = path.join(dir, 'clicks.wav')
    ff('-f', 'lavfi', '-i', "aevalsrc='if(lt(mod(t,0.5),0.03),sin(2*PI*1000*t),0)':s=22050:d=12", clicks)
    drone = path.join(dir, 'drone.wav')
    ff('-f', 'lavfi', '-i', 'anoisesrc=d=12:c=pink:a=0.3:s=11025', drone)
  })
  after(async () => {
    await mcp?.close()
  })

  test('[mcp:make_reel][ipc:reels:make] cuts the pictures and a clip to the song\'s beat as a new edit with the song on A1, fading out at the end', async () => {
    const r = await ok('make_reel', { items: [pics[0], pics[1], clip, pics[2]], song: clicks, pace: 'normal', format: 'square', name: 'My reel' })
    assert.ok(Math.abs(r.bpm - 120) < 3, `tempo ${r.bpm}`)
    assert.ok(r.strength >= 0.3, `a clear pulse, ${r.strength}`)
    assert.equal(r.beatsPer, 4, 'a slot is 4 beats (2 s) at 120 BPM, the nearest to normal pace')
    assert.equal(r.used, 4)
    assert.equal(r.left, 0)
    const e = await ok('get_edit', { editId: r.editId })
    assert.equal(e.name, 'My reel')
    assert.equal(e.settings.format, 'square')
    assert.equal(e.tracks.V1.length, 4)
    const starts = e.tracks.V1.map((c) => c.start)
    assert.equal(starts[0], 0)
    for (const s of starts.slice(1)) assert.ok(Math.abs((s / 0.5) - Math.round(s / 0.5)) < 0.15, `cut at ${s} is on a beat`)
    assert.ok(starts[1] > 1.9 && starts[1] < 2.6, `the first slot runs to the first beat after half a slot, ${starts[1]}`)
    for (let k = 2; k < starts.length; k++) assert.ok(Math.abs(starts[k] - starts[k - 1] - 2) < 0.1, `slot ${k} is 4 beats, 2 s`)
    assert.equal(e.tracks.A1.length, 1)
    assert.ok(e.tracks.A1[0].fadeOut > 0, 'the song fades out')
    assert.ok(Math.abs(r.seconds - e.tracks.V1.at(-1).end) < 0.05, 'the reel ends with its last picture')
    // each picture became a short moving clip at the format's size; the clip was used as it was
    const made = e.media.filter((m) => m.path.startsWith(path.join(mcp.dataDir, 'reels'))).sort((a, b) => a.name.localeCompare(b.name)) // media come back in the order of their random ids
    assert.deepEqual(made.map((m) => [m.name, m.width, m.height]), [['000.mp4', 1080, 1080], ['001.mp4', 1080, 1080], ['003.mp4', 1080, 1080]])
    assert.ok(e.media.some((m) => m.path === clip), 'the video clip is not re-made')
  })

  test('[mcp:make_reel] ends with the length asked for and says how many pictures were left out', async () => {
    const r = await ok('make_reel', { items: pics, song: clicks, pace: 'fast', length: 4 })
    assert.ok(r.seconds <= 4.05, `ends by 4 s, ran ${r.seconds}`)
    assert.ok(r.used < 4 && r.used >= 2, `used ${r.used}`)
    assert.equal(r.left, 4 - r.used)
    const e = await ok('get_edit', { editId: r.editId })
    assert.equal(e.tracks.V1.length, r.used)
    assert.equal(e.name, 'Reel')
  })

  test('[mcp:make_reel] cuts a song with no clear beat at an even pace and says so with a low strength', async () => {
    const r = await ok('make_reel', { items: [pics[0], pics[1], pics[2]], song: drone, pace: 'calm', length: 6 })
    assert.ok(r.strength < 0.3, `no pulse, ${r.strength}`)
    assert.equal(r.beatsPer, 0)
    const e = await ok('get_edit', { editId: r.editId })
    assert.deepEqual(e.tracks.V1.map((c) => c.start), [0, 3.2], 'about 3.2 s a picture, from the start of the song')
  })

  test('[mcp:make_reel] says what is missing: no pictures, no song, a file that is not there, a format it does not make', async () => {
    await fails('make_reel', { items: [], song: clicks }, /items|at least|Add some pictures/i)
    await fails('make_reel', { items: [pics[0]], song: path.join(path.dirname(clicks), 'gone.wav') }, /Pick a song\./)
    await fails('make_reel', { items: [path.join(path.dirname(clicks), 'gone.png')], song: clicks }, /Not found: .*gone\.png/)
    await fails('make_reel', { items: [pics[0]], song: clicks, pace: 'slow' }, /pace/i)
    await fails('make_reel', { items: [pics[0]], song: clicks, format: '4k' }, /format/i)
    await fails('make_reel', { items: [pics[0]], song: clicks, length: 1 }, /length/i)
  })
})
