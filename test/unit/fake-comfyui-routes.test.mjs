// The routes added to the fake ComfyUI for the feature test rig (task 4.1): every route IV Studio calls that the
// first fake did not answer. The list, from `rg` over src/ for path literals passed to the Comfy client, managerReq
// and a raw fetch to the ComfyUI address:
//   /experiment/models            civitai.js:192, models.js:15, studio.js:569, training.js:752, main/index.js:1068,1132
//   /internal/folder_paths        nodepacks.js:35, main/index.js:1278, mcp/server.js:1016
//   /history?max_items=1          studio.js:403
//   /ws?clientId=…                studio.js:1139 (job progress), comfyupdate.js:117 (Manager's queue-done message)
//   /manager/version, /manager/policy/update, /manager/queue/{status,reset,update_all,update_comfyui,start},
//   /manager/reboot, /customnode/fetch_updates, /customnode/getlist, /comfyui_manager/comfyui_versions,
//   /snapshot/{getlist,save,restore}                      comfyupdate.js:56-254
//   node test/unit/fake-comfyui-routes.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { after, before, describe, test } from 'node:test'
import { Comfy } from '../../src/service/comfy.js'
import { checkUpdates, managerInfo, managerReq, restart, saveSnapshot, update } from '../../src/service/comfyupdate.js'
import { comfyPlace } from '../../src/service/nodepacks.js'
import { startFakeComfy } from '../fakes/comfyui.mjs'

describe('fake ComfyUI: more routes', () => {
  let fake, comfy
  before(async () => {
    fake = await startFakeComfy({ devices: 'mps', models: { loras: ['a.safetensors'], diffusion_models: ['big.safetensors'] } })
    comfy = new Comfy(fake.url)
  })
  after(async () => {
    await fake.close()
  })

  test('/experiment/models lists each model folder with the real folders behind it', async () => {
    const folders = await comfy.req('/experiment/models')
    const loras = folders.find((f) => f.name === 'loras')
    assert.ok(loras.folders.length >= 1)
    assert.ok(fs.existsSync(loras.folders[0]), 'the folder exists in the fake data folder')
  })

  test('/internal/folder_paths names custom_nodes and the model folders, all real folders', async () => {
    const paths = await comfy.req('/internal/folder_paths')
    assert.ok(fs.existsSync(paths.custom_nodes[0]))
    assert.ok(fs.existsSync(paths.diffusion_models[0]))
    const place = await comfyPlace(comfy, '')
    assert.equal(place.customNodes, paths.custom_nodes[0])
  })

  test('/history?max_items=1 returns only the newest job', async () => {
    await comfy.submit({ 1: { class_type: 'X', inputs: {} } })
    const b = await comfy.submit({ 1: { class_type: 'Y', inputs: {} } })
    const one = await comfy.req('/history?max_items=1')
    assert.deepEqual(Object.keys(one), [b])
  })

  test('a held job stays queued until it is released, then finishes', async () => {
    fake.holdNextPrompt(1)
    const id = await comfy.submit({ 1: { class_type: 'X', inputs: {} } })
    assert.equal((await comfy.queue()).queue_pending.length, 1)
    assert.deepEqual(await comfy.req(`/history/${id}`), {})
    fake.releaseHeld()
    assert.equal((await comfy.queue()).queue_pending.length, 0)
    assert.equal((await comfy.req(`/history/${id}`))[id].status.status_str, 'success')
  })

  test('a failed job ends in history with an error status and its message', async () => {
    fake.failNextPrompt('Out of memory')
    const id = await comfy.submit({ 1: { class_type: 'X', inputs: {} } })
    const h = (await comfy.req(`/history/${id}`))[id]
    assert.equal(h.status.status_str, 'error')
    assert.equal(h.status.completed, false)
    assert.match(JSON.stringify(h.status.messages), /Out of memory/)
    assert.deepEqual(h.outputs, {})
  })

  describe('ComfyUI-Manager', () => {
    test('/manager/version and policy answer plain text, and managerInfo reads them', async () => {
      assert.equal(await managerReq(comfy, '/manager/version', { text: true }), 'V3.37')
      assert.deepEqual(await managerInfo(comfy), { present: true, version: 'V3.37', policy: 'stable' })
    })

    test('with Manager absent its routes answer 404, and managerInfo says so', async () => {
      fake.setManager({ present: false })
      assert.deepEqual(await managerInfo(comfy), { present: false, version: null, policy: null })
      fake.setManager({ present: true })
    })

    test('with a restrictive security level its routes answer 403', async () => {
      fake.setManager({ security: true })
      await assert.rejects(managerReq(comfy, '/manager/queue/status'), /security level/)
      fake.setManager({ security: false })
    })

    test('checkUpdates reads versions and the packs with updates', async () => {
      fake.setManager({ current: 'v0.3.99', versions: ['v0.3.99', 'v0.4.2', 'nightly'], packs: { 'pack-a': { id: 'pack-a', title: 'Pack A', state: 'enabled', 'update-state': 'true' }, 'pack-b': { id: 'pack-b', title: 'Pack B', state: 'enabled', 'update-state': 'false' } } })
      const r = await checkUpdates(comfy)
      assert.equal(r.comfyui.latest, 'v0.4.2')
      assert.equal(r.comfyui.behind, true)
      assert.deepEqual(r.packs.withUpdates, [{ id: 'pack-a', title: 'Pack A' }])
      assert.equal(r.packs.installed, 2)
    })

    test('a snapshot is saved and listed', async () => {
      const before = (await managerReq(comfy, '/snapshot/getlist')).items.length
      const name = await saveSnapshot(comfy)
      assert.ok(name)
      assert.equal((await managerReq(comfy, '/snapshot/getlist')).items.length, before + 1)
      await managerReq(comfy, '/snapshot/restore', { method: 'POST', json: { target: name } })
      assert.equal(fake.manager.restored, name)
    })

    test('update runs the queue, hears the done message on /ws, and reports each pack', async () => {
      const progress = []
      // update() leaves a 10 s timer pending after it hears the done message (comfyupdate.js, the race with
      // listener.done); unref the long ones so the test process isn't held open for 10 s
      const realSetTimeout = globalThis.setTimeout
      globalThis.setTimeout = (fn, ms, ...a) => {
        const t = realSetTimeout(fn, ms, ...a)
        if (ms >= 10000) t.unref()
        return t
      }
      let r
      try {
        r = await update(comfy, { onProgress: (p) => progress.push(p.phase), every: 20 })
      } finally {
        globalThis.setTimeout = realSetTimeout
      }
      assert.equal(r.reported, true)
      assert.deepEqual(r.results.map((x) => [x.pack, x.status]), [['pack-a', 'updated'], ['pack-b', 'current']])
      assert.ok(progress.includes('snapshot'))
      assert.deepEqual(fake.requests.filter((q) => q.method === 'POST' && q.path.startsWith('/manager/queue/')).map((q) => q.path).slice(-4), ['/manager/queue/reset', '/manager/queue/update_all', '/manager/queue/update_comfyui', '/manager/queue/start'])
    })

    test('update refuses while a job is queued', async () => {
      fake.holdNextPrompt(1)
      await comfy.submit({ 1: { class_type: 'X', inputs: {} } })
      await assert.rejects(update(comfy, { every: 20 }), /rendering|queued|busy/i)
      fake.releaseHeld()
    })

    test('downAfterReboot makes /system_stats answer 503 that many times after /manager/reboot, then 200 again', async () => {
      fake.setManager({ downAfterReboot: 2 })
      try {
        await managerReq(comfy, '/manager/reboot', { method: 'POST', json: {} })
        assert.equal((await fetch(`${fake.url}/system_stats`)).status, 503)
        assert.equal((await fetch(`${fake.url}/system_stats`)).status, 503)
        assert.equal((await fetch(`${fake.url}/system_stats`)).status, 200)
      } finally {
        fake.setManager({ downAfterReboot: 0, rebootDown: 0 })
      }
    })

    test('restart posts /manager/reboot and waits for ComfyUI to answer again', async () => {
      const r = await restart(comfy, { up: async () => false, wait: async () => {} })
      assert.ok(r.version)
      assert.equal(fake.requests.at(-2).path, '/manager/reboot')
    })
  })
})

describe('fake ComfyUI: registration with the test guard', () => {
  test('it registers its ephemeral port, so a fetch to it works and 8188 stays refused', async () => {
    const f = await startFakeComfy()
    try {
      assert.equal((await fetch(`${f.url}/system_stats`)).status, 200)
      await assert.rejects(fetch('http://127.0.0.1:8188/system_stats'), /8188/)
    } finally {
      await f.close()
    }
    await assert.rejects(fetch(`${f.url}/system_stats`), new RegExp(String(f.port)))
  })
})
