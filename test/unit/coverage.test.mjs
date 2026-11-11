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
import { surfaces } from './surfaces.mjs'
import { rowIdsIn, scanTestNames } from './test-names.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

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

  // fixtures are built from pieces so this file's own source never holds a literal skip call in a test body
  const SKIP = ['skip', 'todo']
  const call = (obj, m) => `${obj}.${m}()`

  test('a tagged test inside describe.skip or describe.todo does not count, nested or not', () => {
    for (const m of SKIP) {
      const text = `describe.${m}('group', () => {\n  test('[mcp:a] in a ${m} group', () => {})\n  describe('inner', () => {\n    test('[mcp:b] nested', () => {})\n  })\n})\ntest('[mcp:c] outside', () => {})`
      const p = coverageProblems({ rows: [{ id: 'mcp:a' }, { id: 'mcp:b' }, { id: 'mcp:c' }], scanned: scan(text), gaps: {} })
      assert.deepEqual(p, ['mcp:a has no test and no gaps entry', 'mcp:b has no test and no gaps entry'], m)
    }
  })

  test('a describe with a skip or todo option skips what is inside it', () => {
    const text = "describe('group', { skip: true }, () => {\n  test('[mcp:a] x', () => {})\n})"
    assert.deepEqual(coverageProblems({ rows: [{ id: 'mcp:a' }], scanned: scan(text), gaps: {} }), ['mcp:a has no test and no gaps entry'])
    assert.deepEqual(coverageProblems({ rows: [{ id: 'mcp:a' }], scanned: scan(text.replace('skip: true', 'skip: false')), gaps: {} }), [])
  })

  test('a test whose body calls its context skip or todo is read as skipped, by the literal call only', () => {
    for (const m of SKIP) {
      const text = `test('[mcp:a] bails', async (t) => {\n  if (!process.env.X) return ${call('t', m)}\n})\ntest('[mcp:b] named ctx', (ctx) => { ${call('ctx', m)} })\ntest('[mcp:c] fine', async (t) => {\n  // ${call('t', m)} is only a comment\n  await t.test('sub', () => {})\n})`
      const p = coverageProblems({ rows: [{ id: 'mcp:a' }, { id: 'mcp:b' }, { id: 'mcp:c' }], scanned: scan(text), gaps: {} })
      assert.deepEqual(p, ['mcp:a has no test and no gaps entry', 'mcp:b has no test and no gaps entry'], m)
    }
  })

  test('a skipped describe does not swallow the tests after it, and brackets inside strings do not confuse it', () => {
    const text = "describe.skip('g (', () => {\n  test('[mcp:a] a', () => { const s = ')}' })\n})\ntest('[mcp:b] after', () => {})"
    assert.deepEqual(coverageProblems({ rows: [{ id: 'mcp:a' }, { id: 'mcp:b' }], scanned: scan(text), gaps: {} }), ['mcp:a has no test and no gaps entry'])
  })

  test('the body-level case cannot be known from source, so a skip decided at run time is only seen in the junit ingest', () => {
    const [{ tests }] = scan("test('[mcp:a] x', async (t) => { if (await check()) { return t['skip']() } })")
    assert.equal(tests[0].skipped, false)
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
