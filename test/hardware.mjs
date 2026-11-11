// Check my PC: what recommend() says for made-up machines, and the nvidia-smi and GPU readers. node test/hardware.mjs
import assert from 'node:assert/strict'
import { electronGpus, parseNvidiaSmi, recommend, tierOf } from '../src/service/hardware.js'

const GB = 1024 ** 3
let n = 0
const ok = (name, fn) => {
  fn()
  n++
  console.log('ok', name)
}
const sizes = { fl2va: 21e9, ref2va: 21e9, text_encoder: 15e9, video_vae: 2.8e9, audio_vae: 0.6e9, dmad: 0.37e9, upscaler: 0.7e9, zimage: 6.2e9, zimage_te: 4e9, zimage_vae: 0.3e9, music3_dit: 4.9e9, music3_te: 9.2e9, music3_vae: 0.2e9, ace15: 10e9, sam31: 3e9, describer: 8e9 }
const machine = ({ vram, ram, platform = 'win32', vendor = 'nvidia', name = 'NVIDIA GeForce RTX 4090', driver = '581.57', threads = 32, free = 900 * GB, installs = {} }) => ({
  os: { platform },
  cpu: { model: 'Test CPU', threads },
  ram: ram * GB,
  gpus: vendor ? [{ vendor, name, vram: vram ? vram * GB : null, driver }] : [],
  drives: [{ path: 'F:\\', total: 2000 * GB, free }],
  modelsDrive: { path: 'F:\\', total: 2000 * GB, free, folder: 'F:\\ComfyUI\\models\\diffusion_models' },
  installs: { modelSizes: sizes, modelsPresent: [], ...installs }
})

ok('nvidia-smi rows', () => {
  const g = parseNvidiaSmi('NVIDIA GeForce RTX 4090, 24564, 581.57, 8.9\r\nNVIDIA GeForce RTX 3060, 12288, 581.57, [N/A]\n')
  assert.equal(g.length, 2)
  assert.equal(g[0].name, 'NVIDIA GeForce RTX 4090')
  assert.equal(Math.round(g[0].vram / GB), 24)
  assert.equal(g[0].computeCap, 8.9)
  assert.equal(g[1].computeCap, null)
  assert.deepEqual(parseNvidiaSmi(''), [])
  assert.deepEqual(parseNvidiaSmi(null), [])
})

ok('Electron GPU info names the vendor', () => {
  const g = electronGpus({ gpuDevice: [{ vendorId: 0x1002, deviceString: 'AMD Radeon RX 7900 XTX', active: true }, { vendorId: 0x8086, deviceId: 1, active: false }] })
  assert.equal(g[0].vendor, 'amd')
  assert.equal(g[1].vendor, 'intel')
  assert.deepEqual(electronGpus(null), [])
})

ok('4090 + 64 GB: everything here, 2 MP finals with DLSS, core models recommended', () => {
  const r = recommend(machine({ vram: 24, ram: 64 }))
  assert.equal(r.tier.id, 'all')
  assert.equal(r.tier.renderOn, 'local')
  assert.equal(r.prefs.finalMp, 2)
  assert.equal(r.prefs.enhancer, 'dlss')
  assert.ok(r.downloads.find((d) => d.id === 'core').recommended)
  assert.ok(r.downloads.find((d) => d.id === 'music').recommended)
  assert.ok(r.training.localReady)
  assert.equal(r.verdicts.find((v) => v.id === 'gpu').state, 'great')
})

ok('5090 + 128 GB on Linux: top tier, SeedVR2 instead of DLSS', () => {
  const r = recommend(machine({ vram: 32, ram: 128, platform: 'linux', name: 'NVIDIA GeForce RTX 5090' }))
  assert.equal(r.tier.id, 'top')
  assert.equal(r.prefs.enhancer, 'seedvr2')
  assert.equal(r.prefs.enhanceResolution, 1440)
  assert.ok(r.tips.some((t) => /DLSS 5 needs/.test(t.text)))
})

ok('16 GB card + 32 GB: most things here, finals at 1.5 MP, Replace not pushed', () => {
  const r = recommend(machine({ vram: 16, ram: 32, name: 'NVIDIA GeForce RTX 4080' }))
  assert.equal(r.tier.id, 'most')
  assert.equal(r.prefs.finalMp, 1.5)
  assert.equal(r.downloads.find((d) => d.id === 'replace').recommended, false)
  assert.equal(r.verdicts.find((v) => v.id === 'ram').state, 'ok')
})

ok('12 GB card: pictures here, video in the cloud, no H3 download pushed', () => {
  const r = recommend(machine({ vram: 12, ram: 32, name: 'NVIDIA GeForce RTX 3060' }))
  assert.equal(r.tier.id, 'some')
  assert.equal(r.downloads.find((d) => d.id === 'core').recommended, false)
  assert.ok(r.downloads.find((d) => d.id === 'design').recommended)
  assert.equal(r.training.localReady, false)
})

ok('a good card with 16 GB of RAM: video in the cloud anyway', () => {
  const r = recommend(machine({ vram: 24, ram: 16 }))
  assert.equal(r.tier.renderOn, 'both')
  assert.match(r.tier.summary, /too little RAM/)
  assert.equal(r.downloads.find((d) => d.id === 'core').recommended, false)
})

ok('a Mac with little memory: the cloud, with a plain reason', () => {
  const r = recommend(machine({ vram: null, ram: 16, platform: 'darwin', vendor: 'apple', name: 'Apple M2 Pro' }))
  assert.equal(r.tier.id, 'cloud')
  assert.equal(r.tier.renderOn, 'cloud')
  assert.match(r.verdicts.find((v) => v.id === 'gpu').say, /32 GB/)
  assert.equal(r.need, '0.0 GB')
})

ok('an AMD card: the cloud, and it says why', () => {
  const r = recommend(machine({ vram: null, ram: 64, vendor: 'amd', name: 'AMD Radeon RX 7900 XTX' }))
  assert.equal(r.tier.id, 'cloud')
  assert.match(r.verdicts.find((v) => v.id === 'gpu').say, /AMD card can't run MiniMax H3/)
})

ok('no graphics card found at all', () => {
  const r = recommend(machine({ vram: null, ram: 16, vendor: null }))
  assert.equal(tierOf(machine({ vram: null, ram: 16, vendor: null })).id, 'cloud')
  assert.match(r.verdicts.find((v) => v.id === 'gpu').value, /No NVIDIA card/)
})

ok('models already there are not downloaded again; the space check counts only what is missing', () => {
  const r = recommend(machine({ vram: 24, ram: 64, installs: { modelsPresent: ['fl2va', 'ref2va', 'text_encoder', 'video_vae', 'audio_vae', 'dmad', 'upscaler'] } }))
  const core = r.downloads.find((d) => d.id === 'core')
  assert.equal(core.have, true)
  assert.equal(core.recommended, false)
  assert.ok(r.needBytes < 50e9)
})

ok('too little disk space is a warning', () => {
  const r = recommend(machine({ vram: 24, ram: 64, free: 30 * GB }))
  assert.equal(r.verdicts.find((v) => v.id === 'disk').state, 'weak')
})

ok('the writer: Claude Code first, then Codex, then local', () => {
  assert.equal(recommend(machine({ vram: 24, ram: 64, installs: { claude: true, codex: true } })).writer, 'claude')
  assert.equal(recommend(machine({ vram: 24, ram: 64, installs: { codex: true } })).writer, 'codex')
  assert.equal(recommend(machine({ vram: 24, ram: 64, installs: { ollama: true } })).writer, 'local')
})

ok('an old NVIDIA driver on Windows gets a tip', () => {
  const r = recommend(machine({ vram: 24, ram: 64, driver: '546.33' }))
  assert.ok(r.tips.some((t) => /driver is 546.33/.test(t.text)))
})

console.log(`hardware: ${n}/${n}`)
