// The small fakes for outside services (test/fakes/outside.mjs): one test each proves the service under test
// reaches the fake and nothing else (the test guard refuses any other address).
//   node --test test/unit/fake-outside.test.mjs
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { Civitai, CIVITAI_SITES } from '../../src/service/civitai.js'
import { GUIDE_FILES, loadGuide } from '../../src/service/h3guide.js'
import { ollamaStatus, setOllamaSource } from '../../src/service/prompter.js'
import { startFakeCivitai, startFakeGithub, startFakeOllama } from '../fakes/outside.mjs'

describe('fake Civitai', () => {
  const sites = { ...CIVITAI_SITES }
  let fake, dir
  before(async () => {
    fake = await startFakeCivitai()
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-civitai-'))
    CIVITAI_SITES.safe = fake.url
    CIVITAI_SITES.mature = fake.url
  })
  after(async () => {
    Object.assign(CIVITAI_SITES, sites)
    fs.rmSync(dir, { recursive: true, force: true })
    await fake.close()
  })

  test('Civitai search reaches the fake and returns its LoRA', async () => {
    const civitai = new Civitai({ dataDir: dir, comfy: { req: async () => [] } })
    const r = await civitai.search({ query: 'neon' })
    assert.equal(r.items.length, 1)
    assert.equal(r.items[0].id, 101)
    assert.equal(fake.requests[0].path, '/api/v1/models')
    assert.equal(fake.requests[0].query.baseModels, 'MiniMax H3')
  })

  test('one model comes back with its versions and trigger words', async () => {
    const civitai = new Civitai({ dataDir: dir, comfy: { req: async () => [] } })
    const m = await civitai.model(101)
    assert.deepEqual(m.versions[0].trainedWords, ['neonstreet'])
  })

  test('with the address left alone the real Civitai is refused by the guard', async () => {
    Object.assign(CIVITAI_SITES, sites)
    try {
      const civitai = new Civitai({ dataDir: dir, comfy: { req: async () => [] } })
      await assert.rejects(civitai.search({ query: 'x' }), /civitai\.com:443/)
    } finally {
      CIVITAI_SITES.safe = fake.url
      CIVITAI_SITES.mature = fake.url
    }
  })
})

describe('fake Ollama', () => {
  let fake
  before(async () => {
    fake = await startFakeOllama()
    setOllamaSource(() => fake.url)
  })
  after(async () => {
    setOllamaSource(() => '')
    await fake.close()
  })

  test('ollamaStatus reads the fake through the Settings address and lists its model', async () => {
    const s = await ollamaStatus()
    assert.equal(s.url, fake.url)
    assert.equal(s.running, true)
    assert.deepEqual(s.models.map((m) => m.name), ['fake-vl:8b'])
    assert.equal(fake.requests[0].path, '/api/tags')
  })

  test('with no address set, the default 11434 is refused, so Ollama reads as not running', async () => {
    setOllamaSource(() => '')
    const s = await ollamaStatus()
    assert.equal(s.running, false)
    setOllamaSource(() => fake.url)
  })
})

describe('fake GitHub', () => {
  let fake
  const files = {}
  const saved = JSON.parse(JSON.stringify(GUIDE_FILES))
  before(async () => {
    const base = 'Fake guide base text.'
    const ref = 'Fake guide reference text.'
    const license = 'Fake licence.'
    fake = await startFakeGithub({ raw: { '/base-en.txt': base, '/ref-en.txt': ref, '/LICENSE': license } })
    const sha = (t) => crypto.createHash('sha256').update(t).digest('hex')
    for (const [name, text, route] of [['base-en.txt', base, '/base-en.txt'], ['ref-en.txt', ref, '/ref-en.txt'], ['LICENSE', license, '/LICENSE']]) {
      GUIDE_FILES[name].url = `${fake.url}${route}`
      GUIDE_FILES[name].sha256 = sha(text)
      files[name] = text
    }
  })
  after(async () => {
    for (const k of Object.keys(saved)) Object.assign(GUIDE_FILES[k], saved[k])
    await fake.close()
  })

  test('the H3 guide downloads from the fake, is checked by its hash and is saved in the data folder', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-guide-'))
    try {
      const guide = await loadGuide({ root })
      assert.equal(guide.base, files['base-en.txt'])
      assert.deepEqual(fake.requests.map((r) => r.path).sort(), ['/LICENSE', '/base-en.txt', '/ref-en.txt'])
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  test('the releases JSON answers for a repo', async () => {
    const r = await (await fetch(`${fake.url}/repos/fake/fake/releases/latest`)).json()
    assert.equal(r.tag_name, 'v9.9.9')
  })
})
