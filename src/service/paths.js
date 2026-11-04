// Where IV Studio keeps its data and finds its bundled resources, for both the app and the MCP server.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// A Mac keeps it in ~/Library/Application Support (Electron's own default for the app's name), found with
// os.homedir() so the MCP server, a plain Node process, gets the same folder. Windows and Linux are unchanged.
export function dataDir({ platform = process.platform, home = os.homedir(), env = process.env } = {}) {
  if (env.IV_STUDIO_DATA) return env.IV_STUDIO_DATA
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'IV Studio')
  const base = env.APPDATA || path.join(env.HOME || '.', '.config')
  return path.join(base, 'IV Studio')
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
// promptEngine: 'local' (ollamaModel), 'claude' (claudeModel) or 'codex' (codexModel) writes prompts, or 'contextir';
// '' as a Claude Code or Codex model means the person's own default there.
// target: 'local' (comfyUrl) or 'cloud' (cloud.url behind the gate, cloudToken; both set by the Cloud page).
// cloudProvider: 'modal' (cloud, cloudToken) or 'runpod' (runpod: the volume, GPU and current pod; runpodToken for
// its gate; runpodKey, the person's RunPod API key). The keys and tokens are stored encrypted.
// comfyFolder: the person's main ComfyUI folder; comfyLauncher: the shortcut, .bat or ComfyUI.exe that starts
// ComfyUI ('' = the best one in comfyFolder, else the best one found on this PC); comfyAutoStart:
// start it when IV Studio opens if it isn't running (comfylauncher.js).
// incognito: the app works in its private set of everything made (see incognitoDir); switched by a restart.
// outputFolder / privateFolder: the folder inside ComfyUI's output where renders save, normally and in
// Incognito ('' = straight into output). Incognito uploads go into the same folder name under input.
export const PRIVATE_FOLDER = 'IV Private'
const DEFAULT_SETTINGS = { comfyUrl: 'http://127.0.0.1:8188', window: null, promptEngine: 'local', ollamaModel: 'huihui_ai/qwen3-vl-abliterated:8b-instruct', claudeModel: '', codexModel: '', comfyApiKey: null, target: 'local', cloud: null, cloudToken: null, cloudProvider: 'modal', runpod: null, runpodKey: null, runpodToken: null, models: {}, comfyFolder: '', comfyLauncher: '', comfyAutoStart: true, civitaiKey: null, civitaiMature: false, civitaiUnblur: false, incognito: false, outputFolder: '', privateFolder: PRIVATE_FOLDER }

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

export function readSettings(dir = dataDir()) {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')) }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function writeSettings(patch, dir = dataDir()) {
  const next = { ...readSettings(dir), ...Object.fromEntries(Object.entries(patch || {}).filter(([k]) => k in DEFAULT_SETTINGS)) }
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
  return { engine, model: engine === 'claude' ? settings.claudeModel || '' : engine === 'codex' ? settings.codexModel || '' : settings.ollamaModel }
}
