// The one GPU rule (src/service/gpu.js): pure helpers, no ComfyUI needed.
//   node --test test/unit/gpu.test.mjs
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { findGpu, gpuDetail, gpuLabel, gpuMemoryGb, lowMemoryAdvice, nonGpuDetail, statsReadout } from '../../src/service/gpu.js'

const GB = 1024 ** 3
const cpu = { name: 'cpu', type: 'cpu' }
const mps = { name: 'mps', type: 'mps', index: null, vram_total: 64 * GB, vram_free: 60 * GB, torch_vram_total: 60 * GB }
const cuda = { name: 'cuda:0 NVIDIA GeForce RTX 4090 : cudaMallocAsync', type: 'cuda', index: 0, vram_total: 24 * GB, vram_free: 22 * GB, torch_vram_total: 23 * GB }
const xpu = { name: 'xpu:0 Intel Arc', type: 'xpu' }

describe('findGpu', () => {
  test('cuda first', () => assert.equal(findGpu([cuda]), cuda))
  test('mps only', () => assert.equal(findGpu([mps]), mps))
  test('cpu then mps picks mps', () => assert.equal(findGpu([cpu, mps]), mps))
  test('mps then cuda picks cuda', () => assert.equal(findGpu([mps, cuda]), cuda))
  test('cpu only is null', () => assert.equal(findGpu([cpu]), null))
  test('xpu only is null', () => assert.equal(findGpu([xpu]), null))
  test('an empty list, undefined and junk are null', () => {
    assert.equal(findGpu([]), null)
    assert.equal(findGpu(undefined), null)
    assert.equal(findGpu(null), null)
    assert.equal(findGpu('cuda'), null)
  })
})

describe('gpuMemoryGb', () => {
  test('bytes to GB', () => {
    assert.equal(gpuMemoryGb(mps), 64)
    assert.equal(gpuMemoryGb(cuda), 24)
  })
  test('no device or no size is 0', () => {
    assert.equal(gpuMemoryGb(null), 0)
    assert.equal(gpuMemoryGb(cpu), 0)
  })
})

describe('labels', () => {
  test('cuda name is cleaned', () => assert.equal(gpuLabel(cuda), 'NVIDIA GeForce RTX 4090'))
  test('cuda name without the prefix or suffix is kept', () => assert.equal(gpuLabel({ type: 'cuda', name: 'NVIDIA A100' }), 'NVIDIA A100'))
  test('mps is Apple GPU', () => assert.equal(gpuLabel(mps), 'Apple GPU'))
  test('setup detail for cuda', () => assert.equal(gpuDetail(cuda), 'NVIDIA GeForce RTX 4090 · 24 GB'))
  test('setup detail for mps', () => assert.equal(gpuDetail(mps), 'Apple GPU · 64 GB unified memory'))
})

describe('lowMemoryAdvice', () => {
  test('cuda 12 GB says VRAM', () => assert.equal(lowMemoryAdvice({ ...cuda, vram_total: 12 * GB }), 'Under 16 GB of VRAM: keep previews at 0.4 MP and finals at or below 1.5 MP.'))
  test('mps 8 GB says memory', () => assert.equal(lowMemoryAdvice({ ...mps, vram_total: 8 * GB }), 'Under 16 GB of memory: keep previews at 0.4 MP and finals at or below 1.5 MP.'))
  test('a 16 GB device (about 15 reported) and bigger get none', () => {
    assert.equal(lowMemoryAdvice({ ...cuda, vram_total: 15 * GB }), undefined)
    assert.equal(lowMemoryAdvice(cuda), undefined)
    assert.equal(lowMemoryAdvice(mps), undefined)
  })
})

describe('nonGpuDetail', () => {
  test('cpu', () => assert.equal(nonGpuDetail([cpu]), 'cpu (not a GPU)'))
  test('xpu', () => assert.equal(nonGpuDetail([xpu]), 'xpu:0 Intel Arc (not supported yet)'))
  test('an unsupported accelerator is named even after a cpu entry', () => assert.equal(nonGpuDetail([cpu, xpu]), 'xpu:0 Intel Arc (not supported yet)'))
  test('empty and missing lists', () => {
    assert.equal(nonGpuDetail([]), 'No GPU reported')
    assert.equal(nonGpuDetail(undefined), 'No GPU reported')
  })
})

describe('statsReadout', () => {
  test('mixed devices use the mps one and say Apple GPU', () => {
    assert.deepEqual(statsReadout({ devices: [cpu, mps] }).gpu, { name: 'Apple GPU', total: mps.vram_total, free: mps.vram_free, comfyHeld: mps.torch_vram_total })
  })
  test('cuda gives the card name', () => {
    const g = statsReadout({ devices: [cpu, cuda] }).gpu
    assert.equal(g.name, 'NVIDIA GeForce RTX 4090')
    assert.equal(g.total, cuda.vram_total)
  })
  test('cpu-only, xpu-only, no devices and no stats give gpu null', () => {
    assert.equal(statsReadout({ devices: [cpu] }).gpu, null)
    assert.equal(statsReadout({ devices: [xpu] }).gpu, null)
    assert.equal(statsReadout({ devices: [] }).gpu, null)
    assert.equal(statsReadout(null).gpu, null)
  })
})
