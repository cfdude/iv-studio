// A ComfyUI that is already starting isn't started twice (Matt: closing IV Studio while it booted ComfyUI and
// reopening it started another). comfylauncher.js: comfyProcesses (stood in), sameComfy and the launch note.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { comfyProcesses, noteLaunch, portOf, recentLaunch, sameComfy, LAUNCH_GRACE_MS } from '../src/service/comfylauncher.js'

let n = 0
const ok = async (name, fn) => (await fn(), n++, console.log('ok ', name))

const portable = { pid: 1, exe: 'F:\\ComfyUI-cu130\\python_embeded\\python.exe', cmd: '.\\python_embeded\\python.exe  -s ComfyUI\\main.py --windows-standalone-build --reserve-vram 4' }
const other = { pid: 2, exe: 'D:\\ComfyUI_windows_portable\\python_embeded\\python.exe', cmd: '.\\python_embeded\\python.exe -s ComfyUI\\main.py --port 8189' }
const desktopApp = { pid: 3, exe: 'C:\\Users\\a\\AppData\\Local\\Programs\\@comfyorgcomfyui-electron\\ComfyUI.exe', cmd: '"C:\\Users\\a\\AppData\\Local\\Programs\\@comfyorgcomfyui-electron\\ComfyUI.exe"' }
const linux = { pid: 4, exe: '/home/a/ComfyUI/venv/bin/python', cmd: '/home/a/ComfyUI/venv/bin/python /home/a/ComfyUI/main.py --listen 127.0.0.1' }
const unrelated = { pid: 5, exe: 'C:\\Python312\\python.exe', cmd: 'python C:\\work\\website\\main.py' }

await ok('the port a ComfyUI listens on', () => {
  assert.equal(portOf(portable.cmd), 8188)
  assert.equal(portOf(other.cmd), 8189)
  assert.equal(portOf('main.py --port=8000'), 8000)
})

await ok('this install’s ComfyUI on this port is found; others are not', () => {
  const procs = [unrelated, other, portable, desktopApp, linux]
  assert.equal(sameComfy(procs, { home: 'F:\\ComfyUI-cu130', url: 'http://127.0.0.1:8188' })?.pid, 1, 'the portable install, by its folder')
  assert.equal(sameComfy(procs, { home: 'F:\\ComfyUI-cu130\\', url: 'http://localhost:8188' })?.pid, 1, 'a trailing slash or localhost')
  assert.equal(sameComfy(procs, { home: 'F:\\ComfyUI-cu130', url: 'http://127.0.0.1:8000' }), null, 'a different port is another ComfyUI')
  assert.equal(sameComfy(procs, { home: 'D:\\ComfyUI_windows_portable', url: 'http://127.0.0.1:8188' })?.pid, 1, 'a ComfyUI already on this port counts, whichever install (two can’t share a port)')
  assert.equal(sameComfy([other], { home: 'F:\\ComfyUI-cu130', url: 'http://127.0.0.1:8188' }), null, 'the other install listens on 8189')
  const relative = { pid: 6, exe: 'C:\\Python312\\python.exe', cmd: 'python ComfyUI\\main.py --port 8299' }
  assert.equal(sameComfy([relative], { home: 'E:\\Comfy', url: 'http://127.0.0.1:8299' })?.pid, 6, 'the system Python with a relative main.py')
  assert.equal(sameComfy(procs, { home: 'D:\\ComfyUI_windows_portable', url: 'http://127.0.0.1:8189' })?.pid, 2)
  assert.equal(sameComfy(procs, { home: '/home/a/ComfyUI', url: 'http://127.0.0.1:8188' })?.pid, 4, 'a Linux checkout with its venv')
  assert.equal(sameComfy([unrelated], { url: 'http://127.0.0.1:8188' }), null, 'someone else’s main.py is not ComfyUI')
  assert.equal(sameComfy([desktopApp], { launcher: 'C:\\Users\\a\\AppData\\Local\\Programs\\@comfyorgcomfyui-electron\\ComfyUI.exe', url: 'http://127.0.0.1:8000' })?.pid, 3, 'the Desktop app')
  assert.equal(sameComfy([desktopApp], { home: 'F:\\ComfyUI-cu130', url: 'http://127.0.0.1:8188' }), null, 'the Desktop app is not a portable install')
  assert.equal(sameComfy([], { home: 'F:\\ComfyUI-cu130' }), null)
})

await ok('listing processes on Windows, Mac and Linux, and when it fails', async () => {
  const win = await comfyProcesses({ platform: 'win32', run: async () => JSON.stringify({ ProcessId: 9, ExecutablePath: portable.exe, CommandLine: portable.cmd }) })
  assert.deepEqual(win, [{ pid: 9, exe: portable.exe, cmd: portable.cmd }], 'one process comes back as an object, not a list')
  const two = await comfyProcesses({ platform: 'win32', run: async () => JSON.stringify([{ ProcessId: 1, ExecutablePath: null, CommandLine: null }, { ProcessId: 2, ExecutablePath: 'x', CommandLine: 'y main.py' }]) })
  assert.equal(two.length, 2)
  assert.deepEqual(await comfyProcesses({ platform: 'win32', run: async () => '' }), [])
  const ps = await comfyProcesses({ platform: 'linux', run: async () => ` 4 ${linux.cmd}\n 77 /usr/bin/bash\n 80 /Applications/ComfyUI.app/Contents/MacOS/ComfyUI\n` })
  assert.deepEqual(ps.map((p) => p.pid), [4, 80])
  assert.deepEqual(await comfyProcesses({ platform: 'win32', run: async () => Promise.reject(new Error('no powershell')) }), [], 'can’t tell: start as before')
})

await ok('a launch a moment ago counts as starting', () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ivstart-')), 'comfy-launch.json')
  assert.equal(recentLaunch(f), null, 'never launched')
  noteLaunch(f, 'C:\\ComfyUI\\run_nvidia_gpu.bat', 1_000_000)
  assert.equal(recentLaunch(f, 1_000_000 + 5_000), 1_000_000)
  assert.equal(recentLaunch(f, 1_000_000 + LAUNCH_GRACE_MS + 1), null, 'long ago: look at the processes instead')
  fs.writeFileSync(f, 'not json')
  assert.equal(recentLaunch(f), null)
})

console.log(`\n${n} passed`)
