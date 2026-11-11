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
import { applyEnvPolicy, checkNode, guardState, installElectronStubs } from '../fakes/guard.mjs'
import { registerPort, unregisterPort } from '../fakes/ports.mjs'
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

  for (const e of policy.remove) {
    test(`${e.name} is removed from the environment`, () => {
      assert.equal(scrubbed.env[e.name], undefined)
      assert.ok(scrubbed.found.includes(e.name))
    })
  }
  for (const e of policy.pin) {
    test(`${e.name} is pinned to a temp path`, () => {
      const v = scrubbed.env[e.name]
      assert.ok(v && v !== `leak-${e.name}`, `${e.name} was not changed`)
      assert.ok(fs.realpathSync(path.dirname(v)).startsWith(tmpReal), `${e.name}=${v}`)
      if (e.to === 'missing-file') assert.equal(fs.existsSync(v), false)
    })
  }
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

  test('showMessageBoxSync returns the canned button index, then cancelId, then 0', () => {
    const electron = makeElectron()
    installElectronStubs(electron, { answers, tempDir: os.tmpdir(), trace: [] })
    assert.equal(electron.dialog.showMessageBoxSync({ title: 'Delete it?', buttons: ['No', 'Yes'] }), 1)
    assert.equal(electron.dialog.showMessageBoxSync({ title: 'Other', cancelId: 2 }), 2)
    assert.equal(electron.dialog.showMessageBoxSync({ title: 'Other' }), 0)
  })
})
