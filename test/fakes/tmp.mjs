// tempDir(prefix): a throwaway folder under the OS temp folder that is removed when the test process ends, so a test file
// that makes folders without a cleanup of its own leaves nothing behind (node --test runs each file in its own process).
// tempDirReal() is the same with symlinks resolved (macOS /var is a link to /private/var).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const made = new Set()
process.on('exit', () => {
  for (const d of made) fs.rmSync(d, { recursive: true, force: true })
})

export function tempDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  made.add(dir)
  return dir
}

export function tempDirReal(prefix) {
  const dir = tempDir(prefix)
  return fs.realpathSync(dir)
}
