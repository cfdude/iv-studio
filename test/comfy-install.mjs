// Get ComfyUI for me (src/service/comfyinstall.js): the right official build for the graphics card, a sensible
// folder, the space check, and a download that resumes and is refused when its checksum is wrong. (Unpacking with
// Windows' tar and starting the build were tried for real on the 4090: see Downloads AGENTS.md.)
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { ComfyInstaller, checkFolder, pickBuild, suggestFolder } from '../src/service/comfyinstall.js'

let n = 0
const ok = async (name, fn) => (await fn(), n++, console.log('ok ', name))
const win = { platform: 'win32' }

await ok('the build follows the graphics card and its driver', () => {
  const b = pickBuild({ os: win, gpus: [{ vendor: 'nvidia', name: 'RTX 4090', vram: 24e9, driver: '621.01', computeCap: 8.9 }] })
  assert.equal(b.ok, true)
  assert.equal(b.asset, 'ComfyUI_windows_portable_nvidia.7z')
  assert.equal(b.warn, null)
  const oldDriver = pickBuild({ os: win, gpus: [{ vendor: 'nvidia', name: 'RTX 3060', driver: '551.86', computeCap: 8.6 }] })
  assert.match(oldDriver.warn, /needs 580 or newer/)
  const pascal = pickBuild({ os: win, gpus: [{ vendor: 'nvidia', name: 'GTX 1080', driver: '551.86', computeCap: 6.1 }] })
  assert.equal(pascal.asset, 'ComfyUI_windows_portable_nvidia_cu126.7z')
  assert.equal(pascal.warn, null, 'the CUDA 12.6 build runs on that driver')
  const amd = pickBuild({ os: win, gpus: [{ vendor: 'amd', name: 'Radeon RX 7900' }] })
  assert.equal(amd.ok, false)
  assert.match(amd.reason, /NVIDIA/)
  assert.equal(pickBuild({ os: { platform: 'darwin' }, gpus: [] }).ok, false)
})

await ok('a roomy, empty folder, and the space check', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ivci-'))
  const drives = [{ path: dir, free: 500e9 }, { path: 'Z:\\', free: 10e9 }]
  assert.equal(suggestFolder(drives), path.join(dir, 'ComfyUI'))
  fs.mkdirSync(path.join(dir, 'ComfyUI'))
  fs.writeFileSync(path.join(dir, 'ComfyUI', 'main.py'), '')
  assert.equal(suggestFolder(drives), path.join(dir, 'IV Studio ComfyUI'), 'a folder already in use is passed over')
  assert.match(checkFolder(path.join(dir, 'ComfyUI'), {}), /isn’t empty/)
  assert.equal(checkFolder(path.join(dir, 'new'), { size: 2e9, freeOf: () => 100e9 }), null)
  assert.match(checkFolder(path.join(dir, 'new'), { size: 2e9, freeOf: () => 3e9 }), /needs about/)
  assert.match(checkFolder('relative\\path', {}), /Pick a folder/)
  fs.rmSync(dir, { recursive: true, force: true })
})

await ok('the download resumes, and a wrong checksum is refused', async () => {
  const body = Buffer.alloc(3 * 1024 * 1024, 7)
  const sum = createHash('sha256').update(body).digest('hex')
  let ranges = []
  const server = http.createServer((req, res) => {
    const m = /bytes=(\d+)-/.exec(req.headers.range || '')
    const from = m ? Number(m[1]) : 0
    ranges.push(from)
    res.writeHead(m ? 206 : 200, { 'Content-Length': body.length - from })
    res.end(body.subarray(from))
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${server.address().port}/ComfyUI_windows_portable_nvidia.7z`
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ivci-'))
  const asset = { name: 'ComfyUI_windows_portable_nvidia.7z', url, size: body.length, sha256: sum, version: 'v0.0.1' }
  // a third of it already there from an earlier try
  fs.writeFileSync(path.join(dir, `${asset.name}.part`), body.subarray(0, 1024 * 1024))
  const seen = []
  const inst = new ComfyInstaller({ onProgress: (s) => seen.push(s.phase) })
  await inst.download(asset, path.join(dir, asset.name))
  assert.deepEqual(ranges, [1024 * 1024], 'it asked for the rest only')
  assert.ok(fs.readFileSync(path.join(dir, asset.name)).equals(body))
  // a wrong checksum: refused and removed before anything is unpacked
  fs.rmSync(path.join(dir, asset.name))
  ranges = []
  const bad = new ComfyInstaller({ tar: 'not-run' })
  await assert.rejects(bad.install({ folder: dir, asset: { ...asset, sha256: '0'.repeat(64) } }), /checksum/)
  assert.equal(fs.existsSync(path.join(dir, asset.name)), false)
  server.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

console.log(`\n${n} passed`)
