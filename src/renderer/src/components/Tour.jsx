import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { usePlatform } from '../platform'
import { TOURS, markTourSeen, tourText } from '../tours'

const PAD = 8 // room round the lit part
const GAP = 14 // between the lit part and the card
const EDGE = 12 // kept clear of the window's edges

// The first on-screen element a step points at (a selector, or a list of them), or null.
function targetOf(step) {
  if (!step?.at) return null
  for (const sel of [].concat(step.at)) {
    let els
    try {
      // "step:Shape and size" is the Create-style step card with that heading
      els = sel.startsWith('step:') ? [...document.querySelectorAll('.create-step')].filter((s) => s.querySelector('.step-head h2')?.textContent.trim() === sel.slice(5)) : document.querySelectorAll(sel)
    } catch {
      continue
    }
    for (const el of els) {
      if (el.closest('.tour')) continue
      const r = el.getBoundingClientRect()
      if (r.width > 4 && r.height > 4 && getComputedStyle(el).visibility !== 'hidden') return el
    }
  }
  return null
}

const usable = (step) => !step.at || !!targetOf(step)

// The tour player: one per window. "?" buttons start a page's tour (tours.js startTour); it lights up each part
// in turn and puts a card beside it. Esc closes, the arrow keys step.
export default function TourHost() {
  const platform = usePlatform()
  const [tour, setTour] = useState(null) // { id, steps }
  const [i, setI] = useState(0)
  const [rect, setRect] = useState(null)
  const [card, setCard] = useState({ top: 0, left: 0, ready: false })
  // true while a step's page is still opening (go): the card waits, then shows beside the part or in the middle
  const [seeking, setSeeking] = useState(false)
  const cardRef = useRef(null)
  const elRef = useRef(null)

  useEffect(() => {
    const start = (e) => {
      // a tour by its id, or a one-step tour made on the spot (tours.js spotTour: the chat's "show me where")
      const t = typeof e.detail === 'object' && e.detail?.steps ? e.detail : TOURS[e.detail]
      if (!t) return
      // steps on another page (go) are kept: their part only shows once the app has gone there
      const steps = t.steps.filter((s) => s.go || usable(s))
      if (!steps.length) return
      setTour({ id: t.id || e.detail, title: t.title, steps })
      setI(0)
    }
    window.addEventListener('iv:tour', start)
    return () => window.removeEventListener('iv:tour', start)
  }, [])

  const step = tour?.steps[i]
  const last = tour && i === tour.steps.length - 1
  const close = () => {
    if (tour) markTourSeen(tour.id)
    setTour(null)
    setRect(null)
    setSeeking(false)
  }
  const go = (d) => setI((n) => Math.max(0, Math.min(tour.steps.length - 1, n + d)))

  // find this step's part and bring it into view
  useEffect(() => {
    if (!step) return
    let gone = false
    const show = (el) => {
      setSeeking(false)
      elRef.current = el
      if (!el) return setRect(null)
      const r = el.getBoundingClientRect()
      const top = Math.max(r.top, 48)
      setRect({ top, left: r.left, width: r.width, height: Math.max(0, Math.min(r.bottom, window.innerHeight - 12) - top) })
      const tall = r.height > window.innerHeight - 260
      if (r.top < 60 || r.bottom > window.innerHeight - 20 || tall) el.scrollIntoView({ block: tall ? 'start' : 'center', behavior: 'smooth' })
    }
    if (!step.go) {
      show(targetOf(step))
      return
    }
    // another page: go there, then wait (up to 3 s) for its part to appear; if it never does, the card shows
    // in the middle instead
    elRef.current = null
    setRect(null)
    setSeeking(true)
    window.dispatchEvent(new CustomEvent('iv:go', { detail: step.go }))
    const t0 = Date.now()
    const look = () => {
      if (gone) return
      const el = step.at && targetOf(step)
      if (el || !step.at || Date.now() - t0 > 3000) return setTimeout(() => !gone && show(el || null), el ? 250 : 0)
      setTimeout(look, 100)
    }
    setTimeout(look, 150)
    return () => {
      gone = true
    }
  }, [tour, i])

  // follow it while the page scrolls, lays out or resizes
  useEffect(() => {
    if (!tour) return
    let raf
    const tick = () => {
      const el = elRef.current
      if (el && el.isConnected) {
        const b = el.getBoundingClientRect()
        // only the part on screen, so a part taller than the window still shows its whole frame
        const top = Math.max(b.top, 48)
        const bottom = Math.min(b.bottom, window.innerHeight - 12)
        const r = { top, left: b.left, width: b.width, height: Math.max(0, bottom - top) }
        setRect((o) => (o && Math.abs(o.top - r.top) < 0.5 && Math.abs(o.left - r.left) < 0.5 && Math.abs(o.width - r.width) < 0.5 && Math.abs(o.height - r.height) < 0.5 ? o : { top: r.top, left: r.left, width: r.width, height: r.height }))
      } else if (el) setRect(null)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [tour, i])

  // the card goes below the part, else above, else beside it, else over its foot; always inside the window
  useLayoutEffect(() => {
    const c = cardRef.current
    if (!c || !tour) return
    // placed here, never hidden from a later effect: a step with nothing to light (rect stays null) used to leave
    // the card invisible behind the dimmed window
    if (seeking) return setCard((o) => (o.ready ? { ...o, ready: false } : o))
    const W = window.innerWidth
    const H = window.innerHeight
    const cw = c.offsetWidth
    const ch = c.offsetHeight
    const clampX = (x) => Math.max(EDGE, Math.min(W - cw - EDGE, x))
    const clampY = (y) => Math.max(EDGE, Math.min(H - ch - EDGE, y))
    if (!rect) return setCard({ top: (H - ch) / 2, left: (W - cw) / 2, ready: true, side: 'middle' })
    const t = rect.top - PAD
    const b = rect.top + rect.height + PAD
    const l = rect.left - PAD
    const r = rect.left + rect.width + PAD
    const cx = rect.left + rect.width / 2 - cw / 2
    let pos
    if (H - b - GAP >= ch + EDGE) pos = { top: b + GAP, left: clampX(cx), side: 'below' }
    else if (t - GAP >= ch + EDGE) pos = { top: t - GAP - ch, left: clampX(cx), side: 'above' }
    else if (W - r - GAP >= cw + EDGE) pos = { top: clampY(rect.top), left: r + GAP, side: 'right' }
    else if (l - GAP >= cw + EDGE) pos = { top: clampY(rect.top), left: l - GAP - cw, side: 'left' }
    else pos = { top: clampY(Math.min(b, H) - ch - 20), left: clampX(cx), side: 'over' }
    setCard((o) => (o.ready && Math.abs(o.top - pos.top) < 1 && Math.abs(o.left - pos.left) < 1 ? o : { ...pos, ready: true }))
  }, [rect, i, tour, seeking])

  useEffect(() => {
    if (!tour) return
    const key = (e) => {
      if (e.key === 'Escape') (e.preventDefault(), close())
      else if (e.key === 'ArrowRight' || (e.key === 'Enter' && !last)) (e.preventDefault(), go(1))
      else if (e.key === 'Enter' && last) (e.preventDefault(), close())
      else if (e.key === 'ArrowLeft') (e.preventDefault(), go(-1))
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [tour, i])

  useEffect(() => {
    if (tour) cardRef.current?.querySelector('.tour-next')?.focus({ preventScroll: true })
  }, [tour, i])

  if (!tour) return null
  const lit = rect && { top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }
  return (
    <div className="tour" role="dialog" aria-modal="true" aria-label={`How it works: ${tour.title}`}>
      <div className="tour-block" onPointerDown={(e) => e.preventDefault()} />
      {lit ? <div className="tour-spot" style={lit} /> : <div className="tour-dim" />}
      <div ref={cardRef} className={`tour-card ${card.ready ? 'ready' : ''} side-${card.side || 'middle'}`} style={{ top: card.top, left: card.left }}>
        <div className="tour-card-top">
          <span className="mono small pink">
            {tour.title} · {i + 1} of {tour.steps.length}
          </span>
          <button className="lora-chip-x" aria-label="Close the tour" onClick={close}>
            ×
          </button>
        </div>
        <h3>{step.title}</h3>
        <p>{tourText(step.text, platform)}</p>
        <div className="tour-dots" aria-hidden="true">
          {tour.steps.map((_, n) => (
            <button key={n} tabIndex={-1} className={n === i ? 'on' : n < i ? 'done' : ''} onClick={() => setI(n)} />
          ))}
        </div>
        <div className="tour-foot">
          {last ? (
            <button className="link-btn mono small" onClick={() => window.ivstudio.learn?.openGuide?.().catch(() => {})}>
              The full guide (PDF) ↗
            </button>
          ) : (
            <button className="link-btn mono small" onClick={close}>
              Skip
            </button>
          )}
          <span className="tour-foot-btns">
            {i > 0 && (
              <button className="btn btn-small" onClick={() => go(-1)}>
                Back
              </button>
            )}
            <button className="btn btn-small btn-primary tour-next" onClick={() => (last ? close() : go(1))}>
              {last ? 'Done' : 'Next'}
            </button>
          </span>
        </div>
      </div>
    </div>
  )
}
