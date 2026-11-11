// MCP film craft tools (upstream v1.1.3, after Sam Wasserman's Slate): the Cinematography picker, coverage plans,
// the prompt writer's tools, a film's Lookbook, the continuity check and the shot list, called through the real MCP
// server on source under the test guard. The prompt writer chosen in Settings is Claude Code, which here is the claude
// shim: it tells the five asks apart by the --json-schema it is given and answers each with a canned object.
//   node --test test/unit/mcp-filmcraft-v113.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { startFakeComfy } from '../fakes/comfyui.mjs'
import { startMcp } from '../fakes/mcp.mjs'
import { guardState } from '../fakes/ports.mjs'

const BASE = 'integrated_multimodal_description: [Shot 1] A woman in a red coat waits at a rainy bus stop <d>[English] Where is that bus?</d>\n\noverall_soundscape: Rain.\n\nnon_diegetic_music: N/A'
const REWORKED = BASE.replace('A woman in a red coat waits', 'A tired woman in a red coat waits')
const LOOK = { tone: 'Quiet and wet.', palette: 'Teal shadows, orange lamps.', lighting: 'Practical sodium light.', lens: 'Long, shallow.', movement: 'Slow push in.', blocking: 'Centred, still.', texture: 'Fine grain.' }

describe('MCP film craft tools', { skip: process.platform === 'win32' && 'the agent CLI shims are sh scripts' }, () => {
  let fake, mcp, shimDir
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
  const readData = (...p) => JSON.parse(fs.readFileSync(path.join(mcp.dataDir, ...p), 'utf8'))
  // The shim answers by schema: prompt (+reply), variants, issues, or the look's fields. Each kind's answer is a file
  // the test sets; every call's user text is appended to claude.log, and the arguments to claude.args.
  const envelope = (obj) => JSON.stringify({ is_error: false, result: '', structured_output: obj })
  const reply = (kind, obj) => fs.writeFileSync(path.join(shimDir, `ans.${kind}`), envelope(obj))
  const fail = (kind) => fs.writeFileSync(path.join(shimDir, `ans.${kind}`), JSON.stringify({ is_error: true, result: 'writer is down' }))
  const calls = () => (fs.existsSync(path.join(shimDir, 'claude.log')) ? fs.readFileSync(path.join(shimDir, 'claude.log'), 'utf8').split('@@CALL\n').slice(1) : [])
  const resetCalls = () => fs.rmSync(path.join(shimDir, 'claude.log'), { force: true })
  const installShim = () => {
    const file = path.join(shimDir, 'claude')
    fs.writeFileSync(file, `#!/bin/sh
d=$(dirname "$0")
in=$(cat)
{ echo "@@CALL"; echo "$in"; } >> "$d/claude.log"
case "$*" in
  *'"required":["variants"]'*) k=variants;;
  *'"required":["issues"]'*) k=issues;;
  *'"required":["tone"'*) k=look;;
  *) k=prompt;;
esac
cat "$d/ans.$k"
`, { mode: 0o755 })
  }
  // a film with one scene and two shots that have prompts
  const film = async (extra = {}) => {
    const f = await ok('create_film', { name: 'Craft film', script: 'INT. BUS STOP - NIGHT\n\nA woman waits.\n', ...extra })
    const sceneId = f.scenes[0].id
    const a = await ok('edit_film_shot', { filmId: f.id, sceneId, add: true, action: 'Tess waits.', camera: 'Wide', seconds: 4, prompt: BASE })
    const b = await ok('edit_film_shot', { filmId: f.id, sceneId, shotId: a.scenes[0].shots[0].id, add: true, action: 'A bus passes.', seconds: 3, prompt: 'integrated_multimodal_description: [Shot 1] A bus passes.' })
    const shots = b.scenes[0].shots
    return { id: f.id, sceneId, a: shots[0].id, b: shots[1].id }
  }
  const shotOf = async (h, id) => (await ok('get_film', { filmId: h.id })).scenes[0].shots.find((s) => s.id === id)
  const stored = (h) => readData('productions', `${h.id}.json`)

  before(async () => {
    fake = await startFakeComfy({ devices: 'mps', os: 'darwin' })
    mcp = await startMcp({ comfyUrl: fake.url, shims: true, settings: { promptEngine: 'claude' } })
    shimDir = [...guardState().shimDirs].at(-1)
    installShim()
    reply('prompt', { prompt: REWORKED, reply: 'Made her tired.' })
    reply('variants', { variants: [{ label: 'Composition', prompt: `${BASE} A` }, { label: 'Light', prompt: `${BASE} B` }, { label: 'Motion', prompt: 'a shot with no line' }] })
    reply('issues', { issues: [{ severity: 'error', shots: ['1.1', '1.2'], issue: 'The coat is red, then gone.', fix: 'Put the red coat in shot 1.2.' }, { severity: 'warn', shots: ['nonsense'], issue: 'Dropped: no digit and no such shot.', fix: 'x' }, { severity: 'maybe', shots: ['1.2'], issue: 'Light shifts.', fix: 'Match the lamp.' }, { severity: 'warn', shots: [], issue: '', fix: 'blank issue is dropped' }] })
    reply('look', LOOK)
  })
  after(async () => {
    await mcp?.close()
    await fake?.close()
  })

  // ---------- list_cinematography ----------
  test('[mcp:list_cinematography] lists Slate\'s 165 setups in 12 groups and its 12 coverage plans', async () => {
    const r = await ok('list_cinematography')
    assert.equal(r.setups.length, 12)
    assert.equal(r.setups.reduce((n, g) => n + g.items.length, 0), 165)
    assert.ok(r.setups.every((g) => g.items.every((i) => i.id && i.label && i.snippet)))
    assert.deepEqual(r.setups.map((g) => g.id).slice(0, 2), ['photo-styles', 'film-stocks'])
    assert.equal(r.plans.length, 12)
    assert.deepEqual(r.plans.find((p) => p.id === 'dialogue-coverage').shots[0].split(':')[0], 'Master')
    assert.ok(r.plans.every((p) => p.shots.length >= 6 && /^[^:]+: .+, .+, .+$/.test(p.shots[0])))
  })

  test('[mcp:list_cinematography] with a group gives only that group and no plans, and an unknown group gives nothing', async () => {
    const r = await ok('list_cinematography', { group: 'film-stocks' })
    assert.deepEqual(r.setups.map((g) => [g.id, g.items.length]), [['film-stocks', 16]])
    assert.deepEqual(r.plans, [])
    const none = await ok('list_cinematography', { group: 'no-such-group' })
    assert.deepEqual(none, { setups: [], plans: [] })
  })

  // ---------- add_cinematography ----------
  test('[mcp:add_cinematography] puts each setup\'s phrase at the end of the description once, in the order given', async () => {
    const all = await ok('list_cinematography')
    const flat = all.setups.flatMap((g) => g.items)
    const [one, two] = [flat.find((i) => i.id === 'editorial-photography'), flat.find((i) => i.id !== 'editorial-photography')]
    const r = await ok('add_cinematography', { prompt: BASE, setups: [one.id, two.id] })
    assert.deepEqual(r.added, [one.label, two.label])
    assert.ok(r.prompt.includes(one.snippet) && r.prompt.includes(two.snippet))
    assert.ok(r.prompt.indexOf(one.snippet) < r.prompt.indexOf(two.snippet))
    assert.ok(r.prompt.indexOf(one.snippet) > r.prompt.indexOf('[Shot 1]'), 'after the description, not before it')
    assert.ok(r.prompt.indexOf(one.snippet) < r.prompt.indexOf('overall_soundscape'), 'inside the description section')
    const again = await ok('add_cinematography', { prompt: r.prompt, setups: [one.id] })
    assert.equal(again.prompt.split(one.snippet).length - 1, 1, 'a setup already there is not added twice')
  })

  test('[mcp:add_cinematography] drops unknown ids, and refuses when none of them exist or the list is empty', async () => {
    const real = (await ok('list_cinematography', { group: 'lens-characteristics' })).setups[0].items[0]
    const r = await ok('add_cinematography', { prompt: BASE, setups: ['nope-1', real.id] })
    assert.deepEqual(r.added, [real.label])
    await fails('add_cinematography', { prompt: BASE, setups: ['nope-1', 'nope-2'] }, /None of those setup ids exist\. See list_cinematography\./)
    const r2 = await call('add_cinematography', { prompt: BASE, setups: [] })
    assert.equal(r2.isError, true)
  })

  // ---------- set_film_cinematography ----------
  test('[mcp:set_film_cinematography] saves the chosen setups on the film\'s look, keeps its notes, drops unknown ids and an empty list clears them', async () => {
    const h = await film()
    await ok('update_film', { filmId: h.id, look: { notes: 'Grainy.', loras: [] } })
    const items = (await ok('list_cinematography', { group: 'lighting-setups' })).setups[0].items
    const r = await ok('set_film_cinematography', { filmId: h.id, setups: [items[1].id, 'nope', items[0].id] })
    assert.deepEqual(r.look.setups, [items[1], items[0]].map((i) => ({ id: i.id, label: i.label, snippet: i.snippet })))
    assert.equal(r.look.notes, 'Grainy.')
    assert.deepEqual(stored(h).look.setups.map((s) => s.id), [items[1].id, items[0].id])
    const cleared = await ok('set_film_cinematography', { filmId: h.id, setups: [] })
    assert.deepEqual(cleared.look.setups, [])
    assert.equal(cleared.look.notes, 'Grainy.')
    await fails('set_film_cinematography', { filmId: 'nope0000', setups: [] }, /No project nope0000/)
  })

  // ---------- set_scene_coverage ----------
  test('[mcp:set_scene_coverage] sets one of Slate\'s plans on a scene and marks a scene that has shots to plan again; an empty plan goes back to the planner\'s choice', async () => {
    const h = await film()
    const r = await ok('set_scene_coverage', { filmId: h.id, sceneId: h.sceneId, plan: 'dialogue-coverage' })
    const sc = r.scenes[0]
    assert.deepEqual([sc.coverage.id, sc.coverage.label, sc.coverage.shots.length, sc.coverage.shots[0].slot], ['dialogue-coverage', 'Dialogue Coverage', 6, 'Master'])
    assert.equal(sc.stale, true, 'the scene has shots, so it is planned again')
    assert.equal(stored(h).scenes[0].coverage.id, 'dialogue-coverage')
    const off = await ok('set_scene_coverage', { filmId: h.id, sceneId: h.sceneId, plan: '' })
    assert.equal(off.scenes[0].coverage, null)
    const empty = await ok('create_film', { script: 'INT. ROOM - DAY\n\nA man sits.\n' })
    const e = await ok('set_scene_coverage', { filmId: empty.id, sceneId: empty.scenes[0].id, plan: 'orbit' })
    assert.notEqual(e.scenes[0].stale, true, 'a scene with no shots has nothing to plan again')
  })

  test('[mcp:set_scene_coverage] refuses a plan, a scene and a film that are not there, and changes nothing', async () => {
    const h = await film()
    await fails('set_scene_coverage', { filmId: h.id, sceneId: h.sceneId, plan: 'no-such-plan' }, /No coverage plan "no-such-plan"\. See list_cinematography\./)
    await fails('set_scene_coverage', { filmId: h.id, sceneId: 'nosuch', plan: 'orbit' }, /No such scene\./)
    await fails('set_scene_coverage', { filmId: 'nope0000', sceneId: h.sceneId, plan: 'orbit' }, /No project nope0000/)
    assert.ok(!stored(h).scenes[0].coverage)
  })

  // ---------- export_shot_list ----------
  test('[mcp:export_shot_list] gives Markdown by default: a table per scene, the coverage plan, no prompts; prompts: true adds them', async () => {
    const h = await film({ name: 'List film', logline: 'A wait.' })
    await ok('edit_film_shot', { filmId: h.id, sceneId: h.sceneId, shotId: h.a, speaker: 'Tess', line: 'Where | is it?' })
    await ok('set_scene_coverage', { filmId: h.id, sceneId: h.sceneId, plan: 'orbit' })
    const { text } = await ok('export_shot_list', { filmId: h.id })
    assert.match(text, /^# List film: shot list\n\nA wait\.\n/)
    assert.match(text, /\n1 scenes, 2 shots, about 7 s\. 16:9\n/)
    assert.match(text, /## 1\. INT\. BUS STOP - NIGHT\n\nCoverage: Orbit\n/)
    assert.match(text, /\| Shot \| s \| Camera \| Action \| Line \|\n\|---\|---\|---\|---\|---\|\n\| 1\.1 \| 4 \| Wide \| Tess waits\. \| Tess: "Where \\\| is it\?" \|\n\| 1\.2 \| 3 \|/)
    assert.ok(!text.includes('prompt\n'), 'no prompts by default')
    const withPrompts = (await ok('export_shot_list', { filmId: h.id, prompts: true })).text
    assert.match(withPrompts, /### 1\.1 prompt\n\n```\nintegrated_multimodal_description: \[Shot 1\] A woman in a red coat/)
  })

  test('[mcp:export_shot_list] csv has a row per shot with the prompt, quotes what needs it, and leaves the prompt out when prompts is false', async () => {
    const h = await film()
    await ok('edit_film_shot', { filmId: h.id, sceneId: h.sceneId, shotId: h.a, line: 'Say "hi", Tess', speaker: 'Tess' })
    const { text } = await ok('export_shot_list', { filmId: h.id, format: 'csv' })
    const lines = text.split('\r\n')
    assert.equal(lines[0], 'scene,heading,shot,seconds,camera,action,staging,characters,speaker,line,ends,coverage,status,prompt')
    assert.equal(lines.length, 4, 'header, two shots and the trailing break')
    assert.match(lines[1], /^1,INT\. BUS STOP - NIGHT,1\.1,4,Wide,Tess waits\.,,,Tess,"Say ""hi"", Tess",,,written,"integrated_multimodal_description: \[Shot 1\]/)
    assert.match(lines[2], /^1,INT\. BUS STOP - NIGHT,1\.2,3,/)
    const slim = (await ok('export_shot_list', { filmId: h.id, format: 'csv', prompts: false })).text.split('\r\n')
    assert.ok(!slim[0].endsWith('prompt') && !slim[1].includes('integrated_multimodal'))
    await fails('export_shot_list', { filmId: 'nope0000' }, /No project nope0000/)
    await fails('export_shot_list', { filmId: h.id, format: 'xls' }, /format/i)
  })

  // ---------- rework_prompt ----------
  test('[mcp:rework_prompt] rewrites a prompt on a director\'s note through the writer chosen in Settings, and reports nothing missing when lines and labels stay', async () => {
    resetCalls()
    const r = await ok('rework_prompt', { prompt: BASE, note: 'Make her tired.' })
    assert.deepEqual(r, { prompt: REWORKED, reply: 'Made her tired.', missing: [] })
    const [seen] = calls()
    assert.match(seen, /The director gives this note: "Make her tired\."/)
    assert.ok(seen.includes(`THE PROMPT:\n${BASE}`))
    assert.match(seen, /Answer with the JSON object only\./)
  })

  test('[mcp:rework_prompt] a named tool carries its own task, and what the rewrite dropped (a spoken line, a kept word) comes back as missing', async () => {
    reply('prompt', { prompt: 'integrated_multimodal_description: [Shot 1] A woman waits.', reply: 'Shorter.' })
    resetCalls()
    const r = await ok('rework_prompt', { prompt: BASE, tool: 'tighten', keep: ['red coat'] })
    assert.deepEqual(r.missing, ['<d>[English] Where is that bus?</d>', 'red coat'])
    assert.match(calls()[0], /TASK: Shorten this prompt by about a third/)
    assert.match(calls()[0], /Keep these words exactly as they are: "red coat"/)
    reply('prompt', { prompt: REWORKED, reply: 'Made her tired.' })
  })

  test('[mcp:rework_prompt] refuses an empty prompt, a note tool with no note, an unknown tool and a writer that answers nothing, without calling the writer', async () => {
    resetCalls()
    await fails('rework_prompt', { prompt: '   ', note: 'x' }, /Write or generate the prompt first\./)
    await fails('rework_prompt', { prompt: BASE }, /Write the note first\./)
    await fails('rework_prompt', { prompt: BASE, note: '  ' }, /Write the note first\./)
    await fails('rework_prompt', { prompt: BASE, tool: 'sparkle' }, /tool/i)
    assert.equal(calls().length, 0)
    reply('prompt', { prompt: '  ', reply: '' })
    await fails('rework_prompt', { prompt: BASE, note: 'x' }, /The writer gave nothing back\. Try again\./)
    fail('prompt')
    await fails('rework_prompt', { prompt: BASE, note: 'x' }, /Claude Code: writer is down/)
    reply('prompt', { prompt: REWORKED, reply: 'Made her tired.' })
  })

  // ---------- prompt_variants ----------
  test('[mcp:prompt_variants] gives three labelled versions and says what each dropped', async () => {
    resetCalls()
    const r = await ok('prompt_variants', { prompt: BASE })
    assert.deepEqual(r.variants.map((v) => v.label), ['Composition', 'Light', 'Motion'])
    assert.deepEqual(r.variants.map((v) => v.missing), [[], [], ['<d>[English] Where is that bus?</d>']])
    assert.match(calls()[0], /Write three distinct versions of this prompt/)
  })

  test('[mcp:prompt_variants] refuses an empty prompt before calling the writer, and a writer with no variants', async () => {
    resetCalls()
    await fails('prompt_variants', { prompt: '' }, /Write or generate the prompt first\./)
    assert.equal(calls().length, 0)
    reply('variants', { variants: [{ label: 'x', prompt: ' ' }] })
    await fails('prompt_variants', { prompt: BASE }, /The writer gave no variants back\. Try again\./)
    reply('variants', { variants: [{ label: 'Composition', prompt: `${BASE} A` }, { label: 'Light', prompt: `${BASE} B` }, { label: 'Motion', prompt: 'a shot with no line' }] })
  })

  // ---------- make_lookbook ----------
  test('[mcp:make_lookbook] turns a look into seven fields and one paragraph for prompts with the source\'s own name scrubbed out', async () => {
    reply('look', { ...LOOK, tone: 'A Noir Picture feel: quiet and wet.' })
    resetCalls()
    const r = await ok('make_lookbook', { source: 'Noir Picture' })
    assert.equal(r.source, 'Noir Picture')
    assert.deepEqual(Object.keys(r.fields), ['tone', 'palette', 'lighting', 'lens', 'movement', 'blocking', 'texture'])
    assert.ok(!/Noir Picture/i.test(r.words) && /the look feel: quiet and wet\. Teal shadows/.test(r.words))
    assert.ok(r.fields.tone.includes('Noir Picture'), 'the fields keep what the writer said; only the paragraph is scrubbed')
    assert.match(calls()[0], /The look: Noir Picture/)
    reply('look', LOOK)
  })

  test('[mcp:make_lookbook] with a filmId it becomes that film\'s Lookbook and keeps the rest of its look; without one nothing is saved', async () => {
    const h = await film()
    await ok('update_film', { filmId: h.id, look: { notes: 'Grainy.', loras: [] } })
    await ok('make_lookbook', { source: 'rain-soaked night street' })
    assert.equal(stored(h).look.lookbook, undefined, 'no filmId, nothing saved')
    const r = await ok('make_lookbook', { source: 'rain-soaked night street', filmId: h.id })
    assert.equal(r.source, 'rain-soaked night street')
    assert.deepEqual(stored(h).look.lookbook, r)
    assert.equal(stored(h).look.notes, 'Grainy.')
  })

  test('[mcp:make_lookbook] refuses an empty source, a film that is not there and a writer with nothing to say', async () => {
    resetCalls()
    await fails('make_lookbook', { source: '  ' }, /Name a film, director or cinematographer, or describe the look\./)
    assert.equal(calls().length, 0)
    await fails('make_lookbook', { source: 'x look', filmId: 'nope0000' }, /No project nope0000/)
    reply('look', { tone: '', palette: '', lighting: '', lens: '', movement: '', blocking: '', texture: '' })
    await fails('make_lookbook', { source: 'x look' }, /The writer gave no look back\. Try again\./)
    reply('look', LOOK)
  })

  // ---------- rework_film_shot, restore_film_shot_prompt ----------
  test('[mcp:rework_film_shot] rewrites a Projects shot\'s prompt, puts the old one in its history and gives the writer the film, scene and look as context', async () => {
    const h = await film({ name: 'Rain film', logline: 'A wait.' })
    await ok('set_film_cinematography', { filmId: h.id, setups: [] })
    resetCalls()
    const r = await ok('rework_film_shot', { filmId: h.id, sceneId: h.sceneId, shotId: h.a, note: 'Make her tired.' })
    assert.deepEqual(r, { prompt: REWORKED, reply: 'Made her tired.', missing: [] })
    const sh = await shotOf(h, h.a)
    assert.equal(sh.prompt, REWORKED)
    const saved = stored(h).scenes[0].shots[0]
    assert.deepEqual(saved.history.map((x) => [x.prompt, x.why]), [[BASE, 'note: Make her tired.']])
    assert.match(calls()[0], /Film: Rain film\. A wait\.\nScene: INT\. BUS STOP - NIGHT\nShot: Wide, 4 s/)
    const t = await ok('rework_film_shot', { filmId: h.id, sceneId: h.sceneId, shotId: h.a, tool: 'enrich' })
    assert.equal(t.prompt, REWORKED)
    assert.equal(stored(h).scenes[0].shots[0].history.length, 1, 'a rewrite that changes nothing adds no history')
  })

  test('[mcp:rework_film_shot] refuses a shot that is not there, a shot with no prompt and a note tool with no note, and changes nothing', async () => {
    const h = await film()
    const blank = await ok('edit_film_shot', { filmId: h.id, sceneId: h.sceneId, shotId: h.b, add: true, action: 'No prompt yet.' })
    const blankId = blank.scenes[0].shots[2].id
    resetCalls()
    await fails('rework_film_shot', { filmId: h.id, sceneId: h.sceneId, shotId: 'nosuch', note: 'x' }, /No such shot\./)
    await fails('rework_film_shot', { filmId: h.id, sceneId: h.sceneId, shotId: blankId, note: 'x' }, /Write or generate the prompt first\./)
    await fails('rework_film_shot', { filmId: h.id, sceneId: h.sceneId, shotId: h.a }, /Write the note first\./)
    await fails('rework_film_shot', { filmId: 'nope0000', sceneId: h.sceneId, shotId: h.a, note: 'x' }, /No project nope0000/)
    assert.equal(calls().length, 0, 'the writer was never asked')
    assert.equal((await shotOf(h, h.a)).prompt, BASE)
    assert.ok(!stored(h).scenes[0].shots[0].history)
  })

  test('[mcp:restore_film_shot_prompt] puts the newest earlier prompt back and the current one goes into the history in its place; index picks an older one', async () => {
    const h = await film()
    for (const tool of ['tighten', 'enrich']) await ok('rework_film_shot', { filmId: h.id, sceneId: h.sceneId, shotId: h.a, tool })
    reply('prompt', { prompt: 'integrated_multimodal_description: [Shot 1] Second.', reply: 'r' })
    await ok('rework_film_shot', { filmId: h.id, sceneId: h.sceneId, shotId: h.a, tool: 'distill' })
    reply('prompt', { prompt: REWORKED, reply: 'Made her tired.' })
    let hist = stored(h).scenes[0].shots[0].history
    assert.deepEqual(hist.map((x) => x.prompt), [REWORKED, BASE], 'newest first')
    const back = await ok('restore_film_shot_prompt', { filmId: h.id, sceneId: h.sceneId, shotId: h.a })
    assert.equal(back.scenes[0].shots[0].prompt, REWORKED)
    hist = stored(h).scenes[0].shots[0].history
    assert.deepEqual(hist.map((x) => [x.prompt, x.why]), [['integrated_multimodal_description: [Shot 1] Second.', 'before going back'], [BASE, 'tighten']])
    const older = await ok('restore_film_shot_prompt', { filmId: h.id, sceneId: h.sceneId, shotId: h.a, index: 1 })
    assert.equal(older.scenes[0].shots[0].prompt, BASE)
  })

  test('[mcp:restore_film_shot_prompt] refuses when there is nothing to go back to or the index is past the history, and changes nothing', async () => {
    const h = await film()
    await fails('restore_film_shot_prompt', { filmId: h.id, sceneId: h.sceneId, shotId: h.a }, /Nothing to go back to\./)
    await ok('rework_film_shot', { filmId: h.id, sceneId: h.sceneId, shotId: h.a, note: 'n' })
    await fails('restore_film_shot_prompt', { filmId: h.id, sceneId: h.sceneId, shotId: h.a, index: 5 }, /Nothing to go back to\./)
    await fails('restore_film_shot_prompt', { filmId: h.id, sceneId: h.sceneId, shotId: 'nosuch' }, /Nothing to go back to\./)
    await fails('restore_film_shot_prompt', { filmId: h.id, sceneId: h.sceneId, shotId: h.a, index: -1 }, /index/i)
    assert.equal((await shotOf(h, h.a)).prompt, REWORKED)
  })

  // ---------- film_shot_variants ----------
  test('[mcp:film_shot_variants] gives three variants of a shot\'s prompt and applies none of them', async () => {
    const h = await film()
    resetCalls()
    const r = await ok('film_shot_variants', { filmId: h.id, sceneId: h.sceneId, shotId: h.a })
    assert.deepEqual(r.variants.map((v) => v.label), ['Composition', 'Light', 'Motion'])
    assert.deepEqual(r.variants[0].missing, [])
    assert.match(calls()[0], /Film: Craft film\nScene: INT\. BUS STOP - NIGHT\nShot: Wide, 4 s/)
    assert.equal((await shotOf(h, h.a)).prompt, BASE)
    assert.ok(!stored(h).scenes[0].shots[0].history, 'nothing was applied, so no history')
  })

  test('[mcp:film_shot_variants] refuses a shot that is not there and a shot with no prompt before calling the writer', async () => {
    const h = await film()
    const blank = await ok('edit_film_shot', { filmId: h.id, sceneId: h.sceneId, shotId: h.b, add: true, action: 'No prompt yet.' })
    resetCalls()
    await fails('film_shot_variants', { filmId: h.id, sceneId: h.sceneId, shotId: 'nosuch' }, /No such shot\./)
    await fails('film_shot_variants', { filmId: h.id, sceneId: h.sceneId, shotId: blank.scenes[0].shots[2].id }, /Write or generate the prompt first\./)
    assert.equal(calls().length, 0)
  })

  // ---------- check_film_continuity ----------
  test('[mcp:check_film_continuity] returns the writer\'s issues tidied (a bad severity becomes warn, shots it cannot place and empty issues are dropped) and keeps them on the scene', async () => {
    const h = await film({ look: undefined })
    resetCalls()
    const r = await ok('check_film_continuity', { filmId: h.id, sceneId: h.sceneId })
    assert.deepEqual(r.issues, [
      { severity: 'error', shots: ['1.1', '1.2'], issue: 'The coat is red, then gone.', fix: 'Put the red coat in shot 1.2.' },
      { severity: 'warn', shots: [], issue: 'Dropped: no digit and no such shot.', fix: 'x' },
      { severity: 'warn', shots: ['1.2'], issue: 'Light shifts.', fix: 'Match the lamp.' }
    ])
    const seen = calls()[0]
    assert.match(seen, /Scene: INT\. BUS STOP - NIGHT/)
    assert.match(seen, /--- 1\.1 ---\nintegrated_multimodal_description: \[Shot 1\] A woman in a red coat/)
    assert.match(seen, /--- 1\.2 ---\nintegrated_multimodal_description: \[Shot 1\] A bus passes\./)
    const kept = stored(h).scenes[0].continuity
    assert.deepEqual(kept.issues, r.issues)
    assert.equal(kept.writer, 'claude')
    assert.ok(Date.parse(kept.at))
  })

  test('[mcp:check_film_continuity] needs two shots with something written, and names a scene that is not there; nothing is kept on a refusal', async () => {
    const f = await ok('create_film', { script: 'INT. ROOM - DAY\n\nA man sits.\n' })
    const sceneId = f.scenes[0].id
    resetCalls()
    await fails('check_film_continuity', { filmId: f.id, sceneId }, /A continuity check needs at least two shots with prompts\./)
    await ok('edit_film_shot', { filmId: f.id, sceneId, add: true, action: 'He sits.', prompt: 'p' })
    await fails('check_film_continuity', { filmId: f.id, sceneId }, /A continuity check needs at least two shots with prompts\./)
    await fails('check_film_continuity', { filmId: f.id, sceneId: 'nosuch' }, /No such scene\./)
    assert.equal(calls().length, 0)
    assert.ok(!readData('productions', `${f.id}.json`).scenes[0].continuity)
  })
})
