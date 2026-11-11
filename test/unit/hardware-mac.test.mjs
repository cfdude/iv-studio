// The first-run wizard on a Mac: an Apple Silicon Mac is tiered by its unified memory.
//   node --test test/unit/hardware-mac.test.mjs
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { recommend, tierOf } from '../../src/service/hardware.js'

const GB = 1024 ** 3
const sizes = { fl2va: 21e9, ref2va: 21e9, text_encoder: 15e9, video_vae: 2.8e9, audio_vae: 0.6e9, dmad: 0.37e9, upscaler: 0.7e9, zimage: 6.2e9, zimage_te: 4e9, zimage_vae: 0.3e9, music3_dit: 4.9e9, music3_te: 9.2e9, music3_vae: 0.2e9, ace15: 10e9, sam31: 3e9, describer: 8e9 }
const mac = (ram, { arch = 'arm64', vendor = 'apple', name = 'Apple M5 Max' } = {}) => ({
  os: { platform: 'darwin', arch },
  cpu: { model: 'Apple M5 Max', threads: 18 },
  ram: ram * GB,
  gpus: [{ vendor, name, vram: null, driver: null }],
  drives: [{ path: '/', total: 2000 * GB, free: 900 * GB }],
  modelsDrive: { path: '/', total: 2000 * GB, free: 900 * GB, folder: '/ComfyUI/models' },
  installs: { modelSizes: sizes, modelsPresent: [] }
})
const rec = (r, id) => r.downloads.find((d) => d.id === id).recommended

describe('Apple Silicon tiers by unified memory', () => {
  const tiered = (ram, id, render) => {
    const r = recommend(mac(ram))
    assert.equal(r.tier.id, id)
    assert.equal(r.tier.renderOn, render)
    assert.equal(tierOf(mac(ram)).id, id)
  }
  test('128 GB is all', () => tiered(128, 'all', 'local'))
  test('96 GB is all', () => tiered(96, 'all', 'local'))
  test('95 GB is most', () => tiered(95, 'most', 'both'))
  test('64 GB is most', () => tiered(64, 'most', 'both'))
  test('63 GB is some', () => tiered(63, 'some', 'both'))
  test('32 GB is some', () => tiered(32, 'some', 'both'))
  test('31 GB is cloud', () => tiered(31, 'cloud', 'cloud'))
  test('16 GB is cloud', () => tiered(16, 'cloud', 'cloud'))

  test('the same Mac with no graphics entry (the agent server has no Electron) is still found by its chip', () => {
    const s = mac(128)
    s.gpus = []
    assert.equal(recommend(s).tier.id, 'all')
  })

  test('the graphics verdict is "Graphics" with the unified memory, and never mentions CUDA or NVIDIA', () => {
    const v = recommend(mac(128)).verdicts.find((x) => x.id === 'gpu')
    assert.equal(v.label, 'Graphics')
    assert.equal(v.value, 'Apple GPU · 128 GB unified memory')
    for (const ram of [128, 64, 32, 16]) assert.doesNotMatch(JSON.stringify([recommend(mac(ram)).verdicts, recommend(mac(ram)).tier]), /CUDA|NVIDIA/)
  })

  test('titles and summaries say This Mac, not This PC', () => {
    for (const ram of [128, 64, 32, 16]) assert.doesNotMatch(JSON.stringify(recommend(mac(ram)).tier), /\bPC\b/i)
    assert.match(recommend(mac(128)).tier.title, /This Mac/)
  })

  test('128 GB wants video, pictures and music, but never Replace or the remakes', () => {
    const r = recommend(mac(128))
    assert.ok(rec(r, 'core') && rec(r, 'design') && rec(r, 'music'))
    assert.ok(!rec(r, 'replace') && !rec(r, 'remake_swap') && !rec(r, 'remake_edit'))
  })

  test('32 GB wants pictures but not video; under 32 GB wants nothing', () => {
    const r = recommend(mac(32))
    assert.ok(rec(r, 'design') && !rec(r, 'core'))
    const c = recommend(mac(16))
    assert.equal(c.need, '0.0 GB')
  })

  test('an Intel Mac stays in the cloud, whatever its memory', () => {
    const r = recommend(mac(64, { arch: 'x64', vendor: 'amd', name: 'AMD Radeon Pro 5500M' }))
    assert.equal(r.tier.id, 'cloud')
    assert.doesNotMatch(r.tier.summary, /\bPC\b/)
  })
})
