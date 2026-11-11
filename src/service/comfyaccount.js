// The person's Comfy.org account: the credits their partner (API) node runs spend. The balance comes from the same
// call ComfyUI's own window makes when it has only an API key: GET api.comfy.org/customers/balance with X-API-KEY.
// The key is the one IV Studio already keeps (encrypted) for the paid prompt writer; nothing else is sent.
import { CREDITS_PER_USD } from './pricing.js'

export const COMFY_API = 'https://api.comfy.org'
export const COMFY_KEYS_PAGE = 'https://platform.comfy.org/profile/api-keys'
export const COMFY_CREDITS_PAGE = 'https://platform.comfy.org/profile/credits'

const err = (message, code, status) => Object.assign(new Error(message), { code, status })

// { usd, credits, prepaidUsd, cloudUsd, at } for a key. Throws with code no_key / bad_key / offline / failed.
// A key with no Comfy.org customer yet (nothing ever bought) answers 404: that's an empty balance, not an error.
export async function getBalance(key, { base = COMFY_API, timeout = 15000, fetchImpl = globalThis.fetch } = {}) {
  const k = String(key || '').trim()
  if (!k) throw err('Add your Comfy.org API key first.', 'no_key')
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), timeout)
  let res
  try {
    res = await fetchImpl(`${base.replace(/\/$/, '')}/customers/balance`, { headers: { 'X-API-KEY': k, Accept: 'application/json' }, signal: ctl.signal })
  } catch (e) {
    throw err(e.name === 'AbortError' ? 'Comfy.org did not answer in time.' : 'Could not reach Comfy.org. Check the internet connection.', 'offline')
  } finally {
    clearTimeout(t)
  }
  if (res.status === 401 || res.status === 403) throw err('Comfy.org refused this API key. Make a new one at platform.comfy.org and paste it again.', 'bad_key', res.status)
  if (res.status === 404) return shape({}, true)
  if (!res.ok) throw err(`Comfy.org answered ${res.status} for the balance.`, 'failed', res.status)
  return shape(await res.json().catch(() => ({})), false)
}

// Comfy.org gives each figure twice, as "_cents" and "_micros", with currency "usd" (amount, effective_balance,
// prepaid_balance, cloud_credit_balance, pending_charges). Despite the name, "_micros" holds cents too: a $10
// top-up answered amount_cents 1000 and amount_micros 1000 (2026-11-08), and ComfyUI's own window passes the
// micros figure to its cents formatter. So both are read as cents, _cents first.
function shape(b, none) {
  const fig = (name) => (Number.isFinite(b[`${name}_cents`]) ? b[`${name}_cents`] / 100 : Number.isFinite(b[`${name}_micros`]) ? b[`${name}_micros`] / 100 : null)
  const usd = fig('effective_balance') ?? fig('amount') ?? 0
  return {
    usd,
    credits: Math.round(usd * CREDITS_PER_USD),
    prepaidUsd: fig('prepaid_balance'),
    cloudUsd: fig('cloud_credit_balance'),
    pendingUsd: fig('pending_charges'),
    newCustomer: none,
    // what Comfy.org answered (numbers and words only), so a change in its format can be seen
    fields: Object.fromEntries(Object.entries(b).filter(([, v]) => ['number', 'string', 'boolean'].includes(typeof v))),
    at: new Date().toISOString()
  }
}

// "12,340 credits ($58.48)"
export const balanceLabel = (b) => (b ? `${b.credits.toLocaleString('en-US')} credits ($${b.usd.toFixed(2)})` : '')

// Waits for a paid prompt to finish (or fail), then calls done(). Checks every 10 s for up to 2 hours, so the
// balance refreshes after the run spends.
export function afterPrompt(comfy, promptId, done, { every = 10000, limit = 2 * 3600 * 1000 } = {}) {
  const start = Date.now()
  const tick = async () => {
    try {
      const h = (await comfy.history(promptId))?.[promptId]
      if (h?.status?.completed || h?.status?.status_str === 'error' || h?.outputs) return done()
    } catch {}
    if (Date.now() - start > limit) return done()
    setTimeout(tick, every)
  }
  setTimeout(tick, every)
}
