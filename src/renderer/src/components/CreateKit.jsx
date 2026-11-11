// Pieces Create's Video and Image sides share: the Video | Image selector under the banner, a step's heading,
// an aspect ratio drawn as its shape, and the drop icon.

// Video or Image, as two cards with their own picture.
export function CreateKind({ kind, onKind }) {
  const kinds = [
    ['video', 'Video', 'A shot with sound, made by H3', <FilmIcon key="f" />],
    ['image', 'Image', 'Pictures from your image models', <PictureIcon key="p" />]
  ]
  return (
    <div className="create-kind" role="tablist" aria-label="Video or image">
      {kinds.map(([id, label, sub, icon]) => (
        <button key={id} role="tab" aria-selected={kind === id} className={`create-kind-card ${kind === id ? 'on' : ''}`} onClick={() => onKind(id)}>
          <span className="create-kind-icon">{icon}</span>
          <span className="create-kind-text">
            <span className="create-kind-name">{label}</span>
            <span className="dim small">{sub}</span>
          </span>
        </button>
      ))}
    </div>
  )
}

// A step's number, title and one line on what it's for.
// subPlain: the sub line in plain words, shown instead with Simple words on (words.js)
export function StepHead({ n, title, sub, subPlain }) {
  return (
    <div className="step-head">
      {n != null && <span className="step-n">{String(n).padStart(2, '0')}</span>}
      <div>
        <h2>{title}</h2>
        {sub && (
          <p className="dim small" data-plain={subPlain}>
            {sub}
          </p>
        )}
      </div>
    </div>
  )
}

// An aspect ratio drawn as its shape.
export function AspectGlyph({ a }) {
  const [w, h] = a.split(':').map(Number)
  const s = 22 / Math.max(w, h)
  return (
    <span className="aspect-glyph" aria-hidden="true">
      <span style={{ width: Math.round(w * s), height: Math.round(h * s) }} />
    </span>
  )
}

// Aspect ratios as shape tiles.
export function AspectTiles({ aspects, value, onChange }) {
  return (
    <div className="aspect-tiles" role="radiogroup" aria-label="Aspect ratio">
      {aspects.map((a) => (
        <button key={a} role="radio" aria-checked={value === a} className={`aspect-tile ${value === a ? 'on' : ''}`} onClick={() => onChange(a)}>
          <AspectGlyph a={a} />
          <span className="mono">{a}</span>
        </button>
      ))}
    </div>
  )
}

export function DropIcon() {
  return (
    <svg viewBox="0 0 32 32" width="34" height="34" aria-hidden="true" className="drop-icon">
      <g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 5v15M10 14l6 6 6-6" />
        <path d="M6 21v4a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-4" />
      </g>
    </svg>
  )
}

const LINE = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }

function FilmIcon() {
  return (
    <svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true">
      <g {...LINE}>
        <rect x="4" y="7" width="24" height="18" rx="2" />
        <path d="M9 7v18M23 7v18M4 12h5M4 20h5M23 12h5M23 20h5" />
        <path d="M14 13l5 3-5 3z" />
      </g>
    </svg>
  )
}

function PictureIcon() {
  return (
    <svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true">
      <g {...LINE}>
        <rect x="5" y="6" width="22" height="20" rx="2" />
        <circle cx="12" cy="13" r="2.4" />
        <path d="M6 23l7-7 5 5 3-3 6 6" />
      </g>
    </svg>
  )
}

// Line icons for Image's two modes.
export function ImageModeIcon({ id }) {
  return (
    <svg className="mode-icon" viewBox="0 0 32 32" width="30" height="30" aria-hidden="true">
      {id === 'generate' ? (
        <g {...LINE}>
          <path d="M16 5l2.4 6.6L25 14l-6.6 2.4L16 23l-2.4-6.6L7 14l6.6-2.4z" />
          <path d="M24 22l1 2.6 2.6 1-2.6 1-1 2.6-1-2.6-2.6-1 2.6-1z" />
        </g>
      ) : id === 'tools' ? (
        <g {...LINE}>
          <path d="M20.5 5.5a6 6 0 00-7.7 7.7L5 21l3 3 7.8-7.8a6 6 0 007.7-7.7l-3.6 3.6-3-1-1-3z" />
        </g>
      ) : (
        <g {...LINE}>
          <rect x="4" y="9" width="17" height="15" rx="1.5" />
          <path d="M18 18l9-9M24 7l3 3" />
          <path d="M7 21l4-4 3 3" />
        </g>
      )}
    </svg>
  )
}
