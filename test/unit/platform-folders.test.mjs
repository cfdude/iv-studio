// Task 3.2: the data folder (paths.js dataDir) and the renders folder the MCP server uses, per platform.
//   node --test test/unit/platform-folders.test.mjs
import assert from 'node:assert/strict'
import path from 'node:path'
import { describe, test } from 'node:test'
import { dataDir } from '../../src/service/paths.js'
import * as plat from '../../src/service/platform.js'

describe('mcpVideosDir (src/mcp/server.js)', () => {
  test('darwin gives ~/Movies/IV Studio, ignoring USERPROFILE', () => {
    assert.equal(plat.mcpVideosDir({ platform: 'darwin', home: '/Users/me', env: { USERPROFILE: 'X' } }), path.join('/Users/me', 'Movies', 'IV Studio'))
  })
  test('win32 is unchanged: USERPROFILE, else home, plus Videos/IV Studio', () => {
    assert.equal(plat.mcpVideosDir({ platform: 'win32', home: 'H', env: { USERPROFILE: 'C:\\Users\\me' } }), path.join('C:\\Users\\me', 'Videos', 'IV Studio'))
    assert.equal(plat.mcpVideosDir({ platform: 'win32', home: 'H', env: {} }), path.join('H', 'Videos', 'IV Studio'))
  })
  test('linux is unchanged', () => {
    assert.equal(plat.mcpVideosDir({ platform: 'linux', home: '/home/me', env: {} }), path.join('/home/me', 'Videos', 'IV Studio'))
    assert.equal(plat.mcpVideosDir({ platform: 'linux', home: '/home/me', env: { USERPROFILE: '/x' } }), path.join('/x', 'Videos', 'IV Studio'))
  })
})

describe('dataDir', () => {
  test('darwin: ~/Library/Application Support/IV Studio', () => {
    assert.equal(dataDir({ platform: 'darwin', home: '/Users/me', env: {} }), path.join('/Users/me', 'Library', 'Application Support', 'IV Studio'))
  })
  test('darwin ignores APPDATA but not IV_STUDIO_DATA', () => {
    assert.equal(dataDir({ platform: 'darwin', home: '/Users/me', env: { APPDATA: '/nope' } }), path.join('/Users/me', 'Library', 'Application Support', 'IV Studio'))
    assert.equal(dataDir({ platform: 'darwin', home: '/Users/me', env: { IV_STUDIO_DATA: '/d' } }), '/d')
  })
  test('linux with no APPDATA: ~/.config/IV Studio from HOME', () => {
    assert.equal(dataDir({ platform: 'linux', home: '/ignored', env: { HOME: '/home/me' } }), path.join('/home/me', '.config', 'IV Studio'))
  })
  test('linux with no HOME falls back as before', () => {
    assert.equal(dataDir({ platform: 'linux', env: {} }), path.join('.', '.config', 'IV Studio'))
  })
  test('win32: APPDATA, unchanged', () => {
    assert.equal(dataDir({ platform: 'win32', env: { APPDATA: 'C:\\Users\\me\\AppData\\Roaming' } }), path.join('C:\\Users\\me\\AppData\\Roaming', 'IV Studio'))
  })
  test('no arguments still works on this machine', () => {
    assert.equal(typeof dataDir(), 'string')
  })
})
