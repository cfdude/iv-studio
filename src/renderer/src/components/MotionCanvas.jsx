import { useEffect, useRef } from 'react'

// The banners' animation engine, shared by the tall Workflows and audio banners (Stage.jsx) and the page banners
// (Hero.jsx, heroMotion.js). An effect is { make(w, h, anchor) -> state, draw(ctx, state, w, h, t, dt, anchor) }:
// t is seconds since it started, anchor is { x, y, r } (where the banner's subject sits, and roughly how big it is),
// given by anchorOf(canvas) or the canvas' centre. Canvas 2D, paused when the window is hidden or the canvas is off
// screen, and one settled still frame for Reduce motion (the app's own setting, html.rm, or the system's).

export const RED = [244, 72, 89]
export const PINK = [241, 157, 172]
export const CREAM = [244, 236, 220]
export const rgba = ([r, g, b], a) => `rgba(${r},${g},${b},${a})`
export const rand = (a, b) => a + Math.random() * (b - a)

export default function MotionCanvas({ fx, className, anchorOf }) {
  const ref = useRef(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas || !fx) return
    const ctx = canvas.getContext('2d')
    const still = document.documentElement.classList.contains('rm') || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    let w = 0
    let h = 0
    let anchor = null
    let state = null
    let raf = 0
    let visible = true
    let last = performance.now()
    let t = 0
    // the canvas' layout size, which the page's slide-in animation (a transform) doesn't change
    const size = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      w = canvas.clientWidth
      h = canvas.clientHeight
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      anchor = anchorOf?.(canvas) || { x: w / 2, y: h / 2, r: Math.min(w, h) * 0.3 }
      state = fx.make(w, h, anchor)
    }
    const frame = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      t += dt
      ctx.clearRect(0, 0, w, h)
      fx.draw(ctx, state, w, h, t, dt, anchor)
      if (!still && visible && !document.hidden) raf = requestAnimationFrame(frame)
    }
    const resume = () => {
      cancelAnimationFrame(raf)
      last = performance.now()
      raf = requestAnimationFrame(frame)
    }
    const settle = () => {
      // a settled still: run the effect a few seconds without drawing to screen in between
      for (let i = 0; i < 120; i++) (t += 1 / 30), ctx.clearRect(0, 0, w, h), fx.draw(ctx, state, w, h, t, 1 / 30, anchor)
    }
    size()
    if (still) settle()
    else resume()
    // only a real change of size starts the effect again (the observer also reports the first layout)
    const ro = new ResizeObserver(() => {
      if (canvas.clientWidth === Math.round(w) && canvas.clientHeight === Math.round(h)) return
      size()
      if (still) settle()
    })
    ro.observe(canvas)
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting
      if (visible && !still) resume()
    })
    io.observe(canvas)
    const vis = () => !document.hidden && visible && !still && resume()
    document.addEventListener('visibilitychange', vis)
    return () => (cancelAnimationFrame(raf), ro.disconnect(), io.disconnect(), document.removeEventListener('visibilitychange', vis))
  }, [fx])
  return <canvas ref={ref} className={className} aria-hidden="true" />
}
