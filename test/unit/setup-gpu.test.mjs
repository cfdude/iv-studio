// Characterization: what src/service/setup.js says about the GPU today, against the fake ComfyUI.
// These pin CURRENT behaviour. Supporting Apple Silicon (mps) changes some of it on purpose, and the matching test then flips.
//   node --test test/unit/setup-gpu.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { after, before, describe, test } from 'node:test'
import { Comfy } from '../../src/service/comfy.js'
import { checkSetup, comboOptions } from '../../src/service/setup.js'
import { startFakeComfy } from '../fakes/comfyui.mjs'

const template = JSON.parse(fs.readFileSync('resources/workflows/iv_studio_api.json', 'utf8'))
const manifest = JSON.parse(fs.readFileSync('resources/models.json', 'utf8'))

describe('checkSetup GPU item', () => {
  let fake, comfy
  before(async () => {
    fake = await startFakeComfy()
    comfy = new Comfy(fake.url)
  })
  after(() => fake.close())

  const gpuItem = async (devices) => {
    fake.setDevices(devices)
    const r = await checkSetup({ comfy, template, manifest, characters: [] })
    return { ...r, gpu: r.items.find((i) => i.id === 'gpu') }
  }

  test('cuda 24 GB is ok', async () => {
    const { gpu } = await gpuItem('cuda')
    assert.equal(gpu.status, 'ok')
    assert.equal(gpu.detail, 'NVIDIA GeForce RTX 4090 · 24 GB')
    assert.equal(gpu.fix, undefined)
  })

  test('cuda under 15 GB is a warning with the preview/final size advice', async () => {
    const { gpu } = await gpuItem([{ name: 'cuda:0 NVIDIA GeForce RTX 3060 : cudaMallocAsync', type: 'cuda', vram_total: 12 * 1024 ** 3 }])
    assert.equal(gpu.status, 'warn')
    assert.match(gpu.fix, /Under 16 GB/)
  })

  const blocking = (r) => r.items.filter((i) => i.status === 'missing').map((i) => i.id)

  test('mps is rejected today (Apple Silicon ComfyUI reports mps; this flips when it is supported)', async () => {
    const r = await gpuItem('mps')
    assert.equal(r.gpu.status, 'missing')
    assert.equal(r.gpu.detail, 'mps · 64 GB')
    // 'missing' blocks, so the GPU item is one of the reasons setup is not ready
    assert.ok(blocking(r).includes('gpu'))
  })

  test('cuda does not block on the GPU item', async () => {
    assert.ok(!blocking(await gpuItem('cuda')).includes('gpu'))
  })

  test('no devices at all is missing, with "No GPU reported"', async () => {
    const { gpu } = await gpuItem([])
    assert.equal(gpu.status, 'missing')
    assert.equal(gpu.detail, 'No GPU reported')
  })

  test('a cuda device wins over a first non-cuda device', async () => {
    const { gpu } = await gpuItem([
      { name: 'mps', type: 'mps', vram_total: 8 * 1024 ** 3 },
      { name: 'cuda:1 NVIDIA GeForce RTX 4090 : cudaMallocAsync', type: 'cuda', vram_total: 24 * 1024 ** 3 }
    ])
    assert.equal(gpu.status, 'ok')
  })

  test('ComfyUI down: one blocking "comfyui" item and nothing else', async () => {
    fake.failRoute('/system_stats', 500, 'down')
    const r = await checkSetup({ comfy, template, manifest, characters: [] })
    fake.failRoute('/system_stats', null)
    assert.equal(r.ready, false)
    assert.deepEqual(r.items.map((i) => i.id), ['comfyui'])
  })

  const dlssStatus = async (os) => {
    fake.setDevices('cuda')
    fake.state.os = os
    const r = await checkSetup({ comfy, template, manifest, characters: [] })
    const dlss = manifest.node_packs.find((p) => p.classes.includes('DLSS5_Enhance_Video'))
    return r.items.find((i) => i.id === `pack:${dlss.label}`).status
  }

  test('DLSS pack is a warning, not blocking, when ComfyUI is on Linux (the cloud)', async () => {
    assert.equal(await dlssStatus('linux'), 'warn')
  })

  test('DLSS pack is missing (blocking) on Windows when its nodes are not installed', async () => {
    assert.equal(await dlssStatus('win32'), 'missing')
  })
})

describe('comboOptions', () => {
  test('reads the list from required or optional inputs, either shape', () => {
    const info = { A: { input: { required: { x: [['a', 'b']] } } }, B: { input: { optional: { y: ['COMBO', { options: ['c'] }] } } } }
    assert.deepEqual(comboOptions(info, 'A', 'x'), ['a', 'b'])
    assert.deepEqual(comboOptions(info, 'B', 'y'), ['c'])
    assert.equal(comboOptions(info, 'A', 'nope'), null)
  })
})
