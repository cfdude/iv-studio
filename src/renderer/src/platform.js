// The renderer's one source for the platform: 'darwin' | 'win32' | 'linux', from the main process's app:info
// (the same value main uses), never from the browser's user agent. main.jsx calls loadPlatform() before the
// first render, so the value is already there when anything paints; components read it with usePlatform().
import { useSyncExternalStore } from 'react'

let current = null
const listeners = new Set()

export const getPlatform = () => current

// Sets the platform and marks the document root (data-platform) so the CSS can tell platforms apart.
export function setPlatform(platform, root = typeof document !== 'undefined' ? document.documentElement : null) {
  current = platform || null
  if (root) {
    if (current) root.dataset.platform = current
    else delete root.dataset.platform
  }
  for (const l of listeners) l()
}

// Asks for the app info and keeps its platform. A failure leaves the platform unknown (null), which every
// wording helper treats as "not a Mac"; it never blocks the window from opening.
export async function loadPlatform(info = () => window.ivstudio.app.info(), root) {
  try {
    setPlatform((await info())?.platform, root)
  } catch {
    setPlatform(null, root)
  }
  return current
}

const subscribe = (l) => {
  listeners.add(l)
  return () => listeners.delete(l)
}
export const usePlatform = () => useSyncExternalStore(subscribe, getPlatform)
