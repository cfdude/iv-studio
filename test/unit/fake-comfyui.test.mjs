// The fake ComfyUI server (test/fakes/comfyui.mjs): every route IV Studio calls, driven through the real Comfy client.
//   node --test test/unit/fake-comfyui.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { Comfy } from '../../src/service/comfy.js'
import { DEVICE_PROFILES, startFakeComfy } from '../fakes/comfyui.mjs'

describe('fake ComfyUI', () => {
  let fake, comfy
  before(async () => {
    fake = await startFakeComfy()
    comfy = new Comfy(fake.url)
  })
  after(() => fake.close())

  test('listens on an ephemeral loopback port', () => {
    assert.match(fake.url, /^http:\/\/127\.0\.0\.1:\d+$/)
    assert.notEqual(new URL(fake.url).port, '8188')
  })

  test('/system_stats reports the cuda profile by default', async () => {
    const s = await comfy.systemStats()
    assert.equal(s.devices[0].type, 'cuda')
    assert.equal(Math.round(s.devices[0].vram_total / 1024 ** 3), 24)
    assert.ok(s.system.comfyui_version)
  })

  test('the devices profile can be switched to mps, and back', async () => {
    fake.setDevices('mps')
    assert.deepEqual((await comfy.systemStats()).devices, [DEVICE_PROFILES.mps])
    assert.equal(DEVICE_PROFILES.mps.vram_total, 68719476736)
    fake.setDevices('cuda')
    assert.equal((await comfy.systemStats()).devices[0].type, 'cuda')
  })

  test('/object_info and /object_info/<cls>', async () => {
    fake.setObjectInfo({ Foo: { input: { required: {} } }, Bar: { input: { required: {} } } })
    assert.deepEqual(Object.keys(await comfy.objectInfo()).sort(), ['Bar', 'Foo'])
    assert.deepEqual(Object.keys(await comfy.objectInfo('Foo')), ['Foo'])
    await assert.rejects(comfy.objectInfo('Nope'), /404/)
  })

  test('/prompt returns a prompt_id, records the graph, and fills /history', async () => {
    const graph = { 1: { class_type: 'SaveImage', inputs: {} } }
    const id = await comfy.submit(graph)
    assert.ok(id)
    assert.deepEqual(fake.prompts.at(-1).prompt, graph)
    const h = await comfy.history(id)
    assert.equal(h[id].status.completed, true)
    assert.ok(h[id].outputs)
  })

  test('/history lists everything; POST /history deletes', async () => {
    const id = await comfy.submit({ 1: { class_type: 'SaveImage', inputs: {} } })
    assert.ok(id in (await comfy.req('/history')))
    await comfy.deleteHistory([id])
    assert.deepEqual(await comfy.history(id), {})
  })

  test('/history/<id> for an unknown id is an empty object, like ComfyUI', async () => {
    assert.deepEqual(await comfy.history('does-not-exist'), {})
  })

  test('a test can script a prompt that stays queued, then cancel it', async () => {
    fake.holdNextPrompt()
    const id = await comfy.submit({ 1: { class_type: 'SaveImage', inputs: {} } })
    assert.deepEqual(await comfy.history(id), {})
    const q = await comfy.queue()
    assert.equal(q.queue_pending.length + q.queue_running.length, 1)
    assert.match(await comfy.cancel(id), /removed from queue|interrupted/)
    const after = await comfy.queue()
    assert.equal(after.queue_pending.length + after.queue_running.length, 0)
  })

  test('/free is logged with its body', async () => {
    await comfy.freeMemory()
    assert.ok(fake.requests.some((r) => r.method === 'POST' && r.path === '/free' && r.json.unload_models === true))
  })

  test('/upload/image takes a multipart file and answers name + subfolder', async () => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ivfake-')), 'ref.png')
    fs.writeFileSync(f, 'not really a png')
    assert.equal(await comfy.upload(f, 'iv_studio'), 'iv_studio/ref.png')
    assert.equal(fake.uploads.at(-1).name, 'ref.png')
    assert.equal(fake.uploads.at(-1).subfolder, 'iv_studio')
    assert.equal(fake.uploads.at(-1).size, 'not really a png'.length)
  })

  test('/view serves the canned file bytes', async () => {
    fake.setView(Buffer.from('PNGDATA'))
    const res = await fetch(comfy.viewUrl({ filename: 'a.png', subfolder: 'x' }))
    assert.equal(res.status, 200)
    assert.equal(await res.text(), 'PNGDATA')
  })

  test('/models lists folders and /models/<folder> lists files', async () => {
    fake.setModels({ loras: ['a.safetensors'], checkpoints: [] })
    assert.deepEqual(await comfy.req('/models'), ['loras', 'checkpoints'])
    assert.deepEqual(await comfy.req('/models/loras'), ['a.safetensors'])
  })

  test('a route can be forced to fail, to test error paths', async () => {
    fake.failRoute('/system_stats', 500, 'boom')
    await assert.rejects(comfy.systemStats(), /500/)
    fake.failRoute('/system_stats', null)
    assert.ok((await comfy.systemStats()).devices)
  })

  test('unknown routes answer 404', async () => {
    await assert.rejects(comfy.req('/nope'), /404/)
  })
})
