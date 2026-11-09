// Platform helpers the renderer and the main process both import. No Node imports here (the renderer is
// sandboxed): every function takes the platform as an argument, 'darwin' | 'win32' | 'linux'.

// ---------- Modifier key ----------
// Cmd on a Mac, Ctrl everywhere else.
export const modKey = (e, platform) => (platform === 'darwin' ? !!e.metaKey : !!e.ctrlKey)
export const modLabel = (platform) => (platform === 'darwin' ? '⌘' : 'Ctrl')
// A shortcut hint: '⌘K' on a Mac, 'Ctrl+K' elsewhere.
export const modChord = (platform, key) => (platform === 'darwin' ? `⌘${key}` : `Ctrl+${key}`)

// ---------- Editor keys ----------
// The editor's key-to-action mapping: 'undo' | 'redo' | 'splitAll' | 'prevMarker' | 'stop' | 'none' | 'pass'.
// This is the modifier branch of the editor's onKey, in the order it always ran: the mapped combos first (the
// platform's modifier only; Alt was never checked there), then the guard that stops every OTHER Ctrl/Alt/Meta
// combination (Cmd+Q/W/M/C included) reaching the tool keys.
// 'stop' runs nothing but keeps the key from the menu: on a Mac, Select All would highlight the whole page.
// 'pass' means no modifier is down, so the editor goes on to its plain keys.
export function editorKeyAction(e, platform) {
  const lower = String(e.key).toLowerCase()
  const mod = modKey(e, platform)
  if (mod && lower === 'z') return e.shiftKey ? 'redo' : 'undo'
  if (mod && lower === 'y') return 'redo'
  if (mod && lower === 'k') return 'splitAll'
  if (mod && e.shiftKey && lower === 'm') return 'prevMarker'
  if (platform === 'darwin' && e.metaKey && !e.shiftKey && !e.altKey && !e.ctrlKey && lower === 'a') return 'stop'
  if (e.ctrlKey || e.altKey || e.metaKey) return 'none'
  return 'pass'
}
// Whether a key press toggles the editor's full-workspace view: F11 or the backtick. On a Mac, Cmd+backtick
// cycles the app's windows, so it is left alone there. Windows and Linux act on the backtick as before.
export const focusKey = (e, platform) => e.key === 'F11' || (e.key === '`' && !(platform === 'darwin' && e.metaKey))

// ---------- Menu ----------
// The application menu for macOS: the app, File (Close Window, Cmd+W), Edit (Cmd+C/V/X/A/Z) and Window
// (Cmd+M) menus, all from Electron's own roles. Without an Edit menu a Mac window cannot copy or paste.
export const macMenuTemplate = () => [{ role: 'appMenu' }, { role: 'fileMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]
// What to install on this platform: the template on a Mac, null (no menu, as today) everywhere else.
export const menuTemplateFor = (platform) => (platform === 'darwin' ? macMenuTemplate() : null)

// ---------- Wording ----------
// What an MCP client is told about an edit that is open in the window.
export const liveEditText = (platform) => `If the edit is open in the IV Studio window, it reloads there and the person can undo your change with ${modChord(platform, 'Z')}.`
// Where finished videos go by default; Windows and Linux keep today's text.
export const rendersFolderText = (platform) => (platform === 'darwin' ? '~/Movies/IV Studio' : 'Videos\\IV Studio')
// The folder separator in text shown to a person: '/' on a Mac, '\\' on Windows and Linux (which keep today's text).
export const sepText = (platform) => (platform === 'darwin' ? '/' : '\\')
export const editsFolderText = (platform) => `${rendersFolderText(platform)}${sepText(platform)}Edits`
export const secretStoreName = (platform) => (platform === 'darwin' ? 'Keychain' : platform === 'win32' ? 'Windows encryption' : 'GNOME Keyring or KWallet')
// Said when the system secret store can't hold a key.
export const keyStoreMissingText = (platform) =>
  platform === 'darwin' ? 'The Mac Keychain is not available, so the key cannot be stored safely.' : platform === 'win32' ? 'Windows encryption is not available, so the key cannot be stored safely.' : `No system keyring (${secretStoreName(platform)}) is available, so the key cannot be stored safely.`

// Said on a Mac when the Keychain refuses IV Studio access to its saved keys (Deny was pressed, or nobody answered).
// Re-entering a key can't work until access is allowed, so this replaces any "enter it again" text. Plain Allow
// asks for the password on every launch; Always Allow stops that.
export const keychainRefusedText = (platform) =>
  platform === 'darwin'
    ? 'The Mac Keychain isn’t letting IV Studio open its saved keys. Open Keychain Access and allow IV Studio, or quit and start IV Studio again and, when your Mac asks, press Always Allow (plain Allow asks again every time you start).'
    : keyStoreMissingText(platform)

// Said when a saved RunPod access token can't be used. On a Mac whose Keychain refuses access, setting up
// again can't work, so it says what to allow; otherwise it keeps the set-up-again text.
export const runpodTokenMissingText = (platform, storeAvailable) =>
  platform === 'darwin' && !storeAvailable
    ? keychainRefusedText(platform)
    : 'IV Studio can no longer read the RunPod access token it saved. Set up RunPod again on the Cloud page.'

// The Settings -> ComfyUI help under the launcher picker. Windows and Linux keep their text; a Mac names
// Comfy Desktop.app and ComfyUI's main.py.
export const comfyLauncherHelp = (platform) =>
  platform === 'darwin'
    ? 'Comfy Desktop.app, or a .sh script or main.py in your ComfyUI folder, so ComfyUI starts the way you’d start it yourself and keeps running after IV Studio closes. A ComfyUI folder’s main.py runs with its own venv’s Python, and its output goes to comfyui.log in IV Studio’s data folder.'
    : platform === 'linux'
      ? 'A .sh script beside ComfyUI, or its main.py with its own venv’s Python. Its output goes to comfyui.log in IV Studio’s data folder.'
      : 'The same shortcut or .bat you’d double-click, so ComfyUI starts with your own settings in its own window.'
