// MCP overnight batch tools (upstream v1.1.3): start_batch queues several H3 shots on the local ComfyUI in one project,
// get_batch says where they stand, make_dailies makes the reel and notes again. Called through the real MCP server on
// source under the test guard, against the fake ComfyUI on an Apple GPU; the reel is the bundled ffmpeg.
//   node --test test/unit/mcp-batch-v113.test.mjs
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import ffmpegStatic from 'ffmpeg-ffprobe-static'
import { startFakeComfy } from '../fakes/comfyui.mjs'
import { startMcp } from '../fakes/mcp.mjs'

const PROMPT = 'integrated_multimodal_description: [Shot 1] A fox trots across a frosty field at dawn.\n\noverall_soundscape: Frost crunching.\n\nnon_diegetic_music: N/A'
const PROMPT_B = PROMPT.replace('trots across a frosty field', 'sits on a stone wall')

describe('MCP overnight batch tools', () => {
  let fake, mcp, takes
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
  const gif = (file) => ({ gifs: [{ filename: path.basename(file), subfolder: 'H3/previews', type: 'output', fullpath: file }] })
  const takeOutputs = () => ({ 42: gif(takes[0]), 118: gif(takes[1]), 128: gif(takes[2]) })
  // the jobs a batch queued, in order
  const jobsOf = (batchId) => readData('batches', `${batchId}.json`).jobs
  // ComfyUI finishes a batch's job j (0-based), and the app reads it back
  const finish = async (batchId, j) => {
    const { jobId } = jobsOf(batchId)[j]
    fake.state.history[readData('jobs', `${jobId}.json`).promptId].outputs = takeOutputs()
    return ok('get_job', { jobId })
  }

  before(async () => {
    fake = await startFakeComfy({ devices: 'mps', os: 'darwin' })
    mcp = await startMcp({ comfyUrl: fake.url })
    const dir = path.join(path.dirname(mcp.dataDir), 'fixtures')
    fs.mkdirSync(dir, { recursive: true })
    takes = [1, 2, 3].map((n) => path.join(dir, `take${n}.mp4`))
    const h264 = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p']
    ff('-f', 'lavfi', '-i', 'testsrc=s=128x96:r=24:d=1', '-f', 'lavfi', '-i', 'sine=f=330:d=1', ...h264, '-c:a', 'aac', '-shortest', takes[0])
    ff('-f', 'lavfi', '-i', 'color=c=red:s=128x96:r=24:d=1', ...h264, takes[1])
    ff('-f', 'lavfi', '-i', 'testsrc=s=128x96:r=24:d=1,boxblur=6', ...h264, takes[2])
  })
  after(async () => {
    await mcp?.close()
    await fake?.close()
  })

  // ---------- start_batch ----------
  test('[mcp:start_batch] queues each variation as its own job in one project, with the takes, aspect, seconds and label, and writes the batch record', async () => {
    const before = fake.prompts.length
    const r = await ok('start_batch', { name: 'Fox at dawn: 2 variations', shots: [{ prompt: PROMPT, label: 'Frosty field' }, { prompt: PROMPT_B, label: 'Stone wall', seconds: 8, aspect: '9:16' }], takes: 2, seconds: 6 })
    assert.match(r.batch, /^b[a-z0-9]+$/)
    assert.deepEqual([r.queued, r.takes], [2, 2])
    assert.match(r.note, /^Queued\. IV Studio keeps the computer awake/)
    assert.equal(fake.prompts.length - before, 2, 'one ComfyUI prompt per shot')
    const rec = readData('batches', `${r.batch}.json`)
    assert.deepEqual([rec.name, rec.status, rec.takes, rec.projectId, rec.reportedAt], ['Fox at dawn: 2 variations', 'running', 2, r.project, null])
    assert.deepEqual(rec.jobs.map((j) => [j.label, j.prompt]), [['Frosty field', PROMPT], ['Stone wall', PROMPT_B]])
    const [a, b] = await Promise.all(rec.jobs.map((j) => ok('get_job', { jobId: j.jobId })))
    assert.equal(a.projectId, r.project)
    assert.equal(b.projectId, r.project, 'both shots are in the one project')
    assert.deepEqual([a.plan.request.previews, b.plan.request.previews], [2, 2])
    assert.deepEqual([a.plan.request.seconds, b.plan.request.seconds], [6, 8], 'a shot\'s own seconds beat the batch\'s')
    assert.deepEqual([a.plan.request.aspect, b.plan.request.aspect], ['16:9', '9:16'])
    assert.equal(a.plan.request.engine, 'h3')
  })

  test('[mcp:start_batch] queues nothing when the prompt checker finds an error in any shot, and names which', async () => {
    const before = fake.prompts.length
    const batches = fs.existsSync(path.join(mcp.dataDir, 'batches')) ? fs.readdirSync(path.join(mcp.dataDir, 'batches')).length : 0
    const r = await call('start_batch', { name: 'Half bad', shots: [{ prompt: PROMPT }, { prompt: 'a fox walks' }] })
    assert.equal(r.isError, true)
    assert.match(r.content[0].text, /^Nothing was queued\. The prompt checker found: shot 2: .*integrated_multimodal_description: section/)
    assert.doesNotMatch(r.content[0].text, /shot 1:/)
    assert.equal(fake.prompts.length, before, 'not even the good shot went to ComfyUI')
    assert.equal(fs.existsSync(path.join(mcp.dataDir, 'batches')) ? fs.readdirSync(path.join(mcp.dataDir, 'batches')).length : 0, batches, 'no batch record')
  })

  test('[mcp:start_batch] refuses no shots, more than 12 shots, takes outside 1 to 3, an aspect that is not offered and an empty name, and queues nothing', async () => {
    const before = fake.prompts.length
    await fails('start_batch', { name: 'x', shots: [] }, /shots/i)
    await fails('start_batch', { name: 'x', shots: Array.from({ length: 13 }, () => ({ prompt: PROMPT })) }, /shots/i)
    await fails('start_batch', { name: 'x', shots: [{ prompt: PROMPT }], takes: 4 }, /takes/i)
    await fails('start_batch', { name: 'x', shots: [{ prompt: PROMPT }], aspect: '2:1' }, /aspect/i)
    await fails('start_batch', { name: '', shots: [{ prompt: PROMPT }] }, /name/i)
    assert.equal(fake.prompts.length, before)
  })

  // ---------- get_batch ----------
  test('[mcp:get_batch] shows each shot\'s status and where the batch stands as ComfyUI finishes them, and gives no report until the app has made one', async () => {
    fake.failNextPrompt('CUDA out of memory')
    const b = await ok('start_batch', { name: 'Progress', shots: [{ prompt: PROMPT, label: 'One' }, { prompt: PROMPT_B }] })
    const waiting = await ok('get_batch', { batchId: b.batch })
    assert.equal(waiting.name, 'Progress')
    assert.equal(waiting.status, 'running')
    assert.deepEqual(waiting.shots.map((s) => [s.shot, s.label, s.status]), [[1, 'One', 'queued'], [2, null, 'queued']])
    assert.deepEqual(waiting.state, { done: false, finished: 0, failed: 0, waiting: 2, ranked: 0, total: 2 })
    assert.equal(waiting.report, undefined)
    await finish(b.batch, 1)
    assert.equal((await ok('get_batch', { batchId: b.batch })).state.ranked, 0, 'finished but not ranked yet')
    await ok('rank_takes', { jobId: jobsOf(b.batch)[1].jobId })
    const half = await ok('get_batch', { batchId: b.batch })
    assert.deepEqual(half.shots.map((s) => s.status), ['queued', 'success'])
    assert.deepEqual([half.state.finished, half.state.waiting, half.state.ranked, half.state.done], [1, 1, 1, false])
    const failed = await ok('get_job', { jobId: jobsOf(b.batch)[0].jobId })
    assert.match(failed.error, /CUDA out of memory/)
    const after = await ok('get_batch', { batchId: b.batch })
    assert.deepEqual(after.shots.map((s) => s.status), ['error', 'success'])
    assert.deepEqual([after.state.done, after.state.failed, after.state.finished], [true, 1, 1])
    assert.equal(after.status, 'running', 'the app, not this call, marks it reported')
    assert.equal(after.report, undefined)
  })

  test('[mcp:get_batch] once the batch is reported it carries the report: the best takes first', async () => {
    const b = await ok('start_batch', { name: 'Reported', shots: [{ prompt: PROMPT, label: 'Frosty field' }, { prompt: PROMPT_B, label: 'Stone wall' }], takes: 3 })
    await finish(b.batch, 0)
    const file = path.join(mcp.dataDir, 'batches', `${b.batch}.json`)
    fs.writeFileSync(file, JSON.stringify({ ...readData('batches', `${b.batch}.json`), status: 'reported', reportedAt: '2026-11-10T08:00:00.000Z' }))
    const r = await ok('get_batch', { batchId: b.batch })
    assert.equal(r.status, 'reported')
    assert.equal(r.report.title, 'Reported')
    assert.match(r.report.text, /^Your overnight batch “Reported” is done: 1 of 2 shots rendered \(3 takes\)\. The best: 1\) shot 1, take \d/)
    assert.ok(r.report.picks.length === 1 && /^Shot 1, take \d: Frosty field$/.test(r.report.picks[0].label))
    assert.equal(r.report.picks[0].projectId, b.project)
    assert.deepEqual([r.report.state.finished, r.report.state.waiting], [1, 1])
    assert.doesNotMatch(r.report.text, /Didn’t render/, 'a shot still waiting is not a failure')
  })

  test('[mcp:get_batch] names a batch that is not there, and one whose id could not be a batch id', async () => {
    await fails('get_batch', { batchId: 'bnosuchbatch' }, /No such batch\./)
    await fails('get_batch', { batchId: '../settings' }, /No such batch\./)
  })

  // ---------- make_dailies ----------
  test('[mcp:make_dailies] makes the reel and notes.md for a batch in the Videos folder\'s Dailies, best take of each shot first, and says what did not render', async () => {
    const b = await ok('start_batch', { name: 'Dailies: fox', shots: [{ prompt: PROMPT, label: 'Frosty field' }, { prompt: PROMPT_B, label: 'Stone wall' }], takes: 3 })
    await finish(b.batch, 0)
    const r = await ok('make_dailies', { batchId: b.batch })
    assert.equal(r.takes, 3, 'every take of the shot that rendered')
        assert.equal(path.dirname(r.folder), path.join(mcp.dataDir, 'videos', 'Dailies'), 'in the Videos folder from Settings')
    assert.match(path.basename(r.folder), new RegExp(`^Dailies fox \\d{4}-\\d{2}-\\d{2} ${b.batch.slice(-4)}$`))
    assert.equal(path.basename(r.reel), 'dailies.mp4')
    assert.ok(fs.statSync(r.reel).size > 1000)
    assert.equal(path.basename(r.notes), 'notes.md')
    assert.ok(!fs.existsSync(path.join(r.folder, '.work')), 'the working files are gone')
    const notes = fs.readFileSync(r.notes, 'utf8')
    assert.match(notes, /^# Dailies: Dailies: fox\n/)
    assert.match(notes, /1 of 2 shots rendered, 3 takes\. The reel: dailies\.mp4\./)
    assert.match(notes, /## Look at these first\n\n- Shot 1, take \d.*: Frosty field/)
    assert.match(notes, /### Shot 1: Frosty field\n\n- Take \d/)
    assert.match(notes, /## Didn’t render\n\n- Shot 2: Stone wall/)
    // the reel is a card then the take for each of the three takes, with sound throughout
    const probe = JSON.parse(execFileSync(ffmpegStatic.ffprobePath, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', r.reel]).toString())
    assert.deepEqual(probe.streams.map((s) => s.codec_type).sort(), ['audio', 'video'])
    assert.ok(Number(probe.format.duration) > 3 * 1.6, `a title card and a take, three times: ${probe.format.duration}`)
  })

  test('[mcp:make_dailies] a batch with nothing rendered gets notes and no reel, and a batch that is not there is refused', async () => {
    const b = await ok('start_batch', { name: 'Nothing yet', shots: [{ prompt: PROMPT }] })
    const r = await ok('make_dailies', { batchId: b.batch })
    assert.deepEqual([r.reel, r.takes], [null, 0])
    assert.match(fs.readFileSync(r.notes, 'utf8'), /## Look at these first\n\nNothing rendered\./)
    assert.ok(!fs.existsSync(path.join(r.folder, 'dailies.mp4')))
    await fails('make_dailies', { batchId: 'bnosuchbatch' }, /No such batch\./)
  })
})
