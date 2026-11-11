// The chat's spending limit (src/service/spending.js): the rules, the record, the app's spend desk, and the whole path
// inside the built MCP server (out/main/mcp.js; run `npx electron-vite build` first) against a stand-in ComfyUI that
// prices Seedance from ComfyUI's own node definitions (test/fixtures/partner-info.json). Nothing is spent: the
// stand-in only writes down what it was sent.
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import fs from 'node:fs'
import http from 'node:http'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { addSpend, budgetOf, decideSpend, readLedger, spendDeskClient, spentToday, startSpendDesk, todayLabel } from '../src/service/spending.js'

const here = path.dirname(fileURLToPath(import.meta.url))
let failed = 0
const check = (name, ok, more = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !more ? '' : `: ${String(more).slice(0, 400)}`}`)
}

// ---------- the rules ----------
check('budget: off by default, 1,000 a day, 250 a step', JSON.stringify(budgetOf({})) === JSON.stringify({ on: false, daily: 1000, perStep: 250 }))
check('budget: bad numbers fall back', budgetOf({ chatBudget: { on: true, daily: -5, perStep: 'x' } }).daily === 1000 && budgetOf({ chatBudget: { on: true, daily: -5, perStep: 'x' } }).perStep === 250)
check('budget: on only when exactly true', budgetOf({ chatBudget: { on: 'yes' } }).on === false && budgetOf({ chatBudget: { on: true } }).on === true)
const on = { on: true, daily: 1000, perStep: 250 }
const ask = (o) => decideSpend({ budget: on, spent: 0, credits: 120, usd: 0.57, balance: 5000, ...o })
check('rules: under both amounts, with the balance, it goes ahead', ask({}).auto === true)
check('rules: off, it asks with the price', /about 120 credits \(\$0\.57\)/.test(decideSpend({ budget: { ...on, on: false }, credits: 120, usd: 0.57, balance: 5000 }).why))
check('rules: more than one step may spend asks', !ask({ credits: 251 }).auto && /250 credits one step/.test(ask({ credits: 251 }).why))
check('rules: exactly the step amount goes ahead', ask({ credits: 250 }).auto)
check('rules: past today’s limit asks, saying what’s left', !ask({ spent: 900, credits: 120 }).auto && /Only 100 credits are left/.test(ask({ spent: 900, credits: 120 }).why))
check('rules: exactly reaching the limit goes ahead', ask({ spent: 880, credits: 120 }).auto)
check('rules: an unknown part of the price asks', !ask({ unknown: true }).auto && /isn’t known/.test(ask({ unknown: true }).why))
check('rules: no balance read asks', !ask({ balance: null }).auto && /couldn’t read your Comfy.org balance/.test(ask({ balance: null }).why))
check('rules: a balance too small asks', !ask({ balance: 100 }).auto && /balance is 100 credits/.test(ask({ balance: 100 }).why))
check('rules: the card says today’s spending', /spent 900 of your 1,000-credit limit/.test(ask({ spent: 900 }).why))
check('label: off shows nothing', todayLabel({ ...on, on: false }, 5) === null)
check('label: Today: 340 of 1,000 credits', todayLabel(on, 340) === 'Today: 340 of 1,000 credits')

// ---------- the record ----------
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ivs-spend-'))
const noon = new Date(2026, 10, 10, 12, 0, 0)
addSpend(dir, { tool: 'generate_previews', credits: 100, usd: 0.47, auto: true }, new Date(2026, 10, 9, 23, 59, 0))
addSpend(dir, { tool: 'generate_previews', credits: 120, usd: 0.57, auto: true }, new Date(2026, 10, 10, 0, 0, 1))
addSpend(dir, { tool: 'finish_candidate', credits: 30, usd: 0.14, auto: false }, noon)
check('record: today starts at local midnight', spentToday(readLedger(dir), noon) === 150, spentToday(readLedger(dir), noon))
addSpend(dir, { tool: 'old', credits: 5, usd: 0.02 }, new Date(2026, 6, 1))
addSpend(dir, { tool: 'new', credits: 5, usd: 0.02 }, noon)
check('record: keeps 90 days', !readLedger(dir).some((e) => e.tool === 'old') && readLedger(dir).length === 4, readLedger(dir).map((e) => e.tool).join())
fs.rmSync(dir, { recursive: true, force: true })

// ---------- the app's spend desk ----------
const deskDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ivs-desk-'))
let settings = { chatBudget: { on: true, daily: 1000, perStep: 250 } }
let balanceCalls = 0
let balanceNow = 5000
const spends = []
const desk = startSpendDesk({ dataDir: deskDir, settings: () => settings, key: () => 'the-key', balance: async () => (balanceCalls++, balanceNow), onSpend: (turn, entry, s) => spends.push({ turn, entry, s }) })
const url = await desk.url
check('desk: listens on 127.0.0.1 only', /^http:\/\/127\.0\.0\.1:\d+$/.test(url), url)
const token = desk.issue({ chat: { id: 'c1' } })
const raw = (route, { tokenUsed = token, body, origin } = {}) =>
  fetch(`${url}${route}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(tokenUsed ? { 'x-iv-token': tokenUsed } : {}), ...(origin ? { origin } : {}) }, body: body ? JSON.stringify(body) : undefined })
check('desk: no token, no answer', (await raw('/key', { tokenUsed: null })).status === 403)
check('desk: a wrong token, no answer', (await raw('/key', { tokenUsed: 'nope' })).status === 403)
check('desk: a browser page (any Origin) gets nothing', (await raw('/key', { origin: 'http://evil.example' })).status === 403)
const client = spendDeskClient({ IV_STUDIO_AGENT_APP: url, IV_STUDIO_AGENT_TOKEN: token })
check('desk: lends the key to its own turn', (await client.key()) === 'the-key')
let d = await client.check({ tool: 'generate_previews', credits: 300, usd: 1.42 })
check('desk: a step over the step amount asks, without reading the balance', !d.auto && balanceCalls === 0, JSON.stringify(d))
d = await client.check({ tool: 'generate_previews', credits: 120, usd: 0.57 })
check('desk: a step under both goes ahead, after reading the balance', d.auto && balanceCalls === 1, JSON.stringify(d))
balanceNow = 50
d = await client.check({ tool: 'generate_previews', credits: 120, usd: 0.57 })
check('desk: a short balance asks', !d.auto && /balance is 50 credits/.test(d.why), JSON.stringify(d))
balanceNow = 5000
const rec = await client.record({ tool: 'generate_previews', credits: 120, usd: 0.57, auto: true })
check('desk: recording adds it to today', rec.spent === 120 && readLedger(deskDir).length === 1 && readLedger(deskDir)[0].chatId === null)
check('desk: the app hears about it, with today’s figure', spends.length === 1 && spends[0].turn.chat.id === 'c1' && spends[0].s.spent === 120)
settings = { chatBudget: { on: true, daily: 200, perStep: 250 } }
d = await client.check({ tool: 'generate_previews', credits: 120, usd: 0.57 })
check('desk: counts what’s already spent today', !d.auto && /Only 80 credits are left/.test(d.why) && d.spent === 120, JSON.stringify(d))
desk.revoke(token)
check('desk: a finished turn’s token stops working', (await raw('/key')).status === 403)
desk.close()
fs.rmSync(deskDir, { recursive: true, force: true })

// ---------- the whole path, inside the built MCP server ----------
const info = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'partner-info.json'), 'utf8'))
const queued = []
const comfy = http.createServer((req, res) => {
  const send = (code, body) => (res.writeHead(code, { 'Content-Type': 'application/json' }), res.end(JSON.stringify(body)))
  const m = req.url.match(/^\/object_info\/(.+)$/)
  if (m) {
    const cls = decodeURIComponent(m[1])
    return info[cls] ? send(200, { [cls]: info[cls] }) : send(404, {})
  }
  if (req.url === '/object_info') return send(200, info)
  if (req.url === '/prompt' && req.method === 'POST') {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => (queued.push(JSON.parse(body)), send(200, { prompt_id: `p${queued.length}`, number: queued.length })))
    return
  }
  if (req.url.startsWith('/history')) return send(200, {})
  if (req.url === '/queue') return send(200, { queue_running: [], queue_pending: [] })
  if (req.url === '/system_stats') return send(200, { system: { comfyui_version: '0.45.0' }, devices: [] })
  send(404, {})
})
await new Promise((r) => comfy.listen(0, '127.0.0.1', r))
const comfyUrl = `http://127.0.0.1:${comfy.address().port}`

const data = fs.mkdtempSync(path.join(os.tmpdir(), 'ivs-spendmcp-'))
const askDir = path.join(data, 'asks')
const ledgerDir = path.join(data, 'ledger')
fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify({ comfyUrl, ollamaUrl: 'http://127.0.0.1:9' }))
settings = { chatBudget: { on: true, daily: 5000, perStep: 2000 } }
const realDesk = startSpendDesk({ dataDir: ledgerDir, settings: () => settings, key: () => 'stand-in-key', balance: async () => 100000 })
const turnToken = realDesk.issue({ chat: { id: 'c2' } })
const transport = new StdioClientTransport({
  command: createRequire(import.meta.url)('electron'),
  args: [path.resolve(here, '..', 'out', 'main', 'mcp.js')],
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', IV_STUDIO_DATA: data, IV_STUDIO_AGENT_RUN: 'chat', IV_STUDIO_AGENT_ASK: askDir, IV_STUDIO_AGENT_ASK_MS: '4000', IV_STUDIO_AGENT_APP: await realDesk.url, IV_STUDIO_AGENT_TOKEN: turnToken, COMFY_ORG_API_KEY: '' }
})
const mcp = new Client({ name: 'spending', version: '1' })
await mcp.connect(transport)
const call = (name, args = {}) => mcp.callTool({ name, arguments: args })
const asks = () => (fs.existsSync(askDir) ? fs.readdirSync(askDir).filter((n) => n.endsWith('.ask.json')) : [])
const answerNext = (allow) =>
  new Promise((resolve) => {
    const iv = setInterval(() => {
      const f = asks()[0]
      if (!f) return
      clearInterval(iv)
      const a = JSON.parse(fs.readFileSync(path.join(askDir, f), 'utf8'))
      fs.writeFileSync(path.join(askDir, `${a.id}.answer.json`), JSON.stringify({ allow }))
      resolve(a)
    }, 100)
  })
const shot = { engine: 'seedance', prompt: 'A paper boat drifts across a puddle in soft rain.', character: 'none', force: true }
let price = await call('price_shot', shot)
const priced = JSON.parse(price.content[0].text)
check('server: Seedance has a price from ComfyUI’s own node definitions', priced.paid && priced.maxUsd > 0, price.content?.[0]?.text)
const credits = Math.round(priced.maxUsd * 211)

let out = await call('generate_previews', shot)
check('server: under the limit, Seedance starts with no Allow card and no confirm_cost from the agent', !out.isError && asks().length === 0 && queued.length === 1, out.content?.[0]?.text)
const sent = queued[0]
check('server: the app’s key goes with it (never written to a file)', sent?.extra_data?.api_key_comfy_org === 'stand-in-key', JSON.stringify(sent?.extra_data || {}).slice(0, 200))
check('server: it’s recorded at IV Studio’s own price', readLedger(ledgerDir).length === 1 && readLedger(ledgerDir)[0].credits === credits && readLedger(ledgerDir)[0].auto === true, JSON.stringify(readLedger(ledgerDir)))
check('server: no key in the data folder', !JSON.stringify(fs.readdirSync(data, { recursive: true }).map((f) => { try { return fs.readFileSync(path.join(data, f), 'utf8') } catch { return '' } })).includes('stand-in-key'))

settings = { chatBudget: { on: true, daily: 5000, perStep: Math.max(1, credits - 1) } }
let [a, res] = await Promise.all([answerNext(false), call('generate_previews', shot)])
check('server: over the step amount, the card shows the price and the limit', new RegExp(`about ${credits.toLocaleString('en-US')} credits`).test(a.why) && /one step can spend/.test(a.why), a.why)
check('server: Don’t allow, nothing is sent or recorded', res.isError && queued.length === 1 && readLedger(ledgerDir).length === 1, res.content?.[0]?.text)
;[a, res] = await Promise.all([answerNext(true), call('generate_previews', shot)])
check('server: Allow sends it, recorded as Allowed', !res.isError && queued.length === 2 && readLedger(ledgerDir).length === 2 && readLedger(ledgerDir)[1].auto === false, res.content?.[0]?.text)

settings = { chatBudget: { on: false, daily: 5000, perStep: 2000 } }
;[a, res] = await Promise.all([answerNext(false), call('generate_previews', shot)])
check('server: limit off, every paid step asks, with its price', /Seedance renders on your Comfy.org credits: this costs about/.test(a.why) && res.isError && queued.length === 2, a.why)
out = await call('generate_previews', { ...shot, engine: 'h3', prompt: 'x' }).catch((e) => ({ isError: true, content: [{ text: e.message }] }))
check('server: a free H3 render never touches the record', readLedger(ledgerDir).length === 2)

await mcp.close()
realDesk.close()
comfy.close()
fs.rmSync(data, { recursive: true, force: true, maxRetries: 3 })

console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
