// IV Studio updates itself from GitHub Releases (latest.yml is published next to the installer), the same
// way IV Downloader does: it checks on launch and every six hours, downloads a new version in the
// background, and installs it when the person clicks "Restart to update" or quits the app.
// IV_STUDIO_UPDATE_FEED (a URL with a latest.yml) points a test copy at a local feed; such a copy never
// installs on quit, so a test can't replace the installed app.
import { app } from 'electron'
import electronUpdater from 'electron-updater'
import { updatesEnabled } from '../shared/platform'

const SIX_HOURS = 6 * 60 * 60 * 1000
const TEST_FEED = process.env.IV_STUDIO_UPDATE_FEED

let state = { status: 'idle', version: app.getVersion(), available: null, percent: null, error: null, checkedAt: null }
export const updateState = () => state

export function initUpdater(onChange) {
  const set = (patch) => {
    state = { ...state, ...patch }
    onChange(state)
  }

  // Held back on this platform (a Mac build while MAC_UPDATES is off): never touch the update library.
  if (!updatesEnabled(process.platform)) {
    set({ status: 'off' })
    return { check: async () => state, install: () => false }
  }

  // Development builds have no app-update.yml; only packaged builds check.
  if (!app.isPackaged) {
    set({ status: 'dev' })
    return { check: async () => state, install: () => false }
  }

  // Only here, so a build that doesn't update never builds electron-updater's platform updater.
  const { autoUpdater } = electronUpdater
  if (TEST_FEED) autoUpdater.setFeedURL({ provider: 'generic', url: TEST_FEED })
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = !TEST_FEED

  autoUpdater.on('checking-for-update', () => set({ status: 'checking', error: null }))
  autoUpdater.on('update-not-available', () => set({ status: 'current', available: null, checkedAt: new Date().toISOString() }))
  autoUpdater.on('update-available', (info) => set({ status: 'downloading', available: info.version, percent: 0, checkedAt: new Date().toISOString() }))
  autoUpdater.on('download-progress', (p) => set({ status: 'downloading', percent: p.percent }))
  autoUpdater.on('update-downloaded', (info) => set({ status: 'ready', available: info.version, percent: 100 }))
  autoUpdater.on('error', (err) => {
    const message = String(err?.message || err)
    // With no published release yet (drafts only), GitHub has no "latest" to report.
    if (/Unable to find latest version/i.test(message)) return set({ status: 'current', error: null })
    set({ status: 'error', error: message.split('\n')[0] })
  })

  const check = async () => {
    if (state.status === 'downloading' || state.status === 'ready') return state
    try {
      await autoUpdater.checkForUpdates()
    } catch {
      /* reported through the error event */
    }
    return state
  }
  setTimeout(check, 10_000)
  setInterval(check, SIX_HOURS)

  return {
    check,
    // Silent install, then IV Studio opens again on the new version.
    install: () => {
      if (state.status !== 'ready') return false
      autoUpdater.quitAndInstall(true, true)
      return true
    }
  }
}
