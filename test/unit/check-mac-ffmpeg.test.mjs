// The Mac build refuses to package FFmpeg that isn't a thin arm64 Mach-O executable. Fixture bytes only.
//   node --test test/unit/check-mac-ffmpeg.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'
import { checkBinaries, checkMachOHeader } from '../../scripts/check-mac-ffmpeg.mjs'

// 64-bit Mach-O, little endian: magic cffaedfe, then the cpu type.
const macho = (cpuBytes) => Buffer.from([0xcf, 0xfa, 0xed, 0xfe, ...cpuBytes, 0, 0, 0, 0, 2, 0, 0, 0])
const ARM64 = macho([0x0c, 0x00, 0x00, 0x01])
const X86_64 = macho([0x07, 0x00, 0x00, 0x01])

describe('checkMachOHeader', () => {
  test('arm64 passes', () => assert.deepEqual(checkMachOHeader(ARM64), { ok: true }))
  test('x86_64 fails and says so', () => {
    const r = checkMachOHeader(X86_64)
    assert.equal(r.ok, false)
    assert.match(r.reason, /Intel|x86_64/)
  })
  test('a universal binary is not accepted', () => {
    const r = checkMachOHeader(Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0, 0, 0, 2]))
    assert.equal(r.ok, false)
  })
  test('a script, an ELF file and a tiny file fail', () => {
    assert.equal(checkMachOHeader(Buffer.from('#!/bin/sh\necho hi\n')).ok, false)
    assert.equal(checkMachOHeader(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0])).ok, false)
    assert.equal(checkMachOHeader(Buffer.from([0xcf, 0xfa])).ok, false)
  })
  test('a missing file (null) fails and says it is missing', () => {
    const r = checkMachOHeader(null)
    assert.equal(r.ok, false)
    assert.match(r.reason, /missing/i)
  })
})

describe('checkBinaries', () => {
  const withDir = (fn) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-ffmpeg-'))
    try {
      return fn(dir)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }

  test('both arm64 gives no problems', () =>
    withDir((dir) => {
      const ffmpeg = path.join(dir, 'ffmpeg')
      const ffprobe = path.join(dir, 'ffprobe')
      fs.writeFileSync(ffmpeg, ARM64)
      fs.writeFileSync(ffprobe, ARM64)
      assert.deepEqual(checkBinaries({ ffmpeg, ffprobe }), [])
    }))

  test('a missing ffprobe and an Intel ffmpeg are each named', () =>
    withDir((dir) => {
      const ffmpeg = path.join(dir, 'ffmpeg')
      fs.writeFileSync(ffmpeg, X86_64)
      const problems = checkBinaries({ ffmpeg, ffprobe: path.join(dir, 'ffprobe') })
      assert.equal(problems.length, 2)
      assert.match(problems[0], /ffmpeg/)
      assert.match(problems[1], /ffprobe.*missing/i)
    }))
})
