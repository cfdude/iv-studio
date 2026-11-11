// MCP tools upstream added in v1.1.3 for edits and takes: export_edit_for_editors, caption_edit, last_frame,
// use_clean_stretch, soften_mouth, and list_activity (what agents did). Called through the real MCP server on source
// under the test guard, against a fake ComfyUI on an Apple GPU. ffmpeg is the bundled one; every fixture is a few
// frames made in the temp folder. Upstream's own scripts for the same ground: test/edit-export.mjs,
// test/interchange.mjs, test/continue-full.mjs. Pricing, speeds and LoRA tools are in the sibling files
// mcp-edits-v113-pricing.test.mjs and mcp-edits-v113-loras.test.mjs.
//   node --test test/unit/mcp-edits-v113.test.mjs
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { after, before, describe, test } from 'node:test'
import ffmpegStatic from 'ffmpeg-ffprobe-static'
import { ENGINE, FACE_MODELS } from '../../src/service/shinobi.js'
import { startFakeComfy } from '../fakes/comfyui.mjs'
import { startMcp } from '../fakes/mcp.mjs'
import { MAC_VOICES_LATER } from '../../src/service/voiceengine.js'

const PROMPT = 'integrated_multimodal_description: [Shot 1] A woman walks along a rainy street.\n\noverall_soundscape: Rain on stone.\n\nnon_diegetic_music: N/A'
const TWO_SHOTS = 'integrated_multimodal_description: [Shot 1] A woman walks along a rainy street. [Shot 2] She turns to the camera.\n\noverall_soundscape: Rain on stone.\n\nnon_diegetic_music: N/A'
// a Mac has no local voice engine yet, so it is told that rather than pointed at a setup that refuses
const CAPTIONS_NEED_VOICES = process.platform === 'darwin' ? `Captions need the voice engine (its Whisper hears the words). ${MAC_VOICES_LATER}` : 'Captions need the voice engine (its Whisper hears the words). Ask the person to press Set up voices on Audio > Voices, or run setup_voices with their OK.'

describe('MCP edit export, captions, last frame, clean stretch, soft mouth and activity tools', () => {
  let fake, mcp, dir, clip, silent, still, song, redBlue
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
  const probe = (file, entries, ...more) => execFileSync(ffmpegStatic.ffprobePath, ['-v', 'error', ...more, '-show_entries', entries, '-of', 'csv=p=0', file]).toString().trim()
  const dataFile = (...p) => path.join(mcp.dataDir, ...p)
  const h264 = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p']
  // an edit with the fixtures in its media bin
  const withMedia = async (name, files = [clip, silent, still, song]) => {
    const e = await ok('create_edit', { name })
    const added = await ok('add_media', { editId: e.id, files })
    return { id: e.id, media: added.media }
  }
  const editsFolder = () => (fs.existsSync(dataFile('videos', 'Edits')) ? fs.readdirSync(dataFile('videos', 'Edits')) : [])
  // a zip read back: the entry names and bytes, inflating what was deflated
  const readZip = (file) => {
    const z = fs.readFileSync(file)
    const end = z.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
    const count = z.readUInt16LE(end + 10)
    let at = z.readUInt32LE(end + 16)
    const entries = {}
    for (let i = 0; i < count; i++) {
      assert.equal(z.readUInt32LE(at), 0x02014b50)
      const method = z.readUInt16LE(at + 10)
      const comp = z.readUInt32LE(at + 20)
      const nlen = z.readUInt16LE(at + 28)
      const local = z.readUInt32LE(at + 42)
      const name = z.subarray(at + 46, at + 46 + nlen).toString('utf8')
      const data = z.subarray(local + 30 + z.readUInt16LE(local + 26), local + 30 + z.readUInt16LE(local + 26) + comp)
      entries[name] = method === 8 ? zlib.inflateRawSync(data) : data
      at += 46 + nlen
    }
    return entries
  }
  const gif = (file) => ({ gifs: [{ filename: path.basename(file), subfolder: 'H3/previews', type: 'output', fullpath: file }] })
  // a previews job the fake has finished, with the given files as its takes, read back
  const finished = async (files, args = {}) => {
    const job = await ok('generate_previews', { prompt: PROMPT, character: 'none', previews: files.length, ...args })
    fake.state.history[job.promptId].outputs = Object.fromEntries(files.map((f, i) => [[42, 118, 128][i], gif(f)]))
    return ok('get_job', { jobId: job.id })
  }

  before(async () => {
    fake = await startFakeComfy({ devices: 'mps', os: 'darwin' })
    mcp = await startMcp({ comfyUrl: fake.url })
    dir = path.join(path.dirname(mcp.dataDir), 'fixtures')
    fs.mkdirSync(dir, { recursive: true })
    clip = path.join(dir, 'clip.mp4')
    silent = path.join(dir, 'silent.mp4')
    still = path.join(dir, 'still.png')
    song = path.join(dir, 'song.wav')
    redBlue = path.join(dir, 'red-blue.mp4')
    ff('-f', 'lavfi', '-i', 'testsrc=s=128x72:r=24:d=2', '-f', 'lavfi', '-i', 'sine=f=440:d=2', ...h264, '-c:a', 'aac', '-shortest', clip)
    ff('-f', 'lavfi', '-i', 'testsrc=s=128x72:r=24:d=2', '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono', '-t', '2', ...h264, '-c:a', 'aac', silent)
    ff('-f', 'lavfi', '-i', 'color=c=blue:s=128x72', '-frames:v', '1', still)
    ff('-f', 'lavfi', '-i', 'sine=f=330:d=3', song)
    // one second red, then one second blue: its last frame is blue
    ff('-f', 'lavfi', '-i', 'color=c=red:s=128x72:r=24:d=1', '-f', 'lavfi', '-i', 'color=c=blue:s=128x72:r=24:d=1', '-filter_complex', '[0:v][1:v]concat=n=2:v=1[v]', '-map', '[v]', ...h264, redBlue)
  })
  after(async () => {
    await mcp?.close()
    await fake?.close()
  })

  // ---------- export_edit_for_editors ----------
  test('[mcp:export_edit_for_editors] writes FCP 7 XML, FCPXML 1.10 and a CMX3600 EDL, copies the media beside them and zips the folder', async () => {
    const m = await withMedia('Cap: A/B? rough cut')
    const [video, , picture, audio] = m.media
    await ok('edit_timeline', {
      editId: m.id,
      ops: [
        { op: 'add_clip', media: video.id, in: 0.5, out: 1.5 },
        { op: 'add_clip', media: picture.id, duration: 1 },
        { op: 'add_clip', media: audio.id, track: 'A1', duration: 2 },
        { op: 'add_title', content: 'Hello <world>', start: 0.2, duration: 0.8 },
        { op: 'add_marker', at: 0.5, label: 'Look here' },
        { op: 'update_track', track: 'A1', locked: true }
      ]
    })
    const r = await ok('export_edit_for_editors', { editId: m.id })
    assert.equal(path.dirname(r.folder), dataFile('videos', 'Edits'), 'into Videos/IV Studio/Edits by default')
    assert.match(path.basename(r.folder), /^Cap AB rough cut - for Premiere and Resolve \d{4}-\d\d-\d\d-\d\d-\d\d$/, 'the colon, slash and question mark are left out of the name')
    assert.deepEqual(fs.readdirSync(r.folder).sort(), ['Cap AB rough cut (Premiere, Resolve).xml', 'Cap AB rough cut (Resolve, Final Cut).fcpxml', 'Cap AB rough cut V1.edl', 'Media', 'README.txt'].sort())
    assert.deepEqual([r.xml, r.fcpxml, r.edl, r.readme].map((f) => path.dirname(f)), [r.folder, r.folder, r.folder, r.folder])
    // every file the timeline uses is copied into Media (the media bin's silent clip is not on the timeline)
    assert.deepEqual(fs.readdirSync(path.join(r.folder, 'Media')).sort(), ['clip.mp4', 'song.wav', 'still.png'])
    assert.deepEqual(r.media.map((f) => path.basename(f)).sort(), ['clip.mp4', 'song.wav', 'still.png'])
    for (const f of r.media) assert.equal(fs.statSync(f).size, fs.statSync(path.join(dir, path.basename(f))).size, 'a copy, byte for byte in size')
    // FCP 7 XML: 2 s at 24 fps; V1 clip 1 is 1 s from 0.5 s in; the sound track is locked; the marker and the title come as markers
    const xml = fs.readFileSync(r.xml, 'utf8')
    assert.match(xml, /<xmeml version="4">/)
    assert.match(xml, /<sequence id="sequence-1"><name>Cap: A\/B\? rough cut<\/name><duration>48<\/duration>/)
    assert.match(xml, /<start>0<\/start><end>24<\/end><in>12<\/in><out>36<\/out>/, 'V1 clip 1: 1 s from 0.5 s in')
    assert.match(xml, /<locked>TRUE<\/locked>/)
    assert.match(xml, /<marker><name>Look here<\/name><comment><\/comment><in>12<\/in>/)
    assert.match(xml, /<name>Title: Hello &lt;world&gt;<\/name>/)
    assert.ok([...xml.matchAll(/<pathurl>([^<]+)<\/pathurl>/g)].every((x) => x[1].startsWith('file://localhost/') && x[1].includes('/Media/')), 'the timeline points at the copies in Media')
    // FCPXML 1.10
    const fcpxml = fs.readFileSync(r.fcpxml, 'utf8')
    assert.match(fcpxml, /<fcpxml version="1\.10">/)
    assert.match(fcpxml, /frameDuration="1\/24s" width="1920" height="1080"/)
    assert.match(fcpxml, /<text-style ref="ts1">Hello &lt;world&gt;<\/text-style>/)
    // markers sit in the clip's own time: its 0.5 s trim plus where the marker is (0.5 s; the title's 0.2 s, to the frame)
    assert.match(fcpxml, /<marker start="24\/24s" duration="1\/24s" value="Look here"\/>/)
    assert.match(fcpxml, /<marker start="17\/24s" duration="1\/24s" value="Title: Hello &lt;world&gt;"\/>/)
    // EDL: V1 only, source and record timecodes
    const edl = fs.readFileSync(r.edl, 'utf8')
    assert.match(edl, /^TITLE: Cap: A\/B\? rough cut\r\nFCM: NON-DROP FRAME/)
    assert.match(edl, /001 {2}AX {7}V {5}C {8}00:00:00:12 00:00:01:12 00:00:00:00 00:00:01:00/)
    assert.match(edl, /\* FROM CLIP NAME: clip\.mp4/)
    assert.doesNotMatch(edl, /song\.wav/, 'the EDL carries V1 only')
    assert.match(edl, /\* MARKER 00:00:00:12 Look here/)
    assert.match(fs.readFileSync(r.readme, 'utf8'), /Not carried over: fades, title styling/)
    // the zip holds the same files: 4 timeline files and 3 media, each entry equal to its file
    const entries = readZip(r.zip)
    assert.equal(r.zip, `${r.folder}.zip`)
    assert.equal(Object.keys(entries).length, 7)
    for (const [name, bytes] of Object.entries(entries)) {
      assert.ok(name.startsWith(`${path.basename(r.folder)}/`), name)
      const src = name.includes('/Media/') ? path.join(r.folder, 'Media', path.basename(name)) : path.join(r.folder, path.basename(name))
      assert.ok(bytes.equals(fs.readFileSync(src)), `${name} matches its file`)
    }
  })

  test('[mcp:export_edit_for_editors] zip false skips the zip, and outDir puts the folder where the person says', async () => {
    const m = await withMedia('To a folder', [clip])
    await ok('edit_timeline', { editId: m.id, ops: [{ op: 'add_clip', media: m.media[0].id, out: 1 }] })
    const out = path.join(dir, 'handoff')
    const before = editsFolder()
    const r = await ok('export_edit_for_editors', { editId: m.id, outDir: out, zip: false })
    assert.equal(path.dirname(r.folder), out)
    assert.equal(r.zip, null)
    assert.deepEqual(fs.readdirSync(out), [path.basename(r.folder)], 'a folder and no zip beside it')
    assert.deepEqual(editsFolder(), before, 'the default Edits folder was left alone')
    assert.ok(fs.existsSync(r.xml) && fs.existsSync(r.fcpxml) && fs.existsSync(r.edl))
    // the edit itself is untouched: an export for editors is not recorded as a render
    assert.deepEqual((await ok('get_edit', { editId: m.id })).exports, [])
  })

  test('[mcp:export_edit_for_editors] carries a hidden track and a muted track into the XML', async () => {
    const m = await withMedia('Tracks', [clip, song])
    await ok('edit_timeline', {
      editId: m.id,
      ops: [
        { op: 'add_clip', media: m.media[0].id, track: 'V2', out: 1 },
        { op: 'add_clip', media: m.media[0].id, out: 1 },
        { op: 'add_clip', media: m.media[1].id, track: 'A2', duration: 1 },
        { op: 'update_track', track: 'V2', hidden: true },
        { op: 'update_track', track: 'A2', muted: true }
      ]
    })
    const r = await ok('export_edit_for_editors', { editId: m.id, outDir: path.join(dir, 'tracks'), zip: false })
    const xml = fs.readFileSync(r.xml, 'utf8')
    const video = xml.slice(xml.indexOf('<video><format>'), xml.indexOf('</video><audio><numOutputChannels>'))
    const tracks = video.split('<track>').slice(1)
    assert.equal(tracks.length, 2, 'V1 and V2')
    assert.match(tracks[1], /^<enabled>FALSE<\/enabled>/, 'V2 is hidden')
    const audio = xml.slice(xml.indexOf('</video><audio><numOutputChannels>'))
    assert.ok(/<enabled>FALSE<\/enabled>/.test(audio), 'A2 is muted')
  })

  test('[mcp:export_edit_for_editors] refuses an empty timeline, an edit that is not there and a clip whose file has gone, and writes nothing', async () => {
    const before = editsFolder()
    const out = path.join(dir, 'refused')
    const empty = await ok('create_edit', { name: 'Empty' })
    await fails('export_edit_for_editors', { editId: empty.id, outDir: out }, /^The timeline is empty\.$/)
    await fails('export_edit_for_editors', { editId: 'nope0000', outDir: out }, /^No edit nope0000/)
    const doomed = path.join(dir, 'doomed.mp4')
    fs.copyFileSync(clip, doomed)
    const m = await withMedia('Gone', [doomed])
    await ok('edit_timeline', { editId: m.id, ops: [{ op: 'add_clip', media: m.media[0].id }] })
    fs.rmSync(doomed)
    await fails('export_edit_for_editors', { editId: m.id, outDir: out }, /^Missing files: doomed\.mp4$/)
    assert.equal(fs.existsSync(out), false, 'no folder was made for any refusal')
    assert.deepEqual(editsFolder(), before)
  })

  // ---------- caption_edit ----------
  test('[mcp:caption_edit] needs the voice engine, which a Mac does not have yet: it says so (on a Mac, that voices come later), and changes nothing', async () => {
    const m = await withMedia('Caption me', [clip, silent])
    await ok('edit_timeline', { editId: m.id, ops: [{ op: 'add_clip', media: m.media[0].id }] })
    const before = await ok('get_edit', { editId: m.id })
    await fails('caption_edit', { editId: m.id }, new RegExp(`^${CAPTIONS_NEED_VOICES.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`))
    assert.deepEqual(await ok('get_edit', { editId: m.id }), before)
    assert.deepEqual(await mcp.refusals(), [], 'the product refused; no program was started')
    // and the way it suggests is refused on a Mac for now
    const voice = await ok('voice_status')
    assert.equal(voice.installed, false)
  })

  test('[mcp:caption_edit] refuses settings outside what a caption takes, and asks about the voice engine before the edit', async () => {
    const m = await withMedia('Caption limits', [silent])
    await fails('caption_edit', { editId: m.id, maxWords: 1 }, /maxWords/)
    await fails('caption_edit', { editId: m.id, maxWords: 15 }, /maxWords/)
    await fails('caption_edit', { editId: m.id, style: { size: 1 } }, /size/)
    await fails('caption_edit', { editId: m.id, style: { position: 'sideways' } }, /position/)
    await fails('caption_edit', { editId: m.id, tracks: ['Q9'] }, /Tracks are T1, V1, V2/)
    // the voice engine is asked about before the edit is looked up
    await fails('caption_edit', { editId: 'nope0000' }, /^Captions need the voice engine/)
  })

  test('[mcp:caption_edit] with the voice engine in place, hears nothing in a silent clip, adds no caption and leaves the edit as it was', async () => {
    // the engine's marker, as setup leaves it: the python file and installed.json at the current version
    const voiceDir = dataFile('voiceengine')
    fs.mkdirSync(path.join(voiceDir, 'venv', 'bin'), { recursive: true })
    fs.writeFileSync(path.join(voiceDir, 'venv', 'bin', 'python'), '')
    fs.writeFileSync(path.join(voiceDir, 'installed.json'), JSON.stringify({ version: 1 }))
    try {
      const m = await withMedia('Quiet', [silent, still])
      await ok('edit_timeline', { editId: m.id, ops: [{ op: 'add_clip', media: m.media[0].id }, { op: 'add_title', content: 'My own title', start: 0, duration: 1 }] })
      const before = await ok('get_edit', { editId: m.id })
      const r = await ok('caption_edit', { editId: m.id })
      assert.equal(r.lines, 0)
      assert.equal(r.note, 'Nothing was said in the clips heard.')
      assert.equal(r.heard.length, 1)
      assert.deepEqual({ words: r.heard[0].words, start: r.heard[0].start, end: r.heard[0].end }, { words: '', start: 0, end: 2 })
      assert.equal(r.edit, undefined, 'nothing to save')
      assert.deepEqual(await ok('get_edit', { editId: m.id }), before, 'the edit\'s own title is still there')
      // a track with nothing on it, and a picture (no sound to hear)
      const none = await ok('caption_edit', { editId: m.id, tracks: ['A1'] })
      assert.deepEqual(none, { lines: 0, heard: [], note: 'No clips with sound on those tracks.' })
      await ok('edit_timeline', { editId: m.id, ops: [{ op: 'remove_clip', clip: before.tracks.V1[0].clip }, { op: 'add_clip', media: m.media[1].id, duration: 1 }] })
      assert.equal((await ok('caption_edit', { editId: m.id })).note, 'No clips with sound on those tracks.')
    } finally {
      fs.rmSync(voiceDir, { recursive: true, force: true })
    }
  })

  // ---------- last_frame ----------
  test('[mcp:last_frame] saves the exact last frame of a video as a PNG picture set in the Library (Images)', async () => {
    const r = await ok('last_frame', { file: redBlue })
    assert.equal(r.mode, 'frame')
    assert.equal(r.family, 'frame')
    assert.equal(r.familyLabel, 'Last frame')
    assert.equal(r.name, 'red blue · last frame')
    assert.equal(r.status, 'success')
    assert.equal(r.count, 1)
    assert.deepEqual([r.width, r.height], [128, 72])
    assert.equal(r.source, redBlue)
    assert.equal(r.files.length, 1)
    assert.equal(path.dirname(r.files[0]), dataFile('images'))
    assert.match(path.basename(r.files[0]), /^red_blue_last_frame_[0-9a-f]{8}\.png$/)
    const png = fs.readFileSync(r.files[0])
    assert.equal(png.subarray(1, 4).toString(), 'PNG')
    // the picture is the last frame: blue, not the red the video opens on
    const px = execFileSync(ffmpegStatic.ffmpegPath, ['-v', 'error', '-i', r.files[0], '-frames:v', '1', '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']).subarray(0, 3)
    assert.ok(px[2] > 200 && px[0] < 60 && px[1] < 60, `last frame pixel is ${[...px]}`)
    const listed = (await ok('list_images')).items.find((i) => i.id === r.id)
    assert.ok(listed, 'it is in the Library')
    assert.deepEqual(listed.files, r.files)
    assert.equal((await ok('get_image', { imageId: r.id })).id, r.id)
  })

  test('[mcp:last_frame] takes a name, and a second ask for the same video gives back the picture it already saved rather than saving it twice', async () => {
    const named = await ok('last_frame', { file: clip, name: 'Closing shot' })
    assert.equal(named.name, 'Closing shot')
    assert.match(path.basename(named.files[0]), /^closing_shot_[0-9a-f]{8}\.png$/)
    const files = fs.readdirSync(dataFile('images')).length
    const again = await ok('last_frame', { file: clip })
    assert.equal(again.id, named.id)
    assert.deepEqual(again.files, named.files)
    assert.equal(fs.readdirSync(dataFile('images')).length, files, 'no second file')
    // a picture that has been deleted is saved again
    fs.rmSync(named.files[0])
    const redone = await ok('last_frame', { file: clip })
    assert.notEqual(redone.id, named.id)
    assert.ok(fs.existsSync(redone.files[0]))
  })

  test('[mcp:last_frame] refuses a file that is not there and a file with no picture, and saves nothing', async () => {
    const files = fs.readdirSync(dataFile('images')).length
    const listed = (await ok('list_images')).items.length
    await fails('last_frame', { file: path.join(dir, 'missing.mp4') }, /^That file is not on this computer\.$/)
    await fails('last_frame', { file: song }, /^Couldn't read the last frame/)
    await fails('last_frame', {}, /file/)
    assert.equal(fs.readdirSync(dataFile('images')).length, files)
    assert.equal((await ok('list_images')).items.length, listed)
  })

  // ---------- use_clean_stretch ----------
  // a take that cuts away mid-shot: 2.5 s, then a cut to red for 1 s (84 frames); and one too short to carry on from
  const cutTake = () => {
    const file = path.join(dir, 'cut.mp4')
    if (!fs.existsSync(file)) ff('-f', 'lavfi', '-i', 'testsrc=s=128x96:r=24:d=2.5', '-f', 'lavfi', '-i', 'color=c=red:s=128x96:r=24:d=1', '-filter_complex', '[0:v][1:v]concat=n=2:v=1[v]', '-map', '[v]', ...h264, file)
    return file
  }
  const shortCutTake = () => {
    const file = path.join(dir, 'short-cut.mp4')
    if (!fs.existsSync(file)) ff('-f', 'lavfi', '-i', 'testsrc=s=128x96:r=24:d=0.5', '-f', 'lavfi', '-i', 'color=c=red:s=128x96:r=24:d=0.5', '-filter_complex', '[0:v][1:v]concat=n=2:v=1[v]', '-map', '[v]', ...h264, file)
    return file
  }
  const mediaCount = () => (fs.existsSync(dataFile('media')) ? fs.readdirSync(dataFile('media')).length : 0)
  const frames = (file) => Number(probe(file, 'stream=nb_read_frames', '-count_frames', '-select_streams', 'v:0'))

  test('[mcp:use_clean_stretch] saves the longest stretch of a take without a cut as its own video, frame-exact', async () => {
    const job = await finished([cutTake()])
    const { ranking } = await ok('rank_takes', { jobId: job.id })
    assert.deepEqual(ranking.takes[0].raw.cuts.map((c) => c.frame), [60], 'the cut away at 2.5 s')
    const r = await ok('use_clean_stretch', { jobId: job.id, candidate: 1 })
    assert.deepEqual({ from: r.from, to: r.to, seconds: r.seconds, frames: r.frames }, { from: 0, to: 2.5, seconds: 2.5, frames: 60 })
    assert.equal(path.dirname(r.path), dataFile('media'))
    assert.match(path.basename(r.path), /^cut_[0-9a-f]{10}\.mp4$/)
    assert.equal(frames(r.path), 60, 'exactly the 60 frames before the cut')
    assert.notEqual(r.path, cutTake(), 'a new file; the take is as it was')
    assert.equal(frames(cutTake()), 84)
    // the file goes straight into an edit
    const e = await ok('create_edit', { name: 'Uses the stretch' })
    assert.equal((await ok('add_media', { editId: e.id, files: [r.path] })).media[0].kind, 'video')
  })

  test('[mcp:use_clean_stretch] forContinue cuts it down to H3\'s 17n+5 frame grid, ready as the source of a Continue shot', async () => {
    const job = await finished([cutTake()])
    await ok('rank_takes', { jobId: job.id })
    const r = await ok('use_clean_stretch', { jobId: job.id, candidate: 1, forContinue: true })
    assert.equal(r.frames, 56, '17 x 3 + 5, the most that fits in 60')
    assert.equal((r.frames - 5) % 17, 0)
    assert.deepEqual({ from: r.from, to: r.to }, { from: 0, to: 2.333 })
    assert.equal(frames(r.path), 56)
    // forContinue false is the same as leaving it out
    const plain = await ok('use_clean_stretch', { jobId: job.id, candidate: 1, forContinue: false })
    assert.equal(plain.frames, 60)
  })

  test('[mcp:use_clean_stretch] on a take too short to carry on from, forContinue refuses with the length, and the plain stretch still works', async () => {
    const job = await finished([shortCutTake()])
    const { ranking } = await ok('rank_takes', { jobId: job.id })
    assert.equal(ranking.takes[0].raw.cuts.length, 1)
    assert.equal(ranking.takes[0].raw.cleanH3, null)
    await fails('use_clean_stretch', { jobId: job.id, candidate: 1, forContinue: true }, /^The part without a cut is only 0\.5 s, too short to carry on from \(H3 needs about 1 s\)\.$/)
    assert.equal((await ok('use_clean_stretch', { jobId: job.id, candidate: 1 })).seconds, 0.5)
  })

  test('[mcp:use_clean_stretch] refuses a take with no cut, a take not ranked yet, a prompt that asked for cuts, an unknown job and a take number outside 1 to 3', async () => {
    const made = mediaCount()
    // one unbroken shot: nothing to cut around
    const steady = await finished([clip])
    await ok('rank_takes', { jobId: steady.id })
    await fails('use_clean_stretch', { jobId: steady.id, candidate: 1 }, /^That take has no cut to cut around\. Rank the takes first\.$/)
    // never ranked
    const unranked = await finished([cutTake()])
    await fails('use_clean_stretch', { jobId: unranked.id, candidate: 1 }, /^That take has no cut to cut around\. Rank the takes first\.$/)
    // a take that is not there
    const ranked = await finished([cutTake()])
    await ok('rank_takes', { jobId: ranked.id })
    await fails('use_clean_stretch', { jobId: ranked.id, candidate: 2 }, /^That take has no cut to cut around\./)
    // a prompt that asks for a second shot wants its cuts: they are not measured
    const wanted = await finished([cutTake()], { prompt: TWO_SHOTS })
    const { ranking } = await ok('rank_takes', { jobId: wanted.id })
    assert.equal(ranking.takes[0].raw.cuts, undefined)
    await fails('use_clean_stretch', { jobId: wanted.id, candidate: 1 }, /^That take has no cut to cut around\./)
    await fails('use_clean_stretch', { jobId: 'nope', candidate: 1 }, /^No job nope$/)
    await fails('use_clean_stretch', { jobId: ranked.id, candidate: 4 }, /candidate/)
    await fails('use_clean_stretch', { jobId: ranked.id, candidate: 0 }, /candidate/)
    assert.equal(mediaCount(), made, 'no file was made for any refusal')
  })

  // ---------- soften_mouth ----------
  const shinobiAt = (parts) => {
    const root = dataFile('shinobi')
    if (parts.python) {
      fs.mkdirSync(path.join(root, 'venv', 'bin'), { recursive: true })
      fs.writeFileSync(path.join(root, 'venv', 'bin', 'python'), '')
      fs.writeFileSync(path.join(root, 'installed.json'), JSON.stringify({ commit: ENGINE.commit }))
    }
    if (parts.faces) {
      fs.mkdirSync(path.join(root, 'models', 'buffalo_l'), { recursive: true })
      for (const f of FACE_MODELS.files) fs.writeFileSync(path.join(root, 'models', 'buffalo_l', f), '')
    }
  }

  test('[mcp:soften_mouth] says what to set up when Shinobi\'s Python is not here, then when the face models are not, and starts nothing', async () => {
    await fails('soften_mouth', { file: clip }, /^Soft mouth uses Shinobi’s Python\. Set up Shinobi once \(Workflows → Shinobi\)\.$/)
    shinobiAt({ python: true })
    await fails('soften_mouth', { file: clip }, /^Soft mouth needs the face models \(Characters → Rank by likeness downloads them\)\.$/)
    assert.deepEqual(await mcp.refusals(), [], 'the product refused; no program was started')
    assert.equal(fs.existsSync(dataFile('softmouth')), false, 'no copy folder was made')
  })

  test('[mcp:soften_mouth] refuses a file that is not there before anything else', async () => {
    const missing = path.join(dir, 'nowhere.mp4')
    await fails('soften_mouth', { file: missing }, new RegExp(`^File not found: ${missing.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`))
    await fails('soften_mouth', {}, /file/)
  })

  test('[mcp:soften_mouth] gives back the copy it made before for the same file version without running anything', async () => {
    shinobiAt({ python: true, faces: true })
    // what an earlier run leaves: <name>_softmouth_<key>.mp4 and its .json, the key from the file's path and modified time
    const key = createHash('sha1').update(JSON.stringify([path.resolve(clip), fs.statSync(clip).mtimeMs, 1])).digest('hex').slice(0, 10)
    const out = dataFile('softmouth', `clip_softmouth_${key}.mp4`)
    fs.mkdirSync(path.dirname(out), { recursive: true })
    fs.copyFileSync(clip, out)
    const facts = { frames: 48, withFace: 46, width: 128, height: 72 }
    fs.writeFileSync(`${out}.json`, JSON.stringify(facts))
    assert.deepEqual(await ok('soften_mouth', { file: clip }), { path: out, ...facts })
    assert.deepEqual(await mcp.refusals(), [], 'Shinobi\'s Python was not started')
    // a changed file is a new version: it is not given the old copy, and (here, with no real Python) cannot be made
    const later = new Date(Date.now() + 60000)
    fs.utimesSync(clip, later, later)
    const r = await call('soften_mouth', { file: clip })
    assert.equal(r.isError, true)
  })

  // ---------- list_activity ----------
  const day = (ago) => new Date(Date.now() - ago * 86400000).toISOString().slice(0, 10)
  const seed = (ago, entries) => {
    const file = dataFile('activity', `${day(ago)}.jsonl`)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.appendFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n')
  }
  const entry = (id, over = {}) => ({ id, at: `${day(0)}T12:00:00.000Z`, who: { kind: 'chat', name: 'The chat' }, tool: 'create_edit', label: 'Create edit', about: id, refs: {}, ok: true, ...over })

  test('[mcp:list_activity] lists what the agent did in this session: every change, newest first, with who, the step, what it was about and the ids it touched', async () => {
    const edit = await ok('create_edit', { name: 'Activity edit' })
    const m = await ok('add_media', { editId: edit.id, files: [clip] })
    await ok('edit_timeline', { editId: edit.id, ops: [{ op: 'add_clip', media: m.media[0].id }] })
    const frame = await ok('last_frame', { file: redBlue })
    const { items } = await ok('list_activity')
    const mine = items.filter((i) => ['create_edit', 'add_media', 'edit_timeline', 'last_frame'].includes(i.tool))
    assert.deepEqual(mine.slice(0, 4).map((i) => i.tool), ['last_frame', 'edit_timeline', 'add_media', 'create_edit'], 'newest first')
    const by = Object.fromEntries(mine.slice(0, 4).map((i) => [i.tool, i]))
    assert.deepEqual(by.create_edit.who, { kind: 'outside', name: 'A test', client: 'iv-test' }, 'an outside agent, named from the client that connected')
    assert.equal(by.create_edit.about, 'Activity edit')
    assert.equal(by.create_edit.ok, true)
    assert.equal(by.create_edit.refs.editId, edit.id)
    assert.equal(by.edit_timeline.refs.editId, edit.id)
    assert.match(by.edit_timeline.undo, /^[a-z0-9]+-[a-z0-9]+$/, 'a change to an edit keeps an undo point')
    assert.ok(fs.existsSync(dataFile('activity', 'undo', `${by.edit_timeline.undo}.json`)))
    assert.equal(by.last_frame.refs.imageId, frame.id, 'a tool that makes something names it as what it made')
    assert.match(by.create_edit.at, /^\d{4}-\d\d-\d\dT/)
    assert.equal(typeof by.create_edit.ms, 'number')
    // looking things up is not logged
    await ok('list_edits')
    await ok('get_edit', { editId: edit.id })
    await ok('get_speeds')
    const after = (await ok('list_activity')).items
    assert.equal(after.filter((i) => ['list_edits', 'get_edit', 'get_speeds', 'list_activity'].includes(i.tool)).length, 0)
    assert.equal(after.length, items.length, 'asking what was done is not a step')
  })

  test('[mcp:list_activity] problems shows only failed steps, with the first line of the error', async () => {
    await call('export_edit_for_editors', { editId: 'nope0000' })
    await call('use_clean_stretch', { jobId: 'nope', candidate: 1 })
    const { items } = await ok('list_activity', { problems: true })
    assert.ok(items.length >= 2)
    assert.ok(items.every((i) => i.ok === false && typeof i.error === 'string' && i.error.length > 0))
    assert.deepEqual(items.slice(0, 2).map((i) => [i.tool, i.error]), [['use_clean_stretch', 'No job nope'], ['export_edit_for_editors', 'No edit nope0000']])
    assert.equal(items[0].refs.jobId, 'nope')
    // a failed look-up is logged too, a good one is not
    await call('get_job', { jobId: 'nope' })
    assert.equal((await ok('list_activity', { problems: true })).items[0].tool, 'get_job')
  })

  test('[mcp:list_activity] narrows by who did it, by days and by limit, from the log files', async () => {
    seed(5, [entry('old-chat', { who: { kind: 'chat', name: 'The chat' } })])
    seed(1, [entry('yesterday-idea', { who: { kind: 'idea', name: 'A Dashboard idea' }, at: `${day(1)}T09:00:00.000Z`, tool: 'make_image', label: 'Make image', refs: { imageId: 'img1' }, spend: { credits: 211, usd: 1 } }), entry('yesterday-chat', { at: `${day(1)}T10:00:00.000Z`, ok: false, error: 'It broke' })])
    const ids = (r) => r.items.map((i) => i.id)
    const dflt = await ok('list_activity', { limit: 300 })
    assert.ok(ids(dflt).includes('yesterday-idea') && ids(dflt).includes('yesterday-chat'))
    assert.ok(!ids(dflt).includes('old-chat'), 'two days by default: five days ago is left out')
    assert.ok(ids(await ok('list_activity', { days: 7, limit: 300 })).includes('old-chat'))
    assert.ok(!ids(await ok('list_activity', { days: 4, limit: 300 })).includes('old-chat'))
    // yesterday's file is read before the older one, and within a day the later line comes first
    const week = ids(await ok('list_activity', { days: 7, limit: 300 }))
    assert.ok(week.indexOf('yesterday-chat') < week.indexOf('yesterday-idea') && week.indexOf('yesterday-idea') < week.indexOf('old-chat'))
    const idea = (await ok('list_activity', { who: 'idea' })).items
    assert.deepEqual(idea.map((i) => i.id), ['yesterday-idea'])
    assert.deepEqual(idea[0].spend, { credits: 211, usd: 1 })
    assert.deepEqual(idea[0].refs, { imageId: 'img1' })
    assert.ok((await ok('list_activity', { who: 'chat', days: 7 })).items.every((i) => i.who.kind === 'chat'))
    assert.ok((await ok('list_activity', { who: 'outside' })).items.every((i) => i.who.kind === 'outside'))
    assert.deepEqual(ids(await ok('list_activity', { who: 'chat', problems: true })), ['yesterday-chat'])
    assert.equal((await ok('list_activity', { limit: 1 })).items.length, 1)
    assert.equal((await ok('list_activity', { limit: 1 })).items[0].id, ids(dflt)[0])
  })

  test('[mcp:list_activity] marks a change that has been undone, and skips a log line it cannot read', async () => {
    seed(0, [entry('with-undo', { tool: 'edit_timeline', undo: 'undo-abc-1' })])
    fs.appendFileSync(dataFile('activity', `${day(0)}.jsonl`), 'not json at all\n')
    fs.writeFileSync(dataFile('activity', 'undone.json'), JSON.stringify(['undo-abc-1']))
    const item = (await ok('list_activity', { limit: 300 })).items.find((i) => i.id === 'with-undo')
    assert.equal(item.undone, true)
    assert.equal((await ok('list_activity', { limit: 300 })).items.filter((i) => i.id).length > 0, true)
  })

  test('[mcp:list_activity] refuses a days, limit or who outside what it takes', async () => {
    await fails('list_activity', { days: 0 }, /days/)
    await fails('list_activity', { days: 31 }, /days/)
    await fails('list_activity', { limit: 0 }, /limit/)
    await fails('list_activity', { limit: 301 }, /limit/)
    await fails('list_activity', { who: 'robot' }, /who/)
  })
})
