// The speed presets (service/speed.js): cards in Settings → Your PC, a compact row in Create's Shape and size.
import { roughTime, SPEED_IDS, SPEEDS } from '../../../service/speed'

// Settings: one card per preset with what it trades and its time on a 4090
export function SpeedCards({ value, onPick, recommended }) {
  return (
    <div className="set-engines speed-cards" role="radiogroup" aria-label="Speed">
      {SPEED_IDS.map((id) => {
        const s = SPEEDS[id]
        return (
          <button key={id} role="radio" aria-checked={value === id} className={`set-engine ${value === id ? 'on' : ''}`} onClick={() => onPick(id)}>
            <span className="set-engine-name">{s.label}</span>
            <span className="small">{s.say}</span>
            <span className="small dim">{s.trade}</span>
            <span className="speed-time mono">
              Hunt {roughTime(s.estimate.hunt)} · finish {roughTime(s.estimate.finish)}
            </span>
            {recommended === id && <span className="speed-rec mono">Suits this PC</span>}
          </button>
        )
      })}
    </div>
  )
}

// Create: the presets as a segmented row; "Custom" when the size, steps or takes were changed by hand
export function SpeedRow({ value, onPick }) {
  const s = SPEEDS[value]
  return (
    <div className="create-field speed-row">
      <span className="create-label mono">
        Speed <span className="create-value">{s ? s.label : 'Custom'}</span>
      </span>
      <div className="segmented" role="radiogroup" aria-label="Speed">
        {SPEED_IDS.map((id) => (
          <button key={id} role="radio" aria-checked={value === id} className={value === id ? 'on' : ''} onClick={() => onPick(id)} title={SPEEDS[id].say}>
            {SPEEDS[id].label}
          </button>
        ))}
      </div>
      <span className="dim small">{s ? `${s.say} Hunt ${roughTime(s.estimate.hunt)}, finish ${roughTime(s.estimate.finish)} on an RTX 4090.` : 'Your own preview size, steps or takes. Pick a preset to go back to one.'}</span>
    </div>
  )
}
