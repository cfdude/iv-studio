// The Shot page's Finish panel: which enhancers it offers and what it starts on (src/renderer/src/finish.js), SB-23.
//   node --test test/unit/finish-choices.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { describe, test } from 'node:test'
import { enhancerChoices, finishDefaults, fpsFor, pickEnhancer } from '../../src/renderer/src/finish.js'

const mac = { dlss: false, gpuKind: 'mps', esrgan: true, rife: true, fps: [0, 48, 72, 120], fpsBuiltIn: [0, 48, 72, 120] }
const macBare = { dlss: false, gpuKind: 'mps', esrgan: false, rife: false, fps: [0], fpsBuiltIn: [0] }
const win = { dlss: true, gpuKind: 'cuda', esrgan: false, rife: false, fps: [0, 30, 50, 60, 120], fpsBuiltIn: [0] }
const linux = { dlss: false, gpuKind: 'cuda', esrgan: true, rife: true, fps: [0, 48, 72, 120], fpsBuiltIn: [0, 48, 72, 120] }
const MAC_PREFS = { finalMp: 1.5, enhancer: 'upscale', enhanceResolution: 1080, upscale2x: true, fps: 48 }

describe('enhancerChoices', () => {
  test('a Mac is offered the built-in upscale and never SeedVR2 or DLSS 5', () => assert.deepEqual(enhancerChoices(mac, false), ['upscale']))
  test('Windows with an NVIDIA card has all three', () => assert.deepEqual(enhancerChoices(win, false), ['dlss', 'upscale', 'seedvr2']))
  test('Linux with an NVIDIA card has the upscale and SeedVR2', () => assert.deepEqual(enhancerChoices(linux, false), ['upscale', 'seedvr2']))
  test('the cloud has no SeedVR2', () => assert.deepEqual(enhancerChoices({ ...linux }, true), ['upscale']))
  test('before ComfyUI has been read, DLSS 5 stays on offer as it did', () => assert.deepEqual(enhancerChoices(null, false), ['dlss', 'upscale']))
})

describe('pickEnhancer', () => {
  test('keeps a wanted enhancer that is on offer, else the first on offer', () => {
    assert.equal(pickEnhancer('seedvr2', ['dlss', 'upscale', 'seedvr2']), 'seedvr2')
    assert.equal(pickEnhancer('seedvr2', ['upscale']), 'upscale')
    assert.equal(pickEnhancer('dlss', ['upscale']), 'upscale')
  })
})

describe('fpsFor', () => {
  test('upscale offers RIFE\'s rates even where DLSS 5 offers its own', () => {
    assert.deepEqual(fpsFor(win, 'dlss'), [0, 30, 50, 60, 120])
    assert.deepEqual(fpsFor({ ...win, fpsBuiltIn: [0, 48] }, 'upscale'), [0, 48])
  })
})

describe('finishDefaults', () => {
  test('a Mac with both finishers starts on the upscale, 2× and 48 fps', () => {
    assert.deepEqual(finishDefaults(MAC_PREFS, mac, false), { enhancer: 'upscale', megapixels: 1.5, enhanceResolution: 1080, upscale2x: true, fps: 48 })
  })
  test('a Mac missing Real-ESRGAN x2 and RIFE starts on the upscale with both off, not on something it cannot do', () => {
    const d = finishDefaults(MAC_PREFS, macBare, false)
    assert.deepEqual([d.enhancer, d.upscale2x, d.fps], ['upscale', false, 0])
  })
  test('the old Mac default, SeedVR2, lands on the upscale instead of on a refused enhancer', () => {
    assert.equal(finishDefaults({ ...MAC_PREFS, enhancer: 'seedvr2' }, mac, false).enhancer, 'upscale')
  })
  test('a Mac that saved SeedVR2 before the upscale existed starts on the upscale at 2× and 48 fps', () => {
    const d = finishDefaults({ finalMp: 1.5, enhancer: 'seedvr2', enhanceResolution: 1080 }, mac, false)
    assert.deepEqual([d.enhancer, d.upscale2x, d.fps], ['upscale', true, 48])
  })
  test('Windows keeps DLSS 5 and sets no 2× or frame rate of its own', () => {
    const d = finishDefaults({ finalMp: 2, enhancer: 'dlss', enhanceResolution: 1440 }, win, false)
    assert.deepEqual(d, { enhancer: 'dlss', megapixels: 2, enhanceResolution: 1440 })
  })
  test('no saved defaults: the first enhancer on offer', () => {
    assert.deepEqual(finishDefaults(null, mac, false), { enhancer: 'upscale', upscale2x: false, fps: 0 })
  })
})

describe('the Finish panel and the welcome wizard use them', () => {
  const shot = fs.readFileSync('src/renderer/src/components/Shot.jsx', 'utf8')
  const welcome = fs.readFileSync('src/renderer/src/components/Welcome.jsx', 'utf8')
  test('Shot.jsx takes its enhancer choices and defaults from finish.js, with no leftover seedvr2 swap', () => {
    assert.match(shot, /from '\.\.\/finish'/)
    assert.match(shot, /enhancerChoices\(caps, remote\)/)
    assert.match(shot, /finishDefaults\(/)
    assert.doesNotMatch(shot, /p\.enhancer === 'dlss' && !dlss \? 'seedvr2'/)
  })
  test('the wizard offers the built-in upscale, and SeedVR2 only to an NVIDIA card', () => {
    assert.match(welcome, /\['upscale', /)
    assert.match(welcome, /nvidiaOk/)
  })
})
