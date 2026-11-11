// The SDXL and H3-still picture families (src/service/images.js) without ComfyUI: which files belong to them, and
// the graphs they build.
//   node test/image-families.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { familyOfModel, imageGraph, IMAGE_FAMILIES } from '../src/service/images.js'

let n = 0
const ok = (name, fn) => {
  fn()
  n++
  console.log(`ok  ${name}`)
}
const classes = (g) => Object.values(g).map((x) => x.class_type)

ok('SDXL checkpoints are recognised by name; other families keep theirs', () => {
  for (const f of ['SDXL\\sd_xl_base_1.0.safetensors', 'juggernautXL_v9.safetensors', 'ponyDiffusionV6XL.safetensors', 'illustriousXL_v01.safetensors', 'realvisxlV50.safetensors']) assert.equal(familyOfModel(f.split('\\').pop())?.id, 'sdxl', f)
  assert.equal(familyOfModel('Minimax H3\\minimax_h3_fl2va_pruned_int8_convrot.safetensors')?.id, 'h3')
  assert.equal(familyOfModel('Flux 2\\flux-2-klein-9b.safetensors')?.id, 'flux2')
  assert.equal(familyOfModel('z_image_turbo_bf16.safetensors')?.id, 'zimage')
  assert.equal(familyOfModel('ltx-2.3-22b-distilled-fp8.safetensors'), null)
})

ok('SDXL: ComfyUI’s template, LoRAs on the model and the text encoder', () => {
  const g = imageGraph({ family: 'sdxl', unet: 'SDXL\\sd_xl_base_1.0.safetensors', loras: [{ name: 'xl_style.safetensors', strength: 0.7 }], prompt: 'a red fox', width: 1024, height: 1024, count: 2, seed: 5, steps: 30, cfg: 6, prefix: 'p' })
  assert.deepEqual(classes(g), ['CheckpointLoaderSimple', 'LoraLoader', 'CLIPTextEncode', 'CLIPTextEncode', 'EmptyLatentImage', 'KSampler', 'VAEDecode', 'SaveImage'])
  const k = Object.values(g).find((x) => x.class_type === 'KSampler').inputs
  assert.deepEqual([k.sampler_name, k.scheduler, k.steps, k.cfg], ['dpmpp_2m', 'karras', 30, 6])
  assert.equal(Object.values(g).find((x) => x.class_type === 'EmptyLatentImage').inputs.batch_size, 2)
  const lora = Object.values(g).find((x) => x.class_type === 'LoraLoader').inputs
  assert.deepEqual([lora.strength_model, lora.strength_clip], [0.7, 0.7])
  assert.deepEqual(Object.values(g).find((x) => x.class_type === 'VAEDecode').inputs.vae, ['1', 2], 'the checkpoint’s own VAE')
})

ok('H3 still: the shot’s text mode cut short, turbo LoRA first, a middle frame of each take saved', () => {
  const h3 = IMAGE_FAMILIES.find((f) => f.id === 'h3')
  const g = imageGraph({ family: 'h3', unet: 'Minimax H3\\minimax_h3_fl2va_pruned_int8_convrot.safetensors', te: 'qwen3vl_32b_minimax_h3_int4_convrot.safetensors', vae: 'minimax_h3_video_vae_int8_convrot.safetensors', turbo: 'minimax_h3_DMAD_4step_full_lora_avg_rank_39_bf16.safetensors', loras: [{ name: 'MiniMax H3\\tess\\tess.safetensors', strength: 0.8 }], prompt: 't3ss4 smiles', width: 1024, height: 576, count: 2, seed: 42, steps: 8, cfg: 1, prefix: 'p' })
  const c = classes(g)
  assert.equal(c.filter((x) => x === 'SaveImage').length, 2)
  assert.equal(c.filter((x) => x === 'SamplerCustomAdvanced').length, 2)
  const loras = Object.values(g).filter((x) => x.class_type === 'LoraLoaderModelOnly').map((x) => x.inputs.lora_name)
  assert.deepEqual(loras, ['minimax_h3_DMAD_4step_full_lora_avg_rank_39_bf16.safetensors', 'MiniMax H3\\tess\\tess.safetensors'])
  const cond = Object.values(g).find((x) => x.class_type === 'MiniMaxH3ImageToVideo').inputs
  assert.equal(cond.length, h3.frames)
  assert.deepEqual(Object.values(g).filter((x) => x.class_type === 'RandomNoise').map((x) => x.inputs.noise_seed), [42, 1042])
  const pick = Object.values(g).find((x) => x.class_type === 'ImageFromBatch').inputs
  assert.equal(pick.batch_index, Math.floor(h3.frames / 2))
  assert.equal(Object.values(g).find((x) => x.class_type === 'CLIPLoader').inputs.type, 'minimax')
  assert.equal(Object.values(g).find((x) => x.class_type === 'BasicScheduler').inputs.scheduler, 'beta')
})

// GitHub #20: a picture model's files that Setup downloads must be ones the picture code takes, or Setup says
// "installed" and Create → Image and Projects say "missing" (Z-Image's text encoder was the fp8 file)
ok('every picture-model file Setup downloads is one its family accepts', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../resources/models.json', import.meta.url), 'utf8'))
  const fileOf = (id) => {
    const m = manifest.models.find((x) => x.id === id)
    return m && (m.filename || m.url.split('/').pop().split('?')[0])
  }
  const z = IMAGE_FAMILIES.find((f) => f.id === 'zimage')
  assert.ok(z.te.files.includes(fileOf('zimage_te')), `zimage text encoder ${fileOf('zimage_te')} not in ${z.te.files}`)
  assert.ok(z.vae.includes(fileOf('zimage_vae')), `zimage vae ${fileOf('zimage_vae')}`)
  assert.ok(z.unet.test(fileOf('zimage')), `zimage model ${fileOf('zimage')}`)
})

console.log(`\n${n} checks passed`)
