import { keychainRefusedText } from '../shared/platform.js'

// Saved secrets. A secret that was never saved is different from one that was saved and can't be opened now
// (for example after the app's signing identity changed, or a Mac Keychain that refused access), and Settings
// and the Cloud page tell the person what to do about the second kind.

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
  comfyCloudKey: { label: 'Comfy Cloud key', action: 'reenter', text: 'The saved Comfy Cloud key can’t be read. Enter it again.' },
  civitaiKey: { label: 'Civitai key', action: 'reenter', text: 'The saved Civitai key can’t be read. Enter it again.' },
  runpodKey: { label: 'RunPod key', action: 'reenter', text: 'The saved RunPod key can’t be read. Enter it again.' },
  cloudToken: { label: 'Cloud GPU (Modal)', action: 'setup', text: 'The saved cloud GPU sign-in can’t be read. Set the cloud GPU up again.' },
  runpodToken: { label: 'Cloud GPU (RunPod)', action: 'setup', text: 'The saved cloud GPU sign-in can’t be read. Set the cloud GPU up again.' },
  hfToken: { label: 'Hugging Face token', action: 'reenter', text: 'The saved Hugging Face token can’t be read. Enter it again.' },
  openaiKey: { label: 'OpenAI-compatible writer key', action: 'reenter', text: 'The saved key for the OpenAI-compatible writer can’t be read. Enter it again.' },
  openaiHeaders: { label: 'OpenAI-compatible writer headers', action: 'reenter', text: 'The saved headers for the OpenAI-compatible writer can’t be read. Enter them again.' }
}
export const SECRET_NAMES = Object.keys(REMEDIES)

// What the window shows next to an unreadable secret. `action` is 'reenter' (the person typed it) or
// 'setup' (IV Studio made it, so typing one would be wrong).
export const secretRemedy = (name) => {
  const r = REMEDIES[name]
  if (!r) throw new Error(`Unknown saved secret: ${name}`)
  return { ...r }
}

// `store` is Electron's safeStorage (decryptString + isEncryptionAvailable). One state per secret:
//   'absent' | 'ok' | 'unreadable' | 'refused'
// 'refused' is only ever a Mac whose Keychain access was denied: isEncryptionAvailable() is false, the sealed
// value stays on disk, and nothing can be read or re-saved until the person allows access. Elsewhere an
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

export const secretStates = (settings, store, platform) => {
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

// The cloud sign-ins IV Studio made itself (the person never typed them).
const TOKEN_NAMES = ['cloudToken', 'runpodToken']

// Which saved secrets Settings and the Cloud page may offer to remove. An unreadable one is dead weight, and a
// key on a refused Keychain can be cleared (clearing needs no encryption). A refused cloud sign-in is kept: it
// may open again once access is allowed, and losing it would mean a full set-up.
export const removableSecrets = (states) =>
  SECRET_NAMES.filter((n) => states[n] === 'unreadable' || (states[n] === 'refused' && !TOKEN_NAMES.includes(n)))

// What clearing one cloud sign-in writes: just that field, nothing remote. Only an unreadable one may be cleared.
export const tokenClearPatch = (name, states) => {
  if (!TOKEN_NAMES.includes(name)) throw new Error('That isn’t a cloud sign-in.')
  const state = states?.[name] || 'absent'
  if (state === 'absent') throw new Error('Nothing saved to remove.')
  if (state === 'refused') throw new Error('IV Studio can’t tell whether this sign-in can be read until the Keychain allows it, so it was kept.')
  if (state !== 'unreadable') throw new Error('That sign-in can be read, so it was kept.')
  return { [name]: null }
}

// The settings the window gets: the secrets themselves never leave, only whether each is usable.
// `unreadable` lists saved secrets that can't be opened (re-enter, or set the cloud GPU up again).
// `secretStoreRefused` is true on a Mac whose Keychain access was denied: Settings then shows the
// allow-in-Keychain text and Remove, with no key entry.
export const projectSettings = (settings, store, platform) => {
  const { comfyApiKey, cloudToken, civitaiKey, runpodKey, runpodToken, comfyCloudKey, hfToken, openaiKey, openaiHeaders, ...rest } = settings
  const states = secretStates(settings, store, platform)
  return {
    ...rest,
    hasComfyKey: states.comfyApiKey === 'ok',
    hasCloudToken: states.cloudToken === 'ok',
    hasCivitaiKey: states.civitaiKey === 'ok',
    hasRunpodKey: states.runpodKey === 'ok',
    hasHfToken: states.hfToken === 'ok',
    hasOpenaiKey: states.openaiKey === 'ok',
    hasOpenaiHeaders: states.openaiHeaders === 'ok',
    unreadable: SECRET_NAMES.filter((n) => states[n] === 'unreadable'),
    removable: removableSecrets(states),
    secretStoreRefused: platform === 'darwin' && !storeAvailable(store)
  }
}
