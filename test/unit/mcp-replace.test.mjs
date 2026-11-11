// MCP Replace tools (task 5.7, part 3): what a Replace mode still needs, queueing a run, and the past runs. Called
// through the real MCP server on source under the test guard, against the fake ComfyUI (design D1, D8). The fake is first
// a ComfyUI with none of OpenJutsu's node packs, then (a second fake and server) one that has every node the seven
// workflows use, the SAM 3.1 checkpoint and the Qwen3-VL describer, so a run can be queued.
//   node --test test/unit/mcp-replace.test.mjs
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { after, afterEach, before, describe, test } from 'node:test'
import ffmpegStatic from 'ffmpeg-ffprobe-static'
import { startFakeComfy } from '../fakes/comfyui.mjs'
import { startMcp } from '../fakes/mcp.mjs'

const WORKFLOWS = ['simple', 'advanced', 'advanced_maxq', 'object', 'mask', 'face', 'color']
const readWorkflow = (name) => JSON.parse(fs.readFileSync(new URL(`../../resources/workflows/replace/${name}.api.json`, import.meta.url), 'utf8'))
// every node class the seven workflows use, plus the SAM 3.1 checkpoint and the describer
function everything() {
  const info = {}
  for (const w of WORKFLOWS) for (const n of Object.values(readWorkflow(w))) info[n.class_type] ||= { input: { required: {} } }
  info.CheckpointLoaderSimple = { input: { required: { ckpt_name: [['sam3.1_multiplex_fp16.safetensors']] } } }
  info.CLIPLoader = { input: { required: { clip_name: [['qwen3vl_8b_int8_convrot.safetensors']] } } }
  return info
}

describe('MCP Replace tools', () => {
  let bare, full, mcpBare, mcp, dir, video, silent, face, shot, out
  const callOn = (m) => (name, args = {}) => m.client.callTool({ name, arguments: args })
  const call = (name, args = {}) => callOn(mcp)(name, args)
  const okOn = (m) => async (name, args = {}) => {
    const r = await callOn(m)(name, args)
    assert.ok(!r.isError, `${name}: ${JSON.stringify(r.content)}`)
    return r.structuredContent
  }
  const ok = (name, args) => okOn(mcp)(name, args)
  const fails = async (name, args, pattern, m = mcp) => {
    const r = await callOn(m)(name, args)
    assert.equal(r.isError, true, `${name} should have failed`)
    assert.match(r.content[0].text, pattern)
  }
  const ff = (...args) => execFileSync(ffmpegStatic.ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args])
  const lastGraph = () => fake().prompts.at(-1).prompt
  const fake = () => full
  const uploads = () => full.uploads.map((u) => u.name)

  before(async () => {
    bare = await startFakeComfy({ devices: 'cuda', os: 'win32' })
    mcpBare = await startMcp({ comfyUrl: bare.url })
    full = await startFakeComfy({ devices: 'cuda', os: 'win32', objectInfo: everything() })
    mcp = await startMcp({ comfyUrl: full.url })
    dir = path.join(path.dirname(mcp.dataDir), 'fixtures')
    fs.mkdirSync(dir, { recursive: true })
    video = path.join(dir, 'people.mp4')
    silent = path.join(dir, 'silent.mp4')
    face = path.join(dir, 'face.png')
    shot = path.join(dir, 'second.png')
    out = path.join(dir, 'replaced.mp4')
    const h264 = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p']
    ff('-f', 'lavfi', '-i', 'testsrc=s=128x72:r=24:d=4', '-f', 'lavfi', '-i', 'sine=f=440:d=4', '-shortest', ...h264, '-c:a', 'aac', video)
    ff('-f', 'lavfi', '-i', 'testsrc2=s=128x72:r=24:d=3', ...h264, silent)
    ff('-f', 'lavfi', '-i', 'color=c=orange:s=64x64', '-frames:v', '1', face)
    ff('-f', 'lavfi', '-i', 'color=c=teal:s=64x64', '-frames:v', '1', shot)
    ff('-f', 'lavfi', '-i', 'testsrc=s=128x72:r=24:d=2', ...h264, out)
  })
  afterEach(() => full.setOutputs(null))
  after(async () => {
    await mcp?.close()
    await mcpBare?.close()
    await full?.close()
    await bare?.close()
  })

  // ---------- replace_check ----------
  test('[mcp:replace_check] lists the node packs with their links and the models a mode still needs on a ComfyUI that has none', async () => {
    const r = await okOn(mcpBare)('replace_check', { mode: 'person' })
    assert.equal(r.ready, false)
    const pack = (name) => r.packs.find((p) => p.name.startsWith(name))
    assert.equal(pack('ComfyUI-MiniMaxH3-Context-Loop').url, 'https://github.com/ethanfel/ComfyUI-MiniMaxH3-Context-Loop')
    assert.ok(pack('ComfyUI-MiniMaxH3-Context-Loop').missing.includes('MiniMaxH3ChainPlanModern'))
    assert.equal(pack('comfyui-h3-oneclick-swap').url, 'https://github.com/D3voz/comfyui-h3-oneclick-swap')
    assert.deepEqual(r.models.map((m) => [m.setup, m.where]), [['sam31', 'checkpoints'], ['describer', 'text_encoders']])
    const def = await okOn(mcpBare)('replace_check', {})
    assert.deepEqual(def, r, 'person is the default mode')
  })

  test('[mcp:replace_check] needs fewer things for the modes that use fewer: colours and the mask check skip the describer, colours skips SAM too', async () => {
    const colours = await okOn(mcpBare)('replace_check', { mode: 'colours' })
    assert.deepEqual(colours.models, [])
    assert.ok(colours.packs.length > 0, 'it still needs its node packs')
    const mask = await okOn(mcpBare)('replace_check', { mode: 'mask' })
    assert.deepEqual(mask.models.map((m) => m.setup), ['sam31'])
    const faces = await okOn(mcpBare)('replace_check', { mode: 'faces' })
    assert.deepEqual(faces.models.map((m) => m.setup), ['describer'])
    await fails('replace_check', { mode: 'telepathy' }, /mode/i, mcpBare)
  })

  test('[mcp:replace_check] says a mode is ready once every node, the SAM checkpoint and the describer are there', async () => {
    for (const mode of ['person', 'people', 'people_maxq', 'object', 'mask', 'faces', 'colours']) {
      const r = await ok('replace_check', { mode })
      assert.deepEqual(r, { ready: true, packs: [], models: [] }, mode)
    }
  })

  // ---------- replace_video ----------
  test('[mcp:replace_video] queues nothing and lists what is missing when the ComfyUI is not ready', async () => {
    const queued = bare.prompts.length
    await fails('replace_video', { mode: 'person', video, pictures: [face] }, /Replace needs .*ComfyUI-MiniMaxH3-Context-Loop.*SAM 3\.1.*Qwen3-VL 8B describer.*\. The Replace page lists where to get them\./, mcpBare)
    assert.equal(bare.prompts.length, queued)
  })

  test('[mcp:replace_video] queues the person swap with the part of the video, the picture, the settings and the steps, in a Replace project', async () => {
    const before = full.prompts.length
    const job = await ok('replace_video', { mode: 'person', video, pictures: [face], start: 1, length: 2, settings: { seed: 99, resolution: '480p', clipSeconds: 4, role: '  the   woman ' } })
    assert.equal(full.prompts.length, before + 1)
    assert.equal(job.kind, 'replace')
    const g = lastGraph()
    assert.equal(g['5'].inputs.skip_first_frames, 24)
    assert.equal(g['5'].inputs.frame_load_cap, 48)
    assert.deepEqual([g['11'].inputs.seed, g['11'].inputs.resolution, g['11'].inputs.clip_seconds, g['11'].inputs.roles, g['11'].inputs.steps], [99, '480p', 4, 'the woman', 6])
    assert.equal(g['24'].inputs.text, 'person', 'SAM tracks the main person')
    assert.match(g['5'].inputs.video, /^replace\/people_[0-9a-f]{10}\.mp4$/, 'the video is a copy with its sound padded, staged for ComfyUI')
    assert.equal(g['2'].inputs.image, 'replace/face.png')
    assert.deepEqual(uploads().slice(-2).sort(), ['face.png', g['5'].inputs.video.split('/')[1]].sort())
    assert.equal(Object.values(g).some((n) => n._meta), false, 'no titles are sent')
    const unet = Object.values(g).find((n) => n.class_type === 'UNETLoader')
    assert.match(unet.inputs.unet_name, /minimax_h3_ref2va/)
    const lora = Object.values(g).find((n) => n.class_type === 'LoraLoaderModelOnly')
    assert.match(lora.inputs.lora_name, /DMAD/)
    const history = await ok('replace_history')
    assert.equal(history.items[0].job, job.id)
    assert.match(history.items[0].name, /^Replace · people/)
  })

  test('[mcp:replace_video] pads a video with no sound so the workflow can read it, and the conformed copy has sound of the picture\'s length', async () => {
    await ok('replace_video', { mode: 'mask', video: silent })
    const staged = full.uploads.at(-1).name
    assert.match(staged, /^silent_[0-9a-f]{10}\.mp4$/)
    const conformed = fs.readdirSync(path.join(mcp.dataDir, 'media', 'replace')).find((f) => f === staged)
    assert.ok(conformed, 'the copy is kept in the media cache')
    const streams = execFileSync(ffmpegStatic.ffprobePath, ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', path.join(mcp.dataDir, 'media', 'replace', conformed)]).toString().trim().split('\n').sort()
    assert.deepEqual(streams, ['audio', 'video'])
    const queued = full.prompts.length
    await ok('replace_video', { mode: 'mask', video: silent })
    assert.equal(full.uploads.at(-1).name, staged, 'the same copy again')
    assert.equal(full.prompts.length, queued + 1)
  })

  test('[mcp:replace_video] turns down a run that cannot work: the wrong number of pictures, a missing video, a missing object target', async () => {
    const queued = full.prompts.length
    await fails('replace_video', { mode: 'person', video, pictures: [] }, /Add one picture of the character\./)
    await fails('replace_video', { mode: 'person', video, pictures: [face, shot] }, /Add one picture of the character\./)
    await fails('replace_video', { mode: 'people', video, pictures: [] }, /Add 1-4 character pictures\./)
    await fails('replace_video', { mode: 'people_maxq', video, pictures: [face] }, /exactly two characters/)
    await fails('replace_video', { mode: 'faces', video, pictures: [] }, /Add the picture of the face to restore\./)
    await fails('replace_video', { mode: 'person', video: path.join(dir, 'gone.mp4'), pictures: [face] }, /Choose the source video\./)
    await fails('replace_video', { mode: 'object', video, pictures: [] }, /Say what to change, for example hair\./)
    await fails('replace_video', { mode: 'object', video, settings: { target: 'hair' } }, /Say what it becomes, or add a picture\./)
    await fails('replace_video', { mode: 'object', video, settings: { mode: 'background' } }, /Say what stays, for example person\./)
    await fails('replace_video', { mode: 'sideways', video }, /mode/i)
    assert.equal(full.prompts.length, queued, 'nothing was queued')
  })

  test('[mcp:replace_video] queues each of the other modes from its own workflow', async (t) => {
    const cases = [
      ['people', { pictures: [face, shot], settings: { roles: ['the woman', 'the man'] } }, (g) => assert.equal(Object.values(g).filter((n) => n.class_type === 'LoadImage').length >= 2, true)],
      ['people_maxq', { pictures: [face, shot] }, (g) => assert.ok(Object.values(g).some((n) => n.class_type === 'LoadImage'))],
      ['object', { settings: { mode: 'change', target: 'hair', changeTo: 'blue hair' } }, (g) => assert.ok(JSON.stringify(g).includes('blue hair'))],
      ['object', { settings: { mode: 'remove', target: 'the lamp' } }, (g) => assert.ok(JSON.stringify(g).includes('the lamp'))],
      ['faces', { pictures: [face], settings: { style: 'mouth' } }, (g) => assert.ok(Object.values(g).some((n) => n.class_type === 'H3FaceTrackCrop'))],
      ['colours', { settings: { detail: 0.5 } }, (g) => assert.equal(Object.values(g).some((n) => n.class_type === 'H3FaceTrackCrop' || n.class_type === 'SAMLoader'), false)],
      ['mask', { settings: { target: 'dog', margin: 'loose' } }, (g) => assert.equal(g['3'].inputs.text, 'dog')]
    ]
    for (const [mode, extra, check] of cases) {
      await t.test(`${mode} ${JSON.stringify(extra.settings || {})}`, async () => {
        const before = full.prompts.length
        const job = await ok('replace_video', { mode, video, ...extra })
        assert.equal(full.prompts.length, before + 1)
        assert.equal(job.kind, 'replace')
        check(lastGraph())
      })
    }
  })

  // ---------- replace_history ----------
  test('[mcp:replace_history] lists the runs newest first with their name, status, mode and the finished video', async () => {
    full.setOutputs((g) => {
      const final = Object.entries(g).find(([, n]) => n.class_type === 'MiniMaxH3ChainAssemble')?.[0] || Object.entries(g).filter(([, n]) => n.class_type === 'VHS_VideoCombine').pop()?.[0]
      return final ? { [final]: { gifs: [{ filename: 'replaced.mp4', subfolder: 'replace', type: 'output', fullpath: out }] } } : undefined
    })
    const job = await ok('replace_video', { mode: 'person', video, pictures: [face], settings: { seed: 5 } })
    const { items } = await ok('replace_history')
    assert.ok(items.length >= 3)
    assert.equal(items[0].job, job.id, 'newest first')
    assert.equal(items[0].status, 'success')
    assert.match(items[0].name, /^Replace · people/)
    const final = items[0].outputs.find((o) => o.kind === 'final')
    assert.equal(final.path, out)
  })

  test('[mcp:replace_history] shows a run that failed with its error', async () => {
    full.failNextPrompt('Out of memory on the GPU')
    await ok('replace_video', { mode: 'mask', video })
    const { items } = await ok('replace_history')
    assert.equal(items[0].status, 'error')
    assert.match(items[0].error, /Out of memory on the GPU/)
  })

  test('[mcp:replace_history] has nothing to list on a data folder with no Replace runs', async () => {
    const r = await okOn(mcpBare)('replace_history')
    assert.deepEqual(r, { items: [] })
  })
})
