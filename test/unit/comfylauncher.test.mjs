// Starting ComfyUI (src/service/comfylauncher.js): which launchers are found, in what order, and that only a
// ComfyUI on this PC can be started. Builds a fake home folder; starts nothing.
// Ported from test/comfylauncher.mjs; the real Linux start lives in test/real/comfylauncher-linux.test.mjs.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { findLaunchers, isComfyFolder, isLocalUrl, launch, launchersIn, linuxCommand } from '../../src/service/comfylauncher.js'

const touch = (p) => (fs.mkdirSync(path.dirname(p), { recursive: true }), fs.writeFileSync(p, ''))

test('this PC: 127.0.0.1, localhost and ::1', () => {
  assert.ok(isLocalUrl('http://127.0.0.1:8188') && isLocalUrl('http://localhost:8188/') && isLocalUrl('http://[::1]:8188'))
})

test('not this PC: another machine, the cloud, nonsense', () => {
  assert.ok(!isLocalUrl('http://192.168.1.20:8188') && !isLocalUrl('https://pod-8189.proxy.runpod.net') && !isLocalUrl('not a url'))
})

describe('launchers in a fake home folder', () => {
  let home
  let env
  before(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-launcher-'))
    env = { USERPROFILE: home, APPDATA: path.join(home, 'AppData', 'Roaming'), LOCALAPPDATA: path.join(home, 'AppData', 'Local'), PUBLIC: path.join(home, 'Public') }
  })
  after(() => fs.rmSync(home, { recursive: true, force: true }))

  // These steps build on one another (same as the original script), so they run in order.
  test('Windows: what is found, and in what order', () => {
    assert.equal(findLaunchers({ env, drives: [], platform: 'win32' }).length, 0, 'nothing installed: nothing found')
    touch(path.join(home, 'ComfyUI_windows_portable', 'run_nvidia_gpu.bat'))
    touch(path.join(home, 'ComfyUI_windows_portable', 'run_cpu.bat'))
    touch(path.join(env.LOCALAPPDATA, 'Programs', '@comfyorgcomfyui-electron', 'ComfyUI.exe'))
    touch(path.join(home, 'Desktop', 'ComfyUI.lnk'))
    touch(path.join(home, 'Desktop', 'notes.txt'))
    touch(path.join(env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'ComfyUI', 'ComfyUI.lnk'))
    const found = findLaunchers({ env, drives: [], platform: 'win32' })
    const names = found.map((f) => path.relative(home, f.path))
    assert.ok(found[0].path.endsWith(path.join('Desktop', 'ComfyUI.lnk')), 'a desktop shortcut comes first (it carries the person’s own flags)')
    assert.ok(found.some((f) => f.kind === 'desktop app') && found.some((f) => f.kind === 'portable'), 'the ComfyUI Desktop app and a portable install are found too')
    assert.ok(names.indexOf(path.join('ComfyUI_windows_portable', 'run_nvidia_gpu.bat')) < names.indexOf(path.join('ComfyUI_windows_portable', 'run_cpu.bat')), 'the GPU .bat before the CPU one')
    assert.ok(!names.some((n) => n.endsWith('notes.txt')), 'only things that can start ComfyUI')
  })

  test('Windows: a missing file or a non-launcher is refused, not run', () => {
    let refused = 0
    for (const bad of [path.join(home, 'missing.bat'), path.join(home, 'Desktop', 'notes.txt')]) {
      try {
        launch(bad, { platform: 'win32' })
      } catch {
        refused++
      }
    }
    assert.equal(refused, 2)
  })

  test('a picked ComfyUI folder (Settings → ComfyUI → ComfyUI folder)', () => {
    const portable = path.join(home, 'ComfyUI_windows_portable')
    touch(path.join(portable, 'ComfyUI', 'main.py'))
    touch(path.join(portable, 'run_nvidia_gpu_seedhunter.bat'))
    touch(path.join(portable, 'README_VERY_IMPORTANT.txt'))
    const app = path.join(env.LOCALAPPDATA, 'Programs', '@comfyorgcomfyui-electron')
    assert.ok(isComfyFolder(portable) && isComfyFolder(app) && !isComfyFolder(path.join(home, 'Desktop')), 'a portable install and the Desktop app’s folder count as ComfyUI; the desktop doesn’t')
    const inFolder = launchersIn(portable, 'win32').map((f) => f.label)
    assert.ok(inFolder[0] === 'run_nvidia_gpu.bat' && inFolder[1] === 'run_nvidia_gpu_seedhunter.bat' && inFolder.at(-1) === 'run_cpu.bat' && !inFolder.some((n) => n.endsWith('.txt')), 'its start files: run_nvidia_gpu.bat, then GPU variants, CPU last, nothing else')
  })

  test('Linux: folders in the home folder, .sh scripts first, then main.py with the folder’s own venv', () => {
    const lhome = path.join(home, 'linux-home')
    assert.equal(findLaunchers({ platform: 'linux', home: lhome }).length, 0, 'Linux, nothing installed: nothing found')
    const comfy = path.join(lhome, 'ComfyUI')
    touch(path.join(comfy, 'main.py'))
    touch(path.join(comfy, 'venv', 'bin', 'python'))
    const lfound = findLaunchers({ platform: 'linux', home: lhome })
    assert.ok(lfound.length === 1 && lfound[0].path === path.join(comfy, 'main.py'), 'a ComfyUI checkout in the home folder is found by its main.py')
    touch(path.join(comfy, 'run_cpu.sh'))
    touch(path.join(comfy, 'start_gpu.sh'))
    const lin = launchersIn(comfy, 'linux').map((f) => f.label)
    assert.ok(lin[0] === 'start_gpu.sh' && lin[1] === 'run_cpu.sh' && lin[2] === 'main.py', 'GPU script, then CPU script, then main.py')
    const [cmd, args] = linuxCommand(path.join(comfy, 'main.py'))
    assert.ok(cmd === path.join(comfy, 'venv', 'bin', 'python') && args[0] === path.join(comfy, 'main.py'), 'main.py runs with the folder’s venv Python')
    assert.ok(linuxCommand(path.join(lhome, 'x', 'main.py'))[0] === 'python3' && linuxCommand(path.join(comfy, 'start_gpu.sh'))[0] === 'bash', 'python3 without a venv, bash for a script')
    assert.throws(() => launch(path.join(comfy, 'venv', 'bin', 'python'), { platform: 'linux' }), 'something that isn’t a script or main.py is refused')
  })
})
