// Voice setup on a Mac says voices come in a later release and downloads nothing; elsewhere it runs as before.
//   node --test test/unit/voice-mac.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'
import { VoiceEngine } from '../../src/service/voiceengine.js'
import { Voices } from '../../src/service/voices.js'

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'iv-voice-'))
const touch = (file) => (fs.mkdirSync(path.dirname(file), { recursive: true }), fs.writeFileSync(file, '', { mode: 0o755 }), file)

const make = (platform) => {
  const e = new VoiceEngine({ dataDir: dir(), resourcesDir: dir(), onLog: () => {}, platform })
  let calls = 0
  e.cloud = { ensureUv: async () => calls++, uvEnv: () => ({}), exec: async () => calls++, uvExe: 'uv' }
  e.runScript = async () => calls++
  return { e, calls: () => calls }
}

describe('voice setup', () => {
  test('darwin: says voices come later and downloads nothing', async () => {
    const { e, calls } = make('darwin')
    assert.match(e.status().unavailable, /later release/)
    await assert.rejects(() => e.install(), /Voices on Mac come in a later release/)
    assert.equal(calls(), 0)
    assert.equal(e.installing, null)
  })
  test('on linux and win32 setup runs as before', async (t) => {
    for (const p of ['linux', 'win32']) {
      await t.test(`${p}: setup runs as before`, async () => {
        const { e, calls } = make(p)
        assert.equal(e.status().unavailable, undefined)
        touch(path.join(e.venv, 'bin', 'python'))
        touch(path.join(e.venv, 'Scripts', 'python.exe'))
        await e.install()
        assert.equal(calls(), 3)
      })
    }
  })
  test('the window sees the reason through the voices status', () => {
    assert.match(Voices.prototype.status.call({ engine: make('darwin').e }).unavailable, /later release/)
  })
  test('the voices page shows it', () => {
    assert.match(fs.readFileSync('src/renderer/src/components/Voices.jsx', 'utf8'), /status\.unavailable/)
  })
})
