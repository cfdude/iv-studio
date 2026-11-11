// Writes Seedance 2.5 prompts from a plain-words idea, with the same writers as H3 shots (the local model in
// Ollama, or the person's Claude Code or Codex), following IV Studio's bundled Seedance guide
// (resources/guides/seedance25: Matthew Hollis's playbook distilled from ByteDance/Dreamina's public guides).
// Claude Code and Codex get the whole guide; the local 8B model gets the core rules below.
import fs from 'node:fs'
import path from 'node:path'
import { harnessJson } from './harness.js'
import { jpegOf, localChat, localWriterModel } from './prompter.js'
import { lintSeedance, toSeedanceTags } from './seedlint.js'

export const GUIDE_FILES = ['guide.md', 'task-templates.md', 'craft.md', 'transitions.md', 'limits.md']

export function loadSeedanceGuide(resourcesDir) {
  const dir = path.join(resourcesDir, 'guides', 'seedance25')
  return GUIDE_FILES.map((f) => {
    try {
      return `----- ${f} -----\n${fs.readFileSync(path.join(dir, f), 'utf8')}`
    } catch {
      return ''
    }
  })
    .filter(Boolean)
    .join('\n\n')
}

// The core of the guide, short enough for a small local model.
export const CORE_RULES = `Seedance 2.5 executes what is written, literally. Under-specified prompts fail, not the model.
- Formula: Subject + Action/Event + Scene & Environment + Visual Style + Camera Movement + Audio. Plain sentences, no field names.
- Every attached reference gets one line giving its role AND an exclusion, e.g. "@image1 defines Mara's face, hair and clothing. Do not use the image background." or "@video1 defines the camera path only. Do not use its people or place." or "@audio1 is Mara's voice."
- Bind each person, prop and place to its own reference, one line each. Never "@image1 to @image3 are the characters".
- One main change per stage. For anything longer than about 6 seconds, use stages or one-second ranges ("0-3 seconds: … End state: …"), consecutive and within the shot's length, each ending on a visible end state.
- Translate feelings into visible cues ("her shoulders drop, she looks at the floor"), and name the camera move plainly ("slow push in", "handheld, gentle sway").
- Spoken lines: name the language and the speaker, then the words in double quotes: Dialogue language: American English. Mara says quietly: "I thought you weren't coming." Short lines, few per shot.
- Hold consistency: number of people, clothing, who holds what, screen direction. Keep each subject one continuous instance.
- Control cutting: say "one continuous take" or name each cut. End with what you don't want, e.g. "No subtitles, no on-screen text, no background music."`

const MODE_RULES = {
  text: 'Text to video: no references unless listed below. Describe the people fully (age, build, hair, clothes).',
  reference: 'Reference to video: a NEW scene. A person’s picture gives the person, not their background; the idea gives the place unless a picture of a place is given for it.',
  frames: 'First / last frame: @image1 is the exact first frame (the video opens on it); @image2, if given, is the exact last frame. Describe the motion between them and say the first line plainly: "The input images are the first and last frames: @image1 … @image2 …".',
  continue: 'Extend: @video1 is the clip to carry on. Start with "Extend @video1 forward:" then describe only the new seconds, picking up exactly where the clip ends (same people, place, light, motion trend and sound).'
}

const SCHEMA = {
  type: 'object',
  properties: {
    direction: { type: 'string', description: 'One or two sentences: what the shot is for and where everyone is on screen. Not part of the prompt.' },
    prompt: { type: 'string', description: 'The whole Seedance 2.5 prompt.' }
  },
  required: ['direction', 'prompt'],
  additionalProperties: false
}

// labels: [{ tag, what, file, at? }] for every reference, in attach order.
export function referenceLabels({ mode, media = [], face = null, character = null, voiceLine = null }) {
  const out = []
  const n = { picture: 0, video: 0, audio: 0 }
  const who = character?.name?.split(/\s+/)[0]
  for (const m of media) {
    if (!(m.kind in n)) continue
    const k = ++n[m.kind]
    const file = m.file || m.path
    const tag = `@${m.kind === 'picture' ? 'image' : m.kind}${k}`
    const what = mode === 'frames' && m.kind === 'picture' ? (k === 1 ? 'the first frame' : 'the last frame') : mode === 'continue' && m.kind === 'video' ? 'the clip to carry on' : `the person's ${m.kind}`
    out.push({ tag, kind: m.kind, what, file })
  }
  if (face && mode !== 'frames') out.push({ tag: `@image${++n.picture}`, kind: 'picture', what: `${who || 'the character'}'s face (a portrait of them)`, file: face })
  if (voiceLine && mode !== 'frames') out.push({ tag: `@audio${++n.audio}`, kind: 'audio', what: `${who || 'the character'}'s voice line: the words they say, in their voice`, file: voiceLine })
  return out
}

export function seedanceSystem({ mode = 'text', seconds = 5, character = null, labels = [], full = null }) {
  const who = character?.name?.split(/\s+/)[0]
  return [
    'You write prompts for ByteDance Seedance 2.5 video generation. Answer with JSON: { direction, prompt }.',
    full ? `IV Studio's Seedance 2.5 guide (follow it; write references as @image1, @video1, @audio1, not "@Image 1"):\n\n${full}` : CORE_RULES,
    `This shot: ${seconds} seconds. ${MODE_RULES[mode] || MODE_RULES.text} Size and length are set outside the prompt: don't write them.`,
    labels.length ? `Attached references, in order (name each one in the prompt with its role and exclusion):\n${labels.map((l) => `${l.tag}: ${l.what}`).join('\n')}` : 'No references are attached: do not write @image, @video or @audio.',
    who ? `The character is ${who}: write their name, never "{char}". ${labels.some((l) => /face/.test(l.what)) ? 'Their face comes from their reference; describe their clothes and actions, not their face.' : ''}` : '',
    'Write in English. No markdown, no headings, no notes to the reader.'
  ]
    .filter(Boolean)
    .join('\n\n')
}

async function shown(labels) {
  const out = []
  for (const l of labels) {
    if (!l.file || !fs.existsSync(l.file) || l.kind === 'audio') continue
    try {
      out.push({ label: `${l.tag} (${l.what})`, data: await jpegOf({ file: l.file, at: l.kind === 'video' ? (l.what.includes('carry on') ? 'end' : 0.3) : undefined }) })
    } catch {}
    if (out.length >= 6) break
  }
  return out
}

const parse = (text) => {
  try {
    return JSON.parse(String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, ''))
  } catch {
    throw new Error('The writer returned something unreadable. Try again.')
  }
}

// { engine: local | claude | codex, model, idea, mode, seconds, character, face, media, voiceLine, resourcesDir, cpu }
// -> the prompt. One more try when the checker finds an error in the first draft.
export async function writeSeedance({ engine = 'local', model, idea, mode = 'text', seconds = 5, character = null, face = null, media = [], voiceLine = null, resourcesDir, cpu = false }) {
  if (!idea?.trim()) throw new Error('Describe the idea first.')
  const labels = referenceLabels({ mode, media, face, character, voiceLine })
  const full = engine === 'local' ? null : loadSeedanceGuide(resourcesDir)
  const system = seedanceSystem({ mode, seconds, character, labels, full })
  const pictures = await shown(labels)
  const look = pictures.length ? `\n\nThe images ${engine === 'claude' ? 'in your working folder' : 'attached'} show the references, in this order:\n${pictures.map((p, i) => `Image ${i + 1}: ${p.label}`).join('\n')}\nWrite what you actually see (people, clothes, objects, place) into their reference lines.${engine === 'claude' ? ' Open each with the Read tool first.' : ''}` : ''
  const user = `Idea: ${idea.replace(/\{char\}/g, character?.name?.split(/\s+/)[0] || 'the person')}${look}\n\nAnswer with the JSON object only.`
  const refs = { pictures: labels.filter((l) => l.kind === 'picture'), videos: labels.filter((l) => l.kind === 'video'), audios: labels.filter((l) => l.kind === 'audio') }

  let ask
  if (engine === 'claude' || engine === 'codex') {
    const images = pictures.map((p, i) => ({ ...p, name: `reference-${i + 1}.jpg` }))
    ask = (extra = '') => harnessJson({ engine, model, system, user: user + extra, schema: SCHEMA, images })
  } else {
    const info = await localWriterModel(model)
    ask = async (extra = '') => {
      const message = { role: 'user', content: user + extra, ...(info.vision && pictures.length ? { images: pictures.map((p) => p.data) } : {}) }
      return parse(await localChat({ model: info.name, system, messages: [message], schema: SCHEMA, temperature: 0.6, ctx: 12288, maxTokens: 3000, cpu, raw: true }))
    }
  }
  const clean = (p) => toSeedanceTags(String(p || '').trim()).replace(/\{char\}/g, character?.name?.split(/\s+/)[0] || 'the person')
  let prompt = clean((await ask()).prompt)
  const errors = lintSeedance(prompt, { mode, seconds, refs }).filter((f) => f.level === 'error' || f.code === 'ref-unused')
  if (errors.length) {
    try {
      const again = clean((await ask(`\n\nYour previous prompt:\n${prompt}\n\nFix these and answer again:\n${errors.map((e) => `- ${e.message}`).join('\n')}`)).prompt)
      if (lintSeedance(again, { mode, seconds, refs }).filter((f) => f.level === 'error').length <= errors.filter((e) => e.level === 'error').length) prompt = again
    } catch {}
  }
  return prompt
}
