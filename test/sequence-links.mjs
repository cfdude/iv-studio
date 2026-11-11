// Offline checks for two sequence fixes (no ComfyUI needed):
//  - extra LoRAs for a sequence: saved clean, chained after the character's in the take and retake graphs, and only
//    counted in a shot's freshness once a sequence has some;
//  - shot-by-shot runs made from the project page ("Edit and run again") can be found and linked back to their shot.
//   node test/sequence-links.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkPrompt } from '../src/service/graph.js'
import { cleanSequenceLoras, retakeGraph, SEQUENCE_DEFAULTS, takeGraph, takeShot } from '../src/service/sequence.js'
import { Studio } from '../src/service/studio.js'

let passed = 0
const test = (name, fn) => {
  fn()
  passed++
  console.log(`ok - ${name}`)
}

const template = JSON.parse(fs.readFileSync('resources/workflows/iv_studio_api.json', 'utf8'))
const tess = { id: 'tess', name: 'Tess Marlow', lora: 'MiniMax H3\\tess\\tess.safetensors', strength: 0.8, trigger: 't3ss4' }
const seqBase = { ...SEQUENCE_DEFAULTS, shots: [{ prompt: '{char} waves.' }, { prompt: '{char} sits.' }] }

test('cleanSequenceLoras drops blanks and repeats, clamps strength, keeps at most 4', () => {
  const out = cleanSequenceLoras([{ name: ' a.safetensors ', strength: 3 }, { name: 'a.safetensors', strength: 1 }, { name: '' }, { name: 'b', strength: 'x' }, { name: 'c', strength: -5 }, { name: 'd', strength: 0 }, { name: 'e', strength: 1 }])
  assert.deepEqual(out, [
    { name: 'a.safetensors', strength: 2 },
    { name: 'b', strength: 0.8 },
    { name: 'c', strength: -2 },
    { name: 'd', strength: 0 }
  ])
  assert.deepEqual(cleanSequenceLoras(undefined), [])
})

test('take graph without LoRAs is unchanged: sampler on the character LoRA', () => {
  const { graph } = takeGraph({ template, seq: seqBase, character: tess, name: 't' })
  assert.deepEqual(graph.take.inputs.model, ['char', 0])
  assert.ok(!Object.keys(graph).some((k) => /^lora\d/.test(k)))
  assert.deepEqual(checkPrompt(graph), [])
})

test('take graph chains extra LoRAs after the character, in order', () => {
  const seq = { ...seqBase, loras: [{ name: 'style.safetensors', strength: 0.6 }, { name: 'move.safetensors', strength: 1 }] }
  const { graph } = takeGraph({ template, seq, character: tess, name: 't' })
  assert.deepEqual(graph.lora1.inputs, { model: ['char', 0], lora_name: 'style.safetensors', strength_model: 0.6 })
  assert.deepEqual(graph.lora2.inputs, { model: ['lora1', 0], lora_name: 'move.safetensors', strength_model: 1 })
  assert.deepEqual(graph.take.inputs.model, ['lora2', 0])
  assert.deepEqual(checkPrompt(graph), [])
})

test('take graph with no character chains LoRAs from the turbo LoRA', () => {
  const { graph } = takeGraph({ template, seq: { ...seqBase, loras: [{ name: 'x', strength: 1 }] }, character: null, name: 't' })
  assert.deepEqual(graph.lora1.inputs.model, ['turbo', 0])
  assert.deepEqual(graph.take.inputs.model, ['lora1', 0])
})

test('retake graph uses the sequence LoRAs for its sampler and scheduler', () => {
  const { graph } = retakeGraph({ template, seq: { ...seqBase, loras: [{ name: 'x', strength: 1 }] }, character: tess, name: 't', sourcePath: 'C:/v.mp4', prompt: 'p', start: 1, end: 2, mode: 'both', seed: 1 })
  assert.deepEqual(graph.retake.inputs.model, ['lora1', 0])
  assert.deepEqual(graph.sigmas.inputs.model, ['lora1', 0])
})

// ---------- a studio on a scratch data folder ----------
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ivs-seqlinks-'))
const studio = new Studio({ dataDir, resourcesDir: path.resolve('resources'), comfyUrl: 'http://127.0.0.1:1' })
const writeJob = (j) => {
  fs.mkdirSync(path.join(dataDir, 'jobs'), { recursive: true })
  fs.writeFileSync(studio.jobFile(j.id), JSON.stringify({ status: 'success', outputs: [], createdAt: new Date().toISOString(), ...j }))
}
const req = (patch = {}) => ({ mode: 'text', character: 'none', aspect: '16:9', seconds: 10, steps: 8, megapixels: 0.4, extraLoras: [], media: [], ...patch })

const s0 = studio.createSequence({ name: 'Kitchen', method: 'shots', character: 'none', shots: [{ id: 'sh1', prompt: 'first', mode: 'text', media: [] }, { id: 'sh2', prompt: 'second', mode: 'text', media: [] }] })
const project = studio.createProject('Kitchen (sequence)', s0.id)
const other = studio.createProject('Elsewhere')
const raw1 = path.join(dataDir, 'raw1.mp4')
writeJob({ id: 'A', kind: 'previews', projectId: project.id, plan: { request: req() } })
writeJob({ id: 'F1', kind: 'finish', parent: 'A', projectId: project.id, outputs: [{ kind: 'before_dlss', path: raw1 }] })
writeJob({ id: 'B', kind: 'previews', projectId: project.id, plan: { request: req({ mode: 'continue', megapixels: 0.9, media: [{ kind: 'video', file: raw1 }] }), asked: { prompt: 'second, edited', mode: 'continue', media: [{ kind: 'video', file: raw1 }] } } })
writeJob({ id: 'F2', kind: 'finish', parent: 'B', projectId: project.id, outputs: [{ kind: 'continued_before_dlss', path: path.join(dataDir, 'raw2.mp4') }] })
writeJob({ id: 'C', kind: 'previews', projectId: project.id, plan: { request: req({ aspect: '9:16' }) } })
writeJob({ id: 'D', kind: 'previews', projectId: project.id, status: 'running', plan: { request: req() } })
writeJob({ id: 'X', kind: 'previews', projectId: other.id, plan: { request: req() } })
const p = studio.getProject(project.id)
p.jobs = ['A', 'F1', 'B', 'F2', 'C', 'D']
fs.writeFileSync(studio.projectFile(p.id), JSON.stringify(p))
const s = studio.getSequence(s0.id)
s.projectId = project.id
s.shotJobs.sh1 = { previews: 'A', finish: 'F1', key: studio.shotKey(s, 0, null) }
studio.writeSequence(s)

test('a sequence with no LoRAs keeps its old freshness key', () => {
  const sq = studio.getSequence(s0.id)
  const legacy = JSON.stringify([sq.shots[0].prompt, sq.shots[0].mode, sq.shots[0].media, sq.character, sq.aspect, sq.megapixels, sq.shotSeconds, sq.steps, null])
  assert.equal(studio.shotKey(sq, 0, null), legacy)
  assert.equal(studio.sequenceView(s0.id).shots[0].fresh, true)
})

test('saveSequence keeps LoRAs clean, and adding one makes shots stale', () => {
  studio.saveSequence(s0.id, { loras: [{ name: 'look.safetensors', strength: 0.7 }, { name: 'look.safetensors' }, { name: '' }] })
  assert.deepEqual(studio.getSequence(s0.id).loras, [{ name: 'look.safetensors', strength: 0.7 }])
  assert.equal(studio.sequenceView(s0.id).shots[0].stale, true)
  studio.saveSequence(s0.id, { loras: [] })
  assert.equal(studio.sequenceView(s0.id).shots[0].fresh, true)
})

test('sequenceRunsOf: linked runs, linkable orphans and ones that no longer fit', () => {
  const info = studio.sequenceRunsOf(project.id)
  assert.equal(info.sequenceId, s0.id)
  assert.equal(info.sequenceName, 'Kitchen')
  assert.deepEqual(info.runs.A, { index: 0, linked: true })
  assert.deepEqual(info.runs.B, { index: 1, linked: false })
  assert.equal(info.runs.C.index, 0)
  assert.match(info.runs.C.problem, /frame shape/)
  assert.match(info.runs.D.problem, /not finished/)
  assert.ok(!('F1' in info.runs), 'finishes are not runs')
  assert.equal(studio.sequenceRunsOf(other.id), null)
})

test('linkShotRun refuses runs that do not fit or are not the sequence own', () => {
  assert.throws(() => studio.linkShotRun(s0.id, { jobId: 'C', index: 0 }), /frame shape/)
  assert.throws(() => studio.linkShotRun(s0.id, { jobId: 'B', index: 0 }), /first shot starts fresh/)
  assert.throws(() => studio.linkShotRun(s0.id, { jobId: 'X', index: 0 }), /isn't one of this sequence's/)
  assert.throws(() => studio.linkShotRun(s0.id, { jobId: 'A', index: 5 }), /No shot 6/)
})

test('linkShotRun makes an orphaned run the shot, with its prompt and its finish', () => {
  const view = studio.linkShotRun(s0.id, { jobId: 'B', index: 1 })
  const sq = studio.getSequence(s0.id)
  assert.equal(sq.shots[1].prompt, 'second, edited')
  assert.deepEqual(sq.shotJobs.sh2.previews, 'B')
  assert.equal(sq.shotJobs.sh2.finish, 'F2')
  assert.equal(view.shots[1].fresh, true)
  assert.deepEqual(studio.sequenceRunsOf(project.id).runs.B, { index: 1, linked: true })
})

test('changing an earlier shot still makes later shots stale', () => {
  const sq = studio.getSequence(s0.id)
  studio.saveSequence(s0.id, { shots: sq.shots.map((sh, i) => (i === 0 ? { ...sh, prompt: 'first, changed' } : sh)) })
  const v = studio.sequenceView(s0.id)
  assert.equal(v.shots[0].stale, true)
  assert.equal(v.shots[1].fresh, false)
})

// GitHub #14: with a voice attached, H3 Multishot writes the ref2va sections itself, so a shot goes as plain text
const written = 'integrated_multimodal_description: [Shot 1] Live-action. {char} sits and says <d>[English] Late again.</d>\n\noverall_soundscape: Rain on the roof.\n\nnon_diegetic_music: N/A'
test('a take with a voice sends each shot without section names, its sound folded in', () => {
  assert.equal(takeShot(written, { wrapped: true }), '[Shot 1] Live-action. {char} sits and says <d>[English] Late again.</d>\n\nThe sound: Rain on the roof.')
  assert.equal(takeShot('Just a paragraph.', { wrapped: true }), 'Just a paragraph.')
  const { graph } = takeGraph({ template, seq: { ...seqBase, shots: [{ prompt: written }, { prompt: written }] }, character: tess, name: 't', voiceRef: 'iv_studio/v.wav' })
  assert.ok(!/integrated_multimodal_description|overall_soundscape|non_diegetic_music/.test(graph.take.inputs.script))
  assert.ok(graph.take.inputs.script.includes('t3ss4 sits'))
})
test('a take with no reference sends each shot as written', () => {
  const { graph } = takeGraph({ template, seq: { ...seqBase, shots: [{ prompt: written }] }, character: tess, name: 't' })
  assert.ok(graph.take.inputs.script.startsWith('integrated_multimodal_description: [Shot 1]'))
})

fs.rmSync(dataDir, { recursive: true, force: true })
console.log(`\n${passed} passed`)
