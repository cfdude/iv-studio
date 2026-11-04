// A real start on Linux: a stand-in "ComfyUI" script that writes a file, started in its own session with its
// output logged. It spawns a real process, so it is a real test (see test/real/README.md): opt-in, and Linux only.
// Its logic twin is test/unit/comfylauncher.test.mjs.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { launch } from '../../src/service/comfylauncher.js'

const skip = process.env.IV_REAL !== '1' ? 'set IV_REAL=1 to run real tests' : process.platform !== 'linux' ? 'Linux only' : false

test('Linux: a script really starts, in its own folder, with its output in the log', { skip }, async () => {
  const lhome = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-launcher-real-'))
  try {
    const fake = path.join(lhome, 'FakeComfy')
    const marker = path.join(fake, 'started.txt')
    fs.mkdirSync(fake, { recursive: true })
    fs.writeFileSync(path.join(fake, 'run_gpu.sh'), `echo started > "${marker}"
echo hello from comfy
`)
    const log = path.join(lhome, 'comfy.log')
    launch(path.join(fake, 'run_gpu.sh'), { platform: 'linux', logFile: log })
    for (let i = 0; i < 50 && !fs.existsSync(marker); i++) await new Promise((r) => setTimeout(r, 100))
    await new Promise((r) => setTimeout(r, 200))
    assert.ok(fs.existsSync(marker) && /hello from comfy/.test(fs.readFileSync(log, 'utf8')))
  } finally {
    fs.rmSync(lhome, { recursive: true, force: true })
  }
})
