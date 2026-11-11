// MCP tools upstream added in v1.1.3 for LoRAs: recommended_loras (the Recommended shelf), download_recommended_lora and
// set_lora_family, called through the real MCP server on source under the test guard, against a fake ComfyUI on an
// Apple GPU. Downloads go to the fake ComfyUI's loras folder; Hugging Face is never reached here (the guard refuses
// it). The checksummed download itself, with a stand-in for Hugging Face, is in mcp-edits-v113-outside.test.mjs.
// Upstream's own scripts for the same ground: test/recommended.mjs, test/lora-families.mjs.
//   node --test test/unit/mcp-edits-v113-loras.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { LORA_FAMILIES } from '../../src/service/civitai.js'
import { startFakeComfy } from '../fakes/comfyui.mjs'
import { startMcp } from '../fakes/mcp.mjs'

const combo = (names) => ({ input: { required: { lora_name: [names] } } })
const FAMILY_IDS = LORA_FAMILIES.map((f) => f.id)
const FPV = 'fpv_headbob_h3_50.safetensors'
const REPAIR = 'Motion_Repair_V2.safetensors'
const CAMERA = 'camera_motion_h3_lora_v1_3000_pruned.safetensors'

describe('MCP Recommended LoRA shelf and LoRA family tools', () => {
  let fake, mcp, lonely
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
  const shelf = async (who = mcp) => Object.fromEntries((await ok('recommended_loras', {}, who)).items.map((i) => [i.id, i]))
  const recommendedDir = () => path.join(fake.dataDir, 'models', 'loras', 'MiniMax H3', 'Recommended')
  // the file a finished download leaves, with the bytes it should keep
  const place = (file, bytes = 'already here') => {
    fs.mkdirSync(recommendedDir(), { recursive: true })
    fs.writeFileSync(path.join(recommendedDir(), file), bytes)
  }
  const settle = async (id, who = mcp) => {
    for (let i = 0; i < 200; i++) {
      const d = (await shelf(who))[id].download
      if (d && !['queued', 'downloading', 'verifying'].includes(d.status)) return d
      await new Promise((r) => setTimeout(r, 25))
    }
    throw new Error(`${id} never settled`)
  }

  before(async () => {
    fake = await startFakeComfy({ devices: 'mps', os: 'darwin', models: { loras: [] }, objectInfo: { LoraLoaderModelOnly: combo([]) } })
    mcp = await startMcp({ comfyUrl: fake.url })
    // a server whose ComfyUI cannot be asked (nothing listens there)
    lonely = await startMcp({ comfyUrl: 'http://127.0.0.1:9' })
  })
  after(async () => {
    await mcp?.close()
    await lonely?.close()
    await fake?.close()
  })

  // ---------- recommended_loras ----------
  test('[mcp:recommended_loras] lists the tested H3 LoRAs, each pinned to one file with its licence, trigger word, strength and how to prompt it', async () => {
    const { items } = await ok('recommended_loras')
    assert.deepEqual(items.map((i) => i.id), ['rec-camera-motion', 'rec-natural-face-speech', 'rec-motion-repair', 'rec-spatial-physics', 'rec-fpv', 'rec-orbit-360', 'rec-transformation', 'rec-turnaround'])
    for (const i of items) {
      assert.match(i.page, /^https:\/\/huggingface\.co\/[^/]+\/[^/]+$/, `${i.id} page`)
      assert.match(i.url, new RegExp(`^${i.page}/resolve/[0-9a-f]{40}/${i.match.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), `${i.id} is one file at one commit`)
      assert.match(i.sha256, /^[0-9a-f]{64}$/, `${i.id} pinned checksum`)
      assert.ok(i.size > 1e6, `${i.id} size`)
      assert.ok(i.what.length > 20 && i.how.length > 10, `${i.id} says what it does and how to prompt it`)
      assert.ok(i.strength > 0 && i.strength <= 1.5, `${i.id} strength`)
      assert.ok(['Apache-2.0', 'MiniMax H3 Community Licence'].includes(i.licence), `${i.id} licence ${i.licence}`)
      assert.ok(i.works.every((m) => ['text', 'frames', 'reference'].includes(m)))
      assert.equal(i.onDisk, null)
      assert.equal(i.download, null)
    }
    const by = Object.fromEntries(items.map((i) => [i.id, i]))
    assert.deepEqual([by['rec-camera-motion'].trigger, by['rec-camera-motion'].strength, by['rec-camera-motion'].licence, by['rec-camera-motion'].match], ['camera motion', 0.9, 'Apache-2.0', CAMERA])
    assert.equal(by['rec-transformation'].trigger, 'Tr@nsf0rmation_style')
    // Turnaround is for make_turnaround only: it names no mode a normal shot can use
    assert.deepEqual([by['rec-turnaround'].use, by['rec-turnaround'].works], ['turnaround', []])
    assert.ok(items.filter((i) => i.id !== 'rec-turnaround').every((i) => i.use === 'shot' && i.works.length > 0))
  })

  test('[mcp:recommended_loras] says which are already in this computer\'s ComfyUI, by file name in any folder, as the name generate_previews extraLoras takes', async () => {
    fake.setObjectInfo({ LoraLoaderModelOnly: combo([`MiniMax H3/Recommended/${FPV}`, `Somewhere else/${REPAIR}`, 'Windows\\Folder\\' + CAMERA, 'unrelated.safetensors', `${FPV}.bak`]) })
    const by = await shelf()
    assert.equal(by['rec-fpv'].onDisk, `MiniMax H3/Recommended/${FPV}`)
    assert.equal(by['rec-motion-repair'].onDisk, `Somewhere else/${REPAIR}`)
    assert.equal(by['rec-camera-motion'].onDisk, 'Windows\\Folder\\' + CAMERA, 'a backslash path too')
    assert.equal(by['rec-orbit-360'].onDisk, null)
    assert.equal(Object.values(by).filter((i) => i.onDisk).length, 3, 'a name that only starts like one is not it')
    fake.setObjectInfo({ LoraLoaderModelOnly: combo([]) })
    assert.equal(Object.values(await shelf()).filter((i) => i.onDisk).length, 0)
  })

  test('[mcp:recommended_loras] still lists the shelf, with nothing on disk, when ComfyUI cannot be asked', async () => {
    const { items } = await ok('recommended_loras', {}, lonely)
    assert.equal(items.length, 8)
    assert.ok(items.every((i) => i.onDisk === null && i.download === null))
  })

  // ---------- download_recommended_lora ----------
  test('[mcp:download_recommended_lora] refuses an id that is not on the shelf with exact words, and starts nothing', async () => {
    await fails('download_recommended_lora', { id: 'rec-nope' }, /^Unknown model "rec-nope"\.$/)
    await fails('download_recommended_lora', { id: 'camera_motion' }, /^Unknown model "camera_motion"\.$/)
    await fails('download_recommended_lora', {}, /id/)
    assert.ok(Object.values(await shelf()).every((i) => i.download === null), 'no download was recorded')
    assert.equal(fs.existsSync(recommendedDir()), false, 'no folder or file was made')
    assert.deepEqual(await mcp.refusals(), [], 'nothing reached out')
  })

  test('[mcp:download_recommended_lora] returns at once with the download queued, and recommended_loras follows it: a file already in place is kept, not fetched again', async () => {
    place(FPV, 'bytes the person already has')
    const started = await ok('download_recommended_lora', { id: 'rec-fpv' })
    assert.deepEqual(started, { status: 'queued', error: null })
    const done = await settle('rec-fpv')
    assert.equal(done.status, 'done')
    assert.equal(done.path, path.join(recommendedDir(), FPV), 'loras/MiniMax H3/Recommended in ComfyUI')
    assert.equal(fs.readFileSync(done.path, 'utf8'), 'bytes the person already has', 'not overwritten')
    assert.deepEqual(fs.readdirSync(recommendedDir()), [FPV], 'no .part file')
    // once ComfyUI lists it, the shelf names it for extraLoras
    fake.setObjectInfo({ LoraLoaderModelOnly: combo([`MiniMax H3/Recommended/${FPV}`]) })
    const by = await shelf()
    assert.equal(by['rec-fpv'].onDisk, `MiniMax H3/Recommended/${FPV}`)
    assert.equal(by['rec-fpv'].download.status, 'done')
    assert.equal(by['rec-camera-motion'].download, null, 'the others are untouched')
  })

  test('[mcp:download_recommended_lora] queues several one after another', async () => {
    place(REPAIR)
    place(CAMERA)
    const a = await ok('download_recommended_lora', { id: 'rec-motion-repair' })
    const b = await ok('download_recommended_lora', { id: 'rec-camera-motion' })
    assert.equal(a.status, 'queued')
    assert.ok(['queued', 'done'].includes(b.status))
    assert.equal((await settle('rec-motion-repair')).status, 'done')
    assert.equal((await settle('rec-camera-motion')).status, 'done')
  })

  test('[mcp:download_recommended_lora] when Hugging Face cannot be reached the download shows an error on the shelf, writes no file and can be asked for again', async () => {
    const first = await ok('download_recommended_lora', { id: 'rec-spatial-physics' })
    assert.equal(first.status, 'queued')
    const failed = await settle('rec-spatial-physics')
    assert.equal(failed.status, 'error')
    assert.equal(typeof failed.error, 'string')
    assert.ok(failed.error.length > 0)
    assert.equal(fs.existsSync(path.join(recommendedDir(), 'wushu_spatial_physics_clean_3000_pruned.safetensors')), false)
    assert.deepEqual(fs.readdirSync(recommendedDir()).filter((f) => f.endsWith('.part')), [], 'no partial file left')
    const again = await ok('download_recommended_lora', { id: 'rec-spatial-physics' })
    assert.deepEqual(again, { status: 'queued', error: null }, 'asked for again, it starts again')
    assert.equal((await settle('rec-spatial-physics')).status, 'error')
  })

  test('[mcp:download_recommended_lora] says so when ComfyUI has no loras models folder, and writes nothing', async () => {
    const bare = await startFakeComfy({ devices: 'mps', os: 'darwin', models: {} })
    const who = await startMcp({ comfyUrl: bare.url })
    try {
      assert.equal((await ok('download_recommended_lora', { id: 'rec-turnaround' }, who)).status, 'queued')
      const d = await settle('rec-turnaround', who)
      assert.deepEqual({ status: d.status, error: d.error }, { status: 'error', error: 'ComfyUI has no "loras" models folder.' })
      assert.equal(fs.existsSync(path.join(bare.dataDir, 'models', 'loras')), false)
    } finally {
      await who.close()
      await bare.close()
    }
  })

  // ---------- set_lora_family ----------
  const NAMES = ['MiniMax H3/tess/tess_mmh3-000040.safetensors', 'SDXL/ponystyle.safetensors', 'mystery.safetensors']
  const mine = async (args) => (await ok('list_my_loras', args)).items
  const family = async (name) => (await mine({ family: 'all' })).find((i) => i.name === name)

  test('[mcp:set_lora_family] sets the family of a LoRA IV Studio could not tell, and it moves into that family\'s list', async () => {
    fake.setObjectInfo({ LoraLoaderModelOnly: combo(NAMES) })
    assert.deepEqual((await mine({ family: 'all' })).map((i) => [i.name, i.family]), [[NAMES[0], 'h3'], [NAMES[1], 'sdxl'], [NAMES[2], null]], 'the guess from the folder and file name')
    assert.deepEqual((await mine({})).map((i) => i.name), [NAMES[0]], 'the H3 list by default')
    const r = await ok('set_lora_family', { name: 'mystery.safetensors', family: 'flux2' })
    assert.deepEqual(r, { family: 'flux2' })
    const it = await family('mystery.safetensors')
    assert.deepEqual([it.family, it.h3, it.prefs], ['flux2', false, { family: 'flux2' }])
    assert.deepEqual((await mine({ family: 'flux2' })).map((i) => i.name), ['mystery.safetensors'])
    assert.deepEqual((await mine({})).map((i) => i.name), [NAMES[0]], 'not in the H3 list')
    // h3 makes it an H3 LoRA
    await ok('set_lora_family', { name: 'mystery.safetensors', family: 'h3' })
    assert.deepEqual((await mine({})).map((i) => [i.name, i.h3]), [[NAMES[0], true], ['mystery.safetensors', true]])
  })

  test('[mcp:set_lora_family] overrides a wrong guess, and family null puts it back to the guess without losing its other settings', async () => {
    const tess = NAMES[0]
    await ok('set_lora_family', { name: tess, family: 'sdxl' })
    assert.equal((await family(tess)).family, 'sdxl', 'the person\'s choice beats the folder name')
    assert.ok(!(await mine({})).some((i) => i.name === tess), 'no longer an H3 LoRA')
    assert.equal((await family(tess)).h3, false)
    // another setting for the same LoRA lives beside the family
    const file = path.join(mcp.dataDir, 'loras', 'library.json')
    const lib = JSON.parse(fs.readFileSync(file, 'utf8'))
    lib.prefs[tess] = { ...lib.prefs[tess], favourite: true, strength: 0.7 }
    fs.writeFileSync(file, JSON.stringify(lib))
    const back = await ok('set_lora_family', { name: tess, family: null })
    assert.deepEqual(back, { favourite: true, strength: 0.7 }, 'the family key is gone, the rest stays')
    const it = await family(tess)
    assert.deepEqual([it.family, it.h3], ['h3', true], 'back to what the name says')
    // null on one that was never set changes nothing
    assert.deepEqual(await ok('set_lora_family', { name: NAMES[1], family: null }), {})
    assert.equal((await family(NAMES[1])).family, 'sdxl')
  })

  test('[mcp:set_lora_family] takes every family IV Studio runs, and refuses one it does not know before anything is saved', async () => {
    for (const id of FAMILY_IDS) assert.deepEqual(await ok('set_lora_family', { name: 'mystery.safetensors', family: id }), { family: id }, id)
    assert.deepEqual(FAMILY_IDS.slice(0, 3), ['h3', 'h3image', 'ltx'])
    const file = path.join(mcp.dataDir, 'loras', 'library.json')
    const before = fs.readFileSync(file, 'utf8')
    await fails('set_lora_family', { name: 'mystery.safetensors', family: 'dalle' }, /Invalid enum value\. Expected 'h3' \| 'h3image'.*received 'dalle'/)
    await fails('set_lora_family', { name: 'mystery.safetensors', family: 'H3' }, /Invalid enum value/)
    await fails('set_lora_family', { name: 'mystery.safetensors' }, /family/)
    await fails('set_lora_family', { family: 'h3' }, /name/)
    assert.equal(fs.readFileSync(file, 'utf8'), before, 'a refusal saved nothing')
    assert.equal((await family('mystery.safetensors')).family, FAMILY_IDS.at(-1))
  })
})
