// Starting ComfyUI on macOS (src/service/comfylauncher.js): app bundles, Comfy Desktop's install folder, the
// accepted file types, and startApp. Temp trees only; nothing here opens a real app.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, test } from 'node:test'

import { launch, launchable, launcherTypes } from '../../src/service/comfylauncher.js'

const touch = (p) => (fs.mkdirSync(path.dirname(p), { recursive: true }), fs.writeFileSync(p, ''))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-launcher-darwin-'))
after(() => fs.rmSync(tmp, { recursive: true, force: true }))
const fresh = () => {
  const root = fs.mkdtempSync(path.join(tmp, 'root-'))
  const home = fs.mkdtempSync(path.join(tmp, 'home-'))
  return { root, home, env: { HOME: home, PATH: '' } }
}

describe('what a Mac accepts as a launcher', () => {
  test('.app, .sh and .py, case-insensitive', () => {
    for (const f of ['/Applications/Comfy Desktop.app', 'run.sh', 'main.py', 'X.APP']) assert.ok(launchable('darwin').test(f), f)
  })
  test('not Windows or AppImage types', () => {
    for (const f of ['a.bat', 'a.exe', 'a.lnk', 'a.AppImage', 'notes.txt']) assert.ok(!launchable('darwin').test(f), f)
  })
  test('the picker lists .app, .sh and .py', () => {
    assert.deepEqual(launcherTypes('darwin'), { name: 'Comfy Desktop.app, a shell script or main.py', extensions: ['app', 'sh', 'py'] })
  })
  test('Windows and Linux picker types are what they were', () => {
    assert.deepEqual(launcherTypes('win32').extensions, ['lnk', 'bat', 'cmd', 'exe'])
    assert.deepEqual(launcherTypes('linux').extensions, ['sh', 'py', 'AppImage'])
  })
  test('a .txt is refused with the Mac types, not Windows ones', () => {
    const { root } = fresh()
    const txt = path.join(root, 'a.txt')
    touch(txt)
    assert.throws(() => launch(txt, { platform: 'darwin' }), (e) => /\.app/.test(e.message) && /\.sh/.test(e.message) && /\.py/.test(e.message) && !/\.bat|\.exe|AppImage/.test(e.message))
  })
})

