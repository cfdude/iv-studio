// The page-tier driver (design D3, D8): launches the built app under the test guard and drives its window over the
// Chrome DevTools protocol with Node's built-in WebSocket. No dependency, and it never builds: `npm run build` first.
//   npm run test:ui
// What a launch does, in order: checks out/ is newer than src/, starts nothing itself but takes a fake ComfyUI, seeds a
// temp data folder, builds Electron's environment (scrubbed keys gone, HOME and the data folders at temp), starts
// Electron with the guard in its main process and every Chromium request sent to a dead proxy except to the fakes'
// ports, waits for the guard's load marker (and stops if it never comes), then attaches to the window.
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { seedSettings } from '../fakes/mcp.mjs'
import { guardState, registerPort, registerProgram } from '../fakes/ports.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(here, '../..')
export const GUARD_URL = pathToFileURL(path.join(ROOT, 'test/fakes/guard.mjs')).href
export const REAL_HOME = os.userInfo().homedir // os.homedir() is the temp home once the guard has run
const policy = JSON.parse(fs.readFileSync(path.join(ROOT, 'test/fakes/env-policy.json'), 'utf8'))

// ---------- the build check ----------

function newest(dir, pick) {
  let best = null
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name)
      if (e.isDirectory()) walk(f)
      else if (e.isFile()) {
        const t = fs.statSync(f).mtimeMs
        if (!best || pick(t, best.t)) best = { file: f, t }
      }
    }
  }
  walk(dir)
  return best
}

// Throws, naming the newest changed file under src/, when anything under out/ is older than it. Never builds.
export function checkBuild(root = ROOT) {
  const out = path.join(root, 'out')
  if (!fs.existsSync(path.join(out, 'main', 'index.js'))) throw new Error('There is no build in out/. Run `npm run build` first.')
  const src = newest(path.join(root, 'src'), (a, b) => a > b)
  const oldestOut = newest(out, (a, b) => a < b)
  if (src && oldestOut && oldestOut.t < src.t) {
    throw new Error(`out/ is older than src/: ${path.relative(root, src.file)} changed after ${path.relative(root, oldestOut.file)} was built. Run \`npm run build\` first.`)
  }
}

// ---------- Electron's launch ----------

// The environment Electron gets: built here, not inherited, so the scrub holds before the guard loads.
export function electronEnv(shellEnv, { home, data, userData, runDir, ports = [] }) {
  const env = { ...shellEnv }
  for (const e of policy.remove) delete env[e.name]
  delete env.ELECTRON_RUN_AS_NODE // would start Electron as plain Node, with no window
  delete env.NODE_OPTIONS
  for (const e of policy.pin) delete env[e.name]
  Object.assign(env, {
    HOME: home,
    IV_STUDIO_DATA: data,
    IV_STUDIO_USER_DATA: userData,
    IV_TEST_RUN_DIR: runDir,
    IV_TEST_ALLOW_PORTS: ports.join(','),
    NODE_OPTIONS: `--import=${GUARD_URL}`
  })
  // the other pinned names point at temp files that do not exist
  for (const e of policy.pin) {
    if (e.name in env) continue
    env[e.name] = e.to === 'dir' ? path.join(home, e.name.toLowerCase()) : path.join(runDir, e.name.toLowerCase(), 'does-not-exist')
  }
  return env
}

// Chromium sends everything to a dead proxy except the fakes' ports. `<-loopback>` takes away the implicit loopback
// bypass, so an unregistered local port (a real ComfyUI on 8188) is refused too.
export function proxyArgs(deadPort, ports) {
  return [`--proxy-server=127.0.0.1:${deadPort}`, `--proxy-bypass-list=${['<-loopback>', ...ports.map((p) => `127.0.0.1:${p}`)].join(';')}`]
}

export function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer()
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => resolve(port))
    })
    s.on('error', reject)
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Waits for the guard's marker from Electron's main process (with the paths the app resolved once ready). The run
// stops, and says so, when it never comes.
export async function waitForMarker(runDir, { timeoutMs = 20000, ready = true } = {}) {
  const file = path.join(runDir, 'guard-loaded.json')
  const until = Date.now() + timeoutMs
  let last = null
  while (Date.now() < until) {
    try {
      last = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (!ready || last.paths) break
    } catch {
      /* not written yet */
    }
    await sleep(100)
  }
  if (!last) throw new Error("The guard did not load in Electron's main process (no guard-loaded.json). The page tier does not run unguarded.")
  if (!last.electron || last.processType !== 'browser') throw new Error(`The guard loaded in the wrong process (${last.processType}), not Electron's main process.`)
  if (last.electronError) throw new Error(`The guard could not stub Electron: ${last.electronError}`)
  if (ready && !last.paths) throw new Error("Electron's main process wrote a guard marker but the app never became ready.")
  return last
}

// ---------- the DevTools protocol ----------

export class Cdp {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    this.handlers = new Map()
    ws.addEventListener('message', (m) => {
      const msg = JSON.parse(m.data)
      if (msg.id) {
        const p = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (p) msg.error ? p.reject(new Error(`${p.method}: ${msg.error.message}`)) : p.resolve(msg.result)
      } else for (const h of this.handlers.get(msg.method) || []) h(msg.params)
    })
  }
  static async connect(url) {
    const ws = new WebSocket(url)
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true })
      ws.addEventListener('error', () => reject(new Error(`DevTools connection to ${url} failed`)), { once: true })
    })
    return new Cdp(ws)
  }
  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  on(method, fn) {
    this.handlers.set(method, [...(this.handlers.get(method) || []), fn])
  }
  close() {
    try {
      this.ws.close()
    } catch {
      /* closed */
    }
  }
}

// ---------- evidence ----------

export const runId = process.env.IV_TEST_RUN_ID || `ui-${new Date().toISOString().replace(/[:.]/g, '-')}`
export const evidenceDir = path.join(process.env.IV_TEST_EVIDENCE_DIR || path.join(REAL_HOME, 'Documents/Repos/iv-studio-dev/docs/backlog/evidence'), runId)

// ---------- launching the app ----------

let electronBinary = null
function electronPath() {
  electronBinary ??= createRequire(import.meta.url)('electron')
  if (typeof electronBinary !== 'string' || !fs.existsSync(electronBinary)) throw new Error('The Electron binary is not installed. Run `node node_modules/electron/install.js`.')
  return electronBinary
}

// Starts the built app. `fake` is a started fake ComfyUI (or null to leave comfyUrl at its default).
//   name: a folder name inside the evidence folder; settings: extra settings.json keys.
export async function launchApp({ name = 'app', fake = null, settings = {}, timeoutMs = 30000 } = {}) {
  checkBuild()
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'iv-ui-')))
  const home = path.join(base, 'home')
  const data = path.join(base, 'data')
  const userData = path.join(base, 'userdata')
  const runDir = path.join(base, 'run')
  for (const d of [home, data, userData, runDir]) fs.mkdirSync(d, { recursive: true })
  // `onboarded` is seeded so the first-run welcome overlay does not cover the pages (a test can pass its own)
  seedSettings(data, { comfyUrl: fake?.url, extra: { onboarded: '2026-01-01T00:00:00.000Z', ...settings } })
  const seeded = JSON.parse(fs.readFileSync(path.join(data, 'settings.json'), 'utf8'))
  if (fake?.url === undefined) delete seeded.comfyUrl
  fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify(seeded, null, 2))

  const ports = [...guardState().ports]
  const deadPort = await freePort()
  const env = electronEnv(process.env, { home, data, userData, runDir, ports })
  const binary = electronPath()
  registerProgram(binary)
  const args = [ROOT, '--remote-debugging-port=0', '--use-mock-keychain', `--user-data-dir=${userData}`, ...proxyArgs(deadPort, ports)]
  const child = spawn(binary, args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
  let stderr = ''
  let stdout = ''
  child.stdout.on('data', (d) => (stdout += d))
  child.stderr.on('data', (d) => (stderr += d))
  const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })))
  let died = null
  exited.then((r) => (died = r))

  const kill = async () => {
    try {
      if (died === null) child.kill('SIGTERM')
    } catch {
      /* gone */
    }
    await Promise.race([exited, sleep(5000)])
    if (died === null) child.kill('SIGKILL')
  }
  const copyEvidence = () => {
    const dest = path.join(evidenceDir, name)
    fs.mkdirSync(dest, { recursive: true })
    for (const f of ['guard-loaded.json', 'guard-refusals.json', 'guard-network-refusals.json', 'guard-trace.json', 'ipc-trace.jsonl']) {
      if (fs.existsSync(path.join(runDir, f))) fs.copyFileSync(path.join(runDir, f), path.join(dest, f))
    }
    fs.writeFileSync(path.join(dest, 'electron.log'), `args: ${args.join(' ')}\n--- stdout\n${stdout}\n--- stderr\n${stderr}\n`)
  }

  try {
    // the DevTools port, from Electron's own line on stderr; registered with the guard before anything connects to it
    const cdpPort = await (async () => {
      const until = Date.now() + timeoutMs
      while (Date.now() < until) {
        const m = /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//.exec(stderr)
        if (m) return Number(m[1])
        if (died) throw new Error(`Electron exited before it opened a window (${JSON.stringify(died)}). ${stderr.slice(-400)}`)
        await sleep(100)
      }
      throw new Error(`Electron did not report a DevTools port in ${timeoutMs} ms. ${stderr.slice(-400)}`)
    })()
    registerPort(cdpPort)
    const marker = await waitForMarker(runDir, { timeoutMs })

    const page = await (async () => {
      const until = Date.now() + timeoutMs
      while (Date.now() < until) {
        const list = await fetch(`http://127.0.0.1:${cdpPort}/json/list`).then((r) => r.json())
        const t = list.find((x) => x.type === 'page' && /index\.html/.test(x.url))
        if (t) return t
        await sleep(150)
      }
      throw new Error('The app opened no window.')
    })()
    const cdp = await Cdp.connect(page.webSocketDebuggerUrl)
    const consoleErrors = []
    const crashes = []
    const failedRequests = []
    const urls = new Map()
    cdp.on('Runtime.exceptionThrown', (p) => consoleErrors.push(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text))
    cdp.on('Runtime.consoleAPICalled', (p) => p.type === 'error' && consoleErrors.push(p.args.map((a) => a.value ?? a.description).join(' ')))
    cdp.on('Inspector.targetCrashed', () => crashes.push('renderer crashed'))
    cdp.on('Network.requestWillBeSent', (p) => urls.set(p.requestId, p.request.url))
    cdp.on('Network.loadingFailed', (p) => failedRequests.push({ url: urls.get(p.requestId), error: p.errorText }))
    for (const d of ['Runtime', 'Page', 'Network', 'Inspector']) await cdp.send(`${d}.enable`)

    const app = {
      name,
      pid: child.pid,
      base,
      home,
      data,
      userData,
      runDir,
      cdpPort,
      deadPort,
      args,
      env,
      marker,
      cdp,
      consoleErrors,
      crashes,
      failedRequests,
      readJson: (f) => {
        try {
          return JSON.parse(fs.readFileSync(path.join(runDir, f), 'utf8'))
        } catch {
          return []
        }
      },
      refusals: () => app.readJson('guard-refusals.json'),
      networkRefusals: () => app.readJson('guard-network-refusals.json'),
      trace: () => app.readJson('guard-trace.json'),
      // every channel call the main process handled so far, in order: [{ channel, args }] (argument shapes, no values)
      ipcTrace: () => {
        try {
          return fs.readFileSync(path.join(runDir, 'ipc-trace.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
        } catch {
          return []
        }
      },
      // runs an expression in the window and returns its value; a thrown error or a rejected promise throws here
      async evaluate(expression) {
        const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
        return r.result.value
      },
      // waits for the page's text to stop changing, then returns it
      async settle({ timeoutMs: t = 15000 } = {}) {
        const until = Date.now() + t
        let prev = ''
        let stable = 0
        while (Date.now() < until) {
          const text = await app.evaluate(`document.body ? document.body.innerText : ''`)
          if (text && text === prev) stable++
          else stable = 0
          prev = text
          if (stable >= 3) return text
          await sleep(250)
        }
        return prev
      },
      // writes a file into this launch's evidence folder
      evidence(file, content) {
        const dest = path.join(evidenceDir, name, file)
        fs.mkdirSync(path.dirname(dest), { recursive: true })
        fs.writeFileSync(dest, content)
        return dest
      },
      async screenshot(file) {
        const { data: b64 } = await cdp.send('Page.captureScreenshot', { format: 'png' })
        const dest = path.join(evidenceDir, name, file)
        fs.mkdirSync(path.dirname(dest), { recursive: true })
        fs.writeFileSync(dest, Buffer.from(b64, 'base64'))
        return dest
      },
      async close() {
        cdp.close()
        await kill()
        copyEvidence()
        fs.rmSync(base, { recursive: true, force: true })
      }
    }
    return app
  } catch (e) {
    await kill()
    copyEvidence()
    fs.rmSync(base, { recursive: true, force: true })
    throw e
  }
}

// ---------- the person's real folders must not change ----------

// name and modification time of every file under `dir`, leaving out paths that hold code checkouts or the evidence folder
export function listing(dir, skip = /iv-studio|evidence/i) {
  const out = []
  const walk = (d) => {
    let entries = []
    try {
      entries = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const f = path.join(d, e.name)
      if (skip.test(f)) continue
      let t = null
      try {
        t = fs.lstatSync(f).mtimeMs
      } catch {
        continue
      }
      out.push(`${f}\t${t}`)
      if (e.isDirectory()) walk(f)
    }
  }
  walk(dir)
  return out.sort()
}

// An unpackaged Electron on macOS writes AppKit/StoreKit defaults to ~/Library/Preferences/com.github.Electron.plist in the
// account's real home. CFFIXED_USER_HOME does not move it (tried 2026-11-11: the file still changed with it set to the
// temp home), and the file holds no app data (AppleTextDirection, NSForceRightToLeftWritingDirection,
// NSTreatUnknownArgumentsAsOpen, SKPurchaseIntentUpdatesLastChecked). That one file is accepted. Any other Electron or
// IV Studio preferences file that appears or changes in the real home fails the page tier, and so does app data in it.
export const ACCEPTED_PREFS = path.join(REAL_HOME, 'Library', 'Preferences', 'com.github.Electron.plist')
const PREFS_WATCHED = /^com\.github\.electron|iv-?studio/i
// name and modification time of the watched preferences files under `dir`, the accepted one left out
export const prefsListing = (dir = path.dirname(ACCEPTED_PREFS), accepted = ACCEPTED_PREFS) =>
  listing(dir, /^$/).filter((l) => PREFS_WATCHED.test(path.basename(l.split('\t')[0])) && l.split('\t')[0] !== accepted)
// true when the bytes mention app data: a service, a key or token, or a user path
export const appDataIn = (bytes) => /comfy|civitai|runpod|modal|iv[- ]?studio|token|secret|api[-_ ]?key|\/Users\/|\/private\/var/i.test(Buffer.from(bytes).toString('latin1'))
