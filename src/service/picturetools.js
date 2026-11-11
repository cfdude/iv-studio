// Create -> Image -> Tools: one-step fixes for a picture, each an API graph of ComfyUI's own nodes (the workflows of
// Freefield's apps, github.com/neuregex/freefield, MIT, adapted to the models IV Studio already uses).
//   inpaint   paint over part of a picture and describe the change; Flux 3 Klein redraws only that part
//   relight   new light for the whole picture (Qwen Image Edit 2509 + its Relight and Lightning LoRAs)
//   removebg  the subject cut out onto transparency (BiRefNet)
//   upscale   2x or 4x with restored detail (SeedVR2, the ComfyUI-SeedVR2_VideoUpscaler pack IV Studio finishes with)
//   depth     a depth or normal map (MoGe-2)
export const PICTURE_TOOLS = [
  { id: 'inpaint', label: 'Inpaint', short: 'Paint over a part and describe the change', needs: ['flux3'] },
  { id: 'relight', label: 'Relight', short: 'New light for the whole picture', needs: ['relight_unet', 'relight_lightning', 'relight_lora'] },
  { id: 'removebg', label: 'Remove background', short: 'The subject on transparency', needs: [] },
  { id: 'upscale', label: 'Upscale', short: '2× or 4× with restored detail', needs: [] },
  { id: 'depth', label: 'Depth map', short: 'Depth or normal map', needs: [] }
]

// Relight's presets: [the words the Relight LoRA reads, the label]. Freefield's presets and controls.
export const RELIGHT = {
  light: [
    ['golden hour sunlight through a low window, warm color temperature, long soft shadows', 'Golden hour'],
    ['twilight blue-hour light with warm practical lamps, soft light and blurred shadows', 'Blue hour'],
    ['neon night lighting, magenta and cyan rim light, dark moody background', 'Neon night'],
    ['soft studio light from a large softbox on the left, gentle fill, clean shadows', 'Studio softbox'],
    ['dramatic chiaroscuro, a single hard key light from the side, deep shadows', 'Dramatic key light'],
    ['overcast daylight, soft and even, no hard shadows', 'Overcast'],
    ['warm candlelight, flickering amber glow, deep shadows', 'Candlelight'],
    ['a single light source', 'One light, your way']
  ],
  direction: [['', 'Any'], [', the light coming from above', 'Above'], [', the light coming from the front', 'Front'], [', the light coming from the left', 'Left'], [', the light coming from the right', 'Right'], [', the light coming from behind the subject', 'Behind'], [', the light coming from below', 'Below']],
  quality: [['', 'Any'], [', soft light with blurred shadow edges', 'Soft'], [', hard light with crisp shadow edges', 'Hard']],
  brightness: [['', 'Any'], [', dim and low-key', 'Dim'], [', bright and high-key', 'Bright']],
  color: [['', 'Any'], [', neutral white colored light', 'White'], [', warm tungsten colored light', 'Warm'], [', cool blue-white colored light', 'Cool'], [', red colored light', 'Red'], [', orange colored light', 'Orange'], [', green colored light', 'Green'], [', cyan colored light', 'Cyan'], [', blue colored light', 'Blue'], [', purple colored light', 'Purple'], [', pink colored light', 'Pink']]
}
export const relightText = ({ light = RELIGHT.light[0][0], direction = '', quality = '', brightness = '', color = '', details = '' } = {}) =>
  `重新照明, relight the image using ${light}${direction}${quality}${brightness}${color}.${String(details || '').trim() ? ` ${String(details).trim()}` : ''}`

export const DEPTH_OUTPUTS = [
  ['depth_colored', 'Depth, in colour'],
  ['depth', 'Depth, greyscale'],
  ['normal_opengl', 'Normal map (OpenGL)'],
  ['normal_directx', 'Normal map (DirectX)']
]

const save = (images, prefix) => ({ class_type: 'SaveImage', inputs: { images, filename_prefix: prefix } })

export function removeBgGraph({ image, model = 'birefnet.safetensors', prefix }) {
  return {
    1: { class_type: 'LoadImage', inputs: { image } },
    2: { class_type: 'LoadBackgroundRemovalModel', inputs: { bg_removal_name: model } },
    3: { class_type: 'RemoveBackground', inputs: { image: ['1', 0], bg_removal_model: ['2', 0] } },
    4: { class_type: 'InvertMask', inputs: { mask: ['3', 0] } },
    5: { class_type: 'JoinImageWithAlpha', inputs: { image: ['1', 0], alpha: ['4', 0] } },
    6: save(['5', 0], prefix)
  }
}

// longest: the picture's longer side; over 2048 px it is brought down first (as Freefield's app does), never up
export function depthGraph({ image, model = 'moge_2_vitl_normal_fp16.safetensors', output = 'depth_colored', longest = 0, prefix }) {
  const big = longest > 2048
  return {
    1: { class_type: 'LoadImage', inputs: { image } },
    ...(big ? { 2: { class_type: 'ImageScaleToMaxDimension', inputs: { image: ['1', 0], upscale_method: 'lanczos', largest_size: 2048 } } } : {}),
    3: { class_type: 'LoadMoGeModel', inputs: { model_name: model } },
    4: { class_type: 'MoGeInference', inputs: { moge_model: ['3', 0], image: [big ? '2' : '1', 0], resolution_level: 2, fov_x_degrees: 0, batch_size: 4, force_projection: true, apply_mask: true, refine_steps: 3 } },
    5: { class_type: 'MoGeRender', inputs: { moge_geometry: ['4', 0], output } },
    6: save(['5', 0], prefix)
  }
}

// SeedVR2 on one picture: resolution is the short side it comes out at.
export function upscaleGraph({ image, dit, resolution, prefix }) {
  return {
    1: { class_type: 'LoadImage', inputs: { image } },
    2: { class_type: 'SeedVR2LoadDiTModel', inputs: { model: dit, device: 'cuda:0', blocks_to_swap: 0, offload_device: 'cpu', cache_model: false, attention_mode: 'sdpa' } },
    3: { class_type: 'SeedVR2LoadVAEModel', inputs: { model: 'ema_vae_fp16.safetensors', device: 'cuda:0', encode_tiled: true, decode_tiled: true, offload_device: 'cpu', cache_model: false } },
    4: { class_type: 'SeedVR2VideoUpscaler', inputs: { image: ['1', 0], dit: ['2', 0], vae: ['3', 0], seed: 42, resolution, max_resolution: 0, batch_size: 1, uniform_batch_size: false, color_correction: 'lab', temporal_overlap: 0, offload_device: 'cpu' } },
    5: save(['4', 0], prefix)
  }
}

// Qwen Image Edit 2509 with the Lightning (4 steps) and Relight LoRAs, Freefield's relight graph.
export function relightGraph({ image, unet, te, vae, lightning, relight, text, seed, prefix }) {
  return {
    1: { class_type: 'LoadImage', inputs: { image } },
    2: { class_type: 'UNETLoader', inputs: { unet_name: unet, weight_dtype: 'default' } },
    3: { class_type: 'CLIPLoader', inputs: { clip_name: te, type: 'qwen_image', device: 'default' } },
    4: { class_type: 'VAELoader', inputs: { vae_name: vae } },
    5: { class_type: 'LoraLoaderModelOnly', inputs: { model: ['2', 0], lora_name: lightning, strength_model: 1 } },
    6: { class_type: 'LoraLoaderModelOnly', inputs: { model: ['5', 0], lora_name: relight, strength_model: 1 } },
    7: { class_type: 'ModelSamplingAuraFlow', inputs: { model: ['6', 0], shift: 3 } },
    8: { class_type: 'CFGNorm', inputs: { model: ['7', 0], strength: 1, pre_cfg: false } },
    9: { class_type: 'FluxKontextImageScale', inputs: { image: ['1', 0] } },
    10: { class_type: 'TextEncodeQwenImageEditPlus', inputs: { clip: ['3', 0], vae: ['4', 0], image1: ['9', 0], prompt: text } },
    11: { class_type: 'TextEncodeQwenImageEditPlus', inputs: { clip: ['3', 0], vae: ['4', 0], image1: ['9', 0], prompt: '' } },
    12: { class_type: 'VAEEncode', inputs: { pixels: ['9', 0], vae: ['4', 0] } },
    13: { class_type: 'KSampler', inputs: { model: ['8', 0], positive: ['10', 0], negative: ['11', 0], latent_image: ['12', 0], seed, steps: 4, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: 1 } },
    14: { class_type: 'VAEDecode', inputs: { samples: ['13', 0], vae: ['4', 0] } },
    15: save(['14', 0], prefix)
  }
}

// Flux 3 Klein redraws only the painted part (white in the mask), then the result is pasted back over the picture.
export function inpaintGraph({ image, mask, unet, te, vae, text, seed, steps = 16, prefix }) {
  return {
    1: { class_type: 'UNETLoader', inputs: { unet_name: unet, weight_dtype: 'default' } },
    2: { class_type: 'CLIPLoader', inputs: { clip_name: te, type: 'flux3', device: 'default' } },
    3: { class_type: 'VAELoader', inputs: { vae_name: vae } },
    4: { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text } },
    5: { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['4', 0] } },
    6: { class_type: 'LoadImage', inputs: { image } },
    7: { class_type: 'LoadImage', inputs: { image: mask } },
    8: { class_type: 'ImageScaleToTotalPixels', inputs: { image: ['6', 0], upscale_method: 'lanczos', megapixels: 1, resolution_steps: 16 } },
    9: { class_type: 'GetImageSize', inputs: { image: ['8', 0] } },
    10: { class_type: 'ImageScale', inputs: { image: ['7', 0], upscale_method: 'bilinear', width: ['9', 0], height: ['9', 1], crop: 'disabled' } },
    11: { class_type: 'ImageToMask', inputs: { image: ['10', 0], channel: 'red' } },
    12: { class_type: 'GrowMask', inputs: { mask: ['11', 0], expand: 8, tapered_corners: true } },
    13: { class_type: 'ReferenceMultiLatent', inputs: { positive: ['4', 0], negative: ['5', 0], vae: ['3', 0], 'images.image0': ['8', 0], resolution: 'resize', 'resolution.megapixels': 1 } },
    14: { class_type: 'VAEEncode', inputs: { pixels: ['8', 0], vae: ['3', 0] } },
    15: { class_type: 'SetLatentNoiseMask', inputs: { samples: ['14', 0], mask: ['12', 0] } },
    16: { class_type: 'KSampler', inputs: { model: ['1', 0], positive: ['13', 0], negative: ['13', 1], latent_image: ['15', 0], seed, steps, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: 1 } },
    17: { class_type: 'VAEDecode', inputs: { samples: ['16', 0], vae: ['3', 0] } },
    18: { class_type: 'ImageCompositeMasked', inputs: { destination: ['8', 0], source: ['17', 0], x: 0, y: 0, resize_source: false, mask: ['12', 0] } },
    19: save(['18', 0], prefix)
  }
}
