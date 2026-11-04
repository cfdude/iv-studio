// Platform helpers the renderer and the main process both import. No Node imports here (the renderer is
// sandboxed): every function takes the platform as an argument, 'darwin' | 'win32' | 'linux'.
// The filesystem-backed finders live in src/service/platform.js.

// ---------- Modifier key ----------
// Cmd on a Mac, Ctrl everywhere else.
export const modKey = (e, platform) => (platform === 'darwin' ? !!e.metaKey : !!e.ctrlKey)
export const modLabel = (platform) => (platform === 'darwin' ? '⌘' : 'Ctrl')

// ---------- Wording ----------
export const dataFolderText = (platform) => (platform === 'darwin' ? '~/Library/Application Support/IV Studio' : platform === 'win32' ? '%APPDATA%\\IV Studio' : '~/.config/IV Studio')
// Windows and Linux keep today's text.
export const rendersFolderText = (platform) => (platform === 'darwin' ? '~/Movies/IV Studio' : 'Videos\\IV Studio')
export const secretStoreName = (platform) => (platform === 'darwin' ? 'Keychain' : platform === 'win32' ? 'Windows encryption' : 'GNOME Keyring or KWallet')
export const fileManagerName = (platform) => (platform === 'darwin' ? 'Finder' : platform === 'win32' ? 'Explorer' : 'your file manager')

// ---------- Filled in by later tasks (minimal behaviour for now) ----------
// Task 7.3: the editor's key-to-action mapping: 'undo' | 'redo' | 'splitAll' | 'prevMarker' | 'none' | 'pass'.
export const editorKeyAction = () => 'pass'
// Task 7.1: the application menu template for macOS.
export const macMenuTemplate = () => []
// Task 7.2: extra BrowserWindow options for a platform, merged over today's.
export const windowOptions = () => ({})
// Task 8.1: which update UI to show: 'show' | 'none'.
export const updateView = () => 'show'
// Task 8.1: the one switch for Mac updates. Task 8.1 makes darwin follow it; today only darwin is held off.
export const MAC_UPDATES = false
export const updatesEnabled = (platform) => platform !== 'darwin' || MAC_UPDATES
