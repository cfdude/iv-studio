import { useEffect, useState } from 'react'

// Claude Code and Codex on this PC (src/service/agentinstall.js): found or not, Install with the maker's own
// installer, and Sign in (a window running the agent's login). Used by Check my PC and by Settings.
export function useAgentSetup() {
  const [setup, setSetup] = useState(null)
  useEffect(() => {
    let live = true
    const load = () => window.ivstudio.agents.setup().then((s) => live && setSetup(s), () => {})
    load()
    const off = window.ivstudio.agents.onSetup((s) => live && setSetup((x) => ({ ...(x || {}), ...s })))
    // back from the sign-in window: check again
    window.addEventListener('focus', load)
    return () => ((live = false), off(), window.removeEventListener('focus', load))
  }, [])
  return setup
}

const ENGINES = ['claude', 'codex']

export function AgentRows({ setup, notify, only }) {
  if (!setup) return <p className="dim small">Looking for Claude Code and Codex…</p>
  const busy = setup.install?.status === 'running' ? setup.install.engine : null
  const act = (fn) => async () => {
    try {
      await fn()
    } catch (e) {
      notify?.(e.message)
    }
  }
  return (
    <div className="agent-setup">
      {(only ? [only] : ENGINES).map((engine) => {
        const a = setup[engine]
        if (!a) return null
        const mine = setup.install?.engine === engine ? setup.install : null
        const installing = mine?.status === 'running'
        const failed = mine?.status === 'failed' && !a.installed
        const ready = a.installed && a.signedIn === true
        const state = installing ? 'Installing…' : ready ? 'Ready' : a.installed ? (a.signedIn === false ? 'Installed · not signed in' : 'Installed') : 'Not on this computer'
        return (
          <div key={engine} className={`agent-setup-row ${ready ? 'ready' : ''}`} data-engine={engine}>
            <div className="agent-setup-who">
              <span className="agent-setup-name">
                {ready && (
                  <svg className="agent-setup-tick" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M5 12.5l4.2 4.2L19 7" />
                  </svg>
                )}
                {a.name}
              </span>
              <span className={`agent-setup-state mono small ${ready ? '' : 'dim'}`}>{state}</span>
            </div>
            <div className="agent-setup-act">
              {installing ? (
                <button className="btn btn-small" onClick={act(() => window.ivstudio.agents.stopInstall())}>
                  Stop
                </button>
              ) : !a.installed ? (
                <button className="btn btn-small btn-primary agent-setup-install" disabled={!!busy} title={busy ? 'One install at a time' : `Install ${a.name} with ${a.maker}'s own installer`} onClick={act(() => window.ivstudio.agents.install(engine))}>
                  Install {a.name}
                </button>
              ) : (
                a.signedIn !== true && (
                  <button className="btn btn-small agent-setup-signin" onClick={act(() => window.ivstudio.agents.signIn(engine))}>
                    Sign in
                  </button>
                )
              )}
            </div>
            {installing && (
              <p className="agent-setup-line mono small dim" aria-live="polite">
                {mine.lines?.at(-1) || `Starting ${a.maker}'s installer…`}
              </p>
            )}
            {failed && (
              <p className="agent-setup-line small pink" role="alert">
                {mine.error || 'The install stopped.'}{' '}
                <button className="link-btn" onClick={() => window.ivstudio.links.open(a.site)}>
                  Get it from {a.maker} ↗
                </button>
              </p>
            )}
            {!a.installed && !installing && !failed && <p className="agent-setup-line small dim">{a.plan} Installs in a minute or two, no admin needed, and keeps itself up to date.</p>}
            {a.installed && a.signedIn !== true && !installing && (
              <p className="agent-setup-line small dim">
                Sign in opens a small window that starts {a.name}’s browser login. When it’s done, close the window and come back here.
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}
