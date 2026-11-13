// Small, pure helpers for how a scan of this computer is worded and summarised (the Welcome wizard and Settings →
// Your computer share them). No Node imports: the window uses it too.
const GB = 1024 ** 3

export const gbs = (b) => (b / GB >= 1000 ? `${(b / GB / 1024).toFixed(1)} TB` : `${b / GB >= 100 ? Math.round(b / GB) : (b / GB).toFixed(b / GB < 10 ? 1 : 0)} GB`)

// A drive's root as a person says it: "/" is the startup disk, "/Volumes/Media" is Media, "C:\" is C:.
export function driveName(p) {
  const s = String(p || '')
  if (s === '/') return 'the startup disk'
  const vol = /^\/Volumes\/([^/]+)\/?$/.exec(s)
  if (vol) return vol[1]
  return s.replace(/\\$/, '')
}

// Chromium names a card through its ANGLE layer: "ANGLE (Apple, ANGLE Metal Renderer: Apple M5 Max, Unspecified
// Version)", "ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 (0x00002684) Direct3D11 vs_5_0 ps_5_0, D3D11)". The card's own
// name is what a person recognises; anything that isn't in that wrapper is left alone.
export function cleanGpuName(raw) {
  const m = /^ANGLE \((.*)\)$/s.exec(String(raw || '').trim())
  if (!m) return raw || null
  const i = m[1].indexOf(', ')
  let name = i < 0 ? m[1] : m[1].slice(i + 2)
  name = name
    .replace(/,\s*(?:D3D\d+[\w.-]*|OpenGL[^,]*|Vulkan[^,]*|Metal[^,]*|Unspecified Version|Version[^,]*)$/i, '')
    .replace(/^ANGLE Metal Renderer:\s*/i, '')
    .replace(/\s+Direct3D\d+.*$/i, '')
    .replace(/\s*\(0x[0-9a-f]+\)/gi, '')
    .trim()
  return name || raw
}


// Settings keeps a short summary of the last scan (settings.hardware). Records written before this stamp existed (v)
// came from older builds that stored Chromium's raw ANGLE string and, on a Mac, the 'cloud' tier. Bump it when the
// summary's meaning changes, so the card checks the computer again by itself.
export const SUMMARY_VERSION = 2

// A stored summary an older build wrote: no stamp or an older one (those kept Chromium's raw ANGLE name and filed an
// Apple Silicon Mac under the 'cloud' tier), or a raw ANGLE name whatever the stamp. A stamped Mac with the 'cloud'
// tier is a real result (little memory), so it is not stale.
export function summaryStale(hw) {
  if (!hw) return false
  return (hw.v ?? 0) < SUMMARY_VERSION || /^ANGLE \(/.test(String(hw.gpu || ''))
}

// The by-itself re-check of a stale card runs at most once per app session, whether or not it works: a card that stays
// stale (the scan throws, or the graphics name is one we don't know) must not scan again on every Settings visit.
let autoTried = false
export function autoRecheckOnce(stale, run) {
  if (!stale || autoTried) return false
  autoTried = true
  Promise.resolve()
    .then(run)
    .catch(() => {})
  return true
}
export const resetAutoRecheck = () => {
  autoTried = false
}

// A stored summary as the card shows it: the GPU's own name, whatever an older build kept ("ANGLE (…) · 24 GB").
export function summaryForDisplay(hw) {
  if (!hw?.gpu) return hw
  const [name, ...rest] = String(hw.gpu).split(' · ')
  return { ...hw, gpu: [cleanGpuName(name), ...rest].join(' · ') }
}

// What Settings keeps of a scan (settings.hardware): the card shown in Settings → Your computer.
export function summaryOf(d) {
  if (!d) return null
  const g = (d.scan.gpus || [])[0]
  return { v: SUMMARY_VERSION, at: d.scan.at, tier: d.rec.tier.id, title: d.rec.tier.title, gpu: g ? `${g.name}${g.vram ? ` · ${gbs(g.vram)}` : ''}` : null, ram: gbs(d.scan.ram), cpu: d.scan.cpu?.model, canTrain: !!d.rec.training?.localReady }
}
