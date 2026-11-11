// Prompt writer: turns a plain-words idea into a MiniMax H3 prompt, so nobody has to learn the format.
//   contextir - MiniMax's own rewriter (H3 Context IR), run as a ComfyUI partner node. Paid per call
//               through the user's Comfy.org API key; sees the reference media.
//   local     - a model in the user's own Ollama with IV Studio's H3 rule sheet and MiniMax's own H3 guide
//               (h3guide.js). Free and private; the model is unloaded right after writing so H3 gets the GPU back.
//   claude, codex - the person's own Claude Code or Codex (harness.js), with the same rules and guide.
//   openai    - the same as local, on an OpenAI-compatible server (llm.js; Settings calls it OpenAI-compatible).
//               writerOf (paths.js) hands it on as engine 'local'; localChat picks the server.
// The character is written as its first name for the writer and turned back into {char} afterwards.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import ffmpegStatic from 'ffmpeg-ffprobe-static'
import { DIRECTING, DIRECTING_SOURCE } from './directing.js'
import { loadGuide } from './h3guide.js'
import { harnessJson, onPath } from './harness.js'
import { FIRST_FRAME_LINE, firstLastLine, lintPrompt, withLine } from './lint.js'
import { isPrevis } from './staging.js'
import { llmConfig, openaiChat, openaiModels } from './llm.js'

// The bundled ffmpeg, outside the asar in a packaged app (as in main and the MCP server).
const unpacked = (p) => p && p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`)
const FFMPEG = unpacked(ffmpegStatic.ffmpegPath)
const FFPROBE = unpacked(ffmpegStatic.ffprobePath)

export const OLLAMA_URL = 'http://127.0.0.1:11434'

// Where Ollama is: Settings → Prompt writer → Ollama address, else OLLAMA_HOST (Ollama's own variable), else this PC.
// Main and the MCP server point ollamaSource at their settings. An Ollama elsewhere (another container or PC) isn't
// started by IV Studio, and isn't sent to the CPU while ComfyUI renders, since it doesn't share this GPU.
let ollamaSource = () => ''
export const setOllamaSource = (fn) => (ollamaSource = fn)
export function normalizeOllamaUrl(value) {
  let v = String(value || '').trim()
  if (!v) return ''
  if (!/^https?:\/\//i.test(v)) v = `http://${v}`
  const u = new URL(v)
  if (u.hostname === '0.0.0.0') u.hostname = '127.0.0.1'
  if (!u.port && !/^https:/i.test(v)) u.port = '11434'
  return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`
}
export function ollamaUrl(env = process.env) {
  for (const v of [ollamaSource(), env.OLLAMA_HOST]) {
    try {
      const u = normalizeOllamaUrl(v)
      if (u) return u
    } catch {}
  }
  return OLLAMA_URL
}
export function ollamaIsLocal(url = ollamaUrl()) {
  try {
    return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(new URL(url).hostname)
  } catch {
    return false
  }
}
// Ollama options that keep the writer off the GPU while ComfyUI renders on this PC.
export const cpuOptions = (cpu) => (cpu && ollamaIsLocal() ? { num_gpu: 0 } : {})
export const DEFAULT_LOCAL_MODEL = 'huihui_ai/qwen3-vl-abliterated:8b-instruct'

// The local writer's model, ready to use: { name, vision, provider }. With an OpenAI-compatible server chosen, the
// model and "sees pictures" come from its settings (the model asked for is the Ollama one, so it's ignored).
// needsEyes: what the job is called when it can't be done without pictures ("review a take").
export async function localWriterModel(model, { needsEyes = null } = {}) {
  const cfg = llmConfig()
  if (cfg.provider === 'openai') {
    if (!cfg.url) throw new Error('The OpenAI-compatible writer has no address. Enter it in Settings → Prompt writer.')
    if (!cfg.model) throw new Error('Choose the model for the OpenAI-compatible writer in Settings → Prompt writer.')
    // a server that lists its models must list this one; one that doesn't list (or can't be asked) is tried anyway
    const listed = await openaiModels(cfg).catch((err) => (/refused the key/.test(err.message) ? Promise.reject(err) : []))
    if (listed.length && !listed.includes(cfg.model)) throw new Error(`The OpenAI-compatible server at ${cfg.url} doesn't list the model "${cfg.model}". Choose one of its models in Settings → Prompt writer.`)
    if (needsEyes && !cfg.vision) throw new Error(`The OpenAI-compatible writer is set to not see pictures, so it can't ${needsEyes}. If ${cfg.model} can, turn on "It can see pictures" in Settings → Prompt writer, or choose Claude Code or Codex.`)
    return { name: cfg.model, vision: cfg.vision, provider: 'openai' }
  }
  await ensureOllama()
  const name = model || DEFAULT_LOCAL_MODEL
  const info = (await ollamaStatus()).models.find((m) => m.name === name)
  if (!info) throw new Error(`The writer model ${name} isn't in Ollama yet. Install it in Settings → Prompt writer.`)
  if (needsEyes && !info.vision) throw new Error(`${name} can't see pictures, so it can't ${needsEyes}. Choose a vision model, Claude Code or Codex in Settings → Prompt writer.`)
  return { name, vision: info.vision, provider: 'ollama' }
}

// One structured answer from the local writer (Ollama, or the OpenAI-compatible server): system + messages in
// ([{ role, content, images?: [base64 JPEG] }]), the parsed JSON of `schema`'s shape out. Ollama unloads the model
// afterwards and, with cpu, keeps it off the GPU while ComfyUI renders; a server manages its own models.
// raw: return the reply text instead (writeLocal parses and retries itself).
// signal: stops the answer early (the Library's describer stops when a render starts).
export async function localChat({ model, system, messages, schema, temperature = 0.5, ctx = 16384, maxTokens = 6000, cpu = false, timeoutMs = 600000, raw = false, signal = null }) {
  const cfg = llmConfig()
  let text
  if (cfg.provider === 'openai') text = await openaiChat({ cfg, model: cfg.model, system, messages, schema, temperature, maxTokens, timeoutMs })
  else {
    await ensureOllama()
    const r = await fetch(`${ollamaUrl()}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: model || DEFAULT_LOCAL_MODEL, stream: false, format: schema, keep_alive: 0, options: { temperature, num_ctx: ctx, num_predict: maxTokens, ...cpuOptions(cpu) }, messages: [{ role: 'system', content: system }, ...messages] }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs)
    })
    if (!r.ok) throw new Error(`Ollama: ${(await r.text()).slice(0, 300)}`)
    text = (await r.json()).message?.content
  }
  return raw ? text : parseJson(text)
}
export const CONTEXT_IR_PRICE = 'about $0.02 a prompt ($0.05 with first/last frames, $0.06–0.11 with reference media)'

const RULES = `You write prompts for MiniMax H3, a model that makes short videos with native sound (24 fps, picture and audio together).
Write in English. Answer with JSON only, in the shape you are given.

DIRECTION (decide it first, in "direction", before you write any shot)
- purpose: the emotional change the video shows, the visible action that shows it, and the one or two details that must survive (a face, a product, a logo, a prop).
- staging: where each person starts by screen side (screen-left is the viewer's left, not the character's), which way they face, who they look at, how far apart they are, and where they move. With two people, keep the camera on one side of the line between them.
- Don't add dialogue, characters, props, camera moves or places the idea doesn't need, just to fill the time. A quiet reaction can carry the scene.
- Frame the action so it reads: hands and the object for a small action, enough body and floor for a movement, the face for a reaction.

DIRECTING RULES
- Cover the whole duration with continuous action; every beat has a visible action, a reaction or consequence, and the state it leaves. End on a settled, visible result with a little time to spare.
- Open the first shot with who is where, wardrobe, setting, light and key props, then the action.
- Use a new shot only when a cut adds new information. Later shots start at strictly increasing times inside the duration.
- Camera: one compatible move at a time, written like "The camera pushes in with small amplitude at slow speed toward her hands." Use "The camera holds a static shot" for a locked camera.
- Dialogue: speakers get stable IDs in the order they first speak, written right after who they are, e.g. "Mara (S1)" or "the older fisherman in the orange vest (S1)". The first time someone speaks, say who they are and what their voice is like ("the older fisherman in the orange vest, with a gravelly, slow voice (S1), shouts:"); later just "the fisherman in orange (S1) says:". Never use S1 or S2 as a name on its own. Put ONLY the exact spoken words inside <d>[English] ...</d>, never quotation marks. Describe delivery and the listener's reaction outside the tag. Keep lines short enough to say naturally in the time: about 2.5 words a second, with room for reactions.
- "style" names the medium first. When the pictures you are shown are animated, drawn, painted, clay or 3D renders, say so ("3D animated film, soft painterly light") and never "Live-action"; use "Live-action" only for photographs, filmed footage or no pictures at all.
- Describe what is seen and heard, positively and concretely. No negative prompts, no camera or render settings, no real people, no imitation of named artists or franchises.
- Keep identities, wardrobe, props, light and screen direction consistent unless something visibly changes them.
- soundscape: 1-4 sentences of ambience, physical action sounds and breaths (no dialogue, no music). music: 1-3 sentences of audience-only music, or "N/A".

EXAMPLE of the shape only (do not reuse its scene, props or lines; 10 seconds, main character Mara):
{"direction": {"purpose": "Mara's quiet pride turns into a playful win over her neighbour; the tomato toss shows it. Her mustard apron and green watering can stay the same throughout.", "staging": "Mara stands screen-right between the beds, facing screen-left toward the low wall; the neighbour leans over the wall screen-left, facing her, about three metres away. The camera stays on the garden side of the wall."}, "style": "Live-action, warm late-afternoon light, shallow depth of field.", "shots": [{"start_seconds": 0, "description": "Wide shot of a rooftop vegetable garden at golden hour: Mara stands between raised beds in a mustard apron over a white T-shirt, a green watering can in her right hand. The camera pushes in with small amplitude at slow speed. A neighbour (S1) in a striped shirt leans over the low wall and calls: <d>[English] Your tomatoes beat mine again!</d> Mara (S2) laughs and lifts the watering can in a salute."}, {"start_seconds": 6, "description": "The camera cuts to a medium shot of Mara as she plucks a ripe tomato and tosses it across the wall. The neighbour catches it with both hands and grins. Mara (S2) answers: <d>[English] Bribery works.</d> She turns back to the beds, still smiling."}], "soundscape": "A light breeze rustles the tomato leaves, water patters from the can onto soil, and city traffic hums far below. A soft thud as the tomato lands in the neighbour's hands.", "music": "N/A"}`

const CHARACTER_RULE = (name) =>
  `- The main character is called ${name}. Always refer to them as ${name}. Their face, hair, body and voice come from a trained character model: never describe ${name}'s face, hair, age, ethnicity, body or voice. Do describe their clothes, position, actions, expressions in action terms and what they say.`

const MODE_RULES = {
  text: '',
  frames: `- The video starts on a fixed first picture (I2VA in MiniMax's guide) and is ONE continuous shot, written in three parts instead of "shots": "opening" is the first picture as it is, in one or two sentences (who and what, where, the light); "motion" is what happens next, two to four sentences: an action begins and develops, with the camera move and any spoken line; "ending" is the visible result it settles into. Something must move or change.`,
  framesLast: `- The video starts on a fixed first picture and ends on a fixed last picture (FL2VA in MiniMax's guide). It is ONE continuous shot without a cut, written in three parts instead of "shots": "opening" is the first picture's state, in one or two sentences; "motion" is how it changes towards the last picture, two to four sentences (how people move, how poses, objects, camera, place and light change); "ending" is the last picture's state, described in full (who, where, wearing what, framing, light) as what the video settles into at the very end.`,
  continue: `- This prompt continues an existing video from its last frames. The first shot opens holding the source video's final arrangement (same people, positions, framing and light), then the new action follows.`,
  reference: `- Reference media are attached and named <Picture N>, <Video N> and <Audio N>, numbered separately per kind in the order listed below. Use ONLY labels that exist.
- Also fill "subjects": each person, place, object or style the references define, one per entry, in the order you'll use them (the first is <Subject 1>). Every attached picture and video defines at least one subject, so the subjects together name every label; a picture of a room or a place is a subject (the place). One person seen in two pictures is ONE subject. Things that appear in no reference are not subjects: just describe them in the shots. "definition" says who or what it is and its main visible features, naming the picture or video it comes from, like "the young woman in <Picture 2>, with shoulder-length dark hair and a navy T-shirt".
- In "direction", "priorities" gives each reference its role (identity, wardrobe, logo, place, light, prop, movement) and which one wins where two disagree (a dedicated shoe picture beats the shoes in a character sheet), and names the few details recognition depends on. A reference's pose doesn't fix the performance or the camera.
- "summary": one short paragraph on what the target video is and what each reference supplies, using only the labels defined.
- "retention": one entry per subject: the shots it appears in, how it is kept ("fully_preserved" when it appears as defined, "partially_preserved" when some defined features change, "attribute_transfer" only when its features pass to a different target subject, "weak_reference" for broad similarity of style or mood) and what is kept.
- A picture of a person gives the PERSON, not the scene: keep their face, hair, age, build, wardrobe and what they wear or carry, and nothing of the picture's background, place, light, framing or pose. The place, light, camera and action come from the idea and are new: describe them fresh in the shots, as if the picture had been taken somewhere else. If the idea names no place, choose one that fits the idea instead of the picture's background. A person's "retention" lists only identity and wardrobe, never setting, background, scene or lighting, and the summary never says the setting is kept. Only a picture of a place (no person in it), or an idea that asks for the same place ("here", "in this room", "same place"), sets the place. Every shot happens in the idea's place, [Shot 1] included: never open on the picture's place and cut away from it.
- Each subject also has "backdrop": for a person or thing seen in a picture, what is behind them in that picture, in a few plain words (like "pyramids, sphinx, desert, tourists"); "" for a place. It isn't part of the prompt: IV Studio uses it to keep that backdrop out of the shots unless the idea asks for it.
- In the shots, refer to those people and things as <Subject 1>, <Subject 2>, describing them in full at their first appearance. A subject who speaks is written "<Subject 2> (S1)".
- Put one or two sentences of overall style in "style". The shots together run 350-500 words: each shot gives its composition, who is where and what they wear, the place and light, the action, the camera, and the sound.`
}
const AUDIO_RULE = `- For each <Audio N>, fill "audio": what it is for in the target video ("role", like "the voice-timbre reference for <Subject 1> (S1)" or "the background music") and how it is used ("relation": "reference" when only its voice, style or rhythm is followed, "partially_copy" when part of it is heard, "fully_copy" when it is the whole final soundtrack).`

const SEQUENCE_RULES = `- This shot is one of several that are joined into ONE continuous take with no visible cut between them, so write exactly one shot.
- Describe the place, light and wardrobe the same way, word for word, in every shot.
- Unless it is the first shot, it opens holding the previous shot's exact closing arrangement (same people, positions, framing) and stays quiet for about two seconds, with small natural movement (a breath, a weight shift, an eyeline change), before anyone speaks.
- It ends settled: dialogue finished, people back in a stable arrangement, with about two seconds to spare. That arrangement is what the next shot opens on.
- A spoken line never runs past the end of the shot. Budget about 15 words of speech for a 10 second shot, about 27 for 15 seconds.`

function durationRule(seconds) {
  const s = Math.round(seconds)
  const shots = s <= 6 ? '1-2 shots and at most one short line or two very short exchanges' : s <= 11 ? '1-3 shots and at most 2-4 short lines, each with a visible reaction' : '1-3 shots with natural pauses'
  return `- The video is ${s} seconds long. Plan ${shots}, and only the lines the idea needs. Keep 0.3-0.8 seconds at the end for the reaction or result.`
}

const firstName = (character) => character?.name?.split(/\s+/)[0] || null

// Writer output -> IV Studio prompt: character name back to {char}, fences and thinking removed.
export function cleanPrompt(text, character) {
  let t = String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^```[a-z]*\s*|```\s*$/gim, '')
    .trim()
  const name = firstName(character)
  if (name) t = t.replace(new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), '{char}')
  return t
}

// Spoken lines in H3's tag: <d>[English] words</d> with no quotation marks inside. Quoted speech the
// writer left outside a tag (she says: "...") is moved into one.
export function normalizeDialogue(text) {
  let t = String(text).replace(/<d>\s*(\[[A-Za-z ]+\])?\s*[“"‘']?([\s\S]*?)[”"’']?\s*<\/d>/g, (_, lang, words) => `<d>${lang || '[English]'} ${words.trim()}</d>`)
  if (!/<d>/.test(t)) t = t.replace(/(\b(?:says|asks|whispers|replies|answers|shouts|murmurs|admits|adds)\b[^“"\n]{0,40}?)[:,]?\s*[“"]([^”"]+)[”"]/g, (_, lead, words) => `${lead.trimEnd()}: <d>[English] ${words.trim()}</d>`)
  return t
}

const at = (sec) => {
  const ms = Math.round(sec * 1000)
  const s = ((ms % 60000) / 1000).toFixed(3).padStart(6, '0')
  return `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${s}`
}

// The opening line MiniMax's guide gives each keyframe mode (I2VA: first frame; FL2VA: first and last frame, the
// last landing at the end of the video's real length on H3's frame grid), shared with the prompt checker.
export { FIRST_FRAME_LINE, firstLastLine }

// What a small writer model sometimes repeats from the guide's examples inside a field: field names, shot labels, cut times.
const FIELD_NAMES = /^\s*(?:integrated_multimodal_description|detailed_description|overall_soundscape|non_diegetic_music|subject_definitions|summary|retention_analysis)\s*:\s*/i
const stripShot = (s) => String(s || '').trim().replace(FIELD_NAMES, '').replace(/^\[Shot \d+\]\s*/i, '').replace(/^At \d{1,2}:\d{2}(?:\.\d+)?,?\s*/i, '').trim()
const stripField = (s) => String(s || '').trim().replace(FIELD_NAMES, '').trim()
const sentence = (s) => (s && !/[.!?]$/.test(s) ? `${s}.` : s)

const RELATIONS = ['fully_preserved', 'partially_preserved', 'attribute_transfer', 'weak_reference']
const AUDIO_RELATIONS = ['fully_copy', 'partially_copy', 'reference', 'weak_reference']
const pick = (v, list, fallback) => {
  const k = String(v || '').toLowerCase().replace(/[\s-]+/g, '_')
  return list.find((x) => x === k) || list.find((x) => k && (x.startsWith(k) || k.startsWith(x.split('_')[0]))) || fallback
}

// The writer's JSON -> the exact H3 text format of MiniMax's guide. Cut times are kept strictly increasing inside the
// duration; a shot whose time doesn't fit is folded into the shot before it. lastFrame: frames mode with a last picture.
export function assemble(data, { mode = 'text', seconds = 5, lastFrame = false } = {}) {
  const shots = []
  // Frames mode answers in three parts (opening, motion, ending), one continuous shot.
  const parts = ['opening', 'motion', 'ending'].map((k) => sentence(stripShot(data?.[k]))).filter(Boolean)
  const given = parts.length ? [{ start_seconds: 0, description: parts.join(' ') }] : Array.isArray(data?.shots) ? data.shots : []
  for (const sh of given) {
    const desc = normalizeDialogue(stripShot(sh.description))
    if (!desc) continue
    const t = Number(sh.start_seconds)
    const prev = shots.at(-1)
    if (!prev) shots.push({ t: 0, desc })
    else if (!lastFrame && Number.isFinite(t) && t > prev.t + 0.5 && t < seconds - 0.5) shots.push({ t, desc })
    else prev.desc += ` ${desc}`
  }
  if (!shots.length) throw new Error('The writer returned no shots. Try again.')
  const style = sentence(stripField(data.style))
  const lines = shots.map((sh, i) => (i === 0 ? `[Shot 1] ${sh.desc}` : `[Shot ${i + 1}] At ${at(sh.t)}, ${sh.desc.charAt(0).toLowerCase()}${sh.desc.slice(1)}`))
  const sound = stripField(data.soundscape) || 'Quiet room tone.'
  const music = stripField(data.music) || 'N/A'
  if (mode === 'reference') {
    const subjects = (data.subjects || []).map((x, i) => `<Subject ${i + 1}> is ${sentence(String(x.definition || x.traits || '').trim().replace(/^<Subject \d+>\s*is\s*/i, ''))}`)
    const audio = Array.isArray(data.audio) ? data.audio : []
    audio.forEach((x, i) => subjects.push(`${x.label || `<Audio ${i + 1}>`} is ${sentence(String(x.role || 'a reference sound').trim())}`))
    const allShots = lines.map((_, i) => `[Shot ${i + 1}]`).join(', ')
    const retention = (data.retention || []).map((x, i) => {
      const n = Number(x.subject) || i + 1
      const inShots = (Array.isArray(x.shots) ? x.shots : []).map(Number).filter((s) => s >= 1 && s <= lines.length)
      return `<Subject ${n}> (appears in ${inShots.length ? inShots.map((s) => `[Shot ${s}]`).join(', ') : allShots}): ${pick(x.relation, RELATIONS, 'fully_preserved')} - ${String(x.carries || '').trim()}`
    })
    audio.forEach((x, i) => retention.push(`${x.label || `<Audio ${i + 1}>`}: ${pick(x.relation, AUDIO_RELATIONS, 'reference')} - ${String(x.carries || x.role || '').trim()}`))
    const relations = audio.map((x) => pick(x.relation, AUDIO_RELATIONS, 'reference'))
    const task = ['reference generation', relations.some((r) => r.endsWith('copy')) && 'audio reuse', relations.some((r) => !r.endsWith('copy')) && 'audio reference'].filter(Boolean).join(' + ')
    return [
      `subject_definitions:\n${subjects.join('\n')}`,
      `summary:\n[${task}] ${stripField(data.summary).replace(/^\[[^\]]*\]\s*/, '')}`,
      `retention_analysis:\n${retention.join('\n')}`,
      `detailed_description:\n${style ? `${style}\n` : ''}${lines.join('\n')}`,
      `overall_soundscape:\n${sound}`,
      `non_diegetic_music:\n${music}`
    ].join('\n\n')
  }
  // The base modes put the style at the start of [Shot 1] and the shots on one line, as the guide's cases do.
  const first = style ? [`[Shot 1] ${style} ${shots[0].desc}`, ...lines.slice(1)] : lines
  const body = [`integrated_multimodal_description: ${first.join(' ')}`, `overall_soundscape: ${sound}`, `non_diegetic_music: ${music}`].join('\n\n')
  if (mode !== 'frames') return body
  return `${lastFrame ? firstLastLine(seconds, shots.length) : FIRST_FRAME_LINE}\n\n${body}`
}

const SHOT_SCHEMA = { type: 'object', properties: { start_seconds: { type: 'number' }, description: { type: 'string' } }, required: ['start_seconds', 'description'] }

// JSON shape the writer must answer in (Ollama structured output, or the harness CLI's). Frames mode asks for the
// shot in three required parts, because a small model left to one description only restates the picture. refs:
// pictures and videos attached in reference mode, each of which defines at least one subject.
export function outputSchema({ mode = 'text', sequence = false, lastFrame = false, audio = false, refs = 0 } = {}) {
  const text = { type: 'string' }
  // the direction (directing.js): what the shot is for and who stands where, decided before any shot is written. In
  // reference mode it also says which reference wins where two disagree. It isn't part of the H3 prompt.
  // notes, not prompt text: capped, because the 8B writer can run one on until its context fills
  const note = { type: 'string', maxLength: 700 }
  const direction = { type: 'object', properties: { purpose: note, staging: note, ...(mode === 'reference' && { priorities: note }) }, required: ['purpose', 'staging', ...(mode === 'reference' ? ['priorities'] : [])] }
  if (mode === 'frames') return { type: 'object', properties: { direction, style: text, opening: text, motion: text, ending: text, soundscape: text, music: text }, required: ['direction', 'style', 'opening', 'motion', 'ending', 'soundscape', 'music'] }
  const props = { direction, style: text, shots: { type: 'array', items: SHOT_SCHEMA, minItems: 1, maxItems: sequence || lastFrame ? 1 : 3 }, soundscape: text, music: text }
  const required = ['direction', 'style', 'shots', 'soundscape', 'music']
  if (mode === 'reference') {
    props.subjects = { type: 'array', items: { type: 'object', properties: { definition: { type: 'string' }, backdrop: { type: 'string' } }, required: ['definition', 'backdrop'] }, ...(refs && { minItems: refs }) }
    props.summary = { type: 'string' }
    props.retention = { type: 'array', items: { type: 'object', properties: { subject: { type: 'integer' }, shots: { type: 'array', items: { type: 'integer' } }, relation: { type: 'string', enum: RELATIONS }, carries: { type: 'string' } }, required: ['subject', 'shots', 'relation', 'carries'] } }
    required.push('subjects', 'summary', 'retention')
    if (audio) {
      props.audio = { type: 'array', items: { type: 'object', properties: { label: { type: 'string' }, role: { type: 'string' }, relation: { type: 'string', enum: AUDIO_RELATIONS }, carries: { type: 'string' } }, required: ['label', 'role', 'relation'] } }
      required.push('audio')
    }
  }
  return { type: 'object', properties: props, required }
}

const withName = (text, character) => (firstName(character) ? String(text).replaceAll('{char}', firstName(character)) : String(text).replaceAll('{char}', 'the main character'))

// MiniMax's guide, as the writer reads it after IV Studio's rules: the base guide for every mode, its
// full-reference guide too in reference mode. IV Studio's JSON shape and character rule still come first.
function guideText(guide, mode) {
  if (!guide) return ''
  return `MINIMAX'S OWN H3 PROMPT GUIDE
MiniMax, who made H3, wrote the guide below. Follow it for the content and wording of every field: style, composition, shots and cuts, camera moves (type, amplitude, speed), speakers and their voices, dialogue, voiceover, on-screen text, sound and music. Where it and IV Studio's rules above differ, follow the guide, except that you still answer in IV Studio's JSON shape and keep the main-character rule.
IV Studio assembles the final prompt from your JSON, so don't write field names, the opening alignment line, [Shot N] labels or cut times yourself: "style" opens [Shot 1]${mode === 'reference' ? ' (in reference mode it is the one or two style sentences before [Shot 1])' : ''}, each shot's "description" is that shot's text, and "soundscape" and "music" are overall_soundscape and non_diegetic_music.

${guide.base}${mode === 'reference' && guide.ref ? `\n\n${guide.ref}` : ''}`
}

function directingText() {
  return `THE DIRECTING METHOD
${DIRECTING_SOURCE}. Direct the shot this way. You answer in IV Studio's JSON shape, so "return a shot brief" means the "direction" field and the shots: there is nobody to ask, so label a working assumption inside "direction" when something minor is missing. The review part applies when you are asked to review a take.

${DIRECTING}`
}

// full: the whole directing method (Claude Code, Codex); the local writer keeps to the short DIRECTION rules.
// A previs (previs.js) steers the camera and the blocking; its mannequins and boxes must never become the subjects.
const PREVIS_RULE = (n) => `- <Video ${n}> is a grey previs: plain mannequins and boxes stand in for the people and the set. Use it ONLY for the camera's path, speed and framing, and where the people stand and walk. Never define a <Subject> from it and never mention mannequins, grey, boxes or its look anywhere: the people are the character and cast of the idea, the place is the idea's, and its greys say nothing about clothes, colours or light. Name it once in the description, as the idea words it, and in retention_analysis as "<Video ${n}> (camera movement and blocking): partially_preserved - ...".`

export function systemPrompt({ mode = 'text', seconds = 5, character, sequence = false, media = [], guide = null, full = false }) {
  const parts = [RULES]
  if (character) parts.push(CHARACTER_RULE(firstName(character)))
  const lastFrame = mode === 'frames' && media.filter((m) => m.kind === 'picture').length >= 2
  if (MODE_RULES[lastFrame ? 'framesLast' : mode]) parts.push(MODE_RULES[lastFrame ? 'framesLast' : mode])
  if (mode === 'reference' && media.length) {
    const count = { picture: 0, video: 0, audio: 0 }
    const label = { picture: 'Picture', video: 'Video', audio: 'Audio' }
    parts.push('Attached references, in order:\n' + media.map((m) => `<${label[m.kind]} ${++count[m.kind]}> (${isPrevis(m.file || m.path) ? 'video: a grey previs, for the camera move and blocking only' : `${m.kind}: ${path.basename(m.file || m.path || '')}`})`).join('\n'))
    if (count.audio) parts.push(AUDIO_RULE)
    const p = media.filter((m) => m.kind === 'video').findIndex((m) => isPrevis(m.file || m.path)) + 1
    if (p) parts.push(PREVIS_RULE(p))
  }
  if (sequence) parts.push(SEQUENCE_RULES)
  parts.push(durationRule(seconds))
  if (full) parts.push('', directingText())
  const g = guideText(guide, mode)
  if (g) parts.push('', g)
  return parts.join('\n')
}

// ---------- local (Ollama) ----------
export async function ollamaStatus() {
  const url = ollamaUrl()
  const local = ollamaIsLocal(url)
  try {
    const r = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(2500) })
    const { models = [] } = await r.json()
    return { url, local, running: true, installed: true, models: models.map((m) => ({ name: m.name, size: m.size, vision: /vl|vision|llava|gemma3/i.test(m.name) })) }
  } catch {
    // An Ollama elsewhere counts as installed: IV Studio can't see or start it, only reach it.
    return { url, local, running: false, installed: !local || ollamaExe() != null, models: [] }
  }
}

function ollamaExe() {
  // the Mac app keeps its command line tool inside the app until "Install command line" is clicked
  if (process.platform === 'darwin') return onPath('ollama') || ['/Applications', path.join(os.homedir(), 'Applications')].map((d) => path.join(d, 'Ollama.app', 'Contents', 'Resources', 'ollama')).find((f) => fs.existsSync(f)) || null
  if (process.platform !== 'win32') return onPath('ollama')
  const local = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Ollama', 'ollama.exe')
  return local && fs.existsSync(local) ? local : null
}

// Starts Ollama's server if it is installed but not running, and waits for it.
// Unloads whatever Ollama still holds (the title bar's Free memory). Returns the names it unloaded.
export async function unloadOllama() {
  try {
    const r = await fetch(`${ollamaUrl()}/api/ps`, { signal: AbortSignal.timeout(2500) })
    const { models = [] } = await r.json()
    for (const m of models) await fetch(`${ollamaUrl()}/api/generate`, { method: 'POST', body: JSON.stringify({ model: m.name, keep_alive: 0 }), signal: AbortSignal.timeout(10000) }).catch(() => {})
    return models.map((m) => m.name)
  } catch {
    return []
  }
}

export async function ensureOllama() {
  if ((await ollamaStatus()).running) return true
  if (!ollamaIsLocal()) throw new Error(`Ollama isn't answering at ${ollamaUrl()}. Check the address in Settings → Prompt writer, and that Ollama listens there (OLLAMA_HOST=0.0.0.0).`)
  const exe = ollamaExe()
  if (!exe) throw new Error('Ollama is not installed. Install it from ollama.com, or use MiniMax Context IR.')
  spawn(exe, ['serve'], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 500))
    if ((await ollamaStatus()).running) return true
  }
  throw new Error('Ollama did not start.')
}

// What a vision writer is shown, each with the label the prompt uses for it: reference pictures (<Picture N>), two
// frames of each reference video (<Video N>), the first/last frame pictures, or the last frame of the video a
// Continue shot carries on from. At most 6 images, each a JPEG of 1024 px or less (Ollama doesn't read every format).
const MAX_IMAGES = 6
export function imagePlan(media, mode) {
  const plan = []
  const n = { picture: 0, video: 0 }
  for (const m of media) {
    if (!(m.kind in n)) continue
    const k = ++n[m.kind]
    const file = m.file || m.path
    if (!file || !fs.existsSync(file)) continue
    if (m.kind === 'picture' && mode === 'frames' && k <= 2) plan.push({ file, label: k === 1 ? 'the first frame (the video opens exactly on it)' : 'the last frame (the video ends on it)' })
    else if (m.kind === 'picture' && mode === 'reference') plan.push({ file, label: `<Picture ${k}>` })
    else if (m.kind === 'video' && mode === 'reference') {
      const what = isPrevis(file) ? ' (the grey previs: camera and blocking only)' : ''
      plan.push({ file, at: 0.15, label: `<Video ${k}>${what}, a frame near its start` }, { file, at: 0.6, label: `<Video ${k}>${what}, a frame later on` })
    }
    else if (m.kind === 'video' && mode === 'continue' && k === 1) plan.push({ file, at: 'end', label: 'the last frame of the video this shot continues' })
  }
  return plan.slice(0, MAX_IMAGES)
}

const run = (cmd, args) =>
  new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true })
    const out = []
    p.stdout.on('data', (d) => out.push(d))
    p.on('error', reject)
    p.on('close', (code) => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(`${path.basename(cmd)} exited ${code}`))))
  })

// One picture or video frame as base64 JPEG. at: a fraction of the video's length, 'end', or none for a picture.
export async function jpegOf({ file, at }) {
  let seek = []
  if (at === 'end') seek = ['-sseof', '-0.1']
  else if (at != null) {
    const length = parseFloat(String(await run(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]))) || 0
    seek = ['-ss', (length * at).toFixed(2)]
  }
  const jpg = await run(FFMPEG, ['-v', 'error', ...seek, '-i', file, '-frames:v', '1', '-vf', "scale='min(1024,iw)':'min(1024,ih)':force_original_aspect_ratio=decrease", '-q:v', '4', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-'])
  if (!jpg.length) throw new Error('no frame')
  return jpg.toString('base64')
}

async function imagesFor(media, mode) {
  const shown = []
  for (const item of imagePlan(media, mode)) {
    try {
      shown.push({ label: item.label, data: await jpegOf(item) })
    } catch {
      // a picture ffmpeg can't read still goes over as it is; a video frame that fails is left out
      if (item.at == null) shown.push({ label: item.label, data: fs.readFileSync(item.file).toString('base64') })
    }
  }
  return shown
}

const LOOK_RULE = `The images attached to this message are the references, listed below. Look at them closely and write what you actually see into the shots: who is in them (face, hair, age, build, wardrobe), the objects, the place, the light and the colours. Refer to each reference by its label, and don't invent details that contradict them. "Image 1", "Image 2" are only how they're listed here: never write "Image N" in the prompt.`
// References mode makes a NEW scene: a person's picture gives the person, and the idea gives the place. Without
// this the writer described the picture's background and marked the "setting" as kept, and H3 rebuilt the
// reference's place (a queen photographed at Giza danced in front of the same pyramids).
const LOOK_RULE_REFERENCE = `The images attached to this message are the references, listed below. Look at them closely. Write each person exactly as you see them (face, hair, age, build, wardrobe, what they wear or carry), but NOT their picture's background, place, light or framing: the target video is a new scene, and its place, light and camera come from the idea. Only a picture of a place with no person in it, or an idea that asks for the same place, sets the place. Refer to each reference by its label, and don't invent details that contradict them. "Image 1", "Image 2" are only how they're listed here: never write "Image N" in the prompt.`
const lookRule = (mode) => (mode === 'reference' ? LOOK_RULE_REFERENCE : LOOK_RULE)

// What any writer is given for one prompt: the system text, the idea, the reference pictures and the JSON shape.
async function promptRequest({ idea, mode, seconds, character, sequence, previous, media, guide, look = true, full = false }) {
  let user = `Idea: ${withName(idea, character)}`
  if (previous) user += `\n\nThe previous shot, which this one continues from:\n${withName(previous, character)}`
  const shown = look ? await imagesFor(media, mode) : []
  const lastFrame = mode === 'frames' && media.filter((m) => m.kind === 'picture').length >= 2
  const audio = mode === 'reference' && media.some((m) => m.kind === 'audio')
  const refs = mode === 'reference' ? media.filter((m) => m.kind === 'picture' || m.kind === 'video').length : 0
  return { system: systemPrompt({ mode, seconds, character, sequence, media, guide, full }), user, shown, lastFrame, schema: outputSchema({ mode, sequence, lastFrame, audio, refs }) }
}

// The writer's draft through the prompt checker (lint.js). What the checker can mend itself is mended; anything else
// that matters goes back to the writer once (again: findings text, the draft's JSON -> a corrected JSON, or null to
// skip), and the better of the two drafts is kept.
const REDO = new Set(['missing-field', 'no-shot-1', 'cut-order', 'cut-late', 'speech-too-long', 'speech-long', 'name-in-line', 'no-speaker', 'untagged-speech', 'reference-missing', 'reference-unused', 'subject-undefined', 'reference-keeps-place', 'char-face', 'char-missing', 'frames-cut', 'too-many-shots'])
const MEND = new Set(['frames-line', 'quoted-line', 'filler', 'no-speaker'])
const checkerContext = ({ mode, seconds, media, character }) => ({ mode, seconds, media, character: character ? { name: character.name, trigger: character.trigger } : null })
function mended(prompt, ctx) {
  let text = prompt
  for (let i = 0; i < 4; i++) {
    const f = lintPrompt(text, ctx).find((x) => MEND.has(x.code) && x.fix)
    if (!f) break
    text = f.fix
  }
  return text
}
const score = (findings) => findings.reduce((n, f) => n + (f.level === 'error' ? 10 : f.level === 'warning' && REDO.has(f.code) ? 1 : 0), 0)

// References mode: the writer names what is behind each person in their picture ("backdrop"). When the idea asks for
// none of it but the shots describe it, the shots are set in the picture's place: the 8B local writer wrote "No place
// is preserved" in the summary and then opened [Shot 1] "between two pyramids", and H3 opened every take on the
// photo's pyramids before cutting to the idea's neon street. Returns the backdrop words found in the shots.
const BACKDROP_SKIP = new Set(['with', 'behind', 'background', 'backdrop', 'light', 'lighting', 'bright', 'clear', 'blue', 'white', 'dark', 'sunny', 'daylight', 'outdoor', 'outdoors', 'indoor', 'some', 'many', 'other', 'distant', 'large', 'small', 'tall', 'wall', 'walls', 'none', 'plain', 'soft'])
export function backdropInShots(data, idea = '') {
  const stems = new Set()
  for (const s of data?.subjects || [])
    for (const w of String(s?.backdrop || '').toLowerCase().match(/[a-z]{4,}/g) || []) if (!BACKDROP_SKIP.has(w)) stems.add(w.replace(/(?:es|s)$/, ''))
  if (!stems.size) return []
  const has = (text, stem) => new RegExp(`\\b${stem}(?:s|es)?\\b`, 'i').test(text)
  const ask = String(idea || '')
  if ([...stems].some((st) => has(ask, st))) return [] // the idea asks for that place (a pyramid idea may show the desert)
  const shots = (data?.shots || []).map((s) => [s?.description, s?.action, s?.camera].filter(Boolean).join(' ')).join(' ') + ' ' + (data?.style || '')
  return [...stems].filter((st) => has(shots, st))
}

// Last resort for a draft whose opening shots are still in the picture's backdrop while a later shot is in the idea's
// place: those opening shots go, and the video starts at the first shot in the idea's place (re-timed to start at 0).
export function dropBackdropShots(data, idea = '') {
  const words = backdropInShots(data, idea)
  const shots = data?.shots || []
  if (!words.length || shots.length < 2) return data
  const inBackdrop = (s) => words.some((w) => new RegExp(`\\b${w}(?:s|es)?\\b`, 'i').test(String(s?.description || '')))
  const first = shots.findIndex((s) => !inBackdrop(s))
  if (first <= 0 || shots.slice(first).some(inBackdrop)) return data
  const offset = Number(shots[first].start_seconds) || 0
  return { ...data, shots: shots.slice(first).map((s) => ({ ...s, start_seconds: Math.max(0, (Number(s.start_seconds) || 0) - offset) })) }
}

// limited: only send the draft back for the backdrop problem (the local writer on the CPU, where a full second pass
// is slow, still fixes the one mistake that ruins the shot). retry: a fresh request with a note (the local writer,
// asked to correct its own answer, hands back the same shots; asked afresh with the words to avoid, it complies).
async function checked(data, { assembleOpts, character, ctx, again, retry, idea, limited = false }) {
  const reference = assembleOpts.mode === 'reference'
  const backdrop = reference ? backdropInShots(data, idea) : []
  if (backdrop.length && retry) {
    let best = null
    for (let k = 0; k < 2 && !(best && !backdropInShots(best, idea).length); k++) {
      try {
        const fresh = await retry(`Keep the reference pictures' own backdrops out of the shots: don't write ${backdrop.join(', ')} or anything else from behind the people in them anywhere in the shots or the style. Every shot, [Shot 1] included, happens in the idea's place; someone who arrives somewhere starts at its doorway or already inside it.`)
        if (fresh && backdropInShots(fresh, idea).length < (best ? backdropInShots(best, idea).length : backdrop.length)) best = fresh
      } catch {}
    }
    if (best) return checked(best, { assembleOpts, character, ctx, again, idea, limited })
  }
  if (reference) data = dropBackdropShots(data, idea)
  const draft = mended(cleanPrompt(assemble(data, assembleOpts), character), ctx)
  const left = reference ? backdropInShots(data, idea) : []
  const issues = limited ? [] : lintPrompt(draft, ctx).filter((f) => f.level === 'error' || REDO.has(f.code))
  if (left.length && !limited) issues.unshift({ message: `The shots set the scene in the reference picture's own backdrop (${left.join(', ')}), which the idea doesn't ask for. Every shot, [Shot 1] included, happens in the idea's place: rewrite the shots without the picture's backdrop.` })
  if (!issues.length || !again) return draft
  const note = `IV Studio's prompt checker found these problems in your answer:\n${issues.map((f) => `- ${f.message}`).join('\n')}\nAnswer again with the whole JSON object, in the same shape, changing only what fixes these problems.`
  try {
    let fixed = await again(note, JSON.stringify(data))
    if (!fixed) return draft
    if (reference) fixed = dropBackdropShots(fixed, idea)
    const second = mended(cleanPrompt(assemble(fixed, assembleOpts), character), ctx)
    const worse = (d, text) => score(lintPrompt(text, ctx)) + 10 * (reference ? backdropInShots(d, idea).length : 0)
    return worse(fixed, second) < worse(data, draft) ? second : draft
  } catch {
    return draft
  }
}

// A line quoted in the idea is said in the shot, even when the writer leaves it out (the local one sometimes does).
// Only a single quoted line: with more, who says which is the writer's call.
export function keepIdeaLine(prompt, idea, character) {
  const quoted = [...String(idea || '').matchAll(/["“]([^"”]{2,})["”]/g)].map((m) => m[1].trim())
  return quoted.length === 1 ? withLine(prompt, character ? '{char} (S1)' : 'Someone', quoted[0]) : prompt
}

// The medium the idea asks for wins over a writer that wrote "Live-action" anyway (the local one reads a 3D animated
// frame as a photograph).
const MEDIA = [
  [/\bclay|claymation|stop[- ]motion/i, 'Stop-motion clay animation'],
  [/\banime\b/i, 'Anime'],
  [/\bhand[- ]drawn|\bdrawn\b|illustrat|\bcartoon/i, 'Hand-drawn animation'],
  [/\bpainted|painterly|watercolou?r/i, 'Painted animation'],
  [/\b3d\b|\bcgi\b|\bpixar/i, '3D animated film'],
  [/\banimat/i, 'Animated film']
]
export function keepIdeaMedium(prompt, idea) {
  const medium = MEDIA.find(([re]) => re.test(String(idea || '')))?.[1]
  return medium ? prompt.replace(/\bLive-action\b/gi, medium) : prompt
}

// cpu: keep the model off the GPU (used while ComfyUI is rendering, so H3 keeps its VRAM). On the CPU the draft is
// mended but not sent back for a second pass, which would double a slow write.
export async function writeLocal({ idea, mode = 'text', seconds = 5, character, sequence = false, previous, media = [], model, cpu = false }) {
  const info = await localWriterModel(model)
  const name = info.name
  // On the CPU (ComfyUI is rendering) the full-reference part of the guide makes a prompt take over five minutes,
  // so it's left out there; IV Studio's reference rules and layout still apply.
  const full = await loadGuide()
  const guide = full && cpu ? { base: full.base } : full
  const req = await promptRequest({ idea, mode, seconds, character, sequence, previous, media, guide, look: info.vision })
  const message = { role: 'user', content: req.user }
  if (req.shown.length) {
    message.images = req.shown.map((s) => s.data)
    message.content += `\n\n${lookRule(mode)}\n${req.shown.map((s, i) => `Image ${i + 1}: ${s.label}`).join('\n')}`
  }
  const chat = async (messages, tries = 2) => {
    const content = await localChat({ model: name, system: req.system, messages, schema: req.schema, temperature: 0.6, ctx: guide ? (guide.ref ? 24576 : 16384) : 8192, maxTokens: 6000, cpu, raw: true })
    try {
      return parseJson(content)
    } catch (err) {
      if (tries > 1) return chat(messages, tries - 1)
      throw err
    }
  }
  const data = await chat([message])
  const again = (note, previous) => chat([message, { role: 'assistant', content: previous }, { role: 'user', content: note }])
  const retry = (note) => chat([{ ...message, content: `${message.content}\n\n${note}` }])
  return keepIdeaMedium(keepIdeaLine(await checked(data, { assembleOpts: { mode, seconds, lastFrame: req.lastFrame }, character, ctx: checkerContext({ mode, seconds, media, character }), again, retry, idea, limited: cpu }), idea, character), idea)
}

// The same prompt from the person's Claude Code or Codex (harness.js), with the whole guide: it runs off this PC's GPU.
// Claude Code reads the pictures from the run's folder; Codex gets them attached, in order.
export async function writeHarness({ engine, model, idea, mode = 'text', seconds = 5, character, sequence = false, previous, media = [] }) {
  const req = await promptRequest({ idea, mode, seconds, character, sequence, previous, media, guide: await loadGuide(), full: true })
  const images = req.shown.map((s, i) => ({ ...s, name: `reference-${i + 1}.jpg` }))
  let user = req.user
  if (images.length)
    user += `\n\n${engine === 'claude' ? lookRule(mode).replace('The images attached to this message are', 'The image files in your working folder are') : lookRule(mode)}\n${images.map((s, i) => `Image ${i + 1} (${s.name}): ${s.label}`).join('\n')}${engine === 'claude' ? '\nOpen each one with the Read tool before you write.' : ''}`
  user += '\n\nAnswer with the JSON object only.'
  const data = await harnessJson({ engine, model, system: req.system, user, schema: req.schema, images })
  const again = (note, previous) => harnessJson({ engine, model, system: req.system, user: `${user}\n\nYour previous answer:\n${previous}\n\n${note}`, schema: req.schema, images })
  const retry = (note) => harnessJson({ engine, model, system: req.system, user: `${user}\n\n${note}`, schema: req.schema, images })
  return keepIdeaMedium(keepIdeaLine(await checked(data, { assembleOpts: { mode, seconds, lastFrame: req.lastFrame }, character, ctx: checkerContext({ mode, seconds, media, character }), again, retry, idea }), idea, character), idea)
}

function parseJson(text) {
  try {
    return JSON.parse(String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, ''))
  } catch {
    throw new Error('The writer returned something unreadable. Try again.')
  }
}

// Any structured answer from the local writer: system + user text in, an object of `schema`'s shape out
// (Projects' scene breakdown uses it). Unloads afterwards like every write.
export async function ollamaJson({ system, user, schema, model, cpu = false, ctx = 16384, temperature = 0.5 }) {
  const { name } = await localWriterModel(model)
  return localChat({ model: name, system, messages: [{ role: 'user', content: user }], schema, temperature, ctx, maxTokens: 8000, cpu, timeoutMs: 900000 })
}

// A short story -> one prompt per shot, written to join as one continuous take. engine: 'local' (Ollama) or a
// harness ('claude', 'codex').
export async function writeStoryLocal({ story, shots, seconds, character, model, cpu = false, engine = 'local' }) {
  const sys = `${systemPrompt({ mode: 'text', seconds, character, sequence: true, guide: await loadGuide() })}
TASK: Split the story into exactly ${shots} consecutive shots of ${seconds} seconds each, following every rule above. Each item of "prompts" is one shot in the single-shot JSON shape of the example (style, shots with exactly one entry, soundscape, music).`
  const schema = { type: 'object', properties: { prompts: { type: 'array', items: outputSchema({ sequence: true }), minItems: shots, maxItems: shots } }, required: ['prompts'] }
  let list
  if (engine !== 'local') list = (await harnessJson({ engine, model, system: sys, user: `Story: ${withName(story, character)}\n\nAnswer with the JSON object only.`, schema, timeoutMs: 600000 })).prompts
  else {
    const { name } = await localWriterModel(model)
    list = (await localChat({ model: name, system: sys, messages: [{ role: 'user', content: `Story: ${withName(story, character)}` }], schema, temperature: 0.6, ctx: 16384, maxTokens: 8000, cpu })).prompts
  }
  if (!Array.isArray(list) || !list.length) throw new Error('The writer did not return a shot list. Try again.')
  return list.slice(0, shots).map((p) => cleanPrompt(assemble(p, { seconds }), character))
}

export async function pullModel(name, onProgress) {
  await ensureOllama()
  const r = await fetch(`${ollamaUrl()}/api/pull`, { method: 'POST', body: JSON.stringify({ model: name, stream: true }) })
  if (!r.ok) throw new Error(`Ollama: ${(await r.text()).slice(0, 300)}`)
  const decoder = new TextDecoder()
  let buf = ''
  for await (const chunk of r.body) {
    buf += decoder.decode(chunk, { stream: true })
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (!line) continue
      const ev = JSON.parse(line)
      if (ev.error) throw new Error(`Ollama: ${ev.error}`)
      onProgress?.(ev)
    }
  }
  return true
}

// ---------- MiniMax Context IR (ComfyUI partner node) ----------
// media: [{kind, name}] already uploaded into ComfyUI's input folder, in IV Studio order.
export function contextIrGraph({ idea, mode, seconds, aspect, character, media = [], sequence = false }) {
  const g = {}
  const ir = { model: 'MiniMax H3', 'model.prompt': '', 'model.duration': Math.min(15, Math.max(4, Math.round(seconds))), 'model.ratio': aspect || '16:9' }
  let text = withName(idea, character)
  if (character) text += ` (${firstName(character)}'s face and voice come from a trained character model; describe clothes and actions, not their face or voice.)`
  if (sequence) text += ' This shot joins seamlessly onto the previous and next shots as one continuous take: open holding the previous closing pose, stay quiet for about two seconds before speaking, and end settled with about two seconds to spare.'
  if (mode === 'continue') text += ' The video continues an existing clip from its final frame, holding that arrangement at the start.'
  ir['model.prompt'] = text
  const pics = media.filter((m) => m.kind === 'picture')
  if (mode === 'frames') {
    pics.slice(0, 2).forEach((m, i) => {
      g[`img${i}`] = { class_type: 'LoadImage', inputs: { image: m.name } }
      ir[i === 0 ? 'first_frame' : 'last_frame'] = [`img${i}`, 0]
    })
  } else if (mode === 'reference') {
    const n = { picture: 0, video: 0, audio: 0 }
    for (const m of media) {
      const k = ++n[m.kind]
      const id = `${m.kind}${k}`
      if (m.kind === 'picture' && k <= 9) {
        g[id] = { class_type: 'LoadImage', inputs: { image: m.name } }
        ir[`model.reference_images.image_${k}`] = [id, 0]
      } else if (m.kind === 'video' && k <= 3) {
        g[id] = { class_type: 'LoadVideo', inputs: { file: m.name } }
        ir[`model.reference_videos.video_${k}`] = [id, 0]
      } else if (m.kind === 'audio' && k <= 3 && media.some((x) => x.kind !== 'audio')) {
        // Context IR refuses audio without a picture or video
        g[id] = { class_type: 'LoadAudio', inputs: { audio: m.name } }
        ir[`model.reference_audios.audio_${k}`] = [id, 0]
      }
    }
  }
  if (!Object.keys(ir).some((k) => k.startsWith('model.reference') || k.endsWith('_frame')) && ir['model.ratio'] === 'adaptive') ir['model.ratio'] = '16:9'
  g.ir = { class_type: 'MinimaxHailuo03ContextIRNode', inputs: ir }
  g.out = { class_type: 'PreviewAny', inputs: { source: ['ir', 0] } }
  return g
}

// Context IR names media "Image 1", "Video 1", "Audio 1"; IV Studio's workflow uses <Picture 1>, <Video 1>, <Audio 1>.
export function fromContextIr(text, character) {
  const t = String(text || '')
    .replace(/<?\b(?:Image|Picture)\s*(\d)\b>?/g, '<Picture $1>')
    .replace(/<?\bVideo\s*(\d)\b>?/g, '<Video $1>')
    .replace(/<?\bAudio\s*(\d)\b>?/g, '<Audio $1>')
  return cleanPrompt(t, character)
}
