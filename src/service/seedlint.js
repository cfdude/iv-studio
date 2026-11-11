// The prompt checker for Seedance 2.5 shots (lint.js is H3's). Pure, so the window runs it on every keystroke.
// Seedance doesn't infer what a reference is for, so every attached reference should be named (@image1, @video1,
// @audio1, in attach order) and given a role; H3's markup (<d>, <Picture 1>, field names) means nothing to it.
//   lintSeedance(prompt, { mode, seconds, refs: { pictures, videos, audios }, auto }) -> [{ level, code, message, fix? }]
// auto: tags IV Studio writes a role line for itself when the prompt doesn't (a character's face, a voice line).

const H3_FIELDS = /\b(integrated_multimodal_description|detailed_description|subject_definitions|retention_analysis|overall_soundscape|non_diegetic_music)\s*:/i

// H3's tags in Seedance form: <Picture 2> -> @image2, <Video 1> -> @video1, <Audio 1> -> @audio1; <d>[English] hi</d> -> "hi".
export function toSeedanceTags(text) {
  return String(text || '')
    .replace(/<Picture (\d+)>/g, '@image$1')
    .replace(/<Video (\d+)>/g, '@video$1')
    .replace(/<Audio (\d+)>/g, '@audio$1')
    .replace(/<d>\s*(?:\[[^\]]*\])?\s*([^<]*)<\/d>/g, '"$1"')
}

export function lintSeedance(prompt, { mode = 'text', seconds = 5, refs = {}, auto = [] } = {}) {
  const text = String(prompt || '')
  const out = []
  if (!text.trim()) return [{ level: 'error', code: 'empty', message: 'Write what happens first.' }]
  const counts = { image: (refs.pictures || []).length, video: (refs.videos || []).length, audio: (refs.audios || []).length }

  if (/<Picture \d+>|<Video \d+>|<Audio \d+>|<d>/.test(text)) {
    out.push({ level: 'error', code: 'h3-tags', message: 'This uses H3’s tags (<Picture 1>, <d>…</d>). Seedance names references @image1, @video1, @audio1 and puts spoken lines in quotes.', fix: toSeedanceTags(text) })
  }
  if (H3_FIELDS.test(text)) out.push({ level: 'warning', code: 'h3-fields', message: 'H3’s field names (detailed_description:, overall_soundscape: …) mean nothing to Seedance. Plain sentences work best.' })
  if (/\{char\}/.test(text)) out.push({ level: 'info', code: 'char', message: '{char} becomes the character’s first name when it renders.' })

  // named but not attached, and attached but never named
  for (const [kind, n] of Object.entries(counts)) {
    const named = [...new Set([...text.matchAll(new RegExp(`@${kind}_?(\\d+)\\b`, 'gi'))].map((m) => Number(m[1])))]
    for (const k of named.filter((k) => k > n)) out.push({ level: 'error', code: 'ref-missing', message: `@${kind}${k} is named, but only ${n} ${kind === 'image' ? 'picture' : kind}${n === 1 ? ' is' : 's are'} attached.` })
    const unnamed = Array.from({ length: n }, (_, i) => i + 1).filter((k) => !named.includes(k) && !auto.includes(`@${kind}${k}`))
    if (unnamed.length && !(mode === 'frames' && kind === 'image')) {
      out.push({ level: 'warning', code: 'ref-unused', message: `${unnamed.map((k) => `@${kind}${k}`).join(', ')} ${unnamed.length > 1 ? 'are' : 'is'} attached but never named. Seedance doesn’t guess what a reference is for: say what to take from it (and what not).` })
    }
  }

  // timestamps past the end
  const stamps = [...text.matchAll(/\[?(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)\s*s(?:ec(?:onds?)?)?\]?/gi)].map((m) => Number(m[2]))
  const late = stamps.filter((t) => t > seconds + 0.01)
  if (late.length) out.push({ level: 'warning', code: 'time-late', message: `A timestamp runs to ${Math.max(...late)} s, past the shot’s ${seconds} s.` })

  if (mode === 'continue' && !/\b(extend|continue|carr(y|ies) on)\b/i.test(text)) {
    out.push({ level: 'warning', code: 'extend-word', message: 'Continue mode: say “continue” or “extend forward” so Seedance treats it as carrying the clip on.' })
  }
  const words = text.split(/\s+/).filter(Boolean).length
  if (words < 12) out.push({ level: 'warning', code: 'thin', message: 'Very short. Seedance does what it’s told and little more: say who, what happens, where, the camera and the sound.' })
  return out
}
