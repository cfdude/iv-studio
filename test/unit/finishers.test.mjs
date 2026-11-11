// The finishers a Mac (or any ComfyUI without DLSS 5) uses: Real-ESRGAN x2 and RIFE are listed in Setup, and a finish
// that needs one it lacks says so instead of quietly dropping the 2× or the frame rate (SB-10).
//   node --test test/unit/finishers.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { after, before, describe, test } from 'node:test'
import { Comfy } from '../../src/service/comfy.js'
import { adaptGraph, capabilities, CLOUD_UPSCALER, NO_RIFE, NO_UPSCALER } from '../../src/service/remote.js'
import { checkSetup } from '../../src/service/setup.js'
import { startFakeComfy } from '../fakes/comfyui.mjs'

const template = JSON.parse(fs.readFileSync('resources/workflows/iv_studio_api.json', 'utf8'))
const manifest = JSON.parse(fs.readFileSync('resources/models.json', 'utf8'))
const cloud = JSON.parse(fs.readFileSync('resources/cloud/cloud.json', 'utf8'))
const combo = (name, options) => ({ input: { required: { [name]: [options] } } })
const GB = 1024 ** 3
const mps = [{ name: 'mps', type: 'mps', vram_total: 64 * GB }]

describe('the manifest lists the finishers', () => {
  test('[mcp:check_setup][ipc:setup:check] Real-ESRGAN x2 is an optional model in upscale_models, the same file the cloud installs', () => {
    const m = manifest.models.find((x) => x.id === 'esrgan_x2')
    assert.ok(m, 'esrgan_x2 is in models.json')
    assert.deepEqual([m.match, m.folder, m.loader, m.optional], [CLOUD_UPSCALER, 'upscale_models', 'UpscaleModelLoader.model_name', true])
    assert.match(m.optionalFor, /2× upscale/)
    assert.equal(m.url, cloud.extraModels.find((x) => x.id === 'esrgan_x2').url)
  })
  test('[mcp:check_setup][ipc:setup:check] RIFE is an optional node pack, named for a Mac and Linux finish', () => {
    const p = manifest.node_packs.find((x) => x.classes.includes('RIFE VFI'))
    assert.ok(p, 'a pack provides RIFE VFI')
    assert.equal(p.dir, 'comfyui-frame-interpolation')
    assert.ok(cloud.packs.some((x) => x.dir === p.dir), 'the cloud installs the same pack')
    assert.match(p.for, /Mac/)
    assert.ok(!p.windowsOnly, 'shown on a Mac: only a Windows ComfyUI is spared it, because DLSS 5 does its frame rate')
  })
  test('the cloud installer does not download Real-ESRGAN twice (optional models are left to cloud.json)', () => {
    const ids = [...manifest.models.filter((x) => !x.optional), ...cloud.extraModels].map((x) => x.id)
    assert.equal(new Set(ids).size, ids.length)
  })
})

describe('Setup reports the finishers', () => {
  let fake, comfy
  before(async () => {
    fake = await startFakeComfy({ devices: 'mps' })
    comfy = new Comfy(fake.url)
  })
  after(() => fake.close())
  const run = async (objectInfo) => {
    fake.setDevices(mps)
    fake.setObjectInfo(objectInfo)
    const r = await checkSetup({ comfy, template, manifest, characters: [] })
    return { r, byId: Object.fromEntries(r.items.map((i) => [i.id, i])) }
  }

  test('[mcp:check_setup][ipc:setup:check] a ComfyUI with neither warns for both, naming what each one is for, and stays ready on them', async () => {
    const { r, byId } = await run({})
    assert.equal(byId['model:esrgan_x2'].status, 'warn')
    assert.match(byId['model:esrgan_x2'].label, /Real-ESRGAN x2 .* for 2× upscale/)
    assert.equal(byId['model:esrgan_x2'].fix, 'Download into models/upscale_models')
    const rife = r.items.find((i) => i.kind === 'node_pack' && /RIFE/.test(i.label))
    assert.equal(rife.status, 'warn')
    assert.match(rife.detail, /Missing nodes: RIFE VFI/)
    assert.match(rife.fix, /frame rate/)
    assert.ok(!r.items.filter((i) => i.status === 'missing').some((i) => i.id === 'model:esrgan_x2' || i.id === rife.id))
  })

  test('[mcp:check_setup][ipc:setup:check] a ComfyUI with both lists them as ok', async () => {
    const { r, byId } = await run({ UpscaleModelLoader: combo('model_name', [CLOUD_UPSCALER]), 'RIFE VFI': { input: { required: {} } } })
    assert.equal(byId['model:esrgan_x2'].status, 'ok')
    assert.equal(r.items.find((i) => i.kind === 'node_pack' && /RIFE/.test(i.label)).status, 'ok')
  })
})

describe('a finish that needs a missing finisher says so', () => {
  const winGraph = (scale, fps) => ({ dlss: { class_type: 'DLSS5_Enhance_Video', inputs: { 'Video Path': 'a.mp4', Scale: scale, 'Target FPS': fps, 'Filename Prefix': 'x', 'Output Directory': 'H3/final', 'Input FPS': 24 } } })
  const caps = (objectInfo) => capabilities(objectInfo, { system: { os: 'posix' }, devices: mps })
  const BOTH = { UpscaleModelLoader: combo('model_name', [CLOUD_UPSCALER]), 'RIFE VFI': {} }

  test('capabilities() says whether Real-ESRGAN x2 itself is there, not only whether DLSS could stand in', () => {
    assert.equal(caps(BOTH).esrgan, true)
    assert.equal(caps({ UpscaleModelLoader: combo('model_name', ['other.pth']) }).esrgan, false)
    assert.equal(capabilities({ DLSS5_Enhance_Video: {} }, {}).esrgan, false)
  })
  test('2× with no upscaler throws, naming Setup', () => {
    assert.throws(() => adaptGraph(winGraph(2, 0), caps({ 'RIFE VFI': {} })), { message: NO_UPSCALER })
    assert.match(NO_UPSCALER, /no 2x upscaler\. .*Real-ESRGAN x2.*Setup/)
  })
  test('a frame rate above 24 with no RIFE throws, naming Setup', () => {
    assert.throws(() => adaptGraph(winGraph(1, 48), caps({ UpscaleModelLoader: combo('model_name', [CLOUD_UPSCALER]) })), { message: NO_RIFE })
    assert.match(NO_RIFE, /RIFE.*Setup/)
  })
  test('with both, the 2× upscale and RIFE nodes are in the graph; with neither asked for, nothing throws', () => {
    const g = adaptGraph(winGraph(2, 48), caps(BOTH))
    assert.deepEqual(Object.values(g).map((n) => n.class_type).filter((c) => /Upscale|RIFE/.test(c)), ['UpscaleModelLoader', 'ImageUpscaleWithModel', 'RIFE VFI'])
    assert.doesNotThrow(() => adaptGraph(winGraph(1, 0), caps({})))
    assert.doesNotThrow(() => adaptGraph(winGraph(1, 24), caps({})))
  })
})
