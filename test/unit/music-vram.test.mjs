// Characterization: src/service/music.js status() and the two song graphs, against the fake ComfyUI.
// vramGb comes from the one GPU rule (cuda, else mps), so Apple Silicon reports its unified memory.
//   node --test test/unit/music-vram.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { Comfy } from '../../src/service/comfy.js'
import { aceGraph, Music, MUSIC_ENGINES, minimaxGraph } from '../../src/service/music.js'
import { startFakeComfy } from '../fakes/comfyui.mjs'

const manifest = JSON.parse(fs.readFileSync('resources/models.json', 'utf8'))

// objectInfo that lists every music model file by its manifest name
function objectInfoWithMusicModels() {
  const info = {
    MiniMaxMusic3TextEncode: { input: { required: {} } },
    EmptyMiniMaxMusic3LatentAudio: { input: { required: {} } },
    'TextEncodeAceStepAudio1.5': { input: { required: {} } },
    'EmptyAceStep1.5LatentAudio': { input: { required: {} } }
  }
  for (const id of MUSIC_ENGINES.flatMap((e) => e.models)) {
    const m = manifest.models.find((x) => x.id === id)
    const [cls, input] = m.loader.split('.')
    info[cls] ||= { input: { required: {} } }
    info[cls].input.required[input] = [[...(info[cls].input.required[input]?.[0] || []), m.match]]
  }
  return info
}

describe('Music.status VRAM', () => {
  let fake, music, dataDir
  before(async () => {
    fake = await startFakeComfy()
    const studio = { comfy: new Comfy(fake.url), manifest }
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ivmusic-'))
    music = new Music({ studio, dataDir, probe: null })
  })
  after(async () => {
    fs.rmSync(dataDir, { recursive: true, force: true })
    await fake.close()
  })

  test('cuda reports its VRAM in whole GB', async () => {
    fake.setDevices('cuda')
    assert.equal((await music.status()).vramGb, 24)
  })

  test('mps reports its unified memory: 64', async () => {
    fake.setDevices('mps')
    assert.equal((await music.status()).vramGb, 64)
  })

  test('a cpu device first and an mps device second reads the mps one', async () => {
    fake.setDevices([{ name: 'cpu', type: 'cpu' }, { name: 'mps', type: 'mps', vram_total: 32 * 1024 ** 3 }])
    assert.equal((await music.status()).vramGb, 32)
  })

  test('cpu only: vramGb is null', async () => {
    fake.setDevices([{ name: 'cpu', type: 'cpu' }])
    assert.equal((await music.status()).vramGb, null)
  })

  test('no devices: vramGb is null', async () => {
    fake.setDevices([])
    assert.equal((await music.status()).vramGb, null)
  })

  test('with no music models installed, no engine is ready and each lists what is missing', async () => {
    fake.setDevices('cuda')
    fake.setObjectInfo({})
    const s = await music.status()
    assert.equal(s.ready, false)
    assert.deepEqual(s.engines.find((e) => e.id === 'minimax').missing.map((m) => m.id), ['music3_dit', 'music3_te', 'music3_vae'])
  })

  test('with every music model and node installed, both engines are ready and files are found by name', async () => {
    fake.setObjectInfo(objectInfoWithMusicModels())
    const s = await music.status()
    assert.equal(s.ready, true)
    assert.deepEqual(s.engines.map((e) => e.ready), [true, true])
    assert.equal(s.engines.find((e) => e.id === 'ace').files.ace15, manifest.models.find((m) => m.id === 'ace15').match)
  })

  test('a Windows-style path in the model list still matches by file name', async () => {
    const info = objectInfoWithMusicModels()
    const dit = manifest.models.find((m) => m.id === 'music3_dit')
    info.UNETLoader.input.required.unet_name = [[`MiniMax\\${dit.match}`]]
    fake.setObjectInfo(info)
    const s = await music.status()
    assert.equal(s.engines.find((e) => e.id === 'minimax').files.music3_dit, `MiniMax\\${dit.match}`)
  })

  test('a remote (token) ComfyUI is reported as remote and not ready, without asking it anything', async () => {
    const before = fake.requests.length
    const remote = new Music({ studio: { comfy: new Comfy(fake.url, 'iv-studio', 'tok'), manifest }, dataDir: os.tmpdir(), probe: null })
    const s = await remote.status()
    assert.equal(s.remote, true)
    assert.equal(s.ready, false)
    assert.equal(fake.requests.length, before)
  })

  test('ComfyUI down: status carries the error and no engine is ready', async () => {
    fake.failRoute('/object_info', 500, 'down')
    const s = await music.status()
    fake.failRoute('/object_info', null)
    assert.match(s.error, /500/)
    assert.equal(s.ready, false)
  })
})

describe('song graphs', () => {
  const links = (g) => Object.values(g).flatMap((n) => Object.values(n.inputs)).filter((v) => Array.isArray(v) && typeof v[0] === 'string')

  test('minimaxGraph: tiled decode below the VRAM line, plain decode above it', () => {
    const args = { dit: 'd', te: 't', vae: 'v', caption: 'c', lyrics: 'l', seconds: 60, seed: 7, prefix: 'p' }
    assert.equal(minimaxGraph({ ...args, tiled: true })[8].class_type, 'VAEDecodeAudioTiled')
    assert.equal(minimaxGraph({ ...args, tiled: false })[8].class_type, 'VAEDecodeAudio')
  })

  test('both graphs are wired: every link points at a node that exists, and each ends in SaveAudio', () => {
    const m = minimaxGraph({ dit: 'd', te: 't', vae: 'v', caption: 'c', lyrics: 'l', seconds: 60, seed: 7, tiled: false, prefix: 'p' })
    const a = aceGraph({ ckpt: 'k', tags: 't', lyrics: 'l', seconds: 30, seed: 7, bpm: 120, key: 'C major', timesignature: '4', language: 'en', prefix: 'p' })
    for (const g of [m, a]) {
      for (const [id] of links(g)) assert.ok(id in g, `link to missing node ${id}`)
      assert.equal(Object.values(g).at(-1).class_type, 'SaveAudio')
    }
    assert.equal(m[7].inputs.steps, 30)
    assert.equal(a[6].inputs.steps, 8)
  })
})
