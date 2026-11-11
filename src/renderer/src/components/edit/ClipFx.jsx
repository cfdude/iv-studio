import { useEffect, useMemo, useState } from 'react'
import { CameraRig } from './CameraRig'

// Edit → right-click a clip → Effects…: Freefield's video apps on the clip's own stretch (freefield.js). Pick an
// effect, set what it asks for (drawn from the app's own inputs), and run it; the result takes the clip's place.
const VIDEO_FX = ['dub', 'cleanplate', 'night', 'water', 'hdr', 'removebg', 'smooth']
const ICON = {
  reshoot: 'M5 22l7-7 4 4 9-9M19 10h6v6M4 26h24',
  dub: 'M9 13a3 3 0 016 0v4a3 3 0 01-6 0zM6 17a6 6 0 0012 0M12 23v3M19 9c2 1 3 3 3 6s-1 5-3 6M23 6c3 2 5 5 5 9s-2 7-5 9',
  cleanplate: 'M4 24h24M8 24V12l8-6 8 6v12M13 24v-6h6v6',
  night: 'M20 4a10 10 0 100 24 12 12 0 010-24z',
  water: 'M16 4c4 6 8 10 8 15a8 8 0 01-16 0c0-5 4-9 8-15z',
  hdr: 'M4 8h24v16H4zM9 13v6M13 13v6M9 16h4M17 13h3a3 3 0 010 6h-3zM24 13v6',
  removebg: 'M5 5h22v22H5zM16 9a4 4 0 110 8 4 4 0 010-8zM9 27c0-4 3-7 7-7s7 3 7 7',
  smooth: 'M4 16h6M13 16h6M22 16h6M4 10c4-4 8-4 12 0s8 4 12 0M4 22c4 4 8 4 12 0s8-4 12 0'
}

function Field({ input, value, onChange }) {
  const label = input.label || input.id
  if (input.type === 'slider')
    return (
      <label className="create-field">
        <span className="create-label mono">{label}</span>
        <div className="fx-slider">
          <input type="range" min={input.min} max={input.max} step={input.step || (input.max - input.min > 10 ? 1 : 0.05)} value={value} onChange={(e) => onChange(Number(e.target.value))} />
          <span className="mono">{value}</span>
        </div>
        {input.help && <span className="small dim">{input.help}</span>}
      </label>
    )
  if (input.type === 'select') {
    const opts = input.options || []
    return (
      <div className="create-field">
        <span className="create-label mono">{label}</span>
        {opts.length <= 6 ? (
          <div className="segmented wrap">
            {opts.map((o) => (
              <button key={String(o.value)} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
                {o.label || String(o.value)}
              </button>
            ))}
          </div>
        ) : (
          <select value={String(value)} onChange={(e) => onChange(opts.find((o) => String(o.value) === e.target.value)?.value)}>
            {opts.map((o) => (
              <option key={String(o.value)} value={String(o.value)}>
                {o.label || String(o.value)}
              </option>
            ))}
          </select>
        )}
        {input.help && <span className="small dim">{input.help}</span>}
      </div>
    )
  }
  if (input.type === 'toggle')
    return (
      <label className="create-field fx-toggle">
        <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
        <span>{label}</span>
        {input.help && <span className="small dim">{input.help}</span>}
      </label>
    )
  return (
    <label className="create-field">
      <span className="create-label mono">{label}</span>
      <textarea rows={input.id === 'negative' ? 2 : 3} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
      {input.help && <span className="small dim">{input.help}</span>}
    </label>
  )
}

export { Field }
export function ClipFxDialog({ clipName, length, clip = null, onRun, onClose }) {
  const [metas, setMetas] = useState(null)
  const [status, setStatus] = useState({})
  const [fx, setFx] = useState(null)
  const [values, setValues] = useState({})
  const [camera, setCamera] = useState({})
  const [size, setSize] = useState(null)
  useEffect(() => {
    window.ivstudio.clipfx.meta().then((all) => setMetas(all.filter((m) => VIDEO_FX.includes(m.fx))))
    window.ivstudio.clipfx.status().then(setStatus, () => {})
    const esc = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [])
  const meta = metas?.find((m) => m.fx === fx)
  const fields = useMemo(() => (meta?.inputs || []).filter((i) => !['video', 'image', 'seed'].includes(i.type)), [meta])
  function pick(id) {
    const m = metas.find((x) => x.fx === id)
    setFx(id)
    setCamera({})
    setSize(m.size?.default ?? null)
    setValues(Object.fromEntries((m.inputs || []).filter((i) => i.default !== undefined && !['video', 'image'].includes(i.type)).map((i) => [i.id, i.default])))
  }
  const st = fx && status[fx]
  const why = (s) => (!s ? 'Checking…' : s.ready ? null : s.missingNodes?.length ? 'Needs node packs: Setup → Install missing node packs' : s.missingModels?.length ? `Needs ${s.missingModels.length} model${s.missingModels.length > 1 ? 's' : ''}: Setup` : s.error || 'Not set up')
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal clipfx${fx === 'reshoot' ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="clipfx-title">
        <div className="modal-head">
          <h2 id="clipfx-title">{meta ? meta.label : 'Effects'}</h2>
          <span className="small dim">
            {clipName} · {length.toFixed(1)} s
          </span>
          <span className="spacer" />
          <button className="lora-chip-x" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        {!meta ? (
          <div className="mode-cards fx-cards">
            {(metas || []).map((m) => {
              const w = why(status[m.fx])
              return (
                <button key={m.fx} className="mode-card" onClick={() => pick(m.fx)} title={w || m.what}>
                  <svg className="mode-icon" viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">
                    <path d={ICON[m.fx]} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span className="mode-name">{m.label}</span>
                  <span className="dim small">{m.what}</span>
                  {w && <span className="mono small pink">{w}</span>}
                </button>
              )
            })}
            {!metas && <span className="dim small">Loading…</span>}
          </div>
        ) : (
          <div className={fx === 'reshoot' ? 'fx-split' : undefined}>
            {fx === 'reshoot' && (
              <CameraRig values={values} camera={camera} defaults={meta.camera} clip={clip} previewStatus={st?.preview} onValues={(v) => setValues((s) => ({ ...s, ...v }))} onCamera={(c) => setCamera((s) => ({ ...s, ...c }))} size={size} sizeChoices={meta.size?.choices} onSize={setSize} />
            )}
            <div className="fx-form">
              <p className="small dim">{meta.summary}</p>
              {fields.map((input) => (
                <Field key={input.id} input={input} value={values[input.id]} onChange={(v) => setValues((s) => ({ ...s, [input.id]: v }))} />
              ))}
              {st && !st.ready && <p className="small pink">{why(st)}{st.missingModels?.length ? ` (${st.missingModels.join(', ')})` : ''}.</p>}
            </div>
          </div>
        )}
        <div className="modal-foot">
          {meta && (
            <button className="link-btn small" onClick={() => setFx(null)}>
              ← All effects
            </button>
          )}
          <span className="spacer" />
          <button className="btn btn-small" onClick={onClose}>
            Cancel
          </button>
          {meta && (
            <button className="btn btn-small btn-primary" disabled={!st?.ready} onClick={() => (onRun({ fx, values, camera, size, label: meta.label }), onClose())}>
              {meta.label}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
