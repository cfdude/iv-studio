// Upstream's own test/*.mjs scripts keep their names and places (spec: "Upstream's own scripts keep working").
// Each is classified in upstream-scripts.json, and the default run must reach none outside the default-safe class.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const classes = JSON.parse(fs.readFileSync(path.join(root, 'test/unit/upstream-scripts.json'), 'utf8'))
const onDisk = fs.readdirSync(path.join(root, 'test')).filter((f) => f.endsWith('.mjs')).sort()
const CLASSES = ['default-safe', 'needs fixtures', 'needs Windows', 'real']

// The glob after --test in the test:unit script, turned into a regular expression on paths from the repo root.
const unitGlobs = () => {
  const script = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts['test:unit']
  return [...script.matchAll(/--test\s+"([^"]+)"/g)].map((m) => m[1])
}
const globToRegExp = (g) => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '$')

test('every upstream test script is classified', () => {
  const unclassified = onDisk.filter((f) => !(f in classes))
  assert.deepEqual(unclassified, [], `classify these in test/unit/upstream-scripts.json: ${unclassified.join(', ')}`)
})

test('no classified script is missing from disk', () => {
  const missing = Object.keys(classes).filter((f) => !onDisk.includes(f))
  assert.deepEqual(missing, [], `these are classified but not in test/: ${missing.join(', ')}`)
})

test('each classification has a known class, a one-line reason and a Mac flag', () => {
  for (const [name, c] of Object.entries(classes)) {
    assert.ok(CLASSES.includes(c.class), `${name}: class must be one of ${CLASSES.join(', ')}`)
    assert.ok(typeof c.reason === 'string' && c.reason.length > 10 && !c.reason.includes('\n'), `${name}: needs a one-line reason`)
    assert.equal(typeof c.failsOnMac, 'boolean', `${name}: failsOnMac must be true or false`)
  }
})

test('a script that needs Windows says so by failing on a Mac', () => {
  const wrong = Object.entries(classes).filter(([, c]) => c.class === 'needs Windows' && !c.failsOnMac)
  assert.deepEqual(wrong.map(([n]) => n), [])
})

test('the default unit run reaches no upstream script', () => {
  const globs = unitGlobs()
  assert.ok(globs.length > 0, 'test:unit should name its test files with a glob')
  for (const g of globs) {
    const re = globToRegExp(g)
    const reached = onDisk.filter((f) => re.test(`test/${f}`))
    assert.deepEqual(reached, [], `the glob ${g} reaches upstream scripts: ${reached.join(', ')}`)
  }
})

test('the default unit glob does reach this folder, so the check above is not vacuous', () => {
  const re = globToRegExp(unitGlobs()[0])
  assert.ok(re.test('test/unit/upstream-scripts.test.mjs'))
  assert.ok(!re.test('test/cast.mjs'))
})
