// Reading test names out of source (shared by the coverage test and the page-only list test): every name is a string
// literal, so a name can be read without running the test.
import { ROW_ID } from './surfaces.mjs'

const CALL = /(?<![.\w$])(test|it|describe)(?:\.(skip|todo|only))?\s*\(\s*/g
const lineOf = (text, i) => text.slice(0, i).split('\n').length

// Index just past the `)` that closes the call whose `(` is at `open`; text.length if it never closes (then the whole
// rest of the file counts as inside, which is the cautious reading). Skips strings, template literals and comments.
// A regex literal holding a quote or bracket can fool it, which fails toward "skipped", never toward "covered".
function endOfCall(text, open) {
  const skipString = (i, q) => {
    for (i++; i < text.length && text[i] !== q; i++) {
      if (text[i] === '\\') i++
      else if (q === '`' && text[i] === '$' && text[i + 1] === '{') i = skipBraces(i + 1)
    }
    return i
  }
  const skipBraces = (i) => {
    let d = 0
    for (; i < text.length; i++) {
      const c = text[i]
      if (c === "'" || c === '"' || c === '`') i = skipString(i, c)
      else if (c === '/' && text[i + 1] === '/') i = text.indexOf('\n', i) === -1 ? text.length : text.indexOf('\n', i)
      else if (c === '/' && text[i + 1] === '*') i = text.indexOf('*/', i) === -1 ? text.length : text.indexOf('*/', i) + 1
      else if (c === '{') d++
      else if (c === '}' && --d === 0) return i
    }
    return i
  }
  let depth = 0
  for (let i = open; i < text.length; i++) {
    const c = text[i]
    if (c === "'" || c === '"' || c === '`') i = skipString(i, c)
    else if (c === '/' && text[i + 1] === '/') i = text.indexOf('\n', i) === -1 ? text.length : text.indexOf('\n', i)
    else if (c === '/' && text[i + 1] === '*') i = text.indexOf('*/', i) === -1 ? text.length : text.indexOf('*/', i) + 1
    else if (c === '(') depth++
    else if (c === ')' && --depth === 0) return i + 1
  }
  return text.length
}

// A test body whose source calls <its context argument>.skip( or .todo( : a body-level skip cannot be known without
// running the test, so this is the cautious reading of the literal call. A comment or string does not count.
const SKIP_IN_BODY = (param) => new RegExp(`(?<![.\\w$])${param}\\.(?:skip|todo)\\s*\\(`)
function bodySkips(call) {
  const body = call.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  const param = /^[^,]*,\s*(?:\{[^}]*\}\s*,\s*)?(?:async\s+)?(?:function\s*\w*\s*\(\s*(\w+)|\(\s*(\w+)|(\w+)\s*=>)/.exec(body)
  return SKIP_IN_BODY(param?.[1] || param?.[2] || param?.[3] || 't').test(body)
}

// `skip: process.platform === 'win32' && '<reason>'` skips on one platform only: the row is proven everywhere else, so it
// stays live. Any other expression (an env var, a probe) is read as skipped. Only the identifier process.platform may
// appear outside a quoted string.
function platformOnlySkip(options) {
  const m = /\bskip\s*:\s*([\s\S]*)$/.exec(options)
  if (!m || /\btodo\s*:/.test(options)) return false
  const bare = m[1].replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, '')
  const ids = bare.match(/[A-Za-z_$][\w$.]*/g) || []
  return ids.length > 0 && ids.every((id) => id === 'process.platform')
}

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
    const optionSkip = /\b(skip|todo)\s*:\s*(?!false\b)[^\s,}]/.test(options) && !platformOnlySkip(options)
    const open = m.index + m[0].indexOf('(')
    const end = endOfCall(text, open)
    const skipped = modifier === 'skip' || modifier === 'todo' || optionSkip
    tests.push({ kind, name, line, file, skipped, start: m.index, end, bodySkip: kind !== 'describe' && bodySkips(text.slice(open, end)) })
  }
  // a test inside a skipped or todo describe is skipped with it; a body calling t.skip( or t.todo( is read as skipped
  for (const t of tests) {
    const inSkippedDescribe = tests.some((d) => d.kind === 'describe' && d.skipped && d.start < t.start && t.start < d.end)
    t.skipped = t.skipped || inSkippedDescribe || t.bodySkip
    t.skipReason = t.skipped ? (inSkippedDescribe ? 'inside a skipped describe' : t.bodySkip ? 'calls skip or todo in its body' : 'skip or todo') : null
  }
  return { tests, problems }
}

export function rowIdsIn(name) {
  return [...name.matchAll(/\[([a-z]+:[^\]\s]+)\]/g)].map((m) => m[1]).filter((id) => ROW_ID.test(id))
}
