import { useEffect, useState } from 'react'
import Hero from './Hero'
import TileDelete from './TileDelete'
import { MediaEditor, MediaTile } from './MediaEditor'
import { fileUrl } from './edit/model'

const V = () => window.ivstudio.voices
const KIND = { designed: 'Designed', clone: 'Your recording', ready: 'Ready-made' }
const ENGINE_LABEL = { voxcpm2: 'VoxCPM2', cosyvoice: 'CosyVoice 3' }
const DESIGN_EXAMPLE = 'A woman in her forties from Glasgow. Low, warm and a little gravelly; quick, dry and kind. Close, natural recording in a small room.'

// IV Studio's voice engine (VoxCPM2 and Whisper in its own folder), with Set up the first time. Shared by
// Voices, Lines and Create.
export function useVoiceEngine() {
  const [status, setStatus] = useState(null)
  const check = () => V().status().then(setStatus, () => setStatus({ ready: false, engines: [] }))
  useEffect(() => {
    check()
  }, [])
  return [status, check]
}

const GB = (b) => `${Math.round(b / 1024 ** 3)} GB`

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
  if (!status) return <p className="voice-engine mono dim">Checking the voice engine…</p>
  if (status.ready)
    return (
      <p className="voice-engine mono">
        <span className="cloud-ok">● Voice engine ready</span>
        {status.setup?.models.map((m) => (
          <span key={m.name} className="dim" title={`${m.by}, ${m.licence}`}>
            {m.name}
          </span>
        ))}
      </p>
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
    <div className="voice-engine off">
      <p className="mono pink">● Voices need a one-time setup</p>
      <p className="small dim">
        IV Studio speaks with {status.setup?.models.map((m) => `${m.name} (${m.by}, ${m.licence})`).join(' and ')}, running on this PC. Setup downloads about {GB(status.setup?.size || 0)} into IV Studio's folder, once.
      </p>
      <div className="row-actions">
        <button className="btn btn-small btn-primary" disabled={working} onClick={setup}>
          {working ? 'Setting up…' : `Set up voices · ${GB(status.setup?.size || 0)}`}
        </button>
        {working && <span className="mono small dim voice-log">{log}</span>}
      </div>
    </div>
  )
}

// Audio > Voices: every voice IV Studio can speak in, which character has it, and two ways to make one.
export function VoicesPage({ notify, characters, setCharacters }) {
  const [status, check] = useVoiceEngine()
  const [voices, setVoices] = useState(null)
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

  return (
    <div className="voices">
      <Hero art="voices" title="Voices" kicker="Audio" />
      <p className="lede">
        A voice for every character.
        <span className="lede-small dim">Give a character a voice and Create can speak a line in it for H3 to lip-sync. Design a new voice from a description, or start from a recording. Only invented voices, your own, or someone who agreed to it.</span>
      </p>
      <EngineStatus status={status} check={check} notify={notify} />

      <section className="group">
        <div className="group-head">
          <h2>Your voices</h2>
          <p className="dim small">Kept by IV Studio as a short reference recording and its words.</p>
        </div>
        <div className="group-body">
          {voices?.length === 0 && <p className="dim small">No voices yet. Design one below, or download Tess or Theo on the Characters page: their voices come with them.</p>}
          <div className="voice-cards">
            {(voices || []).map((v) => (
              <div key={v.id} className="voice-card">
                <div className="voice-card-head">
                  <input className="preset-name" value={v.name} onChange={(e) => rename(v.id, e.target.value)} />
                  <span className="mono small dim">
                    {KIND[v.kind] || v.kind}
                    {v.seed != null && ` · seed ${v.seed}`}
                  </span>
                </div>
                {v.description && <p className="small dim">{v.description}</p>}
                <audio controls preload="none" src={fileUrl(v.reference)} />
                <div className="row tight">
                  <span className="row-label">Character</span>
                  <select value={ownerOf(v.id)[0]?.id || ''} onChange={(e) => e.target.value && giveTo(v.id, e.target.value)}>
                    <option value="">{ownerOf(v.id).length ? '' : 'Nobody yet'}</option>
                    {characters.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {c.voiceId && c.voiceId !== v.id ? ' (has a voice)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <TileDelete
                  name={v.name}
                  keeps={ownerOf(v.id).length ? `${ownerOf(v.id).map((c) => c.name).join(' and ')} will have no voice. Lines already spoken in it are removed too.` : 'Lines already spoken in it are removed too.'}
                  notify={notify}
                  onDelete={async () => {
                    await V().delete(v.id)
                    setCharacters(await window.ivstudio.characters.list())
                    load()
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      </section>

      <DesignVoice notify={notify} ready={status?.ready} onSaved={load} />
      <CloneVoice notify={notify} ready={status?.ready} onSaved={load} />
    </div>
  )
}

function DesignVoice({ notify, ready, onSaved }) {
  const [description, setDescription] = useState('')
  const [text, setText] = useState('')
  const [seed, setSeed] = useState(1)
  const [busy, setBusy] = useState(false)
  const [takes, setTakes] = useState([])
  const [name, setName] = useState('')
  async function design() {
    setBusy(true)
    setTakes([])
    try {
      setTakes(await V().design({ description, text, seed, count: 3 }))
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
    <section className="group">
      <div className="group-head">
        <h2>Design a voice</h2>
        <p className="dim small">Describe a voice that doesn't exist yet. VoxCPM2 makes three takes (about 25 seconds each); keep the one that fits.</p>
      </div>
      <div className="group-body">
        <textarea rows={3} value={description} placeholder={DESIGN_EXAMPLE} onChange={(e) => setDescription(e.target.value)} />
        <div className="row">
          <span className="row-label">They say</span>
          <input value={text} placeholder="Hi. So this is what I sound like when I'm just talking… (optional)" onChange={(e) => setText(e.target.value)} />
        </div>
        <div className="row">
          <span className="row-label">Seed</span>
          <input className="mini" type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value) || 1)} />
        </div>
        <button className="btn btn-primary" disabled={!ready || busy || !description.trim()} onClick={design}>
          {busy ? 'Designing three takes…' : 'Make three takes'}
        </button>
        {takes.length > 0 && (
          <>
            <div className="row">
              <span className="row-label">Name</span>
              <input value={name} placeholder="e.g. Maya Ortiz" onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="voice-takes">
              {takes.map((t) => (
                <div key={t.file} className="voice-take">
                  <span className="mono small">seed {t.seed}</span>
                  <audio controls src={fileUrl(t.file)} />
                  <button className="btn btn-small" onClick={() => keep(t)}>
                    Keep this one
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
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
    } finally {
      setBusy(null)
    }
  }
  const long = item?.info?.duration > 20
  return (
    <section className="group">
      <div className="group-head">
        <h2>From a recording</h2>
        <p className="dim small">A clean 10–20 second recording of one person talking, with no music. Longer recordings are cut to their first 20 seconds; click the recording to choose which part.</p>
      </div>
      <div className="group-body">
        {item ? (
          <div className="voice-control">
            <MediaTile item={item} label="Voice" onEdit={() => setEditing(true)} onRemove={() => setItem(null)} />
            {long && <span className="small pink">Over 20 s: trim it to the best part.</span>}
          </div>
        ) : (
          <button className="btn btn-small" onClick={pick}>
            + Recording
          </button>
        )}
        {editing && item && <MediaEditor item={item} hint="Keep 10–20 seconds of clear speech." onApply={(next) => (setItem(next), setEditing(false))} onClose={() => setEditing(false)} notify={notify} />}
        {item && (
          <>
            <div className="row">
              <span className="row-label">Words</span>
              <div className="voice-words">
                <textarea rows={3} value={text} placeholder="What's said in the recording. Leave it empty and it's read for you." onChange={(e) => setText(e.target.value)} />
                <button className="link-btn mono" disabled={!ready || busy} onClick={read}>
                  {busy === 'read' ? 'Listening…' : 'Read them for me'}
                </button>
              </div>
            </div>
            <div className="row">
              <span className="row-label">Name</span>
              <input value={name} placeholder="e.g. My narrator voice" onChange={(e) => setName(e.target.value)} />
            </div>
            <label className="consent small">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              This is my own voice, an invented one, or I have the speaker's permission to use it.
            </label>
            <button className="btn btn-primary" disabled={!ready || busy || !name.trim() || !consent || long} onClick={save}>
              {busy === 'save' ? 'Saving…' : 'Save voice'}
            </button>
          </>
        )}
      </div>
    </section>
  )
}

// Audio > Lines: say anything in any voice; every line is kept, ready to use in a shot or an edit.
export function LinesPage({ notify, characters, sendToCreate }) {
  const [status, check] = useVoiceEngine()
  const [voices, setVoices] = useState([])
  const [lines, setLines] = useState([])
  const [voiceId, setVoiceId] = useState(null)
  const [text, setText] = useState('')
  const [seed, setSeed] = useState('')
  const [busy, setBusy] = useState(false)
  const loadLines = () => V().lines().then(setLines, () => {})
  useEffect(() => {
    V()
      .list()
      .then((vs) => (setVoices(vs), setVoiceId((id) => id || vs[0]?.id || null)), () => {})
    loadLines()
  }, [])
  const voice = voices.find((v) => v.id === voiceId)
  const owner = (id) => characters.find((c) => c.voiceId === id)
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
  return (
    <div className="voices">
      <Hero art="lines" title="Lines" kicker="Audio" />
      <p className="lede">
        Say it in their voice.
        <span className="lede-small dim">Type a line, pick a voice, and use the result as a shot's voice line: H3 lip-syncs the character to it. Every line is kept here.</span>
      </p>
      <EngineStatus status={status} check={check} notify={notify} />
      <section className="group">
        <div className="group-head">
          <h2>New line</h2>
        </div>
        <div className="group-body">
          {voices.length === 0 ? (
            <p className="dim small">Make a voice on the Voices page first.</p>
          ) : (
            <>
              <div className="row">
                <span className="row-label">Voice</span>
                <select value={voiceId || ''} onChange={(e) => setVoiceId(e.target.value)}>
                  {voices.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                      {owner(v.id) && owner(v.id).name !== v.name ? ` (${owner(v.id).name})` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <textarea rows={3} value={text} placeholder="Okay, so I found the café. And it's closed. Of course it's closed." onChange={(e) => setText(e.target.value)} />
              <div className="row">
                <span className="row-label">Seed</span>
                <input className="mini" type="number" value={seed} placeholder={String(voice?.seed ?? 41)} onChange={(e) => setSeed(e.target.value)} />
              </div>
              <p className="dim small seed-note">A different seed gives a different read of the same words.</p>
              <button className="btn btn-primary" disabled={!status?.ready || busy || !text.trim()} onClick={speak}>
                {busy ? 'Speaking… (up to a minute the first time)' : 'Speak'}
              </button>
            </>
          )}
        </div>
      </section>
      {lines.length > 0 && (
        <section className="group">
          <div className="group-head">
            <h2>Spoken lines</h2>
            <p className="dim small">Newest first.</p>
          </div>
          <div className="group-body">
            <div className="line-list">
              {lines.map((l) => (
                <div key={l.id} className="line-row">
                  <div className="line-text">
                    <span className="mono small dim">
                      {l.voice} · {ENGINE_LABEL[l.engine] || l.engine} · seed {l.seed} · {l.duration}s
                    </span>
                    <span>{l.text}</span>
                  </div>
                  <audio controls preload="none" src={fileUrl(l.file)} />
                  <div className="line-actions">
                    <button className="btn btn-small btn-primary" onClick={() => sendToCreate(l)}>
                      Use in a shot
                    </button>
                    <button className="link-btn mono" onClick={() => window.ivstudio.files.reveal(l.file)}>
                      Show file
                    </button>
                    <button className="link-btn mono" onClick={async () => (await V().deleteLine(l.id), loadLines())}>
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
