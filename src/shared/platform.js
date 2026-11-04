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
// Task 7.1: the application menu template for macOS.
export const macMenuTemplate = () => []
// Task 7.2: extra BrowserWindow options for a platform, merged over today's.
export const windowOptions = () => ({})

// ---------- Updates ----------
// Which update UI to show, from the update status (or the whole state): 'show' | 'none'. 'off' (updates held
// back on this build) shows nothing; every other status, 'dev' included, shows what it showed before.
export const updateView = (state) => ((state && typeof state === 'object' ? state.status : state) === 'off' ? 'none' : 'show')
// The one switch for Mac updates. While it is false a Mac build never checks for, downloads or installs
// updates. A working Mac feed also needs a zip target and a Developer ID signature (see the README).
export const MAC_UPDATES = false
// The second argument exists only so a test can try the switch on.
export const updatesEnabled = (platform, macUpdates = MAC_UPDATES) => platform !== 'darwin' || macUpdates
