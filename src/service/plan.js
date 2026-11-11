// Turns a render request (from the studio or an agent) into the groups and node values of the IV Studio
// graph, and resolves the real pixel size, frame count and duration before anything runs.

export const MODES = {
  text: { group: 'mode1', label: 'Text to video', model: 'fl2va' },
  frames: { group: 'mode2', label: 'First / last frame', model: 'fl2va' },
  reference: { group: 'mode3', label: 'Reference to video', model: 'ref2va' },
  continue: { group: 'mode4', label: 'Continue a video', model: 'fl2va' }
}

export const ASPECTS = {
  '16:9': '16:9 (Widescreen)',
  '9:16': '9:16 (Portrait Widescreen)',
  '1:1': '1:1 (Square)',
  '4:3': '4:3 (Standard)',
  '3:4': '3:4 (Portrait Standard)',
  '3:2': '3:2 (Photo)',
  '2:3': '2:3 (Portrait Photo)',
  '21:9': '21:9 (Ultrawide)'
}

// DLSS takes 30/50/60/120; the cloud's RIFE takes whole multiples of 24 (48/72/120). The studio
// checks a request against what the connected ComfyUI can do (remote.js capabilities).
export const FRAME_GEN_FPS = [0, 30, 48, 50, 60, 72, 120]
const RATIO = { '16:9': [16, 9], '9:16': [9, 16], '1:1': [1, 1], '4:3': [4, 3], '3:4': [3, 4], '3:2': [3, 2], '2:3': [2, 3], '21:9': [21, 9] }

// ComfyUI's ResolutionSelector, multiple 32.
export function resolveSize(aspect, megapixels) {
  const [a, b] = RATIO[aspect]
  const s = Math.sqrt((megapixels * 1024 * 1024) / (a * b))
  return { width: Math.round((a * s) / 32) * 32, height: Math.round((b * s) / 32) * 32 }
}

// Seedhunter 2.5's formula: seconds -> frames on H3's 17n+5 grid at 24 fps.
export function resolveFrames(seconds) {
  const f = Math.max(5, Math.round(seconds * 24))
  return f + ((5 - (f % 17)) % 17 + 17) % 17
}

// The latent upscaler sizes by megapixels with 32-pixel alignment; this is its result for a given input.
export function resolveFinalSize(width, height, megapixels) {
  const s = Math.sqrt((megapixels * 1024 * 1024) / (width * height))
  return { width: Math.round((width * s) / 32) * 32, height: Math.round((height * s) / 32) * 32 }
}

const loraState = (loras) =>
  JSON.stringify({ version: 1, sep: ', ', cacheMode: 'last', loras: loras.map((l) => ({ name: l.name, on: true, sm: l.strength ?? 0.8, sc: l.strength ?? 0.8, triggers: [] })) })

export const DEFAULTS = {
  mode: 'text',
  prompt: '',
  character: 'tess',
  aspect: '16:9',
  megapixels: 0.4,
  seconds: 5,
  steps: 8,
  // the preview pass's sampler (KSamplerSelect, node 12) and scheduler (BasicScheduler, node 13); the 2 MP finish
  // keeps its own tuned refine (er_sde, linear_quadratic, 2 steps at 0.4)
  sampler: 'er_sde',
  scheduler: 'beta',
  seed: 4242,
  previews: 3,
  overlapFrames: 22,
  media: [],
  voiceLine: null,
  refmods: [],
  retention: 1,
  extraLoras: []
}

// request: see DEFAULTS. characters: [{id, name, lora, strength, trigger}]. Returns the plan or throws.
export function planPreviews(request, characters) {
  const r = { ...DEFAULTS, ...request }
  const errors = []
  const mode = MODES[r.mode]
  if (!mode) errors.push(`Unknown mode "${r.mode}". Use ${Object.keys(MODES).join(', ')}.`)
  if (!ASPECTS[r.aspect]) errors.push(`Unknown aspect "${r.aspect}". Use ${Object.keys(ASPECTS).join(', ')}.`)
  if (!(r.megapixels >= 0.1 && r.megapixels <= 2.5)) errors.push('megapixels must be between 0.1 and 2.5.')
  if (!(r.seconds >= 1 && r.seconds <= 15)) errors.push('seconds must be between 1 and 15.')
  if (!r.prompt?.trim()) errors.push('A prompt is required.')
  if (!/^[\w.+-]{1,60}$/.test(String(r.sampler || ''))) errors.push(`Unknown sampler "${r.sampler}".`)
  if (!/^[\w.+-]{1,60}$/.test(String(r.scheduler || ''))) errors.push(`Unknown scheduler "${r.scheduler}".`)
  const character = r.character === 'none' ? null : characters.find((c) => c.id === r.character)
  if (r.character !== 'none' && !character) errors.push(`Unknown character "${r.character}".`)
  // a RefMod character (refmods.js) is RefMod 1, ahead of any RefMods picked for the shot; a LoRA character loads its LoRA
  const refChar = character && !character.lora && character.refmod ? character : null
  const refmods = refChar ? [{ name: refChar.refmod, strength: refChar.strength ?? 1, copies: 1 }, ...r.refmods.filter((m) => m.name !== refChar.refmod)] : r.refmods
  const pictures = r.media.filter((m) => m.kind === 'picture')
  const videos = r.media.filter((m) => m.kind === 'video')
  if (r.mode === 'frames' && (pictures.length < 1 || pictures.length > 2)) errors.push('First / last frame needs 1 picture (first frame) or 2 (first and last).')
  if (r.mode === 'reference' && !r.media.length && !refmods.length) errors.push('Reference to video needs at least one picture, video or audio reference, or a RefMod.')
  if (r.mode === 'continue' && videos.length !== 1) errors.push('Continue a video needs exactly one source video.')
  if (r.mode === 'continue' && ![5, 22, 39, 56].includes(r.overlapFrames)) errors.push('Overlap frames must be 5, 22, 39 or 56.')
  if (refmods.length > 8) errors.push(refChar ? 'At most 7 RefMods with a RefMod character (it takes the first).' : 'At most 8 RefMods.')
  if (errors.length) throw Object.assign(new Error(errors.join(' ')), { errors })

  const previews = r.mode === 'continue' ? 1 : Math.min(3, Math.max(1, Math.round(r.previews)))
  const size = resolveSize(r.aspect, r.megapixels)
  const frames = resolveFrames(r.seconds)
  const groups = [mode.group, character && !refChar ? 'char_tess' : 'char_none', 'select1']
  for (let k = 1; k <= previews; k++) groups.push(`preview${k}`)
  if (r.voiceLine) groups.push('voice')
  if (refmods.length) groups.push('refmods')

  const values = {
    '87': r.prompt,
    '501.aspect_ratio': ASPECTS[r.aspect],
    '501.megapixels': r.megapixels,
    '82': r.seconds,
    '503': r.steps,
    '12.sampler_name': r.sampler,
    '13.scheduler': r.scheduler,
    '81.seed': r.seed,
    '410.LoraLoaderState': loraState(r.extraLoras)
  }
  if (refChar) values['1004'] = refChar.name
  else if (character) {
    values['1001.LoraLoaderState'] = loraState([{ name: character.lora, strength: character.strength }])
    values['1002'] = character.trigger
  }
  const mediaNode = { frames: '202', reference: '302', continue: '602' }[r.mode]
  if (mediaNode) values[`${mediaNode}.media_state`] = JSON.stringify(r.media.map(mediaItem))
  if (r.mode === 'continue') values['604'] = r.overlapFrames
  if (r.voiceLine) values['801.audio'] = r.voiceLine
  if (refmods.length) {
    for (let k = 1; k <= 8; k++) {
      const m = refmods[k - 1]
      values[`1101.mod_${k}`] = m ? m.name : '(none)'
      values[`1101.strength_${k}`] = m ? (m.strength ?? 1) : 1
      values[`1101.copies_${k}`] = m ? (m.copies ?? 1) : 1
    }
    values['1102'] = r.retention
  }
  return {
    request: r,
    groups,
    values,
    resolved: { ...size, frames, seconds: +(frames / 24).toFixed(3), fps: 24, previews, model: mode.model, seeds: [r.seed, r.seed + 1000, r.seed + 2000].slice(0, previews) }
  }
}

// A finish re-uses the preview plan's groups and values unchanged (so the picked latent's fingerprint
// matches and IV Latent Cache skips re-sampling), keeping only the picked preview and adding the upscale.
// The finish's enhancer: DLSS 5 (in the graph: noise reduction, RTX 2x, frame generation), SeedVR2 (a step after
// a DLSS-free finish, to a short side of enhanceResolution) or upscale (the finish's own Real-ESRGAN 2× and RIFE
// frame rate, with no DLSS 5: what a Mac uses).
export const ENHANCERS = ['dlss', 'seedvr2', 'upscale']
export const SEEDVR2_SIZES = [1080, 1440, 2160]
export function planFinish(previewPlan, finish) {
  const f = { candidate: 1, megapixels: 2, upscale2x: false, fps: 0, audio: 'pass', rerollSeed: null, enhancer: 'dlss', enhanceResolution: 1080, ...finish }
  // SeedVR2 instead of DLSS 5: the finish skips DLSS (no 2x, no frame generation) and SeedVR2 follows it
  if (f.enhancer === 'seedvr2') Object.assign(f, { upscale2x: false, fps: 0 })
  const errors = []
  if (!ENHANCERS.includes(f.enhancer)) errors.push(`enhancer must be ${ENHANCERS.slice(0, -1).join(', ')} or ${ENHANCERS.at(-1)}.`)
  if (f.enhancer === 'seedvr2' && !SEEDVR2_SIZES.includes(f.enhanceResolution)) errors.push(`enhanceResolution must be ${SEEDVR2_SIZES.join(', ')}.`)
  const n = previewPlan.resolved.previews
  if (!(f.candidate >= 1 && f.candidate <= n)) errors.push(`candidate must be 1..${n}.`)
  if (!FRAME_GEN_FPS.includes(f.fps)) errors.push(`fps must be one of ${FRAME_GEN_FPS.join(', ')} (0 = off).`)
  if (!(f.megapixels >= 0.5 && f.megapixels <= 4)) errors.push('megapixels must be between 0.5 and 4.')
  if (f.audio === 'voice' && !previewPlan.request.voiceLine) errors.push('Final audio "voice" needs a voice line.')
  if (errors.length) throw Object.assign(new Error(errors.join(' ')), { errors })

  const single = previewPlan.request.mode === 'continue'
  const keep = previewPlan.groups.filter((g) => !/^preview\d$|^select\d$/.test(g))
  const groups = [...keep, `preview${f.candidate}`, `select${f.candidate}`, single ? 'single' : 'upscale']
  if (!single && f.audio === 'preview') groups.push('audio_preview')
  if (!single && f.audio === 'voice') groups.push('audio_voice')
  const values = { ...previewPlan.values, '504': f.megapixels, '511': f.upscale2x ? 2 : 1, '512': f.fps }
  if (f.rerollSeed != null) values['505.seed'] = f.rerollSeed
  else values['505.seed'] = previewPlan.request.seed + 444
  const { width, height } = previewPlan.resolved
  const base = single ? { width, height } : resolveFinalSize(width, height, f.megapixels)
  const scale = f.enhancer === 'seedvr2' ? f.enhanceResolution / Math.min(base.width, base.height) : f.upscale2x ? 2 : 1
  const frames = previewPlan.resolved.frames
  return {
    finish: f,
    groups,
    values,
    resolved: {
      width: Math.round((base.width * scale) / 2) * 2,
      height: Math.round((base.height * scale) / 2) * 2,
      enhancer: f.enhancer,
      ...(f.enhancer === 'seedvr2' ? { finishWidth: base.width, finishHeight: base.height } : {}),
      // what the latent upscaler makes, before DLSS or SeedVR2 (remote.js hands it to ComfyUI's built-in upscaler)
      ...(single ? {} : { upscaleSize: { width: base.width, height: base.height } }),
      fps: f.fps || 24,
      frames: f.fps ? Math.round((frames / 24) * f.fps) : frames,
      seconds: previewPlan.resolved.seconds,
      singlePass: single
    }
  }
}

function mediaItem(m) {
  const base = { kind: m.kind, file: `${m.file} [input]`, name: m.file.split('/').pop(), duration: m.duration ?? null, width: m.width ?? null, height: m.height ?? null, uid: m.file.slice(-10) }
  if (m.kind === 'video') return { ...base, has_audio: m.hasAudio ?? true, audio_mode: 'paired' }
  return { ...base, has_audio: m.kind === 'audio', audio_mode: 'off' }
}
