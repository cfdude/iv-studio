import { useEffect, useRef } from 'react'

// What's new after an update (news.js): the Dashboard shows a small "See what's new" button, and this is the pop-up
// it opens. Got it, ×, Esc or the backdrop closes it, and that counts as seen.
export function NewsChip({ news, onOpen, onDismiss }) {
  if (!news) return null
  return (
    <div className="news-chip" role="region" aria-label="What's new">
      <button className="news-chip-open" onClick={onOpen}>
        <span className="news-chip-dot" aria-hidden="true" />
        <span className="mono small pink">New in {news.version}</span>
        <span className="news-chip-text">See what’s new in this update</span>
        <span className="news-chip-arrow" aria-hidden="true">
          →
        </span>
      </button>
      <button className="lora-chip-x" aria-label="Dismiss what's new" title="Dismiss (it stays in Settings → Updates)" onClick={onDismiss}>
        ×
      </button>
    </div>
  )
}

export default function WhatsNew({ news, onClose, go }) {
  const okRef = useRef(null)
  useEffect(() => {
    okRef.current?.focus()
    const key = (e) => e.key === 'Escape' && (e.preventDefault(), onClose())
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [onClose])
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal whats-new" role="dialog" aria-modal="true" aria-labelledby="whats-new-title">
        <div className="modal-head">
          <h2 id="whats-new-title">What’s new</h2>
          <span className="mono small pink">IV Studio {news.version}</span>
          <span className="spacer" />
          <button className="lora-chip-x" aria-label="Close what's new" onClick={onClose}>
            ×
          </button>
        </div>
        <ul className="whats-new-list">
          {news.items.map((n) => (
            <li key={n.text}>{n.text}</li>
          ))}
        </ul>
        <div className="modal-foot">
          <span className="small dim">
            Earlier updates are in{' '}
            <button className="link-btn" onClick={() => (onClose(), go?.('settings'))}>
              Settings → Updates
            </button>
            .
          </span>
          <span className="spacer" />
          <button ref={okRef} className="btn btn-primary" onClick={onClose}>
            Got it
          </button>
        </div>
      </div>
    </div>
  )
}
