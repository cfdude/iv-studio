import { clipKind, clipLength, timecode } from './model'
import { modChord } from '../../../../shared/platform'
import { usePlatform } from '../../platform'

function Num({ label, value, onChange, step = 0.1, min = 0, max }) {
  return (
    <label className="ed-num">
      <span className="dim small">{label}</span>
      <input type="number" step={step} min={min} max={max} value={Number(value ?? 0).toFixed(2)} onChange={(e) => onChange(Math.max(min, Number(e.target.value) || 0))} />
    </label>
  )
}

const shortcuts = (platform) => [
  ['Space', 'play / pause'],
  ['J K L', 'shuttle back, stop, forward (again: faster)'],
  ['← →', 'one frame (Shift: 1 s)'],
  ['↑ ↓', 'previous / next edit point'],
  ['I O', 'mark In / Out in the source'],
  [', .', 'insert / overwrite from the source'],
  ['V C B N', 'select, razor, ripple trim, rolling edit'],
  [`S, ${modChord(platform, 'K')}`, 'split selected / split every track'],
  ['Q W', 'ripple trim the clip start / end to the playhead'],
  ['Del, Shift+Del', 'delete, ripple delete'],
  ['M, Shift+M', 'add marker, next marker'],
  ['\\  =  −', 'fit, zoom in, zoom out'],
  ['F11, Esc', 'full screen workspace, back'],
  [`${modChord(platform, 'Z')}, ${modChord(platform, 'Y')}`, 'undo, redo']
]

// Effect controls: the selected clip's settings, or (nothing selected) the edit's format, markers and keys.
export default function Inspector({ clip, media, meta, settings, markers, selMarker, onClip, onSettings, onMarkers, onSeek }) {
  const platform = usePlatform()
  if (!clip)
    return (
      <div className="ed-insp">
        <p className="mono label">Edit settings</p>
        <span className="dim small">Format</span>
        <div className="segmented ed-seg">
          {Object.entries(meta.formats).map(([id, f]) => (
            <button key={id} className={settings.format === id ? 'on' : ''} onClick={() => onSettings({ format: id })}>
              {f.label.split(' ')[0]}
            </button>
          ))}
        </div>
        <span className="dim small">Frame rate</span>
        <div className="segmented ed-seg">
          {[24, 30, 60].map((f) => (
            <button key={f} className={settings.fps === f ? 'on' : ''} onClick={() => onSettings({ fps: f })}>
              {f}
            </button>
          ))}
        </div>
        {meta.loudness && (
          <>
            <span className="dim small" title="How loud the exported film is: Online is about -14 LUFS, right for phones and the web">
              Loudness
            </span>
            <div className="segmented ed-seg">
              {Object.entries(meta.loudness).map(([id, l]) => (
                <button key={id} className={(settings.loudness || 'web') === id ? 'on' : ''} title={l.lufs ? `${l.lufs} LUFS` : 'Leave the sound as mixed'} onClick={() => onSettings({ loudness: id })}>
                  {l.label}
                </button>
              ))}
            </div>
          </>
        )}
        <p className="mono label ed-insp-gap">Markers</p>
        {markers.length === 0 && <p className="small dim">Press M to drop one at the playhead.</p>}
        {markers.map((mk) => (
          <div key={mk.id} className={`ed-mk ${selMarker === mk.id ? 'on' : ''}`}>
            <button className="link-btn mono" onClick={() => onSeek(mk.t)} title="Go to it">
              {timecode(mk.t)}
            </button>
            <input value={mk.label} placeholder="Label" onChange={(e) => onMarkers(markers.map((x) => (x.id === mk.id ? { ...x, label: e.target.value } : x)))} />
            <button className="link-btn" title="Remove" onClick={() => onMarkers(markers.filter((x) => x.id !== mk.id))}>
              ×
            </button>
          </div>
        ))}
        <p className="mono label ed-insp-gap">Keys</p>
        <dl className="ed-keys small">
          {shortcuts(platform).map(([k, v]) => (
            <div key={k}>
              <dt className="mono">{k}</dt>
              <dd className="dim">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    )
  const m = media[clip.media]
  const kind = clipKind(clip, media)
  const set = (patch) => onClip({ ...clip, ...patch })
  return (
    <div className="ed-insp">
      <p className="mono label">{kind === 'text' ? 'Title' : m?.name || 'Clip'}</p>
      {kind === 'text' && (
        <>
          <textarea rows={3} value={clip.text.content} onChange={(e) => set({ text: { ...clip.text, content: e.target.value } })} />
          <div className="segmented ed-seg">
            {['top', 'center', 'bottom'].map((p) => (
              <button key={p} className={clip.text.position === p ? 'on' : ''} onClick={() => set({ text: { ...clip.text, position: p } })}>
                {p}
              </button>
            ))}
          </div>
          <div className="ed-row">
            <Num label="Size %" value={clip.text.size} step={0.5} min={2} max={30} onChange={(v) => set({ text: { ...clip.text, size: v } })} />
            <label className="ed-num">
              <span className="dim small">Colour</span>
              <input type="color" value={clip.text.color || '#f4ecdc'} onChange={(e) => set({ text: { ...clip.text, color: e.target.value } })} />
            </label>
          </div>
          <label className="ed-check small">
            <input type="checkbox" checked={!!clip.text.box} onChange={(e) => set({ text: { ...clip.text, box: e.target.checked } })} /> Dark box behind
          </label>
        </>
      )}
      <div className="ed-row">
        <Num label="Start" value={clip.start} onChange={(v) => set({ start: v })} />
        <Num label="Length" value={clipLength(clip)} min={0.1} max={m?.duration ? m.duration - clip.in : undefined} onChange={(v) => set({ out: clip.in + v })} />
      </div>
      {kind !== 'text' && kind !== 'image' && (
        <div className="ed-row">
          <Num label="In (source)" value={clip.in} max={clip.out - 0.1} onChange={(v) => set({ in: v })} />
          <Num label="Out (source)" value={clip.out} min={clip.in + 0.1} max={m?.duration} onChange={(v) => set({ out: v })} />
        </div>
      )}
      <div className="ed-row">
        <Num label="Fade in" value={clip.fadeIn} max={clipLength(clip)} onChange={(v) => set({ fadeIn: v })} />
        <Num label="Fade out" value={clip.fadeOut} max={clipLength(clip)} onChange={(v) => set({ fadeOut: v })} />
      </div>
      {(kind === 'audio' || (kind === 'video' && m?.hasAudio)) && (
        <>
          <span className="dim small">Volume {Math.round((clip.volume ?? 1) * 100)}%</span>
          <input type="range" min={0} max={2} step={0.05} value={clip.volume ?? 1} onChange={(e) => set({ volume: Number(e.target.value) })} />
          <label className="ed-check small">
            <input type="checkbox" checked={!!clip.muted} onChange={(e) => set({ muted: e.target.checked })} /> Mute this clip
          </label>
        </>
      )}
    </div>
  )
}

