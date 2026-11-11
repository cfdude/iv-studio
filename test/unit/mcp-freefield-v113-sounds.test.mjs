// MCP tools new in upstream v1.1.3, part 1: sounds (Stable Audio 3), recipes and "show me where", called through the
// real MCP server on source under the test guard, against the fake ComfyUI and the fake Ollama. A sound is a job on
// the fake: the graph it queued is read from fake.prompts, and a finished sound is made by the test writing audio
// outputs into the fake's history, the way ComfyUI saves them.
//   node --test test/unit/mcp-freefield-v113-sounds.test.mjs
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import ffmpegStatic from 'ffmpeg-ffprobe-static'
import { startFakeComfy } from '../fakes/comfyui.mjs'
import { startMcp } from '../fakes/mcp.mjs'
import { startFakeOllama } from '../fakes/outside.mjs'
import { guardState } from '../fakes/ports.mjs'
import { seedSettings } from '../fakes/mcp.mjs'
import os from 'node:os'
import { pathToFileURL } from 'node:url'

const CKPT = 'stable_audio_3_medium.safetensors'
const TE = 't5gemma_b_b_ul2.safetensors'
const node = (required = {}) => ({ input: { required } })
const NODES = { EmptyLatentAudio: node(), VAEDecodeAudio: node(), SaveAudio: node() }
// object_info with Stable Audio 3's nodes and (models) its two files
const soundInfo = ({ nodes = true, models = true, ckpt = CKPT, te = TE, types = ['stable_audio', 'lumina2'] } = {}) => ({
  ...(nodes ? NODES : {}),
  CheckpointLoaderSimple: node({ ckpt_name: [models ? [ckpt] : ['other.safetensors']] }),
  CLIPLoader: node({ clip_name: [models ? [te] : ['other.safetensors']], type: [types] })
})

describe('MCP sound tools', () => {
  let fake, ollama, mcp, dir
  let written = { description: 'A heavy wooden door slams shut in a stone hallway, a short echo after.', seconds: 3 }
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
  const byClass = (cls) => Object.values(lastGraph()).find((n) => n.class_type === cls)
  // ComfyUI saved these audio files for the last prompt queued
  const saved = (...files) => {
    fake.state.history[fake.prompts.at(-1).id].outputs = { 8: { audio: files.map((f) => ({ filename: path.basename(f), subfolder: 'iv_studio/sounds', type: 'output', fullpath: f })) } }
  }
  const withSounds = async (fn, info = soundInfo()) => {
    fake.setObjectInfo(info)
    try {
      return await fn()
    } finally {
      fake.setObjectInfo({})
    }
  }
  let n = 0
  const flac = (seconds = 2) => {
    const f = path.join(dir, `take${++n}.flac`)
    ff('-f', 'lavfi', '-i', `sine=f=440:d=${seconds}`, f)
    return f
  }

  before(async () => {
    fake = await startFakeComfy({ devices: 'mps', os: 'darwin' })
    ollama = await startFakeOllama({ answer: () => written })
    mcp = await startMcp({ comfyUrl: fake.url, settings: { ollamaUrl: ollama.url, ollamaModel: 'fake-vl:8b', promptEngine: 'local' } })
    dir = path.join(path.dirname(mcp.dataDir), 'fixtures')
    fs.mkdirSync(dir, { recursive: true })
  })
  after(async () => {
    await mcp?.close()
    await ollama?.close()
    await fake?.close()
  })

  // ---------- sound_status ----------
  test('[mcp:sound_status] says what a bare ComfyUI lacks: both models by label and size, and the audio nodes', async () => {
    const s = await ok('sound_status')
    assert.equal(s.ready, false)
    assert.deepEqual(s.missing.map((m) => [m.id, m.label, m.folder]), [['sa3', 'Stable Audio 3 (medium)', 'checkpoints'], ['sa3_te', 'Stable Audio 3 text encoder (T5Gemma)', 'text_encoders']])
    assert.ok(s.missing.every((m) => m.size > 0))
    assert.deepEqual(s.missingNodes, ['EmptyLatentAudio', 'VAEDecodeAudio', 'SaveAudio', 'CLIPLoader (stable_audio)'])
    assert.deepEqual(s.engine, { label: 'Stable Audio 3', by: 'Stability AI', licence: 'Stable Audio Community License', models: ['sa3', 'sa3_te'] })
  })

  test('[mcp:sound_status] is ready when the nodes and both files are listed, and gives the file as ComfyUI lists it, folder included', async () => {
    await withSounds(async () => {
      const s = await ok('sound_status')
      assert.deepEqual([s.ready, s.missing, s.missingNodes], [true, [], []])
      assert.deepEqual(s.files, { sa3: `StableAudio/${CKPT}`, sa3_te: TE })
    }, soundInfo({ ckpt: `StableAudio/${CKPT}` }))
  })

  test('[mcp:sound_status] names a CLIP loader that has no stable_audio type even when the files are there', async () => {
    await withSounds(async () => {
      const s = await ok('sound_status')
      assert.equal(s.ready, false)
      assert.deepEqual(s.missingNodes, ['CLIPLoader (stable_audio)'])
      assert.deepEqual(s.missing, [])
    }, soundInfo({ types: ['lumina2'] }))
  })

  // ---------- write_sound ----------
  test('[mcp:write_sound] has the prompt writer turn a few words into a description and a length, asking in that kind\'s way', async () => {
    const before = ollama.requests.length
    const out = await ok('write_sound', { idea: 'a door slamming', kind: 'sfx' })
    assert.deepEqual(out, { description: written.description, seconds: 3 })
    const asked = ollama.requests.slice(before).find((r) => r.path === '/api/chat' && r.json?.messages)
    assert.ok(asked, 'the writer was asked on the fake Ollama')
    const text = JSON.stringify(asked.json.messages)
    assert.match(text, /Describe one sound effect for a generative audio model/)
    assert.match(text, /The sound: a door slamming/)
    assert.match(text, /whole seconds \(1 to 120\)/)
  })

  test('[mcp:write_sound] uses the ambience wording for an ambience, rounds the length and keeps it within 1 to 120 seconds', async () => {
    written = { description: 'Steady rain on a tin roof.', seconds: 400 }
    try {
      const before = ollama.requests.length
      const long = await ok('write_sound', { idea: 'rain', kind: 'ambience' })
      assert.deepEqual(long, { description: 'Steady rain on a tin roof.', seconds: 120 })
      assert.match(JSON.stringify(ollama.requests.slice(before).find((r) => r.json?.messages).json.messages), /background ambience/)
      written = { description: 'A click.', seconds: 0.2 }
      assert.equal((await ok('write_sound', { idea: 'click' })).seconds, 1)
      // a length the writer left out falls back to the kind's own (a one-shot is 3 s)
      written = { description: 'A deep boom.' }
      assert.equal((await ok('write_sound', { idea: 'boom', kind: 'oneshot' })).seconds, 3)
    } finally {
      written = { description: 'A heavy wooden door slams shut in a stone hallway, a short echo after.', seconds: 3 }
    }
  })

  test('[mcp:write_sound] refuses empty words, and says so when the writer gives nothing back', async () => {
    await fails('write_sound', { idea: '   ' }, /^Write a few words about the sound first\.$/)
    written = { description: '  ', seconds: 3 }
    try {
      await fails('write_sound', { idea: 'a door' }, /^The writer gave nothing back\. Try again\.$/)
    } finally {
      written = { description: 'A heavy wooden door slams shut in a stone hallway, a short echo after.', seconds: 3 }
    }
    await fails('write_sound', { idea: 'x', kind: 'whisper' }, /kind/i)
  })

  // ---------- make_sound ----------
  test('[mcp:make_sound] queues Stable Audio 3 with the description, length, takes and seed, and records the sound in a project', async () => {
    await withSounds(async () => {
      const queued = fake.prompts.length
      const s = await ok('make_sound', { description: 'A heavy wooden door slams shut. Echo.', kind: 'sfx', seconds: 5.25, takes: 3, seed: 7, name: 'Door slam' })
      assert.equal(fake.prompts.length, queued + 1)
      assert.match(s.id, /^[0-9a-f]{8}$/)
      assert.deepEqual([s.name, s.kind, s.seconds, s.takes, s.seed, s.status, s.files], ['Door slam', 'sfx', 5.3, 3, 7, 'queued', []])
      assert.equal(byClass('CheckpointLoaderSimple').inputs.ckpt_name, CKPT)
      assert.deepEqual([byClass('CLIPLoader').inputs.clip_name, byClass('CLIPLoader').inputs.type], [TE, 'stable_audio'])
      const texts = Object.values(lastGraph()).filter((x) => x.class_type === 'CLIPTextEncode').map((x) => x.inputs.text)
      assert.deepEqual(texts, ['A heavy wooden door slams shut. Echo.', ''], 'the description, and an empty negative')
      assert.deepEqual(byClass('EmptyLatentAudio').inputs, { seconds: 5.3, batch_size: 3 })
      const k = byClass('KSampler').inputs
      assert.deepEqual([k.seed, k.steps, k.cfg, k.sampler_name, k.scheduler], [7, 8, 1, 'lcm', 'simple'])
      assert.equal(byClass('SaveAudio').inputs.filename_prefix, `iv_studio/sounds/door_slam_${s.id}`)
      const extra = fake.prompts.at(-1).extra_data.iv_studio
      assert.deepEqual([extra.kind, extra.project], ['sound', s.projectId])
      assert.equal(readData('projects', `${s.projectId}.json`).name, 'Sound · Door slam')
      assert.equal(readData('sounds', 'sounds.json')[0].id, s.id)
    })
  })

  test('[mcp:make_sound] takes its length, name and one take from the kind when only a description is given', async () => {
    await withSounds(async () => {
      const amb = await ok('make_sound', { description: 'Steady rain on a tin roof, distant thunder.', kind: 'ambience' })
      assert.deepEqual([amb.kind, amb.seconds, amb.takes, amb.name], ['ambience', 15, 1, 'Steady rain on a tin roof'])
      assert.deepEqual(byClass('EmptyLatentAudio').inputs, { seconds: 15, batch_size: 1 })
      const sfx = await ok('make_sound', { description: 'A click.' })
      assert.deepEqual([sfx.kind, sfx.seconds], ['sfx', 4])
      assert.ok(Number.isInteger(sfx.seed) && sfx.seed >= 0, 'no seed asked: one is rolled')
      assert.equal((await ok('make_sound', { description: 'A boom.', kind: 'oneshot' })).seconds, 3)
      assert.equal((await ok('make_sound', { description: 'A chord loop.', kind: 'loop' })).seconds, 10)
    })
  })

  test('[mcp:make_sound] says what is wrong and queues nothing: no description, a length or takes out of range, an unknown kind', async () => {
    await withSounds(async () => {
      const queued = fake.prompts.length
      await fails('make_sound', { description: '   ' }, /^Describe the sound first: what it is, what it is made of, where it happens\.$/)
      await fails('make_sound', { description: 'x', seconds: 0.5 }, /seconds/i)
      await fails('make_sound', { description: 'x', seconds: 121 }, /seconds/i)
      await fails('make_sound', { description: 'x', takes: 5 }, /takes/i)
      await fails('make_sound', { description: 'x', takes: 0 }, /takes/i)
      await fails('make_sound', { description: 'x', kind: 'voice' }, /kind/i)
      assert.equal(fake.prompts.length, queued)
    })
  })

  test('[mcp:make_sound] names the missing models, or the missing nodes, and queues nothing', async () => {
    const queued = fake.prompts.length
    await withSounds(() => fails('make_sound', { description: 'A door.' }, /^Stable Audio 3 needs Stable Audio 3 \(medium\) and Stable Audio 3 text encoder \(T5Gemma\)\. Download them on the Sounds page\.$/), soundInfo({ models: false }))
    await withSounds(() => fails('make_sound', { description: 'A door.' }, /^Stable Audio 3 needs Stable Audio 3 text encoder \(T5Gemma\)\. Download it on the Sounds page\.$/), { ...soundInfo(), CLIPLoader: node({ clip_name: [['other.safetensors']], type: [['stable_audio']] }) })
    // a bare ComfyUI: the nodes come first
    await fails('make_sound', { description: 'A door.' }, /^This ComfyUI has no EmptyLatentAudio, VAEDecodeAudio, SaveAudio, CLIPLoader \(stable_audio\)\. Update ComfyUI\.$/)
    assert.equal(fake.prompts.length, queued)
  })

  // ---------- get_sound ----------
  test('[mcp:get_sound] shows a waiting sound queued, then its takes copied into the sounds folder with their lengths once ComfyUI saves them', async () => {
    await withSounds(async () => {
      fake.holdNextPrompt(1)
      const s = await ok('make_sound', { description: 'A door slams.', name: 'Slam', takes: 2 })
      const waiting = await ok('get_sound', { soundId: s.id })
      assert.equal(waiting.status, 'queued')
      assert.equal(waiting.queuePosition, 1)
      assert.deepEqual(waiting.files, [])
      fake.releaseHeld()
      const a = flac(2)
      const b = flac(3)
      saved(a, b)
      const done = await ok('get_sound', { soundId: s.id })
      assert.equal(done.status, 'success')
      assert.deepEqual(done.files.map((f) => f.file), [dataFile('sounds', `slam_${s.id}_1.flac`), dataFile('sounds', `slam_${s.id}_2.flac`)])
      assert.deepEqual(done.files.map((f) => Math.round(f.duration)), [2, 3])
      assert.ok(done.finishedAt)
      assert.equal(fs.readFileSync(done.files[0].file).length, fs.readFileSync(a).length)
      assert.ok(fs.existsSync(a), 'ComfyUI\'s own copy stays')
      assert.deepEqual(readData('sounds', 'sounds.json').find((r) => r.id === s.id).files, done.files)
    })
  })

  test('[mcp:get_sound] reports ComfyUI\'s error, says when it saved no sound, and refuses an unknown sound', async () => {
    await withSounds(async () => {
      fake.failNextPrompt('Out of memory on the audio decoder')
      const bad = await ok('make_sound', { description: 'A door that fails.' })
      const failed = await ok('get_sound', { soundId: bad.id })
      assert.equal(failed.status, 'error')
      assert.match(failed.error, /Out of memory on the audio decoder/)
      // the fake's default answer is a sound-less success
      const empty = await ok('make_sound', { description: 'A door with no file.' })
      fake.state.history[fake.prompts.at(-1).id].outputs = {}
      const none = await ok('get_sound', { soundId: empty.id })
      assert.equal(none.status, 'error')
      assert.equal(none.error, 'ComfyUI finished but saved no sound.')
    })
    await fails('get_sound', { soundId: 'nope0000' }, /^No sound nope0000\.$/)
  })

  // ---------- list_sounds ----------
  test('[mcp:list_sounds] lists every sound newest first with its kind, description, status and takes', async () => {
    await withSounds(async () => {
      const first = await ok('make_sound', { description: 'Listed first, made first.', kind: 'oneshot', name: 'Older' })
      await new Promise((r) => setTimeout(r, 5))
      const second = await ok('make_sound', { description: 'Listed second, made second.', kind: 'loop', name: 'Newer' })
      saved(flac(1))
      const { items } = await ok('list_sounds')
      const ids = items.map((x) => x.id)
      assert.ok(ids.indexOf(second.id) < ids.indexOf(first.id), 'newest first')
      const newer = items.find((x) => x.id === second.id)
      assert.deepEqual([newer.name, newer.kind, newer.description, newer.status], ['Newer', 'loop', 'Listed second, made second.', 'success'])
      assert.equal(newer.files.length, 1)
      assert.equal(items.find((x) => x.id === first.id).kind, 'oneshot')
    })
  })

  // ---------- delete_sound ----------
  test('[mcp:delete_sound] removes a finished sound\'s files, its project and its record', async () => {
    await withSounds(async () => {
      const s = await ok('make_sound', { description: 'To be deleted.', name: 'Gone' })
      saved(flac(1))
      const done = await ok('get_sound', { soundId: s.id })
      assert.ok(fs.existsSync(done.files[0].file))
      assert.deepEqual(await ok('delete_sound', { soundId: s.id }), { deleted: s.id })
      assert.ok(!fs.existsSync(done.files[0].file))
      assert.ok(!fs.existsSync(dataFile('projects', `${s.projectId}.json`)))
      assert.ok(!readData('sounds', 'sounds.json').some((r) => r.id === s.id))
      await fails('get_sound', { soundId: s.id }, new RegExp(`^No sound ${s.id}\\.$`))
    })
  })

  test('[mcp:delete_sound] stops a sound still being made, and refuses an unknown one', async () => {
    await withSounds(async () => {
      fake.holdNextPrompt(1)
      const s = await ok('make_sound', { description: 'Still waiting.' })
      assert.equal(fake.state.pending.length, 1)
      await ok('delete_sound', { soundId: s.id })
      assert.equal(fake.state.pending.length, 0, 'the waiting prompt left ComfyUI\'s queue')
      assert.ok(!readData('sounds', 'sounds.json').some((r) => r.id === s.id))
    })
    await fails('delete_sound', { soundId: 'nope0000' }, /^No sound nope0000\.$/)
  })
})

describe('MCP recipe tools', () => {
  let mcp
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
  before(async () => {
    mcp = await startMcp({ comfyUrl: 'http://127.0.0.1:9' })
  })
  after(async () => {
    await mcp?.close()
  })

  test('[mcp:list_recipes] is empty on a fresh data folder', async () => {
    assert.deepEqual((await ok('list_recipes')).items, [])
  })

  test('[mcp:save_recipe] saves a recipe with its name, instruction and note, and writes recipes.json', async () => {
    const r = await ok('save_recipe', { name: '  Vertical   teaser ', instruction: 'Make a 15 second vertical teaser from my latest finished shot, fast cuts.', note: 'A teaser\nfor social' })
    assert.match(r.id, /^r[0-9a-z]+$/)
    assert.deepEqual([r.name, r.instruction, r.note], ['Vertical teaser', 'Make a 15 second vertical teaser from my latest finished shot, fast cuts.', 'A teaser for social'])
    assert.ok(r.createdAt && r.updatedAt)
    const onDisk = JSON.parse(fs.readFileSync(path.join(mcp.dataDir, 'recipes.json'), 'utf8'))
    assert.deepEqual(onDisk.recipes.map((x) => x.id), [r.id])
    assert.deepEqual((await ok('list_recipes')).items.map((x) => x.id), [r.id])
  })

  test('[mcp:save_recipe] replaces the recipe of the same name (in any case), keeping its id and first date', async () => {
    const [old] = (await ok('list_recipes')).items
    await new Promise((r) => setTimeout(r, 5))
    const again = await ok('save_recipe', { name: 'VERTICAL TEASER', instruction: 'Make a 20 second vertical teaser from the open edit.' })
    assert.deepEqual([again.id, again.createdAt, again.name, again.note], [old.id, old.createdAt, 'VERTICAL TEASER', ''])
    assert.notEqual(again.updatedAt, old.updatedAt)
    const { items } = await ok('list_recipes')
    assert.equal(items.length, 1)
    assert.equal(items[0].instruction, 'Make a 20 second vertical teaser from the open edit.')
  })

  test('[mcp:save_recipe] refuses a missing name, a request too short to stand alone, and a twenty-fifth recipe', async () => {
    await fails('save_recipe', { name: '', instruction: 'Make a short film from my idea.' }, /name/i)
    await fails('save_recipe', { name: '   ', instruction: 'Make a short film from my idea.' }, /^A recipe needs a short name for its button\.$/)
    await fails('save_recipe', { name: 'Tiny', instruction: 'too short' }, /instruction/i)
    await fails('save_recipe', { name: 'Tiny', instruction: '          ' }, /^A recipe needs the request itself, written so it works on its own another day\.$/)
    await fails('save_recipe', { name: 'x'.repeat(61), instruction: 'Make a short film from my idea.' }, /name/i)
    const have = (await ok('list_recipes')).items.length
    for (let i = have; i < 24; i++) await ok('save_recipe', { name: `Recipe ${i}`, instruction: `Make something nice, number ${i}.` })
    assert.equal((await ok('list_recipes')).items.length, 24)
    await fails('save_recipe', { name: 'One too many', instruction: 'Make something nice, one more.' }, /^There are already 24 recipes\. Ask the person which one to remove first\.$/)
    // replacing an existing one still works at the limit
    await ok('save_recipe', { name: 'Recipe 5', instruction: 'Make something nicer than before.' })
    assert.equal((await ok('list_recipes')).items.length, 24)
  })

  test('[mcp:list_recipes] lists each recipe with its name, instruction and note, in the order saved', async () => {
    const { items } = await ok('list_recipes')
    assert.equal(items[0].name, 'VERTICAL TEASER')
    assert.deepEqual(Object.keys(items[1]).sort(), ['createdAt', 'id', 'instruction', 'name', 'note', 'updatedAt'])
    assert.equal(items.at(-1).name, 'Recipe 23')
  })

  test('[mcp:delete_recipe] removes the recipe by id, and refuses an id that is not there', async () => {
    const { items } = await ok('list_recipes')
    const victim = items[3]
    assert.deepEqual(await ok('delete_recipe', { id: victim.id }), { removed: victim.id })
    const after = (await ok('list_recipes')).items
    assert.equal(after.length, items.length - 1)
    assert.ok(!after.some((r) => r.id === victim.id))
    assert.equal(JSON.parse(fs.readFileSync(path.join(mcp.dataDir, 'recipes.json'), 'utf8')).recipes.length, after.length)
    await fails('delete_recipe', { id: victim.id }, /^No such recipe\.$/)
    // and a place frees up for a new one
    await ok('save_recipe', { name: 'Fits again', instruction: 'Make something that fits again.' })
  })
})

// The test guard removes the agent context the app gives its own MCP child (env-policy.json: "a test that wants it sets
// it itself"), so this starts the server as startMcp does and sets IV_STUDIO_AGENT_RUN=chat and its ask folder in the
// child after the guard has run.
const fakes = new URL('../fakes/', import.meta.url)
const root = new URL('../../', import.meta.url)
async function startChatMcp(ask) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'iv-mcp-chat-')))
  const dataDir = path.join(base, 'data')
  const runDir = path.join(base, 'run')
  fs.mkdirSync(dataDir, { recursive: true })
  fs.mkdirSync(runDir, { recursive: true })
  seedSettings(dataDir, { comfyUrl: 'http://127.0.0.1:9' })
  const chat = `data:text/javascript,${encodeURIComponent(`process.env.IV_STUDIO_AGENT_RUN='chat';process.env.IV_STUDIO_AGENT_ASK=${JSON.stringify(ask)}`)}`
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', '--import', new URL('guard.mjs', fakes).href, '--import', new URL('resolve.mjs', fakes).href, '--import', new URL('dirname.mjs', fakes).href, '--import', chat, path.join(pathToFileURL(root.pathname).pathname, 'src/mcp/server.js')],
    env: { ...process.env, IV_STUDIO_DATA: dataDir, IV_TEST_RUN_DIR: runDir, IV_TEST_ALLOW_PORTS: [...guardState().ports].join(','), IV_TEST_SHIM_DIRS: [...guardState().shimDirs].join(path.delimiter) },
    stderr: 'pipe'
  })
  const client = new Client({ name: 'iv-test', version: '1' })
  await client.connect(transport)
  return { client, close: async () => (await client.close().catch(() => {}), fs.rmSync(base, { recursive: true, force: true })) }
}

describe('MCP places in the app', () => {
  let mcp, chatMcp, ask
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
  const shows = () => fs.readdirSync(ask).filter((f) => f.endsWith('.show.json'))
  const shown = (f) => JSON.parse(fs.readFileSync(path.join(ask, f), 'utf8'))
  const inChat = (name, args) => chatMcp.client.callTool({ name, arguments: args })
  before(async () => {
    // outside IV Studio's own chat: no ask folder, no window to move
    mcp = await startMcp({ comfyUrl: 'http://127.0.0.1:9' })
    ask = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'iv-ask-')), 'ask')
    chatMcp = await startChatMcp(ask)
  })
  after(async () => {
    await chatMcp?.close()
    await mcp?.close()
    fs.rmSync(path.dirname(ask), { recursive: true, force: true })
  })

  test('[mcp:list_places] lists each page\'s parts as where, page, spot and what is there', async () => {
    const { items } = await ok('list_places')
    assert.ok(items.length > 20, `${items.length} places`)
    assert.ok(items.every((p) => p.where && p.page && p.spot && p.about), 'every place says where, page, spot and about')
    assert.ok(items.some((p) => p.where === 'home' && p.page === 'The Dashboard' && p.spot === 'Start something'), 'the Dashboard has its Start something cards')
    assert.ok(!items.some((p) => p.where === 'full'), 'the full tour is not a place')
  })

  test('[mcp:show_in_app] outside IV Studio\'s own chat says to tell the person the page instead, and writes nothing', async () => {
    await fails('show_in_app', { where: 'home', spot: 'Start something' }, /^show_in_app works in IV Studio's own chat, where the app can move\. Tell the person the page and what to click instead\.$/)
    assert.ok(!fs.existsSync(ask) || shows().length === 0)
  })

  test('[mcp:show_in_app] in the chat writes a show file with the page, the part and the words, and answers what was shown', async () => {
    const r = await inChat('show_in_app', { where: 'home', spot: 'Start something', say: 'Click a card to begin.' })
    assert.ok(!r.isError, JSON.stringify(r.content))
    assert.deepEqual(r.structuredContent, { shown: true, page: 'The Dashboard', spot: 'Start something' })
    assert.equal(shows().length, 1)
    assert.deepEqual(shown(shows()[0]), { where: 'home', spot: 'Start something', say: 'Click a card to begin.' })
    assert.ok(!fs.readdirSync(ask).some((f) => f.endsWith('.tmp') || f.endsWith('.ask.json')), 'no half-written file, and no Allow card: it only moves the view')
    // no words: the file says null, and the app uses the part's own
    await inChat('show_in_app', { where: 'home', spot: 'Start something' })
    assert.equal(shows().length, 2)
    assert.ok(shows().map(shown).some((j) => j.say === null))
  })

  test('[mcp:show_in_app] in the chat refuses a part the page does not have, a page that is not offered and words over 300 characters, and writes nothing', async () => {
    const before = shows().length
    const a = await inChat('show_in_app', { where: 'home', spot: 'No such part' })
    assert.equal(a.isError, true)
    assert.match(a.content[0].text, /^There's no "No such part" on The Dashboard\. Pick a spot from list_places\.$/)
    const b = await inChat('show_in_app', { where: 'nowhere', spot: 'x' })
    assert.equal(b.isError, true)
    assert.match(b.content[0].text, /where/i)
    const c = await inChat('show_in_app', { where: 'home', spot: 'Start something', say: 'x'.repeat(301) })
    assert.equal(c.isError, true)
    assert.match(c.content[0].text, /say/i)
    assert.equal(shows().length, before)
  })
})
