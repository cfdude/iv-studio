// How a scan is worded: the startup disk, volumes, drive letters, and the summary Settings keeps.
//   node --test test/unit/hwsummary.test.mjs
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { recommend } from '../../src/service/hardware.js'
import { autoRecheckOnce, driveName, gbs, resetAutoRecheck, SUMMARY_VERSION, summaryForDisplay, summaryOf, summaryStale } from '../../src/service/hwsummary.js'

const GB = 1024 ** 3

describe('driveName', () => {
  test('"/" is the startup disk, a volume is its name, a drive letter loses its slash', () => {
    assert.equal(driveName('/'), 'the startup disk')
    assert.equal(driveName('/Volumes/Media'), 'Media')
    assert.equal(driveName('/Volumes/Media/'), 'Media')
    assert.equal(driveName('C:\\'), 'C:')
    assert.equal(driveName('/mnt/data'), '/mnt/data')
  })
  test('the Free space line of a Mac scan never says "free on /"', () => {
    const scan = {
      os: { platform: 'darwin', arch: 'arm64' },
      cpu: { model: 'Apple M5 Max', threads: 18 },
      ram: 128 * GB,
      gpus: [{ vendor: 'apple', name: 'Apple M5 Max', vram: null, driver: null }],
      drives: [{ path: '/', total: 2000 * GB, free: 900 * GB }],
      modelsDrive: { path: '/', total: 2000 * GB, free: 900 * GB, folder: '/ComfyUI/models' },
      installs: { modelSizes: {}, modelsPresent: [] }
    }
    const disk = recommend(scan).verdicts.find((v) => v.id === 'disk')
    assert.match(disk.value, /free on the startup disk$/)
    const noComfy = recommend({ ...scan, modelsDrive: null }).verdicts.find((v) => v.id === 'disk')
    assert.ok(!/ on \/[ ,]/.test(`${noComfy.value} ${noComfy.say}`), `${noComfy.value} ${noComfy.say}`)
  })
})

describe('summaryOf', () => {
  test('keeps what the card shows', () => {
    const d = { scan: { at: '2026-11-12T00:00:00Z', gpus: [{ name: 'Apple M5 Max', vram: 0 }], ram: 128 * GB, cpu: { model: 'Apple M5 Max' } }, rec: { tier: { id: 'all', title: 'Everything' }, training: { localReady: true } } }
    assert.deepEqual(summaryOf(d), { v: SUMMARY_VERSION, at: '2026-11-12T00:00:00Z', tier: 'all', title: 'Everything', gpu: 'Apple M5 Max', ram: gbs(128 * GB), cpu: 'Apple M5 Max', canTrain: true })
    assert.equal(summaryOf(null), null)
  })
})

describe('a summary an older build stored (Settings → Your computer)', () => {
  const OLD = { at: '2026-11-12T00:00:00Z', tier: 'cloud', title: 'Everything in the cloud', gpu: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M5 Max, Unspecified Version) · 128 GB', ram: '128 GB', cpu: 'Apple M5 Max', canTrain: false }
  test('shows the card\'s own name, keeping the memory that follows it', () => {
    assert.equal(summaryForDisplay(OLD).gpu, 'Apple M5 Max · 128 GB')
    assert.equal(summaryForDisplay({ ...OLD, gpu: 'NVIDIA GeForce RTX 4090 · 24 GB' }).gpu, 'NVIDIA GeForce RTX 4090 · 24 GB')
    assert.equal(summaryForDisplay(null), null)
  })
  test('is stale: it checks the computer again by itself', () => {
    assert.equal(summaryStale(OLD), true)
    assert.equal(summaryStale({ ...OLD, gpu: 'Apple M5 Max · 128 GB' }), true, 'no stamp')
    assert.equal(summaryStale({ ...OLD, v: SUMMARY_VERSION, gpu: 'ANGLE (Apple, x)' }), true, 'raw name even when stamped')
    assert.equal(summaryStale(null), false)
  })
  test('a new record is stamped and is not stale, even a Mac that really is cloud-only', () => {
    const d = { scan: { at: 'x', gpus: [{ name: 'Apple M2', vram: 0 }], ram: 8 * GB, cpu: { model: 'Apple M2' } }, rec: { tier: { id: 'cloud', title: 'T' }, training: {} } }
    const s = summaryOf(d)
    assert.equal(s.v, SUMMARY_VERSION)
    assert.equal(summaryStale(s), false)
  })
})

describe('autoRecheckOnce', () => {
  test('runs once per session however often Settings opens, and a failure is silent', async () => {
    resetAutoRecheck()
    let runs = 0
    const failing = async () => {
      runs++
      throw new Error('scan failed')
    }
    assert.equal(autoRecheckOnce(false, failing), false)
    assert.equal(autoRecheckOnce(true, failing), true)
    assert.equal(autoRecheckOnce(true, failing), false)
    assert.equal(autoRecheckOnce(true, failing), false)
    await new Promise((r) => setImmediate(r))
    assert.equal(runs, 1)
  })
})
