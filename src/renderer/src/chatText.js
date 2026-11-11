// The agent writes its replies in markdown. The chat shows the few marks it uses as formatting instead of raw
// asterisks: **bold**, *italic* / _italic_, `code`, "# heading" lines and "- " / "* " / "1. " list lines.
// Pure: returns a list of lines, each a list of parts { t, b?, i?, code? }, with the line's kind. The chat turns
// them into React elements, so nothing the agent writes is ever read as HTML.

const INLINE = /(\*\*[^*\n]+?\*\*|__[^_\n]+?__|`[^`\n]+`|\*[^*\s\n][^*\n]*?\*|(?<![\w])_[^_\s\n][^_\n]*?_(?![\w]))/g

export function inlineParts(text) {
  const out = []
  let last = 0
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) out.push({ t: text.slice(last, m.index) })
    const s = m[0]
    if (s.startsWith('**') || s.startsWith('__')) out.push({ t: s.slice(2, -2), b: true })
    else if (s.startsWith('`')) out.push({ t: s.slice(1, -1), code: true })
    else out.push({ t: s.slice(1, -1), i: true })
    last = m.index + s.length
  }
  if (last < text.length) out.push({ t: text.slice(last) })
  return out
}

export function chatLines(text = '') {
  return String(text)
    .split('\n')
    .map((raw) => {
      let m
      if ((m = raw.match(/^\s{0,3}#{1,6}\s+(.*)$/))) return { kind: 'head', parts: inlineParts(m[1].replace(/\s*#+\s*$/, '')) }
      if ((m = raw.match(/^(\s*)[-*•]\s+(.*)$/))) return { kind: 'bullet', indent: m[1].length, mark: '•', parts: inlineParts(m[2]) }
      if ((m = raw.match(/^(\s*)(\d+[.)])\s+(.*)$/))) return { kind: 'bullet', indent: m[1].length, mark: m[2], parts: inlineParts(m[3]) }
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(raw)) return { kind: 'rule', parts: [] }
      return { kind: 'text', parts: inlineParts(raw) }
    })
}
