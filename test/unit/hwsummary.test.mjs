// How a scan is worded: the startup disk, volumes, drive letters, and the summary Settings keeps.
//   node --test test/unit/hwsummary.test.mjs
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { recommend } from '../../src/service/hardware.js'
import { driveName, gbs, summaryOf } from '../../src/service/hwsummary.js'

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
    assert.deepEqual(summaryOf(d), { at: '2026-11-12T00:00:00Z', tier: 'all', title: 'Everything', gpu: 'Apple M5 Max', ram: gbs(128 * GB), cpu: 'Apple M5 Max', canTrain: true })
    assert.equal(summaryOf(null), null)
  })
})
