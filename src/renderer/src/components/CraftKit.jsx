// Film craft in the window (filmcraft.js, after Sam Wasserman's Slate): the Cinematography picker, the prompt
// tools (a director's note, Tighten, Enrich, Distill, Stronger shot, New angle, Variants) and the Lookbook.
import { useEffect, useMemo, useState } from 'react'

const C = () => window.ivstudio.craft

let slateCache = null
// Slate's setups and coverage plans, and which writer the tools use ({ setups, plans, writer }).
export function useSlate() {
  const [s, setS] = useState(slateCache)
  useEffect(() => {
    if (!slateCache) C().slate().then((r) => setS((slateCache = r)), () => {})
  }, [])
  return s
}

// The Cinematography picker: Slate's 165 setups in 12 groups. value: the chosen setups ({ id, label, snippet });
// onChange gets the new list. A dialog over the page.
export function CinemaPicker({ value = [], onChange, onClose }) {
  const slate = useSlate()
  const [group, setGroup] = useState('')
  const [q, setQ] = useState('')
  const chosen = new Set(value.map((s) => s.id))
  useEffect(() => {
    const key = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])
  const groups = slate?.setups || []
  const shown = useMemo(() => {
    const words = q.trim().toLowerCase()
    return groups
      .filter((g) => !group || g.id === group)
      .map((g) => ({ ...g, items: g.items.filter((i) => !words || `${i.label} ${i.snippet} ${i.tags.join(' ')}`.toLowerCase().includes(words)) }))
      .filter((g) => g.items.length)
  }, [groups, group, q])
  const toggle = (i) => onChange(chosen.has(i.id) ? value.filter((s) => s.id !== i.id) : [...value, { id: i.id, label: i.label, snippet: i.snippet }])
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal craft-picker" role="dialog" aria-label="Cinematography">
        <div className="craft-picker-head">
          <div>
            <h3 className="craft-title">Cinematography</h3>
            <p className="small dim">Film stocks, lenses, light, camera rigs and moods. Each adds a tested phrase to the prompt. From Slate by Sam Wasserman.</p>
          </div>
          <button className="lora-chip-x" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="craft-picker-bar">
          <input className="craft-search" value={q} placeholder="Search: portra, rim light, handheld, noir…" onChange={(e) => setQ(e.target.value)} aria-label="Search the setups" autoFocus />
          <div className="craft-groups" role="tablist" aria-label="Groups">
            <button role="tab" aria-selected={!group} className={!group ? 'on' : ''} onClick={() => setGroup('')}>
              All
            </button>
            {groups.map((g) => (
              <button key={g.id} role="tab" aria-selected={group === g.id} className={group === g.id ? 'on' : ''} onClick={() => setGroup(g.id)}>
                {g.label}
              </button>
            ))}
          </div>
        </div>
        <div className="craft-picker-body">
          {!slate && <p className="small dim">Loading…</p>}
          {slate && !shown.length && <p className="small dim">Nothing matches “{q}”.</p>}
          {shown.map((g) => (
            <section key={g.id} className="craft-group">
              <h4 className="mono small dim">{g.label}</h4>
              <div className="craft-chips">
                {g.items.map((i) => (
                  <button key={i.id} className={`craft-chip ${chosen.has(i.id) ? 'on' : ''}`} aria-pressed={chosen.has(i.id)} title={i.snippet} onClick={() => toggle(i)}>
                    {i.label}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
        <div className="craft-picker-foot">
          <span className="small dim">{value.length ? `${value.length} chosen: ${value.map((s) => s.label).join(', ')}` : 'Nothing chosen yet.'}</span>
          <button className="btn btn-small btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

// The chosen setups as small chips, with × to take one away and + to open the picker.
export function CinemaChips({ value = [], onChange, onOpen, label = '+ Cinematography' }) {
  return (
    <div className="craft-chosen">
      {value.map((s) => (
        <span key={s.id} className="craft-chip on small" title={s.snippet}>
          {s.label}
          <button aria-label={`Remove ${s.label}`} onClick={() => onChange(value.filter((x) => x.id !== s.id))}>
            ×
          </button>
        </span>
      ))}
      <button className="link-btn mono small craft-open" onClick={onOpen}>
        {label}
      </button>
    </div>
  )
}

export const TOOLS = [
  ['tighten', 'Tighten', 'Shorter by about a third, every concrete fact kept'],
  ['enrich', 'Enrich', 'More specific cinematography: lens, light, texture, atmosphere'],
  ['distill', 'Distill', 'Just the strongest core, in the fewest words'],
  ['shot', 'Stronger shot', 'Clearer framing and blocking'],
  ['angle', 'New angle', 'A more dramatic camera angle, same action']
]

// The prompt tools under a prompt. run({ tool, note }) -> { prompt, reply, missing } rewrites it (the caller saves it);
// variants() -> [{ label, prompt, missing }]; onUse(prompt, why) puts a variant in. history: [{ prompt, why, at }]
// with onRestore(index), or null to keep an in-memory one here (Create).
export function PromptTools({ prompt, run, variants, onUse, writer, history = null, onRestore = null, disabled = false }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState('')
  const [reply, setReply] = useState(null) // { text, missing }
  const [vars, setVars] = useState(null)
  const [local, setLocal] = useState([]) // Create's own history while the page is open
  const past = history ?? local
  const go = async (tool) => {
    setBusy(tool)
    setReply(null)
    try {
      const before = prompt
      const r = await run({ tool, note: tool === 'note' ? note : '' })
      if (r) {
        if (!history) setLocal((h) => [{ prompt: before, why: tool === 'note' ? `note: ${note.slice(0, 50)}` : tool, at: new Date().toISOString() }, ...h].slice(0, 20))
        setReply({ text: r.reply, missing: r.missing || [] })
        if (tool === 'note') setNote('')
      }
    } catch (err) {
      setReply({ text: err.message, error: true, missing: [] })
    } finally {
      setBusy('')
    }
  }
  const getVariants = async () => {
    setBusy('variants')
    setReply(null)
    try {
      setVars(await variants())
    } catch (err) {
      setReply({ text: err.message, error: true, missing: [] })
    } finally {
      setBusy('')
    }
  }
  const use = (v) => {
    if (!history) setLocal((h) => [{ prompt, why: `variant: ${v.label}`, at: new Date().toISOString() }, ...h].slice(0, 20))
    onUse(v.prompt, `variant: ${v.label}`)
    setVars(null)
  }
  const restore = (i) => {
    if (onRestore) return onRestore(i)
    const h = local[i]
    setLocal((l) => [{ prompt, why: 'before going back', at: new Date().toISOString() }, ...l.filter((_, j) => j !== i)].slice(0, 20))
    onUse(h.prompt, 'went back')
  }
  const off = disabled || !prompt?.trim() || !!busy
  return (
    <div className="craft-tools">
      <div className="craft-note">
        <input value={note} placeholder="A director's note: make it colder, she shouldn't smile, end on the door…" onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && note.trim() && !off && go('note')} aria-label="Director's note" />
        <button className="btn btn-small" disabled={off || !note.trim()} onClick={() => go('note')}>
          {busy === 'note' ? 'Working…' : 'Apply note'}
        </button>
      </div>
      <div className="craft-tool-row">
        {TOOLS.map(([id, label, what]) => (
          <button key={id} className="btn btn-small" title={what} disabled={off} onClick={() => go(id)}>
            {busy === id ? `${label}…` : label}
          </button>
        ))}
        <button className="btn btn-small" title="Three versions weighting composition, light or motion, to compare" disabled={off} onClick={getVariants}>
          {busy === 'variants' ? 'Variants…' : '3 variants'}
        </button>
        {writer && <span className="mono small dim craft-writer">with {writer}</span>}
      </div>
      {reply && (
        <p className={`small ${reply.error ? 'pink' : 'dim'}`}>
          {reply.text}
          {reply.missing?.length > 0 && <span className="pink"> It dropped {reply.missing.join(', ')}: check the prompt, or go back.</span>}
        </p>
      )}
      {vars && (
        <div className="craft-variants">
          {vars.map((v, i) => (
            <div key={i} className="craft-variant">
              <div className="craft-variant-head">
                <span className="mono small">{v.label}</span>
                <button className="btn btn-small" onClick={() => use(v)}>
                  Use this one
                </button>
              </div>
              <p className="small">{v.prompt}</p>
              {v.missing?.length > 0 && <p className="small pink">Drops {v.missing.join(', ')}.</p>}
            </div>
          ))}
          <button className="link-btn mono small" onClick={() => setVars(null)}>
            Keep the prompt as it is
          </button>
        </div>
      )}
      {past.length > 0 && (
        <details className="craft-history">
          <summary className="mono small">Earlier versions ({past.length})</summary>
          {past.map((h, i) => (
            <div key={i} className="craft-history-row">
              <span className="mono small dim">{h.why}</span>
              <span className="small craft-history-text" title={h.prompt}>
                {h.prompt.slice(0, 140)}
                {h.prompt.length > 140 ? '…' : ''}
              </span>
              <button className="link-btn mono small" onClick={() => restore(i)}>
                Go back to this
              </button>
            </div>
          ))}
        </details>
      )}
    </div>
  )
}

// The Lookbook: a film, director or cinematographer (or a described look) into look language with no names.
// value: { source, fields, words } or null; onChange(look | null).
export function LookbookBox({ value, onChange, writer }) {
  const [source, setSource] = useState(value?.source || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const make = async () => {
    setBusy(true)
    setError('')
    try {
      onChange(await C().lookbook(source))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  const LABELS = { tone: 'Tone', palette: 'Palette', lighting: 'Lighting', lens: 'Lens', movement: 'Camera movement', blocking: 'Blocking', texture: 'Texture and grain' }
  return (
    <div className="craft-lookbook">
      <div className="craft-note">
        <input value={source} placeholder="Look like… a film, a director, a cinematographer, or words: rain-soaked 90s Hong Kong night" onChange={(e) => setSource(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && source.trim() && !busy && make()} aria-label="Lookbook source" />
        <button className="btn btn-small" disabled={busy || !source.trim()} onClick={make}>
          {busy ? 'Studying the look…' : value ? 'Make it again' : 'Make the lookbook'}
        </button>
      </div>
      {writer && !value && <p className="small dim">{writer} turns it into look language with no names in it (names don't go into prompts).</p>}
      {error && <p className="small pink">{error}</p>}
      {value && (
        <div className="craft-look">
          <dl>
            {Object.entries(value.fields || {})
              .filter(([, t]) => t)
              .map(([k, t]) => (
                <div key={k}>
                  <dt className="mono small dim">{LABELS[k] || k}</dt>
                  <dd className="small">{t}</dd>
                </div>
              ))}
          </dl>
          <button className="link-btn mono small" onClick={() => (onChange(null), setSource(''))}>
            Remove the lookbook
          </button>
        </div>
      )}
    </div>
  )
}
