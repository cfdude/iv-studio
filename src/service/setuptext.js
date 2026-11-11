// Cinematography phrases in an H3 prompt: added at the end of its description section, once, or taken out again.
// Pure, so the window (Create, Projects) and the service share it (filmcraft.js re-exports it).
// The prompt's description section: where [Shot 1]'s words are (base or reference format), else the whole text.
const BODY = /(^|\n)(\s*)(integrated_multimodal_description|detailed_description)\s*:/
const NEXT = /\n\s*\n?\s*(overall_soundscape|non_diegetic_music|subject_definitions|summary|retention_analysis)\s*:/
function bodyRange(prompt) {
  const m = BODY.exec(prompt)
  if (!m) {
    const n = NEXT.exec(prompt)
    return [0, n ? n.index : prompt.length]
  }
  const start = m.index + m[0].length
  const rest = prompt.slice(start)
  const n = NEXT.exec(rest)
  return [start, start + (n ? n.index : rest.length)]
}
// Adds each snippet's sentence at the end of the description (once), or takes it out again.
export function withSetups(prompt, snippets) {
  let out = String(prompt || '')
  const add = snippets.map((s) => s.snippet || s).filter((t) => t && !out.includes(t))
  if (!add.length) return out
  if (!out.trim()) return add.join(' ')
  const [, end] = bodyRange(out)
  const head = out.slice(0, end).trimEnd()
  return `${head} ${add.join(' ')}${out.slice(end)}`
}
export function withoutSetups(prompt, snippets) {
  let out = String(prompt || '')
  for (const s of snippets) {
    const t = s.snippet || s
    if (t) out = out.replace(` ${t}`, '').replace(t, '')
  }
  return out.replace(/[ \t]{2,}/g, ' ')
}

