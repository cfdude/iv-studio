// What the test guard (guard.mjs) is told by the fakes: which local ports are allowed, and which folders hold
// agent CLI shims. Kept apart from guard.mjs so a fake can register itself without loading the guard.
// With no guard loaded the registry still works; it just has nobody to enforce it.
import { realpathSync } from 'node:fs'
import path from 'node:path'

const KEY = Symbol.for('iv-studio.test-guard')

export function guardState() {
  return (globalThis[KEY] ??= { ports: new Set(), shimDirs: new Set(), programs: new Set(), refusals: [], netRefusals: [], trace: [], loaded: false, runDir: null })
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

// A program the test driver itself may start (the Electron binary the page tier launches). An exact real path,
// never inherited by a child: the app it starts carries its own guard. With `firstArg` it starts only when that is
// its first argument (a test that runs one harmless script, such as `python3 -I`, opens nothing else).
export function registerProgram(file, { firstArg } = {}) {
  const s = guardState()
  const real = realpathSync(file)
  s.programs.add(real)
  s.programFirstArg ??= new Map()
  if (firstArg === undefined) s.programFirstArg.delete(real)
  else s.programFirstArg.set(real, firstArg)
}

export function unregisterProgram(file) {
  const s = guardState()
  const real = realpathSync(file)
  s.programs.delete(real)
  s.programFirstArg?.delete(real)
}

export function registerShimDir(dir) {
  const s = guardState()
  s.shimDirs.add(dir)
  process.env.IV_TEST_SHIM_DIRS = [...s.shimDirs].join(path.delimiter)
}

export function unregisterShimDir(dir) {
  const s = guardState()
  s.shimDirs.delete(dir)
  process.env.IV_TEST_SHIM_DIRS = [...s.shimDirs].join(path.delimiter)
}

// Reads what a parent process passed down.
export function loadInherited() {
  const s = guardState()
  for (const p of fromList(process.env.IV_TEST_ALLOW_PORTS)) s.ports.add(Number(p))
  for (const d of String(process.env.IV_TEST_SHIM_DIRS || '').split(path.delimiter).filter(Boolean)) s.shimDirs.add(d)
}

export const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost', '[::1]'])
export const portAllowed = (host, port) => LOOPBACK.has(String(host).toLowerCase()) && guardState().ports.has(Number(port))
