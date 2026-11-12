import { isHarness } from './harness.js'
// Projects: a short film from script to rough cut. (Called "productions" in the code: a "project" already means
// one shot's renders, see Studio.createProject.) A production holds:
//   brief    name, logline, aspect, target length, look (style LoRAs, notes)
//   assets   cast (character presets, each with its voice), locations and props (descriptions, pictures)
//   script   screenplay text (plain or Fountain), parsed into scenes by screenplay.js
//   scenes   each with shots: what we see, the camera, who's in it, a spoken line, seconds and an H3 prompt.
//            Each shot renders as an ordinary IV Studio shot (shot.projectId), so it also shows in Shots.
//   sketches a still per shot for the storyboard (shot.sketch), made by Images and kept out of its gallery
//   cut      an Edit with every shot in script order (editId)
// step is where the person is in the Projects wizard (idea, story, cast, board, film, watch).
// Breaking the script down uses the local writer: one call per scene for the shot list, then one per shot
// for its H3 prompt. Rendering, picking and finishing are Studio's own.
import { withLine } from './lint.js'
import { needsPrevis, previsWords, stageFields } from './staging.js'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { probe } from './media.js'
import { ASPECTS } from './plan.js'
import { DEFAULT_LOCAL_MODEL, writeHarness, writeLocal } from './prompter.js'
import { askWriter, continuityCheck, coverageRules, promptVariants, rewritePrompt, shotListCsv, shotListMarkdown } from './filmcraft.js'
import { parseScript, sceneText } from './screenplay.js'
import { applyOps } from './timeline.js'

const now = () => new Date().toISOString()
const id6 = () => randomUUID().slice(0, 6)
const first = (x) => String(x || '').split(/\s+/)[0].toLowerCase() // people match by first name
// a script's cue in capitals ("KEEPER") reads as a name ("Keeper")
const nameCase = (n) => (n && n === n.toUpperCase() ? n.toLowerCase().replace(/\b\w/g, (x) => x.toUpperCase()) : n)
const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}
const STEPS = ['idea', 'story', 'cast', 'board', 'film', 'watch']
const FORMAT_FOR = { '16:9': '1080p', '9:16': 'vertical', '1:1': 'square' }
const DONE = ['success', 'error', 'cancelled']
// Continue mode's previews open with the source's last 23 frames (its 22-frame overlap and one more; measured)
const CONTINUE_OVERLAP = 23 / 24

const SHOT_RULES = `You are a film director breaking one scene of a screenplay into shots for an AI video model. Each shot is one continuous camera take of 3 to 10 seconds with native sound.
- Keep the scene's order. Cover its action within the seconds you are given for the scene: when there's more than fits, keep the moments that tell the story and every spoken line.
- Every line of dialogue appears in exactly one shot, word for word, and a shot has at most one speaker. A long speech can be split over shots, each with its own part.
- Open with a shot that shows where we are, then go closer when people talk or do something small.
- action: what we see, present tense, one or two concrete sentences: who, where, what they do and how. Name people by their names. No camera words here.
- A shot never cuts. Something like "close-up on her hand, then cut to a wide shot" is two shots: write them as two.
- staging: where each person is at the start of the shot by screen side (screen-left is the viewer's left, not the character's), which way they face, who they look at and how far apart they are, and where they move. With two people, keep the camera on one side of the line between them for the whole scene, so they stay on the same sides of the frame.
- camera: one shot size and the camera's movement (e.g. "Wide, slow push in", "Close-up, handheld"), never two sizes with an arrow. Choose the framing that shows the action: hands and the object for a small action, enough body and floor for a movement, the face for a reaction.
- ends: how the shot leaves things: where each person is and which way they face, where their hands and the important props are, who they look at and which way anyone is moving. The next shot starts from exactly that, unless the scene says otherwise.
- characters: the names of the people on screen (from the cast list, or as the script names them).
- speaker and line: who speaks in this shot and their exact words, or "" for both.
- seconds: 3 to 10. A spoken line needs about 1 second per 2.5 words plus 1 second.
- Don't add lines, people, props or camera moves the script doesn't have. A quiet reaction can carry a moment.`
const SHOT_SCHEMA = {
  type: 'object',
  properties: {
    shots: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        // length limits keep a small local writer from running on in one field until its answer is cut off (#27)
        properties: { action: { type: 'string', maxLength: 500 }, staging: { type: 'string', maxLength: 500 }, camera: { type: 'string', maxLength: 160 }, characters: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 60 } }, speaker: { type: 'string', maxLength: 60 }, line: { type: 'string', maxLength: 800 }, seconds: { type: 'number' }, ends: { type: 'string', maxLength: 400 } },
        required: ['action', 'staging', 'camera', 'characters', 'speaker', 'line', 'seconds', 'ends']
      }
    }
  },
  required: ['shots']
}

// The shot schema for a stretch of this many seconds: no more shots than 3-second shots would fill, plus two (#27).
export function shotSchemaFor(seconds) {
  const s = structuredClone(SHOT_SCHEMA)
  s.properties.shots.maxItems = Math.max(3, Math.ceil(seconds / 3) + 2)
  return s
}

// A scene in parts of about `each` seconds for the shot planner, split between script elements (a line of dialogue
// or a paragraph of action is never cut), each with its share of the scene's seconds: [{ text, seconds }].
// A scene up to 1.25 parts long stays whole.
export function sceneParts(scene, seconds, each = 60) {
  const els = scene.elements || []
  const n = Math.min(els.length, Math.ceil(seconds / each))
  if (n <= 1 || seconds <= each * 1.25) return [{ text: sceneText(scene), seconds, elements: els }]
  const size = (e) => String(e.text || '').length + 20
  const total = els.reduce((t, e) => t + size(e), 0)
  const groups = [[]]
  let done = 0
  for (const e of els) {
    // start the next part once this one has its share (and there are parts left to fill)
    if (groups[groups.length - 1].length && groups.length < n && done >= (total * groups.length) / n) groups.push([])
    groups[groups.length - 1].push(e)
    done += size(e)
  }
  return groups.map((g, k) => ({
    text: sceneText({ heading: `${scene.heading}${k ? ' (continued)' : ''}`, elements: g }),
    seconds: Math.max(6, Math.round((seconds * g.reduce((t, e) => t + size(e), 0)) / total)),
    elements: g
  }))
}

// Words for matching a line: lower case, straight quotes, no punctuation.
const lineWords = (t) =>
  String(t || '')
    .toLowerCase()
    .replace(/[‘’`]/g, "'")
    .replace(/[^a-z0-9']+/g, ' ')
    .trim()
// A shot's words hold a script line: all of it, or (for a writer that changed a word or two) at least 80% of its
// words in a shot line of about the same length.
function holds(have, want) {
  if (!have || !want) return false
  if (have.includes(want)) return true
  const w = want.split(' ')
  const h = new Set(have.split(' '))
  return w.length >= 4 && w.filter((x) => h.has(x)).length / w.length >= 0.8 && have.split(' ').length <= w.length * 1.5
}

// Every line of dialogue in `elements` (a scene's or a part's script) in some shot (GitHub #27: a small local writer
// leaves a few out). A line counts when a shot's line holds it, or when up to four shots in a row hold it between
// them (a speech split over shots). Lines are looked for from the shot of the line before, so a line said twice
// needs two shots. A line no shot holds gets a shot of its own after the shot of the line before it, with the
// action written just before it in the script. Returns { shots, added }.
export function keepLines(shots, elements = []) {
  const out = shots.map((s) => ({ ...s }))
  let added = 0
  let after = 0
  let action = ''
  let last = ''
  const used = new Set() // shots already matched to a line
  // the index of the shot (from `from` on) where `want` is said: in one shot's line, or across the lines of up to
  // four shots in a row that start with its first words; -1 when nowhere
  const findLine = (want, from, fresh = false) => {
    for (let j = from; j < out.length; j++) {
      if (fresh && used.has(j)) continue
      const first = lineWords(out[j].line)
      if (!first) continue
      if (holds(first, want)) return j
      if (!want.startsWith(first)) continue
      let joined = first
      for (let k = j + 1, n = 1; k < out.length && n < 4; k++) {
        if (!out[k].line) continue
        joined = `${joined} ${lineWords(out[k].line)}`
        n++
        if (holds(joined, want)) return k
      }
    }
    return -1
  }
  for (const e of elements) {
    if (e.type !== 'dialogue') {
      action = String(e.text || '').trim()
      continue
    }
    const want = lineWords(e.text)
    if (!want) continue
    // the same words again need the next shot; another line can share the shot of the one before
    const k = findLine(want, want === last ? after + 1 : after)
    last = want
    if (k >= 0) {
      used.add(k)
      after = k
      continue
    }
    // said earlier than expected (the writer moved it) in a shot no other line took: it's there, nothing to add
    const early = findLine(want, 0, true)
    if (early >= 0 && early < after) {
      used.add(early)
      continue
    }
    const prev = out.length ? out[Math.min(after, out.length - 1)] : null
    const words = String(e.text).split(/\s+/).filter(Boolean).length
    const shot = {
      action: action ? action.slice(0, 480) : `${e.who} speaks.`,
      staging: prev?.ends || prev?.staging || '',
      camera: 'Medium close-up, static',
      characters: [e.who],
      speaker: e.who,
      line: String(e.text).trim(),
      seconds: Math.min(10, Math.max(3, Math.round(words / 2.5 + 1))),
      ends: prev?.ends || ''
    }
    const pos = out.length ? Math.min(after + 1, out.length) : 0
    out.splice(pos, 0, shot)
    // the matched shots at or after pos moved down one
    for (const u of [...used].filter((u) => u >= pos).sort((a, b) => b - a)) (used.delete(u), used.add(u + 1))
    used.add(pos)
    after = pos
    added++
  }
  return { shots: out, added }
}

// withLine lives with the prompt checker now (Create's writers use it too)
export { withLine }

// A shot with no line says so, or H3 may give someone words ("Thank you.") of its own. Speaker tags go too.
// The film's look as words for the writers: the person's notes, the Lookbook's look language and the chosen
// cinematography (Slate's setups, kept on the look as { id, label, snippet }).
export function lookWords(look = {}) {
  return [look.notes, look.lookbook?.words, ...(look.setups || []).map((s) => s.snippet)]
    .map((t) => String(t || '').trim())
    .filter(Boolean)
    .join(' ')
}
const HISTORY = 20
// Keeps a shot's current prompt in its history (newest first, at most 20) before it changes.
function remember(sh, why) {
  if (!sh.prompt) return
  sh.history = [{ prompt: sh.prompt, why, at: new Date().toISOString() }, ...(sh.history || [])].slice(0, HISTORY)
}

export function withSilence(prompt) {
  if (/<d>/.test(prompt) || /nobody speaks/i.test(prompt)) return prompt
  const quiet = String(prompt).replace(/\s*\(S\d+\)/g, '')
  const said = 'Nobody speaks in this shot: no dialogue, only the sounds of the place.'
  const cut = quiet.search(/\n\s*\noverall_soundscape:/)
  return cut < 0 ? `${quiet.trimEnd()} ${said}` : `${quiet.slice(0, cut).trimEnd()} ${said}${quiet.slice(cut)}`
}

// How well a spoken take matches its line (0 to 1): its words found, in any order, against the longer of the two,
// so a dropped word and an added one ("Mine." heard as "Mine swept") both count against it.
export function wordMatch(line, heard) {
  const words = (t) => String(t || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean)
  const want = words(line)
  const got = words(heard)
  if (!want.length) return 1
  const total = Math.max(want.length, got.length)
  let n = 0
  for (const w of want) {
    const i = got.indexOf(w)
    if (i >= 0) (n++, got.splice(i, 1))
  }
  return n / total
}

const SCRIPT_RULES = `You write short films for an AI video model that films one 3 to 10 second shot at a time, with sound and spoken lines.
- Write the film the person describes, in plain, concrete, visual English. Show, don't explain.
- Keep the idea's own events, twist and ending exactly as given. Never swap them for a different or simpler story: if the idea says a puzzle is finished and then an extra piece turns up, the puzzle is finished and the piece is extra.
- Keep where people are and what they hold consistent from beat to beat: someone sitting on the floor doesn't push back a chair.
- Keep it small: few places, few people, simple physical actions the camera can see, short spoken lines.
- Use the cast's names for the people in it. Don't invent more than one extra person unless the idea needs them.
- Every scene happens in one place at one time. place is a short name ("Pottery studio"), time is DAY, NIGHT, MORNING or EVENING, inside is true for interiors, and looks is one sentence on what the place looks like (the room, the light, the colours).
- beats run in order. An action beat fills only action: one short sentence of what we see. A line beat fills speaker (a cast name), delivery (two or three words on how it's said, or "") and words: only what they say out loud, with no name, no quote marks and no "she says". Lines are short: one sentence.
- Write exactly the number of beats you are given, and end on a clear final image or line.
Example of three beats:
{"kind":"action","action":"Tess lifts a finished bowl off the wheel and turns it in the light.","speaker":"","delivery":"","words":""}
{"kind":"line","action":"","speaker":"Tess","delivery":"to herself","words":"That's the one."}
{"kind":"action","action":"She sets it on a shelf crowded with a dozen almost identical bowls.","speaker":"","delivery":"","words":""}`
// Lengths are capped so a small writer can't run one string on and on (Ollama holds it to the schema).
function scriptSchema(beats) {
  const str = (n) => ({ type: 'string', maxLength: n })
  return {
    type: 'object',
    properties: {
      title: str(60),
      scenes: {
        type: 'array',
        minItems: 1,
        maxItems: Math.max(1, Math.ceil(beats / 3)),
        items: {
          type: 'object',
          properties: {
            place: str(40),
            time: { type: 'string', enum: ['DAY', 'NIGHT', 'MORNING', 'EVENING'] },
            inside: { type: 'boolean' },
            looks: str(240),
            beats: { type: 'array', minItems: 1, maxItems: beats, items: { type: 'object', properties: { kind: { type: 'string', enum: ['action', 'line'] }, action: str(220), speaker: str(30), delivery: str(40), words: str(160) }, required: ['kind', 'action', 'speaker', 'delivery', 'words'] } }
          },
          required: ['place', 'time', 'inside', 'looks', 'beats']
        }
      }
    },
    required: ['title', 'scenes']
  }
}

// Only the words said out loud. The writer sometimes wraps a line as prose: Theo: "It's mine," he says.
const QUOTED = /["“]([^"“”]+)["”]/g
const SAYS = /\b(?:he|she|they|[A-Z][a-z]+)\s+(?:says|said|asks|asked|whispers|whispered|mutters|muttered|shouts|shouted|replies|replied|adds|added|calls|snaps)\b/
export function spokenWords(text) {
  let t = String(text || '').trim().replace(/^[A-Z][\w'.-]*(?: [A-Z][\w'.-]*)?\s*(?:\([^)]*\))?\s*:\s*/, '')
  const quoted = [...t.matchAll(QUOTED)].map((m) => m[1].trim().replace(/,$/, '.'))
  if (quoted.length && (/^["“]/.test(t) || SAYS.test(t.replace(QUOTED, '')))) t = quoted.join(' ')
  const single = t.match(/^['‘](.+)['’]$/)
  if (single) t = single[1]
  return t.replace(/^["“]|["”]$/g, '').trim()
}

// One beat from the writer, put right when it fills the wrong fields: the words in delivery, "Tess (quiet)" as the
// words, or a line with nobody saying anything. Takes the older { text, who, how } shape too.
export function beatOf(b) {
  let kind = b.kind === 'line' ? 'line' : 'action'
  let action = String(b.action ?? (kind === 'action' ? b.text : '') ?? '').trim()
  const speaker = String(b.speaker ?? b.who ?? '').trim()
  let delivery = String(b.delivery ?? b.how ?? '').trim().replace(/^\(|\)$/g, '').trim()
  let words = String(b.words ?? (kind === 'line' ? b.text : '') ?? '').trim()
  const first = speaker.split(/\s+/)[0].toLowerCase()
  if (words && first && new RegExp(`^${first.replace(/[^\w]/g, '')}\\b[^.!?]*$`, 'i').test(words.replace(/\([^)]*\)/g, '').trim()) && words.split(/\s+/).length <= 3) words = ''
  if (!words && delivery.split(/\s+/).length >= 3) [words, delivery] = [delivery, '']
  words = spokenWords(words)
  if (kind === 'line' && !words) kind = 'action'
  if (kind === 'action' && !action && words && speaker) kind = 'line'
  return kind === 'line' ? { kind, speaker, delivery, words } : { kind, action: action || words }
}

// A scene heading's place and time from the writer's, which can come as "Bus stop – rainy afternoon" + "AFTERNOON".
const TIMES = [
  ['NIGHT', /night|midnight|\b\d{1,2}\s*a\.?m\b|late/i],
  ['MORNING', /morning|dawn|sunrise/i],
  ['EVENING', /evening|dusk|sunset|twilight/i],
  ['DAY', /day|noon|afternoon/i]
]
export function heading(place, time) {
  const [name, ...rest] = String(place || 'Somewhere').split(/\s+[-–—]\s+/)
  const said = [time, ...rest].filter(Boolean).join(' ')
  return { place: name.trim() || 'Somewhere', time: TIMES.find(([, re]) => re.test(said))?.[0] || 'DAY' }
}

// The writer's film as screenplay text, which parseScript reads back.
export function scriptText(out) {
  const parts = out.title ? [`Title: ${out.title.trim()}`, ''] : []
  for (const sc of out.scenes || []) {
    const { place, time } = heading(sc.place, sc.time)
    parts.push(`${sc.inside === false ? 'EXT.' : 'INT.'} ${place.toUpperCase()} - ${time}`, '')
    for (const raw of sc.beats || []) {
      const b = beatOf(raw)
      if (b.kind === 'line' && b.speaker) parts.push(b.speaker.toUpperCase(), ...(b.delivery ? [`(${b.delivery})`] : []), b.words, '')
      else if (b.kind === 'line' || b.action) parts.push(b.kind === 'line' ? b.words : b.action, '')
    }
  }
  return parts.join('\n').trim() + '\n'
}

// A shot's text prompt as a Frames prompt: H3 opens on <Picture 1> (the shot's sketch) when the prompt says so.
const FIRST_FRAME = 'For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.'
// A film shot is one unbroken take, but writers still add "[Shot 2] At 00:03.000, close-up of ..." (and H3 then
// cuts; with a face picture attached it once cut to the picture itself). Later [Shot n] parts are folded into
// [Shot 1] as what happens next in the same take.
export function oneTake(prompt) {
  return String(prompt || '')
    .replace(/\s*\n\s*\[Shot (?:[2-9]|\d{2,})\]\s*(?:At \d{1,2}:\d{2}(?:\.\d+)?,?\s*)?/g, ' Then, in the same unbroken take, ')
    .replace(/unbroken take, (?:a |an )?(extreme close-up|close-up|medium close-up|medium shot|wide shot|full shot) (of|on)\b/gi, (_, size, w) => `unbroken take, the camera moves into a ${size.toLowerCase()} ${w}`)
    .replace(/unbroken take, (The|His|Her|He|She|They|Their|It|Its|A|An) /g, (_, w) => `unbroken take, ${w.toLowerCase()} `)
}

export function asFirstFrame(prompt) {
  const body = String(prompt || '').trim()
  return body.startsWith(FIRST_FRAME) ? body : `${FIRST_FRAME}\n\n${body}`
}

// A shot that opens on its sketch (<Picture 1>) and stays in the place's picture (<Picture 2>), for reference to video:
// the sketch fixes the first frame and the place carries its room, light and colours through the whole take.
// Anyone else on screen (people) comes as the next pictures: their face carries into the shot. With previs (the
// shot's staging board plan) its grey previs clip is <Video 1>, for the camera move and the blocking; sketch or
// room false leaves that picture out (and renumbers the rest).
// Written in the full-reference format of MiniMax's H3 guide; the text prompt's three fields become its last three.
// An outdoor scene's place picture is kept as a place: told "the room, its furniture", H3 opened outdoor shots on a
// furnished room (outside: EXT. scenes, see isOutside).
export const isOutside = (sc) => sc?.inside === false || /^\s*EXT\b/i.test(sc?.heading || '')

export function withRoom(prompt, { place, description, people = [], sketch = true, room = true, previs = null, outside = false }) {
  const body = String(prompt || '').trim().replace(`${FIRST_FRAME}\n\n`, '')
  const field = (name) => (body.match(new RegExp(`${name}:\\s*([\\s\\S]*?)(?=\\n\\s*\\n\\s*(?:overall_soundscape|non_diegetic_music):|$)`)) || [])[1]?.trim()
  const shots = (field('integrated_multimodal_description') ?? body).replace(/\s+(\[Shot \d+\])/g, '\n$1')
  const inShots = Array.from({ length: (shots.match(/\[Shot \d+\]/g) || ['']).length }, (_, i) => `[Shot ${i + 1}]`).join(', ')
  let k = 0
  const sk = sketch ? ++k : 0
  const rm = room ? ++k : 0
  const face = people.map(() => ++k)
  const subject = (i) => i + 1 + (room ? 1 : 0)
  const opens = [sk && `begins from <Picture ${sk}>`, rm && 'stays in <Subject 1> for the whole shot'].filter(Boolean).join(' and ')
  const where = [sk && `The shot begins from <Picture ${sk}>`, rm && `takes place in <Subject 1>, the place in <Picture ${rm}>, throughout`].filter(Boolean).join(' and ')
  return [
    'subject_definitions:',
    ...(sk ? [`<Picture ${sk}> is the first frame of [Shot 1], the storyboard sketch of this shot.`] : []),
    ...(rm ? [`<Subject 1> is the place in <Picture ${rm}>: ${place || 'the set'}${description ? `, ${description.replace(/[.\s]+$/, '')}` : ''}.`] : []),
    ...people.map((name, i) => `<Subject ${subject(i)}> is ${name}, the person in <Picture ${face[i]}>.`),
    '',
    'summary:',
    `[${sk ? 'keyframe completion + ' : ''}reference generation] The target video ${opens || 'is one shot'}.${people.length ? ` ${people.map((name, i) => `${name} is <Subject ${subject(i)}>`).join(' and ')}.` : ''}${previs ? ' Its camera move and blocking follow <Video 1>.' : ''}`,
    '',
    'retention_analysis:',
    ...(sk ? [`<Picture ${sk}> ([Shot 1] first frame): fully_preserved - the shot begins from it at 0.00 seconds.`] : []),
    ...(rm ? [`<Subject 1> (appears in ${inShots}): fully_preserved - ${outside ? 'the place, its ground, plants and sky' : 'the room, its furniture'}, light and colours, wherever the camera looks; the framing is newly directed.`] : []),
    // (a drawn face is a studio portrait: H3 once cut to it whole, plain background and all)
    ...people.map((name, i) => `<Subject ${subject(i)}> (appears in ${inShots}): partially_preserved - ${name}'s face and hair only; pose, clothes, light and background follow the shot, and the picture itself never appears as a frame.`),
    ...(previs ? ['<Video 1> (camera movement and blocking): partially_preserved - its camera path, speed and framing, and where the people stand and walk; not its look.'] : []),
    '',
    'detailed_description:',
    ...[where && `${where}.`, previs && previsWords(previs, 1)].filter(Boolean),
    shots,
    '',
    `overall_soundscape:\n${field('overall_soundscape') || (outside ? 'The quiet sounds of the place.' : 'Quiet room tone.')}`,
    '',
    `non_diegetic_music:\n${field('non_diegetic_music') || 'N/A'}`
  ].join('\n')
}

// A storyboard still's prompt: a film still of the shot, in the film's look.
export function sketchPrompt({ action, camera, place, time, description, look, faces = [], staging }) {
  return [
    `Cinematic film still, ${camera ? `${camera.replace(/[.\s]+$/, '').toLowerCase()} framing` : 'medium shot'}.`,
    faces.length ? `${faces.map((f, i) => `${f} is the person in picture ${i + 1}`).join('; ')}; keep their face.` : '',
    action,
    staging ? `${staging.replace(/[.\s]+$/, '')}.` : '',
    place ? `${place}${time ? `, ${time.toLowerCase()}` : ''}${description ? `: ${description}` : ''}.` : '',
    look ? `Look: ${look}.` : 'Natural light, realistic, shallow depth of field.',
    'One single frame: no split screen, no collage, no text, no captions, no borders.'
  ]
    .filter(Boolean)
    .join(' ')
}

// The empty place, drawn once so every sketch there shares its room, light and colours.
export function placePrompt({ place, time, description, look }) {
  return [
    `Cinematic film still, wide establishing shot of ${place || 'the place'}${time ? `, ${time.toLowerCase()}` : ''}.`,
    description ? `${description}.` : '',
    'Nobody in it: an empty set, ready for the actors.',
    look ? `Look: ${look}.` : 'Natural light, realistic.',
    'One single frame: no split screen, no collage, no text, no captions, no borders.'
  ]
    .filter(Boolean)
    .join(' ')
}

// A made-up person's face, drawn once so they look the same in every sketch and shot.
export function facePrompt({ role, description, look }) {
  return [
    `Cinematic film still, head-and-shoulders portrait of ${role || 'a person'}${description ? `: ${String(description).replace(/[.\s]+$/, '')}` : ''}.`,
    'Facing the camera, a calm everyday expression, the whole face clear and evenly lit, a plain soft background.',
    look ? `Look: ${look}.` : 'Natural light, realistic skin.',
    'One person only. One single frame: no split screen, no collage, no text, no captions, no borders.'
  ]
    .filter(Boolean)
    .join(' ')
}

// More views of a place from its photo, so a shot from another angle still finds the same room: the QMA camera
// angles LoRA on Qwen Image 2.1's edit (gribbliest/qwen-image-2.1-qma-camera-angles, Apache-2.0), with camera-only
// prompts as its card advises. Tested on a living room (2026-11-01): the quarter turn, the side and the wide view
// are real camera moves in the same room; its "back view" kept facing the windows, so there is no reverse.
// (Without the LoRA, Flux 3 Klein and Qwen 2.1 edits redrew the same view whatever the words said.)
export const ANGLES = {
  quarter: '<qma> front-right quarter view eye-level shot medium shot',
  side: '<qma> left side view eye-level shot medium shot',
  wide: '<qma> front view eye-level shot wide shot'
}
// Which picture of a place suits a shot: the wide view for a wide or establishing shot; for a camera turned away
// from the photo's direction on its staging board (or words like reverse, side, profile), the side view; for a slight
// turn (or over-the-shoulder, three-quarter), the quarter view; else the place's own photo.
export function placePicture(loc, sh = {}) {
  const has = (f) => f && fs.existsSync(f)
  const main = (loc?.pictures || []).find(has) || null
  // (an angle drawn from an older photo no longer matches the place)
  const view = (v) => (loc?.angles || []).find((a) => a.view === v && has(a.file) && (!a.from || a.from === main))?.file || null
  const words = sh.camera || ''
  const raw = sh.stage?.camera ? ((((Number(sh.stage.camera.facing) || 0) % 360) + 360) % 360) : null
  const turn = raw == null ? 0 : Math.min(raw, 360 - raw)
  if (/\b(wide|establishing|extreme long|long shot)\b/i.test(words)) return view('wide') || main
  if (turn > 70 || /\b(reverse|side|profile)\b/i.test(words)) return view('side') || main
  if (turn >= 20 || /\b(over the shoulder|over-the-shoulder|three-quarter|quarter)\b/i.test(words)) return view('quarter') || main
  return main
}

// An animatic's timing: each shot holds for its length (longer when its line runs longer), in script order.
export function animaticPlan(scenes) {
  let at = 0
  return scenes.flatMap((sc) =>
    sc.shots.map((sh, i) => {
      const seconds = +Math.max(sh.seconds || 5, sh.voiceLine?.duration ? sh.voiceLine.duration + 0.4 : 0).toFixed(2)
      const row = { shot: sh.id, scene: sc.heading, n: i + 1, at: +at.toFixed(2), seconds, sketch: sh.sketch && !sh.sketchStale ? sh.sketch : null, line: sh.line ? `${sh.speaker ? `${nameCase(sh.speaker)}: ` : ''}${sh.line}` : '', action: sh.action || '', voice: sh.voiceLine?.file || null }
      at += seconds
      return row
    })
  )
}

export class Productions {
  // studio: () => the current Studio. voices: () => the voice engine (or null). images: () => Images (sketches).
  // edits: Edits. localCopy(file): an output as a file on this PC. onChange(id): a production changed
  // (breakdown progress, renders).
  constructor({ dataDir, studio, voices = () => null, images = () => null, previs = () => null, catalog = () => null, edits, localCopy, onChange = () => {}, model = () => DEFAULT_LOCAL_MODEL, writer = () => ({ engine: 'local' }) }) {
    this.dir = path.join(dataDir, 'productions')
    this.studio = studio
    this.voices = voices
    this.previs = previs // the staging board in motion (previs.js), for shots whose camera arcs
    this.images = images
    this.catalog = catalog // the ready-made characters, for faces of presets that have none of their own
    this.edits = edits
    this.localCopy = localCopy
    this.onChange = onChange
    this.model = model // the local model, for scripts and storyboard plans
    this.writer = writer // the prompt writer chosen in Settings ({ engine, model }), for each shot's H3 prompt
    this.running = new Map() // production id -> breakdown promise
    this.writing = new Set() // production ids whose script is being written
    this.filming = new Map() // production id -> { speaking: shot id or null, waiting: Set of shot ids } while lines are said
  }

  file = (id) => path.join(this.dir, `${id}.json`)
  list() {
    if (!fs.existsSync(this.dir)) return []
    return fs
      .readdirSync(this.dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => readJson(path.join(this.dir, f), null))
      .filter(Boolean)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((p) => {
        const shots = p.scenes.flatMap((s) => s.shots)
        return { id: p.id, name: p.name, logline: p.logline, aspect: p.aspect, step: p.step || (shots.length ? 'board' : p.scenes.length ? 'cast' : 'idea'), scenes: p.scenes.length, shots: shots.length, cover: shots.find((s) => s.sketch)?.sketch || null, updatedAt: p.updatedAt }
      })
  }
  get(id) {
    const p = readJson(this.file(id), null)
    if (!p) throw new Error(`No project ${id}`)
    return p
  }
  write(p) {
    p.updatedAt = now()
    fs.mkdirSync(this.dir, { recursive: true })
    fs.writeFileSync(`${this.file(p.id)}.tmp`, JSON.stringify(p, null, 2))
    fs.renameSync(`${this.file(p.id)}.tmp`, this.file(p.id))
    return p
  }
  create({ name = 'Untitled film', logline = '', aspect = '16:9', targetSeconds = 120, script = '' } = {}) {
    if (!ASPECTS[aspect]) throw new Error(`aspect must be ${Object.keys(ASPECTS).join(', ')}.`)
    const p = { id: randomUUID().slice(0, 8), kind: 'short', name, logline, aspect, targetSeconds, step: 'idea', createdAt: now(), cast: [], locations: [], props: [], look: { notes: '', loras: [] }, script: { text: script }, scenes: [], breakdown: null, editId: null }
    if (script) Object.assign(p, this.parsed(p, script))
    return this.write(p)
  }
  remove(id) {
    fs.rmSync(this.file(id), { force: true })
    return true
  }

  // The brief and the assets: any of name, logline, aspect, targetSeconds, look, cast, locations, props, step.
  update(id, patch) {
    const p = this.get(id)
    const oldAngles = new Map((p.locations || []).map((l) => [l.id, l.angles || []]))
    for (const k of ['name', 'logline', 'aspect', 'targetSeconds', 'look', 'cast', 'locations', 'props', 'step']) if (patch[k] !== undefined) p[k] = patch[k]
    if (!ASPECTS[p.aspect]) throw new Error(`aspect must be ${Object.keys(ASPECTS).join(', ')}.`)
    if (!STEPS.includes(p.step || 'idea')) throw new Error(`step must be ${STEPS.join(', ')}.`)
    // a place keeps its drawn angles when the new list doesn't give them
    p.locations = (p.locations || []).map((l) => ({ id: l.id || id6(), name: l.name || 'Location', description: l.description || '', pictures: l.pictures || [], angles: l.angles || oldAngles.get(l.id) || [] }))
    p.cast = (p.cast || []).map((c) => (c.characterId ? { characterId: c.characterId, as: c.as } : { as: c.as, characterId: null, description: c.description || '', face: c.face || null }))
    p.props = (p.props || []).map((l) => ({ id: l.id || id6(), name: l.name || 'Prop', description: l.description || '', pictures: l.pictures || [] }))
    return this.write(p)
  }

  // ---------- script ----------
  // New script text: scenes are re-read from it. Scenes that already have shots keep them when their heading
  // is unchanged, so editing one scene doesn't throw away the others.
  setScript(id, text) {
    const p = this.get(id)
    return this.write(Object.assign(p, this.parsed(p, text)))
  }
  parsed(p, text) {
    const s = parseScript(text)
    const old = new Map((p.scenes || []).map((x) => [x.heading, x]))
    const scenes = s.scenes.map((sc) => {
      const prev = old.get(sc.heading)
      const same = prev && JSON.stringify(prev.elements) === JSON.stringify(sc.elements)
      return { id: prev?.id || id6(), heading: sc.heading, location: sc.location, time: sc.time, elements: sc.elements, shots: same ? prev.shots : [], stale: !!prev && !same && prev.shots.length > 0 }
    })
    // the cast: any speaker who matches a character preset joins it, and so does a preset named in the action
    const presets = this.studio().characters()
    const cast = [...(p.cast || [])]
    const firstName = (n) => n.split(/\s+/)[0].toLowerCase()
    for (const who of s.speakers) {
      const c = presets.find((x) => firstName(x.name) === firstName(who))
      if (c && !cast.some((x) => x.characterId === c.id)) cast.push({ characterId: c.id, as: who })
    }
    const action = s.scenes.flatMap((sc) => sc.elements.filter((e) => e.type === 'action').map((e) => e.text)).join('\n')
    // (only for a first script, so someone taken out of the cast stays out when the script is edited)
    for (const c of (p.scenes || []).length ? [] : presets) {
      const name = c.name.split(/\s+/)[0]
      if (name.length > 1 && !cast.some((x) => x.characterId === c.id) && new RegExp(`\\b${name.replace(/[^\w]/g, '')}\\b`).test(action)) cast.push({ characterId: c.id, as: name })
    }
    // locations from the headings
    const locations = [...(p.locations || [])]
    for (const sc of scenes) if (sc.location && !locations.some((l) => l.name.toLowerCase() === sc.location.toLowerCase())) locations.push({ id: id6(), name: sc.location, description: '', pictures: [] })
    return { script: { text, updatedAt: now() }, scenes, cast, locations, ...(s.title && (!p.name || p.name === 'Untitled film') ? { name: s.title } : {}) }
  }

  // A first draft of the script from the idea (the logline, or idea), the cast and the target length, by the
  // local writer. It replaces the script, so the page asks before writing over one.
  async writeScript(id, opts = {}) {
    if (this.writing.has(id)) throw new Error('The script is already being written.')
    this.writing.add(id)
    this.onChange(id)
    try {
      return await this.draftScript(id, opts)
    } finally {
      this.writing.delete(id)
      this.onChange(id)
    }
  }
  async draftScript(id, { idea } = {}) {
    const p = this.get(id)
    const brief = String(idea || p.logline || '').trim()
    if (!brief) throw new Error('Say what the film is about first.')
    const castNames = p.cast.map((c) => this.character(c.characterId)?.name || c.as).filter(Boolean)
    const beats = Math.max(3, Math.round(p.targetSeconds / 4))
    const user = [
      `Idea: ${brief}`,
      p.name && p.name !== 'Untitled film' ? `Title: ${p.name}` : '',
      castNames.length ? `Cast: ${castNames.join(', ')}` : '',
      `Beats: exactly ${beats} in all, for about ${p.targetSeconds} seconds of film.`,
      lookWords(p.look) ? `Look: ${lookWords(p.look)}` : ''
    ]
      .filter(Boolean)
      .join('\n')
    const out = await askWriter(this.writer(), { system: SCRIPT_RULES, user, schema: scriptSchema(beats), cpu: await this.studio().gpuBusy().catch(() => false), temperature: 0.6 })
    if (p.name && p.name !== 'Untitled film') out.title = ''
    const q = this.setScript(id, scriptText(out))
    // the writer's one line on each place fills a place the person hasn't described yet
    const looks = new Map((out.scenes || []).filter((s) => s.place && s.looks?.trim()).map((s) => [String(s.place).trim().toLowerCase(), s.looks.trim()]))
    if (!q.locations.some((l) => !l.description && looks.has(l.name.toLowerCase()))) return q
    return this.write({ ...q, locations: q.locations.map((l) => (l.description ? l : { ...l, description: looks.get(l.name.toLowerCase()) || '' })) })
  }

  // ---------- breakdown ----------
  // Breaks every scene without shots (or all of them, with redo) into shots and writes each shot's H3 prompt.
  // Runs in the background; progress is in production.breakdown. Returns at once.
  breakDown(id, { redo = false, sceneIds = null, sketch = false } = {}) {
    if (this.running.has(id)) throw new Error('This project is already being broken down.')
    const p = this.get(id)
    if (!p.scenes.length) throw new Error('Add the script first.')
    const todo = p.scenes.filter((s) => (sceneIds ? sceneIds.includes(s.id) : redo || !s.shots.length || s.stale)).map((s) => s.id)
    if (!todo.length) throw new Error('Every scene already has shots. Pass redo to break them down again.')
    p.breakdown = { state: 'running', scenes: todo.length, scenesDone: 0, shots: 0, shotsDone: 0, error: null, at: now() }
    this.write(p)
    this.onChange(id)
    const run = this.runBreakdown(id, todo, { sketch })
      .catch((err) => this.patch(id, (q) => (q.breakdown = { ...q.breakdown, state: 'error', error: err.message })))
      .finally(() => this.running.delete(id))
    this.running.set(id, run)
    return this.get(id)
  }
  patch(id, fn) {
    const p = this.get(id)
    fn(p)
    this.write(p)
    this.onChange(id)
    return p
  }
  // With sketch, the new shots' storyboard stills are queued before the breakdown counts as done.
  async runBreakdown(id, sceneIds, { sketch = false } = {}) {
    const cpu = await this.studio().gpuBusy().catch(() => false)
    for (const sid of sceneIds) {
      const p = this.get(id)
      const sc = p.scenes.find((s) => s.id === sid)
      if (!sc) continue
      const castNames = p.cast.map((c) => this.character(c.characterId)?.name).filter(Boolean)
      const loc = p.locations.find((l) => l.name.toLowerCase() === (sc.location || '').toLowerCase())
      // the scene's share of the film's length, by how much script it has
      const size = (s) => sceneText(s).length
      const share = Math.max(6, Math.round((p.targetSeconds * size(sc)) / Math.max(1, p.scenes.reduce((n, s) => n + size(s), 0))))
      const head = [`Film: ${p.name}${p.logline ? `. ${p.logline}` : ''}`, castNames.length ? `Cast: ${castNames.join(', ')}` : '', loc?.description ? `${loc.name}: ${loc.description}` : '', lookWords(p.look) ? `Look: ${lookWords(p.look)}` : '']
      // a coverage plan (Slate's): exactly its shots, in its order, each named by its slot
      const plan = sc.coverage?.shots?.length ? sc.coverage : null
      const people = [...new Set(p.cast.map((c) => this.character(c.characterId)?.name?.split(/\s+/)[0] || c.as).filter(Boolean))]
      // A long scene (a 5-minute film can be one scene of several minutes) is planned in parts of about a minute,
      // each carrying on from where the last ended, and each answer may hold only as many shots as its seconds
      // allow, so a small local writer can't loop until it's cut off. An answer cut off anyway keeps the shots it
      // finished, and the board says so (GitHub #27). A coverage plan is planned whole.
      const parts = plan ? [{ text: sceneText(sc), seconds: share }] : sceneParts(sc, share)
      const out = { shots: [], _cut: false }
      for (const [k, part] of parts.entries()) {
        const where = parts.length > 1 ? [`This is part ${k + 1} of ${parts.length} of the scene: plan the shots for this part only.`, out.shots.length ? `It opens as the previous part ended: ${out.shots[out.shots.length - 1].ends || out.shots[out.shots.length - 1].action}` : ''] : []
        const user = [...head, ...where, `Seconds for this ${parts.length > 1 ? 'part' : 'scene'}: about ${part.seconds} (${Math.max(1, Math.round(part.seconds / 6))} shots or so).`, `Scene:\n${part.text}`].filter(Boolean).join('\n')
        const schema = plan ? SHOT_SCHEMA : shotSchemaFor(part.seconds)
        const long = part.seconds > 60
        const got = await askWriter(this.writer(), { system: plan ? `${SHOT_RULES}\n\n${coverageRules(plan, { people })}` : SHOT_RULES, user, schema, cpu, ctx: long ? 24576 : 16384, maxTokens: long ? 14000 : 8000, salvage: true })
        const planned = (got.shots || []).filter((s) => s && String(s.action || '').trim())
        // every line of the part's script in a shot (a coverage plan keeps its own slots)
        const kept = plan ? { shots: planned, added: 0 } : keepLines(planned, part.elements)
        out.shots.push(...kept.shots)
        out.added = (out.added || 0) + kept.added
        if (got._cut) out._cut = true
      }
      if (plan) out.shots = out.shots.slice(0, plan.shots.length)
      const sceneNo = p.scenes.findIndex((s) => s.id === sid) + 1
      if (!out.shots.length) throw new Error(`The writer gave no shots for scene ${sceneNo}. Try again, or pick another writer in Settings → Prompt writer.`)
      const shots = (out.shots || []).map((s, k) => ({
        id: id6(),
        action: String(s.action || '').trim(),
        staging: String(s.staging || '').trim(),
        camera: String(s.camera || '').trim(),
        ends: String(s.ends || '').trim(),
        characters: (s.characters || []).map(String),
        // the writer sometimes copies a cue's "(to herself)" or "(V.O.)" into the name
        speaker: String(s.speaker || '').replace(/\s*\(.*?\)\s*/g, ' ').trim(),
        line: String(s.line || '').trim(),
        seconds: Math.min(10, Math.max(3, Math.round(Number(s.seconds) || 5))),
        prompt: '',
        character: this.mainCharacter(p, s),
        projectId: null,
        voiceLine: null,
        ...(plan?.shots[k] ? { slot: plan.shots[k].slot } : {})
      }))
      this.patch(id, (q) => {
        const t = q.scenes.find((s) => s.id === sid)
        if (t) Object.assign(t, { shots, stale: false })
        q.breakdown.scenesDone++
        q.breakdown.shots += shots.length
        if (out._cut) q.breakdown.cutScenes = [...(q.breakdown.cutScenes || []), sceneNo]
        if (out.added) q.breakdown.restoredLines = (q.breakdown.restoredLines || 0) + out.added
      })
      // a shot whose prompt can't be written is left to write again from its drawer; the rest carry on
      for (const sh of shots) {
        const failed = await this.writeShotPrompt(id, sid, sh.id, { cpu }).then(
          () => false,
          () => true
        )
        this.patch(id, (q) => {
          q.breakdown.shotsDone++
          if (failed) q.breakdown.promptErrors = (q.breakdown.promptErrors || 0) + 1
        })
      }
    }
    const sketchError = sketch ? await this.sketch(id).then(() => null, (err) => err.message) : null
    this.patch(id, (q) => (q.breakdown = { ...q.breakdown, state: 'done', sketchError, at: now() }))
  }

  character(cid) {
    return this.studio().characters().find((c) => c.id === cid) || null
  }
  // The people on screen in a shot who have a face picture: the shot's own character first, then anyone else it
  // names who is in the cast, then made-up people with a face (three at most: a shot of a man, his dog and a bird
  // drew the man from nothing with two), as [{ ch, face, made }].
  onScreen(p, sh) {
    const names = [...(sh.speaker ? [sh.speaker] : []), ...(sh.characters || [])]
    const ids = [sh.character, ...names.map((n) => p.cast.find((c) => c.characterId && (first(c.as) === first(n) || first(this.character(c.characterId)?.name) === first(n)))?.characterId)]
    const presets = [...new Set(ids.filter((x) => x && x !== 'none'))].map((cid) => ({ ch: this.character(cid), face: this.facePicture(this.character(cid)), made: false })).filter((x) => x.ch && x.face)
    const made = [...new Map(names.map((n) => this.madeUp(p, n)).filter((c) => c?.face && fs.existsSync(c.face)).map((c) => [first(c.as), c])).values()]
      .filter((c) => !presets.some((x) => first(x.ch.name) === first(c.as)))
      .map((c) => ({ ch: { id: `made:${first(c.as)}`, name: nameCase(c.as) }, face: c.face, made: true }))
    return [...presets, ...made].slice(0, 3)
  }
  // A made-up person's cast entry (someone no character preset plays), or null.
  madeUp(p, name) {
    return (p.cast || []).find((c) => !c.characterId && first(c.as) === first(name)) || null
  }
  // Everyone a set of shots shows or hears who no character preset plays: the people to draw faces for.
  madeUpRoles(p, shots) {
    const presets = this.studio().characters()
    const played = (n) => p.cast.some((c) => c.characterId && (first(c.as) === first(n) || first(this.character(c.characterId)?.name) === first(n))) || presets.some((c) => first(c.name) === first(n))
    const roles = new Map()
    for (const sh of shots) for (const n of [sh.speaker, ...(sh.characters || [])]) if (n && first(n).length > 1 && !played(n) && !roles.has(first(n))) roles.set(first(n), n)
    return [...roles.values()]
  }
  // A character's face picture: its own, else the ready-made catalogue's.
  facePicture(ch) {
    if (!ch) return null
    const own = ch.picture && fs.existsSync(ch.picture) ? ch.picture : null
    const ready = own ? null : this.catalog()?.entries?.().find((c) => c.id === ch.id)
    const file = own || (ready?.picture ? path.join(this.catalog().dir, ready.picture) : null)
    return file && fs.existsSync(file) ? file : null
  }
  // The shot's character preset: the speaker's, else the first person on screen who is in the cast.
  mainCharacter(p, s) {
    const match = (name) => p.cast.find((c) => {
      const ch = this.character(c.characterId)
      const first = (x) => String(x || '').split(/\s+/)[0].toLowerCase()
      return ch && (first(ch.name) === first(name) || first(c.as) === first(name))
    })
    const c = match(s.speaker) || (s.characters || []).map(match).find(Boolean)
    return c?.characterId || 'none'
  }

  // One shot's H3 prompt from its description, by the local writer (with the shot's character).
  async writeShotPrompt(id, sceneId, shotId, { cpu } = {}) {
    const p = this.get(id)
    const sc = p.scenes.find((s) => s.id === sceneId)
    const sh = sc?.shots.find((s) => s.id === shotId)
    if (!sh) throw new Error('No such shot.')
    const loc = p.locations.find((l) => l.name.toLowerCase() === (sc.location || '').toLowerCase())
    const others = sh.characters.filter((n) => n.split(/\s+/)[0].toLowerCase() !== (this.character(sh.character)?.name || '').split(/\s+/)[0].toLowerCase())
    const before = sc.shots[sc.shots.findIndex((s) => s.id === shotId) - 1]
    const dot = (t) => String(t).trim().replace(/[.\s]+$/, '') + '.'
    // a made-up person's looks go in every shot of them, so the words agree with their drawn face
    const looks = [...new Set([sh.speaker, ...sh.characters].filter(Boolean))].map((n) => this.madeUp(p, n)).filter((c) => c?.description)
    const idea = [
      loc ? `${loc.name}${sc.time ? `, ${sc.time.toLowerCase()}` : ''}${loc.description ? `: ${loc.description}` : ''}.` : sc.heading,
      sh.continues && before ? 'This carries straight on from the previous shot as one unbroken take: no cut, the same camera.' : '',
      before?.ends ? `It opens as the previous shot ended: ${dot(before.ends)}` : '',
      looks.length ? looks.map((c) => `${c.as}: ${dot(c.description)}`).join(' ') : '',
      sh.action,
      sh.staging ? `Staging: ${dot(sh.staging)}` : '',
      sh.camera ? `Camera: ${sh.camera}.` : '',
      sh.ends ? `It ends with: ${dot(sh.ends)}` : '',
      others.length ? `Also in the shot: ${others.join(', ')}.` : '',
      sh.line ? `${sh.speaker || 'They'} says exactly these words: "${sh.line}"` : 'No one speaks.',
      lookWords(p.look) ? `Look: ${lookWords(p.look).replace(/[.\s]+$/, '')}.` : '',
      'It is one continuous take with no cuts: write a single [Shot 1].'
    ]
      .filter(Boolean)
      .join(' ')
    const ch = this.character(sh.character)
    const w = this.writer()
    const written =
      isHarness(w.engine)
        ? await writeHarness({ engine: w.engine, model: w.model, idea, mode: 'text', seconds: sh.seconds, character: ch })
        : await writeLocal({ idea, mode: 'text', seconds: sh.seconds, character: ch, model: this.model(), cpu: cpu ?? (await this.studio().gpuBusy().catch(() => false)) })
    const prompt = oneTake(withLine(written, ch && first(ch.name) === first(sh.speaker) ? '{char}' : sh.speaker, sh.line))
    this.patch(id, (q) => {
      const t = q.scenes.find((s) => s.id === sceneId)?.shots.find((s) => s.id === shotId)
      if (t) (remember(t, 'written again'), (t.prompt = prompt))
    })
    return prompt
  }

  // ---------- film craft (filmcraft.js, after Sam Wasserman's Slate) ----------
  // A scene's coverage plan: { id, label, shots: [{ slot, size, angle, movement, intent, promptGuidance }] } from
  // Slate's list (the caller looks it up), or null for the planner's own choice. The scene's shots are planned again.
  setCoverage(id, sceneId, plan) {
    return this.patch(id, (p) => {
      const sc = p.scenes.find((s) => s.id === sceneId)
      if (!sc) throw new Error('No such scene.')
      sc.coverage = plan?.shots?.length ? { id: plan.id, label: plan.label, shots: plan.shots } : null
      if (sc.shots.length) sc.stale = true
    })
  }
  // The film's shot list: 'md' or 'csv'.
  shotList(id, format = 'md', { prompts } = {}) {
    const p = this.get(id)
    const q = { ...p, scenes: p.scenes.map((sc) => ({ ...sc, coverage: sc.coverage?.label || '' })) }
    return format === 'csv' ? shotListCsv(q, { prompts: prompts ?? true }) : shotListMarkdown(q, { prompts: !!prompts })
  }
  shotContext(p, sc, sh) {
    return { film: [p.name, p.logline].filter(Boolean).join('. '), scene: sc.heading || sc.location || '', look: lookWords(p.look), spec: [sh.slot, sh.camera, `${sh.seconds} s`].filter(Boolean).join(', ') }
  }
  // A director's note or one of Tighten, Enrich, Distill, Stronger shot, New angle on a shot's prompt, with the
  // person's writer. The old prompt goes into the shot's history (Undo). Returns { prompt, reply, missing }.
  async reworkShot(id, sceneId, shotId, { tool = 'note', note = '', keep = [] } = {}) {
    const p = this.get(id)
    const sc = p.scenes.find((s) => s.id === sceneId)
    const sh = sc?.shots.find((s) => s.id === shotId)
    if (!sh) throw new Error('No such shot.')
    const r = await rewritePrompt(this.writer(), { prompt: sh.prompt, tool, note, context: { ...this.shotContext(p, sc, sh), keep }, cpu: await this.studio().gpuBusy().catch(() => false) })
    this.setShotPrompt(id, sceneId, shotId, r.prompt, tool === 'note' ? `note: ${note.slice(0, 60)}` : tool)
    return r
  }
  async shotVariants(id, sceneId, shotId) {
    const p = this.get(id)
    const sc = p.scenes.find((s) => s.id === sceneId)
    const sh = sc?.shots.find((s) => s.id === shotId)
    if (!sh) throw new Error('No such shot.')
    return promptVariants(this.writer(), { prompt: sh.prompt, context: this.shotContext(p, sc, sh), cpu: await this.studio().gpuBusy().catch(() => false) })
  }
  // A new prompt for a shot, the old one kept in its history; why says what made it.
  setShotPrompt(id, sceneId, shotId, prompt, why = 'edited') {
    return this.patch(id, (q) => {
      const t = q.scenes.find((s) => s.id === sceneId)?.shots.find((s) => s.id === shotId)
      if (!t) throw new Error('No such shot.')
      if (String(prompt) === t.prompt) return
      remember(t, why)
      t.prompt = String(prompt)
    })
  }
  // Puts a prompt from the shot's history back (the current one goes into the history in its place).
  restoreShotPrompt(id, sceneId, shotId, index = 0) {
    return this.patch(id, (q) => {
      const t = q.scenes.find((s) => s.id === sceneId)?.shots.find((s) => s.id === shotId)
      const h = t?.history?.[index]
      if (!h) throw new Error('Nothing to go back to.')
      t.history.splice(index, 1)
      remember(t, 'before going back')
      t.prompt = h.prompt
    })
  }
  // A script supervisor's read of a scene's shots; kept on the scene as continuity { issues, at, writer }.
  async checkContinuity(id, sceneId) {
    const p = this.get(id)
    const sc = p.scenes.find((s) => s.id === sceneId)
    if (!sc) throw new Error('No such scene.')
    const i = p.scenes.indexOf(sc)
    const shots = sc.shots.map((sh, j) => ({ name: `${i + 1}.${j + 1}`, prompt: sh.prompt, action: sh.action, staging: sh.staging, ends: sh.ends }))
    const issues = await continuityCheck(this.writer(), { scene: sc.heading || sc.location || '', look: lookWords(p.look), shots, cpu: await this.studio().gpuBusy().catch(() => false) })
    this.patch(id, (q) => {
      const t = q.scenes.find((s) => s.id === sceneId)
      if (t) t.continuity = { issues, at: now(), writer: this.writer()?.engine || 'local' }
    })
    return issues
  }

  // ---------- shots ----------
  // Change a shot (any of action, staging, camera, ends, characters, speaker, line, seconds, prompt, character), add one after
  // another (add: { after }), remove one, or move one (move: -1 | 1).
  editShot(id, sceneId, shotId, patch = {}) {
    return this.patch(id, (p) => {
      const sc = p.scenes.find((s) => s.id === sceneId)
      if (!sc) throw new Error('No such scene.')
      const i = sc.shots.findIndex((s) => s.id === shotId)
      if (patch.remove) {
        if (i < 0) throw new Error('No such shot.')
        sc.shots.splice(i, 1)
        return
      }
      if (patch.add) {
        const sh = { id: id6(), action: patch.action || '', staging: patch.staging || '', camera: patch.camera || '', ends: patch.ends || '', characters: patch.characters || [], speaker: patch.speaker || '', line: patch.line || '', seconds: patch.seconds || 5, prompt: patch.prompt || '', character: patch.character || 'none', projectId: null, voiceLine: null }
        sc.shots.splice(i < 0 ? sc.shots.length : i + 1, 0, sh)
        return
      }
      if (i < 0) throw new Error('No such shot.')
      if (patch.move) {
        const j = i + Math.sign(patch.move)
        if (j >= 0 && j < sc.shots.length) [sc.shots[i], sc.shots[j]] = [sc.shots[j], sc.shots[i]]
        return
      }
      const sh = sc.shots[i]
      // a sketch drawn before the action, staging or camera changed would start the shot from the old picture
      // (a seated pair stood up mid-take when the board had them standing), so it's set aside until redrawn
      const looks = ['action', 'staging', 'camera', 'stage'].some((k) => patch[k] !== undefined && JSON.stringify(patch[k]) !== JSON.stringify(sh[k] ?? null))
      if (looks && (sh.sketch || sh.sketchSet)) sh.sketchStale = true
      if (patch.prompt !== undefined && patch.prompt !== sh.prompt) remember(sh, patch.why || 'edited')
      for (const k of ['action', 'staging', 'camera', 'ends', 'characters', 'speaker', 'line', 'seconds', 'prompt', 'character', 'stage', 'continues']) if (patch[k] !== undefined) sh[k] = patch[k]
      if (sh.continues && i === 0) sh.continues = false // the first shot of a scene has nothing to carry on from
      // a staging board's plan becomes the shot's words, unless the words were given too
      if (patch.stage) {
        const f = stageFields(patch.stage)
        if (patch.staging === undefined) sh.staging = f.staging
        if (patch.camera === undefined) sh.camera = f.camera
      }
      if (patch.line !== undefined || patch.character !== undefined) sh.voiceLine = null
      sh.seconds = Math.min(15, Math.max(1, Number(sh.seconds) || 5))
    })
  }
  find(p, shotId) {
    for (const sc of p.scenes) {
      const sh = sc.shots.find((s) => s.id === shotId)
      if (sh) return { sc, sh }
    }
    throw new Error(`No shot ${shotId}.`)
  }

  // The shot's line in its character's voice (for lip-sync): the file becomes the shot's voice line.
  // again: a new take with fresh seeds (the voice keeps a take per seed, so the same seed gives the same take).
  async speak(id, shotId, { again = false } = {}) {
    const p = this.get(id)
    const { sh } = this.find(p, shotId)
    if (!sh.line) throw new Error('This shot has no line to say.')
    const voiceId = this.character(sh.character)?.voiceId
    if (!voiceId) throw new Error('Give this character a voice on the Characters page first.')
    const v = this.voices()
    if (!v) throw new Error('Voices need IV Studio on this PC.')
    // the voice can drop a word from a short line, so each take is read back and said again (up to 3 seeds)
    // until every word is there; the most complete take is kept
    let best = null
    const from = again ? 3000 + Math.floor(Math.random() * 1e6) : null
    for (const seed of from == null ? [null, 1001, 2002] : [from, from + 1, from + 2]) {
      const line = await v.speak({ voiceId, text: sh.line, seed })
      const heard = await v.transcribe(line.file).catch(() => null)
      const score = heard == null ? 1 : wordMatch(sh.line, heard)
      if (!best || score > best.score) best = { line, score, heard }
      if (score >= 0.99) break
    }
    const { line } = best
    this.patch(id, (q) => (this.find(q, shotId).sh.voiceLine = { file: line.file, text: line.text, duration: line.duration, heard: best.heard }))
    return line
  }
  // A recording of the line (the person's own voice, an actor, a take from elsewhere) becomes the shot's voice
  // line, so the shot lip-syncs to it. Whisper reads it back when the voice engine is set up; a shot with no line
  // yet takes the words it heard.
  async useRecording(id, shotId, file) {
    if (!file || !fs.existsSync(file)) throw new Error('Pick a sound file.')
    const ffmpeg = this.edits?.ffmpeg
    if (!ffmpeg) throw new Error('Recordings need IV Studio on this PC.')
    const dir = path.join(this.dir, 'lines')
    fs.mkdirSync(dir, { recursive: true })
    const out = path.join(dir, `${id}_${shotId}_${Date.now()}.wav`)
    await this.edits.run(['-y', '-i', file, '-vn', '-ac', '1', '-ar', '48000', '-c:a', 'pcm_s16le', out])
    const { duration } = await probe(this.edits.ffprobe, out)
    if (!duration || duration > 14.5) {
      fs.rmSync(out, { force: true })
      throw new Error(duration ? `The recording is ${duration.toFixed(1)} s; a shot holds 14 s at most. Trim it in the media editor first.` : 'That file has no sound.')
    }
    const heard = this.voices() ? await this.voices().transcribe(out).catch(() => null) : null
    const { sh } = this.find(this.get(id), shotId)
    const line = sh.line || String(heard || '').trim()
    const ch = this.character(sh.character)
    this.patch(id, (q) => {
      const t = this.find(q, shotId).sh
      t.voiceLine = { file: out, text: line, duration, heard, recorded: path.basename(file) }
      // a new line goes into the prompt's <d> too, so H3 mouths these words
      if (!sh.line && line) Object.assign(t, { line, prompt: t.prompt ? withLine(t.prompt, ch && (!t.speaker || first(ch.name) === first(t.speaker)) ? '{char}' : t.speaker || 'Someone', line) : t.prompt })
    })
    return { file: out, duration, heard, line }
  }

  // ---------- storyboard sketches ----------
  // A still per shot (all shots without one, or shotIds, or every shot with redo), so the board shows the film
  // before any video renders. With a face for the shot's character or a picture of the place, an editing model
  // (Flux.2 Klein, else Flux 3 Klein) keeps them in the film's frame; otherwise a generating model draws it.
  async sketch(id, { shotIds = null, redo = false } = {}) {
    const { images, editor, drawer } = await this.pictureModels('Sketches')
    let p = this.get(id)
    const todo = (sc) => sc.shots.filter((sh) => (shotIds ? shotIds.includes(sh.id) : redo || !(sh.sketch || sh.sketchSet)))
    // a place with no photo gets one drawn first (it shows on Cast and places), or each sketch makes up its own room
    if (editor)
      for (const sc of p.scenes) {
        const loc = p.locations.find((l) => l.name.toLowerCase() === (sc.location || '').toLowerCase())
        if (!loc || !todo(sc).length || loc.pictures.some((f) => fs.existsSync(f))) continue
        const file = await this.drawPlace(images, drawer, p, loc, sc).catch(() => null)
        if (file) p = this.patch(id, (q) => (q.locations.find((l) => l.id === loc.id).pictures = [file]))
      }
    // so does everyone no character preset plays: one drawn face, kept in every sketch and shot of them
    // (a made-up keeper had a different face in each shot of "Last Watch")
    if (editor)
      for (const role of this.madeUpRoles(p, p.scenes.flatMap(todo))) {
        if (this.madeUp(p, role)?.face && fs.existsSync(this.madeUp(p, role).face)) continue
        await this.drawFace(id, role).catch(() => null)
        p = this.get(id)
      }
    const made = []
    for (const sc of p.scenes)
      for (const [i, sh] of sc.shots.entries()) {
        if (!todo(sc).includes(sh)) continue
        const loc = p.locations.find((l) => l.name.toLowerCase() === (sc.location || '').toLowerCase())
        const people = editor ? this.onScreen(p, sh) : []
        const place = placePicture(loc, sh)
        const refs = editor ? [...people.map((x) => x.face), place].filter(Boolean) : []
        const prompt =
          sketchPrompt({ action: sh.action, camera: sh.camera, place: loc?.name || sc.location, time: sc.time, description: loc?.description, look: p.look?.notes, faces: people.map((x) => x.ch.name), staging: sh.staging }) +
          (place && refs.length ? ` The place looks like picture ${refs.length}.` : '')
        const fam = refs.length ? editor : drawer
        const rec = await images.create({ mode: refs.length ? 'edit' : 'generate', model: fam.models[0], prompt, aspect: p.aspect, megapixels: 0.5, count: 1, refs, keepAspect: true, name: `${p.name} · ${sc.location || 'scene'} · ${i + 1}`, tag: `film:${p.id}` })
        this.patch(id, (q) => Object.assign(this.find(q, sh.id).sh, { sketchSet: rec.id, sketch: null, sketchStale: false }))
        made.push({ shot: sh.id, set: rec.id })
      }
    return made
  }
  // This PC's picture models: editor (Flux.2 or Flux 3 Klein, which keep a face, a place and the film's frame) and
  // drawer (any model that draws from words).
  async pictureModels(what) {
    const images = this.images()
    if (!images) throw new Error(`${what} need IV Studio on this PC.`)
    const st = await images.status()
    if (st.error) throw new Error(st.error)
    const ready = (ids, edit) => ids.map((f) => st.families.find((x) => x.id === f && x.ready && x.models.length && (!edit || x.edit))).find(Boolean)
    const editor = ready(['flux2', 'flux3'], true)
    const drawer = ready(['flux2', 'zimage', 'flux3', 'krea2', 'qwen21', 'moss'], false)
    if (!drawer) throw new Error(`${what} need a picture model. Set one up in Settings → Setup (Flux.2 Klein or Z-Image Turbo).`)
    return { images, editor, drawer, st }
  }
  // Waits for a picture set (about 20 s) and returns its first file.
  async picture(images, rec, what) {
    for (const end = Date.now() + 600e3; Date.now() < end; await new Promise((r) => setTimeout(r, 2000))) {
      const r = await images.get(rec.id)
      if (r.files?.length) return r.files[0]
      if (['error', 'cancelled'].includes(r.status)) throw new Error(r.error || `The ${what} failed.`)
    }
    throw new Error(`The ${what} took too long.`)
  }
  // Draws the empty place in the film's frame and waits for it. Returns the picture file.
  async drawPlace(images, fam, p, loc, sc) {
    const rec = await images.create({ mode: 'generate', model: fam.models[0], prompt: placePrompt({ place: loc.name, time: sc.time, description: loc.description, look: p.look?.notes }), aspect: p.aspect, megapixels: 0.5, count: 1, name: `${p.name} · ${loc.name}`, tag: `film:${p.id}` })
    return this.picture(images, rec, 'place picture')
  }
  // Draws a face for someone no character preset plays (from their description, if the person gave one) and keeps
  // it on their cast entry ({ as, characterId: null, description, face }). again: a new face.
  async drawFace(id, role, { again = false } = {}) {
    const { images, drawer } = await this.pictureModels('Faces')
    const p = this.get(id)
    const entry = this.madeUp(p, role) || { as: role, characterId: null, description: '', face: null }
    if (entry.face && fs.existsSync(entry.face) && !again) return entry
    const rec = await images.create({ mode: 'generate', model: drawer.models[0], prompt: facePrompt({ role: entry.as, description: entry.description, look: p.look?.notes }), aspect: '3:4', megapixels: 0.5, count: 1, seed: again ? Math.floor(Math.random() * 1e9) : null, name: `${p.name} · ${entry.as}`, tag: `film:${p.id}` })
    const face = await this.picture(images, rec, 'face')
    const q = this.patch(id, (x) => {
      const old = this.madeUp(x, role)
      if (old) old.face = face
      else x.cast.push({ ...entry, face })
      // their shots' sketches were drawn with the old face (or none)
      for (const sc of x.scenes) for (const sh of sc.shots) if ((sh.sketch || sh.sketchSet) && [sh.speaker, ...(sh.characters || [])].some((n) => first(n) === first(role))) sh.sketchStale = true
    })
    return this.madeUp(q, role)
  }
  // The person's own picture as a made-up role's face (concept art, a reference sheet, a photo of an actor who
  // agreed): copied into the film's faces/ folder and kept on their cast entry, like a drawn face. Their existing
  // sketches are marked to redraw.
  useFace(id, role, file) {
    if (!file || !fs.existsSync(file)) throw new Error('Pick a picture of their face.')
    if (!/\.(png|jpe?g|webp)$/i.test(file)) throw new Error('Use a PNG, JPEG or WebP picture.')
    const p = this.get(id)
    const entry = this.madeUp(p, role) || { as: role, characterId: null, description: '', face: null }
    const dir = path.join(this.dir, 'faces')
    fs.mkdirSync(dir, { recursive: true })
    const face = path.join(dir, `${id}_${first(entry.as).toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'face'}_${Date.now()}${path.extname(file).toLowerCase()}`)
    fs.copyFileSync(file, face)
    const q = this.patch(id, (x) => {
      const old = this.madeUp(x, role)
      if (old) old.face = face
      else x.cast.push({ ...entry, face })
      for (const sc of x.scenes) for (const sh of sc.shots) if ((sh.sketch || sh.sketchSet) && [sh.speaker, ...(sh.characters || [])].some((n) => first(n) === first(role))) sh.sketchStale = true
    })
    return this.madeUp(q, role)
  }
  // More views of a place, drawn from its photo with the QMA camera angles LoRA (see ANGLES): quarter, side and wide.
  // Sketches and shots then take the view that suits their camera (placePicture).
  async drawAngles(id, locationId, { views = Object.keys(ANGLES) } = {}) {
    const { images, st } = await this.pictureModels('Angles')
    const qwen = st.families.find((f) => f.id === 'qwen21' && f.ready && f.edit && f.models.length)
    const info = await this.studio().comfy.objectInfo('LoraLoaderModelOnly').catch(() => null)
    const field = info?.LoraLoaderModelOnly?.input?.required?.lora_name
    const lora = (field?.[1]?.options || field?.[0] || []).find((n) => /qwen-image-2\.1-qma-camera-angles/i.test(n))
    if (!qwen || !lora) throw new Error('More angles need Qwen Image 2.1 and the QMA camera angles LoRA. Get them in Settings → Setup.')
    const model = qwen.models.find((m) => !/[-_]UC[-_]/i.test(m)) || qwen.models[0]
    const p = this.get(id)
    const loc = p.locations.find((l) => l.id === locationId)
    if (!loc) throw new Error('No such place.')
    const photo = loc.pictures.find((f) => fs.existsSync(f))
    if (!photo) throw new Error('Add or draw a photo of the place first; the angles are drawn from it.')
    const angles = []
    // the LoRA card's settings: strength 1, 30 steps, CFG 3, about 1 MP (about 50 s a view on the 4090)
    for (const view of views.filter((v) => ANGLES[v])) {
      const rec = await images.create({ mode: 'edit', model, prompt: ANGLES[view], loras: [{ name: lora, strength: 1 }], refs: [photo], megapixels: 1, steps: 30, cfg: 3, count: 1, seed: 42, name: `${p.name} · ${loc.name} · ${view}`, tag: `film:${p.id}` })
      angles.push({ view, file: await this.picture(images, rec, `${view} view`), from: photo })
    }
    const q = this.patch(id, (x) => {
      const l = x.locations.find((y) => y.id === locationId)
      l.angles = [...(l.angles || []).filter((a) => !angles.some((b) => b.view === a.view)), ...angles]
    })
    return q.locations.find((l) => l.id === locationId)
  }
  // A shot's finished sketch becomes its picture (shot.sketch); a failed one is dropped so it can be redone.
  async refreshSketches(p) {
    const images = this.images()
    if (!images) return p
    for (const sc of p.scenes)
      for (const sh of sc.shots) {
        if (!sh.sketchSet || sh.sketch) continue
        const rec = await images.get(sh.sketchSet).catch(() => null)
        if (!rec || ['error', 'cancelled'].includes(rec.status)) {
          this.patch(p.id, (q) => (this.find(q, sh.id).sh.sketchSet = null))
          sh.sketchSet = null
        } else if (rec.files?.length) {
          this.patch(p.id, (q) => (this.find(q, sh.id).sh.sketch = rec.files[0]))
          sh.sketch = rec.files[0]
        } else sh.sketching = rec.status === 'running' ? 'drawing' : 'waiting'
      }
    return p
  }

  // Hunts previews for a shot (an ordinary IV Studio shot: it shows in Shots too).
  // With voice (the default), a line its character has a voice for is said first, so the shot lip-syncs to it;
  // if the voice engine can't, the shot renders with H3's own voice. With fromSketch (the default) a shot that
  // has a sketch opens exactly on it (Frames mode), so the film keeps the storyboard's framing and faces.
  async render(id, shotId, opts = {}) {
    if (this.filming.has(id)) throw new Error('This film is already being filmed. Wait for its lines to be said.')
    const { sh } = this.find(this.get(id), shotId)
    if (!sh.prompt.trim()) throw new Error('This shot has no prompt yet. Write it first.')
    return (await this.filmShots(id, [shotId], opts))[0]
  }
  // A line its character has a voice for is said first (voice), while the shot shows "Saying the line".
  needsLine(sh, voice = true) {
    return voice && !!sh.line && !sh.voiceLine && !!this.character(sh.character)?.voiceId && !!this.voices()
  }
  // Every line is said before any shot renders: a render stops the voice engine to free the GPU, so saying
  // and rendering in turn would load the voice models again for every shot. Until then the shots show as
  // speaking or queued, and a second Film it is refused.
  async filmShots(id, shotIds, { voice = true, ...opts } = {}) {
    const run = { speaking: null, waiting: new Set(shotIds) }
    this.filming.set(id, run)
    this.onChange(id)
    try {
      for (const shotId of shotIds) {
        if (!this.needsLine(this.find(this.get(id), shotId).sh, voice)) continue
        run.speaking = shotId
        this.onChange(id)
        await this.speak(id, shotId).catch(() => {}) // without the voice engine, H3 voices the line itself
      }
      run.speaking = null
      const jobs = []
      for (const shotId of shotIds) {
        jobs.push(await this.queueShot(id, shotId, opts))
        run.waiting.delete(shotId)
      }
      return jobs
    } finally {
      this.filming.delete(id)
      this.onChange(id)
    }
  }
  async queueShot(id, shotId, { previews = 3, seed, fromSketch = true, room: useRoom = true, previs: usePrevis = true } = {}) {
    const studio = this.studio()
    const p = this.get(id)
    const { sc, sh } = this.find(p, shotId)
    let projectId = sh.projectId
    try {
      if (projectId) studio.getProject(projectId)
    } catch {
      projectId = null
    }
    if (!projectId) {
      const n = sc.shots.indexOf(sh) + 1
      const shot = studio.createProject(`${p.name} · ${sc.location || sc.heading} · ${n}`)
      projectId = shot.id
      this.patch(id, (q) => (this.find(q, shotId).sh.projectId = projectId))
    }
    const said = oneTake(sh.line ? sh.prompt : withSilence(sh.prompt))
    if (sh.continues) return this.queueContinued(p, sc, sh, { projectId, said, previews, seed })
    const seconds = sh.voiceLine ? Math.min(15, Math.max(sh.seconds, Math.ceil(sh.voiceLine.duration + 0.5))) : sh.seconds
    const sketch = fromSketch && sh.sketch && !sh.sketchStale && fs.existsSync(sh.sketch) ? sh.sketch : null
    // with a picture of the place too, reference to video keeps the room the same however the camera moves
    const loc = p.locations.find((l) => l.name.toLowerCase() === (sc.location || '').toLowerCase())
    const room = sketch && useRoom ? placePicture(loc, sh) : null
    // a staged shot whose camera arcs films from its previs: H3 follows a previs's arc and barely arcs from words
    // (other moves and walks do as well from the staging words, and faster)
    const moving = usePrevis && needsPrevis(sh.stage)
    const clip = moving && this.previs() ? await this.previs().make({ stage: sh.stage, seconds, aspect: p.aspect, name: `${p.name} ${sc.shots.indexOf(sh) + 1}` }).catch(() => null) : null
    // the shot's character comes from its LoRA; anyone else in the cast on screen comes from their face picture, and
    // a made-up person's drawn face always comes along (References mode), or H3 makes up a new face each shot
    const faces = this.onScreen(p, sh).filter((x) => x.ch.id !== sh.character)
    const reference = room || clip || faces.some((x) => x.made)
    const others = reference ? faces : []
    const job = await studio.generatePreviews({
      projectId,
      mode: reference ? 'reference' : sketch ? 'frames' : 'text',
      prompt: reference ? withRoom(said, { place: loc?.name, description: loc?.description, people: others.map((x) => x.ch.name.split(/\s+/)[0]), sketch: !!sketch, room: !!room, previs: clip ? sh.stage : null, outside: isOutside(sc) }) : sketch ? asFirstFrame(said) : said,
      media: reference
        ? [...(sketch ? [{ kind: 'picture', file: sketch }] : []), ...(room ? [{ kind: 'picture', file: room }] : []), ...others.map((x) => ({ kind: 'picture', file: x.face })), ...(clip ? [{ kind: 'video', file: clip.file, hasAudio: false }] : [])]
        : sketch
          ? [{ kind: 'picture', file: sketch }]
          : [],
      character: sh.character || 'none',
      seconds,
      aspect: p.aspect,
      megapixels: 0.4,
      previews,
      extraLoras: p.look?.loras || [],
      voiceLine: sh.voiceLine?.file || null,
      seed: seed ?? Math.floor(Math.random() * 1e9)
    })
    this.patch(id, (q) => Object.assign(this.find(q, shotId).sh, { filmedFrom: sketch ? 'sketch' : 'prompt', previs: clip?.file || null }))
    return job
  }
  // A continuous shot carries straight on from the previous shot's take (its finished take, else the picked or first
  // preview) as one unbroken take: Continue mode from that take's last 4 seconds. Its takes open with a replay of
  // the previous take, which the cut leaves out (roughCut).
  async queueContinued(p, sc, sh, { projectId, said, previews, seed }) {
    const n = sc.shots.indexOf(sh)
    const prev = sc.shots[n - 1]
    if (!prev) throw new Error('The first shot of a scene has nothing to carry on from.')
    const st = this.shotState(prev)
    const take = st.final || st.candidates?.find((c) => c.n === (st.picked || 1)) || st.candidates?.[0]
    if (!take) throw new Error(`Film shot ${n} first: shot ${n + 1} carries straight on from its take.`)
    const file = await this.localCopy(take)
    const info = await probe(this.edits.ffprobe, file)
    const dir = path.join(this.dir, 'continue')
    fs.mkdirSync(dir, { recursive: true })
    const src = path.join(dir, `${p.id}_${sh.id}_${Date.now()}.mp4`)
    const silent = info.hasAudio ? [] : ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo']
    await this.edits.run(['-y', '-ss', String(Math.max(0, info.duration - 4)), '-i', file, ...silent, '-map', '0:v:0', '-map', info.hasAudio ? '0:a:0' : '1:a:0', '-r', '24', '-c:v', 'libx264', '-crf', '14', '-preset', 'fast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '48000', '-shortest', src])
    const cut = await probe(this.edits.ffprobe, src)
    const job = await this.studio().generatePreviews({
      projectId,
      mode: 'continue',
      prompt: said,
      character: sh.character || 'none',
      // Continue counts its 22-frame overlap inside the length (H3 stops at 15 s)
      seconds: Math.min(15, +(sh.seconds + CONTINUE_OVERLAP).toFixed(2)),
      overlapFrames: 22,
      aspect: p.aspect,
      megapixels: 0.4,
      previews,
      extraLoras: p.look?.loras || [],
      seed: seed ?? Math.floor(Math.random() * 1e9),
      media: [{ kind: 'video', file: src, duration: cut.duration, width: cut.width, height: cut.height, hasAudio: true }]
    })
    this.patch(p.id, (q) => Object.assign(this.find(q, sh.id).sh, { filmedFrom: 'continue', previs: null }))
    return job
  }
  // Previews for every shot in a scene (or, with no sceneId, the whole film) that has a prompt and nothing
  // rendered yet.
  async renderScene(id, sceneId, opts = {}) {
    const p = this.get(id)
    const scenes = sceneId ? p.scenes.filter((s) => s.id === sceneId) : p.scenes
    if (!scenes.length) throw new Error('No such scene.')
    if (this.filming.has(id)) throw new Error('This film is already being filmed. Wait for its lines to be said.')
    // a continuous shot waits until the shot before it has a take to carry on from
    const hasTake = (sh) => !!sh?.projectId && ['pick', 'finished', 'finishing'].includes(this.shotState(sh).status)
    const ids = scenes.flatMap((sc) => sc.shots.filter((sh, i) => sh.prompt.trim() && !sh.projectId && (!sh.continues || hasTake(sc.shots[i - 1]))).map((sh) => sh.id))
    return ids.length ? this.filmShots(id, ids, opts) : []
  }
  // Finishes preview n of the shot's latest hunt (2 MP; with the voice line as its sound when it has one).
  async finish(id, shotId, candidate = 1, { megapixels = 2, upscale2x = false } = {}) {
    const p = this.get(id)
    const { sh } = this.find(p, shotId)
    const st = this.shotState(sh)
    if (!st.previewsJob || st.previewsStatus !== 'success') throw new Error('Render its previews first.')
    const job = await this.studio().finishCandidate({ jobId: st.previewsJob, candidate: Number(candidate), megapixels, upscale2x, fps: 0, audio: sh.voiceLine ? 'voice' : 'pass' })
    this.onChange(id)
    return job
  }

  // Where a shot is: its newest hunt and newest finish, read from the shot's jobs.
  shotState(sh) {
    if (!sh.projectId) return { status: sh.prompt ? 'ready' : 'draft' }
    const studio = this.studio()
    let jobs = []
    try {
      jobs = studio.listJobs(sh.projectId)
    } catch {
      return { status: sh.prompt ? 'ready' : 'draft' }
    }
    const last = (kind) => jobs.filter((j) => j.kind === kind).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0]
    const pv = last('previews')
    // a finish counts only for the newest hunt: new takes mean the shot is being redone, so an older finished take
    // (still in Shots) no longer stands for it in the cut or as what a one-take shot carries on from
    const fin = [last('finish')].find((f) => f && (!pv || f.parent === pv.id || String(f.createdAt) > String(pv.createdAt)))
    const out = { previewsJob: pv?.id || null, previewsStatus: pv?.status || null, finishJob: fin?.id || null, finishStatus: fin?.status || null }
    out.candidates = pv?.status === 'success' ? (pv.outputs || []).filter((o) => o.kind === 'preview').map((o) => ({ n: o.candidate, url: o.url, path: o.path })) : []
    const finalOut = fin?.status === 'success' ? (fin.outputs || []).find((o) => o.kind === 'final') || (fin.outputs || []).find((o) => /before_dlss$/.test(o.kind)) : null
    if (finalOut) out.final = { url: finalOut.url, path: finalOut.path }
    if (fin && fin.parent === pv?.id) out.picked = fin.plan?.finish?.candidate || null
    out.status = finalOut ? 'finished' : fin && !DONE.includes(fin.status) ? 'finishing' : pv && !DONE.includes(pv.status) ? 'rendering' : pv?.status === 'success' ? 'pick' : pv?.status === 'error' || fin?.status === 'error' ? 'error' : 'ready'
    out.error = fin?.status === 'error' ? fin.error : pv?.status === 'error' ? pv.error : null
    return out
  }
  // Moves unfinished jobs on (asks ComfyUI) and returns the production with each shot's state.
  async view(id) {
    const p = await this.refreshSketches(this.get(id))
    const studio = this.studio()
    for (const sc of p.scenes)
      for (const sh of sc.shots)
        if (sh.projectId)
          for (const j of studio.listJobs(sh.projectId))
            if (!DONE.includes(j.status)) await studio.refreshJob(j.id).catch(() => {})
    const run = this.filming.get(id)
    const stateOf = (sh) => (run?.speaking === sh.id ? { status: 'speaking' } : run?.waiting.has(sh.id) && !sh.projectId ? { status: 'queued' } : this.shotState(sh))
    const scenes = p.scenes.map((sc) => ({ ...sc, shots: sc.shots.map((sh) => ({ ...sh, state: stateOf(sh) })) }))
    const all = scenes.flatMap((s) => s.shots)
    const count = (st) => all.filter((s) => s.state.status === st).length
    return {
      ...p,
      step: p.step || (all.length ? 'board' : p.scenes.length ? 'cast' : 'idea'),
      writing: this.writing.has(id),
      filming: run ? { speaking: run.speaking, waiting: run.waiting.size } : null,
      scenes,
      totals: { shots: all.length, seconds: all.reduce((n, s) => n + s.seconds, 0), finished: count('finished'), pick: count('pick'), rendering: count('rendering') + count('finishing') + count('speaking') + count('queued'), speaking: count('speaking') + count('queued'), ready: count('ready'), draft: count('draft'), sketched: all.filter((s) => s.sketch).length, sketching: all.filter((s) => s.sketchSet && !s.sketch).length }
    }
  }

  // ---------- the cut ----------
  // Every shot in script order on V1 of the project's edit (made the first time; V1 is replaced on a rebuild,
  // other tracks stay): the finished take, else the picked or first preview. Returns { editId, placed, missing }.
  async roughCut(id) {
    const v = await this.view(id)
    let e
    try {
      e = v.editId ? this.edits.get(v.editId) : null
    } catch {
      e = null
    }
    if (!e) e = this.edits.create(`${v.name} · rough cut`)
    e.settings = { ...e.settings, format: FORMAT_FOR[v.aspect] || '1080p', fps: 24 }
    const media = { ...e.media }
    const ops = [...e.clips.filter((c) => c.track === 'V1').map((c) => ({ op: 'remove_clip', clip: c.id }))]
    const missing = []
    let at = 0
    let placed = 0
    for (const sc of v.scenes)
      for (const sh of sc.shots) {
        const st = sh.state
        const src = st.final || (st.candidates?.length ? st.candidates.find((c) => c.n === (st.picked || 1)) || st.candidates[0] : null)
        if (!src) {
          missing.push({ scene: sc.heading, shot: sh.id, status: st.status })
          continue
        }
        const file = await this.localCopy(src)
        let m = Object.values(media).find((x) => x.path === file)
        if (!m) {
          m = await this.edits.addMedia(file, { type: 'iv', label: `${sc.location || sc.heading} · ${sh.action.slice(0, 40)}`, production: v.id })
          media[m.id] = m
        }
        // a continuous shot opens with a replay of the previous take: its previews repeat the last 23 frames, its
        // finished take ("continued") the whole 4 s source. Either way the new footage is the preview's length less
        // those 23 frames, so the cut keeps that much from the end.
        let from = 0
        if (sh.filmedFrom === 'continue' && st.candidates?.length) {
          const pv = await probe(this.edits.ffprobe, await this.localCopy(st.candidates[0])).catch(() => null)
          const fresh = pv?.duration ? pv.duration - CONTINUE_OVERLAP : 0
          if (fresh > 0.5 && fresh < m.duration) from = +(m.duration - fresh).toFixed(3)
        }
        ops.push({ op: 'add_clip', media: m.id, track: 'V1', start: at, in: from, out: m.duration })
        at += m.duration - from
        placed++
      }
    const r = applyOps({ ...e, media }, ops)
    Object.assign(e, { clips: r.clips, media: r.media, tracks: r.tracks, markers: r.markers })
    this.edits.write(e)
    this.patch(id, (q) => (q.editId = e.id))
    return { editId: e.id, placed, missing, seconds: +at.toFixed(2) }
  }

  // ---------- the animatic ----------
  // The storyboard played as a film before anything is filmed: each sketch held for its shot's length with a slow
  // push-in, the shot's line in its voice where it has one (said first with voice, when the voice engine is set up),
  // and the words on screen. A shot with no sketch shows its action on a dark card. Saved in the app data's
  // productions\animatics and kept on the production as animatic { file, seconds, shots, at }.
  async animatic(id, { voice = false } = {}) {
    if (!this.edits?.ffmpeg) throw new Error('The animatic needs IV Studio on this PC.')
    if (voice) for (const sc of this.get(id).scenes) for (const sh of sc.shots) if (this.needsLine(sh)) await this.speak(id, sh.id).catch(() => {})
    const p = this.get(id)
    const plan = animaticPlan(p.scenes)
    if (!plan.length) throw new Error('Plan the storyboard first.')
    const [w, h] = { '16:9': [1280, 720], '9:16': [720, 1280], '1:1': [960, 960] }[p.aspect] || [1280, 720]
    const dir = path.join(this.dir, 'animatics', p.id)
    fs.rmSync(dir, { recursive: true, force: true })
    fs.mkdirSync(dir, { recursive: true })
    const font = String(this.edits.fontFile || '').replace(/\\/g, '/').replace(/:/g, '\\:')
    const parts = []
    for (const [k, s] of plan.entries()) {
      const out = path.join(dir, `${String(k).padStart(3, '0')}.mp4`)
      const frames = Math.round(s.seconds * 24)
      // words on screen go through text files, so quotes and colons need no escaping
      const words = path.join(dir, `${k}.txt`)
      fs.writeFileSync(words, wrap(s.line || (s.sketch ? '' : s.action), Math.round(w / 26)))
      const label = path.join(dir, `${k}l.txt`)
      fs.writeFileSync(label, `${s.n}`)
      const text = (file, size, y, box) => `drawtext=fontfile='${font}':textfile='${file.replace(/\\/g, '/').replace(/:/g, '\\:')}':fontsize=${size}:fontcolor=white:x=(w-text_w)/2:y=${y}:line_spacing=6${box ? ':box=1:boxcolor=black@0.55:boxborderw=14' : ''}`
      const picture = s.sketch && fs.existsSync(s.sketch) ? ['-loop', '1', '-i', s.sketch] : ['-f', 'lavfi', '-i', `color=c=0x15171c:s=${w}x${h}:r=24`]
      const sound = s.voice && fs.existsSync(s.voice) ? ['-i', s.voice] : ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo']
      const push = s.sketch ? `scale=${w * 2}:${h * 2}:force_original_aspect_ratio=increase,crop=${w * 2}:${h * 2},zoompan=z='min(1+0.06*on/${frames},1.06)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${w}x${h}:fps=24,` : ''
      const vf = `${push}${text(label, Math.round(h / 24), 'h/30', true).replace(':x=(w-text_w)/2', ':x=w/40')},${text(words, Math.round(h / (s.sketch ? 22 : 16)), s.sketch ? 'h-text_h-h/14' : '(h-text_h)/2', !!s.sketch)},format=yuv420p`
      await this.edits.run(['-y', ...picture, ...sound, '-filter_complex', `[0:v]${vf}[v];[1:a]aresample=48000,apad[a]`, '-map', '[v]', '-map', '[a]', '-t', String(s.seconds), '-r', '24', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-ac', '2', '-ar', '48000', out])
      parts.push(out)
    }
    const list = path.join(dir, 'parts.txt')
    fs.writeFileSync(list, parts.map((f) => `file '${f.replace(/\\/g, '/')}'`).join('\n'))
    const file = path.join(this.dir, 'animatics', `${p.id}.mp4`)
    await this.edits.run(['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', file])
    fs.rmSync(dir, { recursive: true, force: true })
    const seconds = +plan.reduce((n, s) => n + s.seconds, 0).toFixed(2)
    const animatic = { file, seconds, shots: plan.length, sketched: plan.filter((s) => s.sketch).length, voiced: plan.filter((s) => s.voice).length, at: now() }
    this.patch(id, (q) => (q.animatic = animatic))
    return { ...animatic, plan }
  }
}

// Words broken into lines of about n characters, for text drawn on the animatic.
function wrap(text, n) {
  const lines = []
  let line = ''
  for (const word of String(text || '').split(/\s+/).filter(Boolean)) {
    if (line && (line + ' ' + word).length > n) {
      lines.push(line)
      line = word
    } else line = line ? `${line} ${word}` : word
  }
  if (line) lines.push(line)
  return lines.join('\n')
}
