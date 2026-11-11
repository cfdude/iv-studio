// Seedance 2.5 as a second engine for IV Studio's shots: the same four modes, form and hunt -> pick -> finish, with
// ComfyUI's ByteDance partner nodes in place of H3. They run on the person's Comfy.org credits through any ComfyUI
// (no GPU needed), so every render is priced and confirmed first (pricing.js, Comfy.submit).
//
//   text       ByteDance2TextToVideoNode (or the reference node when a character's face or a voice line comes along)
//   reference  ByteDance2ReferenceNodeV2, task "reference": up to 30 pictures, 10 videos, 10 sounds
//   frames     ByteDance2FirstLastFrameNode: the first frame, and optionally the last
//   continue   ByteDance2ReferenceNodeV2, task "extend": the clip carries on for `seconds`
//
// Hunting uses "Seedance 2.5 Draft" (480p); a picked draft is finished by ByteDance2DraftToFinalVideoNode at 1080p
// from its draft_task_id. 720p or 1080p takes are finals already. Prompts name references as @image1, @video1,
// @audio1 (ComfyUI's own Seedance templates write them that way), in the order the graph attaches them.
import { fillDefaults, missingInputs } from './nodeschema.js'

export const SEEDANCE = 'seedance'
export const SEEDANCE_LABEL = 'Seedance 2.5'
export const SEEDANCE_TIERS = {
  draft: { model: 'Seedance 2.5 Draft', resolution: '480p', label: 'Draft · 480p', short: 480 },
  '720p': { model: 'Seedance 2.5', resolution: '720p', label: '720p', short: 720 },
  '1080p': { model: 'Seedance 2.5', resolution: '1080p', label: '1080p', short: 1080 }
}
export const SEEDANCE_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9']
export const SEEDANCE_SECONDS = { min: 4, max: 30 }
export const SEEDANCE_LIMITS = { picture: 30, video: 10, audio: 10 }
export const FINAL_FROM_DRAFT = { resolution: '1080p', short: 1080 }
export const NODES = {
  text: 'ByteDance2TextToVideoNode',
  reference: 'ByteDance2ReferenceNodeV2',
  frames: 'ByteDance2FirstLastFrameNode',
  final: 'ByteDance2DraftToFinalVideoNode'
}
export const TAGS = { picture: 'image', video: 'video', audio: 'audio' }
export const tagOf = (kind, n) => `@${TAGS[kind]}${n}`

const RATIO = { '16:9': [16, 9], '9:16': [9, 16], '1:1': [1, 1], '4:3': [4, 3], '3:4': [3, 4], '21:9': [21, 9] }
// The size a tier makes at a ratio (the short side is the tier's lines, the long side to the nearest even pixel).
export function sizeOf(short, ratio) {
  const [a, b] = RATIO[ratio] || RATIO['16:9']
  const long = Math.round(((short * Math.max(a, b)) / Math.min(a, b)) / 2) * 2
  return a >= b ? { width: long, height: short } : { width: short, height: long }
}

// Which node a request renders with, and the task for the reference node.
export function nodeFor(mode, { extraRefs = false } = {}) {
  if (mode === 'frames') return { cls: NODES.frames }
  if (mode === 'continue') return { cls: NODES.reference, task: 'extend' }
  if (mode === 'reference' || extraRefs) return { cls: NODES.reference, task: 'reference' }
  return { cls: NODES.text }
}

// request (Create's form, with engine: 'seedance'): mode, prompt, character, aspect, seconds, previews, seed, media,
// voiceLine, tier ('draft' | '720p' | '1080p'), audio (true). face: the picked character's face picture (a path), if
// it has one. Returns { request, refs, node, resolved } or throws with every problem.
export function planSeedance(request, characters = [], { face = null } = {}) {
  const r = { mode: 'text', prompt: '', character: 'none', aspect: '16:9', seconds: 5, previews: 2, seed: 4242, media: [], voiceLine: null, tier: 'draft', audio: true, ...request }
  const errors = []
  const tier = SEEDANCE_TIERS[r.tier]
  if (!tier) errors.push(`Unknown Seedance quality "${r.tier}". Use ${Object.keys(SEEDANCE_TIERS).join(', ')}.`)
  if (!['text', 'reference', 'frames', 'continue'].includes(r.mode)) errors.push(`Unknown mode "${r.mode}".`)
  if (!SEEDANCE_RATIOS.includes(r.aspect)) errors.push(`Seedance makes ${SEEDANCE_RATIOS.join(', ')}.`)
  const seconds = Math.round(Number(r.seconds))
  if (!(seconds >= SEEDANCE_SECONDS.min && seconds <= SEEDANCE_SECONDS.max)) errors.push(`Seedance makes ${SEEDANCE_SECONDS.min} to ${SEEDANCE_SECONDS.max} seconds.`)
  if (!r.prompt?.trim()) errors.push('A prompt is required.')
  const character = r.character === 'none' ? null : characters.find((c) => c.id === r.character)
  if (r.character !== 'none' && !character) errors.push(`Unknown character "${r.character}".`)

  const pictures = r.media.filter((m) => m.kind === 'picture').map((m) => m.file || m.path)
  const videos = r.media.filter((m) => m.kind === 'video').map((m) => m.file || m.path)
  const audios = r.media.filter((m) => m.kind === 'audio').map((m) => m.file || m.path)
  const notes = []
  // a character comes in as their face picture (H3 LoRAs and RefMods don't apply), after the person's own pictures
  let faceTag = null
  if (character && face && r.mode !== 'frames') {
    pictures.push(face)
    faceTag = tagOf('picture', pictures.length)
  } else if (character && r.mode !== 'frames') notes.push(`${character.name} has no face picture, so Seedance only reads the name.`)
  else if (character) notes.push('First / last frame takes no other pictures, so the character is only named.')
  if (r.voiceLine && r.mode !== 'frames') audios.push(r.voiceLine)
  else if (r.voiceLine) notes.push('First / last frame takes no sound, so the voice line is left out.')

  if (r.mode === 'frames' && (pictures.length < 1 || pictures.length > 2)) errors.push('First / last frame needs 1 picture (the first frame) or 2 (first and last).')
  if (r.mode === 'frames' && (videos.length || audios.length)) errors.push('First / last frame takes pictures only.')
  if (r.mode === 'continue' && videos.length !== 1) errors.push('Continue a video needs exactly one source video.')
  if (r.mode === 'reference' && !pictures.length && !videos.length && !audios.length) errors.push('References needs at least one picture, video or sound (or a character with a face).')
  for (const [kind, list] of [['picture', pictures], ['video', videos], ['audio', audios]]) if (list.length > SEEDANCE_LIMITS[kind]) errors.push(`Seedance takes at most ${SEEDANCE_LIMITS[kind]} ${kind}s.`)
  if (errors.length) throw Object.assign(new Error(errors.join(' ')), { errors })

  const extraRefs = r.mode === 'text' && (pictures.length || audios.length)
  const node = nodeFor(r.mode, { extraRefs })
  const previews = r.mode === 'continue' ? 1 : Math.min(3, Math.max(1, Math.round(r.previews)))
  const size = sizeOf(tier.short, r.aspect)
  // Seedance doesn't infer what a reference is for, so the character's face and the voice line get their role
  // written in when the prompt doesn't name them itself.
  const who = character?.name?.split(/\s+/)[0] || 'The person'
  const roles = []
  if (faceTag && !r.prompt.includes(faceTag)) roles.push(`${faceTag} defines ${who}'s face, hair and build. Do not use the image background.`)
  const voiceTag = r.voiceLine && r.mode !== 'frames' ? tagOf('audio', audios.length) : null
  if (voiceTag && !r.prompt.includes(voiceTag)) roles.push(`${voiceTag} is ${who}'s voice: ${who} says exactly these words, in this voice.`)
  const prompt = (roles.length ? `${roles.join('\n')}\n\n` : '') + withName(r.prompt, character)
  return {
    engine: SEEDANCE,
    request: { ...r, seconds, prompt, character: r.character },
    refs: { pictures, videos, audios, faceTag },
    node,
    notes,
    resolved: {
      ...size,
      seconds,
      frames: seconds * 24 + 1,
      fps: 24,
      previews,
      model: tier.model,
      tier: r.tier,
      draft: r.tier === 'draft',
      seeds: Array.from({ length: previews }, (_, i) => r.seed + i * 1000),
      engine: SEEDANCE
    }
  }
}

// {char} becomes the character's name (Seedance has no trigger words).
export const withName = (prompt, character) => String(prompt || '').replace(/\{char\}/g, character?.name?.split(/\s+/)[0] || 'the person')

// The API-form graph for a plan's takes. staged: the names ComfyUI knows the references by (in its input folder),
// in the plan's order: { pictures, videos, audios }. info: /object_info for the classes used (to fill defaults).
// name: the output name prefix. One node per take, each with its own SaveVideo and a PreviewAny that reports the
// take's draft_task_id (so a draft can be finished later).
export function seedanceGraph(plan, staged, info, name) {
  const { request: r, node, resolved } = plan
  const tier = SEEDANCE_TIERS[r.tier]
  const g = {}
  const refs = { pictures: [], videos: [], audios: [] }
  staged.pictures.forEach((f, i) => ((g[`img${i + 1}`] = { class_type: 'LoadImage', inputs: { image: f }, _meta: { title: `@image${i + 1}` } }), refs.pictures.push(`img${i + 1}`)))
  staged.videos.forEach((f, i) => ((g[`vid${i + 1}`] = { class_type: 'LoadVideo', inputs: { file: f }, _meta: { title: `@video${i + 1}` } }), refs.videos.push(`vid${i + 1}`)))
  staged.audios.forEach((f, i) => ((g[`aud${i + 1}`] = { class_type: 'LoadAudio', inputs: { audio: f }, _meta: { title: `@audio${i + 1}` } }), refs.audios.push(`aud${i + 1}`)))

  for (let k = 1; k <= resolved.previews; k++) {
    const inputs = {
      model: tier.model,
      'model.prompt': r.prompt,
      'model.resolution': tier.resolution,
      'model.duration': resolved.seconds,
      'model.generate_audio': r.audio !== false,
      seed: resolved.seeds[k - 1] % 2147483647,
      watermark: false
    }
    if (node.cls !== NODES.frames) inputs['model.ratio'] = r.aspect
    if (node.cls === NODES.frames) {
      inputs.first_frame = [refs.pictures[0], 0]
      if (refs.pictures[1]) inputs.last_frame = [refs.pictures[1], 0]
    }
    if (node.cls === NODES.reference) {
      inputs['model.task_type'] = node.task
      refs.pictures.forEach((id, i) => (inputs[`model.reference_images.image_${i + 1}`] = [id, 0]))
      refs.videos.forEach((id, i) => (inputs[`model.reference_videos.video_${i + 1}`] = [id, 0]))
      refs.audios.forEach((id, i) => (inputs[`model.reference_audios.audio_${i + 1}`] = [id, 0]))
    }
    g[`take${k}`] = { class_type: node.cls, inputs: info?.[node.cls] ? fillDefaults(info[node.cls], inputs) : inputs, _meta: { title: `${SEEDANCE_LABEL} take ${k}` } }
    g[`save${k}`] = saveNode(`take${k}`, `${name}_take${k}`, info)
    if (resolved.draft) g[`tid${k}`] = { class_type: 'PreviewAny', inputs: { source: [`take${k}`, 1] }, _meta: { title: `draft task ${k}` } }
  }
  return g
}

// A picked draft at 1080p: Draft to Final from the draft's task id.
export function finalGraph(draftTaskId, info, name) {
  const inputs = { draft_task_id: String(draftTaskId), watermark: false }
  return {
    final: { class_type: NODES.final, inputs: info?.[NODES.final] ? fillDefaults(info[NODES.final], inputs) : inputs, _meta: { title: `${SEEDANCE_LABEL} final` } },
    savefinal: saveNode('final', `${name}_final`, info)
  }
}

function saveNode(from, prefix, info) {
  const inputs = { video: [from, 0], filename_prefix: `IV Studio/seedance/${prefix}`, format: 'mp4', 'format.codec': 'h264' }
  return { class_type: 'SaveVideo', inputs: info?.SaveVideo ? fillDefaults(info.SaveVideo, inputs) : inputs, _meta: { title: 'save' } }
}

// Every node's missing required inputs (a graph IV Studio built wrongly), as "take1: model.prompt" lines.
export function graphProblems(graph, info) {
  const out = []
  for (const [id, n] of Object.entries(graph)) {
    const def = info?.[n.class_type]
    if (!def) {
      out.push(`${id}: ComfyUI has no ${n.class_type}`)
      continue
    }
    for (const m of missingInputs(def, n.inputs)) out.push(`${id}: ${m}`)
  }
  return out
}

// The saved takes of a finished prompt: [{ candidate, file, draftTaskId }] from SaveVideo (its video is listed under
// "images", or "videos" in some ComfyUI versions) and PreviewAny's text.
export function takesFrom(outputs, previews) {
  const list = []
  for (let k = 1; k <= previews; k++) {
    const o = outputs?.[`save${k}`]
    const f = [...(o?.images || []), ...(o?.videos || []), ...(o?.gifs || [])].find((x) => /\.(mp4|mov|webm|mkv)$/i.test(x.filename || ''))
    const text = outputs?.[`tid${k}`]?.text
    const id = Array.isArray(text) ? text.flat().find((t) => typeof t === 'string' && t.trim()) : typeof text === 'string' ? text : null
    if (f) list.push({ candidate: k, file: f, draftTaskId: id ? id.trim() : null })
  }
  return list
}

export function finalFrom(outputs) {
  const o = outputs?.savefinal
  return [...(o?.images || []), ...(o?.videos || []), ...(o?.gifs || [])].find((x) => /\.(mp4|mov|webm|mkv)$/i.test(x.filename || '')) || null
}

// @ mentions for Seedance: a cast member or place with a picture is attached as the next @imageN, with a role line
// first; one without a picture is written as their name. Seedance's own tags (@image1 …) aren't mentions.
export const OWN_TAG = /^(image|video|audio|asset)_?\d+$/i
export function seedanceMentions(request, members) {
  const handles = [...new Set([...String(request.prompt || '').matchAll(/(^|[^\w@<])@([A-Za-z][\w-]*)/g)].map((m) => m[2]))].filter((h) => !OWN_TAG.test(h))
  if (!handles.length) return { request, notes: [] }
  const notes = []
  let prompt = request.prompt
  const media = [...(request.media || [])]
  const roles = []
  const replace = (text, h, by) => text.replace(new RegExp(`(^|[^\\w@<])@${h}\\b`, 'gi'), `$1${by}`)
  for (const h of handles) {
    const m = members.find((x) => x.handle.toLowerCase() === h.toLowerCase())
    if (!m) {
      notes.push({ level: 'error', message: `@${h} isn't in your cast or places.` })
      continue
    }
    const word = m.kind === 'character' ? m.name.split(/\s+/)[0] : m.name
    if (m.kind === 'character' && m.id === request.character) {
      prompt = replace(prompt, h, '{char}')
      continue
    }
    if (!m.picture || request.mode === 'frames') {
      prompt = replace(prompt, h, word)
      if (m.picture) notes.push({ level: 'warning', message: `First / last frame takes no other pictures, so @${h} is written as "${word}".` })
      continue
    }
    if (!media.some((x) => (x.file || x.path) === m.picture)) media.push({ kind: 'picture', file: m.picture })
    const n = media.filter((x) => x.kind === 'picture').findIndex((x) => (x.file || x.path) === m.picture) + 1
    prompt = replace(prompt, h, word)
    roles.push(m.kind === 'character' ? `@image${n} defines ${word}'s face, hair and build. Do not use the image background.` : `@image${n} defines the place: ${m.name}. Keep its layout, light and colours.`)
  }
  if (roles.length) prompt = `${roles.join('\n')}\n\n${prompt}`
  const mode = roles.length && request.mode === 'text' ? 'reference' : request.mode
  return { request: { ...request, prompt, media, mode }, notes }
}
