import { useEffect, useRef, useState } from 'react'
import { fileUrl } from './model'

// New angle's camera, shown three ways: a top-down plan and a side view of where the new camera sits against the
// original one (drag either to move it), the move in plain words with the range the CrossView LoRA was trained on,
// and the picture itself. "Preview this angle" runs only the depth and warp half of the graph (MoGe + CrossView
// Warp, freefield.js previewAngle); after that, CrossView's own live route re-warps the clip for every change, so the
// picture follows the sliders and can be dragged like the node in ComfyUI. Magenta is what the original camera never
// saw: H3 has to invent it.
//
// Signs follow CrossView: +azimuth orbits RIGHT, +elevation rises above the subject. Its README: green is +-45
// azimuth and +30/-20 elevation (checked), yellow to +-90 and +45/-35 (the training set); distance isn't followed
// reliably by the current LoRA.
export const ZONES = { az: [45, 90], up: [30, 45], down: [-20, -35] }

export function zoneOf(az, el) {
  const a = Math.abs(az)
  if (a > 90 || el > 45 || el < -35) return 'out'
  if (a > 45 || el > 30 || el < -20) return 'edge'
  return 'in'
}

export function cameraWords({ azimuth = 0, elevation = 0, distance = 1, hfov = 50 }) {
  const a = Math.round(azimuth)
  const e = Math.round(elevation)
  const parts = []
  parts.push(a === 0 ? 'Straight on' : `Orbits ${Math.abs(a)}° ${a < 0 ? 'left' : 'right'}`)
  parts.push(e === 0 ? 'at the same height' : e > 0 ? `rises ${e}° above` : `drops ${-e}° below, looking up`)
  const d = Number(distance)
  parts.push(Math.abs(d - 1) < 0.03 ? 'same distance' : d < 1 ? `${Math.round((1 - d) * 100)}% closer` : `${Math.round((d - 1) * 100)}% further back`)
  const lens = Number(hfov)
  const lensWords = !lens ? 'lens read from the clip' : lens < 30 ? `${lens}° long lens` : lens <= 60 ? `${lens}° normal lens` : `${lens}° wide lens`
  return `${parts.join(', ')} · ${lensWords}`
}

export function zoneWords(az, el) {
  if (Math.abs(az) < 6 && Math.abs(el) < 6) return { tone: 'pink', text: 'A very small move. The model misbehaves when the new view is almost the same as the original.' }
  const z = zoneOf(az, el)
  if (z === 'in' && Math.abs(az) <= 20 && Math.abs(el) <= 10) return { tone: 'ok', text: 'A move H3 follows well. Check the preview: magenta is what it has to invent.' }
  if (z === 'in') return { tone: 'pink', text: 'Inside the range the CrossView LoRA was checked on, but a big move for most shots: the more magenta in the preview, the more H3 invents or falls back to the original angle.' }
  if (z === 'edge') return { tone: 'pink', text: el < -20 ? 'Looking up from below is thin in the training set: expect more invention.' : 'Past the checked range, inside what it was trained on: expect more invention.' }
  return { tone: 'red', text: 'Past the training set: the hidden side is invented.' }
}

const rad = (d) => (d * Math.PI) / 180
// an annular wedge in the plan: angles measured from straight down (the original camera), + to the right
function wedge(cx, cy, r0, r1, a0, a1) {
  const p = (r, a) => [cx + r * Math.sin(rad(a)), cy + r * Math.cos(rad(a))]
  const [x0, y0] = p(r1, a0)
  const [x1, y1] = p(r1, a1)
  const [x2, y2] = p(r0, a1)
  const [x3, y3] = p(r0, a0)
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0
  return `M${x0} ${y0} A${r1} ${r1} 0 ${large} 0 ${x1} ${y1} L${x2} ${y2} A${r0} ${r0} 0 ${large} 1 ${x3} ${y3} Z`
}
// a wedge in the side view: angles from the horizontal, + up, opening to the left of the subject
function sideWedge(cx, cy, r0, r1, a0, a1) {
  const p = (r, a) => [cx - r * Math.cos(rad(a)), cy - r * Math.sin(rad(a))]
  const [x0, y0] = p(r1, a0)
  const [x1, y1] = p(r1, a1)
  const [x2, y2] = p(r0, a1)
  const [x3, y3] = p(r0, a0)
  return `M${x0} ${y0} A${r1} ${r1} 0 0 1 ${x1} ${y1} L${x2} ${y2} A${r0} ${r0} 0 0 0 ${x3} ${y3} Z`
}

function CameraGlyph({ x, y, toward, hfov, ghost, label, labelSide = 1 }) {
  // a small camera body pointing at `toward`, with its field of view drawn as a cone
  const ang = Math.atan2(toward[1] - y, toward[0] - x)
  const half = rad(Math.max(10, Math.min(120, hfov || 50)) / 2)
  const len = 46
  const cone = `M${x} ${y} L${x + len * Math.cos(ang - half)} ${y + len * Math.sin(ang - half)} L${x + len * Math.cos(ang + half)} ${y + len * Math.sin(ang + half)} Z`
  return (
    <g className={`rig-cam${ghost ? ' ghost' : ''}`}>
      <path d={cone} className="rig-cone" />
      <g transform={`translate(${x} ${y}) rotate(${(ang * 180) / Math.PI})`}>
        <rect x={-11} y={-7} width={14} height={14} rx={2} />
        <path d="M3 -4 L10 -7 L10 7 L3 4 Z" />
      </g>
      {label && (
        <text x={x} y={y + 22 * labelSide} textAnchor="middle" className="rig-label">
          {label}
        </text>
      )}
    </g>
  )
}

function Plan({ azimuth, distance, hfov, onChange }) {
  const W = 300
  const H = 230
  const cx = W / 2
  const cy = 92
  const R = 92 // distance 1
  const r = R * Math.max(0.35, Math.min(1.25, Number(distance) || 1))
  const cam = [cx + r * Math.sin(rad(azimuth)), cy + r * Math.cos(rad(azimuth))]
  const ref = useRef(null)
  function drag(e) {
    const box = ref.current.getBoundingClientRect()
    const x = ((e.clientX - box.left) / box.width) * W - cx
    const y = ((e.clientY - box.top) / box.height) * H - cy
    let a = (Math.atan2(x, y) * 180) / Math.PI
    a = Math.max(-180, Math.min(180, Math.round(a)))
    onChange({ azimuth: a })
  }
  return (
    <svg
      ref={ref}
      className="rig-svg"
      viewBox={`0 0 ${W} ${H}`}
      role="slider"
      aria-label="Orbit, seen from above"
      aria-valuemin={-90}
      aria-valuemax={90}
      aria-valuenow={azimuth}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') onChange({ azimuth: Math.max(-180, azimuth - (e.shiftKey ? 10 : 1)) })
        if (e.key === 'ArrowRight') onChange({ azimuth: Math.min(180, azimuth + (e.shiftKey ? 10 : 1)) })
      }}
      onPointerDown={(e) => (e.currentTarget.setPointerCapture(e.pointerId), drag(e))}
      onPointerMove={(e) => e.buttons === 1 && drag(e)}
    >
      <path className="rig-zone edge" d={wedge(cx, cy, 28, R * 1.3, -90, 90)} />
      <path className="rig-zone in" d={wedge(cx, cy, 28, R * 1.3, -45, 45)} />
      <circle cx={cx} cy={cy} r={R} className="rig-orbit" />
      <line x1={cx} y1={cy} x2={cx} y2={cy + R * 1.3} className="rig-axis" />
      {/* the subject, seen from above, facing the original camera */}
      <circle cx={cx} cy={cy} r={9} className="rig-subject" />
      <path d={`M${cx - 5} ${cy + 6} L${cx} ${cy + 14} L${cx + 5} ${cy + 6}`} className="rig-subject-nose" />
      <CameraGlyph x={cx} y={cy + R} toward={[cx, cy]} hfov={hfov} ghost label="Original" />
      <CameraGlyph x={cam[0]} y={cam[1]} toward={[cx, cy]} hfov={hfov} label="New" labelSide={cam[1] < cy ? -1 : 1} />
      <text x={12} y={H - 10} className="rig-label">
        Left
      </text>
      <text x={W - 12} y={H - 10} textAnchor="end" className="rig-label">
        Right
      </text>
      <text x={12} y={18} className="rig-label strong">
        From above
      </text>
    </svg>
  )
}

function Side({ elevation, distance, onChange }) {
  const W = 300
  const H = 230
  const cx = 214
  const cy = 132
  const R = 120
  const r = R * Math.max(0.35, Math.min(1.25, Number(distance) || 1))
  const cam = [cx - r * Math.cos(rad(elevation)), cy - r * Math.sin(rad(elevation))]
  const ref = useRef(null)
  function drag(e) {
    const box = ref.current.getBoundingClientRect()
    const x = cx - ((e.clientX - box.left) / box.width) * W
    const y = cy - ((e.clientY - box.top) / box.height) * H
    onChange({ elevation: Math.max(-90, Math.min(90, Math.round((Math.atan2(y, Math.max(1, x)) * 180) / Math.PI))) })
  }
  return (
    <svg
      ref={ref}
      className="rig-svg"
      viewBox={`0 0 ${W} ${H}`}
      role="slider"
      aria-label="Height, seen from the side"
      aria-valuemin={-35}
      aria-valuemax={45}
      aria-valuenow={elevation}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp') onChange({ elevation: Math.min(90, elevation + (e.shiftKey ? 10 : 1)) })
        if (e.key === 'ArrowDown') onChange({ elevation: Math.max(-90, elevation - (e.shiftKey ? 10 : 1)) })
      }}
      onPointerDown={(e) => (e.currentTarget.setPointerCapture(e.pointerId), drag(e))}
      onPointerMove={(e) => e.buttons === 1 && drag(e)}
    >
      <path className="rig-zone edge" d={sideWedge(cx, cy, 24, R * 1.25, -35, 45)} />
      <path className="rig-zone in" d={sideWedge(cx, cy, 24, R * 1.25, -20, 30)} />
      <line x1={10} y1={cy + 34} x2={W - 10} y2={cy + 34} className="rig-ground" />
      <line x1={cx} y1={cy} x2={cx - R * 1.25} y2={cy} className="rig-axis" />
      {/* the subject, side on */}
      <circle cx={cx} cy={cy - 20} r={8} className="rig-subject" />
      <line x1={cx} y1={cy - 12} x2={cx} y2={cy + 34} className="rig-subject-line" />
      <CameraGlyph x={cx - R} y={cy} toward={[cx, cy]} hfov={50} ghost label="Original" />
      <CameraGlyph x={cam[0]} y={cam[1]} toward={[cx, cy]} hfov={50} label="New" labelSide={-1} />
      <text x={12} y={18} className="rig-label strong">
        From the side
      </text>
    </svg>
  )
}

const LENSES = [
  [0, 'From the clip'],
  [24, '24° long'],
  [35, '35°'],
  [50, '50° normal'],
  [70, '70° wide'],
  [90, '90° very wide']
]

export function CameraRig({ values, camera, defaults = {}, clip, previewStatus, onValues, onCamera, size = null, sizeChoices = null, onSize = () => {} }) {
  const az = Number(values.azimuth ?? -30)
  const el = Number(values.elevation ?? 20)
  const dist = Number(values.distance ?? 1)
  const cam = { ...defaults, ...camera }
  const [state, setState] = useState({ phase: 'idle' }) // idle | running | live | clip | error
  const [img, setImg] = useState(null)
  const [frame, setFrame] = useState(1)
  const [count, setCount] = useState(0)
  const [adv, setAdv] = useState(false)
  const busy = useRef(false)
  const wanted = useRef(null)
  const live = state.phase === 'live'
  const params = { ...cam, azimuth: az, elevation: el, distance: dist }
  const key = JSON.stringify([params, frame])

  // the live picture: one request in flight, the newest camera next
  async function render(p, f) {
    if (busy.current) return void (wanted.current = [p, f])
    busy.current = true
    try {
      const r = await window.ivstudio.clipfx.live({ fx: 'reshoot', frame: f, params: p })
      if (r.stale || r.unavailable) setState((s) => ({ ...s, phase: 'clip' }))
      else {
        setImg(r.image)
        if (r.count) setCount(r.count)
      }
    } catch (err) {
      setState((s) => ({ ...s, phase: 'clip', note: err.message }))
    } finally {
      busy.current = false
      const next = wanted.current
      wanted.current = null
      if (next) render(...next)
    }
  }
  useEffect(() => {
    if (live) render(params, frame)
  }, [key, live])

  async function preview() {
    setState({ phase: 'running' })
    const t0 = Date.now()
    try {
      const r = await window.ivstudio.clipfx.preview({ fx: 'reshoot', file: clip.file, start: clip.start, length: clip.length, values, camera, size })
      setState({ phase: 'live', file: r.file, seconds: Math.round((Date.now() - t0) / 1000) })
      setFrame(1)
    } catch (err) {
      setState({ phase: 'error', note: err.message })
    }
  }

  // dragging the picture orbits the camera, the wheel moves it in and out (as CrossView's own preview does)
  const pic = useRef(null)
  function picDrag(e) {
    if (!live || e.buttons !== 1) return
    onValues({ azimuth: Math.max(-180, Math.min(180, Math.round(az + e.movementX * 0.35))), elevation: Math.max(-90, Math.min(90, Math.round(el - e.movementY * 0.35))) })
  }
  const zone = zoneWords(az, el)
  const pv = previewStatus
  const cannot = pv && !pv.ready ? (pv.missingNodes?.length ? 'Needs the CrossView node pack: Setup → Install missing node packs, then restart ComfyUI.' : pv.missingModels?.length ? `Needs ${pv.missingModels.join(', ')}: Setup.` : null) : null
  return (
    <div className="camera-rig">
      <div className="rig-plans">
        <Plan azimuth={az} distance={dist} hfov={cam.hfov || 50} onChange={onValues} />
        <Side elevation={el} distance={dist} onChange={onValues} />
      </div>
      <p className="rig-words">{cameraWords({ azimuth: az, elevation: el, distance: dist, hfov: cam.hfov })}</p>
      <p className={`small rig-zone-note ${zone.tone}`}>
        <span className={`rig-dot ${zoneOf(az, el)}`} /> {zone.text}
        {Math.abs(dist - 1) > 0.05 && ' Distance isn’t followed reliably by the current CrossView LoRA.'}
      </p>

      <div className="rig-picture">
        {live && img ? (
          <img
            ref={pic}
            src={img}
            alt="The clip from the new angle"
            draggable={false}
            onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
            onPointerMove={picDrag}
            onWheel={(e) => onValues({ distance: Math.max(0.5, Math.min(2, Math.round((dist + (e.deltaY > 0 ? 0.05 : -0.05)) * 100) / 100)) })}
          />
        ) : state.file ? (
          <video src={fileUrl(state.file)} autoPlay loop muted playsInline />
        ) : (
          <div className="rig-picture-empty">
            <span className="mono small">{state.phase === 'running' ? 'Reading depth and warping…' : 'The shot from here'}</span>
            <span className="small dim">{state.phase === 'running' ? 'The first time loads MoGe; after that it re-warps as you move.' : 'Preview this angle shows the clip from the new camera, before H3 renders anything.'}</span>
          </div>
        )}
        {live && img && <span className="rig-picture-tag mono">Live · drag to orbit · wheel to move in</span>}
      </div>
      {live && count > 1 && (
        <label className="fx-slider rig-scrub">
          <span className="mono small dim">Frame</span>
          <input type="range" min={1} max={count} value={frame} onChange={(e) => setFrame(Number(e.target.value))} aria-label="Frame" />
          <span className="mono small">
            {frame}/{count}
          </span>
        </label>
      )}
      <div className="rig-actions">
        <button className="btn btn-small" disabled={state.phase === 'running' || !!cannot || !clip?.file} onClick={preview}>
          {state.phase === 'running' ? 'Previewing…' : live || state.file ? 'Preview again' : 'Preview this angle'}
        </button>
        <span className="small dim">
          {cannot ||
            (state.phase === 'error' && state.note) ||
            (state.phase === 'clip' && (state.note || 'The live picture is gone (ComfyUI ran something else). Preview again to bring it back.')) ||
            (live ? `Warped in ${state.seconds} s. Magenta is what the original camera never saw: H3 fills it in.` : 'A few seconds, free, on this PC. Only the depth and warp, not H3.')}
        </span>
      </div>

      <button className="link-btn small rig-adv-toggle" onClick={() => setAdv(!adv)} aria-expanded={adv}>
        {adv ? '▾' : '▸'} Advanced camera
      </button>
      {adv && (
        <div className="rig-adv">
          {sizeChoices && (
            <div className="create-field">
              <span className="create-label mono">Picture size</span>
              <div className="segmented wrap">
                {sizeChoices.map(([v, l]) => (
                  <button key={v} className={Number(size) === v ? 'on' : ''} onClick={() => onSize(v)}>
                    {l} · {v} MP
                  </button>
                ))}
              </div>
              <span className="small dim">Standard fits a 5 s clip on a PC with 64 GB of RAM. Sharper needs a good deal more memory; on 64 GB keep it to about 2 seconds.</span>
            </div>
          )}
          <div className="create-field">
            <span className="create-label mono">Lens (horizontal field of view)</span>
            <div className="segmented wrap">
              {LENSES.map(([v, l]) => (
                <button key={v} className={Number(cam.hfov) === v ? 'on' : ''} onClick={() => onCamera({ hfov: v })}>
                  {l}
                </button>
              ))}
            </div>
            <span className="small dim">The lens the clip was shot on, which the warp assumes. From the clip reads it from the depth, about 10% short; set it if you know it.</span>
          </div>
          <label className="create-field">
            <span className="create-label mono">Vertical shift</span>
            <div className="fx-slider">
              <input type="range" min={-1} max={1} step={0.02} value={cam.vertical_shift ?? 0} onChange={(e) => onCamera({ vertical_shift: Number(e.target.value) })} />
              <span className="mono">{Number(cam.vertical_shift ?? 0).toFixed(2)}</span>
            </div>
            <span className="small dim">A lens shift: moves the framing up or down without tilting, to rescue a cut-off head. Nothing moves, so the parallax stays.</span>
          </label>
          <label className="create-field">
            <span className="create-label mono">Depth relief</span>
            <div className="fx-slider">
              <input type="range" min={1} max={20} step={0.5} value={cam.depth_ratio ?? 6} onChange={(e) => onCamera({ depth_ratio: Number(e.target.value) })} />
              <span className="mono">{Number(cam.depth_ratio ?? 6).toFixed(1)}</span>
            </div>
            <span className="small dim">How much parallax the warp gets from depth. MoGe's metric depth mostly sets this itself.</span>
          </label>
          <label className="fx-toggle">
            <input type="checkbox" checked={cam.keep_source_aim !== false} onChange={(e) => onCamera({ keep_source_aim: e.target.checked })} />
            <span>Keep the original aim</span>
            <span className="small dim">Orbit the subject but keep pointing where the original camera pointed, as the training data does (measurably closer).</span>
          </label>
          <label className="fx-toggle">
            <input type="checkbox" checked={!!cam.smooth_depth} onChange={(e) => onCamera({ smooth_depth: e.target.checked })} />
            <span>Smooth the depth</span>
            <span className="small dim">Edge-aware smoothing: fewer speckled holes in the warp.</span>
          </label>
        </div>
      )}
    </div>
  )
}
