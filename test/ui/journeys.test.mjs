// The page tier, part 3 (task 7.4): each start-menu journey (src/service/startmenu.js) walked in the window as far as
// the step before a real render, on the fake ComfyUI. A journey opens the page it belongs to, then makes the calls a
// person (or the agent the menu briefs) makes there, through window.ivstudio, and stops where the next call would queue a
// render. What the fake received is asserted: the reads the journey needed, and nothing that changes anything
// (no POST, no queued prompt, no upload). Free: no credits, no GPU work.
//   npm run build && npm run test:ui
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { START_MENU } from '../../src/service/startmenu.js'
import { startFakeComfy } from '../fakes/comfyui.mjs'
import { launchApp } from './driver.mjs'
import { POLLED, traceRows } from './trace.mjs'
import { checkRoute, makeFixtures, tempBase, waitFor, writeSizzle } from './pages.mjs'

const PROMPT = 'integrated_multimodal_description: [Shot 1] A courier runs across a rooftop at dusk.\n\noverall_soundscape: Wind and footsteps.\n\nnon_diegetic_music: N/A'
const SCRIPT = 'INT. ROOFTOP - DUSK\n\nA courier runs along the edge.\n\nMIRA\nKeep moving.\n\nEXT. STREET - NIGHT\n\nRain on empty tarmac.'

describe('page tier: the start-menu journeys, to the step before a real render', () => {
  let fake
  let app
  let fixtures
  const results = []
  const api = (name, ...args) => app.evaluate(`window.ivstudio.${name}(${args.map((a) => JSON.stringify(a)).join(', ')})`)
  traceRows(import.meta.url, () => app)
  const asked = (from) => [...new Set(fake.requests.slice(from).map((r) => `${r.method} ${r.path.split('?')[0]}`))].sort()

  // Runs one journey: the menu entry, its page, then its steps. `steps` returns the reads it expects the fake to have
  // received. After it: nothing queued, uploaded or changed on the fake, and no console error or crash.
  const journey = async (id, route, steps) => {
    const entry = START_MENU.find((m) => m.id === id)
    assert.ok(entry, `${id} is a start-menu entry`)
    assert.ok(entry.title && entry.brief, `${id} has a title and a brief`)
    const from = fake.requests.length
    const prompts = fake.prompts.length
    const uploads = fake.uploads.length
    const errors0 = app.consoleErrors.length
    const crashes0 = app.crashes.length
    const page = await checkRoute(app, route)
    const expected = await steps()
    const got = asked(from)
    for (const want of expected) assert.ok(got.includes(want), `${id}: the fake never received ${want}; it received ${got.join(', ')}`)
    const changes = fake.requests.slice(from).filter((r) => r.method !== 'GET').map((r) => `${r.method} ${r.path}`)
    assert.deepEqual(changes, [], `${id}: a call that changes something reached the fake`)
    assert.equal(fake.prompts.length, prompts, `${id}: a render was queued`)
    assert.equal(fake.uploads.length, uploads, `${id}: a file was uploaded`)
    assert.deepEqual(app.consoleErrors.slice(errors0), [], `${id}: the window logged an error`)
    assert.deepEqual(app.crashes.slice(crashes0), [])
    results.push({ journey: id, title: entry.title, page: route, pageTextLength: page.textLength, fakeRequests: got, stoppedBefore: 'a real render' })
  }

  before(async () => {
    fixtures = makeFixtures(path.join(tempBase(), 'fixtures'))
    fake = await startFakeComfy({ devices: 'mps' })
    app = await launchApp({ name: 'journeys', fake })
    await waitFor('the sidebar', () => app.evaluate(`!!document.querySelector('.nav .nav-item')`))
    // v1.1.3's shell reads the chat, recipes and Dashboard idea at start-up in no fixed order; let those reads end before
    // the first journey records its trace, or their order lands in journey:make_a_shot's row
    const calls = () => app.ipcTrace().filter((c) => !POLLED.includes(c.channel)).length
    await waitFor('the start-up calls to finish', async () => {
      const n = calls()
      await new Promise((r) => setTimeout(r, 1000))
      return calls() === n
    })
  })

  after(async () => {
    await app?.close()
    await fake?.close()
  })

  test('the menu has the 11 journeys, each with a title, a brief and a start the person can type', () => {
    assert.equal(START_MENU.length, 11)
    for (const m of START_MENU) assert.ok(m.id && m.title && m.blurb && m.brief, m.id)
  })

  test('[journey:make_a_shot] opens Create, finds Tess, plans the preview run, and stops before the previews are queued', async () => {
    await journey('make_a_shot', 'create', async () => {
      const characters = await api('characters.list')
      assert.ok(characters.some((c) => c.id === 'tess'))
      const plan = await api('render.plan', { prompt: PROMPT, character: 'tess', mode: 'text' })
      assert.equal(plan.resolved.previews, 3)
      assert.equal(plan.resolved.seconds, 5.167)
      assert.equal((await api('setup.check')).items.find((i) => i.id === 'comfyui').status, 'ok')
      return ['GET /system_stats', 'GET /object_info']
    })
  })

  test('[journey:make_a_picture] opens Create, lists the six image models, and stops before a picture is made', async () => {
    await journey('make_a_picture', 'create', async () => {
      const status = await api('images.status')
      // the menu's blurb says six; the page lists what the code knows about
      assert.ok(status.families.length >= 6, `${status.families.length} families`)
      assert.ok(status.families.every((f) => f.label))
      return ['GET /object_info']
    })
  })

  test('[journey:make_a_film] opens Projects, starts a film with its idea and script, and stops before the storyboard is made', async () => {
    await journey('make_a_film', 'projects', async () => {
      const film = await api('productions.create', { name: 'Courier film', logline: 'A courier crosses a rooftop at dusk' })
      assert.equal(film.step, 'idea')
      const scripted = await api('productions.setScript', film.id, SCRIPT)
      assert.deepEqual(scripted.scenes.map((s) => s.heading), ['INT. ROOFTOP - DUSK', 'EXT. STREET - NIGHT'])
      const view = await api('productions.get', film.id)
      assert.equal(view.name, 'Courier film')
      assert.equal(view.scenes.length, 2)
      return []
    })
  })

  test('[journey:make_a_sequence] opens Sequences, saves a two-shot scene, and stops before a take is rendered', async () => {
    await journey('make_a_sequence', 'sequences', async () => {
      const made = await api('sequences.create', { name: 'Rooftop scene' })
      const saved = await api('sequences.save', made.id, { method: 'shots', shots: [{ prompt: PROMPT }, { prompt: PROMPT.replace('rooftop', 'street') }] })
      assert.equal(saved.shots.length, 2)
      assert.equal(saved.method, 'shots')
      assert.deepEqual(saved.shots.map((s) => s.prompt.includes('street')), [false, true])
      const got = await api('sequences.get', made.id)
      assert.equal(got.shots.length, 2)
      return []
    })
  })

  test('[journey:voice_line] opens Lines, finds the bundled voice, sees the voice engine is not set up, and stops before a line is spoken', async () => {
    await journey('voice_line', 'lines', async () => {
      const voices = await api('voices.list')
      assert.ok(voices.some((v) => v.name === 'Tess Marlow'))
      const status = await api('voices.status')
      assert.equal(status.installed, false)
      assert.equal(status.setup.models.length > 0, true)
      return []
    })
  })

  test('[journey:make_music] opens Music, reads what each engine is missing from ComfyUI, and stops before a song is queued', async () => {
    await journey('make_music', 'music', async () => {
      const status = await api('music.status')
      assert.equal(status.ready, false)
      assert.deepEqual(status.engines.map((e) => e.id).sort(), ['ace', 'minimax'])
      return ['GET /object_info']
    })
  })

  test('[journey:edit_video] opens Edit, puts a render on a new timeline, and stops before the export', async () => {
    await journey('edit_video', 'edits', async () => {
      const edit = await api('edits.create', 'Rooftop cut')
      const media = await api('edits.addOutput', { file: { path: fixtures.clip }, label: 'Rooftop' })
      const saved = await api('edits.save', edit.id, { media: { [media.id]: media }, clips: [{ id: 'c1', track: 'V1', media: media.id, start: 0, in: 0, out: media.duration, fadeIn: 0, fadeOut: 0, volume: 1, muted: false }] })
      assert.equal(saved.clips.length, 1)
      assert.ok(saved.clips[0].out > 5, `a ${saved.clips[0].out} s clip`)
      assert.equal((await api('edits.get', edit.id)).media[media.id].name, 'clip.mp4')
      assert.equal(fs.existsSync(path.join(app.data, 'videos', 'Edits')), false, 'nothing was exported')
      return []
    })
  })

  test('[journey:website_sizzle] opens Sizzle, writes and approves a storyboard for a captured site, and stops before the pieces are made', async () => {
    await journey('website_sizzle', 'sizzle', async () => {
      const site = writeSizzle(app.data, { id: 'sz000002', name: 'Acme' })
      assert.equal((await api('sizzle.list')).some((s) => s.id === site.id), true)
      const plan = { seconds: 12, music: { engine: 'ace', caption: 'driving synthwave', seconds: 20 }, scenes: [{ kind: 'screen', seconds: 3, capture: 'hero' }, { kind: 'h3', seconds: 5, prompt: 'A rocket lifts off at dawn.' }, { kind: 'title', seconds: 2, text: 'Rockets for everyone' }] }
      const saved = await api('sizzle.savePlan', site.id, plan)
      assert.equal(saved.plan.scenes.length, 3)
      const approved = await api('sizzle.approve', site.id)
      assert.equal(approved.status, 'approved')
      assert.ok(approved.approvedAt)
      return []
    })
  })

  test('[journey:replace_someone] opens Replace, checks what the swap needs from ComfyUI, and stops before the swap runs', async () => {
    await journey('replace_someone', 'replace', async () => {
      const check = await api('replace.check', 'person')
      assert.ok(check.packs.length > 0 || check.models.length > 0, 'the fake has none of the swap\'s nodes or models')
      assert.equal(check.ready, false)
      assert.ok((await api('replace.meta')).resolutions.includes('768p'))
      return ['GET /object_info']
    })
  })

  test('[journey:new_character] opens Characters, starts a new character and prices its training, and stops before any training starts', async () => {
    await journey('new_character', 'characters', async () => {
      const t = await api('training.create', { name: 'Theo', who: 'a man in his fifties' })
      assert.equal(t.who, 'a man in his fifties')
      const estimate = await api('training.estimate', t.id)
      assert.equal(estimate.where, 'modal')
      assert.ok(estimate.dollars > 0 && estimate.minutes > 0)
      assert.equal((await api('training.get', t.id)).train, null, 'training never started')
      return []
    })
  })

  test('[journey:show_me_around] opens the Dashboard, checks the computer, lists the characters and what was made, and offers the menu', async () => {
    await journey('show_me_around', 'home', async () => {
      const setup = await api('setup.check')
      assert.ok(setup.items.length > 5)
      assert.ok((await api('characters.list')).length >= 1)
      assert.ok(Array.isArray(await api('library.all')))
      return ['GET /system_stats', 'GET /object_info']
    })
  })

  test('every journey result is written as evidence', async () => {
    assert.equal(results.length, 11, results.map((r) => r.journey).join(', '))
    const file = app.evidence('journeys.json', JSON.stringify(results, null, 2))
    assert.ok(fs.statSync(file).size > 500)
  })
})
