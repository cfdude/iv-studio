// A RunPod pod is never started without a token (it would be open to anyone): runpod.js, index.js, gate.py.
//   node --test test/unit/runpod-token.test.mjs
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { describe, test } from 'node:test'
import { RunPod } from '../../src/service/runpod.js'

const volume = { id: 'vol1', dataCenter: 'US-NC-1' }
const make = () => {
  const calls = []
  const fetchImpl = async (url) => (calls.push(url), { ok: true, status: 200, json: async () => ({}), text: async () => '{}' })
  const rp = new RunPod({ resourcesDir: 'resources', key: () => 'k', fetchImpl })
  rp.bundle = () => 'stub-bundle' // the real one runs `tar`, which the test guard refuses
  return { calls, rp }
}

describe('RunPod token', () => {
  test('podBody and createPod refuse a missing, empty or non-string token with no network call', async (t) => {
    for (const token of [null, undefined, '', 42]) {
      await t.test(`podBody and createPod refuse ${JSON.stringify(token)} with no network call`, async () => {
        const { rp, calls } = make()
        assert.throws(() => rp.podBody({ gpu: 'NVIDIA L40S', volume, token, idleSeconds: 300 }), /access token/)
        await assert.rejects(rp.createPod({ gpu: 'NVIDIA L40S', volume, token, idleSeconds: 300 }), /access token/)
        assert.equal(calls.length, 0)
      })
    }
  })
  test('a real token still builds the pod body', () => {
    const { rp } = make()
    assert.equal(rp.podBody({ gpu: 'NVIDIA L40S', volume, token: 'tok', idleSeconds: 300 }).env.IV_TOKEN, 'tok')
  })
  test('wakeRunpod checks the token before any pod lookup or createPod (source check)', () => {
    const src = fs.readFileSync('src/main/index.js', 'utf8')
    const body = src.slice(src.indexOf('const wakeRunpod = () =>'), src.indexOf('runpodWake = async'))
    const check = body.search(/if \(!runpodToken\(\)\) throw new Error\(/)
    assert.ok(check > 0, 'wakeRunpod has a token check')
    for (const later of ['runpod.health(', 'runpod.pods(', 'runpod.createPod(']) assert.ok(check < body.indexOf(later), `check comes before ${later}`)
  })
})

// Runs the real gate.py with aiohttp stubbed (this machine and CI have no aiohttp); only its token logic is exercised.
const py = spawnSync('python3', ['--version'])
const runGate = (env, code) =>
  spawnSync(
    'python3',
    [
      '-I',
      '-c',
      `
import sys, types, importlib.util
a = types.ModuleType('aiohttp'); a.WSMsgType = types.SimpleNamespace(TEXT=1); a.web = types.SimpleNamespace(); sys.modules['aiohttp'] = a
spec = importlib.util.spec_from_file_location('gate', 'resources/cloud/gate.py'); g = importlib.util.module_from_spec(spec)
${code}`
    ],
    { env: { PATH: process.env.PATH, ...env }, encoding: 'utf8' }
  )

describe('gate.py token', { skip: py.status !== 0 && 'python3 not available' }, () => {
  test('refuses to start with an empty or missing IV_TOKEN', () => {
    for (const env of [{ IV_TOKEN: '' }, {}]) {
      const r = runGate(env, 'spec.loader.exec_module(g)')
      assert.notEqual(r.status, 0)
      assert.match(r.stderr, /IV_TOKEN is empty/)
    }
  })
  test('allowed() is false for an empty token and a wrong one, true for the right one', () => {
    const r = runGate(
      { IV_TOKEN: 'secret' },
      `spec.loader.exec_module(g)
R = lambda h, q=None: types.SimpleNamespace(headers=h, query=q or {})
assert g.allowed(R({'Authorization': 'Bearer secret'}))
assert not g.allowed(R({}))
assert not g.allowed(R({'Authorization': 'Bearer nope'}))
g.TOKEN = ''
assert not g.allowed(R({}))
assert not g.allowed(R({'Authorization': 'Bearer '}))
print('ok')`
    )
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /ok/)
  })
})
