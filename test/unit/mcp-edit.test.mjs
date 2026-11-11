// MCP edit tools (task 5.6, part 1): the timeline editor's list, settings, media bin, timeline operations, frame grab
// and export, called through the real MCP server on source under the test guard (design D1, D8). Nothing here needs
// ComfyUI; ffmpeg is the bundled one (the guard allows it) and every fixture is a few frames made in the temp folder.
// Other 5.6 groups: mcp-sequence.test.mjs, mcp-production.test.mjs, mcp-edit-generate.test.mjs.
//   node --test test/unit/mcp-edit.test.mjs
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import ffmpegStatic from 'ffmpeg-ffprobe-static'
import { startFakeComfy } from '../fakes/comfyui.mjs'
import { startMcp } from '../fakes/mcp.mjs'

const TEMP = fs.realpathSync(os.tmpdir())

describe('MCP edit tools', () => {
  let fake, mcp, clip, still, song
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
  const probe = (file, entries) => execFileSync(ffmpegStatic.ffprobePath, ['-v', 'error', '-show_entries', entries, '-of', 'csv=p=0', file]).toString().trim()
  const dataFile = (...p) => path.join(mcp.dataDir, ...p)
  // a fresh edit with the three fixtures in its media bin; returns the edit and the media ids by kind
  const withMedia = async (name = 'Test edit') => {
    const e = await ok('create_edit', { name })
    const added = await ok('add_media', { editId: e.id, files: [clip, still, song] })
    const [video, picture, audio] = added.media
    return { id: e.id, video, picture, audio }
  }
  const settle = async (editId) => {
    for (let i = 0; i < 200; i++) {
      const st = await ok('get_edit_export', { editId })
      if (st.state !== 'running') return st
      await new Promise((r) => setTimeout(r, 50))
    }
    throw new Error('the export never finished')
  }

  before(async () => {
    fake = await startFakeComfy({ devices: 'mps', os: 'darwin' })
    mcp = await startMcp({ comfyUrl: fake.url })
    const dir = path.join(path.dirname(mcp.dataDir), 'fixtures')
    fs.mkdirSync(dir, { recursive: true })
    clip = path.join(dir, 'clip.mp4')
    still = path.join(dir, 'still.png')
    song = path.join(dir, 'song.wav')
    ff('-f', 'lavfi', '-i', 'testsrc=s=128x72:r=24:d=2', '-f', 'lavfi', '-i', 'sine=f=440:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', clip)
    ff('-f', 'lavfi', '-i', 'color=c=blue:s=128x72', '-frames:v', '1', still)
    ff('-f', 'lavfi', '-i', 'sine=f=330:d=3', song)
  })
  after(async () => {
    await mcp?.close()
    await fake?.close()
  })

  // ---------- create_edit, list_edits, get_edit ----------
  test('[mcp:list_edits] is empty on a fresh data folder', async () => {
    assert.deepEqual((await ok('list_edits')).items, [])
  })

  test('[mcp:create_edit][ipc:edits:create] makes an empty edit with the default name, 1080p and 24 fps', async () => {
    const e = await ok('create_edit')
    assert.equal(e.name, 'Untitled edit')
    assert.deepEqual(e.settings, { format: '1080p', fps: 24 })
    assert.equal(e.seconds, 0)
    assert.deepEqual(e.media, [])
    assert.deepEqual(e.trackList.map((t) => t.id), ['T1', 'V2', 'V1', 'A1', 'A2'])
    assert.deepEqual(e.markers, [])
    assert.ok(fs.existsSync(dataFile('edits', `${e.id}.json`)), 'saved under the data folder')
  })

  test('[mcp:create_edit] takes a name, a format and a frame rate, and refuses ones outside the list', async () => {
    const e = await ok('create_edit', { name: 'Reel', format: 'vertical', fps: 30 })
    assert.equal(e.name, 'Reel')
    assert.deepEqual(e.settings, { format: 'vertical', fps: 30 })
    await fails('create_edit', { format: 'cinemascope' }, /format/i)
    await fails('create_edit', { fps: 5 }, /fps/i)
    await fails('create_edit', { fps: 61 }, /fps/i)
  })

  test('[mcp:list_edits][ipc:edits:list] lists each edit with its clip count, length and format, newest first', async () => {
    const { id, video } = await withMedia('Listed')
    await ok('edit_timeline', { editId: id, ops: [{ op: 'add_clip', media: video.id }] })
    const { items } = await ok('list_edits')
    assert.equal(items[0].id, id, 'the edit changed last comes first')
    assert.deepEqual({ name: items[0].name, clips: items[0].clips, seconds: items[0].seconds, format: items[0].format, exports: items[0].exports }, { name: 'Listed', clips: 1, seconds: 2, format: '1080p', exports: 0 })
    assert.deepEqual(items[0].cover, { path: clip, kind: 'video', at: 0 })
    assert.ok(items.length >= 3)
    const times = items.map((i) => i.updatedAt)
    assert.deepEqual(times, [...times].sort().reverse())
  })

  test('[mcp:get_edit][ipc:edits:get] describes the media with ids, the tracks and their clips in order', async () => {
    const m = await withMedia('Described')
    await ok('edit_timeline', { editId: m.id, ops: [{ op: 'add_clip', media: m.video.id }, { op: 'add_clip', media: m.picture.id, track: 'V2', start: 0.5 }, { op: 'add_clip', media: m.audio.id }, { op: 'add_title', content: 'Hello', start: 1 }] })
    const e = await ok('get_edit', { editId: m.id })
    // the media come back in the order of their random ids, so look each one up by name
    const byName = Object.fromEntries(e.media.map((x) => [x.name, x]))
    assert.deepEqual(e.media.map((x) => [x.name, x.kind]).sort(), [['clip.mp4', 'video'], ['song.wav', 'audio'], ['still.png', 'image']])
    assert.equal(byName['clip.mp4'].hasAudio, true)
    assert.equal(byName['still.png'].hasAudio, false)
    assert.equal(e.tracks.V1.length, 1)
    assert.deepEqual({ name: e.tracks.V1[0].name, start: e.tracks.V1[0].start, end: e.tracks.V1[0].end, in: e.tracks.V1[0].in, out: e.tracks.V1[0].out, volume: e.tracks.V1[0].volume, muted: e.tracks.V1[0].muted }, { name: 'clip.mp4', start: 0, end: 2, in: 0, out: 2, volume: 1, muted: false })
    assert.deepEqual([e.tracks.V2[0].start, e.tracks.V2[0].end], [0.5, 4.5], 'a picture plays 4 s')
    assert.equal(e.tracks.A1[0].name, 'song.wav')
    assert.deepEqual(e.tracks.T1[0].title, { content: 'Hello', size: 8, position: 'bottom', color: '#f4ecdc', box: false })
    assert.equal(e.seconds, 4.5)
  })

  test('[mcp:get_edit] names the edit it cannot find', async () => {
    await fails('get_edit', { editId: 'nope0000' }, /No edit nope0000/)
  })

  // ---------- set_edit_settings ----------
  test('[mcp:set_edit_settings] renames an edit and changes its format, frame rate and loudness, keeping what it was not asked about', async () => {
    const e = await ok('create_edit', { name: 'Before' })
    const renamed = await ok('set_edit_settings', { editId: e.id, name: 'After' })
    assert.equal(renamed.name, 'After')
    assert.deepEqual(renamed.settings, { format: '1080p', fps: 24 })
    const changed = await ok('set_edit_settings', { editId: e.id, format: 'square', fps: 25, loudness: 'tv' })
    assert.equal(changed.name, 'After')
    assert.deepEqual(changed.settings, { format: 'square', fps: 25, loudness: 'tv' })
    const again = await ok('set_edit_settings', { editId: e.id, loudness: 'off' })
    assert.deepEqual(again.settings, { format: 'square', fps: 25, loudness: 'off' })
    assert.deepEqual(JSON.parse(fs.readFileSync(dataFile('edits', `${e.id}.json`), 'utf8')).settings, again.settings, 'saved to the edit')
  })

  test('[mcp:set_edit_settings] refuses an unknown format, loudness, an empty name and an edit that is not there', async () => {
    const e = await ok('create_edit')
    await fails('set_edit_settings', { editId: e.id, format: 'imax' }, /format/i)
    await fails('set_edit_settings', { editId: e.id, loudness: 'loud' }, /loudness/i)
    await fails('set_edit_settings', { editId: e.id, name: '' }, /name/i)
    await fails('set_edit_settings', { editId: 'nope0000', name: 'x' }, /No edit nope0000/)
  })

  // ---------- add_media ----------
  test('[mcp:add_media][ipc:edits:addOutput] adds a video, a picture and a sound to the bin with what ffprobe found, and puts nothing on the timeline', async () => {
    const e = await ok('create_edit')
    const r = await ok('add_media', { editId: e.id, files: [clip, still, song] })
    assert.deepEqual(r.placed, [])
    const [v, p, a] = r.media
    assert.deepEqual({ name: v.name, kind: v.kind, width: v.width, height: v.height, hasAudio: v.hasAudio }, { name: 'clip.mp4', kind: 'video', width: 128, height: 72, hasAudio: true })
    assert.ok(Math.abs(v.duration - 2) < 0.1, `video ${v.duration}`)
    assert.deepEqual({ kind: p.kind, width: p.width, hasAudio: p.hasAudio }, { kind: 'image', width: 128, hasAudio: false })
    assert.deepEqual({ kind: a.kind, hasAudio: a.hasAudio }, { kind: 'audio', hasAudio: true })
    assert.ok(Math.abs(a.duration - 3) < 0.1)
    const got = await ok('get_edit', { editId: e.id })
    assert.equal(got.media.length, 3)
    assert.deepEqual(got.tracks.V1, [])
  })

  test('[mcp:add_media] with append puts video and pictures on the end of V1 and sound on A1, in the order given', async () => {
    const e = await ok('create_edit')
    const r = await ok('add_media', { editId: e.id, files: [clip, still, song], append: true })
    assert.deepEqual(r.placed.map((x) => [x.track, x.start, x.end]), [['V1', 0, 2], ['V1', 2, 6], ['A1', 0, 3]])
    const got = await ok('get_edit', { editId: e.id })
    assert.deepEqual(got.tracks.V1.map((c) => c.name), ['clip.mp4', 'still.png'])
    assert.deepEqual(got.tracks.A1.map((c) => c.name), ['song.wav'])
    // adding again appends after what is there
    const more = await ok('add_media', { editId: e.id, files: [clip], append: true })
    assert.deepEqual([more.placed[0].start, more.placed[0].end], [6, 8])
  })

  test('[mcp:add_media] adds an IV Studio render by its key from list_renders, as a copy of a local file kept where it is', async () => {
    const render = path.join(path.dirname(clip), 'render.mp4')
    fs.copyFileSync(clip, render)
    const at = '2026-11-10T12:00:00.000Z'
    fs.mkdirSync(dataFile('projects'), { recursive: true })
    fs.mkdirSync(dataFile('jobs'), { recursive: true })
    fs.writeFileSync(dataFile('projects', 'shotedit1.json'), JSON.stringify({ id: 'shotedit1', name: 'Harbor', createdAt: at, updatedAt: at, jobs: ['jobedit001'], sequenceId: null }))
    fs.writeFileSync(dataFile('jobs', 'jobedit001.json'), JSON.stringify({ id: 'jobedit001', kind: 'finish', projectId: 'shotedit1', status: 'success', createdAt: at, finishedAt: at, plan: { request: {} }, outputs: [{ kind: 'final', path: render }] }))
    const key = (await ok('list_renders')).items.find((r) => r.label === 'Harbor · final').key
    const e = await ok('create_edit')
    const r = await ok('add_media', { editId: e.id, renders: [key], append: true })
    assert.equal(r.media[0].name, 'render.mp4')
    assert.equal(r.placed[0].track, 'V1')
    const got = await ok('get_edit', { editId: e.id })
    assert.equal(got.media[0].path, render)
    const saved = JSON.parse(fs.readFileSync(dataFile('edits', `${e.id}.json`), 'utf8'))
    assert.deepEqual(Object.values(saved.media)[0].source, { type: 'iv', label: 'Harbor · final' })
  })

  test('[mcp:add_media] refuses a missing file, an unknown render key, nothing at all and an edit that is not there', async () => {
    const e = await ok('create_edit')
    await fails('add_media', { editId: e.id, files: [path.join(TEMP, 'iv-no-such-file.mp4')] }, /File not found/)
    await fails('add_media', { editId: e.id, renders: ['jobnone:final:'] }, /No render jobnone:final:\. list_renders gives the keys/)
    await fails('add_media', { editId: e.id }, /Give files or renders/)
    await fails('add_media', { editId: 'nope0000', files: [clip] }, /No edit nope0000/)
    assert.deepEqual((await ok('get_edit', { editId: e.id })).media, [], 'a failed call adds nothing')
  })

  // ---------- edit_timeline ----------
  test('[mcp:edit_timeline] adds, trims, fades and moves clips, and returns what each operation did and the edit afterwards', async () => {
    const m = await withMedia()
    const r = await ok('edit_timeline', { editId: m.id, ops: [
      { op: 'add_clip', media: m.video.id, in: 0.5, out: 1.5, fadeIn: 0.25 },
      { op: 'add_clip', media: m.video.id, start: 5, duration: 1, volume: 0.5, muted: true },
      { op: 'add_title', content: 'Opening', start: 0, duration: 2, position: 'top', color: '#ff0000', box: true }
    ] })
    assert.deepEqual(r.results.map((x) => [x.op, x.start, x.end]), [['add_clip', 0, 1], ['add_clip', 5, 6], ['add_title', 0, 2]])
    const [first, second] = r.edit.tracks.V1
    assert.deepEqual({ in: first.in, out: first.out, fadeIn: first.fadeIn }, { in: 0.5, out: 1.5, fadeIn: 0.25 })
    assert.deepEqual({ volume: second.volume, muted: second.muted }, { volume: 0.5, muted: true })
    assert.deepEqual(r.edit.tracks.T1[0].title, { content: 'Opening', size: 8, position: 'top', color: '#ff0000', box: true })
    const moved = await ok('edit_timeline', { editId: m.id, ops: [{ op: 'update_clip', clip: second.clip, start: 2, in: 0, out: 2, fadeOut: 0.5 }, { op: 'update_clip', clip: r.results[2].clip, content: 'Changed' }] })
    assert.deepEqual(moved.results.map((x) => [x.start, x.end]), [[2, 4], [0, 2]])
    assert.equal(moved.edit.tracks.T1[0].title.content, 'Changed')
  })

  test('[mcp:edit_timeline] splits a clip, removes one with and without ripple, and inserts and overwrites like an editor', async () => {
    const m = await withMedia()
    const base = await ok('edit_timeline', { editId: m.id, ops: [{ op: 'add_clip', media: m.video.id }, { op: 'add_clip', media: m.video.id }] })
    const [a, b] = base.results.map((x) => x.clip)
    const split = await ok('edit_timeline', { editId: m.id, ops: [{ op: 'split_clip', clip: a, at: 1 }] })
    assert.equal(split.results[0].at, 1)
    assert.deepEqual(split.edit.tracks.V1.map((c) => [c.start, c.end, c.in, c.out]), [[0, 1, 0, 1], [1, 2, 1, 2], [2, 4, 0, 2]])
    const rippled = await ok('edit_timeline', { editId: m.id, ops: [{ op: 'remove_clip', clip: split.results[0].newClip, ripple: true }] })
    assert.deepEqual(rippled.edit.tracks.V1.map((c) => [c.start, c.end]), [[0, 1], [1, 3]], 'later clips close the gap')
    const plain = await ok('edit_timeline', { editId: m.id, ops: [{ op: 'remove_clip', clip: b }] })
    assert.deepEqual(plain.edit.tracks.V1.map((c) => [c.start, c.end]), [[0, 1]])
    const inserted = await ok('edit_timeline', { editId: m.id, ops: [{ op: 'insert_clip', media: m.picture.id, at: 0.5, duration: 1 }] })
    assert.deepEqual(inserted.edit.tracks.V1.map((c) => [c.name, c.start, c.end]), [['clip.mp4', 0, 0.5], ['still.png', 0.5, 1.5], ['clip.mp4', 1.5, 2]], 'the clip it landed in is cut in two and the rest moves right')
    const over = await ok('edit_timeline', { editId: m.id, ops: [{ op: 'overwrite_clip', media: m.picture.id, at: 0.25, duration: 0.5 }] })
    assert.ok(over.edit.tracks.V1.some((c) => c.name === 'still.png' && c.start === 0.25 && c.end === 0.75), 'overwrite puts the new clip where it was told')
    assert.equal(over.edit.tracks.V1.find((c) => c.name === 'clip.mp4' && c.start === 0).end, 0.25, 'and trims what it covers')
  })

  test('[mcp:edit_timeline] adds, changes and removes tracks and markers, and clears a track', async () => {
    const m = await withMedia()
    const r = await ok('edit_timeline', { editId: m.id, ops: [
      { op: 'add_track', kind: 'video', label: 'Overlay' },
      { op: 'add_track', kind: 'audio' },
      { op: 'update_track', track: 'A2', muted: true, solo: false, label: 'Music' },
      { op: 'add_marker', at: 2.5, label: 'Beat', color: '#00ff00' },
      { op: 'add_marker', at: 1 }
    ] })
    assert.deepEqual(r.results.slice(0, 2).map((x) => x.track), ['V3', 'A3'])
    assert.deepEqual(r.edit.trackList.map((t) => t.id), ['T1', 'V3', 'V2', 'V1', 'A1', 'A2', 'A3'])
    assert.equal(r.edit.trackList.find((t) => t.id === 'V3').label, 'Overlay')
    assert.deepEqual(r.edit.trackList.find((t) => t.id === 'A2'), { id: 'A2', kind: 'audio', label: 'Music', hidden: false, locked: false, muted: true, solo: false })
    assert.deepEqual(r.edit.markers.map((x) => [x.t, x.label]), [[1, ''], [2.5, 'Beat']], 'markers stay in time order')
    const [early, late] = r.edit.markers
    const next = await ok('edit_timeline', { editId: m.id, ops: [{ op: 'update_marker', marker: late.id, at: 0.5, label: 'Hit' }, { op: 'remove_marker', marker: early.id }, { op: 'remove_track', track: 'V3' }] })
    assert.deepEqual(next.edit.markers.map((x) => [x.t, x.label]), [[0.5, 'Hit']])
    assert.ok(!next.edit.trackList.some((t) => t.id === 'V3'))
    await ok('edit_timeline', { editId: m.id, ops: [{ op: 'add_clip', media: m.video.id }, { op: 'add_clip', media: m.audio.id }] })
    const cleared = await ok('edit_timeline', { editId: m.id, ops: [{ op: 'clear', track: 'V1' }] })
    assert.deepEqual(cleared.edit.tracks.V1, [])
    assert.equal(cleared.edit.tracks.A1.length, 1, 'only that track')
    const all = await ok('edit_timeline', { editId: m.id, ops: [{ op: 'clear' }] })
    assert.equal(all.edit.tracks.A1.length, 0)
    const gone = await ok('edit_timeline', { editId: m.id, ops: [{ op: 'remove_media', media: m.audio.id }] })
    assert.equal(gone.results[0].clipsRemoved, 0)
    assert.ok(!gone.edit.media.some((x) => x.id === m.audio.id))
  })

  test('[mcp:edit_timeline] changes nothing when one operation fails, and says which one and why', async () => {
    const m = await withMedia()
    const before = await ok('get_edit', { editId: m.id })
    await fails('edit_timeline', { editId: m.id, ops: [{ op: 'add_clip', media: m.video.id }, { op: 'add_clip', media: 'nomedia1' }] }, /Operation 2 \(add_clip\): No media nomedia1\. add_media returns media ids\. Nothing was changed\./)
    await fails('edit_timeline', { editId: m.id, ops: [{ op: 'add_clip', media: m.video.id, out: 9 }] }, /clip\.mp4 is only 2\.00 s long; out can't be 9/)
    await fails('edit_timeline', { editId: m.id, ops: [{ op: 'add_clip', media: m.audio.id, track: 'V1' }] }, /An audio clip can't go on V1/)
    await fails('edit_timeline', { editId: m.id, ops: [{ op: 'add_clip', media: m.video.id, track: 'V9' }] }, /Unknown track V9/)
    await fails('edit_timeline', { editId: m.id, ops: [{ op: 'remove_track', track: 'V1' }] }, /V1 can't be removed/)
    await fails('edit_timeline', { editId: m.id, ops: [{ op: 'split_clip', clip: 'noclip00', at: 1 }] }, /No clip noclip00/)
    await fails('edit_timeline', { editId: m.id, ops: [{ op: 'add_clip', media: m.video.id, fadeIn: 2, fadeOut: 2 }] }, /Fades must fit inside the clip/)
    await fails('edit_timeline', { editId: m.id, ops: [] }, /ops/i)
    await fails('edit_timeline', { editId: m.id, ops: [{ op: 'add_clip', media: m.video.id, track: 'X1' }] }, /Tracks are T1, V1, V2/)
    assert.deepEqual(await ok('get_edit', { editId: m.id }), before)
  })

  test('[mcp:edit_timeline] refuses changes on a locked track, and a split outside its clip', async () => {
    const m = await withMedia()
    const r = await ok('edit_timeline', { editId: m.id, ops: [{ op: 'add_clip', media: m.video.id }] })
    const id = r.results[0].clip
    await ok('edit_timeline', { editId: m.id, ops: [{ op: 'update_track', track: 'V1', locked: true }] })
    await fails('edit_timeline', { editId: m.id, ops: [{ op: 'remove_clip', clip: id }] }, /Track V1 is locked in the editor/)
    await fails('edit_timeline', { editId: m.id, ops: [{ op: 'add_clip', media: m.video.id }] }, /Track V1 is locked/)
    await ok('edit_timeline', { editId: m.id, ops: [{ op: 'update_track', track: 'V1', locked: false }] })
    await fails('edit_timeline', { editId: m.id, ops: [{ op: 'split_clip', clip: id, at: 5 }] }, /5 s is not inside clip/)
  })

  // ---------- grab_frame ----------
  test('[mcp:grab_frame] returns a PNG of an edit at a time, from the top visible video track, and says what it came from', async () => {
    const m = await withMedia()
    await ok('edit_timeline', { editId: m.id, ops: [{ op: 'add_clip', media: m.video.id }, { op: 'add_clip', media: m.picture.id, track: 'V2' }] })
    const r = await call('grab_frame', { editId: m.id, at: 1, width: 320 })
    assert.ok(!r.isError, JSON.stringify(r.content))
    const [img, text] = r.content
    assert.equal(img.type, 'image')
    assert.equal(img.mimeType, 'image/png')
    const png = Buffer.from(img.data, 'base64')
    assert.equal(png.subarray(1, 4).toString(), 'PNG')
    assert.equal(png.readUInt32BE(16), 320, 'scaled to the width asked for')
    assert.equal(text.text, 'still.png at 0.00 s', 'the picture on V2 is drawn over the video on V1')
    const hidden = await ok('edit_timeline', { editId: m.id, ops: [{ op: 'update_track', track: 'V2', hidden: true }] })
    assert.equal(hidden.edit.trackList.find((t) => t.id === 'V2').hidden, true)
    const under = await call('grab_frame', { editId: m.id, at: 1.5 })
    assert.equal(under.content[1].text, 'clip.mp4 at 1.50 s', 'a hidden track is left out')
  })

  test('[mcp:grab_frame] takes any video file at a time, and refuses an empty moment, a missing file and no source', async () => {
    const r = await call('grab_frame', { file: clip, at: 1 })
    assert.equal(r.content[1].text, 'clip.mp4 at 1.00 s')
    assert.equal(Buffer.from(r.content[0].data, 'base64').readUInt32BE(16), 640, 'the default width')
    const m = await ok('create_edit')
    await fails('grab_frame', { editId: m.id, at: 0 }, /Nothing on a visible video track at 0 s/)
    await fails('grab_frame', { file: path.join(TEMP, 'iv-no-such-file.mp4'), at: 0 }, /Give editId or an existing file/)
    await fails('grab_frame', { at: 0 }, /Give editId or an existing file/)
    await fails('grab_frame', { file: clip, at: 60 }, /No frame at 60\.00 s in clip\.mp4/)
    await fails('grab_frame', { file: clip, at: 0, width: 100 }, /width/i)
  })

  // ---------- export_edit, get_edit_export, cancel_edit_export ----------
  test('[mcp:export_edit][ipc:edits:export] renders the timeline to an MP4 in the Edits folder and records the export on the edit', async () => {
    const m = await withMedia('Export me')
    await ok('edit_timeline', { editId: m.id, ops: [{ op: 'add_clip', media: m.video.id, out: 1 }, { op: 'add_title', content: 'Hi', start: 0, duration: 1 }] })
    const started = await ok('export_edit', { editId: m.id })
    assert.equal(started.state, 'running')
    assert.equal(started.seconds, 1)
    await fails('export_edit', { editId: m.id }, /already exporting/)
    const done = await settle(m.id)
    assert.equal(done.state, 'done', JSON.stringify(done))
    assert.equal(done.progress, 1)
    assert.equal(path.dirname(done.file), dataFile('videos', 'Edits'))
    assert.ok(fs.realpathSync(done.file).startsWith(TEMP + path.sep))
    assert.match(path.basename(done.file), /^Export me_\d{4}-\d\d-\d\d-\d\d-\d\d-\d\d\.mp4$/)
    assert.deepEqual(probe(done.file, 'stream=codec_name,width,height').split('\n').sort(), ['aac', 'h264,1920,1080'].sort())
    assert.ok(Math.abs(Number(probe(done.file, 'format=duration')) - 1) < 0.15)
    const after = await ok('get_edit', { editId: m.id })
    assert.equal(after.exports.length, 1)
    assert.equal(after.exports[0].file, done.file)
    assert.deepEqual({ format: after.exports[0].format, fps: after.exports[0].fps, target: after.exports[0].loudness.target }, { format: '1080p', fps: 24, target: -14 })
    assert.equal((await ok('list_edits')).items.find((i) => i.id === m.id).exports, 1)
    // finished: a new export can start, into a folder of the caller's choosing
    const out = path.join(path.dirname(mcp.dataDir), 'exports')
    const second = await ok('export_edit', { editId: m.id, outDir: out })
    const again = await settle(m.id)
    assert.equal(again.state, 'done', JSON.stringify(again))
    assert.equal(path.dirname(again.file), out)
    assert.equal(second.state, 'running')
  })

  test('[mcp:export_edit] refuses an empty timeline and an edit that is not there', async () => {
    const e = await ok('create_edit')
    await fails('export_edit', { editId: e.id }, /The timeline is empty/)
    await fails('export_edit', { editId: 'nope0000' }, /No edit nope0000/)
  })

  test('[mcp:export_edit] fails with the files named when a clip\'s media has gone', async () => {
    const copy = path.join(path.dirname(clip), 'doomed.mp4')
    fs.copyFileSync(clip, copy)
    const e = await ok('create_edit')
    const added = await ok('add_media', { editId: e.id, files: [copy], append: true })
    fs.rmSync(copy)
    await ok('export_edit', { editId: e.id })
    const st = await settle(e.id)
    assert.equal(st.state, 'failed')
    assert.match(st.error, /Missing files: doomed\.mp4/)
    assert.ok(added.media[0].id)
  })

  test('[mcp:get_edit_export] reports progress and the file, and says so when no export was started from this server', async () => {
    const e = await ok('create_edit')
    await fails('get_edit_export', { editId: e.id }, /No export started for this edit from this MCP server\. Past exports are in get_edit/)
    const m = await withMedia()
    await ok('edit_timeline', { editId: m.id, ops: [{ op: 'add_clip', media: m.audio.id, out: 0.5 }] })
    await ok('export_edit', { editId: m.id })
    const st = await settle(m.id)
    assert.deepEqual(Object.keys(st).sort(), ['error', 'file', 'progress', 'seconds', 'startedAt', 'state'])
    assert.equal(st.state, 'done', JSON.stringify(st))
    assert.equal(st.error, null)
    assert.ok(fs.existsSync(st.file))
  })

  test('[mcp:cancel_edit_export][ipc:edits:cancelExport] stops a running export and the state turns cancelled; with none running it says nothing was cancelled', async () => {
    const m = await withMedia()
    await ok('edit_timeline', { editId: m.id, ops: [{ op: 'add_clip', media: m.video.id }] })
    assert.equal((await ok('cancel_edit_export', { editId: m.id })).cancelled, false)
    await ok('export_edit', { editId: m.id })
    assert.equal((await ok('cancel_edit_export', { editId: m.id })).cancelled, true)
    const st = await settle(m.id)
    assert.equal(st.state, 'cancelled', JSON.stringify(st))
    assert.match(st.error, /cancel/i)
    assert.equal((await ok('get_edit', { editId: m.id })).exports.length, 0, 'a cancelled export is not recorded')
  })

  // ---------- delete_edit (last: it changes the list) ----------
  test('[mcp:delete_edit][ipc:edits:delete] removes the timeline and leaves its media files and exports on disk', async () => {
    const m = await withMedia('Doomed')
    await ok('edit_timeline', { editId: m.id, ops: [{ op: 'add_clip', media: m.video.id, out: 0.5 }] })
    await ok('export_edit', { editId: m.id })
    const exported = (await settle(m.id)).file
    const r = await ok('delete_edit', { editId: m.id })
    assert.equal(r.items, true)
    assert.ok(!fs.existsSync(dataFile('edits', `${m.id}.json`)))
    assert.ok(!(await ok('list_edits')).items.some((i) => i.id === m.id))
    await fails('get_edit', { editId: m.id }, /No edit/)
    assert.ok(fs.existsSync(clip) && fs.existsSync(exported), 'the files stay')
  })
})
