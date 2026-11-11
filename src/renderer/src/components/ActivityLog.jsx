import { useEffect, useMemo, useState } from 'react'

// What agents did in IV Studio (src/service/activity.js): the chat, Dashboard ideas, and Claude Desktop, Codex or any
// other agent using IV Studio's MCP server from outside. Each step that changed something, spent or failed, newest
// first by day, with who took it, a link to what it touched, and Undo for a change to an edit.
const WHO = [
  ['all', 'Everyone'],
  ['chat', 'The chat'],
  ['outside', 'Outside agents'],
  ['idea', 'Dashboard ideas']
]
const dayName = (at) => {
  const d = new Date(at)
  const today = new Date()
  const y = new Date(Date.now() - 86400000)
  const same = (a, b) => a.toDateString() === b.toDateString()
  if (same(d, today)) return 'Today'
  if (same(d, y)) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
}
const timeOf = (at) => new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

// where a step's result can be opened, best first
const OPENS = [
  ['editId', 'edit', 'Open the edit'],
  ['projectId', 'shot', 'Open the shot'],
  ['filmId', 'film', 'Open the film'],
  ['sequenceId', 'sequence', 'Open the sequence'],
  ['imageId', 'images', 'Open pictures'],
  ['songId', 'music', 'Open Music'],
  ['lineId', 'lines', 'Open Lines'],
  ['voiceId', 'voices', 'Open Voices']
]
export const openOf = (refs = {}) => {
  for (const [key, kind, label] of OPENS) if (refs[key]) return { kind, id: refs[key], label }
  return null
}

export default function ActivityLog({ notify, openRef }) {
  const [items, setItems] = useState(null)
  const [who, setWho] = useState('all')
  const [problems, setProblems] = useState(false)
  const load = () =>
    window.ivstudio.activity
      .list({ days: 14, who: who === 'all' ? null : who, problems })
      .then(setItems, (err) => (setItems([]), notify?.(err.message)))
  useEffect(() => {
    load()
    const off = window.ivstudio.activity.onChange(() => load())
    return () => off()
  }, [who, problems])
  const days = useMemo(() => {
    const out = []
    for (const e of items || []) {
      const name = dayName(e.at)
      if (!out.length || out[out.length - 1].name !== name) out.push({ name, items: [] })
      out[out.length - 1].items.push(e)
    }
    return out
  }, [items])
  const undo = async (e) => {
    try {
      const r = await window.ivstudio.activity.undo(e.undo)
      notify?.(`Put “${r.name}” back as it was.`, 'ok')
      load()
    } catch (err) {
      notify?.(err.message)
    }
  }

  return (
    <div className="activity">
      <div className="activity-bar">
        <select className="small" value={who} onChange={(ev) => setWho(ev.target.value)} aria-label="Whose steps">
          {WHO.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
        <label className="activity-problems small">
          <input type="checkbox" checked={problems} onChange={(ev) => setProblems(ev.target.checked)} /> Only problems
        </label>
      </div>
      {items === null ? (
        <p className="small dim activity-empty">Loading…</p>
      ) : !items.length ? (
        <p className="small dim activity-empty">
          {problems ? 'No failed steps in the last two weeks.' : 'Nothing yet. When an agent makes, changes or spends something in IV Studio, it shows here: the chat, Dashboard ideas, and Claude Desktop, Codex or any agent using IV Studio from outside.'}
        </p>
      ) : (
        <div className="activity-days">
          {days.map((d) => (
            <section key={d.name} className="activity-day">
              <h3 className="mono small">{d.name}</h3>
              <ol>
                {d.items.map((e) => {
                  // a step that failed may name something that doesn't exist (a wrong id), so it has no Open
                  const open = e.ok ? openOf(e.refs) : null
                  return (
                    <li key={e.id} className={`activity-item ${e.ok ? '' : 'bad'} who-${e.who?.kind || 'outside'}`}>
                      <div className="activity-line">
                        <span className="activity-time mono">{timeOf(e.at)}</span>
                        <span className="activity-who mono">{e.who?.name || 'An agent'}</span>
                      </div>
                      <div className="activity-what">
                        <span aria-hidden="true">{e.ok ? '✓' : '!'}</span> {e.label}
                        {e.about && <span className="dim"> · {e.about}</span>}
                      </div>
                      {!e.ok && e.error && <div className="activity-why small">{e.error}</div>}
                      {e.spend && (
                        <div className="activity-spend mono small">
                          Spent {Number(e.spend.credits || 0).toLocaleString('en-US')} credits (${Number(e.spend.usd || 0).toFixed(2)})
                        </div>
                      )}
                      {(open || e.undo) && (
                        <div className="activity-acts">
                          {open && (
                            <button className="link-btn mono small" onClick={() => openRef?.(open.kind, open.id)}>
                              {open.label} →
                            </button>
                          )}
                          {e.undo &&
                            (e.undone ? (
                              <span className="mono small dim">Undone</span>
                            ) : (
                              <button className="link-btn mono small" onClick={() => undo(e)}>
                                Undo this change
                              </button>
                            ))}
                        </div>
                      )}
                    </li>
                  )
                })}
              </ol>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
