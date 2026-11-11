import { useEffect, useRef, useState } from 'react'
import { fileUrl } from './edit/model'

// A reference as a card: what it is at a glance (picture, a video's first frame, a sound's length),
// with what was done to it. Clicking it opens the editor.
// item: { kind: 'picture'|'video'|'audio', path, source?, edit?: {crop, start, end}, info? }
export function MediaTile({ item, label, onEdit, onRemove, extra = null }) {
  const len = item.info?.duration
  const notes = [item.edit?.crop && 'cropped', item.edit && (item.edit.start != null || item.edit.end != null) && 'trimmed'].filter(Boolean)
  return (
    <div className={`media-tile ${item.kind}`}>
      <button className="media-thumb" onClick={onEdit} title={`Edit ${base(item.source || item.path)}`}>
        {item.kind === 'picture' && <img src={fileUrl(item.path)} alt="" />}
        {item.kind === 'video' && <video src={`${fileUrl(item.path)}#t=0.1`} muted preload="metadata" />}
        {item.kind === 'audio' && <span className="media-wave">♪</span>}
        <span className="media-edit mono">{item.kind === 'picture' ? 'Crop' : 'Trim'}</span>
      </button>
      <div className="media-meta">
        <span className="mono pink">{label}</span>
        <span className="media-name" title={item.source || item.path}>
          {base(item.source || item.path)}
        </span>
        <span className="mono dim small">{[len && `${len.toFixed(2)} s`, item.info?.width && `${item.info.width}×${item.info.height}`, ...notes].filter(Boolean).join(' · ')}</span>
        {extra}
      </div>
      <button className="media-remove" onClick={onRemove} title="Remove">
        ×
      </button>
    </div>
  )
}

const base = (p) => String(p).split(/[\\/]/).pop()
const RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9']
const ratio = (a) => (a ? a.split(':').reduce((w, h) => w / h) : null)
const GRID = Array.from({ length: 22 }, (_, n) => 17 * n + 5) // H3 frame counts at 24 fps
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

// The biggest box of aspect r centred in w x h.
function fitBox(w, h, r) {
  if (!r) return { x: 0, y: 0, w, h }
  const bw = Math.min(w, h * r)
  const bh = bw / r
  return { x: (w - bw) / 2, y: (h - bh) / 2, w: bw, h: bh }
}

// H3's own sizes: about mp megapixels, both sides on a 32-pixel grid (as src/service/media.js h3Size).
const h3Size = (w, h, mp) => {
  const s = Math.sqrt((mp * 1024 * 1024) / (w * h))
  const grid = (x) => Math.max(256, Math.round((x * s) / 32) * 32)
  return { w: grid(w), h: grid(h) }
}
const FITS = [0.5, 1, 2]

// Crop, trim, resize, or all three, on a copy of the reference. shotAspect is the render's aspect (e.g. "16:9").
export function MediaEditor({ item, shotAspect, hint, onApply, onClose, notify }) {
  const source = item.source || item.path
  const [info, setInfo] = useState(null)
  const [crop, setCrop] = useState(item.edit?.crop || null)
  const [lock, setLock] = useState(null) // aspect string or null (free)
  const [range, setRange] = useState(null) // [start, end]
  const [fit, setFit] = useState(item.edit?.fitH3 || null) // megapixels to resize to H3's sizes, or null
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [snap, setSnap] = useState(false)
  const [busy, setBusy] = useState(false)
  const [peaks, setPeaks] = useState(null)
  const stage = useRef(null)
  const el = useRef(null)
  const [box, setBox] = useState(null) // displayed size of the picture/video

  useEffect(() => {
    window.ivstudio.media.probe(source).then((i) => {
      setInfo(i)
      if (i.duration) setRange([item.edit?.start ?? 0, item.edit?.end ?? i.duration])
    }, (err) => notify(err.message))
  }, [source])

  // A sound's (or a video's) waveform, for trimming by ear and eye.
  useEffect(() => {
    if (!info || item.kind === 'picture' || !(item.kind === 'audio' || info.hasAudio) || info.duration > 180) return
    let live = true
    fetch(fileUrl(source))
      .then((r) => r.arrayBuffer())
      .then((buf) => new AudioContext().decodeAudioData(buf))
      .then((audio) => {
        const data = audio.getChannelData(0)
        const n = 400
        const step = Math.floor(data.length / n)
        const out = Array.from({ length: n }, (_, k) => {
          let m = 0
          for (let j = k * step; j < (k + 1) * step; j += 8) m = Math.max(m, Math.abs(data[j]))
          return m
        })
        if (live) setPeaks(out)
      })
      .catch(() => {})
    return () => (live = false)
  }, [info])

  // Fit the picture/video in the stage and remember its displayed size.
  const measure = () => {
    if (!info?.width || !stage.current) return
    const sw = stage.current.clientWidth
    const sh = stage.current.clientHeight
    const s = Math.min(sw / info.width, sh / info.height, 1)
    setBox({ w: info.width * s, h: info.height * s, s })
  }
  useEffect(() => {
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [info])

  // Playback stays inside the trimmed part and loops.
  useEffect(() => {
    const m = el.current
    if (!m || !range) return
    let raf
    const tick = () => {
      if (m.currentTime >= range[1] - 0.02 || m.currentTime < range[0] - 0.05) m.currentTime = range[0]
      setTime(m.currentTime)
      raf = requestAnimationFrame(tick)
    }
    if (playing) {
      if (m.currentTime < range[0] || m.currentTime >= range[1]) m.currentTime = range[0]
      m.play().catch(() => setPlaying(false))
      raf = requestAnimationFrame(tick)
    } else m.pause()
    return () => cancelAnimationFrame(raf)
  }, [playing, range])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
      else if (e.code === 'Space' && range && !/input|textarea/i.test(e.target.tagName)) {
        e.preventDefault()
        setPlaying((p) => !p)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  function pickRatio(a) {
    setLock(a)
    setCrop(fitBox(info.width, info.height, ratio(a)))
  }

  // Dragging the crop box (mode 'move') or one of its corners ('nw', 'ne', 'sw', 'se').
  function dragCrop(e, mode) {
    e.preventDefault()
    e.stopPropagation()
    const start = { x: e.clientX, y: e.clientY, c: { ...crop } }
    const r = ratio(lock)
    const move = (ev) => {
      const dx = (ev.clientX - start.x) / box.s
      const dy = (ev.clientY - start.y) / box.s
      const c = start.c
      if (mode === 'move') return setCrop({ ...c, x: clamp(c.x + dx, 0, info.width - c.w), y: clamp(c.y + dy, 0, info.height - c.h) })
      const left = mode.includes('w')
      const top = mode.includes('n')
      let w = clamp(c.w + (left ? -dx : dx), 32, left ? c.x + c.w : info.width - c.x)
      let h = clamp(c.h + (top ? -dy : dy), 32, top ? c.y + c.h : info.height - c.y)
      if (r) {
        if (w / h > r) w = h * r
        else h = w / r
      }
      setCrop({ x: left ? c.x + c.w - w : c.x, y: top ? c.y + c.h - h : c.y, w, h })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // Dragging an end of the trim bar, or clicking the bar to seek.
  const bar = useRef(null)
  const at = (clientX) => {
    const r = bar.current.getBoundingClientRect()
    return clamp((clientX - r.left) / r.width, 0, 1) * info.duration
  }
  function snapEnd([s, e], on = snap) {
    if (!on) return [s, e]
    const frames = Math.round((e - s) * 24)
    const fit = [...GRID].reverse().find((g) => g <= frames) || GRID[0]
    return [s, Math.min(info.duration, s + fit / 24)]
  }
  function dragTrim(e, which) {
    e.preventDefault()
    e.stopPropagation()
    setPlaying(false)
    const move = (ev) => {
      const t = at(ev.clientX)
      setRange((r) => snapEnd(which === 0 ? [Math.min(t, r[1] - 0.1), r[1]] : [r[0], Math.max(t, r[0] + 0.1)]))
      if (el.current) el.current.currentTime = t
      setTime(t)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  function seek(e) {
    const t = clamp(at(e.clientX), range[0], range[1])
    if (el.current) el.current.currentTime = t
    setTime(t)
  }
  const setPoint = (which) => setRange((r) => snapEnd(which === 0 ? [Math.min(time, r[1] - 0.1), r[1]] : [r[0], Math.max(time, r[0] + 0.1)]))

  async function apply() {
    const full = !range || (range[0] < 0.01 && range[1] > info.duration - 0.01)
    const whole = !crop || (crop.x < 1 && crop.y < 1 && crop.w > info.width - 1 && crop.h > info.height - 1)
    if (full && whole && !fit) return onApply({ kind: item.kind, path: source, info })
    setBusy(true)
    try {
      const edit = { crop: whole ? null : crop, start: full ? null : range[0], end: full ? null : range[1], fitH3: fit }
      const res = await window.ivstudio.media.prepare({ file: source, ...edit })
      onApply({ kind: item.kind, path: res.path, source, edit, info: res })
    } catch (err) {
      notify(err.message)
      setBusy(false)
    }
  }

  if (!info) return null
  const len = range ? range[1] - range[0] : 0
  const pct = (t) => `${(t / info.duration) * 100}%`
  const visual = item.kind !== 'audio'
  const shotRatio = shotAspect && RATIOS.includes(shotAspect) ? shotAspect : null

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal media-editor">
        <div className="modal-head">
          <h2>{item.kind === 'picture' ? 'Crop and resize picture' : item.kind === 'video' ? 'Trim, crop and resize video' : 'Trim sound'}</h2>
          <span className="mono dim small">
            {[base(source), info.width && `${info.width}×${info.height}`, info.duration && `${info.duration.toFixed(2)} s`, info.fps && `${info.fps} fps`].filter(Boolean).join(' · ')}
          </span>
        </div>
        {hint && <p className="small dim">{hint}</p>}

        {visual && (
          <div className="me-stage" ref={stage}>
            {box && (
              <div className="me-frame" style={{ width: box.w, height: box.h }}>
                {item.kind === 'picture' ? (
                  <img src={fileUrl(source)} alt="" draggable={false} />
                ) : (
                  <video ref={el} src={fileUrl(source)} preload="auto" onLoadedMetadata={(e) => (e.target.currentTime = range?.[0] || 0)} onClick={() => setPlaying((p) => !p)} />
                )}
                {crop && (
                  <div className="me-crop" style={{ left: crop.x * box.s, top: crop.y * box.s, width: crop.w * box.s, height: crop.h * box.s }} onPointerDown={(e) => dragCrop(e, 'move')}>
                    {['nw', 'ne', 'sw', 'se'].map((h) => (
                      <span key={h} className={`me-handle ${h}`} onPointerDown={(e) => dragCrop(e, h)} />
                    ))}
                    <span className="me-crop-size mono">
                      {Math.round(crop.w)}×{Math.round(crop.h)}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {visual && (
          <div className="me-ratios">
            <span className="row-label">Crop</span>
            <div className="segmented">
              <button className={!crop ? 'on' : ''} onClick={() => (setCrop(null), setLock(null))}>
                None
              </button>
              <button className={crop && !lock ? 'on' : ''} onClick={() => (setLock(null), setCrop(crop || { x: info.width * 0.1, y: info.height * 0.1, w: info.width * 0.8, h: info.height * 0.8 }))}>
                Free
              </button>
              {shotRatio && (
                <button className={crop && lock === shotRatio ? 'on shot' : ''} onClick={() => pickRatio(shotRatio)} title="The aspect of the shot you're rendering">
                  Shot {shotRatio}
                </button>
              )}
              {RATIOS.filter((r) => r !== shotRatio).map((r) => (
                <button key={r} className={crop && lock === r ? 'on' : ''} onClick={() => pickRatio(r)}>
                  {r}
                </button>
              ))}
            </div>
          </div>
        )}

        {visual && info.width && (
          <div className="me-ratios">
            <span className="row-label">Size</span>
            <div className="segmented">
              <button className={!fit ? 'on' : ''} onClick={() => setFit(null)}>
                As is
              </button>
              {FITS.map((mp) => (
                <button key={mp} className={fit === mp ? 'on' : ''} onClick={() => setFit(mp)} title="Resized so H3 can use it: about this many megapixels, both sides on its 32-pixel grid">
                  Fit for H3 · {mp} MP
                </button>
              ))}
            </div>
            <span className="mono small dim">
              {(() => {
                const w = crop ? Math.round(crop.w) : info.width
                const h = crop ? Math.round(crop.h) : info.height
                if (!fit) return `${w}×${h}${w % 32 || h % 32 ? ' · not on H3’s 32-pixel grid' : ''}`
                const t = h3Size(w, h, fit)
                return `${w}×${h} → ${t.w}×${t.h}${item.kind === 'video' ? ' · 24 fps' : ''}`
              })()}
            </span>
          </div>
        )}

        {range && (
          <div className="me-trim">
            {item.kind === 'audio' && <audio ref={el} src={fileUrl(source)} preload="auto" />}
            <div className="me-bar" ref={bar} onPointerDown={seek}>
              {peaks && (
                <div className="me-peaks">
                  {peaks.map((p, k) => (
                    <span key={k} style={{ height: `${Math.max(2, p * 100)}%` }} />
                  ))}
                </div>
              )}
              <div className="me-out" style={{ left: 0, width: pct(range[0]) }} />
              <div className="me-out" style={{ left: pct(range[1]), right: 0 }} />
              <div className="me-range" style={{ left: pct(range[0]), width: pct(len) }}>
                <span className="me-grip in" onPointerDown={(e) => dragTrim(e, 0)} />
                <span className="me-grip out" onPointerDown={(e) => dragTrim(e, 1)} />
              </div>
              <div className="me-playhead" style={{ left: pct(time) }} />
            </div>
            <div className="me-trim-row">
              <button className="btn btn-small" onClick={() => setPlaying((p) => !p)}>
                {playing ? 'Pause' : 'Play'}
              </button>
              <button className="link-btn mono" onClick={() => setPoint(0)}>
                Set start here
              </button>
              <button className="link-btn mono" onClick={() => setPoint(1)}>
                Set end here
              </button>
              <span className="mono small">
                {range[0].toFixed(2)} → {range[1].toFixed(2)} s · <span className="pink">{len.toFixed(2)} s</span>
                {item.kind === 'video' && ` · ${Math.round(len * 24)} frames at 24 fps`}
              </span>
              {item.kind === 'video' && (
                <label className="me-snap small">
                  <input type="checkbox" checked={snap} onChange={(e) => (setSnap(e.target.checked), e.target.checked && setRange((r) => snapEnd(r, true)))} /> Snap to H3 lengths
                </label>
              )}
            </div>
          </div>
        )}

        <div className="modal-foot">
          <button
            className="link-btn mono"
            onClick={() => {
              setCrop(null)
              setLock(null)
              setFit(null)
              if (info.duration) setRange([0, info.duration])
            }}
          >
            Reset
          </button>
          <span className="spacer" />
          <button className="btn btn-small" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary btn-small" disabled={busy} onClick={apply}>
            {busy ? 'Preparing…' : 'Apply'}
          </button>
        </div>
      </div>
    </div>
  )
}
