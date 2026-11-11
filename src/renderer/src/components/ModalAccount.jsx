import { useEffect, useState } from 'react'

// The Modal sign-in, for the Cloud page and the cloud setup wizard. Three states:
//   signed in   the workspace, checked with Modal itself, and Sign out (to sign in again or with another account)
//   waiting     Modal's page is open in the browser: its address (for when no browser opened) and Cancel
//   signed out  Create an account, and Sign in with Modal
// st is cloud:status; run(label, fn) is the page's busy wrapper; onChanged refreshes the page's status.
export default function ModalAccount({ st, busy, run, info, notify, onChanged, compact = false }) {
  const [url, setUrl] = useState(st.signInUrl || null)
  const [signingOut, setSigningOut] = useState(false)
  const waiting = st.signingIn || busy === 'Waiting for the Modal sign-in in your browser' || busy === 'Waiting for Modal sign-in'
  // the sign-in page's address shows up a moment after Modal starts; ask until it does (and while waiting)
  useEffect(() => {
    if (!waiting) return setUrl(null)
    let live = true
    const ask = () => window.ivstudio.cloud.status().then((s) => live && setUrl(s.signInUrl || null), () => {})
    ask()
    const t = setInterval(ask, 1500)
    return () => ((live = false), clearInterval(t))
  }, [waiting])

  async function signOut() {
    setSigningOut(true)
    try {
      const r = await window.ivstudio.cloud.signOut()
      notify?.(r?.removed ? `Signed out of Modal (${r.removed}).` : 'Signed out of Modal.', 'ok')
    } catch (err) {
      notify?.(err.message)
    }
    setSigningOut(false)
    await onChanged?.()
  }
  const cancel = () => window.ivstudio.cloud.cancelSignIn().catch(() => {})
  const signIn = () => run('Waiting for the Modal sign-in in your browser', () => window.ivstudio.cloud.signIn())

  if (st.workspace)
    return (
      <div className="modal-account">
        <p className="small">
          Signed in to the Modal workspace <span className="mono">{st.workspace}</span>.
        </p>
        <button className="link-btn mono" disabled={!!busy || signingOut} onClick={signOut}>
          {signingOut ? 'Signing out…' : 'Sign out'}
        </button>
        <span className="dim small">Not working, or the wrong account? Sign out, then sign in again. Other Modal tools on this computer are signed out too.</span>
      </div>
    )
  if (waiting)
    return (
      <div className="modal-account waiting">
        <p className="small">
          <span className="version-dot" aria-hidden="true" /> Waiting for you to approve IV Studio on Modal’s page in your browser.
        </p>
        <div className="modal-account-btns">
          {url && (
            <button className="btn btn-small" onClick={() => window.ivstudio.links.open(url)}>
              Open the sign-in page
            </button>
          )}
          <button className="btn btn-small" onClick={cancel}>
            Cancel
          </button>
        </div>
        <span className="dim small">{url ? 'No browser opened? Use the button above. ' : ''}When you’ve approved it, this moves on by itself.</span>
      </div>
    )
  return (
    <div className="modal-account">
      {!compact && <p className="small dim">Opens Modal’s sign-in page in your browser. New to Modal? Signing up is free.</p>}
      <div className="modal-account-btns">
        <button className="btn btn-small" onClick={() => window.ivstudio.links.open(info?.links?.modalSignup || 'https://modal.com/signup')}>
          Create an account
        </button>
        <button className="btn btn-small btn-primary" disabled={!!busy || !st.toolkit} onClick={signIn}>
          Sign in with Modal
        </button>
      </div>
      {info?.links?.modalSignup && <span className="cloud-support small">This is IV Studio’s referral link: signing up through it supports the app, and costs you nothing extra.</span>}
    </div>
  )
}
