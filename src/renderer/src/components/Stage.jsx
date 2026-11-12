import { ART } from './Hero'
import Help from './Help'
import MotionCanvas, { CREAM, PINK, RED, rand, rgba } from './MotionCanvas'
import { HERO_EFFECTS } from './heroMotion'

// The Workflows tools' and audio pages' start: a tall banner with the page's own animation behind it (fire for
// Sizzle, a beat for Reel, film for Sequences, blade cuts for Shinobi, a scanning swap for Replace, speech for Voices,
// a waveform for Lines, rings for Music, ripples for Sounds), the title and the page's main bar centered on it. The
// engine (pausing off screen, a still frame for Reduce motion) is MotionCanvas.jsx.

// Each effect: make(w, h) -> state; draw(ctx, state, w, h, t) where t is seconds.
const EFFECTS = {
  // flames rising off the bottom edge, with embers drifting up through them
  fire: {
    make: (w, h) => ({ flames: [], embers: Array.from({ length: Math.round(w / 8) }, () => ember(w, h, true)) }),
    draw(ctx, s, w, h, t, dt) {
      const glow = ctx.createLinearGradient(0, h, 0, h * 0.2)
      glow.addColorStop(0, rgba(RED, 0.45 + 0.08 * Math.sin(t * 3.1)))
      glow.addColorStop(0.35, rgba(RED, 0.22))
      glow.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = glow
      ctx.fillRect(0, 0, w, h)
      // layered tongues of flame: a tall dark-red back row up to a short white-hot front row, each a moving
      // silhouette of peaked waves
      const layers = [
        [0.78, [150, 18, 34], 0.85, 1.0, 0],
        [0.62, RED, 0.8, 1.35, 1.7],
        [0.46, [255, 110, 50], 0.6, 1.7, 3.1],
        [0.28, [255, 168, 70], 0.55, 2.1, 4.4],
        [0.14, [255, 205, 110], 0.35, 2.6, 5.9]
      ]
      layers.forEach(([reach, c, a, speed, ph], li) => {
        ctx.globalCompositeOperation = li > 2 ? 'screen' : 'source-over'
        const top = h * (1 - reach)
        const g = ctx.createLinearGradient(0, h, 0, top)
        g.addColorStop(0, rgba(c, a))
        g.addColorStop(0.6, rgba(c, a * 0.55))
        g.addColorStop(1, rgba(c, 0))
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.moveTo(0, h)
        for (let x = 0; x <= w + 8; x += 8) {
          const f = 0.011 + li * 0.002
          const tongue = Math.pow(Math.abs(Math.sin(x * f + t * speed + ph)), 3) * 0.55 + Math.pow(Math.abs(Math.sin(x * f * 2.3 - t * speed * 1.4 + ph * 2)), 4) * 0.35
          const flick = 0.1 * Math.sin(x * 0.05 + t * 9 + li)
          ctx.lineTo(x, h - (h - top) * Math.min(1, 0.25 + tongue + flick))
        }
        ctx.lineTo(w, h)
        ctx.closePath()
        ctx.fill()
      })
      ctx.globalCompositeOperation = 'lighter'
      const born = Math.round((w / 6) * dt)
      for (let i = 0; i < born; i++) s.flames.push({ x: rand(-20, w + 20), y: h + rand(0, 30), r: rand(18, 46), vy: rand(60, 150), vx: rand(-12, 12), life: 0, max: rand(0.9, 1.9), seed: Math.random() * 10 })
      s.flames = s.flames.filter((f) => (f.life += dt) < f.max)
      for (const f of s.flames) {
        const k = f.life / f.max
        f.y -= f.vy * dt
        f.x += (f.vx + Math.sin(t * 3 + f.seed) * 22) * dt
        const r = f.r * (1 - k * 0.7)
        const c = k < 0.25 ? [255, 214, 140] : k < 0.55 ? [255, 132, 60] : RED
        const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r)
        g.addColorStop(0, rgba(c, 0.32 * (1 - k)))
        g.addColorStop(1, rgba(c, 0))
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(f.x, f.y, r, 0, Math.PI * 2)
        ctx.fill()
      }
      for (const e of s.embers) {
        e.y -= e.vy * dt
        e.x += Math.sin(t * e.f + e.seed) * 18 * dt
        e.life += dt
        if (e.y < -10 || e.life > e.max) Object.assign(e, ember(w, h))
        const a = Math.min(1, e.life * 2) * (1 - e.life / e.max)
        ctx.fillStyle = rgba(e.hot ? [255, 220, 150] : PINK, 0.9 * a)
        ctx.beginPath()
        ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalCompositeOperation = 'source-over'
    }
  },
  // equaliser bars along the bottom and rings opening from the middle on every beat (120 BPM)
  beat: {
    make: (w) => ({ bars: Array.from({ length: Math.max(24, Math.round(w / 22)) }, () => ({ v: 0, seed: Math.random() * 10 })), rings: [], last: -1 }),
    draw(ctx, s, w, h, t, dt) {
      const beat = Math.floor(t * 2)
      const phase = t * 2 - beat
      if (beat !== s.last) (s.last = beat), s.rings.push({ r: 30, a: 0.55 })
      ctx.lineWidth = 2
      s.rings = s.rings.filter((r) => (r.a -= dt * 0.45) > 0)
      for (const r of s.rings) {
        r.r += dt * 260
        ctx.strokeStyle = rgba(RED, r.a)
        ctx.beginPath()
        ctx.arc(w / 2, h * 0.52, r.r, 0, Math.PI * 2)
        ctx.stroke()
      }
      const bw = w / s.bars.length
      const kick = Math.exp(-phase * 5)
      s.bars.forEach((b, i) => {
        const target = 0.12 + 0.5 * kick * (0.6 + 0.4 * Math.sin(i * 0.7 + b.seed)) + 0.18 * (0.5 + 0.5 * Math.sin(t * (2 + (i % 5)) + b.seed))
        b.v += (target - b.v) * Math.min(1, dt * 14)
        const bh = b.v * h * 0.55
        const g = ctx.createLinearGradient(0, h, 0, h - bh)
        g.addColorStop(0, rgba(RED, 0.75))
        g.addColorStop(1, rgba(PINK, 0.15))
        ctx.fillStyle = g
        ctx.fillRect(i * bw + 2, h - bh, bw - 4, bh)
      })
    }
  },
  // a picture bursting: every second and a half, confetti and star sparks fly out from the middle and fall (no flash
  // of light with them: nothing on a banner may flash, for people with photosensitive epilepsy)
  burst: {
    make: () => ({ bits: [], last: -1 }),
    draw(ctx, s, w, h, t, dt) {
      const cx = w / 2
      const cy = h * 0.5
      const n = Math.floor(t / 1.5)
      if (n !== s.last) {
        s.last = n
        for (let i = 0; i < 70; i++) {
          const a = rand(0, Math.PI * 2)
          const v = rand(120, 520)
          s.bits.push({ x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 80, rot: rand(0, 6), vr: rand(-8, 8), size: rand(4, 11), life: 0, max: rand(1.4, 2.6), star: Math.random() < 0.3, c: [RED, PINK, CREAM][Math.floor(rand(0, 3))] })
        }
      }
      s.bits = s.bits.filter((b) => (b.life += dt) < b.max)
      for (const b of s.bits) {
        b.vy += 260 * dt
        b.vx *= 1 - 0.8 * dt
        b.x += b.vx * dt
        b.y += b.vy * dt
        b.rot += b.vr * dt
        const a = 1 - b.life / b.max
        ctx.save()
        ctx.translate(b.x, b.y)
        ctx.rotate(b.rot)
        ctx.fillStyle = rgba(b.c, 0.85 * a)
        if (b.star) {
          ctx.beginPath()
          for (let k = 0; k < 8; k++) {
            const r = k % 2 ? b.size * 0.35 : b.size
            ctx.lineTo(Math.cos((k * Math.PI) / 4) * r, Math.sin((k * Math.PI) / 4) * r)
          }
          ctx.closePath()
          ctx.fill()
        } else ctx.fillRect(-b.size / 2, -b.size / 4, b.size, b.size / 2)
        ctx.restore()
      }
    }
  },
  // two strips of film running past, frames lit in turn
  film: {
    make: () => ({}),
    draw(ctx, s, w, h, t) {
      const strip = (y, fh, speed, alpha) => {
        const fw = fh * 1.5
        const off = (t * speed) % (fw + 10)
        ctx.fillStyle = `rgba(8,6,7,${alpha})`
        ctx.fillRect(0, y - 14, w, fh + 28)
        for (let x = -fw - 10 + off; x < w + fw; x += fw + 10) {
          const n = Math.floor((x - off) / (fw + 10))
          const lit = 0.18 + 0.22 * (0.5 + 0.5 * Math.sin(t * 1.6 + n * 1.3))
          const g = ctx.createLinearGradient(x, y, x + fw, y + fh)
          g.addColorStop(0, rgba(RED, lit * alpha))
          g.addColorStop(1, rgba(PINK, lit * 0.4 * alpha))
          ctx.fillStyle = g
          ctx.fillRect(x, y, fw, fh)
          ctx.fillStyle = rgba(CREAM, 0.35 * alpha)
          for (let hx = x + 4; hx < x + fw; hx += 16) {
            ctx.fillRect(hx, y - 10, 8, 6)
            ctx.fillRect(hx, y + fh + 4, 8, 6)
          }
        }
      }
      strip(h * 0.12, h * 0.2, 60, 0.55)
      strip(h * 0.66, h * 0.24, -90, 0.8)
    }
  },
  // quick blade cuts across the frame, each leaving a fading streak, and petals drifting down
  slash: {
    make: (w, h) => ({ cuts: [], petals: Array.from({ length: 40 }, () => petal(w, h, true)), next: 0 }),
    draw(ctx, s, w, h, t, dt) {
      if (t > s.next) {
        s.next = t + rand(0.9, 1.8)
        const y = rand(h * 0.1, h * 0.9)
        const tilt = rand(-0.35, 0.35) * h
        s.cuts.push({ y0: y - tilt, y1: y + tilt, born: t })
      }
      s.cuts = s.cuts.filter((c) => t - c.born < 1.2)
      for (const c of s.cuts) {
        const k = Math.min(1, (t - c.born) / 0.18)
        const fade = 1 - Math.max(0, (t - c.born - 0.18) / 1)
        const x1 = w * k
        const g = ctx.createLinearGradient(0, 0, x1, 0)
        g.addColorStop(0, rgba(RED, 0))
        g.addColorStop(1, rgba(CREAM, 0.55 * fade))
        ctx.strokeStyle = g
        ctx.lineWidth = 2.5 * fade + 0.5
        ctx.beginPath()
        ctx.moveTo(-10, c.y0)
        ctx.lineTo(x1, c.y0 + (c.y1 - c.y0) * k)
        ctx.stroke()
        ctx.strokeStyle = rgba(RED, 0.35 * fade)
        ctx.lineWidth = 9 * fade
        ctx.stroke()
      }
      for (const p of s.petals) {
        p.y += p.vy * dt
        p.x += Math.sin(t * p.f + p.seed) * 25 * dt
        p.a += p.spin * dt
        if (p.y > h + 10) Object.assign(p, petal(w, h))
        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.rotate(p.a)
        ctx.fillStyle = rgba(p.c, 0.55)
        ctx.beginPath()
        ctx.ellipse(0, 0, p.r, p.r * 0.45, 0, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      }
    }
  },
  // a bright line sweeping across; dots behind it change from one colour to the other, then back on the return
  morph: {
    make: (w, h) => {
      const step = 26
      const dots = []
      for (let y = step / 2; y < h; y += step) for (let x = step / 2; x < w; x += step) dots.push({ x, y, seed: Math.random() })
      return { dots }
    },
    draw(ctx, s, w, h, t) {
      const period = 5
      const p = (t % period) / period
      const forward = Math.floor(t / period) % 2 === 0
      const lx = (forward ? p : 1 - p) * (w + 160) - 80
      for (const d of s.dots) {
        const past = forward ? d.x < lx : d.x > lx
        const near = Math.max(0, 1 - Math.abs(d.x - lx) / 90)
        const c = past ? RED : CREAM
        ctx.fillStyle = rgba(c, (past ? 0.5 : 0.14) + near * 0.5)
        const r = 1.6 + near * 2.4 + (past ? 0.6 * Math.sin(t * 2 + d.seed * 6) : 0)
        ctx.beginPath()
        ctx.arc(d.x, d.y, Math.max(0.6, r), 0, Math.PI * 2)
        ctx.fill()
      }
      const g = ctx.createLinearGradient(lx - 70, 0, lx + 70, 0)
      g.addColorStop(0, rgba(RED, 0))
      g.addColorStop(0.5, rgba(CREAM, 0.5))
      g.addColorStop(1, rgba(RED, 0))
      ctx.fillStyle = g
      ctx.fillRect(lx - 70, 0, 140, h)
    }
  },
  // Voices: soft bands of a speaking voice breathing out from the middle, swelling with each phrase and settling
  speech: {
    make: () => ({ bands: Array.from({ length: 6 }, (_, i) => ({ f: 0.9 + i * 0.37, seed: Math.random() * 10 })), phrase: 0, next: 0, from: 0, to: 1 }),
    draw(ctx, s, w, h, t) {
      if (t >= s.next) (s.from = s.to), (s.to = rand(0.35, 1)), (s.phrase = t), (s.next = t + rand(1.5, 2.5))
      const k = Math.min(1, (t - s.phrase) / 0.6)
      const swell = s.from + (s.to - s.from) * (k * k * (3 - 2 * k))
      const cy = h * 0.52
      const step = 6
      s.bands.forEach((b, i) => {
        const amp = h * (0.05 + 0.035 * i) * swell * (0.75 + 0.25 * Math.sin(t * 2.3 + b.seed))
        const c = i % 3 === 2 ? CREAM : i % 2 ? PINK : RED
        ctx.strokeStyle = rgba(c, 0.5 - i * 0.055)
        ctx.lineWidth = 2.2 - i * 0.22
        ctx.beginPath()
        for (let x = 0; x <= w; x += step) {
          const u = x / w - 0.5
          const env = Math.exp(-u * u * 9) // strongest in the middle, fading to the edges
          const y = cy + Math.sin(x * 0.018 * b.f + t * (2.4 + i * 0.5) + b.seed) * amp * env
          x ? ctx.lineTo(x, y) : ctx.moveTo(x, y)
        }
        ctx.stroke()
      })
    }
  },
  // Lines: a spoken line's waveform scrolling right to left past a fixed playhead
  scope: {
    make: (w) => ({ cols: [], x: 0, word: 0, gap: 0, colW: 4, span: Math.ceil(w / 4) + 2 }),
    draw(ctx, s, w, h, t, dt) {
      // fill new columns at the right edge: words (loud bursts) with short pauses between them
      s.x += dt * 120
      while (s.x >= s.colW) {
        s.x -= s.colW
        if (s.gap > 0) s.gap--, s.cols.push(0.03)
        else {
          if (s.word <= 0) s.word = Math.round(rand(8, 26))
          const p = 1 - Math.abs((s.word % 13) / 13 - 0.5) * 2
          s.cols.push(Math.min(1, 0.25 + 0.6 * p * rand(0.6, 1.2)))
          if (--s.word <= 0) s.gap = Math.round(rand(2, 9))
        }
        if (s.cols.length > s.span) s.cols.shift()
      }
      // a band along the bottom of the banner, under the title and the bar
      const cy = h * 0.86
      const head = w * 0.62
      for (let i = 0; i < s.cols.length; i++) {
        const x = w - (s.cols.length - i) * s.colW - s.x
        const v = s.cols[i] * h * 0.1
        const near = Math.max(0, 1 - Math.abs(x - head) / 60)
        ctx.fillStyle = x < head ? rgba(RED, 0.55 + near * 0.3) : rgba(PINK, 0.22)
        ctx.fillRect(x, cy - v, s.colW - 1.5, v * 2)
      }
      ctx.fillStyle = rgba(CREAM, 0.85)
      ctx.fillRect(head - 1, h * 0.72, 2, h * 0.28)
      ctx.beginPath()
      ctx.arc(head, h * 0.72, 4, 0, Math.PI * 2)
      ctx.fill()
    }
  },
  // Music: rings rolling out from the centre on the beat (120 BPM) over faint record grooves turning slowly
  rings: {
    make: () => ({ rings: [], last: -1 }),
    draw(ctx, s, w, h, t, dt) {
      const cx = w / 2
      const cy = h * 0.52
      const turn = t * 0.35
      for (let r = 40; r < Math.max(w, h) * 0.75; r += 14) {
        ctx.strokeStyle = rgba(PINK, 0.06 + 0.04 * Math.sin(r * 0.3))
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.arc(cx, cy, r, turn + r * 0.01, turn + r * 0.01 + Math.PI * 1.6)
        ctx.stroke()
      }
      const beat = Math.floor(t * 2)
      if (beat !== s.last) (s.last = beat), s.rings.push({ r: 34, a: beat % 4 === 0 ? 0.7 : 0.45 })
      s.rings = s.rings.filter((r) => (r.a -= dt * 0.4) > 0)
      for (const r of s.rings) {
        r.r += dt * 200
        ctx.strokeStyle = rgba(RED, r.a)
        ctx.lineWidth = 2.5
        ctx.beginPath()
        ctx.arc(cx, cy, r.r, 0, Math.PI * 2)
        ctx.stroke()
      }
    }
  },
  // Sounds: an impact somewhere every second or so, three ripples spreading from it from a soft glow
  ripple: {
    make: () => ({ hits: [], next: 0 }),
    draw(ctx, s, w, h, t) {
      if (t >= s.next) (s.next = t + rand(0.8, 1.6)), s.hits.push({ x: rand(w * 0.08, w * 0.92), y: rand(h * 0.2, h * 0.85), born: t })
      s.hits = s.hits.filter((p) => t - p.born < 3)
      for (const p of s.hits) {
        const age = t - p.born
        if (age < 0.8) {
          // a glow that rises and falls over most of a second, never a flash
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 60)
          g.addColorStop(0, rgba(CREAM, 0.18 * Math.sin((age / 0.8) * Math.PI)))
          g.addColorStop(1, rgba(RED, 0))
          ctx.fillStyle = g
          ctx.fillRect(p.x - 60, p.y - 60, 120, 120)
        }
        for (let k = 0; k < 3; k++) {
          const a = age - k * 0.22
          if (a <= 0) continue
          const fade = Math.max(0, 1 - a / 2.6)
          ctx.strokeStyle = rgba(k ? PINK : RED, 0.6 * fade)
          ctx.lineWidth = 2 - k * 0.5
          ctx.beginPath()
          ctx.ellipse(p.x, p.y, a * 150, a * 150 * 0.55, 0, 0, Math.PI * 2)
          ctx.stroke()
        }
      }
    }
  }
}
function ember(w, h, anywhere) {
  return { x: rand(0, w), y: anywhere ? rand(0, h) : h + rand(0, 20), r: rand(0.8, 2.4), vy: rand(30, 90), f: rand(1, 3), seed: rand(0, 10), life: 0, max: rand(2.5, 6), hot: Math.random() < 0.4 }
}
function petal(w, h, anywhere) {
  return { x: rand(0, w), y: anywhere ? rand(-h, h) : rand(-40, -10), r: rand(3, 7), vy: rand(18, 45), f: rand(0.6, 1.6), seed: rand(0, 10), a: rand(0, 6), spin: rand(-1.5, 1.5), c: Math.random() < 0.6 ? RED : PINK }
}

// The page motions (heroMotion.js) work here too, centred and bigger (big: livelier) on a tall banner.
const tallSubject = (canvas) => ({ x: canvas.clientWidth / 2, y: canvas.clientHeight * 0.5, r: Math.min(canvas.clientWidth * 0.16, canvas.clientHeight * 0.4), big: true })

export default function Stage({ effect, art, title, kicker, back, help, children }) {
  const own = EFFECTS[effect]
  return (
    <header className={`stage stage-${effect} stage-art-${art}`}>
      <div className="stage-art" aria-hidden="true" style={ART[art] ? { backgroundImage: `url("${ART[art]}")` } : undefined} />
      <MotionCanvas fx={own || HERO_EFFECTS[effect]} className="stage-canvas" anchorOf={own ? null : tallSubject} />
      <div className="stage-shade" aria-hidden="true" />
      {back && (
        <button className="link-btn mono hero-back" onClick={back.onClick}>
          ← {back.label}
        </button>
      )}
      {help !== false && (
        <div className="hero-help">
          <Help art={art} page={help} />
        </div>
      )}
      <div className="stage-body">
        <h1 className="stage-title">{title}</h1>
        {kicker && <p className="stage-kicker mono">{kicker}</p>}
        {children && <div className="stage-bar">{children}</div>}
      </div>
    </header>
  )
}
