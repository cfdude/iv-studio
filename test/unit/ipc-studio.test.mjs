// Window channels for the Studio, sequences, places and the render queue whose service method no MCP tool reaches
// (task 6.2). Each test calls the service method the channel's one-line handler calls (src/main/index.js;
// test/unit/ipc-map.mjs), in this process, on the fake ComfyUI. The channels that share a method with an MCP tool
// carry their id in that tool's test name instead.
//   node --test test/unit/ipc-studio.test.mjs
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import ffmpegStatic from 'ffmpeg-ffprobe-static'
import { Shinobi } from '../../src/service/shinobi.js'
import { Studio } from '../../src/service/studio.js'
import { startFakeComfy } from '../fakes/comfyui.mjs'
import { guardState } from '../fakes/ports.mjs'

const combo = (name, options) => ({ input: { required: { [name]: [options] } } })
const PROMPT = 'integrated_multimodal_description: [Shot 1] A woman walks into a rainy bus stop.\n\noverall_soundscape: Rain.\n\nnon_diegetic_music: N/A'

describe('window channels: Studio', () => {
  let fake, dir, studio
  const readJob = (id) => JSON.parse(fs.readFileSync(path.join(dir, 'jobs', `${id}.json`), 'utf8'))
  const writeJob = (job) => fs.writeFileSync(path.join(dir, 'jobs', `${job.id}.json`), JSON.stringify(job))
  const sequence = () => studio.createSequence({ name: 'Bus stop', character: 'none', method: 'shots', seed: 100, shots: [{ prompt: PROMPT }, { prompt: 'She opens an umbrella.' }] })
  before(async () => {
    fake = await startFakeComfy({ devices: 'mps', os: 'darwin', models: { loras: [] }, objectInfo: { LoraLoaderModelOnly: combo('lora_name', ['MiniMax H3\\tess\\tess_mmh3-000040.safetensors', 'style\\grain.safetensors']) } })
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'iv-ipc-')))
    studio = new Studio({ dataDir: dir, resourcesDir: path.resolve('resources'), comfyUrl: fake.url })
  })
  after(() => fake.close())

  test('[ipc:characters:loras] lists the LoRA names ComfyUI can load, and none when the node is not there', async () => {
    assert.deepEqual(await studio.loraNames(), ['MiniMax H3\\tess\\tess_mmh3-000040.safetensors', 'style\\grain.safetensors'])
    fake.setObjectInfo({})
    assert.deepEqual(await studio.loraNames(), [])
    fake.setObjectInfo({ LoraLoaderModelOnly: combo('lora_name', ['a.safetensors']) })
    assert.deepEqual(await studio.loraNames(), ['a.safetensors'])
  })

  test('[ipc:render:planFinish] says what a finish of a previews job would make without queuing anything, and refuses a candidate that is not there or a job that is not previews', async () => {
    const s = sequence()
    const job = await studio.huntShot(s.id, 0, {})
    const queued = fake.prompts.length
    const plain = studio.planFinishJob(job.id, {})
    assert.deepEqual([plain.enhancer, plain.fps, plain.singlePass], ['dlss', 24, false])
    const plan = studio.planFinishJob(job.id, { candidate: 2, megapixels: 1, upscale2x: true, fps: 48 })
    assert.equal(plan.fps, 48)
    assert.equal(plan.frames, plain.frames * 2, 'twice the frames at 48 fps')
    assert.ok(Math.abs(plan.upscaleSize.width * plan.upscaleSize.height - 1e6) < 1.5e5, 'about 1 MP before the 2x')
    assert.equal(plan.width, Math.round(plan.upscaleSize.width * 2 / 2) * 2, 'and twice that wide once upscaled')
    assert.ok(plan.upscaleSize.width * plan.upscaleSize.height < plain.upscaleSize.width * plain.upscaleSize.height, 'smaller than the 2 MP default')
    assert.equal(fake.prompts.length, queued, 'nothing queued')
    assert.throws(() => studio.planFinishJob(job.id, { candidate: 4 }), /candidate must be 1\.\.3\./)
    assert.throws(() => studio.planFinishJob('nope', {}), /No job nope/)
    const finish = { ...readJob(job.id), id: 'fin00001', kind: 'finish' }
    writeJob(finish)
    assert.throws(() => studio.planFinishJob('fin00001', {}), /Needs a previews job id\./)
  })

  test('[ipc:queue:list] shows nothing when ComfyUI is idle, then the render that is running with the job and kind it belongs to', async () => {
    fake.releaseHeld?.()
    assert.deepEqual((await studio.renderQueue()).items.filter((i) => i.ours), [], 'only IV Studio\'s own renders are ours')
    const s = sequence()
    fake.holdNextPrompt(1)
    const job = await studio.huntShot(s.id, 0, {})
    const { items } = await studio.renderQueue()
    const mine = items.find((i) => i.promptId === job.promptId)
    assert.ok(mine, 'the held render is in the queue')
    assert.equal(mine.ours, true)
    assert.equal(mine.jobId, job.id)
    assert.equal(mine.kind, 'previews')
    assert.ok(['running', 'queued'].includes(mine.state))
    assert.equal(mine.position, items.indexOf(mine) + 1)
    fake.releaseHeld()
  })

  test('[ipc:sequences:runsOf] says which shot each preview run of a sequence\'s project belongs to, why an unlinked one does not fit, and nothing for a plain project', async () => {
    const s = sequence()
    const job = await studio.huntShot(s.id, 0, { seed: 5 })
    const projectId = studio.getSequence(s.id).projectId
    const linked = studio.sequenceRunsOf(projectId)
    assert.deepEqual([linked.sequenceId, linked.sequenceName, linked.method], [s.id, 'Bus stop', 'shots'])
    assert.deepEqual(linked.runs, { [job.id]: { index: 0, linked: true } })
    // the shot lets go of the run: it is a run the person made from the project's page
    const seq = studio.getSequence(s.id)
    seq.shotJobs = {}
    studio.writeSequence(seq)
    const loose = studio.sequenceRunsOf(projectId).runs[job.id]
    assert.deepEqual([loose.index, loose.linked, loose.problem], [0, false, 'It has not finished rendering.'])
    writeJob({ ...readJob(job.id), status: 'success' })
    assert.deepEqual(studio.sequenceRunsOf(projectId).runs[job.id], { index: 0, linked: false }, 'a finished run with the sequence\'s own settings fits')
    writeJob({ ...readJob(job.id), plan: { ...readJob(job.id).plan, request: { ...readJob(job.id).plan.request, steps: 4 } } })
    assert.match(studio.sequenceRunsOf(projectId).runs[job.id].problem, /Its steps differs from the sequence's\./)
    assert.equal(studio.sequenceRunsOf(studio.createProject('Plain').id), null)
  })

  test('[ipc:sequences:linkRun] makes a finished run the shot it was made for, and refuses a run that is unfinished, from another project, or a shot that is not there', async () => {
    const s = sequence()
    const job = await studio.huntShot(s.id, 0, { seed: 7 })
    const seq = studio.getSequence(s.id)
    const shotId = seq.shots[0].id
    seq.shotJobs = {}
    studio.writeSequence(seq)
    assert.throws(() => studio.linkShotRun(s.id, { jobId: job.id, index: 0 }), /That run can't be shot 1\. It has not finished rendering\./)
    writeJob({ ...readJob(job.id), status: 'success' })
    const view = studio.linkShotRun(s.id, { jobId: job.id, index: 0 })
    assert.equal(studio.getSequence(s.id).shotJobs[shotId].previews, job.id, 'saved on the shot')
    assert.equal(studio.getSequence(s.id).shots[0].prompt, PROMPT, 'the shot takes the run\'s prompt')
    assert.ok(view.shots.length === 2, 'the sequence as the window shows it')
    assert.throws(() => studio.linkShotRun(s.id, { jobId: job.id, index: 5 }), /No shot 6\./)
    assert.throws(() => studio.linkShotRun(s.id, { jobId: job.id, index: 1 }), /doesn't continue from shot 1's current video/)
    const other = sequence()
    const otherJob = await studio.huntShot(other.id, 0, {})
    assert.throws(() => studio.linkShotRun(s.id, { jobId: otherJob.id, index: 0 }), /isn't one of this sequence's/)
  })

  test('[ipc:cast:places][ipc:cast:deletePlace] lists the places the person saved, and removes one and leaves the rest', () => {
    const picture = path.join(dir, 'place.png')
    execFileSync(ffmpegStatic.ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:d=1', '-frames:v', '1', picture])
    assert.deepEqual(studio.cast.places(), [])
    const a = studio.cast.savePlace({ name: 'Bus Stop', description: 'wet', picture })
    const b = studio.cast.savePlace({ name: 'Harbor', picture })
    assert.deepEqual(studio.cast.places().map((p) => p.name), ['Bus Stop', 'Harbor'])
    assert.equal(studio.cast.deletePlace(a.id), undefined)
    assert.deepEqual(studio.cast.places().map((p) => p.id), [b.id])
    studio.cast.deletePlace('nope')
    assert.deepEqual(studio.cast.places().map((p) => p.id), [b.id], 'an id that is not there changes nothing')
    assert.ok(!studio.cast.members().some((m) => m.name === 'Bus Stop'), 'it is no longer something a prompt can mention')
  })
  // The window's Manager install and Shinobi face models spawn git, or uv after a download; the guard turns each back.
  // No row id: their rows carry a gaps reason (spawns ...), and this proves the refusal.
  test('guard refuses git and the download for the Manager install, and the face models stop at uv before any download', async () => {
    const refused = () => guardState().refusals.map((r) => r.command)
    const before = refused().length
    const r = await studio.installManager({ folder: dir })
    assert.equal(r.restart, false, 'nothing installed, so no restart')
    assert.equal(r.results.length, 1)
    assert.equal(r.results[0].status, 'failed')
    assert.match(r.results[0].detail, /refused a fetch/)
    assert.ok(refused().slice(before).includes('git'), `a git refusal in ${refused().slice(before)}`)
    const shinobi = new Shinobi({ dataDir: dir, resourcesDir: path.resolve('resources'), ffmpegDir: path.dirname(ffmpegStatic.ffmpegPath) })
    await assert.rejects(() => shinobi.installFaceModels(() => {}))
    assert.equal(shinobi.faceModelsReady(), false, 'no face models, and no engine either')
    assert.ok(!fs.existsSync(path.join(shinobi.faceDir, 'buffalo_l.zip.part')), 'no download started')
  })
})
