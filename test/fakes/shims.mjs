// withShims(): copies the fake `claude` and `codex` scripts to a temp folder and puts it first on PATH, so a test
// that exercises an agent engine runs the shim instead of the person's real CLI.
//   const shims = withShims()   ...   shims.restore()
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerShimDir, unregisterShimDir } from './ports.mjs'

const binDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'bin')

export function withShims() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'iv-shims-')))
  for (const name of fs.readdirSync(binDir)) {
    fs.copyFileSync(path.join(binDir, name), path.join(dir, name))
    fs.chmodSync(path.join(dir, name), 0o755)
  }
  const before = process.env.PATH
  process.env.PATH = `${dir}${path.delimiter}${before || ''}`
  registerShimDir(dir)
  return {
    dir,
    restore() {
      process.env.PATH = before
      unregisterShimDir(dir)
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }
}
