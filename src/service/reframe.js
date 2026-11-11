// Reframe: a shot made for one frame shape (16:9) turned into another (9:16, 1:1, 16:9) by drawing what lies beyond
// its edges, instead of cropping heads off. The shot is scaled to fit inside the new frame on a grey canvas, and a
// mask marks the bars (reaching a little into the picture, so the join blends); MiniMax H3's masked video edit
// (MiniMaxH3FantasticVideoEditLatent, the same machinery Replace uses) regenerates only the masked part, holding the
// original picture and its sound. Pictures go through Qwen Image 2.1 with its outpaint LoRA instead.
// reframeGeometry and reframeGraph are pure, so they are tested without ComfyUI.
import fs from 'node:fs'
import path from 'node:path'
import { probe } from './media.js'

export const SHAPES = { '16:9': [16, 9], '9:16': [9, 16], '1:1': [1, 1], '4:5': [4, 5] }
const MODEL = {
  unet: 'minimax_h3_ref2va_pruned_int8_convrot.safetensors',
  lora: 'minimax_h3_DMAD_4step_full_lora_avg_rank_39_bf16.safetensors',
  clip: 'qwen3vl_32b_minimax_h3_int4_convrot.safetensors',
  vae: 'minimax_h3_video_vae_int8_convrot.safetensors',
  audioVae: 'minimax_h3_audio_vae_fp32.safetensors'
}
const grid = (v) => Math.max(256, Math.round(v / 32) * 32)
const even = (v) => Math.max(2, Math.round(v / 2) * 2)

// The new frame (about megapixels, both sides on H3's 32-pixel grid), where the shot sits in it (scaled to fit, then
// zoom > 1 enlarges it and crops what falls outside), and the mask's hole (the shot less `blend` pixels each side).
export function reframeGeometry({ width, height, shape = '9:16', megapixels = 0.6, zoom = 1, blend = 16 }) {
  const [a, b] = SHAPES[shape] || SHAPES['9:16']
  const k = Math.sqrt((megapixels * 1024 * 1024) / (a * b))
  const W = grid(a * k)
  const H = grid(b * k)
  const s = Math.min(W / width, H / height) * Math.max(1, zoom)
  const w = Math.min(W, even(width * s))
  const h = Math.min(H, even(height * s))
  const x = Math.round((W - w) / 2)
  const y = Math.round((H - h) / 2)
  const hole = { x: x + (x > 0 ? blend : 0), y: y + (y > 0 ? blend : 0), w: w - (x > 0 ? 2 * blend : 0), h: h - (y > 0 ? 2 * blend : 0) }
  return { W, H, scaled: { w: even(width * s), h: even(height * s) }, x, y, w, h, hole, filled: +(1 - (w * h) / (W * H)).toFixed(3) }
}

// H3's lengths are 17n+5 frames, at most 15 s at 24 fps.
export const h3Frames = (frames) => Math.max(22, Math.min(17 * 21 + 5, Math.floor((frames - 5) / 17) * 17 + 5))

export function reframeGraph({ padded, mask, prompt, seed = 42, steps = 6, prefix, fps = 24 }) {
  return {
    load: { class_type: 'VHS_LoadVideoPath', inputs: { video: padded, force_rate: 0, custom_width: 0, custom_height: 0, frame_load_cap: 0, skip_first_frames: 0, select_every_nth: 1, format: 'None' } },
    // one still mask: the bars don't move (H3's masked target takes a static mask or one per frame)
    maskload: { class_type: 'LoadImage', inputs: { image: mask } },
    tomask: { class_type: 'ImageToMask', inputs: { image: ['maskload', 0], channel: 'red' } },
    unet: { class_type: 'UNETLoader', inputs: { unet_name: MODEL.unet, weight_dtype: 'default' } },
    lora: { class_type: 'LoraLoaderModelOnly', inputs: { lora_name: MODEL.lora, strength_model: 1, model: ['unet', 0] } },
    shift: { class_type: 'MiniMaxH3SigmaShift', inputs: { shift_video: 12, shift_audio: 2, model: ['lora', 0] } },
    clip: { class_type: 'CLIPLoader', inputs: { clip_name: MODEL.clip, type: 'minimax', device: 'default' } },
    vae: { class_type: 'VAELoader', inputs: { vae_name: MODEL.vae } },
    avae: { class_type: 'VAELoader', inputs: { vae_name: MODEL.audioVae } },
    edit: { class_type: 'MiniMaxH3FantasticVideoEditLatent', inputs: { vae: ['vae', 0], images: ['load', 0], mask: ['tomask', 0], grow: 0, keep_audio: true, audio_vae: ['avae', 0], audio: ['load', 2], megapixels: 0 } },
    target: { class_type: 'MiniMaxH3ContexMaskedTarget', inputs: { target_latent: ['edit', 0], mask: ['tomask', 0], mask_meaning: 'white = generate', audio_mode: 'preserve source audio', mask_conversion: 'H3 exact (causal/token max)' } },
    text: { class_type: 'MiniMaxH3ReferenceToVideo', inputs: { clip: ['clip', 0], prompt, width: ['edit', 1], height: ['edit', 2], length: ['edit', 3], ref_image_size: 'match', vae: ['vae', 0], audio_vae: ['avae', 0] } },
    guider: { class_type: 'BasicGuider', inputs: { model: ['shift', 0], conditioning: ['text', 0] } },
    sampler: { class_type: 'KSamplerSelect', inputs: { sampler_name: 'euler' } },
    sigmas: { class_type: 'BasicScheduler', inputs: { scheduler: 'simple', steps, denoise: 1, model: ['shift', 0] } },
    noise: { class_type: 'RandomNoise', inputs: { noise_seed: seed } },
    sample: { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['noise', 0], guider: ['guider', 0], sampler: ['sampler', 0], sigmas: ['sigmas', 0], latent_image: ['target', 0] } },
    decode: { class_type: 'VAEDecode', inputs: { samples: ['sample', 0], vae: ['vae', 0] } },
    sound: { class_type: 'VAEDecodeAudio', inputs: { samples: ['sample', 0], vae: ['avae', 0] } },
    save: { class_type: 'VHS_VideoCombine', inputs: { images: ['decode', 0], audio: ['sound', 0], frame_rate: fps, loop_count: 0, filename_prefix: prefix, format: 'video/h264-mp4', pix_fmt: 'yuv420p', crf: 16, save_metadata: true, trim_to_audio: false, pingpong: false, save_output: true } }
  }
}

// The words H3 gets: the shot's own prompt when IV Studio made it, and always what to do with the bars.
export function reframePrompt({ shape, about }) {
  return [
    `The same shot, reframed to a ${shape === '9:16' ? 'vertical 9:16' : shape === '1:1' ? 'square' : shape} frame. The middle of the picture is the original shot: keep it exactly, with its people, motion, camera move and sound.`,
    'Fill the grey area around it by continuing the same scene beyond the original edges: the same place, light, colours and camera move, so it reads as one wider view. Add no new people and nothing that draws the eye; no borders, no text.',
    about ? `The shot: ${String(about).replace(/\s+/g, ' ').trim().slice(0, 900)}` : ''
  ]
    .filter(Boolean)
    .join('\n')
}

// The outpaint LoRA's own trigger (ausboss/Qwen-Image-2.1-Outpaint-LoRA): it fills flat #808080 around the picture.
export const OUTPAINT_TRIGGER = 'Outpaint the image: replace the solid gray areas with a seamless continuation of the scene, keeping the existing picture unchanged.'

export class Reframes {
  // studio: () => Studio. edits: Edits (ffmpeg, ffprobe). images: () => Images (pictures).
  constructor({ dataDir, studio, edits, images = () => null }) {
    this.dir = path.join(dataDir, 'reframes')
    this.studio = studio
    this.edits = edits
    this.images = images
  }

  // A picture in a new shape: padded with flat grey, filled by Qwen Image 2.1 edit with the outpaint LoRA (its card's
  // settings: 25 steps, CFG 1), then the exact original pasted back over a soft edge. About 30 s.
  async makePicture({ file, shape = '9:16', about = '', zoom = 1, megapixels = 1 }) {
    const images = this.images()
    if (!images) throw new Error('Pictures need IV Studio on this computer.')
    const st = await images.status()
    const qwen = st.families.find((f) => f.id === 'qwen21' && f.ready && f.edit && f.models.length)
    const info = await this.studio().comfy.objectInfo('LoraLoaderModelOnly').catch(() => null)
    const field = info?.LoraLoaderModelOnly?.input?.required?.lora_name
    const names = field?.[1]?.options || field?.[0] || []
    const lora = names.find((n) => /qwen-image-2\.1-outpaint-v2/i.test(n)) || names.find((n) => /qwen-image-2\.1-outpaint/i.test(n))
    if (!qwen || !lora) throw new Error('Reframing a picture needs Qwen Image 2.1 and its outpaint LoRA (ausboss/Qwen-Image-2.1-Outpaint-LoRA, in loras).')
    const pic = await probe(this.edits.ffprobe, file)
    const g = reframeGeometry({ width: pic.width, height: pic.height, shape, megapixels, zoom, blend: 0 })
    if (g.filled < 0.02) throw new Error('The picture already has that shape.')
    fs.mkdirSync(this.dir, { recursive: true })
    const base = `${path.basename(file).replace(/\.[^.]+$/, '').slice(0, 40)}_${shape.replace(':', 'x')}_${Date.now().toString(36)}`
    const padded = path.join(this.dir, `${base}_padded.png`)
    await this.edits.run(['-y', '-v', 'error', '-i', file, '-vf', `scale=${g.scaled.w}:${g.scaled.h}:flags=lanczos,crop=${g.w}:${g.h},pad=${g.W}:${g.H}:${g.x}:${g.y}:color=0x808080,format=rgb24`, '-frames:v', '1', padded])
    const model = qwen.models.find((m) => !/[-_]UC[-_]/i.test(m)) || qwen.models[0]
    const rec = await images.create({ mode: 'edit', model, prompt: `${OUTPAINT_TRIGGER}${about ? ` Scene: ${about}` : ''}`, loras: [{ name: lora, strength: 1 }], refs: [padded], megapixels, steps: 25, cfg: 1, count: 1, seed: 42, name: `Reframe ${shape}`, tag: 'reframe' })
    let filled
    for (const end = Date.now() + 600e3; Date.now() < end && !filled; await new Promise((r) => setTimeout(r, 2000))) {
      const r = await images.get(rec.id)
      if (r.files?.length) filled = r.files[0]
      else if (['error', 'cancelled'].includes(r.status)) throw new Error(r.error || 'The reframe failed.')
    }
    if (!filled) throw new Error('The reframe took too long.')
    // the exact original back in its place, its edges blended over 24 px
    const out = path.join(this.dir, `${base}.png`)
    // (only the edges that meet new picture fade; an edge on the frame's border stays solid)
    const f = 24
    const dx = g.x > 0 ? 'min(X,W-1-X)' : String(f)
    const dy = g.y > 0 ? 'min(Y,H-1-Y)' : String(f)
    await this.edits.run(['-y', '-v', 'error', '-i', filled, '-i', file, '-filter_complex', `[0:v]scale=${g.W}:${g.H},format=rgba[bg];[1:v]scale=${g.scaled.w}:${g.scaled.h}:flags=lanczos,crop=${g.w}:${g.h},format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='255*min(1,min(${dx},${dy})/${f})'[fg];[bg][fg]overlay=${g.x}:${g.y},format=rgb24`, '-frames:v', '1', out])
    return { file: out, shape, filled: g.filled, width: g.W, height: g.H, padded, raw: filled }
  }

  // file: a video. shape: 9:16, 1:1, 16:9 or 4:5. about: what the shot shows (optional). zoom: above 1 crops into the
  // shot so less has to be drawn. Resolves (a few minutes for 5 s) with { file, shape, filled, seconds, jobId }.
  async make({ file, shape = '9:16', about = '', zoom = 1, seed = 42, megapixels = 0.6 }) {
    if (!file || !fs.existsSync(file)) throw new Error('Pick a video.')
    if (!SHAPES[shape]) throw new Error(`shape must be ${Object.keys(SHAPES).join(', ')}.`)
    const studio = this.studio()
    if (studio.comfy.hosted) throw new Error('Reframe runs on this computer’s ComfyUI or on your own cloud (RunPod, Modal).')
    const info = await probe(this.edits.ffprobe, file)
    if (info.kind !== 'video') throw new Error('Reframe takes a video; pictures go through Create → Image.')
    const g = reframeGeometry({ width: info.width, height: info.height, shape, megapixels, zoom })
    if (g.filled < 0.02) throw new Error('The shot already has that shape.')
    // (a frame short and H3 rounds down a whole step: 123 frames came back as 107)
    const frames = h3Frames(Math.round(info.duration * 24) + 1)
    const dur = (frames / 24).toFixed(4)
    const base = `${path.basename(file).replace(/\.[^.]+$/, '').replace(/-audio$/, '').slice(0, 40)}_${shape.replace(':', 'x')}_${Date.now().toString(36)}`
    fs.mkdirSync(this.dir, { recursive: true })
    const padded = path.join(this.dir, `${base}_padded.mp4`)
    const mask = path.join(this.dir, `${base}_mask.png`)
    const silent = info.hasAudio ? [] : ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo']
    // the shot in its new frame, at 24 fps and exactly an H3 length (with sound: H3's loader wants a sound track).
    // The bars start as the shot itself enlarged and heavily blurred: on flat grey, H3 kept the top bar grey.
    await this.edits.run(['-y', '-v', 'error', '-i', file, ...silent, '-filter_complex', `[0:v]fps=24,split[a][b];[a]scale=${g.W}:${g.H}:force_original_aspect_ratio=increase,crop=${g.W}:${g.H},boxblur=40:3[bg];[b]scale=${g.scaled.w}:${g.scaled.h}:flags=lanczos,crop=${g.w}:${g.h}[fg];[bg][fg]overlay=${g.x}:${g.y},format=yuv420p[v];[${info.hasAudio ? '0:a:0' : '1:a:0'}]apad=whole_dur=${dur},atrim=end=${dur}[s]`, '-map', '[v]', '-map', '[s]', '-frames:v', String(frames), '-c:v', 'libx264', '-crf', '12', '-preset', 'fast', '-c:a', 'aac', '-ar', '48000', padded])
    await this.edits.run(['-y', '-v', 'error', '-f', 'lavfi', '-i', `color=c=white:s=${g.W}x${g.H}`, '-vf', `drawbox=x=${g.hole.x}:y=${g.hole.y}:w=${g.hole.w}:h=${g.hole.h}:color=black:t=fill,format=rgb24`, '-frames:v', '1', mask])
    // on the person's own cloud the padded shot is uploaded and read from ComfyUI's input folder
    const cloud = studio.comfy.ownCloud
    const graph = reframeGraph({ padded: cloud ? await studio.comfy.upload(padded) : padded, mask: await studio.comfy.upload(mask), prompt: reframePrompt({ shape, about }), seed, prefix: `iv_studio/reframes/${base}` })
    if (cloud) graph.load.class_type = 'VHS_LoadVideo'
    const job = await studio.submitGraph({ kind: 'reframe', graph, name: `Reframe to ${shape}`, plan: { reframe: { shape, from: file, filled: g.filled } } })
    let j = job
    for (const end = Date.now() + 30 * 60e3; Date.now() < end; await new Promise((r) => setTimeout(r, 4000))) {
      j = await studio.refreshJob(job.id)
      if (['success', 'error', 'cancelled'].includes(j.status)) break
    }
    if (j.status !== 'success') throw new Error(j.error || `The reframe ${j.status || 'took too long'}.`)
    const out = (j.outputs || []).find((o) => o.kind === 'final')
    const result = out && (await studio.localCopy(out, this.dir))
    if (!result) throw new Error('The reframe saved no video.')
    return { file: result, shape, filled: g.filled, seconds: +dur, width: g.W, height: g.H, padded, mask, jobId: j.id }
  }
}
