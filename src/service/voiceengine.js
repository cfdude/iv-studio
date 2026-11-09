// IV Studio's own voice engine, so no separate app is needed: VoxCPM2 (OpenBMB, Apache-2.0, code and weights)
// speaks, designs and clones voices, and Whisper large-v3 turbo (OpenAI, MIT) reads the words in a recording.
// Both run in a Python environment IV Studio makes with uv in its data folder (voiceengine/), driven by
// resources/python/voice_server.py one JSON line at a time. The models load on first use; stopping the
// process is how the GPU gets its memory back.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { Cloud } from './cloud.js'

// Pinned: torch's CUDA 12.8 build, and torchcodec from PyPI (the CUDA index has no Windows build of it).
export const VOICE_PACKAGES = ['torch==2.9.1', 'torchaudio==2.9.1', 'torchcodec==0.9.1', 'voxcpm==2.0.3']
const TORCH_INDEX = 'https://download.pytorch.org/whl/cu128'
export const VOICE_SETUP = {
  size: 12 * 1024 ** 3, // about 5.2 GB of Python packages and 6.6 GB of models
  models: [
    { name: 'VoxCPM2', by: 'OpenBMB', licence: 'Apache-2.0', url: 'https://huggingface.co/openbmb/VoxCPM2' },
    { name: 'Whisper large-v3 turbo', by: 'OpenAI', licence: 'MIT', url: 'https://huggingface.co/openai/whisper-large-v3-turbo' }
  ]
}
const VERSION = 1 // bump when VOICE_PACKAGES or the models change, so setup runs again

const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

// Said on a Mac, where the voice engine's PyTorch (CUDA) build and models are not set up yet.
export const MAC_VOICES_LATER = 'Voices on Mac come in a later release.'

export class VoiceEngine {
  // beforeLoad: called before the worker starts, to make room on the GPU (see Voices).
  constructor({ dataDir, resourcesDir, onLog, beforeLoad, platform = process.platform }) {
    this.platform = platform
    this.beforeLoad = beforeLoad || (async () => {})
    this.dir = path.join(dataDir, 'voiceengine')
    this.resourcesDir = resourcesDir
    this.onLog = onLog || (() => {})
    this.cloud = new Cloud({ dataDir, resourcesDir, onLog: this.onLog }) // for uv and its Python
    this.proc = null
    this.pending = new Map()
    this.seq = 0
    this.installing = null
  }

  get venv() {
    return path.join(this.dir, 'venv')
  }
  get python() {
    return path.join(this.venv, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
  }
  get models() {
    return path.join(this.dir, 'models')
  }
  get script() {
    return path.join(this.resourcesDir, 'python', 'voice_server.py')
  }
  marker = () => path.join(this.dir, 'installed.json')
  installed = () => fs.existsSync(this.python) && readJson(this.marker(), {}).version === VERSION

  status() {
    const unavailable = this.platform === 'darwin' ? MAC_VOICES_LATER : undefined
    return { installed: this.installed(), installing: !!this.installing, running: !!this.proc, setup: VOICE_SETUP, ...(unavailable && { unavailable }) }
  }

  env() {
    return { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', HF_HUB_DISABLE_TELEMETRY: '1', HF_HUB_DISABLE_PROGRESS_BARS: '1' }
  }

  // Once, about 12 GB: Python 3.12, PyTorch for CUDA and VoxCPM, then both models.
  install() {
    if (this.platform === 'darwin') return Promise.reject(new Error(MAC_VOICES_LATER)) // before any download
    if (this.installed()) return Promise.resolve(this.status())
    if (!this.installing)
      this.installing = (async () => {
        await this.cloud.ensureUv()
        const env = this.cloud.uvEnv()
        fs.mkdirSync(this.dir, { recursive: true })
        this.onLog('Setting up Python for voices…')
        if (!fs.existsSync(this.python)) await this.cloud.exec(this.cloud.uvExe, ['venv', this.venv, '--python', '3.12'], { env })
        this.onLog('Installing PyTorch and VoxCPM (about 5 GB)…')
        await this.cloud.exec(this.cloud.uvExe, ['pip', 'install', '--python', this.venv, '--index', TORCH_INDEX, '--index-strategy', 'unsafe-best-match', ...VOICE_PACKAGES], { env })
        this.onLog('Downloading VoxCPM2 and Whisper (about 6.6 GB)…')
        await this.runScript(['--download', this.models])
        fs.writeFileSync(this.marker(), JSON.stringify({ version: VERSION, packages: VOICE_PACKAGES, at: new Date().toISOString() }, null, 2))
        this.onLog('Voices are ready.')
        return this.status()
      })().finally(() => (this.installing = null))
    return this.installing
  }

  // The download step: the script prints {"progress"} lines, then {"done"}.
  runScript(args) {
    return new Promise((resolve, reject) => {
      const p = spawn(this.python, ['-u', this.script, ...args], { env: this.env(), windowsHide: true })
      let err = ''
      p.stdout.on('data', (d) => {
        for (const line of String(d).split(/\r?\n/).filter(Boolean)) {
          try {
            const m = JSON.parse(line)
            if (m.progress) this.onLog(m.progress)
          } catch {}
        }
      })
      p.stderr.on('data', (d) => (err = (err + d).slice(-4000)))
      p.on('error', reject)
      p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Voice setup stopped: ${err.trim().split(/\r?\n/).pop() || code}`))))
    })
  }

  // The worker, started on first use.
  start() {
    if (this.proc) return this.proc.ready
    if (!this.installed()) throw new Error('Set up voices first: Audio > Voices > Set up voices.')
    const p = spawn(this.python, ['-u', this.script, this.models], { env: this.env(), windowsHide: true })
    const state = { p, ready: null, buf: '', err: '' }
    state.ready = new Promise((resolve, reject) => {
      state.resolveReady = resolve
      state.rejectReady = reject
    })
    p.stdout.on('data', (d) => {
      state.buf += d
      let i
      while ((i = state.buf.indexOf('\n')) >= 0) {
        const line = state.buf.slice(0, i).trim()
        state.buf = state.buf.slice(i + 1)
        if (!line) continue
        let m
        try {
          m = JSON.parse(line)
        } catch {
          continue
        }
        if (m.ready) state.resolveReady()
        const job = this.pending.get(m.id)
        if (!job) continue
        this.pending.delete(m.id)
        m.error ? job.reject(new Error(m.error)) : job.resolve(m)
      }
    })
    p.stderr.on('data', (d) => (state.err = (state.err + d).slice(-4000)))
    p.on('error', (e) => state.rejectReady(e))
    p.on('close', (code) => {
      if (this.proc === state) this.proc = null
      const why = new Error(`The voice engine stopped${code ? ` (${state.err.trim().split(/\r?\n/).pop() || code})` : ''}.`)
      state.rejectReady(why)
      for (const job of this.pending.values()) job.reject(why)
      this.pending.clear()
    })
    this.proc = state
    return state.ready
  }

  async call(op, args = {}) {
    if (!this.proc) await this.beforeLoad().catch(() => {})
    await this.start()
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.proc.p.stdin.write(JSON.stringify({ id, op, ...args }) + '\n')
    })
  }

  // Stops the worker, which gives its GPU memory back. Anything still waiting fails with "stopped".
  // On Windows a venv's python.exe is a launcher that runs the real interpreter as its child, so the
  // whole tree goes; killing the launcher alone can leave the model in VRAM.
  release() {
    if (!this.proc) return
    const { p } = this.proc
    this.proc = null
    try {
      p.stdin.end()
      if (process.platform === 'win32' && p.pid) spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { windowsHide: true }).on('error', () => p.kill())
      else p.kill()
    } catch {}
  }
}
