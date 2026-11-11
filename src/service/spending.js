// The chat's spending limit (Settings → Agents). Off unless the person turns it on. When it's on, a chat step whose
// price IV Studio knows before it runs (Seedance on the person's Comfy.org credits, priced by IV Studio's own price
// check) goes ahead without an Allow card when all of these hold: it costs no more than the per-step amount, today's
// chat spending plus it stays within the daily budget, and the Comfy.org balance covers it. Anything else asks, as
// before. Every paid chat step counts when it starts (Allowed or not, and even if the render later fails); the day
// starts at local midnight. The record is spending.json in IV Studio's data folder.
//
// The chat's MCP server runs as its own process and can't read the app's sealed Comfy.org key, so the app runs a
// "spend desk" on 127.0.0.1 while a chat turn runs: the server asks it whether a step may go ahead, records what
// started, and borrows the key for the step. Each turn gets its own token, dropped when the turn ends.
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'

export const BUDGET_DEFAULTS = { on: false, daily: 1000, perStep: 250 }
export const LEDGER_FILE = 'spending.json'
const KEEP_DAYS = 90
const DAY = 24 * 3600 * 1000

const whole = (v, d) => (v !== null && v !== '' && Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.round(Number(v)) : d)
// settings.chatBudget, made safe: { on, daily, perStep } in credits
export function budgetOf(settings = {}) {
  const b = settings?.chatBudget || {}
  return { on: b.on === true, daily: whole(b.daily, BUDGET_DEFAULTS.daily), perStep: whole(b.perStep, BUDGET_DEFAULTS.perStep) }
}

export function readLedger(dataDir) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(dataDir, LEDGER_FILE), 'utf8'))
    return Array.isArray(j.entries) ? j.entries : []
  } catch {
    return []
  }
}
// Adds one paid step ({ tool, credits, usd, auto, chatId }); keeps the last 90 days.
export function addSpend(dataDir, entry, now = new Date()) {
  const cutoff = now.getTime() - KEEP_DAYS * DAY
  const entries = [...readLedger(dataDir).filter((e) => Date.parse(e.at) >= cutoff), { at: now.toISOString(), ...entry }]
  fs.mkdirSync(dataDir, { recursive: true })
  const file = path.join(dataDir, LEDGER_FILE)
  fs.writeFileSync(`${file}.tmp`, JSON.stringify({ entries }, null, 1))
  fs.renameSync(`${file}.tmp`, file)
  return entries
}
const dayStart = (now) => {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}
export const spentToday = (entries, now = new Date()) => entries.filter((e) => Date.parse(e.at) >= dayStart(now)).reduce((sum, e) => sum + (Number(e.credits) || 0), 0)

const n = (x) => Math.round(x).toLocaleString('en-US')
// What the chat header shows: "Today: 340 of 1,000 credits", or null when the limit is off
export function todayLabel(budget, spent) {
  return budget.on ? `Today: ${n(spent)} of ${n(budget.daily)} credits` : null
}

// May this paid step go ahead without an Allow card? { auto: true } or { auto: false, why } (the card's words).
// credits/usd: the top of IV Studio's price. unknown: part of the price isn't known. balance: credits, or null when
// it couldn't be read.
export function decideSpend({ budget, spent = 0, credits, usd, unknown = false, balance = null, what = 'Seedance renders on your Comfy.org credits' }) {
  const cost = `${what}: this costs about ${n(credits)} credits ($${Number(usd).toFixed(2)}).`
  if (!budget.on) return { auto: false, why: cost }
  const status = ` Today the chat has spent ${n(spent)} of your ${n(budget.daily)}-credit limit.`
  if (unknown) return { auto: false, why: `${cost} Part of its price isn’t known before it runs, so it asks.${status}` }
  if (!(credits >= 0)) return { auto: false, why: `${cost} Its price isn’t known, so it asks.${status}` }
  if (credits > budget.perStep) return { auto: false, why: `${cost} That’s more than the ${n(budget.perStep)} credits one step can spend without asking.${status}` }
  if (spent + credits > budget.daily) return { auto: false, why: `${cost} Only ${n(Math.max(0, budget.daily - spent))} credits are left in today’s limit.${status}` }
  if (balance === null || !Number.isFinite(balance)) return { auto: false, why: `${cost} IV Studio couldn’t read your Comfy.org balance, so it asks.${status}` }
  if (balance < credits) return { auto: false, why: `${cost} Your Comfy.org balance is ${n(balance)} credits, not enough for it.${status}` }
  return { auto: true }
}

// The app's side: a small server on 127.0.0.1 that only answers a chat turn's own token.
//   settings(): IV Studio's settings now. key(): the Comfy.org key or null. balance(): credits now, or null.
//   onSpend(turn, entry, { spent, budget }): a paid step started (the app adds a line to the chat).
// Returns { url (a promise), issue(turn) → token, revoke(token), close() }.
export function startSpendDesk({ dataDir, settings, key, balance, onSpend = () => {}, now = () => new Date() }) {
  const turns = new Map()
  const send = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(JSON.stringify(body))
  }
  const server = http.createServer((req, res) => {
    const turn = turns.get(String(req.headers['x-iv-token'] || ''))
    // a browser page can't reach it: no token, or any Origin, and it answers nothing
    if (!turn || req.headers.origin) return send(res, 403, { error: 'Not for you.' })
    let raw = ''
    req.on('data', (d) => {
      raw += d
      if (raw.length > 10000) req.destroy()
    })
    req.on('end', async () => {
      try {
        const body = raw ? JSON.parse(raw) : {}
        const budget = budgetOf(settings())
        if (req.method === 'GET' && req.url === '/key') return send(res, 200, { key: key() || null })
        if (req.method === 'POST' && req.url === '/check') {
          const spent = spentToday(readLedger(dataDir), now())
          const ask = { budget, spent, credits: Number(body.credits), usd: Number(body.usd) || 0, unknown: !!body.unknown }
          // the balance is a network call: only when everything else already says yes
          let d = decideSpend({ ...ask, balance: Number.MAX_SAFE_INTEGER })
          if (d.auto) {
            let b = null
            try {
              b = await balance()
            } catch {
              b = null
            }
            d = decideSpend({ ...ask, balance: b })
          }
          return send(res, 200, { ...d, spent, daily: budget.daily, on: budget.on })
        }
        if (req.method === 'POST' && req.url === '/record') {
          const entry = { tool: String(body.tool || ''), credits: Math.round(Number(body.credits) || 0), usd: Number(body.usd) || 0, auto: !!body.auto, chatId: turn.chatId || null }
          const entries = addSpend(dataDir, entry, now())
          const spent = spentToday(entries, now())
          try {
            onSpend(turn, entry, { spent, budget })
          } catch {}
          return send(res, 200, { spent, daily: budget.daily })
        }
        send(res, 404, { error: 'No such thing.' })
      } catch (e) {
        send(res, 400, { error: e.message })
      }
    })
  })
  const url = new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`))
  })
  return {
    url,
    issue(turn = {}) {
      const token = crypto.randomBytes(24).toString('hex')
      turns.set(token, turn)
      return token
    },
    revoke(token) {
      turns.delete(token)
    },
    close() {
      turns.clear()
      server.close()
    }
  }
}

// The MCP server's side: ask the app's spend desk (IV_STUDIO_AGENT_APP, IV_STUDIO_AGENT_TOKEN). null when there's none.
export function spendDeskClient(env = process.env, fetchImpl = globalThis.fetch) {
  const base = env.IV_STUDIO_AGENT_APP
  const token = env.IV_STUDIO_AGENT_TOKEN
  if (!base || !token) return null
  const call = async (route, body) => {
    const res = await fetchImpl(`${base}${route}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json', 'x-iv-token': token },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000)
    })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(j.error || `IV Studio answered ${res.status}.`)
    return j
  }
  return {
    check: (step) => call('/check', step),
    record: (step) => call('/record', step),
    key: async () => (await call('/key')).key || null
  }
}
