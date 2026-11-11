// The data folder channels (task 6.3, 6.4): what the Settings page's "Data folder" box reads and does through
// src/service/datafolder.js. The handlers in src/main/index.js call these functions with the folder IV Studio runs in
// (BASE) and the default folder; each test does the same on temp folders, in order: a move, what the box then says,
// and removing the old copy. What main adds (the picker, the restart, the last `done` progress) is the page tier's.
//   node --test test/unit/ipc-data.test.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, test } from 'node:test'
import { chooseTarget, copyData, freeBytes, listData, movableEntries, oldCopy, removeOldCopy, verifyCopy, writePointer } from '../../src/service/datafolder.js'
import { readPointer } from '../../src/service/paths.js'
import { tempDirReal } from '../fakes/tmp.mjs'

const tmp = () => tempDirReal('iv-data-')
const write = (file, text) => (fs.mkdirSync(path.dirname(file), { recursive: true }), fs.writeFileSync(file, text), file)

describe('window channels: data folder', () => {
  const root = tmp()
  const defaultDir = path.join(root, 'default')
  const target = path.join(root, 'moved', 'IV Studio')
  const progress = []
  let copied
  write(path.join(defaultDir, 'settings.json'), JSON.stringify({ outputFolder: path.join(defaultDir, 'out') }))
  write(path.join(defaultDir, 'jobs', 'a.json'), '{"id":"a"}')
  write(path.join(defaultDir, 'music', 'song.wav'), 'x'.repeat(1500))
  write(path.join(defaultDir, 'Local Storage', 'leveldb', 'x'), 'the window\'s own file stays put')

  test('[ipc:data:size] counts the bytes and files of what IV Studio keeps, not the window\'s own files', async () => {
    const items = await listData(defaultDir)
    const r = { bytes: items.reduce((n, i) => n + i.size, 0), files: items.filter((i) => !i.dir).length }
    assert.equal(r.files, 3)
    assert.equal(r.bytes, JSON.stringify({ outputFolder: path.join(defaultDir, 'out') }).length + '{"id":"a"}'.length + 1500)
    assert.deepEqual(movableEntries(defaultDir).sort(), ['jobs', 'music', 'settings.json'])
  })

  test('[ipc:data:info] says there is no old copy before a move, and how much room the drive has', () => {
    assert.equal(oldCopy(defaultDir, defaultDir), null)
    const free = freeBytes(defaultDir)
    assert.ok(free > 0, 'free space of the drive')
    assert.ok(Math.abs(freeBytes(path.join(defaultDir, 'not', 'made', 'yet')) - free) < 512 * 1024 ** 2, 'a folder that is not there yet is measured by the drive it will be on')
    assert.equal(chooseTarget(path.join(root, 'moved'), { from: defaultDir, defaultDir }), path.join(root, 'moved'), 'an empty or missing folder is used as it is')
    assert.throws(() => chooseTarget(defaultDir, { from: defaultDir, defaultDir }), /already IV Studio’s data folder/)
    assert.throws(() => chooseTarget(path.join(defaultDir, 'jobs'), { from: defaultDir, defaultDir }), /outside IV Studio’s current data folder/)
  })

  test('[ipc:data:move][event:data:progress] copies the data to the new folder, reports counting, copying, copied and checked, rewrites the old path in the settings, and leaves the old copy', async () => {
    const chosen = chooseTarget(path.join(root, 'moved'), { from: defaultDir, defaultDir })
    fs.mkdirSync(chosen, { recursive: true })
    write(path.join(chosen, 'keep-me.txt'), 'x')
    assert.equal(chooseTarget(path.join(root, 'moved'), { from: defaultDir, defaultDir }), target, 'a folder with something in it gets an "IV Studio" folder inside')
    const entries = movableEntries(defaultDir)
    copied = await copyData(defaultDir, target, { entries, onProgress: (p) => progress.push(p) })
    await verifyCopy(target, copied, { onProgress: (p) => progress.push(p) })
    writePointer(defaultDir, { to: target, from: defaultDir, entries: copied.entries })
    assert.equal(copied.files.length, 3)
    assert.equal(copied.bytes, JSON.stringify({ outputFolder: path.join(defaultDir, 'out') }).length + '{"id":"a"}'.length + 1500, 'the bytes counted are the original files\'')
    assert.equal(fs.readFileSync(path.join(target, 'music', 'song.wav'), 'utf8').length, 1500)
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(target, 'settings.json'), 'utf8')), { outputFolder: path.join(target, 'out') }, 'the old folder in the settings now points at the new one')
    assert.ok(!fs.existsSync(path.join(target, 'Local Storage')), 'the window\'s files were not copied')
    assert.ok(fs.existsSync(path.join(defaultDir, 'jobs', 'a.json')), 'the old copy is left')
    // the payload main sends the window as data:progress: { phase, done, total }
    const phases = [...new Set(progress.map((p) => p.phase))]
    assert.deepEqual(phases.filter((p) => ['counting', 'copied', 'checked'].includes(p)), ['counting', 'copied', 'checked'])
    for (const p of progress) assert.ok(typeof p.phase === 'string' && Number.isFinite(p.done) && Number.isFinite(p.total), JSON.stringify(p))
    assert.deepEqual(progress.at(-1), { phase: 'checked', done: 3, total: 3 })
    assert.equal(progress.find((p) => p.phase === 'copied').total, copied.bytes)
    assert.equal(readPointer(defaultDir).dir, target)
  })

  test('[ipc:data:move] refuses a copy that does not check out and keeps the old folder, and takes back what a failed move copied', async () => {
    const bad = { ...copied, files: [...copied.files, { rel: 'jobs/gone.json', size: 4 }] }
    await assert.rejects(verifyCopy(target, bad), /The copy didn’t check out, so IV Studio keeps using the old folder: jobs\/gone\.json: missing/)
    const elsewhere = path.join(root, 'half')
    await assert.rejects(copyData(defaultDir, elsewhere, { entries: ['jobs', 'nope'] }))
    assert.ok(fs.existsSync(path.join(defaultDir, 'jobs', 'a.json')), 'the original was never changed')
  })

  test('[ipc:data:info] after a move, names the old copy that is left so the page can offer to remove it', () => {
    const old = oldCopy(defaultDir, target)
    assert.equal(old.dir, defaultDir)
    assert.deepEqual(old.entries.sort(), ['jobs', 'music', 'settings.json'])
    assert.equal(oldCopy(defaultDir, defaultDir), null, 'running from the old folder, there is no old copy')
  })

  test('[ipc:data:removeOld] removes only the names the move copied from the old folder, keeps the window\'s files, and says how many; again it has nothing to remove', async () => {
    assert.deepEqual(await removeOldCopy(defaultDir, target), { removed: 3 })
    assert.deepEqual(fs.readdirSync(defaultDir).sort(), ['Local Storage', 'data-folder.json'].sort(), 'the window\'s own folder and the pointer stay')
    assert.ok(fs.existsSync(path.join(target, 'jobs', 'a.json')), 'the new copy is untouched')
    assert.deepEqual(await removeOldCopy(defaultDir, target), { removed: 0 })
    assert.equal(oldCopy(defaultDir, target), null)
  })
})
