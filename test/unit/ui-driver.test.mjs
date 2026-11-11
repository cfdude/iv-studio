// The page-tier driver's pure parts (test/ui/driver.mjs): the build check, Electron's environment, the proxy flags
// and the guard-marker wait. No window opens here; the window is `npm run test:ui`.
//   npm run test:unit
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { ACCEPTED_PREFS, appDataIn, checkBuild, electronEnv, prefsListing, proxyArgs, waitForMarker } from '../ui/driver.mjs'
import { tempDirReal } from '../fakes/tmp.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const policy = JSON.parse(fs.readFileSync(path.join(here, '../fakes/env-policy.json'), 'utf8'))
const temp = () => tempDirReal('iv-driver-')

describe('page-tier driver: the build check', () => {
  const tree = (srcAge, outAge) => {
    const root = temp()
    fs.mkdirSync(path.join(root, 'src/main'), { recursive: true })
    fs.mkdirSync(path.join(root, 'out/main'), { recursive: true })
    const put = (rel, ageMs) => {
      const f = path.join(root, rel)
      fs.writeFileSync(f, 'x')
      const t = new Date(Date.now() - ageMs)
      fs.utimesSync(f, t, t)
    }
    put('src/main/old.js', 9000)
    put('src/main/index.js', srcAge)
    put('out/main/index.js', outAge)
    return root
  }

  test('a build older than src/ fails and names the newest changed file', () => {
    assert.throws(() => checkBuild(tree(1000, 5000)), /src\/main\/index\.js changed after out\/main\/index\.js was built/)
  })

  test('a build newer than src/ passes, and a missing build says to build', () => {
    assert.doesNotThrow(() => checkBuild(tree(5000, 1000)))
    assert.throws(() => checkBuild(temp()), /Run `npm run build` first/)
  })
})

describe('page-tier driver: what Electron is started with', () => {
  const shell = Object.fromEntries([...policy.remove.map((e) => [e.name, 'real-secret']), ...policy.pin.map((e) => [e.name, '/Users/real/place']), ['ELECTRON_RUN_AS_NODE', '1'], ['NODE_OPTIONS', '--inspect'], ['PATH', '/usr/bin']])
  const dirs = { home: '/tmp/iv/home', data: '/tmp/iv/data', userData: '/tmp/iv/ud', runDir: '/tmp/iv/run', ports: [4001, 4002] }

  test('every scrubbed key in the shell is gone, and the pinned ones point at temp', () => {
    const env = electronEnv(shell, dirs)
    for (const e of policy.remove) assert.ok(!(e.name in env), `${e.name} should be removed`)
    assert.ok(!('ELECTRON_RUN_AS_NODE' in env))
    for (const e of policy.pin) assert.ok(env[e.name].startsWith('/tmp/iv'), `${e.name} is ${env[e.name]}`)
    assert.equal(env.HOME, '/tmp/iv/home')
    assert.equal(env.IV_STUDIO_DATA, '/tmp/iv/data')
    assert.equal(env.IV_STUDIO_USER_DATA, '/tmp/iv/ud')
    assert.equal(env.PATH, '/usr/bin')
    assert.match(env.NODE_OPTIONS, /^--import=file:.*guard\.mjs$/)
    assert.equal(env.IV_TEST_ALLOW_PORTS, '4001,4002')
  })

  test('Chromium goes to a dead proxy except the registered ports, and loopback is not implicitly bypassed', () => {
    assert.deepEqual(proxyArgs(5555, [4001, 4002]), ['--proxy-server=127.0.0.1:5555', '--proxy-bypass-list=<-loopback>;127.0.0.1:4001;127.0.0.1:4002'])
  })
})

describe('page-tier driver: the guard marker', () => {
  test('a missing marker stops the run, saying the guard did not load', async () => {
    await assert.rejects(waitForMarker(temp(), { timeoutMs: 300 }), /guard did not load in Electron's main process/)
  })

  test('a marker from a plain Node process is not accepted, and one without the ready paths says the app never became ready', async () => {
    const node = temp()
    fs.writeFileSync(path.join(node, 'guard-loaded.json'), JSON.stringify({ processType: 'node', electron: false }))
    await assert.rejects(waitForMarker(node, { timeoutMs: 300 }), /wrong process/)
    const early = temp()
    fs.writeFileSync(path.join(early, 'guard-loaded.json'), JSON.stringify({ processType: 'browser', electron: true, paths: null }))
    await assert.rejects(waitForMarker(early, { timeoutMs: 300 }), /never became ready/)
  })
})

describe('page-tier driver: the real Electron preferences check', () => {
  const prefs = () => {
    const dir = temp()
    for (const f of ['com.github.Electron.plist', 'com.apple.finder.plist']) fs.writeFileSync(path.join(dir, f), 'x')
    return dir
  }
  const accepted = (dir) => path.join(dir, 'com.github.Electron.plist')

  test('the accepted file may change, and unrelated preferences files are not watched', () => {
    const dir = prefs()
    const was = prefsListing(dir, accepted(dir))
    fs.writeFileSync(accepted(dir), 'changed')
    fs.writeFileSync(path.join(dir, 'com.apple.finder.plist'), 'changed')
    assert.deepEqual(prefsListing(dir, accepted(dir)), was)
  })

  test('another Electron or IV Studio preferences file that appears or changes is seen', () => {
    const dir = prefs()
    const was = prefsListing(dir, accepted(dir))
    fs.writeFileSync(path.join(dir, 'com.github.Electron.helper.plist'), 'x')
    assert.notDeepEqual(prefsListing(dir, accepted(dir)), was)
    const f = path.join(dir, 'com.iv-studio.app.plist')
    fs.writeFileSync(f, 'x')
    const mid = prefsListing(dir, accepted(dir))
    assert.equal(mid.length, 2)
    const later = new Date(Date.now() + 5000)
    fs.utimesSync(f, later, later)
    assert.notDeepEqual(prefsListing(dir, accepted(dir)), mid)
  })

  test('app data in the accepted file is seen, its known window defaults are not', () => {
    assert.equal(appDataIn(Buffer.from('AppleTextDirection NSForceRightToLeftWritingDirection NSTreatUnknownArgumentsAsOpen SKPurchaseIntentUpdatesLastChecked')), false)
    for (const bad of ['comfyUrl', 'civitaiKey', 'cloudToken', '/Users/someone/Movies', 'IV Studio', 'iv-studio-data']) assert.equal(appDataIn(Buffer.from(bad)), true, bad)
  })

  test('the accepted file is the Electron defaults file in the real home', () => {
    assert.equal(path.basename(ACCEPTED_PREFS), 'com.github.Electron.plist')
    assert.match(ACCEPTED_PREFS, /Library\/Preferences\//)
  })
})

describe('page-tier driver: the evidence folder', () => {
  const driverUrl = new URL('../ui/driver.mjs', import.meta.url).href
  const evidenceFor = (env) =>
    execFileSync(process.execPath, ['--input-type=module', '-e', `import('${driverUrl}').then((m) => process.stdout.write(m.evidenceDir))`], {
      env: { ...process.env, IV_TEST_EVIDENCE_DIR: '', IV_TEST_RUN_ID: 'run-x', ...env },
      encoding: 'utf8'
    })

  test('with IV_TEST_EVIDENCE_DIR unset it is a folder under the OS temp folder, not a path in a checkout', () => {
    const dir = evidenceFor({})
    assert.equal(dir, path.join(os.tmpdir(), 'iv-studio-evidence', 'run-x'))
    assert.doesNotMatch(dir, /docs[\\/]backlog/)
  })

  test('IV_TEST_EVIDENCE_DIR picks the folder, with the run id inside it', () => {
    const where = path.join(os.tmpdir(), 'somewhere-durable')
    assert.equal(evidenceFor({ IV_TEST_EVIDENCE_DIR: where }), path.join(where, 'run-x'))
  })
})
