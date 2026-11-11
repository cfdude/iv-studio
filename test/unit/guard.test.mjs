// The test guard (test/fakes/guard.mjs): no network except to a registered local fake, no child process except
// ffmpeg, ffprobe, node and the agent shims, no real credentials, a temp home. It is loaded with --import by
// `npm run test:unit`, in every MCP child and in Electron's main process.
//   npm run test:unit
import assert from 'node:assert/strict'
import { exec, execFile, execFileSync, execSync, fork, spawn, spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import dgram from 'node:dgram'
import { once } from 'node:events'
import fs from 'node:fs'
import http from 'node:http'
import http2 from 'node:http2'
import https from 'node:https'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import tls from 'node:tls'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ffmpegStatic from 'ffmpeg-ffprobe-static'
import { modalConfigPath } from '../../src/service/cloud.js'
import { scanHardware } from '../../src/service/hardware.js'
import { applyEnvPolicy, checkNode, ELECTRON_FOLDERS, guardState, installElectronStubs, pinElectronPaths, readElectronPaths } from '../fakes/guard.mjs'
import { registerPort, registerProgram, unregisterPort, unregisterProgram } from '../fakes/ports.mjs'
import { withShims } from '../fakes/shims.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const policy = JSON.parse(fs.readFileSync(path.join(here, '../fakes/env-policy.json'), 'utf8'))
const tmpReal = fs.realpathSync(os.tmpdir())
const underTemp = (p) => fs.realpathSync(path.dirname(p)).startsWith(tmpReal)
const guardUrl = pathToFileURL(path.join(here, '../fakes/guard.mjs')).href

// Runs `node -e code` through the wrapped spawn and returns what it printed.
function nodeChild(code, env = {}) {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-guard-child-'))
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', code], { env: { ...process.env, ...env, IV_TEST_RUN_DIR: runDir } })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('error', reject)
    child.on('close', (status) => resolve({ status, out, err, runDir }))
  })
}

describe('guard: loaded', () => {
  test('it is loaded in the test process (the unit script passes --import)', () => {
    assert.equal(guardState().loaded, true, 'run these tests with `npm run test:unit`')
  })
})

describe('guard: Node version', () => {
  test('checkNode stops older Node with a plain message', () => {
    assert.throws(() => checkNode('22.14.0'), { message: "IV Studio's tests need Node 22.18 or later; this is 22.14.0." })
    assert.throws(() => checkNode('21.7.3'), /need Node 22\.18 or later; this is 21\.7\.3\./)
  })
  test('checkNode passes 22.18 and newer', () => {
    checkNode('22.18.0')
    checkNode('22.19.1')
    checkNode('26.13.0')
  })
})

describe('guard: environment', () => {
  const dirty = {}
  const all = [...policy.remove, ...policy.pin]
  for (const e of all) dirty[e.name] = `leak-${e.name}`
  const scrubbed = applyEnvPolicy({ ...dirty, PATH: '/usr/bin', SystemRoot: 'C:\\Windows' }, policy, fs.mkdtempSync(path.join(os.tmpdir(), 'iv-env-')))

  test('every removed variable is gone from the environment', async (t) => {
    for (const e of policy.remove) {
      await t.test(`${e.name} is removed from the environment`, () => {
        assert.equal(scrubbed.env[e.name], undefined)
        assert.ok(scrubbed.found.includes(e.name))
      })
    }
  })
  test('every pinned variable points at a temp path', async (t) => {
    for (const e of policy.pin) {
      await t.test(`${e.name} is pinned to a temp path`, () => {
        const v = scrubbed.env[e.name]
        assert.ok(v && v !== `leak-${e.name}`, `${e.name} was not changed`)
        assert.ok(fs.realpathSync(path.dirname(v)).startsWith(tmpReal), `${e.name}=${v}`)
        if (e.to === 'missing-file') assert.equal(fs.existsSync(v), false)
      })
    }
  })
  test('a pinned variable already set to a temp path by the harness is kept', () => {
    const mine = path.join(tmpReal, 'iv-seeded-data')
    const r = applyEnvPolicy({ IV_STUDIO_DATA: mine, HOME: '/Users/someone' }, policy, fs.mkdtempSync(path.join(os.tmpdir(), 'iv-env-')))
    assert.equal(r.env.IV_STUDIO_DATA, mine)
    assert.notEqual(r.env.HOME, '/Users/someone')
  })
  test('kept variables pass through', () => {
    assert.equal(scrubbed.env.PATH, '/usr/bin')
    assert.equal(scrubbed.env.SystemRoot, 'C:\\Windows')
  })

  test('in a child, every removed variable is gone and every pinned one is under the temp folder', async () => {
    const shell = Object.fromEntries(all.map((e) => [e.name, `leak-${e.name}`]))
    const r = await nodeChild('process.stdout.write(JSON.stringify(process.env))', shell)
    assert.equal(r.status, 0, r.err)
    const env = JSON.parse(r.out)
    for (const e of policy.remove) assert.equal(env[e.name], undefined, `${e.name} reached the child`)
    for (const e of policy.pin) {
      assert.notEqual(env[e.name], `leak-${e.name}`, `${e.name} reached the child`)
      assert.ok(fs.realpathSync(path.dirname(env[e.name])).startsWith(tmpReal), `${e.name}=${env[e.name]}`)
    }
  })

  test('HOME is under the OS temp folder', () => {
    assert.ok(fs.realpathSync(process.env.HOME).startsWith(tmpReal), process.env.HOME)
    assert.ok(os.homedir().startsWith(process.env.HOME) || fs.realpathSync(os.homedir()).startsWith(tmpReal))
  })
  test('modalConfigPath() points at a temp file that does not exist', () => {
    const p = modalConfigPath()
    assert.ok(underTemp(p), p)
    assert.equal(fs.existsSync(p), false)
  })
})

describe('guard: network', () => {
  let server
  const upgraded = []
  before(async () => {
    server = http.createServer((req, res) => res.end('ok'))
    // a minimal WebSocket handshake, enough for the client to reach "open"
    server.on('upgrade', (req, socket) => {
      upgraded.push(socket)
      const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')
      socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)
    })
    await new Promise((r) => server.listen(0, '127.0.0.1', r))
    registerPort(server.address().port)
  })
  after(async () => {
    unregisterPort(server.address().port)
    for (const s of upgraded) s.destroy()
    server.closeAllConnections?.()
    await new Promise((r) => server.close(r))
  })

  test('fetch to a registered fake works', async () => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/`)
    assert.equal(await res.text(), 'ok')
  })
  test('fetch to an outside host fails naming the host', async () => {
    await assert.rejects(fetch('https://example.com'), /example\.com/)
  })
  test('fetch to 127.0.0.1:8188 with no fake on that port fails naming the port', async () => {
    await assert.rejects(fetch('http://127.0.0.1:8188/system_stats'), /8188/)
  })
  test('a WebSocket to ws://127.0.0.1:8188/ws fails naming host and port', () => {
    assert.throws(() => new WebSocket('ws://127.0.0.1:8188/ws'), /127\.0\.0\.1:8188/)
  })
  test('a WebSocket to a registered fake works', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.address().port}/ws`)
    await new Promise((resolve, reject) => {
      ws.onopen = resolve
      ws.onerror = () => reject(new Error('websocket error'))
    })
    ws.close()
  })
  test('tls.connect to example.com:443 fails naming host and port', async () => {
    const s = tls.connect({ host: 'example.com', port: 443 })
    const [err] = await once(s, 'error')
    assert.match(err.message, /example\.com:443/)
  })
  test('net.Socket().connect(443, example.com) fails naming host and port', async () => {
    const s = new net.Socket().connect(443, 'example.com')
    const [err] = await once(s, 'error')
    assert.match(err.message, /example\.com:443/)
  })
  test('an https.request through a pre-made Agent fails naming host and port', async () => {
    const agent = new https.Agent()
    const req = https.request({ host: 'example.com', port: 443, path: '/', agent })
    const [err] = await once(req, 'error')
    assert.match(err.message, /example\.com:443/)
  })
  test('http2.connect to an outside host throws naming the host', () => {
    assert.throws(() => http2.connect('https://example.com'), /example\.com/)
  })
  test('a datagram to an outside host is refused', async () => {
    const sock = dgram.createSocket('udp4')
    const err = await new Promise((resolve) => {
      try {
        sock.send('x', 53, '8.8.8.8', (e) => resolve(e))
      } catch (e) {
        resolve(e)
      }
    })
    sock.close()
    assert.match(String(err?.message), /8\.8\.8\.8:53/)
  })
})

describe('guard: child processes', () => {
  const refusals = () => guardState().refusals
  const enoent = (e, name) => {
    assert.equal(e.code, 'ENOENT')
    assert.equal(e.ivGuardRefused, true)
    assert.match(e.message, new RegExp(name))
  }

  test('spawn("claude"), imported by name, is refused: error event on the next tick, no spawn event', async () => {
    const child = spawn('claude', ['-p'])
    let spawned = false
    child.on('spawn', () => (spawned = true))
    const [e] = await once(child, 'error')
    enoent(e, 'claude')
    assert.equal(spawned, false)
  })
  test('spawn("claude") by an absolute path outside the allowlist is refused', async () => {
    const [e] = await once(spawn('/opt/homebrew/bin/claude', []), 'error')
    enoent(e, 'claude')
  })
  test('spawn("open", ["-a", ...]) is refused', async () => {
    const child = spawn('open', ['-a', '/Applications/Comfy Desktop.app'], { detached: true, stdio: 'ignore' })
    child.unref()
    const [e] = await once(child, 'error')
    enoent(e, 'open')
  })
  test('execFile with git calls back with ENOENT asynchronously', async () => {
    let sync = true
    const p = new Promise((resolve) => execFile('git', ['status'], (err) => resolve({ err, sync })))
    sync = false
    const { err, sync: wasSync } = await p
    assert.equal(wasSync, false)
    enoent(err, 'git')
  })
  test('exec with git calls back with ENOENT asynchronously', async () => {
    const err = await new Promise((resolve) => exec('git status', (e) => resolve(e)))
    enoent(err, 'git')
  })
  test('fork with git as the executable is refused', async () => {
    const child = fork('x.js', [], { execPath: 'git' })
    const [e] = await once(child, 'error')
    enoent(e, 'git')
  })
  test('spawnSync returns { status: null, error }', () => {
    const r = spawnSync('git', ['status'])
    assert.equal(r.status, null)
    enoent(r.error, 'git')
  })
  test('execFileSync and execSync throw it', () => {
    assert.throws(() => execFileSync('git', ['status']), (e) => (enoent(e, 'git'), true))
    assert.throws(() => execSync('git status'), (e) => (enoent(e, 'git'), true))
  })
  test('every refusal is recorded', () => {
    const names = refusals().map((r) => r.command)
    for (const n of ['claude', 'open', 'git']) assert.ok(names.includes(n), `no refusal recorded for ${n}`)
    const file = path.join(guardState().runDir, 'guard-refusals.json')
    assert.ok(JSON.parse(fs.readFileSync(file, 'utf8')).length >= names.length)
  })
  test('scanHardware on linux, whose nvidia-smi start is refused, still resolves with no NVIDIA card', async () => {
    const hw = await scanHardware({ platform: 'linux' })
    assert.deepEqual((hw.gpus || []).filter((g) => g.vendor === 'nvidia'), [])
  })

  test('node is allowed, and its child has the guard loaded and writes its marker', async () => {
    const r = await nodeChild('process.stdout.write("hi")')
    assert.equal(r.status, 0, r.err)
    assert.equal(r.out, 'hi')
    const marker = JSON.parse(fs.readFileSync(path.join(r.runDir, 'guard-loaded.json'), 'utf8'))
    assert.equal(typeof marker.pid, 'number')
  })
  test('a node child sees the same allowed ports and no scrubbed key', async () => {
    registerPort(54321)
    try {
      const r = await nodeChild('process.stdout.write(JSON.stringify({ ports: process.env.IV_TEST_ALLOW_PORTS, key: process.env.ANTHROPIC_API_KEY ?? null }))', { ANTHROPIC_API_KEY: 'sk-leak' })
      const got = JSON.parse(r.out)
      assert.ok(got.ports.split(',').includes('54321'))
      assert.equal(got.key, null)
    } finally {
      unregisterPort(54321)
    }
  })
  test('a node grandchild is held to the network rule', async () => {
    const code = `fetch('https://example.com').then(() => process.stdout.write('reached'), (e) => process.stdout.write('refused:' + e.message))`
    const r = await nodeChild(code)
    assert.match(r.out, /^refused:.*example\.com/)
  })
  test('ffmpeg with a network input is refused', async () => {
    const [e] = await once(spawn(ffmpegStatic.ffmpegPath, ['-i', 'https://example.com/x.mp4', '-f', 'null', '-']), 'error')
    enoent(e, 'ffmpeg|network')
  })
  test('ffmpeg with a network output is refused', async () => {
    const [e] = await once(spawn(ffmpegStatic.ffmpegPath, ['-i', 'a.mp4', 'rtmp://example.com/live']), 'error')
    assert.equal(e.code, 'ENOENT')
  })
  test('ffmpeg -version, with no network argument, runs', async () => {
    const child = spawn(ffmpegStatic.ffmpegPath, ['-version'])
    const [code] = await once(child, 'close')
    assert.equal(code, 0)
  })

  test('withShims(): spawn("claude") runs the shim and returns its canned answer', async () => {
    const shims = withShims()
    try {
      const out = await new Promise((resolve, reject) => {
        const child = spawn('claude', ['-p'])
        let text = ''
        child.stdout.on('data', (d) => (text += d))
        child.on('error', reject)
        child.on('close', () => resolve(text))
        child.stdin.end('hello')
      })
      assert.equal(JSON.parse(out).structured_output.engine, 'claude')
    } finally {
      shims.restore()
    }
  })
  test('after restore, claude is refused again', async () => {
    const [e] = await once(spawn('claude', []), 'error')
    enoent(e, 'claude')
  })
})

describe('guard: Electron stand-ins', () => {
  const makeElectron = () => ({
    shell: { openExternal: async () => 'REAL', openPath: async () => 'REAL', showItemInFolder: () => 'REAL' },
    dialog: Object.fromEntries(['showOpenDialog', 'showOpenDialogSync', 'showSaveDialog', 'showSaveDialogSync', 'showMessageBox', 'showMessageBoxSync'].map((n) => [n, () => 'REAL'])),
    Notification: class {
      static isSupported() {
        return false
      }
      show() {
        throw new Error('REAL')
      }
    }
  })
  const answers = { open: { 'Pick a folder': { kind: 'dir', name: 'picked' } }, save: { 'Save as': { name: 'out.mp4' } }, messageBox: { 'Delete it?': 1 } }

  test('shell, dialog and Notification record their calls and open nothing', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-electron-'))
    const electron = makeElectron()
    const trace = []
    installElectronStubs(electron, { answers, tempDir, trace })
    assert.equal(await electron.shell.openExternal('https://example.com'), undefined)
    assert.equal(await electron.shell.openPath('/tmp/x'), '')
    electron.shell.showItemInFolder('/tmp/y')
    const n = new electron.Notification({ title: 'Done', body: 'Your video' })
    n.show()
    assert.equal(electron.Notification.isSupported(), true)
    assert.deepEqual(
      trace.map((t) => [t.fn, t.arg ?? t.title]),
      [['shell.openExternal', 'https://example.com'], ['shell.openPath', '/tmp/x'], ['shell.showItemInFolder', '/tmp/y'], ['Notification.show', 'Done']]
    )
    assert.equal(trace.at(-1).body, 'Your video')
  })

  test('showOpenDialog with a known title returns a path under the temp folder; an unknown title is cancelled', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-electron-'))
    const electron = makeElectron()
    const trace = []
    installElectronStubs(electron, { answers, tempDir, trace })
    const known = await electron.dialog.showOpenDialog({ title: 'Pick a folder', properties: ['openDirectory'] })
    assert.equal(known.canceled, false)
    assert.ok(fs.realpathSync(known.filePaths[0]).startsWith(fs.realpathSync(tempDir)))
    assert.ok(fs.statSync(known.filePaths[0]).isDirectory())
    const unknown = await electron.dialog.showOpenDialog({ title: 'Something else' })
    assert.equal(unknown.canceled, true)
    assert.deepEqual(electron.dialog.showOpenDialogSync({ title: 'Something else' }), undefined)
    const saved = await electron.dialog.showSaveDialog({ title: 'Save as' })
    assert.ok(saved.filePath.startsWith(tempDir))
    assert.equal(trace.filter((t) => t.fn.startsWith('dialog.')).length, 4)
  })

  test('a dialog answer is made even when the temp folder for answers does not exist yet', async () => {
    const tempDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'iv-electron-')), 'not', 'yet')
    const electron = makeElectron()
    installElectronStubs(electron, { answers, tempDir, trace: [] })
    const r = await electron.dialog.showOpenDialog({ title: 'Pick a folder', properties: ['openDirectory'] })
    assert.ok(fs.statSync(r.filePaths[0]).isDirectory())
  })

  test('a restart is recorded and neither relaunches nor exits the app', () => {
    const calls = []
    const electron = { ...makeElectron(), app: { relaunch: () => calls.push('REAL relaunch'), exit: () => calls.push('REAL exit') } }
    const trace = []
    installElectronStubs(electron, { answers, tempDir: os.tmpdir(), trace })
    electron.app.relaunch()
    electron.app.exit(0)
    assert.deepEqual(calls, [])
    assert.deepEqual(trace.map((t) => t.fn), ['app.relaunch', 'app.exit'])
  })

  test('a folder answer with contents holds those files', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-electron-'))
    const electron = makeElectron()
    installElectronStubs(electron, { answers: { open: { 'Pick a folder': { kind: 'dir', name: 'comfy', contents: ['main.py', 'custom_nodes/.keep'] } } }, tempDir, trace: [] })
    const r = await electron.dialog.showOpenDialog({ title: 'Pick a folder' })
    assert.deepEqual([fs.existsSync(path.join(r.filePaths[0], 'main.py')), fs.existsSync(path.join(r.filePaths[0], 'custom_nodes', '.keep'))], [true, true])
  })

  test('showMessageBoxSync returns the canned button index, then cancelId, then 0', () => {
    const electron = makeElectron()
    installElectronStubs(electron, { answers, tempDir: os.tmpdir(), trace: [] })
    assert.equal(electron.dialog.showMessageBoxSync({ title: 'Delete it?', buttons: ['No', 'Yes'] }), 1)
    assert.equal(electron.dialog.showMessageBoxSync({ title: 'Other', cancelId: 2 }), 2)
    assert.equal(electron.dialog.showMessageBoxSync({ title: 'Other' }), 0)
  })
})

describe('guard: what the page tier adds', () => {
  test('a program the driver registers by exact path starts; its sibling still does not', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-program-'))
    for (const n of ['launched', 'sibling']) {
      fs.writeFileSync(path.join(dir, n), '#!/bin/sh\necho ok\n', { mode: 0o755 })
    }
    const before = spawnSync(path.join(dir, 'launched'), [])
    assert.equal(before.error?.ivGuardRefused, true)
    registerProgram(path.join(dir, 'launched'))
    try {
      const r = spawnSync(path.join(dir, 'launched'), [])
      assert.equal(r.status, 0)
      assert.equal(String(r.stdout).trim(), 'ok')
      assert.equal(spawnSync(path.join(dir, 'sibling'), []).error?.ivGuardRefused, true)
    } finally {
      unregisterProgram(path.join(dir, 'launched'))
    }
    assert.equal(spawnSync(path.join(dir, 'launched'), []).error?.ivGuardRefused, true)
  })

  test('a refused network call is also recorded, with its host and port, apart from the refused commands', async () => {
    const before = guardState().netRefusals.length
    await assert.rejects(fetch('http://127.0.0.1:8188/experiment/models'), /127\.0\.0\.1:8188/)
    const added = guardState().netRefusals.slice(before)
    assert.equal(added.length, 1)
    assert.deepEqual([added[0].host, added[0].port, added[0].path], ['127.0.0.1', 8188, '/experiment/models'])
    assert.ok(!guardState().refusals.some((r) => r.command === '127.0.0.1'))
    const written = JSON.parse(fs.readFileSync(path.join(guardState().runDir, 'guard-network-refusals.json'), 'utf8'))
    assert.ok(written.some((r) => r.port === 8188))
  })

  test('the Electron stubs write their trace to a file the driver can read', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-trace-'))
    const traceFile = path.join(dir, 'guard-trace.json')
    const dialog = Object.fromEntries(['showOpenDialog', 'showOpenDialogSync', 'showSaveDialog', 'showSaveDialogSync', 'showMessageBox', 'showMessageBoxSync'].map((n) => [n, () => 'REAL']))
    const electron = { shell: {}, dialog }
    const trace = []
    installElectronStubs(electron, { answers: { open: { 'Pick a folder': { kind: 'dir', name: 'picked' } } }, tempDir: dir, trace, traceFile })
    await electron.shell.openExternal('https://example.com')
    await electron.dialog.showOpenDialog({ title: 'Pick a folder', properties: ['openDirectory'] })
    const read = JSON.parse(fs.readFileSync(traceFile, 'utf8'))
    assert.deepEqual(read.map((t) => t.fn), ['shell.openExternal', 'dialog.showOpenDialog'])
    assert.equal(read[0].arg, 'https://example.com')
    assert.equal(read[1].title, 'Pick a folder')
  })

  test("a Notification that cannot be replaced (Electron's own getter) is patched so it shows nothing and records", () => {
    class Real {
      constructor(options) {
        this.title = options.title
        this.body = options.body
      }
      static isSupported() {
        return false
      }
      show() {
        throw new Error('REAL')
      }
    }
    const electron = { shell: {}, dialog: {} }
    Object.defineProperty(electron, 'Notification', { get: () => Real, enumerable: true, configurable: false })
    const trace = []
    installElectronStubs(electron, { answers: {}, tempDir: os.tmpdir(), trace, traceFile: null })
    assert.equal(electron.Notification, Real)
    assert.equal(electron.Notification.isSupported(), true)
    new electron.Notification({ title: 'Done', body: 'Your video' }).show()
    assert.deepEqual(trace.map((t) => [t.fn, t.title, t.body]), [['Notification.show', 'Done', 'Your video']])
  })

  test('pinElectronPaths points home, videos and the other user folders at the temp home, not the account record', () => {
    // a stand-in app that, like macOS Electron, resolves these from "the account" until told otherwise
    const real = { home: '/Users/someone', videos: '/Users/someone/Movies', documents: '/Users/someone/Documents', downloads: '/Users/someone/Downloads', desktop: '/Users/someone/Desktop', music: '/Users/someone/Music', pictures: '/Users/someone/Pictures', userData: '/tmp/ud' }
    const set = {}
    const app = { setPath: (n, v) => ((set[n] = v), (real[n] = v)), getPath: (n) => real[n] }
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-pin-home-'))
    const pinned = pinElectronPaths(app, home)
    assert.deepEqual(Object.keys(pinned), Object.keys(ELECTRON_FOLDERS))
    for (const name of Object.keys(ELECTRON_FOLDERS)) {
      assert.ok(app.getPath(name) === home || app.getPath(name).startsWith(home + path.sep), `${name} is ${app.getPath(name)}`)
      assert.ok(fs.statSync(app.getPath(name)).isDirectory())
    }
    assert.equal(app.getPath('videos'), path.join(home, 'Movies'))
    assert.deepEqual(readElectronPaths(app).userData, '/tmp/ud')
  })
})
