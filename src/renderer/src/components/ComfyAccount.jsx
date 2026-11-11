import { useEffect, useState } from 'react'
import { ask } from './Confirm'
import { SetCard, SetField, Pill } from './SettingsKit'

// The person's Comfy.org account: credits that ComfyUI's paid partner nodes (Seedance, Kling, Veo…) spend.
// The key lives encrypted in the main process; the window only sees whether one is saved and the balance.

const KEYS_PAGE = 'https://platform.comfy.org/profile/api-keys'
const CREDITS_PAGE = 'https://platform.comfy.org/profile/credits'
const open = (url) => window.ivstudio.links.open(url)
export const credits = (n) => `${Math.round(n).toLocaleString('en-US')} credits`
export const dollars = (usd) => `$${usd.toFixed(2)}`

// The account state, kept current from the main process: { hasKey, balance, error, checking }.
export function useAccount() {
  const [account, setAccount] = useState(null)
  useEffect(() => {
    window.ivstudio.account.state().then(setAccount)
    return window.ivstudio.account.onState(setAccount)
  }, [])
  return account
}

// Title bar: "Comfy · 12,340 credits". Hidden with no key. A click reads the balance again.
export function BalanceChip() {
  const a = useAccount()
  if (!a?.hasKey) return null
  const b = a.balance
  const label = a.checking && !b ? 'checking…' : b ? credits(b.credits) : 'balance ?'
  const title = b ? `Comfy.org credits: ${credits(b.credits)} (${dollars(b.usd)}). Paid partner nodes spend these. Click to check again.` : a.error || 'Comfy.org credits. Click to check again.'
  return (
    <button className={`balance-chip mono ${a.error && !b ? 'warn' : ''} ${a.checking ? 'busy' : ''}`} title={title} onClick={() => window.ivstudio.account.refresh()}>
      <span className="balance-dot" />
      <span className="balance-pre">Comfy · </span>
      {label}
    </button>
  )
}

// Settings → Comfy account.
export function AccountCard({ n, notify }) {
  const a = useAccount()
  const [key, setKey] = useState('')
  const [saving, setSaving] = useState(false)
  async function save() {
    setSaving(true)
    try {
      await window.ivstudio.account.setKey(key)
      setKey('')
    } catch (err) {
      notify(err.message)
    } finally {
      setSaving(false)
    }
  }
  async function remove() {
    if (!(await ask({ title: 'Remove the Comfy.org key?', message: 'Paid partner nodes and the Context IR writer stop working until you add a key again. Your credits stay on your Comfy.org account.', confirm: 'Remove', danger: true }))) return
    await window.ivstudio.account.clearKey()
  }
  const b = a?.balance
  const aside = !a ? null : !a.hasKey ? <Pill>No key</Pill> : b ? <Pill tone="ok">{credits(b.credits)}</Pill> : a.error ? <Pill tone="warn">Not checked</Pill> : <Pill>Checking</Pill>
  return (
    <SetCard id="account" n={n} title="Comfy account" sub="ComfyUI's paid partner nodes (Seedance, Kling, Veo and more) run on your own Comfy.org credits. IV Studio always shows the price and asks before anything paid runs." aside={aside}>
      <SetField label="API key">
        {a?.hasKey ? (
          <div className="set-inline">
            <Pill tone="ok">Saved · encrypted on this PC</Pill>
            <button className="link-btn" onClick={remove}>
              Remove
            </button>
          </div>
        ) : (
          <>
            <div className="set-inline grow">
              <input type="password" value={key} placeholder="Comfy.org API key (comfyui-…)" onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && key.trim() && save()} autoComplete="off" />
              <button className="btn btn-small" disabled={!key.trim() || saving} onClick={save}>
                {saving ? 'Checking…' : 'Save'}
              </button>
            </div>
            <p className="set-hint">
              Make one on{' '}
              <button className="link-btn" onClick={() => open(KEYS_PAGE)}>
                platform.comfy.org
              </button>{' '}
              (API keys). IV Studio checks it with Comfy.org before keeping it, and it never leaves this PC except to Comfy.org.
            </p>
          </>
        )}
      </SetField>
      {a?.hasKey && (
        <SetField
          label="Balance"
          hint={b ? `${b.pendingUsd > 0 ? `${dollars(b.pendingUsd)} of runs still being charged. ` : ''}Checked ${new Date(b.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. It updates after each paid run.` : null}
          warn={a.error || (b && b.usd <= 0 ? 'No credits on this Comfy.org account. Paid nodes won’t run until you add some.' : null)}
        >
          <div className="set-inline">
            {b ? (
              <span className="account-balance">
                <b>{credits(b.credits)}</b> <span className="dim">{dollars(b.usd)}</span>
              </span>
            ) : (
              <span className="dim">{a.checking ? 'Checking…' : 'Not known yet'}</span>
            )}
            <button className="btn btn-small" disabled={a.checking} onClick={() => window.ivstudio.account.refresh()}>
              Check again
            </button>
            <button className="link-btn" onClick={() => open(CREDITS_PAGE)}>
              Add credits
            </button>
          </div>
        </SetField>
      )}
    </SetCard>
  )
}

// Asks before a paid run. price: from account.price(graph). Resolves with the spend OK to pass along
// ({ approvedUsd, unknownOk }), or null when the person says no. Free graphs pass straight through.
export async function confirmSpend(price, { what = 'this run' } = {}) {
  if (!price?.paid) return { approvedUsd: 0 }
  const a = await window.ivstudio.account.state()
  const cost = (nd) => (nd.unknown ? (nd.text ? `${nd.text}, total not known` : 'no price shown') : nd.min === nd.max ? `about ${dollars(nd.max)}` : `${dollars(nd.min)} to ${dollars(nd.max)}`)
  const range = price.max - price.min > 0.005
  const short = a?.balance && a.balance.usd < price.max
  const message = [
    `This runs paid Comfy.org nodes (${what}). The prices are ComfyUI's own.`,
    range ? `The final price depends on how the run goes, so you agree to at most ${dollars(price.max)}.` : '',
    price.unknown.length ? 'Some nodes don’t show a fixed price, so the total may be higher.' : ''
  ]
    .filter(Boolean)
    .join('\n')
  const details = [
    ...price.nodes.map((nd) => [nd.title, cost(nd)]),
    ['Total', price.label],
    ['Your balance', a?.balance ? `${credits(a.balance.credits)} (${dollars(a.balance.usd)})${short ? ', which may not be enough' : ''}` : 'not known']
  ]
  const yes = await ask({ kicker: 'Paid run', title: `Spend up to ${dollars(price.max)}?`, message, details, confirm: `Run it · up to ${dollars(price.max)}` })
  return yes ? { approvedUsd: price.max, unknownOk: price.unknown.length > 0 } : null
}

// Test copies only: lets a test show the confirm for a graph without a run button (window.ivTestSpend(graph)).
window.ivstudio?.app?.info?.().then?.((i) => {
  if (i?.testCopy) window.ivTestSpend = async (graph) => confirmSpend(await window.ivstudio.account.price(graph), { what: 'a test' })
})
