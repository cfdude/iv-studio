// Setup's character rows: a ready-made (catalogue) character whose LoRA isn't in ComfyUI says so with the id the
// window downloads it by; one the person made themselves has no such download.
//   node --test test/unit/setup-characters.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { after, before, describe, test } from 'node:test'
import { Comfy } from '../../src/service/comfy.js'
import { checkSetup } from '../../src/service/setup.js'
import { startFakeComfy } from '../fakes/comfyui.mjs'

const template = JSON.parse(fs.readFileSync('resources/workflows/iv_studio_api.json', 'utf8'))
const manifest = JSON.parse(fs.readFileSync('resources/models.json', 'utf8'))

describe('checkSetup character rows', () => {
  let fake, comfy
  before(async () => {
    fake = await startFakeComfy()
    comfy = new Comfy(fake.url)
  })
  after(() => fake.close())
  const rows = async (characters) => (await checkSetup({ comfy, template, manifest, characters })).items.filter((i) => i.kind === 'character')

  test('a catalogue character with its LoRA missing can be downloaded from the row', async () => {
    const [row] = await rows([{ id: 'tess', name: 'Tess', lora: 'H3\\tess.safetensors', catalog: true }])
    assert.equal(row.status, 'warn')
    assert.equal(row.download, 'tess')
  })

  test('your own character with its LoRA missing has no download, and one that is here needs none', async () => {
    const [mine] = await rows([{ id: 'mine', name: 'Mine', lora: 'H3\\mine.safetensors' }])
    assert.equal(mine.status, 'warn')
    assert.equal(mine.download, undefined)
  })
})
