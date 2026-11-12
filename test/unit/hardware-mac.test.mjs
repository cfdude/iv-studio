// The first-run wizard on a Mac: an Apple Silicon Mac is tiered by its unified memory.
//   node --test test/unit/hardware-mac.test.mjs
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { cleanGpuName, electronGpus, recommend, tierOf } from '../../src/service/hardware.js'

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

  test('titles and summaries say This Mac, not This computer (or PC)', () => {
    for (const ram of [128, 64, 32, 16]) assert.doesNotMatch(JSON.stringify(recommend(mac(ram)).tier), /\bPC\b|computer/i)
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

describe('the default finisher (SB-23)', () => {
  const GBn = 1024 ** 3
  const pc = ({ platform, vendor, name }) => ({
    os: { platform, arch: 'x64' },
    cpu: { model: 'Test CPU', threads: 32 },
    ram: 64 * GBn,
    gpus: [{ vendor, name, vram: vendor === 'nvidia' ? 24 * GBn : null, driver: '581.57' }],
    drives: [{ path: '/', total: 2000 * GBn, free: 900 * GBn }],
    modelsDrive: { path: '/', total: 2000 * GBn, free: 900 * GBn, folder: '/ComfyUI/models' },
    installs: { modelSizes: { ...sizes, esrgan_x2: 67061725 }, modelsPresent: [] }
  })
  test('[mcp:scan_hardware] a Mac gets the built-in 2× upscale with frame interpolation, never SeedVR2 or DLSS 5', () => {
    for (const ram of [128, 64, 32]) {
      const { prefs } = recommend(mac(ram))
      assert.deepEqual([prefs.enhancer, prefs.upscale2x, prefs.fps], ['upscale', true, 48])
    }
  })
  test('[mcp:scan_hardware] the Mac tip names what finals use and why', () => {
    const tips = recommend(mac(64)).tips.map((t) => t.text).join(' ')
    assert.match(tips, /2× upscale and RIFE frame interpolation/)
    assert.match(tips, /SeedVR2 isn't available on an Apple GPU yet/)
    assert.doesNotMatch(tips, /DLSS|NVIDIA RTX/, 'a Mac is not told what a Windows card is needed for')
  })
  test('[mcp:scan_hardware] Real-ESRGAN x2 is recommended with the video models on a Mac, as its own download group', () => {
    const r = recommend(mac(64))
    const g = r.downloads.find((d) => d.id === 'finish_up')
    assert.deepEqual([g.ids, g.recommended], [['esrgan_x2'], true])
    assert.equal(r.downloads.find((d) => d.id === 'core').recommended, true)
  })
  test('[mcp:scan_hardware] an NVIDIA card on Windows keeps DLSS 5 and does not need Real-ESRGAN', () => {
    const r = recommend(pc({ platform: 'win32', vendor: 'nvidia', name: 'NVIDIA GeForce RTX 4090' }))
    assert.equal(r.prefs.enhancer, 'dlss')
    assert.equal(r.downloads.find((d) => d.id === 'finish_up').recommended, false)
  })
  test('[mcp:scan_hardware] an NVIDIA card on Linux gets SeedVR2, as before', () => {
    assert.equal(recommend(pc({ platform: 'linux', vendor: 'nvidia', name: 'NVIDIA GeForce RTX 4090' })).prefs.enhancer, 'seedvr2')
  })
  test('[mcp:scan_hardware] a card SeedVR2 cannot run on (AMD or Intel) gets the built-in upscale too', () => {
    for (const platform of ['linux', 'win32']) assert.equal(recommend(pc({ platform, vendor: 'amd', name: 'AMD Radeon RX 7900 XTX' })).prefs.enhancer, 'upscale')
  })
})

describe('graphics card names from Chromium', () => {
  const cases = [
    ['ANGLE (Apple, ANGLE Metal Renderer: Apple M5 Max, Unspecified Version)', 'Apple M5 Max'],
    ['ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Version 14.5 (Build 23F79))', 'Apple M2 Pro'],
    ['ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 (0x00002684) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'NVIDIA GeForce RTX 4090'],
    ['ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11-27.20.100.9168)', 'Intel(R) UHD Graphics 630'],
    ['ANGLE (NVIDIA Corporation, NVIDIA GeForce RTX 3060/PCIe/SSE2, OpenGL 4.5.0 NVIDIA 535.54)', 'NVIDIA GeForce RTX 3060/PCIe/SSE2']
  ]
  test('strips the ANGLE wrapper, the backend and the device id from real-looking strings', () => {
    for (const [raw, want] of cases) assert.equal(cleanGpuName(raw), want, raw)
  })
  test('a name that is not in the wrapper passes through, and nothing stays null', () => {
    assert.equal(cleanGpuName('AMD Radeon RX 7900 XTX'), 'AMD Radeon RX 7900 XTX')
    assert.equal(cleanGpuName('Apple M5 Max'), 'Apple M5 Max')
    assert.equal(cleanGpuName(undefined), null)
    assert.equal(cleanGpuName('ANGLE (Apple)'), 'Apple')
  })
  test('electronGpus applies it', () => {
    const [g] = electronGpus({ gpuDevice: [{ vendorId: 0x106b, deviceString: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M5 Max, Unspecified Version)', active: true }] })
    assert.equal(g.name, 'Apple M5 Max')
    assert.equal(g.vendor, 'apple')
  })
})
