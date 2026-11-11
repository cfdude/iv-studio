// Speed presets: ready-made trades of picture size and steps for time and memory, so H3 runs on smaller
// graphics cards. Each preset only sets values IV Studio already has (preview size, steps, how many takes,
// the finish size and the 2x upscale); the graph itself never changes.
//
// Measured on an RTX 4090 with one 5 s Tess shot, one take, through IV Studio's own service (2026-11-08):
//   8 steps of sampling: 0.3 MP 32 s, 0.4 MP 43 s, 0.6 MP 75 s, 0.8 MP 111 s; 4 steps at 0.4 MP 24 s.
//   Each hunt also pays about 48 s once (the text encoder and H3 loading, then decoding).
//   Finish: 2 MP pass 194 s (only 1 GB of H3 stays on a 24 GB card), 1 MP + RTX 2x 116 s (2752x1536).
//   Attention settings (SLA keep %, dense, comfy kitchen vs PyTorch) and EasyCache changed almost nothing.
//   0.3 MP with 4 steps: 37 s for one take, close to the 0.4 MP / 8-step picture.
// The same 4090 with ComfyUI's --reserve-vram set to leave what a 16 GB card (7.5) and a 12 GB card (11.5) would:
//   0.4 MP, 8 steps 109 s / 123 s; 0.3 MP, 4 steps 46 s / 65 s; 2 MP finish 227 s / 213 s; 1 MP + RTX 2x 152 s / 148 s.
//   Everything fit (no out-of-memory) and the pictures matched; only the speed changed. A smaller card's own
//   compute is slower too, which that can't show.

export const SPEEDS = {
  quality: {
    label: 'Quality',
    say: 'The best picture: full previews, three takes, a 2 MP finish.',
    trade: 'Slowest. Needs a big card: the 2 MP finish streams most of H3 from memory.',
    previewMp: 0.4,
    steps: 8,
    previews: 3,
    finalMp: 2,
    upscale2x: false,
    estimate: { hunt: 180, finish: 194 }
  },
  balanced: {
    label: 'Balanced',
    say: 'Full previews, two takes, finished at 1 MP and upscaled 2x.',
    trade: 'About two thirds of the time. The final comes out bigger than a 2 MP pass, with slightly less fine skin detail.',
    previewMp: 0.4,
    steps: 8,
    previews: 2,
    finalMp: 1,
    upscale2x: true,
    estimate: { hunt: 135, finish: 116 }
  },
  fast: {
    label: 'Fast',
    say: 'Smaller, 4-step previews, two takes, finished at 1 MP and upscaled 2x.',
    trade: 'About half the time. Previews are softer; the finish is the same as Balanced.',
    previewMp: 0.3,
    steps: 4,
    previews: 2,
    finalMp: 1,
    upscale2x: true,
    estimate: { hunt: 60, finish: 116 }
  },
  low: {
    label: 'Low memory',
    say: 'One small 4-step preview and a 1 MP finish, never a 2 MP pass.',
    trade: 'For 10 to 16 GB cards. The least memory and the quickest; one take, so reroll the seed for another.',
    previewMp: 0.3,
    steps: 4,
    previews: 1,
    finalMp: 1,
    upscale2x: true,
    maxFinalMp: 1,
    estimate: { hunt: 40, finish: 116 }
  }
}
export const SPEED_IDS = Object.keys(SPEEDS)
export const DEFAULT_SPEED = 'quality'
export const isSpeed = (id) => SPEED_IDS.includes(id)

// Check my PC's pick, from hardware.js's tier (top, all, most, some, cloud)
export function speedForTier(tierId) {
  if (tierId === 'top' || tierId === 'all') return 'quality'
  if (tierId === 'most') return 'balanced'
  if (tierId === 'some') return 'low'
  return 'balanced' // cloud: the cloud's GPUs are big, but Balanced keeps runs short and cheap
}

// The preview settings a preset gives a shot
export function previewFor(id) {
  const s = SPEEDS[id] || SPEEDS[DEFAULT_SPEED]
  return { megapixels: s.previewMp, steps: s.steps, previews: s.previews }
}

// The finish a preset gives a shot. Without a 2x upscaler (no DLSS 5 and no cloud upscaler) the 1 MP + 2x finish
// becomes a 1.5 MP pass, or 1 MP on Low memory, which never runs a pass above 1 MP.
export function finishFor(id, { upscale2x = true } = {}) {
  const s = SPEEDS[id] || SPEEDS[DEFAULT_SPEED]
  if (!s.upscale2x || upscale2x) return { megapixels: s.finalMp, upscale2x: s.upscale2x }
  return { megapixels: s.maxFinalMp || 1.5, upscale2x: false }
}

// Which preset a form's own values match, or null when the person changed them by hand ("Custom")
// previews undefined: ignore the takes (Continue always renders one)
export function speedOf({ megapixels, steps, previews }) {
  return (
    SPEED_IDS.find((id) => {
      const p = previewFor(id)
      return p.megapixels === megapixels && p.steps === steps && (previews === undefined || p.previews === previews)
    }) || null
  )
}

// The saved preset (Settings → Your PC), else the one Check my PC's older defaults point at, else Quality
export function savedSpeed(settings = {}) {
  if (isSpeed(settings.speed)) return settings.speed
  const p = settings.shotPrefs
  if (p?.speed && isSpeed(p.speed)) return p.speed
  if (p) return p.finalMp >= 2 ? 'quality' : p.finalMp >= 1.5 ? 'balanced' : 'low'
  return DEFAULT_SPEED
}

// A render request with a preset's preview values filled in where the request leaves them out (an agent can send
// speed alone). speed: the request's own, else fallback (the saved one). Values given always win.
export function applySpeed(req, fallback = null) {
  const out = Object.fromEntries(Object.entries(req || {}).filter(([, v]) => v !== undefined && v !== null))
  const id = isSpeed(out.speed) ? out.speed : isSpeed(fallback) ? fallback : null
  if (out.speed !== undefined && !isSpeed(out.speed)) throw new Error(`Unknown speed "${out.speed}". Use ${SPEED_IDS.join(', ')}.`)
  if (!id) return out
  return { ...previewFor(id), ...out, speed: id }
}

// A finish request with the preset's finish filled in where it leaves the size or the 2x upscale out.
// caps: what the ComfyUI can do (remote.js capabilities); without a 2x upscaler, finishFor picks a pass instead.
export function applyFinishSpeed(finish, id, caps = {}) {
  const out = Object.fromEntries(Object.entries(finish || {}).filter(([, v]) => v !== undefined && v !== null))
  if (!isSpeed(id) || out.enhancer === 'seedvr2') return out
  const f = finishFor(id, { upscale2x: caps.upscale2x !== false })
  if (out.megapixels === undefined) out.megapixels = f.megapixels
  if (out.upscale2x === undefined) out.upscale2x = f.upscale2x
  return out
}

// "about 2 min" for the estimates shown beside each preset
export function roughTime(seconds) {
  if (seconds < 75) return `about ${Math.max(10, Math.round(seconds / 10) * 10)} s`
  const m = seconds / 60
  return `about ${m < 2.25 ? (Math.round(m * 2) / 2).toString().replace('.5', '½') : Math.round(m)} min`
}
