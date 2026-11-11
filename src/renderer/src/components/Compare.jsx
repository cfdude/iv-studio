import { useEffect, useMemo, useRef, useState } from 'react'

// Versions of a shot against each other (takes, finals, enhanced copies): up to four, played, paused, stepped and
// scrubbed together. Side by side and Wipe show the first two; Grid shows them all. Zoom looks at the same spot in
// every one, which is where upscalers differ: the mouse wheel zooms in and out (1x to 8x) at the pointer, dragging
// looks around (Shift-drag in Wipe, where a plain drag moves the wipe), 1x/2x/4x jump there, and a double-click
// zooms in where you click. The spot is one offset for every picture (fractions of a picture), so it lines up. Each slot can
// be swapped for any other version of the shot (pool). The sound is the first one's.
//   items: [{ key, url, label, prompt }] (2-4), or a and b; pool: every version the slots can take.
export function CompareViewer({ a, b, items, pool = [], onClose }) {
  const start = items || [a, b].filter(Boolean)
  const all = useMemo(() => {
    const seen = new Map()
    for (const it of [...start, ...pool]) if (it?.url && !seen.has(it.key)) seen.set(it.key, it)
    return [...seen.values()]
  }, [pool])
  const [slots, setSlots] = useState(start.map((it) => it.key).slice(0, 4))
  const shown = slots.map((k) => all.find((it) => it.key === k)).filter(Boolean)
  const [mode, setMode] = useState(start.length > 2 ? 'grid' : 'side')
  const [split, setSplit] = useState(50)
  // zoom 1-8, and the top-left corner of what's in view, as fractions of a picture (0 to zoom - 1)
  const [zoom, setZoom] = useState(1)
  const [off, setOff] = useState({ x: 0, y: 0 })
  const [panning, setPanning] = useState(false)
  const stage = useRef(null)
  const view = useRef({ zoom: 1, off: { x: 0, y: 0 } })
  view.current = { zoom, off }
  const [playing, setPlaying] = useState(false)
  const [t, setT] = useState(0)
  const [length, setLength] = useState(0)
  // the shot's shape, from the first version: Wipe lays both pictures in one box of it, so a zoom lines up
  const [ar, setAr] = useState(16 / 9)
  const refs = useRef([])
  const live = () => refs.current.filter(Boolean)
  const visible = mode === 'grid' ? shown : shown.slice(0, 2)

  useEffect(() => {
    const keys = (e) => {
      if (e.target.tagName === 'SELECT') return
      if (e.key === 'Escape') onClose()
      else if (e.key === ' ') (e.preventDefault(), toggle())
      else if (e.key === ',' || e.key === 'ArrowLeft') (e.preventDefault(), step(-1))
      else if (e.key === '.' || e.key === 'ArrowRight') (e.preventDefault(), step(1))
    }
    window.addEventListener('keydown', keys)
    return () => window.removeEventListener('keydown', keys)
  })
  // every other picture follows the first, so they stay frame-aligned however long each takes to load
  useEffect(() => {
    const lead = refs.current[0]
    if (!lead) return
    const tick = () => {
      setT(lead.currentTime)
      for (const v of refs.current.slice(1)) if (v && Math.abs(v.currentTime - lead.currentTime) > 0.06) v.currentTime = lead.currentTime
    }
    lead.addEventListener('timeupdate', tick)
    lead.addEventListener('seeked', tick)
    return () => (lead.removeEventListener('timeupdate', tick), lead.removeEventListener('seeked', tick))
  }, [mode, slots.join('|')])
  // a changed slot or mode starts paused, at the same moment
  useEffect(() => {
    setPlaying(false)
    const at = t
    requestAnimationFrame(() => live().forEach((v) => (v.pause(), (v.currentTime = at))))
  }, [mode, slots.join('|')])

  function toggle() {
    if (playing) {
      // paused, every picture lands on the first one's frame
      live().forEach((v) => v.pause())
      const at = refs.current[0]?.currentTime ?? t
      live().forEach((v) => (v.currentTime = at))
      setT(at)
    } else live().forEach((v) => v.play().catch(() => {}))
    setPlaying(!playing)
  }
  function seek(sec) {
    live().forEach((v) => (v.currentTime = sec))
    setT(sec)
  }
  function step(frames) {
    live().forEach((v) => v.pause())
    setPlaying(false)
    seek(Math.min(Math.max(0, t + frames / 24), length || t))
  }
  // zoom to z keeping the point under c (fractions of the picture box) where it is
  function zoomAt(z, c = { x: 0.5, y: 0.5 }) {
    const { zoom: z1, off: o1 } = view.current
    const z2 = Math.min(8, Math.max(1, z))
    const keep = (k) => Math.min(z2 - 1, Math.max(0, ((c[k] + o1[k]) / z1) * z2 - c[k]))
    setZoom(z2)
    setOff(z2 <= 1.001 ? { x: 0, y: 0 } : { x: keep('x'), y: keep('y') })
  }
  // where the pointer is, as fractions of the picture box it's over
  const at = (e) => {
    const box = e.target.closest?.('.cmp-frame, .compare-wipe') || stage.current
    const r = box.getBoundingClientRect()
    return { box: r, c: { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height } }
  }
  function aim(e) {
    if (zoom === 1) zoomAt(2, at(e).c)
  }
  // the wheel zooms at the pointer (a listener that can stop the page scrolling)
  useEffect(() => {
    const el = stage.current
    if (!el) return
    const wheel = (e) => {
      e.preventDefault()
      const z = view.current.zoom * Math.pow(1.0018, -e.deltaY)
      zoomAt(Math.abs(z - 1) < 0.04 ? 1 : z, at(e).c)
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [mode])
  // dragging a zoomed picture looks around it (in Wipe, Shift-drag: a plain drag moves the wipe)
  function grab(e) {
    if (view.current.zoom <= 1 || e.button !== 0 || (mode === 'wipe' && !e.shiftKey)) return
    e.preventDefault()
    e.stopPropagation()
    const { box } = at(e)
    let last = { x: e.clientX, y: e.clientY }
    setPanning(true)
    const move = (m) => {
      const { zoom: z, off: o } = view.current
      const dx = (m.clientX - last.x) / box.width
      const dy = (m.clientY - last.y) / box.height
      last = { x: m.clientX, y: m.clientY }
      setOff({ x: Math.min(z - 1, Math.max(0, o.x - dx)), y: Math.min(z - 1, Math.max(0, o.y - dy)) })
    }
    const up = () => (setPanning(false), window.removeEventListener('pointermove', move), window.removeEventListener('pointerup', up))
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const swap = (i, key) => setSlots((s) => s.map((k, j) => (j === i ? key : k)))
  const unused = all.filter((it) => !slots.includes(it.key))

  refs.current = []
  const look = { transform: `translate(${-off.x * 100}%, ${-off.y * 100}%) scale(${zoom})`, transformOrigin: '0 0', ...(panning ? { transition: 'none' } : {}) }
  const frame = (it, i, extra = {}) => (
    <div className="cmp-frame" onDoubleClick={aim} {...extra}>
      <video
        ref={(el) => (refs.current[i] = el)}
        src={it.url}
        muted={i !== 0}
        loop
        playsInline
        preload="auto"
        style={look}
        onLoadedMetadata={(e) => i === 0 && (setLength(e.target.duration), e.target.videoHeight && setAr(e.target.videoWidth / e.target.videoHeight))}
      />
    </div>
  )

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal compare compare-${mode}-mode`}>
        <div className="compare-head">
          <div className="segmented">
            <button className={mode === 'side' ? 'on' : ''} onClick={() => setMode('side')}>
              Side by side
            </button>
            <button className={mode === 'wipe' ? 'on' : ''} onClick={() => setMode('wipe')}>
              Wipe
            </button>
            <button className={mode === 'grid' ? 'on' : ''} disabled={shown.length < 3} title={shown.length < 3 ? 'Add a third version to see a grid' : 'Every version at once'} onClick={() => setMode('grid')}>
              Grid
            </button>
          </div>
          <div className="segmented compare-zoom" title="The mouse wheel zooms at the pointer; drag to look around">
            {[1, 2, 4].map((z) => (
              <button key={z} className={Math.abs(zoom - z) < 0.01 ? 'on' : ''} onClick={() => zoomAt(z)}>
                {z}×
              </button>
            ))}
          </div>
          {![1, 2, 4].some((z) => Math.abs(zoom - z) < 0.01) && <span className="mono compare-zoom-now">{zoom.toFixed(1)}×</span>}
          <span className="mono dim small">Space plays · ← → a frame · wheel zooms · {mode === 'wipe' ? 'Shift-drag' : 'drag'} to look around</span>
          <button className="link-btn mono" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="compare-slots">
          {shown.map((it, i) => (
            <label key={`${i}:${it.key}`} className={`compare-slot ${mode !== 'grid' && i > 1 ? 'off' : ''}`}>
              <span className="mono">{mode === 'wipe' ? (i === 0 ? 'Left' : i === 1 ? 'Right' : 'Not shown') : String.fromCharCode(65 + i)}</span>
              <select value={it.key} onChange={(e) => swap(i, e.target.value)} aria-label={`Version ${i + 1}`}>
                {[it, ...unused].map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </select>
              {shown.length > 2 && (
                <button className="compare-slot-x" title="Take it out" onClick={(e) => (e.preventDefault(), setSlots((s) => s.filter((_, j) => j !== i)))}>
                  ×
                </button>
              )}
            </label>
          ))}
          {shown.length < 4 && unused.length > 0 && (
            <button
              className="link-btn mono"
              onClick={() => {
                setSlots((s) => [...s, unused[0].key])
                setMode('grid')
              }}
            >
              + Add a version
            </button>
          )}
        </div>

        <div className={`compare-stage ${zoom > 1 ? 'zoomed' : ''} ${panning ? 'panning' : ''}`} ref={stage} onPointerDownCapture={grab}>
        {mode === 'side' && (
          <div className="compare-side">
            {visible.map((it, i) => (
              <figure key={`${i}:${it.key}`}>
                {frame(it, i)}
                <figcaption className="mono small">{it.label}</figcaption>
              </figure>
            ))}
          </div>
        )}
        {mode === 'wipe' && visible.length === 2 && (
          <div className="compare-wipe" style={{ '--ar': ar }} onDoubleClick={aim}>
            {frame(visible[0], 0, { className: 'cmp-frame cmp-layer' })}
            {frame(visible[1], 1, { className: 'cmp-frame cmp-layer cmp-top', style: { clipPath: `inset(0 0 0 ${split}%)` } })}
            <div className="wipe-line" style={{ left: `${split}%` }} />
            <input className="wipe-slider" type="range" min={0} max={100} value={split} onChange={(e) => setSplit(Number(e.target.value))} aria-label="Wipe position" />
            <span className="wipe-label left mono small">{visible[0].label}</span>
            <span className="wipe-label right mono small">{visible[1].label}</span>
          </div>
        )}
        {mode === 'grid' && (
          <div className={`compare-grid n${visible.length}`}>
            {visible.map((it, i) => (
              <figure key={`${i}:${it.key}`}>
                {frame(it, i)}
                <figcaption className="mono small">{it.label}</figcaption>
              </figure>
            ))}
          </div>
        )}

        </div>

        <div className="compare-transport">
          <button className="btn btn-small" onClick={toggle}>
            {playing ? 'Pause' : 'Play'}
          </button>
          <input type="range" min={0} max={length || 1} step={1 / 24} value={t} onChange={(e) => seek(Number(e.target.value))} aria-label="Position" />
          <span className="mono small">
            {t.toFixed(2)} / {length.toFixed(2)} s · frame {Math.round(t * 24) + 1}
          </span>
        </div>
        {visible[0]?.prompt !== visible[1]?.prompt && visible[0]?.prompt && visible[1]?.prompt && (
          <details className="compare-diff" open>
            <summary className="mono dim">What changed in the prompt</summary>
            <PromptDiff before={visible[0].prompt} after={visible[1].prompt} />
          </details>
        )}
      </div>
    </div>
  )
}

// Word changes from one prompt to the next: removed words struck through, added ones marked.
export function PromptDiff({ before, after }) {
  return (
    <pre className="prompt-diff">
      {wordDiff(before, after).map(([op, text], i) => (op === '=' ? text : <span key={i} className={op === '+' ? 'added' : 'removed'}>{text}</span>))}
    </pre>
  )
}

// The longest common run of words between two texts, as [op, text] pieces ('=', '+', '-'), whitespace kept.
export function wordDiff(a, b) {
  const x = String(a).split(/(\s+)/)
  const y = String(b).split(/(\s+)/)
  const n = x.length
  const m = y.length
  if (n * m > 4e6) return [['-', a], ['+', b]]
  const lcs = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = x[i] === y[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
  const out = []
  const push = (op, text) => (out.length && out.at(-1)[0] === op ? (out.at(-1)[1] += text) : out.push([op, text]))
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      push('=', x[i++])
      j++
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) push('-', x[i++])
    else push('+', y[j++])
  }
  while (i < n) push('-', x[i++])
  while (j < m) push('+', y[j++])
  return out
}

// What changed between a run and the one before it, in a few words.
export function runChanges(req, prev) {
  if (!prev) return []
  const out = []
  if ((req.prompt || '') !== (prev.prompt || '')) out.push('prompt')
  if (req.mode !== prev.mode) out.push(`${prev.mode} → ${req.mode}`)
  if (req.seed !== prev.seed) out.push(`seed ${prev.seed} → ${req.seed}`)
  if (req.seconds !== prev.seconds) out.push(`${prev.seconds} s → ${req.seconds} s`)
  if (req.aspect !== prev.aspect) out.push(`${prev.aspect} → ${req.aspect}`)
  if (req.character !== prev.character) out.push('character')
  if (JSON.stringify(req.extraLoras || []) !== JSON.stringify(prev.extraLoras || [])) out.push('LoRAs')
  if (JSON.stringify((req.media || []).map((m) => m.file)) !== JSON.stringify((prev.media || []).map((m) => m.file))) out.push('references')
  if (req.megapixels !== prev.megapixels) out.push(`${prev.megapixels} → ${req.megapixels} MP`)
  return out
}
