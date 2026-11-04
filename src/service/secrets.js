// Saved secrets (design D8). A secret that was never saved is different from one that was saved and
// can't be opened now (for example after the app's signing identity changed), and Settings tells the
// user what to do about the second kind.

// `store` is anything with decryptString(Buffer), such as Electron's safeStorage. `sealed` is the
// base64 text kept in settings. Returns { state: 'absent' } | { state: 'ok', value } | { state: 'unreadable' }.
export const readSecret = (store, sealed) => {
  if (!sealed) return { state: 'absent' }
  try {
    return { state: 'ok', value: store.decryptString(Buffer.from(sealed, 'base64')) }
  } catch {
    return { state: 'unreadable' }
  }
}

const REMEDIES = {
  comfyApiKey: { label: 'Comfy API key', action: 'reenter', text: 'The saved Comfy API key can’t be read. Enter it again.' },
  civitaiKey: { label: 'Civitai key', action: 'reenter', text: 'The saved Civitai key can’t be read. Enter it again.' },
  runpodKey: { label: 'RunPod key', action: 'reenter', text: 'The saved RunPod key can’t be read. Enter it again.' },
  cloudToken: { label: 'Cloud GPU (Modal)', action: 'setup', text: 'The saved cloud GPU sign-in can’t be read. Set the cloud GPU up again.' },
  runpodToken: { label: 'Cloud GPU (RunPod)', action: 'setup', text: 'The saved cloud GPU sign-in can’t be read. Set the cloud GPU up again.' }
}
export const SECRET_NAMES = Object.keys(REMEDIES)

// What Settings shows next to an unreadable secret. `action` is 'reenter' (the user typed it) or
// 'setup' (IV Studio made it, so typing one would be wrong).
export const secretRemedy = (name) => {
  const r = REMEDIES[name]
  if (!r) throw new Error(`Unknown saved secret: ${name}`)
  return { ...r }
}
