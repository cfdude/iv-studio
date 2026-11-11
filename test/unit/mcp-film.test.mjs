// MCP film tools (task 5.6, part 4): the short-film project from brief and script to shots, their prompts, lines and
// faces, called through the real MCP server on source under the test guard (design D1, D8). The local writer is the
// fake Ollama, answering the script and the shot list in the shape the app asks for; each shot's H3 prompt comes from
// the claude shim (Settings: Prompt writer = Claude Code). Nothing here draws a picture or renders: that is
// mcp-film-render.test.mjs.
//   node --test test/unit/mcp-film.test.mjs
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import ffmpegStatic from 'ffmpeg-ffprobe-static'
import { startFakeComfy } from '../fakes/comfyui.mjs'
import { startMcp } from '../fakes/mcp.mjs'
import { startFakeOllama } from '../fakes/outside.mjs'
import { guardState } from '../fakes/ports.mjs'

const SCRIPT = 'Title: Rain Check\n\nINT. BUS STOP - NIGHT\n\nRain hammers the shelter. A woman waits.\n\nTESS\nWhere is that bus?\n\nEXT. STREET - DAY\n\nA bus rolls by.\n'
const WRITTEN_SCRIPT = {
  title: 'Wet Evening',
  scenes: [{ place: 'Bus stop', time: 'NIGHT', inside: false, looks: 'A glass shelter under an orange streetlight.', beats: [
    { kind: 'action', action: 'A woman waits in the rain.', speaker: '', delivery: '', words: '' },
    { kind: 'line', action: '', speaker: 'Tess', delivery: 'to herself', words: 'Come on.' }
  ] }]
}
const WRITTEN_SHOTS = { shots: [
  { action: 'Tess stands at the bus stop in the rain.', staging: 'Tess screen-left, facing right.', camera: 'Wide, slow push in', characters: ['Tess'], speaker: 'Tess', line: 'Where is that bus?', seconds: 4, ends: 'She looks up the road.' },
  { action: 'A bus rolls slowly past the shelter.', staging: 'The bus crosses from right to left.', camera: 'Medium, static', characters: [], speaker: '', line: '', seconds: 3, ends: 'The bus is gone.' }
] }
const WRITER = { direction: { purpose: 'A woman waits.', staging: 'She stands screen-left.' }, style: 'Live-action, soft light.', shots: [{ start_seconds: 0, description: 'A woman in a red coat waits at a rainy bus stop, the camera holds a static shot.' }], soundscape: 'Rain.', music: 'N/A' }
const hash = (...parts) => createHash('sha1').update(parts.join('\u0000')).digest('hex').slice(0, 12)

describe('MCP film tools', () => {
  let fake, ollama, mcp, shimDir, wav, long, face
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
  const shim = (body) => {
    const file = path.join(shimDir, 'claude')
    fs.rmSync(`${file}.args`, { force: true })
    fs.writeFileSync(file, `#!/bin/sh\necho "$@" > "$0.args"\ncat > "$0.stdin"\n${body}`, { mode: 0o755 })
  }
  const claudeAnswers = (obj) => shim(`cat <<'JSON'\n${JSON.stringify({ is_error: false, result: '', structured_output: obj })}\nJSON\n`)
  const sawInput = () => fs.readFileSync(path.join(shimDir, 'claude.stdin'), 'utf8')
  // a film with one scene and two shots, written by hand (no writer involved)
  const film = async (extra = {}) => {
    const f = await ok('create_film', { name: 'Hand film', script: 'INT. BUS STOP - NIGHT\n\nA woman waits.\n', ...extra })
    const sceneId = f.scenes[0].id
    const a = await ok('edit_film_shot', { filmId: f.id, sceneId, add: true, action: 'Tess waits.', speaker: 'Tess', characters: ['Tess'], line: 'Where is that bus?', seconds: 4, character: 'tess' })
    const b = await ok('edit_film_shot', { filmId: f.id, sceneId, shotId: a.scenes[0].shots[0].id, add: true, action: 'A bus passes.', seconds: 3 })
    const shots = b.scenes[0].shots
    return { id: f.id, sceneId, a: shots[0].id, b: shots[1].id }
  }
  const view = (filmId) => ok('get_film', { filmId })
  const shotOf = async (filmId, shotId) => (await view(filmId)).scenes.flatMap((s) => s.shots).find((s) => s.id === shotId)
  const settled = async (filmId) => {
    for (let i = 0; i < 200; i++) {
      const v = await view(filmId)
      if (v.breakdown?.state !== 'running') return v
      await new Promise((r) => setTimeout(r, 25))
    }
    throw new Error('the breakdown never finished')
  }

  before(async () => {
    fake = await startFakeComfy({ devices: 'mps', os: 'darwin' })
    ollama = await startFakeOllama({ answer: (body) => (body.format?.properties?.scenes ? WRITTEN_SCRIPT : WRITTEN_SHOTS) })
    mcp = await startMcp({ comfyUrl: fake.url, shims: true, settings: { ollamaUrl: ollama.url, ollamaModel: 'fake-vl:8b', promptEngine: 'claude' } })
    shimDir = [...guardState().shimDirs].at(-1)
    const dir = path.join(path.dirname(mcp.dataDir), 'fixtures')
    fs.mkdirSync(dir, { recursive: true })
    wav = path.join(dir, 'line.wav')
    long = path.join(dir, 'long.wav')
    face = path.join(dir, 'face.png')
    ff('-f', 'lavfi', '-i', 'sine=f=440:d=2', wav)
    ff('-f', 'lavfi', '-i', 'sine=f=330:d=16', long)
    ff('-f', 'lavfi', '-i', 'color=c=orange:s=64x64', '-frames:v', '1', face)
    claudeAnswers(WRITER)
  })
  after(async () => {
    await mcp?.close()
    await ollama?.close()
    await fake?.close()
  })

  // ---------- list_films, create_film, get_film ----------
  test('[mcp:list_films] is empty on a fresh data folder', async () => {
    assert.deepEqual((await ok('list_films')).items, [])
  })

  test('[mcp:create_film] starts a film with the defaults and an empty script', async () => {
    const f = await ok('create_film')
    assert.match(f.id, /^[0-9a-f]{8}$/)
    assert.deepEqual({ name: f.name, logline: f.logline, aspect: f.aspect, targetSeconds: f.targetSeconds, step: f.step, kind: f.kind }, { name: 'Untitled film', logline: '', aspect: '16:9', targetSeconds: 120, step: 'idea', kind: 'short' })
    assert.deepEqual([f.scenes, f.cast, f.locations, f.props], [[], [], [], []])
    assert.deepEqual(f.look, { notes: '', loras: [] })
    assert.ok(fs.existsSync(dataFile('productions', `${f.id}.json`)))
  })

  test('[mcp:create_film] reads a script into scenes, takes the title, and puts a speaker who matches a preset into the cast and each heading into the places', async () => {
    const f = await ok('create_film', { script: SCRIPT, aspect: '9:16', targetSeconds: 60, logline: 'A wait.' })
    assert.equal(f.name, 'Rain Check', 'the title page names an unnamed film')
    assert.deepEqual(f.scenes.map((s) => [s.heading, s.location, s.time, s.shots.length]), [['INT. BUS STOP - NIGHT', 'Bus Stop', 'Night', 0], ['EXT. STREET - DAY', 'Street', 'Day', 0]])
    assert.deepEqual(f.scenes[0].elements.map((e) => [e.type, e.who, e.text]), [['action', undefined, 'Rain hammers the shelter. A woman waits.'], ['dialogue', 'Tess', 'Where is that bus?']])
    assert.deepEqual(f.cast, [{ characterId: 'tess', as: 'Tess' }])
    assert.deepEqual(f.locations.map((l) => l.name), ['Bus Stop', 'Street'])
    assert.deepEqual([f.aspect, f.targetSeconds, f.logline], ['9:16', 60, 'A wait.'])
  })

  test('[mcp:create_film] refuses an aspect that is not offered and a length outside 10 to 3600 seconds', async () => {
    await fails('create_film', { aspect: '2:1' }, /aspect/i)
    await fails('create_film', { targetSeconds: 5 }, /targetSeconds/i)
    await fails('create_film', { targetSeconds: 4000 }, /targetSeconds/i)
  })

  test('[mcp:list_films] lists each film with its scene and shot counts, newest first', async () => {
    const h = await film()
    const { items } = await ok('list_films')
    assert.equal(items[0].id, h.id)
    assert.deepEqual({ name: items[0].name, aspect: items[0].aspect, scenes: items[0].scenes, shots: items[0].shots, step: items[0].step }, { name: 'Hand film', aspect: '16:9', scenes: 1, shots: 2, step: 'idea' })
    assert.ok(items.length >= 3)
    const times = items.map((i) => i.updatedAt).filter(Boolean)
    assert.deepEqual(times, [...times].sort().reverse())
  })

  test('[mcp:get_film] shows the brief, the scenes with each shot and where it is, and totals; and names a film that is not there', async () => {
    const h = await film()
    const v = await view(h.id)
    assert.equal(v.id, h.id)
    assert.deepEqual(v.scenes[0].shots.map((s) => [s.action, s.seconds, s.state.status]), [['Tess waits.', 4, 'draft'], ['A bus passes.', 3, 'draft']])
    assert.deepEqual(v.totals, { shots: 2, seconds: 7, finished: 0, pick: 0, rendering: 0, speaking: 0, ready: 0, draft: 2, sketched: 0, sketching: 0 })
    assert.equal(v.writing, false)
    assert.equal(v.filming, null)
    await fails('get_film', { filmId: 'nope0000' }, /No project nope0000/)
  })

  // ---------- update_film ----------
  test('[mcp:update_film] changes the brief, the look, the cast, the places and the props, and a list replaces the old one whole', async () => {
    const f = await ok('create_film', { name: 'Before', script: SCRIPT })
    const u = await ok('update_film', {
      filmId: f.id, name: 'After', logline: 'Waiting.', aspect: '1:1', targetSeconds: 90, step: 'cast', look: { notes: 'Grainy 16 mm.', loras: [{ name: 'film.safetensors', strength: 0.7 }] },
      cast: [{ characterId: 'tess', as: 'Tess' }, { characterId: null, as: 'Driver', description: 'A tired man in a cap.' }],
      locations: [{ name: 'Bus Stop', description: 'A glass shelter.', pictures: [face] }],
      props: [{ name: 'Umbrella', description: 'Red.' }]
    })
    assert.deepEqual({ name: u.name, logline: u.logline, aspect: u.aspect, targetSeconds: u.targetSeconds, step: u.step }, { name: 'After', logline: 'Waiting.', aspect: '1:1', targetSeconds: 90, step: 'cast' })
    assert.deepEqual(u.look, { notes: 'Grainy 16 mm.', loras: [{ name: 'film.safetensors', strength: 0.7 }] })
    assert.deepEqual(u.cast, [{ characterId: 'tess', as: 'Tess' }, { as: 'Driver', characterId: null, description: 'A tired man in a cap.', face: null }])
    assert.deepEqual(u.locations.map((l) => [l.name, l.description, l.pictures, l.angles]), [['Bus Stop', 'A glass shelter.', [face], []]], 'the list replaced both places')
    assert.match(u.locations[0].id, /^[0-9a-f]{6}$/)
    assert.deepEqual(u.props.map((p) => [p.name, p.description]), [['Umbrella', 'Red.']])
    const again = await ok('update_film', { filmId: f.id, name: 'Again' })
    assert.deepEqual([again.cast.length, again.locations.length, again.look.notes], [2, 1, 'Grainy 16 mm.'], 'what was not given stays')
    assert.equal(readData('productions', `${f.id}.json`).name, 'Again')
  })

  test('[mcp:update_film] refuses an aspect or a wizard step that does not exist, and a film that is not there', async () => {
    const f = await ok('create_film')
    await fails('update_film', { filmId: f.id, aspect: '2:1' }, /aspect/i)
    await fails('update_film', { filmId: f.id, step: 'party' }, /step/i)
    await fails('update_film', { filmId: 'nope0000', name: 'x' }, /No project nope0000/)
    assert.equal((await view(f.id)).aspect, '16:9')
  })

  // ---------- set_film_script ----------
  test('[mcp:set_film_script] replaces the script, keeps the shots of a scene that did not change and marks one that did as stale', async () => {
    const f = await ok('create_film', { script: SCRIPT })
    const [s1, s2] = f.scenes
    await ok('edit_film_shot', { filmId: f.id, sceneId: s1.id, add: true, action: 'Tess waits.', seconds: 4 })
    await ok('edit_film_shot', { filmId: f.id, sceneId: s2.id, add: true, action: 'A bus passes.', seconds: 3 })
    const edited = SCRIPT.replace('A bus rolls by.', 'A bus rolls by, spraying water.')
    const r = await ok('set_film_script', { filmId: f.id, script: edited })
    assert.deepEqual(r.scenes.map((s) => [s.id, s.shots.length, s.stale]), [[s1.id, 1, false], [s2.id, 0, true]], 'the changed scene lost its shots and is marked')
    assert.equal(r.script.text, edited)
    const more = await ok('set_film_script', { filmId: f.id, script: `${edited}\nEXT. ROOFTOP - NIGHT\n\nThe moon.\n` })
    assert.deepEqual(more.locations.map((l) => l.name), ['Bus Stop', 'Street', 'Rooftop'], 'a new heading adds a place')
    await fails('set_film_script', { filmId: f.id, script: '' }, /script/i)
    await fails('set_film_script', { filmId: 'nope0000', script: 'x' }, /No project nope0000/)
  })

  // ---------- write_film_script ----------
  test('[mcp:write_film_script] has the local writer draft the script from the idea, the cast and the length, and fills a place\'s look', async () => {
    const f = await ok('create_film', { name: 'Waiting', targetSeconds: 40 })
    await ok('update_film', { filmId: f.id, cast: [{ characterId: 'tess', as: 'Tess' }], look: { notes: 'Soft night light.', loras: [] } })
    const before = ollama.requests.length
    const r = await ok('write_film_script', { filmId: f.id, idea: 'A woman waits for a bus that never comes.' })
    const asked = ollama.requests.slice(before).filter((x) => x.path === '/api/chat').at(-1).json
    assert.equal(asked.model, 'fake-vl:8b')
    assert.match(asked.messages[1].content, /^Idea: A woman waits for a bus that never comes\.\nTitle: Waiting\nCast: Tess Marlow\nBeats: exactly 10 in all, for about 40 seconds of film\.\nLook: Soft night light\.$/)
    assert.deepEqual(asked.format.properties.scenes.items.properties.beats.maxItems, 10)
    assert.equal(r.name, 'Waiting', 'a name the person gave is kept')
    assert.match(r.script.text, /^EXT\. BUS STOP - NIGHT\n\nA woman waits in the rain\.\n\nTESS\n\(to herself\)\nCome on\.\n$/)
    assert.deepEqual(r.scenes.map((s) => [s.heading, s.elements.map((e) => e.type)]), [['EXT. BUS STOP - NIGHT', ['action', 'dialogue']]])
    assert.deepEqual(r.locations.map((l) => [l.name, l.description]), [['Bus Stop', 'A glass shelter under an orange streetlight.']])
    assert.deepEqual(r.cast, [{ characterId: 'tess', as: 'Tess' }], 'Tess was already there')
    // an unnamed film takes the writer's title, and with no idea the film's logline is the idea
    const g = await ok('create_film', { logline: 'A bus that never comes.' })
    assert.equal((await ok('write_film_script', { filmId: g.id })).name, 'Wet Evening')
    assert.match(ollama.requests.at(-1).json.messages[1].content, /^Idea: A bus that never comes\./)
  })

  test('[mcp:write_film_script] asks for an idea first, and says so when the writer is not answering', async () => {
    const f = await ok('create_film')
    await fails('write_film_script', { filmId: f.id }, /Say what the film is about first\./)
    const gone = await startFakeOllama()
    const off = await startMcp({ comfyUrl: fake.url, settings: { ollamaUrl: gone.url, ollamaModel: 'not-installed:1b' } })
    try {
      const g = (await off.client.callTool({ name: 'create_film', arguments: { logline: 'A wait.' } })).structuredContent
      const r = await off.client.callTool({ name: 'write_film_script', arguments: { filmId: g.id } })
      assert.equal(r.isError, true)
      assert.match(r.content[0].text, /The writer model not-installed:1b isn't in Ollama yet\./)
    } finally {
      await off.close()
      await gone.close()
    }
  })

  // ---------- break_down_film ----------
  test('[mcp:break_down_film] breaks each scene into shots with the writer in the background and writes each shot\'s prompt', async () => {
    const f = await ok('create_film', { script: 'INT. BUS STOP - NIGHT\n\nTess waits.\n\nTESS\nWhere is that bus?\n' })
    claudeAnswers(WRITER)
    const started = await ok('break_down_film', { filmId: f.id, sketch: false })
    assert.equal(started.breakdown.state, 'running')
    assert.deepEqual([started.breakdown.scenes, started.breakdown.scenesDone], [1, 0])
    const v = await settled(f.id)
    assert.deepEqual({ state: v.breakdown.state, error: v.breakdown.error, scenesDone: v.breakdown.scenesDone, shots: v.breakdown.shots, shotsDone: v.breakdown.shotsDone, sketchError: v.breakdown.sketchError }, { state: 'done', error: null, scenesDone: 1, shots: 2, shotsDone: 2, sketchError: null })
    const [one, two] = v.scenes[0].shots
    assert.deepEqual([one.action, one.camera, one.speaker, one.line, one.seconds, one.character, one.ends], ['Tess stands at the bus stop in the rain.', 'Wide, slow push in', 'Tess', 'Where is that bus?', 4, 'tess', 'She looks up the road.'])
    assert.deepEqual([two.speaker, two.line, two.character, two.seconds], ['', '', 'none', 3])
    assert.match(one.prompt, /A woman in a red coat waits at a rainy bus stop/)
    assert.match(one.prompt, /Where is that bus\?/, 'the shot\'s line goes into the prompt')
    assert.match(two.prompt, /overall_soundscape/)
    assert.equal(v.scenes[0].stale, false)
    // the writer was told the scene and the film, and the shot list came back through the schema it was held to
    const asked = ollama.requests.filter((x) => x.path === '/api/chat' && x.json.format?.properties?.shots).at(-1).json
    assert.match(asked.messages[1].content, /^Film: Untitled film/)
    assert.deepEqual(asked.format.required, ['shots'])
    assert.match(sawInput(), /It opens as the previous shot ended: She looks up the road\. A bus rolls slowly past the shelter\./, 'the last shot was written knowing how the one before ended')
  })

  test('[mcp:break_down_film] leaves scenes that have shots alone unless redo is passed, and refuses with no script or nothing to do', async () => {
    const none = await ok('create_film')
    await fails('break_down_film', { filmId: none.id }, /Add the script first\./)
    // shots made by hand, so only the breakdowns below run the writer
    const f = await ok('create_film', { script: SCRIPT })
    const [s1, s2] = f.scenes
    const hand = await ok('edit_film_shot', { filmId: f.id, sceneId: s1.id, add: true, action: 'Tess waits.', seconds: 4 })
    const handId = hand.scenes[0].shots[0].id
    await ok('edit_film_shot', { filmId: f.id, sceneId: s2.id, add: true, action: 'A bus passes.', seconds: 3 })
    await fails('break_down_film', { filmId: f.id, sketch: false }, /Every scene already has shots\. Pass redo to break them down again\./)
    await ok('break_down_film', { filmId: f.id, sceneIds: [s2.id], sketch: false })
    const some = await settled(f.id)
    assert.equal(some.breakdown.scenes, 1, 'only the scene asked for')
    assert.deepEqual(some.scenes[0].shots.map((s) => s.id), [handId], 'the other scene kept its shot')
    assert.equal(some.scenes[1].shots.length, 2, 'the scene asked for got the writer\'s shots')
    const one = await ok('create_film', { script: 'INT. BUS STOP - NIGHT\n\nA woman waits.\n' })
    const made = await ok('edit_film_shot', { filmId: one.id, sceneId: one.scenes[0].id, add: true, action: 'By hand.' })
    await fails('break_down_film', { filmId: one.id, sketch: false }, /Every scene already has shots/)
    await ok('break_down_film', { filmId: one.id, redo: true, sketch: false })
    const redone = await settled(one.id)
    assert.equal(redone.breakdown.scenes, 1)
    assert.ok(redone.scenes[0].shots.length === 2 && !redone.scenes[0].shots.some((s) => s.id === made.scenes[0].shots[0].id), 'redo made new shots')
  })

  test('[mcp:break_down_film] records the writer\'s failure on the film instead of throwing', async () => {
    const down = await startFakeOllama({ models: [] })
    const off = await startMcp({ comfyUrl: fake.url, settings: { ollamaUrl: down.url } })
    try {
      const f = (await off.client.callTool({ name: 'create_film', arguments: { script: SCRIPT } })).structuredContent
      await off.client.callTool({ name: 'break_down_film', arguments: { filmId: f.id, sketch: false } })
      let v
      for (let i = 0; i < 100 && v?.breakdown?.state !== 'error'; i++) {
        v = (await off.client.callTool({ name: 'get_film', arguments: { filmId: f.id } })).structuredContent
        await new Promise((r) => setTimeout(r, 20))
      }
      assert.equal(v.breakdown.state, 'error')
      assert.match(v.breakdown.error, /isn't in Ollama yet/)
    } finally {
      await off.close()
      await down.close()
    }
  })

  // ---------- edit_film_shot ----------
  test('[mcp:edit_film_shot] adds a shot after another, changes a field, moves it within its scene and removes it', async () => {
    const f = await ok('create_film', { script: 'INT. BUS STOP - NIGHT\n\nA woman waits.\n' })
    const sceneId = f.scenes[0].id
    const added = await ok('edit_film_shot', { filmId: f.id, sceneId, add: true, action: 'One.', seconds: 4, camera: 'Wide' })
    const one = added.scenes[0].shots[0]
    assert.deepEqual([one.action, one.camera, one.seconds, one.prompt, one.character], ['One.', 'Wide', 4, '', 'none'])
    const withTwo = await ok('edit_film_shot', { filmId: f.id, sceneId, shotId: one.id, add: true, action: 'Two.' })
    const withThree = await ok('edit_film_shot', { filmId: f.id, sceneId, add: true, action: 'Three.' })
    assert.deepEqual(withThree.scenes[0].shots.map((s) => s.action), ['One.', 'Two.', 'Three.'], 'with no shotId it goes at the end of the scene')
    const two = withTwo.scenes[0].shots[1]
    const changed = await ok('edit_film_shot', { filmId: f.id, sceneId, shotId: two.id, action: 'Two, changed.', seconds: 15, line: 'Hello.', speaker: 'Tess' })
    const t = changed.scenes[0].shots[1]
    assert.deepEqual([t.action, t.seconds, t.line, t.speaker], ['Two, changed.', 15, 'Hello.', 'Tess'])
    const moved = await ok('edit_film_shot', { filmId: f.id, sceneId, shotId: two.id, move: 1 })
    assert.deepEqual(moved.scenes[0].shots.map((s) => s.action), ['One.', 'Three.', 'Two, changed.'])
    const up = await ok('edit_film_shot', { filmId: f.id, sceneId, shotId: two.id, move: -1 })
    assert.deepEqual(up.scenes[0].shots.map((s) => s.action), ['One.', 'Two, changed.', 'Three.'])
    const removed = await ok('edit_film_shot', { filmId: f.id, sceneId, shotId: two.id, remove: true })
    assert.deepEqual(removed.scenes[0].shots.map((s) => s.action), ['One.', 'Three.'])
  })

  test('[mcp:edit_film_shot] marks a shot\'s sketch stale when what it shows changes, and clears its voice line when the words do', async () => {
    const h = await film()
    const file = dataFile('productions', `${h.id}.json`)
    const p = readData('productions', `${h.id}.json`)
    Object.assign(p.scenes[0].shots[0], { sketch: face, voiceLine: { file: wav, text: 'x', duration: 2 } })
    fs.writeFileSync(file, JSON.stringify(p))
    const same = await ok('edit_film_shot', { filmId: h.id, sceneId: h.sceneId, shotId: h.a, seconds: 5 })
    assert.equal(same.scenes[0].shots[0].sketchStale, undefined, 'a length change does not touch the sketch')
    const looks = await ok('edit_film_shot', { filmId: h.id, sceneId: h.sceneId, shotId: h.a, camera: 'Close-up' })
    assert.equal(looks.scenes[0].shots[0].sketchStale, true)
    assert.ok(looks.scenes[0].shots[0].voiceLine, 'the voice line stays while the words are the same')
    const said = await ok('edit_film_shot', { filmId: h.id, sceneId: h.sceneId, shotId: h.a, line: 'A new line.' })
    assert.equal(said.scenes[0].shots[0].voiceLine, null)
  })

  test('[mcp:edit_film_shot] turns a staging board into the shot\'s words and warns when two people swap sides from the shot before', async () => {
    const h = await film()
    const stage = (x) => ({ people: [{ name: 'Tess', x, y: 0, facing: 90 }, { name: 'Ana', x: -x, y: 0, facing: 270 }], camera: { x: 0, y: -3, facing: 0 } })
    const first = await ok('edit_film_shot', { filmId: h.id, sceneId: h.sceneId, shotId: h.a, stage: stage(1) })
    assert.deepEqual(first.lineWarnings, [])
    assert.match((await shotOf(h.id, h.a)).staging, /Tess/)
    assert.match((await shotOf(h.id, h.a)).camera, /./)
    const second = await ok('edit_film_shot', { filmId: h.id, sceneId: h.sceneId, shotId: h.b, stage: stage(-1) })
    assert.equal(second.lineWarnings.length, 1)
    assert.match(second.lineWarnings[0], /Tess|Ana/)
  })

  test('[mcp:edit_film_shot] says so for a scene or a shot that is not there', async () => {
    const h = await film()
    await fails('edit_film_shot', { filmId: h.id, sceneId: 'nosc00', shotId: h.a, action: 'x' }, /No such scene\./)
    await fails('edit_film_shot', { filmId: h.id, sceneId: h.sceneId, shotId: 'noshot', action: 'x' }, /No such shot\./)
    await fails('edit_film_shot', { filmId: h.id, sceneId: h.sceneId, shotId: 'noshot', remove: true }, /No such shot\./)
    await fails('edit_film_shot', { filmId: h.id, sceneId: h.sceneId, shotId: h.a, move: 2 }, /move/i)
    await fails('edit_film_shot', { filmId: h.id, sceneId: h.sceneId, shotId: h.a, seconds: 0 }, /seconds/i)
    await fails('edit_film_shot', { filmId: h.id, sceneId: h.sceneId, shotId: h.a, seconds: 99 }, /seconds/i)
  })

  // ---------- write_film_shot_prompt ----------
  test('[mcp:write_film_shot_prompt] writes the shot\'s H3 prompt from its description with the writer chosen in Settings and saves it on the shot', async () => {
    const h = await film()
    claudeAnswers(WRITER)
    const r = await ok('write_film_shot_prompt', { filmId: h.id, sceneId: h.sceneId, shotId: h.a })
    assert.match(r.prompt, /^integrated_multimodal_description: \[Shot 1\] .*A woman in a red coat waits at a rainy bus stop/)
    assert.match(r.prompt, /Where is that bus\?/)
    assert.equal((await shotOf(h.id, h.a)).prompt, r.prompt, 'saved on the shot')
    const input = sawInput()
    assert.match(input, /Bus Stop, night/i)
    assert.match(input, /Tess waits\./)
    assert.match(input, /says exactly these words: "Where is that bus\?"/)
    assert.match(input, /one continuous take with no cuts: write a single \[Shot 1\]/)
    const silent = await ok('write_film_shot_prompt', { filmId: h.id, sceneId: h.sceneId, shotId: h.b })
    assert.match(sawInput(), /No one speaks\./)
    assert.match(sawInput(), /It opens as the previous shot ended|A bus passes\./)
    assert.ok(silent.prompt)
  })

  test('[mcp:write_film_shot_prompt] names a shot that is not there and relays the writer\'s own failure', async () => {
    const h = await film()
    await fails('write_film_shot_prompt', { filmId: h.id, sceneId: h.sceneId, shotId: 'noshot' }, /No such shot\./)
    shim('echo "login expired, run claude to sign in" >&2\nexit 1\n')
    await fails('write_film_shot_prompt', { filmId: h.id, sceneId: h.sceneId, shotId: h.a }, /login expired, run claude to sign in/)
    assert.equal((await shotOf(h.id, h.a)).prompt, '', 'a failed write changes nothing')
    claudeAnswers(WRITER)
  })

  // ---------- speak_film_line ----------
  test('[mcp:speak_film_line] says the shot\'s line in its character\'s voice and keeps the file on the shot', async () => {
    const v = await ok('create_voice', { name: 'Tess film voice', file: wav, text: 'Reference words.', kind: 'designed', seed: 41 })
    await ok('save_character', { id: 'tess', voiceId: v.id })
    const h = await film()
    const say = 'Where is that bus?'
    const cached = dataFile('voices', 'lines', `${v.id}_${hash(say, 'voxcpm2', 41, v.text)}.wav`)
    fs.mkdirSync(path.dirname(cached), { recursive: true })
    fs.copyFileSync(wav, cached)
    const r = await ok('speak_film_line', { filmId: h.id, shotId: h.a })
    assert.equal(r.file, cached)
    assert.ok(Math.abs(r.duration - 2) < 0.1)
    assert.equal(r.heard, null, 'nothing read it back: the voice engine is not set up')
    const sh = await shotOf(h.id, h.a)
    assert.deepEqual([sh.voiceLine.file, sh.voiceLine.text], [cached, say])
    assert.equal(readData('voices', 'lines.json')[0].voiceId, v.id, 'the line is in the voice\'s history too')
    // a new take uses new seeds the engine has never said, so with no engine it is refused and the old line stays
    await fails('speak_film_line', { filmId: h.id, shotId: h.a, again: true }, /Set up voices first/)
    assert.equal((await shotOf(h.id, h.a)).voiceLine.file, cached)
  })

  test('[mcp:speak_film_line] refuses a shot with no line, a character with no voice and a shot that is not there', async () => {
    const h = await film()
    await fails('speak_film_line', { filmId: h.id, shotId: h.b }, /This shot has no line to say\./)
    await ok('edit_film_shot', { filmId: h.id, sceneId: h.sceneId, shotId: h.b, line: 'Hello.', speaker: 'Ana', character: 'ana' })
    await fails('speak_film_line', { filmId: h.id, shotId: h.b }, /Give this character a voice on the Characters page first\./)
    await fails('speak_film_line', { filmId: h.id, shotId: 'noshot' }, /No shot noshot\./)
  })

  // ---------- use_film_recording ----------
  test('[mcp:use_film_recording] converts a recording to the shot\'s line, keeping the shot\'s words, and a shot with no words keeps what was heard', async () => {
    const h = await film()
    const r = await ok('use_film_recording', { filmId: h.id, shotId: h.a, file: wav })
    assert.ok(r.file.startsWith(dataFile('productions', 'lines')) && r.file.endsWith('.wav'))
    assert.ok(Math.abs(r.duration - 2) < 0.1)
    assert.equal(r.heard, null)
    assert.equal(r.line, 'Where is that bus?')
    assert.equal(execFileSync(ffmpegStatic.ffprobePath, ['-v', 'error', '-show_entries', 'stream=sample_rate,channels', '-of', 'csv=p=0', r.file]).toString().trim(), '48000,1', 'mono 48 kHz')
    const sh = await shotOf(h.id, h.a)
    assert.deepEqual([sh.voiceLine.text, sh.voiceLine.recorded, sh.line], ['Where is that bus?', 'line.wav', 'Where is that bus?'])
    const silent = await ok('use_film_recording', { filmId: h.id, shotId: h.b, file: wav })
    assert.equal(silent.line, '', 'nothing was heard, so there are no words')
  })

  test('[mcp:use_film_recording] refuses a recording longer than a shot holds, a picture with no sound to take, a missing file and a shot that is not there', async () => {
    const h = await film()
    await fails('use_film_recording', { filmId: h.id, shotId: h.a, file: long }, /The recording is 16\.0 s; a shot holds 14 s at most\./)
    await fails('use_film_recording', { filmId: h.id, shotId: h.a, file: face }, /Error opening output files/)
    await fails('use_film_recording', { filmId: h.id, shotId: h.a, file: path.join(path.dirname(wav), 'gone.wav') }, /Pick a sound file\./)
    await fails('use_film_recording', { filmId: h.id, shotId: 'noshot', file: wav }, /No shot noshot\./)
    assert.equal((await shotOf(h.id, h.a)).voiceLine, null)
  })

  // ---------- use_film_face ----------
  test('[mcp:use_film_face] keeps the person\'s own picture as a made-up role\'s face and marks their sketches to redraw', async () => {
    const h = await film({ script: 'INT. BUS STOP - NIGHT\n\nA man waits.\n' })
    await ok('edit_film_shot', { filmId: h.id, sceneId: h.sceneId, shotId: h.b, speaker: 'Driver', characters: ['Driver'], action: 'The driver nods.' })
    const p = readData('productions', `${h.id}.json`)
    p.scenes[0].shots[1].sketch = face
    fs.writeFileSync(dataFile('productions', `${h.id}.json`), JSON.stringify(p))
    const r = await ok('use_film_face', { filmId: h.id, role: 'Driver', file: face })
    assert.equal(r.as, 'Driver')
    assert.equal(r.characterId, null)
    assert.ok(r.face.startsWith(dataFile('productions', 'faces')) && r.face.endsWith('.png'), r.face)
    assert.ok(fs.existsSync(r.face) && r.face !== face, 'a copy in the film\'s faces folder')
    assert.deepEqual((await view(h.id)).cast.filter((c) => !c.characterId).map((c) => [c.as, c.face]), [['Driver', r.face]])
    assert.equal((await shotOf(h.id, h.b)).sketchStale, true)
    // a second picture replaces the first on the same cast entry
    const again = await ok('use_film_face', { filmId: h.id, role: 'driver', file: face })
    assert.notEqual(again.face, r.face)
    assert.equal((await view(h.id)).cast.filter((c) => !c.characterId).length, 1)
  })

  test('[mcp:use_film_face] refuses a missing file and a file that is not a PNG, JPEG or WebP picture', async () => {
    const h = await film()
    await fails('use_film_face', { filmId: h.id, role: 'Driver', file: path.join(path.dirname(face), 'gone.png') }, /Pick a picture of their face\./)
    await fails('use_film_face', { filmId: h.id, role: 'Driver', file: wav }, /Use a PNG, JPEG or WebP picture\./)
    await fails('use_film_face', { filmId: 'nope0000', role: 'Driver', file: face }, /No project nope0000/)
    assert.deepEqual((await view(h.id)).cast.filter((c) => !c.characterId), [])
  })
})
