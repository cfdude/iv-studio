// Window channels added with upstream v1.1.3 around ComfyUI: restart, "Get ComfyUI for me", the Hugging Face token and
// the cloud's model prep. main (src/main/index.js) starts Electron and cannot be imported, so each test carries a copy of
// the handler's glue, pins the copy to main's source, and runs it on the real services with stand-ins on loopback.
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./test/fakes/guard.mjs --test test/unit/ipc-v113-comfy.test.mjs
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { ComfyInstaller, checkFolder, latestAsset, pickBuild, suggestFolder } from '../../src/service/comfyinstall.js'
import { comfyUp, isLocalUrl, waitDown, waitUp } from '../../src/service/comfylauncher.js'
import { managerReq } from '../../src/service/comfyupdate.js'
import { CloudPrep, cloudCatalog } from '../../src/service/cloudprep.js'
import { freeBytes } from '../../src/service/datafolder.js'
import { hfLoginFrom, hfToken, setSavedHfToken } from '../../src/service/models.js'
import { readSettings, writeSettings } from '../../src/service/paths.js'
import { startFakeComfy } from '../fakes/comfyui.mjs'
import { startFakeGithub } from '../fakes/outside.mjs'
import { registerPort, unregisterPort } from '../fakes/ports.mjs'
import { tempDirReal } from '../fakes/tmp.mjs'
import { assertCopiesMain, assertMainSends } from './main-source.mjs'

const tmp = () => tempDirReal('iv-v113-comfy-')
const resources = path.resolve('resources')

describe('restart ComfyUI', () => {
  let fake, dir
  before(async () => {
    fake = await startFakeComfy({ devices: 'mps', os: 'darwin' })
    dir = tmp()
    writeSettings({ comfyUrl: fake.url }, dir)
  })
  after(() => fake.close())

  // A copy of main's restartComfy up to the launcher fallback (which finds the program with `ps` and stops it: a real
  // system program the guard refuses). `send` collects what main sends to the window as comfy:state.
  const sent = []
  const send = (channel, payload) => sent.push([channel, payload])
  const restartComfy = async ({ force = false } = {}) => {
    const s = readSettings(dir)
    if (!isLocalUrl(s.comfyUrl) || s.target === 'cloud') throw new Error('ComfyUI isn’t on this computer (Settings → ComfyUI), so IV Studio can’t restart it.')
    const t0 = Date.now()
    if (!(await comfyUp(s.comfyUrl))) throw new Error('the test starts with ComfyUI up')
    if (!force) {
      const q = await fetch(`${s.comfyUrl}/queue`, { signal: AbortSignal.timeout(8000) }).then((r) => r.json()).catch(() => null)
      const busy = (q?.queue_running?.length || 0) + (q?.queue_pending?.length || 0)
      if (busy) {
        const err = new Error(`ComfyUI is working on ${busy} job${busy === 1 ? '' : 's'}. Restarting stops ${busy === 1 ? 'it' : 'them'}.`)
        err.code = 'busy'
        throw err
      }
    }
    send('comfy:state', { state: 'restarting', detail: 'Restarting ComfyUI' })
    let via = null
    const comfy = { url: s.comfyUrl, headers: (h = {}) => h }
    for (const route of ['/manager/reboot', '/v2/manager/reboot']) {
      try {
        await managerReq(comfy, route, { method: 'POST', json: {}, timeout: 8000 })
        via = 'manager'
      } catch (err) {
        if (err.code === 'missing') continue
        if (err.code === 'down' || /did not answer/.test(err.message)) via = 'manager' // the restart drops the connection
      }
      break
    }
    if (via === 'manager' && !(await waitDown(s.comfyUrl, { timeoutMs: 20000 }))) via = null
    if (via !== 'manager') throw new Error('the manager did not restart ComfyUI; the launcher fallback needs ps')
    await waitUp(s.comfyUrl)
    const seconds = Math.round((Date.now() - t0) / 1000)
    send('comfy:state', { state: 'up', detail: `ComfyUI restarted in ${seconds} s.` })
    return { restarted: true, via, seconds }
  }
  // main's handler wraps it: a busy ComfyUI comes back as { busy, message } for the window to ask about
  const handler = async (opts) => {
    try {
      return await restartComfy(opts || {})
    } catch (err) {
      if (err.code === 'busy') return { busy: true, message: err.message } // the window asks, then sends force
      throw err
    }
  }

  test('[ipc:comfy:restart] pins main\'s restart and answer-busy code to the copy', () => {
    assertCopiesMain(assert, 'comfy:restart', `try {
      return await restartComfy(opts || {})
    } catch (err) {
      if (err.code === 'busy') return { busy: true, message: err.message } // the window asks, then sends force
      throw err
    }`)
    assertMainSends(assert, "if (!isLocalUrl(s.comfyUrl) || s.target === 'cloud') throw new Error('ComfyUI isn’t on this computer (Settings → ComfyUI), so IV Studio can’t restart it.')")
    assertMainSends(assert, "const q = await fetch(`${s.comfyUrl}/queue`, { signal: AbortSignal.timeout(8000) }).then((r) => r.json()).catch(() => null)")
    assertMainSends(assert, "const busy = (q?.queue_running?.length || 0) + (q?.queue_pending?.length || 0)")
    assertMainSends(assert, "const err = new Error(`ComfyUI is working on ${busy} job${busy === 1 ? '' : 's'}. Restarting stops ${busy === 1 ? 'it' : 'them'}.`)")
    assertMainSends(assert, "for (const route of ['/manager/reboot', '/v2/manager/reboot']) {")
    assertMainSends(assert, "await managerReq(comfy, route, { method: 'POST', json: {}, timeout: 8000 })")
    assertMainSends(assert, "if (via === 'manager' && !(await waitDown(s.comfyUrl, { timeoutMs: 20000 }))) via = null")
    assertMainSends(assert, "return { restarted: true, via, seconds }")
  })

  test('[ipc:comfy:restart] asks first when ComfyUI has a job waiting, and does not touch it', async () => {
    fake.holdNextPrompt()
    const res = await fetch(`${fake.url}/prompt`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: { 1: { class_type: 'X', inputs: {} } } }) })
    assert.equal(res.status, 200)
    const before = fake.manager.rebooted
    const answer = await handler(undefined)
    assert.deepEqual(answer, { busy: true, message: 'ComfyUI is working on 1 job. Restarting stops it.' })
    assert.equal(fake.manager.rebooted, before, 'ComfyUI-Manager was not asked to restart')
    assert.equal(sent.length, 0, 'the window was not told it is restarting')
  })

  test('[ipc:comfy:restart] restarts through ComfyUI-Manager when forced, waits for it to go down and come back, and tells the window', async () => {
    fake.manager.downAfterReboot = 2
    const answer = await handler({ force: true })
    assert.equal(answer.restarted, true)
    assert.equal(answer.via, 'manager')
    assert.equal(typeof answer.seconds, 'number')
    assert.equal(fake.manager.rebooted, 1)
    assert.deepEqual(sent.map(([c, p]) => [c, p.state]), [['comfy:state', 'restarting'], ['comfy:state', 'up']])
    assert.match(sent[1][1].detail, /^ComfyUI restarted in \d+ s\.$/)
    fake.releaseHeld()
    sent.length = 0
    // with nothing waiting it goes straight through, no force needed
    fake.manager.downAfterReboot = 1
    const again = await handler({})
    assert.equal(again.restarted, true)
    assert.equal(fake.manager.rebooted, 2)
  })

  test('[ipc:comfy:restart] refuses a cloud target, since there is no ComfyUI on this computer to restart', async () => {
    writeSettings({ target: 'cloud' }, dir)
    try {
      await assert.rejects(handler({ force: true }), /isn’t on this computer/)
    } finally {
      writeSettings({ target: 'local' }, dir)
    }
  })
})

describe('Get ComfyUI for me', () => {
  const winScan = (extra = {}) => ({ os: { platform: 'win32' }, gpus: [{ vendor: 'nvidia', name: 'RTX 4090', vram: 24e9, driver: '621.01', computeCap: 8.9 }], drives: [], ...extra })
  const body = Buffer.alloc(300 * 1024, 7)
  const sum = createHash('sha256').update(body).digest('hex')
  let github, files, folder, redirect
  before(async () => {
    // the download server: sends the first half at once and the rest after `gap` ms, or stalls after the first half when `stall` is set
    files = await new Promise((resolve) => {
      const state = { gap: 30, stall: false, hits: 0 }
      const server = http.createServer((req, res) => {
        state.hits++
        const half = Math.floor(body.length / 2)
        res.writeHead(200, { 'Content-Length': body.length })
        res.write(body.subarray(0, half))
        if (state.stall) return // never finishes: the test cancels
        setTimeout(() => res.end(body.subarray(half)), state.gap)
      })
      server.listen(0, '127.0.0.1', () => {
        registerPort(server.address().port)
        resolve({ server, state, url: `http://127.0.0.1:${server.address().port}`, close: () => (unregisterPort(server.address().port), server.closeAllConnections?.(), new Promise((r) => server.close(r))) })
      })
    })
    github = await startFakeGithub({
      releases: {
        tag_name: 'v0.44.0',
        html_url: 'https://github.com/Comfy-Org/ComfyUI/releases/tag/v0.44.0',
        assets: [
          { name: 'ComfyUI_windows_portable_nvidia.7z', size: body.length, digest: `sha256:${sum}`, browser_download_url: `${files.url}/ComfyUI_windows_portable_nvidia.7z` },
          { name: 'ComfyUI_windows_portable_nvidia_cu126.7z', size: 10, digest: `sha256:${'0'.repeat(64)}`, browser_download_url: `${files.url}/cu126.7z` }
        ]
      }
    })
    // the releases address is fixed in the service; the stand-in answers for it
    redirect = (url, init) => fetch(String(url).replace('https://api.github.com', github.url), init)
    folder = tmp()
  })
  after(async () => {
    await github.close()
    await files.close()
  })

  // main's installPlan, with the scan handed in (main's comes from scanHardware and Electron's GPU report) and the
  // releases fetch pointed at the stand-in
  const installPlan = async (scan) => {
    const build = pickBuild(scan)
    let asset = null
    if (build.ok) asset = await latestAsset(build.asset, { fetchImpl: redirect }).catch((err) => ({ error: err.message }))
    return { build, asset, scan }
  }

  test('[ipc:comfy:installPlan] names the official build for this card, the newest release\'s file with its size and checksum, and a roomy empty folder', async () => {
    assertMainSends(assert, `const build = pickBuild(scan)
    let asset = null
    if (build.ok) asset = await latestAsset(build.asset).catch((err) => ({ error: err.message }))
    return { build, asset, scan }`)
    assertMainSends(assert, `const folder = suggestFolder(scan.drives || [])
    return {
      build,
      asset,
      folder,
      free: folder ? freeBytes(folder) : null,
      state: comfyInstaller.state,`)
    const root = tmp()
    const { build, asset, scan } = await installPlan(winScan({ drives: [{ path: root, free: 500e9 }, { path: 'Z:\\', free: 10e9 }] }))
    assert.equal(build.ok, true)
    assert.equal(build.asset, 'ComfyUI_windows_portable_nvidia.7z')
    assert.deepEqual({ version: asset.version, size: asset.size, sha256: asset.sha256, name: asset.name }, { version: 'v0.44.0', size: body.length, sha256: sum, name: 'ComfyUI_windows_portable_nvidia.7z' })
    assert.equal(asset.url, `${files.url}/ComfyUI_windows_portable_nvidia.7z`)
    const where = suggestFolder(scan.drives || [])
    assert.equal(where, path.join(root, 'ComfyUI'))
    assert.ok(freeBytes(where) > 0, 'the free space of the suggested folder is read from the disk it is on')
    // an older card gets the CUDA 12.6 build, and a Mac gets the reason instead of a download
    const old = await installPlan(winScan({ gpus: [{ vendor: 'nvidia', name: 'GTX 1080', driver: '551.86', computeCap: 6.1 }] }))
    assert.equal(old.asset.name, 'ComfyUI_windows_portable_nvidia_cu126.7z')
    const mac = await installPlan({ os: { platform: 'darwin' }, gpus: [], drives: [] })
    assert.equal(mac.build.ok, false)
    assert.match(mac.build.reason, /ComfyUI Desktop/)
    assert.equal(mac.asset, null, 'nothing is fetched from GitHub for a PC with no official build')
    const before = github.requests.length
    await installPlan({ os: { platform: 'darwin' }, gpus: [], drives: [] })
    assert.equal(github.requests.length, before)
  })

  test('[ipc:comfy:installPlan] hands the window the reason when GitHub has no file for this build, instead of throwing', async () => {
    const empty = await startFakeGithub({ releases: { tag_name: 'v0.45.0', assets: [] } })
    try {
      const build = pickBuild(winScan())
      const asset = await latestAsset(build.asset, { fetchImpl: (u, i) => fetch(String(u).replace('https://api.github.com', empty.url), i) }).catch((err) => ({ error: err.message }))
      assert.match(asset.error, /v0\.45\.0 release has no ComfyUI_windows_portable_nvidia\.7z/)
    } finally {
      await empty.close()
    }
  })

  test('[ipc:comfy:installCheck] says why a folder will not do before anything is downloaded, and null when it will', () => {
    assertCopiesMain(assert, 'comfy:installCheck', 'checkFolder(folder, { size, freeOf: freeBytes })')
    const check = ({ folder: f, size } = {}) => checkFolder(f, { size, freeOf: freeBytes })
    assert.equal(check(), 'Pick a folder.')
    assert.equal(check({ folder: 'relative/path' }), 'Pick a folder.')
    assert.equal(check({ folder: path.join(folder, 'new'), size: 1024 }), null, 'a new folder on a roomy disk is fine')
    const used = path.join(folder, 'used')
    fs.mkdirSync(used)
    fs.writeFileSync(path.join(used, 'main.py'), 'x')
    assert.match(check({ folder: used, size: 1024 }), /isn’t empty/)
    assert.match(check({ folder: path.join(folder, 'new'), size: 1e30 }), /That drive has .* GB free; ComfyUI needs about/)
  })

  test('[ipc:comfy:install] stops before downloading when there is no official build, no file, or the folder will not do', async () => {
    assertMainSends(assert, `const { build, asset } = await installPlan()
    if (!build.ok) throw new Error(build.reason)
    if (!asset || asset.error) throw new Error(asset?.error || 'Couldn’t find ComfyUI’s download.')
    const problem = checkFolder(folder, { size: asset.size, freeOf: freeBytes })
    if (problem) throw new Error(problem)
    const dir = await comfyInstaller.install({ folder, asset })`)
    const seen = []
    const installer = new ComfyInstaller({ onProgress: (s) => seen.push(s) })
    const install = async (scan, where) => {
      const { build, asset } = await installPlan(scan)
      if (!build.ok) throw new Error(build.reason)
      if (!asset || asset.error) throw new Error(asset?.error || 'Couldn’t find ComfyUI’s download.')
      const problem = checkFolder(where, { size: asset.size, freeOf: freeBytes })
      if (problem) throw new Error(problem)
      return installer.install({ folder: where, asset })
    }
    await assert.rejects(install({ os: { platform: 'darwin' }, gpus: [] }, path.join(folder, 'a')), /ComfyUI Desktop from comfy\.org/)
    await assert.rejects(install(winScan({ gpus: [{ vendor: 'amd', name: 'Radeon RX 7900' }] }), path.join(folder, 'a')), /needs an NVIDIA graphics card/)
    await assert.rejects(install(winScan(), 'not\\absolute'), /Pick a folder\./)
    const used = path.join(folder, 'used')
    await assert.rejects(install(winScan(), used), /isn’t empty/)
    assert.equal(files.state.hits, 0, 'no download was started for any of them')
    assert.equal(seen.length, 0, 'and the window heard nothing')
  })

  test('[ipc:comfy:install] [event:comfy:install] a download whose checksum is wrong is removed, and the window hears download, check, then the error', async () => {
    assertMainSends(assert, "const comfyInstaller = new ComfyInstaller({ onProgress: (s) => send('comfy:install', s) })")
    const heard = []
    const send = (channel, payload) => heard.push([channel, payload])
    const installer = new ComfyInstaller({ tar: 'not-run', onProgress: (s) => send('comfy:install', s) })
    const target = path.join(tmp(), 'ComfyUI')
    const asset = { name: 'ComfyUI_windows_portable_nvidia.7z', url: `${files.url}/x.7z`, size: body.length, sha256: '0'.repeat(64), version: 'v0.44.0' }
    await assert.rejects(installer.install({ folder: target, asset }), /didn’t match the checksum/)
    assert.equal(fs.existsSync(path.join(target, asset.name)), false, 'the bad file is removed')
    assert.equal(fs.existsSync(path.join(target, `${asset.name}.part`)), false)
    assert.ok(heard.every(([c]) => c === 'comfy:install'))
    const phases = heard.map(([, p]) => p.phase)
    assert.deepEqual([...new Set(phases)], ['download', 'check', 'error'])
    const first = heard[0][1]
    assert.deepEqual({ phase: first.phase, version: first.version, folder: first.folder, total: first.total, got: first.got }, { phase: 'download', version: 'v0.44.0', folder: target, total: body.length, got: 0 })
    const progress = heard.map(([, p]) => p).filter((p) => p.phase === 'download' && p.got > 0)
    assert.ok(progress.length >= 1, 'the bytes so far are announced as they arrive')
    for (const p of progress) {
      assert.equal(p.total, body.length)
      assert.ok(p.got > 0 && p.got <= body.length)
      assert.equal(typeof p.at, 'number')
    }
    assert.ok(progress.some((p) => typeof p.rate === 'number' && p.rate > 0), 'with how fast it is going')
    const last = heard.at(-1)[1]
    assert.equal(last.done, true)
    assert.match(last.error, /checksum/)
    assert.equal(installer.state.phase, 'error', 'the plan answer shows this state to a window opened later')
  })

  test('[ipc:comfy:installCancel] says no when nothing is installing, and stops a download in progress with Cancelled', async () => {
    assertMainSends(assert, "handle('comfy:installCancel', () => comfyInstaller.cancel())")
    const installer = new ComfyInstaller({ tar: 'not-run' })
    assert.equal(installer.cancel(), false, 'nothing to cancel before anything started')
    files.state.stall = true
    try {
      const asset = { name: 'ComfyUI_windows_portable_nvidia.7z', url: `${files.url}/slow.7z`, size: body.length, sha256: sum, version: 'v0.44.0' }
      const target = path.join(tmp(), 'ComfyUI')
      const running = installer.install({ folder: target, asset })
      const settled = running.then(() => null, (e) => e)
      for (let i = 0; i < 300 && !(installer.state?.got > 0); i++) await new Promise((r) => setTimeout(r, 10))
      assert.ok(installer.state?.got > 0, 'the download had started')
      assert.equal(installer.cancel(), true)
      const err = await settled
      assert.equal(err?.message, 'Cancelled.')
      assert.equal(installer.state.phase, 'error')
      assert.equal(installer.state.error, 'Cancelled.')
      assert.equal(installer.cancel(), false, 'a finished install cannot be cancelled again')
    } finally {
      files.state.stall = false
    }
  })
})

describe('the Hugging Face token', () => {
  test('[ipc:cloud:hfToken] an empty token removes the saved one: IV Studio stops using it and the window is told it has none', () => {
    assertCopiesMain(assert, 'cloud:hfToken', `const k = String(token || '').trim()
    if (!k) return (writeSettings({ hfToken: null, hfTokenAt: new Date().toISOString() }, BASE), setSavedHfToken(null), { hasToken: false })`)
    const dir = tmp()
    const home = tmp()
    const handler = async (token) => {
      const k = String(token || '').trim()
      if (!k) return (writeSettings({ hfToken: null, hfTokenAt: new Date().toISOString() }, dir), setSavedHfToken(null), { hasToken: false })
      throw new Error('a real token is checked with huggingface.co')
    }
    setSavedHfToken('hf_saved_for_the_test')
    assert.equal(hfLoginFrom({}, home), 'iv')
    return Promise.all([handler('   '), handler(undefined)]).then((answers) => {
      assert.deepEqual(answers, [{ hasToken: false }, { hasToken: false }])
      assert.equal(hfLoginFrom({}, home), null, 'downloads go back to anonymous (nothing in the environment or hf login)')
      assert.equal(hfToken({}, home), null)
    })
  })
})

describe('cloud model prep', () => {
  let dir, graph, catalog
  before(() => {
    dir = tmp()
    const manifest = JSON.parse(fs.readFileSync(path.join(resources, 'models.json'), 'utf8'))
    const cloudJson = JSON.parse(fs.readFileSync(path.join(resources, 'cloud', 'cloud.json'), 'utf8'))
    catalog = cloudCatalog(manifest, cloudJson)
    graph = { 1: { class_type: 'UNETLoader', inputs: { unet_name: 'Qwen/qwen_image_2.1_int8_convrot.safetensors' } }, 4: { class_type: 'LoraLoaderModelOnly', inputs: { lora_name: 'Styles/Test.safetensors' } } }
  })

  const prepWith = (provider, events, extra = {}) => {
    const lora = path.join(dir, 'Test.safetensors')
    fs.writeFileSync(lora, 'lora bytes')
    return new CloudPrep({ dataDir: tmp(), provider, catalog, stamp: 'test', ask: async () => true, localFile: async () => lora, hfToken: () => null, fetchInfo: async () => ({}), onEvent: (e) => events.push(e), ...extra })
  }

  test('[event:cloud:prep] reports the models going down to the cloud with their progress, each file going up, and done, and the error when a download fails', async () => {
    assertMainSends(assert, "onEvent: (e) => send('cloud:prep', e)")
    // a stand-in for Modal or RunPod: the adapter main hands CloudPrep
    const uploaded = []
    const provider = {
      name: 'standin',
      async download(entries, onEvent) {
        onEvent({ id: entries[0].id, label: entries[0].label, percent: 40, total: 1000, index: 1, count: entries.length })
        onEvent({ id: entries[0].id, label: entries[0].label, percent: 100, total: 1000, index: 1, count: entries.length })
      },
      async upload(file, remote, sha256) {
        uploaded.push({ remote, sha256, bytes: fs.readFileSync(file, 'utf8') })
      }
    }
    const events = []
    const result = await prepWith(provider, events).prepare(graph)
    assert.deepEqual(result.uploaded, ['Styles/Test.safetensors'])
    assert.equal(result.downloaded.length, 1)
    assert.deepEqual(events.map((e) => e.state), ['downloading', 'downloading', 'downloading', 'uploading', 'done'])
    assert.deepEqual(events[0].items.map((i) => Object.keys(i).sort()), [['id', 'label', 'size']])
    assert.equal(events[0].items[0].id, result.downloaded[0])
    assert.deepEqual({ percent: events[1].percent, total: events[1].total, index: events[1].index, count: events[1].count }, { percent: 40, total: 1000, index: 1, count: 1 })
    assert.equal(events[2].percent, 100)
    assert.deepEqual({ label: events[3].label, index: events[3].index, count: events[3].count }, { label: 'Styles/Test.safetensors', index: 1, count: 1 })
    assert.deepEqual(uploaded.map((u) => [u.remote, u.bytes]), [['loras/Styles/Test.safetensors', 'lora bytes']])
    assert.equal(uploaded[0].sha256, createHash('sha256').update('lora bytes').digest('hex'))
    // a download that fails is announced, then the render is stopped with the same message
    const bad = []
    const broken = { ...provider, async download() { throw new Error('The cloud ran out of room.') } }
    await assert.rejects(prepWith(broken, bad).prepare(graph), /ran out of room/)
    assert.deepEqual(bad.map((e) => e.state), ['downloading', 'error'])
    assert.equal(bad[1].error, 'The cloud ran out of room.')
  })

  test('[event:cloud:prep] sends nothing when the person says no to the download, and nothing when the cloud already has every file', async () => {
    const events = []
    const provider = { name: 'standin', download: async () => assert.fail('nothing should be downloaded'), upload: async () => {} }
    await assert.rejects(prepWith(provider, events, { ask: async () => false }).prepare(graph), (e) => e.code === 'declined')
    assert.deepEqual(events, [])
    const none = await prepWith(provider, events).prepare({ 8: { class_type: 'SaveImage', inputs: { filename_prefix: 'x' } } })
    assert.deepEqual(none, { downloaded: [], uploaded: [] })
    assert.deepEqual(events, [])
  })
})
