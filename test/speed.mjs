// Speed presets (src/service/speed.js): each preset's values, Check my PC's pick, and how a request and a
// finish are filled in from a preset.  node test/speed.mjs
import assert from 'node:assert/strict'
import { applyFinishSpeed, applySpeed, finishFor, previewFor, roughTime, savedSpeed, speedForTier, speedOf, SPEED_IDS, SPEEDS } from '../src/service/speed.js'
import { planFinish, planPreviews } from '../src/service/plan.js'

let n = 0
let failed = 0
const ok = (name, fn) => {
  n++
  try {
    fn()
    console.log('ok', name)
  } catch (err) {
    failed++
    console.log('FAIL', name, '-', err.message)
  }
}

ok('four presets, quickest last, each a valid preview and finish', () => {
  assert.deepEqual(SPEED_IDS, ['quality', 'balanced', 'fast', 'low'])
  for (const id of SPEED_IDS) {
    const s = SPEEDS[id]
    assert.ok(s.label && s.say && s.trade, id)
    assert.ok([0.3, 0.4, 0.6, 0.8].includes(s.previewMp), id)
    assert.ok([4, 8].includes(s.steps), id)
    assert.ok(s.previews >= 1 && s.previews <= 3, id)
    assert.ok([1, 1.5, 2].includes(s.finalMp), id)
    assert.ok(!/—/.test(s.say + s.trade), `${id} has an em dash`)
  }
  const hunts = SPEED_IDS.map((id) => SPEEDS[id].estimate.hunt)
  assert.deepEqual([...hunts].sort((a, b) => b - a), hunts)
})

ok('Quality is today’s default shot; Low memory never runs a pass above 1 MP', () => {
  assert.deepEqual(previewFor('quality'), { megapixels: 0.4, steps: 8, previews: 3 })
  assert.deepEqual(finishFor('quality'), { megapixels: 2, upscale2x: false })
  assert.deepEqual(finishFor('low'), { megapixels: 1, upscale2x: true })
  assert.deepEqual(finishFor('low', { upscale2x: false }), { megapixels: 1, upscale2x: false })
  assert.deepEqual(finishFor('balanced', { upscale2x: false }), { megapixels: 1.5, upscale2x: false })
})

ok('Check my PC: big cards Quality, 16 GB Balanced, 12 GB Low memory', () => {
  assert.equal(speedForTier('top'), 'quality')
  assert.equal(speedForTier('all'), 'quality')
  assert.equal(speedForTier('most'), 'balanced')
  assert.equal(speedForTier('some'), 'low')
  assert.equal(speedForTier('cloud'), 'balanced')
})

ok('a request takes the preset where it leaves values out; given values win', () => {
  assert.deepEqual(applySpeed({ prompt: 'x', speed: 'fast' }), { megapixels: 0.3, steps: 4, previews: 2, prompt: 'x', speed: 'fast' })
  assert.equal(applySpeed({ speed: 'fast', megapixels: 0.6 }).megapixels, 0.6)
  assert.equal(applySpeed({ prompt: 'x' }, 'low').previews, 1)
  assert.deepEqual(applySpeed({ prompt: 'x', megapixels: undefined }), { prompt: 'x' })
  assert.throws(() => applySpeed({ speed: 'turbo' }), /Unknown speed/)
})

ok('a finish takes the shot’s preset; SeedVR2 and given sizes are left alone', () => {
  assert.deepEqual(applyFinishSpeed({ candidate: 2 }, 'balanced', { upscale2x: true }), { candidate: 2, megapixels: 1, upscale2x: true })
  assert.deepEqual(applyFinishSpeed({ candidate: 1 }, 'fast', { upscale2x: false }), { candidate: 1, megapixels: 1.5, upscale2x: false })
  assert.deepEqual(applyFinishSpeed({ megapixels: 2 }, 'low', {}), { megapixels: 2, upscale2x: true })
  assert.deepEqual(applyFinishSpeed({ enhancer: 'seedvr2' }, 'balanced', {}), { enhancer: 'seedvr2' })
  assert.deepEqual(applyFinishSpeed({ candidate: 1 }, null, {}), { candidate: 1 })
})

ok('the form shows the preset its values match, else Custom; Continue ignores the takes', () => {
  assert.equal(speedOf({ megapixels: 0.4, steps: 8, previews: 3 }), 'quality')
  assert.equal(speedOf({ megapixels: 0.3, steps: 4, previews: 1 }), 'low')
  assert.equal(speedOf({ megapixels: 0.4, steps: 4, previews: 3 }), null)
  assert.equal(speedOf({ megapixels: 0.3, steps: 4, previews: undefined }), 'fast')
})

ok('the saved preset: Settings first, then Check my PC’s older defaults, else Quality', () => {
  assert.equal(savedSpeed({ speed: 'fast', shotPrefs: { speed: 'low' } }), 'fast')
  assert.equal(savedSpeed({ shotPrefs: { speed: 'balanced' } }), 'balanced')
  assert.equal(savedSpeed({ shotPrefs: { previewMp: 0.4, quality: 'standard', finalMp: 2 } }), 'quality')
  assert.equal(savedSpeed({ shotPrefs: { previewMp: 0.4, quality: 'draft', finalMp: 1 } }), 'low')
  assert.equal(savedSpeed({ shotPrefs: { previewMp: 0.4, quality: 'draft', finalMp: 1.5 } }), 'balanced')
  assert.equal(savedSpeed({}), 'quality')
  assert.equal(savedSpeed({ speed: 'nonsense' }), 'quality')
})

ok('a preset plans: the preview graph gets its size, steps and takes, the plan keeps the preset', () => {
  const tess = [{ id: 'tess', name: 'Tess', lora: 'MiniMax H3\\tess\\tess.safetensors', trigger: 't3ss4', strength: 0.8 }]
  const plan = planPreviews(applySpeed({ prompt: '{char} waves.', character: 'tess', speed: 'low' }), tess)
  assert.equal(plan.values['501.megapixels'], 0.3)
  assert.equal(plan.values['503'], 4)
  assert.equal(plan.resolved.previews, 1)
  assert.equal(plan.request.speed, 'low')
  const fin = planFinish(plan, applyFinishSpeed({ candidate: 1 }, plan.request.speed, { upscale2x: true }))
  assert.equal(fin.values['504'], 1)
  assert.equal(fin.values['511'], 2)
  assert.equal(fin.resolved.width, 2 * fin.resolved.upscaleSize.width)
  const q = planPreviews({ prompt: '{char} waves.', character: 'tess' }, tess)
  assert.equal(q.request.speed, null)
  assert.equal(q.values['501.megapixels'], 0.4)
})

ok('rough times read naturally', () => {
  assert.equal(roughTime(37), 'about 40 s')
  assert.equal(roughTime(116), 'about 2 min')
  assert.equal(roughTime(180), 'about 3 min')
  assert.equal(roughTime(90), 'about 1½ min')
})

console.log(failed ? `speed: ${n - failed}/${n}, ${failed} failed` : `speed: ${n}/${n}`)
process.exit(failed ? 1 : 0)
