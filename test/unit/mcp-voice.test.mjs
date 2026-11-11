// MCP voice tools (task 5.5), called through the real MCP server on source under the test guard, with the server
// reporting darwin: voices are a later release on a Mac, so the engine is never set up and nothing here needs Python,
// a GPU or a download. What the engine would make is stood in for by the cache the product itself keeps: a design draft
// or a spoken line whose file is already there is returned without asking the engine (src/service/voices.js).
// Row ids: the Mac refusal is the case for [mcp:setup_voices]; the board records the voice engine as refused-by-spec in 9.3.
//   node --test test/unit/mcp-voice.test.mjs
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import ffmpegStatic from 'ffmpeg-ffprobe-static'
import { startFakeComfy } from '../fakes/comfyui.mjs'
import { startMcp } from '../fakes/mcp.mjs'

// the same short name the product gives a cached file (voices.js hash())
const hash = (...parts) => createHash('sha1').update(parts.join('\u0000')).digest('hex').slice(0, 12)
const NOT_SET_UP = /Set up voices first/

describe('MCP voice tools on a Mac', () => {
  let fake, mcp, wav, long, bundled
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
  const seconds = (file) => Number(execFileSync(ffmpegStatic.ffprobePath, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString())
  const channelsAndRate = (file) => execFileSync(ffmpegStatic.ffprobePath, ['-v', 'error', '-show_entries', 'stream=channels,sample_rate', '-of', 'csv=p=0', file]).toString().trim()

  before(async () => {
    fake = await startFakeComfy({ devices: 'mps', os: 'darwin' })
    mcp = await startMcp({ comfyUrl: fake.url, platform: 'darwin' })
    const dir = path.join(path.dirname(mcp.dataDir), 'fixtures')
    fs.mkdirSync(dir, { recursive: true })
    wav = path.join(dir, 'voice.wav')
    long = path.join(dir, 'long.wav')
    ff('-f', 'lavfi', '-i', 'sine=f=440:d=3', wav)
    ff('-f', 'lavfi', '-i', 'sine=f=330:d=24', long)
  })
  after(async () => {
    await mcp?.close()
    await fake?.close()
  })

  // ---------- voice_status, setup_voices ----------
  test('[mcp:voice_status] says voices are not set up and, on a Mac, why', async () => {
    const s = await ok('voice_status')
    assert.equal(s.installed, false)
    assert.equal(s.installing, false)
    assert.equal(s.running, false)
    assert.equal(s.ready, false)
    assert.equal(s.unavailable, 'Voices on Mac come in a later release.')
    assert.deepEqual(s.engines.map((e) => [e.id, e.available]), [['voxcpm2', false]])
    assert.equal(s.setup.models.length, 2)
  })

  test('[mcp:setup_voices] refuses on a Mac with its own message, before any download', async () => {
    await fails('setup_voices', {}, /^Voices on Mac come in a later release\.$/)
    assert.deepEqual(await mcp.refusals(), [], 'the product refused, not the guard: no program was started')
    assert.equal(fs.existsSync(dataFile('voiceengine', 'venv')), false)
    assert.equal(fs.existsSync(dataFile('voiceengine', 'installed.json')), false)
    assert.equal((await ok('voice_status')).installing, false)
  })

  // ---------- release_voice_engine ----------
  test('[mcp:release_voice_engine] answers released with nothing running and leaves the status as it was', async () => {
    assert.deepEqual(await ok('release_voice_engine'), { released: true })
    assert.equal((await ok('voice_status')).running, false)
  })

  // ---------- create_voice, list_voices ----------
  test('[mcp:list_voices] starts with the voice bundled for the ready-made Tess character, and lists who uses it', async () => {
    const { items } = await ok('list_voices')
    assert.equal(items.length, 1)
    assert.deepEqual([items[0].name, items[0].kind, items[0].engine, items[0].catalogId, items[0].characters], ['Tess Marlow', 'ready', 'voxcpm2', 'tess', ['tess']])
    assert.equal(channelsAndRate(items[0].reference), '24000,1')
    bundled = items[0].id
  })

  test('[mcp:create_voice] refuses a clone without consent, a missing name and a missing recording', async () => {
    await fails('create_voice', { name: 'Nope', file: wav, kind: 'clone' }, /Only clone your own voice, an invented one, or someone who agreed to it/)
    await fails('create_voice', { name: '  ', file: wav, consent: true }, /Give the voice a name\./)
    await fails('create_voice', { name: 'Ghost', file: dataFile('nothing.wav'), consent: true }, /Pick the recording first\./)
    await fails('create_voice', { name: 'Odd', file: dataFile('settings.json'), consent: true }, /Couldn't read that recording/)
    assert.deepEqual((await ok('list_voices')).items.map((v) => v.id), [bundled], 'nothing was saved')
  })

  test('[mcp:create_voice] saves a clone as a mono 24 kHz reference with the words it was given', async () => {
    const v = await ok('create_voice', { name: '  Tess clone  ', file: wav, kind: 'clone', text: 'Hello there.', description: 'warm', seed: 9, consent: true })
    assert.match(v.id, /^[0-9a-f]{8}$/)
    assert.equal(v.name, 'Tess clone')
    assert.equal(v.kind, 'clone')
    assert.equal(v.engine, 'voxcpm2')
    assert.equal(v.text, 'Hello there.')
    assert.equal(v.seed, 9)
    assert.equal(v.source, wav)
    assert.equal(v.reference, dataFile('voices', v.id, 'reference.wav'))
    assert.equal(channelsAndRate(v.reference), '24000,1')
    assert.ok(Math.abs(v.duration - 3) < 0.1, `duration ${v.duration}`)
    assert.deepEqual(readData('voices', v.id, 'voice.json'), v)
  })

  test('[mcp:create_voice] keeps only the first 20 seconds of a long recording, and an engine that is not set up leaves the words empty', async () => {
    const v = await ok('create_voice', { name: 'Long one', file: long, kind: 'designed' })
    assert.ok(Math.abs(seconds(v.reference) - 20) < 0.2, `reference is ${seconds(v.reference)} s`)
    assert.ok(Math.abs(v.duration - 20) < 0.2)
    assert.equal(v.kind, 'designed')
    assert.equal(v.text, '', 'Whisper cannot read it back without the engine; the voice is still saved')
    await ok('delete_voice', { id: v.id })
  })

  test('[mcp:list_voices] lists voices newest first with the characters that use each', async () => {
    const second = await ok('create_voice', { name: 'Second', file: wav, text: 'Two.', kind: 'designed' })
    await ok('save_character', { id: 'tess', voiceId: second.id })
    const { items } = await ok('list_voices')
    assert.deepEqual(items.map((v) => v.name), ['Second', 'Tess clone', 'Tess Marlow'])
    assert.deepEqual(items.find((v) => v.id === second.id).characters, ['tess'])
    assert.deepEqual(items.find((v) => v.id === bundled).characters, [], 'a character has one voice')
    await ok('save_character', { id: 'tess', voiceId: bundled })
    await ok('delete_voice', { id: second.id })
  })

  // ---------- update_voice ----------
  test('[mcp:update_voice] renames a voice and changes its seed, words and description and nothing else', async () => {
    const v = (await ok('list_voices')).items.find((x) => x.name === 'Tess clone')
    const u = await ok('update_voice', { id: v.id, name: 'Tess (calm)', seed: 3, text: 'Hi.', description: 'calm' })
    assert.deepEqual([u.name, u.seed, u.text, u.description], ['Tess (calm)', 3, 'Hi.', 'calm'])
    assert.equal(u.reference, v.reference)
    assert.equal(u.kind, v.kind)
    assert.equal(readData('voices', v.id, 'voice.json').name, 'Tess (calm)')
    assert.equal((await ok('update_voice', { id: v.id, seed: null })).seed, null)
    await fails('update_voice', { id: 'nope', name: 'x' }, /No voice nope\./)
  })

  // ---------- design_voice ----------
  test('[mcp:design_voice] asks for a description, and without the engine reports voices are not set up', async () => {
    await fails('design_voice', { description: ' '.repeat(10) }, /Describe the voice first/)
    await fails('design_voice', { description: 'a calm older woman' }, NOT_SET_UP)
    assert.deepEqual(await mcp.refusals(), [], 'no Python was started')
  })

  test('[mcp:design_voice] returns candidates already drafted for the same description, text and seeds, without the engine', async () => {
    const description = 'a calm older woman, soft accent'
    const text = 'Good evening.'
    const drafts = dataFile('voices', '_drafts')
    fs.mkdirSync(drafts, { recursive: true })
    // seeds step by 7 from the first; a draft's file name is a hash of its description, words and seed
    for (const s of [5, 12]) fs.copyFileSync(wav, path.join(drafts, `${hash(description, text, s)}.wav`))
    const items = (await ok('design_voice', { description, text, seed: 5, count: 2 })).items
    assert.deepEqual(items.map((i) => i.seed), [5, 12])
    assert.deepEqual(items.map((i) => i.file), [5, 12].map((s) => path.join(drafts, `${hash(description, text, s)}.wav`)))
    assert.ok(items.every((i) => i.text === text && i.description === description && Math.abs(i.duration - 3) < 0.1))
    // a third candidate was never drafted, so it needs the engine
    await fails('design_voice', { description, text, seed: 5, count: 3 }, NOT_SET_UP)
  })

  // ---------- speak_line, list_lines, delete_line ----------
  test('[mcp:speak_line] returns a line already spoken in that voice and seed without the engine, and records it', async () => {
    const v = await ok('create_voice', { name: 'Narrator', file: wav, text: 'Reference words.', kind: 'designed', seed: 41 })
    const say = 'The rain stopped.'
    const file = dataFile('voices', 'lines', `${v.id}_${hash(say, 'voxcpm2', 41, v.text)}.wav`)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.copyFileSync(wav, file)
    const line = await ok('speak_line', { voiceId: v.id, text: `  ${say}  ` })
    assert.match(line.id, /^[0-9a-f]{8}$/)
    assert.deepEqual([line.voiceId, line.voice, line.text, line.engine, line.seed], [v.id, 'Narrator', say, 'voxcpm2', 41])
    assert.equal(line.file, file)
    assert.ok(Math.abs(line.duration - 3) < 0.1)
    assert.deepEqual(readData('voices', 'lines.json').map((l) => l.id), [line.id])
  })

  test('[mcp:speak_line] finds the voice through a character, and refuses an empty line, no voice and an engine that is not set up', async () => {
    const [v] = (await ok('list_voices')).items.filter((x) => x.name === 'Narrator')
    await ok('save_character', { id: 'tess', voiceId: v.id })
    const say = 'The rain stopped.'
    const via = await ok('speak_line', { character: 'tess', text: say })
    assert.equal(via.voiceId, v.id, 'the character carries the voice')
    await fails('speak_line', { voiceId: v.id, text: 'A line nobody has said.' }, NOT_SET_UP)
    await fails('speak_line', { voiceId: v.id, text: '   ' }, /Type the line first\./)
    await fails('speak_line', { text: 'Hello' }, /Give voiceId or character\./)
    await fails('speak_line', { character: 'nobody', text: 'Hello' }, /nobody has no voice yet: give them one with save_character voiceId\./)
    await fails('speak_line', { voiceId: 'nope', text: 'Hello' }, /No voice nope\./)
    await ok('save_character', { id: 'tess', voiceId: bundled })
  })

  test('[mcp:list_lines] lists lines newest first, optionally for one voice', async () => {
    const other = await ok('create_voice', { name: 'Other', file: wav, text: 'Other words.', kind: 'designed', seed: 2 })
    const say = 'Another one.'
    const file = dataFile('voices', 'lines', `${other.id}_${hash(say, 'voxcpm2', 2, other.text)}.wav`)
    fs.copyFileSync(wav, file)
    const mine = await ok('speak_line', { voiceId: other.id, text: say })
    const all = (await ok('list_lines')).items
    assert.equal(all.length, 3)
    assert.equal(all[0].id, mine.id, 'newest first')
    const only = (await ok('list_lines', { voiceId: other.id })).items
    assert.deepEqual(only.map((l) => l.id), [mine.id])
    assert.deepEqual((await ok('list_lines', { voiceId: 'nope' })).items, [])
  })

  test('[mcp:delete_line] removes the line and its file, but keeps a file another line still uses', async () => {
    const lines = (await ok('list_lines')).items
    const shared = lines.filter((l) => l.text === 'The rain stopped.')
    assert.equal(shared.length, 2, 'the same words, voice and seed share one file')
    assert.equal(shared[0].file, shared[1].file)
    assert.deepEqual(await ok('delete_line', { id: shared[0].id }), { deleted: shared[0].id })
    assert.ok(fs.existsSync(shared[1].file), 'the other line still needs it')
    assert.deepEqual(await ok('delete_line', { id: shared[1].id }), { deleted: shared[1].id })
    assert.equal(fs.existsSync(shared[1].file), false)
    assert.equal((await ok('list_lines')).items.length, 1)
    await fails('delete_line', { id: shared[0].id }, new RegExp(`No line ${shared[0].id}\\.`))
  })

  // ---------- delete_voice ----------
  test('[mcp:delete_voice] removes the voice and its lines, and a character that used it loses the voice', async () => {
    const v = (await ok('list_voices')).items.find((x) => x.name === 'Other')
    await ok('save_character', { id: 'tess', voiceId: v.id })
    assert.deepEqual(await ok('delete_voice', { id: v.id }), { deleted: v.id })
    assert.equal(fs.existsSync(dataFile('voices', v.id)), false)
    assert.deepEqual((await ok('list_lines', { voiceId: v.id })).items, [])
    assert.equal((await ok('list_characters')).items.find((c) => c.id === 'tess').voiceId, null)
    assert.ok(!(await ok('list_voices')).items.some((x) => x.id === v.id))
    await fails('delete_voice', { id: v.id }, /No voice /)
  })
})
