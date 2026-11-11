// What the test guard (guard.mjs) is told by the fakes: which local ports are allowed, and which folders hold
// agent CLI shims. Kept apart from guard.mjs so a fake can register itself without loading the guard.
// With no guard loaded the registry still works; it just has nobody to enforce it.
const KEY = Symbol.for('iv-studio.test-guard')

export function guardState() {
  return (globalThis[KEY] ??= { ports: new Set(), shimDirs: new Set(), refusals: [], trace: [], loaded: false, runDir: null })
}

const fromList = (text) => String(text || '').split(/[,:]/).map((s) => s.trim()).filter(Boolean)

export function registerPort(port) {
  const s = guardState()
  s.ports.add(Number(port))
  process.env.IV_TEST_ALLOW_PORTS = [...s.ports].join(',')
}

export function unregisterPort(port) {
  const s = guardState()
  s.ports.delete(Number(port))
  process.env.IV_TEST_ALLOW_PORTS = [...s.ports].join(',')
}

export function registerShimDir(dir) {
  const s = guardState()
  s.shimDirs.add(dir)
  process.env.IV_TEST_SHIM_DIRS = [...s.shimDirs].join(':')
}

export function unregisterShimDir(dir) {
  const s = guardState()
  s.shimDirs.delete(dir)
  process.env.IV_TEST_SHIM_DIRS = [...s.shimDirs].join(':')
}

// Reads what a parent process passed down.
export function loadInherited() {
  const s = guardState()
  for (const p of fromList(process.env.IV_TEST_ALLOW_PORTS)) s.ports.add(Number(p))
  for (const d of String(process.env.IV_TEST_SHIM_DIRS || '').split(':').filter(Boolean)) s.shimDirs.add(d)
}

export const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost', '[::1]'])
export const portAllowed = (host, port) => LOOPBACK.has(String(host).toLowerCase()) && guardState().ports.has(Number(port))
