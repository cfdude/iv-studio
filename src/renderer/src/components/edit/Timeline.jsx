import { useEffect, useRef, useState } from 'react'
import { FRAME, clipEnd, clipFor, clipKind, clipLength, fits, snap, timecode } from './model'
import { Filmstrip, Wave, usePeaks, useStrip } from './thumbs'
import { reducedMotion } from '../../a11y'

export const HEAD = 176
const RULER = 30
const SNAP_PX = 8
const laneHeight = (t) => (t.kind === 'text' ? 34 : t.kind === 'video' ? 64 : 54)

const Eye = ({ off }) => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M1 8s2.6-4.5 7-4.5S15 8 15 8s-2.6 4.5-7 4.5S1 8 1 8z" fill="none" stroke="currentColor" strokeWidth="1.3" />
    <circle cx="8" cy="8" r="2" fill="currentColor" />
    {off && <path d="M2 14 14 2" stroke="currentColor" strokeWidth="1.5" />}
  </svg>
)
const Lock = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <rect x="3" y="7" width="10" height="7" rx="1" fill="currentColor" />
    <path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" strokeWidth="1.4" />
  </svg>
)

// One track's header: its name (click to make it the target for , and .), and its switches.
function TrackHead({ t, height, target, empty, onTarget, onTrack, onRemove }) {
  const sw = (key, label, title, body) => (
    <button className={`tl-sw ${t[key] ? 'on' : ''} ${key}`} title={title} aria-pressed={!!t[key]} onClick={() => onTrack(t.id, { [key]: !t[key] })}>
      {body || label}
    </button>
  )
  return (
    <div className={`tl-head ${t.kind} ${target ? 'target' : ''} ${t.locked ? 'locked' : ''}`} style={{ height }}>
      <button className="tl-name" title={t.kind === 'text' ? 'Titles' : `Target ${t.id}: , and . put source clips here`} onClick={() => t.kind !== 'text' && onTarget(t)}>
        {t.id}
        {t.label !== t.id && t.kind !== 'text' && <span className="tl-label">{t.label}</span>}
        {t.kind === 'text' && <span className="tl-label">Titles</span>}
      </button>
      <div className="tl-sws">
        {t.kind !== 'audio' && sw('hidden', '', t.hidden ? 'Show this track' : 'Hide this track', <Eye off={t.hidden} />)}
        {sw('locked', '', t.locked ? 'Unlock' : 'Lock: no changes, by you or an agent', <Lock />)}
        {t.kind !== 'text' && sw('muted', 'M', t.kind === 'video' ? 'Mute the sound of this track\'s clips' : 'Mute')}
        {t.kind !== 'text' && sw('solo', 'S', 'Solo: hear only soloed tracks')}
      </div>
      {empty && onRemove && (
        <button className="tl-remove" title={`Remove ${t.id}`} onClick={() => onRemove(t.id)}>
          ×
        </button>
      )}
    </div>
  )
}

// The razor's cut: a red blade sweeps down the clip at the cut, a bright seam flashes and a few sparks fly. Drawn
// straight into the lane (outside React) and gone in under a second; the reduce-motion setting skips it.
function slashAt(lane, x, top, height) {
  if (!lane || reducedMotion()) return
  const fx = document.createElement('span')
  fx.className = 'tl-slash'
  fx.style.left = `${x}px`
  fx.style.top = `${top}px`
  fx.style.height = `${height}px`
  fx.innerHTML = '<b class="tl-slash-arc"></b><b class="tl-slash-seam"></b>' + Array.from({ length: 7 }, (_, i) => {
    const a = (i / 7) * Math.PI * 2 + Math.random() * 0.6
    const d = 14 + Math.random() * 16
    return `<i style="--dx:${(Math.cos(a) * d).toFixed(1)}px;--dy:${(Math.sin(a) * d * 0.7).toFixed(1)}px;animation-delay:${60 + i * 12}ms"></i>`
  }).join('')
  lane.appendChild(fx)
  setTimeout(() => fx.remove(), 900)
}

function Clip({ c, m, kind, zoom, height, selected, tool, locked, onPointerDown, onContextMenu }) {
  // where the razor would cut, under the pointer
  const [guide, setGuide] = useState(null)
  const cutting = tool === 'razor' && !locked
  const strip = useStrip(kind === 'video' ? m : null)
  const wave = usePeaks(kind === 'audio' || kind === 'video' ? m : null)
  const width = Math.max(6, clipLength(c) * zoom)
  const label = kind === 'text' ? c.text?.content || 'Title' : m?.name || 'Missing media'
  const inner = height - 2
  const waveH = kind === 'video' ? 14 : inner - 16
  return (
    <div
      className={`tl-clip ${kind} ${selected ? 'on' : ''} ${c.muted ? 'muted' : ''} ${locked ? 'locked' : ''} tool-${tool}`}
      style={{ left: c.start * zoom, width }}
      onPointerDown={(e) => e.button === 0 && onPointerDown(e, 'move')}
      onPointerMove={cutting ? (e) => setGuide(e.clientX - e.currentTarget.getBoundingClientRect().left) : undefined}
      onPointerLeave={cutting ? () => setGuide(null) : undefined}
      onContextMenu={onContextMenu}
      title={`${label} · ${clipLength(c).toFixed(2)} s`}
    >
      {(kind === 'video' || kind === 'image') && <Filmstrip m={m} strip={strip} from={c.in} to={c.out} width={width} height={kind === 'video' && wave ? inner - waveH : inner} />}
      {wave && (kind === 'audio' || kind === 'video') && (
        <div className={`tl-wave ${kind}`} style={{ height: waveH }}>
          <Wave wave={wave} from={c.in} to={c.out} width={width} height={waveH} color={kind === 'video' ? 'rgba(244, 236, 220, 0.7)' : undefined} />
        </div>
      )}
      {c.fadeIn > 0 && <span className="tl-fade in" style={{ width: c.fadeIn * zoom }} />}
      {c.fadeOut > 0 && <span className="tl-fade out" style={{ width: c.fadeOut * zoom }} />}
      <span className="tl-clip-name">{label}</span>
      {cutting && guide != null && <span className="tl-cut-guide" style={{ left: guide }} />}
      {!locked && tool !== 'razor' && (
        <>
          <span className="tl-edge left" onPointerDown={(e) => onPointerDown(e, 'left')} />
          <span className="tl-edge right" onPointerDown={(e) => onPointerDown(e, 'right')} />
        </>
      )}
    </div>
  )
}

// A generation on its way (edit.gens): a striped box where the new clip will land, with how far it has got.
const GEN_WORD = { extend: 'Extend', bridge: 'Bridge', retake: 'Retake' }
function GenBox({ g, zoom, height, onClick }) {
  const state =
    g.status === 'pick'
      ? 'Pick a take ›'
      : g.status === 'error'
        ? 'Failed: click for details'
        : g.progress?.max
          ? `${g.status === 'finishing' ? 'Finishing' : 'Rendering'} · step ${g.progress.value}/${g.progress.max}`
          : g.queuePosition
            ? `Waiting · #${g.queuePosition}`
            : g.status === 'finishing'
              ? 'Finishing…'
              : 'Rendering…'
  const pct = g.progress?.max ? (g.progress.value / g.progress.max) * 100 : 0
  return (
    <button className={`tl-gen ${g.status}`} style={{ left: g.at * zoom, width: Math.max(24, g.length * zoom), height }} onPointerDown={(e) => e.stopPropagation()} onClick={onClick} title={`${g.name} · ${state}`}>
      <span className="tl-gen-name">{g.gap ? 'Fill' : GEN_WORD[g.kind]}</span>
      <span className="tl-gen-state mono">{state}</span>
      {g.progress?.max && <span className="tl-gen-bar" style={{ width: `${pct}%` }} />}
    </button>
  )
}

// The timeline: ruler with markers, track headers, clips with filmstrips and waveforms, and the playhead.
// Tools: select (move across tracks of its kind, trim an edge), razor (click to cut), ripple trim (the
// rest of the track follows) and rolling edit (moves the cut between two touching clips). Changes are
// committed on release.
export default function Timeline({ tracks, clips, media, markers, time, zoom, selected, selectedMarker, snapOn, tool, targets, length, height, onSeek, onSelect, onSelectMarker, onCommit, onMarkers, onTrack, onTarget, onRemoveTrack, onWidth, notify, gens = [], onMenu, onGen }) {
  const box = useRef(null)
  const [drag, setDrag] = useState(null) // { clips } while dragging
  const dragRef = useRef(null)
  const [mkDrag, setMkDrag] = useState(null) // { id, t } while a marker is dragged
  const live = drag?.clips || clips
  const width = Math.max(length + 10, 30) * zoom
  const locked = (id) => !!tracks.find((t) => t.id === id)?.locked

  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => onWidth?.(el.clientWidth - HEAD))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // keep the playhead in view while playing
  useEffect(() => {
    const el = box.current
    if (!el) return
    const x = time * zoom
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - HEAD - 40) el.scrollLeft = Math.max(0, x - 80)
  }, [Math.floor((time * zoom) / 200)])

  const points = (except) => [0, time, ...markers.map((m) => m.t), ...clips.filter((c) => !except.includes(c.id)).flatMap((c) => [c.start, clipEnd(c)])]
  const secondsAt = (clientX) => (clientX - box.current.getBoundingClientRect().left + box.current.scrollLeft - HEAD) / zoom
  const trackAt = (clientY) => {
    let y = clientY - box.current.getBoundingClientRect().top + box.current.scrollTop - RULER
    for (const t of tracks) {
      y -= laneHeight(t)
      if (y < 0) return t.id
    }
    return null
  }

  function startDrag(e, c, mode) {
    e.stopPropagation()
    e.preventDefault()
    if (locked(c.track)) {
      onSelect(c.id)
      return notify(`${c.track} is locked. Unlock it in its header to change it.`)
    }
    if (tool === 'razor') {
      const at = snapOn ? snap(secondsAt(e.clientX), [time, ...markers.map((m) => m.t)], SNAP_PX / zoom) : secondsAt(e.clientX)
      const t = Math.round(at / FRAME) * FRAME
      if (t > c.start + FRAME && t < clipEnd(c) - FRAME) {
        const at2 = c.in + (t - c.start)
        const el = e.currentTarget
        slashAt(el?.closest?.('.tl-lane'), t * zoom, el?.offsetTop ?? 4, el?.offsetHeight ?? 40)
        onCommit(clips.flatMap((x) => (x.id === c.id ? [{ ...c, out: at2, fadeOut: 0 }, { ...c, id: Math.random().toString(36).slice(2, 9), start: t, in: at2, fadeIn: 0 }] : [x])))
      }
      return
    }
    onSelect(c.id)
    const maxOut = (x) => (media[x.media]?.kind === 'video' || media[x.media]?.kind === 'audio' ? media[x.media].duration : Infinity)
    const same = clips.filter((x) => x.track === c.track && x.id !== c.id)
    const next = same.find((x) => Math.abs(x.start - clipEnd(c)) < 1e-3)
    const prev = same.find((x) => Math.abs(clipEnd(x) - c.start) < 1e-3)
    const after = same.filter((x) => x.start >= clipEnd(c) - 1e-6)
    const edgeMode = tool === 'ripple' ? 'ripple' : tool === 'roll' ? 'roll' : 'trim'
    const move = (ev) => {
      const dt = (ev.clientX - e.clientX) / zoom
      const tol = snapOn ? SNAP_PX / zoom : 0
      const map = new Map()
      if (mode === 'move') {
        let start = Math.max(0, c.start + dt)
        const s1 = snap(start, points([c.id]), tol)
        const s2 = snap(start + clipLength(c), points([c.id]), tol) - clipLength(c)
        start = Math.abs(s1 - start) <= Math.abs(s2 - start) ? s1 : s2
        const t = trackAt(ev.clientY)
        map.set(c.id, { ...c, start: Math.max(0, start), track: t && fits(clipKind(c, media), t) && !locked(t) ? t : c.track })
      } else if (mode === 'right') {
        const end = snap(clipEnd(c) + dt, points([c.id, next?.id]), tol)
        let d = end - clipEnd(c)
        d = Math.max(d, FRAME * 2 - clipLength(c))
        d = Math.min(d, maxOut(c) - c.out)
        if (edgeMode === 'roll' && next) {
          d = Math.max(d, -next.in)
          d = Math.min(d, clipLength(next) - FRAME * 2)
          map.set(next.id, { ...next, start: next.start + d, in: next.in + d })
        } else if (edgeMode === 'trim' && next) d = Math.min(d, next.start - clipEnd(c))
        if (edgeMode === 'ripple') after.forEach((x) => map.set(x.id, { ...x, start: x.start + d }))
        map.set(c.id, { ...c, out: c.out + d })
      } else {
        const startAt = snap(c.start + dt, points([c.id, prev?.id]), tol)
        let d = startAt - c.start
        d = Math.max(d, -c.in)
        d = Math.min(d, clipLength(c) - FRAME * 2)
        if (edgeMode === 'ripple') {
          map.set(c.id, { ...c, in: c.in + d })
          after.forEach((x) => map.set(x.id, { ...x, start: x.start - d }))
        } else {
          if (edgeMode === 'roll' && prev) {
            d = Math.max(d, FRAME * 2 - clipLength(prev))
            d = Math.min(d, maxOut(prev) - prev.out)
            map.set(prev.id, { ...prev, out: prev.out + d })
          } else d = Math.max(d, -c.start, prev ? clipEnd(prev) - c.start : -Infinity)
          map.set(c.id, { ...c, start: c.start + d, in: c.in + d })
        }
      }
      const preview = clips.map((x) => map.get(x.id) || x)
      dragRef.current = preview
      setDrag({ clips: preview })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      const d = dragRef.current
      dragRef.current = null
      setDrag(null)
      if (d) onCommit(d)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  function scrub(e) {
    const seek = (ev) => onSeek(Math.max(0, secondsAt(ev.clientX)))
    seek(e)
    const up = () => {
      window.removeEventListener('pointermove', seek)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', seek)
    window.addEventListener('pointerup', up)
  }

  function dragMarker(e, mk) {
    e.stopPropagation()
    onSelectMarker(mk.id)
    onSeek(mk.t)
    let moved = null
    const move = (ev) => {
      moved = Math.max(0, snap(secondsAt(ev.clientX), points([]).filter((p) => p !== mk.t), snapOn ? SNAP_PX / zoom : 0))
      setMkDrag({ id: mk.id, t: moved })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setMkDrag(null)
      if (moved != null && Math.abs(moved - mk.t) > 1e-3) onMarkers(markers.map((x) => (x.id === mk.id ? { ...x, t: Math.round(moved * 1000) / 1000 } : x)).sort((a, b) => a.t - b.t))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  function drop(e, track) {
    e.preventDefault()
    const id = e.dataTransfer.getData('application/x-iv-media')
    const m = media[id]
    if (!m) return
    if (!fits(m.kind, track)) return notify(m.kind === 'audio' ? 'Sound goes on an A track.' : 'Pictures and video go on a V track.')
    if (locked(track)) return notify(`${track} is locked.`)
    const range = (() => {
      try {
        return JSON.parse(e.dataTransfer.getData('application/x-iv-range') || 'null')
      } catch {
        return null
      }
    })()
    const start = snapOn ? snap(secondsAt(e.clientX), points([]), SNAP_PX / zoom) : secondsAt(e.clientX)
    const c = { ...clipFor(m, track, Math.max(0, start)), ...(range && { in: range.in, out: range.out }) }
    onCommit([...clips, c])
    onSelect(c.id)
  }

  const step = zoom > 80 ? 1 : zoom > 30 ? 2 : zoom > 12 ? 5 : zoom > 5 ? 10 : 30
  const ticks = Array.from({ length: Math.ceil(width / zoom / step) + 1 }, (_, i) => i * step)

  return (
    <div className="tl" ref={box} style={{ height }}>
      <div className="tl-inner" style={{ width: HEAD + width }}>
        <div className="tl-row tl-ruler-row">
          <div className="tl-corner mono">{timecode(time)}</div>
          <div className="tl-ruler" style={{ width }} onPointerDown={scrub}>
            {ticks.map((s) => (
              <span key={s} className="tl-tick" style={{ left: s * zoom }}>
                {timecode(s).slice(0, 5)}
              </span>
            ))}
            {markers.map((mk) => (
              <span
                key={mk.id}
                className={`tl-marker ${selectedMarker === mk.id ? 'on' : ''}`}
                style={{ left: (mkDrag?.id === mk.id ? mkDrag.t : mk.t) * zoom, '--mk': mk.color || 'var(--gold, #e8b44c)' }}
                title={`${mk.label || 'Marker'} · ${timecode(mk.t)}`}
                onPointerDown={(e) => dragMarker(e, mk)}
              >
                {mk.label && <span className="tl-marker-label">{mk.label}</span>}
              </span>
            ))}
          </div>
        </div>
        {tracks.map((t) => {
          const h = laneHeight(t)
          const empty = !clips.some((c) => c.track === t.id)
          return (
            <div key={t.id} className={`tl-row ${t.hidden ? 'hidden' : ''}`} style={{ height: h }}>
              <TrackHead
                t={t}
                height={h}
                target={targets[t.kind] === t.id}
                empty={empty && !['V1', 'A1', 'T1'].includes(t.id)}
                onTarget={onTarget}
                onTrack={onTrack}
                onRemove={onRemoveTrack}
              />
              <div
                className={`tl-lane ${t.kind} ${t.locked ? 'locked' : ''}`}
                style={{ width }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => drop(e, t.id)}
                onPointerDown={(e) => {
                  if (e.target === e.currentTarget && e.button === 0) {
                    onSelect(null)
                    scrub(e)
                  }
                }}
                onContextMenu={(e) => {
                  if (e.target !== e.currentTarget || !onMenu) return
                  e.preventDefault()
                  // empty space: the gap it sits in, between the clip before and the clip after
                  const at = secondsAt(e.clientX)
                  const on = clips.filter((c) => c.track === t.id)
                  const before = on.filter((c) => clipEnd(c) <= at).sort((a, b) => clipEnd(b) - clipEnd(a))[0]
                  const after = on.filter((c) => c.start >= at).sort((a, b) => a.start - b.start)[0]
                  onMenu(e, { track: t, at, gap: before && { track: t.id, from: clipEnd(before), to: after ? after.start : null } })
                }}
              >
                {live
                  .filter((c) => c.track === t.id)
                  .map((c) => (
                    <Clip
                      key={c.id}
                      c={c}
                      m={media[c.media]}
                      kind={clipKind(c, media)}
                      zoom={zoom}
                      height={h - 8}
                      selected={selected === c.id}
                      tool={tool}
                      locked={t.locked}
                      onPointerDown={(e, mode) => startDrag(e, c, mode)}
                      onContextMenu={(e) => {
                        if (!onMenu) return
                        e.preventDefault()
                        onSelect(c.id)
                        onMenu(e, { track: t, at: secondsAt(e.clientX), clip: c })
                      }}
                    />
                  ))}
                {gens
                  .filter((g) => g.track === t.id && ['rendering', 'pick', 'finishing', 'error'].includes(g.status))
                  .map((g) => (
                    <GenBox key={g.id} g={g} zoom={zoom} height={h - 8} onClick={() => onGen?.(g)} />
                  ))}
              </div>
            </div>
          )
        })}
        <div className="tl-playhead" style={{ left: HEAD + time * zoom }} />
      </div>
    </div>
  )
}
