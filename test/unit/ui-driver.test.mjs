// The page-tier driver's pure parts (test/ui/driver.mjs): the build check, Electron's environment, the proxy flags
// and the guard-marker wait. No window opens here; the window is `npm run test:ui`.
//   npm run test:unit
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { checkBuild, electronEnv, proxyArgs, waitForMarker } from '../ui/driver.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const policy = JSON.parse(fs.readFileSync(path.join(here, '../fakes/env-policy.json'), 'utf8'))
const temp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'iv-driver-')))

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
