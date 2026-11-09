import { useEffect, useMemo, useState } from 'react'
import Hero from './Hero'
import { ask } from './Confirm'
import { MediaEditor, MediaTile } from './MediaEditor'
import { ListSearch, MoreMenu, Player, Track, VoiceAvatar } from './AudioKit'
import { modChord } from '../../../shared/platform'
import { usePlatform } from '../platform'

const V = () => window.ivstudio.voices
const KIND = { designed: 'Designed', clone: 'From a recording', ready: 'Ready-made' }
const ENGINE_LABEL = { voxcpm2: 'VoxCPM2', cosyvoice: 'CosyVoice 3' }
const DESIGN_EXAMPLE = 'A woman in her forties from Glasgow. Low, warm and a little gravelly; quick, dry and kind. Close, natural recording in a small room.'
const LINE_EXAMPLE = 'Okay, so I found the café. And it’s closed. Of course it’s closed.'
const GB = (b) => `${Math.round(b / 1024 ** 3)} GB`
const secs = (d) => (d ? `${Math.round(d)} s` : null)
// about how long a line takes to say: 2.6 words a second, a natural pace
const sayTime = (text) => {
  const words = text.trim() ? text.trim().split(/\s+/).length : 0
  return { words, seconds: Math.max(1, Math.round(words / 2.6)) }
}

// IV Studio's voice engine (VoxCPM2 and Whisper in its own folder), with Set up the first time.
export function useVoiceEngine() {
  const [status, setStatus] = useState(null)
  const check = () => V().status().then(setStatus, () => setStatus({ ready: false, engines: [] }))
  useEffect(() => {
    check()
  }, [])
  return [status, check]
}

// A slim strip at the top of Voices and Lines: ready (and which models), or the one-time setup.
export function EngineStatus({ status, check, notify }) {
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState('')
  useEffect(() => V().onLog((line) => setLog(String(line).slice(0, 200))), [])
  // a setup started elsewhere (another page, an agent) shows here until it finishes
  useEffect(() => {
    if (!status?.installing) return
    const t = setInterval(check, 3000)
    return () => clearInterval(t)
  }, [status?.installing])
  async function setup() {
    setBusy(true)
    try {
      await V().setup()
    } catch (err) {
      notify(err.message)
    } finally {
      setBusy(false)
      check()
    }
  }
  if (!status) return <div className="engine-strip mono dim">Checking the voice engine…</div>
  if (status.ready)
    return (
      <div className="engine-strip ready mono">
        <span className="engine-dot" />
        Voice engine ready
        <span className="dim">{status.setup?.models.map((m) => m.name).join(' · ')}</span>
      </div>
    )
  if (status.unavailable)
    return (
      <div className="voice-engine off">
        <p className="mono pink">● Voices aren't available yet</p>
        <p className="small dim">{status.unavailable}</p>
      </div>
    )
  const working = busy || status.installing
  return (
    <div className="engine-strip off">
      <div>
        <p className="mono pink">Voices need a one-time setup</p>
        <p className="small dim">
          IV Studio speaks with {status.setup?.models.map((m) => `${m.name} (${m.by}, ${m.licence})`).join(' and ')}, running on this PC. Setup downloads about {GB(status.setup?.size || 0)} into IV Studio's folder, once.
        </p>
        {working && <p className="mono small dim voice-log">{log}</p>}
      </div>
      <button className="btn btn-primary" disabled={working} onClick={setup}>
        {working ? 'Setting up…' : `Set up voices · ${GB(status.setup?.size || 0)}`}
      </button>
    </div>
  )
}

// Seed with a dice button: another number gives another read of the same words.
function SeedField({ value, onChange, placeholder = 'Random' }) {
  return (
    <label className="seed-field mono" title="The same seed gives the same read; another seed, another read">
      Seed
      <input className="mini" type="number" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      <button type="button" className="seed-roll" onClick={() => onChange(String(Math.floor(Math.random() * 100000)))} aria-label="A new seed" title="A new seed">
        ⟳
      </button>
    </label>
  )
}

// Audio > Voices: every voice IV Studio can speak in, which character has it, and two ways to make one.
export function VoicesPage({ notify, characters, setCharacters }) {
  const [status, check] = useVoiceEngine()
  const [voices, setVoices] = useState(null)
  const [tab, setTab] = useState('design')
  const load = () => V().list().then(setVoices, (err) => notify(err.message))
  useEffect(() => {
    load()
  }, [])
  const ownerOf = (id) => characters.filter((c) => c.voiceId === id)
  async function giveTo(voiceId, charId) {
    const list = characters.map((c) => (c.id === charId ? { ...c, voiceId, voiceDeclined: false } : c))
    setCharacters(await window.ivstudio.characters.save(list))
  }
  async function rename(id, name) {
    setVoices((vs) => vs.map((v) => (v.id === id ? { ...v, name } : v)))
    await V().update(id, { name }).catch((err) => notify(err.message))
  }
  async function remove(v) {
    const owners = ownerOf(v.id)
    const keeps = owners.length ? `${owners.map((c) => c.name).join(' and ')} will have no voice. Lines already spoken in it are removed too.` : 'Lines already spoken in it are removed too.'
    if (!(await ask({ title: `Delete “${v.name}”?`, message: keeps, confirm: 'Delete', danger: true }))) return
    try {
      await V().delete(v.id)
      setCharacters(await window.ivstudio.characters.list())
      load()
    } catch (err) {
      notify(err.message)
    }
  }

  return (
    <div className="voices audio-page">
      <Hero art="voices" title="Voices" kicker="Audio" />
      <p className="lede">
        A voice for every character.
        <span className="lede-small dim">Give a character a voice and Create can speak a line in it for H3 to lip-sync. Only invented voices, your own, or someone who agreed to it.</span>
      </p>
      <EngineStatus status={status} check={check} notify={notify} />

      <section className="audio-section">
        <div className="audio-section-head">
          <h2>
            Your voices {voices?.length > 0 && <span className="count">{voices.length}</span>}
          </h2>
        </div>
        {voices?.length === 0 && <p className="audio-empty dim">No voices yet. Make one below, or download Tess or Theo on the Characters page: their voices come with them.</p>}
        <div className="voice-grid">
          {(voices || []).map((v) => {
            const owners = ownerOf(v.id)
            return (
              <div key={v.id} className="voice-tile">
                <div className="voice-tile-head">
                  <VoiceAvatar name={v.name} picture={owners.find((c) => c.picture)?.picture} size={44} />
                  <div className="voice-tile-names">
                    <input className="voice-name" value={v.name} onChange={(e) => rename(v.id, e.target.value)} aria-label="Voice name" title="Click to rename" />
                    <span className="mono small dim">
                      {KIND[v.kind] || v.kind}
                      {v.seed != null && ` · seed ${v.seed}`}
                    </span>
                  </div>
                  <MoreMenu items={[{ label: 'Delete this voice', danger: true, onClick: () => remove(v) }]} label={`More for ${v.name}`} />
                </div>
                {v.description && <p className="voice-desc small dim">{v.description}</p>}
                <Player file={v.reference} label={v.name} />
                <label className="voice-owner">
                  <span className="mono small dim">Voice of</span>
                  <select value={owners[0]?.id || ''} onChange={(e) => e.target.value && giveTo(v.id, e.target.value)}>
                    <option value="">{owners.length ? '' : 'Nobody yet'}</option>
                    {characters.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {c.voiceId && c.voiceId !== v.id ? ' (has a voice)' : ''}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )
          })}
        </div>
      </section>

      <section className="audio-card">
        <div className="audio-card-head">
          <h2>New voice</h2>
          <div className="segmented" role="tablist">
            <button role="tab" aria-selected={tab === 'design'} className={tab === 'design' ? 'on' : ''} onClick={() => setTab('design')}>
              Describe one
            </button>
            <button role="tab" aria-selected={tab === 'clone'} className={tab === 'clone' ? 'on' : ''} onClick={() => setTab('clone')}>
              From a recording
            </button>
          </div>
        </div>
        {tab === 'design' ? <DesignVoice notify={notify} ready={status?.ready} onSaved={load} /> : <CloneVoice notify={notify} ready={status?.ready} onSaved={load} />}
      </section>
    </div>
  )
}

function DesignVoice({ notify, ready, onSaved }) {
  const [description, setDescription] = useState('')
  const [text, setText] = useState('')
  const [seed, setSeed] = useState('1')
  const [busy, setBusy] = useState(false)
  const [takes, setTakes] = useState([])
  const [name, setName] = useState('')
  async function design() {
    setBusy(true)
    setTakes([])
    try {
      setTakes(await V().design({ description, text, seed: Number(seed) || 1, count: 3 }))
    } catch (err) {
      notify(err.message)
    } finally {
      setBusy(false)
    }
  }
  async function keep(t) {
    try {
      await V().create({ name: name || 'New voice', file: t.file, text: t.text, description: t.description, seed: t.seed, kind: 'designed' })
      notify(`Saved “${name || 'New voice'}”. Give it to a character above.`, 'info')
      setTakes([])
      setName('')
      onSaved()
    } catch (err) {
      notify(err.message)
    }
  }
  return (
    <div className="audio-card-body">
      <p className="dim small">Describe a voice that doesn't exist yet. VoxCPM2 makes three takes, about 25 seconds each; keep the one that fits.</p>
      <label className="field">
        <span className="field-label mono">What they sound like</span>
        <textarea rows={3} value={description} placeholder={DESIGN_EXAMPLE} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <label className="field">
        <span className="field-label mono">
          What they say <span className="dim">· optional</span>
        </span>
        <input value={text} placeholder="Hi. So this is what I sound like when I'm just talking…" onChange={(e) => setText(e.target.value)} />
      </label>
      <div className="composer-foot">
        <SeedField value={seed} onChange={setSeed} />
        <button className="btn btn-primary" disabled={!ready || busy || !description.trim()} onClick={design}>
          {busy ? 'Designing three takes…' : 'Make three takes'}
        </button>
      </div>
      {takes.length > 0 && (
        <div className="take-list">
          <label className="field">
            <span className="field-label mono">Name the one you keep</span>
            <input value={name} placeholder="e.g. Maya Ortiz" onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="track-list">
            {takes.map((t, i) => (
              <Track
                key={t.file}
                file={t.file}
                title={`Take ${i + 1}`}
                clamp={false}
                meta={`seed ${t.seed}`}
                actions={
                  <button className="btn btn-small btn-primary" onClick={() => keep(t)}>
                    Keep this one
                  </button>
                }
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function CloneVoice({ notify, ready, onSaved }) {
  const [item, setItem] = useState(null)
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const [name, setName] = useState('')
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(null)
  async function pick() {
    const [file] = await window.ivstudio.files.pick('audio')
    if (file) setItem({ kind: 'audio', path: file, info: await window.ivstudio.media.probe(file).catch(() => null) })
  }
  async function read() {
    setBusy('read')
    try {
      setText(await V().transcribe(item.path))
    } catch (err) {
      notify(err.message)
    } finally {
      setBusy(null)
    }
  }
  async function save() {
    setBusy('save')
    try {
      await V().create({ name, file: item.path, text, kind: 'clone', consent })
      notify(`Saved “${name}”. Give it to a character above.`, 'info')
      setItem(null)
      setText('')
      setName('')
      setConsent(false)
      onSaved()
    } catch (err) {
      notify(err.message)
    }
    setBusy(null)
  }
  const long = item?.info?.duration > 20
  return (
    <div className="audio-card-body">
      <p className="dim small">A clean 10–20 second recording of one person talking, with no music. Longer recordings are cut to their first 20 seconds; click the recording to choose which part.</p>
      {item ? (
        <div className="voice-control">
          <MediaTile item={item} label="Voice" onEdit={() => setEditing(true)} onRemove={() => setItem(null)} />
          {long && <span className="small pink">Over 20 s: trim it to the best part.</span>}
        </div>
      ) : (
        <button className="drop-pick" onClick={pick}>
          <span className="drop-pick-plus">+</span>
          <span>Choose a recording</span>
          <span className="small dim">WAV, MP3, M4A or FLAC</span>
        </button>
      )}
      {editing && item && <MediaEditor item={item} hint="Keep 10–20 seconds of clear speech." onApply={(next) => (setItem(next), setEditing(false))} onClose={() => setEditing(false)} notify={notify} />}
      {item && (
        <>
          <label className="field">
            <span className="field-label mono">
              The words in it
              <button type="button" className="link-btn mono field-action" disabled={!ready || busy} onClick={read}>
                {busy === 'read' ? 'Listening…' : 'Read them for me'}
              </button>
            </span>
            <textarea rows={3} value={text} placeholder="What's said in the recording. Leave it empty and it's read for you." onChange={(e) => setText(e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label mono">Name</span>
            <input value={name} placeholder="e.g. My narrator voice" onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="consent small">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            This is my own voice, an invented one, or I have the speaker's permission to use it.
          </label>
          <div className="composer-foot end">
            <button className="btn btn-primary" disabled={!ready || busy || !name.trim() || !consent || long} onClick={save}>
              {busy === 'save' ? 'Saving…' : 'Save voice'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// Audio > Lines: say anything in any voice; every line is kept, ready to use in a shot or an edit.
export function LinesPage({ notify, characters, sendToCreate }) {
  const platform = usePlatform()
  const [status, check] = useVoiceEngine()
  const [voices, setVoices] = useState([])
  const [lines, setLines] = useState([])
  const [voiceId, setVoiceId] = useState(null)
  const [text, setText] = useState('')
  const [seed, setSeed] = useState('')
  const [busy, setBusy] = useState(false)
  const [q, setQ] = useState('')
  const loadLines = () => V().lines().then(setLines, () => {})
  useEffect(() => {
    V()
      .list()
      .then((vs) => (setVoices(vs), setVoiceId((id) => id || vs[0]?.id || null)), () => {})
    loadLines()
  }, [])
  const voice = voices.find((v) => v.id === voiceId)
  const owner = (id) => characters.find((c) => c.voiceId === id)
  const picOf = (voiceName) => {
    const v = voices.find((x) => x.name === voiceName)
    return v && owner(v.id)?.picture
  }
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s ? lines.filter((l) => `${l.text} ${l.voice}`.toLowerCase().includes(s)) : lines
  }, [lines, q])
  const est = sayTime(text)
  async function speak() {
    setBusy(true)
    try {
      await V().speak({ voiceId, text, seed: seed === '' ? undefined : Number(seed) })
      loadLines()
    } catch (err) {
      notify(err.message)
    } finally {
      setBusy(false)
    }
  }
  async function remove(l) {
    if (!(await ask({ title: 'Delete this line?', message: `“${l.text.slice(0, 80)}${l.text.length > 80 ? '…' : ''}” and its sound file go. Shots that already use it keep their copy.`, confirm: 'Delete', danger: true }))) return
    await V().deleteLine(l.id).catch((err) => notify(err.message))
    loadLines()
  }
  return (
    <div className="voices audio-page">
      <Hero art="lines" title="Lines" kicker="Audio" />
      <p className="lede">
        Say it in their voice.
        <span className="lede-small dim">Type a line, pick a voice, and use it as a shot's voice line: H3 lip-syncs the character to it. Every line is kept here.</span>
      </p>
      <EngineStatus status={status} check={check} notify={notify} />

      <section className="audio-card composer">
        <div className="audio-card-head">
          <h2>New line</h2>
        </div>
        {voices.length === 0 ? (
          <p className="audio-empty dim">Make a voice on the Voices page first.</p>
        ) : (
          <div className="audio-card-body">
            <div className="voice-picker" role="radiogroup" aria-label="Voice">
              {voices.map((v) => {
                const o = owner(v.id)
                return (
                  <button key={v.id} role="radio" aria-checked={voiceId === v.id} className={`voice-chip ${voiceId === v.id ? 'on' : ''}`} onClick={() => setVoiceId(v.id)}>
                    <VoiceAvatar name={v.name} picture={o?.picture} size={30} />
                    <span className="voice-chip-name">
                      {v.name}
                      {o && o.name !== v.name && <span className="dim">{o.name}</span>}
                    </span>
                  </button>
                )
              })}
            </div>
            <textarea className="composer-text" rows={4} value={text} placeholder={LINE_EXAMPLE} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && text.trim() && status?.ready && !busy && speak()} />
            <div className="composer-foot">
              <SeedField value={seed} onChange={setSeed} placeholder={String(voice?.seed ?? 41)} />
              <span className="mono small dim">{est.words ? `${est.words} words · about ${est.seconds} s` : `${modChord(platform, 'Enter')} speaks`}</span>
              <button className="btn btn-primary" disabled={!status?.ready || busy || !text.trim()} onClick={speak}>
                {busy ? 'Speaking… (up to a minute the first time)' : 'Speak'}
              </button>
            </div>
          </div>
        )}
      </section>

      {lines.length > 0 && (
        <section className="audio-section">
          <div className="audio-section-head">
            <h2>
              Spoken lines <span className="count">{lines.length}</span>
            </h2>
            {lines.length > 5 && <ListSearch value={q} onChange={setQ} placeholder="Search lines" />}
          </div>
          <div className="track-list">
            {shown.map((l) => (
              <Track
                key={l.id}
                file={l.file}
                duration={l.duration}
                title={l.text}
                meta={
                  <>
                    <VoiceAvatar name={l.voice} picture={picOf(l.voice)} size={18} />
                    {[l.voice, ENGINE_LABEL[l.engine] || l.engine, `seed ${l.seed}`, secs(l.duration)].filter(Boolean).join(' · ')}
                  </>
                }
                actions={
                  <>
                    <button className="btn btn-small btn-primary" onClick={() => sendToCreate(l)}>
                      Use in a shot
                    </button>
                    <MoreMenu
                      items={[
                        { label: 'Say it again in this voice', onClick: () => (setVoiceId(voices.find((v) => v.name === l.voice)?.id || voiceId), setText(l.text), window.scrollTo?.(0, 0), document.querySelector('.main')?.scrollTo({ top: 0, behavior: 'smooth' })) },
                        { label: 'Show file', onClick: () => window.ivstudio.files.reveal(l.file) },
                        { label: 'Delete', danger: true, onClick: () => remove(l) }
                      ]}
                    />
                  </>
                }
              />
            ))}
            {shown.length === 0 && <p className="audio-empty dim">No lines match “{q}”.</p>}
          </div>
        </section>
      )}
    </div>
  )
}
