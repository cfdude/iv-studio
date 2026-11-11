// MiniMax H3 Image in Create -> Image (src/service/images.js): its sizes against MiniMax's own table, the graph against
// ComfyUI's two templates (image_minimax_h3_image_t2i and _edit), how it's found on a ComfyUI (and what's missing on an
// older one), and its download group.
import { IMAGE_FAMILIES, Images, familyOfModel, imageGraph, imageSize } from '../src/service/images.js'
import { MODEL_GROUPS } from '../src/service/hardware.js'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

let failed = 0
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && extra ? ` -> ${extra}` : ''}`)
  if (!ok) failed++
}
const here = path.dirname(fileURLToPath(import.meta.url))
const fam = IMAGE_FAMILIES.find((f) => f.id === 'h3image')

// MiniMax's 16 MP table (README) and the templates' 4 MP default (2048x2048)
const table = { '1:1': [4096, 4096], '4:3': [4736, 3552], '3:4': [3552, 4736], '3:2': [5024, 3360], '2:3': [3360, 5024], '16:9': [5472, 3072], '9:16': [3072, 5472], '21:9': [6272, 2688] }
for (const [a, [w, h]] of Object.entries(table)) {
  const s = imageSize(a, 16)
  check(`16 MP ${a} is ${w}x${h}`, s.width === w && s.height === h, `${s.width}x${s.height}`)
}
check('4 MP square is the templates’ 2048x2048', imageSize('1:1', 4).width === 2048)
// create() keeps the other families at 4 MP and lifts H3 Image to 4 (checked below with a stand-in ComfyUI)

// finding it
check('the int8 checkpoint is H3 Image', familyOfModel('minimax_h3_image_pruned_int8_convrot.safetensors')?.id === 'h3image')
check('the w4a8 and bf16 ones too', familyOfModel('minimax_h3_image_pruned_w4a8.safetensors')?.id === 'h3image' && familyOfModel('MiniMax H3/minimax_h3_image_pruned_bf16.safetensors')?.id === 'h3image')
check('H3 video checkpoints are not', familyOfModel('minimax_h3_fl2va_pruned_int8_convrot.safetensors')?.id !== 'h3image' && familyOfModel('minimax_h3_ref2va_pruned_int8_convrot.safetensors')?.id !== 'h3image')
check('6 steps, no CFG, euler', fam.steps === 6 && fam.cfg === 1 && fam.sampler === 'euler')
check('edits with up to 16 pictures', fam.edit === true && fam.maxRefs === 16)
check('MiniMax’s prompt tips go with it', /<Picture 1>/.test(fam.tips) && /quotes/.test(fam.tips))

// the graph, generate
const nodes = (g) => Object.values(g)
const byType = (g, t) => nodes(g).filter((n) => n.class_type === t)
let g = imageGraph({ family: 'h3image', unet: 'minimax_h3_image_pruned_int8_convrot.safetensors', te: 'qwen3vl_32b_minimax_h3_int4_convrot.safetensors', vae: 'minimax_h3_image_vae_fp16.safetensors', prompt: 'A plush fox', width: 2048, height: 2048, count: 2, seed: 7, steps: 6, cfg: 1, prefix: 'x' })
const cond = byType(g, 'MiniMaxH3ImageConditioning')[0]
check('generate: H3 Image conditioning with the prompt and size', cond && cond.inputs.prompt === 'A plush fox' && cond.inputs.width === 2048 && cond.inputs.height === 2048)
check('generate: H3’s text encoder as type minimax', byType(g, 'CLIPLoader')[0]?.inputs.type === 'minimax')
const ks = byType(g, 'KSampler')[0]?.inputs
check('generate: KSampler 6 steps, cfg 1, euler, simple', ks && ks.steps === 6 && ks.cfg === 1 && ks.sampler_name === 'euler' && ks.scheduler === 'simple')
check('generate: the negative is zeroed (no CFG)', byType(g, 'ConditioningZeroOut').length === 1)
check('generate: the latent comes from the conditioning, repeated for 2', byType(g, 'RepeatLatentBatch')[0]?.inputs.amount === 2)
check('generate: decoded and saved', byType(g, 'VAEDecode').length === 1 && byType(g, 'SaveImage').length === 1)

// the graph, edit with three pictures
g = imageGraph({ family: 'h3image', mode: 'edit', unet: 'u', te: 't', vae: 'v', prompt: 'Put the jacket from <Picture 2> on her', width: 2048, height: 2048, seed: 1, steps: 6, cfg: 1, refs: ['a.png', 'b.png', 'c.png'], megapixels: 4, prefix: 'x' })
const ec = byType(g, 'MiniMaxH3ImageConditioning')[0]?.inputs
check('edit: each picture loaded', byType(g, 'LoadImage').length === 3)
check('edit: each scaled to 4 MP on a 32-pixel grid', byType(g, 'ImageScaleToTotalPixels').every((n) => n.inputs.megapixels === 4 && n.inputs.resolution_steps === 32) && byType(g, 'ImageScaleToTotalPixels').length === 3)
check('edit: pictures in order as images.image_1..3', ['images.image_1', 'images.image_2', 'images.image_3'].every((k) => Array.isArray(ec?.[k])) && !ec['images.image_4'])
check('edit: the result takes the first picture’s shape', Array.isArray(ec?.width) && byType(g, 'GetImageSize').length === 1)
g = imageGraph({ family: 'h3image', mode: 'edit', unet: 'u', te: 't', vae: 'v', prompt: 'p', width: 5472, height: 3072, seed: 1, steps: 6, cfg: 1, refs: ['a.png'], megapixels: 16, keepAspect: true, prefix: 'x' })
check('edit with keepAspect: the size asked for', byType(g, 'MiniMaxH3ImageConditioning')[0]?.inputs.width === 5472 && byType(g, 'GetImageSize').length === 0)

// status on a ComfyUI: with and without the new node
const combo = (opts) => ({ input: { required: { x: [opts] } } })
const infoOf = (withNode) => ({
  UNETLoader: { input: { required: { unet_name: [['minimax_h3_image_pruned_int8_convrot.safetensors', 'Flux 3/flux3-image-klein-int8-convrot.safetensors']] } } },
  CLIPLoader: { input: { required: { clip_name: [['qwen3vl_32b_minimax_h3_int4_convrot.safetensors', 'qwen3vl_4b_int8_convrot.safetensors']], type: [['minimax', 'flux3']] } } },
  VAELoader: { input: { required: { vae_name: [['minimax_h3_image_vae_fp16.safetensors', 'flux2-vae.safetensors']] } } },
  LoraLoaderModelOnly: { input: { required: { lora_name: [[]] } } },
  CheckpointLoaderSimple: { input: { required: { ckpt_name: [[]] } } },
  ...(withNode ? { MiniMaxH3ImageConditioning: combo([]) } : {})
})
const statusWith = async (withNode) => (await new Images({ studio: { comfy: { objectInfo: async () => infoOf(withNode) } }, dataDir: here }).status()).families.find((f) => f.id === 'h3image')
let st = await statusWith(true)
check('status: ready with its checkpoint, H3’s int4 text encoder and its VAE', st.ready && st.models.length === 1 && /int4/.test(st.te) && st.edit === true, JSON.stringify(st))
check('status: the page gets its sizes, tips and 16 pictures', st.sizes?.join() === '4,8,16' && st.defaultMp === 4 && st.maxRefs === 16 && !!st.tips && st.noNegative === true)
st = await statusWith(false)
check('status: an older ComfyUI says to update it', !st.ready && st.missing.some((m) => /update ComfyUI/.test(m)), JSON.stringify(st.missing))

// create() with a stand-in ComfyUI: the graph it would send, at the size it settles on
const tmp = fs.mkdtempSync(path.join(path.dirname(here), 'test', '.h3image-'))
const sent = []
const fake = { comfy: { objectInfo: async () => infoOf(true), upload: async (p) => path.basename(p) }, createProject: () => ({ id: 'p1' }), submitGraph: async (j) => (sent.push(j.graph), { id: 'j1', status: 'queued' }) }
const imgs = new Images({ studio: fake, dataDir: tmp })
let rec = await imgs.create({ model: 'minimax_h3_image_pruned_int8_convrot.safetensors', prompt: 'A plush fox', aspect: '16:9' })
check('create: H3 Image left at 1 MP is lifted to its 4 MP', rec.megapixels === 4 && byType(sent.at(-1), 'MiniMaxH3ImageConditioning')[0].inputs.width === 2720, `${rec.megapixels} MP, ${byType(sent.at(-1), 'MiniMaxH3ImageConditioning')[0]?.inputs.width}`)
rec = await imgs.create({ model: 'minimax_h3_image_pruned_int8_convrot.safetensors', prompt: 'A plush fox', aspect: '16:9', megapixels: 16 })
check('create: H3 Image at 16 MP is 5472x3072', byType(sent.at(-1), 'MiniMaxH3ImageConditioning')[0].inputs.width === 5472)
rec = await imgs.create({ model: 'Flux 3/flux3-image-klein-int8-convrot.safetensors', prompt: 'A plush fox', megapixels: 16 }).catch((e) => ({ error: e.message }))
check('create: another family asked for 16 MP stays at 4', !rec.error && rec.megapixels === 4 && byType(sent.at(-1), 'EmptyFlux2LatentImage')[0]?.inputs.width === 2048, JSON.stringify(rec).slice(0, 200))
fs.rmSync(tmp, { recursive: true, force: true })

// the download
const group = MODEL_GROUPS.find((m) => m.id === 'h3image')
const manifest = JSON.parse(fs.readFileSync(path.join(here, '..', 'resources', 'models.json'), 'utf8')).models
const m = (id) => manifest.find((x) => x.id === id)
check('download: its own group, sharing H3’s text encoder', group && group.ids.join() === 'h3image,h3image_vae,text_encoder')
check('download: the checkpoint from Comfy-Org at its exact size', m('h3image')?.url.endsWith('/diffusion_models/minimax_h3_image_pruned_int8_convrot.safetensors') && m('h3image').size === 20979314802 && m('h3image').folder === 'diffusion_models')
check('download: the VAE at its exact size', m('h3image_vae')?.size === 1168505312 && m('h3image_vae').folder === 'vae')
check('download: optional, never assumed', m('h3image').optional && m('h3image_vae').optional)

console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
