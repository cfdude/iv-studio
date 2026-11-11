// The prompt checker: what H3 is likely to misread in a prompt, found before any GPU time is spent. Pure, so the
// window (Create, a shot's page), the MCP server and the writer's self-repair all share it. Each finding is
// { level: 'error' | 'warning' | 'info', code, message, fix? }: an error blocks a render unless the person renders
// anyway; fix, when given, is the whole prompt with the problem mended. The rules follow MiniMax's own H3 guide
// and what IV Studio's test renders showed.
import { resolveFrames } from './plan.js'
import { isPrevis } from './staging.js'

export const FIRST_FRAME_LINE = 'For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.'
export const firstLastLine = (seconds, lastShot = 1) =>
  `How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot ${lastShot}) aligns with the ${(resolveFrames(seconds) / 24).toFixed(2)}-second mark of the target video.`

// H3's trained floor is 124 frames (5.17 s); shorter clips are made but move worse.
const MIN_FRAMES = 124
const WORDS_PER_SECOND = 2.5
const FILLER = /\b(masterpiece|best quality|high quality|ultra[- ]?detailed|highly detailed|hyper[- ]?realistic|award[- ]winning|stunning|breathtaking|gorgeous|8k|4k|uhd|trending on artstation)\b/gi
const CAMERA_MOVES = [
  ['push', /\bpush(?:es|ing)? in\b|\bdolly(?:ing)? in\b/i],
  ['pull', /\bpull(?:s|ing)? (?:out|back)\b|\bdolly(?:ing)? out\b/i],
  ['pan', /\bpan(?:s|ning)? (?:left|right)\b/i],
  ['tilt', /\btilt(?:s|ing)? (?:up|down)\b/i],
  ['truck', /\btruck(?:s|ing)? (?:left|right)\b/i],
  ['pedestal', /\bpedestal(?:s|ing)? (?:up|down)\b|\bcrane(?:s|ing)? (?:up|down)\b/i],
  ['arc', /\barc(?:s|ing)?\b|\borbit(?:s|ing)?\b/i],
  ['zoom', /\bzoom(?:s|ing)? (?:in|out)\b/i],
  ['roll', /\brolls? (?:clockwise|counterclockwise)\b/i],
  ['track', /\btracking shot\b|\btracks? (?:her|him|them|the)\b/i]
]
const FACE_WORDS = /\b(hair|eyes?|eyebrows?|face|freckles?|skin|beard|moustache|mustache|nose|lips|cheeks?|jaw|ethnic\w*|voice)\b/i
// Framing and actions name the face without describing it: "a close-up of {char}'s face", "her eyes widen".
const FACE_FRAMING = /\b(?:close[- ]?ups?|shot|frames?|framing|focus(?:es)?|holds?|lingers?|pushes in|push-in|zooms? in|cuts?|tilts? up|pans?)\s+(?:on|of|to|onto|into|across)\s+(?:\{char\}'s|her|his|their|the)\s+(?:face|eyes)\b/gi
const FACE_ACTION = /\b(?:\{char\}'s|her|his|their)\s+(?:eyes?|face|eyebrows?|lips)\s+(?:widens?|narrows?|closes?|close|opens?|lights? up|softens?|falls?|drops?|darts?|flicks?|follows?|turns?|tightens?|crinkles?|parts?|twitches|twitch|lifts?|raises?|goes|go|fills?|fill|meets?|meet|stays?|scans?|drifts?)\b/gi
const unframed = (x) => x.replace(/<d>[\s\S]*?<\/d>/g, '').replace(FACE_FRAMING, '').replace(FACE_ACTION, '')

// Every line said by the one speaker, the picked character: "then says: <d>" → "then {char} (S1) says: <d>"
// (a pronoun just before the verb gives way to the name); a line with no verb before it gets "{char} (S1) says:".
const SPEECH_VERB = /(?:\b(?:she|he|they)\s+)?\b(says|asks|whispers|shouts|replies|answers|calls|mutters|murmurs|sighs)\b(\s*:?\s*)<d>/gi
function withSpeaker(text) {
  const named = text.replace(SPEECH_VERB, (_, verb, gap) => `{char} (S1) ${verb.toLowerCase()}${gap}<d>`)
  return named.replace(/<d>/g, (tag, at) => (/\(S1\)[^<]{0,12}$/.test(named.slice(Math.max(0, at - 40), at)) ? tag : `{char} (S1) says: ${tag}`))
}

// The writer sometimes leaves a line out of its prompt. Without its <d> tag H3 makes up its own words,
// so a missing line goes at the end of the last [Shot] paragraph.
export function withLine(prompt, who, line) {
  const words = String(line || '').trim()
  if (!words) return prompt
  const norm = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const tags = [...prompt.matchAll(/<d>(?:\[[^\]]*\])?([\s\S]*?)<\/d>/g)].map((m) => norm(m[1]))
  if (tags.some((t) => t && (t.includes(norm(words)) || norm(words).includes(t)))) return prompt
  const said = `${who || 'They'} says: <d>[English] ${words.replace(/^["“]|["”]$/g, '')}</d>`
  const cut = prompt.search(/\n\s*\noverall_soundscape:/)
  return cut < 0 ? `${prompt.trimEnd()} ${said}` : `${prompt.slice(0, cut).trimEnd()} ${said}${prompt.slice(cut)}`
}

// H3 has no negative prompt: every noun is something to show, so "No photographs appear anywhere" hung the wall with
// photographs (keys + Sam Wasserman's Imagination Studio found this, twice). IV Studio's own house sentences stay:
// they were tested in renders, and without "No one speaks" H3 invents lines.
const HOUSE_NEGATIVES = [
  /\b(?:no one|nobody) (?:speaks|says anything|talks)\b[^.\n]*[.\n]?/gi,
  /\bthere is no (?:writing|text|lettering)[^.\n]*[.\n]?/gi,
  /\b(?:one|a single|as one) (?:continuous|unbroken) (?:shot|take)\b[^.\n]*[.\n]?/gi,
  /\bit is one continuous take with no cuts\b[^.\n]*[.\n]?/gi,
  /\bno cut, the same camera\b/gi,
  /\bthe picture itself never appears as a frame\b/gi,
  /\bnobody in it: an empty set\b[^.\n]*[.\n]?/gi
]
const NEGATIVE = /\b(no|without|never|not|nor|doesn['’]t|don['’]t|isn['’]t|aren['’]t|won['’]t|cannot|can['’]t)\s+((?:any|a|an|the|one|other|more)\s+)?([a-z][a-z-]*(?:\s+(?!and\b|or\b|but\b|as\b|while\b|with\b)[a-z][a-z-]*){0,3})/gi
// grammar, not a thing to show
const NEGATIVE_OK = /^(?:longer|matter|sooner|more than|less than|only|just|quite|too|much|later|doubt|wonder|exception|less|more|sure|yet|until|before|after|far|least)\b/i
const POSITIVE = [
  [/photo|picture|poster|painting|frame/i, 'bare, plain walls'],
  [/text|writing|word|letter|logo|sign|caption|subtitle|label/i, 'plain, unmarked surfaces'],
  [/people|person|crowd|one else|pedestrian|passer|bystander|extras?/i, 'an empty street or room, with only the people you name'],
  [/music|song/i, 'only the natural sounds of the place'],
  [/cut/i, 'one continuous take'],
  [/camera mov|move|moving|motion|shake/i, 'a locked-off, still camera'],
  [/smil|laugh/i, 'a calm, neutral expression'],
  [/talk|speak|dialogue|say|sound/i, 'lips closed, in silence'],
  [/look\w* (?:at|into) (?:the )?(?:camera|lens)|eye contact/i, 'eyes on something in the scene, off to the side'],
  [/blur|out of focus/i, 'sharp focus throughout'],
  [/rain/i, 'dry, clear weather'],
  [/cloud/i, 'a clear sky'],
  [/hat|glasses|jewel|makeup|tattoo/i, 'the bare head or face, said plainly (short hair, bare face)'],
  [/car|vehicle|traffic/i, 'an empty road']
]
// Phrases like "no photographs", "without a hat", "never looks at the camera", with what to write instead.
export function negativePhrases(prompt) {
  let text = String(prompt || '').replace(/<d>[\s\S]*?<\/d>/g, ' ')
  const s = sections(text)
  for (const k of ['retention_analysis', 'summary', 'non_diegetic_music']) if (s[k]) text = text.replace(s[k], ' ')
  for (const re of HOUSE_NEGATIVES) text = text.replace(re, ' ')
  const out = []
  for (const m of text.matchAll(NEGATIVE)) {
    const rest = m[3].trim()
    if (NEGATIVE_OK.test(rest) || /^(?:one|body) (?:speaks|says|talks)/i.test(rest)) continue
    const phrase = `${m[1]} ${m[2] || ''}${rest}`.replace(/\s+/g, ' ').trim()
    if (out.some((x) => x.phrase.toLowerCase() === phrase.toLowerCase())) continue
    out.push({ phrase, instead: POSITIVE.find(([re]) => re.test(rest))?.[1] || null })
  }
  return out
}

const count = (text, re) => (String(text).match(re) || []).length
const sentences = (text) => String(text).split(/(?<=[.!?])\s+/)

// The prompt's sections by name ({ integrated_multimodal_description: '…', … }), and its text before the first one.
export function sections(prompt) {
  const out = {}
  const re = /(^|\n)\s*(integrated_multimodal_description|detailed_description|overall_soundscape|non_diegetic_music|subject_definitions|summary|retention_analysis)\s*:/g
  const marks = []
  let m
  while ((m = re.exec(prompt))) marks.push({ name: m[2], start: m.index + m[0].length, at: m.index })
  marks.forEach((mk, i) => (out[mk.name] = prompt.slice(mk.start, i + 1 < marks.length ? marks[i + 1].at : prompt.length).trim()))
  out._head = marks.length ? prompt.slice(0, marks[0].at).trim() : prompt.trim()
  return out
}

const parseTime = (s) => {
  const [m, sec] = s.split(':')
  return Number(m) * 60 + Number(sec)
}

// What each kind of reference attached is called in the prompt: { picture: 2, video: 0, audio: 1 }.
const counts = (media = []) => ({ picture: media.filter((m) => m.kind === 'picture').length, video: media.filter((m) => m.kind === 'video').length, audio: media.filter((m) => m.kind === 'audio').length })

// context: { mode, seconds, media: [{kind}], character: { name, trigger } | null, voiceLine, mentions: names known }
export function lintPrompt(prompt, { mode = 'text', seconds = 5, media = [], character = null, voiceLine = null, mentions = null } = {}) {
  const text = String(prompt || '')
  const out = []
  const add = (level, code, message, fix) => out.push({ level, code, message, ...(fix && fix !== text ? { fix } : {}) })
  if (!text.trim()) return out
  const s = sections(text)
  const frames = resolveFrames(seconds)
  const real = frames / 24
  const body = mode === 'reference' ? s.detailed_description : s.integrated_multimodal_description

  // ---- length on H3's frame grid
  if (frames < MIN_FRAMES) add('warning', 'too-short', `${seconds} s is under H3's trained minimum of ${(MIN_FRAMES / 24).toFixed(2)} s. It renders, but the motion is weaker; make it 5 s and trim it in Edit.`)
  else if (Math.abs(real - seconds) >= 0.05) add('info', 'real-length', `${seconds} s renders as ${real.toFixed(2)} s (${frames} frames, H3's frame grid). Cut times should fit ${real.toFixed(2)} s.`)

  // ---- the fields H3 reads
  if (/___/.test(text)) add('error', 'placeholder', 'The template still has blanks (___). Fill them in or take them out.')
  if (mode === 'reference') {
    if (!s.detailed_description) add('error', 'missing-field', 'References mode needs a detailed_description: section (the shots). Write it for me makes all six sections.')
    if (!s.subject_definitions) add('warning', 'missing-field', 'References mode works best with subject_definitions: saying what each <Picture N> or <Video N> is.')
  } else if (!s.integrated_multimodal_description) add('error', 'missing-field', 'The prompt needs an integrated_multimodal_description: section (the shots, starting with [Shot 1]).')
  if (body != null && !/\[Shot 1\]/.test(body)) add('warning', 'no-shot-1', 'The description should start with [Shot 1].')
  if (!s.overall_soundscape) add('warning', 'no-soundscape', 'There is no overall_soundscape: section. Without it H3 often makes a flat or empty sound bed; describe the room tone and the action sounds.')
  else if (/^n\/?a\.?$/i.test(s.overall_soundscape)) add('info', 'silent-soundscape', 'overall_soundscape is N/A, which asks for complete silence. Describe ambience unless you want none.')

  // ---- frames mode's opening line
  const pics = counts(media).picture
  if (mode === 'frames') {
    const want = pics >= 2 ? firstLastLine(seconds, Math.max(1, count(body || '', /\[Shot \d+\]/g))) : FIRST_FRAME_LINE
    const hasFirst = text.includes(FIRST_FRAME_LINE)
    const hasBoth = /aligns with the [\d.]+-second mark/.test(text)
    const stripped = text.replace(FIRST_FRAME_LINE, '').replace(/How the reference pictures align with the target video[^\n]*\n?/, '').trim()
    if (pics >= 2 && !hasBoth) add('error', 'frames-line', `There's a last frame, but the prompt doesn't say where it lands, so H3 ignores it. It needs MiniMax's first-and-last-frame line at ${real.toFixed(2)} s.`, `${want}\n\n${stripped}`)
    else if (pics < 2 && !hasFirst) add('warning', 'frames-line', 'The prompt should open with the line that fixes <Picture 1> as the first frame.', `${want}\n\n${stripped}`)
    else if (pics >= 2 && hasBoth && !text.includes(want)) add('warning', 'frames-line', `The last frame should land at ${real.toFixed(2)} s, the clip's real length.`, `${want}\n\n${stripped}`)
  }

  // ---- cuts
  if (body) {
    let last = 0
    let n = 1
    for (const m of body.matchAll(/\[Shot (\d+)\]\s*At (\d{1,2}:\d{2}(?:\.\d+)?)/g)) {
      const t = parseTime(m[2])
      n = Number(m[1])
      if (t <= last) add('error', 'cut-order', `[Shot ${m[1]}] starts at ${m[2]}, not after the shot before it.`)
      else if (t >= real - 0.5) add('error', 'cut-late', `[Shot ${m[1]}] starts at ${m[2]}, too close to the end of a ${real.toFixed(2)} s clip to be seen.`)
      else if (t - last < 1.5) add('warning', 'cut-short', `[Shot ${m[1] - 1}] lasts ${(t - last).toFixed(1)} s; shots under 1.5 s rarely register.`)
      last = t
    }
    if (n > 1 && mode === 'frames' && pics >= 2) add('warning', 'frames-cut', 'First-and-last-frame clips work best as one continuous shot (MiniMax\'s guide). The cuts may break the path to the last frame.')
    if (n > Math.max(1, Math.round(real / 3))) add('warning', 'too-many-shots', `${n} shots in ${real.toFixed(1)} s leaves under 3 s each. Fewer cuts read better.`)
  }

  // ---- speech
  const lines = [...text.matchAll(/<d>\s*(?:\[[^\]]+\])?\s*([\s\S]*?)<\/d>/g)].map((m) => m[1].trim())
  const words = lines.reduce((n, l) => n + l.split(/\s+/).filter(Boolean).length, 0)
  const budget = real * WORDS_PER_SECOND
  if (words > budget * 1.4) add('error', 'speech-too-long', `${words} spoken words in ${real.toFixed(1)} s is far more than can be said (about ${Math.floor(budget)} at a natural pace). Cut the lines or make the clip longer.`)
  else if (words > budget) add('warning', 'speech-long', `${words} spoken words in ${real.toFixed(1)} s is a lot (about ${Math.floor(budget)} fit at a natural pace, with room for reactions).`)
  for (const l of lines) {
    if (/^["“'‘]|["”'’]$/.test(l)) add('warning', 'quoted-line', `Take the quotation marks out of the line "${l.replace(/^["“'‘]+/, '').slice(0, 40)}…": inside <d> they're read as part of the words.`, text.replace(/(<d>\s*(?:\[[^\]]+\])?\s*)["“'‘]([\s\S]*?)["”'’](\s*<\/d>)/g, '$1$2$3'))
    if (/^[A-Z][\w.]*(?: [A-Z][\w.]*)?\s*(?:\([^)]*\))?\s*:/.test(l)) add('warning', 'name-in-line', `"${l.slice(0, 40)}" starts with a name; inside <d> it would be spoken. Put only the words said.`)
  }
  for (const m of text.matchAll(/<d>/g)) {
    const before = text.slice(Math.max(0, m.index - 220), m.index)
    if (!/\((?:S\d+)(?:,S\d+)*\)/.test(before)) {
      // with a character picked and no speaker IDs anywhere, the picked character is the one speaker: name them
      const fix = character && /\{char\}/.test(text) && !/\(S\d+/.test(text) ? withSpeaker(text) : undefined
      add('warning', 'no-speaker', `A line ("${text.slice(m.index + 3, m.index + 50).replace(/<\/d>[\s\S]*/, '').replace(/^\s*\[[^\]]+\]\s*/, '')}…") has no speaker ID just before it. Every line needs its speaker's ID, as in "Mara (S1) says:", each time they speak.`, fix)
      break
    }
  }
  const outside = text.replace(/<d>[\s\S]*?<\/d>/g, '')
  if (/\b(?:says|asks|whispers|shouts|replies|answers|calls)\b[^"“\n]{0,30}["“][^"”]{3,}["”]/.test(outside)) add('warning', 'untagged-speech', 'There is quoted speech outside <d>…</d>. H3 only says words inside <d>[English] …</d>.')
  if (voiceLine && !lines.length) add('warning', 'voice-no-words', 'There is a voice line to lip-sync, but no <d>[English] …</d> with its words in the prompt. H3 lip-syncs best when the words are written.')

  // ---- references
  const have = counts(media)
  for (const [kind, label] of [
    ['picture', 'Picture'],
    ['video', 'Video'],
    ['audio', 'Audio']
  ]) {
    const named = new Set([...text.matchAll(new RegExp(`<${label} (\\d+)>`, 'g'))].map((m) => Number(m[1])))
    for (const k of named) if (k > have[kind] && !(mode === 'frames' && kind === 'picture')) add('error', 'reference-missing', `The prompt names <${label} ${k}>, but only ${have[kind]} ${kind}${have[kind] === 1 ? ' is' : 's are'} attached.`)
    if (mode === 'reference') for (let k = 1; k <= have[kind]; k++) if (!named.has(k)) add('warning', 'reference-unused', `<${label} ${k}> is attached but the prompt never names it, so H3 may ignore it.`)
  }
  // a previs only guides the camera and the blocking: if the prompt describes its mannequins, H3 may draw them
  const previsAt = media.filter((m) => m.kind === 'video').findIndex((m) => isPrevis(m.file || m.path)) + 1
  if (mode === 'reference' && previsAt) {
    const outside = text.replace(/<Video \d+> is a grey previs[^\n]*?not its look[^.\n]*\./g, '')
    if (/mannequin|grey (?:figure|stage|box)|gray (?:figure|stage|box)/i.test(outside))
      add('error', 'previs-look', `<Video ${previsAt}> is a previs: only its camera move and where people stand count. The prompt describes its mannequins or grey stage, so H3 may draw them; describe the real people and place instead.`)
  }
  // References mode makes a new scene from the person: keeping a person-picture's setting rebuilds its place
  if (mode === 'reference' && s.retention_analysis) {
    const PLACE = /\b(?:setting|background|backdrop|surroundings|scene|location|environment|lighting|sunlight|light)\b/i
    const PERSON = /\b(?:hair|face|skin|eyes|build|wear|wearing|dress|outfit|shirt|top|jacket|headdress|necklace|wardrobe|costume)\b/i
    let fixed = text
    let found = false
    for (const line of s.retention_analysis.split('\n')) {
      const m = line.match(/^(.*?<(?:Subject|Picture) \d+>[^:]*:\s*\w+\s*-\s*)(.*)$/)
      // "through the new scene" says the place changes; only a place that is kept counts
      if (!m || !PERSON.test(m[2]) || !PLACE.test(m[2].replace(/\b(?:the |a )?(?:new|different|another)\s+(?:\w+\s+)?(?:setting|background|backdrop|scene|location|environment|lighting|light)\b/gi, ''))) continue
      found = true
      const kept = m[2].split(/,\s*(?:and\s+)?|\s+and\s+(?=[a-z])/i).filter((part) => part && !PLACE.test(part))
      fixed = fixed.replace(line, m[1] + kept.join(', '))
    }
    const summary = s.summary || ''
    // clause by clause: "identity is preserved; the setting is new" keeps only the person
    const keepsPlace = (c) => /\b(?:setting|background|surroundings)\b/i.test(c) && /\bpreserved\b/i.test(c) && !/\b(?:new|different|changes?|changed)\b/i.test(c)
    if (summary.split(/[.;]/).some(keepsPlace)) {
      found = true
      const trimmed = summary.replace(/,?\s*(?:and\s+)?(?:the\s+)?(?:setting|background|surroundings)\b/gi, '').replace(/\b(\w+), (\w+)(?= (?:are|is) (?:fully |partially )?preserved)/, '$1 and $2')
      fixed = fixed.replace(summary, trimmed)
    }
    if (found)
      add('warning', 'reference-keeps-place', 'The prompt keeps the reference picture’s setting as well as the person, so H3 rebuilds the picture’s place instead of making a new scene. Keep the person (face, hair, outfit) and describe the place from your idea.', fixed)
  }
  if (mode === 'reference' && s.subject_definitions) {
    const defined = new Set([...s.subject_definitions.matchAll(/<Subject (\d+)>/g)].map((m) => m[1]))
    const used = new Set([...(s.detailed_description || '').matchAll(/<Subject (\d+)>/g)].map((m) => m[1]))
    for (const k of used) if (!defined.has(k)) add('error', 'subject-undefined', `<Subject ${k}> is used but subject_definitions doesn't say what it is.`)
    for (const k of defined) if (!used.has(k)) add('info', 'subject-unused', `<Subject ${k}> is defined but never appears in the shots.`)
  }

  // ---- the main character
  if (character) {
    if (!/\{char\}/.test(text) && !(character.trigger && text.includes(character.trigger))) add('warning', 'char-missing', `${character.name?.split(' ')[0] || 'The character'} is picked but the prompt never writes {char}, so the LoRA may not show them.`)
    const faceSentence = sentences(text).find((x) => /\{char\}/.test(x) && FACE_WORDS.test(unframed(x)))
    if (faceSentence) add('warning', 'char-face', `"${faceSentence.slice(0, 70)}…" describes {char}'s ${FACE_WORDS.exec(unframed(faceSentence))[1]}. The character's LoRA carries the face, hair and voice; describing them fights it.`)
  }

  // ---- wording
  const filler = [...new Set((text.match(FILLER) || []).map((w) => w.toLowerCase()))]
  if (filler.length) add('info', 'filler', `"${filler.join('", "')}" describe how good it should look, which H3 doesn't act on. Describe what is seen instead.`, text.replace(FILLER, '').replace(/ ,/g, ',').replace(/,(\s*,)+/g, ',').replace(/ {2,}/g, ' '))
  if (body) {
    for (const shot of body.split(/(?=\[Shot \d+\])/)) {
      const moves = CAMERA_MOVES.filter(([, re]) => re.test(shot)).map(([name]) => name)
      if (moves.length > 2) add('warning', 'camera-load', `${shot.match(/\[Shot \d+\]/)?.[0] || 'A shot'} asks for ${moves.length} camera moves (${moves.join(', ')}). One move a shot reads cleanly.`)
    }
  }

  // ---- "no X": H3 shows the X
  const negs = negativePhrases(text)
  if (negs.length)
    add('warning', 'negative-wording', `H3 has no negative prompt, so every thing named is something to show: "no photographs" can put photographs on the wall. Say what is there instead: ${negs.slice(0, 4).map((n) => `"${n.phrase}"${n.instead ? ` (try: ${n.instead})` : ''}`).join('; ')}${negs.length > 4 ? `; and ${negs.length - 4} more` : ''}.`)

  // ---- @ mentions left unresolved
  if (mentions) for (const m of text.matchAll(/(^|[\s(])@([A-Za-z][\w-]*)/g)) if (!mentions.some((n) => n.toLowerCase() === m[2].toLowerCase())) add('error', 'mention-unknown', `@${m[2]} isn't in your cast or places.`)

  const rank = { error: 0, warning: 1, info: 2 }
  return out.sort((a, b) => rank[a.level] - rank[b.level])
}

export const blocking = (findings) => findings.filter((f) => f.level === 'error')
