// The real tier's twins (spec: "Real-backend tests stay opt-in and twinned").
// A real test that is not a todo names the advertised `feature:` row it proves and the surface rows it exercises, every
// one of which a default-suite test names; the twin names only surface rows, never the feature row; and a real test file
// prints the credits banner by importing test/real/banner.mjs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { scanTestNames, rowIdsIn } from './test-names.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const filesIn = (dir, ok) =>
  fs.readdirSync(path.join(root, dir)).filter(ok).sort().map((f) => ({ file: `${dir}/${f}`, text: fs.readFileSync(path.join(root, dir, f), 'utf8') }))
const BANNER_TEXT = 'Real tests spend Comfy Cloud credits or local GPU time.'
const IMPORTS_BANNER = /(?:^|\n)\s*import\s+(?:[^'"\n]*\sfrom\s+)?['"]\.\/banner\.mjs['"]/

// A todo is the one kind of real test that needs no twin. scanTestNames lumps skip and todo together, so read it again.
const isTodo = (text, t) => {
  const from = text.split('\n').slice(0, t.line - 1).join('\n').length
  const head = text.slice(from, from + 600)
  if (new RegExp(`(?<![.\\w$])${t.kind}\\.todo\\s*\\(`).test(head.slice(0, head.indexOf('(') + 8))) return true
  const rest = head.slice(head.indexOf('(') + 1)
  const options = /\{[^}]*\btodo\s*:\s*(?!false\b)[^\s,}][^}]*\}/.exec(rest.slice(0, 300))
  return Boolean(options)
}

// Everything the rule can complain about, as sentences that name the test. Inputs are [{ file, text }] lists.
export function twinProblems({ realFiles, unitFiles }) {
  const problems = []
  const unitRows = new Set()
  for (const { file, text } of unitFiles) {
    const { tests } = scanTestNames(text, file)
    for (const t of tests) {
      const ids = rowIdsIn(t.name)
      for (const id of ids.filter((i) => i.startsWith('feature:'))) {
        problems.push(`${file}:${t.line}: the default-suite test "${t.name}" names the feature row ${id}; a feature's fake result comes only from the rows it uses`)
      }
      if (!t.skipped) for (const id of ids) unitRows.add(id)
    }
  }
  for (const { file, text } of realFiles) {
    const { tests, problems: notLiteral } = scanTestNames(text, file)
    problems.push(...notLiteral)
    const live = tests.filter((t) => t.kind !== 'describe' && !isTodo(text, t))
    if (live.length && !IMPORTS_BANNER.test(text)) {
      problems.push(`${file}: the real test "${live[0].name}" is in a file that does not import ./banner.mjs, so nothing says it spends credits`)
    }
    for (const t of live) {
      const ids = rowIdsIn(t.name)
      if (!ids.some((i) => i.startsWith('feature:'))) {
        problems.push(`${file}:${t.line}: the real test "${t.name}" names no feature: row`)
      }
      for (const id of ids.filter((i) => !i.startsWith('feature:') && !unitRows.has(i))) {
        problems.push(`${file}:${t.line}: the real test "${t.name}" names ${id}, which no default-suite test names, so it has no twin`)
      }
    }
  }
  return problems
}

const realFiles = () => filesIn('test/real', (f) => f.endsWith('.test.mjs'))
const unitFiles = () => filesIn('test/unit', (f) => f.endsWith('.test.mjs'))

// Source text for the fixtures. The word test is joined here so that no fixture reads as a test of this file.
const T = 'te' + 'st'
const real = (name, { banner = true } = {}) =>
  `${banner ? "import './banner.mjs'\n" : ''}import { ${T} } from 'node:test'\n${T}(${JSON.stringify(name)}, { skip: process.env.IV_REAL !== '1' }, () => {})\n`
const TWIN = { file: 'test/unit/twin.test.mjs', text: `${T}('[mcp:check_setup] reports an Apple GPU', () => {})\n` }

test('the real tier on this branch has every twin and its banner', () => {
  const problems = twinProblems({ realFiles: realFiles(), unitFiles: unitFiles() })
  assert.deepEqual(problems, [])
})

test('a real test that names its feature row and a covered surface row passes', () => {
  const files = [{ file: 'test/real/ok.test.mjs', text: real('[feature:picture-from-text] [mcp:check_setup] makes a picture') }]
  assert.deepEqual(twinProblems({ realFiles: files, unitFiles: [TWIN] }), [])
})

test('a todo real test needs no twin, no feature row and no banner', () => {
  const todo = [
    { file: 'test/real/todo.test.mjs', text: `import { ${T} } from 'node:test'\n${T}.todo('nothing yet')\n` },
    { file: 'test/real/todo2.test.mjs', text: `import { ${T} } from 'node:test'\n${T}('nothing either', { todo: true }, () => {})\n` }
  ]
  assert.deepEqual(twinProblems({ realFiles: todo, unitFiles: [] }), [])
})

test('a real test with no twin fails and names the test', () => {
  const files = [{ file: 'test/real/lonely.test.mjs', text: real('[feature:picture-from-text] [mcp:make_a_picture] makes a picture') }]
  const problems = twinProblems({ realFiles: files, unitFiles: [TWIN] })
  assert.equal(problems.length, 1)
  assert.match(problems[0], /real test "\[feature:picture-from-text\] \[mcp:make_a_picture\] makes a picture"/)
  assert.match(problems[0], /mcp:make_a_picture/)
})

test('a twin that is only skipped does not count as a twin', () => {
  const skipped = { file: 'test/unit/s.test.mjs', text: `${T}.skip('[mcp:make_a_picture] x', () => {})\n` }
  const files = [{ file: 'test/real/a.test.mjs', text: real('[feature:picture-from-text] [mcp:make_a_picture] makes a picture') }]
  assert.equal(twinProblems({ realFiles: files, unitFiles: [skipped] }).length, 1)
})

test('a real test that names no feature row fails and names the test', () => {
  const files = [{ file: 'test/real/nofeature.test.mjs', text: real('[mcp:check_setup] checks the setup') }]
  const problems = twinProblems({ realFiles: files, unitFiles: [TWIN] })
  assert.equal(problems.length, 1)
  assert.match(problems[0], /real test "\[mcp:check_setup\] checks the setup" names no feature: row/)
})

test('a real test file without the banner import fails and names the test', () => {
  const files = [{ file: 'test/real/quiet.test.mjs', text: real('[feature:picture-from-text] [mcp:check_setup] quiet one', { banner: false }) }]
  const problems = twinProblems({ realFiles: files, unitFiles: [TWIN] })
  assert.equal(problems.length, 1)
  assert.match(problems[0], /real test "\[feature:picture-from-text\] \[mcp:check_setup\] quiet one"/)
  assert.match(problems[0], /banner\.mjs/)
})

test('a default-suite test that names a feature row fails and names the test', () => {
  const unit = { file: 'test/unit/greedy.test.mjs', text: `${T}('[feature:picture-from-text] [mcp:check_setup] claims the feature', () => {})\n` }
  const problems = twinProblems({ realFiles: [], unitFiles: [unit] })
  assert.equal(problems.length, 1)
  assert.match(problems[0], /default-suite test "\[feature:picture-from-text\] \[mcp:check_setup\] claims the feature" names the feature row feature:picture-from-text/)
})

test('importing the banner with IV_REAL=1 prints the credits warning before the tests, and without it prints nothing', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-banner-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  // The guard removes IV_REAL from the environment of every process it runs in, so the probe sets it itself, as the
  // person's shell would have before the guard-free real tier started, and only then imports the banner.
  const run = (value) => {
    const file = path.join(dir, `probe-${String(value)}.test.mjs`)
    const set = value === undefined ? '' : `process.env.IV_REAL = ${JSON.stringify(value)}\n`
    fs.writeFileSync(file, `${set}await import(${JSON.stringify(path.join(root, 'test/real/banner.mjs'))})\nconst { ${T} } = await import('node:test')\n${T}('probe', () => {})\n`)
    // this file runs inside node --test, whose marker would make the probe report in the runner's wire format
    const env = { ...process.env }
    delete env.NODE_TEST_CONTEXT
    const r = spawnSync(process.execPath, ['--test', file], { encoding: 'utf8', env })
    assert.equal(r.status, 0, `${r.stderr}${r.stdout}`)
    return r.stdout
  }
  await t.test('IV_REAL=1', () => {
    const out = run('1')
    assert.ok(out.includes(BANNER_TEXT), out)
    assert.ok(out.indexOf(BANNER_TEXT) < out.indexOf('probe'), 'the banner comes before the first test')
  })
  await t.test('IV_REAL unset', () => assert.ok(!run(undefined).includes(BANNER_TEXT)))
  await t.test('IV_REAL=true', () => assert.ok(!run('true').includes(BANNER_TEXT)))
})
