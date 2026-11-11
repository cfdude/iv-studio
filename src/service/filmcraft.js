// Film craft for prompts and Projects, after Slate, the prompt studio for AI filmmaking, by Sam Wasserman
// (wassermanproductions.com, Apache-2.0), as built into Imagination Studio:
//   - the writer the person chose in Settings (askWriter) for every job below, and for Projects' script and plans;
//   - the Cinematography picker: Slate's 165 setups (film stocks, lenses, lighting, rigs, moods...) as phrases added
//     to a prompt (resources/slate/setups.json, unchanged);
//   - coverage plans: Slate's twelve ways to cover a scene, which the storyboard planner follows shot for shot
//     (resources/slate/coverage-plans.json, unchanged);
//   - a film's shot list as Markdown or CSV;
//   - prompt tools: a director's note, Tighten, Enrich, Distill, Shot, Angle, and three Variants, each keeping the
//     H3 prompt's sections, spoken lines and labels;
//   - a continuity check across a scene's shot prompts, like a script supervisor;
//   - a Lookbook: a film, director or cinematographer turned into look language with no names in it.
// The wording of the tools is IV Studio's own, written for MiniMax H3's sectioned prompts; the ideas are Slate's.
import fs from 'node:fs'
import path from 'node:path'
import { harnessJson } from './harness.js'
import { ollamaJson } from './prompter.js'

// ---------- the writer ----------
// writer: { engine, model } from writerOf (paths.js). Claude Code and Codex answer through harness.js; anything else
// (the local writer in Ollama or on an OpenAI-compatible server; Context IR, which only writes H3 prompts) through
// the local writer. Returns the parsed JSON object of `schema`'s shape.
export async function askWriter(writer, { system, user, schema, cpu = false, temperature = 0.5, ctx = 16384, timeoutMs = 600000 }) {
  const w = writer || { engine: 'local' }
  if (w.engine === 'claude' || w.engine === 'codex') return harnessJson({ engine: w.engine, model: w.model, system, user: `${user}\n\nAnswer with the JSON object only.`, schema, timeoutMs })
  return ollamaJson({ system, user, schema, model: w.engine === 'local' ? w.model || undefined : undefined, cpu, temperature, ctx })
}
export const writerName = (w) => ({ claude: 'Claude Code', codex: 'Codex' })[w?.engine] || (w?.provider === 'openai' ? 'the OpenAI-compatible writer' : 'the local writer')

// ---------- Slate's data ----------
const cache = new Map()
export function loadSlate(resourcesDir) {
  if (cache.has(resourcesDir)) return cache.get(resourcesDir)
  const read = (f) => JSON.parse(fs.readFileSync(path.join(resourcesDir, 'slate', f), 'utf8'))
  const setups = read('setups.json').categories.map((c) => ({ id: c.id, label: c.label || c.id, items: (c.setups || c.items || []).map((s) => ({ id: s.id, label: s.label, snippet: s.snippet, section: s.section || 'style', tags: s.tags || [] })) }))
  const plans = read('coverage-plans.json').plans.map((p) => ({ id: p.id, label: p.label, group: p.group, description: p.description, shots: p.shots }))
  const out = { setups, plans, byId: new Map(setups.flatMap((c) => c.items.map((s) => [s.id, { ...s, category: c.id }]))) }
  cache.set(resourcesDir, out)
  return out
}

// The snippets of the chosen setups, in the order chosen; unknown ids are dropped.
export const setupSnippets = (slate, ids = []) => ids.map((id) => slate.byId.get(id)).filter(Boolean)

export { withSetups, withoutSetups } from './setuptext.js'

// ---------- coverage ----------
// The planner's instruction for a scene covered with this plan: exactly these shots, in this order.
export function coverageRules(plan, { people = [] } = {}) {
  if (!plan) return ''
  const who = people.length >= 2 ? ` "A" is ${people[0]} and "B" is ${people[1]}.` : ''
  return [
    `COVERAGE: cover this scene with the "${plan.label}" plan: exactly ${plan.shots.length} shots, in this order, one per slot.${who}`,
    ...plan.shots.map((s, i) => `${i + 1}. ${s.slot}: ${s.size}, ${s.angle}, ${s.movement}. Why: ${s.intent} How: ${s.promptGuidance}`),
    'Each shot still follows every rule above: spoken lines word for word in the shot where they fall, staging by screen side, and how it ends. Put the slot\'s size, angle and movement in camera.'
  ].join('\n')
}

// ---------- shot list ----------
const csvCell = (v) => {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
function rows(p) {
  const out = []
  p.scenes.forEach((sc, i) =>
    sc.shots.forEach((sh, j) =>
      out.push({
        scene: i + 1,
        heading: sc.heading || sc.name || `Scene ${i + 1}`,
        shot: `${i + 1}.${j + 1}`,
        seconds: sh.seconds,
        camera: sh.camera || '',
        action: sh.action || '',
        staging: sh.staging || '',
        characters: (sh.characters || []).join(', '),
        speaker: sh.speaker || '',
        line: sh.line || '',
        ends: sh.ends || '',
        coverage: sh.slot || '',
        status: sh.finished ? 'finished' : sh.takes?.length || sh.projectId ? 'filmed' : sh.prompt ? 'written' : 'planned',
        prompt: sh.prompt || ''
      })
    )
  )
  return out
}
export const SHOT_LIST_COLUMNS = ['scene', 'heading', 'shot', 'seconds', 'camera', 'action', 'staging', 'characters', 'speaker', 'line', 'ends', 'coverage', 'status', 'prompt']
export function shotListCsv(p, { prompts = true } = {}) {
  const cols = SHOT_LIST_COLUMNS.filter((c) => prompts || c !== 'prompt')
  return [cols.join(','), ...rows(p).map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\r\n') + '\r\n'
}
export function shotListMarkdown(p, { prompts = false } = {}) {
  const total = rows(p).reduce((n, r) => n + (Number(r.seconds) || 0), 0)
  const lines = [`# ${p.name || 'Untitled film'}: shot list`, '', p.logline ? `${p.logline}\n` : '', `${p.scenes.length} scenes, ${rows(p).length} shots, about ${Math.round(total)} s. ${p.aspect || ''}`.trim(), '']
  p.scenes.forEach((sc, i) => {
    lines.push(`## ${i + 1}. ${sc.heading || sc.name || `Scene ${i + 1}`}`, '')
    if (sc.coverage) lines.push(`Coverage: ${sc.coverage}`, '')
    lines.push('| Shot | s | Camera | Action | Line |', '|---|---|---|---|---|')
    sc.shots.forEach((sh, j) => {
      const cell = (t) => String(t || '').replace(/\|/g, '\\|').replace(/\n/g, ' ')
      lines.push(`| ${i + 1}.${j + 1}${sh.slot ? ` ${cell(sh.slot)}` : ''} | ${sh.seconds} | ${cell(sh.camera)} | ${cell(sh.action)} | ${sh.line ? `${cell(sh.speaker)}: "${cell(sh.line)}"` : ''} |`)
    })
    if (prompts) sc.shots.forEach((sh, j) => sh.prompt && lines.push('', `### ${i + 1}.${j + 1} prompt`, '', '```', sh.prompt, '```'))
    lines.push('')
  })
  return lines.filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n')
}

// ---------- prompt tools ----------
const KEEP = `Rules that always hold:
- Keep the prompt's section names and order exactly (integrated_multimodal_description / detailed_description, overall_soundscape, non_diegetic_music, subject_definitions, summary, retention_analysis: whichever it has) and its [Shot N] labels and cut times.
- Keep every spoken line inside <d>...</d> word for word, with its speaker and language tag.
- Keep {char}, <Picture N>, <Video N>, <Audio N>, <Subject N> and <RefMod N> exactly as written.
- MiniMax H3 has no negative prompt: every word is something it shows. Describe what is there, not what isn't.
- Write plain, concrete, physical English: what the camera sees and hears. No names of real films, directors or cinematographers.`
export const PROMPT_TOOLS = {
  tighten: { label: 'Tighten', what: 'Shorter by about a third', task: 'Shorten this prompt by about a third. Cut repetition and weak modifiers first. Keep every concrete visual and sound fact.' },
  enrich: { label: 'Enrich', what: 'More cinematography', task: 'Deepen this prompt with specific cinematography: lens behaviour, light quality and direction, texture, atmosphere, how the camera moves. Keep its intent, subject and action. Enrich, do not pad.' },
  distill: { label: 'Distill', what: 'Just the essentials', task: 'Strip this prompt to its strongest core: the fewest words that still carry every critical visual and sound fact.' },
  shot: { label: 'Stronger shot', what: 'Clearer framing and blocking', task: 'Make this a stronger, more intentional shot: clarify the shot size, what is in the frame and where, and the blocking (who is where by screen side and where they move). Leave the rest alone unless it contradicts the new framing.' },
  angle: { label: 'New angle', what: 'A more dramatic camera angle', task: 'Choose a more dramatic camera angle and perspective for this shot and rewrite the camera and framing to match. Keep the subject, action, place and continuity identical.' }
}
const PROMPT_SCHEMA = { type: 'object', properties: { prompt: { type: 'string' }, reply: { type: 'string' } }, required: ['prompt', 'reply'] }
const contextLines = (c = {}) =>
  [c.film && `Film: ${c.film}`, c.scene && `Scene: ${c.scene}`, c.look && `Look: ${c.look}`, c.spec && `Shot: ${c.spec}`, c.keep?.length ? `Keep these words exactly as they are: ${c.keep.map((k) => `"${k}"`).join('; ')}` : ''].filter(Boolean).join('\n')

// tool: one of PROMPT_TOOLS, or 'note' with the director's note. Returns { prompt, reply, missing } (missing: kept
// words or spoken lines the rewrite dropped; the caller decides).
export async function rewritePrompt(writer, { prompt, tool = 'note', note = '', context = {}, cpu = false }) {
  const text = String(prompt || '').trim()
  if (!text) throw new Error('Write or generate the prompt first.')
  const t = tool === 'note' ? null : PROMPT_TOOLS[tool]
  if (!t && !note.trim()) throw new Error('Write the note first.')
  const task = t ? t.task : `The director gives this note: "${note.trim()}". Change the prompt so it does exactly what the note asks and nothing else. If the note is a question, answer it in reply and give the prompt back unchanged.`
  const system = `You are a sharp, experienced director's collaborator who edits MiniMax H3 video prompts.\n${KEEP}\nAnswer as JSON: "prompt" is the whole new prompt, ready to render; "reply" is one or two sentences on what you changed (or your answer).`
  const user = [contextLines(context), `TASK: ${task}`, '', 'THE PROMPT:', text].filter((l) => l !== undefined).join('\n')
  const out = await askWriter(writer, { system, user, schema: PROMPT_SCHEMA, cpu, temperature: 0.4 })
  const next = String(out?.prompt || '').trim()
  if (!next) throw new Error('The writer gave nothing back. Try again.')
  return { prompt: next, reply: String(out?.reply || '').trim(), missing: dropped(text, next, context.keep) }
}
// Spoken lines and kept words in the old prompt that the new one lost.
export function dropped(before, after, keep = []) {
  const lines = (s) => [...String(s).matchAll(/<d>([\s\S]*?)<\/d>/g)].map((m) => m[1].trim())
  const lost = lines(before).filter((l) => !after.includes(l)).map((l) => `<d>${l}</d>`)
  for (const k of keep || []) if (k && before.includes(k) && !after.includes(k)) lost.push(k)
  for (const tag of String(before).match(/\{char\}|<(Picture|Video|Audio|Subject|RefMod) \d+>/g) || []) if (!after.includes(tag) && !lost.includes(tag)) lost.push(tag)
  return lost
}

const VARIANTS_SCHEMA = { type: 'object', properties: { variants: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'object', properties: { label: { type: 'string' }, prompt: { type: 'string' } }, required: ['label', 'prompt'] } } }, required: ['variants'] }
// Three versions of a prompt, each weighting the shot differently (composition, light, motion or mood). Same subject,
// action, lines and continuity. Returns [{ label, prompt, missing }].
export async function promptVariants(writer, { prompt, context = {}, cpu = false }) {
  const text = String(prompt || '').trim()
  if (!text) throw new Error('Write or generate the prompt first.')
  const system = `You write MiniMax H3 video prompts.\n${KEEP}\nAnswer as JSON: {"variants":[{"label":"2 to 4 words","prompt":"the whole prompt"}]} with exactly three variants.`
  const user = [contextLines(context), 'TASK: Write three distinct versions of this prompt, each weighting the shot differently: one composition-forward, one light-forward, one motion-forward (or mood-forward when the shot barely moves). Same subject, action, spoken lines, place and continuity; different emphasis and language.', '', 'THE PROMPT:', text].join('\n')
  const out = await askWriter(writer, { system, user, schema: VARIANTS_SCHEMA, cpu, temperature: 0.7 })
  const list = (out?.variants || []).map((v) => ({ label: String(v.label || 'Variant').trim().slice(0, 40), prompt: String(v.prompt || '').trim() })).filter((v) => v.prompt)
  if (!list.length) throw new Error('The writer gave no variants back. Try again.')
  return list.map((v) => ({ ...v, missing: dropped(text, v.prompt, context.keep) }))
}

// ---------- continuity ----------
const CONTINUITY_SCHEMA = { type: 'object', properties: { issues: { type: 'array', items: { type: 'object', properties: { severity: { type: 'string', enum: ['error', 'warn'] }, shots: { type: 'array', items: { type: 'string' } }, issue: { type: 'string' }, fix: { type: 'string' } }, required: ['severity', 'shots', 'issue', 'fix'] } } }, required: ['issues'] }
// shots: [{ name, prompt, action?, staging?, ends? }] in order. Returns [{ severity, shots: [names], issue, fix }].
export async function continuityCheck(writer, { scene = '', look = '', shots = [], cpu = false }) {
  const list = shots.filter((s) => String(s.prompt || s.action || '').trim())
  if (list.length < 2) throw new Error('A continuity check needs at least two shots with prompts.')
  const system = `You are a film's script supervisor. You read every shot prompt of one scene, in order, and find continuity mistakes between them: a person's look, hair, age or wardrobe that changes; props that appear, vanish or move between hands; the light, time of day or weather that changes; the place that changes; screen sides and eyelines that flip (someone on the left in one shot on the right in the next without moving); where one shot ends against where the next begins. Report only real mismatches, most serious first, each with a concrete fix (which words to change in which shot). "error" breaks the cut; "warn" is likely to be noticed. An empty list when it's clean.`
  const user = [scene && `Scene: ${scene}`, look && `Look: ${look}`, '', ...list.map((s) => `--- ${s.name} ---\n${[s.prompt || s.action, s.staging && `Staging: ${s.staging}`, s.ends && `Ends: ${s.ends}`].filter(Boolean).join('\n')}`)].filter((l) => typeof l === 'string').join('\n')
  const out = await askWriter(writer, { system, user, schema: CONTINUITY_SCHEMA, cpu, temperature: 0.2, ctx: 24576 })
  const names = new Set(list.map((s) => s.name))
  return (out?.issues || [])
    .map((i) => ({ severity: i.severity === 'error' ? 'error' : 'warn', shots: (i.shots || []).map(String).filter((n) => names.has(n) || /\d/.test(n)), issue: String(i.issue || '').trim(), fix: String(i.fix || '').trim() }))
    .filter((i) => i.issue)
}

// ---------- lookbook ----------
export const LOOK_FIELDS = [
  ['tone', 'Tone'],
  ['palette', 'Palette'],
  ['lighting', 'Lighting'],
  ['lens', 'Lens'],
  ['movement', 'Camera movement'],
  ['blocking', 'Blocking'],
  ['texture', 'Texture and grain']
]
const LOOK_SCHEMA = { type: 'object', properties: Object.fromEntries(LOOK_FIELDS.map(([k]) => [k, { type: 'string' }])), required: LOOK_FIELDS.map(([k]) => k) }
// source: a film, series, director or cinematographer, or a description ("rain-soaked 90s Hong Kong night").
// Returns { source, fields: { tone, palette, ... }, words } where words is one paragraph for prompts, with no names.
export async function lookbook(writer, { source, cpu = false }) {
  const s = String(source || '').trim()
  if (!s) throw new Error('Name a film, director or cinematographer, or describe the look.')
  const system = `You are a cinematographer. Study the visual style named or described and turn it into reusable look language for an AI video model: concrete, physical, photographable. Never name the film, series, person or studio in what you write: describe the look itself. Each field is one or two sentences. Answer as JSON with exactly these fields: ${LOOK_FIELDS.map(([k]) => k).join(', ')}.`
  const out = await askWriter(writer, { system, user: `The look: ${s}`, schema: LOOK_SCHEMA, cpu, temperature: 0.5 })
  const fields = Object.fromEntries(LOOK_FIELDS.map(([k]) => [k, String(out?.[k] || '').trim()]))
  const words = scrubNames(LOOK_FIELDS.map(([k]) => fields[k]).filter(Boolean).join(' '), s)
  if (!words) throw new Error('The writer gave no look back. Try again.')
  return { source: s, fields, words }
}
// The source's own name never goes into a prompt (H3 would try to draw it, and it's someone else's work).
export function scrubNames(text, source) {
  let out = String(text || '')
  const names = String(source || '')
    .split(/[,;/]| and /)
    .map((n) => n.trim())
    .filter((n) => n.length > 2 && /[A-Z]/.test(n))
  for (const n of names) out = out.replace(new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), 'the look')
  return out.replace(/\s{2,}/g, ' ').trim()
}
