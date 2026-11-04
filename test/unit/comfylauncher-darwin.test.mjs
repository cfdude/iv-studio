// Starting ComfyUI on macOS (src/service/comfylauncher.js): app bundles, Comfy Desktop's install folder, the
// accepted file types, and startApp. Temp trees only; nothing here opens a real app.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { startFakeComfy } from '../fakes/comfyui.mjs'
import { findLaunchers, launch, launchable, launcherTypes, startApp } from '../../src/service/comfylauncher.js'

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

describe('finding launchers on a Mac', () => {
  test('Rob’s layout: the app first, then the Comfy Desktop install folder’s main.py', () => {
    const { root, home, env } = fresh()
    fs.mkdirSync(path.join(root, 'Applications', 'Comfy Desktop.app'), { recursive: true })
    const main = path.join(home, 'ComfyUI-Installs', 'ComfyUI', 'ComfyUI', 'main.py')
    touch(main)
    touch(path.join(path.dirname(main), '.venv', 'bin', 'python'))
    const found = findLaunchers({ platform: 'darwin', home, root, env })
    assert.deepEqual(found.map((f) => [f.path, f.label]), [
      [path.join(root, 'Applications', 'Comfy Desktop.app'), 'Comfy Desktop (app)'],
      [main, 'main.py']
    ])
  })
  test('no app bundle: no app candidate, folders still offered', () => {
    const { root, home, env } = fresh()
    const main = path.join(home, 'ComfyUI-Installs', 'ComfyUI', 'ComfyUI', 'main.py')
    touch(main)
    assert.deepEqual(findLaunchers({ platform: 'darwin', home, root, env }).map((f) => f.path), [main])
  })
  test('an unrelated "comfy" folder with no main.py is not offered', () => {
    const { root, home, env } = fresh()
    touch(path.join(home, 'ComfyUI-Installs', 'comfy-notes', 'readme.txt'))
    touch(path.join(home, 'comfy-stuff', 'readme.txt'))
    assert.deepEqual(findLaunchers({ platform: 'darwin', home, root, env }), [])
  })
  test('~/ComfyUI-Installs is searched on a Mac only', () => {
    const { root, home, env } = fresh()
    touch(path.join(home, 'ComfyUI-Installs', 'ComfyUI', 'ComfyUI', 'main.py'))
    assert.equal(findLaunchers({ platform: 'linux', home, root, env }).length, 0)
  })
  test('with no root given, /Applications means the real /Applications, not a relative folder', () => {
    const { home, env } = fresh()
    const cwd = process.cwd()
    const work = fs.mkdtempSync(path.join(tmp, 'cwd-'))
    fs.mkdirSync(path.join(work, 'Applications', 'Comfy Desktop.app'), { recursive: true })
    process.chdir(work)
    try {
      assert.ok(!findLaunchers({ platform: 'darwin', home, env }).some((f) => f.path.startsWith('Applications')))
    } finally {
      process.chdir(cwd)
    }
  })
})

describe('startApp', () => {
  const fakeSpawn = () => {
    const calls = []
    const spawn = (...args) => (calls.push(args), { unref: () => calls.push('unref') })
    return { calls, spawn }
  }
  test('opens the app through the system, detached, and reports running once ComfyUI answers', async () => {
    const fake = await startFakeComfy({ devices: 'mps', os: 'darwin' })
    try {
      const { calls, spawn } = fakeSpawn()
      const up = await startApp('/Applications/Comfy Desktop.app', { spawn, url: fake.url, timeoutMs: 5000 })
      assert.deepEqual(calls[0], ['open', ['/Applications/Comfy Desktop.app'], { detached: true, stdio: 'ignore' }])
      assert.equal(calls[1], 'unref')
      assert.equal(typeof up.seconds, 'number')
    } finally {
      await fake.close()
    }
  })
  test('uses the injected wait when given', async () => {
    const { spawn } = fakeSpawn()
    const seen = []
    const up = await startApp('/x.app', { spawn, url: 'http://127.0.0.1:1', waitUp: async (u, o) => (seen.push([u, o.timeoutMs]), { seconds: 4 }) })
    assert.deepEqual(up, { seconds: 4 })
    assert.deepEqual(seen, [['http://127.0.0.1:1', 180000]])
  })
  test('nothing answers: the message names the address and both remedies', async () => {
    const fake = await startFakeComfy()
    const url = fake.url
    await fake.close()
    const { spawn } = fakeSpawn()
    await assert.rejects(startApp('/Applications/Comfy Desktop.app', { spawn, url, timeoutMs: 300 }), (e) => {
      assert.ok(e.message.includes(url), 'names the address')
      assert.match(e.message, /start ComfyUI.s server in Comfy Desktop/i)
      assert.match(e.message, /address Comfy Desktop shows in Settings/i)
      return true
    })
  })
})
