// Starting ComfyUI on macOS (src/service/comfylauncher.js): Comfy Desktop's app and install folder, and startApp.
// Temp trees and injected launch/wait only; nothing here opens a real app.
//   node --test test/unit/comfylauncher-darwin.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, test } from 'node:test'
import { findLaunchers, startApp } from '../../src/service/comfylauncher.js'

const touch = (p) => (fs.mkdirSync(path.dirname(p), { recursive: true }), fs.writeFileSync(p, ''))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-launcher-darwin-'))
after(() => fs.rmSync(tmp, { recursive: true, force: true }))
const home = () => fs.mkdtempSync(path.join(tmp, 'home-'))

describe('finding launchers on a Mac', () => {
  test('Comfy Desktop.app in ~/Applications is found, as is ComfyUI.app', () => {
    for (const name of ['Comfy Desktop.app', 'ComfyUI.app']) {
      const h = home()
      fs.mkdirSync(path.join(h, 'Applications', name), { recursive: true })
      const found = findLaunchers({ platform: 'darwin', home: h, env: { HOME: h } })
      assert.ok(found.some((f) => f.path === path.join(h, 'Applications', name)), name)
    }
  })
  test('Comfy Desktop’s standalone install under ~/ComfyUI-Installs is searched, on a Mac only', () => {
    const h = home()
    const main = path.join(h, 'ComfyUI-Installs', 'ComfyUI', 'ComfyUI', 'main.py')
    touch(main)
    assert.deepEqual(findLaunchers({ platform: 'darwin', home: h, env: { HOME: h } }).map((f) => f.path).filter((p) => p.startsWith(h)), [main]) // /Applications is the real one
    assert.equal(findLaunchers({ platform: 'linux', home: h, env: { HOME: h } }).length, 0)
  })
})

describe('startApp', () => {
  test('opens the app on darwin, then reports once ComfyUI answers', async () => {
    const calls = []
    const up = await startApp('/Applications/Comfy Desktop.app', {
      launch: (file, opts) => calls.push(['launch', file, opts.platform]),
      wait: async (url) => (calls.push(['wait', url]), { seconds: 4 }),
      url: 'http://127.0.0.1:8188'
    })
    assert.deepEqual(calls, [['launch', '/Applications/Comfy Desktop.app', 'darwin'], ['wait', 'http://127.0.0.1:8188']])
    assert.deepEqual(up, { seconds: 4 })
  })
  test('a silent wait says the app opened but nothing answered, and where to look', async () => {
    await assert.rejects(
      startApp('/Applications/Comfy Desktop.app', {
        launch: () => {},
        wait: async () => {
          throw new Error('timed out')
        },
        url: 'http://127.0.0.1:8188'
      }),
      (e) => /opened, but nothing answered at http:\/\/127\.0\.0\.1:8188 within 3 minutes/.test(e.message) && /Settings → ComfyUI/.test(e.message)
    )
  })
  test('a launcher that cannot start is not turned into the silent-wait message', async () => {
    await assert.rejects(
      startApp('/nope.app', {
        launch: () => {
          throw new Error('That ComfyUI launcher no longer exists.')
        },
        wait: async () => assert.fail('must not wait'),
        url: 'http://127.0.0.1:8188'
      }),
      /no longer exists/
    )
  })
  test('index.js sends only a darwin .app launcher to startApp', () => {
    assert.match(fs.readFileSync('src/main/index.js', 'utf8'), /process\.platform === 'darwin' && \/\\\.app\$\/i\.test\(file\) \? await startApp/)
  })
})
