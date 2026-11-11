// The Modal account (src/service/cloud.js): signed in only when Modal's own token check names a workspace, and
// signing out takes out just the active profile.
import assert from 'node:assert/strict'
import { workspaceOf, withoutActiveProfile, Cloud, IMAGE_BUILDER, MODAL_VERSION, clientVersionIn } from '../src/service/cloud.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let n = 0
const ok = (name, fn) => (fn(), n++, console.log('ok ', name))

ok('the workspace comes from `modal token info`, and nothing else counts as signed in', () => {
  assert.equal(workspaceOf('Token: ak-x\nWorkspace: matt-37887 (ac-abc)\nUser: matt-37887 (us-x)\n'), 'matt-37887')
  assert.equal(workspaceOf('Token: ak-x\r\nWorkspace: team-a (ac-1)\r\n'), 'team-a')
  // what `modal profile current` says with no token at all, and Modal's error box
  assert.equal(workspaceOf('default'), null)
  assert.equal(workspaceOf('| Token missing. Could not authenticate client. |'), null)
  assert.equal(workspaceOf(''), null)
})

ok('signing out removes the active profile and keeps the others', () => {
  const two = '[me]\ntoken_id = "a"\ntoken_secret = "b"\nactive = true\n\n[other]\ntoken_id = "c"\ntoken_secret = "d"\n'
  const r = withoutActiveProfile(two)
  assert.equal(r.removed, 'me')
  assert.ok(!r.text.includes('token_id = "a"') && r.text.includes('[other]') && r.text.includes('token_secret = "d"'))
  assert.equal(withoutActiveProfile('[solo]\ntoken_id = "a"\ntoken_secret = "b"\n').removed, 'solo')
  // two profiles and none marked active: nothing is guessed
  assert.deepEqual(withoutActiveProfile('[a]\nx = 1\n[b]\ny = 2\n'), { text: '[a]\nx = 1\n[b]\ny = 2\n', removed: null })
  const crlf = withoutActiveProfile('[x]\r\nactive = true\r\n[y]\r\nz = 1\r\n')
  assert.equal(crlf.removed, 'x')
  assert.ok(crlf.text.startsWith('[y]\r\n'))
})

// every Modal command asks for the image builder IV Studio is tested with; other programs don't get it
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ivm-'))
const cloud = new Cloud({ dataDir: dir, resourcesDir: dir })
const show = ['-e', 'process.stdout.write(process.env.MODAL_IMAGE_BUILDER_VERSION || "none")']
Object.defineProperty(cloud, 'modalExe', { get: () => process.execPath, configurable: true })
assert.equal(await cloud.exec(process.execPath, show, { quiet: true }), IMAGE_BUILDER)
assert.equal(IMAGE_BUILDER, '2025.06')
Object.defineProperty(cloud, 'modalExe', { get: () => 'not-node', configurable: true })
assert.equal(await cloud.exec(process.execPath, show, { quiet: true }), 'none')
fs.rmSync(dir, { recursive: true, force: true })
n++
console.log('ok  Modal commands ask for image builder', IMAGE_BUILDER)

// an install from an older IV Studio: its client version is read from its files and it's updated once, before
// commands that build or run, never before quick questions
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ivm-'))
  const cloud = new Cloud({ dataDir: dir, resourcesDir: dir })
  assert.equal(cloud.toolkitVersion(), null)
  assert.equal(cloud.toolkitReady(), false)
  if (process.platform !== 'win32') fs.mkdirSync(path.join(dir, 'cloud', 'venv', 'lib', 'python3.12', 'site-packages'), { recursive: true })
  const site = cloud.sitePackages()
  fs.mkdirSync(path.dirname(cloud.modalExe), { recursive: true })
  fs.writeFileSync(cloud.modalExe, '')
  fs.mkdirSync(path.join(site, 'modal-1.6.1.dist-info'), { recursive: true })
  fs.mkdirSync(path.join(site, 'modal_proto'), { recursive: true })
  assert.equal(cloud.toolkitVersion(), '1.6.1')
  assert.equal(cloud.toolkitReady(), true)
  assert.equal(cloud.toolkitCurrent(), false)
  let installs = 0
  cloud.installToolkit = async () => {
    installs++
    await new Promise((r) => setTimeout(r, 30))
    fs.renameSync(path.join(site, 'modal-1.6.1.dist-info'), path.join(site, `modal-${MODAL_VERSION}.dist-info`))
    return true
  }
  const ran = []
  cloud.exec = async (cmd, args) => (ran.push(args[0]), '')
  await cloud.modal(['token', 'info'], { quick: true })
  assert.equal(installs, 0, 'a quick question uses the installed client')
  await Promise.all([cloud.modal(['deploy', 'x']), cloud.modal(['run', 'y'])])
  assert.equal(installs, 1, 'two commands at once update it once')
  assert.equal(cloud.toolkitCurrent(), true)
  await cloud.modal(['deploy', 'x'])
  assert.equal(installs, 1, 'a current client is left alone')
  assert.deepEqual(ran, ['token', 'deploy', 'run', 'deploy'])
  assert.equal(clientVersionIn(path.join(dir, 'nowhere')), null)
  fs.rmSync(dir, { recursive: true, force: true })
  n++
  console.log('ok  an older Modal client is updated once, before commands that build or run')
}

// Shut down GPU answers Modal's "Are you sure?" itself: modal 1.6 aborts without a terminal otherwise
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ivm-'))
  const cloud = new Cloud({ dataDir: dir, resourcesDir: dir })
  const ran = []
  cloud.exec = async (cmd, args) => {
    ran.push(args)
    return args[0] === 'container' && args[1] === 'list' ? JSON.stringify([{ container_id: 'ta-1', app_name: 'iv-studio', start_time: 1 }, { container_id: 'ta-2', app_name: 'other-app', start_time: 1 }]) : ''
  }
  assert.deepEqual(await cloud.stopGpu(), { stopped: 1 })
  assert.deepEqual(ran.at(-1), ['container', 'stop', 'ta-1', '--yes'], 'stops only IV Studio’s container, without a prompt')
  fs.rmSync(dir, { recursive: true, force: true })
  n++
  console.log('ok  Shut down GPU stops the container without Modal asking first')
}

console.log(`\n${n} passed`)
