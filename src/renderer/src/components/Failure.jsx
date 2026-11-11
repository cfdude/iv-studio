import { useState } from 'react'
import { askAgent, useAgentName } from './ChatPanel'

// A failed render, said plainly (src/service/failures.js): what happened, why, and a button for each thing that
// fixes it. ComfyUI's own message stays under Details. A job without an explanation shows its message as before.
//
// job: a job as the window sees it ({ status, error, explain }). go(page): the app's navigation.
// onRetry: run it again (only offered where the page can).

const SPEED_EVENT = 'iv:settings'

export default function Failure({ job, error, explain, go, notify, onRetry }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(null)
  // the person's own Claude Code or Codex can look into it from the chat (ChatPanel.jsx)
  const agent = useAgentName()
  // a page that wasn't handed the app's navigation still gets there (App.jsx listens for iv:go)
  const to = (page) => (go ? go(page) : window.dispatchEvent(new CustomEvent('iv:go', { detail: { page } })))
  const x = explain ?? job?.explain
  const raw = error ?? job?.error
  if (!x) return raw ? <p className="notice">{raw}</p> : null

  const act = async (fix) => {
    setBusy(fix.id)
    try {
      if (fix.id === 'lower-memory') {
        // the speed preset Settings → Your PC shows (speed.js); Create picks it up for the next shot
        await window.ivstudio.settings.set({ speed: 'low' })
        window.dispatchEvent(new CustomEvent(SPEED_EVENT))
        notify?.('Switched to the Low memory preset. New shots use it; change it back in Settings → Your computer.')
      } else if (fix.id === 'restart-comfy') {
        await window.ivstudio.comfy.restart()
        notify?.('Restarting ComfyUI. Give it a minute, then try again.')
      } else if (fix.id === 'open-setup') to('setup')
      else if (fix.id === 'open-cloud') to('cloud')
      else if (fix.id === 'comfy-account' || fix.id === 'free-space') {
        to('settings')
        setTimeout(() => document.getElementById(fix.id === 'free-space' ? 'set-data' : 'set-account')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 400)
      } else if (fix.id === 'try-again') await onRetry?.()
    } catch (err) {
      notify?.(err.message)
    }
    setBusy(null)
  }
  // "Try again" only where the page gave a way to
  const fixes = x.fixes.filter((f) => f.id !== 'try-again' || onRetry)
  const askFix = () =>
    askAgent({
      send: true,
      about: `the failed render (job ${job.id})`,
      text: `This render failed. IV Studio says: ${x.title} ${x.why}\nFind out what went wrong (check_setup, get_job) and fix what you can. Tell me in plain words what it was and what you did.`
    })

  return (
    <div className="failure" role="alert">
      <strong className="failure-title">{x.title}</strong>
      <p className="failure-why">{x.why}</p>
      {(fixes.length > 0 || (agent && job?.id)) && (
        <div className="failure-fixes">
          {fixes.map((f, i) => (
            <button key={f.id} className={`btn btn-small ${i === 0 ? 'btn-primary' : ''}`} disabled={!!busy} onClick={() => act(f)}>
              {busy === f.id ? 'Working…' : f.label}
            </button>
          ))}
          {agent && job?.id && (
            <button className={`btn btn-small failure-ask ${fixes.length ? '' : 'btn-primary'}`} onClick={askFix} title={`${agent} looks into it in the chat, and asks before it installs or changes anything`}>
              Ask {agent} to fix it
            </button>
          )}
        </div>
      )}
      <button className="link-btn small" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? 'Hide details' : 'Details'}
      </button>
      {open && <pre className="failure-raw mono small">{x.raw}</pre>}
    </div>
  )
}
