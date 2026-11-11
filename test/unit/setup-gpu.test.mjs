// Characterization: what src/service/setup.js says about the GPU today, against the fake ComfyUI.
// Cuda behaviour is pinned as it was; an Apple GPU (mps) with 15 GB or more is ready; it needs ComfyUI 0.44+ for H3's upscaler.
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

  const CORE = { MiniMaxH3LatentUpscaleWithModel: {}, LatentUpscaleModelLoader: {} }
  const UPSCALER_FIX = "Update ComfyUI to 0.44 or newer. Older versions can't upscale H3 video on an Apple GPU."
  const upscalerItem = (r) => r.items.find((i) => i.id === 'gpu-upscaler')

  test('Apple GPU (mps) with 64 GB is ok, named, and needs no fix', async () => {
    fake.setObjectInfo(CORE)
    const r = await gpuItem('mps')
    assert.equal(r.gpu.status, 'ok')
    assert.equal(r.gpu.detail, 'Apple GPU · 64 GB unified memory')
    assert.equal(r.gpu.fix, undefined)
    assert.equal(upscalerItem(r), undefined)
    assert.ok(!blocking(r).includes('gpu'))
  })

  test('Apple GPU (mps) under 15 GB warns with the memory advice', async () => {
    fake.setObjectInfo(CORE)
    const { gpu } = await gpuItem([{ name: 'mps', type: 'mps', vram_total: 8 * 1024 ** 3 }])
    assert.equal(gpu.status, 'warn')
    assert.match(gpu.fix, /Under 16 GB of memory/)
  })

  test('Apple GPU without the built-in H3 upscaler blocks, asking for ComfyUI 0.44+', async () => {
    fake.setObjectInfo({})
    const r = await gpuItem('mps')
    assert.equal(upscalerItem(r).status, 'missing')
    assert.equal(upscalerItem(r).fix, UPSCALER_FIX)
    assert.ok(blocking(r).includes('gpu-upscaler'))
    assert.equal(r.gpu.status, 'ok')
  })

  test('Apple GPU with only half of the built-in upscaler still blocks', async () => {
    fake.setObjectInfo({ LatentUpscaleModelLoader: {} })
    assert.equal(upscalerItem(await gpuItem('mps')).status, 'missing')
  })

  test('cuda never gets the upscaler item, with or without the built-in nodes', async () => {
    fake.setObjectInfo({})
    assert.equal(upscalerItem(await gpuItem('cuda')), undefined)
    fake.setObjectInfo(CORE)
    assert.equal(upscalerItem(await gpuItem('cuda')), undefined)
  })

  test('Comfy Cloud never gets the upscaler item', async () => {
    fake.setObjectInfo({})
    fake.setDevices('mps')
    const cloud = Object.create(comfy, { hosted: { value: true } })
    const r = await checkSetup({ comfy: cloud, template, manifest, characters: [] })
    assert.equal(upscalerItem(r), undefined)
    assert.match(r.items.find((i) => i.id === 'gpu').detail, /Comfy Cloud/)
  })

  test('cuda reporting no memory at all is a warning, as it always was', async () => {
    const { gpu } = await gpuItem([{ name: 'cuda:0 NVIDIA GeForce RTX 3060 : cudaMallocAsync', type: 'cuda', vram_total: 0 }])
    assert.equal(gpu.status, 'warn')
  })

  test('cuda 12 GB warns, with the VRAM advice', async () => {
    const { gpu } = await gpuItem([{ name: 'cuda:0 NVIDIA GeForce RTX 3060 : cudaMallocAsync', type: 'cuda', vram_total: 12 * 1024 ** 3 }])
    assert.equal(gpu.fix, 'Under 16 GB of VRAM: keep previews at 0.4 MP and finals at or below 1.5 MP.')
  })

  test('cpu-only ComfyUI is missing and blocks, with "cpu (not a GPU)"', async () => {
    const r = await gpuItem([{ name: 'cpu', type: 'cpu' }])
    assert.equal(r.gpu.status, 'missing')
    assert.equal(r.gpu.detail, 'cpu (not a GPU)')
    assert.ok(blocking(r).includes('gpu'))
  })

  test('another accelerator type is missing, named "not supported yet"', async () => {
    const { gpu } = await gpuItem([{ name: 'xpu:0 Intel Arc', type: 'xpu' }])
    assert.equal(gpu.status, 'missing')
    assert.equal(gpu.detail, 'xpu:0 Intel Arc (not supported yet)')
  })

  test('a cpu device first and an mps device second uses the mps one', async () => {
    const { gpu } = await gpuItem([{ name: 'cpu', type: 'cpu' }, { name: 'mps', type: 'mps', vram_total: 32 * 1024 ** 3 }])
    assert.equal(gpu.status, 'ok')
    assert.equal(gpu.detail, 'Apple GPU · 32 GB unified memory')
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
