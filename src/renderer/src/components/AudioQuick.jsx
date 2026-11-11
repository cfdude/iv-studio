// The quick-start bar on a page's tall banner (the audio pages, and the visual side's main pages): the page's main
// words and its main button, in the Workflows tools' glass panel (.stage-panel). It edits the same state as the page's form below, so
// nothing is typed twice. When the page can't run yet, a short note says why, with a button that shows the way.
//
// value / onChange: the words. onGo: the page's own action (the same one the form's button runs). disabled: exactly
// the form button's disabled. before: anything that sits before the words (Lines' voice picker). after: more buttons.
// note: { text, action?: { label, onClick } } when the page isn't ready.
//
// search: the words are a search. Then the button is always Search, and it (or Enter) takes the person down to the
// results (results: the selector where they start); once something is typed, a line under the bar says how many
// match (found, counted as noun) and goes there too. The page's own "+ New ..." is alt ({ label, onClick, disabled }),
// a separate smaller button under the bar so it isn't mistaken for part of the search.
export default function QuickBar({ value, onChange, placeholder, label, goLabel, busyLabel, busy, disabled, onGo, before, after, note, search = false, results = '.lede', found, noun = 'result', alt }) {
  const go = () => !disabled && onGo?.()
  const words = String(value || '').trim()
  const toResults = () => showBelow(results)
  const plural = (n) => `${n} ${noun}${n === 1 ? '' : 's'}`
  return (
    <>
      <div className={`stage-panel stage-quick ${search ? 'stage-search' : ''}`}>
        {before}
        {search && (
          <svg className="stage-search-icon" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="10.5" cy="10.5" r="6.5" />
            <path d="M15.5 15.5L20 20" />
          </svg>
        )}
        <input
          type={search ? 'search' : 'text'}
          value={value}
          placeholder={placeholder}
          aria-label={label}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (search ? words && toResults() : go())}
        />
        {search ? (
          <button className="btn btn-primary" disabled={!words} onClick={toResults} title={words ? 'Show the results below' : 'Type what to look for first'}>
            Search
          </button>
        ) : (
          goLabel && (
            <button className="btn btn-primary" disabled={disabled} onClick={go}>
              {busy ? busyLabel || 'Working…' : goLabel}
            </button>
          )
        )}
        {after}
      </div>
      {search && words && (
        <p className="stage-note stage-found small" aria-live="polite">
          {found === 0 ? (
            <>No {noun}s match “{words}”.</>
          ) : (
            <button className="link-btn" onClick={toResults}>
              {found == null ? 'See the results' : `${plural(found)} match: see ${found === 1 ? 'it' : 'them'}`} ↓
            </button>
          )}
        </p>
      )}
      {search && alt && (
        <div className="stage-alt">
          <span className="small dim">or</span>
          <button className="btn btn-small" disabled={alt.disabled} onClick={alt.onClick}>
            {alt.label}
          </button>
        </div>
      )}
      {note && (
        <p className="stage-note stage-quick-note small">
          {note.text}
          {note.action && (
            <>
              {' '}
              <button className="link-btn" onClick={note.action.onClick}>
                {note.action.label}
              </button>
            </>
          )}
        </p>
      )}
    </>
  )
}

// Brings a part of the page below the banner into view (the setup card, the form, a search's results); straight
// there under Reduce motion.
export const showBelow = (selector) => {
  const still = document.documentElement.classList.contains('rm') || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  document.querySelector(selector)?.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' })
}
