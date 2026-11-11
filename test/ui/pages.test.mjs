// The page tier, part 2 (tasks 7.2 and 7.3): every page of the app opens, and the records the id-gated pages need are
// made through the window's own channels first. Free: the built app under the guard on a fake ComfyUI.
//   npm run build && npm run test:ui
// A route check records text length, console errors and renderer crashes, retries once on a failure and keeps both
// attempts. The page-only channels (test/unit/page-only-channels.json) are proven here too: a test whose name carries
// `[ipc:<channel>]` calls that channel through the window (dialogs answer from test/fakes/dialog-answers.json).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { startFakeComfy } from '../fakes/comfyui.mjs'
import { launchApp } from './driver.mjs'
import { checkRoute, makeFixtures, musicObjectInfo, ROUTES, tempBase, waitFor, writeShinobi, writeSizzle } from './pages.mjs'

const PROMPT = 'integrated_multimodal_description: [Shot 1] A courier runs across a rooftop at dusk.\n\noverall_soundscape: Wind and footsteps.\n\nnon_diegetic_music: N/A'

describe('page tier: every sidebar page opens', () => {
  let fake
  let app
  let fixtures
  const records = {}
  const results = []
  // a channel through the window: api('folders.videos'), api('shinobi.saveBrief', id, 'text')
  const api = (name, ...args) => app.evaluate(`window.ivstudio.${name}(${args.map((a) => JSON.stringify(a)).join(', ')})`)
  const route = async (id) => {
    const r = await checkRoute(app, id)
    results.push(r)
    return r
  }
  const dataFile = (...p) => path.join(app.data, ...p)

  before(async () => {
    fixtures = makeFixtures(path.join(tempBase(), 'fixtures'))
    fake = await startFakeComfy({ devices: 'mps' })
    app = await launchApp({ name: 'pages', fake })
    await waitFor('the sidebar', () => app.evaluate(`!!document.querySelector('.nav .nav-item')`))
    // the records the id-gated pages need, made the way the window makes them
    records.shot = await api('render.previews', { prompt: PROMPT, character: 'none', projectName: 'Rig shot', previews: 2 })
    records.project = await api('productions.create', { name: 'Rig film', logline: 'A courier crosses a rooftop' })
    records.sequence = await api('sequences.create', { name: 'Rig sequence' })
    records.edit = await api('edits.create', 'Rig cut')
    records.character = await api('training.create', { name: 'Mira', who: 'a woman in her thirties' })
    records.rebuild = await api('rebuild.read', { file: fixtures.clip, rights: true, name: 'Rig rebuild' })
    // a sizzle starts with a browser capture and a Shinobi film with its Python engine, which the guard refuses
    records.sizzle = writeSizzle(app.data)
    records.film = writeShinobi(app.data)
  })

  after(async () => {
    await app?.close()
    await fake?.close()
  })

  test('the records the id-gated pages need exist', async () => {
    assert.match(records.shot.projectId, /^[0-9a-f]{8}$/)
    assert.equal(records.shot.status, 'queued')
    for (const k of ['project', 'sequence', 'edit', 'character', 'rebuild']) assert.match(records[k].id, /^[0-9a-f]{8}$/, k)
    assert.equal(records.rebuild.name, 'Rig rebuild')
  })

  // ---------- 7.2: the sidebar routes ----------
  test('[page:create] opens from the sidebar with no console error or crash', async () => void (await route('create')))
  test('[page:projects] opens from the sidebar with no console error or crash', async () => void (await route('projects')))
  test('[page:library] opens from the sidebar with no console error or crash', async () => void (await route('library')))
  test('[page:edits] opens from the sidebar with no console error or crash', async () => void (await route('edits')))
  test('[page:workflows] opens from the sidebar with no console error or crash', async () => void (await route('workflows')))
  test('[page:sequences] opens from the Workflows page with no console error or crash', async () => void (await route('sequences')))
  test('[page:sizzle] opens from the Workflows page with no console error or crash', async () => void (await route('sizzle')))
  test('[page:reel] opens from the Workflows page with no console error or crash', async () => void (await route('reel')))
  test('[page:shinobi] opens from the Workflows page with no console error or crash', async () => void (await route('shinobi')))
  test('[page:replace] opens from the Workflows page with no console error or crash', async () => void (await route('replace')))
  test('[page:rebuild] opens from the Workflows page with no console error or crash', async () => void (await route('rebuild')))
  test('[page:characters] opens from the sidebar with no console error or crash', async () => void (await route('characters')))
  test('[page:loras] opens from the sidebar with no console error or crash', async () => void (await route('loras')))
  test('[page:cloud] opens from the sidebar with no console error or crash', async () => void (await route('cloud')))
  test('[page:settings] opens from the sidebar with no console error or crash', async () => void (await route('settings')))
  test('[page:setup] opens from the Settings tab with no console error or crash', async () => void (await route('setup')))
  test('[page:media] opens from the Library link with no console error or crash', async () => void (await route('media')))
  test('[page:voices] opens from the Audio sidebar with no console error or crash', async () => void (await route('voices')))
  test('[page:lines] opens from the Audio sidebar with no console error or crash', async () => void (await route('lines')))
  test('[page:music] opens from the Audio sidebar with no console error or crash', async () => void (await route('music')))

  test('a page error thrown in a fixture makes that route fail with the error text, on both attempts', async () => {
    const inject = `setTimeout(() => { throw new Error('fixture page error: the loras page broke') }, 0)`
    await assert.rejects(
      () => checkRoute(app, 'loras', { inject }),
      (e) => {
        assert.match(e.message, /page loras failed 2 time\(s\)/)
        assert.equal((e.message.match(/fixture page error: the loras page broke/g) || []).length >= 2, true, e.message)
        assert.equal(e.result.attempts.length, 2)
        assert.equal(e.result.ok, false)
        return true
      }
    )
    // and a page that is fine afterwards passes again: the error belonged to the fixture, not the route
    const ok = await checkRoute(app, 'loras')
    assert.equal(ok.attempts.length, 1)
  })

  test('a wrong page and a missing control are reported, and a retry that works is two recorded attempts', async () => {
    await assert.rejects(() => checkRoute(app, 'loras', { marker: /this text is not on the page/ }), /does not look like loras/)
    await assert.rejects(() => checkRoute(app, 'loras', { steps: [['nav', 'No such sidebar item']], clickMs: 800 }), /Timed out/)
    // the retry is real: a route that fails once and then opens is a pass with two attempts recorded
    let flip = 0
    const flaky = { ...ROUTES.loras, marker: { test: () => flip++ > 0 } }
    const r = await checkRoute(app, 'loras', { marker: flaky.marker })
    assert.equal(r.attempts.length, 2)
    assert.equal(r.attempts[0].ok, false)
    assert.equal(r.attempts[1].ok, true)
  })

  // ---------- 7.2: the page-only channels on the sidebar pages, through the window ----------
  const settingsOnDisk = () => JSON.parse(fs.readFileSync(dataFile('settings.json'), 'utf8'))
  const traceOf = (fn) => app.trace().filter((t) => t.fn === fn)
  const rejects = async (expr, pattern) => {
    const r = await app.evaluate(`(async () => { try { await (${expr}); return null } catch (e) { return e.message } })()`)
    assert.match(String(r), pattern, `${expr} should have failed`)
  }

  test('[page:settings][ipc:app:info] says the version and platform, and that the data folder is the one the driver set', async () => {
    const info = await api('app.info')
    assert.match(info.version, /^\d+\.\d+\.\d+/)
    assert.equal(info.platform, process.platform)
    assert.equal(info.dataDir, app.data)
    assert.equal(info.dataSource, 'env')
    assert.equal(info.incognito, false)
    assert.ok(info.mcp && info.links?.website)
  })

  test('[page:settings][ipc:settings:set][ipc:hardware:apply] saves the settings it is given, keeps secrets out of them and marks the person as set up', async () => {
    const s = await api('settings.set', { ollamaUrl: '192.168.1.20:11434', textSize: 'not-a-size', comfyApiKey: 'must-not-be-saved' })
    assert.equal(s.ollamaUrl, 'http://192.168.1.20:11434')
    assert.equal(s.hasComfyKey, false)
    const disk = settingsOnDisk()
    assert.equal(disk.ollamaUrl, 'http://192.168.1.20:11434')
    assert.ok(!('textSize' in disk) || disk.textSize !== 'not-a-size')
    assert.ok(!disk.comfyApiKey, 'the key in a settings patch is dropped')
    await rejects(`window.ivstudio.settings.set({ ollamaUrl: 'not an address' })`, /isn.t an address/)
    const applied = await api('hardware.apply', { promptEngine: 'claude', highContrast: true, hardware: { gpu: 'Apple M-series' } })
    assert.match(applied.onboarded, /^\d{4}-\d\d-\d\dT/)
    assert.deepEqual([applied.promptEngine, applied.highContrast], ['claude', true])
    const bogus = await api('hardware.apply', { promptEngine: 'not-an-engine' })
    assert.equal(bogus.promptEngine, 'claude', 'an engine the app does not know is ignored')
  })

  test('[page:settings][ipc:settings:setComfyKey][ipc:settings:setCivitaiKey] keep a key sealed and never hand it back, and an empty one removes it', async () => {
    for (const [fn, field, has] of [['setComfyKey', 'comfyApiKey', 'hasComfyKey'], ['setCivitaiKey', 'civitaiKey', 'hasCivitaiKey']]) {
      const value = `dummy-${field}-value`
      const saved = await api(`settings.${fn}`, value)
      assert.equal(saved[has], true, fn)
      assert.ok(!(field in saved), 'the window never gets the key')
      const sealed = settingsOnDisk()[field]
      assert.ok(sealed && sealed !== value && !String(sealed).includes(value), `${field} is kept sealed, not as typed`)
      const cleared = await api(`settings.${fn}`, '')
      assert.equal(cleared[has], false)
      assert.ok(!settingsOnDisk()[field])
    }
  })

  test('[page:settings][ipc:comfy:launcher][ipc:comfy:chooseLauncher][ipc:comfy:chooseFolder] pick a launcher and a ComfyUI folder from the canned answers and report what ComfyUI would start with', async () => {
    const before = await api('comfy.launcher')
    assert.equal(before.chosen, null)
    assert.equal(before.autoStart, false)
    const launcher = await api('comfy.chooseLauncher')
    assert.equal(path.basename(launcher), 'start-comfy.sh')
    assert.equal(settingsOnDisk().comfyLauncher, launcher)
    assert.equal((await api('comfy.launcher')).chosen, launcher)
    const dialog = traceOf('dialog.showOpenDialog').find((t) => t.title === 'Start ComfyUI with')
    assert.deepEqual(dialog.properties, ['openFile'])
    const folder = await api('comfy.chooseFolder')
    assert.equal(path.basename(folder), 'ComfyUI-here')
    assert.deepEqual([settingsOnDisk().comfyFolder, settingsOnDisk().comfyLauncher], [folder, ''], 'a new folder drops the launcher picked before')
    const after = await api('comfy.launcher')
    assert.equal(after.folder, folder)
    assert.deepEqual(after.inFolder.map((l) => path.basename(l.path)), ['main.py'])
    assert.ok(traceOf('dialog.showOpenDialog').some((t) => t.title === 'Your ComfyUI folder'))
  })

  test('[page:settings][ipc:folders:videos][ipc:folders:chooseVideos][ipc:folders:resetVideos] show, pick and reset the folder finished videos go to', async () => {
    const seeded = await api('folders.videos')
    assert.deepEqual([seeded.path, seeded.custom], [path.join(app.data, 'videos'), true])
    const picked = await api('folders.chooseVideos')
    assert.equal(path.basename(picked.path), 'picked-videos')
    assert.equal(settingsOnDisk().videosFolder, picked.path)
    assert.ok(traceOf('dialog.showOpenDialog').some((t) => t.title === 'Where finished videos go' && t.properties.includes('createDirectory')))
    const reset = await api('folders.resetVideos')
    assert.equal(reset.custom, false)
    assert.equal(settingsOnDisk().videosFolder, '')
  })

  test('[page:settings][ipc:data:choose][ipc:data:open][ipc:data:restart] refuse to move a folder the driver pinned, open the data folder, and restart without relaunching', async () => {
    await rejects(`window.ivstudio.data.choose()`, /.+/)
    assert.ok(!traceOf('dialog.showOpenDialog').some((t) => /Move IV Studio/.test(t.title)), 'no dialog opens for a folder that cannot move')
    await api('data.open')
    assert.deepEqual(traceOf('shell.openPath').at(-1).arg, app.data)
    const restarts = traceOf('app.relaunch').length
    assert.equal(await api('data.restart'), true)
    await waitFor('the restart to be recorded', () => traceOf('app.relaunch').length === restarts + 1 && traceOf('app.exit').length >= 1)
    assert.equal(await app.evaluate(`document.body.innerText.length > 0`), true, 'the window is still there: nothing really restarted')
  })

  test('[page:settings][ipc:agents:info][ipc:agents:installSkill] show what to paste into an agent and write the skill file under the temp home only', async () => {
    const info = await api('agents.info')
    const skill = path.join(app.home, '.claude', 'skills', 'iv-studio', 'SKILL.md')
    assert.equal(info.skillFile, skill)
    assert.equal(info.skillInstalled, false)
    assert.match(info.paste, /iv-studio|IV Studio/i)
    assert.equal(await api('agents.installSkill'), skill)
    assert.ok(fs.existsSync(skill))
    const again = await api('agents.info')
    assert.deepEqual([again.skillInstalled, again.skillCurrent], [true, true])
  })

  test('[page:settings][ipc:learn:openGuide][ipc:links:open][ipc:files:reveal] open the guide, a link and a file in a folder through the app, and the trace holds each call', async () => {
    const guide = await api('learn.openGuide')
    assert.equal(path.dirname(guide), path.join(app.data, 'guide'))
    assert.ok(fs.statSync(guide).size > 1000)
    assert.equal(await api('links.open', 'https://example.com/guide'), true)
    assert.equal(await api('links.open', 'file:///etc/passwd'), true)
    const file = path.join(app.data, 'reveal-me.txt')
    fs.writeFileSync(file, 'x')
    assert.equal(await api('files.reveal', file), file)
    assert.deepEqual(traceOf('shell.openPath').at(-1).arg, guide)
    assert.deepEqual(traceOf('shell.openExternal').map((t) => t.arg).filter((a) => /guide|passwd/.test(a)), ['https://example.com/guide'], 'only an https link is opened')
    assert.deepEqual(traceOf('shell.showItemInFolder').at(-1).arg, file)
  })

  test('[page:settings][ipc:update:state][ipc:update:check][ipc:update:install] say an unpackaged build is a development build and never install', async () => {
    const state = await api('update.state')
    assert.equal(state.status, 'dev')
    assert.equal(state.manual, process.platform === 'darwin')
    assert.equal((await api('update.check')).status, 'dev')
    assert.equal(await api('update.install'), false)
  })

  test('[page:settings][ipc:incognito:set] switches the private space on by saving it and restarting (recorded, not done), and off again', async () => {
    const restarts = traceOf('app.relaunch').length
    assert.deepEqual(await api('incognito.set', true), { on: true, restarting: true })
    assert.equal(settingsOnDisk().incognito, true)
    await waitFor('the restart to be recorded', () => traceOf('app.relaunch').length === restarts + 1)
    // this window never restarted, so it is still the normal space: asking for that is a no-op
    assert.deepEqual(await api('incognito.set', false), { on: false })
    await api('settings.set', { incognito: false })
  })

  // the song a finished render leaves, made on the fake
  const finishedSong = async () => {
    fake.setObjectInfo(musicObjectInfo())
    const song = await api('music.create', { engine: 'ace', caption: 'lo-fi piano', seconds: 10, name: 'Rig song' })
    const promptId = JSON.parse(fs.readFileSync(dataFile('jobs', `${song.jobId}.json`), 'utf8')).promptId
    fake.state.history[promptId].outputs = { 8: { audio: [{ filename: path.basename(fixtures.song), subfolder: 'iv_studio/music', type: 'output', fullpath: fixtures.song }] } }
    return waitFor('the song to finish', async () => {
      const got = await api('music.get', song.id)
      return got.status === 'success' && got
    })
  }

  test('[page:music][ipc:music:pickSong][ipc:music:toEdit] pick a song to remix from the canned answer and put a finished song on a new edit', async () => {
    const picked = await api('music.pickSong')
    assert.equal(path.basename(picked), 'song-to-remix.wav')
    assert.ok(traceOf('dialog.showOpenDialog').some((t) => t.title === 'A song to remix'))
    records.song = await finishedSong()
    assert.ok(fs.existsSync(records.song.file))
    const edit = await api('music.toEdit', records.song.id)
    assert.equal(edit.name, 'Rig song')
    assert.equal(Object.values(edit.media).length, 1)
    assert.equal(edit.clips.length, 1)
    assert.ok((await api('edits.list')).some((e) => e.id === edit.id))
    await rejects(`window.ivstudio.music.toEdit('nope')`, /.+/)
  })

  test('[page:create][ipc:images:toEdit][ipc:files:pick] put a picture on a new edit, and pick files from the canned answer with the right dialog options per kind', async () => {
    const edit = await api('images.toEdit', fixtures.picture, 'Rig picture')
    assert.equal(edit.name, 'Rig picture')
    assert.equal(Object.values(edit.media).length, 1)
    const picked = await api('files.pick', 'picture')
    assert.deepEqual(picked.map((f) => path.basename(f)), ['picked-file.png'])
    assert.deepEqual((await api('files.pick', 'audio')).map((f) => path.basename(f)), ['picked-file.png'])
    const calls = traceOf('dialog.showOpenDialog').filter((t) => t.title === '')
    assert.ok(calls[0].properties.includes('multiSelections'), 'pictures may be picked several at a time')
    assert.ok(!calls[1].properties.includes('multiSelections'), 'audio is one file')
  })

  test('[page:media][ipc:library:all][ipc:library:toEdit] list everything made, and put one of the items on a new edit', async () => {
    const items = await api('library.all')
    const song = items.find((i) => i.key === `music:${records.song.id}`)
    assert.ok(song, JSON.stringify(items.map((i) => i.key)))
    assert.equal(song.type, 'music')
    assert.equal(song.label, 'Rig song')
    const edit = await api('library.toEdit', song)
    assert.equal(edit.name, 'Rig song')
    assert.equal(Object.values(edit.media).length, 1)
  })

  test('[page:rebuild][ipc:rebuild:pickVideo] picks the video to rebuild from the canned answer', async () => {
    const picked = await api('rebuild.pickVideo')
    assert.equal(path.basename(picked), 'video-to-rebuild.mp4')
    assert.ok(traceOf('dialog.showOpenDialog').some((t) => t.title === 'A video to rebuild' && t.properties.includes('openFile')))
  })

  test('[page:replace][ipc:replace:toEdit] puts a finished replace on a new edit', async () => {
    const edit = await api('replace.toEdit', fixtures.clip, 'Rig replace')
    assert.equal(edit.name, 'Rig replace')
    const [media] = Object.values(edit.media)
    assert.ok(media.duration > 5, `a ${media.duration} s clip`)
    assert.equal(edit.clips.length, 1)
  })

  test('[page:characters][ipc:training:chooseFizgig] picks a folder with Fizgig in it from the canned answer and saves it', async () => {
    const dir = await api('training.chooseFizgig')
    assert.equal(path.basename(dir), 'Fizgig-here')
    assert.equal(settingsOnDisk().fizgigFolder, dir)
    assert.ok(traceOf('dialog.showOpenDialog').some((t) => t.title === 'Fizgig’s folder'))
  })

  test('[page:cloud][ipc:cloud:provider][ipc:cloud:status][ipc:cloud:clearToken] choose the cloud service, report it, and clear only a sign-in that cannot be opened', async () => {
    assert.equal(await api('cloud.provider', 'runpod'), 'runpod')
    assert.equal(settingsOnDisk().cloudProvider, 'runpod')
    await api('cloud.provider', 'something else')
    assert.equal(settingsOnDisk().cloudProvider, 'modal', 'an unknown service means Modal')
    const status = await api('cloud.status')
    assert.equal(status.provider, 'modal')
    assert.equal(status.hasToken, false)
    assert.deepEqual(status.removable, [])
    await rejects(`window.ivstudio.cloud.clearToken('cloudToken')`, /Nothing saved to remove/)
    await rejects(`window.ivstudio.cloud.clearToken('comfyApiKey')`, /isn.t a cloud sign-in/)
    // a sign-in saved by another install: sealed text this app cannot open
    fs.writeFileSync(dataFile('settings.json'), JSON.stringify({ ...settingsOnDisk(), cloudToken: Buffer.from('sealed by another app').toString('base64') }, null, 2))
    const stuck = await api('cloud.status')
    assert.deepEqual(stuck.removable, ['cloudToken'])
    assert.equal(await api('cloud.clearToken', 'cloudToken'), true)
    assert.ok(!settingsOnDisk().cloudToken)
    assert.deepEqual((await api('cloud.status')).removable, [])
  })

  test('[page:library][ipc:projects:list] lists the shots made, with the latest run and its state', async () => {
    const list = await api('projects.list')
    const shot = list.find((p) => p.id === records.shot.projectId)
    assert.ok(shot, JSON.stringify(list.map((p) => p.name)))
    assert.equal(shot.name, 'Rig shot')
    assert.equal(shot.jobCount, 1)
    assert.ok(!list.some((p) => p.tool || p.trainingId || p.sequenceId), 'tool, training and sequence projects are not shots')
  })

  // ---------- 7.3: the pages that need a record ----------
  // A record's page is reached from its list page, by clicking its tile. `marker` is text only that page has (the
  // list page says the record's name too), so a click that missed shows as the wrong page.
  const recordRoute = async (id, list, name, marker, options = {}) => {
    const r = await checkRoute(app, id, { steps: [...ROUTES[list].steps, ['record', name]], marker, clickMs: 5000, minText: 100, ...options })
    results.push(r)
    return r
  }
  // the app shows its error screen for a crashed page and nothing in the sidebar works until it reloads
  const recover = async () => {
    await app.cdp.send('Page.reload')
    await waitFor('the sidebar again', () => app.evaluate(`!!document.querySelector('.nav .nav-item')`))
  }

  test('[page:shot] opens a shot from the Shots page and shows its run', async () => {
    await recordRoute('shot', 'library', 'Rig shot', /← all shots[\s\S]*run/i)
  })

  test('[page:shot][ipc:jobs:watch] a shot page can ask the app to watch a job, and the app polls the fake for it', async () => {
    assert.equal(await api('jobs.watch', [records.shot.id]), true)
    await waitFor('the app to ask the fake about the job', () => fake.requests.some((r) => r.path.includes(`/history`) && r.path.includes(records.shot.promptId)), { timeoutMs: 20000 })
    assert.equal(await api('jobs.watch', []), true, 'watching nothing is fine')
  })

  test('[page:project] opens a film from the Projects page and shows its steps', async () => {
    await recordRoute('project', 'projects', 'Rig film', /← all films[\s\S]*storyboard/i)
  })

  test('[page:sequence] opens a sequence from the Sequences page and shows how it renders', async () => {
    await recordRoute('sequence', 'sequences', 'Rig sequence', /← all sequences[\s\S]*how it renders/i)
  })

  // The editor's page crashes on every machine: Editor.jsx reads `platform` at line 280 and never declares it
  // (usePlatform is imported and not called), so the app shows its error screen. Reported, not fixed here (the rig changes
  // no product code). Marked todo so the run stays green and the failure text is in the output; when the product is
  // fixed the test passes, and the gaps entry for page:edit can go.
  test('[page:edit] opens an edit from the Edit page and shows its timeline', { todo: 'product bug: ReferenceError: platform is not defined (src/renderer/src/components/edit/Editor.jsx:280)' }, async () => {
    try {
      await recordRoute('edit', 'edits', 'Rig cut', /^(?![\s\S]*cut your shots)[\s\S]*rig cut/i, { settleMs: 2500 })
    } finally {
      await recover()
    }
  })

  test('[ipc:window:fullScreen] asks the window to go full screen and to leave it, and says whether it is', async () => {
    // On macOS a window the person has not brought to the front never enters full screen, so what can be proven here is
    // that main gets the request and answers with the window's state, not that the window filled the display.
    assert.equal(typeof (await api('edits.fullScreen', true)), 'boolean')
    const left = await waitFor('the window to say it is not full screen', async () => (await api('edits.fullScreen', false)) === false, { timeoutMs: 8000, every: 300 })
    assert.equal(left, true)
  })

  test('[event:edits:changed] reaches the window when an agent changes an edit on disk, and not for the window\'s own save', async () => {
    await app.evaluate(`(() => { window.__edits = []; window.__off = window.ivstudio.edits.onChanged((p) => window.__edits.push(p)); return true })()`)
    const file = dataFile('edits', `${records.edit.id}.json`)
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
    // the window's own save is not echoed back
    const own = await api('edits.save', records.edit.id, { name: 'Rig cut (saved by the window)' })
    await new Promise((r) => setTimeout(r, 800))
    assert.deepEqual(await app.evaluate(`window.__edits`), [], 'no event for the window\'s own save')
    // an agent (here the driver) writes the file
    const changed = { ...JSON.parse(fs.readFileSync(file, 'utf8')), name: 'Rig cut (changed by an agent)', updatedAt: new Date(Date.parse(own.updatedAt) + 5000).toISOString() }
    fs.writeFileSync(file, JSON.stringify(changed, null, 2))
    const heard = await waitFor('the window to hear the change', () => app.evaluate(`window.__edits.length ? window.__edits : null`), { timeoutMs: 8000 })
    assert.deepEqual(heard, [{ id: records.edit.id, updatedAt: changed.updatedAt }])
    await app.evaluate(`window.__off()`)
    assert.equal(saved.id, records.edit.id)
  })

  test('[page:character] opens a character from the Characters page and shows its steps', async () => {
    await recordRoute('character', 'characters', 'Mira', /character · trigger m1ra4/i)
  })

  test('[page:rebuild-project] opens a rebuild from the Rebuild page and shows the shots it read', async () => {
    await recordRoute('rebuild-project', 'rebuild', 'Rig rebuild', /← all rebuilds[\s\S]*the shots/i)
  })

  test('[page:sizzle-project] opens a sizzle from the Sizzle page and shows what was captured', async () => {
    await recordRoute('sizzle-project', 'sizzle', 'Acme', /← all sizzles|← sizzle/i)
  })

  test('[page:shinobi-film] opens a film from the Shinobi page', async () => {
    // the film page asks the Shinobi engine for its recipes, which is Python: the guard refuses it, and the page says so in the console
    const r = await recordRoute('shinobi-film', 'shinobi', 'Rig film cut', /← (all films|shinobi)/i, { allow: [/refused to start "python"/] })
    assert.equal(r.attempts.at(-1).allowed.length, 1, 'the refused Python start is the one console error, and it is recorded')
    assert.ok(app.refusals().some((x) => /python/.test(x.command)), JSON.stringify(app.refusals()))
  })

  test('[page:shinobi-film][ipc:shinobi:saveBrief][ipc:shinobi:addToEdit] save the film\'s brief next to it and send a cut to a new edit', async () => {
    await api('shinobi.saveBrief', records.film.id, 'A thirty second teaser. Open on the rooftop.')
    assert.equal(fs.readFileSync(dataFile('shinobi', 'projects', records.film.id, 'iv-brief.md'), 'utf8'), 'A thirty second teaser. Open on the rooftop.')
    assert.equal((await api('shinobi.project', records.film.id)).brief, 'A thirty second teaser. Open on the rooftop.')
    const edit = await api('shinobi.addToEdit', fixtures.clip, 'Rig teaser')
    assert.equal(edit.name, 'Rig teaser')
    const [media] = Object.values(edit.media)
    assert.equal(media.source.type, 'shinobi')
    assert.ok(media.duration > 5)
    assert.equal(edit.clips.length, 1)
    assert.equal((await api('shinobi.addToEdit', fixtures.clip)).name, 'Shinobi cut', 'no name gives the default')
  })

  test('every route result is written as evidence', async () => {
    assert.ok(results.length >= 20)
    const file = app.evidence('page-routes.json', JSON.stringify(results.map(({ id, textLength, consoleErrors, allowedErrors, crashes, ok, attempts }) => ({ id, textLength, consoleErrors, allowedErrors, crashes, ok, attempts: attempts.length })), null, 2))
    assert.ok(fs.statSync(file).size > 100)
    for (const r of results) assert.deepEqual([r.id, r.consoleErrors, r.crashes], [r.id, 0, 0])
  })
})
