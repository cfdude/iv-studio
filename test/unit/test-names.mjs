// Reading test names out of source (shared by the coverage test and the page-only list test): every name is a string
// literal, so a name can be read without running the test.
import { ROW_ID } from './surfaces.mjs'

const CALL = /(?<![.\w$])(test|it|describe)(?:\.(skip|todo|only))?\s*\(\s*/g
const lineOf = (text, i) => text.slice(0, i).split('\n').length

const skipString = (text, i, q) => {
  for (i++; i < text.length && text[i] !== q; i++) {
    if (text[i] === '\\') i++
    else if (q === '`' && text[i] === '$' && text[i + 1] === '{') i = skipBraces(text, i + 1)
  }
  return i
}
// Index of the `}` that closes the `{` at `i` (text.length if none), skipping strings, templates and comments.
const skipBraces = (text, i) => {
  let d = 0
  for (; i < text.length; i++) {
    const c = text[i]
    if (c === "'" || c === '"' || c === '`') i = skipString(text, i, c)
    else if (c === '/' && text[i + 1] === '/') i = text.indexOf('\n', i) === -1 ? text.length : text.indexOf('\n', i)
    else if (c === '/' && text[i + 1] === '*') i = text.indexOf('*/', i) === -1 ? text.length : text.indexOf('*/', i) + 1
    else if (c === '{') d++
    else if (c === '}' && --d === 0) return i
  }
  return i
}

// Index just past the `)` that closes the call whose `(` is at `open`; text.length if it never closes (then the whole
// rest of the file counts as inside, which is the cautious reading). Skips strings, template literals and comments.
// A regex literal holding a quote or bracket can fool it, which fails toward "skipped", never toward "covered".
function endOfCall(text, open) {
  let depth = 0
  for (let i = open; i < text.length; i++) {
    const c = text[i]
    if (c === "'" || c === '"' || c === '`') i = skipString(text, i, c)
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

// The options object after a test name: its top-level `key: value` entries, split with brace matching that skips
// strings and templates, so a `}` inside a value cannot end it early. {} when there is no options object.
function readOptions(text, from) {
  const m = /^\s*,\s*\{/.exec(text.slice(from, from + 200))
  if (!m) return {}
  const open = from + m[0].length - 1
  const close = skipBraces(text, open)
  const body = text.slice(open + 1, close)
  const out = {}
  let depth = 0
  let start = 0
  const flush = (end) => {
    const e = /^\s*([A-Za-z_$][\w$]*)\s*:\s*([\s\S]*?)\s*$/.exec(body.slice(start, end))
    if (e) out[e[1]] = e[2]
  }
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (c === "'" || c === '"' || c === '`') i = skipString(body, i, c)
    else if ('{(['.includes(c)) depth++
    else if ('})]'.includes(c)) depth--
    else if (c === ',' && depth === 0) (flush(i), (start = i + 1))
  }
  flush(body.length)
  return out
}

// Only the exact form `process.platform === 'win32' && '<literal reason>'` is live: it skips on one platform, so the row
// is proven everywhere else. Every other skip or todo value (true, a reason string, a variable, !==, darwin, an env probe)
// is read as skipped; `false` is not a skip.
const PLATFORM_ONLY = /^process\.platform\s*===\s*'win32'\s*&&\s*(?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")$/
const optionsSkip = (options) => ['skip', 'todo'].some((k) => k in options && options[k] !== 'false' && !(k === 'skip' && PLATFORM_ONLY.test(options[k])))

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
    const optionSkip = optionsSkip(readOptions(text, i + name.length + 2))
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
