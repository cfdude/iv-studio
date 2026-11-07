// uv is picked by platform and processor, lazily, with its pinned checksum. No network.
//   node --test test/unit/cloud-uv.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'
import { Cloud, UV_BUILDS, UV_VERSION, uvBuildFor } from '../../src/service/cloud.js'

describe('uvBuildFor', () => {
  test('darwin arm64 gets the aarch64 apple build, shaped like the linux one', () => {
    const b = uvBuildFor('darwin', 'arm64')
    assert.ok(b.url.endsWith(`/${UV_VERSION}/uv-aarch64-apple-darwin.tar.gz`))
    assert.match(b.sha256, /^[0-9a-f]{64}$/)
    assert.equal(b.file, 'uv.tar.gz')
    assert.equal(b.strip, 1)
  })

  test('windows and linux x64 are unchanged', () => {
    const w = uvBuildFor('win32', 'x64')
    assert.match(w.url, /uv-x86_64-pc-windows-msvc\.zip$/)
    assert.equal(w.sha256, '088962f9e7b7bd9ea740c04c650b2a21c8928c345bd99ac24350dc924dba656c')
    assert.equal(w.file, 'uv.zip')
    assert.equal(w.strip, undefined)
    const l = uvBuildFor('linux', 'x64')
    assert.match(l.url, /uv-x86_64-unknown-linux-gnu\.tar\.gz$/)
    assert.equal(l.sha256, '1468ebd5a5541121837c5a2817b9972ba6090fa6caa3d142620850a47fb75154')
    assert.equal(l.strip, 1)
  })

  test('windows on arm keeps the x64 build it always used', () => {
    assert.deepEqual(uvBuildFor('win32', 'arm64'), uvBuildFor('win32', 'x64'))
  })

  test('every pinned build uses the one pinned version', () => {
    for (const b of Object.values(UV_BUILDS)) assert.ok(b.url.includes(`/${UV_VERSION}/`))
  })

  test('an unpinned platform throws a plain message naming it', () => {
    assert.throws(() => uvBuildFor('linux', 'arm64'), /linux-arm64/)
    assert.throws(() => uvBuildFor('darwin', 'x64'), /darwin-x64/)
  })
})

describe('Cloud.ensureUv', () => {
  test('stops before any download on an unpinned platform', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-uv-'))
    try {
      const cloud = new Cloud({ dataDir: dir, resourcesDir: dir, platform: 'linux', arch: 'arm64' })
      const realFetch = globalThis.fetch
      globalThis.fetch = () => assert.fail('must not download')
      try {
        await assert.rejects(() => cloud.ensureUv(), /linux-arm64/)
      } finally {
        globalThis.fetch = realFetch
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test('an already-installed uv is returned without choosing a build', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-uv-'))
    try {
      const cloud = new Cloud({ dataDir: dir, resourcesDir: dir, platform: 'linux', arch: 'arm64' })
      fs.mkdirSync(path.dirname(cloud.uvExe), { recursive: true })
      fs.writeFileSync(cloud.uvExe, '')
      assert.equal(await cloud.ensureUv(), cloud.uvExe)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
