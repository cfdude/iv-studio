import { useEffect, useMemo, useState } from 'react'
import { fileUrl } from './edit/model'
import { DropIcon } from './CreateKit'

// Where a character comes from: a LoRA (Loras.jsx's picker) or a RefMod (below), and making a RefMod from
// pictures (refmods.js). RefMods are files in ComfyUI's models/refmods, named by the loader as "folder/name".

const LINE = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }
export const LoraIcon = () => (
  <svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true">
    <g {...LINE}>
      <circle cx="16" cy="16" r="10" />
      <circle cx="16" cy="16" r="4.5" />
      <path d="M16 6v5.5M16 20.5V26M6 16h5.5M20.5 16H26" />
    </g>
  </svg>
)
export const RefModIcon = () => (
  <svg viewBox="0 0 32 32" width="30" height="30" aria-hidden="true">
    <g {...LINE}>
      <circle cx="16" cy="12" r="5" />
      <path d="M7 27c1.2-5 4.8-7.5 9-7.5s7.8 2.5 9 7.5" />
      <path d="M24 5l1 2.5 2.5 1-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1z" />
    </g>
  </svg>
)

function useEsc(onClose, off = false) {
  useEffect(() => {
    if (off) return
    const esc = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [off])
}

// "Add from a LoRA or RefMod": the two ways in, as cards.
export function SourceChooser({ onLora, onRefMod, onClose }) {
  useEsc(onClose)
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal source-chooser" role="dialog" aria-label="Add a character">
        <div className="source-head">
          <h2>Add a character</h2>
          <button className="link-btn mono" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <p className="dim small">From a file you already have in ComfyUI.</p>
        <div className="source-cards">
          <button className="source-card" onClick={onLora}>
            <span className="source-icon">
              <LoraIcon />
            </span>
            <span className="source-name">From a LoRA</span>
            <span className="dim small">A character LoRA trained for H3. The strongest likeness; it needs its trigger word.</span>
          </button>
          <button className="source-card" onClick={onRefMod}>
            <span className="source-icon">
              <RefModIcon />
            </span>
            <span className="source-name">From a RefMod</span>
            <span className="dim small">A RefMod made from pictures (and a voice). Quick to make, no training; works in Create shots.</span>
          </button>
        </div>
      </div>
    </div>
  )
}

export const pretty = (name) =>
  name
    .split('/')
    .pop()
    .replace(/_[0-9a-f]{6}$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())

// Every RefMod in ComfyUI, grouped by folder, with a search.
export function RefModPicker({ onPick, onClose, current = null }) {
  const [names, setNames] = useState(null)
  const [q, setQ] = useState('')
  useEsc(onClose)
  useEffect(() => {
    window.ivstudio.refmods.list().then(setNames, () => setNames([]))
  }, [])
  const groups = useMemo(() => {
    const s = q.trim().toLowerCase()
    const out = new Map()
    for (const n of names || []) {
      if (s && !n.toLowerCase().includes(s)) continue
      const folder = n.includes('/') ? n.split('/').slice(0, -1).join('/') : 'refmods'
      if (!out.has(folder)) out.set(folder, [])
      out.get(folder).push(n)
    }
    return [...out.entries()].sort(([a], [b]) => (a === 'characters' ? -1 : b === 'characters' ? 1 : a.localeCompare(b)))
  }, [names, q])
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal refmod-picker" role="dialog" aria-label="Choose a RefMod">
        <div className="source-head">
          <h2>Choose a RefMod</h2>
          <button className="link-btn mono" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <input className="list-search" type="search" value={q} placeholder="Search your RefMods" onChange={(e) => setQ(e.target.value)} autoFocus aria-label="Search your RefMods" />
        <div className="refmod-list">
          {names === null && <p className="dim small">Reading ComfyUI's refmods folder…</p>}
          {names?.length === 0 && <p className="dim small">ComfyUI has no RefMods yet. Make one under Train your own → Make a RefMod.</p>}
          {groups.map(([folder, list]) => (
            <div key={folder} className="refmod-group">
              <span className="refmod-folder mono">{folder}</span>
              {list.map((n) => (
                <button key={n} className={`refmod-row ${current === n ? 'on' : ''}`} onClick={() => onPick({ name: n, title: pretty(n) })}>
                  <RefModIcon />
                  <span className="refmod-title">{pretty(n)}</span>
                  <span className="mono small dim">{n}</span>
                </button>
              ))}
            </div>
          ))}
          {names?.length > 0 && groups.length === 0 && <p className="dim small">No RefMods match “{q}”.</p>}
        </div>
      </div>
    </div>
  )
}

// Make a RefMod: pictures (and a voice clip) become a RefMod character in seconds, on this PC.
export function RefModMaker({ notify, onMade, onCancel }) {
  const [name, setName] = useState('')
  const [who, setWho] = useState('')
  const [pictures, setPictures] = useState([])
  const [voice, setVoice] = useState(null)
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(null)
  const [can, setCan] = useState(null)
  const [over, setOver] = useState(false)
  useEffect(() => {
    window.ivstudio.refmods.ready().then(setCan, (err) => setCan({ ready: false, why: err.message }))
    return window.ivstudio.refmods.onStatus((s) => setBusy(s))
  }, [])
  const addPictures = (paths) => setPictures((p) => [...p, ...paths.filter((x) => /\.(png|jpe?g|webp|bmp)$/i.test(x))].slice(0, 6))
  function drop(e) {
    e.preventDefault()
    setOver(false)
    addPictures([...(e.dataTransfer?.files || [])].map((f) => window.ivstudio.media.pathFor(f)).filter(Boolean))
  }
  async function make() {
    setBusy('Starting')
    try {
      const r = await window.ivstudio.refmods.make({ name, who, pictures, audio: voice, consent })
      notify(`${r.character.name} is ready as a RefMod character (made in ${r.seconds} s). Pick them in Create.`, 'info')
      onMade(r.character)
    } catch (err) {
      notify(err.message)
    } finally {
      setBusy(null)
    }
  }
  return (
    <div className="refmod-maker">
      {can && !can.ready && <p className="notice">{can.why}</p>}
      <div className="create-grid">
        <label className="create-field">
          <span className="create-label mono">Name</span>
          <input value={name} placeholder="e.g. Maya Ortiz" onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="create-field">
          <span className="create-label mono">
            Who they are <span className="dim">· a few words</span>
          </span>
          <input value={who} placeholder="a woman in her thirties" onChange={(e) => setWho(e.target.value)} />
        </label>
      </div>
      <div className="create-field">
        <span className="create-label mono">
          Pictures <span className="dim">· 1 to 6, clear and well lit; more angles hold the likeness better</span>
        </span>
        <div className={`refmod-pics create-drop ${over ? 'drag-over' : ''}`} onDragOver={(e) => (e.preventDefault(), setOver(true))} onDragLeave={() => setOver(false)} onDrop={drop}>
          {pictures.map((p, i) => (
            <div key={p + i} className="refmod-pic">
              <img src={fileUrl(p)} alt="" />
              {i === 0 && <span className="refmod-pic-tag mono">Face</span>}
              <button className="lora-chip-x" title="Take it out" onClick={() => setPictures(pictures.filter((_, j) => j !== i))}>
                ×
              </button>
            </div>
          ))}
          {pictures.length < 6 && (
            <button className="refmod-pic add" onClick={async () => addPictures(await window.ivstudio.files.pick('picture'))}>
              <DropIcon />
              <span>+ Pictures</span>
              <span className="small dim">or drop them here</span>
            </button>
          )}
        </div>
      </div>
      <div className="create-field">
        <span className="create-label mono">
          Voice <span className="dim">· optional, up to 15 seconds of them talking</span>
        </span>
        <div className="refmod-voice">
          {voice ? (
            <>
              <span className="mono small">{voice.split(/[\\/]/).pop()}</span>
              <button className="link-btn mono" onClick={() => setVoice(null)}>
                Remove
              </button>
            </>
          ) : (
            <button className="btn btn-small" onClick={async () => setVoice((await window.ivstudio.files.pick('audio'))[0] || null)}>
              + Voice clip
            </button>
          )}
        </div>
      </div>
      <label className="consent small">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        These are pictures of me, of an invented person, or of someone who agreed to be made into a character.
      </label>
      <div className="composer-foot">
        <span className="dim small">Runs on this computer: about 15 seconds a picture, free.</span>
        {onCancel && (
          <button className="link-btn mono" onClick={onCancel} disabled={!!busy}>
            Cancel
          </button>
        )}
        <button className="btn btn-primary" disabled={!!busy || !can?.ready || !name.trim() || !pictures.length || !consent} onClick={make}>
          {busy ? `${busy}…` : 'Make the RefMod'}
        </button>
      </div>
    </div>
  )
}

export { pretty as refmodTitle }
