// Starting ComfyUI on macOS (src/service/comfylauncher.js): Comfy Desktop's app and install folder, and startApp.
// Temp trees and injected launch/wait only; nothing here opens a real app.
//   node --test test/unit/comfylauncher-darwin.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, describe, test } from 'node:test'
import { comfyHome, findLaunchers, isDesktopLauncher, startApp } from '../../src/service/comfylauncher.js'

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

describe('Comfy Desktop on a Mac: recognising the app and finding its install', () => {
  const desktopData = (h, installs) => {
    const dir = path.join(h, 'Library', 'Application Support', 'Comfy Desktop')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'installations.json'), JSON.stringify(installs))
  }
  test('Comfy Desktop.app and ComfyUI.app are the Desktop app; a script, main.py or shortcut is not', () => {
    assert.ok(isDesktopLauncher('/Applications/Comfy Desktop.app'))
    assert.ok(isDesktopLauncher('/Applications/ComfyUI.app'))
    assert.ok(isDesktopLauncher('C:/Users/x/AppData/Local/Programs/@comfyorgcomfyui-electron/ComfyUI.exe'))
    assert.ok(!isDesktopLauncher('/Users/x/ComfyUI-Installs/ComfyUI/ComfyUI/main.py'))
    assert.ok(!isDesktopLauncher('/Users/x/run.sh'))
    assert.ok(!isDesktopLauncher('C:/x/Comfy Desktop.exe')) // Windows names are unchanged
  })
  test('the install folder is read from Comfy Desktop’s own installations.json, not guessed', () => {
    const h = home()
    const install = path.join(h, 'elsewhere', 'MyComfy')
    fs.mkdirSync(path.join(install, 'ComfyUI'), { recursive: true })
    desktopData(h, [{ installPath: path.join(h, 'gone') }, { installPath: install }])
    assert.equal(comfyHome('/Applications/Comfy Desktop.app', { platform: 'darwin', home: h }), path.join(install, 'ComfyUI'))
  })
  test('Comfy Desktop’s models folder wins when it has one, and a null installPath is skipped', () => {
    const h = home()
    const models = path.join(h, 'Shared', 'models')
    fs.mkdirSync(models, { recursive: true })
    const dir = path.join(h, 'Library', 'Application Support', 'Comfy Desktop')
    desktopData(h, [{ installPath: null }, { installPath: path.join(h, 'MyComfy') }])
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ modelsDirs: [path.join(h, 'gone'), models] }))
    assert.equal(comfyHome('/Applications/Comfy Desktop.app', { platform: 'darwin', home: h }), models)
  })
  test('an install with no inner ComfyUI folder is returned as it is', () => {
    const h = home()
    const install = path.join(h, 'MyComfy')
    fs.mkdirSync(install, { recursive: true })
    desktopData(h, [{ installPath: install }])
    assert.equal(comfyHome('/Applications/Comfy Desktop.app', { platform: 'darwin', home: h }), install)
  })
  test('the older ComfyUI.app config.json basePath still works', () => {
    const h = home()
    const base = path.join(h, 'base')
    fs.mkdirSync(base)
    const dir = path.join(h, 'Library', 'Application Support', 'ComfyUI')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ basePath: base }))
    assert.equal(comfyHome('/Applications/ComfyUI.app', { platform: 'darwin', home: h }), base)
  })
  test('no config, an unreadable one, or paths that are gone give null; main.py gives its folder', () => {
    const h = home()
    assert.equal(comfyHome('/Applications/Comfy Desktop.app', { platform: 'darwin', home: h }), null)
    desktopData(h, 'not an array')
    assert.equal(comfyHome('/Applications/Comfy Desktop.app', { platform: 'darwin', home: h }), null)
    desktopData(h, [{ installPath: path.join(h, 'gone') }, {}, null])
    assert.equal(comfyHome('/Applications/Comfy Desktop.app', { platform: 'darwin', home: h }), null)
    assert.equal(comfyHome('/x/ComfyUI/main.py', { platform: 'darwin', home: h }), '/x/ComfyUI')
  })
  test('Windows still reads %APPDATA%\\ComfyUI\\config.json, and ignores the Mac config', () => {
    const h = home()
    const appData = path.join(h, 'AppData')
    const base = path.join(h, 'winbase')
    fs.mkdirSync(base)
    fs.mkdirSync(path.join(appData, 'ComfyUI'), { recursive: true })
    fs.writeFileSync(path.join(appData, 'ComfyUI', 'config.json'), JSON.stringify({ basePath: base }))
    desktopData(h, [{ installPath: h }])
    assert.equal(comfyHome('C:/Programs/ComfyUI.exe', { platform: 'win32', appData, home: h }), base)
  })
})
