import { keychainRefusedText } from '../shared/platform.js'

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

// ---------- What the window is told (task 6.3) ----------
// `store` is Electron's safeStorage (decryptString + isEncryptionAvailable). One state per secret:
//   'absent' | 'ok' | 'unreadable' | 'refused'
// 'refused' is only ever a Mac whose Keychain access was denied: isEncryptionAvailable() is false, the sealed
// value stays on disk, and nothing can be read or re-saved until the user allows access. Elsewhere an
// unavailable store behaves as it always did: a saved value counts as saved (and is not opened here).
const storeAvailable = (store) => {
  try {
    return !!store.isEncryptionAvailable()
  } catch {
    return false
  }
}

// Why nothing may be sealed right now, or null when the store can seal. Checked first in a step that changes
// something remote (a deploy that makes a new token), so a refusal can't leave the old token out of step.
// Linux's built-in-password fallback still seals, so it is not blocked here.
export const sealBlockedText = (store, platform) => (storeAvailable(store) ? null : keychainRefusedText(platform))

export const secretStates =(settings, store, platform) => {
  const available = storeAvailable(store)
  const states = {}
  for (const name of SECRET_NAMES) {
    const sealed = settings?.[name]
    if (!sealed) states[name] = 'absent'
    else if (!available) states[name] = platform === 'darwin' ? 'refused' : 'ok'
    else states[name] = readSecret(store, sealed).state
  }
  return states
}

// The settings the window gets: the secrets themselves never leave, only whether each is usable.
// `unreadable` lists saved secrets that can't be opened (re-enter, or set the cloud GPU up again).
// `secretStoreRefused` is true on a Mac whose Keychain access was denied: Settings then shows only the
// allow-in-Keychain text, with no remedies and no key entry.
export const projectSettings = (settings, store, platform) => {
  const { comfyApiKey, cloudToken, civitaiKey, runpodKey, runpodToken, ...rest } = settings
  const states = secretStates(settings, store, platform)
  return {
    ...rest,
    hasComfyKey: states.comfyApiKey === 'ok',
    hasCloudToken: states.cloudToken === 'ok',
    hasCivitaiKey: states.civitaiKey === 'ok',
    hasRunpodKey: states.runpodKey === 'ok',
    unreadable: SECRET_NAMES.filter((n) => states[n] === 'unreadable'),
    secretStoreRefused: platform === 'darwin' && !storeAvailable(store)
  }
}
