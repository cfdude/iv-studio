// MCP tools for characters, projects, renders, cast, media preparation and the guide and menu (task 5.3), called
// through the real MCP server on source under the test guard, against the fake ComfyUI (design D1, D8). One fake and
// one server for the file.
//   node --test test/unit/mcp-library.test.mjs
// The tests in this file share fixtures (characters, projects, renders) and run in order; several fail when run alone
// by name, so run the whole file.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import ffmpegStatic from 'ffmpeg-ffprobe-static'
import { startFakeComfy } from '../fakes/comfyui.mjs'
import { startMcp } from '../fakes/mcp.mjs'

const TESS_LORA = 'MiniMax H3\\tess\\tess_mmh3-000040.safetensors'
const combo = (name, options) => ({ input: { required: { [name]: [options] } } })
const NOW = '2026-11-10T10:00:00.000Z'

describe('MCP character, project, render, cast, media and guide tools', () => {
  let fake, mcp, files
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
  const writeData = (p, value) => {
    fs.mkdirSync(path.dirname(dataFile(p)), { recursive: true })
    fs.writeFileSync(dataFile(p), JSON.stringify(value, null, 2))
  }
  const ff = (...args) => execFileSync(ffmpegStatic.ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args])
  const probe = (file) => JSON.parse(execFileSync(ffmpegStatic.ffprobePath, ['-v', 'error', '-show_entries', 'format=duration:stream=width,height', '-of', 'json', file]).toString())
  const lastPrompt = () => fake.prompts.at(-1).prompt

  before(async () => {
    fake = await startFakeComfy({ devices: 'mps' })
    mcp = await startMcp({ comfyUrl: fake.url })
    // small fixtures: a picture, a second picture, a video with sound, a sound
    const dir = path.join(path.dirname(mcp.dataDir), 'fixtures')
    fs.mkdirSync(dir, { recursive: true })
    files = { png: path.join(dir, 'face.png'), png2: path.join(dir, 'face2.png'), mp4: path.join(dir, 'clip.mp4'), wav: path.join(dir, 'voice.wav'), room: path.join(dir, 'room.png') }
    ff('-f', 'lavfi', '-i', 'color=c=red:s=128x96', '-frames:v', '1', files.png)
    ff('-f', 'lavfi', '-i', 'color=c=blue:s=128x96', '-frames:v', '1', files.png2)
    ff('-f', 'lavfi', '-i', 'color=c=green:s=96x64', '-frames:v', '1', files.room)
    ff('-f', 'lavfi', '-i', 'testsrc=s=128x96:r=24:d=2', '-f', 'lavfi', '-i', 'sine=f=440:d=2', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', files.mp4)
    ff('-f', 'lavfi', '-i', 'sine=f=440:d=3', files.wav)
  })
  after(async () => {
    await mcp?.close()
    await fake?.close()
  })

  // ---------- list_characters, save_character, delete_character ----------
  test('[mcp:list_characters][ipc:characters:list] lists the Tess preset before anyone has saved a character', async () => {
    const { items } = await ok('list_characters')
    assert.equal(items.length, 1)
    assert.equal(items[0].id, 'tess')
    assert.equal(items[0].name, 'Tess Marlow')
    assert.equal(items[0].lora, TESS_LORA)
    assert.equal(items[0].strength, 0.8)
    assert.equal(items[0].trigger, 't3ss4')
  })

  test('[mcp:save_character][ipc:characters:save] adds a LoRA character the ComfyUI can load, with the default strength', async () => {
    fake.setObjectInfo({ LoraLoaderModelOnly: combo('lora_name', [TESS_LORA, 'MiniMax H3\\ana\\ana.safetensors']) })
    try {
      const saved = await ok('save_character', { id: 'ana', name: 'Ana Ruiz', lora: 'MiniMax H3\\ana\\ana.safetensors', trigger: 'an4' })
      assert.deepEqual(saved, { strength: 0.8, id: 'ana', name: 'Ana Ruiz', lora: 'MiniMax H3\\ana\\ana.safetensors', trigger: 'an4' })
      assert.deepEqual(readData('characters.json').map((c) => c.id), ['tess', 'ana'])
      assert.deepEqual((await ok('list_characters')).items.map((c) => c.id), ['tess', 'ana'])
      // a LoRA name with forward slashes still matches the backslash name ComfyUI lists
      await ok('save_character', { id: 'ana2', name: 'Ana Two', lora: 'MiniMax H3/ana/ana.safetensors', trigger: 'an5' })
    } finally {
      fake.setObjectInfo({})
    }
  })

  test('[mcp:save_character] updates a character by id and keeps the fields it was not given', async () => {
    const saved = await ok('save_character', { id: 'ana', strength: 1.1, voiceId: null })
    assert.equal(saved.strength, 1.1)
    assert.equal(saved.name, 'Ana Ruiz')
    assert.equal(saved.trigger, 'an4')
    assert.equal(saved.voiceDeclined, true)
    assert.equal(saved.voiceId, null)
    assert.equal(readData('characters.json').find((c) => c.id === 'ana').strength, 1.1)
  })

  test('[mcp:save_character] saves a RefMod character with no LoRA and no trigger word', async () => {
    fake.setObjectInfo({ MiniMaxH3RefModsLoader: combo('mod_1', ['(none)', 'characters/maya_ab12cd']) })
    try {
      const saved = await ok('save_character', { id: 'maya', name: 'Maya', refmod: 'characters/maya_ab12cd' })
      assert.equal(saved.refmod, 'characters/maya_ab12cd')
      assert.equal(saved.lora, undefined)
      await fails('save_character', { id: 'maya', refmod: 'characters/nobody' }, /ComfyUI has no RefMod "characters\/nobody"\. list_choices shows them\./)
    } finally {
      fake.setObjectInfo({})
    }
  })

  test('[mcp:save_character] refuses a new character that lacks a name, a LoRA or a trigger word, and a LoRA ComfyUI cannot load', async () => {
    await fails('save_character', { id: 'zed', lora: 'x.safetensors', trigger: 'zz' }, /A new character needs name\./)
    await fails('save_character', { id: 'zed', name: 'Zed', trigger: 'zz' }, /A new character needs lora\./)
    await fails('save_character', { id: 'zed', name: 'Zed', lora: 'x.safetensors' }, /A new character needs trigger\./)
    await fails('save_character', { id: 'zed', name: 'Zed', lora: 'ghost.safetensors', trigger: 'zz' }, /ComfyUI has no LoRA "ghost\.safetensors"\. list_choices shows them\./)
    await fails('save_character', { id: 'Bad Id', name: 'Zed' }, /id/i)
    await fails('save_character', { id: 'ana', voiceId: 'nobody' }, /nobody|voice/i)
    assert.ok(!readData('characters.json').some((c) => c.id === 'zed'))
  })

  test('[mcp:delete_character] removes the preset and says so when there is no such character', async () => {
    // its own two characters, so it does not depend on the save tests having run
    fake.setObjectInfo({ LoraLoaderModelOnly: combo('lora_name', [TESS_LORA, 'MiniMax H3/keep/keep.safetensors', 'MiniMax H3/gone/gone.safetensors']) })
    try {
      await ok('save_character', { id: 'keep-me', name: 'Keep Me', lora: 'MiniMax H3/keep/keep.safetensors', trigger: 'kp1' })
      await ok('save_character', { id: 'drop-me', name: 'Drop Me', lora: 'MiniMax H3/gone/gone.safetensors', trigger: 'dp1' })
    } finally {
      fake.setObjectInfo({})
    }
    const left = await ok('delete_character', { id: 'drop-me' })
    assert.ok(!left.items.some((c) => c.id === 'drop-me'))
    assert.ok(left.items.some((c) => c.id === 'keep-me'))
    assert.ok(!readData('characters.json').some((c) => c.id === 'drop-me'))
    await fails('delete_character', { id: 'drop-me' }, /No character drop-me\./)
  })

  // ---------- list_ready_characters, install_ready_character ----------
  test('[mcp:list_ready_characters][ipc:characters:catalog] lists the ready-made characters with their picture and whether the LoRA is on this PC', async () => {
    const { items } = await ok('list_ready_characters')
    assert.deepEqual(items.map((c) => c.id), ['tess', 'theo'])
    for (const c of items) {
      assert.equal(c.available, true)
      assert.equal(c.loraPresent, false)
      assert.equal(c.installed, false)
      assert.equal(c.downloading, null)
      assert.ok(path.isAbsolute(c.picture) && fs.existsSync(c.picture), `no picture at ${c.picture}`)
      assert.match(c.lora.url, /^https:\/\//)
    }
  })

  test('[mcp:list_ready_characters] marks a character installed once ComfyUI lists its LoRA and it is a preset', async () => {
    fake.setObjectInfo({ LoraLoaderModelOnly: combo('lora_name', ['MiniMax H3\\tess\\tess_mmh3-000040.safetensors']) })
    try {
      const byId = Object.fromEntries((await ok('list_ready_characters')).items.map((c) => [c.id, c]))
      assert.equal(byId.tess.loraPresent, true)
      assert.equal(byId.tess.installed, true)
      assert.equal(byId.theo.loraPresent, false)
      // no preset, so the LoRA alone is not "installed"
      await ok('delete_character', { id: 'tess' })
      const again = Object.fromEntries((await ok('list_ready_characters')).items.map((c) => [c.id, c]))
      assert.equal(again.tess.loraPresent, true)
      assert.equal(again.tess.installed, false)
      writeData('characters.json', [{ id: 'tess', name: 'Tess Marlow', lora: TESS_LORA, strength: 0.8, trigger: 't3ss4' }, ...readData('characters.json')])
    } finally {
      fake.setObjectInfo({})
    }
  })

  // install_ready_character downloads about 150 MB from GitHub, so no row id (gaps: needs GitHub)
  test('guard refuses the GitHub download for install_ready_character and adds no preset', async () => {
    fake.setModels({ loras: [] })
    const before = readData('characters.json')
    try {
      // the guard refuses the fetch to github.com (a network refusal comes back as the call's error text)
      await fails('install_ready_character', { id: 'theo' }, /tests refused a fetch to github\.com:443/)
      // the failed download is forgotten, so a retry fails the same way rather than "already downloading"
      await fails('install_ready_character', { id: 'theo' }, /tests refused a fetch to github\.com:443/)
      await fails('install_ready_character', { id: 'nobody' }, /No ready-made character nobody\./)
    } finally {
      fake.setModels({})
    }
    assert.deepEqual(readData('characters.json'), before)
  })

  // ---------- make_refmod_character ----------
  const refmodInfo = (extra = []) => ({
    MiniMaxH3RefModMasterExtract: { input: { required: {} } },
    VAELoader: combo('vae_name', ['minimax_h3_video_vae_fp16.safetensors', ...extra])
  })

  test('[mcp:make_refmod_character][ipc:refmods:list][ipc:refmods:ready][ipc:refmods:make] queues the RefMod Master graph with the pictures uploaded and saves the character', async () => {
    fake.setObjectInfo(refmodInfo())
    const uploads = fake.uploads.length
    try {
      const r = await ok('make_refmod_character', { name: 'Maya Ortiz', pictures: [files.png, files.png2], who: 'a woman in her thirties', consent: true })
      assert.match(r.refmod, /^characters\/maya_ortiz_[0-9a-f]{6}$/)
      assert.equal(r.character.name, 'Maya Ortiz')
      assert.equal(r.character.refmod, r.refmod)
      assert.equal(r.character.who, 'a woman in her thirties')
      assert.equal(r.character.strength, 1)
      // pictures went to ComfyUI under iv_studio/refmods, one upload each
      const sent = fake.uploads.slice(uploads)
      assert.equal(sent.length, 2)
      assert.ok(sent.every((u) => u.subfolder === 'iv_studio/refmods'))
      // the graph: a LoadImage per picture, the video VAE, and the master node saving a bundle under characters/
      const g = lastPrompt()
      const master = Object.values(g).find((n) => n.class_type === 'MiniMaxH3RefModMasterExtract').inputs
      assert.equal(master.name, r.refmod.split('/')[1])
      assert.equal(master.subfolder, 'characters')
      assert.equal(master.save_layout, 'bundle')
      assert.equal(master.mode, 'Full Reference')
      assert.deepEqual([master['refs_image.ref_image_0'], master['refs_image.ref_image_1']], [['1', 0], ['2', 0]])
      assert.equal(Object.values(g).filter((n) => n.class_type === 'LoadImage').length, 2)
      assert.equal(g['10'].inputs.vae_name, 'minimax_h3_video_vae_fp16.safetensors')
      assert.equal(master.audio, undefined)
      assert.match(master.description, /a woman in her thirties/)
      // the face is the first picture, kept in the data folder; the character is a preset; the run is a project
      assert.ok(fs.existsSync(r.character.picture) && r.character.picture.startsWith(dataFile('faces')))
      assert.equal(fs.readFileSync(r.character.picture).length, fs.readFileSync(files.png).length)
      assert.ok((await ok('list_characters')).items.some((c) => c.id === r.character.id && c.refmod === r.refmod))
      const project = (await ok('list_projects')).items.find((p) => p.name === 'RefMod · Maya Ortiz')
      assert.equal(project.tool, 'refmod')
      assert.equal(project.jobs.length, 1)
    } finally {
      fake.setObjectInfo({})
    }
  })

  test('[mcp:make_refmod_character] adds the voice clip through the audio VAE when there is one', async () => {
    fake.setObjectInfo(refmodInfo(['minimax_h3_audio_vae.safetensors']))
    try {
      await ok('make_refmod_character', { name: 'Sam Voice', pictures: [files.png], audio: files.wav, consent: true })
      const g = lastPrompt()
      const master = Object.values(g).find((n) => n.class_type === 'MiniMaxH3RefModMasterExtract').inputs
      assert.deepEqual(master.audio, ['20', 0])
      assert.deepEqual(master.audio_vae, ['21', 0])
      assert.equal(g['20'].class_type, 'LoadAudio')
      assert.equal(g['21'].inputs.vae_name, 'minimax_h3_audio_vae.safetensors')
      assert.match(master.description, /voice timbre and accent/)
    } finally {
      fake.setObjectInfo({})
    }
  })

  test('[mcp:make_refmod_character] says what is missing: consent, pictures, the node pack, a VAE', async () => {
    const queued = fake.prompts.length
    await fails('make_refmod_character', { name: 'Kit', pictures: [files.png], consent: false }, /Tick that these are your own pictures/)
    await fails('make_refmod_character', { name: 'Kit', pictures: [path.join(path.dirname(files.png), 'gone.png')], consent: true }, /No file at .*gone\.png\./)
    await fails('make_refmod_character', { name: 'Kit', pictures: [], consent: true }, /pictures/i)
    await fails('make_refmod_character', { name: 'Kit', pictures: new Array(7).fill(files.png), consent: true }, /pictures/i)
    await fails('make_refmod_character', { name: 'Kit', pictures: [files.png], consent: true }, /no "Create H3 RefMod Master" node\. Install the ComfyUI-MiniMaxH3Mod pack/)
    fake.setObjectInfo({ MiniMaxH3RefModMasterExtract: { input: { required: {} } } })
    try {
      await fails('make_refmod_character', { name: 'Kit', pictures: [files.png], consent: true }, /no MiniMax H3 video VAE/)
    } finally {
      fake.setObjectInfo(refmodInfo())
    }
    try {
      await fails('make_refmod_character', { name: 'Kit', pictures: [files.png], audio: files.wav, consent: true }, /voice needs the H3 audio VAE/)
    } finally {
      fake.setObjectInfo({})
    }
    assert.equal(fake.prompts.length, queued, 'nothing was queued')
    assert.ok(!readData('characters.json').some((c) => c.name === 'Kit'))
  })

  test('[mcp:make_refmod_character] reports ComfyUI\'s error and adds no character when the run fails', async () => {
    fake.setObjectInfo(refmodInfo())
    const before = readData('characters.json').length
    fake.failNextPrompt('RefMod master blew up')
    try {
      await fails('make_refmod_character', { name: 'Kit', pictures: [files.png], consent: true }, /RefMod master blew up/)
    } finally {
      fake.setObjectInfo({})
    }
    assert.equal(readData('characters.json').length, before)
  })

  // ---------- list_projects, rename_project, delete_project ----------
  test('[mcp:list_projects] lists projects newest first', async () => {
    for (const [id, name, updatedAt] of [['old00001', 'Old shot', '2026-11-01T00:00:00.000Z'], ['new00001', 'New shot', '2026-11-09T00:00:00.000Z']])
      writeData(`projects/${id}.json`, { id, name, createdAt: updatedAt, updatedAt, jobs: [], sequenceId: null })
    const { items } = await ok('list_projects')
    const names = items.map((p) => p.name)
    assert.ok(names.indexOf('New shot') < names.indexOf('Old shot'))
    assert.deepEqual(items.find((p) => p.id === 'new00001'), { id: 'new00001', name: 'New shot', createdAt: '2026-11-09T00:00:00.000Z', updatedAt: '2026-11-09T00:00:00.000Z', jobs: [], sequenceId: null })
  })

  test('[mcp:rename_project][ipc:projects:rename] renames the project on disk and refuses an empty name or an unknown project', async () => {
    const p = await ok('rename_project', { projectId: 'old00001', name: 'Bus stop, take two' })
    assert.equal(p.name, 'Bus stop, take two')
    assert.equal(readData('projects/old00001.json').name, 'Bus stop, take two')
    assert.ok((await ok('list_projects')).items.some((x) => x.id === 'old00001' && x.name === 'Bus stop, take two'))
    await fails('rename_project', { projectId: 'old00001', name: '' }, /name/i)
    await fails('rename_project', { projectId: 'nope0000', name: 'x' }, /No project nope0000/)
    assert.equal(readData('projects/old00001.json').name, 'Bus stop, take two')
  })

  test('[mcp:delete_project][ipc:projects:delete] deletes the project and its job records and leaves the videos', async () => {
    const video = path.join(path.dirname(files.png), 'kept.mp4')
    fs.copyFileSync(files.mp4, video)
    writeData('jobs/job000000001.json', { id: 'job000000001', kind: 'previews', projectId: 'gone0001', status: 'success', createdAt: NOW, outputs: [{ kind: 'preview', candidate: 1, path: video }] })
    writeData('projects/gone0001.json', { id: 'gone0001', name: 'Doomed', createdAt: NOW, updatedAt: NOW, jobs: ['job000000001'], sequenceId: null })
    assert.equal((await call('delete_project', { projectId: 'gone0001' })).isError, undefined)
    assert.ok(!fs.existsSync(dataFile('projects/gone0001.json')))
    assert.ok(!fs.existsSync(dataFile('jobs/job000000001.json')))
    assert.ok(fs.existsSync(video), 'the rendered video stays')
    assert.ok(!(await ok('list_projects')).items.some((p) => p.id === 'gone0001'))
    await fails('delete_project', { projectId: 'gone0001' }, /No project gone0001/)
  })

  // ---------- list_renders ----------
  test('[mcp:list_renders][ipc:edits:library] lists a shot\'s previews and final newest first, each with a key and a path', async () => {
    const mk = (n) => path.join(path.dirname(files.png), `render${n}.mp4`)
    writeData('projects/shot0001.json', { id: 'shot0001', name: 'Rooftop', createdAt: NOW, updatedAt: NOW, jobs: ['jobprev0001', 'jobfin00001'], sequenceId: null })
    writeData('jobs/jobprev0001.json', { id: 'jobprev0001', kind: 'previews', projectId: 'shot0001', status: 'success', createdAt: '2026-11-10T10:00:00.000Z', finishedAt: '2026-11-10T10:05:00.000Z', plan: { request: { mode: 'text', character: 'tess', aspect: '16:9' } }, outputs: [{ kind: 'preview', candidate: 1, path: mk(1) }, { kind: 'preview', candidate: 2, path: mk(2) }] })
    writeData('jobs/jobfin00001.json', { id: 'jobfin00001', kind: 'finish', parent: 'jobprev0001', projectId: 'shot0001', status: 'success', createdAt: '2026-11-10T10:10:00.000Z', finishedAt: '2026-11-10T10:12:00.000Z', outputs: [{ kind: 'final', path: mk(3) }] })
    const { items } = await ok('list_renders')
    const mine = items.filter((r) => r.label.startsWith('Rooftop'))
    assert.deepEqual(mine.map((r) => r.key), ['jobfin00001:final:', 'jobprev0001:preview:1', 'jobprev0001:preview:2'])
    assert.deepEqual(mine.map((r) => r.label), ['Rooftop · final', 'Rooftop · preview 1', 'Rooftop · preview 2'])
    assert.deepEqual(mine.map((r) => r.path), [mk(3), mk(1), mk(2)])
    assert.ok(mine.every((r) => r.group === 'Shots' && r.url === null))
    assert.equal(mine[0].at, '2026-11-10T10:12:00.000Z')
    assert.ok(items.indexOf(mine[0]) < items.indexOf(mine[1]), 'newest first')
  })

  test('[mcp:list_renders] stops at the limit and refuses a limit outside 1 to 500', async () => {
    assert.equal((await ok('list_renders', { limit: 1 })).items.length, 1)
    await fails('list_renders', { limit: 0 }, /limit/i)
    await fails('list_renders', { limit: 501 }, /limit/i)
  })

  // ---------- list_cast, save_place ----------
  test('[mcp:list_cast][ipc:cast:list] lists the characters with a picture flag and the handle a prompt mentions them by', async () => {
    const { items } = await ok('list_cast')
    const tess = items.find((m) => m.mention === '@Tess')
    assert.deepEqual(tess, { mention: '@Tess', kind: 'character', name: 'Tess Marlow', hasPicture: true })
    const maya = items.find((m) => m.mention === '@Maya')
    assert.equal(maya.kind, 'character')
    assert.equal(maya.hasPicture, false)
    // the LoRA character Ana has no picture of her own
    assert.equal(items.find((m) => m.mention === '@Ana').hasPicture, false)
  })

  test('[mcp:save_place][ipc:cast:savePlace] saves a place with a copy of its picture, so it can be mentioned as @Name', async () => {
    const place = await ok('save_place', { name: 'Bus Stop', picture: files.room, description: 'A rainy bus stop at night.' })
    assert.equal(place.name, 'Bus Stop')
    assert.equal(place.description, 'A rainy bus stop at night.')
    assert.ok(place.picture.startsWith(dataFile('places')), place.picture)
    assert.ok(place.picture !== files.room && fs.existsSync(place.picture))
    assert.deepEqual(readData('places.json').map((p) => p.id), [place.id])
    const listed = (await ok('list_cast')).items.find((m) => m.mention === '@BusStop')
    assert.deepEqual(listed, { mention: '@BusStop', kind: 'place', name: 'Bus Stop', hasPicture: true, description: 'A rainy bus stop at night.' })
    // saving again with the same id changes it and keeps one entry
    const again = await ok('save_place', { id: place.id, name: 'Bus Shelter', picture: place.picture, description: 'Dry now.' })
    assert.equal(again.picture, place.picture)
    assert.equal(readData('places.json').length, 1)
    assert.ok((await ok('list_cast')).items.some((m) => m.mention === '@BusShelter'))
  })

  test('[mcp:save_place] refuses a place with no name, no picture on disk, or a name a character already has', async () => {
    await fails('save_place', { name: '   ', picture: files.room }, /Give the place a name\./)
    await fails('save_place', { name: 'Cellar', picture: path.join(path.dirname(files.room), 'gone.png') }, /That picture isn't there\./)
    await fails('save_place', { name: 'Tess', picture: files.room }, /@Tess is already a character\. Give this place another name\./)
    assert.ok(!readData('places.json').some((p) => p.name === 'Cellar' || p.name === 'Tess'))
  })

  test('[mcp:list_cast] includes the places of a film that have a picture, named for the film', async () => {
    writeData('productions/film0001.json', { id: 'film0001', name: 'Night Bus', locations: [{ id: 'loc1', name: 'Depot', description: 'A bus depot.', pictures: [files.room] }, { id: 'loc2', name: 'Nowhere', pictures: [] }] })
    const { items } = await ok('list_cast')
    assert.deepEqual(items.find((m) => m.mention === '@Depot'), { mention: '@Depot', kind: 'place', name: 'Depot', hasPicture: true, description: 'A bus depot.', film: 'Night Bus' })
    assert.ok(!items.some((m) => m.mention === '@Nowhere'))
  })

  // ---------- prepare_media ----------
  test('[mcp:prepare_media][ipc:media:probe][ipc:media:prepare] crops a picture into a new file in the media folder and leaves the original', async () => {
    const before = fs.readFileSync(files.png)
    const r = await ok('prepare_media', { file: files.png, crop: { x: 16, y: 16, w: 64, h: 32 } })
    assert.equal(r.kind, 'image')
    assert.ok(r.path.startsWith(dataFile('media')) && r.path.endsWith('.png'), r.path)
    assert.deepEqual([r.width, r.height], [64, 32])
    assert.deepEqual([probe(r.path).streams[0].width, probe(r.path).streams[0].height], [64, 32])
    assert.ok(before.equals(fs.readFileSync(files.png)), 'original untouched')
    // the same settings again reuse the file
    assert.equal((await ok('prepare_media', { file: files.png, crop: { x: 16, y: 16, w: 64, h: 32 } })).path, r.path)
  })

  test('[mcp:prepare_media] fits a picture to H3\'s 32-pixel grid at the megapixels asked for', async () => {
    const r = await ok('prepare_media', { file: files.png, fitH3: 0.5 })
    assert.equal(r.width % 32, 0)
    assert.equal(r.height % 32, 0)
    // about half a megapixel, in the picture's own 4:3 shape
    assert.ok(Math.abs(r.width * r.height - 0.5 * 1024 * 1024) < 40000, `${r.width}x${r.height}`)
    assert.ok(Math.abs(r.width / r.height - 4 / 3) < 0.05)
  })

  test('[mcp:prepare_media] trims a video and a sound to the seconds asked for', async () => {
    const v = await ok('prepare_media', { file: files.mp4, start: 0.5, end: 1.5 })
    assert.equal(v.kind, 'video')
    assert.ok(v.path.endsWith('.mp4') && v.path.startsWith(dataFile('media')))
    assert.ok(Math.abs(v.duration - 1) < 0.15, `video ${v.duration}`)
    assert.equal(v.hasAudio, true)
    const a = await ok('prepare_media', { file: files.wav, start: 1, end: 2.5 })
    assert.equal(a.kind, 'audio')
    assert.ok(a.path.endsWith('.wav'))
    assert.ok(Math.abs(a.duration - 1.5) < 0.1, `audio ${a.duration}`)
  })

  test('[mcp:prepare_media] says why a file cannot be prepared that way', async () => {
    await fails('prepare_media', { file: path.join(path.dirname(files.png), 'gone.png') }, /File not found: .*gone\.png/)
    await fails('prepare_media', { file: files.wav, crop: { x: 0, y: 0, w: 32, h: 32 } }, /Sounds have no picture to crop\./)
    await fails('prepare_media', { file: files.png, start: 0, end: 1 }, /Pictures have no length to trim\./)
    await fails('prepare_media', { file: files.wav, fitH3: 1 }, /Sounds have no picture to resize\./)
    await fails('prepare_media', { file: files.mp4, start: 1, end: 1 }, /longer than a frame/)
    await fails('prepare_media', { file: files.png, crop: { x: 0, y: 0, w: 8, h: 8 } }, /Number must be greater than or equal to 16 at crop\.w/)
    await fails('prepare_media', { file: files.png, fitH3: 9 }, /fitH3|4/)
  })

  // ---------- get_guide, get_menu ----------
  test('[mcp:get_guide] returns the how-to guide by default', async () => {
    const r = await call('get_guide')
    assert.ok(!r.isError)
    const text = r.content[0].text
    assert.equal(text, fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../resources/agent-guide.md'), 'utf8'))
    assert.match(text, /^# Using IV Studio from an agent/)
    assert.match(text, /get_menu/)
    assert.equal(r.content.length, 1)
  })

  test('[mcp:get_guide] returns the directing method for topic directing, with where it comes from', async () => {
    const r = await call('get_guide', { topic: 'directing' })
    assert.ok(!r.isError)
    assert.match(r.content[0].text, /In IV Studio, the shot brief is a prompt plus its references; review_take does the review step on a rendered take\./)
    assert.ok(r.content[0].text.length > 2000)
    assert.notEqual(r.content[0].text, (await call('get_guide')).content[0].text)
  })

  test('[mcp:get_guide] says the H3 prompt guide could not be downloaded when the network is refused, and rejects an unknown topic', async () => {
    await fails('get_guide', { topic: 'h3-prompts' }, /MiniMax's H3 prompt guide couldn't be downloaded from GitHub\. Check the internet connection and try again\./)
    await fails('get_guide', { topic: 'nonsense' }, /topic|enum|Invalid/i)
  })

  test('[mcp:get_menu] offers the start menu as one question with a choice and a brief for each entry', async () => {
    const r = await call('get_menu')
    assert.ok(!r.isError)
    const menu = JSON.parse(r.content[0].text)
    assert.equal(menu.ask, 'What would you like to make?')
    assert.deepEqual(menu.choices.slice(0, 3).map((c) => c.id), ['make_a_shot', 'make_a_picture', 'make_a_film'])
    for (const c of menu.choices) {
      assert.ok(c.title && c.blurb && c.then, `incomplete choice ${c.id}`)
    }
    assert.match(menu.choices[0].then, /list_characters/)
    // each entry is also a prompt (a slash command), plus "start"
    const { prompts } = await mcp.client.listPrompts()
    const names = prompts.map((p) => p.name)
    assert.ok(names.includes('start'))
    for (const c of menu.choices) assert.ok(names.includes(c.id), `no prompt ${c.id}`)
  })
})
