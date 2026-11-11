// The portable copy's updates (see src/service/portableupdate.js for why it isn't electron-updater): the same states
// and the same { check, install } as updater.js, so Settings -> Updates and the sidebar work as for the installed
// copy. It checks on launch and every six hours, downloads the new zip in the background, and installs on
// "Restart to update" or when IV Studio quits. A copy that can't change its own folder says why and offers the
// download page instead; so does a release that has no portable feed.
// IV_STUDIO_UPDATE_FEED points a test copy at a local feed; IV_STUDIO_UPDATE_SELFTEST=1 then installs as soon as
// the download is ready (scripts/portable-update-selftest.mjs, on a copy of the app in a temporary folder).
import { app, shell } from 'electron'
import { spawn, execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { PORTABLE_FOLDER } from '../service/paths'
import { RELEASES, UPDATES_FOLDER, cannotReplace, checkFile, cleanUpOld, download, feedUrls, installScript, newer, parseFeed, pickFile, stage } from '../service/portableupdate'

const SIX_HOURS = 6 * 60 * 60 * 1000
const RETRY = 5 * 60 * 1000
const TAR = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
const unzip = (zip, dir) => new Promise((resolve) => execFile(TAR, ['-xf', zip, '-C', dir], { windowsHide: true, maxBuffer: 4 << 20 }, (err, stdout, stderr) => resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr })))

export function initPortableUpdater({ set, get, testFeed }) {
  const selftest = !!testFeed && process.env.IV_STUDIO_UPDATE_SELFTEST === '1'
  const urls = feedUrls(testFeed)
  const appDir = path.dirname(process.execPath)
  const work = path.join(appDir, PORTABLE_FOLDER, UPDATES_FOLDER)
  let staged = null // { version, dir }
  let busy = null
  let retry = null

  const log = (line) => {
    try {
      fs.mkdirSync(work, { recursive: true })
      fs.appendFileSync(path.join(work, 'update.log'), `${new Date().toISOString()} ${line}\n`)
    } catch {
      /* the log is only a help */
    }
  }
  // old program files an earlier update couldn't delete (still in use then)
  try {
    cleanUpOld(appDir)
  } catch {
    /* tried again next time */
  }

  async function fetchFeed() {
    const res = await fetch(`${urls.feed}${testFeed ? '' : `?t=${Date.now()}`}`, { redirect: 'follow' })
    if (res.status === 404) return null // no published release with a portable feed
    if (!res.ok) throw new Error(`GitHub answered ${res.status}.`)
    return parseFeed(await res.text())
  }

  async function checkNow() {
    set({ status: 'checking', error: null })
    const feed = await fetchFeed()
    const at = new Date().toISOString()
    if (!feed || !newer(feed.version, app.getVersion())) return set({ status: 'current', available: null, why: null, checkedAt: at })
    const file = pickFile(feed.files)
    const why = !file ? 'This release has no portable zip.' : cannotReplace(appDir)
    if (why) {
      log(`${feed.version} is out; can't install here: ${why}`)
      return set({ status: 'available', available: feed.version, manual: true, why, percent: null, checkedAt: at })
    }
    if (staged?.version === feed.version && fs.existsSync(staged.dir)) return set({ status: 'ready', available: feed.version, manual: false, why: null, percent: 100, checkedAt: at })
    set({ status: 'downloading', available: feed.version, manual: false, why: null, percent: 0, checkedAt: at })
    const zip = path.join(work, path.basename(file.url))
    log(`downloading ${file.url} (${feed.version})`)
    await download(urls.file(file.url, feed.version), zip, { onProgress: (p) => p !== get().percent && set({ percent: p }) })
    await checkFile(zip, file)
    const dir = await stage(zip, path.join(work, `new-${feed.version}`), { version: feed.version, unzip })
    fs.rmSync(zip, { force: true })
    staged = { version: feed.version, dir }
    log(`ready: ${dir}`)
    set({ status: 'ready', available: feed.version, percent: 100 })
    if (selftest) install()
  }

  const check = async () => {
    const s = get().status
    if (busy || s === 'downloading' || s === 'ready') return get()
    busy = checkNow()
      .catch((err) => {
        log(`error: ${err.message}`)
        set({ status: 'error', error: String(err.message || err).split('\n')[0], percent: null })
        clearTimeout(retry)
        retry = setTimeout(check, selftest ? 3000 : RETRY)
      })
      .finally(() => (busy = null))
    await busy
    return get()
  }

  // Hand the swap to a script that waits for this process to end. Started through a short-lived PowerShell's
  // Start-Process (as comfylauncher.js starts ComfyUI): a detached, console-less PowerShell runs nothing, and a
  // plain child could go down with IV Studio.
  function swap(relaunch) {
    const script = path.join(work, 'install.ps1')
    fs.writeFileSync(script, installScript({ pid: process.pid, appDir, staged: staged.dir, log: path.join(work, 'update.log'), relaunch }))
    const q = (s) => `'${String(s).replace(/'/g, "''")}'`
    const start = `Start-Process -FilePath powershell.exe -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',${q(`"${script}"`)}`
    spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', start], { stdio: 'ignore', windowsHide: true }).unref()
    log(`installing ${staged.version} over ${appDir}${relaunch ? ', then reopening' : ''}`)
  }

  function install() {
    const s = get()
    if (s.status === 'available') {
      shell.openExternal(`${RELEASES}/latest`)
      return true
    }
    if (s.status !== 'ready' || !staged) return false
    swap(true)
    staged = null
    // give the script a moment to start before this process goes
    setTimeout(() => app.quit(), 1200)
    return true
  }

  // a downloaded update also installs when IV Studio quits (never from a test feed, except the selftest)
  app.on('will-quit', () => {
    if (!staged || get().status !== 'ready' || (testFeed && !selftest)) return
    try {
      swap(false)
      staged = null
    } catch (err) {
      log(`couldn't start the install on quit: ${err.message}`)
    }
  })

  setTimeout(check, selftest ? 1000 : 10_000)
  setInterval(check, SIX_HOURS)
  return { check, install }
}
