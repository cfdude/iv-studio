// Every environment variable that src/ reads must be listed in test/fakes/env-policy.json as
// remove, pin or keep, so the test guard scrubs credentials and machine paths (design D8).
//   node --test test/unit/env-policy.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const policy = JSON.parse(fs.readFileSync(path.join(root, 'test/fakes/env-policy.json'), 'utf8'))

// process.env.NAME, process.env['NAME'] and env.NAME, where NAME starts with an uppercase letter.
const PATTERNS = [
  /\bprocess\.env\.([A-Z][A-Za-z0-9_]*)/g,
  /\bprocess\.env\[\s*['"]([A-Z][A-Za-z0-9_]*)['"]\s*\]/g,
  /\benv\.([A-Z][A-Za-z0-9_]*)/g
]

export function scanSource(text) {
  const names = new Set()
  for (const re of PATTERNS) for (const m of text.matchAll(re)) names.add(m[1])
  return names
}

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else if (/\.(js|mjs|cjs|jsx|ts)$/.test(entry.name)) yield full
  }
}

const listed = new Set([...policy.remove, ...policy.pin, ...policy.keep].map((e) => e.name))

// Returns "NAME (file)" for each variable in `text` that the policy does not list.
function unlisted(text, file) {
  return [...scanSource(text)].filter((n) => !listed.has(n)).map((n) => `${n} (${file})`)
}

describe('env policy', () => {
  test('every variable read under src is listed as remove, pin or keep', () => {
    const missing = []
    for (const file of walk(path.join(root, 'src'))) {
      missing.push(...unlisted(fs.readFileSync(file, 'utf8'), path.relative(root, file)))
    }
    assert.deepEqual(missing, [], `env-policy.json does not list: ${missing.join(', ')}`)
  })

  test('a new variable in a source line is reported by name and file', () => {
    assert.deepEqual(unlisted('const x = process.env.NEW_THING', 'src/fixture.js'), ['NEW_THING (src/fixture.js)'])
    assert.deepEqual(unlisted("const x = process.env['NEW_OTHER']", 'src/fixture.js'), ['NEW_OTHER (src/fixture.js)'])
  })

  test('lowercase locals and comments such as env.cfg do not match', () => {
    assert.equal(scanSource('// see env.cfg\nconst a = env.home').size, 0)
  })

  test('each entry has exactly one action', () => {
    const names = [...policy.remove, ...policy.pin, ...policy.keep].map((e) => e.name)
    assert.equal(new Set(names).size, names.length, 'a name appears under two actions')
  })

  test('the CLI-read credentials are listed by hand, each with a documentation citation', () => {
    const cli = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'OPENAI_API_KEY', 'MODAL_TOKEN_ID', 'MODAL_TOKEN_SECRET', 'MODAL_PROFILE']
    for (const name of cli) {
      const entry = policy.remove.find((e) => e.name === name)
      assert.ok(entry, `${name} is not under remove`)
      assert.match(entry.citation || '', /^https:\/\//, `${name} has no documentation citation`)
    }
  })

  test('pinned variables say what they are pinned to', () => {
    for (const e of policy.pin) assert.ok(['dir', 'missing-file'].includes(e.to), `${e.name} has no pin target`)
  })
})
