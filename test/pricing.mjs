// Comfy Premium, stop A: what a partner-node graph costs (src/service/pricing.js), the spend guard in Comfy.submit,
// and the Comfy.org balance call (src/service/comfyaccount.js) against a stand-in for api.comfy.org. No network,
// no spend. The node definitions are ComfyUI 0.44.1's own /object_info (test/fixtures/partner-info.json).
//   node test/pricing.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import { Comfy } from '../src/service/comfy.js'
import { afterPrompt, getBalance } from '../src/service/comfyaccount.js'
import { checkSpend, normalize, priceGraph, priceLabel, readResult, specFor, usdToCredits } from '../src/service/pricing.js'

const info = JSON.parse(fs.readFileSync(new URL('./fixtures/partner-info.json', import.meta.url)))
let n = 0
const ok = async (name, fn) => {
  await fn()
  n++
  console.log(`ok  ${name}`)
}
const near = (a, b, d = 0.0005) => assert.ok(Math.abs(a - b) < d, `${a} is not ${b}`)

const seedance = (over = {}) => ({
  1: { class_type: 'ByteDance2TextToVideoNode', inputs: { model: 'Seedance 2.5', 'model.prompt': 'a fox', 'model.resolution': '720p', 'model.ratio': '16:9', 'model.duration': 5, 'model.generate_audio': true, 'model.output_format': 'mp4', seed: 0, watermark: false, ...over } },
  2: { class_type: 'SaveVideo', inputs: { video: ['1', 0], filename_prefix: 'x', format: 'auto', codec: 'auto' } }
})

await ok('Seedance 2.5, 720p, 16:9, 5 s is $1.6663 (900 px-units × 121 frames × $0.015301 per 1000)', async () => {
  const p = await priceGraph(seedance(), info)
  assert.equal(p.paid, true)
  near(p.max, (Math.floor(900 * (24 * 5 + 1)) / 1000) * 0.015301)
  assert.equal(p.min, p.max)
  assert.equal(p.credits.max, 352)
  assert.equal(p.label, 'about $1.67 · 352 credits')
})

await ok('Seedance 2.0 Mini, 480p, 5 s is about $0.25 (lower-cased model name matches "mini")', async () => {
  const p = await priceGraph(seedance({ model: 'Seedance 2.0 Mini', 'model.resolution': '480p' }), info)
  near(p.max, (5 * 10044 * 0.005005) / 1000)
  assert.equal(p.credits.max, 53)
})

await ok('duration and resolution change the price; 1080p 10 s costs more than 720p 5 s', async () => {
  const a = await priceGraph(seedance(), info)
  const b = await priceGraph(seedance({ 'model.resolution': '1080p', 'model.duration': 10 }), info)
  near(b.max, (Math.floor(2025 * (24 * 10 + 1)) / 1000) * 0.016731)
  assert.ok(b.max > a.max * 4)
})

await ok('a widget fed by a primitive node still counts', async () => {
  const g = seedance({ 'model.duration': ['9', 0] })
  g[9] = { class_type: 'PrimitiveInt', inputs: { value: 10 } }
  const p = await priceGraph(g, info)
  near(p.max, (Math.floor(900 * (24 * 10 + 1)) / 1000) * 0.015301)
})

await ok('reference videos counted from the growing input group widen Seedance reference to a range', async () => {
  const g = {
    1: { class_type: 'ByteDance2ReferenceNodeV2', inputs: { model: 'Seedance 2.5', 'model.prompt': 'x', 'model.resolution': '720p', 'model.ratio': '16:9', 'model.duration': 5, 'model.generate_audio': true, 'model.task_type': 'reference', 'model.output_format': 'mp4', 'model.reference_videos.video_1': ['5', 0], seed: 0, watermark: false } },
    5: { class_type: 'LoadVideo', inputs: { file: 'a.mp4' } }
  }
  const p = await priceGraph(g, info)
  assert.ok(p.max > p.min, 'a reference video gives a range')
  delete g[1].inputs['model.reference_videos.video_1']
  const q = await priceGraph(g, info)
  assert.equal(q.min, q.max)
})

await ok('missing widgets fall back to the schema default (Veo 3: veo-3.1-generate, 720p, no audio, 8 s = $1.60)', async () => {
  const p = await priceGraph({ 1: { class_type: 'Veo3VideoGenerationNode', inputs: { prompt: 'x' } } }, info)
  near(p.max, 0.2 * 8)
  const q = await priceGraph({ 1: { class_type: 'Veo3VideoGenerationNode', inputs: { prompt: 'x', model: 'veo-3.1-fast-generate', resolution: '1080p', generate_audio: true, duration_seconds: 6 } } }, info)
  near(q.max, 0.12 * 6)
})

await ok('a fixed range (Draft to Final) is kept as a range and labelled with both ends', async () => {
  const p = await priceGraph({ 1: { class_type: 'ByteDance2DraftToFinalVideoNode', inputs: { draft_task_id: 'abc' } } }, info)
  near(p.min, 3.2864)
  near(p.max, 29.3964)
  assert.match(p.label, /^\$3\.29 to \$29\.40 · 693 to 6,203 credits$/)
})

await ok('a node with no price, and one charged by use, are unknown and named', async () => {
  const p = await priceGraph({ 1: { class_type: 'FluxKontextProImageNode', inputs: {} }, 2: { class_type: 'ClaudeNode', inputs: {} } }, info)
  assert.equal(p.paid, true)
  assert.equal(p.unknown.length, 2)
  const claude = p.nodes.find((x) => x.class === 'ClaudeNode')
  assert.equal(claude.rate, true)
  assert.match(claude.why, /^Charged by use: \$.*per 1K tokens$/)
  assert.equal(p.label, 'Price not shown by these nodes')
})

await ok('a graph with no partner nodes is free', async () => {
  const p = await priceGraph({ 1: { class_type: 'LoadImage', inputs: { image: 'a.png' } } }, info)
  assert.equal(p.paid, false)
  assert.equal(p.label, 'Free: no paid nodes')
})

await ok('result shapes: legacy, usd, range, list, per-run and rate suffixes', async () => {
  assert.deepEqual(readResult({ usd: 0.5 }), { min: 0.5, max: 0.5 })
  assert.equal(readResult({ type: 'range_usd', min_usd: 2, max_usd: 1 }).min, 1)
  assert.equal(readResult({ type: 'list_usd', usd: [0.2, 0.4] }).max, 0.4)
  assert.equal(readResult({ type: 'usd', usd: 0.04, format: { suffix: '/Image' } }).max, 0.04)
  assert.equal(readResult({ type: 'usd', usd: 0.1, format: { suffix: '/second' } }).text, '$0.10/second')
  assert.equal(readResult({ type: 'text', text: 'Varies' }).text, 'Varies')
  assert.equal(readResult(undefined), null)
})

await ok('widget values are normalised like ComfyUI does (combos lower-cased, numbers, booleans)', async () => {
  assert.equal(normalize('Seedance 2.5', 'COMFY_DYNAMICCOMBO_V3'), 'seedance 2.5')
  assert.equal(normalize('5', 'INT'), 5)
  assert.equal(normalize('true', 'BOOLEAN'), true)
  assert.equal(normalize(7, 'COMBO'), 7)
  assert.equal(specFor(info.ByteDance2TextToVideoNode, 'model.resolution', { model: 'Seedance 2.0 Fast' })[1].options.join(','), '480p,720p')
})

await ok('checkSpend: no OK, too small an OK and an unknown price are refused; the top of the range is enough', async () => {
  const p = await priceGraph({ 1: { class_type: 'ByteDance2DraftToFinalVideoNode', inputs: { draft_task_id: 'abc' } } }, info)
  assert.throws(() => checkSpend(p, null), { code: 'needs_confirm' })
  assert.throws(() => checkSpend(p, { approvedUsd: 3.29 }), /up to \$29\.40/)
  assert.equal(checkSpend(p, { approvedUsd: 29.3964 }), true)
  const u = await priceGraph({ 1: { class_type: 'FluxKontextProImageNode', inputs: {} } }, info)
  assert.throws(() => checkSpend(u, { approvedUsd: 100 }), /does not show a price/)
  assert.equal(checkSpend(u, { approvedUsd: 0, unknownOk: true }), true)
  assert.equal(checkSpend({ paid: false }, null), true)
  assert.equal(priceLabel({ min: 0.01, max: 0.01 }), 'about $0.01 · 2 credits')
  assert.equal(usdToCredits(1), 211)
})

// ---------- a stand-in ComfyUI and api.comfy.org ----------
const queued = []
const server = http.createServer((req, res) => {
  const send = (code, body) => (res.writeHead(code, { 'Content-Type': 'application/json' }), res.end(JSON.stringify(body)))
  const m = req.url.match(/^\/object_info\/(.+)$/)
  if (m) {
    const cls = decodeURIComponent(m[1])
    return info[cls] ? send(200, { [cls]: info[cls] }) : send(404, {})
  }
  if (req.url === '/prompt' && req.method === 'POST') {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => (queued.push(JSON.parse(body)), send(200, { prompt_id: `p${queued.length}` })))
    return
  }
  if (req.url === '/customers/balance') {
    const key = req.headers['x-api-key']
    if (!key) return send(401, { message: 'No Authorization header found' })
    if (key === 'new') return send(404, { message: 'customer not found' })
    if (!['good', 'cents', 'zero', 'micros'].includes(key)) return send(401, { message: 'Invalid Comfy API key' })
    if (key === 'cents') return send(200, { amount_cents: 450, effective_balance_cents: 425, pending_charges_cents: 25, currency: 'usd' })
    // the shape Comfy.org answered with on 2026-11-08 (an account with nothing on it)
    if (key === 'zero') return send(200, { amount_cents: 0, amount_micros: 0, cloud_credit_balance_cents: 0, cloud_credit_balance_micros: 0, currency: 'usd', effective_balance_cents: 0, effective_balance_micros: 0, pending_charges_cents: 0, pending_charges_micros: 0, prepaid_balance_cents: 0, prepaid_balance_micros: 0 })
    // only the _micros fields, which (like the _cents ones) hold cents
    if (key === 'micros') return send(200, { amount_micros: 1250, effective_balance_micros: 1200, currency: 'usd' })
    // what Comfy.org answered after a $10 top-up on 2026-11-08
    return send(200, { amount_cents: 1000, amount_micros: 1000, cloud_credit_balance_cents: 0, cloud_credit_balance_micros: 0, currency: 'usd', effective_balance_cents: 1000, effective_balance_micros: 1000, pending_charges_cents: 50, pending_charges_micros: 50, prepaid_balance_cents: 1000, prepaid_balance_micros: 1000 })
  }
  send(404, {})
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}`

await ok('Comfy.submit refuses a paid graph with a key attached and no OK, and nothing reaches ComfyUI', async () => {
  const c = new Comfy(base)
  await assert.rejects(c.submit(seedance(), { api_key_comfy_org: 'k' }), { code: 'needs_confirm' })
  await assert.rejects(c.submit(seedance(), { api_key_comfy_org: 'k' }, { spend: { approvedUsd: 1 } }), /up to \$1\.67/)
  assert.equal(queued.length, 0)
})

await ok('Comfy.submit queues a paid graph with an OK for its price, and tells onPaid', async () => {
  const c = new Comfy(base)
  const paid = []
  Comfy.onPaid = (x) => paid.push(x)
  const id = await c.submit(seedance(), { api_key_comfy_org: 'k' }, { spend: { approvedUsd: 1.67 } })
  Comfy.onPaid = null
  assert.equal(id, 'p1')
  assert.equal(queued[0].extra_data.api_key_comfy_org, 'k')
  assert.equal(paid.length, 1)
  near(paid[0].price.max, 1.6663)
})

await ok('Comfy.submit without a key (a normal local render) does not price or ask', async () => {
  const c = new Comfy(base)
  await c.submit({ 1: { class_type: 'LoadImage', inputs: { image: 'a.png' } } }, { iv_studio: { kind: 'x' } })
  assert.equal(queued.length, 2)
})

await ok('balance: no key, a fake key and a key with no purchases yet', async () => {
  await assert.rejects(getBalance('', { base }), { code: 'no_key' })
  await assert.rejects(getBalance('fake', { base }), { code: 'bad_key', message: /refused this API key/ })
  const none = await getBalance('new', { base })
  assert.equal(none.usd, 0)
  assert.equal(none.newCustomer, true)
})

await ok('balance: Comfy.org figures are cents (its _micros too): $10 is 2,110 credits; the effective balance wins; an empty account reads 0', async () => {
  const b = await getBalance('good', { base })
  assert.equal(b.usd, 10)
  assert.equal(b.credits, 2110)
  assert.equal(b.prepaidUsd, 10)
  assert.equal(b.cloudUsd, 0)
  assert.equal(b.pendingUsd, 0.5)
  const m = await getBalance('micros', { base })
  assert.equal(m.usd, 12)
  assert.equal(b.fields.currency, 'usd')
  const c = await getBalance('cents', { base })
  assert.equal(c.usd, 4.25)
  assert.equal(c.pendingUsd, 0.25)
  const z = await getBalance('zero', { base })
  assert.equal(z.usd, 0)
  assert.equal(z.credits, 0)
  assert.equal(z.newCustomer, false)
})

await ok('balance: nothing listening is "offline", not a bad key', async () => {
  await assert.rejects(getBalance('good', { base: 'http://127.0.0.1:9', timeout: 3000 }), { code: 'offline' })
})

await ok('afterPrompt: the balance refresh waits for the paid prompt to finish', async () => {
  let calls = 0
  const fake = { history: async (id) => (++calls < 3 ? {} : { [id]: { status: { completed: true }, outputs: {} } }) }
  const t0 = Date.now()
  await new Promise((done) => afterPrompt(fake, 'p9', done, { every: 20 }))
  assert.equal(calls, 3)
  assert.ok(Date.now() - t0 >= 50)
})

server.close()
console.log(`\n${n} passed`)
