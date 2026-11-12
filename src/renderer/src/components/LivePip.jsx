import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLive } from './Live'

// Live preview, picture in picture: switched on from the sidebar's queue box, it floats in a corner of every page
// and shows what's rendering now. For H3 previews on this PC that's each step's picture as it's made (Live.jsx);
// other renders show their name, step and time. Nothing rendering: it shrinks to a small pill, so it's clear it's on.
//
// How it moves: grab it anywhere (not on a button) and throw it toward a corner; it glides there. Resize it from the
// corner or either edge facing into the page; the picture keeps its shape. Double-click the picture, or ⤢, for the
// two quick sizes. With the bar focused: arrow keys move it to another corner, + and - resize it, Esc cancels a drag.
//
// Gestures write straight to the panel each frame (no React render per mouse move) and are saved when let go.
const CORNERS = ['br', 'bl', 'tr', 'tl']
const SMALL = 340
const BIG = 540
const MIN = 240
const MAX = 1600
const EDGE = 20 // gap to the window's edges
const TOP = 56 // below the title bar
const SLOP = 4 // pixels before a press becomes a drag (so clicks and double-clicks still work)
const load = (k, d) => {
  try {
    return localStorage.getItem(k) ?? d
  } catch {
    return d
  }
}
const save = (k, v) => {
  try {
    localStorage.setItem(k, v)
  } catch {}
}
const clock = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
const still = () => document.documentElement.classList.contains('rm') || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)

export default function LivePip({ items, now, kindLabel, open, onOff }) {
  const [corner, setCorner] = useState(() => (CORNERS.includes(load('iv.livePipCorner')) ? load('iv.livePipCorner') : 'br'))
  const [width, setWidth] = useState(() => Number(load('iv.livePipW', '')) || (load('iv.livePipBig') === '1' ? BIG : SMALL))
  // the picture's shape (from the step pictures), so the panel's height never jumps when one arrives
  const [aspect, setAspect] = useState(() => Number(load('iv.livePipAr', '')) || 16 / 9)
  const [gesture, setGesture] = useState(null) // 'size' | 'move' while one runs (for the cursor and no transitions)
  const [snap, setSnap] = useState(0) // bumps after a drag so the glide runs even when the corner didn't change
  const box = useRef(null)
  const g = useRef(null) // the running gesture
  const flip = useRef(null) // where the panel was let go, for the glide
  const chrome = useRef(84) // the panel's height minus the picture (bar, foot, progress)
  const item = items.find((i) => i.state === 'running' && i.ours) || items.find((i) => i.state === 'running') || null
  const live = useLive(item?.ours ? item.promptId : null)
  const waiting = items.filter((i) => i.state !== 'running').length

  // where it sits: the left corners sit just past the sidebar (none in the full-screen editor); the top corners sit
  // below the title bar, and in the editor below its own title and buttons (it stays where it was put, never flies off)
  const navRight = Math.max(0, document.querySelector('.nav')?.getBoundingClientRect().right || 0)
  // the right corners sit left of the chat while it's open in the window (beside the page, or over it on a smaller
  // window), so the panel never covers the chat's box or its buttons; with no room left of it, the window's edge
  const chatEl = document.querySelector('.chat-panel:not(.popped)')
  const chatLeft = chatEl ? Math.round(chatEl.getBoundingClientRect().left) : innerWidth
  const rightEdge = chatLeft - navRight >= MIN + EDGE * 2 ? Math.min(innerWidth, chatLeft) : innerWidth
  const dock = [...document.querySelectorAll('.go-dock')].find((d) => d.offsetParent !== null)
  const dockTop = dock ? dock.getBoundingClientRect().top : 0
  const place = corner
  const edTop = document.querySelector('.ed-top')
  const topGap = edTop ? Math.max(TOP, Math.round(edTop.getBoundingClientRect().bottom) + 10) : TOP
  // a page's bar at the bottom of the window (Create's Hunt bar): sit above it, not on its button
  const bottomGap = dockTop ? Math.max(EDGE, innerHeight - dockTop + 12) : EDGE
  const pos = {
    left: place.endsWith('l') ? navRight + EDGE : 'auto',
    right: place.endsWith('r') ? innerWidth - rightEdge + EDGE : 'auto',
    top: place.startsWith('t') ? topGap : 'auto',
    bottom: place.startsWith('b') ? bottomGap : 'auto'
  }

  // the widest it can be here: inside the window beside the sidebar, and short enough to stay below the title bar
  // (and the editor's own top row)
  const maxW = () => {
    const availW = rightEdge - navRight - EDGE * 2
    const availH = place.startsWith('b') ? innerHeight - bottomGap - topGap : innerHeight - topGap - EDGE
    return Math.max(MIN, Math.min(MAX, availW, (availH - chrome.current) * aspect))
  }
  const clampW = (w) => Math.round(Math.max(MIN, Math.min(w, maxW())))
  const shown = g.current?.kind === 'size' ? g.current.w : clampW(width)

  useEffect(() => save('iv.livePipW', String(Math.round(width))), [width])
  // a smaller window (or a taller dock) keeps it inside: re-render on resize, and clampW does the rest
  const [, setTick] = useState(0)
  useEffect(() => {
    const fit = () => setTick((t) => t + 1)
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])
  // learn the bar and foot's height after every layout, for maxW
  useLayoutEffect(() => {
    const b = box.current
    const pic = b?.querySelector('.live-pip-pic')
    if (b && pic) chrome.current = b.offsetHeight - pic.offsetHeight
  })

  // the glide after a drag: start where it was let go, then ease into the corner
  useLayoutEffect(() => {
    const b = box.current
    const from = flip.current
    flip.current = null
    if (!b || !from) return
    b.style.transition = 'none'
    b.style.transform = ''
    const to = b.getBoundingClientRect()
    const dx = from.left - to.left
    const dy = from.top - to.top
    if (still() || (Math.abs(dx) < 1 && Math.abs(dy) < 1)) {
      b.style.transition = ''
      return
    }
    b.style.transform = `translate3d(${dx}px, ${dy}px, 0)`
    void b.offsetWidth // commit the start before the transition
    b.style.transition = 'transform 0.32s cubic-bezier(0.2, 0.9, 0.25, 1)'
    b.style.transform = ''
    const done = (e) => {
      if (e && e.propertyName !== 'transform') return
      b.style.transition = ''
      b.removeEventListener('transitionend', done)
    }
    b.addEventListener('transitionend', done)
    const t = setTimeout(done, 450)
    return () => clearTimeout(t)
  }, [corner, snap])

  // window listeners for the running gesture; pointer capture keeps it ours even outside the window. A move only
  // captures once it really is a drag (capture() from onMove), so a double-click still reaches the picture.
  function track(e, onMove, onEnd, { lazy = false } = {}) {
    const el = e.currentTarget
    let captured = false
    const capture = () => {
      if (captured) return
      captured = true
      try {
        el.setPointerCapture(e.pointerId)
      } catch {}
    }
    if (!lazy) capture()
    let raf = 0
    let last = null
    const move = (ev) => {
      if (ev.pointerId !== e.pointerId) return
      // the button came up somewhere we didn't hear about: end here
      if (ev.pointerType === 'mouse' && ev.buttons === 0) return finish(false)
      last = ev
      if (!raf)
        raf = requestAnimationFrame(() => {
          raf = 0
          const l = last
          last = null
          if (l) onMove(l, capture)
        })
    }
    let over = false
    const finish = (cancelled) => {
      if (over) return
      over = true
      cancelAnimationFrame(raf)
      // a move that came in after the last frame still counts (once)
      if (!cancelled && last) onMove(last, capture)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', key, true)
      el.removeEventListener('lostpointercapture', up)
      if (captured)
        try {
          el.releasePointerCapture(e.pointerId)
        } catch {}
      onEnd(cancelled)
    }
    const up = (ev) => (ev.pointerId === undefined || ev.pointerId === e.pointerId) && finish(false)
    const cancel = (ev) => ev.pointerId === e.pointerId && finish(true)
    const key = (ev) => {
      if (ev.key !== 'Escape') return
      ev.preventDefault()
      ev.stopPropagation()
      finish(true)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', key, true)
    el.addEventListener('lostpointercapture', up)
    return move
  }

  // resize from the inner corner ('corner') or an inner edge ('x' across, 'y' up/down); it grows away from the
  // corner it's pinned to. The corner handle follows the mouse along the panel's own diagonal, so it never jumps.
  function startSize(e, along) {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const b = box.current
    if (!b) return
    const sx = e.clientX
    const sy = e.clientY
    const w0 = shown
    const xs = place.endsWith('r') ? -1 : 1
    const ys = place.startsWith('b') ? -1 : 1
    g.current = { kind: 'size', w: w0 }
    b.classList.add('gesture', 'sizing')
    track(
      e,
      (ev) => {
        const bx = (ev.clientX - sx) * xs
        const by = (ev.clientY - sy) * ys
        const dw = along === 'x' ? bx : along === 'y' ? by * aspect : (bx + by / aspect) / (1 + 1 / (aspect * aspect))
        const w = clampW(w0 + dw)
        if (w !== g.current.w) {
          g.current.w = w
          b.style.width = `${w}px`
        }
      },
      (cancelled) => {
        const w = cancelled ? w0 : g.current.w
        b.style.width = `${w}px`
        g.current = null
        b.classList.remove('gesture', 'sizing')
        setWidth(w)
        setGesture(null)
      }
    )
    setGesture('size')
  }

  // move: grab it anywhere that isn't a button or a handle. It follows the mouse (kept inside the window) and,
  // when let go, glides to the corner it was heading for (a quick flick counts where it was going, not where it is).
  function startMove(e) {
    if (e.button !== 0 || e.target.closest('button, a, .live-pip-handle')) return
    const b = box.current
    if (!b) return
    e.preventDefault()
    const sx = e.clientX
    const sy = e.clientY
    const r0 = b.getBoundingClientRect()
    const trail = [[e.timeStamp, sx, sy]] // when each move happened (event time), for the throw
    g.current = { kind: 'move', dx: 0, dy: 0, moved: false }
    track(
      e,
      (ev, capture) => {
        const s = g.current
        if (!s) return
        let dx = ev.clientX - sx
        let dy = ev.clientY - sy
        if (!s.moved) {
          if (Math.hypot(dx, dy) < SLOP) return
          s.moved = true
          capture()
          b.classList.add('gesture', 'moving')
          setGesture('move')
        }
        dx = Math.min(Math.max(dx, 8 - r0.left), rightEdge - 8 - r0.right)
        dy = Math.min(Math.max(dy, 8 - r0.top), innerHeight - 8 - r0.bottom)
        s.dx = dx
        s.dy = dy
        if (ev.timeStamp > trail[trail.length - 1][0]) trail.push([ev.timeStamp, ev.clientX, ev.clientY])
        if (trail.length > 12) trail.shift()
        b.style.transform = `translate3d(${dx}px, ${dy}px, 0)`
      },
      (cancelled) => {
        const s = g.current
        g.current = null
        b.classList.remove('gesture', 'moving')
        setGesture(null)
        if (!s?.moved) return
        flip.current = b.getBoundingClientRect()
        if (cancelled) {
          setSnap((n) => n + 1)
          return
        }
        // where it was heading: the last ~120 ms of movement, carried on for a moment
        const t1 = trail[trail.length - 1]
        const t0 = trail.find((p) => t1[0] - p[0] <= 120) || trail[0]
        const dt = Math.max(1, t1[0] - t0[0])
        const vx = (t1[1] - t0[1]) / dt
        const vy = (t1[2] - t0[2]) / dt
        // a pause before letting go, or a slow drift, means "here", not a throw; a throw carries on like a flicked
        // card would on a phone (about half a second), so a flick reaches the far side of a big screen too
        const thrown = performance.now() - t1[0] < 90 && Math.hypot(vx, vy) > 0.25
        const cx = flip.current.left + flip.current.width / 2 + (thrown ? vx * 450 : 0)
        const cy = flip.current.top + flip.current.height / 2 + (thrown ? vy * 450 : 0)
        // and a clear flick one way means that way, however big the screen
        const FLICK = 0.9
        const down = thrown && Math.abs(vy) > FLICK ? vy > 0 : cy > innerHeight / 2
        const right = thrown && Math.abs(vx) > FLICK ? vx > 0 : cx > (navRight + rightEdge) / 2
        const next = `${down ? 'b' : 't'}${right ? 'r' : 'l'}`
        save('iv.livePipCorner', next)
        setCorner(next)
        setSnap((n) => n + 1)
      },
      { lazy: true }
    )
  }

  function moveTo(next) {
    if (next === corner || !box.current) return
    flip.current = box.current.getBoundingClientRect()
    save('iv.livePipCorner', next)
    setCorner(next)
    setSnap((n) => n + 1)
  }
  const resizeTo = (w) => setWidth(clampW(w))
  const big = shown >= (SMALL + BIG) / 2
  const toggle = () => resizeTo(big ? SMALL : BIG)
  function onKey(e) {
    const v = place[0]
    const h = place[1]
    const map = { ArrowLeft: v + 'l', ArrowRight: v + 'r', ArrowUp: 't' + h, ArrowDown: 'b' + h }
    if (map[e.key]) {
      e.preventDefault()
      moveTo(map[e.key])
    } else if (e.key === '+' || e.key === '=') {
      e.preventDefault()
      resizeTo(shown + 40)
    } else if (e.key === '-' || e.key === '_') {
      e.preventDefault()
      resizeTo(shown - 40)
    }
  }

  const pct = item?.progress?.max ? Math.round((item.progress.value / item.progress.max) * 100) : null
  const cls = `live-pip c-${place}${gesture ? ` gesture ${gesture === 'size' ? 'sizing' : 'moving'}` : ''}`

  const body = !item ? (
    <div ref={box} className={`${cls} idle`} style={pos} onPointerDown={startMove} role="status">
      <span className="live-pip-dot" />
      <span className="mono">Live preview</span>
      <span className="mono dim">nothing rendering</span>
      <button className="live-pip-icon" onClick={onOff} title="Turn the live preview off" aria-label="Turn the live preview off">
        ×
      </button>
    </div>
  ) : (
    <div ref={box} className={cls} style={{ ...pos, width: shown, '--pip-ar': aspect }} onPointerDown={startMove} role="region" aria-label="Live preview">
      <span className="live-pip-handle edge-x" onPointerDown={(e) => startSize(e, 'x')} onDoubleClick={toggle} aria-hidden="true" />
      <span className="live-pip-handle edge-y" onPointerDown={(e) => startSize(e, 'y')} onDoubleClick={toggle} aria-hidden="true" />
      <span className="live-pip-handle live-pip-grip" onPointerDown={(e) => startSize(e, 'corner')} onDoubleClick={toggle} title="Drag to resize (double-click: small or big)" aria-hidden="true" />
      <div
        className="live-pip-bar"
        tabIndex={0}
        onKeyDown={onKey}
        title="Drag to move it (arrow keys move it to another corner, + and - resize it)"
        aria-label="Live preview: arrow keys move it, plus and minus resize it"
      >
        <span className="live-pip-dot on" />
        <span className="mono live-pip-tag">Live</span>
        <span className="live-pip-name">{item.ours ? item.name || kindLabel(item.kind) : 'Other ComfyUI work'}</span>
        <button className="live-pip-icon" onClick={toggle} title={big ? 'Smaller' : 'Bigger'} aria-label={big ? 'Smaller' : 'Bigger'}>
          {big ? '⤡' : '⤢'}
        </button>
        <button className="live-pip-icon" onClick={onOff} title="Turn the live preview off" aria-label="Turn the live preview off">
          ×
        </button>
      </div>
      <div className="live-pip-pic" onDoubleClick={toggle}>
        {live ? (
          <img
            src={live.image}
            alt={`Step ${live.step} of ${live.total}`}
            draggable={false}
            onLoad={(e) => {
              const a = e.currentTarget.naturalWidth / e.currentTarget.naturalHeight
              if (a > 0.2 && a < 5 && Math.abs(a - aspect) > 0.01) {
                setAspect(a)
                save('iv.livePipAr', a.toFixed(4))
              }
            }}
          />
        ) : (
          <div className="live-pip-empty mono small dim">
            {!item.ours
              ? 'Started outside IV Studio: no picture to show.'
              : item.live
                ? 'The first step’s picture shows here in a few seconds.'
                : item.kind === 'previews' || item.kind === 'finish'
                  ? 'No step pictures for this render: they need ComfyUI on this computer and H3’s small preview model (Settings → Setup → H3 live preview decoder).'
                  : 'This kind of render shows its progress, not a picture, until it’s done.'}
          </div>
        )}
      </div>
      <div className="live-pip-foot">
        {/* what it is shortens first; the step and the clock always show */}
        <span className="mono small live-pip-what">{[item.ours && item.name && kindLabel(item.kind), item.kind === 'previews' && live?.take && `take ${live.take}`].filter(Boolean).join(' · ')}</span>
        <span className="mono small live-pip-when">
          {item.progress || live ? <span className="live-pip-long">step </span> : null}
          {[item.progress ? `${item.progress.value}/${item.progress.max}` : live ? `${live.step}/${live.total}` : 'rendering', item.startedAt && clock(now - item.startedAt)].filter(Boolean).join(' · ')}
        </span>
        {waiting > 0 && <span className="live-pip-wait mono small" title={`${waiting} more waiting in the queue`}>+{waiting}</span>}
        {item.ours && (
          <button className="link-btn mono live-pip-open" onClick={() => open(item)} title="Open it" aria-label="Open it">
            <span className="live-pip-long">Open </span>→
          </button>
        )}
      </div>
      <span className="live-pip-progress">
        <span style={{ width: `${pct ?? 0}%` }} />
      </span>
    </div>
  )
  return createPortal(body, document.body)
}
