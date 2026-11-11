import { useEffect, useState } from 'react'

// "Get ComfyUI for me" (comfyinstall.js): on Setup, only when this PC has no ComfyUI IV Studio can start. It gets
// ComfyUI's official Windows portable build for this graphics card, checks it, unpacks it into a folder the person
// picks and starts it. Or they point IV Studio at a ComfyUI they already have.
const GB = 1024 ** 3
const gb = (b) => `${(b / GB).toFixed(b / GB >= 10 ? 0 : 1)} GB`
const mins = (s) => (s == null ? '' : s < 60 ? `${Math.max(1, Math.round(s))} s left` : `about ${Math.round(s / 60)} min left`)
const PHASES = { download: 'Downloading ComfyUI', check: 'Checking the download', unpack: 'Unpacking', start: 'Starting ComfyUI', done: 'ComfyUI is installed', error: 'Stopped' }

export default function GetComfy({ notify, recheck }) {
  const [plan, setPlan] = useState(null)
  const [folder, setFolder] = useState('')
  const [problem, setProblem] = useState(null)
  const [st, setSt] = useState(null)
  useEffect(() => {
    window.ivstudio.comfy.installPlan().then(
      (p) => (setPlan(p), setFolder((f) => f || p.folder || ''), p.state && !p.state.done && setSt(p.state)),
      () => setPlan({ build: { ok: false, reason: 'Couldn’t read this PC’s graphics card.' } })
    )
    return window.ivstudio.comfy.onInstall?.((s) => {
      setSt(s)
      if (s.phase === 'done' && s.done) recheck?.()
    })
  }, [])
  useEffect(() => {
    if (!folder || !plan?.asset?.size) return setProblem(null)
    window.ivstudio.comfy.installCheck({ folder, size: plan.asset.size }).then(setProblem, () => {})
  }, [folder, plan?.asset?.size])

  if (!plan || plan.found) return null
  const busy = st && !st.done
  const { build, asset } = plan
  async function choose() {
    const f = await window.ivstudio.comfy.chooseInstallFolder()
    if (f) setFolder(f.endsWith('ComfyUI') ? f : `${f.replace(/[\\/]$/, '')}\\ComfyUI`)
  }
  async function go() {
    setSt({ phase: 'download', got: 0, total: asset.size })
    try {
      await window.ivstudio.comfy.install({ folder })
    } catch (err) {
      notify?.(err.message)
    }
  }
  async function haveOne() {
    try {
      if (await window.ivstudio.comfy.chooseFolder()) (notify?.('IV Studio will start that ComfyUI.', 'ok'), recheck?.())
    } catch (err) {
      notify?.(err.message)
    }
  }
  const pct = st?.phase === 'download' && st.total ? Math.min(100, (st.got / st.total) * 100) : st?.phase === 'check' ? 100 : null

  return (
    <div className="get-comfy">
      <h3>No ComfyUI on this PC yet</h3>
      {!build.ok ? (
        <p className="small">{build.reason}</p>
      ) : (
        <>
          <p className="small dim">
            IV Studio renders with ComfyUI. It can get ComfyUI’s official portable build for you{asset?.version ? ` (${asset.version})` : ''}: it comes with its own Python, so nothing else is installed on your PC, and it lives in one folder you choose.
            {asset?.size ? ` ${gb(asset.size)} to download, about ${gb(asset.size + 5 * GB)} free while it unpacks;` : ''} the H3 models it needs come next, about 60 GB, so pick a roomy drive.
          </p>
          {build.note && <p className="small dim">{build.note}</p>}
          {build.warn && <p className="small pink">{build.warn}</p>}
          {asset?.error && <p className="small pink">{asset.error}</p>}
          {!busy && st?.phase !== 'done' && (
            <div className="get-comfy-folder">
              <span className="mono small dim">Folder</span>
              <span className="mono get-comfy-path words-exact">{folder || 'Pick a folder'}</span>
              <button className="btn btn-small" onClick={choose}>
                Change…
              </button>
            </div>
          )}
          {problem && !busy && <p className="small pink">{problem}</p>}
          {st && (
            <div className={`get-comfy-progress ${st.phase}`}>
              <div className="get-comfy-progress-head">
                <span>{PHASES[st.phase] || 'Working'}</span>
                <span className="mono small dim">
                  {st.phase === 'download' && st.total ? `${gb(st.got || 0)} of ${gb(st.total)}${st.rate ? ` · ${(st.rate / 1024 ** 2).toFixed(1)} MB/s · ${mins(st.left)}` : ''}` : st.phase === 'unpack' ? `${(st.files || 0).toLocaleString()} files` : ''}
                </span>
              </div>
              {st.phase !== 'done' && st.phase !== 'error' && (
                <div className={`setup-step-bar ${pct == null ? 'busy' : ''}`}>
                  <i style={pct == null ? undefined : { width: `${Math.max(2, pct)}%` }} />
                </div>
              )}
              {st.phase === 'error' && <p className="small pink">{st.error}</p>}
              {st.phase === 'done' && (
                <p className="small">
                  {st.started === false ? `Installed in ${st.dir}, but it didn’t start: ${st.startError} Use Start ComfyUI to try again.` : `Installed in ${st.dir} and running. Next: the node packs and models below.`}
                </p>
              )}
              {busy && st.phase !== 'start' && <p className="small dim">It keeps going if you leave this page. A stopped download picks up where it left off.</p>}
            </div>
          )}
        </>
      )}
      <div className="get-comfy-btns">
        {build.ok && st?.phase !== 'done' && (
          <button className="btn btn-primary" disabled={busy || !folder || !!problem || !asset || !!asset.error} onClick={go}>
            {busy ? 'Getting ComfyUI…' : st?.phase === 'error' ? 'Try again' : 'Get ComfyUI for me'}
          </button>
        )}
        {busy && st.phase !== 'start' && (
          <button className="btn" onClick={() => window.ivstudio.comfy.installCancel()}>
            Cancel
          </button>
        )}
        {!busy && st?.phase !== 'done' && (
          <button className="link-btn" onClick={haveOne}>
            I already have ComfyUI: choose its folder
          </button>
        )}
        {!build.ok && (
          <button className="link-btn" onClick={() => window.dispatchEvent(new CustomEvent('iv:go', { detail: 'cloud' }))}>
            Render in the cloud instead
          </button>
        )}
      </div>
    </div>
  )
}
