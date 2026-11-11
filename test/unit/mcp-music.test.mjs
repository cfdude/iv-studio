// MCP music tools (task 5.5), called through the real MCP server on source under the test guard, against the fake
// ComfyUI (design D1, D8). One fake and one server for the file. A song is a job on the fake: the graph it queued is
// read from fake.prompts, and a finished song is made by the test writing an audio output into the fake's history.
//   node --test test/unit/mcp-music.test.mjs
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import ffmpegStatic from 'ffmpeg-ffprobe-static'
import { startFakeComfy } from '../fakes/comfyui.mjs'
import { startMcp } from '../fakes/mcp.mjs'

const manifest = JSON.parse(fs.readFileSync(new URL('../../resources/models.json', import.meta.url), 'utf8'))
const MUSIC_MODELS = ['music3_dit', 'music3_te', 'music3_vae', 'ace15']
const node = () => ({ input: { required: {} } })

// object_info that has the music nodes and lists each music model file by its manifest name. remix: the two nodes
// Remix also needs. models: which of the four model files to list.
function musicInfo({ remix = true, models = MUSIC_MODELS } = {}) {
  const info = { MiniMaxMusic3TextEncode: node(), EmptyMiniMaxMusic3LatentAudio: node(), 'TextEncodeAceStepAudio1.5': node(), 'EmptyAceStep1.5LatentAudio': node() }
  if (remix) Object.assign(info, { LoadAudio: node(), VAEEncodeAudio: node() })
  for (const id of models) {
    const m = manifest.models.find((x) => x.id === id)
    const [cls, input] = m.loader.split('.')
    info[cls] ||= node()
    info[cls].input.required[input] = [[...(info[cls].input.required[input]?.[0] || []), m.match]]
  }
  return info
}

describe('MCP music tools', () => {
  let fake, mcp, dir, wav, short, clicks
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
  const dataFile = (...p) => path.join(mcp.dataDir, ...p)
  const readData = (...p) => JSON.parse(fs.readFileSync(dataFile(...p), 'utf8'))
  const ff = (...args) => execFileSync(ffmpegStatic.ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args])
  const lastGraph = () => fake.prompts.at(-1).prompt
  const byClass = (graph, cls) => Object.values(graph).find((n) => n.class_type === cls)
  // ComfyUI finishing a song: its audio output lands in the history of the song's job
  const finishSong = (song, file) => {
    fake.state.history[song.promptId ?? promptOf(song)].outputs = { 8: { audio: [{ filename: path.basename(file), subfolder: 'iv_studio/music', type: 'output', fullpath: file }] } }
  }
  const promptOf = (song) => readData('jobs', `${song.jobId}.json`).promptId
  // a song made, finished on the fake and read back
  const finished = async ({ length = 4, ...args } = {}) => {
    const song = await ok('make_music', { engine: 'ace', caption: 'lo-fi piano', seconds: 10, ...args })
    const file = path.join(dir, `${song.id}.flac`)
    ff('-f', 'lavfi', '-i', `sine=f=523:d=${length}`, file)
    finishSong(song, file)
    return ok('get_music', { songId: song.id })
  }

  before(async () => {
    fake = await startFakeComfy({ devices: 'mps', os: 'darwin', objectInfo: {} })
    mcp = await startMcp({ comfyUrl: fake.url })
    dir = path.join(path.dirname(mcp.dataDir), 'fixtures')
    fs.mkdirSync(dir, { recursive: true })
    wav = path.join(dir, 'song.wav')
    short = path.join(dir, 'short.wav')
    clicks = path.join(dir, 'clicks.wav')
    ff('-f', 'lavfi', '-i', 'sine=f=440:d=8', wav)
    ff('-f', 'lavfi', '-i', 'sine=f=440:d=2', short)
    // a click every half second: 120 beats a minute
    ff('-f', 'lavfi', '-i', "aevalsrc='if(lt(mod(t,0.5),0.03),sin(2*PI*1000*t),0)':s=22050:d=12", clicks)
  })
  after(async () => {
    await mcp?.close()
    await fake?.close()
  })

  // ---------- music_status ----------
  test('[mcp:music_status][ipc:music:status] lists what each engine is missing when the ComfyUI has none of the music models', async () => {
    const s = await ok('music_status')
    assert.equal(s.ready, false)
    const [minimax, ace] = s.engines
    assert.deepEqual(minimax.missing.map((m) => m.id), ['music3_dit', 'music3_te', 'music3_vae'])
    assert.deepEqual(ace.missing.map((m) => m.id), ['ace15'])
    assert.deepEqual(minimax.missingNodes, ['MiniMaxMusic3TextEncode', 'EmptyMiniMaxMusic3LatentAudio'])
    assert.equal(minimax.ready, false)
    assert.equal(ace.remixReady, false)
  })

  test('[mcp:music_status] reports both engines ready, the files found by name, Remix and the GPU memory once the models and nodes are there', async () => {
    fake.setObjectInfo(musicInfo())
    const s = await ok('music_status')
    assert.equal(s.ready, true)
    assert.deepEqual(s.engines.map((e) => [e.id, e.ready, e.missing.length]), [['minimax', true, 0], ['ace', true, 0]])
    assert.equal(s.engines[0].files.music3_dit, manifest.models.find((m) => m.id === 'music3_dit').match)
    assert.equal(s.engines[1].files.ace15, manifest.models.find((m) => m.id === 'ace15').match)
    assert.equal(s.engines[1].remixReady, true)
    assert.equal(s.vramGb, 64, 'Apple GPU memory is the unified memory the fake reports')
  })

  test('[mcp:music_status] says the engine is ready for ACE-Step alone when only its checkpoint is installed', async () => {
    fake.setObjectInfo(musicInfo({ models: ['ace15'] }))
    const s = await ok('music_status')
    assert.deepEqual(s.engines.map((e) => e.ready), [false, true])
    assert.equal(s.ready, true)
    fake.setObjectInfo(musicInfo())
  })

  // ---------- make_music ----------
  test('[mcp:make_music][ipc:music:create] queues the MiniMax graph with the style, lyrics, length and seed and records the song in a music project', async () => {
    const queued = fake.prompts.length
    const lyrics = '[Verse]\nRain on the window\n[Chorus]\nWe go on'
    const song = await ok('make_music', { caption: 'warm indie folk, female voice', lyrics, seconds: 45, seed: 77, name: 'Rain song' })
    assert.equal(fake.prompts.length, queued + 1)
    const g = lastGraph()
    assert.deepEqual(byClass(g, 'MiniMaxMusic3TextEncode').inputs, { clip: ['2', 0], caption: 'warm indie folk, female voice', lyrics, seed: 77, max_duration: 45, cfg_scale: 1.7, top_k: 50 })
    assert.equal(byClass(g, 'UNETLoader').inputs.unet_name, manifest.models.find((m) => m.id === 'music3_dit').match)
    assert.equal(byClass(g, 'KSampler').inputs.steps, 30)
    assert.equal(byClass(g, 'VAEDecodeAudio').class_type, 'VAEDecodeAudio', 'a Mac with plenty of memory decodes in one piece')
    assert.match(byClass(g, 'SaveAudio').inputs.filename_prefix, new RegExp(`music/rain_song_${song.id}$`))
    assert.deepEqual([song.engine, song.name, song.seconds, song.seed, song.instrumental, song.lyrics, song.status, song.file], ['minimax', 'Rain song', 45, 77, false, lyrics, 'queued', null])
    assert.equal(fake.prompts.at(-1).id, promptOf(song))
    // saved: the song, its job, and a project for the music tool
    assert.equal(readData('music', 'songs.json')[0].id, song.id)
    assert.equal(readData('projects', `${song.projectId}.json`).tool, 'music')
    assert.equal(readData('projects', `${song.projectId}.json`).name, 'Music · Rain song')
  })

  test('[mcp:make_music] queues the ACE-Step graph with tempo, key, time signature and language, and a plain instrumental when no lyrics are given', async () => {
    const song = await ok('make_music', { engine: 'ace', caption: 'dark synthwave, driving bass', seconds: 30, seed: 5, bpm: 96, key: 'E minor', timesignature: '3', language: 'es' })
    const g = lastGraph()
    const enc = byClass(g, 'TextEncodeAceStepAudio1.5').inputs
    assert.deepEqual([enc.tags, enc.lyrics, enc.seed, enc.bpm, enc.duration, enc.timesignature, enc.language, enc.keyscale, enc.generate_audio_codes], ['dark synthwave, driving bass', '[Instrumental]', 5, 96, 30, '3', 'es', 'E minor', true])
    assert.equal(byClass(g, 'KSampler').inputs.steps, 8)
    assert.equal(byClass(g, 'CheckpointLoaderSimple').inputs.ckpt_name, manifest.models.find((m) => m.id === 'ace15').match)
    assert.deepEqual([song.instrumental, song.lyrics, song.bpm, song.key, song.timesignature, song.language], [true, '', 96, 'E minor', '3', 'es'])
    assert.equal(song.name, 'dark synthwave', 'the name is the first phrase of the style')
  })

  test('[mcp:make_music] makes an instrumental even when lyrics are given and fills in the defaults', async () => {
    const song = await ok('make_music', { engine: 'ace', caption: 'ambient pads', lyrics: 'la la la', instrumental: true })
    assert.equal(byClass(lastGraph(), 'TextEncodeAceStepAudio1.5').inputs.lyrics, '[Instrumental]')
    assert.deepEqual([song.seconds, song.bpm, song.key, song.timesignature, song.language], [60, 120, 'C major', '4', 'en'])
  })

  test('[mcp:make_music] refuses a missing style, a length the engine cannot make and a tempo outside 30 to 300, and queues nothing', async () => {
    const queued = fake.prompts.length
    await fails('make_music', { caption: '   ' }, /Describe the music first/)
    await fails('make_music', { caption: 'a song', seconds: 301 }, /MiniMax Music 3 makes 5 to 300 seconds\./)
    await fails('make_music', { engine: 'ace', caption: 'a song', seconds: 601 }, /(makes 5 to 600 seconds|600)/)
    await fails('make_music', { engine: 'ace', caption: 'a song', key: 'H minor' }, /key/i)
    await fails('make_music', { engine: 'ace', caption: 'a song', timesignature: '5' }, /timesignature/i)
    await fails('make_music', { engine: 'ace', caption: 'a song', bpm: 400 }, /bpm/i)
    await fails('make_music', { engine: 'tape', caption: 'a song' }, /engine/i)
    assert.equal(fake.prompts.length, queued)
  })

  test('[mcp:make_music] names the missing models and the missing node and queues nothing', async () => {
    const queued = fake.prompts.length
    fake.setObjectInfo(musicInfo({ models: ['ace15'] }))
    await fails('make_music', { caption: 'a song' }, /MiniMax Music 3 needs MiniMax Music 3 DiT \(fp16\), MiniMax Music 3 text encoder \(int8\), MiniMax Music 3 audio VAE\. Download them on the Music page\./)
    const info = musicInfo()
    delete info['TextEncodeAceStepAudio1.5']
    fake.setObjectInfo(info)
    await fails('make_music', { engine: 'ace', caption: 'a song' }, /This ComfyUI has no TextEncodeAceStepAudio1\.5 node\. Update ComfyUI/)
    assert.equal(fake.prompts.length, queued)
    fake.setObjectInfo(musicInfo())
  })

  // ---------- get_music ----------
  test('[mcp:get_music][ipc:music:get] reports a waiting song with its place in the queue', async () => {
    fake.holdNextPrompt(1)
    const song = await ok('make_music', { engine: 'ace', caption: 'a waiting song', seconds: 10 })
    const got = await ok('get_music', { songId: song.id })
    assert.equal(got.status, 'queued')
    assert.equal(got.queuePosition, 1)
    assert.equal(got.file, null)
    await ok('cancel_music', { songId: song.id })
  })

  test('[mcp:get_music] copies a finished song into the music folder once and reads its length', async () => {
    const got = await finished({ name: 'Piano', caption: 'lo-fi piano' })
    assert.equal(got.status, 'success')
    assert.equal(got.file, dataFile('music', `piano_${got.id}.flac`))
    assert.ok(fs.existsSync(got.file))
    assert.ok(Math.abs(got.duration - 4) < 0.2, `duration ${got.duration}`)
    assert.ok(got.finishedAt)
    const again = await ok('get_music', { songId: got.id })
    assert.equal(again.file, got.file)
    assert.equal(readData('music', 'songs.json').find((s) => s.id === got.id).status, 'success')
  })

  test('[mcp:get_music] reports ComfyUI\'s error, a finish with no audio, and an unknown song', async () => {
    fake.failNextPrompt('Out of memory')
    const failed = await ok('make_music', { engine: 'ace', caption: 'a failing song', seconds: 10 })
    const got = await ok('get_music', { songId: failed.id })
    assert.equal(got.status, 'error')
    assert.match(got.error, /Out of memory/)
    const silent = await ok('make_music', { engine: 'ace', caption: 'a silent song', seconds: 10 })
    const none = await ok('get_music', { songId: silent.id })
    assert.equal(none.status, 'error')
    assert.equal(none.error, 'ComfyUI finished but saved no audio.')
    await fails('get_music', { songId: 'nope' }, /No song nope\./)
  })

  // ---------- list_music ----------
  test('[mcp:list_music][ipc:music:list] lists every song newest first with its status, file and engine', async () => {
    const { id } = await finished({ name: 'Newest', caption: 'newest style' })
    const list = JSON.parse((await call('list_music')).content[0].text)
    assert.equal(list.length, new Set(list.map((s) => s.id)).size)
    assert.equal(list[0].id, id)
    assert.deepEqual([list[0].status, list[0].engine, list[0].name], ['success', 'ace', 'Newest'])
    assert.ok(list[0].file.startsWith(dataFile('music')))
    assert.ok(list.some((s) => s.engine === 'minimax' && s.name === 'Rain song'))
    assert.ok(list.some((s) => s.status === 'error'), 'failed songs stay in the list')
  })

  // ---------- rename_music ----------
  test('[mcp:rename_music][ipc:music:rename] renames a song, trims the name and refuses an empty one or an unknown song', async () => {
    const song = await ok('make_music', { engine: 'ace', caption: 'a song to rename', seconds: 10 })
    assert.equal((await ok('rename_music', { songId: song.id, name: '  Better name  ' })).name, 'Better name')
    assert.equal(readData('music', 'songs.json').find((s) => s.id === song.id).name, 'Better name')
    await fails('rename_music', { songId: song.id, name: '' }, /name/i)
    await fails('rename_music', { songId: song.id, name: ' ' }, /Give the song a name\./)
    await fails('rename_music', { songId: 'nope', name: 'x' }, /No song nope\./)
  })

  // ---------- cancel_music ----------
  test('[mcp:cancel_music][ipc:music:cancel] takes a waiting song out of ComfyUI\'s queue and marks it cancelled', async () => {
    fake.holdNextPrompt(1)
    const song = await ok('make_music', { engine: 'ace', caption: 'a song to cancel', seconds: 10 })
    assert.deepEqual(fake.state.pending.map((p) => p[1]), [promptOf(song)])
    const r = await ok('cancel_music', { songId: song.id })
    assert.equal(r.result, 'removed from queue')
    assert.equal(r.status, 'cancelled')
    assert.deepEqual(fake.state.pending, [])
    assert.equal(readData('music', 'songs.json').find((s) => s.id === song.id).status, 'cancelled')
    await fails('cancel_music', { songId: 'nope' }, /No song nope\./)
  })

  test('[mcp:cancel_music] interrupts a song that is running, and no other job', async () => {
    fake.holdNextPrompt(1)
    const song = await ok('make_music', { engine: 'ace', caption: 'a running song', seconds: 10 })
    fake.state.running.push(fake.state.pending.splice(0)[0])
    const r = await ok('cancel_music', { songId: song.id })
    assert.equal(r.result, 'interrupted')
    assert.deepEqual(fake.requests.filter((q) => q.path === '/interrupt').at(-1).json, { prompt_id: promptOf(song) })
    fake.state.running.length = 0
  })

  // ---------- delete_music ----------
  test('[mcp:delete_music][ipc:music:delete] removes a finished song, its file in the music folder and its project, and keeps ComfyUI\'s own copy', async () => {
    const got = await finished({ name: 'Doomed' })
    const comfyCopy = path.join(dir, `${got.id}.flac`)
    assert.deepEqual(await ok('delete_music', { songId: got.id }), { deleted: got.id })
    assert.equal(fs.existsSync(got.file), false)
    assert.ok(fs.existsSync(comfyCopy), "ComfyUI's output is not touched")
    assert.ok(!readData('music', 'songs.json').some((s) => s.id === got.id))
    assert.equal(fs.existsSync(dataFile('projects', `${got.projectId}.json`)), false)
    await fails('get_music', { songId: got.id }, /No song /)
    await fails('delete_music', { songId: got.id }, /No song /)
  })

  test('[mcp:delete_music] cancels a song that is still waiting before it is removed', async () => {
    fake.holdNextPrompt(1)
    const song = await ok('make_music', { engine: 'ace', caption: 'a song to delete', seconds: 10 })
    await ok('delete_music', { songId: song.id })
    assert.deepEqual(fake.state.pending, [], 'it is out of ComfyUI\'s queue')
    assert.ok(!readData('music', 'songs.json').some((s) => s.id === song.id))
  })

  // ---------- read_song ----------
  test('[mcp:read_song][ipc:music:analyse] reads a sound file\'s length, tempo and key', async () => {
    const r = await ok('read_song', { source: clicks })
    assert.equal(r.file, clicks)
    assert.equal(r.name, 'clicks')
    assert.ok(Math.abs(r.duration - 12) < 0.2, `duration ${r.duration}`)
    assert.ok(r.bpm >= 116 && r.bpm <= 124, `a click every half second is about 120 BPM, got ${r.bpm}`)
    assert.equal(typeof r.key, 'string')
    assert.ok(r.beatStrength > 0)
  })

  test('[mcp:read_song] reads a finished song by id, and refuses a missing file, a non-sound file and an unknown song', async () => {
    const song = await finished({ name: 'Readable' })
    const r = await ok('read_song', { songId: song.id })
    assert.equal(r.name, 'Readable')
    assert.equal(r.file, song.file)
    assert.ok(Math.abs(r.duration - 4) < 0.2)
    await fails('read_song', { source: dataFile('nothing.wav') }, /File not found/)
    await fails('read_song', { source: dataFile('settings.json') }, /Remix takes a sound file/)
    await fails('read_song', { songId: 'nope' }, /No song nope\./)
    await fails('read_song', {}, /Pick a song to remix\./)
  })

  // ---------- remix_music ----------
  test('[mcp:remix_music][ipc:music:remix] queues the ACE-Step remix graph on the uploaded song with the default strength, tempo and key as given', async () => {
    const uploads = fake.uploads.length
    const song = await ok('remix_music', { source: wav, caption: 'jazz trio, brushed drums', bpm: 100, key: 'A minor', seed: 3 })
    const g = lastGraph()
    assert.deepEqual(fake.uploads.slice(uploads).map((u) => [u.name, u.subfolder]), [['song.wav', 'iv_studio/remix']])
    assert.equal(byClass(g, 'LoadAudio').inputs.audio, 'iv_studio/remix/song.wav')
    assert.equal(byClass(g, 'KSampler').inputs.denoise, 0.65)
    assert.equal(byClass(g, 'VAEEncodeAudio').class_type, 'VAEEncodeAudio')
    const enc = byClass(g, 'TextEncodeAceStepAudio1.5').inputs
    assert.deepEqual([enc.tags, enc.lyrics, enc.bpm, enc.keyscale, enc.generate_audio_codes, enc.duration, enc.seed], ['jazz trio, brushed drums', '[Instrumental]', 100, 'A minor', false, 8, 3])
    assert.deepEqual([song.name, song.engine, song.instrumental, song.seconds, song.remix], ['song (remix)', 'ace', true, 8, { source: wav, sourceName: 'song', strength: 0.65 }])
    assert.equal(song.status, 'queued')
  })

  test('[mcp:remix_music] reads the tempo and key from the song when they are not given, and takes a strength and a name', async () => {
    const song = await ok('remix_music', { source: clicks, caption: 'big band', strength: 0.8, name: 'Swing' })
    const enc = byClass(lastGraph(), 'TextEncodeAceStepAudio1.5').inputs
    assert.ok(enc.bpm >= 116 && enc.bpm <= 124, `tempo read from the song: ${enc.bpm}`)
    assert.match(enc.keyscale, /^[A-G][#b]? (major|minor)$/)
    assert.equal(byClass(lastGraph(), 'KSampler').inputs.denoise, 0.8)
    assert.equal(song.name, 'Swing')
    assert.equal(song.remix.strength, 0.8)
  })

  test('[mcp:remix_music] remixes a finished song from the list by its id', async () => {
    const made = await finished({ name: 'Origin', length: 8 })
    const uploads = fake.uploads.length
    const song = await ok('remix_music', { songId: made.id, caption: 'orchestral', bpm: 90, key: 'C major' })
    assert.equal(song.name, 'Origin (remix)')
    assert.deepEqual([song.remix.source, song.remix.sourceName], [made.file, 'Origin'])
    assert.equal(fake.uploads[uploads].name, path.basename(made.file))
  })

  test('[mcp:remix_music] refuses a missing style, a strength outside 0.4 to 0.9, and a song that is missing, not a sound, unfinished or too short', async () => {
    const queued = fake.prompts.length
    await fails('remix_music', { source: wav, caption: '  ' }, /Describe the new style first/)
    await fails('remix_music', { source: wav, caption: 'x', strength: 0.95 }, /strength/i)
    await fails('remix_music', { source: wav, caption: 'x', strength: 0.3 }, /strength/i)
    await fails('remix_music', { caption: 'x' }, /Pick a song to remix\./)
    await fails('remix_music', { source: dataFile('nothing.wav'), caption: 'x' }, /File not found/)
    await fails('remix_music', { source: dataFile('settings.json'), caption: 'x' }, /Remix takes a sound file/)
    await fails('remix_music', { songId: 'nope', caption: 'x' }, /No song nope\./)
    await fails('remix_music', { source: short, caption: 'x', bpm: 100, key: 'C major' }, /Remix takes songs of 5 seconds to 5 minutes; this one is 2 s\. Trim it first\./)
    fake.holdNextPrompt(1)
    const waiting = await ok('make_music', { engine: 'ace', caption: 'unfinished', seconds: 10 })
    await fails('remix_music', { songId: waiting.id, caption: 'x' }, /has no finished file to remix\./)
    await ok('cancel_music', { songId: waiting.id })
    assert.equal(fake.prompts.length, queued + 1, 'only the unfinished song itself was queued')
  })

  test('[mcp:remix_music] says what to download or update when the ComfyUI cannot remix', async () => {
    const queued = fake.prompts.length
    fake.setObjectInfo(musicInfo({ remix: false }))
    await fails('remix_music', { source: wav, caption: 'x', bpm: 100, key: 'C major' }, /can't load songs \(no LoadAudio or VAEEncodeAudio node\)\. Update ComfyUI\./)
    fake.setObjectInfo(musicInfo({ models: ['music3_dit', 'music3_te', 'music3_vae'] }))
    await fails('remix_music', { source: wav, caption: 'x', bpm: 100, key: 'C major' }, /Remix uses ACE-Step 1\.5 Turbo, which needs ACE-Step 1\.5 Turbo \(all-in-one\)\. Download it on the Music page\./)
    assert.equal(fake.prompts.length, queued)
    fake.setObjectInfo(musicInfo())
  })
})
