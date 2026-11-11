// The page tier (opt-in; design D3, D8): the built app, under the test guard, on a fake ComfyUI. Free: no network, no
// credits, no GPU work. Build first (`npm run build`), then `npm run test:ui`.
// Evidence (screenshots, the guard's marker, refusals and trace, Electron's log) goes to
// docs/backlog/evidence/<run-id>/ in the main checkout, never into this worktree.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { startFakeComfy } from '../fakes/comfyui.mjs'
import { ACCEPTED_PREFS, appDataIn, evidenceDir, freePort, launchApp, listing, prefsListing, REAL_HOME } from './driver.mjs'
import { traceRows } from './trace.mjs'

const tmpReal = fs.realpathSync(os.tmpdir())
const under = (p, dir) => p === dir || p.startsWith(dir + path.sep)
const REAL_FOLDERS = [path.join(REAL_HOME, 'Movies'), path.join(REAL_HOME, '.claude', 'skills')]
describe('page tier: the app runs guarded, in temporary folders', () => {
  let fake
  let app
  let before_
  let prefsBefore
  let outsider // a plain local server on a port no fake registered: a real ComfyUI on 8188, say
  const outsiderHits = []
  traceRows(import.meta.url, () => app)

  before(async () => {
    before_ = REAL_FOLDERS.map((d) => listing(d))
    prefsBefore = prefsListing()
    fake = await startFakeComfy({ devices: 'mps' })
    outsider = http.createServer((req, res) => (outsiderHits.push(req.url), res.end('hello')))
    await new Promise((r) => outsider.listen(0, '127.0.0.1', r))
    app = await launchApp({ name: 'app', fake })
  })

  after(async () => {
    await app?.close()
    await fake?.close()
    await new Promise((r) => outsider?.close(r))
    await new Promise((r) => setTimeout(r, 1500)) // cfprefsd writes defaults a moment after the app quits
    assert.deepEqual(prefsListing(), prefsBefore, 'an Electron or IV Studio preferences file in the real home changed during the run')
    if (fs.existsSync(ACCEPTED_PREFS)) assert.equal(appDataIn(fs.readFileSync(ACCEPTED_PREFS)), false, `${ACCEPTED_PREFS} holds app data`)
  })

  test("the main process's guard marker is present, scrubbed nothing, and puts home under the temp folder", async () => {
    const m = app.marker
    assert.equal(m.processType, 'browser')
    assert.equal(m.electron, true)
    assert.deepEqual(m.scrubbedFound, [], 'a scrubbed key reached Electron: the driver built the environment wrongly')
    assert.ok(under(fs.realpathSync(m.paths.home), tmpReal), `home is ${m.paths.home}`)
    assert.ok(under(fs.realpathSync(m.paths.videos), tmpReal), `videos is ${m.paths.videos}`)
    assert.ok(under(fs.realpathSync(m.paths.userData), tmpReal), `userData is ${m.paths.userData}`)
    assert.notEqual(m.paths.home, REAL_HOME)
    // the environment the driver built, as the main process saw it
    for (const k of ['COMFY_ORG_API_KEY', 'CIVITAI_API_KEY', 'RUNPOD_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'ELECTRON_RUN_AS_NODE']) assert.ok(!(k in app.env), k)
    assert.equal(app.env.HOME, app.home)
    assert.equal(app.env.IV_STUDIO_DATA, app.data)
    assert.equal(app.env.IV_STUDIO_USER_DATA, app.userData)
  })

  test("the app's videos folder is the seeded one", async () => {
    const state = await app.evaluate(`window.ivstudio.folders.videos()`)
    assert.equal(state.path, path.join(app.data, 'videos'))
    assert.equal(state.custom, true)
  })

  test('[page:home] opens the home page, reads its text and saves a screenshot', async () => {
    const text = await app.settle()
    assert.ok(text.length > 50, `the home page said only: ${text}`)
    assert.match(text, /dashboard/i)
    const shot = await app.screenshot('page-home.png')
    assert.ok(fs.statSync(shot).size > 1000)
    assert.ok(under(shot, evidenceDir))
    assert.deepEqual(app.crashes, [])
  })

  test('a page fetching an outside host or an unregistered local port fails at the proxy; a fake is reached', async () => {
    // the page's own policy would stop these first, so switch it off: what is left is Chromium's network stack
    await app.cdp.send('Page.setBypassCSP', { enabled: true })
    await app.cdp.send('Page.reload')
    await app.settle()
    const probe = (url) => app.evaluate(`fetch(${JSON.stringify(url)}, { mode: 'no-cors', cache: 'no-store' }).then((r) => 'reached:' + r.type, (e) => 'failed:' + e.message)`)
    const outsiderUrl = `http://127.0.0.1:${outsider.address().port}/probe-outsider`
    const closed = `http://127.0.0.1:${await freePort()}/probe-closed`
    const results = {
      fake: await probe(`${fake.url}/probe-fake`),
      outsider: await probe(outsiderUrl),
      closed: await probe(closed),
      default8188: await probe('http://127.0.0.1:8188/probe-8188'),
      example: await probe('https://example.com/probe-example')
    }
    assert.match(results.fake, /^reached:/)
    for (const k of ['outsider', 'closed', 'default8188', 'example']) assert.match(results[k], /^failed:/, `${k}: ${results[k]}`)
    // the fake saw the page's request; the outsider, which is listening, never did
    assert.ok(fake.requests.some((r) => r.path === '/probe-fake'))
    assert.deepEqual(outsiderHits, [])
    // and the failures are the dead proxy's, not a refused connection (so the loopback bypass really is off)
    const failed = app.failedRequests.filter((f) => /probe-(outsider|example|8188|closed)/.test(f.url || ''))
    assert.equal(failed.length, 4, JSON.stringify(app.failedRequests))
    for (const f of failed) assert.match(f.error, /PROXY/, `${f.url}: ${f.error}`)
    app.evidence('network-probes.json', JSON.stringify({ results, failed }, null, 2))
  })

  test('a file picker shows no dialog, gets the canned folder in the temp area, and the trace records it', async () => {
    const state = await app.evaluate(`window.ivstudio.folders.chooseVideos()`)
    assert.ok(state, 'the stub should have answered with the canned folder, not cancelled')
    assert.equal(path.basename(state.path), 'picked-videos')
    assert.ok(under(fs.realpathSync(state.path), tmpReal))
    const call = app.trace().find((t) => t.fn === 'dialog.showOpenDialog')
    assert.ok(call, JSON.stringify(app.trace()))
    assert.equal(call.title, 'Where finished videos go')
    assert.deepEqual(call.properties, ['openDirectory', 'createDirectory'])
  })

  test('asking to open an https link and to reveal a file opens nothing and the trace records both', async () => {
    const file = path.join(app.data, 'videos', 'reveal-me.mp4')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, '')
    assert.equal(await app.evaluate(`window.ivstudio.links.open('https://example.com/docs')`), true)
    assert.equal(await app.evaluate(`window.ivstudio.files.reveal(${JSON.stringify(file)})`), file)
    const shell = app.trace().filter((t) => t.fn.startsWith('shell.'))
    assert.deepEqual(shell.map((t) => [t.fn, t.arg]), [['shell.openExternal', 'https://example.com/docs'], ['shell.showItemInFolder', file]])
  })

  test('the app started no program, and the fake saw no render, upload or request it was not expecting', async () => {
    const refused = app.refusals().map((r) => `${r.kind}:${r.command}`)
    app.evidence('refused-programs.txt', `${refused.join('\n')}\n`)
    // a refused start is not a start; what must not appear is a ComfyUI launch
    assert.deepEqual(refused.filter((r) => /python|comfy|main\.py|run_|^spawn:open$|osascript/i.test(r)), [])
    assert.deepEqual(fake.prompts, [])
    assert.deepEqual(fake.uploads, [])
    const posts = fake.requests.filter((r) => r.method !== 'GET').map((r) => `${r.method} ${r.path}`)
    assert.deepEqual(posts, [], 'the fake got a request that changes something')
    assert.deepEqual(app.crashes, [])
  })

  test("the person's real Movies and skills folders are unchanged", async () => {
    const now = REAL_FOLDERS.map((d) => listing(d))
    now.forEach((l, i) => {
      const was = new Set(before_[i])
      const is = new Set(l)
      const diff = [...is].filter((x) => !was.has(x)).map((x) => `+ ${x}`).concat([...was].filter((x) => !is.has(x)).map((x) => `- ${x}`))
      assert.deepEqual(diff, [], `${REAL_FOLDERS[i]} changed during the run (another program may have touched it):\n${diff.slice(0, 10).join('\n')}`)
    })
  })
})

describe('page tier: the main process cannot reach the default ComfyUI', () => {
  let app

  before(async () => {
    app = await launchApp({ name: 'default-comfy-url', fake: null })
  })

  after(async () => {
    await app?.close()
  })

  test("with comfyUrl left at the default, the main process's fetch at src/main/index.js:1068 is refused by the guard", async () => {
    const settings = JSON.parse(fs.readFileSync(path.join(app.data, 'settings.json'), 'utf8'))
    assert.ok(!settings.comfyUrl || settings.comfyUrl === 'http://127.0.0.1:8188', 'this launch must keep the default comfyUrl')
    const models = () => app.networkRefusals().filter((r) => r.host === '127.0.0.1' && r.port === 8188 && r.path === '/experiment/models' && r.what === 'a fetch')
    const was = models().length
    // uploadModalCharacters (index.js:1068) fetches `${comfyUrl}/experiment/models` and treats a failure as "no ComfyUI on this PC"
    const value = await app.evaluate(`window.ivstudio.cloud.uploadCharacters()`)
    assert.deepEqual(value, [])
    // nothing else in a quiet launch asks for /experiment/models, so exactly this call added the refusal
    assert.equal(models().length, was + 1, `the guard recorded no refused fetch of /experiment/models: ${JSON.stringify(app.networkRefusals())}`)
  })
})
