// Create -> Image: pictures made on this PC's ComfyUI with the person's own image models. Six families,
// each built after ComfyUI's official template for it (Comfy-Org's workflow templates, 2026-10), with the
// person's checkpoint, LoRAs (model-only), size, count and seed. Generate makes pictures from a prompt; Edit
// changes reference pictures with an instruction and only lists the families that can.
//
// A picture set is a ComfyUI job (a project with tool 'image'); when it finishes its pictures are copied
// into the app data's images/ folder, where the Library, the MCP server and Create's gallery find them.
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { comboOptions, modelOptions, resolveModel } from './setup.js'
import ffmpegStatic from 'ffmpeg-ffprobe-static'
import { probe } from './media.js'
import { DEPTH_OUTPUTS, PICTURE_TOOLS, RELIGHT, depthGraph, inpaintGraph, relightGraph, relightText, removeBgGraph, upscaleGraph } from './picturetools.js'

// the bundled ffprobe, outside the asar in a packaged app (an upscale reads the picture's size)
const FFPROBE = ffmpegStatic.ffprobePath?.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`)

// unet: the family's checkpoints, by their folder or name in ComfyUI's diffusion_models.
// te / vae: the text encoder and VAE the official template uses, then compatible ones, first found wins.
// steps / cfg: the template's settings; base (undistilled) checkpoints get their own.
// loras: how the family's LoRAs are named (their folder or file), for the LoRA picker.
export const IMAGE_FAMILIES = [
  {
    id: 'flux2',
    label: 'Flux.2 Klein 9B',
    unet: /^flux ?2[\\/]|flux[.-]?2[-_ ]klein/i,
    te: { type: 'flux2', files: ['qwen_3_8b.safetensors', 'qwen_3_8b_fp8mixed.safetensors'] },
    vae: ['flux2-vae.safetensors', 'full_encoder_small_decoder.safetensors'],
    steps: 4,
    cfg: 1,
    base: { match: /base/i, steps: 20, cfg: 5 },
    edit: true,
    loras: /flux ?2|klein|klien/i,
    licence: 'FLUX Non-Commercial License (9B)',
    note: 'Fast, and edits with several reference pictures.'
  },
  {
    id: 'flux3',
    label: 'Flux 3 Klein',
    unet: /^flux ?3[\\/]|flux3[-_]image[-_]klein/i,
    te: { type: 'flux3', files: ['qwen3vl_4b_int8_convrot.safetensors', 'qwen3vl_4b_fp8_scaled.safetensors'] },
    vae: ['flux2-vae.safetensors'],
    steps: 15,
    cfg: 1,
    sampler: 'er_sde',
    editSteps: 16,
    edit: true,
    loras: /flux ?3|flux3/i,
    licence: 'FLUX Kommunity License',
    note: 'Black Forest Labs’ newest open model; edits keep what you don’t mention.'
  },
  {
    id: 'krea2',
    label: 'Krea 2',
    unet: /^krea ?2[\\/]|krea2/i,
    te: { type: 'krea2', files: ['qwen3vl_4b_fp8_scaled.safetensors', 'qwen3vl_4b_int8_convrot.safetensors'] },
    vae: ['qwen_image_vae.safetensors'],
    steps: 8,
    cfg: 1,
    base: { match: /^(?!.*turbo)/i, steps: 20, cfg: 3 },
    edit: 'lora', // with the Krea 2 Identity Edit LoRA and the comfyui-krea2edit nodes
    editLora: /identity[_ -]?edit/i,
    loras: /krea/i,
    licence: 'Krea 2 licence (see its model page)',
    note: 'Aesthetic, photographic looks, and many fine-tunes.'
  },
  {
    id: 'moss',
    label: 'Moss',
    unet: /^moss[\\/]|moss[_-]image/i,
    te: { type: 'moss_image', files: ['qwen3.5_9b_w4a8_gptq.safetensors', 'qwen3.5_9b_uncensored_int8_convrot.safetensors', 'qwen3.5_9b_int8_convrot.safetensors'] },
    vae: ['flux2-vae_small.safetensors', 'flux2-vae.safetensors'],
    steps: 25,
    cfg: 2.5,
    sampler: 'er_sde',
    negative: 'worst quality, bad anatomy, watermark, jpeg artifact',
    edit: false,
    noEdit: 'Moss edits through an edit LoRA that needs a newer ComfyUI.',
    loras: /moss/i,
    licence: 'Apache-2.0',
    note: 'Reads a full scene description, and spells out text well.'
  },
  {
    id: 'qwen21',
    label: 'Qwen Image 2.1',
    unet: /qwen[-_ ]image[-_ ]2\.1/i,
    te: { type: 'qwen_image', files: ['qwen3vl_8b_int8_convrot.safetensors', 'qwen3vl_8b_int8_uncensored.safetensors'] },
    vae: ['qwen_image_2.1_vae_bf16.safetensors'],
    steps: 25,
    cfg: 1,
    edit: true,
    loras: /qwen[ _-]?(image[ _-]?)?2\.1|qwen 2\.1/i,
    licence: 'Apache-2.0',
    note: 'Strong at text in pictures; edits with up to three references.'
  },
  {
    id: 'zimage',
    label: 'Z-Image Turbo',
    unet: /z[-_ ]?image/i,
    te: { type: 'lumina2', files: ['qwen_3_4b_fp8_mixed.safetensors', 'qwen_3_4b.safetensors', 'qwen_3_4b_bf16.safetensors'] },
    vae: ['ae.safetensors', 'Z-ImageVAE.safetensors'],
    steps: 8,
    cfg: 1,
    sampler: 'res_multistep',
    edit: false,
    noEdit: 'Z-Image Turbo makes pictures from a prompt only.',
    loras: /z[-_ ]?image|\bzit\b/i,
    licence: 'Apache-2.0',
    note: 'Very fast photographic pictures.'
  },
  {
    // one file holds the model, text encoders and VAE (CheckpointLoaderSimple), as ComfyUI's SDXL template loads it;
    // any SDXL fine-tune in ComfyUI's checkpoints folder counts
    id: 'sdxl',
    label: 'SDXL',
    unet: /(?!)/,
    checkpoint: /sdxl|sd_xl|[-_ ]xl[-_ .]|xl[-_]?v?\d|\bxl\b|pony|illustrious|noobai|juggernaut|realvis|dreamshaper/i,
    steps: 30,
    cfg: 6,
    sampler: 'dpmpp_2m',
    scheduler: 'karras',
    negative: 'blurry, low quality, worst quality, watermark, text, deformed hands',
    edit: false,
    noEdit: 'SDXL makes pictures from a prompt. To change a picture, use Flux or Qwen Image.',
    loras: /sdxl|\bxl\b|[-_]xl[-_.]|pony|illustrious|noob/i,
    licence: 'CreativeML Open RAIL++-M (SDXL base); fine-tunes have their own',
    note: 'The classic: thousands of fine-tunes and LoRAs on Civitai.'
  },
  {
    // MiniMax-H3-Image, after ComfyUI's two templates (image_minimax_h3_image_t2i and _edit, 2026-11-10): one checkpoint
    // that makes pictures and edits with up to 16 reference pictures, distilled to 6 steps with no CFG, at 4 to 16 MP
    // (it's weak below 4). Its text encoder is H3's own Qwen3-VL 32B, unchanged, so any H3 text encoder works.
    id: 'h3image',
    label: 'MiniMax H3 Image',
    unet: /minimax[_ -]?h3[_ -]?image/i,
    te: { type: 'minimax', files: ['qwen3vl_32b_minimax_h3_int8_convrot.safetensors', 'qwen3vl_32b_minimax_h3_int4_convrot.safetensors', 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors', 'qwen3vl_32b_minimax_h3_bf16.safetensors'] },
    vae: ['minimax_h3_image_vae_fp16.safetensors'],
    steps: 6,
    cfg: 1,
    sampler: 'euler',
    edit: true,
    maxRefs: 16,
    node: 'MiniMaxH3ImageConditioning',
    sizes: [4, 8, 16],
    defaultMp: 4,
    noNegative: true,
    loras: /minimax ?h3[ _-]?image|h3[ _-]?image/i,
    licence: 'MiniMax-H3-Image Community License',
    note: 'Big, detailed pictures (up to 16 MP) that follow long descriptions closely; edits with up to 16 pictures. Needs a lot of memory at 16 MP. Edits with the int8 download come out heavily over-sharpened, even in ComfyUI’s own template; new pictures are clean.',
    // MiniMax's own prompt guide (skills/h3-image-prompt-writing), in short, for whoever writes the prompt
    tips: 'Describe the finished picture in plain English, around one clear focus: what is in it, where things are (left/right, front/back), light, style and medium. Keep every name, count and detail asked for. Put any words that should appear in the picture in quotes, exactly as written. For an edit, call the pictures <Picture 1>, <Picture 2> in the order given, say what stays (for example "<Picture 1> is fully preserved."), then describe the finished result rather than giving an order. No negative prompt.'
  },
  {
    // a frame from a very short MiniMax H3 render (text mode, as a shot's first pass): pictures in the look of your H3
    // shots, with your H3 character LoRAs. Its text encoder and VAE are H3's own (Setup); the DMAD 4-step LoRA keeps
    // it at 8 steps.
    id: 'h3',
    label: 'MiniMax H3 (a still)',
    unet: /fl2va/i,
    te: { type: 'minimax', files: ['qwen3vl_32b_minimax_h3_int4_convrot.safetensors', 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors', 'qwen3vl_32b_minimax_h3_int8_convrot.safetensors', 'qwen3vl_32b_minimax_h3_bf16.safetensors'] },
    vae: ['minimax_h3_video_vae_int8_convrot.safetensors', 'minimax_h3_video_vae_fp16.safetensors'],
    turbo: /DMAD.*4step/i,
    steps: 8,
    cfg: 1,
    sampler: 'er_sde',
    scheduler: 'beta',
    frames: 22,
    edit: false,
    noEdit: 'An H3 still comes from a prompt, with your H3 character LoRAs.',
    loras: /minimax ?h3|\bh3\b|t3ss4|tess|theo/i,
    licence: 'MiniMax H3 Community License (excludes the EU, UK, South Korea and USA)',
    note: 'A frame of a very short H3 render: the look and characters of your H3 shots. Slower than the picture models.'
  }
]

export const IMAGE_ASPECTS = { '1:1': 1, '16:9': 16 / 9, '9:16': 9 / 16, '4:3': 4 / 3, '3:4': 3 / 4, '3:2': 3 / 2, '2:3': 2 / 3, '21:9': 21 / 9 }
export const IMAGE_DEFAULTS = { aspect: '1:1', megapixels: 1, count: 1 }

const now = () => new Date().toISOString()
const slug = (s) => String(s || 'image').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'image'
const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(value, null, 2))
}
const DONE = ['success', 'error', 'cancelled']

// Width and height for an aspect at about this many megapixels, on a 32-pixel grid every family accepts. Most
// families stop at 4 MP; MiniMax H3 Image works best at 16 (its own table: 4096x4096, 5472x3072, 6272x2688...).
export function imageSize(aspect, megapixels) {
  const ar = IMAGE_ASPECTS[aspect] || 1
  const px = Math.max(0.25, Math.min(20, Number(megapixels) || 1)) * 1024 * 1024
  const w = Math.round(Math.sqrt(px * ar) / 32) * 32
  const h = Math.round(Math.sqrt(px / ar) / 32) * 32
  return { width: w, height: h }
}

// The family a checkpoint belongs to, by its name.
export const familyOfModel = (unet) => IMAGE_FAMILIES.find((f) => f.unet.test(unet)) || IMAGE_FAMILIES.find((f) => f.checkpoint?.test(unet)) || null

// Builds the API graph. refs: picture names already in ComfyUI's input folder (Edit).
export function imageGraph({ family, mode = 'generate', unet, te, vae, loras = [], prompt, negative = '', width, height, count = 1, seed, steps, cfg, refs = [], megapixels = 1, editLora = null, turbo = null, prefix, keepAspect = false }) {
  const f = IMAGE_FAMILIES.find((x) => x.id === family)
  const g = {}
  let n = 0
  const add = (class_type, inputs) => ((g[String(++n)] = { class_type, inputs }), String(n))
  if (family === 'sdxl') {
    // ComfyUI's SDXL template: the checkpoint, LoRAs on model and text encoder, KSampler, decode
    const ckpt = add('CheckpointLoaderSimple', { ckpt_name: unet })
    let model = [ckpt, 0]
    let clip = [ckpt, 1]
    for (const l of loras) {
      const node = add('LoraLoader', { model, clip, lora_name: l.name, strength_model: Number(l.strength ?? 1), strength_clip: Number(l.strength ?? 1) })
      model = [node, 0]
      clip = [node, 1]
    }
    const pos = [add('CLIPTextEncode', { clip, text: prompt }), 0]
    const neg = [add('CLIPTextEncode', { clip, text: negative || f.negative }), 0]
    const latent = [add('EmptyLatentImage', { width, height, batch_size: Math.max(1, Math.min(4, Math.round(count))) }), 0]
    const out = [add('KSampler', { model, seed, steps, cfg, sampler_name: f.sampler, scheduler: f.scheduler, denoise: 1, positive: pos, negative: neg, latent_image: latent }), 0]
    add('SaveImage', { images: [add('VAEDecode', { samples: out, vae: [ckpt, 2] }), 0], filename_prefix: prefix })
    return g
  }
  if (family === 'h3') {
    // IV Studio's text-mode shot, cut short: H3 conditioning and its audio+video latent, the turbo LoRA and the
    // person's LoRAs, er_sde on a beta schedule; one frame from the middle of each take is kept
    let model = [add('UNETLoader', { unet_name: unet, weight_dtype: 'default' }), 0]
    for (const l of [...(turbo ? [{ name: turbo, strength: 1 }] : []), ...loras]) model = [add('LoraLoaderModelOnly', { model, lora_name: l.name, strength_model: Number(l.strength ?? 1) }), 0]
    const clip = [add('CLIPLoader', { clip_name: te, type: f.te.type, device: 'default' }), 0]
    const vaeOut = [add('VAELoader', { vae_name: vae }), 0]
    const cond = add('MiniMaxH3ImageToVideo', { clip, vae: vaeOut, prompt, width, height, length: f.frames })
    const guider = [add('BasicGuider', { model, conditioning: [cond, 0] }), 0]
    const sampler = [add('KSamplerSelect', { sampler_name: f.sampler }), 0]
    const sigmas = [add('BasicScheduler', { model, scheduler: f.scheduler, steps, denoise: 1 }), 0]
    for (let i = 0; i < Math.max(1, Math.min(4, Math.round(count))); i++) {
      const out = add('SamplerCustomAdvanced', { noise: [add('RandomNoise', { noise_seed: seed + i * 1000 }), 0], guider, sampler, sigmas, latent_image: [cond, 1] })
      const video = [add('LTXVSeparateAVLatent', { av_latent: [out, 0] }), 0]
      const frames = [add('VAEDecode', { samples: video, vae: vaeOut }), 0]
      add('SaveImage', { images: [add('ImageFromBatch', { image: frames, batch_index: Math.floor(f.frames / 2), length: 1 }), 0], filename_prefix: prefix })
    }
    return g
  }
  const unetNode = add('UNETLoader', { unet_name: unet, weight_dtype: 'default' })
  let model = [unetNode, 0]
  // Krea 2 edits through its identity edit LoRA, first in the chain
  for (const l of [...(mode === 'edit' && editLora ? [{ name: editLora, strength: 1 }] : []), ...loras]) model = [add('LoraLoaderModelOnly', { model, lora_name: l.name, strength_model: Number(l.strength ?? 1) }), 0]
  const clip = [add('CLIPLoader', { clip_name: te, type: f.te.type, device: 'default' }), 0]
  const vaeOut = [add('VAELoader', { vae_name: vae }), 0]
  const batch = Math.max(1, Math.min(4, Math.round(count)))
  const sampler = f.sampler || 'euler'
  const encode = (text) => [add('CLIPTextEncode', { clip, text }), 0]
  const ksample = (m, pos, neg, latent, stepsN = steps) => [add('KSampler', { model: m, seed, steps: stepsN, cfg, sampler_name: sampler, scheduler: 'simple', denoise: 1, positive: pos, negative: neg, latent_image: latent }), 0]
  const save = (samples) => add('SaveImage', { images: [add('VAEDecode', { samples, vae: vaeOut }), 0], filename_prefix: prefix })
  const negOf = (pos) => (cfg > 1 ? encode(negative || f.negative || '') : [add('ConditioningZeroOut', { conditioning: pos }), 0])
  const loadRefs = () => refs.map((name) => [add('LoadImage', { image: name }), 0])
  const sized = (img) => [add('ImageScaleToTotalPixels', { image: img, upscale_method: 'lanczos', megapixels, resolution_steps: 16 }), 0]
  const repeat = (latent) => (batch > 1 ? [add('RepeatLatentBatch', { samples: latent, amount: batch }), 0] : latent)

  if (family === 'flux2') {
    let pos = encode(prompt)
    let neg = cfg > 1 ? encode(negative) : [add('ConditioningZeroOut', { conditioning: pos }), 0]
    let w = width
    let h = height
    if (mode === 'edit') {
      const imgs = loadRefs().map(sized)
      // an edit takes its first picture's size, unless keepAspect asks for width x height (a film's frame)
      if (!keepAspect) {
        const size = add('GetImageSize', { image: imgs[0] })
        ;[w, h] = [[size, 0], [size, 1]]
      }
      for (const img of imgs) {
        const lat = [add('VAEEncode', { pixels: img, vae: vaeOut }), 0]
        pos = [add('ReferenceLatent', { conditioning: pos, latent: lat }), 0]
        neg = [add('ReferenceLatent', { conditioning: neg, latent: lat }), 0]
      }
    }
    const guider = [add('CFGGuider', { model, positive: pos, negative: neg, cfg }), 0]
    const out = add('SamplerCustomAdvanced', {
      noise: [add('RandomNoise', { noise_seed: seed }), 0],
      guider,
      sampler: [add('KSamplerSelect', { sampler_name: 'euler' }), 0],
      sigmas: [add('Flux2Scheduler', { steps, width: w, height: h }), 0],
      latent_image: [add('EmptyFlux2LatentImage', { width: w, height: h, batch_size: batch }), 0]
    })
    save([out, 0])
  } else if (family === 'flux3') {
    const pos = encode(prompt)
    const neg = [add('ConditioningZeroOut', { conditioning: pos }), 0]
    if (mode === 'edit') {
      const inputs = { positive: pos, negative: neg, vae: vaeOut, resolution: 'resize', 'resolution.megapixels': megapixels }
      loadRefs().forEach((img, i) => (inputs[`images.image${i}`] = img))
      const ref = add('ReferenceMultiLatent', inputs)
      const latent = keepAspect ? [add('EmptyFlux2LatentImage', { width, height, batch_size: batch }), 0] : repeat([ref, 2])
      save(ksample(model, [ref, 0], [ref, 1], latent, f.editSteps))
    } else save(ksample(model, pos, neg, [add('EmptyFlux2LatentImage', { width, height, batch_size: batch }), 0]))
  } else if (family === 'krea2') {
    if (mode === 'edit') {
      const img = sized(loadRefs()[0])
      const size = add('GetImageSize', { image: img })
      const target = [add('EmptySD3LatentImage', { width: [size, 0], height: [size, 1], batch_size: 1 }), 0]
      const patched = [add('Krea2EditModelPatch', { model, source_latent: [add('VAEEncode', { pixels: img, vae: vaeOut }), 0], vae: vaeOut, source_image: img, target_latent: target, ref_boost: 1, ref_boost_a: 1, fit_mode: 'fit' }), 0]
      const pos = [add('Krea2EditGroundedEncode', { clip, prompt, image: img, grounding_px: 1024, system_prompt: '' }), 0]
      const neg = [add('Krea2EditGroundedEncode', { clip, prompt: negative || '', image: img, grounding_px: 1024, system_prompt: '' }), 0]
      save(ksample(patched, pos, neg, repeat(target)))
    } else {
      const pos = encode(prompt)
      save(ksample(model, pos, negOf(pos), [add('EmptyLatentImage', { width, height, batch_size: batch }), 0]))
    }
  } else if (family === 'moss') {
    const pos = encode(prompt)
    save(ksample(model, pos, encode(negative || f.negative), [add('EmptyFlux2LatentImage', { width, height, batch_size: batch }), 0]))
  } else if (family === 'qwen21') {
    const cached = [add('QwenImage21Cache', { model, device: 'auto', dtype: 'default' }), 0]
    const inputs = { clip, prompt, negative_prompt: negative || '', resolution: Math.round((Math.sqrt(megapixels) * 1024) / 32) * 32 }
    if (mode === 'edit') {
      inputs.vae = vaeOut
      loadRefs().forEach((img, i) => (inputs[`images.image_${i + 1}`] = img))
    }
    const enc = add('TextEncodeQwenImage21', inputs)
    const latent = mode === 'edit' ? repeat([enc, 2]) : [add('EmptyLatentImage', { width, height, batch_size: batch }), 0]
    save(ksample(cached, [enc, 0], [enc, 1], latent))
  } else if (family === 'h3image') {
    // ComfyUI's MiniMax-H3-Image templates: H3 Image conditioning (the prompt, the size and, for an edit, the
    // reference pictures as <Picture 1>, <Picture 2>...) gives the conditioning and the empty latent; no CFG, so the
    // negative is zeroed; 6 steps of euler. An edit's pictures are scaled to the size asked for (it's weak below 4 MP),
    // on a 32-pixel grid, and the result takes the first picture's shape.
    const inputs = { clip, vae: vaeOut, prompt, width, height }
    if (mode === 'edit') {
      const imgs = loadRefs().map((img) => [add('ImageScaleToTotalPixels', { image: img, upscale_method: 'area', megapixels, resolution_steps: 32 }), 0])
      imgs.forEach((img, i) => (inputs[`images.image_${i + 1}`] = img))
      if (!keepAspect) {
        const size = add('GetImageSize', { image: imgs[0] })
        ;[inputs.width, inputs.height] = [[size, 0], [size, 1]]
      }
    }
    const cond = add('MiniMaxH3ImageConditioning', inputs)
    save(ksample(model, [cond, 0], [add('ConditioningZeroOut', { conditioning: [cond, 0] }), 0], repeat([cond, 1])))
  } else if (family === 'zimage') {
    const shifted = [add('ModelSamplingAuraFlow', { model, shift: 3 }), 0]
    const pos = encode(prompt)
    save(ksample(shifted, pos, negOf(pos), [add('EmptySD3LatentImage', { width, height, batch_size: batch }), 0]))
  } else throw new Error(`Unknown image family "${family}".`)
  return g
}

export class Images {
  constructor({ studio, dataDir }) {
    this.studio = studio
    this.dir = path.join(dataDir, 'images')
  }

  file = () => path.join(this.dir, 'images.json')
  all = () => readJson(this.file(), [])
  saveAll = (list) => writeJson(this.file(), list)

  // What each family can do on this ComfyUI: its checkpoints, the text encoder and VAE found for it, what's
  // missing, and whether it can edit.
  async status() {
    // the person's own cloud (Modal, RunPod) answers from its saved lists plus the models it can download (one pinned
    // model per family, cloud.json); Comfy Cloud has its own, read like this PC's
    let info
    try {
      info = await this.studio.comfy.objectInfo()
    } catch (err) {
      return { error: err.message, families: IMAGE_FAMILIES.map((f) => ({ ...strip(f), ready: false, models: [], missing: [] })) }
    }
    const unets = comboOptions(info, 'UNETLoader', 'unet_name') || []
    const clips = comboOptions(info, 'CLIPLoader', 'clip_name') || []
    const vaes = comboOptions(info, 'VAELoader', 'vae_name') || []
    const loras = comboOptions(info, 'LoraLoaderModelOnly', 'lora_name') || []
    const types = comboOptions(info, 'CLIPLoader', 'type') || []
    const pick = (opts, names) => names.map((n) => opts.find((o) => o.split(/[\\/]/).pop() === n)).find(Boolean) || null
    const checkpoints = comboOptions(info, 'CheckpointLoaderSimple', 'ckpt_name') || []
    const families = IMAGE_FAMILIES.map((f) => {
      if (f.checkpoint) {
        // SDXL-type: the checkpoint is the whole model
        const models = checkpoints.filter((c) => f.checkpoint.test(c.split(/[\\/]/).pop()))
        return { ...strip(f), models, te: null, vae: null, editLora: null, ready: models.length > 0, missing: [], edit: false, editNote: f.noEdit }
      }
      const models = unets.filter((u) => f.unet.test(u) && familyOfModel(u)?.id === f.id)
      const te = pick(clips, f.te.files)
      const vae = pick(vaes, f.vae)
      const missing = [...(te ? [] : [`text encoder ${f.te.files[0]}`]), ...(vae ? [] : [`VAE ${f.vae[0]}`]), ...(types.includes(f.te.type) ? [] : [`ComfyUI support for ${f.label} (update ComfyUI)`])]
      let edit = f.edit === true
      let editNote = f.noEdit || null
      let editLora = null
      if (f.edit === 'lora') {
        editLora = loras.find((l) => f.editLora.test(l)) || null
        const nodes = ['Krea2EditModelPatch', 'Krea2EditGroundedEncode'].every((c) => info[c])
        edit = !!editLora && nodes
        editNote = edit ? null : !nodes ? 'Krea 2 edits need the comfyui-krea2edit nodes.' : 'Krea 2 edits need the Krea 2 Identity Edit LoRA (krea2_identity_edit) in ComfyUI’s loras folder.'
      }
      if (f.id === 'flux3' && !info.ReferenceMultiLatent) [edit, editNote] = [false, 'Flux 3 Klein edits need a newer ComfyUI.']
      // a family built on a node newer than this ComfyUI (MiniMax H3 Image, 2026-11-10)
      if (f.node && !info[f.node]) missing.push(`ComfyUI's ${f.label} support (update ComfyUI)`)
      // H3 stills need H3's turbo LoRA and ComfyUI's own H3 nodes
      let turbo = null
      if (f.turbo) {
        turbo = loras.find((l) => f.turbo.test(l.split(/[\\/]/).pop())) || null
        if (!turbo) missing.push('the DMAD 4-step turbo LoRA (Settings → Setup)')
        if (!info.MiniMaxH3ImageToVideo || !info.LTXVSeparateAVLatent) missing.push('ComfyUI’s MiniMax H3 nodes (update ComfyUI)')
      }
      return { ...strip(f), models, te, vae, editLora, turbo, ready: models.length > 0 && !missing.length, missing, edit: edit && models.length > 0 && !missing.length, canEdit: f.edit !== false, editNote }
    })
    // what each family downloads from Settings → Setup (models.json pictureFamilies), and which of those files this
    // ComfyUI already has, so a family that isn't set up can say what it needs and get it in one click (GitHub #22)
    const manifest = this.studio.manifest?.models || []
    for (const f of families) {
      f.setup = manifest
        .filter((m) => m.pictureFamilies?.includes(f.id))
        .map((m) => ({ id: m.id, label: m.label, size: m.size || 0, present: !!resolveModel(m, modelOptions(info, m) || [])?.file, gated: m.gated || null }))
    }
    return { families, aspects: Object.keys(IMAGE_ASPECTS), defaults: IMAGE_DEFAULTS, remote: !!this.studio.comfy?.remote }
  }

  // Queues a set of pictures. request: { mode: generate|edit, model (a checkpoint), prompt, negative, loras
  // [{name, strength}], aspect, megapixels, count 1-4, seed, steps, cfg, refs [local picture paths] (Edit), name,
  // tag (keeps the set out of the gallery), keepAspect (an edit comes out at aspect, not its picture's shape;
  // Flux.2 and Flux 3 only) }.
  async create({ mode = 'generate', model, prompt = '', negative = '', loras = [], aspect = IMAGE_DEFAULTS.aspect, megapixels = IMAGE_DEFAULTS.megapixels, count = IMAGE_DEFAULTS.count, seed = null, steps = null, cfg = null, refs = [], name, tag = null, keepAspect = false } = {}) {
    const text = String(prompt || '').trim()
    if (!text) throw new Error(mode === 'edit' ? 'Say what to change in the picture.' : 'Describe the picture first.')
    const st = await this.status()
    if (st.error) throw new Error(st.error)
    const fam = st.families.find((f) => f.models.includes(model)) || st.families.find((f) => f.id === familyOfModel(String(model || ''))?.id)
    if (!fam) throw new Error(`"${model}" isn't an image model IV Studio knows. Pick one from list_image_models.`)
    if (!fam.models.includes(model)) throw new Error(`${fam.label} has no checkpoint "${model}" in ComfyUI.`)
    if (!fam.ready) throw new Error(`${fam.label} needs ${fam.missing.join(', ')}.`)
    if (mode === 'edit') {
      if (!fam.edit) throw new Error(fam.editNote || `${fam.label} can't edit pictures.`)
      if (!refs.length) throw new Error('Add the picture to edit.')
      if (fam.id === 'krea2' && refs.length > 1) throw new Error('Krea 2 edits one picture at a time.')
      const most = fam.maxRefs || (fam.id === 'qwen21' ? 3 : 6)
      if (refs.length > most) throw new Error(`${fam.label} takes up to ${most} reference pictures.`)
    } else if (mode !== 'generate') throw new Error('Mode is generate or edit.')
    const spec = IMAGE_FAMILIES.find((f) => f.id === fam.id)
    // a family that's weak below its smallest size (MiniMax H3 Image under 4 MP) gets its own default
    if (spec.sizes && !(Number(megapixels) >= spec.sizes[0])) megapixels = spec.defaultMp || spec.sizes[0]
    // and the others stay at the 4 MP they were built for
    if (!spec.sizes) megapixels = Math.min(4, Number(megapixels) || 1)
    const isBase = spec.base && spec.base.match.test(model.split(/[\\/]/).pop())
    const s = seed == null || seed === '' ? Math.floor(Math.random() * 2 ** 31) : Math.floor(Number(seed))
    const usedSteps = Math.round(Number(steps) || (isBase ? spec.base.steps : spec.steps))
    const usedCfg = Number(cfg) || (isBase ? spec.base.cfg : spec.cfg)
    const { width, height } = imageSize(aspect, megapixels)
    const uploaded = []
    for (const r of refs) {
      if (!fs.existsSync(r)) throw new Error(`No picture at ${r}.`)
      uploaded.push(await this.studio.comfy.upload(r, 'iv_studio/images'))
    }
    const id = randomUUID().slice(0, 8)
    const title = String(name || '').trim() || text.split(/[.,\n]/)[0].slice(0, 48)
    const graph = imageGraph({ family: fam.id, mode, unet: model, te: fam.te, vae: fam.vae, loras: loras.filter((l) => l?.name), prompt: text, negative, width, height, count, seed: s, steps: usedSteps, cfg: usedCfg, refs: uploaded, megapixels: Number(megapixels) || 1, editLora: fam.editLora, turbo: fam.turbo || null, keepAspect: keepAspect && mode === 'edit' && ['flux2', 'flux3', 'h3image'].includes(fam.id), prefix: `iv_studio/images/${slug(title)}_${id}` })
    const project = this.studio.createProject(`Image · ${title}`, null, null, 'image')
    const job = await this.studio.submitGraph({ kind: `picture:${fam.id}`, graph, projectId: project.id, name: title, plan: { images: true, request: { prompt: text } } })
    const record = { id, name: title, mode, family: fam.id, familyLabel: fam.label, model, prompt: text, negative, loras: loras.filter((l) => l?.name), aspect, megapixels: Number(megapixels) || 1, width: mode === 'edit' ? null : width, height: mode === 'edit' ? null : height, count: Math.max(1, Math.min(4, Math.round(count))), seed: s, steps: usedSteps, cfg: usedCfg, refs, ...(tag ? { tag } : {}), projectId: project.id, jobId: job.id, status: job.status, files: [], createdAt: now() }
    this.saveAll([record, ...this.all()])
    return record
  }

  // A set brought up to date: a finished job's pictures are copied into images/ once.
  async refresh(rec) {
    if (DONE.includes(rec.status) && (rec.status !== 'success' || rec.files?.length)) return rec
    let job
    try {
      job = await this.studio.refreshJob(rec.jobId)
    } catch (err) {
      return { ...rec, note: err.message }
    }
    const next = { ...rec, status: job.status, progress: job.progress, queuePosition: job.queuePosition, seconds_taken: job.seconds }
    if (job.status === 'error') next.error = job.error
    if (job.status === 'success') {
      const outs = (job.outputs || []).filter((o) => o.kind === 'image')
      if (!outs.length) Object.assign(next, { status: 'error', error: 'ComfyUI finished but saved no pictures.' })
      else {
        fs.mkdirSync(this.dir, { recursive: true })
        next.files = []
        for (const [i, out] of outs.entries()) {
          const src = await this.studio.localCopy(out, path.join(this.dir, '_comfy'))
          const file = path.join(this.dir, `${slug(rec.name)}_${rec.id}_${i + 1}${path.extname(src) || '.png'}`)
          if (!fs.existsSync(file)) fs.copyFileSync(src, file)
          if (path.dirname(src) === path.join(this.dir, '_comfy')) fs.rmSync(src, { force: true })
          next.files.push(file)
        }
        next.finishedAt = now()
      }
    }
    if (DONE.includes(next.status)) {
      delete next.progress
      delete next.queuePosition
      this.saveAll(this.all().map((x) => (x.id === rec.id ? next : x)))
    }
    return next
  }

  // A video's last frame as a picture in the Library (a finished version's "Use the last frame"): read exactly,
  // not a seek near the end. ffmpeg writes every frame of the final second over the same file, so the file left
  // is the last one. A cloud render is downloaded first. Kept as its own set ("Last frame"), ready to be a
  // shot's first frame or a picture to edit.
  async lastFrame({ file, name } = {}) {
    // the same video's frame, saved before and still there, is used again rather than saved twice
    const key = typeof file === 'string' ? file : file?.path || file?.url || null
    const had = key && this.all().find((r) => r.mode === 'frame' && r.source === key && r.files?.[0] && fs.existsSync(r.files[0]))
    if (had) return had
    const src = await this.studio.localCopy(file, path.join(this.dir, '_comfy'))
    if (!src || !fs.existsSync(src)) throw new Error('That video is not on this PC.')
    const id = randomUUID().slice(0, 8)
    const title = String(name || '').trim() || `${path.basename(src, path.extname(src)).replace(/_\d+$/, '').replace(/[_-]+/g, ' ').slice(0, 40)} · last frame`
    fs.mkdirSync(this.dir, { recursive: true })
    const out = path.join(this.dir, `${slug(title)}_${id}.png`)
    const ffmpeg = ffmpegStatic.ffmpegPath?.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`)
    await new Promise((resolve, reject) => {
      const p = spawn(ffmpeg, ['-v', 'error', '-y', '-sseof', '-1', '-i', src, '-map', '0:v:0', '-update', '1', '-c:v', 'png', out], { windowsHide: true })
      const err = []
      p.stderr.on('data', (d) => err.push(d))
      p.on('error', reject)
      p.on('close', (code) => (code === 0 && fs.existsSync(out) ? resolve() : reject(new Error(`Couldn't read the last frame${err.length ? `: ${String(Buffer.concat(err)).trim().split('\n').pop()}` : '.'}`))))
    })
    if (path.dirname(src) === path.join(this.dir, '_comfy')) fs.rmSync(src, { force: true })
    const info = await probe(FFPROBE, out).catch(() => null)
    const t = now()
    const record = { id, name: title, mode: 'frame', family: 'frame', familyLabel: 'Last frame', model: null, prompt: '', loras: [], width: info?.width || null, height: info?.height || null, count: 1, seed: null, source: key, status: 'success', files: [out], createdAt: t, finishedAt: t }
    this.saveAll([record, ...this.all()])
    return record
  }

  // ---------- Tools: one-step fixes for a picture (picturetools.js) ----------
  // Which tools this ComfyUI can run, and what each still needs (manifest ids, downloaded on Setup or here).
  async toolsStatus() {
    let info, st
    try {
      ;[info, st] = await Promise.all([this.studio.comfy.objectInfo(), this.status()])
    } catch (err) {
      return { error: err.message, tools: PICTURE_TOOLS.map((t) => ({ ...t, ready: false, missing: [] })) }
    }
    const opt = (cls, input) => comboOptions(info, cls, input) || []
    const find = (id) => {
      const m = this.studio.manifest.models.find((x) => x.id === id)
      if (!m) return null
      const [cls, input] = m.loader.split('.')
      const opts = opt(cls, input)
      return [m.match, ...(m.alt || [])].map((n) => opts.find((o) => o.split(/[\\/]/).pop() === n)).find(Boolean) || null
    }
    const need = (ids) => ids.map((id) => ({ id, file: find(id) })).filter((x) => !x.file).map((x) => {
      const m = this.studio.manifest.models.find((y) => y.id === x.id)
      return { id: x.id, label: m?.label || x.id, size: m?.size || 0, folder: m?.folder }
    })
    const flux3 = st.families?.find((f) => f.id === 'flux3')
    const dits = opt('SeedVR2LoadDiTModel', 'model')
    const tools = PICTURE_TOOLS.map((t) => {
      if (t.id === 'inpaint') return { ...t, ready: !!flux3?.ready && !!info.ReferenceMultiLatent, missing: [], note: flux3?.ready ? null : 'Needs Flux 3 Klein (its model, text encoder and VAE), as for pictures.' }
      if (t.id === 'relight') {
        const missing = need(['relight_unet', 'relight_te', 'relight_vae', 'relight_lightning', 'relight_lora'])
        return { ...t, ready: !missing.length && !!info.TextEncodeQwenImageEditPlus, missing }
      }
      if (t.id === 'removebg') {
        const missing = need(['birefnet'])
        return { ...t, ready: !missing.length && !!info.RemoveBackground, missing }
      }
      if (t.id === 'depth') {
        const missing = need(['moge'])
        return { ...t, ready: !missing.length && !!info.MoGeInference, missing }
      }
      if (t.id === 'upscale') return { ...t, ready: !!info.SeedVR2VideoUpscaler && dits.length > 0, missing: [], note: info.SeedVR2VideoUpscaler ? null : 'Needs the SeedVR2 node pack: Install missing node packs on Setup.' }
      return { ...t, ready: false, missing: [] }
    })
    return { tools, files: { birefnet: find('birefnet'), moge: find('moge'), relight_unet: find('relight_unet'), relight_te: find('relight_te'), relight_vae: find('relight_vae'), relight_lightning: find('relight_lightning'), relight_lora: find('relight_lora'), dit: ['seedvr2_ema_3b_fp16.safetensors', 'seedvr2_ema_3b_fp8_e4m3fn.safetensors', 'seedvr2_ema_3b-Q8_0.gguf'].find((d) => dits.includes(d)) || dits[0] || null }, flux3: flux3 ? { unet: flux3.models[0], te: flux3.te, vae: flux3.vae } : null, relight: RELIGHT, depthOutputs: DEPTH_OUTPUTS }
  }

  // Runs one tool on a picture. request: { tool, image (a local picture), mask (inpaint: a picture, white = change),
  // prompt (inpaint), light/direction/quality/brightness/color/details (relight), scale 2|4 (upscale),
  // output (depth), seed, name }. The result joins the gallery like any set (mode 'tool').
  async tool({ tool, image, mask = null, prompt = '', light, direction, quality, brightness, color, details, scale = 2, output = 'depth_colored', seed = null, name } = {}) {
    const t = PICTURE_TOOLS.find((x) => x.id === tool)
    if (!t) throw new Error(`Tool is one of ${PICTURE_TOOLS.map((x) => x.id).join(', ')}.`)
    if (!image || !fs.existsSync(image)) throw new Error('Pick the picture first.')
    const st = await this.toolsStatus()
    if (st.error) throw new Error(st.error)
    if (st.error) throw new Error(st.error)
    const ts = st.tools.find((x) => x.id === tool)
    if (!ts.ready) throw new Error(ts.missing?.length ? `${t.label} needs ${ts.missing.map((m) => m.label).join(', ')}. Download on Setup.` : ts.note || `${t.label} can’t run on this ComfyUI.`)
    const text = String(prompt || '').trim()
    if (tool === 'inpaint' && !text) throw new Error('Say what the painted part should become.')
    if (tool === 'inpaint' && (!mask || !fs.existsSync(mask))) throw new Error('Paint over the part to change first.')
    const s = seed == null || seed === '' ? Math.floor(Math.random() * 2 ** 31) : Math.floor(Number(seed))
    const id = randomUUID().slice(0, 8)
    const src = path.basename(image).replace(/\.[^.]+$/, '')
    const title = String(name || '').trim() || `${t.label} · ${src}`.slice(0, 60)
    const prefix = `iv_studio/images/${slug(title)}_${id}`
    const up = await this.studio.comfy.upload(image, 'iv_studio/images')
    let graph
    let request = { tool }
    if (tool === 'removebg') graph = removeBgGraph({ image: up, model: st.files.birefnet, prefix })
    else if (tool === 'depth') {
      if (!DEPTH_OUTPUTS.some(([v]) => v === output)) throw new Error(`Output is one of ${DEPTH_OUTPUTS.map(([v]) => v).join(', ')}.`)
      const size = await probe(FFPROBE, image).catch(() => null)
      graph = depthGraph({ image: up, model: st.files.moge, output, longest: Math.max(size?.width || 0, size?.height || 0), prefix })
      request.output = output
    } else if (tool === 'upscale') {
      const factor = Number(scale) === 4 ? 4 : 2
      const size = await probe(FFPROBE, image).catch(() => null)
      const short = Math.min(size?.width || 1024, size?.height || 1024)
      const resolution = Math.min(4096, Math.round((short * factor) / 16) * 16)
      graph = upscaleGraph({ image: up, dit: st.files.dit, resolution, prefix })
      request = { ...request, scale: factor, resolution }
    } else if (tool === 'relight') {
      const words = relightText({ light, direction, quality, brightness, color, details })
      graph = relightGraph({ image: up, unet: st.files.relight_unet, te: st.files.relight_te, vae: st.files.relight_vae, lightning: st.files.relight_lightning, relight: st.files.relight_lora, text: words, seed: s, prefix })
      request.prompt = words
    } else if (tool === 'inpaint') {
      const m = await this.studio.comfy.upload(mask, 'iv_studio/images')
      graph = inpaintGraph({ image: up, mask: m, unet: st.flux3.unet, te: st.flux3.te, vae: st.flux3.vae, text, seed: s, prefix })
      request.prompt = text
    }
    const project = this.studio.createProject(`Image · ${title}`, null, null, 'image')
    const job = await this.studio.submitGraph({ kind: `picture:tool-${tool}`, graph, projectId: project.id, name: title, plan: { images: true, request: { prompt: request.prompt || t.label } } })
    const record = { id, name: title, mode: 'tool', tool, family: `tool-${tool}`, familyLabel: t.label, prompt: request.prompt || '', request, refs: [image], ...(mask ? { mask } : {}), count: 1, seed: s, projectId: project.id, jobId: job.id, status: job.status, files: [], createdAt: now() }
    this.saveAll([record, ...this.all()])
    return record
  }

  // A mask painted in the window (a PNG data URL), saved beside the gallery for an inpaint.
  saveMask(dataUrl) {
    const m = /^data:image\/png;base64,(.+)$/.exec(String(dataUrl || ''))
    if (!m) throw new Error('That mask isn’t a PNG picture.')
    const dir = path.join(this.dir, '_masks')
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, `mask_${randomUUID().slice(0, 8)}.png`)
    fs.writeFileSync(file, Buffer.from(m[1], 'base64'))
    return file
  }

  // tagged sets (a film's storyboard sketches) belong to their page and stay out of the gallery
  list = ({ all = false } = {}) => Promise.all(this.all().filter((r) => all || !r.tag).map((r) => this.refresh(r)))

  async get(id) {
    const r = this.all().find((x) => x.id === id)
    if (!r) throw new Error(`No picture set ${id}.`)
    return this.refresh(r)
  }

  async cancel(id) {
    const r = this.all().find((x) => x.id === id)
    if (!r) throw new Error(`No picture set ${id}.`)
    const c = await this.studio.cancelJob(r.jobId)
    return { ...(await this.refresh(r)), result: c.result }
  }

  // Removes the set and its copies in images/. ComfyUI's own output files stay.
  async delete(id) {
    const r = this.all().find((x) => x.id === id)
    if (!r) throw new Error(`No picture set ${id}.`)
    if (!DONE.includes(r.status)) await this.studio.cancelJob(r.jobId).catch(() => {})
    for (const f of r.files || []) fs.rmSync(f, { force: true })
    try {
      this.studio.deleteProject(r.projectId)
    } catch {}
    this.saveAll(this.all().filter((x) => x.id !== id))
    return { deleted: id }
  }
}

// what the window and agents see of a family spec (no regular expressions)
function strip(f) {
  return { id: f.id, label: f.label, licence: f.licence, note: f.note, edit: f.edit === true, loraPattern: f.loras.source, steps: f.steps, cfg: f.cfg, maxRefs: f.maxRefs || (f.id === 'krea2' ? 1 : f.id === 'qwen21' ? 3 : 6), sizes: f.sizes || null, defaultMp: f.defaultMp || null, noNegative: !!f.noNegative, tips: f.tips || null }
}
