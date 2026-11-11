// Check my PC: what this computer can do in IV Studio, read from the computer itself (no ComfyUI needed), and what
// to set up for it. scanHardware() reads the parts; recommend() turns a scan into plain verdicts, a way of working
// (this PC, the cloud or both), the downloads worth getting and the defaults to apply. recommend() is pure, so it
// can be tested on made-up machines (test/hardware.mjs).
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const GB = 1024 ** 3

// ---------- reading the computer ----------

function run(file, args, timeout = 6000) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout, windowsHide: true }, (err, stdout) => resolve(err ? null : String(stdout)))
  })
}

// nvidia-smi --query-gpu=name,memory.total,driver_version,compute_cap --format=csv,noheader,nounits
export function parseNvidiaSmi(text) {
  if (!text) return []
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.split(',').map((s) => s.trim()))
    .filter((p) => p.length >= 2 && Number(p[1]) > 0)
    .map(([name, mib, driver, cap]) => ({ vendor: 'nvidia', name, vram: Number(mib) * 1024 ** 2, driver: driver || null, computeCap: cap && /^\d/.test(cap) ? Number(cap) : null }))
}

function nvidiaSmi(platform) {
  if (platform === 'darwin') return null
  const sys = platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'nvidia-smi.exe') : null
  return sys && fs.existsSync(sys) ? sys : 'nvidia-smi'
}

// Graphics cards from Electron (app.getGPUInfo('complete')), for cards nvidia-smi can't see (AMD, Intel, Apple)
const VENDORS = { 0x10de: 'nvidia', 0x1002: 'amd', 0x1022: 'amd', 0x8086: 'intel', 0x106b: 'apple' }
export function electronGpus(info) {
  const list = info?.gpuDevice || []
  return list.map((d) => ({ vendor: VENDORS[d.vendorId] || 'other', name: d.deviceString || d.description || null, vram: null, driver: d.driverVersion || null, active: !!d.active }))
}

// Free space on each drive: Windows drive letters, or the main folders elsewhere (and mounted volumes on a Mac)
export function drives(platform = process.platform) {
  const roots =
    platform === 'win32'
      ? 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((l) => `${l}:\\`)
      : ['/', os.homedir(), ...(platform === 'darwin' ? list('/Volumes').map((v) => path.join('/Volumes', v)) : list('/mnt').map((v) => path.join('/mnt', v)))]
  const seen = new Set()
  const out = []
  for (const root of roots) {
    try {
      const s = fs.statfsSync(root)
      const total = s.blocks * s.bsize
      const free = s.bavail * s.bsize
      const key = `${total}:${s.blocks}`
      if (!total || seen.has(key)) continue // the same disk under another name
      seen.add(key)
      out.push({ path: root, total, free })
    } catch {}
  }
  return out
}
const list = (dir) => {
  try {
    return fs.readdirSync(dir)
  } catch {
    return []
  }
}

// Which of the drives holds a folder (the longest matching root)
export function driveOf(folder, ds) {
  if (!folder) return null
  const f = path.resolve(folder).toLowerCase()
  return ds.filter((d) => f.startsWith(d.path.toLowerCase())).sort((a, b) => b.path.length - a.path.length)[0] || null
}

// The parts of this computer. installs: what main already knows (ComfyUI, Ollama, the harnesses, the voice
// engine, the setup check's models, the cloud); passed in so this stays free of the app's classes.
export async function scanHardware({ electronGpu = null, platform = process.platform, installs = {}, comfyFolder = '', videosFolder = '' } = {}) {
  const smi = nvidiaSmi(platform)
  const nvidia = smi ? parseNvidiaSmi(await run(smi, ['--query-gpu=name,memory.total,driver_version,compute_cap', '--format=csv,noheader,nounits'])) : []
  const others = electronGpus(electronGpu).filter((g) => g.vendor !== 'nvidia' || !nvidia.length)
  const cpus = os.cpus()
  const ds = drives(platform)
  const models = driveOf(comfyFolder, ds)
  const videos = driveOf(videosFolder, ds)
  return {
    at: new Date().toISOString(),
    os: { platform, release: os.release(), arch: process.arch },
    cpu: { model: (cpus[0]?.model || '').replace(/\((R|TM)\)/gi, '').replace(/\s+/g, ' ').trim(), threads: cpus.length },
    ram: os.totalmem(),
    gpus: nvidia.length ? nvidia : others,
    drives: ds,
    modelsDrive: models ? { ...models, folder: comfyFolder } : null,
    videosDrive: videos ? { ...videos, folder: videosFolder } : null,
    installs
  }
}

// ---------- what it means ----------

// What to download, by what it's for (ids from resources/models.json)
export const MODEL_GROUPS = [
  { id: 'core', label: 'Video shots (MiniMax H3)', ids: ['fl2va', 'ref2va', 'text_encoder', 'video_vae', 'audio_vae', 'dmad', 'upscaler'], needs: 'video' },
  { id: 'design', label: 'Designing characters (Z-Image)', ids: ['zimage', 'zimage_te', 'zimage_vae'], needs: 'pictures' },
  { id: 'sdxl', label: 'SDXL pictures', ids: ['sdxl_base'], needs: 'pictures' },
  { id: 'music', label: 'Music (MiniMax Music 3 and ACE-Step)', ids: ['music3_dit', 'music3_te', 'music3_vae', 'ace15'], needs: 'music' },
  { id: 'replace', label: 'Replace: masks and descriptions', ids: ['sam31', 'describer'], needs: 'video' },
  { id: 'remake_swap', label: 'Replace: swapping people', ids: ['remake_swap'], needs: 'video' },
  { id: 'remake_edit', label: 'Replace: changing the scene', ids: ['remake_edit'], needs: 'video' },
  { id: 'qma', label: 'More angles of a place', ids: ['qma'], needs: 'pictures' }
]

const gb = (b) => b / GB
const fmt = (b) => (gb(b) >= 1000 ? `${(gb(b) / 1024).toFixed(1)} TB` : `${gb(b) >= 100 ? Math.round(gb(b)) : gb(b).toFixed(gb(b) < 10 ? 1 : 0)} GB`)

// An Apple Silicon Mac: the chip says arm64 (the scan records it); without that, an Apple graphics entry.
export function isAppleSilicon(scan) {
  if (scan.os?.platform !== 'darwin') return false
  return scan.os.arch ? scan.os.arch === 'arm64' : (scan.gpus || []).some((g) => g.vendor === 'apple')
}

// The tiers, by the best NVIDIA card's memory (H3 runs on CUDA), or on an Apple Silicon Mac by its unified memory.
// Only one measurement so far (H3 960x544 peaked at 28 GB on a 128 GB M5 Max), so the Mac cut-offs are cautious.
export function tierOf(scan) {
  if (isAppleSilicon(scan)) {
    const v = gb(scan.ram || 0)
    const gpu = (scan.gpus || []).find((g) => g.vendor === 'apple') || { vendor: 'apple', name: 'Apple GPU' }
    const id = v >= 96 ? 'all' : v >= 64 ? 'most' : v >= 32 ? 'some' : 'cloud'
    return { id, gpu: { ...gpu, vram: scan.ram || 0 }, vram: v }
  }
  const nv = (scan.gpus || []).filter((g) => g.vendor === 'nvidia' && g.vram).sort((a, b) => b.vram - a.vram)[0]
  const v = nv ? gb(nv.vram) : 0
  if (v >= 30) return { id: 'top', gpu: nv, vram: v }
  if (v >= 22) return { id: 'all', gpu: nv, vram: v }
  if (v >= 15) return { id: 'most', gpu: nv, vram: v }
  if (v >= 10) return { id: 'some', gpu: nv, vram: v }
  return { id: 'cloud', gpu: nv || (scan.gpus || [])[0] || null, vram: v }
}

const TIERS = {
  top: { title: 'This PC can do everything, fast', summary: 'Render shots, pictures, music and voices here, finish at full size, and train characters on this PC.', renderOn: 'local' },
  all: { title: 'This PC can do everything', summary: 'Render shots, pictures, music and voices here and finish at full size. Big jobs take a few minutes.', renderOn: 'local' },
  most: { title: 'This PC can make shots, a little smaller', summary: 'Shots, pictures, music and voices all run here. Keep finals at 1 to 1.5 MP; use the cloud for the biggest jobs.', renderOn: 'both' },
  some: { title: 'Pictures here, video in the cloud', summary: 'Pictures, music and voices run here. Video shots are slow on this card, so make them in the cloud.', renderOn: 'both' },
  cloud: { title: 'Make video in the cloud', summary: 'This PC has no NVIDIA card with enough memory for video. Shots render on RunPod, Modal or Comfy Cloud; IV Studio still edits, plans and organises here.', renderOn: 'cloud' }
}

export function recommend(scan) {
  const t = tierOf(scan)
  const tier = { id: t.id, ...TIERS[t.id] }
  const ram = gb(scan.ram || 0)
  const mac = scan.os?.platform === 'darwin'
  const apple = isAppleSilicon(scan)
  if (mac) {
    for (const k of ['title', 'summary']) tier[k] = tier[k].replace(/This PC/g, 'This Mac').replace(/this PC/g, 'this Mac')
    if (t.id === 'cloud') tier.summary = apple ? 'This Mac has under 32 GB of memory, which is too little for video. Shots render on RunPod, Modal or Comfy Cloud; IV Studio still edits, plans and organises here.' : 'This Mac has no Apple Silicon chip, so video shots render on RunPod, Modal or Comfy Cloud; IV Studio still edits, plans and organises here.'
    if (t.id === 'some') tier.summary = 'Pictures, music and voices run here. Video shots are untested at this memory size, so make them in the cloud.'
  }
  const win = scan.os?.platform === 'win32'
  const ins = scan.installs || {}
  const verdicts = []
  const tips = []

  // graphics card
  const g = t.gpu
  if (apple) {
    const state = t.id === 'all' ? 'great' : t.id === 'most' ? 'good' : t.id === 'some' ? 'ok' : 'weak'
    const say = {
      great: 'Enough unified memory for MiniMax H3 here: it peaked at 28 GB in testing.',
      good: 'Should run H3 here; this memory size is not tested yet. Keep finals at 1 to 1.5 MP.',
      ok: 'Pictures, music and voices fit. H3 video is untested at this size, so make it in the cloud.',
      weak: 'Under 32 GB of memory: too little for H3 video. Shots render in the cloud.'
    }[state]
    verdicts.push({ id: 'gpu', label: 'Graphics', value: `Apple GPU · ${fmt(scan.ram || 0)} unified memory`, state, say })
  } else if (g?.vendor === 'nvidia' && g.vram) {
    const state = t.id === 'top' || t.id === 'all' ? 'great' : t.id === 'most' ? 'good' : t.id === 'some' ? 'ok' : 'weak'
    const say = {
      great: 'Enough memory for MiniMax H3 at full size, SeedVR2 and training.',
      good: 'Runs H3. Previews at 0.4 MP and finals up to 1.5 MP fit comfortably.',
      ok: 'Pictures, music and voices fit. H3 video works but is slow here.',
      weak: 'Too little memory for H3 video. Pictures at small sizes may work.'
    }[state]
    verdicts.push({ id: 'gpu', label: 'Graphics card', value: `${g.name} · ${fmt(g.vram)}`, state, say })
    if (g.driver) {
      const major = Number(String(g.driver).split('.')[0])
      if (win && major && major < 560) tips.push({ state: 'warn', text: `Your NVIDIA driver is ${g.driver}. Update it (GeForce or NVIDIA App) before rendering: older drivers are slower and miss features DLSS 5 needs.` })
    }
  } else if (mac) {
    verdicts.push({ id: 'gpu', label: 'Graphics', value: g?.name || 'Mac graphics', state: 'weak', say: 'Only an Apple Silicon Mac can render MiniMax H3 here. Shots render in the cloud.' })
  } else {
    const name = g?.name || 'No NVIDIA card found'
    verdicts.push({ id: 'gpu', label: 'Graphics card', value: name, state: 'weak', say: g ? `${g.vendor === 'amd' ? 'AMD' : g.vendor === 'intel' ? 'Intel' : 'This'} card can't run MiniMax H3 (it needs NVIDIA's CUDA). Shots render in the cloud.` : 'MiniMax H3 needs an NVIDIA card. Shots render in the cloud.' })
  }

  // memory
  const ramState = ram >= 60 ? 'great' : ram >= 30 ? 'ok' : 'weak'
  verdicts.push({
    id: 'ram',
    label: 'Memory (RAM)',
    value: fmt(scan.ram || 0),
    state: ramState,
    say: ramState === 'great' ? 'Plenty for H3 and the other models, one family at a time.' : ramState === 'ok' ? 'Enough, but H3 loads slowly. IV Studio unloads one kind of model before the next.' : 'Under 32 GB: H3 struggles to load here. Use the cloud for video shots.'
  })
  if (ramState === 'weak' && t.id !== 'cloud') {
    tier.title = 'Pictures here, video in the cloud'
    tier.summary = 'Your card could run H3, but this PC has too little RAM to load it. Make video shots in the cloud; pictures, music and voices run here.'
    tier.renderOn = 'both'
  }

  // the processor (for the writer and voices on the CPU)
  verdicts.push({ id: 'cpu', label: 'Processor', value: `${scan.cpu?.model || 'Unknown'} · ${scan.cpu?.threads || '?'} threads`, state: (scan.cpu?.threads || 0) >= 12 ? 'good' : 'ok', say: (scan.cpu?.threads || 0) >= 12 ? 'The local prompt writer can work here while the graphics card renders.' : 'The local prompt writer will be slow while a render runs; Claude Code or Codex write faster.' })

  // where the models go
  const local = tier.renderOn !== 'cloud'
  const want = {
    core: local && t.id !== 'some' && ramState !== 'weak',
    design: local,
    sdxl: false,
    music: local && t.vram >= 15,
    replace: local && !apple && t.vram >= 22,
    remake_swap: false,
    remake_edit: false,
    qma: false
  }
  const present = new Set(ins.modelsPresent || [])
  const sizes = ins.modelSizes || {}
  const downloads = MODEL_GROUPS.map((m) => {
    const missing = m.ids.filter((id) => !present.has(id))
    const bytes = missing.reduce((s, id) => s + (sizes[id] || 0), 0)
    return { ...m, missing, bytes, size: fmt(bytes), have: !missing.length, recommended: !!want[m.id] && missing.length > 0 }
  })
  const needBytes = downloads.filter((d) => d.recommended).reduce((s, d) => s + d.bytes, 0)
  const md = scan.modelsDrive
  if (md) {
    const state = md.free > needBytes + 20 * GB ? 'great' : md.free > needBytes ? 'ok' : 'weak'
    verdicts.push({ id: 'disk', label: 'Free space', value: `${fmt(md.free)} free on ${md.path}`, state, say: state === 'weak' ? `The recommended downloads need ${fmt(needBytes)}. Free some space there, or move ComfyUI to a bigger drive.` : needBytes ? `Room for the ${fmt(needBytes)} of recommended downloads.` : 'Room to spare.' })
  } else {
    const best = [...(scan.drives || [])].sort((a, b) => b.free - a.free)[0]
    if (best) verdicts.push({ id: 'disk', label: 'Free space', value: `${fmt(best.free)} free on ${best.path}`, state: best.free > needBytes + 20 * GB ? 'good' : 'ok', say: `No ComfyUI folder yet. Put ComfyUI on ${best.path}, the drive with the most room (H3 alone is about 61 GB).` })
  }

  // the prompt writer
  const writer = ins.claude ? 'claude' : ins.codex ? 'codex' : 'local'
  const writerSay = {
    claude: 'Claude Code is on this PC: it writes the best prompts and reviews takes.',
    codex: 'Codex is on this PC: it writes good prompts and reviews takes.',
    local: ins.ollama ? 'The local writer (Ollama) is ready; it runs on the processor while a render uses the graphics card.' : 'Install Ollama for a free local writer, or sign in to Claude Code or Codex for better prompts.'
  }[writer]
  verdicts.push({ id: 'writer', label: 'Prompt writer', value: { claude: 'Claude Code', codex: 'Codex', local: ins.ollama ? 'Local (Ollama)' : 'Not set up' }[writer], state: writer === 'local' && !ins.ollama ? 'ok' : 'good', say: writerSay })

  // what to set
  const nvidia = g?.vendor === 'nvidia'
  const finalMp = t.id === 'top' || t.id === 'all' ? 2 : t.id === 'most' ? 1.5 : 1
  const enhancer = nvidia && win ? 'dlss' : 'seedvr2'
  const prefs = {
    previewMp: t.id === 'top' ? 0.6 : 0.4,
    quality: t.id === 'top' || t.id === 'all' ? 'standard' : 'draft',
    finalMp,
    enhancer,
    enhanceResolution: t.id === 'top' ? 1440 : 1080
  }
  if (apple) tips.push({ state: 'info', text: "Finals on a Mac use the 2× upscale; DLSS 5 needs an NVIDIA RTX card on Windows, and SeedVR2 isn't available on an Apple GPU yet." })
  else if (!nvidia || !win) tips.push({ state: 'info', text: 'DLSS 5 needs an NVIDIA RTX card on Windows. Finals here use SeedVR2 or the 2× upscale instead.' })
  if (ins.comfyRunning === false && !ins.comfyFound && local) tips.push({ state: 'warn', text: 'No ComfyUI found on this PC. Install ComfyUI (the Desktop app or the portable build) for anything that renders here.' })
  if (!ins.voices && local && nvidia) tips.push({ state: 'info', text: 'Voices are a one-time 12 GB setup on Audio > Voices.' })

  // training a character
  const training =
    nvidia && t.vram >= 16 && ramState !== 'weak'
      ? { where: 'cloud', localReady: true, say: `This card can train a character on this PC, free: Fizgig trains H3 from 16 GB, in a few hours. Or rent a cloud GPU for about $3 to $5 and half an hour.` }
      : { where: 'cloud', localReady: false, say: 'Characters train on a cloud GPU (your RunPod or Modal account), about $3 to $5 a character.' }

  return { tier, verdicts, tips, downloads, needBytes, need: fmt(needBytes), prefs, writer, training }
}
