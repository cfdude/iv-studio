// Reddit and GitHub reports (1.0.8): ComfyUI addresses typed the way a browser takes them, the drive a ComfyUI keeps
// its models on, where finished videos go, the accessibility settings, and the live preview decoder (taeh3).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { normalizeComfyUrl, readSettings, videosFolderOf, writeSettings } from '../src/service/paths.js'
import { comfyHome, isLocalUrl } from '../src/service/comfylauncher.js'
import { LIVE_NODE, withLivePreview } from '../src/service/remote.js'

let n = 0
const ok = (name, fn) => (fn(), n++, console.log('ok ', name))
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ivaddr-'))

ok('addresses as people type them', () => {
  assert.equal(normalizeComfyUrl('localhost:8000'), 'http://localhost:8000')
  assert.equal(normalizeComfyUrl(' 127.0.0.1:8188/ '), 'http://127.0.0.1:8188')
  assert.equal(normalizeComfyUrl('0.0.0.0:8188'), 'http://127.0.0.1:8188')
  assert.equal(normalizeComfyUrl('http://localhost:8000/'), 'http://localhost:8000')
  assert.equal(normalizeComfyUrl('192.168.1.20:8188'), 'http://192.168.1.20:8188')
  assert.equal(normalizeComfyUrl('https://abc-8188.proxy.runpod.net'), 'https://abc-8188.proxy.runpod.net')
  assert.equal(normalizeComfyUrl(''), 'http://127.0.0.1:8188')
  assert.throws(() => normalizeComfyUrl('ftp://x'))
  assert.equal(isLocalUrl(normalizeComfyUrl('localhost:8000')), true, 'a bare localhost:8000 reads as this computer')
})

ok('an address saved before the fix works, and a bad one is refused', () => {
  const dir = tmp()
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ comfyUrl: 'localhost:8000' }))
  assert.equal(readSettings(dir).comfyUrl, 'http://localhost:8000')
  assert.equal(writeSettings({ comfyUrl: '127.0.0.1:8001/' }, dir).comfyUrl, 'http://127.0.0.1:8001')
  assert.throws(() => writeSettings({ comfyUrl: 'ftp://nope' }, dir), /isn’t an address/)
  assert.equal(readSettings(dir).comfyUrl, 'http://127.0.0.1:8001', 'a refused address changes nothing')
  fs.rmSync(dir, { recursive: true, force: true })
})

ok('the accessibility settings are kept', () => {
  const dir = tmp()
  const s = writeSettings({ highContrast: true, textSize: 'larger', reduceMotion: true, focusRings: true, underlineLinks: true, videosFolder: 'E:\\Films' }, dir)
  for (const k of ['highContrast', 'reduceMotion', 'focusRings', 'underlineLinks']) assert.equal(s[k], true, k)
  assert.equal(s.textSize, 'larger')
  assert.equal(readSettings(dir).videosFolder, 'E:\\Films')
  assert.equal(readSettings(tmp()).textSize, 'normal', 'normal by default')
  fs.rmSync(dir, { recursive: true, force: true })
})

ok('finished videos go to the chosen folder, else Videos\\IV Studio', () => {
  const videos = path.join(os.tmpdir(), 'Videos')
  const chosen = path.join(os.tmpdir(), 'E-drive', 'Films')
  assert.equal(videosFolderOf({}, { videos }), path.join(videos, 'IV Studio'))
  assert.equal(videosFolderOf({ videosFolder: chosen }, { videos }), chosen)
  assert.equal(videosFolderOf({ videosFolder: 'relative' }, { videos }), path.join(videos, 'IV Studio'), 'a relative path is ignored')
  assert.equal(videosFolderOf({ videosFolder: chosen }, { incognito: true, dataDir: 'D' }), path.join('D', 'videos'), 'Incognito keeps its own')
})

ok('the folder a launcher’s ComfyUI keeps its models in', () => {
  const dir = tmp()
  const portable = path.join(dir, 'E', 'ComfyUI_windows_portable')
  fs.mkdirSync(portable, { recursive: true })
  const bat = path.join(portable, 'run_nvidia_gpu.bat')
  fs.writeFileSync(bat, '')
  assert.equal(comfyHome(bat), portable)
  // a desktop shortcut is followed to its target, not measured where the shortcut sits
  const lnk = path.join(dir, 'Desktop', 'ComfyUI.lnk')
  assert.equal(comfyHome(lnk, { readLink: () => ({ target: bat }) }), portable)
  assert.equal(comfyHome(lnk, { readLink: () => null }), null)
  // the Desktop app: the folder its installer was pointed at (basePath in its config.json)
  const appData = path.join(dir, 'AppData')
  const base = path.join(dir, 'E', 'ComfyUI Desktop')
  fs.mkdirSync(path.join(appData, 'ComfyUI'), { recursive: true })
  fs.mkdirSync(base, { recursive: true })
  fs.writeFileSync(path.join(appData, 'ComfyUI', 'config.json'), JSON.stringify({ basePath: base }))
  assert.equal(comfyHome(path.join(dir, 'Programs', 'ComfyUI', 'ComfyUI.exe'), { appData, platform: 'win32' }), base)
  assert.equal(comfyHome(path.join(dir, 'Programs', 'ComfyUI', 'ComfyUI.exe'), { appData: path.join(dir, 'none'), platform: 'win32' }), null)
  fs.rmSync(dir, { recursive: true, force: true })
})

ok('the live preview decoder is an optional, pinned download', () => {
  const m = JSON.parse(fs.readFileSync(new URL('../resources/models.json', import.meta.url), 'utf8')).models.find((x) => x.id === 'taeh3')
  assert.ok(m, 'taeh3 is listed')
  assert.equal(m.optional, true)
  assert.equal(m.folder, 'vae_approx')
  assert.equal(m.match, 'taeh3.safetensors')
  assert.match(m.url, /\/resolve\/[0-9a-f]{40}\//, 'pinned to a commit')
  assert.match(m.sha256, /^[0-9a-f]{64}$/)
  // a render only promises step pictures when its graph carries the preview node
  const g = { 14: { class_type: 'CFGGuider', inputs: { model: ['3', 0] } } }
  assert.ok(withLivePreview(g)[LIVE_NODE])
  assert.equal(g[LIVE_NODE], undefined)
})

console.log(`\n${n} passed`)
