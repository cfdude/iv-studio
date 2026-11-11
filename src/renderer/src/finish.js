// Which enhancers a finish can offer on this ComfyUI, and what a new finish starts with (the Shot page's Finish panel).
// Pure, so it is tested without a window. `caps` is the studio's capabilities (remote.js); it is null until read.

// DLSS 5 where it is installed (caps.dlss is false only once ComfyUI has been read and has none); the built-in 2×
// upscale and frame rate everywhere; SeedVR2 on a local CUDA ComfyUI only (it is refused on an Apple GPU).
export function enhancerChoices(caps, remote) {
  const choices = []
  if (caps?.dlss !== false) choices.push('dlss')
  choices.push('upscale')
  if (!remote && caps?.gpuKind === 'cuda') choices.push('seedvr2')
  return choices
}

// The enhancer to use: the wanted one when it is on offer, else the first on offer.
export const pickEnhancer = (wanted, choices) => (choices.includes(wanted) ? wanted : choices[0])

// The frame rates the panel offers for an enhancer: RIFE's for upscale, else the ComfyUI's own.
export const fpsFor = (caps, enhancer) => (enhancer === 'upscale' ? caps?.fpsBuiltIn || [0] : caps?.fps || [0, 30, 50, 60, 120])

// The panel's starting options from the defaults Check my PC saved (settings.shotPrefs). A 2× or a frame rate is
// only started on when this ComfyUI has what it takes (the panel says what is missing).
export function finishDefaults(prefs, caps, remote) {
  const enhancer = pickEnhancer(prefs?.enhancer || 'dlss', enhancerChoices(caps, remote))
  const out = { enhancer }
  if (prefs?.finalMp) out.megapixels = prefs.finalMp
  if (prefs?.enhanceResolution) out.enhanceResolution = prefs.enhanceResolution
  if (enhancer === 'upscale') {
    out.upscale2x = !!prefs?.upscale2x && !!caps?.esrgan
    out.fps = fpsFor(caps, 'upscale').includes(prefs?.fps) ? prefs.fps : 0
  }
  return out
}
