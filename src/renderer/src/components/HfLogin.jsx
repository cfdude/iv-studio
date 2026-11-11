import { useEffect, useState } from 'react'

// A Hugging Face login for gated models (Flux.2 Klein 9B, Flux 3 Klein, the LTX effects): their licence is accepted
// on Hugging Face, then they download with the person's own Read token. One token serves this PC and the cloud (it's
// the Cloud page's token too), sealed on this PC. A login made with `hf auth login` or HF_TOKEN counts as well.
export const TOKENS_PAGE = 'https://huggingface.co/settings/tokens'

export function useHfLogin() {
  const [from, setFrom] = useState(undefined)
  const refresh = () =>
    window.ivstudio.models
      .hfLogin()
      .then((r) => setFrom(r?.from || null))
      .catch(() => setFrom(null))
  useEffect(() => {
    refresh()
  }, [])
  return [from, refresh]
}

export default function HfLogin({ notify, pages = [], onChange }) {
  const [from, refresh] = useHfLogin()
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  async function save(k) {
    setBusy(true)
    try {
      const r = await window.ivstudio.cloud.hfToken(k)
      setToken('')
      if (k) notify?.(`Hugging Face token saved (encrypted on this PC)${r?.name ? ` for ${r.name}` : ''}.`, 'info')
      await refresh()
      onChange?.()
    } catch (err) {
      notify?.(err.message)
    } finally {
      setBusy(false)
    }
  }
  const open = (url) => window.ivstudio.links.open(url)
  return (
    <div className="hf-login">
      <div className="hf-login-text small">
        <strong>Some of these need a free Hugging Face login.</strong>{' '}
        <span className="dim">
          Open each model’s page while signed in to Hugging Face and accept its licence, then add a Read token here.
        </span>
        {pages.length > 0 && (
          <span className="hf-login-pages">
            {pages.map((p) => (
              <button key={p.url} className="link-btn mono small" onClick={() => open(p.url)}>
                {p.label} licence
              </button>
            ))}
          </span>
        )}
      </div>
      {from === undefined ? (
        <span className="dim small">Checking…</span>
      ) : from === 'iv' ? (
        <p className="small hf-login-ok">
          <span className="ok-dot" aria-hidden="true">●</span> Token saved in IV Studio.{' '}
          <button className="link-btn small" disabled={busy} onClick={() => save('')}>
            Remove it
          </button>
        </p>
      ) : from ? (
        <p className="small hf-login-ok">
          <span className="ok-dot" aria-hidden="true">●</span> Using this PC’s Hugging Face login ({from === 'env' ? 'HF_TOKEN' : 'hf auth login'}).
        </p>
      ) : (
        <div className="key-form">
          <input type="password" placeholder="hf_…" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" spellCheck={false} aria-label="Hugging Face token" />
          <button className="btn btn-small" disabled={busy || !token.trim()} onClick={() => save(token.trim())}>
            {busy ? 'Checking…' : 'Save token'}
          </button>
          <button className="link-btn mono small" onClick={() => open(TOKENS_PAGE)}>
            Make a token
          </button>
        </div>
      )}
    </div>
  )
}
