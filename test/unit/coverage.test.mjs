// Coverage is enforced (design D5): every surface row has a test whose name carries its id in square brackets
// (`test('[mcp:check_setup] reports an Apple GPU', …)`), or an entry in coverage-gaps.json saying why not.
// Names are read from source, so every test( / it( / describe( under test/unit and test/ui must be named with a
// string literal. A skipped or todo test does not count, and a gap that a live test now covers is stale.
//   node --test test/unit/coverage.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { ROW_ID, surfaces } from './surfaces.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

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

// Everything that is wrong, as readable lines. rows: [{ id }]; scanned: [{ tests, problems }]; gaps: { id: reason }.
export function coverageProblems({ rows, scanned, gaps }) {
  const problems = scanned.flatMap((s) => s.problems)
  const covered = new Set()
  for (const { tests } of scanned) for (const t of tests) if (t.kind !== 'describe' && !t.skipped) for (const id of rowIdsIn(t.name)) covered.add(id)
  const known = new Set(rows.map((r) => r.id))
  for (const r of rows) if (!covered.has(r.id) && !(r.id in gaps)) problems.push(`${r.id} has no test and no gaps entry`)
  for (const [id, reason] of Object.entries(gaps)) {
    if (!known.has(id)) problems.push(`gaps entry ${id} names no surface row`)
    else if (covered.has(id)) problems.push(`gaps entry ${id} is stale: a test now covers it`)
    if (!String(reason || '').trim()) problems.push(`gaps entry ${id} has no reason`)
  }
  return problems
}

function* testFiles() {
  for (const dir of ['test/unit', 'test/ui']) {
    const full = path.join(root, dir)
    if (!fs.existsSync(full)) continue
    for (const f of fs.readdirSync(full)) if (/\.test\.mjs$/.test(f)) yield path.join(full, f)
  }
}

describe('coverage is enforced', () => {
  test('every surface has a tagged test or a gaps entry, and no gap is stale', async () => {
    const { rows } = await surfaces(root)
    const gaps = JSON.parse(fs.readFileSync(path.join(root, 'test/unit/coverage-gaps.json'), 'utf8'))
    const scanned = [...testFiles()].map((f) => scanTestNames(fs.readFileSync(f, 'utf8'), path.relative(root, f)))
    assert.deepEqual(coverageProblems({ rows, scanned, gaps }), [])
  })

  const rows = [{ id: 'mcp:a' }, { id: 'ipc:b:c' }]
  const scan = (text) => [scanTestNames(text, 'fixture.test.mjs')]

  test('removing a gap entry fails, naming the id', () => {
    const p = coverageProblems({ rows, scanned: scan("test('[mcp:a] works', () => {})"), gaps: {} })
    assert.deepEqual(p, ['ipc:b:c has no test and no gaps entry'])
  })

  test('a fixture whose only tagged test is test.skip fails, naming the id', () => {
    const p = coverageProblems({ rows: [{ id: 'mcp:a' }], scanned: scan("test.skip('[mcp:a] later', () => {})"), gaps: {} })
    assert.deepEqual(p, ['mcp:a has no test and no gaps entry'])
  })

  test('test.todo and a skip or todo option do not count either', () => {
    const text = "test.todo('[mcp:a] x')\ntest('[mcp:a] y', { skip: true }, () => {})\ntest('[mcp:a] z', { todo: 'soon' }, () => {})"
    assert.equal(coverageProblems({ rows: [{ id: 'mcp:a' }], scanned: scan(text), gaps: {} }).length, 1)
    assert.equal(coverageProblems({ rows: [{ id: 'mcp:a' }], scanned: scan("test('[mcp:a] ok', { skip: false }, () => {})"), gaps: {} }).length, 0)
  })

  test('a gaps entry for a row a live test names fails, naming the row', () => {
    const p = coverageProblems({ rows: [{ id: 'mcp:a' }], scanned: scan("test('[mcp:a] works', () => {})"), gaps: { 'mcp:a': 'pending 5.2' } })
    assert.deepEqual(p, ['gaps entry mcp:a is stale: a test now covers it'])
  })

  test('a gaps entry naming no row, or with no reason, fails', () => {
    const p = coverageProblems({ rows: [{ id: 'mcp:a' }], scanned: scan(''), gaps: { 'mcp:a': '', 'mcp:gone': 'pending 5.2' } })
    assert.deepEqual(p, ['gaps entry mcp:a has no reason', 'gaps entry mcp:gone names no surface row'])
  })

  test('a test named by a variable fails, naming its file and line', () => {
    const p = coverageProblems({ rows: [], scanned: scan("const n = 'x'\ntest(n, () => {})\ntest(`a ${n}`, () => {})\ndescribe('d' + n, () => {})"), gaps: {} })
    assert.equal(p.length, 3)
    assert.match(p[0], /^fixture\.test\.mjs:2: the name given to test\( is not a string literal$/)
    assert.match(p[1], /fixture\.test\.mjs:3/)
    assert.match(p[2], /fixture\.test\.mjs:4.*describe/)
  })

  test('literal names, template names with no substitution, comments and subtests are fine', () => {
    const text = "// test(name, f)\ntest(`plain`, () => {})\ntest(\"two\", async (t) => { await t.test(`${x}`, () => {}) })"
    const s = scanTestNames(text, 'f.mjs')
    assert.deepEqual(s.problems, [])
    assert.deepEqual(s.tests.map((t) => t.name), ['plain', 'two'])
  })
})
