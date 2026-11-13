// Which enhancers a finish can offer on this ComfyUI, and what a new finish starts with (the Shot page's Finish panel).
// Pure, so it is tested without a window. `caps` is the studio's capabilities (remote.js); it is null until read.

// DLSS 5 where it is installed (caps.dlss is false only once ComfyUI has been read and has none); the built-in 2×
// upscale and frame rate everywhere; SeedVR2 on a local CUDA ComfyUI only (it is refused on an Apple GPU).
// DLSS 5 is on offer unless this ComfyUI has been read and cannot run it: no DLSS node, an Apple GPU, or a Mac or Linux
// computer (it is a Windows NVIDIA program). capabilities() already folds those into caps.dlss; the rest is belt and braces.
export const dlssOn = (caps) => caps?.dlss !== false && caps?.gpuKind !== 'mps' && caps?.posix !== true

export function enhancerChoices(caps, remote) {
  const choices = []
  if (dlssOn(caps)) choices.push('dlss')
  choices.push('upscale')
  if (!remote && caps?.gpuKind === 'cuda') choices.push('seedvr2')
  return choices
}

// The enhancer to use: the wanted one when it is on offer, else the first on offer.
export const pickEnhancer = (wanted, choices) => (choices.includes(wanted) ? wanted : choices[0])

// The enhancer a finish starts with when nobody named one (an agent's finish_candidate): DLSS 5 where it is on offer,
// else the built-in upscale. Never DLSS 5 on an Apple GPU, the same rule as the Finish panel and Check my computer
// (hardware.js: anything but an NVIDIA card finishes with the upscale), so a Mac's default finish is plain.
export const defaultEnhancer = (caps, remote) => (caps?.gpuKind === 'mps' ? 'upscale' : pickEnhancer('dlss', enhancerChoices(caps, remote)))

// The frame rates the panel offers for an enhancer: RIFE's for upscale, else the ComfyUI's own.
export const fpsFor = (caps, enhancer) => (enhancer === 'upscale' ? caps?.fpsBuiltIn || [0] : caps?.fps || [0, 30, 50, 60, 120])

// What the panel lists as frame rates: the ones this ComfyUI can make (fpsFor), plus RIFE's 48, 72 and 120 on the
// upscale even before the pack is installed (the panel shows those off until it is), plus the rate the finish is
// already set to, so the chosen or default rate (48 on a Mac) is never missing from the row.
export const UPSCALE_FPS = [48, 72, 120]
export const fpsChoices = (caps, enhancer, current = 0) => [...new Set([...fpsFor(caps, enhancer), ...(enhancer === 'upscale' ? UPSCALE_FPS : []), ...(current ? [current] : [])])].sort((a, b) => a - b)

// The panel's starting options from the defaults Check my PC saved (settings.shotPrefs). A 2× or a frame rate is
// only started on when this ComfyUI has what it takes (the panel says what is missing).
export function finishDefaults(prefs, caps, remote) {
  const enhancer = pickEnhancer(prefs?.enhancer || 'dlss', enhancerChoices(caps, remote))
  const out = { enhancer }
  if (prefs?.finalMp) out.megapixels = prefs.finalMp
  if (prefs?.enhanceResolution) out.enhanceResolution = prefs.enhanceResolution
  if (enhancer === 'upscale') {
    // saved before the upscale existed (an old Mac default was SeedVR2): start on what Check my computer now picks
    const fresh = !!prefs && prefs.enhancer !== 'upscale'
    const want2x = fresh ? prefs?.upscale2x ?? true : !!prefs?.upscale2x
    const wantFps = fresh ? prefs?.fps ?? 48 : prefs?.fps
    out.upscale2x = want2x && !!caps?.esrgan
    out.fps = fpsFor(caps, 'upscale').includes(wantFps) ? wantFps : 0
  }
  return out
}
