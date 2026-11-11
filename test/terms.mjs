// IV Studio's terms for MiniMax H3 (src/service/terms.js, TERMS.md, docs/SAFEGUARDS.md): which graphs count as H3, the
// gate in Comfy.submit and training, and that the documents carry MiniMax's use restrictions and the abuse address.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { ABUSE_EMAIL, H3_RULES, H3_TERMS_NEEDED, H3_TERMS_VERSION, acceptance, checkH3Terms, setH3Gate, termsAccepted, usesH3 } from '../src/service/terms.js'
import { Comfy } from '../src/service/comfy.js'
import { readSettings } from '../src/service/paths.js'
import os from 'node:os'
import path from 'node:path'

let n = 0
const ok = async (name, fn) => (await fn(), n++, console.log('ok ', name))
const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')
const node = (class_type, inputs = {}) => ({ class_type, inputs })

await ok('IV Studio’s own shot graph counts as H3', () => {
  assert.equal(usesH3(JSON.parse(read('resources/workflows/iv_studio_api.json'))), true)
})
await ok('H3 nodes, H3 model files, H3 LoRAs and Viggle Remake count; other models don’t', () => {
  assert.equal(usesH3({ 1: node('MiniMaxH3ReferenceToVideo') }), true)
  assert.equal(usesH3({ 1: node('UNETLoader', { unet_name: 'Minimax H3/minimax_h3_fl2va_pruned_int8_convrot.safetensors' }) }), true)
  assert.equal(usesH3({ 1: node('CLIPLoader', { clip_name: 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors' }) }), true)
  assert.equal(usesH3({ 1: node('LoraLoaderModelOnly', { lora_name: 'MiniMax H3\\tess\\tess_mmh3-000040.safetensors' }) }), true)
  assert.equal(usesH3({ 1: node('UNETLoader', { unet_name: 'Viggle Remake/viggle_remake_swap_pruned_int8_convrot.safetensors' }) }), true)
  assert.equal(usesH3({ 1: node('UNETLoader', { unet_name: 'minimax_music3_dit_fp16.safetensors' }) }), false)
  assert.equal(usesH3({ 1: node('UNETLoader', { unet_name: 'minimax_h3_image_pruned_int8_convrot.safetensors' }) }), false)
  assert.equal(usesH3({ 1: node('MiniMaxH3ImageConditioning', { prompt: 'a lake' }) }), false)
  assert.equal(usesH3({ 1: node('MiniMaxH3ImageToVideo', { prompt: 'a lake' }) }), true)
  assert.equal(usesH3({ 1: node('CheckpointLoaderSimple', { ckpt_name: 'SDXL/sd_xl_base_1.0.safetensors' }), 2: node('KSampler', { seed: 1 }) }), false)
  assert.equal(usesH3({ 1: node('ByteDance2TextToVideoNode', { prompt: 'a fox' }) }), false)
  assert.equal(usesH3(null), false)
})

await ok('no gate: nothing is checked (tests and scripts)', async () => {
  setH3Gate(null)
  await checkH3Terms({ 1: node('MiniMaxH3ReferenceToVideo') })
})
await ok('a gate that refuses stops H3 graphs and training, not other models', async () => {
  const asked = []
  setH3Gate(async (what) => {
    asked.push(what)
    throw new Error(H3_TERMS_NEEDED)
  })
  await assert.rejects(checkH3Terms({ 1: node('MiniMaxH3ImageToVideo') }), /terms for MiniMax H3/)
  await assert.rejects(checkH3Terms(null, 'training'), /terms for MiniMax H3/)
  await checkH3Terms({ 1: node('UNETLoader', { unet_name: 'minimax_music3_dit_fp16.safetensors' }) })
  assert.deepEqual(asked, ['render', 'training'])
})
await ok('Comfy.submit refuses an H3 graph before anything is sent', async () => {
  // a ComfyUI address that isn't listening: a refused graph never gets as far as connecting
  const comfy = new Comfy('http://127.0.0.1:9')
  await assert.rejects(comfy.submit({ 1: node('MiniMaxH3ReferenceToVideo') }), (e) => /terms for MiniMax H3/.test(e.message))
  await assert.rejects(comfy.submit({ 1: node('KSampler', { seed: 1 }) }), (e) => !/terms/.test(e.message))
  setH3Gate(null)
})
await ok('agreeing is saved per version; settings start unagreed', () => {
  assert.equal(termsAccepted({ h3Terms: acceptance() }), true)
  assert.equal(termsAccepted({ h3Terms: { version: '2000-01-01', at: 'x' } }), false)
  assert.equal(termsAccepted({}), false)
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-terms-'))
  assert.equal(readSettings(empty).h3Terms, null)
  fs.rmSync(empty, { recursive: true, force: true })
  assert.match(H3_TERMS_VERSION, /^\d{4}-\d{2}-\d{2}$/)
  assert.ok(read('TERMS.md').includes(`Version ${H3_TERMS_VERSION}`), 'TERMS.md shows the version the app asks for')
})

await ok('TERMS.md carries MiniMax’s use restrictions and Acceptable Use Policy', () => {
  const t = read('TERMS.md').replace(/\s+/g, ' ') // lines wrap anywhere
  // one phrase for each item of MiniMax's section V and Exhibit A
  for (const p of [
    /licence, or a licence you hold, allows/,
    /trade-control/,
    /copyright, trademark, privacy, publicity, likeness/,
    /Harm yourself or others/,
    /Harm or exploit minors/,
    /influence\s+elections/,
    /false online engagement/,
    /defame/,
    /personal information/,
    /Impersonate people/,
    /made with AI/,
    /malware/,
    /high-risk automated decisions/,
    /violent extremism or terrorism/,
    /protected characteristics/,
    /vulnerabilities/,
    /military purposes/,
    /Practise a profession without a licence/,
    /social, ethical or moral standards/,
    /Get around safeguards/,
    /Train other AI models/,
    /the stricter one applies/,
    /Powered by MiniMax H3/,
    /MiniMax H3 Community License Agreement, Copyright © 2026 MiniMax\. All Rights Reserved\./
  ])
    assert.match(t, p)
  assert.ok(t.includes(ABUSE_EMAIL))
})
await ok('the notice’s rules, TERMS.md and SAFEGUARDS.md have no em dashes', () => {
  for (const r of H3_RULES) assert.ok(!/[—]/.test(r), r)
  assert.ok(!/[—]/.test(read('TERMS.md')), 'TERMS.md')
  assert.ok(!/[—]/.test(read('docs/SAFEGUARDS.md')), 'SAFEGUARDS.md')
})
await ok('MiniMax’s licence and notice ship with the app', () => {
  const lic = read('resources/licenses/MiniMax-H3-LICENSE.txt')
  assert.match(lic, /MiniMax H3 Community License/)
  assert.match(lic, /Exhibit A/)
  assert.match(read('resources/licenses/MiniMax-H3-NOTICE.txt'), /MiniMax H3 is licensed under the MiniMax H3 Community License Agreement/)
})
await ok('the README, Settings and SAFEGUARDS.md point at the terms and the abuse address', () => {
  const readme = read('README.md')
  assert.ok(readme.includes('TERMS.md') && readme.includes(ABUSE_EMAIL) && readme.includes('docs/SAFEGUARDS.md'))
  const settings = read('src/renderer/src/components/Settings.jsx')
  assert.ok(settings.includes('about-terms') && settings.includes('about-report') && settings.includes('Report misuse'))
  const safe = read('docs/SAFEGUARDS.md')
  assert.ok(safe.includes(ABUSE_EMAIL) && /Known gaps/.test(safe) && /Reviews/.test(safe))
})

console.log(`${n} passed`)
