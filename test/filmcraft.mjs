// Film craft (filmcraft.js, after Sam Wasserman's Slate) with no ComfyUI and no real writer: Slate's data as
// bundled, cinematography phrases in a prompt, coverage rules, the shot list, what a rewrite dropped, names kept out
// of a lookbook, and the prompt tools, variants, continuity and lookbook through a stand-in OpenAI-compatible
// writer; then Projects: the chosen writer plans a covered scene, history and going back, the shot list.
//   node test/filmcraft.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { continuityCheck, coverageRules, dropped, loadSlate, lookbook, promptVariants, rewritePrompt, scrubNames, setupSnippets, shotListCsv, shotListMarkdown, withSetups, withoutSetups } from '../src/service/filmcraft.js'
import { setLlmSource } from '../src/service/llm.js'
import { lookWords, Productions } from '../src/service/productions.js'

let passed = 0
const test = async (name, fn) => {
  await fn()
  passed++
  console.log(`ok - ${name}`)
}
const RES = path.resolve('resources')
const PROMPT = 'integrated_multimodal_description: [Shot 1] Live-action. {char} waits at a bus stop in the rain and says <d>[English] Late again.</d> <Picture 1> is the shelter.\n\noverall_soundscape: Rain on the roof.\n\nnon_diegetic_music: N/A'

// the stand-in writer answers by what the system message asks for
const seen = []
const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    const send = (o) => (res.writeHead(200, { 'content-type': 'application/json' }), res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(o) } }] })))
    if (req.url === '/v1/models') return (res.writeHead(200, { 'content-type': 'application/json' }), res.end(JSON.stringify({ data: [{ id: 'craft' }] })))
    const j = JSON.parse(body)
    const sys = j.messages[0].content
    const user = j.messages.at(-1).content
    seen.push({ sys, user })
    if (/script supervisor/.test(sys)) return send({ issues: [{ severity: 'error', shots: ['1.2'], issue: 'Her coat turns red.', fix: 'Say "grey coat" in shot 1.2.' }] })
    if (/^You are a cinematographer/.test(sys)) return send({ tone: 'Melancholy, hushed.', palette: 'Teal and amber, Wong Kar-wai style.', lighting: 'Neon spill.', lens: 'Long lens.', movement: 'Step-printed handheld.', blocking: 'Close and cramped.', texture: 'Heavy grain.' })
    if (/three variants/.test(sys)) return send({ variants: [{ label: 'Light first', prompt: PROMPT.replace('Rain on', 'Hard rain on') }, { label: 'Composition first', prompt: PROMPT }, { label: 'Lost a line', prompt: PROMPT.replace(/<d>.*?<\/d>/, '') }] })
    if (/collaborator who edits/.test(sys)) return send({ prompt: PROMPT.replace('waits', 'waits, shoulders hunched,'), reply: 'Made her colder.' })
    if (/breaking one scene/.test(sys))
      return send({
        shots: [1, 2, 3, 4, 5, 6, 7].map((n) => ({ action: `Shot ${n} action.`, staging: 'Tess screen-left, Theo screen-right.', camera: 'Medium, static', characters: ['Tess'], speaker: n === 2 ? 'Tess' : '', line: n === 2 ? 'Late again.' : '', seconds: 4, ends: 'They stand still.' }))
      })
    send({})
  })
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
setLlmSource(() => ({ provider: 'openai', url: `http://127.0.0.1:${server.address().port}/v1`, model: 'craft', vision: false }))
const writer = { engine: 'local', provider: 'openai', model: 'craft' }

await test("Slate's data as bundled: 165 setups in 12 groups, 12 coverage plans", () => {
  const s = loadSlate(RES)
  assert.equal(s.setups.length, 12)
  assert.equal(s.setups.reduce((n, g) => n + g.items.length, 0), 165)
  assert.equal(s.plans.length, 12)
  assert.ok(s.byId.get('kodak-portra-400').snippet.startsWith('Shot on Kodak Portra 400'))
  assert.deepEqual(s.plans.find((p) => p.id === 'dialogue-coverage').shots.map((x) => x.slot), ['Master', 'OTS A', 'OTS B', 'CU A', 'CU B', 'Reaction'])
  assert.ok(fs.existsSync(path.join(RES, 'slate', 'NOTICE')) && fs.readFileSync(path.join(RES, 'slate', 'NOTICE'), 'utf8').includes('Sam Wasserman'))
})

await test('cinematography phrases go at the end of the description, once, and come out again', () => {
  const s = loadSlate(RES)
  const picks = setupSnippets(s, ['kodak-portra-400', 'rembrandt-lighting', 'no-such-id'])
  assert.equal(picks.length, 2)
  const out = withSetups(PROMPT, picks)
  const [body, rest] = out.split('\n\noverall_soundscape:')
  assert.ok(body.endsWith(picks[1].snippet) && body.includes(picks[0].snippet), body)
  assert.ok(rest.startsWith(' Rain on the roof.'))
  assert.equal(withSetups(out, picks), out, 'added once')
  assert.equal(withoutSetups(out, picks), PROMPT)
  assert.equal(withSetups('', picks), picks.map((p) => p.snippet).join(' '))
  const ref = 'subject_definitions:\n<Subject 1> is Tess.\n\ndetailed_description:\n[Shot 1] She waits.\n\nnon_diegetic_music: N/A'
  assert.ok(withSetups(ref, picks.slice(0, 1)).includes(`She waits. ${picks[0].snippet}\n\nnon_diegetic_music`))
})

await test('a coverage plan becomes exact planner rules, with A and B named', () => {
  const plan = loadSlate(RES).plans.find((p) => p.id === 'dialogue-coverage')
  const r = coverageRules(plan, { people: ['Tess', 'Theo'] })
  assert.match(r, /exactly 6 shots/)
  assert.match(r, /"A" is Tess and "B" is Theo/)
  assert.match(r, /2\. OTS A: MCU, over-shoulder, locked/)
  assert.equal(coverageRules(null), '')
})

const film = {
  name: 'Dry Seat',
  logline: 'Two strangers, one dry seat.',
  aspect: '9:16',
  scenes: [{ heading: 'EXT. BUS STOP - NIGHT', coverage: 'Dialogue Coverage', shots: [{ seconds: 5, camera: 'Wide, static', action: 'Tess waits, "soaked".', speaker: 'Tess', line: 'Late, again', slot: 'Master', prompt: 'p1' }, { seconds: 4, camera: 'Close-up', action: 'Theo | sits.', prompt: '' }] }]
}
await test('the shot list as Markdown and CSV', () => {
  const md = shotListMarkdown(film)
  assert.match(md, /^# Dry Seat: shot list/)
  assert.match(md, /1 scenes, 2 shots, about 9 s/)
  assert.match(md, /\| 1\.1 Master \| 5 \| Wide, static \| Tess waits, "soaked"\. \| Tess: "Late, again" \|/)
  assert.match(md, /Theo \\\| sits\./)
  const csv = shotListCsv(film)
  const lines = csv.trim().split('\r\n')
  assert.equal(lines.length, 3)
  assert.ok(lines[0].startsWith('scene,heading,shot,seconds,camera'))
  assert.ok(lines[1].includes('"Tess waits, ""soaked""."') && lines[1].includes('"Late, again"'))
  assert.ok(!shotListCsv(film, { prompts: false }).includes(',p1'))
})

await test('what a rewrite dropped: spoken lines, kept words and labels', () => {
  assert.deepEqual(dropped(PROMPT, PROMPT), [])
  const lost = dropped(PROMPT, PROMPT.replace(/<d>.*?<\/d>/, '').replace('{char}', 'Tess').replace('<Picture 1>', 'the photo'), ['bus stop'])
  assert.deepEqual(lost, ['<d>[English] Late again.</d>', '{char}', '<Picture 1>'])
  assert.deepEqual(dropped('a bus stop', 'a shelter', ['bus stop']), ['bus stop'])
})

await test("a lookbook's names never reach the prompt", () => {
  assert.equal(scrubNames('Teal and amber, Wong Kar-wai style.', 'Wong Kar-wai'), 'Teal and amber, the look style.')
  assert.equal(scrubNames('deep shadows like Roger Deakins and Christopher Doyle', 'Roger Deakins and Christopher Doyle'), 'deep shadows like the look and the look')
})

await test('prompt tools, variants, continuity and lookbook through the chosen writer', async () => {
  const r = await rewritePrompt(writer, { prompt: PROMPT, tool: 'note', note: 'make it colder', context: { film: 'Dry Seat', keep: ['bus stop'] } })
  assert.match(r.prompt, /shoulders hunched/)
  assert.equal(r.reply, 'Made her colder.')
  assert.deepEqual(r.missing, [])
  assert.match(seen.at(-1).user, /director gives this note: "make it colder"/)
  assert.match(seen.at(-1).user, /Keep these words exactly as they are: "bus stop"/)
  assert.match(seen.at(-1).sys, /no negative prompt/)
  await rewritePrompt(writer, { prompt: PROMPT, tool: 'tighten' })
  assert.match(seen.at(-1).user, /Shorten this prompt by about a third/)
  await assert.rejects(rewritePrompt(writer, { prompt: '', tool: 'tighten' }), /Write or generate the prompt first/)
  await assert.rejects(rewritePrompt(writer, { prompt: PROMPT, tool: 'note', note: ' ' }), /Write the note first/)
  const v = await promptVariants(writer, { prompt: PROMPT })
  assert.deepEqual(v.map((x) => x.label), ['Light first', 'Composition first', 'Lost a line'])
  assert.deepEqual(v[2].missing, ['<d>[English] Late again.</d>'])
  const issues = await continuityCheck(writer, { scene: 'Bus stop', shots: [{ name: '1.1', prompt: 'grey coat' }, { name: '1.2', prompt: 'red coat' }] })
  assert.deepEqual(issues, [{ severity: 'error', shots: ['1.2'], issue: 'Her coat turns red.', fix: 'Say "grey coat" in shot 1.2.' }])
  await assert.rejects(continuityCheck(writer, { shots: [{ name: '1.1', prompt: 'x' }] }), /at least two shots/)
  const look = await lookbook(writer, { source: 'Wong Kar-wai' })
  assert.equal(look.fields.lens, 'Long lens.')
  assert.ok(!/wong kar-wai/i.test(look.words), look.words)
  assert.match(look.words, /^Melancholy, hushed\. Teal and amber/)
})

await test('Projects: the chosen writer plans a covered scene; history, going back and the shot list', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-filmcraft-'))
  const studio = { gpuBusy: async () => false, characters: () => [], listJobs: () => [], refreshJob: async () => {} }
  const prod = new Productions({ dataDir: dir, studio: () => studio, writer: () => writer })
  // shot prompts are written by writeShotPrompt (the H3 writer, with MiniMax's guide); here they're stubbed
  prod.writeShotPrompt = async (id, sceneId, shotId) => prod.setShotPrompt(id, sceneId, shotId, `${PROMPT} (${shotId})`, 'written')
  let p = prod.create({ name: 'Dry Seat', script: 'EXT. BUS STOP - NIGHT\n\nTess waits.\n\nTESS\nLate again.\n' })
  const sc = p.scenes[0]
  const plan = loadSlate(RES).plans.find((x) => x.id === 'dialogue-coverage')
  p = prod.setCoverage(p.id, sc.id, plan)
  assert.equal(p.scenes[0].coverage.label, 'Dialogue Coverage')
  prod.update(p.id, { look: { notes: 'Wet streets.', setups: [{ id: 'kodak-portra-400', label: 'Kodak Portra 400', snippet: 'Portra skin.' }], lookbook: { words: 'Neon spill.' } } })
  assert.equal(lookWords(prod.get(p.id).look), 'Wet streets. Neon spill. Portra skin.')
  prod.breakDown(p.id)
  await prod.running.get(p.id)
  p = prod.get(p.id)
  assert.equal(p.breakdown.state, 'done', p.breakdown.error)
  const shots = p.scenes[0].shots
  assert.equal(shots.length, 6, 'the plan has six slots; the writer gave seven')
  assert.deepEqual(shots.map((s) => s.slot), plan.shots.map((x) => x.slot))
  const asked = seen.find((x) => /breaking one scene/.test(x.sys))
  assert.match(asked.sys, /COVERAGE: cover this scene with the "Dialogue Coverage" plan: exactly 6 shots/)
  assert.match(asked.user, /Look: Wet streets\. Neon spill\. Portra skin\./)
  // a note on a shot: the old prompt goes into its history, and back again
  const sh = shots[1]
  const before = sh.prompt
  const r = await prod.reworkShot(p.id, sc.id, sh.id, { tool: 'note', note: 'colder' })
  assert.match(r.prompt, /shoulders hunched/)
  let now = prod.get(p.id).scenes[0].shots[1]
  assert.equal(now.history[0].prompt, before)
  assert.equal(now.history[0].why, 'note: colder')
  prod.editShot(p.id, sc.id, sh.id, { prompt: 'typed by hand' })
  now = prod.get(p.id).scenes[0].shots[1]
  assert.equal(now.history[0].why, 'edited')
  prod.restoreShotPrompt(p.id, sc.id, sh.id, 1)
  now = prod.get(p.id).scenes[0].shots[1]
  assert.equal(now.prompt, before)
  assert.equal(now.history[0].prompt, 'typed by hand')
  const issues = await prod.checkContinuity(p.id, sc.id)
  assert.equal(issues.length, 1)
  assert.equal(prod.get(p.id).scenes[0].continuity.issues[0].issue, 'Her coat turns red.')
  const md = prod.shotList(p.id, 'md')
  assert.match(md, /Coverage: Dialogue Coverage/)
  assert.match(md, /\| 1\.2 OTS A \|/)
  assert.equal(prod.shotList(p.id, 'csv').trim().split('\r\n').length, 7)
  fs.rmSync(dir, { recursive: true, force: true })
})

server.close()
console.log(`\n${passed} passed`)
