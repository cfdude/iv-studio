// Sequences: several shots that play as one continuous video. This builds the ComfyUI graphs that the
// IV Studio workflow doesn't cover. The model, encoder, VAE and turbo LoRA names come from the IV Studio
// template, so a sequence renders with exactly the models Setup checked.
//   take      - H3 Multishot's sampler renders every shot as one seamless take (ref2va)
//   retake    - H3 Retake redoes one stretch of a finished video and keeps the rest
//   renderout - optional colour smoothing across the joins (H3 Chain Normalize), then the DLSS pass
// Shot by shot rendering reuses the IV Studio workflow's own Continue mode (see studio.js).
import { resolveFrames, resolveSize } from './plan.js'
import { sections } from './lint.js'

export const SHOT_SECONDS = [10, 15] // H3 Multishot's verified windows (243 and 362 frames); 5 s shots clip their joins
export const RETAKE_MODES = {
  both: 'video + audio (redo the moment)',
  video: 'video only (keep the performance)',
  audio: 'audio only (keep the picture)'
}
export const SEQUENCE_DEFAULTS = {
  method: 'take',
  character: 'tess',
  aspect: '16:9',
  megapixels: 0.9, // 1280x736 at 16:9, the pack's tested size
  shotSeconds: 10,
  steps: 8,
  seed: 4242,
  voiceRef: null,
  loras: [] // extra LoRAs for every shot: [{name, strength}], after the character's
}

export const MAX_SEQUENCE_LORAS = 4
// A sequence's extra LoRAs as saved: named, strength -2..2 (default 0.8), no repeats, at most MAX_SEQUENCE_LORAS.
export function cleanSequenceLoras(loras) {
  const seen = new Set()
  const out = []
  for (const l of Array.isArray(loras) ? loras : []) {
    const name = typeof l?.name === 'string' ? l.name.trim() : ''
    if (!name || seen.has(name)) continue
    seen.add(name)
    const n = Number(l.strength)
    out.push({ name, strength: Number.isFinite(n) ? Math.min(2, Math.max(-2, Math.round(n * 100) / 100)) : 0.8, ...(l.title && { title: String(l.title) }) })
  }
  return out.slice(0, MAX_SEQUENCE_LORAS)
}

// Node ids the studio reads outputs from.
export const SAVES = { master: 'save', final: 'final' }

const fill = (text, character) => (character ? text.replaceAll('{char}', character.trigger) : text)

// One shot of a one-take script. With a voice attached, H3 Multishot writes the reference (ref2va) sections
// itself (subject_definitions, summary, retention_analysis, non_diegetic_music: N/A) and puts the shot's text
// in detailed_description, so the shot goes as plain text: the description with its sound folded in. Sent as
// written, IV Studio's own section names ended up inside detailed_description (GitHub #14). With no
// reference attached there is nothing for those sections to define, and the written prompt goes as it is.
export function takeShot(prompt, { wrapped = false } = {}) {
  const text = String(prompt || '').trim()
  if (!wrapped) return text
  const s = sections(text)
  const body = s.integrated_multimodal_description ?? s.detailed_description ?? s._head
  if (!body) return text
  const sound = s.overall_soundscape && !/^n\/?a\.?$/i.test(s.overall_soundscape) ? `\n\nThe sound: ${s.overall_soundscape}` : ''
  return `${body}${sound}`
}

// Loaders shared by every sequence graph: ref2va (it carries identity and voice across a chain),
// the turbo LoRA, the character LoRA, then the sequence's extra LoRAs.
// unet: the model chosen for this workflow in Settings, else the template's ref2va.
function loaders(template, character, unet, extra = []) {
  const g = {
    unet: { class_type: 'UNETLoader', inputs: { unet_name: unet || template['301'].inputs.unet_name, weight_dtype: 'default' } },
    clip: { class_type: 'CLIPLoader', inputs: { ...template['2'].inputs } },
    vvae: { class_type: 'VAELoader', inputs: { ...template['3'].inputs } },
    avae: { class_type: 'VAELoader', inputs: { ...template['4'].inputs } },
    turbo: { class_type: 'LoraLoaderModelOnly', inputs: { model: ['unet', 0], lora_name: template['5'].inputs.lora_name, strength_model: 1 } }
  }
  let model = ['turbo', 0]
  if (character && !character.lora) throw new Error(`${character.name} is a RefMod character; sequences need a character with a LoRA. Use Create for RefMod characters.`)
  if (character) {
    g.char = { class_type: 'LoraLoaderModelOnly', inputs: { model, lora_name: character.lora, strength_model: character.strength ?? 0.8 } }
    model = ['char', 0]
  }
  cleanSequenceLoras(extra).forEach((l, k) => {
    g[`lora${k + 1}`] = { class_type: 'LoraLoaderModelOnly', inputs: { model, lora_name: l.name, strength_model: l.strength } }
    model = [`lora${k + 1}`, 0]
  })
  return { g, model }
}

const save = (images, audio, prefix) => ({
  class_type: 'VHS_VideoCombine',
  inputs: { images, audio, frame_rate: 24, loop_count: 0, filename_prefix: prefix, format: 'video/h264-mp4', pix_fmt: 'yuv420p', crf: 17, save_metadata: true, trim_to_audio: false, pingpong: false, save_output: true }
})

export function validateSequence(seq, characters) {
  const errors = []
  const character = seq.character === 'none' ? null : characters.find((c) => c.id === seq.character)
  if (seq.character !== 'none' && !character) errors.push(`Unknown character "${seq.character}".`)
  if (character && !character.lora) errors.push(`${character.name} is a RefMod character; sequences need a character with a LoRA. Use Create for RefMod characters.`)
  if (!seq.shots?.length) errors.push('Add at least one shot.')
  seq.shots?.forEach((s, i) => !s.prompt?.trim() && errors.push(`Shot ${i + 1} has no prompt.`))
  if (seq.shots?.length > 8) errors.push('At most 8 shots in one take.')
  if (!SHOT_SECONDS.includes(seq.shotSeconds)) errors.push(`Shot length must be ${SHOT_SECONDS.join(' or ')} seconds.`)
  if (errors.length) throw Object.assign(new Error(errors.join(' ')), { errors })
  return character
}

// The whole sequence as one continuous take.
export function takeGraph({ template, seq, character, name, voiceRef, unet }) {
  const { g, model } = loaders(template, character, unet, seq.loras)
  const { width, height } = resolveSize(seq.aspect, seq.megapixels)
  const frames = resolveFrames(seq.shotSeconds)
  const sampler = {
    model,
    clip: ['clip', 0],
    video_vae: ['vvae', 0],
    audio_vae: ['avae', 0],
    script: seq.shots.map((s) => fill(takeShot(s.prompt, { wrapped: !!voiceRef }), character)).join('\n---\n'),
    shot_count: 0,
    width,
    height,
    frames_per_shot: frames,
    seed: seq.seed,
    steps: seq.steps,
    seed_per_shot: true,
    sampler_name: 'er_sde',
    scheduler: 'beta',
    save_every_shot: false
  }
  if (voiceRef) {
    g.voice = { class_type: 'LoadAudio', inputs: { audio: voiceRef } }
    sampler.voice_ref = ['voice', 0]
  }
  g.take = { class_type: 'H3MultishotSampler', inputs: sampler }
  g[SAVES.master] = save(['take', 0], ['take', 1], `H3/sequences/${name}_take`)
  const seconds = (frames * seq.shots.length) / 24
  return { graph: g, resolved: { width, height, framesPerShot: frames, shots: seq.shots.length, seconds: +seconds.toFixed(1) } }
}

// Redo start..end seconds of a finished video. Everything outside the window is kept as it was.
export function retakeGraph({ template, seq, character, name, sourcePath, prompt, start, end, mode, seed, unet }) {
  const { g, model } = loaders(template, character, unet, seq.loras)
  g.src = { class_type: 'VHS_LoadVideoPath', inputs: { video: sourcePath, force_rate: 24, custom_width: 0, custom_height: 0, frame_load_cap: 0, skip_first_frames: 0, select_every_nth: 1, format: 'AnimateDiff' } }
  g.sampler = { class_type: 'KSamplerSelect', inputs: { sampler_name: 'er_sde' } }
  g.sigmas = { class_type: 'BasicScheduler', inputs: { model, scheduler: 'beta', steps: seq.steps, denoise: 1 } }
  g.retake = {
    class_type: 'H3Retake',
    inputs: { model, clip: ['clip', 0], video_vae: ['vvae', 0], audio_vae: ['avae', 0], images: ['src', 0], audio: ['src', 2], prompt: fill(prompt, character), start_seconds: start, end_seconds: end, mode: RETAKE_MODES[mode], seed, sampler: ['sampler', 0], sigmas: ['sigmas', 0] }
  }
  g[SAVES.master] = save(['retake', 0], ['retake', 1], `H3/sequences/${name}_retake`)
  return { graph: g }
}

// The finishing pass on a master: optional colour smoothing across joins, then DLSS (scale, frame rate).
export function renderOutGraph({ template, name, sourcePath, normalize, scale, fps }) {
  const g = {}
  let pathRef
  if (normalize) {
    g.src = { class_type: 'VHS_LoadVideoPath', inputs: { video: sourcePath, force_rate: 24, custom_width: 0, custom_height: 0, frame_load_cap: 0, skip_first_frames: 0, select_every_nth: 1, format: 'AnimateDiff' } }
    g.norm = { class_type: 'H3ChainNormalize', inputs: { images: ['src', 0], baseline_seconds: 10, skip_seconds: 2, fps: 24, strength: 1, deadband: 1.06, ema: 0.1, colour_match: true } }
    g.smooth = save(['norm', 0], ['src', 2], `H3/sequences/${name}_smoothed`)
    g.pick = { class_type: 'VHS_SelectFilename', inputs: { filenames: ['smooth', 0], index: -1 } }
    pathRef = ['pick', 0]
  } else {
    g.path = { class_type: 'PrimitiveString', inputs: { value: sourcePath } }
    pathRef = ['path', 0]
  }
  g.dlss = { class_type: 'DLSS5_Enhance_Video', inputs: { ...template['703'].inputs, 'Video Path': pathRef, Scale: scale, 'Target FPS': fps, 'Filename Prefix': name, 'Output Directory': 'H3/sequences' } }
  g[SAVES.final] = { class_type: 'PreviewAny', inputs: { source: ['dlss', 0] } }
  return { graph: g }
}
