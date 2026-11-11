// The seeded settings of every test run (test/fakes/mcp.mjs seedSettings, used by the MCP child and the page tier's
// driver) hold every secret key as null. The list of secret keys is read from source, so a new secret that src adds
// and the seed forgets fails here.
//   node --test test/unit/seed-secrets.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { seedSettings } from '../fakes/mcp.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8')

// Every settings key that holds a secret, from three places in source: DEFAULT_SETTINGS names ending in Key or Token,
// SECRET_NAMES in secrets.js (via its REMEDIES table), and every key the main process seals with `name: seal(`.
export function secretKeysInSource() {
  const keys = new Set()
  const defaults = /const DEFAULT_SETTINGS = \{([^\n]*)\}/.exec(read('src/service/paths.js'))?.[1] || ''
  for (const m of defaults.matchAll(/\b(\w+(?:Key|Token))\s*:/g)) keys.add(m[1])
  const remedies = /const REMEDIES = \{([\s\S]*?)\n\}/.exec(read('src/service/secrets.js'))?.[1] || ''
  for (const m of remedies.matchAll(/^\s{2}(\w+):\s*\{/gm)) keys.add(m[1])
  for (const m of read('src/main/index.js').matchAll(/\b(\w+):\s*seal\(/g)) keys.add(m[1])
  return keys
}

test('the secret keys are read from source, and include the Comfy Cloud key', () => {
  const keys = secretKeysInSource()
  for (const k of ['comfyApiKey', 'comfyCloudKey', 'civitaiKey', 'runpodKey', 'cloudToken', 'runpodToken']) assert.ok(keys.has(k), `${k} not found in source`)
})

test('the seeded settings hold every secret key from source as null', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-seed-'))
  try {
    seedSettings(dir, { comfyUrl: 'http://127.0.0.1:1' })
    const seeded = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'))
    for (const k of secretKeysInSource()) {
      assert.ok(k in seeded, `${k} is not seeded`)
      assert.equal(seeded[k], null, `${k} is not null`)
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
