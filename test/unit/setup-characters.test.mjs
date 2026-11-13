// Setup's character check on a Mac: a LoRA path saved on Windows (backslashes) against a Mac ComfyUI's list (forward
// slashes), and the Download button for a ready-made character whose saved record has no catalog flag.
//   node --test test/unit/setup-characters.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { after, before, describe, test } from 'node:test'
import { Comfy } from '../../src/service/comfy.js'
import { checkSetup, sameLora } from '../../src/service/setup.js'
import { startFakeComfy } from '../fakes/comfyui.mjs'

const template = JSON.parse(fs.readFileSync('resources/workflows/iv_studio_api.json', 'utf8'))
const manifest = JSON.parse(fs.readFileSync('resources/models.json', 'utf8'))
const combo = (name, options) => ({ input: { required: { [name]: [options] } } })
const shippedTess = { id: 'tess', lora: { folder: 'MiniMax H3/tess', file: 'tess_mmh3-000040.safetensors', url: 'https://example.invalid/t' } }
const tess = { id: 'tess', name: 'Tess Marlow', lora: 'MiniMax H3\\tess\\tess_mmh3-000040.safetensors', strength: 0.8 }

describe('sameLora', () => {
  test('separators do not matter, case does (ComfyUI needs the exact name)', () => {
    assert.equal(sameLora('MiniMax H3\\tess\\a.safetensors', 'MiniMax H3/tess/a.safetensors'), true)
    assert.equal(sameLora('minimax h3/Tess/A.safetensors', 'MiniMax H3\\tess\\a.safetensors'), false)
    assert.equal(sameLora('a/b.safetensors', 'a/c.safetensors'), false)
    assert.equal(sameLora('', undefined), true)
  })
})

describe('checkSetup character LoRAs on a Mac', () => {
  let fake, comfy
  const item = async (characters, loras, catalog) => {
    fake.setObjectInfo({ LoraLoaderModelOnly: combo('lora_name', loras) })
    const r = await checkSetup({ comfy, template, manifest, characters, catalog })
    return r.items.find((i) => i.id === `character:${characters[0].id}`)
  }
  before(async () => {
    fake = await startFakeComfy({ devices: 'mps', os: 'darwin' })
    comfy = new Comfy(fake.url)
  })
  after(() => fake.close())

  test('a Windows-spelled LoRA path matches the Mac ComfyUI\'s forward-slash list', async () => {
    const i = await item([tess], ['MiniMax H3/tess/tess_mmh3-000040.safetensors'], [])
    assert.equal(i.status, 'ok')
  })
  test('a name that differs only by case is not found (ComfyUI would refuse it)', async () => {
    const i = await item([tess], ['minimax h3/Tess/TESS_MMH3-000040.safetensors'], [])
    assert.equal(i.status, 'warn')
  })
  test('missing: a saved record with no catalog flag still gets the Download button when IV Studio ships that character', async () => {
    const i = await item([tess], ['MiniMax H3/Turbo/x.safetensors'], [shippedTess])
    assert.equal(i.status, 'warn')
    assert.equal(i.download, 'tess')
  })
  test('a person\'s own character that reuses the id "tess" with a different LoRA gets no Download (it would overwrite their LoRA)', async () => {
    const own = { ...tess, lora: 'Mine\\my_tess.safetensors' }
    const i = await item([own], ['MiniMax H3/Turbo/x.safetensors'], [shippedTess])
    assert.equal(i.status, 'warn')
    assert.equal(i.download, undefined)
  })
  test('missing and not shipped: no Download button (nothing to download from)', async () => {
    const i = await item([{ ...tess, id: 'mine' }], ['MiniMax H3/Turbo/x.safetensors'], [{ id: 'tess', lora: { url: 'x' } }])
    assert.equal(i.status, 'warn')
    assert.equal(i.download, undefined)
  })
  test('the shipped catalogue really has Tess, with a source', () => {
    const c = JSON.parse(fs.readFileSync('resources/characters/catalog.json', 'utf8')).characters.find((x) => x.id === 'tess')
    assert.match(c.lora.url, /^https:/)
  })
})
