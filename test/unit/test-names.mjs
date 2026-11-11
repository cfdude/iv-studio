// Reading test names out of source (shared by the coverage test and the page-only list test): every name is a string
// literal, so a name can be read without running the test.
import { ROW_ID } from './surfaces.mjs'

const CALL = /(?<![.\w$])(test|it|describe)(?:\.(skip|todo|only))?\s*\(\s*/g
const lineOf = (text, i) => text.slice(0, i).split('\n').length

// The tests named in one file's source: [{ kind, name, line, skipped }] and the names that are not literals.
export function scanTestNames(text, file) {
  const tests = []
  const problems = []
  for (const m of text.matchAll(CALL)) {
    const lineStart = text.lastIndexOf('\n', m.index) + 1
    if (text.slice(lineStart, m.index).includes('//')) continue // in a comment
    const [, kind, modifier] = m
    const line = lineOf(text, m.index)
    let i = m.index + m[0].length
    const q = text[i]
    let name = null
    if (q === "'" || q === '"' || q === '`') {
      let j = i + 1
      let value = ''
      while (j < text.length && text[j] !== q) {
        if (text[j] === '\\') (value += text[j + 1]), (j += 2)
        else (value += text[j]), j++
      }
      const after = text.slice(j + 1).match(/^\s*([,)])/)
      if (after && !(q === '`' && value.includes('${'))) name = value
    }
    if (name === null) {
      problems.push(`${file}:${line}: the name given to ${kind}( is not a string literal`)
      continue
    }
    const rest = text.slice(i + name.length + 3, i + name.length + 400)
    const options = /^\s*,?\s*\{([^}]*)\}\s*,/.exec(rest)?.[1] || ''
    const optionSkip = /\b(skip|todo)\s*:\s*(?!false\b)[^\s,}]/.test(options)
    tests.push({ kind, name, line, file, skipped: modifier === 'skip' || modifier === 'todo' || optionSkip })
  }
  return { tests, problems }
}

export function rowIdsIn(name) {
  return [...name.matchAll(/\[([a-z]+:[^\]\s]+)\]/g)].map((m) => m[1]).filter((id) => ROW_ID.test(id))
}
