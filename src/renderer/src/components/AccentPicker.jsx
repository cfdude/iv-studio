import { ACCENTS, accentOf } from '../accent'

// Four colour swatches (accent.js). onPick gets the id; the caller saves it and applies it.
export default function AccentPicker({ value, onPick }) {
  const on = accentOf(value).id
  return (
    <div className="accent-pick" role="radiogroup" aria-label="Colour">
      {ACCENTS.map((a) => (
        <button key={a.id} role="radio" aria-checked={on === a.id} className={`accent-swatch ${on === a.id ? 'on' : ''}`} style={{ '--swatch': a.hex }} onClick={() => onPick(a.id)}>
          <span className="accent-dot" aria-hidden="true" />
          {a.label}
          {a.id === 'red' && <span className="dim small"> (default)</span>}
        </button>
      ))}
    </div>
  )
}
