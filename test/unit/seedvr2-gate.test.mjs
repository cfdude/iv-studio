// SeedVR2 is refused on an Apple GPU (gpu-readiness spec), at both entry points the window and the MCP server share:
// Studio.finishCandidate (enhancer seedvr2) and Studio.enhanceFinal (engine seedvr2). Runs the real methods on a stub.
//   node --test test/unit/seedvr2-gate.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { describe, test } from 'node:test'
import { SEEDVR2_DEVICE, SEEDVR2_MPS_MESSAGE, seedvr2Refusal } from '../../src/service/gpu.js'
import { capabilities } from '../../src/service/remote.js'
import { Studio } from '../../src/service/studio.js'

const GB = 1024 ** 3
const mps = { name: 'mps', type: 'mps', vram_total: 64 * GB }
const cuda = { name: 'cuda:0 NVIDIA GeForce RTX 4090 : cudaMallocAsync', type: 'cuda', vram_total: 24 * GB }
const cpu = { name: 'cpu', type: 'cpu' }
const STOP = 'reached past the gate'

describe('seedvr2Refusal', () => {
  test('mps refuses with the plain message', () => {
    assert.equal(seedvr2Refusal('mps'), SEEDVR2_MPS_MESSAGE)
    assert.match(seedvr2Refusal('mps'), /SeedVR2 isn't available on an Apple GPU yet/)
  })
  test('cuda and unknown allow', () => {
    assert.equal(seedvr2Refusal('cuda'), null)
    assert.equal(seedvr2Refusal(null), null)
    assert.equal(seedvr2Refusal(undefined), null)
  })
})

describe('SeedVR2 device', () => {
  test('is the one CUDA device ComfyUI defaults to, and the refusal points an Apple GPU at the 2× upscale', () => {
    assert.equal(SEEDVR2_DEVICE, 'cuda:0')
    assert.match(SEEDVR2_MPS_MESSAGE, /Use the 2× upscale and frame rate options instead\.$/)
  })
  test('Studio builds both SeedVR2 loaders from it, so no cuda literal is left in the graph', () => {
    const src = fs.readFileSync('src/service/studio.js', 'utf8')
    assert.equal((src.match(/device: SEEDVR2_DEVICE/g) || []).length, 2)
    assert.doesNotMatch(src, /'cuda:0'/)
  })
})

describe('capabilities().gpuKind', () => {
  test('follows the one GPU rule', () => {
    assert.equal(capabilities({}, { devices: [cuda] }).gpuKind, 'cuda')
    assert.equal(capabilities({}, { devices: [cpu, mps] }).gpuKind, 'mps')
    assert.equal(capabilities({}, { devices: [cpu] }).gpuKind, null)
    assert.equal(capabilities({}, {}).gpuKind, null)
  })
})

// A stand-in `this`: caps from a device list; getJob stops the method right after the gate.
const stub = (devices, remote = false) => ({
  comfy: { remote },
  capabilities: async () => capabilities({}, { devices }),
  getJob: () => {
    throw new Error(STOP)
  }
})
const stubFinish = (devices, remote) => ({ ...stub(devices, remote), getJob: () => ({ kind: 'previews', plan: {} }) })

describe('enhanceFinal', () => {
  test('mps refuses SeedVR2 before looking at the job', async () => {
    await assert.rejects(Studio.prototype.enhanceFinal.call(stub([mps]), { jobId: 'j', engine: 'seedvr2' }), { message: SEEDVR2_MPS_MESSAGE })
  })
  test('the default engine is SeedVR2, so it refuses too', async () => {
    await assert.rejects(Studio.prototype.enhanceFinal.call(stub([mps]), { jobId: 'j' }), { message: SEEDVR2_MPS_MESSAGE })
  })
  test('cuda gets past the gate', async () => {
    await assert.rejects(Studio.prototype.enhanceFinal.call(stub([cuda]), { jobId: 'j', engine: 'seedvr2' }), { message: STOP })
  })
  test('a ComfyUI that can\'t be read falls through to the usual checks', async () => {
    const down = { ...stub([mps]), capabilities: async () => { throw new Error('fetch failed') } }
    await assert.rejects(Studio.prototype.enhanceFinal.call(down, { jobId: 'j', engine: 'seedvr2' }), { message: STOP })
  })
  test('DLSS enhance is not gated', async () => {
    await assert.rejects(Studio.prototype.enhanceFinal.call(stub([mps]), { jobId: 'j', engine: 'dlss' }), { message: STOP })
  })
  test('a remote ComfyUI keeps today\'s message, on any GPU', async () => {
    await assert.rejects(Studio.prototype.enhanceFinal.call(stub([mps], true), { jobId: 'j', engine: 'seedvr2' }), { message: /runs on this PC's ComfyUI only|Enhance runs on this PC/ })
  })
})

describe('finishCandidate', () => {
  const fin = (devices, remote, finish) => Studio.prototype.finishCandidate.call(stubFinish(devices, remote), { jobId: 'j', fps: 0, ...finish })
  test('mps refuses the SeedVR2 enhancer', async () => {
    await assert.rejects(fin([mps], false, { enhancer: 'seedvr2' }), { message: SEEDVR2_MPS_MESSAGE })
  })
  test('cuda gets past the gate (and fails later, on the stub job)', async () => {
    await assert.rejects(fin([cuda], false, { enhancer: 'seedvr2' }), (err) => err.message !== SEEDVR2_MPS_MESSAGE)
  })
  test('the DLSS enhancer on mps is not gated', async () => {
    await assert.rejects(fin([mps], false, { enhancer: 'dlss' }), (err) => err.message !== SEEDVR2_MPS_MESSAGE)
  })
  test('a remote ComfyUI keeps today\'s message, on any GPU', async () => {
    await assert.rejects(fin([mps], true, { enhancer: 'seedvr2' }), { message: /cloud finishes with its own upscaler/ })
  })
})
