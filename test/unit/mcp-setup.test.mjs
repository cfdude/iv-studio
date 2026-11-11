// MCP tools for setup, updates, node packs, models and hardware (task 5.2), called through the real MCP server on
// source under the test guard, against the fake ComfyUI (design D1, D8). One fake and one server for the file.
//   node --test test/unit/mcp-setup.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { startFakeComfy } from '../fakes/comfyui.mjs'
import { startMcp } from '../fakes/mcp.mjs'

const H3_MODEL = 'Minimax H3\\minimax_h3_fl2va_pruned_int8_convrot.safetensors'
const combo = (name, options) => ({ input: { required: { [name]: [options] } } })

describe('MCP setup, update, model and hardware tools', () => {
  let fake, mcp
  const call = (name, args = {}) => mcp.client.callTool({ name, arguments: args })
  const ok = async (name, args = {}) => {
    const r = await call(name, args)
    assert.ok(!r.isError, `${name}: ${JSON.stringify(r.content)}`)
    return r.structuredContent
  }
  const settingsFile = () => JSON.parse(fs.readFileSync(path.join(mcp.dataDir, 'settings.json'), 'utf8'))
  const posts = (prefix) => fake.requests.filter((q) => q.method === 'POST' && q.path.startsWith(prefix)).map((q) => q.path)

  before(async () => {
    fake = await startFakeComfy({ devices: 'mps' })
    // after /manager/reboot ComfyUI answers 503 once, so restart() sees it go down and come back
    fake.setManager({ downAfterReboot: 1 })
    mcp = await startMcp({ comfyUrl: fake.url })
  })
  after(async () => {
    await mcp?.close()
    await fake?.close()
  })

  // ---------- check_setup ----------
  test('[mcp:check_setup] reports ComfyUI, an Apple GPU that passes, the missing built-in upscaler and every missing node pack', async () => {
    const r = await ok('check_setup')
    assert.equal(r.ready, false)
    const byId = Object.fromEntries(r.items.map((i) => [i.id, i]))
    assert.equal(byId.comfyui.status, 'ok')
    assert.match(byId.comfyui.detail, new RegExp(`Version 0\\.3\\.99 at ${fake.url}`))
    assert.equal(byId.gpu.status, 'ok')
    assert.match(byId.gpu.detail, /Apple GPU · 64 GB unified memory/)
    // an Apple GPU needs ComfyUI's built-in H3 upscaler (0.44+); this fake is 0.3.99 and lists neither node
    assert.equal(byId['gpu-upscaler'].status, 'missing')
    assert.equal(byId['gpu-upscaler'].label, 'ComfyUI version')
    assert.match(byId['gpu-upscaler'].fix, /Update ComfyUI to 0\.44 or newer/)
    const packs = r.items.filter((i) => i.kind === 'node_pack' && i.status === 'missing')
    assert.ok(packs.length >= 8, `only ${packs.length} missing packs`)
    assert.match(byId['pack:VideoHelperSuite'].detail, /Missing nodes: VHS_VideoCombine/)
    assert.equal(byId['pack:VideoHelperSuite'].dir, 'ComfyUI-VideoHelperSuite')
  })

  test('[mcp:check_setup] drops the upscaler item once ComfyUI lists the built-in H3 upscaler nodes', async () => {
    fake.setObjectInfo({ MiniMaxH3LatentUpscaleWithModel: { input: { required: {} } }, LatentUpscaleModelLoader: { input: { required: {} } } })
    try {
      const r = await ok('check_setup')
      assert.equal(r.items.find((i) => i.id === 'gpu').status, 'ok')
      assert.equal(r.items.find((i) => i.id === 'gpu-upscaler'), undefined)
    } finally {
      fake.setObjectInfo({})
    }
  })

  test('[mcp:check_setup][ipc:setup:check] counts a node pack as installed once ComfyUI lists its nodes', async () => {
    fake.setObjectInfo({ VHS_VideoCombine: { input: { required: {} } }, VHS_SelectFilename: { input: { required: {} } } })
    try {
      const r = await ok('check_setup')
      const vhs = r.items.find((i) => i.id === 'pack:VideoHelperSuite')
      assert.equal(vhs.status, 'ok')
      assert.equal(r.items.find((i) => i.id === 'pack:rgthree-comfy').status, 'missing')
    } finally {
      fake.setObjectInfo({})
    }
  })

  test('[mcp:check_setup] says ComfyUI is missing, with the reason, when nothing answers', async () => {
    const gone = await startFakeComfy({ devices: 'mps' })
    const url = gone.url
    await gone.close()
    const lonely = await startMcp({ comfyUrl: url })
    try {
      const r = await lonely.client.callTool({ name: 'check_setup', arguments: {} })
      assert.ok(!r.isError, JSON.stringify(r.content))
      assert.equal(r.structuredContent.ready, false)
      assert.equal(r.structuredContent.items.length, 1)
      assert.equal(r.structuredContent.items[0].id, 'comfyui')
      assert.equal(r.structuredContent.items[0].status, 'missing')
      assert.ok(r.structuredContent.items[0].detail.length > 0)
    } finally {
      await lonely.close()
    }
  })

  // ---------- install_node_packs: spawns git (and pip for requirements), so no row id (gaps: spawns git) ----------
  test('guard refuses git for install_node_packs, and the packs it cannot download come back failed', async () => {
    const r = await call('install_node_packs')
    assert.ok(!r.isError, JSON.stringify(r.content))
    const refusals = await mcp.refusals()
    assert.ok(refusals.some((x) => x.command === 'git'), `no git refusal in ${JSON.stringify(refusals)}`)
    const { results, customNodes } = r.structuredContent
    assert.equal(customNodes, path.join(fake.dataDir, 'custom_nodes'))
    // the pack IV Studio ships is copied into custom_nodes; the others need a download, which the guard refuses
    assert.equal(results.find((x) => x.dir === 'ComfyUI-IV-Studio').status, 'installed')
    assert.ok(fs.existsSync(path.join(customNodes, 'ComfyUI-IV-Studio')))
    const failed = results.filter((x) => x.status === 'failed')
    assert.ok(failed.length >= 8)
    assert.ok(failed.every((x) => /refused a fetch/.test(x.detail)), JSON.stringify(failed[0]))
    // run again: the folders that went in are left alone
    const installed = results.filter((x) => x.status === 'installed').map((x) => x.dir)
    const again = await ok('install_node_packs')
    for (const dir of installed) assert.equal(again.results.find((x) => x.dir === dir).status, 'skipped')
    for (const dir of installed) fs.rmSync(path.join(customNodes, dir), { recursive: true, force: true })
  })

  // ---------- check_comfy_updates (ComfyUI-Manager) ----------
  test('[mcp:check_comfy_updates][ipc:setup:updates:check] compares ComfyUI with its newest stable release and lists packs with updates', async () => {
    const r = await ok('check_comfy_updates')
    assert.deepEqual(r.manager, { present: true, version: 'V3.37', policy: 'stable' })
    assert.deepEqual(r.comfyui, { current: 'v0.3.99', latest: 'v0.4.2', behind: true })
    assert.deepEqual(r.packs, { installed: 2, withUpdates: [{ id: 'pack-a', title: 'Pack A' }] })
    assert.equal(r.desktop, false)
    assert.equal(r.last, null)
    assert.ok(posts('/customnode/fetch_updates').length >= 1, 'Manager was asked to fetch the remotes first')
  })

  test('[mcp:check_comfy_updates] says ComfyUI is current when it is on the newest release', async () => {
    fake.setManager({ current: 'v0.4.2' })
    try {
      assert.equal((await ok('check_comfy_updates')).comfyui.behind, false)
    } finally {
      fake.setManager({ current: 'v0.3.99' })
    }
  })

  test('[mcp:check_comfy_updates] answers manager.present false when ComfyUI-Manager is not installed', async () => {
    fake.setManager({ present: false })
    try {
      const r = await ok('check_comfy_updates')
      assert.deepEqual(r.manager, { present: false, version: null, policy: null })
      assert.equal(r.last, null)
    } finally {
      fake.setManager({ present: true })
    }
  })

  // ---------- update_comfy and undo_comfy_update (ComfyUI-Manager, no git or pip of ours) ----------
  test('[mcp:undo_comfy_update] refuses when there is no update to undo', async () => {
    const r = await call('undo_comfy_update')
    assert.equal(r.isError, true)
    assert.match(r.content[0].text, /no update to undo/)
    assert.deepEqual(posts('/snapshot/restore'), [])
  })

  test('[mcp:update_comfy] refuses while ComfyUI has a job queued, and changes nothing', async () => {
    fake.holdNextPrompt(1)
    await fetch(`${fake.url}/prompt`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: { 1: { class_type: 'X', inputs: {} } } }) })
    try {
      const r = await call('update_comfy')
      assert.equal(r.isError, true)
      assert.match(r.content[0].text, /rendering|queued/i)
      assert.deepEqual(posts('/snapshot/save'), [])
    } finally {
      fake.releaseHeld()
    }
  })

  test('[mcp:update_comfy] says so when ComfyUI-Manager is not installed', async () => {
    fake.setManager({ present: false })
    try {
      const r = await call('update_comfy')
      assert.equal(r.isError, true)
      assert.match(r.content[0].text, /Manager/)
      assert.deepEqual(posts('/manager/queue/'), [])
    } finally {
      fake.setManager({ present: true })
    }
  })

  test('[mcp:update_comfy][ipc:setup:updates:run] saves a snapshot, updates every pack through Manager, restarts and records it for undo', async () => {
    // a plain folder Manager's snapshot cannot track, as IV Studio's own pack is
    fs.mkdirSync(path.join(fake.dataDir, 'custom_nodes', 'PlainPack'), { recursive: true })
    const rebootsBefore = fake.manager.rebooted
    const r = await ok('update_comfy')
    assert.equal(r.snapshot, 'snapshot-1')
    assert.deepEqual(r.results.map((x) => [x.pack, x.status]), [['pack-a', 'updated'], ['pack-b', 'current']])
    assert.equal(r.reported, true)
    assert.equal(r.comfyuiBefore, '0.3.99')
    assert.equal(r.comfyuiAfter, '0.3.99')
    assert.deepEqual(r.enabledPacks, ['PlainPack'])
    assert.equal(r.customNodes, path.join(fake.dataDir, 'custom_nodes'))
    assert.deepEqual(posts('/manager/queue/'), ['/manager/queue/reset', '/manager/queue/update_all', '/manager/queue/update_comfyui', '/manager/queue/start'])
    assert.equal(fake.manager.rebooted, rebootsBefore + 1)
    // what undo needs is saved in IV Studio's data folder
    const record = JSON.parse(fs.readFileSync(path.join(mcp.dataDir, 'comfy-updates.json'), 'utf8'))
    assert.equal(record.snapshot, 'snapshot-1')
    assert.equal(record.restorePending, undefined)
    // and the next check shows it
    assert.equal((await ok('check_comfy_updates')).last.snapshot, 'snapshot-1')
  })

  test('[mcp:undo_comfy_update][ipc:setup:updates:undo] restores the snapshot, restarts, and switches back on a pack the restore turned off', async () => {
    const nodes = path.join(fake.dataDir, 'custom_nodes')
    // what Manager's restore does to a folder its snapshot does not track
    fs.mkdirSync(path.join(nodes, '.disabled'), { recursive: true })
    fs.renameSync(path.join(nodes, 'PlainPack'), path.join(nodes, '.disabled', 'PlainPack'))
    const rebootsBefore = fake.manager.rebooted
    const r = await ok('undo_comfy_update')
    assert.equal(r.via, 'api')
    assert.equal(r.snapshot, 'snapshot-1')
    assert.deepEqual(r.reenabled, ['PlainPack'])
    assert.ok(fs.existsSync(path.join(nodes, 'PlainPack')), 'the folder is back in custom_nodes')
    assert.equal(fake.manager.restored, 'snapshot-1')
    // one restart after the restore was asked for, and one more for the pack switched back on
    assert.equal(fake.manager.rebooted, rebootsBefore + 2)
  })

  // ---------- hardware ----------
  test('[mcp:scan_hardware] reads this PC, tiers an Apple Silicon Mac by its unified memory and recommends the cloud for any other machine with no NVIDIA card', async () => {
    const r = await ok('scan_hardware')
    assert.ok(r.scan.cpu.threads > 0)
    assert.ok(r.scan.ram > 0)
    assert.ok(Array.isArray(r.scan.drives) && r.scan.drives.length >= 1)
    // the card is read with nvidia-smi (not on a Mac, refused by the guard elsewhere): no card is found
    assert.deepEqual(r.scan.gpus, [])
    assert.equal(r.scan.installs.comfyRunning, true)
    assert.equal(r.scan.installs.comfyFound, true)
    assert.equal(r.scan.installs.modelsKnown, true)
    assert.ok(r.scan.installs.modelSizes.fl2va > 0)
    // the scan is of the machine running the tests, so the expected tier is worked out from what it reports
    const GB = 1024 ** 3
    const appleSilicon = r.scan.os.platform === 'darwin' && r.scan.os.arch === 'arm64'
    const expected = !appleSilicon ? 'cloud' : r.scan.ram >= 96 * GB ? 'all' : r.scan.ram >= 64 * GB ? 'most' : r.scan.ram >= 32 * GB ? 'some' : 'cloud'
    assert.equal(r.recommendations.tier.id, expected)
    assert.equal(r.recommendations.tier.renderOn, expected === 'cloud' ? 'cloud' : expected === 'all' ? 'local' : 'both')
    assert.ok(r.recommendations.verdicts.some((v) => v.id === 'gpu'))
  })

  test('[mcp:scan_hardware] puts the models drive at the folder ComfyUI keeps its diffusion models in', async () => {
    fake.setModels({ diffusion_models: [] })
    try {
      const r = await ok('scan_hardware')
      assert.equal(r.scan.modelsDrive.folder, path.join(fake.dataDir, 'models', 'diffusion_models'))
      assert.ok(r.scan.modelsDrive.free > 0)
    } finally {
      fake.setModels({})
    }
  })

  test('[mcp:free_memory] asks ComfyUI to unload and says whether a render is still running', async () => {
    const before = posts('/free').length
    const idle = await ok('free_memory')
    assert.equal(idle.comfyui, 'asked to unload')
    assert.equal(idle.voiceEngine, 'stopped')
    assert.deepEqual(idle.ollama, [])
    assert.equal(idle.renderRunning, false)
    assert.equal(posts('/free').length, before + 1)
    fake.state.running = [[1, 'p1', {}, {}, []]]
    try {
      assert.equal((await ok('free_memory')).renderRunning, true)
    } finally {
      fake.state.running = []
    }
  })

  // ---------- samplers, models and choices read from ComfyUI's node list ----------
  test('[mcp:list_samplers] lists the samplers and schedulers ComfyUI offers, with IV Studio defaults', async () => {
    fake.setObjectInfo({ KSamplerSelect: combo('sampler_name', ['euler', 'er_sde']), BasicScheduler: combo('scheduler', ['simple', 'beta']) })
    try {
      assert.deepEqual(await ok('list_samplers'), { samplers: ['euler', 'er_sde'], schedulers: ['simple', 'beta'], defaults: { sampler: 'er_sde', scheduler: 'beta' } })
    } finally {
      fake.setObjectInfo({})
    }
  })

  test('[mcp:list_samplers] lists none when ComfyUI has neither node', async () => {
    const r = await ok('list_samplers')
    assert.deepEqual(r.samplers, [])
    assert.deepEqual(r.schedulers, [])
    assert.equal(r.defaults.sampler, 'er_sde')
  })

  test('[mcp:list_h3_models][ipc:models:h3] lists the H3 files ComfyUI has, each workflow default, and the pick from settings', async () => {
    fake.setObjectInfo({ UNETLoader: combo('unet_name', [H3_MODEL, 'flux1-dev.safetensors']) })
    try {
      const r = await ok('list_h3_models')
      assert.deepEqual(r.models, [H3_MODEL])
      assert.deepEqual(Object.keys(r.defaults).sort(), ['continue', 'frames', 'reference', 'retake', 'take', 'text'])
      assert.match(r.defaults.text, /fl2va/)
      assert.match(r.defaults.reference, /ref2va/)
      assert.deepEqual(r.chosen, {})
    } finally {
      fake.setObjectInfo({})
    }
  })

  test('[mcp:set_workflow_model] saves the model for one workflow in settings, and null goes back to the default', async () => {
    fake.setObjectInfo({ UNETLoader: combo('unet_name', [H3_MODEL]) })
    try {
      assert.deepEqual(await ok('set_workflow_model', { workflow: 'text', model: H3_MODEL }), { chosen: { text: H3_MODEL } })
      assert.deepEqual(settingsFile().models, { text: H3_MODEL })
      assert.deepEqual((await ok('list_h3_models')).chosen, { text: H3_MODEL })
      assert.deepEqual(await ok('set_workflow_model', { workflow: 'text', model: null }), { chosen: {} })
      assert.deepEqual(settingsFile().models, {})
    } finally {
      fake.setObjectInfo({})
    }
  })

  test('[mcp:set_workflow_model] refuses a model ComfyUI does not have, and a workflow that does not exist', async () => {
    fake.setObjectInfo({ UNETLoader: combo('unet_name', [H3_MODEL]) })
    try {
      const unknown = await call('set_workflow_model', { workflow: 'frames', model: 'not-a-model.safetensors' })
      assert.equal(unknown.isError, true)
      assert.match(unknown.content[0].text, /no H3 model "not-a-model.safetensors"/)
      const bad = await call('set_workflow_model', { workflow: 'sideways', model: null })
      assert.equal(bad.isError, true)
      assert.match(bad.content[0].text, /workflow/)
      assert.equal(settingsFile().models?.frames, undefined)
    } finally {
      fake.setObjectInfo({})
    }
  })

  test('[mcp:list_choices] lists the character LoRAs and RefMods ComfyUI can load, without the none entry', async () => {
    fake.setObjectInfo({
      LoraLoaderModelOnly: combo('lora_name', ['tess.safetensors', 'maya.safetensors']),
      MiniMaxH3RefModsLoader: combo('mod_1', ['(none)', 'characters/maya_ab12cd'])
    })
    try {
      assert.deepEqual(await ok('list_choices'), { loras: ['tess.safetensors', 'maya.safetensors'], refmods: ['characters/maya_ab12cd'] })
    } finally {
      fake.setObjectInfo({})
    }
  })

  test('[mcp:list_choices] lists nothing when ComfyUI has no such nodes', async () => {
    assert.deepEqual(await ok('list_choices'), { loras: [], refmods: [] })
  })
})
