// Characterization: what src/service/setup.js says about the GPU today, against the fake ComfyUI.
// These pin CURRENT behaviour. r1 (the Mac port) changes some of it on purpose and flips the matching test.
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

  test('mps is rejected today (r1 will flip this)', async () => {
    const { gpu, ready } = await gpuItem('mps')
    assert.equal(gpu.status, 'missing')
    assert.equal(gpu.detail, 'mps · 64 GB')
    // 'missing' is blocking, so the whole app reports not ready on a Mac even before nodes and models are counted
    assert.equal(ready, false)
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

  test('DLSS pack is a warning, not blocking, when ComfyUI is on Linux (the cloud)', async () => {
    fake.setDevices('cuda')
    fake.state.os = 'posix'
    const r = await checkSetup({ comfy, template, manifest, characters: [] })
    const dlss = manifest.node_packs.find((p) => p.classes.includes('DLSS5_Enhance_Video'))
    assert.equal(r.items.find((i) => i.id === `pack:${dlss.label}`).status, 'warn')
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
