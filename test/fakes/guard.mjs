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
import workerThreads from 'node:worker_threads'
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
  const tmp = fs.realpathSync(os.tmpdir())
  const underTemp = (v) => {
    if (typeof v !== 'string' || !path.isAbsolute(v)) return false
    let dir = path.dirname(v)
    while (!fs.existsSync(dir) && dir !== path.dirname(dir)) dir = path.dirname(dir)
    const real = fs.realpathSync(dir)
    return real === tmp || real.startsWith(tmp + path.sep)
  }
  for (const e of policy.pin) {
    // a temp path a harness chose on purpose (the MCP child's seeded data folder) stays; anything else is replaced
    if (underTemp(out[e.name])) continue
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

const networkError = (host, port, what = 'a network call', pathname = null) => {
  state.netRefusals.push({ host: String(host), port: Number(port), what, path: pathname, at: new Date().toISOString() })
  if (state.runDir) {
    try {
      fs.writeFileSync(path.join(state.runDir, 'guard-network-refusals.json'), JSON.stringify(state.netRefusals, null, 2))
    } catch {
      /* the run folder is gone; the in-memory list still holds it */
    }
  }
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
    if (!portAllowed(host, port)) throw networkError(host, port, what, new URL(u).pathname)
  }
  if (realFetch) {
    globalThis.fetch = async function guardedFetch(input, init) {
      checkUrl(typeof input === 'string' || input instanceof URL ? input : input.url, 'a fetch')
      return realFetch.call(this, input, init)
    }
  }
  const RealWebSocket = globalThis.WebSocket
  if (RealWebSocket) {
    // A real WebSocket reports a refused connection later, as an error event and a close, never from its constructor, so
    // a refusal here does the same: the code under test sees what it would see from a server that is not there.
    class RefusedWebSocket extends EventTarget {
      static CONNECTING = 0
      static OPEN = 1
      static CLOSING = 2
      static CLOSED = 3
      constructor(url, refusal) {
        super()
        this.url = String(url)
        this.readyState = 0
        this.protocol = ''
        this.extensions = ''
        this.bufferedAmount = 0
        this.binaryType = 'blob'
        for (const type of ['open', 'message', 'error', 'close']) {
          this[`on${type}`] = null
          this.addEventListener(type, (event) => this[`on${type}`]?.call(this, event))
        }
        setTimeout(() => {
          this.readyState = 3
          const error = new Event('error')
          Object.assign(error, { message: refusal.message, error: refusal })
          this.dispatchEvent(error)
          const close = new Event('close')
          Object.assign(close, { code: 1006, reason: '', wasClean: false })
          this.dispatchEvent(close)
        }, 0)
      }
      send() {
        throw new DOMException('WebSocket is not open: readyState 0 (CONNECTING)', 'InvalidStateError')
      }
      close() {}
    }
    globalThis.WebSocket = class GuardedWebSocket extends RealWebSocket {
      constructor(url, ...rest) {
        try {
          checkUrl(url, 'a WebSocket')
        } catch (e) {
          if (e?.ivGuardRefused) return new RefusedWebSocket(url, e)
          throw e
        }
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

  // Any `scheme://` other than file: (rtsp, ftp, srt, tls, http, a wrapper such as crypto+http or async:http ...), and the
  // protocol names that ffmpeg also takes with no slashes (tcp:host:80, async:, cache:, concat:a|b ...). `file:`, `pipe:`,
  // `fd:` and a Windows drive (C:\) are fine. Filter text such as anullsrc=r=48000:cl=stereo or print:file=- does not match.
  const BARE_PROTOCOL = new RegExp(
    '(?:^|[=,\\s|:+\'"(])(?:async|cache|concat|concatf|crypto|ffrtmphttp|ftp|gopher|gophers|hls|http|httpproxy|https|icecast|ipfs|ipns|mmsh|mmst|prompeg|rist|rtmp|rtmpe|rtmps|rtmpt|rtmpte|rtmpts|rtp|rtsp|rtsps|sctp|sftp|smb|srt|srtp|subfile|tcp|tls|udp|udplite|unix|zmq):',
    'i'
  )
  const networkArg = (a) => {
    for (const m of String(a).matchAll(/([a-z][a-z0-9+.-]+):\/\//gi)) if (m[1].toLowerCase() !== 'file') return true
    return BARE_PROTOCOL.test(a)
  }
  // What may leave a shell string unexamined: nothing that chains, pipes, substitutes or redirects into another command.
  const SHELL_CHAIN = /[;&|`\n\r<>]|\$\(/
  const LOCAL_ONLY = ['-protocol_whitelist', 'file,pipe,fd']
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
    const argv = Array.isArray(args) ? args.map(String) : []
    if (shell) {
      // a shell reads command and arguments as one string: the first word is not the whole story
      const whole = [name, ...argv].join(' ')
      if (SHELL_CHAIN.test(whole)) return { ok: false, name: name.trim().split(/\s+/)[0], why: 'a shell command that chains, pipes, substitutes or redirects is refused' }
      name = name.trim().split(/\s+/)[0].replace(/^["']|["']$/g, '')
    }
    const base = path.basename(name)
    if (/^node(\.exe)?$/i.test(base)) return { ok: true, command: shell ? command : process.execPath, node: true, name }
    const abs = name.includes('/') || name.includes('\\') ? path.resolve(options?.cwd || process.cwd(), name) : onPath(name, options?.env?.PATH)
    if (!abs) return { ok: false, name, why: 'not found on PATH' }
    const real = realpath(abs)
    if (allowed.has(real)) {
      if (media.includes(real)) {
        if ([shell ? String(command) : '', ...argv].some(networkArg)) return { ok: false, name: path.basename(name), why: 'a network input or output is refused' }
        if (argv.includes('-protocol_whitelist')) return { ok: false, name: path.basename(name), why: 'the test sets the protocol whitelist itself' }
        if (shell) return { ok: false, name: path.basename(name), why: 'ffmpeg through a shell cannot be limited to local files' }
        // before each input (and at the front for ffprobe, whose input is positional), so a playlist or concat file
        // that names a network address is refused by ffmpeg itself
        const probe = /ffprobe/i.test(path.basename(real))
        const out = []
        for (const a of argv) a === '-i' ? out.push(...LOCAL_ONLY, a) : out.push(a)
        return { ok: true, command, args: probe && !argv.includes('-i') ? [...LOCAL_ONLY, ...argv] : out, node: false, name }
      }
      return { ok: true, command, node: real === realpath(process.execPath), name }
    }
    if (state.programs.has(real)) {
      const only = state.programFirstArg?.get(real)
      if (only !== undefined && (shell || argv[0] !== only)) return { ok: false, name: base, why: `only allowed with ${only} as its first argument` }
      return { ok: true, command, node: false, name }
    }
    if (inShimDir(abs)) return { ok: true, command, node: false, name }
    return { ok: false, name: base, why: 'not on the test allowlist' }
  }

  // what a child gets: the guard in NODE_OPTIONS, the allowed ports and shim folders, its own run folder
  let childCount = 0
  function childEnv(options, node) {
    const env = { ...(options?.env || process.env) }
    env.IV_TEST_ALLOW_PORTS = [...state.ports].join(',')
    env.IV_TEST_SHIM_DIRS = [...state.shimDirs].join(path.delimiter)
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
    return realSpawn(j.node && !options.shell ? process.execPath : command, j.args ?? args, { ...options, env: childEnv(options, j.node) })
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
    return realSpawnSync(j.node && !options.shell ? process.execPath : command, j.args ?? args, { ...options, env: childEnv(options, j.node) })
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
    return realExecFile(j.node && !options.shell ? process.execPath : file, j.args ?? args, { ...options, env: childEnv(options, j.node) }, cb)
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
    return realExecFileSync(j.node && !options.shell ? process.execPath : file, j.args ?? args, { ...options, env: childEnv(options, j.node) })
  }
  cp.exec = function guardedExec(command, ...rest) {
    const cb = typeof rest.at(-1) === 'function' ? rest.pop() : undefined
    const options = rest[0] && typeof rest[0] === 'object' ? rest[0] : {}
    const j = judge(command, [], options, { shell: true })
    if (!j.ok) {
      recordRefusal('exec', j.name, j.why)
      const child = realExecFile(nowhere, [], {}, cb && ((e, so, se) => cb(e && mark(e, j.name, j.why), so, se)))
      return refuseChild(child, j.name, j.why)
    }
    return realExec(command, { ...options, env: childEnv(options, j.node) }, cb)
  }
  cp.execSync = function guardedExecSync(command, options = {}) {
    const j = judge(command, [], options, { shell: true })
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
  // A worker thread is a fresh realm with its own fetch, so it needs the guard too. A file worker gets --import (a worker
  // started with an execArgv of its own would otherwise drop the inherited one); a string worker (eval: true) runs as a
  // script, where --import is not applied, so the guard is required first.
  const RealWorker = workerThreads.Worker
  workerThreads.Worker = class GuardedWorker extends RealWorker {
    constructor(file, options = {}) {
      // with no execArgv of its own the worker inherits the parent's, --import included
      const execArgv = Array.isArray(options.execArgv) && !options.execArgv.includes(GUARD_URL) ? [...options.execArgv, '--import', GUARD_URL] : options.execArgv
      const code = options.eval && typeof file === 'string' ? `require(${JSON.stringify(fileURLToPath(GUARD_URL))});\n${file}` : file
      super(code, execArgv ? { ...options, execArgv } : options)
    }
  }
  // the named imports in src/ (import { spawn } from 'node:child_process') read these live bindings
  module.syncBuiltinESMExports()
}

// ---------- Electron's main process ----------

// Replaces shell, dialog and Notification on `electron` with stubs that show and open nothing, record the call in
// `trace`, and return canned answers (answers: { open, save, messageBox } keyed by dialog title).
// The trace is also written to `traceFile` (the guard's own trace goes to guard-trace.json in the run folder), so the
// page-tier driver, a different process, can read it.
export function installElectronStubs(electron, { answers = {}, tempDir = os.tmpdir(), trace = state.trace, traceFile = trace === state.trace && state.runDir ? path.join(state.runDir, 'guard-trace.json') : null } = {}) {
  const rec = (fn, extra) => {
    trace.push({ fn, ...extra })
    if (traceFile) {
      try {
        fs.writeFileSync(traceFile, JSON.stringify(trace, null, 2))
      } catch {
        /* the run folder is gone */
      }
    }
  }
  const { shell, dialog, app } = electron
  // a restart records the call and neither relaunches nor exits: the driver would lose the window it is driving
  if (app) {
    app.relaunch = (...a) => void rec('app.relaunch', { arg: a[0] ?? null })
    app.exit = (code) => void rec('app.exit', { arg: code ?? 0 })
  }
  shell.openExternal = async (url) => void rec('shell.openExternal', { arg: url })
  shell.openPath = async (p) => (rec('shell.openPath', { arg: p }), '')
  shell.showItemInFolder = (p) => void rec('shell.showItemInFolder', { arg: p })

  const titleOf = (o) => o?.title ?? o?.message ?? ''
  const optsOf = (args) => (args.length > 1 ? args[1] : args[0]) || {}
  const made = (entry, title) => {
    fs.mkdirSync(tempDir, { recursive: true })
    const dir = fs.mkdtempSync(path.join(tempDir, 'dialog-'))
    const target = path.join(dir, entry.name || 'picked')
    if (entry.kind === 'dir') {
      fs.mkdirSync(target, { recursive: true })
      // files the folder holds (names relative to it), for a folder the app checks the contents of
      for (const f of entry.contents || []) {
        fs.mkdirSync(path.dirname(path.join(target, f)), { recursive: true })
        fs.writeFileSync(path.join(target, f), '')
      }
    }
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

  class Quiet {
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
  try {
    electron.Notification = Quiet
  } catch {
    // Electron's own `Notification` is a getter that cannot be replaced or redefined, so patch the class it hands out:
    // supported, and showing records the call and shows nothing
    const Real = electron.Notification
    Real.isSupported = () => true
    Real.prototype.show = function show() {
      rec('Notification.show', { title: this.title ?? this.options?.title, body: this.body ?? this.options?.body })
    }
  }
  return electron
}

// The shape of an argument: key names and types, never values (so the trace holds no prompt, path or key).
// { b: 1, a: 'x' } -> '{a:string,b:number}'; a list is '[]' when empty, else '[<shape of its first item>]'. A key that is
// a generated id (8 or more hex characters, as in the edit's `media` map) is written `<id>`, so a run's own ids do not
// change the shape.
export function shapeOf(v) {
  if (v === null) return 'null'
  if (Array.isArray(v)) return v.length ? `[${shapeOf(v[0])}]` : '[]'
  if (typeof v === 'object') return `{${Object.keys(v).map((k) => [/^[0-9a-f]{8,}$/.test(k) ? '<id>' : k, shapeOf(v[k])]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, sh]) => `${k}:${sh}`).join(',')}}`
  return typeof v
}

// Wraps ipcMain.handle so that each call to a channel is recorded, in order, as one JSON line in `file`:
// { channel, args } (the argument shapes, without Electron's event). The real handler runs unchanged. This is the
// page tier's channel trace (design D10): `window.ivstudio` is made by contextBridge, and the main process is where
// every call arrives, whoever made it. Test code, not product code.
export function installIpcTrace(ipcMain, { file, inflightFile = null }) {
  const real = ipcMain.handle.bind(ipcMain)
  // how many calls the main process has open (taken and not yet answered), kept in a file so the page tier can tell
  // when the window's start-up calls have all landed and been answered
  let open = 0
  const count = (n) => {
    open += n
    if (!inflightFile) return
    try {
      fs.writeFileSync(`${inflightFile}.tmp`, String(open))
      fs.renameSync(`${inflightFile}.tmp`, inflightFile) // never read half-written
    } catch {
      /* the run folder is gone */
    }
  }
  ipcMain.handle = (channel, listener) =>
    real(channel, (event, ...args) => {
      try {
        fs.appendFileSync(file, `${JSON.stringify({ channel, args: `[${args.map(shapeOf).join(',')}]` })}\n`)
      } catch {
        /* the run folder is gone */
      }
      count(1)
      let result
      try {
        result = listener(event, ...args)
      } catch (e) {
        count(-1)
        throw e
      }
      return Promise.resolve(result).then(
        (v) => (count(-1), v),
        (e) => (count(-1), Promise.reject(e))
      )
    })
  return ipcMain
}

// On macOS Electron's 'home', 'videos' and the other user folders do NOT follow $HOME (they come from the account
// record), so a pinned HOME would still leave app.getPath('videos') at the person's real ~/Movies. This points each one
// at a folder inside the temp home, and returns { name: folder }.
export const ELECTRON_FOLDERS = { home: '', videos: 'Movies', documents: 'Documents', downloads: 'Downloads', desktop: 'Desktop', music: 'Music', pictures: 'Pictures' }
export function pinElectronPaths(app, home) {
  const pinned = {}
  for (const [name, sub] of Object.entries(ELECTRON_FOLDERS)) {
    const dir = sub ? path.join(home, sub) : home
    fs.mkdirSync(dir, { recursive: true })
    app.setPath(name, dir)
    pinned[name] = dir
  }
  return pinned
}

// What the app resolves for each of those folders (plus userData), read live.
export function readElectronPaths(app) {
  return Object.fromEntries([...Object.keys(ELECTRON_FOLDERS), 'userData'].map((n) => [n, app.getPath(n)]))
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
  const writeMarker = (paths) =>
    fs.writeFileSync(
      path.join(state.runDir, 'guard-loaded.json'),
      JSON.stringify({ pid: process.pid, processType: process.type || 'node', electron: !!process.versions.electron, allowedPorts: [...state.ports], scrubbedFound: found, electronError: state.electronError || null, paths: paths || null }, null, 2)
    )
  let electronApp = null
  if (inElectronMain) {
    try {
      const answers = JSON.parse(fs.readFileSync(path.join(here, 'dialog-answers.json'), 'utf8'))
      const electron = require('electron')
      installElectronStubs(electron, { answers, tempDir: path.join(state.runDir, 'dialogs') })
      installIpcTrace(electron.ipcMain, { file: path.join(state.runDir, 'ipc-trace.jsonl'), inflightFile: path.join(state.runDir, 'ipc-inflight') })
      pinElectronPaths(electron.app, process.env.HOME)
      electronApp = electron.app
    } catch (e) {
      state.electronError = String(e?.message || e)
    }
  }
  state.loaded = true
  writeMarker()
  // once the app is ready, say what it resolves for home, videos and the rest (the page tier reads these)
  if (electronApp) {
    electronApp
      .whenReady()
      .then(() => writeMarker(readElectronPaths(electronApp)))
      .catch((e) => {
        state.electronError = String(e?.message || e)
        writeMarker()
      })
  }
}

export { LOOPBACK, pathToFileURL }
