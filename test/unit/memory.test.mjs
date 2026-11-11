// The title bar's RAM figure on a Mac (src/service/memory.js): Activity Monitor's Memory Used from vm_stat.
//   node --test test/unit/memory.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { describe, test } from 'node:test'
import { parseVmStat, ramReadout } from '../../src/service/memory.js'
import { statsReadout } from '../../src/service/gpu.js'

const GB = 1024 ** 3
// real vm_stat from an M5 Max, 128 GB (16384-byte pages)
const FIXTURE = fs.readFileSync(new URL('../fixtures/vm_stat-darwin.txt', import.meta.url), 'utf8')

describe('parseVmStat', () => {
  test('counts app memory + wired + compressor, not inactive, purgeable or free pages', () => {
    const v = parseVmStat(FIXTURE)
    assert.equal(v.pageSize, 16384)
    const pages = (1231130 - 95062) + 517303 + 1229319
    assert.equal(v.used, pages * 16384)
    // the free-pages-only figure (what os.freemem() implied) would be far larger
    assert.ok(v.used < 60 * GB)
  })
  test('reads the page size from the header', () => {
    const t = FIXTURE.replace('16384', '4096')
    assert.equal(parseVmStat(t).pageSize, 4096)
  })
  test('junk, empty and missing counters are null', () => {
    assert.equal(parseVmStat(''), null)
    assert.equal(parseVmStat(null), null)
    assert.equal(parseVmStat('nothing useful'), null)
    assert.equal(parseVmStat(FIXTURE.replace(/^Pages wired down.*$/m, '')), null)
  })
  test('purgeable above anonymous never goes negative', () => {
    const t = FIXTURE.replace(/^Pages purgeable:.*$/m, 'Pages purgeable: 99999999.')
    assert.equal(parseVmStat(t).used, (517303 + 1229319) * 16384)
  })
})

describe('ramReadout', () => {
  test('darwin uses vm_stat, so cached memory is not counted as used', async () => {
    const total = 128 * GB
    const r = await ramReadout({ platform: 'darwin', total, free: 7 * GB, read: async () => FIXTURE })
    assert.equal(r.total, total)
    assert.equal(total - r.free, parseVmStat(FIXTURE).used)
  })
  test('darwin falls back to os.freemem when vm_stat fails or is unreadable', async () => {
    assert.deepEqual(await ramReadout({ platform: 'darwin', total: 10, free: 3, read: async () => null }), { total: 10, free: 3 })
    assert.deepEqual(await ramReadout({ platform: 'darwin', total: 10, free: 3, read: async () => { throw new Error('x') } }), { total: 10, free: 3 })
    assert.deepEqual(await ramReadout({ platform: 'darwin', total: 10, free: 3, read: async () => 'garbage' }), { total: 10, free: 3 })
  })
  test('windows and linux keep os.freemem and never run vm_stat', async () => {
    for (const platform of ['win32', 'linux']) {
      const read = async () => assert.fail('vm_stat must not run')
      assert.deepEqual(await ramReadout({ platform, total: 16, free: 5, read }), { total: 16, free: 5 })
    }
  })
  test('used is capped at the total', async () => {
    const r = await ramReadout({ platform: 'darwin', total: GB, free: 0, read: async () => FIXTURE })
    assert.equal(r.free, 0)
  })
})

describe('Apple GPU readout', () => {
  const mps = { name: 'mps', type: 'mps', vram_total: 128 * GB, vram_free: 31 * GB, torch_vram_total: 27 * GB }
  test('on an Apple GPU the unified memory figure replaces the overstated free number', () => {
    const r = statsReadout({ devices: [mps] }, { total: 128 * GB, free: 70 * GB })
    assert.equal(r.gpu.total, 128 * GB)
    assert.equal(r.gpu.free, 70 * GB)
    assert.equal(r.gpu.comfyHeld, 27 * GB)
  })
  test('a cuda card keeps its own numbers, and no override changes nothing', () => {
    const cuda = { name: 'cuda:0 RTX', type: 'cuda', vram_total: 24 * GB, vram_free: 22 * GB, torch_vram_total: 2 * GB }
    assert.equal(statsReadout({ devices: [cuda] }, { total: 128 * GB, free: 70 * GB }).gpu.free, 22 * GB)
    assert.equal(statsReadout({ devices: [mps] }).gpu.free, 31 * GB)
  })
})
