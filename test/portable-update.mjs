// The portable copy's own updater (src/service/portableupdate.js): its feed, the checks on a download, unpacking
// (with a stand-in for Windows' tar), the swap script and the clean-up of old files. The real swap runs in
// scripts/portable-update-selftest.mjs on Windows.  node test/portable-update.mjs
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PORTABLE_FEED, PORTABLE_ZIP, cannotReplace, checkFile, cleanUpOld, feedText, feedUrls, installScript, newer, parseFeed, pickFile, stage } from '../src/service/portableupdate.js'

let n = 0
let failed = 0
const ok = async (name, fn) => {
  n++
  try {
    await fn()
    console.log('ok', name)
  } catch (err) {
    failed++
    console.log('FAIL', name, '-', err.message)
  }
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-portable-'))

await ok('the feed it writes reads back, and names the portable zip', () => {
  const f = parseFeed(feedText({ version: '1.2.3', sha512: 'abc==', size: 42 }))
  assert.equal(f.version, '1.2.3')
  assert.deepEqual(pickFile(f.files), { url: PORTABLE_ZIP, sha512: 'abc==', size: 42 })
  assert.equal(pickFile([{ url: 'IV-Studio-Setup.exe', sha512: 'x' }]), null)
  assert.ok(newer('1.2.3', '1.1.1') && !newer('1.1.1', '1.1.1'))
})

await ok('the feed comes from the newest release, or a test folder', () => {
  const live = feedUrls()
  assert.equal(live.feed, `https://github.com/hollisorg/iv-studio/releases/latest/download/${PORTABLE_FEED}`)
  assert.equal(live.file(PORTABLE_ZIP, '1.2.3'), `https://github.com/hollisorg/iv-studio/releases/download/v1.2.3/${PORTABLE_ZIP}`)
  const t = feedUrls('http://127.0.0.1:9/feed/')
  assert.equal(t.feed, `http://127.0.0.1:9/feed/${PORTABLE_FEED}`)
})

await ok('a download is checked against the feed', async () => {
  const f = path.join(tmp, 'z.zip')
  fs.writeFileSync(f, 'portable')
  const sha512 = crypto.createHash('sha512').update('portable').digest('base64')
  assert.equal(await checkFile(f, { sha512, size: 8 }), true)
  await assert.rejects(() => checkFile(f, { sha512, size: 9 }), /bytes/)
  await assert.rejects(() => checkFile(f, { sha512: 'nope', size: 8 }), /checksum/)
})

await ok('a folder it can’t write to says so', () => {
  assert.equal(cannotReplace(tmp, { access: () => {} }), null)
  assert.match(cannotReplace(tmp, { access: () => { throw new Error('EPERM') } }), /can’t change/)
})

await ok('unpacking checks the exe, the asar and the version, and drops the zip’s data folder', async () => {
  const fill = (dir, version) => {
    fs.mkdirSync(path.join(dir, 'resources'), { recursive: true })
    fs.mkdirSync(path.join(dir, 'data'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'IV Studio.exe'), 'exe')
    fs.writeFileSync(path.join(dir, 'resources', 'app.asar'), 'asar')
    fs.writeFileSync(path.join(dir, 'data', 'README.txt'), 'empty')
    return { code: 0 }
  }
  const dir = path.join(tmp, 'new')
  const got = await stage('x.zip', dir, { version: '9.9.9', unzip: (z, d) => fill(d), readVersion: () => '9.9.9' })
  assert.equal(got, dir)
  assert.ok(!fs.existsSync(path.join(dir, 'data')), 'the zip’s data folder is not kept')
  await assert.rejects(() => stage('x.zip', dir, { version: '9.9.9', unzip: (z, d) => fill(d), readVersion: () => '1.0.0' }), /says it is 1.0.0/)
  await assert.rejects(() => stage('x.zip', dir, { version: '9.9.9', unzip: () => ({ code: 0 }), readVersion: () => '9.9.9' }), /no IV Studio.exe/)
  await assert.rejects(() => stage('x.zip', dir, { version: '9.9.9', unzip: () => ({ code: 2, stderr: 'bad zip' }) }), /bad zip/)
})

await ok('the swap script waits, keeps data, puts things back on failure and reopens', () => {
  const s = installScript({ pid: 1234, appDir: 'D:\\IV Studio', staged: "D:\\IV Studio\\data\\updates\\new-9.9.9", log: 'D:\\IV Studio\\data\\updates\\update.log', stamp: 5 })
  assert.match(s, /Get-Process -Id 1234/)
  assert.match(s, /\$keep = 'data'/)
  assert.match(s, /Where-Object \{ \$_.Name -ne \$keep \}/)
  assert.match(s, /old-5/)
  assert.match(s, /putting the old files back/)
  assert.match(s, /Start-Process -FilePath 'D:\\IV Studio\\IV Studio.exe'/)
  assert.doesNotMatch(installScript({ pid: 1, appDir: 'C:\\a', staged: 'C:\\b', log: 'C:\\l', relaunch: false }), /Start-Process/)
  // a quote in a folder name stays inside its PowerShell string
  assert.match(installScript({ pid: 1, appDir: "C:\\Matt's apps", staged: 'C:\\b', log: 'C:\\l' }), /'C:\\Matt''s apps'/)
})

await ok('old files left by an update are removed next time, nothing else', () => {
  const app = path.join(tmp, 'app')
  const up = path.join(app, 'data', 'updates')
  fs.mkdirSync(path.join(up, 'old-1', 'resources'), { recursive: true })
  fs.mkdirSync(path.join(up, 'new-9.9.9'), { recursive: true })
  fs.writeFileSync(path.join(up, 'update.log'), 'x')
  assert.equal(cleanUpOld(app), 0)
  assert.deepEqual(fs.readdirSync(up).sort(), ['new-9.9.9', 'update.log'])
  assert.equal(cleanUpOld(path.join(tmp, 'none')), 0)
})

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`${n - failed}/${n} passed`)
process.exit(failed ? 1 : 0)
