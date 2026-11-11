// The test guard: what makes the free tests free (design D8). Load it first, with `--import`.
//   node --import ./test/fakes/guard.mjs --test ...
// It stops on old Node, scrubs credentials and machine paths from the environment, refuses every network
// connection except to a loopback port a fake registered, refuses every child process except ffmpeg, ffprobe, node
// and the agent shims, stubs Electron's shell, dialog and Notification in Electron's main process, and writes a
// marker saying it loaded. A refusal looks like a missing program or a failed connection, so callers that treat
// those as normal keep working.
import cp from 'node:child_process'
import dgram from 'node:dgram'
import fs from 'node:fs'
import http2 from 'node:http2'
import module, { createRequire } from 'node:module'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { guardState, loadInherited, portAllowed, LOOPBACK } from './ports.mjs'

export { guardState }

const require = createRequire(import.meta.url)
const here = path.dirname(fileURLToPath(import.meta.url))
export const GUARD_URL = import.meta.url

// ---------- Node version ----------

export function checkNode(version = process.versions.node) {
  const [major, minor] = String(version).split('.').map(Number)
  if (major < 22 || (major === 22 && minor < 18)) throw new Error(`IV Studio's tests need Node 22.18 or later; this is ${version}.`)
}

// ---------- environment ----------

// Applies env-policy.json to `env` (a plain object). Returns { env, found }: found lists the removed or pinned
// names that were present, for the load marker.
export function applyEnvPolicy(env, policy, root) {
  const out = { ...env }
  const found = []
  for (const e of policy.remove) {
    if (e.name in out) found.push(e.name)
    delete out[e.name]
  }
  fs.mkdirSync(root, { recursive: true })
  for (const e of policy.pin) {
    if (e.name in out) found.push(e.name)
    if (e.to === 'dir') {
      const dir = path.join(root, e.name === 'HOME' ? 'home' : e.name.toLowerCase())
      fs.mkdirSync(dir, { recursive: true })
      out[e.name] = dir
    } else {
      // a file that does not exist (its folder does)
      const dir = path.join(root, e.name.toLowerCase())
      fs.mkdirSync(dir, { recursive: true })
      out[e.name] = path.join(dir, 'does-not-exist')
    }
  }
  return { env: out, found }
}

// ---------- refusals ----------

const state = guardState()

function recordRefusal(kind, command, detail) {
  state.refusals.push({ kind, command, detail, at: new Date().toISOString() })
  if (state.runDir) {
    try {
      fs.writeFileSync(path.join(state.runDir, 'guard-refusals.json'), JSON.stringify(state.refusals, null, 2))
    } catch {
      /* the run folder is gone; the in-memory list still holds it */
    }
  }
}

const networkError = (host, port, what = 'a network call') => {
  const e = new Error(`IV Studio's tests refused ${what} to ${host}:${port}. Only a local fake that registered its port may be reached.`)
  e.code = 'ECONNREFUSED'
  e.ivGuardRefused = true
  return e
}

// ---------- network ----------

function install() {
  const policy = JSON.parse(fs.readFileSync(path.join(here, 'env-policy.json'), 'utf8'))

  // fetch and WebSocket
  const realFetch = globalThis.fetch
  const hostPort = (u) => {
    const url = new URL(u)
    const port = url.port || ({ 'http:': 80, 'https:': 443, 'ws:': 80, 'wss:': 443 }[url.protocol] ?? '')
    return { host: url.hostname.replace(/^\[|\]$/g, ''), port: Number(port) }
  }
  const checkUrl = (u, what) => {
    const { host, port } = hostPort(u)
    if (!portAllowed(host, port)) throw networkError(host, port, what)
  }
  if (realFetch) {
    globalThis.fetch = async function guardedFetch(input, init) {
      checkUrl(typeof input === 'string' || input instanceof URL ? input : input.url, 'a fetch')
      return realFetch.call(this, input, init)
    }
  }
  const RealWebSocket = globalThis.WebSocket
  if (RealWebSocket) {
    globalThis.WebSocket = class GuardedWebSocket extends RealWebSocket {
      constructor(url, ...rest) {
        checkUrl(url, 'a WebSocket')
        super(url, ...rest)
      }
    }
  }

  // every TCP and TLS connection (net.connect, tls.connect, http(s).request, Agent.createConnection) ends here
  const realConnect = net.Socket.prototype.connect
  const target = (args) => {
    let a = args
    if (Array.isArray(a[0])) a = a[0]
    const first = a[0]
    if (first && typeof first === 'object') return first.path ? null : { host: first.host || 'localhost', port: Number(first.port) }
    if (typeof first === 'number' || (typeof first === 'string' && /^\d+$/.test(first))) return { host: typeof a[1] === 'string' ? a[1] : 'localhost', port: Number(first) }
    return null // a socket path
  }
  net.Socket.prototype.connect = function guardedConnect(...args) {
    const t = target(args)
    if (t && !portAllowed(String(t.host).replace(/^\[|\]$/g, ''), t.port)) {
      const err = networkError(t.host, t.port, 'a connection')
      process.nextTick(() => this.destroy(err))
      return this
    }
    return realConnect.apply(this, args)
  }

  const realH2 = http2.connect
  http2.connect = function guardedH2(authority, ...rest) {
    checkUrl(typeof authority === 'string' ? authority : authority.href, 'an HTTP/2 connection')
    return realH2.call(this, authority, ...rest)
  }

  const refuseDgram = (port, address) => {
    if (!portAllowed(address || 'localhost', port)) throw networkError(address || 'localhost', port, 'a datagram')
  }
  const realSend = dgram.Socket.prototype.send
  dgram.Socket.prototype.send = function guardedSend(msg, ...rest) {
    const nums = rest.filter((x) => typeof x === 'number')
    const strs = rest.filter((x) => typeof x === 'string')
    // (offset, length, port, address) or (port, address); an already connected socket has neither
    const port = rest.length >= 2 && typeof rest[0] === 'number' && typeof rest[1] === 'number' && nums.length >= 3 ? nums[2] : nums[0]
    if (port !== undefined && (strs.length || nums.length >= 1)) {
      try {
        refuseDgram(port, strs[0])
      } catch (e) {
        const cb = rest.find((x) => typeof x === 'function')
        if (cb) return void process.nextTick(cb, e)
        throw e
      }
    }
    return realSend.call(this, msg, ...rest)
  }
  const realDgramConnect = dgram.Socket.prototype.connect
  dgram.Socket.prototype.connect = function guardedDgramConnect(port, address, ...rest) {
    refuseDgram(port, typeof address === 'string' ? address : '127.0.0.1')
    return realDgramConnect.call(this, port, address, ...rest)
  }

  // ---------- child processes ----------

  const allowed = new Set()
  const realpath = (p) => {
    try {
      return fs.realpathSync(p)
    } catch {
      return p
    }
  }
  const ffm = (() => {
    try {
      return require('ffmpeg-ffprobe-static')
    } catch {
      return {}
    }
  })()
  const media = [ffm.ffmpegPath, ffm.ffprobePath].filter(Boolean).map(realpath)
  allowed.add(realpath(process.execPath))
  for (const m of media) allowed.add(m)

  const NETWORK_ARG = /(?:^|[=,\s])(?:https?|rtmps?|tcp|udp):\/\//i
  const isNode = (abs) => realpath(abs) === realpath(process.execPath)
  const onPath = (name, envPath) => {
    for (const d of String(envPath ?? process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
      const f = path.join(d, name)
      try {
        if (fs.statSync(f).isFile()) return f
      } catch {
        /* next */
      }
    }
    return null
  }
  const inShimDir = (abs) => [...state.shimDirs].some((d) => realpath(path.dirname(abs)) === realpath(d))

  // -> { ok, command (to run), why }
  function judge(command, args, options, { shell } = {}) {
    let name = String(command)
    if (shell) name = name.trim().split(/\s+/)[0].replace(/^["']|["']$/g, '')
    const base = path.basename(name)
    if (/^node(\.exe)?$/i.test(base)) return { ok: true, command: shell ? command : process.execPath, node: true, name }
    const abs = name.includes('/') || name.includes('\\') ? path.resolve(options?.cwd || process.cwd(), name) : onPath(name, options?.env?.PATH)
    if (!abs) return { ok: false, name, why: 'not found on PATH' }
    const real = realpath(abs)
    if (allowed.has(real)) {
      if (media.includes(real) && (Array.isArray(args) ? args : [String(command)]).some((a) => NETWORK_ARG.test(String(a)))) return { ok: false, name: path.basename(name), why: 'a network input or output is refused' }
      return { ok: true, command, node: real === realpath(process.execPath), name }
    }
    if (inShimDir(abs)) return { ok: true, command, node: false, name }
    return { ok: false, name: base, why: 'not on the test allowlist' }
  }

  // what a child gets: the guard in NODE_OPTIONS, the allowed ports and shim folders, its own run folder
  let childCount = 0
  function childEnv(options, node) {
    const env = { ...(options?.env || process.env) }
    env.IV_TEST_ALLOW_PORTS = [...state.ports].join(',')
    env.IV_TEST_SHIM_DIRS = [...state.shimDirs].join(':')
    if (node) {
      const flag = `--import=${GUARD_URL}`
      if (!String(env.NODE_OPTIONS || '').includes(flag)) env.NODE_OPTIONS = `${env.NODE_OPTIONS || ''} ${flag}`.trim()
      if (!options?.env?.IV_TEST_RUN_DIR) env.IV_TEST_RUN_DIR = path.join(state.runDir, `child-${process.pid}-${++childCount}`)
      fs.mkdirSync(env.IV_TEST_RUN_DIR, { recursive: true })
    }
    return env
  }

  const nowhere = path.join(os.tmpdir(), 'iv-guard-refused', 'no-such-program')
  const mark = (err, name, why) => {
    err.message = `IV Studio's tests refused to start "${name}" (${why}).`
    err.ivGuardRefused = true
    if (!err.code) err.code = 'ENOENT'
    return err
  }
  // run `fn` (a real child_process call on a program that cannot exist) so the caller gets the platform's own
  // missing-program behaviour, with the error rewritten to name what was refused
  const refuseChild = (child, name, why) => {
    child.prependListener('error', (e) => {
      mark(e, name, why)
      if (child.listenerCount('error') === 1) throw e // nobody else listens: an unhandled error, as the real API gives
    })
    return child
  }

  const realSpawn = cp.spawn
  const realSpawnSync = cp.spawnSync
  const realExecFile = cp.execFile
  const realExecFileSync = cp.execFileSync
  const realExec = cp.exec
  const realExecSync = cp.execSync
  const realFork = cp.fork

  const norm = (args) => {
    const [command, a, o] = args
    return Array.isArray(a) ? { command, args: a, options: o || {} } : { command, args: [], options: a || {} }
  }

  cp.spawn = function guardedSpawn(...argv) {
    const { command, args, options } = norm(argv)
    const j = judge(command, args, options, { shell: options.shell === true || typeof options.shell === 'string' })
    if (!j.ok) {
      recordRefusal('spawn', j.name, j.why)
      return refuseChild(realSpawn(nowhere, [], { stdio: options.stdio, detached: options.detached }), j.name, j.why)
    }
    return realSpawn(j.node && !options.shell ? process.execPath : command, args, { ...options, env: childEnv(options, j.node) })
  }
  cp.spawnSync = function guardedSpawnSync(...argv) {
    const { command, args, options } = norm(argv)
    const j = judge(command, args, options, { shell: !!options.shell })
    if (!j.ok) {
      recordRefusal('spawnSync', j.name, j.why)
      const r = realSpawnSync(nowhere, [])
      mark(r.error, j.name, j.why)
      return r
    }
    return realSpawnSync(j.node && !options.shell ? process.execPath : command, args, { ...options, env: childEnv(options, j.node) })
  }
  cp.execFile = function guardedExecFile(file, ...rest) {
    const args = Array.isArray(rest[0]) ? rest.shift() : []
    const cb = typeof rest.at(-1) === 'function' ? rest.pop() : undefined
    const options = rest[0] && typeof rest[0] === 'object' ? rest[0] : {}
    const j = judge(file, args, options, { shell: !!options.shell })
    if (!j.ok) {
      recordRefusal('execFile', j.name, j.why)
      const child = realExecFile(nowhere, [], {}, cb && ((e, so, se) => cb(e && mark(e, j.name, j.why), so, se)))
      return refuseChild(child, j.name, j.why)
    }
    return realExecFile(j.node && !options.shell ? process.execPath : file, args, { ...options, env: childEnv(options, j.node) }, cb)
  }
  cp.execFileSync = function guardedExecFileSync(file, ...rest) {
    const args = Array.isArray(rest[0]) ? rest.shift() : []
    const options = rest[0] && typeof rest[0] === 'object' ? rest[0] : {}
    const j = judge(file, args, options, { shell: !!options.shell })
    if (!j.ok) {
      recordRefusal('execFileSync', j.name, j.why)
      try {
        realExecFileSync(nowhere, [], { stdio: 'pipe' })
      } catch (e) {
        throw mark(e, j.name, j.why)
      }
    }
    return realExecFileSync(j.node && !options.shell ? process.execPath : file, args, { ...options, env: childEnv(options, j.node) })
  }
  cp.exec = function guardedExec(command, ...rest) {
    const cb = typeof rest.at(-1) === 'function' ? rest.pop() : undefined
    const options = rest[0] && typeof rest[0] === 'object' ? rest[0] : {}
    const j = judge(command, [command], options, { shell: true })
    if (!j.ok) {
      recordRefusal('exec', j.name, j.why)
      const child = realExecFile(nowhere, [], {}, cb && ((e, so, se) => cb(e && mark(e, j.name, j.why), so, se)))
      return refuseChild(child, j.name, j.why)
    }
    return realExec(command, { ...options, env: childEnv(options, j.node) }, cb)
  }
  cp.execSync = function guardedExecSync(command, options = {}) {
    const j = judge(command, [command], options, { shell: true })
    if (!j.ok) {
      recordRefusal('execSync', j.name, j.why)
      try {
        realExecFileSync(nowhere, [], { stdio: 'pipe' })
      } catch (e) {
        throw mark(e, j.name, j.why)
      }
    }
    return realExecSync(command, { ...options, env: childEnv(options, j.node) })
  }
  cp.fork = function guardedFork(modulePath, ...rest) {
    const args = Array.isArray(rest[0]) ? rest.shift() : []
    const options = rest[0] && typeof rest[0] === 'object' ? rest[0] : {}
    if (options.execPath) {
      const j = judge(options.execPath, [], options)
      if (!j.ok) {
        recordRefusal('fork', j.name, j.why)
        return refuseChild(realSpawn(nowhere, [], { stdio: 'pipe' }), j.name, j.why)
      }
    }
    return realFork(modulePath, args, { ...options, env: childEnv(options, true) })
  }
  // the named imports in src/ (import { spawn } from 'node:child_process') read these live bindings
  module.syncBuiltinESMExports()
}

// ---------- Electron's main process ----------

// Replaces shell, dialog and Notification on `electron` with stubs that show and open nothing, record the call in
// `trace`, and return canned answers (answers: { open, save, messageBox } keyed by dialog title).
export function installElectronStubs(electron, { answers = {}, tempDir = os.tmpdir(), trace = state.trace } = {}) {
  const rec = (fn, extra) => trace.push({ fn, ...extra })
  const { shell, dialog } = electron
  shell.openExternal = async (url) => void rec('shell.openExternal', { arg: url })
  shell.openPath = async (p) => (rec('shell.openPath', { arg: p }), '')
  shell.showItemInFolder = (p) => void rec('shell.showItemInFolder', { arg: p })

  const titleOf = (o) => o?.title ?? o?.message ?? ''
  const optsOf = (args) => (args.length > 1 ? args[1] : args[0]) || {}
  const made = (entry, title) => {
    const dir = fs.mkdtempSync(path.join(tempDir, 'dialog-'))
    const target = path.join(dir, entry.name || 'picked')
    if (entry.kind === 'dir') fs.mkdirSync(target, { recursive: true })
    else if (entry.fixture) fs.copyFileSync(path.resolve(here, '../..', entry.fixture), target)
    else fs.writeFileSync(target, '')
    return target
  }
  const open = (args, fn) => {
    const o = optsOf(args)
    const entry = answers.open?.[titleOf(o)]
    rec(fn, { title: titleOf(o), properties: o.properties })
    return entry ? made(entry) : null
  }
  const save = (args, fn) => {
    const o = optsOf(args)
    const entry = answers.save?.[titleOf(o)]
    rec(fn, { title: titleOf(o) })
    return entry ? made({ ...entry, kind: 'file' }) : null
  }
  const box = (args, fn) => {
    const o = optsOf(args)
    rec(fn, { title: titleOf(o), buttons: o.buttons })
    return answers.messageBox?.[titleOf(o)] ?? o.cancelId ?? 0
  }
  dialog.showOpenDialog = async (...a) => {
    const p = open(a, 'dialog.showOpenDialog')
    return p ? { canceled: false, filePaths: [p] } : { canceled: true, filePaths: [] }
  }
  dialog.showOpenDialogSync = (...a) => {
    const p = open(a, 'dialog.showOpenDialogSync')
    return p ? [p] : undefined
  }
  dialog.showSaveDialog = async (...a) => {
    const p = save(a, 'dialog.showSaveDialog')
    return p ? { canceled: false, filePath: p } : { canceled: true, filePath: '' }
  }
  dialog.showSaveDialogSync = (...a) => save(a, 'dialog.showSaveDialogSync') || undefined
  dialog.showMessageBox = async (...a) => ({ response: box(a, 'dialog.showMessageBox'), checkboxChecked: false })
  dialog.showMessageBoxSync = (...a) => box(a, 'dialog.showMessageBoxSync')

  electron.Notification = class {
    constructor(options = {}) {
      this.options = options
    }
    static isSupported() {
      return true
    }
    show() {
      rec('Notification.show', { title: this.options.title, body: this.options.body })
    }
    on() {
      return this
    }
    once() {
      return this
    }
    close() {}
  }
  return electron
}

// ---------- load ----------

if (!state.loaded) {
  checkNode()
  loadInherited()
  const policy = JSON.parse(fs.readFileSync(path.join(here, 'env-policy.json'), 'utf8'))
  const given = process.env.IV_TEST_RUN_DIR
  state.runDir = given || fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'iv-test-run-')))
  // a run folder this process made is throwaway; one handed down (a child's, or the driver's evidence folder) is not ours to delete
  if (!given) process.on('exit', () => fs.rmSync(state.runDir, { recursive: true, force: true }))
  fs.mkdirSync(state.runDir, { recursive: true })
  process.env.IV_TEST_RUN_DIR = state.runDir
  const { env, found } = applyEnvPolicy(process.env, policy, path.join(state.runDir, 'env'))
  for (const k of Object.keys(process.env)) if (!(k in env)) delete process.env[k]
  Object.assign(process.env, env)
  state.found = found
  install()
  const inElectronMain = !!process.versions.electron && process.type === 'browser'
  if (inElectronMain) {
    try {
      const answers = JSON.parse(fs.readFileSync(path.join(here, 'dialog-answers.json'), 'utf8'))
      installElectronStubs(require('electron'), { answers, tempDir: path.join(state.runDir, 'dialogs') })
    } catch (e) {
      state.electronError = String(e?.message || e)
    }
  }
  state.loaded = true
  fs.writeFileSync(
    path.join(state.runDir, 'guard-loaded.json'),
    JSON.stringify({ pid: process.pid, processType: process.type || 'node', electron: !!process.versions.electron, allowedPorts: [...state.ports], scrubbedFound: found, electronError: state.electronError || null }, null, 2)
  )
}

export { LOOPBACK, pathToFileURL }
