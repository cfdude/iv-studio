import { useEffect, useState } from 'react'

// The person's own Claude Code or Codex making their Dashboard idea inside IV Studio (src/service/agentrun.js).
// useAgentRun: which agent there is and the current run, kept live. AgentPanel: the run's progress under the banner.
// AgentPill: the run in the title bar on other pages.
export function useAgentRun() {
  const [status, setStatus] = useState(null)
  useEffect(() => {
    let live = true
    window.ivstudio.agentRun.status().then((s) => live && setStatus(s), () => {})
    const off = window.ivstudio.agentRun.onChange((run) => live && setStatus((s) => (s ? { ...s, run } : s)))
    return () => ((live = false), off())
  }, [])
  return status
}

const STATUS = { running: 'is working', done: 'is done', failed: 'stopped with a problem', stopped: 'was stopped' }
const RENDER = { queued: 'waiting', running: 'rendering', success: 'done', error: 'failed', cancelled: 'cancelled', unknown: '' }
const KIND = { previews: 'Previews', finish: 'Finish', enhance: 'Enhance' }

export function AgentPanel({ run, onStop, onDismiss, go }) {
  if (!run) return null
  const live = run.status === 'running'
  const renders = run.renders || []
  return (
    <section className={`agent-panel agent-${run.status}`} aria-live="polite" aria-label={`${run.name} ${STATUS[run.status]}`}>
      <div className="agent-head">
        <span className={`agent-dot ${live ? 'live' : ''}`} aria-hidden="true" />
        <span className="agent-title">
          {run.name} {STATUS[run.status]}
        </span>
        <span className="agent-idea small dim" title={run.idea}>
          “{run.idea}”
        </span>
        {live ? (
          <button className="btn btn-small" onClick={onStop}>
            Stop
          </button>
        ) : (
          <button className="lora-chip-x" aria-label="Close" onClick={onDismiss}>
            ×
          </button>
        )}
      </div>
      {run.steps.length > 0 && (
        <ol className="agent-steps">
          {run.steps.map((s, i) => (
            <li key={`${s.tool}-${i}`} className={s.error ? 'agent-step-error' : i === run.steps.length - 1 && live ? 'agent-step-now' : 'agent-step-done'}>
              <span className="mono small">{s.error ? '!' : i === run.steps.length - 1 && live ? '…' : '✓'}</span> {s.label}
              {s.count > 1 && <span className="dim"> ×{s.count}</span>}
              {s.error && <span className="small dim agent-step-why"> {s.error}</span>}
            </li>
          ))}
        </ol>
      )}
      {live && run.steps.length === 0 && <p className="small dim">Starting {run.name}…</p>}
      {renders.length > 0 && (
        <ul className="agent-renders">
          {renders.map((r) => (
            <li key={r.id} className="small">
              <span className="mono">{KIND[r.kind] || 'Render'}</span> <span className="dim">{RENDER[r.status] ?? r.status}</span>
              {r.status === 'running' && r.progress != null && <span className="dim">{r.progress}%</span>}
              {r.status === 'running' && r.progress != null && (
                <span className="agent-bar" aria-hidden="true">
                  <span style={{ width: `${r.progress}%` }} />
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {run.say && <p className="agent-say">{run.say}</p>}
      {!live && renders.some((r) => ['success', 'running', 'queued'].includes(r.status)) && (
        <button className="btn btn-small btn-primary" onClick={() => go('library')}>
          Open Shots
        </button>
      )}
    </section>
  )
}

export function AgentPill({ status, onOpen }) {
  const run = status?.run
  if (!run || run.status !== 'running') return null
  return (
    <button className="agent-pill mono" onClick={onOpen} title={`${run.name} is making “${run.idea}”`}>
      <span className="agent-dot live" aria-hidden="true" />
      {run.name} working
    </button>
  )
}
