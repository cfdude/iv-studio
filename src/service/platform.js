// Node-side platform helpers: the filesystem-backed finders. Each takes { platform, home, root, env }
// (design D2): absolute candidate paths are joined under `root`, so a test can point at a temp tree.
// The wording and key helpers the renderer shares are re-exported from ../shared/platform.js.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export * from '../shared/platform.js'

const opts = (o = {}) => ({ platform: o.platform ?? process.platform, home: o.home ?? os.homedir(), root: o.root ?? '', env: o.env ?? process.env })
const exists = (p) => {
  try {
    return fs.existsSync(p)
  } catch {
    return false
  }
}

// Where renders go on a Mac, for the app and the MCP server alike.
export const macVideosDir = ({ home = os.homedir() } = {}) => path.join(home, 'Movies', 'IV Studio')

// The folder the MCP server saves exports to (it has no Electron app): ~/Movies/IV Studio on a Mac, otherwise
// <USERPROFILE or home>/Videos/IV Studio, as it always was. The app keeps app.getPath('videos').
export function mcpVideosDir(o) {
  const { platform, home, env } = opts(o)
  return platform === 'darwin' ? macVideosDir({ home }) : path.join(env.USERPROFILE || home, 'Videos', 'IV Studio')
}

// The Applications folders a Mac app can be in: /Applications (under root), then ~/Applications.
const appFolders = ({ home, root }) => [path.join(root, 'Applications'), path.join(home, 'Applications')]

// Comfy Desktop as an app bundle (darwin only), in /Applications then ~/Applications.
export function comfyBundles(o) {
  const { platform, ...where } = opts(o)
  if (platform !== 'darwin') return []
  const found = []
  for (const dir of appFolders(where)) for (const name of ['Comfy Desktop.app', 'ComfyUI.app']) if (exists(path.join(dir, name))) found.push({ path: path.join(dir, name), label: 'Comfy Desktop (app)' })
  return found
}

// Browser executables inside .app bundles (darwin only), best first.
const MAC_BROWSERS = ['Google Chrome', 'Microsoft Edge', 'Chromium', 'Brave Browser']
export function browserCandidates(o) {
  const { platform, ...where } = opts(o)
  if (platform !== 'darwin') return []
  return appFolders(where).flatMap((dir) => MAC_BROWSERS.map((name) => path.join(dir, `${name}.app`, 'Contents', 'MacOS', name)))
}
export const findBrowser = (o) => browserCandidates(o).find(exists) || null

// Extra folders to search for command-line tools (darwin only): an app started from Finder doesn't get the shell's PATH.
export function toolDirs(o) {
  const { platform, root } = opts(o)
  return platform === 'darwin' ? [path.join(root, 'opt', 'homebrew', 'bin'), path.join(root, 'usr', 'local', 'bin')] : []
}

// ollama: the menu-bar app's own executable first, then the tool folders (darwin only).
export function ollamaCandidates(o) {
  const { platform, root } = opts(o)
  if (platform !== 'darwin') return []
  return [path.join(root, 'Applications', 'Ollama.app', 'Contents', 'Resources', 'ollama'), ...toolDirs(o).map((d) => path.join(d, 'ollama'))]
}
export const findOllama = (o) => ollamaCandidates(o).find(exists) || null
