// Setup and the node-pack installer on the two places a pack goes wrong that isn't "missing": a pack for CUDA only
// (SeedVR2) on an Apple GPU, and a pack whose folder is there but ComfyUI couldn't load it after a restart.
//   node --test test/unit/setup-packs.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { Comfy } from '../../src/service/comfy.js'
import { installRequirements, missingPacks } from '../../src/service/nodepacks.js'
import { checkSetup } from '../../src/service/setup.js'
import { startFakeComfy } from '../fakes/comfyui.mjs'

const template = JSON.parse(fs.readFileSync('resources/workflows/iv_studio_api.json', 'utf8'))
const manifest = JSON.parse(fs.readFileSync('resources/models.json', 'utf8'))
const seedvr = manifest.node_packs.find((p) => p.dir === 'seedvr2_videoupscaler')

describe('SeedVR2 pack is CUDA only', () => {
  test('the manifest marks it', () => {
    assert.equal(seedvr.cudaOnly, true)
  })

  test('missingPacks leaves it out unless the GPU is CUDA', () => {
    assert.ok(!missingPacks(manifest, {}, { gpuKind: 'mps' }).some((p) => p === seedvr))
    assert.ok(missingPacks(manifest, {}, { gpuKind: 'cuda' }).some((p) => p === seedvr))
    assert.ok(missingPacks(manifest, {}).some((p) => p === seedvr), 'unknown GPU keeps today’s behaviour')
  })

  describe('checkSetup', () => {
    let fake, comfy
    before(async () => {
      fake = await startFakeComfy()
      comfy = new Comfy(fake.url)
    })
    after(() => fake.close())
    const item = async (devices) => {
      fake.setDevices(devices)
      const r = await checkSetup({ comfy, template, manifest, characters: [] })
      return r.items.find((i) => i.id === `pack:${seedvr.label}`)
    }
    test('an Apple GPU is never offered it, so it cannot be required or loop', async () => {
      assert.equal(await item('mps'), undefined)
    })
    test('a CUDA GPU is still told it is missing', async () => {
      const i = await item('cuda')
      assert.equal(i.status, 'warn')
      assert.match(i.detail, /Missing nodes/)
    })
  })
})

describe('a pack that is installed but did not load', () => {
  let fake, comfy, nodes
  before(async () => {
    fake = await startFakeComfy({ devices: 'cuda' })
    comfy = new Comfy(fake.url)
    nodes = (await comfy.req('/internal/folder_paths')).custom_nodes[0]
  })
  after(() => fake.close())
  const dir = 'seedvr2_videoupscaler'
  const item = async () => (await checkSetup({ comfy, template, manifest, characters: [] })).items.find((i) => i.id === `pack:${seedvr.label}`)

  test('a folder ComfyUI has not tried yet waits for a restart', async () => {
    fs.mkdirSync(path.join(nodes, dir), { recursive: true })
    fs.writeFileSync(path.join(nodes, dir, '__init__.py'), '')
    const i = await item()
    assert.equal(i.restartNeeded, true)
    assert.match(i.detail, /loads it when it restarts/)
  })

  test('a folder ComfyUI already tried to import says it failed to load and points at its log', async () => {
    fs.mkdirSync(path.join(nodes, dir, '__pycache__'), { recursive: true })
    fs.writeFileSync(path.join(nodes, dir, '__pycache__', '__init__.cpython-312.pyc'), '')
    const i = await item()
    assert.equal(i.loadFailed, true)
    assert.ok(!i.restartNeeded)
    assert.match(i.detail, /installed but failed to load/i)
    assert.match(i.fix, /ComfyUI’s log/)
  })
})

describe('installing a pack’s requirements', () => {
  const seen = []
  const runner = (fails = []) => async (cmd, args) => {
    seen.push([cmd, ...args])
    if (fails.some((f) => args.join(' ').includes(f))) throw new Error('no module named pip')
    return ''
  }
  const list = '/tmp/req.txt'
  test('pip when the Python has it', async () => {
    seen.length = 0
    const r = await installRequirements('/py', list, '/x', { run: runner(), which: () => '/bin/uv' })
    assert.equal(r, 'installed')
    assert.deepEqual(seen.at(-1).slice(0, 5), ['/py', '-m', 'pip', 'install', '-r'])
  })
  test('uv pip when it has none (a uv venv) and uv is on the PATH', async () => {
    seen.length = 0
    const r = await installRequirements('/py', list, '/x', { run: runner(['pip --version']), which: () => '/bin/uv' })
    assert.equal(r, 'installed')
    assert.deepEqual(seen.at(-1), ['/bin/uv', 'pip', 'install', '--python', '/py', '-r', list])
  })
  test('says so plainly when there is neither', async () => {
    seen.length = 0
    const r = await installRequirements('/py', list, '/x', { run: runner(['pip --version']), which: () => null })
    assert.match(r, /no pip/i)
    assert.match(r, /uv/)
    assert.equal(seen.length, 1)
  })
})
