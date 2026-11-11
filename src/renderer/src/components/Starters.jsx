import { STARTERS } from '../starters'

// "Start from an example" on Create (src/renderer/src/starters.js): a row of ready-made shots that fill the form
// with a prompt the checker already passes. Shown while the prompt is empty, so it never gets in the way of
// someone who is writing their own. The welcome wizard opens the first one (the iv:starter event; Create listens).

export const openStarter = (id) => window.dispatchEvent(new CustomEvent('iv:starter', { detail: { id } }))

export default function Starters({ onPick, current = null }) {
  return (
    <section className="starters" aria-label="Start from an example">
      <div className="starters-head">
        <strong>Start from an example</strong>
        <span className="small dim">Pick one to fill in the shot, then press Hunt. Change any word to make it yours.</span>
      </div>
      <div className="starters-row">
        {STARTERS.map((s) => (
          <button key={s.id} className={`starter ${current === s.id ? 'on' : ''}`} onClick={() => onPick(s)} title={s.about}>
            <span className="starter-tag mono small">{s.tag}</span>
            <span className="starter-name">{s.name}</span>
            <span className="starter-about small dim">{s.about}</span>
            <span className="starter-shape mono small dim">
              {s.seconds} s · {s.aspect}
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}
