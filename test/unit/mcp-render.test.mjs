// MCP tools for render planning, previews, jobs, ranking and the finish and enhance refusals on an Apple GPU (task
// 5.4), called through the real MCP server on source under the test guard, against the fake ComfyUI (design D1, D8).
// One fake and one server for the file. The finish and enhance cases on an NVIDIA ComfyUI are in
// mcp-render-finish.test.mjs, review and the prompt writers in mcp-render-writers.test.mjs, the picture tools in
// mcp-render-pictures.test.mjs.
//   node --test test/unit/mcp-render.test.mjs
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import ffmpegStatic from 'ffmpeg-ffprobe-static'
import { startFakeComfy } from '../fakes/comfyui.mjs'
import { startMcp } from '../fakes/mcp.mjs'

const PROMPT = 'integrated_multimodal_description: [Shot 1] A woman walks along a rainy street.\n\noverall_soundscape: Rain on stone.\n\nnon_diegetic_music: N/A'
const FIRST_FRAME_LINE = 'For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.'
const TEMP = fs.realpathSync(os.tmpdir())

describe('MCP render planning, preview, job, ranking, finish and enhance tools', () => {
  let fake, mcp, takes, picture
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
  const readData = (...p) => JSON.parse(fs.readFileSync(path.join(mcp.dataDir, ...p), 'utf8'))
  const lastGraph = () => fake.prompts.at(-1).prompt
  const lastExtra = () => fake.prompts.at(-1).extra_data
  const underTemp = (p) => fs.realpathSync(p).startsWith(TEMP + path.sep)
  // what ComfyUI saved for a finished previews job: one video per take
  const gif = (file) => ({ gifs: [{ filename: path.basename(file), subfolder: 'H3/previews', type: 'output', fullpath: file }] })
  const takeOutputs = () => ({ 42: gif(takes[0]), 118: gif(takes[1]), 128: gif(takes[2]) })
  // a previews job that has finished on the fake and been read back, with its three takes
  const finished = async (args = {}) => {
    const job = await ok('generate_previews', { prompt: PROMPT, character: 'none', ...args })
    fake.state.history[job.promptId].outputs = takeOutputs()
    return ok('get_job', { jobId: job.id })
  }
  before(async () => {
    fake = await startFakeComfy({ devices: 'mps', os: 'darwin' })
    mcp = await startMcp({ comfyUrl: fake.url })
    // small fixtures: three takes (one sharp and moving, one frozen, one blurred) and a picture
    const dir = path.join(path.dirname(mcp.dataDir), 'fixtures')
    fs.mkdirSync(dir, { recursive: true })
    takes = [1, 2, 3].map((n) => path.join(dir, `take${n}.mp4`))
    picture = path.join(dir, 'first.png')
    const h264 = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p']
    ff('-f', 'lavfi', '-i', 'testsrc=s=128x96:r=24:d=2', ...h264, takes[0])
    ff('-f', 'lavfi', '-i', 'color=c=red:s=128x96:r=24:d=2', ...h264, takes[1])
    ff('-f', 'lavfi', '-i', 'testsrc=s=128x96:r=24:d=2,boxblur=6', ...h264, takes[2])
    ff('-f', 'lavfi', '-i', 'color=c=blue:s=128x96', '-frames:v', '1', picture)
  })
  after(async () => {
    await mcp?.close()
    await fake?.close()
  })

  // ---------- plan_render ----------
  test('[mcp:plan_render][ipc:render:plan] resolves size, frames, seeds and the finished size and queues nothing', async () => {
    const queued = fake.prompts.length
    const plan = await ok('plan_render', { prompt: PROMPT, character: 'none' })
    assert.deepEqual(plan.resolved, { width: 864, height: 480, frames: 124, seconds: 5.167, fps: 24, previews: 3, model: 'fl2va', seeds: [4242, 5242, 6242] })
    assert.equal(plan.mode, 'text')
    assert.deepEqual(plan.notes, [])
    assert.deepEqual(plan.finish, { width: 1952, height: 1088, enhancer: 'dlss', upscaleSize: { width: 1952, height: 1088 }, fps: 24, frames: 124, seconds: 5.167, singlePass: false })
    const custom = await ok('plan_render', { prompt: PROMPT, character: 'none', seed: 7, previews: 2, aspect: '9:16', seconds: 8 })
    assert.deepEqual(custom.resolved.seeds, [7, 1007])
    assert.equal(custom.resolved.previews, 2)
    assert.ok(custom.resolved.height > custom.resolved.width, 'a 9:16 shot is taller than wide')
    assert.ok(custom.resolved.frames > 124)
    assert.equal(fake.prompts.length, queued, 'planning queues nothing')
  })

  test('[mcp:plan_render] applies a finish override and reports an unknown @mention without failing', async () => {
    const plan = await ok('plan_render', { prompt: PROMPT, character: 'none', finish: { megapixels: 1, upscale2x: true } })
    assert.deepEqual([plan.finish.width, plan.finish.height], [2752, 1536])
    assert.deepEqual(plan.finish.upscaleSize, { width: 1376, height: 768 })
    const mention = await ok('plan_render', { prompt: '@Nobody walks along a street', character: 'none' })
    assert.equal(mention.notes.length, 1)
    assert.equal(mention.notes[0].level, 'error')
    assert.match(mention.notes[0].message, /@nobody isn't in your cast or places/)
  })

  test('[mcp:plan_render] refuses a length, a count or a mode outside what H3 takes', async () => {
    await fails('plan_render', { prompt: PROMPT, seconds: 99 }, /seconds/i)
    await fails('plan_render', { prompt: PROMPT, previews: 4 }, /previews/i)
    await fails('plan_render', { prompt: PROMPT, mode: 'sideways' }, /mode/i)
  })

  // ---------- check_prompt ----------
  test('[mcp:check_prompt] lists what H3 would misread, each with a level and a message', async () => {
    const { findings } = await ok('check_prompt', { prompt: 'a woman walks' })
    const by = Object.fromEntries(findings.map((f) => [f.code, f]))
    assert.equal(by['missing-field'].level, 'error')
    assert.match(by['missing-field'].message, /integrated_multimodal_description: section/)
    assert.equal(by['no-soundscape'].level, 'warning')
    assert.equal(by['char-missing'].level, 'warning')
    assert.match(by['char-missing'].message, /Tess is picked but the prompt never writes \{char\}/)
    assert.equal(by['real-length'].level, 'info')
    const frames = await ok('check_prompt', { prompt: PROMPT, character: 'none', mode: 'frames', media: [{ kind: 'picture', file: picture }] })
    const line = frames.findings.find((f) => f.code === 'frames-line')
    assert.equal(line.level, 'warning')
    assert.equal(line.fix, `${FIRST_FRAME_LINE}\n\n${PROMPT}`, 'the fix is the whole prompt with its opening line added')
  })

  test('[mcp:check_prompt] has no error or warning for a well-formed prompt and nothing at all for an empty one', async () => {
    const { findings } = await ok('check_prompt', { prompt: PROMPT, character: 'none' })
    assert.deepEqual(findings.map((f) => f.level), ['info'])
    assert.deepEqual((await ok('check_prompt', { prompt: '', character: 'none' })).findings, [])
  })

  // ---------- generate_previews ----------
  test('[mcp:generate_previews][ipc:render:previews] queues the preview graph with the seeds, steps and prompt and records a job in a new project', async () => {
    const queued = fake.prompts.length
    const job = await ok('generate_previews', { prompt: PROMPT, character: 'none', seed: 7, previews: 2, steps: 6 })
    assert.equal(fake.prompts.length, queued + 1)
    const g = lastGraph()
    assert.equal(g['81'].inputs.seed, 7)
    assert.equal(g['503'].inputs.value, 6)
    assert.equal(g['87'].inputs.value, PROMPT)
    assert.equal(g['80'].inputs.value, job.name)
    assert.match(job.name, /^a_woman_walks_along_a_rainy_street_[0-9a-f]{8}_r1$/)
    assert.deepEqual(lastExtra().iv_studio, { kind: 'previews', project: job.projectId, sequence: null })
    assert.equal(fake.prompts.at(-1).id, job.promptId)
    assert.equal(job.kind, 'previews')
    assert.equal(job.status, 'queued')
    assert.deepEqual(job.plan.resolved.seeds, [7, 1007])
    // the project and the job are saved in the data folder
    assert.deepEqual(readData('projects', `${job.projectId}.json`).jobs, [job.id])
    assert.equal(readData('jobs', `${job.id}.json`).promptId, job.promptId)
  })

  test('[mcp:generate_previews] stops on a prompt checker error and queues nothing, unless force is passed', async () => {
    const queued = fake.prompts.length
    await fails('generate_previews', { prompt: 'a woman walks', character: 'none' }, /The prompt checker found 1 error: The prompt needs an integrated_multimodal_description: section.*or pass force: true\./)
    assert.equal(fake.prompts.length, queued)
    const job = await ok('generate_previews', { prompt: 'a woman walks', character: 'none', force: true })
    assert.equal(fake.prompts.length, queued + 1)
    assert.equal(lastGraph()['87'].inputs.value, 'a woman walks')
    assert.equal(job.kind, 'previews')
  })

  test('[mcp:generate_previews] refuses an @mention nobody saved and a picture that is not on disk', async () => {
    const queued = fake.prompts.length
    await fails('generate_previews', { prompt: `${PROMPT} @Nobody`, character: 'none' }, /@nobody isn't in your cast or places/)
    await fails('generate_previews', { prompt: `${FIRST_FRAME_LINE}\n\n${PROMPT}`, character: 'none', mode: 'frames', media: [{ kind: 'picture', file: path.join(path.dirname(picture), 'gone.png') }] }, /File not found: .*gone\.png/)
    assert.equal(fake.prompts.length, queued)
  })

  test('[mcp:generate_previews] uploads a first-frame picture into ComfyUI and points the graph at it', async () => {
    const before = fake.uploads.length
    const job = await ok('generate_previews', { prompt: `${FIRST_FRAME_LINE}\n\n${PROMPT}`, character: 'none', mode: 'frames', media: [{ kind: 'picture', file: picture }] })
    assert.deepEqual(fake.uploads.slice(before).map((u) => [u.name, u.subfolder]), [['first.png', 'minimax_h3']])
    const [loader] = Object.values(lastGraph()).filter((n) => n.class_type === 'MiniMaxH3MediaLoader')
    assert.deepEqual(JSON.parse(loader.inputs.media_state).map((m) => [m.kind, m.file, m.name]), [['picture', 'minimax_h3/first.png [input]', 'first.png']])
    assert.equal(job.plan.request.mode, 'frames')
    assert.deepEqual(job.plan.request.media, [{ kind: 'picture', file: 'minimax_h3/first.png' }])
    assert.deepEqual(job.plan.asked.media, [{ kind: 'picture', file: picture }], 'the run keeps the local path it was asked with')
  })

  test('[mcp:generate_previews] adds a second run to an existing project and refuses an unknown one', async () => {
    const first = await ok('generate_previews', { prompt: PROMPT, character: 'none', projectName: 'Rainy street' })
    const second = await ok('generate_previews', { prompt: PROMPT, character: 'none', projectId: first.projectId, seed: 11 })
    assert.equal(second.projectId, first.projectId)
    assert.match(first.name, /^rainy_street_[0-9a-f]{8}_r1$/)
    assert.match(second.name, /^rainy_street_[0-9a-f]{8}_r2$/)
    assert.deepEqual(readData('projects', `${first.projectId}.json`).jobs, [first.id, second.id])
    assert.equal(lastGraph()['81'].inputs.seed, 11)
    await fails('generate_previews', { prompt: PROMPT, character: 'none', projectId: 'nope0000' }, /No project nope0000/)
  })

  // ---------- get_job ----------
  test('[mcp:get_job] shows a waiting job queued, then its takes with their saved paths once ComfyUI finishes', async () => {
    fake.holdNextPrompt(1)
    const job = await ok('generate_previews', { prompt: PROMPT, character: 'none' })
    const waiting = await ok('get_job', { jobId: job.id })
    assert.equal(waiting.status, 'queued')
    assert.equal(waiting.queuePosition, 1)
    assert.deepEqual(waiting.outputs, [])
    fake.releaseHeld()
    fake.state.history[job.promptId].outputs = takeOutputs()
    const done = await ok('get_job', { jobId: job.id })
    assert.equal(done.status, 'success')
    assert.ok(done.finishedAt)
    assert.deepEqual(done.outputs.map((o) => [o.kind, o.candidate, o.seed]), [['preview', 1, 4242], ['preview', 2, 5242], ['preview', 3, 6242]])
    assert.deepEqual(done.outputs.map((o) => o.path), takes)
    assert.ok(done.outputs.every((o) => underTemp(o.path) && o.url.startsWith(fake.url)))
    // finished jobs are read from disk afterwards
    assert.deepEqual((await ok('get_job', { jobId: job.id })).outputs.map((o) => o.path), takes)
  })

  test('[mcp:get_job] reports ComfyUI\'s error text for a failed job and refuses an unknown job', async () => {
    fake.failNextPrompt('CUDA out of memory')
    const job = await ok('generate_previews', { prompt: PROMPT, character: 'none' })
    const failed = await ok('get_job', { jobId: job.id })
    assert.equal(failed.status, 'error')
    assert.match(failed.error, /CUDA out of memory/)
    assert.deepEqual(failed.outputs, [])
    await fails('get_job', { jobId: 'nope' }, /No job nope/)
  })

  // ---------- get_outputs ----------
  test('[mcp:get_outputs][ipc:projects:get] gives a job\'s outputs with the settings that made them, and a project\'s runs', async () => {
    const job = await finished({ seed: 21, projectName: 'Outputs shot' })
    const one = await ok('get_outputs', { jobId: job.id })
    assert.equal(one.job, job.id)
    assert.equal(one.status, 'success')
    assert.equal(one.resolved.seeds[0], 21)
    assert.deepEqual(one.outputs.map((o) => o.path), takes)
    const all = await ok('get_outputs', { projectId: job.projectId })
    assert.deepEqual(all.items.map((j) => [j.job, j.kind, j.status, j.outputs.length]), [[job.id, 'previews', 'success', 3]])
    assert.equal(all.items[0].resolved.seeds[0], 21)
  })

  test('[mcp:get_outputs] needs a job or a project and refuses an unknown one', async () => {
    await fails('get_outputs', {}, /Give jobId or projectId\./)
    await fails('get_outputs', { jobId: 'nope' }, /No job nope/)
    await fails('get_outputs', { projectId: 'nope0000' }, /No project nope0000/)
  })

  // ---------- cancel_job ----------
  test('[mcp:cancel_job][ipc:jobs:cancel] takes a waiting job out of ComfyUI\'s queue and marks it cancelled', async () => {
    fake.holdNextPrompt(1)
    const job = await ok('generate_previews', { prompt: PROMPT, character: 'none' })
    assert.deepEqual(fake.state.pending.map((p) => p[1]), [job.promptId])
    const r = await ok('cancel_job', { jobId: job.id })
    assert.equal(r.result, 'removed from queue')
    assert.equal(r.job.status, 'cancelled')
    assert.deepEqual(fake.state.pending, [])
    assert.equal(readData('jobs', `${job.id}.json`).status, 'cancelled')
    const again = await ok('cancel_job', { jobId: job.id })
    assert.equal(again.result, 'already finished')
    await fails('cancel_job', { jobId: 'nope' }, /No job nope/)
  })

  test('[mcp:cancel_job] interrupts the job that is running and never another', async () => {
    fake.holdNextPrompt(1)
    const job = await ok('generate_previews', { prompt: PROMPT, character: 'none' })
    fake.state.running.push(fake.state.pending.splice(0)[0])
    const r = await ok('cancel_job', { jobId: job.id })
    assert.equal(r.result, 'interrupted')
    const interrupts = fake.requests.filter((q) => q.path === '/interrupt')
    assert.deepEqual(interrupts.at(-1).json, { prompt_id: job.promptId })
    fake.state.running.length = 0
    // a job ComfyUI no longer has is not touched
    const gone = await ok('generate_previews', { prompt: PROMPT, character: 'none' })
    assert.equal((await ok('cancel_job', { jobId: gone.id })).result, 'not queued')
  })

  // ---------- finish_candidate and enhance_final on an Apple GPU ----------
  test('[mcp:finish_candidate][ipc:render:finish] queues a finish from the previews job\'s settings, with DLSS swapped out for a plain save on a Mac ComfyUI', async () => {
    const source = await finished({ seed: 31, projectName: 'Finish shot' })
    const queued = fake.prompts.length
    const job = await ok('finish_candidate', { jobId: source.id, candidate: 2, megapixels: 1 })
    assert.equal(fake.prompts.length, queued + 1)
    assert.equal(job.kind, 'finish')
    assert.equal(job.parent, source.id)
    assert.equal(job.projectId, source.projectId)
    assert.equal(job.name, source.name)
    assert.equal(job.plan.finish.candidate, 2)
    assert.equal(job.plan.finish.megapixels, 1)
    assert.deepEqual(lastExtra().iv_studio, { kind: 'finish', project: source.projectId, sequence: null })
    const g = lastGraph()
    assert.ok(!Object.values(g).some((n) => n.class_type === 'DLSS5_Enhance_Video'), 'Apple GPU: no DLSS node')
    assert.equal(g['50_cl_save'].class_type, 'VHS_VideoCombine')
    assert.equal(g['50'].class_type, 'VHS_SelectFilename')
    assert.equal(g['80'].inputs.value, source.name)
    assert.deepEqual(readData('projects', `${source.projectId}.json`).jobs, [source.id, job.id])
    assert.equal(readData('jobs', `${job.id}.json`).previewPlan.resolved.seeds[0], 31)
  })

  test('[mcp:finish_candidate] says what this ComfyUI cannot do and queues nothing: frame rate, 2x, a non-previews job, an unknown job', async () => {
    const source = await finished()
    const queued = fake.prompts.length
    await fails('finish_candidate', { jobId: source.id, fps: 60 }, /This ComfyUI can make no other fps\./)
    await fails('finish_candidate', { jobId: source.id, upscale2x: true }, /This ComfyUI has no 2x upscaler\./)
    const finish = await ok('finish_candidate', { jobId: source.id })
    await fails('finish_candidate', { jobId: finish.id }, /finish_candidate needs a previews job id\./)
    await fails('finish_candidate', { jobId: 'nope' }, /No job nope/)
    await fails('finish_candidate', { jobId: source.id, candidate: 4 }, /candidate/i)
    assert.equal(fake.prompts.length, queued + 1, 'only the one good finish was queued')
  })

  test('[mcp:finish_candidate] refuses the SeedVR2 enhancer on an Apple GPU in the product\'s words and queues nothing', async () => {
    const source = await finished()
    const queued = fake.prompts.length
    await fails('finish_candidate', { jobId: source.id, enhancer: 'seedvr2' }, /^SeedVR2 isn't available on an Apple GPU yet\. Use the 2× upscale and frame rate options instead\.$/)
    assert.equal(fake.prompts.length, queued)
    assert.deepEqual(await mcp.refusals(), [], 'the product refused it, not the test guard')
  })

  test('[mcp:enhance_final] refuses SeedVR2 on an Apple GPU in the product\'s words and queues nothing', async () => {
    const source = await finished()
    const queued = fake.prompts.length
    await fails('enhance_final', { jobId: source.id }, /^SeedVR2 isn't available on an Apple GPU yet\. Use the 2× upscale and frame rate options instead\.$/)
    await fails('enhance_final', { jobId: source.id, engine: 'seedvr2', resolution: 1440 }, /^SeedVR2 isn't available on an Apple GPU yet\. Use the 2× upscale and frame rate options instead\.$/)
    assert.equal(fake.prompts.length, queued)
    assert.deepEqual(await mcp.refusals(), [], 'the product refused it, not the test guard')
  })

  test('[mcp:enhance_final] says when the render has no finished video on this PC and refuses a resolution H3 does not offer', async () => {
    const source = await finished()
    const queued = fake.prompts.length
    // a previews job has takes, not a final
    await fails('enhance_final', { jobId: source.id, engine: 'dlss' }, /That render has no finished video on this PC to enhance\./)
    await fails('enhance_final', { jobId: 'nope', engine: 'dlss' }, /No job nope/)
    await fails('enhance_final', { jobId: source.id, engine: 'dlss', resolution: 720 }, /resolution/i)
    await fails('enhance_final', { jobId: source.id, engine: 'dlss', scale: 3 }, /scale/i)
    assert.equal(fake.prompts.length, queued)
  })

  // ---------- rank_takes ----------
  test('[mcp:rank_takes][ipc:rank:learn][ipc:rank:job] scores each take on motion and sharpness, marks the best with its reasons and saves it on the job', async () => {
    const job = await finished({ projectName: 'Ranked shot' })
    const { ranking } = await ok('rank_takes', { jobId: job.id })
    assert.deepEqual(ranking.measured, ['motion', 'sharpness'])
    assert.deepEqual(ranking.takes.map((t) => t.candidate), [1, 2, 3])
    const [moving, frozen, blurred] = ranking.takes
    assert.equal(moving.best, true)
    assert.deepEqual(moving.reasons, ['the sharpest'])
    assert.equal(moving.parts.motion, 1)
    assert.equal(frozen.parts.motion, 0)
    assert.match(frozen.reasons[0], /^freezes for [\d.]+ s$/)
    assert.equal(blurred.parts.sharpness, 0)
    assert.deepEqual(blurred.reasons, ['the softest'])
    assert.equal(frozen.best, false)
    // no spoken lines and no voice engine or face models here, so those parts are left out
    assert.ok(ranking.takes.every((t) => t.parts.words === null && t.parts.likeness === null))
    assert.equal((await ok('get_job', { jobId: job.id })).ranking.takes.length, 3)
    assert.deepEqual((await ok('rank_takes', { jobId: job.id })).ranking.at, ranking.at, 'a ranked job is not measured again')
  })

  test('[mcp:rank_takes] records the person\'s pick and moves the weights towards what set it apart', async () => {
    const job = await finished({ projectName: 'Picked shot' })
    const { ranking, weights } = await ok('rank_takes', { jobId: job.id, picked: 2 })
    assert.equal(ranking.takes.length, 3)
    // take 2 froze, so motion was what set it apart: its weight moves down by 6 percent, the others stay
    assert.deepEqual(weights, { words: 4, likeness: 2, motion: 1.41, sharpness: 1 })
    const saved = readData('rank-weights.json')
    assert.deepEqual(saved.weights, weights)
    assert.equal(saved.picks, 1)
    await fails('rank_takes', { jobId: job.id, picked: 4 }, /picked/i)
  })

  test('[mcp:rank_takes] only ranks a finished previews job that has its takes, and refuses an unknown job', async () => {
    fake.holdNextPrompt(1)
    const waiting = await ok('generate_previews', { prompt: PROMPT, character: 'none' })
    await fails('rank_takes', { jobId: waiting.id }, /Only a finished previews job with its takes on this PC can be ranked\./)
    fake.releaseHeld()
    await fails('rank_takes', { jobId: 'nope' }, /No job nope/)
  })

  // ---------- make_previs ----------
  test('make_previs checks the staging plan before it would start a browser, and starts none', async () => {
    const before = (await mcp.refusals()).length
    await fails('make_previs', { stage: { people: [] } }, /camera/i)
    await fails('make_previs', { stage: { people: [], camera: { x: 0, y: -3, facing: 0 } }, seconds: 99 }, /seconds/i)
    assert.equal((await mcp.refusals()).length, before, 'nothing was started and refused')
  })
})
