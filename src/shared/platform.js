// Platform helpers the renderer and the main process both import. No Node imports here (the renderer is
// sandboxed): every function takes the platform as an argument, 'darwin' | 'win32' | 'linux'.
// The filesystem-backed finders live in src/service/platform.js.

// ---------- Modifier key ----------
// Cmd on a Mac, Ctrl everywhere else.
export const modKey = (e, platform) => (platform === 'darwin' ? !!e.metaKey : !!e.ctrlKey)
export const modLabel = (platform) => (platform === 'darwin' ? '⌘' : 'Ctrl')
// A shortcut hint: '⌘K' on a Mac, 'Ctrl+K' elsewhere.
export const modChord = (platform, key) => (platform === 'darwin' ? `⌘${key}` : `Ctrl+${key}`)

// ---------- Wording ----------
export const dataFolderText = (platform) => (platform === 'darwin' ? '~/Library/Application Support/IV Studio' : platform === 'win32' ? '%APPDATA%\\IV Studio' : '~/.config/IV Studio')
// Windows and Linux keep today's text.
export const rendersFolderText = (platform) => (platform === 'darwin' ? '~/Movies/IV Studio' : 'Videos\\IV Studio')
export const secretStoreName = (platform) => (platform === 'darwin' ? 'Keychain' : platform === 'win32' ? 'Windows encryption' : 'GNOME Keyring or KWallet')
export const fileManagerName = (platform) => (platform === 'darwin' ? 'Finder' : platform === 'win32' ? 'Explorer' : 'your file manager')
// The folder separator in text shown to a person: '/' on a Mac, '\\' on Windows and Linux (which keep today's text).
export const sepText = (platform) => (platform === 'darwin' ? '/' : '\\')
export const editsFolderText = (platform) => `${rendersFolderText(platform)}${sepText(platform)}Edits`
// Said when the system secret store can't hold a key. (A store that refuses access to a saved key is task 6.3's.)
export const keyStoreMissingText = (platform) =>
  platform === 'darwin' ? 'The Mac Keychain is not available, so the key cannot be stored safely.' : platform === 'win32' ? 'Windows encryption is not available, so the key cannot be stored safely.' : `No system keyring (${secretStoreName(platform)}) is available, so the key cannot be stored safely.`

// Said on a Mac when the Keychain refuses IV Studio access to its saved keys (Deny was pressed, or nobody answered).
// Re-entering a key can't work until access is allowed, so this replaces any "enter it again" text. Plain Allow
// asks for the password on every launch; Always Allow stops that.
export const keychainRefusedText = (platform) =>
  platform === 'darwin'
    ? 'The Mac Keychain isn’t letting IV Studio open its saved keys. Open Keychain Access and allow IV Studio, or quit and start IV Studio again and, when your Mac asks, press Always Allow (plain Allow asks again every time you start).'
    : keyStoreMissingText(platform)

// The Settings -> ComfyUI help under the launcher picker. Windows keeps today's text (and is what an unknown
// platform shows, as before); Linux keeps its own; a Mac names Comfy Desktop.app and ComfyUI's main.py.
export const comfyLauncherHelp = (platform) =>
  platform === 'darwin'
    ? 'Comfy Desktop.app, or a .sh script or main.py in your ComfyUI folder, so ComfyUI starts the way you’d start it yourself and keeps running after IV Studio closes. A ComfyUI folder’s main.py runs with its own venv’s Python, and its output goes to comfyui.log in IV Studio’s data folder.'
    : platform === 'linux'
      ? 'A .sh script beside ComfyUI, or its main.py run with its own venv’s Python, so ComfyUI starts with your own settings and keeps running after IV Studio closes. Its output goes to comfyui.log in IV Studio’s data folder.'
      : 'The same shortcut or .bat you’d double-click, so ComfyUI starts with your own settings in its own window, and keeps running after IV Studio closes.'

// ---------- Filled in by later tasks (minimal behaviour for now) ----------
// Task 7.3: the editor's key-to-action mapping: 'undo' | 'redo' | 'splitAll' | 'prevMarker' | 'none' | 'pass'.
// This is the modifier branch of the editor's onKey, in the same order as it always ran: the mapped
// combos first (the platform's modifier only; Alt was never checked there), then the guard that
// stops every OTHER Ctrl/Alt/Meta combination (Cmd+Q/W/M/C included) reaching the tool keys.
// 'pass' means no modifier is down, so the editor goes on to its plain keys.
export function editorKeyAction(e, platform) {
  const lower = String(e.key).toLowerCase()
  const mod = modKey(e, platform)
  if (mod && lower === 'z') return e.shiftKey ? 'redo' : 'undo'
  if (mod && lower === 'y') return 'redo'
  if (mod && lower === 'k') return 'splitAll'
  if (mod && e.shiftKey && lower === 'm') return 'prevMarker'
  if (e.ctrlKey || e.altKey || e.metaKey) return 'none'
  return 'pass'
}
// The application menu for macOS: the app, File (Close Window, Cmd+W), Edit (Cmd+C/V/X/A/Z) and Window
// (Cmd+M) menus, all from Electron's own roles.
export const macMenuTemplate = () => [{ role: 'appMenu' }, { role: 'fileMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]
// What to install on this platform: the template on a Mac, null (no menu, as today) everywhere else.
export const menuTemplateFor = (platform) => (platform === 'darwin' ? macMenuTemplate() : null)
// Extra BrowserWindow options for a platform, merged over the common ones. Windows and Linux add nothing.
// A Mac keeps its window buttons (hidden title bar style) and puts them mid-way down the 40 px bar; the page
// pads its title bar to clear them (styles.css, under data-platform="darwin"). Electron's typings only say
// titleBarOverlay "enables" the titlebar-area CSS variables, not that content moves, and the page uses none.
export const windowOptions = (platform) => (platform === 'darwin' ? { trafficLightPosition: { x: 16, y: 12 } } : {})

// ---------- Updates ----------
// Which update UI to show, from the update status (or the whole state): 'show' | 'none'. 'off' (updates held
// back on this build) shows nothing; every other status, 'dev' included, shows what it showed before.
export const updateView = (state) => ((state && typeof state === 'object' ? state.status : state) === 'off' ? 'none' : 'show')
// The one switch for Mac updates. While it is false a Mac build never checks for, downloads or installs
// updates. A working Mac feed also needs a zip target and a Developer ID signature (see the README).
export const MAC_UPDATES = false
// The second argument exists only so a test can try the switch on.
export const updatesEnabled = (platform, macUpdates = MAC_UPDATES) => platform !== 'darwin' || macUpdates
