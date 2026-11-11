import { useEffect, useMemo, useRef, useState } from 'react'
import { CREDITS } from '../credits'

const open = (url) => url && window.ivstudio.links.open(url)

// Settings → About → Credits: who and what IV Studio is built on (credits.js), grouped by what each does here,
// with a search. Esc or the backdrop closes it.
export default function Credits({ onClose }) {
  const [q, setQ] = useState('')
  const searchRef = useRef(null)
  useEffect(() => {
    searchRef.current?.focus()
    const key = (e) => e.key === 'Escape' && (e.preventDefault(), onClose())
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [onClose])
  const groups = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const hit = (i) => words.every((w) => [i.name, i.by, i.use, i.licence, i.note].filter(Boolean).join(' ').toLowerCase().includes(w))
    return CREDITS.map((g) => ({ ...g, items: g.items.filter(hit) })).filter((g) => g.items.length)
  }, [q])
  const total = CREDITS.reduce((n, g) => n + g.items.length, 0)
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal credits" role="dialog" aria-modal="true" aria-labelledby="credits-title">
        <div className="modal-head">
          <h2 id="credits-title">Credits</h2>
          <span className="small dim">IV Studio is built on {total} pieces of other people’s work. Thank you.</span>
          <span className="spacer" />
          <button className="lora-chip-x" aria-label="Close the credits" onClick={onClose}>
            ×
          </button>
        </div>
        <input ref={searchRef} className="credits-search" placeholder="Search: a name, a maker, a page or a licence" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="credits-body">
          {groups.map((g) => (
            <section key={g.group} className="credits-group">
              <h3 className="mono">{g.group}</h3>
              {g.note && <p className="small dim">{g.note}</p>}
              <ul>
                {g.items.map((i) => (
                  <li key={i.name}>
                    <div className="credits-name">
                      {i.url ? (
                        <button className="link-btn" onClick={() => open(i.url)}>
                          {i.name} ↗
                        </button>
                      ) : (
                        <span>{i.name}</span>
                      )}
                      {i.by && <span className="dim"> by {i.by}</span>}
                    </div>
                    <div className="credits-use small">{i.use}</div>
                    {(i.licence || i.note) && (
                      <div className="credits-meta small dim">
                        {i.licence && <span className="credits-licence mono">{i.licence}</span>}
                        {i.note && <span>{i.note}</span>}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {!groups.length && <p className="small dim">Nothing matches “{q}”.</p>}
        </div>
        <p className="small dim credits-foot">
          IV Studio itself is MIT-licensed. Each model and tool keeps its own licence: check a model’s page before commercial use. The full licence texts ship with the app, and{' '}
          <button className="link-btn" onClick={() => open('https://github.com/hollisorg/iv-studio/blob/main/THIRD_PARTY_NOTICES.md')}>
            THIRD_PARTY_NOTICES
          </button>{' '}
          lists what the app bundles.
        </p>
      </div>
    </div>
  )
}
