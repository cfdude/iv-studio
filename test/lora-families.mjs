// LoRAs for every model family (src/service/civitai.js LORA_FAMILIES): each family IV Studio runs is listed with
// Civitai's base-model names, LoRAs on this PC are sorted by what Civitai says or by their folder or file name, and
// the families line up with Create -> Image's (images.js).
import assert from 'node:assert/strict'
import { LORA_FAMILIES, familyById, familyOf } from '../src/service/civitai.js'
import { IMAGE_FAMILIES } from '../src/service/images.js'

let n = 0
const ok = (name, fn) => (fn(), n++, console.log('ok ', name))

ok('every picture family in Create -> Image has a LoRA family, with the same id', () => {
  for (const f of IMAGE_FAMILIES) assert.ok(familyById(f.id), `no LoRA family for ${f.id}`)
  assert.ok(familyById('h3') && familyById('ltx') && familyById('wan'))
  assert.equal(new Set(LORA_FAMILIES.map((f) => f.id)).size, LORA_FAMILIES.length)
})

ok('names and Civitai base models find the family', () => {
  const by = {
    'MiniMax H3/tess/tess_mmh3-000040.safetensors': 'h3',
    'MiniMax H3 Image/painterly.safetensors': 'h3image',
    'h3_image_style.safetensors': 'h3image',
    'MiniMax H3/Styles/MM-H3 - Disney Renaissance Style v2.safetensors': 'h3',
    'Flux 3/solar.safetensors': 'flux3',
    'Flux3 Klein/x.safetensors': 'flux3',
    'Flux.2/klein_style.safetensors': 'flux2',
    'Krea2/Styles/a.safetensors': 'krea2',
    'Qwen 2.1/qwen-image-2.1-outpaint-v2.safetensors': 'qwen21',
    'Z-Image/x.safetensors': 'zimage',
    'SDXL/ponystyle.safetensors': 'sdxl',
    'Moss/m.safetensors': 'moss',
    'LTX/ltx-2.5-ic.safetensors': 'ltx',
    'wan2.1/crying_20_epochs.safetensors': 'wan',
    'misc.safetensors': null
  }
  for (const [name, want] of Object.entries(by)) assert.equal(familyOf({ name }), want, name)
  assert.equal(familyOf({ name: 'whatever.safetensors', civitai: { baseModel: 'Flux.3 Klein' } }), 'flux3')
  assert.equal(familyOf({ name: 'MiniMax H3/x.safetensors', civitai: { baseModel: 'SDXL 1.0' } }), 'sdxl', 'Civitai wins over the folder')
  assert.equal(familyOf({ name: 'x', civitai: { baseModel: 'Something new' } }), null)
})

console.log(`\n${n} passed`)
