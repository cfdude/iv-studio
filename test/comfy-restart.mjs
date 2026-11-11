// Restart ComfyUI (Setup and Settings): what gets stopped, and waiting for ComfyUI to go away.
// comfylauncher.js stopTarget, stopComfy (with a stand-in for PowerShell and taskkill) and waitDown.
import assert from 'node:assert/strict'
import { stopComfy, stopTarget, waitDown } from '../src/service/comfylauncher.js'

let n = 0
const ok = async (name, fn) => (await fn(), n++, console.log('ok ', name))
const py = { pid: 10, exe: 'F:\ComfyUI\python_embeded\python.exe', cmd: '.\python_embeded\python.exe -s ComfyUI\main.py' }

await ok('a portable ComfyUI goes with the console of its .bat; anything else alone', () => {
  assert.equal(stopTarget(py, { pid: 9, name: 'cmd.exe', cmd: 'C:\Windows\system32\cmd.exe /c ""F:\ComfyUI\run_nvidia_gpu.bat""' }, 'win32'), 9)
  assert.equal(stopTarget(py, { pid: 9, name: 'explorer.exe', cmd: 'explorer' }, 'win32'), 10, 'never Explorer')
  assert.equal(stopTarget(py, { pid: 9, name: 'cmd.exe', cmd: 'cmd.exe /k' }, 'win32'), 10, 'a cmd window that is not its .bat')
  assert.equal(stopTarget(py, null, 'win32'), 10)
  assert.equal(stopTarget(py, { pid: 9, name: 'cmd.exe', cmd: 'x.bat' }, 'linux'), 10)
  assert.equal(stopTarget({}, null), null)
})

await ok('stopping asks for the parent, then ends the right tree', async () => {
  const calls = []
  const run = async (cmd, args) => {
    calls.push([cmd, ...args])
    if (cmd === 'powershell.exe') return JSON.stringify({ ProcessId: 9, Name: 'cmd.exe', CommandLine: 'cmd /c "F:\ComfyUI\run_nvidia_gpu.bat"' })
    return ''
  }
  const r = await stopComfy(py, { platform: 'win32', run })
  assert.deepEqual(r, { pid: 9, console: true })
  assert.deepEqual(calls.at(-1), ['taskkill', '/PID', '9', '/T', '/F'])
  await assert.rejects(stopComfy(null, { platform: 'win32', run }), /No ComfyUI/)
})

await ok('waiting until nothing answers', async () => {
  let k = 0
  assert.equal(await waitDown('http://x', { every: 1, up: async () => ++k < 3 }), true)
  assert.equal(await waitDown('http://x', { every: 1, timeoutMs: 30, up: async () => true }), false, 'still up: gives up')
})

console.log(`\n${n} passed`)
