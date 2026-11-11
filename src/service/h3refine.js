// Finishing any video (a Seedance draft, a clip from elsewhere) the way IV Studio finishes its own H3 previews: the
// video is put on H3's grid (a size on 32 pixels, frames padded to 17n+5), encoded into H3's latent space, upscaled
// there by H3's latent upscaler to the finish size, refined by H3 in two steps at low strength with the prompt (and
// the character's LoRA, if any), decoded, trimmed back to its own length, and saved with its OWN sound; DLSS 5 then
// cleans it up (and can upscale 2x) as in a normal finish. Runs on this PC's ComfyUI, free.
//
// The model, LoRA and loader settings come from IV Studio's own H3 template (iv_studio_api.json), so Settings ->
// Models choices and model-file swaps apply as they do to every H3 render.
import { resolveFinalSize, resolveSize } from './plan.js'

export const REFINE_DEFAULTS = { megapixels: 2, denoise: 0.4, steps: 2, upscale2x: false, dlss: true }

// The H3 frame count a clip of `frames` frames is padded to: the next 17n+5.
export const h3Frames = (frames) => {
  const f = Math.max(5, frames)
  return f + ((((5 - (f % 17)) % 17) + 17) % 17)
}

const ASPECT_OF = (w, h) => {
  const r = w / h
  const known = [['16:9', 16 / 9], ['9:16', 9 / 16], ['1:1', 1], ['4:3', 4 / 3], ['3:4', 3 / 4], ['21:9', 21 / 9], ['3:2', 1.5], ['2:3', 2 / 3]]
  return known.sort((a, b) => Math.abs(a[1] - r) - Math.abs(b[1] - r))[0][0]
}

// source: { path, width, height, frames, fps }. character: a preset with `lora` (or null). opts: REFINE_DEFAULTS.
// template: IV Studio's H3 API template. Returns { graph, resolved }.
// silence: a silent sound file in ComfyUI's input folder, for a source with no sound (H3 works on sound and picture
// together, so it needs a track; the saved video then has none).
export function refineGraph(template, { source, prompt, character = null, trigger = '', name, seed = 4686, unet = null, silence = null, ...opts }) {
  const o = { ...REFINE_DEFAULTS, ...opts }
  const t = (id) => structuredClone(template[id].inputs)
  const aspect = ASPECT_OF(source.width, source.height)
  // the encode size: the source's own shape on H3's 32-pixel grid at about its own size (0.4 MP for a 480p draft)
  const mp = Math.min(1, Math.max(0.3, (source.width * source.height) / (1024 * 1024)))
  const size = resolveSize(aspect, Math.round(mp * 10) / 10)
  const padded = h3Frames(source.frames)
  const extra = padded - source.frames
  const final = resolveFinalSize(size.width, size.height, o.megapixels)
  const loraState = (loras) => JSON.stringify({ version: 1, sep: ', ', cacheMode: 'last', loras: loras.map((l) => ({ name: l.name, on: true, sm: l.strength ?? 0.8, sc: l.strength ?? 0.8, triggers: [] })) })
  const text = String(prompt || '').replace(/\{char\}/g, trigger || character?.name?.split(/\s+/)[0] || 'the person')

  const g = {
    // the models: IV Studio's own loaders
    clip: { class_type: 'CLIPLoader', inputs: t('2') },
    vae: { class_type: 'VAELoader', inputs: t('3') },
    avae: { class_type: 'VAELoader', inputs: t('4') },
    unet: { class_type: 'UNETLoader', inputs: { ...t('101'), ...(unet ? { unet_name: unet } : {}) } },
    turbo: { class_type: 'LoraLoaderModelOnly', inputs: { ...t('5'), model: ['unet', 0] } },
    char: { class_type: 'PixaromaLoraLoader', inputs: { model: ['turbo', 0], LoraLoaderState: loraState(character?.lora ? [{ name: character.lora, strength: character.strength }] : []) } },
    attn: { class_type: 'ModelAttentionBackend', inputs: { ...t('7'), model: ['char', 0] } },
    sparse: { class_type: 'BlockSparseAttention', inputs: { ...t('8'), model: ['attn', 0] } },
    // the source, on H3's grid
    load: { class_type: 'VHS_LoadVideoPath', inputs: { video: source.path, force_rate: 24, custom_width: 0, custom_height: 0, frame_load_cap: 0, skip_first_frames: 0, select_every_nth: 1, format: 'AnimateDiff' } },
    fit: { class_type: 'ImageScale', inputs: { image: ['load', 0], upscale_method: 'lanczos', width: size.width, height: size.height, crop: 'center' } },
    ...(extra > 0
      ? {
          tail: { class_type: 'GetImageRangeFromBatch', inputs: { images: ['fit', 0], start_index: source.frames - extra, num_frames: extra } },
          pad: { class_type: 'ImageBatch', inputs: { image1: ['fit', 0], image2: ['tail', 0] } }
        }
      : {}),
    enc: { class_type: 'VAEEncode', inputs: { pixels: [extra > 0 ? 'pad' : 'fit', 0], vae: ['vae', 0] } },
    // the sound goes along (held still by a zero mask) only because H3 works on sound and picture together; the
    // saved video keeps the source's own sound
    ...(silence ? { quiet: { class_type: 'LoadAudio', inputs: { audio: silence } } } : {}),
    aenc: { class_type: 'VAEEncodeAudio', inputs: { audio: [silence ? 'quiet' : 'load', silence ? 0 : 2], vae: ['avae', 0] } },
    amask: { class_type: 'SolidMask', inputs: { value: 0, width: 32, height: 32 } },
    akeep: { class_type: 'SetLatentNoiseMask', inputs: { samples: ['aenc', 0], mask: ['amask', 0] } },
    // conditioning as the finish has it: the prompt alone, frame-free, at the encode size
    cond: { class_type: 'MiniMaxH3ImageToVideo', inputs: { clip: ['clip', 0], vae: ['vae', 0], prompt: text, width: size.width, height: size.height, length: padded } },
    up: { class_type: 'MinimaxH3LatentUpscaler3D', inputs: { ...t('21'), latent: ['enc', 0], 'mode.megapixels': o.megapixels } },
    av: { class_type: 'LTXVConcatAVLatent', inputs: { video_latent: ['up', 0], audio_latent: ['akeep', 0] } },
    noise: { class_type: 'RandomNoise', inputs: { noise_seed: seed } },
    sampler: { class_type: 'KSamplerSelect', inputs: t('24') },
    sigmas: { class_type: 'BasicScheduler', inputs: { ...t('25'), model: ['sparse', 0], steps: o.steps, denoise: o.denoise } },
    guider: { class_type: 'BasicGuider', inputs: { model: ['sparse', 0], conditioning: ['cond', 0] } },
    sample: { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['noise', 0], guider: ['guider', 0], sampler: ['sampler', 0], sigmas: ['sigmas', 0], latent_image: ['av', 0] } },
    split: { class_type: 'LTXVSeparateAVLatent', inputs: { av_latent: ['sample', 0] } },
    dec: { class_type: 'VAEDecode', inputs: { samples: ['split', 0], vae: ['vae', 0] } },
    trim: { class_type: 'GetImageRangeFromBatch', inputs: { images: ['dec', 0], start_index: 0, num_frames: source.frames } },
    save: { class_type: 'VHS_VideoCombine', inputs: { ...t('30'), images: ['trim', 0], ...(silence ? {} : { audio: ['load', 2] }), filename_prefix: `H3/refined/${name}` } },
    file: { class_type: 'VHS_SelectFilename', inputs: { filenames: ['save', 0], index: -1 } }
  }
  if (silence) delete g.save.inputs.audio
  if (o.dlss) {
    g.dlss = { class_type: 'DLSS5_Enhance_Video', inputs: { ...t('50'), 'Video Path': ['file', 0], Scale: o.upscale2x ? 2 : 1, 'Target FPS': 0, 'Filename Prefix': name, 'Output Directory': 'H3/final', ...(o.dlss || {}) } }
    g.out = { class_type: 'PreviewAny', inputs: { source: ['dlss', 0] } }
  }
  const scale = o.dlss && o.upscale2x ? 2 : 1
  return {
    graph: g,
    resolved: { encodeWidth: size.width, encodeHeight: size.height, width: final.width * scale, height: final.height * scale, upscaleSize: final, frames: source.frames, padded, seconds: +(source.frames / 24).toFixed(3), fps: 24, denoise: o.denoise, megapixels: o.megapixels }
  }
}
