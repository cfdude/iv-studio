// Window channels that hand the page a fixed table or the saved settings (task 6.3). The handlers in src/main/index.js
// build their answer from exported constants (`music:meta` is { engines: MUSIC_ENGINES, defaults: MUSIC_DEFAULTS, … }) or
// from readSettings and projectSettings, so each test reads those same exports in this process and checks the shape the
// page depends on. `loras:meta` also adds two settings flags in main; this tests the three tables it hands over.
//   node --test test/unit/ipc-meta.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { CIVITAI_SITES, LORA_SORTS, LORA_TAGS } from '../../src/service/civitai.js'
import { FORMATS, LOUDNESS } from '../../src/service/edits.js'
import { ACE_KEYS, MUSIC_DEFAULTS, MUSIC_ENGINES, REMIX } from '../../src/service/music.js'
import { readSettings, writeSettings } from '../../src/service/paths.js'
import { CREDIT } from '../../src/service/remake.js'
import { DEFAULT_TONE, MAX_CHARACTERS, OPENJUTSU, RESOLUTIONS } from '../../src/service/replace.js'
import { projectSettings } from '../../src/service/secrets.js'
import { SCENE_KINDS, SIZZLE_FORMATS } from '../../src/service/sizzle.js'
import { DEFAULT_TRACKS } from '../../src/service/timeline.js'
import { LOCAL_TRAIN, RUNPOD_TRAIN_GPUS, SCENES, TALKS, TRAIN_DEFAULTS, TRAIN_GPUS } from '../../src/service/training.js'
import { assertHandlerNames } from './main-source.mjs'

// The constants below are what main's handler hands the page. main (src/main/index.js) starts Electron and cannot be
// imported, so each test also reads main's source and fails if the handler stops handing over these names.
test('[ipc:music:meta] hands over the two engines, the defaults, the keys and the remix strengths the page offers', () => {
  assertHandlerNames(assert, 'music:meta', ['MUSIC_ENGINES', 'MUSIC_DEFAULTS', 'ACE_KEYS', 'REMIX'])
  assert.equal(MUSIC_ENGINES[0].id, 'minimax')
  assert.equal(MUSIC_ENGINES.length, 2)
  for (const e of MUSIC_ENGINES) assert.ok(e.label && e.maxSeconds > 0 && e.note, `${e.id} lacks a label, a length or a note`)
  assert.ok(MUSIC_ENGINES.some((e) => e.id === MUSIC_DEFAULTS.engine), 'the default engine is one of them')
  assert.deepEqual(Object.keys(MUSIC_DEFAULTS), ['engine', 'seconds', 'bpm', 'key', 'timesignature', 'language'])
  assert.ok(ACE_KEYS.includes(MUSIC_DEFAULTS.key))
  assert.equal(ACE_KEYS.length, 34, '17 keys, each major and minor')
  assert.deepEqual([REMIX.min, REMIX.max, REMIX.default], [0.4, 0.9, 0.65])
  assert.deepEqual(REMIX.presets.map((p) => p.id), ['subtle', 'remix', 'reimagine'])
  for (const p of REMIX.presets) assert.ok(p.strength >= REMIX.min && p.strength <= REMIX.max, `${p.id} is outside the strength range`)
})

test('[ipc:loras:meta] hands over the tag buttons, the sort order and the safe and mature Civitai sites', () => {
  assertHandlerNames(assert, 'loras:meta', ['LORA_TAGS', 'LORA_SORTS', 'CIVITAI_SITES'])
  assert.equal(LORA_TAGS[0].join('|'), '|All', 'the first tag is "All", with no tag value')
  assert.ok(LORA_TAGS.every(([value, label]) => typeof value === 'string' && label))
  assert.deepEqual(LORA_SORTS, ['Most Downloaded', 'Highest Rated', 'Newest'])
  assert.deepEqual(Object.keys(CIVITAI_SITES), ['safe', 'mature'])
  assert.ok(Object.values(CIVITAI_SITES).every((u) => /^https:\/\//.test(u)))
})

test('[ipc:replace:meta] hands over the resolutions, the character limit, the colour-match tone and where OpenJutsu comes from', () => {
  assertHandlerNames(assert, 'replace:meta', ['RESOLUTIONS', 'MAX_CHARACTERS', 'DEFAULT_TONE', 'OPENJUTSU'])
  assert.deepEqual(RESOLUTIONS, ['480p', '576p', '736p', '768p', '1080p'])
  assert.equal(MAX_CHARACTERS, 4)
  assert.equal(DEFAULT_TONE.mode, 'Reinhard')
  assert.ok(DEFAULT_TONE.strength > 0 && DEFAULT_TONE.strength <= 1)
  assert.deepEqual(Object.keys(OPENJUTSU), ['repo', 'commit', 'licence'])
  assert.match(OPENJUTSU.commit, /^[0-9a-f]{7,40}$/)
})

test('[ipc:remake:meta] hands over the credit line the page shows under a remake', () => {
  assertHandlerNames(assert, 'remake:meta', ['REMAKE_CREDIT'])
  assert.match(CREDIT, /^Powered by Viggle Remake \(https:\/\/huggingface\.co\/Viggle\/Viggle-Remake\), on MiniMax H3$/)
})

test('[ipc:training:meta] hands over the GPUs of each place a character can train, the scenes and talks to test with, and the defaults', () => {
  assertHandlerNames(assert, 'training:meta', ['TRAIN_GPUS', 'RUNPOD_TRAIN_GPUS', 'LOCAL_TRAIN', 'SCENES', 'TALKS', 'TRAIN_DEFAULTS'])
  assert.ok(TRAIN_GPUS.length > 1 && RUNPOD_TRAIN_GPUS.length > 1)
  for (const g of [...TRAIN_GPUS, ...RUNPOD_TRAIN_GPUS, LOCAL_TRAIN]) assert.ok(g.id && g.label && g.perHour >= 0 && g.secPerStep > 0, `${g.id} needs an id, a label, a price and a speed`)
  assert.equal(LOCAL_TRAIN.perHour, 0, 'training on this PC costs nothing')
  assert.ok(SCENES.length > 0 && SCENES.every((s) => typeof s === 'string'))
  assert.ok(TALKS.length > 0 && TALKS.every((t) => t.scene && t.line && t.sound))
  assert.equal(TRAIN_DEFAULTS.where, 'modal')
  assert.equal(TRAIN_DEFAULTS.checkpoints, 20)
})

test('[ipc:sizzle:meta] hands over the three sizes a sizzle reel comes in and the four kinds of scene', () => {
  assertHandlerNames(assert, 'sizzle:meta', ['SIZZLE_FORMATS', 'SCENE_KINDS'])
  assert.deepEqual(Object.keys(SIZZLE_FORMATS), ['16:9', '9:16', '1:1'])
  for (const [shape, { width, height }] of Object.entries(SIZZLE_FORMATS)) {
    const [w, h] = shape.split(':').map(Number)
    assert.ok(Math.abs(width / height - w / h) < 0.02, `${shape} is ${width} x ${height}`)
    assert.ok(width % 16 === 0 && height % 16 === 0, `${shape} is not a multiple of 16`)
  }
  assert.deepEqual(SCENE_KINDS, ['h3', 'image', 'screen', 'title'])
})

test('[ipc:edits:meta] hands over the default tracks, the export formats and the loudness targets', () => {
  assertHandlerNames(assert, 'edits:meta', ['DEFAULT_TRACKS', 'FORMATS', 'LOUDNESS'])
  assert.deepEqual(DEFAULT_TRACKS.map((t) => t.id), ['T1', 'V2', 'V1', 'A1', 'A2'])
  assert.deepEqual(Object.keys(FORMATS), ['1080p', '4k', 'vertical', 'square'])
  for (const f of Object.values(FORMATS)) assert.ok(f.width > 0 && f.height > 0 && f.label)
  assert.deepEqual(Object.keys(LOUDNESS), ['web', 'tv', 'off'])
  assert.equal(LOUDNESS.web.lufs, -14)
  assert.equal(LOUDNESS.tv.lufs, -23)
})

test('[ipc:settings:get] reads the saved settings and tells the page which keys exist without sending the sealed values', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-settings-'))
  const sealed = Buffer.from('ok:the-key').toString('base64')
  writeSettings({ comfyApiKey: sealed, civitaiKey: null, promptEngine: 'codex' }, dir)
  const store = { isEncryptionAvailable: () => true, decryptString: (b) => b.toString().replace(/^ok:/, '') }
  const s = projectSettings(readSettings(dir), store, 'darwin')
  assert.equal(s.hasComfyKey, true)
  assert.equal(s.hasCivitaiKey, false)
  assert.equal(s.promptEngine, 'codex')
  assert.equal(JSON.stringify(s).includes(sealed), false, 'the sealed key is not in what the page gets')
  assert.equal('comfyApiKey' in s, false)
  assert.deepEqual(s.unreadable, [])
  fs.rmSync(dir, { recursive: true, force: true })
})
