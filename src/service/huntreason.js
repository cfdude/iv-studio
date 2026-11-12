// Why Create's "Hunt previews" button is greyed, in plain words: the first thing to fix, or null when it can go.
// Mirrors the button's own rule in Create.jsx (busy, no prompt, no plan, Setup not ready, prompt errors).
export function huntBlockedReason({ busy, prompt, plan, planError, setup, sd, errors = [], anyway }) {
  if (busy) return null
  if (!String(prompt || '').trim()) return 'Write what happens in the shot first.'
  if (!plan?.resolved) return planError || 'IV Studio is still working out this shot’s settings.'
  const comfyOk = setup?.items?.some((i) => i.id === 'comfyui' && i.status === 'ok')
  if (setup && (sd ? !comfyOk : !setup.ready)) {
    const first = sd ? setup.items.find((i) => i.id === 'comfyui') : setup.items.find((i) => i.status === 'missing')
    return `Setup isn’t finished${first ? `: ${first.label}${first.detail ? ` (${first.detail})` : ''}` : ''}. Open Settings → Setup.`
  }
  if (errors.length > 0 && !anyway) return `Fix the ${errors.length} error${errors.length > 1 ? 's' : ''} in the prompt, or press Render anyway.`
  return null
}
