// Where IV Studio keeps its data and finds its bundled resources, for both the app and the MCP server.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

// Where the data folder is, in this order:
//   env       IV_STUDIO_DATA names it (tests, and anyone who wants to set it by hand)
//   portable  a folder called "data" sits next to IV Studio.exe (the portable zip ships with one)
//   moved     the person moved it in Settings → Data folder; the default folder keeps a small pointer to it
//   default   %APPDATA%\IV Studio (Windows), ~/Library/Application Support/IV Studio (Mac), ~/.config/IV Studio
// The default folder is also where Electron keeps the window's own files, so the pointer lives there.
// `missing` is set when the pointer names a folder that isn't there (a drive that isn't plugged in).
export const POINTER_FILE = 'data-folder.json'
export const PORTABLE_FOLDER = 'data'
// Only IV Studio's own binary counts for portable, so a dev copy (electron.exe) or a Node run never does.
const OWN_EXE = /^(IV Studio|iv-studio)(\.exe)?$/i
const isDir = (p) => {
  try {
    return fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

export function defaultDataDir({ env = process.env, platform = process.platform } = {}) {
  // a Mac keeps app data in ~/Library/Application Support (where Electron keeps the window's own)
  if (platform === 'darwin') return path.join(env.HOME || '.', 'Library', 'Application Support', 'IV Studio')
  const base = env.APPDATA || path.join(env.HOME || '.', '.config')
  return path.join(base, 'IV Studio')
}

export function portableDataDir({ execPath = process.execPath } = {}) {
  if (!execPath || !OWN_EXE.test(path.basename(execPath))) return null
  const dir = path.join(path.dirname(execPath), PORTABLE_FOLDER)
  return isDir(dir) ? dir : null
}

export function readPointer(defaultDir) {
  try {
    const p = JSON.parse(fs.readFileSync(path.join(defaultDir, POINTER_FILE), 'utf8'))
    return p && typeof p.dir === 'string' && path.isAbsolute(p.dir) ? p : null
  } catch {
    return null
  }
}

export function dataLocation({ env = process.env, execPath = process.execPath, platform = process.platform } = {}) {
  const defaultDir = defaultDataDir({ env, platform })
  if (env.IV_STUDIO_DATA) return { dir: env.IV_STUDIO_DATA, source: 'env', defaultDir }
  const portable = portableDataDir({ execPath })
  if (portable) return { dir: portable, source: 'portable', defaultDir }
  const pointer = readPointer(defaultDir)
  if (pointer) return { dir: pointer.dir, source: 'moved', defaultDir, pointer, missing: !isDir(pointer.dir) }
  return { dir: defaultDir, source: 'default', defaultDir }
}

export function dataDir(opts) {
  return dataLocation(opts).dir
}

// Packaged: <install>/resources/resources. Dev and the built MCP script: the repo's resources folder.
export function resourcesDir(hint) {
  // Built code sits in out/main or, when shared between entries, out/main/chunks.
  const candidates = [hint, process.resourcesPath && path.join(process.resourcesPath, 'resources'), path.resolve(__dirname, '../../resources'), path.resolve(__dirname, '../../../resources'), path.resolve('resources')]
  for (const c of candidates) if (c && fs.existsSync(path.join(c, 'workflows', 'iv_studio_api.json'))) return c
  throw new Error('IV Studio resources not found')
}

// comfyApiKey and civitaiKey are stored encrypted by the app (Electron safeStorage); they're never sent to the window.
// civitaiMature: mature LoRAs from civitai.red on the LoRAs page, off unless the person turns it on.
// civitaiUnblur: with civitaiMature on, mature previews show without the blur (a second, separate opt-in).
// promptEngine: 'local' (ollamaModel), 'claude' (claudeModel) or 'codex' (codexModel) writes prompts, or 'contextir',
// or 'openai': an OpenAI-compatible server (llm.js) at openaiUrl with openaiModel; openaiVision: it sees pictures;
// openaiKey and openaiHeaders ("Name: value" lines) are stored encrypted.
// '' as a Claude Code or Codex model means the person's own default there.
// target: 'local' (comfyUrl) or 'cloud' (cloud.url behind the gate, cloudToken; both set by the Cloud page).
// cloudProvider: 'modal' (cloud, cloudToken) or 'runpod' (runpod: the volume, GPU and current pod; runpodToken for
// its gate; runpodKey, the person's RunPod API key). The keys and tokens are stored encrypted.
// comfyFolder: the person's main ComfyUI folder; comfyLauncher: the shortcut, .bat or ComfyUI.exe that starts
// ComfyUI ('' = the best one in comfyFolder, else the best one found on this PC); comfyAutoStart:
// start it when IV Studio opens if it isn't running (comfylauncher.js).
// chatBudget: the chat's spending limit { on, daily, perStep } in Comfy credits (spending.js; null = off).
// incognito: the app works in its private set of everything made (see incognitoDir); switched by a restart.
// outputFolder / privateFolder: the folder inside ComfyUI's output where renders save, normally and in
// Incognito ('' = straight into output). Incognito uploads go into the same folder name under input.
export const PRIVATE_FOLDER = 'IV Private'
const DEFAULT_SETTINGS = { comfyUrl: 'http://127.0.0.1:8188', window: null, promptEngine: 'local', ollamaUrl: '', ollamaModel: 'huihui_ai/qwen3-vl-abliterated:8b-instruct', claudeModel: '', codexModel: '', openaiUrl: '', openaiModel: '', openaiVision: false, openaiKey: null, openaiHeaders: null, chatBudget: null, comfyApiKey: null, target: 'local', cloud: null, cloudToken: null, cloudProvider: 'modal', runpod: null, runpodKey: null, runpodToken: null, models: {}, comfyFolder: '', comfyLauncher: '', comfyAutoStart: true, civitaiKey: null, civitaiMature: false, civitaiUnblur: false, incognito: false, outputFolder: '', privateFolder: PRIVATE_FOLDER, onboarded: null, hardware: null, shotPrefs: null, speed: null, plainWords: false, highContrast: false, aiLevel: null, fizgigFolder: '', videosFolder: '', textSize: 'normal', reduceMotion: false, focusRings: false, underlineLinks: false, usage: null, betaJoined: false, describeLibrary: true, h3Terms: null, chatWindow: null }

// A folder name as ComfyUI takes it: relative to its output (or input) folder, forward slashes, nothing
// that climbs out of it or that Windows won't allow.
export function cleanFolder(v) {
  return String(v || '')
    .replace(/\\/g, '/')
    .split('/')
    .map((s) => s.replace(/[<>:"|?*\x00-\x1f]/g, '').trim())
    .filter((s) => s && s !== '.' && s !== '..')
    .join('/')
}

// The folders ComfyUI saves into for this mode: output (where renders go) and input (where uploads go;
// only Incognito moves them).
export function comfyFolders(s, incognito) {
  return incognito ? { output: s.privateFolder, input: s.privateFolder } : { output: s.outputFolder, input: '' }
}

// ---------- Incognito ----------
// A second, private set of everything made (projects and their renders, sequences, edits, songs, voices and
// lines, characters, trainings, Shinobi films, sizzles, media) in <data>/incognito. Nothing made there shows
// in the normal app, and nothing normal is made there. Settings and keys stay in <data>, and the big shared
// tools are linked in rather than copied. ComfyUI writes Incognito renders into its own folder (privateFolder).
const SHARED_DIRS = ['cloud', 'voiceengine', 'loras', path.join('shinobi', 'venv'), path.join('shinobi', 'models')]
const SHARED_FILES = [path.join('shinobi', 'installed.json')]

// The folder the app and the MCP server keep what they make in: <data>, or <data>/incognito.
export function contentDir(base = dataDir()) {
  return readSettings(base).incognito ? incognitoDir(base) : base
}

export function incognitoDir(base = dataDir()) {
  const dir = path.join(base, 'incognito')
  fs.mkdirSync(path.join(dir, 'shinobi'), { recursive: true })
  for (const rel of SHARED_DIRS) {
    const link = path.join(dir, rel)
    if (fs.existsSync(link)) continue
    fs.mkdirSync(path.join(base, rel), { recursive: true })
    fs.symlinkSync(path.join(base, rel), link, 'junction') // a junction needs no admin rights on Windows
  }
  for (const rel of SHARED_FILES) {
    const from = path.join(base, rel)
    if (fs.existsSync(from) && !fs.existsSync(path.join(dir, rel))) fs.copyFileSync(from, path.join(dir, rel))
  }
  // One way only: the normal characters and saved voices are there in Incognito too. Ones made in
  // Incognito never come back.
  try {
    const mine = JSON.parse(fs.readFileSync(path.join(base, 'characters.json'), 'utf8'))
    const file = path.join(dir, 'characters.json')
    const theirs = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : []
    const have = new Set(theirs.map((c) => c.id))
    const merged = [...theirs, ...mine.filter((c) => !have.has(c.id))]
    if (merged.length !== theirs.length) fs.writeFileSync(file, JSON.stringify(merged, null, 2))
  } catch {}
  const voices = path.join(base, 'voices')
  if (fs.existsSync(voices))
    for (const id of fs.readdirSync(voices)) {
      const to = path.join(dir, 'voices', id)
      if (id !== 'lines' && fs.statSync(path.join(voices, id)).isDirectory() && !fs.existsSync(to)) fs.cpSync(path.join(voices, id), to, { recursive: true })
    }
  return dir
}

// Points a graph's saved files into a folder inside ComfyUI's output: literal file name prefixes and output
// directories, and the first part of a joined name that feeds a file name prefix (IV Studio's H3 graph
// builds its names as "H3/hunt/" + the project's name). No folder: the graph is left as it is.
export function outputsUnder(graph, folder) {
  folder = cleanFolder(folder)
  if (!folder) return graph
  const under = (v) => (typeof v === 'string' && !v.startsWith(folder + '/') ? `${folder}/${v.replace(/^[\\/]+/, '')}` : v)
  for (const node of Object.values(graph)) {
    const inp = node?.inputs
    if (!inp) continue
    for (const key of ['filename_prefix', 'Output Directory']) if (typeof inp[key] === 'string') inp[key] = under(inp[key])
    const link = inp.filename_prefix
    if (Array.isArray(link) && graph[link[0]]?.class_type === 'StringConcatenate') graph[link[0]].inputs.string_a = under(graph[link[0]].inputs.string_a)
  }
  return graph
}

// A ComfyUI address as people type it ("localhost:8000", "127.0.0.1:8188/", "0.0.0.0:8188") made into one fetch can
// use: a scheme added, a trailing slash dropped, and 0.0.0.0 (ComfyUI's "listen everywhere") read as this PC.
// Throws when it isn't an address.
export function normalizeComfyUrl(value) {
  let v = String(value ?? '').trim()
  if (!v) return DEFAULT_SETTINGS.comfyUrl
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) v = `http://${v.replace(/^\/+/, '')}`
  const u = new URL(v)
  if (!/^https?:$/.test(u.protocol) || !u.hostname) throw new Error('not an address')
  if (u.hostname === '0.0.0.0') u.hostname = '127.0.0.1'
  return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`
}

// The folder the MCP server saves finished videos under (it has no Electron app to ask). On a Mac that is
// ~/Movies, where the app's own app.getPath('videos') points, so both put them in the same place.
export const mcpVideosBase = ({ platform = process.platform, env = process.env, home = os.homedir() } = {}) =>
  platform === 'darwin' ? path.join(home, 'Movies') : path.join(env.USERPROFILE || home, 'Videos')

// Where finished videos go (edit and film exports, cloud renders brought home): Settings → Folders → Finished videos,
// else Videos\IV Studio. Incognito keeps its own inside its data folder.
export function videosFolderOf(settings, { incognito = false, dataDir: data = '', videos = path.join(os.homedir(), 'Videos') } = {}) {
  if (incognito) return path.join(data, 'videos')
  const v = String(settings?.videosFolder || '').trim()
  return v && path.isAbsolute(v) ? v : path.join(videos, 'IV Studio')
}

export function readSettings(dir = dataDir()) {
  let s
  try {
    s = { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')) }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
  // an address saved before addresses were cleaned up ("localhost:8000") still works
  try {
    s.comfyUrl = normalizeComfyUrl(s.comfyUrl)
  } catch {}
  return s
}

export function writeSettings(patch, dir = dataDir()) {
  const next = { ...readSettings(dir), ...Object.fromEntries(Object.entries(patch || {}).filter(([k]) => k in DEFAULT_SETTINGS)) }
  if ('comfyUrl' in (patch || {})) {
    try {
      next.comfyUrl = normalizeComfyUrl(next.comfyUrl)
    } catch {
      throw new Error('That isn’t an address. Use host:port, like localhost:8000 or 127.0.0.1:8188.')
    }
  }
  next.outputFolder = cleanFolder(next.outputFolder)
  // Incognito always has a folder of its own
  next.privateFolder = cleanFolder(next.privateFolder) || PRIVATE_FOLDER
  if (next.privateFolder.toLowerCase() === next.outputFolder.toLowerCase()) throw new Error('Pick a different folder for Incognito renders than for normal ones.')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(next, null, 2))
  return next
}

// The prompt writer chosen in Settings, as { engine, model }.
export function writerOf(settings) {
  const engine = settings.promptEngine || 'local'
  // the OpenAI-compatible server writes exactly as the local writer does; only the transport differs (llm.js)
  if (engine === 'openai') return { engine: 'local', provider: 'openai', model: settings.openaiModel || '' }
  return { engine, model: engine === 'claude' ? settings.claudeModel || '' : engine === 'codex' ? settings.codexModel || '' : settings.ollamaModel }
}
