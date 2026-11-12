// Shinobi: IV Studio's agent-driven editor. An agent (or a recipe) writes the edit - cuts on the beat, speed
// ramps, camera moves, typography, effects, sound - and Shinobi renders it locally. The engine is OpenKatana
// (Apache-2.0, github.com/rk0neki/OpenKatana), installed at a pinned commit into IV Studio's own folder with
// uv, and driven through its CLI (`python -m openkatana call <tool>`, JSON in and out). It renders with the
// Edge or Chrome already on the PC and IV Studio's bundled ffmpeg. Licence and notice: resources/licenses.
//
// The same Python environment runs face likeness (resources/python/likeness.py) for character training:
// InsightFace's buffalo_l detector and ArcFace, downloaded by the user (non-commercial weights).
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { Cloud } from './cloud.js'

export const ENGINE = {
  name: 'OpenKatana',
  version: '0.1.1',
  commit: 'f24f60a7b07182f364b5902c867433f3e390df74',
  repo: 'https://github.com/rk0neki/OpenKatana',
  licence: 'Apache-2.0'
}
const PACKAGE = `openkatana[mcp,vision,text] @ ${ENGINE.repo}/archive/${ENGINE.commit}.zip`

// InsightFace's buffalo_l release (github.com/deepinsight/insightface, v0.7), checked 2026-10-28.
export const FACE_MODELS = {
  url: 'https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_l.zip',
  sha256: '80ffe37d8a5940d59a7384c201a2a38d4741f2f3c51eef46ebb28218a7b0ca2f',
  size: 288621354,
  files: ['det_10g.onnx', 'w600k_r50.onnx'],
  licence: 'InsightFace model weights are for non-commercial research use only.'
}

const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

export function findBrowser(platform = process.platform, env = process.env) {
  if (platform === 'win32') {
    const pf = [env['ProgramFiles(x86)'], env.ProgramFiles, env.LOCALAPPDATA].filter(Boolean)
    const rel = ['Microsoft/Edge/Application/msedge.exe', 'Google/Chrome/Application/chrome.exe']
    for (const r of rel) for (const base of pf) if (fs.existsSync(path.join(base, r))) return path.join(base, r)
    return null
  }
  if (platform === 'darwin') {
    // apps live in /Applications or the person's own ~/Applications
    const apps = ['Google Chrome.app/Contents/MacOS/Google Chrome', 'Microsoft Edge.app/Contents/MacOS/Microsoft Edge', 'Chromium.app/Contents/MacOS/Chromium', 'Brave Browser.app/Contents/MacOS/Brave Browser']
    for (const a of apps) for (const base of ['/Applications', path.join(env.HOME || '', 'Applications')]) if (fs.existsSync(path.join(base, a))) return path.join(base, a)
    return null
  }
  const names = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'microsoft-edge-stable']
  const dirs = [...String(env.PATH || '').split(':'), '/usr/bin', '/usr/local/bin', '/snap/bin', '/opt/google/chrome']
  for (const n of names) for (const d of dirs) if (d && fs.existsSync(path.join(d, n))) return path.join(d, n)
  return null
}

export class Shinobi {
  constructor({ dataDir, resourcesDir, ffmpegDir, onLog }) {
    this.dir = path.join(dataDir, 'shinobi')
    this.resourcesDir = resourcesDir
    this.ffmpegDir = ffmpegDir
    this.onLog = onLog || (() => {})
    this.cloud = new Cloud({ dataDir, resourcesDir, onLog: this.onLog }) // for uv and its Python
    this.toolList = null
  }

  get venv() {
    return path.join(this.dir, 'venv')
  }
  get python() {
    return path.join(this.venv, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
  }
  get workspace() {
    return path.join(this.dir, 'projects')
  }
  get faceDir() {
    return path.join(this.dir, 'models', 'buffalo_l')
  }
  marker = () => path.join(this.dir, 'installed.json')

  installed = () => fs.existsSync(this.python) && readJson(this.marker(), {}).commit === ENGINE.commit
  faceModelsReady = () => FACE_MODELS.files.every((f) => fs.existsSync(path.join(this.faceDir, f)))

  // Edge ships with Windows; Chrome works too. On Linux, Chrome, Chromium or Edge. The engine drives it headless to
  // draw each frame (previs and website capture use the same one).
  browser() {
    return findBrowser()
  }

  status() {
    return { installed: this.installed(), engine: ENGINE, workspace: this.workspace, browser: this.browser(), faceModels: this.faceModelsReady(), faceLicence: FACE_MODELS.licence, faceSize: FACE_MODELS.size }
  }

  // About 440 MB and under a minute: uv makes a Python 3.12 environment and installs the pinned engine.
  async install() {
    if (this.installed()) return this.status()
    await this.cloud.ensureUv()
    const env = this.cloud.uvEnv()
    this.onLog('Setting up Python for Shinobi…')
    fs.mkdirSync(this.dir, { recursive: true })
    if (!fs.existsSync(this.python)) await this.cloud.exec(this.cloud.uvExe, ['venv', this.venv, '--python', '3.12'], { env })
    this.onLog(`Installing the Shinobi engine (${ENGINE.version})…`)
    await this.cloud.exec(this.cloud.uvExe, ['pip', 'install', '--python', this.venv, PACKAGE, 'onnxruntime>=1.20,<2'], { env })
    fs.writeFileSync(this.marker(), JSON.stringify({ commit: ENGINE.commit, at: new Date().toISOString() }, null, 2))
    fs.mkdirSync(this.workspace, { recursive: true })
    return this.status()
  }

  env() {
    const browser = this.browser()
    return {
      ...process.env,
      PATH: [this.ffmpegDir, process.env.PATH].filter(Boolean).join(path.delimiter),
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1',
      OPENKATANA_NO_WINDOW: '1',
      ...(browser && { OPENKATANA_CHROME: browser })
    }
  }

  // Runs the engine's CLI and returns its stdout.
  run(args, { timeout = 30 * 60 * 1000 } = {}) {
    if (!this.installed()) return Promise.reject(new Error('Set up Shinobi first (the Shinobi page).'))
    return new Promise((resolve, reject) => {
      fs.mkdirSync(this.workspace, { recursive: true })
      const p = spawn(this.python, ['-m', 'openkatana', ...args], { cwd: this.workspace, env: this.env(), windowsHide: true })
      let out = ''
      let err = ''
      const timer = setTimeout(() => p.kill(), timeout)
      p.stdout.on('data', (d) => (out += d))
      p.stderr.on('data', (d) => (err += d))
      p.on('error', reject)
      p.on('close', (code) => {
        clearTimeout(timer)
        if (code === 0) return resolve(out)
        const msg = (err || out).trim().split(/\r?\n/).filter(Boolean).pop() || `Shinobi stopped (${code}).`
        reject(new Error(msg.replace(/^\w+Error: /, '')))
      })
    })
  }

  // One of the engine's tools (the same set an agent gets), with JSON arguments; resolves with its JSON result.
  async call(tool, args = {}) {
    if (tool === 'build_recipe') args = this.fitToMusic(args)
    const file = path.join(os.tmpdir(), `shinobi-${randomUUID()}.json`)
    fs.writeFileSync(file, JSON.stringify(args))
    try {
      return JSON.parse(await this.run(['call', tool, '--workspace', this.workspace, '--arguments', file]))
    } finally {
      fs.rmSync(file, { force: true })
    }
  }
  // A cut longer than its song ends with the song, but the engine rounds the song up to a whole frame and then refuses
  // its own edit ("trim 0+5.167 s extends beyond the 5.152 s recording"): ask for no more than the song's last whole frame.
  fitToMusic(args) {
    if (!args?.music_asset_id || !args.project_id) return args
    try {
      const song = (readJson(path.join(this.projectDir(args.project_id), 'project.json'), {}).assets || []).find((a) => a.id === args.music_asset_id)
      const fps = Number(args.fps) || 30
      const most = song?.duration ? Math.floor(song.duration * fps) / fps : 0
      if (most && args.seconds > most) return { ...args, seconds: most }
    } catch {}
    return args
  }
  async tools() {
    if (!this.toolList) this.toolList = JSON.parse(await this.run(['tools']))
    return this.toolList
  }

  // ---------- projects, read straight from the workspace ----------
  // <workspace>/<id>/project.json (name, media), timeline.json (the saved edit), .openkatana/jobs/<job>/job.json (renders)
  projectDir = (id) => {
    const d = path.resolve(this.workspace, id)
    if (!d.startsWith(path.resolve(this.workspace) + path.sep)) throw new Error('Bad project id.')
    return d
  }
  projects() {
    if (!fs.existsSync(this.workspace)) return []
    return fs
      .readdirSync(this.workspace)
      .map((id) => {
        const p = readJson(path.join(this.workspace, id, 'project.json'), null)
        if (!p) return null
        const renders = this.renders(id)
        const last = renders.find((r) => r.video)
        return { id, name: p.name, createdAt: p.created_at, assets: (p.assets || []).length, renders: renders.length, cover: last?.video || null, updatedAt: fs.statSync(path.join(this.workspace, id, 'project.json')).mtime.toISOString() }
      })
      .filter(Boolean)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }
  // A project's media (absolute paths), its timeline and its renders.
  project(id) {
    const dir = this.projectDir(id)
    const p = readJson(path.join(dir, 'project.json'), null)
    if (!p) throw new Error(`No Shinobi project ${id}`)
    const timeline = readJson(path.join(dir, 'timeline.json'), null)
    const c = timeline?.canvas || {}
    const count = (v) => (Array.isArray(v) ? v.length : v && typeof v === 'object' ? Object.keys(v).length : 0)
    return {
      id,
      name: p.name,
      dir,
      assets: (p.assets || []).map((a) => ({ id: a.id, name: a.name, kind: a.kind || (/\.(png|jpe?g|webp)$/i.test(a.path) ? 'image' : /\.(wav|mp3|m4a|flac|ogg|aac)$/i.test(a.path) ? 'audio' : 'video'), path: path.join(dir, a.path) })),
      // canvas {w, h, fps, frames}; clips keyed by id, shots and text as lists
      timeline: timeline ? { width: c.w, height: c.h, fps: c.fps, seconds: c.fps ? +(c.frames / c.fps).toFixed(2) : 0, shots: count(timeline.shots), clips: count(timeline.clips), texts: count(timeline.text) } : null,
      renders: this.renders(id)
    }
  }
  // A film, with its imported media copies and renders (they live in the film's folder).
  deleteProject(id) {
    fs.rmSync(this.projectDir(id), { recursive: true, force: true })
    return true
  }
  renders(id) {
    const jobs = path.join(this.projectDir(id), '.openkatana', 'jobs')
    if (!fs.existsSync(jobs)) return []
    return fs
      .readdirSync(jobs)
      .map((j) => {
        const job = readJson(path.join(jobs, j, 'job.json'), null)
        if (!job) return null
        const video = job.video ? path.join(this.projectDir(id), job.video) : null
        return { id: job.id || j, requestId: job.request_id, state: job.state, createdAt: job.created_at, error: job.error || null, video: video && fs.existsSync(video) ? video : null }
      })
      .filter(Boolean)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  }

  // ---------- face likeness (character training) ----------
  async installFaceModels(onProgress) {
    if (this.faceModelsReady()) return true
    if (!this.installed()) await this.install()
    fs.mkdirSync(this.faceDir, { recursive: true })
    const zip = path.join(this.faceDir, 'buffalo_l.zip.part')
    this.onLog('Downloading InsightFace buffalo_l (289 MB)…')
    const res = await fetch(FACE_MODELS.url)
    if (!res.ok) throw new Error(`Could not download the face models (${res.status}).`)
    const hash = createHash('sha256')
    let got = 0
    const body = Readable.fromWeb(res.body)
    body.on('data', (c) => {
      hash.update(c)
      got += c.length
      onProgress?.(got / FACE_MODELS.size)
    })
    await pipeline(body, fs.createWriteStream(zip))
    if (hash.digest('hex') !== FACE_MODELS.sha256) {
      fs.rmSync(zip, { force: true })
      throw new Error("The face model download didn't match InsightFace's published file.")
    }
    const extract = `import sys, zipfile\nz = zipfile.ZipFile(sys.argv[1])\nfor f in sys.argv[3:]: z.extract(f, sys.argv[2])`
    await this.cloud.exec(this.python, ['-c', extract, zip, this.faceDir, ...FACE_MODELS.files], { quiet: true })
    fs.rmSync(zip, { force: true })
    return this.faceModelsReady()
  }

  // How closely the largest face in each picture (or in three frames of each video) matches the reference:
  // [{file, score, faces}] with score in -1..1 (0.6+ the same person, 0.4-0.6 a family resemblance).
  async likeness(reference, files) {
    if (!this.faceModelsReady()) throw new Error('Download the face models first (Characters, "Rank by likeness").')
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-likeness-'))
    try {
      const inputs = []
      for (const f of files) {
        if (!/\.(mp4|mov|webm|mkv|m4v)$/i.test(f)) {
          inputs.push({ file: f, frames: [f] })
          continue
        }
        const dur = await this.duration(f)
        const shots = [0.5, dur / 2, Math.max(0.5, dur - 0.6)].map((t, k) => ({ t, out: path.join(tmp, `${inputs.length}_${k}.png`) }))
        for (const s of shots) await this.ffmpeg(['-v', 'error', '-y', '-ss', s.t.toFixed(2), '-i', f, '-frames:v', '1', s.out])
        inputs.push({ file: f, frames: shots.map((s) => s.out).filter((p) => fs.existsSync(p)) })
      }
      const all = inputs.flatMap((i) => i.frames)
      const out = JSON.parse(await this.py([path.join(this.resourcesDir, 'python', 'likeness.py'), this.faceDir, reference, ...all]))
      if (out.error) throw new Error(out.error)
      const byFile = Object.fromEntries(out.results.map((r) => [r.file, r]))
      return inputs.map(({ file, frames }) => {
        const scores = frames.map((f) => byFile[f]?.score).filter((s) => s != null)
        const bests = frames.map((f) => byFile[f]?.best).filter((s) => s != null)
        return { file, score: scores.length ? +(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(3) : null, min: scores.length ? Math.min(...scores) : null, best: bests.length ? +(bests.reduce((a, b) => a + b, 0) / bests.length).toFixed(3) : null, faces: Math.max(0, ...frames.map((f) => byFile[f]?.faces || 0)) }
      })
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  }
  py(args) {
    return new Promise((resolve, reject) => {
      const p = spawn(this.python, args, { env: this.env(), windowsHide: true })
      let out = ''
      let err = ''
      p.stdout.on('data', (d) => (out += d))
      p.stderr.on('data', (d) => (err += d))
      p.on('error', reject)
      p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(err.trim().split(/\r?\n/).pop() || 'Face likeness failed.'))))
    })
  }
  ffmpeg(args) {
    return new Promise((resolve, reject) => {
      const p = spawn(path.join(this.ffmpegDir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'), args, { windowsHide: true })
      p.on('error', reject)
      p.on('close', (code) => (code === 0 ? resolve() : reject(new Error('ffmpeg could not read a frame.'))))
    })
  }
  duration(file) {
    return new Promise((resolve) => {
      const p = spawn(path.join(this.ffmpegDir, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { windowsHide: true })
      let out = ''
      p.stdout.on('data', (d) => (out += d))
      p.on('close', () => resolve(Number(out.trim()) || 1))
    })
  }
}
