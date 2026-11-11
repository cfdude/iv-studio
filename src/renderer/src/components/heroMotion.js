// The page banners' motion (Hero.jsx): one light animation per banner picture, centred on the picture's subject
// (the anchor: { x, y, r }, from where the art sits in the banner) and faded out towards the title on the left by the
// canvas' CSS mask. Short banners, so everything here stays quieter than the tall Workflows banners (Stage.jsx).
// Each effect: make(w, h, anchor) -> state; draw(ctx, state, w, h, t, dt, anchor). Engine: MotionCanvas.jsx.
import { CREAM, PINK, RED, rand, rgba } from './MotionCanvas'

// slow drifting specks around the subject, shared by a few effects (more of them on a tall banner)
const motes = (n, a) => Array.from({ length: a.big ? Math.round(n * 1.8) : n }, () => ({ x: a.x + rand(-a.r * 2.6, a.r * 2.6), y: rand(0, a.y * 2.2), vy: rand(-10, -3), vx: rand(-4, 4), s: rand(0.8, 2), seed: rand(0, 6) }))
function drawMotes(ctx, list, h, t, dt, a, color = CREAM) {
  for (const m of list) {
    m.x += m.vx * dt
    m.y += m.vy * dt
    if (m.y < -4) (m.y = h + 4), (m.x = a.x + rand(-a.r * 2.6, a.r * 2.6))
    ctx.fillStyle = rgba(color, 0.25 + 0.2 * Math.sin(t * 1.3 + m.seed))
    ctx.fillRect(m.x, m.y, m.s, m.s)
  }
}

const photo = (a, h, anywhere) => ({ x: a.x + rand(-a.r * 2.6, a.r * 2.6), y: anywhere ? rand(0, h) : h + rand(10, 40), vy: rand(12, 28), rot: rand(-0.5, 0.5), vr: rand(-0.25, 0.25), s: rand(18, 32) })

export const HERO_EFFECTS = {
  // the eye (Dashboard) and the headphones (Audio): slow rings from the middle, and specks drifting up
  pulse: {
    make: (w, h, a) => ({ rings: [], last: -1, motes: motes(26, a) }),
    draw(ctx, s, w, h, t, dt, a) {
      const n = Math.floor(t / 2.2)
      if (n !== s.last) (s.last = n), s.rings.push({ r: a.r * 0.45, al: 0.4 })
      s.rings = s.rings.filter((r) => (r.al -= dt * 0.13) > 0)
      for (const r of s.rings) {
        r.r += dt * a.r * 0.55
        ctx.strokeStyle = rgba(RED, r.al)
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.ellipse(a.x, a.y, r.r * 1.25, r.r * 0.8, 0, 0, Math.PI * 2)
        ctx.stroke()
      }
      drawMotes(ctx, s.motes, h, t, dt, a)
    }
  },
  // Create (a hand releasing sparks): sparks rising off the hand and fading
  sparks: {
    make: () => ({ bits: [], acc: 0 }),
    draw(ctx, s, w, h, t, dt, a) {
      s.acc += dt * (a.big ? 48 : 22)
      while (s.acc > 1) {
        s.acc--
        const ang = rand(-Math.PI * 0.85, -Math.PI * 0.15)
        const v = rand(20, 70)
        s.bits.push({ x: a.x + rand(-a.r * 0.25, a.r * 0.25), y: a.y - a.r * 0.15, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v, life: 0, max: rand(1.2, 2.6), star: Math.random() < 0.25 })
      }
      s.bits = s.bits.filter((b) => (b.life += dt) < b.max)
      for (const b of s.bits) {
        b.x += b.vx * dt
        b.y += b.vy * dt
        b.vy += 6 * dt
        const k = 1 - b.life / b.max
        ctx.fillStyle = rgba(b.star ? CREAM : PINK, 0.75 * k)
        if (b.star) {
          ctx.fillRect(b.x - 2.5, b.y - 0.5, 5, 1)
          ctx.fillRect(b.x - 0.5, b.y - 2.5, 1, 5)
        } else ctx.fillRect(b.x - 1, b.y - 1, 2, 2)
      }
    }
  },
  // Projects (a director's chair and megaphone): a spotlight beam sweeping slowly across the set
  spotlight: {
    make: (w, h, a) => ({ motes: motes(18, a) }),
    draw(ctx, s, w, h, t, dt, a) {
      const ox = a.x - a.r * 0.6
      const oy = -30
      const ang = Math.PI / 2 + Math.sin(t * 0.45) * 0.55
      const len = h * 1.6
      const spread = 0.17
      const g = ctx.createRadialGradient(ox, oy, 0, ox, oy, len)
      g.addColorStop(0, rgba(CREAM, 0.16))
      g.addColorStop(1, rgba(CREAM, 0))
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.moveTo(ox, oy)
      ctx.lineTo(ox + Math.cos(ang - spread) * len, oy + Math.sin(ang - spread) * len)
      ctx.lineTo(ox + Math.cos(ang + spread) * len, oy + Math.sin(ang + spread) * len)
      ctx.closePath()
      ctx.fill()
      drawMotes(ctx, s.motes, h, t, dt, a)
    }
  },
  // Shots (a clapperboard): a projector's beam, steady and slowly breathing, with dust turning in it and now and then a
  // faint scratch that fades in and out over a second or two. Nothing here flickers or flashes (photosensitivity).
  projector: {
    make: (w, h, a) => ({ dust: Array.from({ length: a.big ? 60 : 30 }, () => ({ u: rand(0, 1), v: rand(0, 1), vu: rand(-0.02, 0.02), vv: rand(-0.03, -0.008), s: rand(0.8, 2.2), seed: rand(0, 6) })), scratch: null, next: 3 }),
    draw(ctx, s, w, h, t, dt, a) {
      // the beam: from a lens above the top edge, widening downwards over the subject
      const ox = a.x
      const oy = -h * 0.35
      const spread = a.r * 2.4
      const glow = 0.09 + 0.025 * Math.sin(t * 0.7) // a slow breath, about every 9 seconds
      const g = ctx.createLinearGradient(0, 0, 0, h)
      g.addColorStop(0, rgba(CREAM, glow))
      g.addColorStop(1, rgba(CREAM, 0))
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.moveTo(ox - 10, oy)
      ctx.lineTo(ox + 10, oy)
      ctx.lineTo(ox + spread, h)
      ctx.lineTo(ox - spread, h)
      ctx.closePath()
      ctx.fill()
      // dust in the beam
      for (const d of s.dust) {
        d.u += d.vu * dt
        d.v += d.vv * dt
        if (d.v < 0) (d.v = 1), (d.u = rand(0, 1))
        if (d.u < 0 || d.u > 1) d.vu = -d.vu
        const y = d.v * h
        const half = 10 + ((y - oy) / (h - oy)) * (spread - 10)
        ctx.fillStyle = rgba(CREAM, 0.22 + 0.16 * Math.sin(t * 0.8 + d.seed))
        ctx.fillRect(ox - half + d.u * half * 2, y, d.s, d.s)
      }
      // a faint scratch, fading in and out
      if (!s.scratch && t >= s.next) s.scratch = { x: ox + rand(-spread * 0.6, spread * 0.6), born: t, life: rand(1.2, 2) }
      if (s.scratch) {
        const k = (t - s.scratch.born) / s.scratch.life
        if (k >= 1) (s.scratch = null), (s.next = t + rand(3, 6))
        else {
          ctx.strokeStyle = rgba(CREAM, 0.2 * Math.sin(k * Math.PI))
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.moveTo(s.scratch.x, 0)
          ctx.lineTo(s.scratch.x + 4, h)
          ctx.stroke()
        }
      }
    }
  },
  // Edit (scissors through film): a film strip running past under the subject, snipped with a bright cut now and then
  snip: {
    make: () => ({ last: -1, cut: -10 }),
    draw(ctx, s, w, h, t, dt, a) {
      // along the bottom on a tall banner (under its bar), under the subject on a short one; no band behind it, and
      // each frame fades out towards the strip's ends, so it has no hard edges
      const fh = a.big ? 28 : 34
      const fw = a.big ? 40 : 48
      const y = a.big ? h - fh - 18 : Math.min(h - 46, a.y + a.r * 0.7)
      const half = a.r * 3
      const off = (t * 40) % (fw + 8)
      for (let x = a.x - half - fw + off; x < a.x + half; x += fw + 8) {
        const k = Math.max(0, 1 - Math.abs(x + fw / 2 - a.x) / half)
        if (!k) continue
        ctx.fillStyle = rgba(RED, 0.24 * k)
        ctx.fillRect(x, y, fw, fh)
        ctx.fillStyle = rgba(CREAM, 0.3 * k)
        for (let hx = x + 3; hx < x + fw; hx += 12) ctx.fillRect(hx, y - 6, 6, 4), ctx.fillRect(hx, y + fh + 2, 6, 4)
      }
      const n = Math.floor(t / 1.8)
      if (n !== s.last) (s.last = n), (s.cut = t)
      // the cut fades in and out over most of a second: a mark, not a flash
      const k = (t - s.cut) / 0.8
      if (k < 1) {
        ctx.strokeStyle = rgba(CREAM, 0.55 * Math.sin(k * Math.PI))
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(a.x, y - 12)
        ctx.lineTo(a.x, y + fh + 12)
        ctx.stroke()
      }
    }
  },
  // Workflows (cogs): two rings of teeth turning opposite ways around the cogs
  cogs: {
    make: () => ({}),
    draw(ctx, s, w, h, t, dt, a) {
      const ring = (r, n, dir, alpha) => {
        ctx.fillStyle = rgba(RED, alpha)
        for (let i = 0; i < n; i++) {
          const ang = (i / n) * Math.PI * 2 + t * 0.25 * dir
          ctx.save()
          ctx.translate(a.x + Math.cos(ang) * r, a.y + Math.sin(ang) * r * 0.8)
          ctx.rotate(ang)
          ctx.fillRect(-3, -1.5, 6, 3)
          ctx.restore()
        }
      }
      ring(a.r * 1.35, 36, 1, 0.35)
      ring(a.r * 1.75, 48, -1, 0.22)
    }
  },
  // Characters (a cameo profile): a soft glow breathing behind the subject, dust
  halo: {
    make: (w, h, a) => ({ motes: motes(30, a) }),
    draw(ctx, s, w, h, t, dt, a) {
      const k = 0.5 + 0.5 * Math.sin(t * 0.9)
      const g = ctx.createRadialGradient(a.x, a.y, a.r * 0.3, a.x, a.y, a.r * (1.6 + 0.3 * k))
      g.addColorStop(0, rgba(PINK, 0.1 + 0.08 * k))
      g.addColorStop(1, rgba(PINK, 0))
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, h)
      drawMotes(ctx, s.motes, h, t, dt, a)
    }
  },
  // LoRAs (a lens): a flare gliding past the lens with a trail of ghosts mirrored through it
  flare: {
    make: () => ({}),
    draw(ctx, s, w, h, t, dt, a) {
      const p = (t % 7) / 7
      if (p > 0.75) return
      const q = p / 0.75
      const fx = a.x - a.r * 2.2 + q * a.r * 4.4
      const fy = a.y - a.r * 0.9 + q * a.r * 0.6
      const fade = Math.sin(q * Math.PI)
      const g = ctx.createRadialGradient(fx, fy, 0, fx, fy, a.r * 0.8)
      g.addColorStop(0, rgba(CREAM, 0.55 * fade))
      g.addColorStop(0.2, rgba(PINK, 0.18 * fade))
      g.addColorStop(1, rgba(RED, 0))
      ctx.fillStyle = g
      ctx.fillRect(fx - a.r, fy - a.r, a.r * 2, a.r * 2)
      for (const [k, r, c] of [
        [-0.4, 10, PINK],
        [-0.8, 18, RED],
        [-1.3, 7, CREAM]
      ]) {
        const gx = a.x + (fx - a.x) * k
        const gy = a.y + (fy - a.y) * k
        ctx.strokeStyle = rgba(c, 0.35 * fade)
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.arc(gx, gy, r, 0, Math.PI * 2)
        ctx.stroke()
      }
    }
  },
  // the Library (fanned photographs): small photographs drifting up and turning, fading as they go
  photos: {
    make: (w, h, a) => ({ list: Array.from({ length: a.big ? 22 : 12 }, () => photo(a, h, true)) }),
    draw(ctx, s, w, h, t, dt, a) {
      for (const p of s.list) {
        p.y -= p.vy * dt
        p.rot += p.vr * dt
        if (p.y < -30) Object.assign(p, photo(a, h, false))
        const fade = Math.min(1, p.y / (h * 0.5))
        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.rotate(p.rot)
        ctx.fillStyle = rgba(RED, 0.16 * fade)
        ctx.fillRect(-p.s / 2, -p.s * 0.4, p.s, p.s * 0.8)
        ctx.strokeStyle = rgba(CREAM, 0.45 * fade)
        ctx.lineWidth = 1.2
        ctx.strokeRect(-p.s / 2, -p.s * 0.4, p.s, p.s * 0.8)
        ctx.restore()
      }
    }
  },
  // Cloud (a soft floating cloud): dreamy. Soft wisps of cloud drift slowly past, and specks of light glow and fade
  // over several seconds like distant stars. Slow on purpose: nothing flashes.
  dream: {
    make: (w, h, a) => ({
      wisps: Array.from({ length: a.big ? 9 : 6 }, (_, i) => ({ x: a.x + rand(-a.r * 3.2, a.r * 3.2), y: rand(h * 0.15, h * 0.9), rx: rand(a.r * 0.6, a.r * 1.4), ry: rand(a.r * 0.12, a.r * 0.25), v: rand(5, 14) * (i % 2 ? 1 : 0.7), seed: rand(0, 6) })),
      stars: Array.from({ length: a.big ? 46 : 26 }, () => ({ x: a.x + rand(-a.r * 3.4, a.r * 3.4), y: rand(0, h), s: rand(0.8, 2), f: rand(0.25, 0.5), seed: rand(0, 6) }))
    }),
    draw(ctx, s, w, h, t, dt, a) {
      const left = a.x - a.r * 3.6
      const right = a.x + a.r * 3.6
      for (const p of s.wisps) {
        p.x += p.v * dt
        if (p.x - p.rx > right) p.x = left - p.rx
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.rx)
        const al = 0.1 + 0.04 * Math.sin(t * 0.35 + p.seed)
        g.addColorStop(0, rgba(PINK, al))
        g.addColorStop(1, rgba(PINK, 0))
        ctx.fillStyle = g
        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.scale(1, p.ry / p.rx)
        ctx.translate(-p.x, -p.y)
        ctx.fillRect(p.x - p.rx, p.y - p.rx, p.rx * 2, p.rx * 2)
        ctx.restore()
      }
      for (const st of s.stars) {
        // each glows and fades over 12 to 25 seconds
        ctx.fillStyle = rgba(CREAM, 0.12 + 0.3 * (0.5 + 0.5 * Math.sin(t * st.f + st.seed)))
        ctx.fillRect(st.x, st.y, st.s, st.s)
      }
    }
  },
  // Settings (crossed wrenches): a ring of dial ticks turning slowly, one tick lit as it goes round
  dial: {
    make: () => ({}),
    draw(ctx, s, w, h, t, dt, a) {
      const n = 60
      const lit = Math.floor((t * 6) % n)
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * Math.PI * 2 + t * 0.08
        const long = i % 5 === 0
        const r0 = a.r * 1.45
        const r1 = r0 + (long ? 12 : 6)
        const on = i === lit
        ctx.strokeStyle = on ? rgba(CREAM, 0.9) : rgba(RED, long ? 0.4 : 0.22)
        ctx.lineWidth = on || long ? 2 : 1
        ctx.beginPath()
        ctx.moveTo(a.x + Math.cos(ang) * r0, a.y + Math.sin(ang) * r0 * 0.8)
        ctx.lineTo(a.x + Math.cos(ang) * r1, a.y + Math.sin(ang) * r1 * 0.8)
        ctx.stroke()
      }
    }
  }
}

// Which effect each banner picture gets (Hero's art; no art is the eye). Pictures not listed stay still.
export const HERO_MOTION = {
  eye: 'pulse',
  audio: 'pulse',
  create: 'sparks',
  projects: 'spotlight',
  shots: 'projector',
  edit: 'snip',
  workflows: 'cogs',
  characters: 'halo',
  library: 'photos',
  loras: 'flare',
  cloud: 'dream',
  settings: 'dial'
}
