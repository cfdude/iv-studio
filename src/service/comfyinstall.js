// "Get ComfyUI for me": for someone with no ComfyUI yet, IV Studio downloads ComfyUI's official Windows portable
// build (its own Python inside, nothing else installed on the PC) from ComfyUI's GitHub releases, checks it against
// the SHA-256 GitHub publishes for it, unpacks it into a folder the person picks and points Settings → ComfyUI at it.
// People who already have a ComfyUI keep using theirs; this only shows when none is found.
//
// Which build (ComfyUI's README): NVIDIA 20-series and newer (compute capability 7.5+) get the main build (PyTorch
// CUDA 13, needs a recent driver); 10-series and older the CUDA 12.6 build. AMD and Intel cards have their own builds,
// but IV Studio's video (MiniMax H3) needs NVIDIA, so they're pointed at the cloud instead.
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export const RELEASES = 'https://api.github.com/repos/Comfy-Org/ComfyUI/releases/latest'
// NVIDIA's driver for CUDA 13 (the main build); older drivers can't start it
export const CUDA13_DRIVER = 580
// what the unpacked folder takes, on top of the download while both exist (v0.44.0 unpacks to 4.4 GB)
export const UNPACKED_BYTES = 5 * 1024 ** 3

// The build for this PC from Check my PC's scan ({ gpus, os }), or why there's none.
export function pickBuild(scan = {}) {
  const platform = scan.os?.platform || process.platform
  if (platform !== 'win32') return { ok: false, reason: platform === 'darwin' ? 'On a Mac, install ComfyUI Desktop from comfy.org, or render in the cloud.' : 'On Linux, install ComfyUI from its GitHub page, then pick its folder.' }
  const gpus = scan.gpus || []
  const nv = gpus.filter((g) => g.vendor === 'nvidia').sort((a, b) => (b.vram || 0) - (a.vram || 0))[0]
  if (!nv) {
    const other = gpus.find((g) => g.vendor === 'amd' || g.vendor === 'intel')
    return { ok: false, reason: other ? `IV Studio’s video model needs an NVIDIA graphics card; this computer has ${other.name || other.vendor}. Render in the cloud instead (Cloud page).` : 'No NVIDIA graphics card was found. IV Studio’s video model needs one: render in the cloud instead (Cloud page).' }
  }
  const old = nv.computeCap != null && nv.computeCap < 7.5
  const driver = Number(String(nv.driver || '').split('.')[0]) || null
  const asset = old ? 'ComfyUI_windows_portable_nvidia_cu126.7z' : 'ComfyUI_windows_portable_nvidia.7z'
  const warn = !old && driver && driver < CUDA13_DRIVER ? `Your NVIDIA driver is ${nv.driver}; this ComfyUI needs ${CUDA13_DRIVER} or newer. Update it first (NVIDIA App or nvidia.com/drivers), or ComfyUI won’t start.` : null
  return { ok: true, asset, gpu: nv.name, old, driver: nv.driver || null, warn, note: old ? 'Your card is a 10-series or older, so this is ComfyUI’s CUDA 12.6 build.' : null }
}

// The newest release's asset: { version, url, size, sha256, page }
export async function latestAsset(assetName, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(RELEASES, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'IV-Studio' } })
  if (!res.ok) throw new Error(`Couldn’t reach ComfyUI’s releases on GitHub (${res.status}).`)
  const r = await res.json()
  const a = (r.assets || []).find((x) => x.name === assetName)
  if (!a) throw new Error(`ComfyUI’s ${r.tag_name || 'latest'} release has no ${assetName}.`)
  const sha256 = String(a.digest || '').replace(/^sha256:/, '') || null
  return { version: r.tag_name, url: a.browser_download_url, size: a.size, sha256, page: r.html_url, name: a.name }
}

// Where to put it: the drive with the most free space (models need about 60 GB more), as <drive>\ComfyUI.
// A folder that's already there with something in it (another ComfyUI, say) is passed over for "IV Studio ComfyUI".
export function suggestFolder(drives = []) {
  const best = [...drives].filter((d) => d.free).sort((a, b) => b.free - a.free)[0]
  if (!best) return null
  const empty = (p) => !fs.existsSync(p) || fs.readdirSync(p).length === 0
  return [path.join(best.path, 'ComfyUI'), path.join(best.path, 'IV Studio ComfyUI'), path.join(best.path, 'IV Studio ComfyUI 2')].find(empty) || null
}

// Checks a folder before anything is downloaded: empty or new, and enough room for the download and the unpacked copy.
export function checkFolder(folder, { size = 2.1e9, freeOf } = {}) {
  if (!folder || !path.isAbsolute(folder)) return 'Pick a folder.'
  if (/\s/.test(folder) && /\\Program Files/i.test(folder)) return 'Pick a folder outside Program Files: ComfyUI writes into its own folder.'
  if (fs.existsSync(folder) && fs.readdirSync(folder).some((n) => !/\.part$|\.7z$/i.test(n) && n !== 'ComfyUI_windows_portable')) return 'That folder isn’t empty. Pick an empty or new folder.'
  const free = freeOf?.(folder)
  if (free != null && free < size + UNPACKED_BYTES) return `That drive has ${(free / 1024 ** 3).toFixed(1)} GB free; ComfyUI needs about ${((size + UNPACKED_BYTES) / 1024 ** 3).toFixed(0)} GB, and the models about 60 GB more.`
  return null
}

export class ComfyInstaller {
  // tar: Windows' own bsdtar (libarchive), which reads 7-Zip archives
  constructor({ fetchImpl = fetch, tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), onProgress = () => {} } = {}) {
    this.fetch = fetchImpl
    this.tar = tar
    this.onProgress = onProgress
    this.state = null
  }

  say(patch) {
    this.state = { ...(this.state || {}), ...patch, at: Date.now() }
    this.onProgress(this.state)
  }

  cancel() {
    if (!this.state || this.state.done) return false
    this.cancelled = true
    this.abort?.abort()
    this.child?.kill()
    return true
  }

  // asset: from latestAsset. Resolves with the ComfyUI folder (…\ComfyUI_windows_portable).
  async install({ folder, asset }) {
    if (this.busy) throw new Error('ComfyUI is already being installed.')
    this.busy = true
    this.cancelled = false
    this.state = null
    const archive = path.join(folder, asset.name)
    try {
      fs.mkdirSync(folder, { recursive: true })
      this.say({ phase: 'download', version: asset.version, folder, total: asset.size, got: 0 })
      await this.download(asset, archive)
      this.say({ phase: 'check' })
      const sum = await sha256Of(archive)
      if (asset.sha256 && sum !== asset.sha256) {
        fs.rmSync(archive, { force: true })
        throw new Error('The download didn’t match the checksum ComfyUI published, so it was removed. Try again.')
      }
      this.say({ phase: 'unpack', files: 0 })
      await this.unpack(archive, folder)
      fs.rmSync(archive, { force: true })
      const dir = path.join(folder, 'ComfyUI_windows_portable')
      if (!fs.existsSync(path.join(dir, 'run_nvidia_gpu.bat')) && !fs.existsSync(path.join(dir, 'ComfyUI', 'main.py'))) throw new Error('The unpacked ComfyUI looks incomplete.')
      this.say({ phase: 'done', done: true, dir })
      return dir
    } catch (err) {
      const msg = this.cancelled ? 'Cancelled.' : err.message
      this.say({ phase: 'error', done: true, error: msg })
      throw new Error(msg)
    } finally {
      this.busy = false
      this.abort = null
      this.child = null
    }
  }

  // with resume: a .part file picks up where it stopped
  async download(asset, archive) {
    const part = `${archive}.part`
    let have = fs.existsSync(part) ? fs.statSync(part).size : 0
    if (fs.existsSync(archive) && fs.statSync(archive).size === asset.size) return
    if (have > asset.size) (fs.rmSync(part, { force: true }), (have = 0))
    this.abort = new AbortController()
    const res = await this.fetch(asset.url, { headers: have ? { Range: `bytes=${have}-` } : {}, signal: this.abort.signal, redirect: 'follow' })
    if (!(res.ok || res.status === 206)) throw new Error(`The download failed (${res.status}).`)
    if (have && res.status !== 206) have = 0
    const out = fs.createWriteStream(part, { flags: have ? 'a' : 'w' })
    let got = have
    let last = 0
    const t0 = Date.now()
    const reader = res.body.getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (!out.write(value)) await new Promise((r) => out.once('drain', r))
        got += value.length
        const now = Date.now()
        if (now - last > 400) {
          last = now
          const rate = (got - have) / Math.max(1, (now - t0) / 1000)
          this.say({ got, total: asset.size, rate, left: rate > 0 ? Math.round((asset.size - got) / rate) : null })
        }
      }
    } finally {
      await new Promise((r) => out.end(r))
    }
    if (got !== asset.size) throw new Error(`The download stopped early (${got} of ${asset.size} bytes). Try again: it picks up where it stopped.`)
    fs.renameSync(part, archive)
    this.say({ got, total: asset.size })
  }

  // Windows' tar lists each file as it unpacks (-v writes to stderr): the count shows it's moving
  unpack(archive, folder) {
    return new Promise((resolve, reject) => {
      const p = spawn(this.tar, ['-xvf', archive, '-C', folder], { windowsHide: true })
      this.child = p
      let files = 0
      let last = 0
      let tail = ''
      const take = (buf) => {
        const lines = String(buf).split(/\r?\n/).filter(Boolean)
        files += lines.length
        tail = (tail + String(buf)).slice(-800)
        const now = Date.now()
        if (now - last > 400) (this.say({ files }), (last = now))
      }
      p.stdout.on('data', take)
      p.stderr.on('data', take)
      p.on('error', reject)
      p.on('close', (code) => (code === 0 ? (this.say({ files }), resolve(files)) : reject(new Error(`Unpacking failed (tar exit ${code}): ${tail.split(/\r?\n/).filter(Boolean).slice(-2).join(' ')}`))))
    })
  }
}

export function sha256Of(file) {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256')
    fs.createReadStream(file)
      .on('data', (d) => h.update(d))
      .on('error', reject)
      .on('end', () => resolve(h.digest('hex')))
  })
}
