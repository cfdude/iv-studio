// The title bar's memory meter: one "Memory" meter on an Apple Silicon Mac (GPU and RAM are one pool), GPU plus RAM
// elsewhere. node --test test/unit/system-meter.test.mjs
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { statsReadout } from '../../src/service/gpu.js'
import { meterParts, meterTitle } from '../../src/renderer/src/meter.js'

const GB = 1024 ** 3
const ram = { total: 128 * GB, free: 34 * GB }

describe('meterParts', () => {
  test('an Apple GPU is one Memory meter, not two identical ones', () => {
    const st = { ram, ...statsReadout({ devices: [{ name: 'mps', type: 'mps', vram_total: 128 * GB, vram_free: 20 * GB, torch_vram_total: 8 * GB }] }, ram) }
    assert.equal(st.gpu.unified, true)
    const parts = meterParts(st)
    assert.deepEqual(parts.map((p) => [p.label, Math.round(p.used / GB), Math.round(p.total / GB)]), [['Memory', 94, 128]])
    assert.match(meterTitle(st), /^Memory: 94\.0 of 128\.0 GB in use\. The graphics chip shares it/)
  })
  test('an NVIDIA card keeps its own GPU meter beside RAM', () => {
    const st = { ram, ...statsReadout({ devices: [{ name: 'cuda:0 NVIDIA GeForce RTX 4090 : cudaMallocAsync', type: 'cuda', vram_total: 24 * GB, vram_free: 10 * GB, torch_vram_total: 12 * GB }] }, ram) }
    assert.equal(st.gpu.unified, undefined)
    assert.deepEqual(meterParts(st).map((p) => p.label), ['GPU', 'RAM'])
    assert.match(meterTitle(st), /RTX 4090.*14\.0 of 24\.0 GB in use.*RAM: 94\.0 of 128\.0 GB/)
  })
  test('no GPU (or cloud with no stats): RAM alone, or nothing', () => {
    assert.deepEqual(meterParts({ ram, gpu: null }).map((p) => p.label), ['RAM'])
    assert.deepEqual(meterParts(null), [])
  })
})
