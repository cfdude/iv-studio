// Installs the ComfyUI node packs IV Studio uses (resources/models.json node_packs) into the person's own ComfyUI.
// IV Studio's own pack is copied from its resources; every other pack is downloaded at the version IV Studio is
// tested with (a GitHub commit or a Comfy Registry release), unpacked into custom_nodes and given its requirements
// with ComfyUI's own Python. A folder that's already there is never touched. ComfyUI loads new packs when it restarts.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { isLocalUrl } from './comfylauncher.js'

// ComfyUI already has these, built for its own CUDA; a pack's requirements must never replace them.
const KEEP = /^(torch|torchvision|torchaudio|xformers|triton|triton-windows)\b/i

// Which packs this ComfyUI needs: the ones with any node it doesn't have, leaving out packs for the other OS and,
// when the GPU is known and isn't CUDA (an Apple GPU), packs that only run on CUDA (SeedVR2).
export function missingPacks(manifest, objectInfo, { linux = false, gpuKind = null } = {}) {
  return manifest.node_packs.filter((p) => !(linux && p.windowsOnly) && !(!linux && p.linuxOnly) && !(p.cudaOnly && gpuKind && gpuKind !== 'cuda') && p.classes.some((c) => !objectInfo[c]))
}

// The Python that runs ComfyUI, next to it: the portable build's python_embeded, a venv, or ComfyUI Desktop's .venv.
export function findPython(comfyRoot, platform = process.platform) {
  const win = platform === 'win32'
  const names = win
    ? ['python_embeded/python.exe', '.venv/Scripts/python.exe', 'venv/Scripts/python.exe', 'env/Scripts/python.exe']
    : ['.venv/bin/python', 'venv/bin/python', 'env/bin/python']
  for (const dir of [comfyRoot, path.dirname(comfyRoot)]) for (const n of names) if (fs.existsSync(path.join(dir, n))) return path.join(dir, n)
  return null
}

// Where this ComfyUI keeps its node packs and which Python runs it. ComfyUI says where custom_nodes is
// (/internal/folder_paths); the ComfyUI folder picked in Settings is the fallback. Only a ComfyUI on this PC.
export async function comfyPlace(comfy, folder) {
  if (!isLocalUrl(comfy.url)) throw new Error('ComfyUI isn’t on this computer, so IV Studio can’t add node packs to it. Install them where that ComfyUI runs.')
  let customNodes = null
  try {
    const paths = await comfy.req('/internal/folder_paths', { timeout: 20000 })
    customNodes = (paths.custom_nodes || []).map((p) => (Array.isArray(p) ? p[0] : p)).find((p) => p && fs.existsSync(p)) || null
  } catch {}
  if (!customNodes && folder) customNodes = ['ComfyUI/custom_nodes', 'custom_nodes'].map((f) => path.join(folder, f)).find((f) => fs.existsSync(f)) || null
  if (!customNodes) throw new Error('IV Studio couldn’t find ComfyUI’s custom_nodes folder. Start ComfyUI, or pick your ComfyUI folder in Settings → ComfyUI.')
  return { customNodes, python: findPython(path.dirname(customNodes)) }
}

const run = (cmd, args, opts = {}) =>
  new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true, ...opts })
    let out = ''
    p.stdout?.on('data', (d) => (out += d))
    p.stderr?.on('data', (d) => (out += d))
    p.on('error', reject)
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(Object.assign(new Error(out.trim().split('\n').slice(-6).join('\n') || `exit ${code}`), { code }))))
  })

async function download(url, file) {
  const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(600000) })
  if (!r.ok) throw new Error(`Download failed (${r.status}): ${url}`)
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()))
}

// Unpacks a zip or a tarball with ComfyUI's Python when there is one, else Windows' own tar (bsdtar reads zips).
// The format comes from the file's first bytes: the registry serves some zips named node.tar.gz.
async function unpack(archive, dest, python) {
  fs.mkdirSync(dest, { recursive: true })
  const zip = fs.readFileSync(archive).subarray(0, 2).toString('latin1') === 'PK'
  if (python) return run(python, ['-I', '-m', zip ? 'zipfile' : 'tarfile', '-e', archive, dest])
  const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar'
  return run(tar, ['-xf', archive, '-C', dest])
}

// A GitHub archive holds one folder (<repo>-<commit>); a registry archive holds the pack's files directly.
function packRoot(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  if (entries.some((e) => e.isFile() && e.name === '__init__.py')) return dir
  const dirs = entries.filter((e) => e.isDirectory())
  return dirs.length === 1 && entries.length === 1 ? packRoot(path.join(dir, dirs[0].name)) : dir
}

// rename can't cross drives (the temp folder on C:, ComfyUI on another), so it copies then.
function move(from, to) {
  try {
    fs.renameSync(from, to)
  } catch (err) {
    if (err.code !== 'EXDEV' && err.code !== 'EPERM') throw err
    fs.cpSync(from, to, { recursive: true })
  }
}

const archiveUrl = (p) => (p.registry ? p.registry : `${p.git.replace(/\/$/, '').replace('https://github.com/', 'https://codeload.github.com/')}/zip/${p.commit}`)

// Its requirements, without the torch family ComfyUI already has, and without git+ lines when git isn't here.
export function requirementsFor(text, { git = true } = {}) {
  const kept = []
  const skipped = []
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    if (KEEP.test(line) || (!git && /^git\+/i.test(line))) skipped.push(line)
    else kept.push(line)
  }
  return { kept, skipped }
}

// The VERSION file IV Studio's own pack carries (0 when it has none: a copy from before versions).
export function packVersion(dir) {
  try {
    return Number(fs.readFileSync(path.join(dir, 'VERSION'), 'utf8').trim()) || 0
  } catch {
    return 0
  }
}
// A uv venv has no pip of its own; `uv pip install --python <python>` fills it. Looks for uv on the PATH.
function whichUv(env = process.env) {
  const exe = process.platform === 'win32' ? 'uv.exe' : 'uv'
  for (const d of String(env.PATH || '').split(path.delimiter)) if (d && fs.existsSync(path.join(d, exe))) return path.join(d, exe)
  return null
}

// Installs a requirements list with ComfyUI's Python: pip when it has it, else uv, else says so plainly.
// Returns 'installed' or a sentence for the person.
export async function installRequirements(python, list, cwd, { run: runner = run, which = whichUv } = {}) {
  const hasPip = await runner(python, ['-m', 'pip', '--version']).then(() => true, () => false)
  try {
    if (hasPip) {
      await runner(python, ['-m', 'pip', 'install', '-r', list, '--disable-pip-version-check', '--no-warn-script-location'], { cwd })
      return 'installed'
    }
    const uv = which()
    if (!uv) return 'ComfyUI’s Python has no pip (it is a uv environment) and uv wasn’t found, so its requirements weren’t installed. Install uv, or run `uv pip install --python <ComfyUI’s python> -r requirements.txt` in the pack’s folder.'
    await runner(uv, ['pip', 'install', '--python', python, '-r', list], { cwd })
    return 'installed'
  } catch (err) {
    return `${hasPip ? 'pip' : 'uv'} couldn’t install all of them: ${err.message}`
  }
}

const hasGit = () => run(process.platform === 'win32' ? 'git.exe' : 'git', ['--version']).then(() => true, () => false)

// Installs the packs (each { id or dir, ... } from missingPacks). onProgress gets { dir, label, step, detail }.
// Returns one result per pack: installed, skipped (folder already there) or failed, and whether its requirements went in.
export async function installPacks(packs, { customNodes, python, resourcesDir, onProgress = () => {} }) {
  const results = []
  const git = await hasGit()
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-nodes-'))
  try {
    for (const p of packs) {
      const target = path.join(customNodes, p.dir)
      const say = (step, detail) => onProgress({ dir: p.dir, label: p.label, step, detail })
      const result = { dir: p.dir, label: p.label }
      results.push(result)
      // IV Studio's own pack is the one folder it updates in place, when the copy it carries is newer
      if (fs.existsSync(target) && p.bundled && p.version && packVersion(target) < p.version) {
        try {
          say('copying', `Updating to version ${p.version}`)
          fs.cpSync(path.join(resourcesDir, p.bundled), target, { recursive: true, force: true, filter: (x) => !x.includes('__pycache__') })
          Object.assign(result, { status: 'installed', detail: `Updated to version ${p.version}` })
          say('done', result.detail)
        } catch (err) {
          Object.assign(result, { status: 'failed', detail: err.message })
          say('failed', err.message)
        }
        continue
      }
      if (fs.existsSync(target)) {
        Object.assign(result, { status: 'skipped', detail: `Already in custom_nodes (${p.dir}), so it was left alone. ComfyUI loads it when it restarts.` })
        say('skipped', result.detail)
        continue
      }
      try {
        if (p.bundled) {
          say('copying')
          fs.cpSync(path.join(resourcesDir, p.bundled), target, { recursive: true, filter: (s) => !s.includes('__pycache__') })
        } else {
          say('downloading', p.registry ? `Comfy Registry ${p.registry.split('/').slice(-2, -1)[0]}` : `GitHub ${p.commit.slice(0, 7)}`)
          const archive = path.join(tmp, `${p.dir}${(p.registry || '').endsWith('.tar.gz') ? '.tar.gz' : '.zip'}`)
          await download(archiveUrl(p), archive)
          say('unpacking')
          const out = path.join(tmp, `${p.dir}-files`)
          await unpack(archive, out, python)
          move(packRoot(out), target)
        }
        result.status = 'installed'
        const reqFile = path.join(target, 'requirements.txt')
        if (fs.existsSync(reqFile)) {
          const { kept, skipped } = requirementsFor(fs.readFileSync(reqFile, 'utf8'), { git })
          result.skippedRequirements = skipped
          if (kept.length && !python) result.requirements = 'ComfyUI’s Python wasn’t found, so its requirements weren’t installed. Install them with ComfyUI’s Python, or with ComfyUI-Manager.'
          else if (kept.length) {
            say('requirements', kept.join(', '))
            const list = path.join(tmp, `${p.dir}-requirements.txt`)
            fs.writeFileSync(list, kept.join('\n'))
            result.requirements = await installRequirements(python, list, target)
          }
        }
        say('done', result.requirements && result.requirements !== 'installed' ? result.requirements : undefined)
      } catch (err) {
        fs.rmSync(target, { recursive: true, force: true })
        Object.assign(result, { status: 'failed', detail: err.message })
        say('failed', err.message)
      }
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
  return results
}
