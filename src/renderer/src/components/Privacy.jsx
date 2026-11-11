import { useEffect, useState } from 'react'
import { SetCard, SetCode, SetField, SetSwitch, Pill } from './SettingsKit'

// Privacy: anonymous usage counting and the cloud beta signup (src/service/usage.js). Both are off until the
// person turns them on. PrivacyCard is Settings → Privacy; UsageAsk is the one question in the welcome wizard;
// BetaJoin is the signup, shown only while a signup address exists (resources/links.json betaUrl).

const U = () => window.ivstudio.usage

export const COUNTED = ['IV Studio was opened', 'A render started', 'A render finished', 'The first render ever finished on this copy']
export const WITH_EACH = 'a random id made for this copy, the day, the app version, Windows / Mac / Linux, and the kind of render (preview, finish, picture…)'
export const NEVER = 'Never your prompts, pictures, videos, file or folder names, keys, accounts or anything about you.'

export function useUsage() {
  const [status, setStatus] = useState(null)
  useEffect(() => {
    let alive = true
    U()
      .status()
      .then((s) => alive && setStatus(s), () => {})
    return () => (alive = false)
  }, [])
  return [status, setStatus]
}

// What's counted, in full, for anyone who wants to read it before answering.
export function WhatIsCounted() {
  return (
    <div className="privacy-what small">
      <p>
        <strong>Counted:</strong>
      </p>
      <ul>
        {COUNTED.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <p>
        <strong>With each count:</strong> {WITH_EACH}.
      </p>
      <p>{NEVER} Incognito is never counted.</p>
    </div>
  )
}

// The welcome wizard's question: a switch that starts off. The wizard saves the answer when it's finished.
export function UsageAsk({ on, onChange }) {
  const [more, setMore] = useState(false)
  return (
    <div className="wel-tour privacy-ask">
      <span className="wel-tour-q" aria-hidden="true">
        ✓
      </span>
      <div>
        <strong>Help improve IV Studio?</strong>
        <p className="small dim">
          Let IV Studio count, anonymously, when it’s opened and when a render starts and finishes. It tells us whether people get to a first render. {NEVER}{' '}
          <button className="link-btn" onClick={() => setMore((m) => !m)} aria-expanded={more}>
            {more ? 'Hide the details' : 'Exactly what’s counted'}
          </button>
        </p>
        {more && <WhatIsCounted />}
      </div>
      <SetSwitch checked={on} onChange={onChange}>
        {on ? 'Yes, count' : 'No thanks'}
      </SetSwitch>
    </div>
  )
}

// The cloud beta signup: an email box and a Join button. Nothing is sent until Join is pressed.
export function BetaJoin({ status, setStatus, notify, compact = false }) {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  if (!status?.betaOpen) return null
  if (status.betaJoined)
    return (
      <p className="small">
        <Pill tone="ok">You’re on the cloud beta list</Pill> We’ll email you when it opens.
      </p>
    )
  const join = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      setStatus(await U().joinBeta(email))
      notify?.('You’re on the cloud beta list.')
    } catch (err) {
      notify?.(err.message)
    }
    setBusy(false)
  }
  return (
    <form className="beta-join" onSubmit={join}>
      {!compact && <p className="small dim">Rendering on our GPUs, with nothing to set up, is coming as a beta. Leave an email address and we’ll tell you when it opens. It’s used for that and nothing else.</p>}
      <div className="beta-join-row">
        <input type="email" className="input" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email address for the cloud beta" autoComplete="email" />
        <button className="btn btn-primary" disabled={busy || !email.trim()}>
          {busy ? 'Joining…' : 'Join the cloud beta'}
        </button>
      </div>
    </form>
  )
}

export function PrivacyCard({ n, notify }) {
  const [status, setStatus] = useUsage()
  const [sample, setSample] = useState(null)
  if (!status) return null
  const set = async (on) => {
    try {
      setStatus(await U().set(on))
      setSample(null)
    } catch (err) {
      notify(err.message)
    }
  }
  const show = async () => setSample(sample ? null : JSON.stringify(await U().preview(), null, 2))
  const on = status.choice === 'on'
  return (
    <SetCard id="privacy" n={n} title="Privacy" sub="What IV Studio sends, which is nothing unless you turn it on here." aside={<Pill tone={on ? 'ok' : ''}>{on ? 'Counting' : 'Nothing sent'}</Pill>}>
      <SetField
        label="Help improve IV Studio"
        hint={
          on
            ? status.counting
              ? status.sends
                ? 'On. Counts are sent a few at a time. Turning this off deletes this copy’s id and anything not sent yet.'
                : 'On. This version has nowhere to send counts yet, so they stay on this computer. Turning this off deletes them.'
              : 'On, but paused: Incognito is never counted.'
            : 'Off. IV Studio counts nothing and sends nothing.'
        }
      >
        <SetSwitch checked={on} onChange={set}>
          {on ? 'On' : 'Off'}
        </SetSwitch>
        <WhatIsCounted />
        <button className="btn btn-small privacy-show" onClick={show}>
          {sample ? 'Hide' : on && status.waiting ? 'See what’s waiting to be sent' : 'See an example of what’s sent'}
        </button>
        {sample && <SetCode text={sample} />}
      </SetField>
      {status.betaOpen && (
        <SetField label="Cloud beta" hint={status.betaJoined ? null : 'Separate from the counting above: this sends only the address you type, and only when you press Join.'}>
          <BetaJoin status={status} setStatus={setStatus} notify={notify} />
        </SetField>
      )}
    </SetCard>
  )
}
