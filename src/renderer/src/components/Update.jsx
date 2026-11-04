import { useEffect, useState } from 'react'
import { updateView } from '../../../shared/platform'

// IV Studio's own updates: the main process checks GitHub on launch and every six hours and downloads a
// new version in the background. These show where it's at, and install it with one click.
export function useUpdate() {
  const [state, setState] = useState(null)
  useEffect(() => {
    window.ivstudio.update.state().then(setState)
    return window.ivstudio.update.onChange(setState)
  }, [])
  return state
}

const install = (notify) => window.ivstudio.update.install().catch((err) => notify(err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')))

// In the sidebar's foot, in place of the version number.
export function UpdateButton({ notify }) {
  const u = useUpdate()
  // With updates off the foot keeps the version number and no update control.
  if (updateView(u) === 'none') return <span>v{u?.version}</span>
  if (u?.status === 'ready')
    return (
      <button className="nav-update ready" onClick={() => install(notify)} title={`IV Studio ${u.available} is downloaded. Restart to install it; anything open is saved.`}>
        ↻ Update to {u.available}
      </button>
    )
  if (u?.status === 'downloading')
    return (
      <span className="nav-update" title="Downloading in the background">
        Updating to {u.available} · {Math.round(u.percent || 0)}%
      </span>
    )
  return <span>v{u?.version}</span>
}

const when = (iso) => (iso ? new Date(iso).toLocaleString() : null)

export function UpdateSettings({ notify }) {
  const u = useUpdate()
  const [checking, setChecking] = useState(false)
  if (!u || updateView(u) === 'none') return null
  const line = {
    dev: 'This is a development copy; the installed app checks for updates.',
    idle: 'Checks GitHub for a new version on launch and every six hours.',
    checking: 'Checking for a new version…',
    current: `You have the newest version.${u.checkedAt ? ` Checked ${when(u.checkedAt)}.` : ''}`,
    downloading: `Downloading IV Studio ${u.available}… ${Math.round(u.percent || 0)}%`,
    ready: `IV Studio ${u.available} is downloaded. Restart to install it, or it installs when you next quit.`,
    error: `Couldn't check for updates: ${u.error}`
  }[u.status]
  async function check() {
    setChecking(true)
    try {
      await window.ivstudio.update.check()
    } finally {
      setChecking(false)
    }
  }
  return (
    <section className="group">
      <div className="group-head">
        <h2>Updates</h2>
        <p className="dim small">IV Studio {u.version}. New versions download in the background and install with one click.</p>
      </div>
      <div className="group-body">
        <p className="small">{line}</p>
        <div className="row-actions">
          {u.status === 'ready' ? (
            <button className="btn btn-small btn-primary" onClick={() => install(notify)}>
              Restart to update
            </button>
          ) : (
            <button className="btn btn-small" disabled={u.status === 'dev' || u.status === 'downloading' || checking || u.status === 'checking'} onClick={check}>
              {checking || u.status === 'checking' ? 'Checking…' : 'Check for updates'}
            </button>
          )}
        </div>
      </div>
    </section>
  )
}
