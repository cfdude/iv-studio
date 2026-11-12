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

// What Settings keeps of a scan (settings.hardware): the card shown in Settings → Your computer.
export function summaryOf(d) {
  if (!d) return null
  const g = (d.scan.gpus || [])[0]
  return { at: d.scan.at, tier: d.rec.tier.id, title: d.rec.tier.title, gpu: g ? `${g.name}${g.vram ? ` · ${gbs(g.vram)}` : ''}` : null, ram: gbs(d.scan.ram), cpu: d.scan.cpu?.model, canTrain: !!d.rec.training?.localReady }
}
