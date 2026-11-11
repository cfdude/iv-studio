// Window channels for Shinobi, Remake, character training and films whose service method no MCP tool reaches (task
// 6.2). Each test calls the service method the channel's one-line handler calls (src/main/index.js;
// test/unit/ipc-map.mjs), in this process, with the fake ComfyUI where a Studio is needed. The channels that share a
// method with an MCP tool carry their id in that tool's test name instead.
//   node --test test/unit/ipc-film.test.mjs
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import ffmpegStatic from 'ffmpeg-ffprobe-static'
import { Productions } from '../../src/service/productions.js'
import { Remake } from '../../src/service/remake.js'
import { Shinobi } from '../../src/service/shinobi.js'
import { Studio } from '../../src/service/studio.js'
import { Trainings } from '../../src/service/training.js'
import { startFakeComfy } from '../fakes/comfyui.mjs'

const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'iv-ipc-')))
const ff = (...args) => execFileSync(ffmpegStatic.ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error', ...args])
const write = (file, text) => (fs.mkdirSync(path.dirname(file), { recursive: true }), fs.writeFileSync(file, text), file)

describe('window channels: Shinobi and Remake', () => {
  test('[ipc:shinobi:delete] removes a project folder with its media and renders, keeps the others, refuses an id outside the workspace and is fine with one that is gone', () => {
    const dir = tmp()
    const shinobi = new Shinobi({ dataDir: dir, resourcesDir: path.resolve('resources'), ffmpegDir: path.dirname(ffmpegStatic.ffmpegPath) })
    const project = (id, name) => write(path.join(shinobi.workspace, id, 'project.json'), JSON.stringify({ name, created_at: '2026-11-10T10:00:00Z', assets: [] }))
    project('keep1', 'Keep')
    project('drop1', 'Drop')
    write(path.join(shinobi.workspace, 'drop1', '.openkatana', 'jobs', 'j1', 'job.json'), '{}')
    assert.deepEqual(shinobi.projects().map((p) => p.id).sort(), ['drop1', 'keep1'])
    assert.equal(shinobi.deleteProject('drop1'), true)
    assert.deepEqual(shinobi.projects().map((p) => p.id), ['keep1'])
    assert.ok(!fs.existsSync(path.join(shinobi.workspace, 'drop1')), 'the whole folder is gone')
    assert.equal(shinobi.deleteProject('drop1'), true, 'again is fine')
    assert.throws(() => shinobi.deleteProject('../keep1'), /Bad project id\./)
    assert.ok(fs.existsSync(path.join(shinobi.workspace, 'keep1', 'project.json')))
  })

  test('[ipc:remake:setKeyframe] leaves a keyframe out and brings it back, touches no other keyframe, and names a session that is not there', () => {
    const dir = tmp()
    const remake = new Remake({ studio: null, images: null, dataDir: dir, resourcesDir: path.resolve('resources'), ffmpeg: ffmpegStatic.ffmpegPath, ffprobe: ffmpegStatic.ffprobePath })
    remake.save({ id: 'rm1', kind: 'swap', keyframes: [{ frame: 0, painted: null }, { frame: 12, painted: '/x/p.png' }] })
    const skipped = remake.setKeyframe('rm1', 12, { skip: true })
    assert.deepEqual(skipped.keyframes.map((k) => [k.frame, !!k.skip]), [[0, false], [12, true]])
    assert.deepEqual(remake.get('rm1').keyframes.map((k) => !!k.skip), [false, true], 'saved')
    assert.deepEqual(remake.setKeyframe('rm1', 12, { skip: false }).keyframes.map((k) => !!k.skip), [false, false], 'brought back')
    assert.deepEqual(remake.setKeyframe('rm1', 99, { skip: true }).keyframes.map((k) => !!k.skip), [false, false], 'a frame it does not have changes nothing')
    assert.throws(() => remake.setKeyframe('nope', 0, { skip: true }), /No Remake nope\./)
  })
})

describe('window channels: character training and films', () => {
  let fake, dir, studio, trainings
  before(async () => {
    fake = await startFakeComfy({ devices: 'mps', os: 'darwin' })
    dir = tmp()
    studio = new Studio({ dataDir: dir, resourcesDir: path.resolve('resources'), comfyUrl: fake.url })
    trainings = new Trainings({ dataDir: dir, resourcesDir: path.resolve('resources'), studio, ffmpeg: ffmpegStatic.ffmpegPath, ffprobe: ffmpegStatic.ffprobePath })
  })
  after(() => fake.close())

  test('[ipc:training:delete] removes the training with its folder and leaves the others listed', () => {
    const a = trainings.create({ name: 'Gone' })
    const b = trainings.create({ name: 'Stays' })
    write(path.join(trainings.folder(a.id), 'stills', 'one.png'), 'x')
    assert.ok(trainings.list().some((t) => t.id === a.id))
    assert.equal(trainings.remove(a.id), true)
    assert.ok(!fs.existsSync(trainings.folder(a.id)), 'its folder is gone')
    assert.deepEqual(trainings.list().map((t) => t.id).filter((id) => [a.id, b.id].includes(id)), [b.id])
    assert.equal(trainings.remove(a.id), true, 'removing it again is fine')
  })

  test('[ipc:training:buildDataset] copies each kept still with a caption file beside it, leaves clips out for a look, and says how many it made', async () => {
    const t = trainings.create({ name: 'Dataset' })
    const png = path.join(dir, 'face.png')
    ff('-f', 'lavfi', '-i', 'color=c=red:s=64x64:d=1', '-frames:v', '1', png)
    trainings.save(t.id, { consent: true })
    trainings.addStills(t.id, [png, png], 'in a red coat')
    const r = await trainings.buildDataset(t.id, { learn: 'look' })
    assert.equal(r.stills, 2)
    assert.equal(r.clips, 0)
    assert.equal(r.dir, path.join(trainings.folder(t.id), 'dataset'))
    const files = fs.readdirSync(r.dir).sort()
    assert.deepEqual(files, ['dataset_still_01.png', 'dataset_still_01.txt', 'dataset_still_02.png', 'dataset_still_02.txt'])
    assert.match(fs.readFileSync(path.join(r.dir, 'dataset_still_01.txt'), 'utf8'), /in a red coat/)
    const again = await trainings.buildDataset(t.id, { learn: 'look' })
    assert.equal(again.items, 2, 'a second build replaces the folder, it does not add to it')
  })

  test('[ipc:training:check] gives back a training with no run as it is, and reads a finished local run from its log', async () => {
    const t = trainings.create({ name: 'Checked' })
    assert.deepEqual((await trainings.checkTraining(t.id)).train, null)
    const train = { where: 'local', name: 'run1', state: 'training', gpu: 'local', options: {}, epochs: 20, pid: 99999999 }
    const saved = trainings.get(t.id)
    saved.train = train
    trainings.write(saved)
    write(path.join(trainings.localRoot(trainings.get(t.id)), 'train.log'), '[local] start\nepoch 20/20 step=160\n[local] TRAINING DONE\n')
    const r = await trainings.checkTraining(t.id)
    assert.equal(r.train.state, 'done', 'the runner is gone and the log says it finished')
    assert.equal(r.train.pid, null)
    assert.equal(trainings.get(t.id).train.state, 'done', 'saved')
    assert.equal((await trainings.checkTraining(t.id)).train.state, 'done', 'a finished run stays finished')
  })

  test('[ipc:productions:delete] removes the film and leaves the others listed', () => {
    const films = new Productions({ dataDir: tmp(), studio: () => ({ characters: () => [] }) })
    const a = films.create({ name: 'Gone' })
    const b = films.create({ name: 'Stays' })
    assert.equal(films.remove(a.id), true)
    assert.deepEqual(films.list().map((f) => f.id), [b.id])
    assert.ok(!fs.existsSync(films.file(a.id)))
    assert.equal(films.remove(a.id), true, 'again is fine')
  })
})
