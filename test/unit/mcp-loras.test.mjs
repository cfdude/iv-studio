// MCP LoRA and Civitai tools (task 5.8), called through the real MCP server on source under the test guard. The server is
// a child process, and Civitai's address is a mutable object inside it, so startMcp({ civitai: fake.url }) points it at the
// fake Civitai through a test-only preload (test/fakes/civitai-address.mjs). Downloads land in the fake ComfyUI's loras folder.
//   node --test test/unit/mcp-loras.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { startFakeComfy } from '../fakes/comfyui.mjs'
import { startMcp } from '../fakes/mcp.mjs'
import { CIVITAI_FILE_BYTES, CIVITAI_FILE_SHA256, CIVITAI_MODEL, startFakeCivitai } from '../fakes/outside.mjs'

const clone = (x) => JSON.parse(JSON.stringify(x))
const combo = (names) => ({ input: { required: { lora_name: [names] } } })
const INSTALLED = 'Civitai/Fake_Neon_Street/fake_neon_street.safetensors'

// 101 the good LoRA; 102 a real person's (never shown); 103 mature (shown only when turned on); 104 whose file does not
// match the checksum Civitai publishes
const MODELS = () => {
  const good = clone(CIVITAI_MODEL)
  const person = { ...clone(CIVITAI_MODEL), id: 102, name: 'Fake Person', poi: true }
  const mature = { ...clone(CIVITAI_MODEL), id: 103, name: 'Fake Mature', nsfw: true, nsfwLevel: 8 }
  const bad = { ...clone(CIVITAI_MODEL), id: 104, name: 'Fake Bad Sum' }
  bad.modelVersions[0].id = 2004
  bad.modelVersions[0].files[0] = { ...bad.modelVersions[0].files[0], id: 3004, name: 'bad_sum.safetensors', hashes: { SHA256: 'cd'.repeat(32) } }
  return [good, person, mature, bad]
}

describe('MCP LoRA tools on the fake Civitai', () => {
  let civitai, fake, mcp, plain, models
  const call = (name, args = {}, who = mcp) => who.client.callTool({ name, arguments: args })
  const ok = async (name, args = {}, who = mcp) => {
    const r = await call(name, args, who)
    assert.ok(!r.isError, `${name}: ${JSON.stringify(r.content)}`)
    return r.structuredContent
  }
  const fails = async (name, args, pattern, who = mcp) => {
    const r = await call(name, args, who)
    assert.equal(r.isError, true, `${name} should have failed`)
    assert.match(r.content[0].text, pattern)
  }
  const lorasDir = () => path.join(fake.dataDir, 'models', 'loras')
  const setMature = (on) => {
    const file = path.join(mcp.dataDir, 'settings.json')
    fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), civitaiMature: on }, null, 2))
  }
  const last = () => civitai.requests.at(-1)

  before(async () => {
    models = MODELS()
    civitai = await startFakeCivitai({ models })
    for (const m of models) m.modelVersions[0].images[0].url = `${civitai.url}/fake/${m.id}/preview.jpeg`
    fake = await startFakeComfy({ devices: 'mps', os: 'darwin', models: { loras: [] }, objectInfo: { LoraLoaderModelOnly: combo([]) } })
    mcp = await startMcp({ comfyUrl: fake.url, civitai: civitai.url, civitaiKey: 'fake-civitai-key' })
    // a second server that is given no Civitai address and no key: the real address, so the guard answers
    plain = await startMcp({ comfyUrl: fake.url })
  })
  after(async () => {
    await mcp?.close()
    await plain?.close()
    await fake?.close()
    await civitai?.close()
  })

  // ---------- the preload really takes effect ----------
  test('the preload points the server at the fake: a search reaches it, and without it the guard refuses civitai.com', async () => {
    const before = civitai.requests.length
    await ok('search_loras', {})
    assert.equal(civitai.requests.length, before + 1, 'the fake received the request')
    assert.equal(last().path, '/api/v1/models')
    await fails('search_loras', {}, /Couldn't reach Civitai.*civitai\.com:443/, plain)
    assert.equal(civitai.requests.length, before + 1, 'the server without the option never reached the fake')
  })

  // ---------- search_loras ----------
  test('[mcp:search_loras] returns the H3 LoRA cards and hides a real person and mature LoRAs', async () => {
    const r = await ok('search_loras', {})
    assert.deepEqual(r.items.map((i) => i.id), [101, 104])
    assert.deepEqual(r.next, null)
    assert.equal(r.mature, false)
    const card = r.items[0]
    assert.equal(card.name, 'Fake Neon Street')
    assert.equal(card.creator, 'fake_maker')
    assert.deepEqual(card.version, { id: 2001, name: 'v1', baseModel: 'MiniMax H3', trainedWords: ['neonstreet'] })
    assert.deepEqual(card.file, { id: 3001, name: 'fake_neon_street.safetensors', size: 1024 * 1024, sha256: CIVITAI_FILE_SHA256 })
    assert.equal(card.installed, false)
    assert.equal(card.previews[0].url, `${civitai.url}/fake/101/width=450,optimized=true/preview.jpeg`)
    assert.deepEqual([last().query.types, last().query.baseModels, last().query.nsfw, last().query.limit], ['LORA', 'MiniMax H3', 'false', '12'])
  })

  test('[mcp:search_loras] sends the query, tag, sort, cursor and a limit held to 1 to 100', async () => {
    await ok('search_loras', { query: ' neon ', tag: 'style', sort: 'Newest', cursor: 'abc', limit: 5 })
    assert.deepEqual(last().query, { types: 'LORA', baseModels: 'MiniMax H3', limit: '5', sort: 'Newest', nsfw: 'false', query: 'neon', tag: 'style', cursor: 'abc' })
    await fails('search_loras', { limit: 500 }, /limit/i)
    await fails('search_loras', { sort: 'Oldest' }, /sort/i)
  })

  test('[mcp:search_loras] shows mature LoRAs only after Show mature LoRAs is turned on, and still never a real person', async () => {
    setMature(true)
    try {
      const r = await ok('search_loras', {})
      assert.equal(r.mature, true)
      assert.deepEqual(r.items.map((i) => i.id), [101, 103, 104])
      assert.equal(last().query.nsfw, 'true')
      assert.equal(r.items.find((i) => i.id === 103).mature, true)
    } finally {
      setMature(false)
    }
  })

  // ---------- get_lora ----------
  test('[mcp:get_lora] gives one LoRA in full: its version, trigger words, licence and notes as plain text', async () => {
    const m = await ok('get_lora', { modelId: 101 })
    assert.equal(m.name, 'Fake Neon Street')
    assert.equal(m.url, `${civitai.url}/models/101`)
    assert.equal(m.description, 'A fake LoRA for tests.')
    assert.deepEqual(m.licence, { commercial: true, commercialUses: ['Image'], derivatives: true, creditNeeded: false })
    assert.equal(m.versions.length, 1)
    const v = m.versions[0]
    assert.deepEqual([v.id, v.name, v.baseModel, v.notes, v.trainedWords, v.installed], [2001, 'v1', 'MiniMax H3', 'First version', ['neonstreet'], false])
    assert.equal(v.file.sha256, CIVITAI_FILE_SHA256)
    assert.equal(v.previews[0].full, `${civitai.url}/fake/101/width=1280,optimized=true/preview.jpeg`)
    assert.equal(last().path, '/api/v1/models/101')
  })

  test('[mcp:get_lora] says a LoRA is not available when Civitai has none, or it is a real person or mature', async () => {
    await fails('get_lora', { modelId: 999 }, /isn’t available here/)
    await fails('get_lora', { modelId: 102 }, /isn’t available here/)
    await fails('get_lora', { modelId: 103 }, /isn’t available here/)
    await fails('get_lora', { modelId: 1.5 }, /integer/i)
  })

  // ---------- download_lora ----------
  test('[mcp:download_lora] needs a Civitai API key and says where to get one, before asking Civitai anything', async () => {
    const before = civitai.requests.length
    await fails('download_lora', { modelId: 101 }, /needs your own Civitai API key.*Settings → Civitai/, plain)
    assert.equal(civitai.requests.length, before)
  })

  test('[mcp:download_lora] saves the file under the fake ComfyUI loras folder, checked against the published SHA-256', async () => {
    const r = await ok('download_lora', { modelId: 101 })
    const target = path.join(lorasDir(), 'Civitai', 'Fake_Neon_Street', 'fake_neon_street.safetensors')
    assert.deepEqual([r.lora, r.path, r.sha256, r.name, r.trainedWords], [INSTALLED, target, CIVITAI_FILE_SHA256, 'Fake Neon Street', ['neonstreet']])
    assert.deepEqual(fs.readFileSync(target), CIVITAI_FILE_BYTES)
    assert.equal(fs.existsSync(`${target}.part`), false)
    assert.ok(target.startsWith(fake.dataDir), 'under the fake ComfyUI folder, not the real home')
    const dl = civitai.requests.find((q) => q.path === '/api/download/models/2001')
    assert.deepEqual([dl.query.token, dl.query.type, dl.query.format], ['fake-civitai-key', 'Model', 'SafeTensor'])
    const lib = JSON.parse(fs.readFileSync(path.join(mcp.dataDir, 'loras', 'library.json'), 'utf8'))
    assert.equal(lib.files[INSTALLED].sha256, CIVITAI_FILE_SHA256)
    assert.equal(lib.files[INSTALLED].civitai.name, 'Fake Neon Street')
    assert.equal(lib.files[INSTALLED].civitai.baseModel, 'MiniMax H3')
    assert.ok(fs.existsSync(lib.files[INSTALLED].civitai.preview.file), 'the preview was kept in the data folder')
    assert.ok(lib.files[INSTALLED].civitai.preview.file.startsWith(mcp.dataDir))
  })

  test('[mcp:download_lora] a second download of the same version returns the file already there, and search marks it installed', async () => {
    const before = civitai.requests.filter((q) => q.path.startsWith('/api/download')).length
    const r = await ok('download_lora', { modelId: 101, versionId: 2001 })
    assert.equal(r.lora, INSTALLED)
    assert.equal(civitai.requests.filter((q) => q.path.startsWith('/api/download')).length, before, 'nothing was downloaded again')
    const found = await ok('search_loras', {})
    assert.equal(found.items.find((i) => i.id === 101).installed, true)
    assert.equal((await ok('get_lora', { modelId: 101 })).versions[0].installed, true)
  })

  test('[mcp:download_lora] removes a file that does not match the published checksum and says so', async () => {
    await fails('download_lora', { modelId: 104 }, /didn’t match the checksum Civitai publishes, so it was removed/)
    const dir = path.join(lorasDir(), 'Civitai', 'Fake_Bad_Sum')
    assert.deepEqual(fs.readdirSync(dir), [], 'neither the file nor its .part is left')
  })

  test('[mcp:download_lora] says so for a LoRA that is not available', async () => {
    await fails('download_lora', { modelId: 102 }, /isn’t available here/)
  })

  // ---------- list_my_loras ----------
  test('[mcp:list_my_loras] lists the LoRAs ComfyUI can load, the H3 ones by default, with what Civitai said', async () => {
    fs.writeFileSync(path.join(lorasDir(), 'other_style.safetensors'), 'not for h3')
    fs.writeFileSync(path.join(lorasDir(), 'minimax_h3_look.safetensors'), 'named for h3')
    fake.setObjectInfo({ LoraLoaderModelOnly: combo([INSTALLED, 'other_style.safetensors', 'minimax_h3_look.safetensors']) })
    const h3 = await ok('list_my_loras', {})
    assert.deepEqual(h3.items.map((i) => i.name), [INSTALLED, 'minimax_h3_look.safetensors'])
    const known = h3.items[0]
    assert.equal(known.file, path.join(lorasDir(), 'Civitai', 'Fake_Neon_Street', 'fake_neon_street.safetensors'))
    assert.equal(known.size, CIVITAI_FILE_BYTES.length)
    assert.equal(known.sha256, CIVITAI_FILE_SHA256)
    assert.deepEqual([known.civitai.name, known.civitai.trainedWords, known.h3], ['Fake Neon Street', ['neonstreet'], true])
    assert.equal(h3.items[1].civitai, null, 'named for H3 but not looked up yet')
    const all = await ok('list_my_loras', { h3Only: false })
    assert.deepEqual(all.items.map((i) => [i.name, i.h3]), [[INSTALLED, true], ['other_style.safetensors', false], ['minimax_h3_look.safetensors', true]])
  })

  // ---------- identify_lora ----------
  test('[mcp:identify_lora] finds an installed file on Civitai by its SHA-256 and keeps the answer', async () => {
    fs.writeFileSync(path.join(lorasDir(), 'mystery.safetensors'), CIVITAI_FILE_BYTES)
    fake.setObjectInfo({ LoraLoaderModelOnly: combo(['mystery.safetensors']) })
    const r = await ok('identify_lora', { name: 'mystery.safetensors' })
    assert.equal(r.sha256, CIVITAI_FILE_SHA256)
    assert.deepEqual([r.civitai.modelId, r.civitai.versionId, r.civitai.name, r.civitai.version, r.civitai.baseModel, r.civitai.trainedWords], [101, 2001, 'Fake Neon Street', 'v1', 'MiniMax H3', ['neonstreet']])
    assert.equal(last().path, `/api/v1/model-versions/by-hash/${CIVITAI_FILE_SHA256}`)
    assert.ok(fs.existsSync(r.civitai.preview.file) && r.civitai.preview.file.startsWith(mcp.dataDir))
    const again = (await ok('list_my_loras', {})).items.find((i) => i.name === 'mystery.safetensors')
    assert.equal(again.civitai.name, 'Fake Neon Street')
    assert.equal(again.sha256, CIVITAI_FILE_SHA256)
    assert.equal(again.h3, true, 'Civitai says MiniMax H3, so it is now an H3 LoRA')
  })

  test('[mcp:identify_lora] keeps no Civitai answer for a file Civitai does not know, and refuses a name ComfyUI does not have', async () => {
    fs.writeFileSync(path.join(lorasDir(), 'unknown.safetensors'), 'bytes nobody published')
    fake.setObjectInfo({ LoraLoaderModelOnly: combo(['unknown.safetensors']) })
    const r = await ok('identify_lora', { name: 'unknown.safetensors' })
    assert.equal(r.civitai, null)
    assert.match(r.sha256, /^[0-9a-f]{64}$/)
    await fails('identify_lora', { name: 'ghost.safetensors' }, /ComfyUI has no LoRA called ghost\.safetensors\./)
  })
})
