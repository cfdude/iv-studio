// Window channels and events upstream added in v1.1.3 around the person's account, what a render will take and cost,
// and the prompt writer's film craft: usage counting and the beta signup, time estimates, the Comfy.org balance and
// key, the price of a graph, the terms notice for MiniMax H3, the OpenAI-compatible writer's status, the film craft
// tools (slate, rewrite, variants, lookbook) and the per-shot tools on a film, the Hugging Face login source, and the
// window's question about downloads to the cloud.
//
// Where main's handler is one line on a service object, the test calls that method. Where main builds the answer
// itself (src/main/index.js starts Electron, so it cannot be imported), the test COPIES the handler's glue, runs the
// real service functions under it, and pins the copy to main's source with assertCopiesMain / assertMainSends, so a
// change in main fails the test. Stand-ins: an api.comfy.org on loopback, an OpenAI-compatible writer on loopback,
// the fake ComfyUI, and a usage and beta address on loopback. Nothing here leaves this computer.
//   node --test test/unit/ipc-v113-account.test.mjs
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { after, afterEach, before, describe, test } from 'node:test'
import { getBalance } from '../../src/service/comfyaccount.js'
import { GPUS } from '../../src/service/cloud.js'
import { loadSlate, lookbook, promptVariants, rewritePrompt, writerName } from '../../src/service/filmcraft.js'
import { normalizeApiBase, openaiStatus, parseHeaders, setLlmSource } from '../../src/service/llm.js'
import { hfLoginFrom, setSavedHfToken } from '../../src/service/models.js'
import { readSettings, writerOf, writeSettings } from '../../src/service/paths.js'
import { infoFor, priceGraph } from '../../src/service/pricing.js'
import { Productions } from '../../src/service/productions.js'
import { GPUS as RUNPOD_GPUS } from '../../src/service/runpod.js'
import { Studio } from '../../src/service/studio.js'
import { ABUSE_EMAIL, acceptance, checkH3Terms, H3_RULES, H3_TERMS_DECLINED, H3_TERMS_NEEDED, H3_TERMS_VERSION, setH3Gate, termsAccepted } from '../../src/service/terms.js'
import { estimate, estimateLine, samples, shapeOfPlan } from '../../src/service/timing.js'
import { EVENTS, Usage } from '../../src/service/usage.js'
import { startFakeComfy } from '../fakes/comfyui.mjs'
import { registerPort, unregisterPort } from '../fakes/ports.mjs'
import { tempDirReal } from '../fakes/tmp.mjs'
import { assertCopiesMain, assertMainSends } from './main-source.mjs'

const tmp = () => tempDirReal('iv-v113-account-')
const resources = path.resolve('resources')
const PARTNER = JSON.parse(fs.readFileSync(new URL('../fixtures/partner-info.json', import.meta.url), 'utf8'))
const FREE_NODE = { input: { required: {} }, output: ['IMAGE'], name: 'SaveImage', display_name: 'Save Image', category: 'image' }

// a small HTTP server on loopback that the guard lets this process reach
async function serve(handler) {
  const server = http.createServer(handler)
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const { port } = server.address()
  registerPort(port)
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve) => {
        unregisterPort(port)
        server.closeAllConnections?.()
        server.close(() => resolve())
      })
  }
}
const readBody = (req) =>
  new Promise((resolve) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => resolve(body))
  })
const json = (res, code, body) => (res.writeHead(code, { 'content-type': 'application/json' }), res.end(JSON.stringify(body)))

// ---------- usage counting and the beta signup ----------
describe('window channels: usage counting and the beta signup', () => {
  let stand, got, dir, store, usage
  before(async () => {
    got = []
    stand = await serve(async (req, res) => {
      const body = await readBody(req)
      got.push({ path: req.url, body: JSON.parse(body || '{}') })
      if (req.url === '/b' && JSON.parse(body).email === 'busy@example.com') return json(res, 429, {})
      json(res, 200, {})
    })
  })
  after(() => stand.close())
  const make = (links, settings = {}) => {
    dir = tmp()
    store = { usage: null, incognito: false, betaJoined: false, ...settings }
    usage = new Usage({ dataDir: dir, version: '1.1.3', platform: 'darwin', settings: () => store, save: (p) => Object.assign(store, p), links, now: () => new Date('2026-11-10T08:00:00Z') })
    return usage
  }

  test('[ipc:usage:status] says counting is off until the person has answered, names where it would send, and never counts in Incognito', () => {
    assertCopiesMain(assert, 'usage:status', 'usage.status()')
    make({ usageUrl: `${stand.url}/u`, betaUrl: `${stand.url}/b` })
    const asked = usage.status()
    assert.equal(asked.choice, null, 'not asked yet')
    assert.equal(asked.counting, false)
    assert.equal(asked.sends, true, 'there is an address to send to')
    assert.equal(asked.waiting, 0)
    assert.equal(asked.betaOpen, true)
    assert.equal(asked.betaJoined, false)
    assert.deepEqual(asked.events, EVENTS)
    assert.equal(usage.count('app_opened'), false, 'nothing is counted before the answer')
    usage.setChoice(true)
    assert.equal(usage.count('app_opened'), true)
    assert.equal(usage.status().waiting, 1)
    store.incognito = true
    assert.equal(usage.status().counting, false, 'Incognito never counts')
    assert.equal(usage.count('app_opened'), false)
    // with no address given nothing is offered or sent
    const bare = make({}).status()
    assert.deepEqual([bare.sends, bare.betaOpen], [false, false])
  })

  test('[ipc:usage:set] turning counting on saves the choice and makes an id, and turning it off removes the id and anything waiting', () => {
    assertCopiesMain(assert, 'usage:set', 'usage.setChoice(!!on)')
    make({ usageUrl: `${stand.url}/u` })
    const on = usage.setChoice(true)
    assert.equal(on.choice, 'on')
    assert.equal(on.counting, true)
    assert.equal(store.usage, 'on', 'saved in settings')
    const id = usage.state().id
    assert.ok(id, 'an id is made')
    usage.count('render_started', 'previews')
    assert.equal(usage.state().waiting.length, 1)
    const off = usage.setChoice(false)
    assert.equal(off.choice, 'off')
    assert.equal(off.counting, false)
    assert.equal(store.usage, 'off')
    assert.equal(usage.state().id, null, 'the id is deleted')
    assert.deepEqual(usage.state().waiting, [], 'what was waiting is dropped')
    assert.notEqual(usage.setChoice(true) && usage.state().id, id, 'turning it on again makes a new id')
  })

  test('[ipc:usage:preview] shows an example row before anything is counted, then exactly the rows that would be sent, with six fields and no time of day', () => {
    assertCopiesMain(assert, 'usage:preview', 'usage.preview()')
    make({ usageUrl: `${stand.url}/u` })
    const example = usage.preview()
    assert.equal(example.length, 1)
    assert.equal(example[0].event, 'render_finished')
    assert.match(example[0].install_id, /a random id/)
    usage.setChoice(true)
    usage.count('app_opened')
    usage.count('render_finished', 'C:\\Users\\me\\secret.mp4')
    const rows = usage.preview()
    assert.deepEqual(rows, usage.state().waiting.slice(-3), 'what the next send would carry')
    assert.deepEqual(rows.map((r) => r.event), ['app_opened', 'render_finished', 'first_render'])
    for (const r of rows) assert.deepEqual(Object.keys(r).sort(), ['day', 'event', 'install_id', 'kind', 'platform', 'version'])
    assert.equal(rows[1].kind, 'other', 'a path is never counted as a kind')
    assert.equal(rows[0].day, '2026-11-10')
    assert.ok(!JSON.stringify(rows).includes('secret'))
  })

  test('[ipc:usage:joinBeta] sends only the address, version and platform to the signup address, refuses a bad address first, says why a failed signup failed, and remembers a good one', async () => {
    assertCopiesMain(assert, 'usage:joinBeta', 'usage.joinBeta(email)')
    make({ betaUrl: `${stand.url}/b` })
    got.length = 0
    await assert.rejects(usage.joinBeta('not an email'), /doesn’t look like an email address/)
    assert.equal(got.length, 0, 'a bad address sends nothing')
    await assert.rejects(usage.joinBeta('busy@example.com'), /Too many tries/)
    assert.equal(store.betaJoined, false, 'a refused signup is not remembered')
    got.length = 0
    const s = await usage.joinBeta('  me@example.com ')
    assert.equal(got.length, 1)
    assert.equal(got[0].path, '/b')
    assert.deepEqual(got[0].body, { email: 'me@example.com', version: '1.1.3', platform: 'darwin' })
    assert.equal(s.betaJoined, true)
    assert.equal(store.betaJoined, true)
    assert.equal(usage.choice(), null, 'joining the beta does not turn counting on')
    await assert.rejects(make({}).joinBeta('me@example.com'), /signup isn’t open yet/)
  })
})

// ---------- time estimates ----------
describe('window channels: time estimates', () => {
  // A copy of main's handler for timing:estimate (main starts Electron, so it cannot be imported); the drift check
  // below reads main's source and fails if this changes there. `timed` is main's cache, made fresh here per folder.
  const makeEstimate = (BASE, DATA) => {
    let timed = { at: 0, dir: null, history: [] }
    return (want) => {
      const s = readSettings(BASE)
      const where = s.target === 'cloud' ? 'cloud' : 'local'
      const plan = shapeOfPlan({ ...(want || {}), where })
      if (!plan) return null
      const dir = path.join(DATA, 'jobs')
      if (Date.now() - timed.at > 30000 || timed.dir !== dir) {
        let jobs = []
        try {
          jobs = fs
            .readdirSync(dir)
            .filter((f) => f.endsWith('.json'))
            .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
            .sort((a, b) => b.t - a.t)
            .slice(0, 200)
            .map(({ f }) => {
              try {
                return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
              } catch {
                return null
              }
            })
        } catch {}
        timed = { at: Date.now(), dir, history: samples(jobs) }
      }
      const provider = s.cloudProvider || 'modal'
      const perHour = where !== 'cloud' ? null : provider === 'runpod' ? RUNPOD_GPUS.find((g) => g.id === s.runpod?.gpu)?.perHour ?? null : provider === 'modal' ? GPUS.find((g) => g.id === s.cloud?.gpu)?.perHour ?? null : null
      const e = estimate(plan, timed.history, { perHour })
      return e ? { ...e, where, line: estimateLine(e, { where }) } : null
    }
  }
  const hunt = (seconds, where, n) => ({ kind: 'previews', status: 'success', seconds, where, finishedAt: new Date(Date.UTC(2026, 10, 1, 0, n)).toISOString(), plan: { resolved: { width: 864, height: 480, frames: 124, fps: 24, previews: 3 }, request: { megapixels: 0.4, seconds: 5, previews: 3, steps: 8 } } })
  const want = { kind: 'previews', megapixels: 0.4, seconds: 5, previews: 3, steps: 8 }
  const jobsIn = (DATA, list) => {
    fs.mkdirSync(path.join(DATA, 'jobs'), { recursive: true })
    list.forEach((j, i) => fs.writeFileSync(path.join(DATA, 'jobs', `job-${i}.json`), JSON.stringify(j)))
    fs.writeFileSync(path.join(DATA, 'jobs', 'broken.json'), '{ not json')
  }

  test('[ipc:timing:estimate] reads this computer\'s finished renders from the jobs folder and says how long the same kind of render takes, from how many, and that it is free; no estimate with no renders or no size', () => {
    const DATA = tmp()
    const BASE = DATA
    const handler = makeEstimate(BASE, DATA)
    assertCopiesMain(
      assert,
      'timing:estimate',
      `(want) => {
      const s = readSettings(BASE)
      const where = s.target === 'cloud' ? 'cloud' : 'local'
      const plan = shapeOfPlan({ ...(want || {}), where })
      if (!plan) return null
      const dir = path.join(DATA, 'jobs')
      if (Date.now() - timed.at > 30000 || timed.dir !== dir) {
        let jobs = []
        try {
          jobs = fs
            .readdirSync(dir)
            .filter((f) => f.endsWith('.json'))
            .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
            .sort((a, b) => b.t - a.t)
            .slice(0, 200)
            .map(({ f }) => {
              try {
                return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
              } catch {
                return null
              }
            })
        } catch {}
        timed = { at: Date.now(), dir, history: samples(jobs) }
      }
      const provider = s.cloudProvider || 'modal'
      const perHour = where !== 'cloud' ? null : provider === 'runpod' ? RUNPOD_GPUS.find((g) => g.id === s.runpod?.gpu)?.perHour ?? null : provider === 'modal' ? GPUS.find((g) => g.id === s.cloud?.gpu)?.perHour ?? null : null
      const e = estimate(plan, timed.history, { perHour })
      return e ? { ...e, where, line: estimateLine(e, { where }) } : null
    }`
    )
    assert.equal(handler(want), null, 'no renders yet, no estimate')
    assert.equal(makeEstimate(BASE, DATA)({ kind: 'previews', megapixels: 0, seconds: 5 }), null, 'no size, no estimate')
    jobsIn(DATA, [hunt(370, undefined, 1), hunt(380, undefined, 2), hunt(900, undefined, 3), hunt(375, undefined, 4), hunt(5, 'cloud', 5)])
    const e = makeEstimate(BASE, DATA)(want)
    assert.equal(e.basis, 'same')
    assert.equal(e.runs, 4, 'the cloud render and the broken file are left out')
    assert.ok(e.seconds >= 370 && e.seconds <= 380, `one slow run does not drag the middle: ${e.seconds}`)
    assert.equal(e.where, 'local')
    assert.equal(e.cost, null)
    assert.match(e.line, /on this computer, free \(from your last 4 renders like this\)\.$/)
  })

  test('[ipc:timing:estimate] prices a cloud estimate at the chosen GPU\'s hourly rate, and counts only the renders made in the cloud', () => {
    const DATA = tmp()
    writeSettings({ target: 'cloud', cloudProvider: 'modal', cloud: { gpu: 'L40S' } }, DATA)
    jobsIn(DATA, [hunt(600, 'cloud', 1), hunt(600, 'cloud', 2), hunt(60, undefined, 3)])
    const e = makeEstimate(DATA, DATA)(want)
    assert.equal(e.where, 'cloud')
    assert.equal(e.runs, 2)
    assert.equal(e.seconds, 600)
    assert.equal(e.cost, Math.round((600 / 3600) * GPUS.find((g) => g.id === 'L40S').perHour * 100) / 100)
    assert.match(e.line, /^About 10 minutes in your cloud, about \$0\.32 \(from your last 2 renders like this\)\.$/)
    // an unknown GPU gives a time with no price
    const DATA2 = tmp()
    writeSettings({ target: 'cloud', cloudProvider: 'modal', cloud: { gpu: 'nope' } }, DATA2)
    jobsIn(DATA2, [hunt(600, 'cloud', 1)])
    assert.equal(makeEstimate(DATA2, DATA2)(want).cost, null)
  })
})

// ---------- the Comfy.org account ----------
describe('window channels: the Comfy.org account', () => {
  let stand, requests, BASE, sent, studio, fake
  const KEY_STORE_MISSING = 'No key store here.'
  let storeOk = true
  const keysSafe = () => storeOk
  const seal = (k) => (k ? `sealed:${k}` : null)
  const comfyKey = () => readSettings(BASE).comfyApiKey?.replace(/^sealed:/, '') || null
  const send = (channel, payload) => sent.push([channel, JSON.parse(JSON.stringify(payload))])
  let api

  before(async () => {
    requests = []
    stand = await serve((req, res) => {
      if (req.url !== '/customers/balance') return json(res, 404, {})
      const key = req.headers['x-api-key']
      requests.push(key)
      if (key === 'new') return json(res, 404, { message: 'customer not found' })
      if (key !== 'good') return json(res, 401, { message: 'Invalid Comfy API key' })
      json(res, 200, { amount_cents: 1000, effective_balance_cents: 1000, prepaid_balance_cents: 1000, cloud_credit_balance_cents: 0, pending_charges_cents: 50, currency: 'usd' })
    })
    fake = await startFakeComfy({ devices: 'mps', os: 'darwin', objectInfo: { ...PARTNER, SaveImage: FREE_NODE } })
    studio = new Studio({ dataDir: tmp(), resourcesDir: resources, comfyUrl: fake.url })
  })
  after(async () => {
    await stand.close()
    await fake.close()
  })

  // A copy of main's account glue (src/main/index.js starts Electron, so it cannot be imported). main's own seal and
  // keysSafe use Electron's safeStorage (the OS key store); they are stubbed above, and only the key's safe keeping
  // is left to the page tier. Everything else, the balance call, the refusal and what is saved, runs here.
  const makeAccount = (accountApi) => {
    let account = { hasKey: false, balance: null, error: null, checking: false }
    const pushAccount = () => send('account:state', account)
    const refreshAccount = async () => {
      const key = comfyKey()
      if (!key) return (account = { hasKey: false, balance: null, error: null, checking: false }), pushAccount(), account
      account = { ...account, hasKey: true, checking: true }
      pushAccount()
      try {
        account = { hasKey: true, balance: await getBalance(key, accountApi), error: null, checking: false }
      } catch (e) {
        account = { ...account, hasKey: true, error: e.message, errorCode: e.code, checking: false }
      }
      pushAccount()
      return account
    }
    const state = () => account
    const refresh = () => refreshAccount()
    const setKey = async (key) => {
      const k = String(key || '').trim()
      if (!k) throw new Error('Paste your Comfy.org API key first.')
      if (!keysSafe()) throw new Error(KEY_STORE_MISSING)
      let balance = null
      try {
        balance = await getBalance(k, accountApi)
      } catch (e) {
        if (e.code === 'bad_key') throw e
      }
      writeSettings({ comfyApiKey: seal(k) }, BASE)
      account = { hasKey: true, balance, error: balance ? null : 'Saved, but Comfy.org could not be reached to check it.', checking: false }
      pushAccount()
      return account
    }
    const clearKey = () => {
      writeSettings({ comfyApiKey: null }, BASE)
      account = { hasKey: false, balance: null, error: null, checking: false }
      pushAccount()
      return account
    }
    return { state, refresh, setKey, clearKey }
  }
  const fresh = (base = stand.url) => {
    BASE = tmp()
    sent = []
    storeOk = true
    requests.length = 0
    api = makeAccount({ base })
    return api
  }

  test('[ipc:account:state][ipc:account:refresh][event:account:state] starts with no key, reads the balance with the saved key and tells the window first that it is checking and then the balance, and says why a refused key failed', async () => {
    assertCopiesMain(assert, 'account:state', '() => account')
    assertCopiesMain(assert, 'account:refresh', '() => refreshAccount()')
    // main's push and refresh, as copied above
    assertMainSends(
      assert,
      `const pushAccount = () => send('account:state', account)
  const refreshAccount = async () => {
    const key = comfyKey()
    if (!key) return (account = { hasKey: false, balance: null, error: null, checking: false }), pushAccount(), account
    account = { ...account, hasKey: true, checking: true }
    pushAccount()
    try {
      account = { hasKey: true, balance: await getBalance(key, accountApi), error: null, checking: false }
    } catch (e) {
      account = { ...account, hasKey: true, error: e.message, errorCode: e.code, checking: false }
    }
    pushAccount()
    return account
  }`
    )
    fresh()
    assert.deepEqual(api.state(), { hasKey: false, balance: null, error: null, checking: false })
    assert.deepEqual(await api.refresh(), { hasKey: false, balance: null, error: null, checking: false })
    assert.deepEqual(sent, [['account:state', { hasKey: false, balance: null, error: null, checking: false }]])
    assert.equal(requests.length, 0, 'with no key nothing is asked of Comfy.org')

    writeSettings({ comfyApiKey: seal('good') }, BASE)
    sent.length = 0
    const got = await api.refresh()
    assert.equal(requests[0], 'good', 'the saved key is what is sent')
    assert.deepEqual(sent.map(([c, a]) => [c, a.checking]), [['account:state', true], ['account:state', false]])
    assert.equal(sent[0][1].hasKey, true)
    assert.equal(got.balance.usd, 10)
    assert.equal(got.balance.credits, 2110)
    assert.equal(got.balance.pendingUsd, 0.5)
    assert.equal(got.error, null)
    assert.deepEqual(api.state(), got, 'account:state now says the same')
    assert.deepEqual(sent.at(-1)[1].balance.usd, 10)

    writeSettings({ comfyApiKey: seal('stale') }, BASE)
    sent.length = 0
    const bad = await api.refresh()
    assert.match(bad.error, /refused this API key/)
    assert.equal(bad.errorCode, 'bad_key')
    assert.equal(bad.hasKey, true, 'the key is still there for the person to replace')
    assert.equal(sent.at(-1)[1].errorCode, 'bad_key')
    assert.equal(sent.at(-1)[1].checking, false)
  })

  test('[ipc:account:setKey][event:account:state] checks a pasted key with Comfy.org before keeping it: a refused key is not saved, a good one is saved with its balance, and a Comfy.org that cannot be reached still keeps it and says so', async () => {
    assertCopiesMain(
      assert,
      'account:setKey',
      `async (key) => {
      const k = String(key || '').trim()
      if (!k) throw new Error('Paste your Comfy.org API key first.')
      if (!keysSafe()) throw new Error(KEY_STORE_MISSING)
      let balance = null
      try {
        balance = await getBalance(k, accountApi)
      } catch (e) {
        if (e.code === 'bad_key') throw e
      }
      writeSettings({ comfyApiKey: seal(k) }, BASE)
      account = { hasKey: true, balance, error: balance ? null : 'Saved, but Comfy.org could not be reached to check it.', checking: false }
      pushAccount()
      return account
    }`
    )
    fresh()
    await assert.rejects(api.setKey('   '), /Paste your Comfy\.org API key first\./)
    storeOk = false
    await assert.rejects(api.setKey('good'), (e) => e.message === KEY_STORE_MISSING)
    assert.equal(readSettings(BASE).comfyApiKey, null, 'with nowhere safe to keep it nothing is saved')
    storeOk = true
    await assert.rejects(api.setKey('wrong'), (e) => e.code === 'bad_key' && /refused this API key/.test(e.message))
    assert.equal(readSettings(BASE).comfyApiKey, null, 'a refused key is not saved')
    assert.deepEqual(sent, [], 'and the window is told nothing')

    const ok = await api.setKey('  good ')
    assert.equal(readSettings(BASE).comfyApiKey, 'sealed:good', 'saved, trimmed, through seal')
    assert.equal(ok.hasKey, true)
    assert.equal(ok.balance.credits, 2110)
    assert.equal(ok.error, null)
    assert.deepEqual(sent.at(-1), ['account:state', JSON.parse(JSON.stringify(ok))])

    // Comfy.org not answering: kept, with a note (the guard refuses an address no fake registered, so it reads as offline)
    const offline = fresh('http://127.0.0.1:9')
    const kept = await offline.setKey('somekey')
    assert.equal(readSettings(BASE).comfyApiKey, 'sealed:somekey')
    assert.equal(kept.balance, null)
    assert.equal(kept.error, 'Saved, but Comfy.org could not be reached to check it.')
    assert.equal(kept.hasKey, true)
  })

  test('[ipc:account:clearKey][event:account:state] removes the saved key, tells the window there is no key and no balance, and is fine when there was none', async () => {
    assertCopiesMain(
      assert,
      'account:clearKey',
      `() => {
      writeSettings({ comfyApiKey: null }, BASE)
      account = { hasKey: false, balance: null, error: null, checking: false }
      pushAccount()
      return account
    }`
    )
    fresh()
    await api.setKey('good')
    assert.ok(readSettings(BASE).comfyApiKey)
    sent.length = 0
    const cleared = api.clearKey()
    assert.deepEqual(cleared, { hasKey: false, balance: null, error: null, checking: false })
    assert.equal(readSettings(BASE).comfyApiKey, null)
    assert.deepEqual(sent, [['account:state', cleared]])
    assert.deepEqual(api.state(), cleared)
    assert.deepEqual(api.clearKey(), cleared, 'again is fine')
  })

  test('[ipc:account:price] prices a Seedance graph from ComfyUI\'s own formula with its credits, and says a graph with no partner node is free', async () => {
    const price = async (graph) => priceGraph(graph, await infoFor(studio.comfy, graph))
    assertCopiesMain(assert, 'account:price', "async (graph) => priceGraph(graph, await infoFor(studio.comfy, graph))")
    const seedance = { 1: { class_type: 'ByteDance2TextToVideoNode', inputs: { model: 'Seedance 2.5', 'model.prompt': 'a fox', 'model.resolution': '720p', 'model.ratio': '16:9', 'model.duration': 5, 'model.generate_audio': true, 'model.output_format': 'mp4', seed: 0, watermark: false } }, 2: { class_type: 'SaveVideo', inputs: { video: ['1', 0], filename_prefix: 'x' } } }
    const paid = await price(seedance)
    assert.equal(paid.paid, true)
    assert.equal(paid.credits.max, 352)
    assert.equal(paid.label, 'about $1.67 · 352 credits')
    assert.equal(paid.min, paid.max)
    const free = await price({ 1: { class_type: 'SaveImage', inputs: { images: ['9', 0], filename_prefix: 'x' } } })
    assert.equal(free.paid, false)
    assert.equal(free.max, 0)
  })
})

// ---------- terms for MiniMax H3 ----------
describe('window channels: terms for MiniMax H3', () => {
  let BASE, sent, win
  const send = (channel, payload) => sent.push([channel, JSON.parse(JSON.stringify(payload))])
  // A copy of main's terms glue (src/main/index.js starts Electron, so it cannot be imported); the drift checks below
  // read main's source and fail if it changes there.
  let termsAsk = null // { promise, resolve }
  const termsState = () => {
    const s = readSettings(BASE)
    return { accepted: termsAccepted(s), at: s.h3Terms?.at || null, version: H3_TERMS_VERSION, rules: H3_RULES, abuseEmail: ABUSE_EMAIL, asking: termsAsk?.what || null }
  }
  const settleTerms = (ok) => {
    if (ok) {
      writeSettings({ h3Terms: acceptance() }, BASE)
      send('terms:changed', termsState())
    }
    termsAsk?.resolve(!!ok)
    termsAsk = null
    return termsState()
  }
  const gate = async (what) => {
    if (termsAccepted(readSettings(BASE))) return
    if (!win || win.isDestroyed()) throw new Error(H3_TERMS_NEEDED)
    if (!termsAsk) {
      let resolve
      const promise = new Promise((r) => (resolve = r))
      termsAsk = { promise, resolve, what }
      send('terms:ask', { what })
    }
    if (!(await termsAsk.promise)) throw new Error(H3_TERMS_DECLINED)
  }
  before(() => {
    assertMainSends(
      assert,
      `let termsAsk = null // { promise, resolve }
  const termsState = () => {
    const s = readSettings(BASE)
    return { accepted: termsAccepted(s), at: s.h3Terms?.at || null, version: H3_TERMS_VERSION, rules: H3_RULES, abuseEmail: ABUSE_EMAIL, asking: termsAsk?.what || null }
  }
  const settleTerms = (ok) => {
    if (ok) {
      writeSettings({ h3Terms: acceptance() }, BASE)
      send('terms:changed', termsState())
    }
    termsAsk?.resolve(!!ok)
    termsAsk = null
    return termsState()
  }
  setH3Gate(async (what) => {
    if (termsAccepted(readSettings(BASE))) return
    if (!win || win.isDestroyed()) throw new Error(H3_TERMS_NEEDED)
    if (!termsAsk) {
      let resolve
      const promise = new Promise((r) => (resolve = r))
      termsAsk = { promise, resolve, what }
      send('terms:ask', { what })
    }
    if (!(await termsAsk.promise)) throw new Error(H3_TERMS_DECLINED)
  })`
    )
    assertCopiesMain(assert, 'terms:state', '() => termsState()')
    assertCopiesMain(assert, 'terms:accept', '() => settleTerms(true)')
    assertCopiesMain(assert, 'terms:answer', '(ok) => settleTerms(ok)')
    setH3Gate(gate)
  })
  after(() => setH3Gate(null))
  afterEach(() => {
    termsAsk = null
  })
  const reset = () => {
    BASE = tmp()
    sent = []
    win = { isDestroyed: () => false }
    termsAsk = null
  }
  const settled = (p) => Promise.race([p.then(() => 'resolved', () => 'rejected'), new Promise((r) => setTimeout(() => r('pending'), 30))])

  test('[ipc:terms:state] says the terms are not accepted yet with this version, the rules to read and the address for reports, and, once accepted, when', () => {
    reset()
    const before = termsState()
    assert.equal(before.accepted, false)
    assert.equal(before.at, null)
    assert.equal(before.version, H3_TERMS_VERSION)
    assert.equal(before.abuseEmail, ABUSE_EMAIL)
    assert.equal(before.asking, null)
    assert.equal(before.rules.length, 10)
    assert.deepEqual(before.rules, H3_RULES)
    settleTerms(true)
    const after = termsState()
    assert.equal(after.accepted, true)
    assert.match(after.at, /^\d{4}-\d{2}-\d{2}T/)
    // an acceptance of an older version of the terms counts as not accepted, so the person is asked again
    writeSettings({ h3Terms: { version: '2026-01-01', at: '2026-01-02T00:00:00.000Z' } }, BASE)
    assert.equal(termsState().accepted, false)
  })

  test('[ipc:terms:accept][event:terms:changed] saves the acceptance from Settings without any question open, and tells the window the terms now read accepted', () => {
    reset()
    const state = settleTerms(true)
    assert.equal(state.accepted, true)
    assert.equal(readSettings(BASE).h3Terms.version, H3_TERMS_VERSION, 'kept in settings')
    assert.equal(sent.length, 1)
    assert.equal(sent[0][0], 'terms:changed')
    assert.equal(sent[0][1].accepted, true)
    assert.deepEqual(Object.keys(sent[0][1]).sort(), ['abuseEmail', 'accepted', 'asking', 'at', 'rules', 'version'])
    assert.equal(sent[0][1].at, state.at)
  })

  test('[ipc:terms:answer][event:terms:ask] a first H3 render asks the window once and waits, a second render meanwhile waits for the same answer, and an OK lets both go and later renders are not asked', async () => {
    reset()
    const first = checkH3Terms(null, 'render')
    const second = checkH3Terms({ 1: { class_type: 'MiniMaxH3ImageToVideo', inputs: {} } }, 'render')
    assert.equal(await settled(first), 'pending', 'it waits for the person')
    assert.deepEqual(sent, [['terms:ask', { what: 'render' }]], 'one question, naming what is being done')
    assert.equal(termsState().asking, 'render', 'terms:state shows the open question')
    const after = settleTerms(true)
    assert.equal(after.asking, null)
    assert.equal(await settled(first), 'resolved')
    assert.equal(await settled(second), 'resolved')
    assert.deepEqual(sent.map(([c]) => c), ['terms:ask', 'terms:changed'])
    await checkH3Terms(null, 'training')
    assert.equal(sent.length, 2, 'accepted, so nothing is asked again')
    // a graph that does not use H3 is never asked about
    reset()
    await checkH3Terms({ 1: { class_type: 'SaveImage', inputs: {} } }, 'render')
    assert.deepEqual(sent, [])
  })

  test('[ipc:terms:answer][event:terms:changed] a no stops the render with the declined message, saves nothing and tells the window nothing changed; with no window the render is refused without asking', async () => {
    reset()
    const run = checkH3Terms(null, 'training')
    const refused = assert.rejects(run, (e) => e.message === H3_TERMS_DECLINED)
    assert.deepEqual(sent, [['terms:ask', { what: 'training' }]])
    const state = settleTerms(false)
    await refused
    assert.equal(state.accepted, false)
    assert.equal(readSettings(BASE).h3Terms, null, 'nothing saved')
    assert.deepEqual(sent.map(([c]) => c), ['terms:ask'], 'no terms:changed')
    assert.equal(termsState().asking, null)
    // the person can still be asked again the next time
    const again = checkH3Terms(null, 'render')
    assert.equal(await settled(again), 'pending')
    settleTerms(true)
    await again

    reset()
    win = null
    await assert.rejects(checkH3Terms(null, 'render'), (e) => e.message === H3_TERMS_NEEDED)
    assert.deepEqual(sent, [], 'no window, no question')
    win = { isDestroyed: () => true }
    await assert.rejects(checkH3Terms(null, 'render'), (e) => e.message === H3_TERMS_NEEDED)
  })
})

// ---------- the Hugging Face login, and the window's question about the cloud ----------
describe('window channels: the Hugging Face login and the question about the cloud', () => {
  test('[ipc:models:hfLogin] says where the Hugging Face token comes from: IV Studio\'s own, then the environment, then the hf login file, else nothing', () => {
    // main calls hfLoginFrom() with the real environment and home; the test gives it its own so it never reads the person's
    assertCopiesMain(assert, 'models:hfLogin', '() => ({ from: hfLoginFrom(env, home) })', { 'hfLoginFrom()': 'hfLoginFrom(env, home)' })
    const home = tmp()
    const hfLogin = (env) => ({ from: hfLoginFrom(env, home) })
    setSavedHfToken(null)
    assert.deepEqual(hfLogin({}), { from: null }, 'nothing anywhere')
    fs.mkdirSync(path.join(home, '.cache', 'huggingface'), { recursive: true })
    fs.writeFileSync(path.join(home, '.cache', 'huggingface', 'token'), 'hf_filetoken\n')
    assert.deepEqual(hfLogin({}), { from: 'hf' }, 'the hf login file')
    assert.deepEqual(hfLogin({ HF_TOKEN: 'hf_env' }), { from: 'env' }, 'the environment wins over the file')
    assert.deepEqual(hfLogin({ HUGGING_FACE_HUB_TOKEN: 'hf_env2' }), { from: 'env' })
    try {
      setSavedHfToken('hf_saved')
      assert.deepEqual(hfLogin({ HF_TOKEN: 'hf_env' }), { from: 'iv' }, 'the one saved in IV Studio wins over both')
    } finally {
      setSavedHfToken(null)
    }
    fs.writeFileSync(path.join(home, '.cache', 'huggingface', 'token'), '   \n')
    assert.deepEqual(hfLogin({}), { from: null }, 'an empty file is no login')
  })

  test('[ipc:cloud:answer][event:cloud:ask] asks the window to go ahead with downloads to the cloud, waits for its answer by id, and a no, an unknown id or no window all end in no or a harmless yes', async () => {
    const sent = []
    let win = { isDestroyed: () => false }
    const send = (channel, payload) => sent.push([channel, JSON.parse(JSON.stringify(payload))])
    // a copy of main's glue; the closure is main's own state (the question waits in a Map until the window answers)
    assertMainSends(
      assert,
      `const asks = new Map()
  const askWindow = (details) =>
    new Promise((resolve) => {
      if (!win || win.isDestroyed()) return resolve(false)
      const id = randomBytes(6).toString('hex')
      asks.set(id, resolve)
      send('cloud:ask', { id, ...details })
    })`
    )
    assertCopiesMain(
      assert,
      'cloud:answer',
      `({ id, ok }) => {
    asks.get(id)?.(!!ok)
    asks.delete(id)
    return true
  }`
    )
    const asks = new Map()
    const askWindow = (details) =>
      new Promise((resolve) => {
        if (!win || win.isDestroyed()) return resolve(false)
        const id = randomBytes(6).toString('hex')
        asks.set(id, resolve)
        send('cloud:ask', { id, ...details })
      })
    const answer = ({ id, ok }) => {
      asks.get(id)?.(!!ok)
      asks.delete(id)
      return true
    }
    const details = { downloads: [{ id: 'voice', label: 'The voice engine', size: 1234 }], bytes: 1234, grow: false, provider: 'runpod' }
    const yes = askWindow(details)
    const no = askWindow({ ...details, bytes: 99 })
    assert.equal(sent.length, 2)
    assert.equal(sent[0][0], 'cloud:ask')
    assert.match(sent[0][1].id, /^[0-9a-f]{12}$/)
    assert.notEqual(sent[0][1].id, sent[1][1].id, 'each question has its own id')
    assert.deepEqual({ ...sent[0][1], id: undefined }, { ...details, id: undefined }, 'the details come along')
    assert.equal(answer({ id: sent[1][1].id, ok: false }), true)
    assert.equal(await no, false, 'a no')
    assert.equal(answer({ id: sent[0][1].id, ok: 1 }), true)
    assert.equal(await yes, true, 'a yes')
    assert.equal(asks.size, 0, 'answered questions are forgotten')
    assert.equal(answer({ id: 'unknown', ok: true }), true, 'an answer to nothing is harmless')
    win = null
    assert.equal(await askWindow(details), false, 'no window means no')
    assert.equal(sent.length, 2, 'and nothing is sent')
  })
})

// ---------- the OpenAI-compatible writer, film craft and the per-shot tools on a film ----------
const PROMPT = 'integrated_multimodal_description: [Shot 1] Live-action. A woman waits at a bus stop in the rain and says <d>[English] Late again.</d>\n\noverall_soundscape: Rain on the roof.\n\nnon_diegetic_music: N/A'
const PROMPT_B = PROMPT.replace('waits', 'sits')

describe('window channels: the prompt writer and film craft', () => {
  let stand, fake, studio, BASE, seen, modelsSeen, films, film, scene, shots
  // what the stand-in writer sends back for each kind of ask; a test changes these
  let rewriteTo, variantsWith
  const state = { modelsStatus: 200 }
  const llmUnseal = (v) => v
  // A copy of main's llmOf (src/main/index.js); the key and headers come from settings as they are, without safeStorage.
  const unseal = llmUnseal
  const llmOf = (s) => {
    let headers = {}
    try {
      headers = parseHeaders(unseal(s.openaiHeaders) || '')
    } catch {}
    return { provider: s.promptEngine === 'openai' ? 'openai' : 'ollama', url: s.openaiUrl, model: s.openaiModel, vision: !!s.openaiVision, key: unseal(s.openaiKey) || '', headers }
  }
  const writerNow = () => writerOf(readSettings(BASE))
  const busyGpu = () => studio.gpuBusy().catch(() => false)
  const slate = () => loadSlate(resources)

  before(async () => {
    seen = []
    modelsSeen = []
    stand = await serve(async (req, res) => {
      if (req.url === '/v1/models') {
        modelsSeen.push(req.headers)
        if (state.modelsStatus !== 200) return json(res, state.modelsStatus, { error: { message: 'bad key' } })
        return json(res, 200, { data: [{ id: 'craft' }, { id: 'craft-vision' }] })
      }
      const j = JSON.parse((await readBody(req)) || '{}')
      const sys = j.messages[0].content
      const user = j.messages.at(-1).content
      seen.push({ sys, user })
      const answer = (o) => json(res, 200, { choices: [{ message: { content: JSON.stringify(o) } }] })
      if (/script supervisor/.test(sys)) return answer({ issues: [{ severity: 'error', shots: ['1.2'], issue: 'Her coat turns red.', fix: 'Say "grey coat" in shot 1.2.' }] })
      if (/^You are a cinematographer/.test(sys)) return answer({ tone: 'Melancholy, hushed.', palette: 'Teal and amber, Wong Kar-wai style.', lighting: 'Neon spill.', lens: 'Long lens.', movement: 'Step-printed handheld.', blocking: 'Close and cramped.', texture: 'Heavy grain.' })
      if (/three variants/.test(sys)) return answer({ variants: variantsWith() })
      if (/collaborator who edits/.test(sys)) return answer({ prompt: rewriteTo(), reply: 'Made her colder.' })
      answer({})
    })
    fake = await startFakeComfy({ devices: 'mps', os: 'darwin' })
    studio = new Studio({ dataDir: tmp(), resourcesDir: resources, comfyUrl: fake.url })
    BASE = tmp()
    writeSettings({ promptEngine: 'openai', openaiUrl: `${stand.url}/v1`, openaiModel: 'craft', openaiVision: true, openaiKey: 'secret-key', openaiHeaders: 'X-Test: yes' }, BASE)
    // main points the writer at the saved settings: setLlmSource(() => llmOf(readSettings(BASE)))
    setLlmSource(() => llmOf(readSettings(BASE)))
    films = new Productions({ dataDir: tmp(), studio: () => studio, writer: () => writerNow() })
  })
  after(async () => {
    setLlmSource(null)
    await stand.close()
    await fake.close()
  })

  test('[ipc:prompts:openai] says the OpenAI-compatible server answers at the saved address with its models, the chosen model and whether it sees pictures, sends the saved key and headers, and says why when it does not answer or refuses the key', async () => {
    assertCopiesMain(
      assert,
      'prompts:openai',
      `async () => {
    const s = readSettings(BASE)
    return { ...(await openaiStatus({ ...llmOf(s), provider: 'openai' })), model: s.openaiModel || '', vision: !!s.openaiVision }
  }`
    )
    assertMainSends(
      assert,
      `const llmOf = (s) => {
  let headers = {}
  try {
    headers = parseHeaders(unseal(s.openaiHeaders) || '')
  } catch {}
  return { provider: s.promptEngine === 'openai' ? 'openai' : 'ollama', url: s.openaiUrl, model: s.openaiModel, vision: !!s.openaiVision, key: unseal(s.openaiKey) || '', headers }
}`
    )
    const status = async () => {
      const s = readSettings(BASE)
      return { ...(await openaiStatus({ ...llmOf(s), provider: 'openai' })), model: s.openaiModel || '', vision: !!s.openaiVision }
    }
    const up = await status()
    assert.deepEqual(up, { ok: true, url: `${stand.url}/v1`, models: ['craft', 'craft-vision'], error: null, model: 'craft', vision: true })
    assert.equal(modelsSeen.at(-1).authorization, 'Bearer secret-key')
    assert.equal(modelsSeen.at(-1)['x-test'], 'yes')

    state.modelsStatus = 401
    const refused = await status()
    state.modelsStatus = 200
    assert.equal(refused.ok, false)
    assert.match(refused.error, /refused the key \(401\): bad key/)
    assert.equal(refused.model, 'craft')

    const saved = readSettings(BASE)
    try {
      writeSettings({ openaiUrl: '' }, BASE)
      const none = await status()
      assert.deepEqual([none.ok, none.error, none.models], [false, 'No address yet.', []])
      writeSettings({ openaiUrl: 'http://127.0.0.1:9/v1' }, BASE)
      const down = await status()
      assert.equal(down.ok, false)
      assert.match(down.error, /Nothing answered at http:\/\/127\.0\.0\.1:9\/v1/)
    } finally {
      writeSettings({ openaiUrl: saved.openaiUrl }, BASE)
    }
    assert.equal(normalizeApiBase('localhost:8080'), 'http://localhost:8080/v1', 'a bare address gets the usual path')
  })

  test('[ipc:craft:slate] gives the cinematography setups in their 12 groups and the 12 coverage plans, and names the writer the person chose', () => {
    assertCopiesMain(assert, 'craft:slate', "() => ({ setups: slate().setups, plans: slate().plans, writer: writerName(writerNow()) })")
    const out = { setups: slate().setups, plans: slate().plans, writer: writerName(writerNow()) }
    assert.equal(out.setups.length, 12)
    assert.equal(out.setups.reduce((n, g) => n + g.items.length, 0), 165)
    assert.equal(out.plans.length, 12)
    assert.deepEqual(out.plans.find((p) => p.id === 'dialogue-coverage').shots.map((x) => x.slot), ['Master', 'OTS A', 'OTS B', 'CU A', 'CU B', 'Reaction'])
    assert.equal(out.writer, 'the OpenAI-compatible writer')
    writeSettings({ promptEngine: 'claude' }, BASE)
    try {
      assert.equal(writerName(writerNow()), 'Claude Code')
      writeSettings({ promptEngine: 'local' }, BASE)
      assert.equal(writerName(writerNow()), 'the local writer')
    } finally {
      writeSettings({ promptEngine: 'openai' }, BASE)
    }
  })

  test('[ipc:craft:rewrite] rewrites a prompt through the chosen writer with the director\'s note and the film\'s context, lists the words the rewrite dropped, and says what is missing when there is no prompt or note', async () => {
    assertCopiesMain(assert, 'craft:rewrite', 'async ({ prompt, tool, note, context } = {}) => rewritePrompt(writerNow(), { prompt, tool, note, context, cpu: await busyGpu() })')
    const rewrite = async ({ prompt, tool, note, context } = {}) => rewritePrompt(writerNow(), { prompt, tool, note, context, cpu: await busyGpu() })
    rewriteTo = () => PROMPT.replace('waits', 'waits, shoulders hunched,')
    const r = await rewrite({ prompt: PROMPT, tool: 'note', note: 'make her colder', context: { film: 'Dry Seat', keep: ['bus stop'] } })
    assert.match(r.prompt, /shoulders hunched/)
    assert.equal(r.reply, 'Made her colder.')
    assert.deepEqual(r.missing, [])
    assert.match(seen.at(-1).user, /director gives this note: "make her colder"/)
    assert.match(seen.at(-1).user, /Film: Dry Seat/)
    assert.match(seen.at(-1).user, /Keep these words exactly as they are: "bus stop"/)
    // a rewrite that loses the spoken line says so
    rewriteTo = () => PROMPT.replace(/<d>.*?<\/d>/, '')
    assert.deepEqual((await rewrite({ prompt: PROMPT, tool: 'tighten' })).missing, ['<d>[English] Late again.</d>'])
    assert.match(seen.at(-1).user, /Shorten this prompt by about a third/)
    await assert.rejects(rewrite(), /Write or generate the prompt first\./)
    await assert.rejects(rewrite({ prompt: PROMPT, tool: 'note', note: ' ' }), /Write the note first\./)
  })

  test('[ipc:craft:variants] gives three versions of a prompt with their labels and marks the one that lost a spoken line', async () => {
    assertCopiesMain(assert, 'craft:variants', 'async ({ prompt, context } = {}) => promptVariants(writerNow(), { prompt, context, cpu: await busyGpu() })')
    const variants = async ({ prompt, context } = {}) => promptVariants(writerNow(), { prompt, context, cpu: await busyGpu() })
    variantsWith = () => [{ label: 'Light first', prompt: PROMPT.replace('Rain on', 'Hard rain on') }, { label: 'Composition first', prompt: PROMPT }, { label: 'Lost a line', prompt: PROMPT.replace(/<d>.*?<\/d>/, '') }]
    const v = await variants({ prompt: PROMPT, context: { scene: 'Bus stop' } })
    assert.deepEqual(v.map((x) => x.label), ['Light first', 'Composition first', 'Lost a line'])
    assert.deepEqual(v.map((x) => x.missing.length), [0, 0, 1])
    assert.deepEqual(v[2].missing, ['<d>[English] Late again.</d>'])
    assert.match(seen.at(-1).user, /Scene: Bus stop/)
    await assert.rejects(variants(), /Write or generate the prompt first\./)
  })

  test('[ipc:craft:lookbook] turns a named look into the seven look fields and one paragraph of words with the name taken out, and asks for a name when there is none', async () => {
    assertCopiesMain(assert, 'craft:lookbook', 'async (source) => lookbook(writerNow(), { source, cpu: await busyGpu() })')
    const book = async (source) => lookbook(writerNow(), { source, cpu: await busyGpu() })
    const look = await book('Wong Kar-wai')
    assert.equal(look.source, 'Wong Kar-wai')
    assert.deepEqual(Object.keys(look.fields), ['tone', 'palette', 'lighting', 'lens', 'movement', 'blocking', 'texture'])
    assert.equal(look.fields.lens, 'Long lens.')
    assert.match(look.words, /^Melancholy, hushed\. Teal and amber/)
    assert.ok(!/wong kar-wai/i.test(look.words), look.words)
    assert.match(seen.at(-1).user, /The look: Wong Kar-wai/)
    await assert.rejects(book(''), /Name a film, director or cinematographer/)
  })

  // a film with a scene and two shots that have prompts
  const makeFilm = () => {
    const p = films.create({ name: 'Dry Seat', script: 'EXT. BUS STOP - NIGHT\n\nTess waits.\n\nTESS\nLate again.\n' })
    const sc = films.get(p.id).scenes[0]
    films.editShot(p.id, sc.id, null, { add: true, action: 'Tess waits.', prompt: PROMPT })
    films.editShot(p.id, sc.id, null, { add: true, action: 'Theo arrives.', prompt: PROMPT_B })
    film = p.id
    scene = sc.id
    shots = films.get(p.id).scenes[0].shots.map((s) => s.id)
    return p
  }
  const shotNow = (n) => films.get(film).scenes[0].shots[n]

  test('[ipc:productions:coverage] sets the coverage plan the person picked on a scene, marks a scene that already has shots as needing a new breakdown, and clears it for no plan or an unknown plan', () => {
    assertCopiesMain(assert, 'productions:coverage', "(id, sceneId, planId) => productions.setCoverage(id, sceneId, planId ? slate().plans.find((p) => p.id === planId) || null : null)")
    const productions = films
    const coverage = (id, sceneId, planId) => productions.setCoverage(id, sceneId, planId ? slate().plans.find((p) => p.id === planId) || null : null)
    const p = films.create({ name: 'Covered', script: 'INT. KITCHEN - DAY\n\nTess cooks.\n' })
    const sc = films.get(p.id).scenes[0]
    const set = coverage(p.id, sc.id, 'dialogue-coverage')
    assert.equal(set.scenes[0].coverage.id, 'dialogue-coverage')
    assert.equal(set.scenes[0].coverage.label, 'Dialogue Coverage')
    assert.deepEqual(set.scenes[0].coverage.shots.map((x) => x.slot), ['Master', 'OTS A', 'OTS B', 'CU A', 'CU B', 'Reaction'])
    assert.ok(!set.scenes[0].stale, 'a scene with no shots has nothing to redo')
    films.editShot(p.id, sc.id, null, { add: true, prompt: PROMPT })
    const redo = coverage(p.id, sc.id, 'full-coverage')
    assert.ok(redo.scenes[0].stale, 'a scene that has shots is marked to break down again')
    assert.equal(redo.scenes[0].coverage.id, 'full-coverage')
    assert.equal(coverage(p.id, sc.id, '').scenes[0].coverage, null, 'no plan clears it')
    assert.equal(coverage(p.id, sc.id, 'no-such-plan').scenes[0].coverage, null, 'an unknown plan clears it')
    assert.throws(() => coverage(p.id, 'nope', 'dialogue-coverage'), /No such scene\./)
  })

  test('[ipc:productions:rework] rewrites a shot\'s prompt with a director\'s note, keeps the old prompt in the shot\'s history with the note, names what the rewrite dropped, and refuses a shot that is not there', async () => {
    assertCopiesMain(assert, 'productions:rework', '(id, sceneId, shotId, opts) => productions.reworkShot(id, sceneId, shotId, opts)')
    makeFilm()
    rewriteTo = () => PROMPT.replace('waits', 'waits, shoulders hunched,').replace(/<d>.*?<\/d>/, '')
    const r = await films.reworkShot(film, scene, shots[0], { tool: 'note', note: 'colder', keep: [] })
    assert.match(r.prompt, /shoulders hunched/)
    assert.deepEqual(r.missing, ['<d>[English] Late again.</d>'])
    assert.equal(shotNow(0).prompt, r.prompt, 'the shot has the new prompt')
    assert.equal(shotNow(0).history[0].prompt, PROMPT, 'and remembers the old one')
    assert.equal(shotNow(0).history[0].why, 'note: colder')
    assert.match(seen.at(-1).user, /Film: Dry Seat/)
    assert.match(seen.at(-1).user, /Scene: EXT\. BUS STOP - NIGHT/)
    await films.reworkShot(film, scene, shots[1], { tool: 'tighten' })
    assert.equal(shotNow(1).history[0].why, 'tighten')
    await assert.rejects(films.reworkShot(film, scene, 'nope', {}), /No such shot\./)
  })

  test('[ipc:productions:variants] gives three versions of a shot\'s prompt with the film\'s context and leaves the shot\'s own prompt as it was', async () => {
    assertCopiesMain(assert, 'productions:variants', '(id, sceneId, shotId) => productions.shotVariants(id, sceneId, shotId)')
    makeFilm()
    variantsWith = () => [{ label: 'Light first', prompt: PROMPT.replace('Rain on', 'Hard rain on') }, { label: 'Composition first', prompt: PROMPT }, { label: 'Lost a line', prompt: PROMPT.replace(/<d>.*?<\/d>/, '') }]
    const v = await films.shotVariants(film, scene, shots[0])
    assert.deepEqual(v.map((x) => x.label), ['Light first', 'Composition first', 'Lost a line'])
    assert.deepEqual(v[2].missing, ['<d>[English] Late again.</d>'])
    assert.match(seen.at(-1).user, /Film: Dry Seat/)
    assert.equal(shotNow(0).prompt, PROMPT, 'nothing is changed until one is picked')
    assert.deepEqual(shotNow(0).history || [], [])
    await assert.rejects(films.shotVariants(film, scene, 'nope'), /No such shot\./)
  })

  test('[ipc:productions:setPrompt] sets a shot\'s prompt, keeps the old one in its history with why it changed (edited when no reason is given), changes nothing for the same prompt, and refuses a shot that is not there', () => {
    assertCopiesMain(assert, 'productions:setPrompt', '(id, sceneId, shotId, prompt, why) => productions.setShotPrompt(id, sceneId, shotId, prompt, why)')
    makeFilm()
    films.setShotPrompt(film, scene, shots[0], 'typed by hand', undefined)
    assert.equal(shotNow(0).prompt, 'typed by hand')
    assert.deepEqual(shotNow(0).history.map((h) => [h.prompt, h.why]), [[PROMPT, 'edited']])
    films.setShotPrompt(film, scene, shots[0], 'a picked variant', 'variant: Light first')
    assert.equal(shotNow(0).history[0].why, 'variant: Light first')
    assert.equal(shotNow(0).history.length, 2)
    films.setShotPrompt(film, scene, shots[0], 'a picked variant', 'again')
    assert.equal(shotNow(0).history.length, 2, 'the same prompt adds nothing')
    assert.equal(shotNow(1).prompt, PROMPT_B, 'the other shot is untouched')
    assert.throws(() => films.setShotPrompt(film, scene, 'nope', 'x'), /No such shot\./)
  })

  test('[ipc:productions:restorePrompt] puts an earlier prompt back from the shot\'s history, keeps the one it replaces in the history, and says there is nothing to go back to when there is no such entry', () => {
    assertCopiesMain(assert, 'productions:restorePrompt', '(id, sceneId, shotId, index) => productions.restoreShotPrompt(id, sceneId, shotId, index)')
    makeFilm()
    assert.throws(() => films.restoreShotPrompt(film, scene, shots[0], 0), /Nothing to go back to\./, 'a shot with no history')
    films.setShotPrompt(film, scene, shots[0], 'first edit', 'edited')
    films.setShotPrompt(film, scene, shots[0], 'second edit', 'edited')
    assert.deepEqual(shotNow(0).history.map((h) => h.prompt), ['first edit', PROMPT])
    films.restoreShotPrompt(film, scene, shots[0], 1)
    assert.equal(shotNow(0).prompt, PROMPT, 'the original is back')
    assert.deepEqual(shotNow(0).history.map((h) => [h.prompt, h.why]), [['second edit', 'before going back'], ['first edit', 'edited']])
    films.restoreShotPrompt(film, scene, shots[0], undefined)
    assert.equal(shotNow(0).prompt, 'second edit', 'no index means the newest')
    assert.throws(() => films.restoreShotPrompt(film, scene, shots[0], 9), /Nothing to go back to\./)
  })

  test('[ipc:productions:continuity] has the writer read the scene\'s shots in order, returns the mismatches with the shots and the fix, keeps them on the scene, and needs two shots with prompts', async () => {
    assertCopiesMain(assert, 'productions:continuity', '(id, sceneId) => productions.checkContinuity(id, sceneId)')
    makeFilm()
    const issues = await films.checkContinuity(film, scene)
    assert.deepEqual(issues, [{ severity: 'error', shots: ['1.2'], issue: 'Her coat turns red.', fix: 'Say "grey coat" in shot 1.2.' }])
    const saved = films.get(film).scenes[0].continuity
    assert.deepEqual(saved.issues, issues)
    assert.equal(saved.writer, 'local')
    assert.match(saved.at, /^\d{4}-\d{2}-\d{2}T/)
    assert.match(seen.at(-1).user, /--- 1\.1 ---/)
    assert.match(seen.at(-1).user, /--- 1\.2 ---/)
    const lone = films.create({ name: 'Lone', script: 'INT. ROOM - DAY\n\nTess sits.\n' })
    const lscene = films.get(lone.id).scenes[0].id
    films.editShot(lone.id, lscene, null, { add: true, prompt: PROMPT })
    await assert.rejects(films.checkContinuity(lone.id, lscene), /at least two shots/)
    await assert.rejects(films.checkContinuity(lone.id, 'nope'), /No such scene\./)
  })
})
