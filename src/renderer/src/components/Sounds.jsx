import { useEffect, useRef, useState } from 'react'
import Stage from './Stage'
import QuickBar, { showBelow } from './AudioQuick'
import { ask } from './Confirm'
import { ListSearch, MoreMenu, Track } from './AudioKit'

// Audio -> Sounds: sound effects, ambiences, one-shots and loops from a description (Stable Audio 3, sounds.js).
const S = () => window.ivstudio.sounds
const DONE = ['success', 'error', 'cancelled']
const ACTIVE_DL = ['queued', 'downloading', 'verifying']
const GB = (b) => `${(b / 1024 ** 3).toFixed(1)} GB`
const blank = { kind: 'sfx', idea: '', description: '', seconds: 4, takes: 2, name: '', seed: '' }
const KIND_ICON = {
  sfx: 'M4 12h3l3-7 4 14 3-7h3',
  ambience: 'M3 15c2-3 4-3 6 0s4 3 6 0 4-3 6 0M3 9c2-3 4-3 6 0s4 3 6 0 4-3 6 0',
  oneshot: 'M12 3v18M7 8l5-5 5 5',
  loop: 'M17 2l3 3-3 3M4 11V9a4 4 0 014-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 01-4 4H4'
}

function state(s) {
  if (s.status === 'queued') return s.queuePosition ? `Waiting · ${s.queuePosition} in ComfyUI's queue` : 'Waiting'
  if (s.status === 'running') return s.progress?.max ? `Making it · ${Math.floor((s.progress.value / s.progress.max) * 100)}%` : 'Making it…'
  if (s.status === 'error') return 'Failed'
  if (s.status === 'cancelled') return 'Cancelled'
  return null
}

function Needed({ status, dl, onDone }) {
  const ids = status.missing.map((m) => m.id)
  const busy = ids.some((id) => ACTIVE_DL.includes(dl[id]?.status))
  const bytes = status.missing.reduce((n, m) => n + (m.size || 0), 0)
  useEffect(() => {
    if (ids.length && ids.every((id) => dl[id]?.status === 'done')) onDone()
  }, [dl])
  return (
    <div className="music-needed">
      <p className="small">
        Stable Audio 3 needs {status.missing.length === 1 ? 'one model' : `${status.missing.length} models`} first ({GB(bytes)}). They download into ComfyUI's models folder and are checked against the SHA-256 Hugging Face publishes.
      </p>
      {status.missing.map((m) => {
        const s = dl[m.id]
        const pct = s?.total ? Math.floor((s.received / s.total) * 100) : null
        return (
          <div key={m.id} className="music-model">
            <span>{m.label}</span>
            <span className="mono dim">models/{m.folder}</span>
            {s && ACTIVE_DL.includes(s.status) ? (
              <div className="dl">
                <div className="bar">
                  <span style={{ width: `${pct ?? 6}%` }} className={pct == null ? 'indeterminate' : ''} />
                </div>
                <span className="mono dim">{s.status === 'queued' ? 'Queued' : s.status === 'verifying' ? 'Checking…' : `${pct}%`}</span>
              </div>
            ) : s?.status === 'error' ? (
              <span className="small pink">{s.error}</span>
            ) : s?.status === 'done' ? (
              <span className="mono cloud-ok">✓</span>
            ) : (
              <span className="mono dim">{GB(m.size)}</span>
            )}
          </div>
        )
      })}
      {status.missingNodes?.length > 0 && <p className="small pink">This ComfyUI has no {status.missingNodes.join(', ')}. Update ComfyUI.</p>}
      <button className="btn btn-primary" disabled={busy} onClick={() => window.ivstudio.models.download(ids)}>
        {busy ? 'Downloading…' : `Download · ${GB(bytes)}`}
      </button>
    </div>
  )
}

function SoundRow({ sound, kinds, edits, notify, reuse, reload, openEdit }) {
  const [name, setName] = useState(sound.name)
  useEffect(() => setName(sound.name), [sound.name])
  const done = sound.status === 'success' && sound.files?.length
  const making = !DONE.includes(sound.status)
  const pct = sound.progress?.max ? Math.floor((sound.progress.value / sound.progress.max) * 100) : null
  async function rename() {
    if (name.trim() && name.trim() !== sound.name) await S().rename(sound.id, name.trim()).catch((err) => notify(err.message))
    reload()
  }
  async function toEdit(take, target) {
    try {
      const e = await S().toEdit(sound.id, take, target || null)
      openEdit(e.id)
    } catch (err) {
      notify(err.message)
    }
  }
  async function remove() {
    if (!(await ask({ title: `Delete “${sound.name}”?`, message: making ? 'It is still being made: this stops it.' : 'Its files in the sounds folder go too. The copy in ComfyUI\'s output folder stays.', confirm: 'Delete', danger: true }))) return
    await S().delete(sound.id).catch((err) => notify(err.message))
    reload()
  }
  const kind = kinds.find((k) => k.id === sound.kind)?.label || 'Sound'
  const meta = [kind, `${sound.seconds} s`, sound.takes > 1 && `${sound.takes} takes`, `seed ${sound.seed}`, sound.seconds_taken && `made in ${sound.seconds_taken} s`].filter(Boolean).join(' · ')
  const menu = (take) => [
    { divider: true, label: 'Add to an edit (A2)' },
    { label: 'A new edit', onClick: () => toEdit(take, null) },
    ...edits.slice(0, 6).map((e) => ({ label: e.name, onClick: () => toEdit(take, e.id) })),
    { divider: true, label: '' },
    { label: 'Make another like this', onClick: () => reuse(sound) },
    { label: 'Show file', onClick: () => window.ivstudio.files.reveal(sound.files[take].file) },
    { label: 'Delete', danger: true, onClick: remove }
  ]
  if (!done)
    return (
      <Track
        title={sound.name}
        sub={sound.description}
        meta={meta}
        status={
          <div className={`track-status ${sound.status === 'error' ? 'failed' : ''}`}>
            {making && (
              <span className="track-progress">
                <span style={{ width: `${pct ?? 4}%` }} className={pct == null ? 'indeterminate' : ''} />
              </span>
            )}
            <span className="mono small">
              {state(sound)}
              {sound.error ? `: ${sound.error}` : ''}
            </span>
          </div>
        }
        actions={
          <>
            {making && (
              <button className="btn btn-small" onClick={async () => (await S().cancel(sound.id).catch((err) => notify(err.message)), reload())}>
                Stop
              </button>
            )}
            <MoreMenu items={[{ label: 'Make another like this', onClick: () => reuse(sound) }, { label: 'Delete', danger: true, onClick: remove }]} label={`More for ${sound.name}`} />
          </>
        }
      />
    )
  return (
    <div className="sound-set">
      {sound.files.map((f, i) => (
        <Track
          key={f.file}
          file={f.file}
          duration={f.duration}
          clamp={false}
          title={i === 0 ? <input className="song-name" value={name} onChange={(e) => setName(e.target.value)} onBlur={rename} onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} aria-label="Sound name" title="Click to rename" /> : null}
          sub={i === 0 ? sound.description : null}
          meta={sound.files.length > 1 ? `${i === 0 ? `${meta} · ` : ''}take ${i + 1}` : meta}
          actions={
            <>
              <button className="btn btn-small btn-primary" onClick={() => toEdit(i, edits[0]?.id || null)} title={edits[0] ? `Onto A2 of “${edits[0].name}”` : 'Onto A2 of a new edit'}>
                Add to edit
              </button>
              <MoreMenu items={menu(i)} label={`More for ${sound.name} take ${i + 1}`} />
            </>
          }
        />
      ))}
    </div>
  )
}

export function SoundsPage({ notify, openEdit, go }) {
  const [meta, setMeta] = useState(null)
  const [status, setStatus] = useState(null)
  const [form, setForm] = useState(blank)
  const [list, setList] = useState([])
  const [edits, setEdits] = useState([])
  const [dl, setDl] = useState({})
  const [busy, setBusy] = useState(false)
  const [writing, setWriting] = useState(false)
  const [more, setMore] = useState(false)
  const [q, setQ] = useState('')
  const top = useRef(null)
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))
  const check = () => S().status().then(setStatus, (err) => setStatus({ error: err.message, missing: [] }))
  const reload = () => S().list().then(setList, (err) => notify(err.message))
  useEffect(() => {
    S().meta().then(setMeta)
    check()
    reload()
    window.ivstudio.edits.list().then(setEdits, () => {})
    window.ivstudio.models.status().then(setDl)
    return window.ivstudio.models.onUpdate((u) => setDl((all) => ({ ...all, [u.id]: u })))
  }, [])
  const making = list.some((s) => !DONE.includes(s.status))
  useEffect(() => {
    if (!making) return
    const t = setInterval(reload, 2500)
    return () => clearInterval(t)
  }, [making])

  const kinds = meta?.kinds || []
  const kind = kinds.find((k) => k.id === form.kind)
  const max = meta?.limits.max || 120
  const shown = q.trim() ? list.filter((s) => `${s.name} ${s.description}`.toLowerCase().includes(q.trim().toLowerCase())) : list
  async function write() {
    setWriting(true)
    try {
      const r = await S().write({ idea: form.idea || form.description, kind: form.kind })
      set({ description: r.description, seconds: r.seconds })
    } catch (err) {
      notify(err.message)
    } finally {
      setWriting(false)
    }
  }
  async function make() {
    setBusy(true)
    try {
      await S().create({ kind: form.kind, description: form.description, seconds: Number(form.seconds), takes: Number(form.takes), name: form.name, seed: form.seed === '' ? null : Number(form.seed) })
      set({ seed: '' })
      reload()
    } catch (err) {
      notify(err.message)
    } finally {
      setBusy(false)
    }
  }
  function reuse(s) {
    setForm({ ...blank, kind: s.kind, description: s.description, seconds: s.seconds, takes: s.takes, name: s.name })
    top.current?.scrollIntoView({ behavior: 'smooth' })
  }
  return (
    <div className="voices music sounds audio-page" ref={top}>
      <Stage effect="ripple" art="sounds" title="Sounds" kicker="Audio" help="sounds" back={{ label: 'Audio', onClick: () => go('audio') }}>
        <QuickBar
          label="Describe a sound"
          placeholder={kind?.example || 'Describe a sound: what makes it, where it happens…'}
          value={form.description}
          onChange={(description) => set({ description, idea: description })}
          goLabel="Make it"
          busyLabel="Making…"
          busy={busy}
          disabled={busy || !status?.ready || !form.description.trim()}
          onGo={make}
          note={
            status?.remote
              ? { text: 'Sounds are made on this PC’s ComfyUI. Switch to This PC on the Cloud page to make them.' }
              : status && !status.ready && !status.error
                ? { text: 'Stable Audio 3 isn’t downloaded yet.', action: { label: 'See what it needs', onClick: () => showBelow('.sounds .composer') } }
                : null
          }
        />
      </Stage>
      <p className="lede">
        Sound effects and ambiences, made on this PC.
        <span className="lede-small dim">Describe a sound, or a few words and Write it for me. Make up to four takes at once and put the one you like under an edit, on A2 beneath the music.</span>
      </p>
      {status?.remote && <p className="notice">Sounds are made on this PC's ComfyUI. Switch to "This PC" on the Cloud page to make them.</p>}
      {status?.error && <p className="notice">{status.error}</p>}

      <section className="audio-card composer">
        <div className="audio-card-head">
          <h2>New sound</h2>
          <span className="mono small dim">
            {meta?.engine.label} · <span className="music-licence">{meta?.engine.licence}</span>
          </span>
        </div>
        <div className="audio-card-body">
          {status && !status.ready && !status.remote && !status.error && <Needed status={status} dl={dl} onDone={check} />}
          <div className="engine-cards sound-kinds" role="radiogroup" aria-label="What kind of sound">
            {kinds.map((k) => (
              <button key={k.id} role="radio" aria-checked={form.kind === k.id} className={`engine-card ${form.kind === k.id ? 'on' : ''}`} onClick={() => set({ kind: k.id, seconds: k.seconds })}>
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d={KIND_ICON[k.id]} />
                </svg>
                <span className="engine-card-name">{k.label}</span>
              </button>
            ))}
          </div>

          <label className="field">
            <span className="field-label mono">
              The sound
              <button type="button" className="link-btn field-action" disabled={writing || !(form.description || form.idea).trim()} onClick={write} title="Your prompt writer (Settings) turns a few words into a full description and picks a length">
                {writing ? 'Writing…' : 'Write it for me'}
              </button>
            </span>
            <textarea rows={3} value={form.description} placeholder={kind?.example} onChange={(e) => set({ description: e.target.value, idea: e.target.value })} />
            <span className="field-hint dim small">What makes it, what it is made of, where it happens, how it starts and ends. A few words are enough for Write it for me.</span>
          </label>

          <div className="field-grid">
            <div className="field">
              <span className="field-label mono">Length</span>
              <div className="music-length">
                <input type="range" min={1} max={Math.min(60, max)} step={1} value={Math.min(form.seconds, 60)} onChange={(e) => set({ seconds: Number(e.target.value) })} aria-label="Seconds" />
                <input className="mini" type="number" min={1} max={max} value={form.seconds} onChange={(e) => set({ seconds: e.target.value })} aria-label="Seconds" />
                <span className="dim small">s</span>
              </div>
            </div>
            <div className="field">
              <span className="field-label mono">Takes</span>
              <div className="segmented">
                {[1, 2, 3, 4].map((n) => (
                  <button key={n} className={Number(form.takes) === n ? 'on' : ''} onClick={() => set({ takes: n })}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className={`more-settings ${more ? 'open' : ''}`}>
            <button type="button" className="more-settings-toggle mono" onClick={() => setMore((m) => !m)} aria-expanded={more}>
              {more ? '−' : '+'} More settings
              <span className="dim">{[form.name && `“${form.name}”`, form.seed !== '' && `seed ${form.seed}`].filter(Boolean).join(' · ')}</span>
            </button>
            {more && (
              <div className="more-settings-body">
                <label className="field">
                  <span className="field-label mono">
                    Name <span className="dim">· optional</span>
                  </span>
                  <input value={form.name} placeholder="The description's first words otherwise" onChange={(e) => set({ name: e.target.value })} />
                </label>
                <label className="field">
                  <span className="field-label mono">Seed</span>
                  <input className="mini seed-input" type="number" value={form.seed} placeholder="Random" onChange={(e) => set({ seed: e.target.value })} />
                  <span className="field-hint dim small">The same description, length and seed give the same sound.</span>
                </label>
              </div>
            )}
          </div>

          <div className="composer-foot end">
            <button className="btn btn-primary" disabled={busy || !status?.ready || !form.description.trim()} onClick={make}>
              {busy ? 'Queuing…' : Number(form.takes) > 1 ? `Make ${form.takes} takes` : 'Make it'}
            </button>
          </div>
        </div>
      </section>

      {list.length > 0 && (
        <section className="audio-section">
          <div className="audio-section-head">
            <h2>
              Sounds <span className="count">{list.length}</span>
            </h2>
            {list.length > 5 && <ListSearch value={q} onChange={setQ} placeholder="Search sounds" />}
          </div>
          <div className="track-list">
            {shown.map((s) => (
              <SoundRow key={s.id} sound={s} kinds={kinds} edits={edits} notify={notify} reuse={reuse} reload={reload} openEdit={openEdit} />
            ))}
            {shown.length === 0 && <p className="audio-empty dim">No sounds match “{q}”.</p>}
          </div>
        </section>
      )}
    </div>
  )
}
