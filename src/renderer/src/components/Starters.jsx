import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { STARTERS } from '../starters'

// "Start from an example" on Create (src/renderer/src/starters.js): one button that opens a pop-up of ready-made
// shots, each filling the form with a prompt the checker already passes. The button shows while the prompt is empty
// (or holds an example), so it never gets in the way of someone writing their own. The welcome wizard opens the
// first one (the iv:starter event; Create listens).

export const openStarter = (id) => window.dispatchEvent(new CustomEvent('iv:starter', { detail: { id } }))

export default function Starters({ onPick, current = null }) {
  const [open, setOpen] = useState(false)
  const now = STARTERS.find((s) => s.id === current)
  return (
    <section className="starters" aria-label="Start from an example">
      <button className="btn starters-open" onClick={() => setOpen(true)}>
        ✦ {now ? 'Pick another example' : 'Start from an example'}
      </button>
      <span className="small dim">{now ? `Filled in from “${now.name}”. Change any word to make it yours.` : 'Ready-made shots that fill everything in. Pick one, then press Hunt.'}</span>
      {open && (
        <StarterMenu
          current={current}
          onPick={(s) => {
            onPick(s)
            setOpen(false)
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </section>
  )
}

function StarterMenu({ current, onPick, onClose }) {
  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [])
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal starter-menu" role="dialog" aria-label="Start from an example">
        <div className="source-head">
          <h2>Start from an example</h2>
          <button className="link-btn mono" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <p className="dim small">Each fills in the whole shot: the prompt, its length and its shape. Then press Hunt, or change any word first.</p>
        <div className="starters-row">
          {STARTERS.map((s, i) => (
            <button key={s.id} className={`starter ${current === s.id ? 'on' : ''}`} style={{ '--i': i }} onClick={() => onPick(s)}>
              <span className="starter-tag mono small">{s.tag}</span>
              <span className="starter-name">{s.name}</span>
              <span className="starter-about small dim">{s.about}</span>
              <span className="starter-shape mono small dim">
                {s.seconds} s · {s.aspect}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body
  )
}
