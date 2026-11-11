import { useEffect, useRef, useState } from 'react'
import { LoraPicker, loraTitle } from './Loras'
import { ask } from './Confirm'
import Hero from './Hero'
import TileDelete from './TileDelete'
import { MediaEditor, MediaTile } from './MediaEditor'
import { fileUrl } from './edit/model'
import { media } from '../media'
import { StepHead } from './CreateKit'
import { LoraIcon, RefModIcon, RefModMaker, RefModPicker, SourceChooser } from './CharacterSources'

const STEPS = [
  ['design', 'Design'],
  ['clips', 'Clips'],
  ['train', 'Train'],
  ['pick', 'Pick']
]
// what each step of the wizard is for, under its name
const STEP_SUB = { design: 'Their face and scenes', clips: 'Voice and talking clips', train: 'Here or in the cloud', pick: 'Test and choose one' }
const DONE = ['success', 'error', 'cancelled']
const RUNNING = ['preparing', 'models', 'uploading', 'training']
const STATE_TEXT = {
  preparing: 'Building the dataset…',
  models: 'Getting the H3 training files ready (about 42 GB in your cloud storage, the first time only)…',
  uploading: 'Uploading the dataset…',
  training: 'Training',
  done: 'Training finished',
  failed: 'Training stopped',
  stopped: 'Stopped'
}
const src = (file) => (file?.url ? media(file.url) : file?.path ? fileUrl(file.path) : null)

// Every character in one place: the ones you can use now (presets), ready-made ones to download, and
// characters you're designing or training. Each is a portrait card; its settings open in a pop-up.
export function CharacterList({ openCharacter, notify, characters, setCharacters, go, startShotWith, setup }) {
  const pcCanTrain = usePcCanTrain(setup)
  const [list, setList] = useState(null)
  // which character's LoRA the picker is choosing ('new' adds a character)
  const [pickFor, setPickFor] = useState(null)
  const [editing, setEditing] = useState(null)
  const [ready, setReady] = useState([])
  const [loras, setLoras] = useState([])
  const [progress, setProgress] = useState({})
  const [voices, setVoices] = useState([])
  const [refmods, setRefmods] = useState([])
  // adding: 'choose' (LoRA or RefMod), 'refmod' (the RefMod list for a new character) or a character id (another RefMod for it)
  const [adding, setAdding] = useState(null)
  // Train your own: 'lora' (design and train) or 'refmod' (make one from pictures)
  const [path, setPath] = useState(null)
  const [name, setName] = useState('')
  const [who, setWho] = useState('a woman in her thirties')
  const C = window.ivstudio.characters
  const loadReady = () => C.catalog().then(setReady, () => {})
  useEffect(() => {
    window.ivstudio.voices.list().then(setVoices, () => {})
    window.ivstudio.training.list().then(setList)
    loadReady()
    C.loras().then(setLoras, () => {})
    window.ivstudio.refmods.list().then(setRefmods, () => {})
    return C.onProgress(({ id, progress: p }) => setProgress((x) => ({ ...x, [id]: p })))
  }, [])
  async function create() {
    try {
      openCharacter((await window.ivstudio.training.create({ name, who })).id)
    } catch (err) {
      notify(err.message)
    }
  }
  async function saveCharacter(id, patch) {
    setCharacters(await C.save(characters.map((c) => (c.id === id ? { ...c, ...patch } : c))))
  }
  async function install(id) {
    setProgress((x) => ({ ...x, [id]: 0 }))
    try {
      await C.install(id)
      setCharacters(await C.list())
      window.ivstudio.voices.list().then(setVoices, () => {})
      notify(`${ready.find((r) => r.id === id)?.name} is ready: pick them in Create and write {char} in the prompt.`, 'info')
    } catch (err) {
      notify(err.message)
    } finally {
      setProgress((x) => ({ ...x, [id]: undefined }))
      loadReady()
    }
  }
  const has = (lora) => loras.some((l) => l.replace(/\\/g, '/').toLowerCase() === String(lora).replace(/\\/g, '/').toLowerCase())
  // a RefMod character needs its RefMod in ComfyUI; any other its LoRA
  const isRef = (c) => !c.lora && !!c.refmod
  const found = (c) => (isRef(c) ? refmods.includes(c.refmod) : has(c.lora))
  const offered = ready.filter((r) => !characters.some((c) => c.id === r.id))
  const face = (c) => c.picture || ready.find((r) => r.id === c.id)?.picture
  const voiceOf = (c) => voices.find((v) => v.id === c.voiceId)
  const downloadLabel = (id, size) => (progress[id] != null ? `Downloading ${Math.round(progress[id] * 100)}%` : `Download · ${Math.round(size / 1e6)} MB`)
  const open = characters.find((c) => c.id === editing)
  const unfinished = (list || []).filter((t) => !t.characterId).length

  return (
    <div className="characters">
      <Hero art="characters" title="Characters" kicker="Your recurring actors" />
      <p className="lede cast-lede">
        The people H3 plays, the same in every shot.
        <span className="lede-small dim">
          Pick one in Create or Sequences and write <span className="mono">{'{char}'}</span> where they go.
        </span>
      </p>

      <datalist id="iv-loras">
        {loras.filter((l) => /h3|minimax/i.test(l)).map((l) => (
          <option key={l} value={l} />
        ))}
      </datalist>

      <section className="cast-section">
        <div className="cast-head">
          <h2>
            Your characters <span className="cast-count mono">{characters.length}</span>
          </h2>
          <p className="dim small">Ready to use in Create, Sequences and Replace. Click one to change its settings.</p>
        </div>
        <div className="cast-grid">
          {characters.map((c) => {
            const ok = found(c)
            const v = voiceOf(c)
            return (
              <div key={c.id} className="portrait">
                <button className="portrait-open" onClick={() => setEditing(c.id)} aria-label={`${c.name}: settings`}>
                  <span className="portrait-face">{face(c) ? <img src={fileUrl(face(c))} alt="" /> : <span className="portrait-initial">{c.name.slice(0, 1)}</span>}</span>
                  {!ok && <span className="portrait-flag mono">{isRef(c) ? 'RefMod missing' : 'LoRA missing'}</span>}
                  {ok && isRef(c) && <span className="portrait-flag mono ok">RefMod</span>}
                  <span className="portrait-body">
                    <span className="portrait-name">{c.name}</span>
                    <span className="portrait-meta mono">
                      {isRef(c) ? 'RefMod' : c.trigger} · {!v ? 'no voice' : v.name === c.name ? 'own voice' : v.name}
                    </span>
                  </span>
                </button>
                {ok && startShotWith && (
                  <button className="btn btn-small btn-primary portrait-action" onClick={() => startShotWith(c.id)}>
                    New shot
                  </button>
                )}
              </div>
            )
          })}
          <button className="portrait portrait-add" onClick={() => setAdding('choose')}>
            <span className="portrait-plus">+</span>
            <span className="portrait-name">Add from a LoRA or RefMod</span>
            <span className="dim small">One you already have in ComfyUI</span>
          </button>
        </div>
      </section>

      {offered.length > 0 && (
        <section className="cast-section">
          <div className="cast-head">
            <h2>Ready-made</h2>
            <p className="dim small">IV Studio's own invented characters. Download one and they join your characters.</p>
          </div>
          <div className="cast-grid">
            {offered.map((r) => (
              <div key={r.id} className="portrait portrait-ready">
                <span className="portrait-face">
                  <img src={fileUrl(r.picture)} alt={`${r.name}'s face`} />
                </span>
                <span className="portrait-body">
                  <span className="portrait-name">{r.name}</span>
                  {r.about && <span className="portrait-about small">{r.about}</span>}
                  {r.available ? (
                    <button className="btn btn-small btn-primary" disabled={progress[r.id] != null} onClick={() => install(r.id)}>
                      {downloadLabel(r.id, r.lora.size)}
                    </button>
                  ) : (
                    <span className="portrait-meta mono">Coming soon</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="cast-section train-own">
        <div className="cast-head">
          <h2>Train your own</h2>
          <p className="dim small">A new character, two ways. Only invented people, or real people who agreed to it.</p>
        </div>
        <div className="train-paths">
          <button className={`train-path ${path === 'lora' ? 'on' : ''}`} onClick={() => setPath(path === 'lora' ? null : 'lora')} aria-expanded={path === 'lora'}>
            <span className="train-path-icon">
              <LoraIcon />
            </span>
            <span className="train-path-name">Train a LoRA</span>
            <span className="train-path-chips mono">
              <span>Best likeness</span>
              <span>about 30 min</span>
              <span>$3–4 on cloud</span>
              {pcCanTrain && <span className="train-free">Free on your computer</span>}
            </span>
            <span className="dim small">Design an invented person, give them talking clips and a voice, then train their LoRA {pcCanTrain ? 'free on your own graphics card, or in the cloud in about half an hour' : 'on a cloud GPU (your RunPod or Modal account)'}.</span>
            <span className="train-path-steps mono">Design → Clips → Train → Pick</span>
          </button>
          <button className={`train-path ${path === 'refmod' ? 'on' : ''}`} onClick={() => setPath(path === 'refmod' ? null : 'refmod')} aria-expanded={path === 'refmod'}>
            <span className="train-path-icon">
              <RefModIcon />
            </span>
            <span className="train-path-name">Make a RefMod</span>
            <span className="train-path-chips mono">
              <span>Seconds</span>
              <span className="train-free">Free on your computer</span>
              <span>From your pictures</span>
            </span>
            <span className="dim small">Up to six pictures (and a voice clip) become a RefMod character. No training; it works in Create shots.</span>
            <span className="train-path-steps mono">Pictures → RefMod → Character</span>
          </button>
        </div>
        {path === 'lora' && (
          <form
            className="cast-new train-form"
            onSubmit={(e) => {
              e.preventDefault()
              if (name.trim()) create()
            }}
          >
            <label>
              <span className="mono label">Name</span>
              <input value={name} placeholder="e.g. Maya Ortiz" onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              <span className="mono label">Who</span>
              <input value={who} placeholder="a man in his fifties" onChange={(e) => setWho(e.target.value)} />
            </label>
            <button className="btn btn-primary" type="submit" disabled={!name.trim()}>
              Start designing
            </button>
          </form>
        )}
        {path === 'refmod' && (
          <div className="train-form">
            <RefModMaker
              notify={notify}
              onCancel={() => setPath(null)}
              onMade={async (c) => {
                setCharacters(await C.list())
                window.ivstudio.refmods.list().then(setRefmods, () => {})
                setPath(null)
                setEditing(c.id)
              }}
            />
          </div>
        )}
        {list?.length > 0 && (
          <>
            <p className="mono label cast-sub">
              Designs and trainings{unfinished > 0 && <span className="dim"> · {unfinished} not finished</span>}
            </p>
            <div className="cast-grid cast-grid-small">
              {list.map((t) => (
                <div key={t.id} className="portrait tile-wrap">
                  <button className="portrait-open" onClick={() => openCharacter(t.id)}>
                    <span className="portrait-face">{t.cover ? <img src={src(t.cover)} alt="" /> : <span className="portrait-initial">{t.name.slice(0, 1)}</span>}</span>
                    <span className={`portrait-flag mono ${t.characterId ? 'ok' : ''}`}>{t.characterId ? 'Trained' : t.state ? STATE_TEXT[t.state] || t.state : `Step: ${t.step}`}</span>
                    <span className="portrait-body">
                      <span className="portrait-name">{t.name}</span>
                      <span className="portrait-meta mono">{t.trigger}</span>
                    </span>
                  </button>
                  <TileDelete name={t.name} keeps={t.characterId ? 'The character preset and its LoRA stay; this removes the design stills, clips and dataset.' : 'This removes its design stills, clips and dataset.'} notify={notify} onDelete={async () => (await window.ivstudio.training.delete(t.id), setList(await window.ivstudio.training.list()))} />
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      {open && (
        <CharacterSettings
          c={open}
          face={face(open)}
          found={found(open)}
          isRef={isRef(open)}
          chooseRefMod={() => setAdding(open.id)}
          offer={ready.find((r) => r.id === open.id && r.available)}
          voices={voices}
          progress={progress[open.id]}
          downloadLabel={downloadLabel}
          picking={!!pickFor || !!adding}
          save={(patch) => saveCharacter(open.id, patch)}
          install={() => install(open.id)}
          chooseLora={() => setPickFor(open.id)}
          newShot={startShotWith ? () => startShotWith(open.id) : null}
          remove={async () => {
            setEditing(null)
            setCharacters(await C.save(characters.filter((x) => x.id !== open.id)))
          }}
          onClose={() => setEditing(null)}
        />
      )}
      {adding === 'choose' && <SourceChooser onClose={() => setAdding(null)} onLora={() => (setAdding(null), setPickFor('new'))} onRefMod={() => setAdding('refmod')} />}
      {adding && adding !== 'choose' && (
        <RefModPicker
          current={adding === 'refmod' ? null : characters.find((c) => c.id === adding)?.refmod}
          onClose={() => setAdding(null)}
          onPick={async ({ name: mod, title }) => {
            // a new character from the RefMod (its settings open next), or another RefMod for an existing one
            if (adding === 'refmod') {
              const id = `char${Date.now().toString(36)}`
              setCharacters(await C.save([...characters, { id, name: title, refmod: mod, strength: 1, trigger: '' }]))
              setEditing(id)
            } else await saveCharacter(adding, { refmod: mod })
            setAdding(null)
          }}
        />
      )}
      {pickFor && (
        <LoraPicker
          notify={notify}
          go={go}
          onClose={() => setPickFor(null)}
          onPick={async ({ name, words = [], title }) => {
            // a new character from the LoRA (its settings open next), or another LoRA for an existing one
            if (pickFor === 'new') {
              const id = `char${Date.now().toString(36)}`
              setCharacters(await C.save([...characters, { id, name: title || loraTitle(name), lora: name, strength: 0.8, trigger: words[0] || 'n4m3' }]))
              setEditing(id)
            } else await saveCharacter(pickFor, { lora: name, ...(words[0] ? { trigger: words[0] } : {}) })
            setPickFor(null)
          }}
        />
      )}
    </div>
  )
}

// One character's settings in a pop-up: name, trigger, strength, LoRA and voice. Changes save as you type.
function CharacterSettings({ c, face, found, isRef, chooseRefMod, offer, voices, progress, downloadLabel, picking, save, install, chooseLora, newShot, remove, onClose }) {
  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && !picking && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [picking])
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal cast-modal" role="dialog" aria-label={`${c.name} settings`}>
        <div className="cast-modal-face">{face ? <img src={fileUrl(face)} alt="" /> : <span className="portrait-initial">{c.name.slice(0, 1)}</span>}</div>
        <div className="cast-modal-body">
          <div className="cast-modal-top">
            <input className="cast-modal-name" value={c.name} aria-label="Name" onChange={(e) => save({ name: e.target.value })} />
            <button className="link-btn mono cast-modal-close" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>
          <div className="cast-modal-status">
            <span className={`mono small ${found ? 'cloud-ok' : 'pink'}`}>{isRef ? (found ? '● RefMod found in ComfyUI' : '● RefMod not in ComfyUI') : found ? '● LoRA found in ComfyUI' : '● LoRA not in ComfyUI'}</span>
            {!found && offer && (
              <button className="btn btn-small btn-primary" disabled={progress != null} onClick={install}>
                {downloadLabel(c.id, offer.lora.size)}
              </button>
            )}
          </div>

          <div className="cast-fields">
            {isRef ? (
              <div className="cast-field">
                <span className="mono label">In prompts</span>
                <span className="small">
                  <span className="mono">{'{char}'}</span> becomes <b>{c.name}</b>, and the RefMod shows H3 who that is.
                </span>
              </div>
            ) : (
              <label className="cast-field">
                <span className="mono label">Trigger word</span>
                <input className="mono" value={c.trigger} onChange={(e) => save({ trigger: e.target.value })} />
              </label>
            )}
            <label className="cast-field">
              <span className="mono label">
                Strength <span className="cast-value">{Number(c.strength).toFixed(2)}</span>
              </span>
              <input type="range" min={0} max={1.5} step={0.05} value={c.strength} onChange={(e) => save({ strength: Number(e.target.value) })} />
            </label>
            <div className="cast-field cast-field-wide">
              <span className="mono label">{isRef ? 'RefMod' : 'LoRA file'}</span>
              <div className="lora-field">
                {isRef ? <input className="mono" value={c.refmod} title={c.refmod} readOnly /> : <input list="iv-loras" value={c.lora} title={c.lora} onChange={(e) => save({ lora: e.target.value })} />}
                <button className="btn btn-small" onClick={isRef ? chooseRefMod : chooseLora}>
                  Choose
                </button>
              </div>
            </div>
            <label className="cast-field cast-field-wide">
              <span className="mono label">Voice</span>
              <select value={c.voiceId || ''} onChange={(e) => save({ voiceId: e.target.value || null, voiceDeclined: !e.target.value })}>
                <option value="">No voice</option>
                {voices.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="cast-modal-foot">
            <button
              className="link-btn mono danger"
              onClick={async () => (await ask({ title: `Delete “${c.name}”?`, message: `Only the preset goes; its ${isRef ? 'RefMod' : 'LoRA'} file stays in ComfyUI, and shots already made with it keep working.`, confirm: 'Delete', danger: true })) && remove()}
            >
              Delete
            </button>
            <span className="cast-modal-spacer" />
            {newShot && found && (
              <button className="btn btn-small" onClick={newShot}>
                New shot with {c.name.split(' ')[0]}
              </button>
            )}
            <button className="btn btn-small btn-primary" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// One character from design to a saved preset.
export function CharacterTrainer({ trainingId, notify, go, setCharacters, setup }) {
  const pcCanTrain = usePcCanTrain(setup)
  const [t, setT] = useState(null)
  const [meta, setMeta] = useState(null)
  const [step, setStep] = useState(null)
  const [busy, setBusy] = useState(null)
  const [log, setLog] = useState([])
  const live = useRef(true)

  const load = () => window.ivstudio.training.get(trainingId).then((x) => live.current && setT(x), (err) => notify(err.message))
  useEffect(() => {
    live.current = true
    window.ivstudio.training.meta().then(setMeta)
    load()
    const offChange = window.ivstudio.training.onChanged(({ id }) => id === trainingId && load())
    const offLog = window.ivstudio.training.onLog(({ id, line }) => id === trainingId && setLog((l) => [...l.slice(-300), line]))
    return () => {
      live.current = false
      offChange()
      offLog()
    }
  }, [trainingId])
  useEffect(() => {
    if (t && !step) setStep({ done: 'pick', pick: 'pick', train: 'train', clips: 'clips', design: 'design' }[stepOf(t)])
  }, [t])

  // Keep polling while renders are queued or running.
  const pending = t && Object.values(t.jobs || {}).some((j) => !DONE.includes(j.status))
  useEffect(() => {
    if (!pending) return
    const h = setInterval(load, 3000)
    return () => clearInterval(h)
  }, [pending])
  // A training that runs on Modal without this window streaming it: read its log from storage now and then.
  const detached = t?.train?.state === 'training'
  useEffect(() => {
    if (!detached) return
    const check = () => window.ivstudio.training.check(trainingId).catch(() => {})
    check()
    const h = setInterval(check, 60000)
    return () => clearInterval(h)
  }, [detached])

  async function act(label, fn) {
    setBusy(label)
    try {
      const r = await fn()
      if (r?.id === trainingId) await load()
      return r
    } catch (err) {
      notify(err.message)
    } finally {
      setBusy(null)
    }
  }

  if (!t || !meta || !step) return null
  const job = (id) => t.jobs?.[id]
  const save = (patch) => act('Saving', () => window.ivstudio.training.save(trainingId, patch))

  return (
    <div className="characters trainer">
      <Hero art="characters" help="character" title={t.name} kicker={`Character · trigger ${t.trigger}`} />
      <ol className="wizard-steps" aria-label="Steps">
        {STEPS.map(([id, label], i) => {
          const reached = STEPS.findIndex(([x]) => x === stepOf(t)) >= i
          return (
            <li key={id} className={`${step === id ? 'on' : ''} ${reached ? 'reached' : ''}`}>
              <button onClick={() => setStep(id)} aria-current={step === id ? 'step' : undefined}>
                <span className="wizard-n">{reached && step !== id && STEPS.findIndex(([x]) => x === stepOf(t)) > i ? '✓' : i + 1}</span>
                <span className="wizard-label">{label}</span>
                <span className="wizard-sub dim small">{STEP_SUB[id]}</span>
              </button>
            </li>
          )
        })}
      </ol>
      {busy && <p className="mono small dim">{busy}…</p>}

      {step === 'design' && <Design t={t} job={job} act={act} save={save} trainingId={trainingId} />}
      {step === 'clips' && <Clips t={t} job={job} act={act} save={save} trainingId={trainingId} meta={meta} notify={notify} next={() => setStep('train')} />}
      {step === 'train' && <Train t={t} act={act} meta={meta} log={log} go={go} trainingId={trainingId} next={() => setStep('pick')} pcCanTrain={pcCanTrain} />}
      {step === 'pick' && <Pick t={t} job={job} act={act} trainingId={trainingId} go={go} setCharacters={setCharacters} />}
    </div>
  )
}

function stepOf(t) {
  if (t.characterId || t.train?.state === 'done') return 'pick'
  if (t.train) return 'train'
  if (t.stills.some((s) => s.file)) return 'clips'
  return 'design'
}

// A render's picture or video, or how far it has got.
// A likeness score as a small badge: ArcFace cosine similarity with the picked face.
function Score({ value }) {
  if (value == null) return null
  const tone = value >= 0.5 ? 'good' : value >= 0.4 ? 'ok' : 'low'
  return <span className={`char-score ${tone}`} title="Face likeness with the picked face (InsightFace ArcFace): 0.6+ the same person, 0.4-0.6 a family resemblance, under 0.4 someone else">{value.toFixed(2)}</span>
}

// Scoring stills and clips against the picked face, after a one-time download of InsightFace's models.
function Likeness({ t, act, trainingId, pick }) {
  const [st, setSt] = useState(null)
  const [progress, setProgress] = useState(null)
  useEffect(() => {
    window.ivstudio.shinobi.status().then(setSt)
    return window.ivstudio.shinobi.onFaceProgress(setProgress)
  }, [])
  if (!st || !t.face) return null
  if (!st.faceModels)
    return (
      <div className="char-likeness">
        <p className="small">
          <span className="pink">Rank by likeness.</span> IV Studio can score every still and clip against the picked face and keep the closest, the way Tess's set was chosen. It uses InsightFace's face models (289 MB, downloaded once from InsightFace's release{st.installed ? '' : ', with Shinobi’s engine, about 440 MB'}). {st.faceLicence}
        </p>
        <button className="btn btn-small" onClick={() => act('Downloading the face models', () => window.ivstudio.shinobi.faceModels()).then(() => window.ivstudio.shinobi.status().then(setSt))}>
          {progress != null && progress < 1 ? `Downloading… ${Math.round(progress * 100)}%` : 'Download the face models'}
        </button>
      </div>
    )
  return (
    <div className="char-likeness">
      <button className="btn btn-small" onClick={() => act('Scoring likeness', () => window.ivstudio.training.rank(trainingId, { pick }))}>
        {pick ? 'Score and keep the closest of each scene' : 'Score against the face'}
      </button>
      {t.rankedAt && <span className="mono small dim">Scored {new Date(t.rankedAt).toLocaleTimeString()}. 0.5+ good · 0.4–0.5 fair · under 0.4 another face</span>}
    </div>
  )
}

function Render({ j, kind = 'image', onClick, picked, score }) {
  if (!j || !DONE.includes(j.status))
    return <div className="char-pending mono small dim">{j?.status === 'running' ? `Rendering${j.progress?.max ? ` ${Math.round((100 * j.progress.value) / j.progress.max)}%` : '…'}` : j?.queuePosition ? `Queued · ${j.queuePosition}` : 'Queued'}</div>
  if (j.status !== 'success') return <div className="char-pending mono small pink">{j.error || j.status}</div>
  const out = j.outputs.find((o) => o.kind === (kind === 'image' ? 'image' : 'preview'))
  if (!out) return <div className="char-pending mono small dim">No output</div>
  return kind === 'image' ? (
    <button className={`char-img ${picked ? 'picked' : ''}`} onClick={() => onClick?.(out)}>
      <img src={media(out.url)} alt="" />
      <Score value={score} />
    </button>
  ) : (
    <div className="char-video-wrap">
      <video className="char-video" src={media(out.url)} controls preload="metadata" />
      <Score value={score} />
    </div>
  )
}

function Design({ t, job, act, save, trainingId }) {
  const [faceText, setFaceText] = useState(t.faceText)
  const [who, setWho] = useState(t.who)
  const [trigger, setTrigger] = useState(t.trigger)
  const [caption, setCaption] = useState('')
  const T = window.ivstudio.training
  return (
    <>
      <section className="block create-step">
        <StepHead n={1} title="The face" />
        <div className="row">
          <span className="row-label">Who</span>
          <input value={who} onChange={(e) => setWho(e.target.value)} onBlur={() => who !== t.who && save({ who })} />
        </div>
        <div className="row">
          <span className="row-label">Trigger word</span>
          <input className="mono" value={trigger} onChange={(e) => setTrigger(e.target.value)} onBlur={() => trigger !== t.trigger && save({ trigger })} />
        </div>
        <p className="small dim">Made up, so H3 has no idea what it means until it learns this face. Prompts write {'{char}'} for it.</p>
        <span className="row-label">Face</span>
        <textarea rows={3} value={faceText} placeholder="e.g. oval face, light freckles across the nose, hazel eyes, straight dark brown shoulder-length hair with a side parting, thin eyebrows" onChange={(e) => setFaceText(e.target.value)} />
        <p className="small dim">Only the face and hair: age, face shape, eyes, skin, hair. It's used for the design stills only; captions never mention it, so the face binds to the trigger word.</p>
        <button className="btn btn-primary" onClick={() => act('Making four faces', () => T.designFaces(trainingId, { faceText, who }))}>
          {t.faceCandidates.length ? 'Make four more faces' : 'Make four faces'}
        </button>
        {t.faceCandidates.length > 0 && (
          <div className="char-grid">
            {t.faceCandidates.map((c) => (
              <Render key={c.jobId} j={job(c.jobId)} picked={t.face?.jobId === c.jobId} onClick={(file) => act('Picking', () => T.pickFace(trainingId, { jobId: c.jobId, file }))} />
            ))}
          </div>
        )}
        {t.face && <p className="small">Face picked. Every scene uses its seed and description, so they read as one person.</p>}
      </section>

      <section className="block create-step">
        <StepHead n={2} title="Scenes" />
        <p className="small dim">Eight stills in different places, clothes and light, so none of them welds to the trigger. Each scene has four candidates: pick the one that looks most like your face ("Two more" if none do), or leave the scene out. A weak still teaches the LoRA a blend.</p>
        {t.stills.length > 0 && <Likeness t={t} act={act} trainingId={trainingId} pick />}
        {t.face && !t.stills.some((s) => s.source === 'generated') && (
          <button className="btn btn-primary" onClick={() => act('Making the scenes', () => T.designScenes(trainingId))}>
            Make the scene stills
          </button>
        )}
        {t.stills.map((s) => (
          <div key={s.id} className="char-still">
            <div className="char-grid">
              {s.source === 'upload' ? (
                <span className="char-img picked">
                  <img src={src(s.file)} alt="" />
                </span>
              ) : (
                s.candidates.map((c, k) => <Render key={c.jobId} j={job(c.jobId)} picked={s.pick === k} score={c.score} onClick={(file) => act('Picking', () => T.pickStill(trainingId, s.id, { pick: k, file }))} />)
              )}
            </div>
            <div className="char-still-side">
              <input className="small" defaultValue={s.caption} onBlur={(e) => e.target.value !== s.caption && act('Saving', () => T.setCaption(trainingId, 'still', s.id, e.target.value))} />
              <div className="row-actions">
                {s.source === 'generated' && (
                  <>
                    <button className="link-btn mono" onClick={() => act('Rendering', () => T.rerollStill(trainingId, s.id))}>
                      Two more
                    </button>
                    <button className="link-btn mono" onClick={() => act('Saving', () => T.pickStill(trainingId, s.id, { pick: null }))}>
                      Leave out
                    </button>
                  </>
                )}
                {s.source === 'upload' && (
                  <button className="link-btn mono" onClick={() => act('Removing', () => T.removeItem(trainingId, 'still', s.id))}>
                    Remove
                  </button>
                )}
                <span className={`mono small ${s.file ? 'cloud-ok' : 'dim'}`}>{s.file ? '● In the set' : 'Not in the set'}</span>
              </div>
            </div>
          </div>
        ))}
      </section>

      <section className="block create-step">
        <StepHead n={3} title="Or your own pictures" />
        <label className="me-snap small">
          <input type="checkbox" checked={!!t.consent} onChange={(e) => save({ consent: e.target.checked })} /> These pictures and clips are of an invented person, or of someone who agreed to be trained
        </label>
        <div className="row">
          <span className="row-label">Caption</span>
          <input value={caption} placeholder="what's in them: clothes, place, framing (never the face)" onChange={(e) => setCaption(e.target.value)} />
        </div>
        <button className="btn btn-small" disabled={!t.consent} onClick={() => act('Adding', () => T.addStills(trainingId, caption))}>
          + Add pictures
        </button>
      </section>
    </>
  )
}

function Clips({ t, job, act, save, trainingId, meta, notify, next }) {
  const [lines, setLines] = useState(meta.talks.map((x) => x.line))
  const [caption, setCaption] = useState('')
  const [editing, setEditing] = useState(false)
  const T = window.ivstudio.training
  const kept = t.stills.filter((s) => s.file).length
  const voice = t.voice?.path ? { kind: 'audio', path: t.voice.path, source: t.voice.source, edit: t.voice.edit, info: t.voice.info } : null
  const [voices, setVoices] = useState([])
  useEffect(() => {
    window.ivstudio.voices.list().then(setVoices, () => {})
  }, [])
  async function pickVoice() {
    const [file] = await window.ivstudio.files.pick('audio')
    if (file) save({ voice: { path: file, info: await window.ivstudio.media.probe(file).catch(() => null) } })
  }
  return (
    <>
      <section className="block create-step">
        <StepHead n={1} title="Voice (optional)" />
        <p className="small dim">One of your voices (design one under Audio › Voices) or a clean recording; never a real person's voice without their consent. The clips speak with it, so the LoRA learns it too. 10–30 seconds is plenty.</p>
        {voice ? (
          <div className="voice-control">
            <MediaTile item={voice} label="Voice" onEdit={() => setEditing(true)} onRemove={() => save({ voice: null })} />
          </div>
        ) : (
          <div className="row-actions">
            <button className="btn btn-small" onClick={pickVoice}>
              + Voice recording
            </button>
            {voices.length > 0 && (
              <select value="" onChange={async (e) => {
                const v = voices.find((x) => x.id === e.target.value)
                if (v) save({ voice: { path: v.reference, info: await window.ivstudio.media.probe(v.reference).catch(() => null) } })
              }}>
                <option value="">or one of your voices…</option>
                {voices.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
        {editing && voice && (
          <MediaEditor
            item={voice}
            hint="Keep a clean stretch of the voice, without music or other people."
            onApply={(v) => (save({ voice: { path: v.path, source: v.source, edit: v.edit, info: v.info } }), setEditing(false))}
            onClose={() => setEditing(false)}
            notify={notify}
          />
        )}
      </section>

      <section className="block create-step">
        <StepHead n={2} title="Talking clips" />
        <p className="small dim">
          Clips teach how they move and talk. IV Studio renders them with H3 on this computer from two of your stills{voice ? ' and the voice' : ''}: eight 5-second clips, about a minute each. Edit the lines if you like.
        </p>
        {!t.clips.some((c) => c.source === 'generated') && (
          <>
            <div className="char-lines">
              {meta.talks.map((x, k) => (
                <div key={k} className="row">
                  <span className="row-label small dim">{x.scene.split(',')[0]}</span>
                  <input value={lines[k]} onChange={(e) => setLines(lines.map((l, j) => (j === k ? e.target.value : l)))} />
                </div>
              ))}
            </div>
            <button className="btn btn-primary" disabled={kept < 2} onClick={() => act('Queuing the clips', () => T.makeClips(trainingId, { talks: meta.talks.map((x, k) => ({ ...x, line: lines[k] })) }))}>
              Render the talking clips
            </button>
            {kept < 2 && <p className="small pink">Keep at least two stills in Design first.</p>}
          </>
        )}
        <div className="char-clips">
          {t.clips.map((c) => (
            <div key={c.id} className={`char-clip ${c.keep ? '' : 'left-out'}`}>
              {c.source === 'upload' ? <video className="char-video" src={src(c.file)} controls preload="metadata" /> : <Render j={job(c.jobId)} kind="video" score={c.score} />}
              <input className="small" defaultValue={c.caption} onBlur={(e) => e.target.value !== c.caption && act('Saving', () => T.setCaption(trainingId, 'clip', c.id, e.target.value))} />
              <div className="row-actions">
                <label className="me-snap small">
                  <input type="checkbox" checked={c.keep} onChange={(e) => act('Saving', () => T.keepClip(trainingId, c.id, e.target.checked))} /> In the set
                </label>
                {c.source === 'upload' ? (
                  <button className="link-btn mono" onClick={() => act('Removing', () => T.removeItem(trainingId, 'clip', c.id))}>
                    Remove
                  </button>
                ) : (
                  DONE.includes(job(c.jobId)?.status) && (
                    <button className="link-btn mono" onClick={() => act('Rendering again', () => T.remakeClips(trainingId, [c.id]))}>
                      Render again
                    </button>
                  )
                )}
              </div>
            </div>
          ))}
        </div>
        {t.clips.some((c) => c.file) && <Likeness t={t} act={act} trainingId={trainingId} />}
        <p className="small dim">If the face drifts or the mouth smears, render that clip again or leave it out. Every clip uses the picked face as its main reference.</p>
      </section>

      <section className="block create-step">
        <StepHead n={3} title="Or your own clips" />
        <p className="small dim">Phone videos or generations (Seedance, Kling…) of the same person talking. Long clips are cut into 5-second pieces and fitted to H3's frame grid.</p>
        <div className="row">
          <span className="row-label">Caption</span>
          <input value={caption} placeholder="clothes, place, action, framing (never the face or voice)" onChange={(e) => setCaption(e.target.value)} />
        </div>
        <button className="btn btn-small" disabled={!t.consent} onClick={() => act('Adding', () => T.addClips(trainingId, caption))}>
          + Add clips
        </button>
        {!t.consent && <p className="small dim">Tick the consent box in Design first.</p>}
      </section>
      <button className="btn btn-primary" onClick={next}>
        Next: train
      </button>
    </>
  )
}

// The Train step: the set, the recipe (a preset plus what it learns, detail, look and checkpoints, with the rest
// under Advanced), where it trains with an optional spending cap, then progress and Train more.
const PRESET_ORDER = ['quick', 'standard', 'thorough']
const PRESET_TEXT = {
  quick: ['Quick', 'Rank 8, a shorter run. Likeness early, and tends to stay flexible.'],
  standard: ['Standard', 'What Tess and Theo trained with.'],
  thorough: ['Thorough', 'Half as long again, for a big set or when Standard looks unfinished.']
}
const BUDGETS = [null, 3, 5, 10]
const MORE = [10, 20, 40]
const PRESET_RANK = { quick: 8, standard: 16, thorough: 16 }
export function usePcCanTrain(setup) {
  const [scan, setScan] = useState(undefined)
  useEffect(() => {
    window.ivstudio.settings
      .get()
      .then((s) => setScan(s.hardware ? (s.hardware.canTrain ?? ['top', 'all', 'most'].includes(s.hardware.tier)) : null))
      .catch(() => setScan(null))
  }, [])
  if (scan !== null && scan !== undefined) return scan
  const gpu = setup?.items?.find((i) => i.id === 'gpu')?.detail || ''
  const gb = Number(/(\d+(?:\.\d+)?)\s*GB/i.exec(gpu)?.[1] || 0)
  return /nvidia|geforce|rtx/i.test(gpu) && gb >= 16
}

const PLACES = {
  local: { name: 'This computer', who: 'Your graphics card' },
  runpod: { name: 'RunPod', who: 'Your RunPod account' },
  modal: { name: 'Modal', who: 'Your Modal account' }
}

function Seg({ label, value, options, onChange, disabled, hint }) {
  return (
    <div className="train-row">
      <span className="train-row-label mono small">{label}</span>
      <div>
        <div className="segmented wrap">
          {options.map(([v, text]) => (
            <button key={String(v)} className={value === v ? 'on' : ''} disabled={disabled} onClick={() => onChange(v)}>
              {text}
            </button>
          ))}
        </div>
        {hint && <p className="dim small train-row-hint">{hint}</p>}
      </div>
    </div>
  )
}

function Train({ t, act, meta, log, go, trainingId, next, pcCanTrain }) {
  const [opts, setOpts] = useState(() => ({ ...(meta.trainDefaults || {}), ...(pcCanTrain ? { where: 'local' } : {}), ...(t.train?.options || {}) }))
  const where = opts.where || 'modal'
  // the PC check can land after the first draw: a new training then moves to This PC
  useEffect(() => {
    if (pcCanTrain && !t.train?.options?.where) setOpts((o) => ({ ...o, where: 'local' }))
  }, [pcCanTrain])
  const gpus = meta.gpusBy?.[where] || meta.gpus
  const [gpuPick, setGpu] = useState(t.train?.gpu || 'H200')
  const gpu = gpus.some((g) => g.id === gpuPick) ? gpuPick : where === 'modal' ? 'H200' : gpus[0].id
  const [local, setLocal] = useState(null)
  const [epochs, setEpochs] = useState('') // blank: the preset's own
  const [customBudget, setCustomBudget] = useState('')
  const [advanced, setAdvanced] = useState(false)
  const [est, setEst] = useState(t.estimate)
  const [more, setMore] = useState(20)
  const [moreEst, setMoreEst] = useState(null)
  const [cloud, setCloud] = useState(null)
  const logEl = useRef(null)
  const T = window.ivstudio.training
  const set = (patch) => setOpts((o) => ({ ...o, ...patch }))
  useEffect(() => {
    window.ivstudio.cloud.status().then(setCloud)
  }, [])
  const checkLocal = () => T.localCheck().then(setLocal, (e) => setLocal({ error: e.message }))
  useEffect(() => {
    if (where === 'local') checkLocal()
  }, [where])
  useEffect(() => {
    T.estimate(trainingId, { gpu, epochs: Number(epochs) || undefined, options: opts }).then(setEst, () => {})
  }, [gpu, epochs, JSON.stringify(opts), t.updatedAt])
  useEffect(() => {
    logEl.current?.scrollTo(0, logEl.current.scrollHeight)
  }, [log])
  const kept = t.stills.filter((s) => s.file).length
  const clips = t.clips.filter((c) => c.keep && c.file).length
  const st = t.train?.state
  const running = RUNNING.includes(st)
  const p = t.train?.progress
  const readyBy = {
    modal: !!(cloud?.toolkit && cloud?.workspace),
    runpod: !!cloud?.runpod?.hasKey,
    local: !!(local?.fizgig && local?.missing && !local.missing.length)
  }
  const ready = readyBy[where]
  const free = where === 'local'
  const canMore = ['done', 'stopped'].includes(st) && t.train?.name
  useEffect(() => {
    if (canMore) T.estimate(trainingId, { gpu, more, options: { ...t.train.options, budget: opts.budget } }).then(setMoreEst, () => {})
  }, [canMore, gpu, more, opts.budget])
  const budgetLabel = opts.budget ? `$${opts.budget}` : 'No cap'

  async function start(extra) {
    const e = extra ? moreEst : est
    if (!e) return
    const yes = await ask({
      kicker: free ? 'On this computer, free' : `Uses your ${PLACES[where].name} account`,
      title: extra ? `Train ${t.name} ${extra} more epochs?` : `Train ${t.name}?`,
      message: free
        ? 'Fizgig trains on your graphics card. Don’t render while it trains; it keeps going if you close IV Studio.'
        : where === 'runpod'
          ? `RunPod bills by the second. The first run also downloads the H3 training files into your volume (about 42 GB, 10 to 20 minutes of GPU). The pod removes itself half an hour after training ends${opts.budget ? `, and training stops at your $${opts.budget} cap` : ''}.`
          : `Modal bills by the second and stops the GPU when training ends${opts.budget ? `, or at your $${opts.budget} cap (even if IV Studio is closed)` : ''}.`,
      details: [
        ['Recipe', extra ? `carries on from epoch ${t.train.epochs}, same recipe` : `${PRESET_TEXT[opts.preset || 'standard'][0]} · rank ${est.rank} · ${est.epochs} epochs · ${opts.learn === 'look' ? 'look only' : 'look and voice'}${opts.detail === 'fine' ? ' · fine detail' : ''}${opts.mode === 'whole' ? ' · whole look' : ''}`],
        ['Where', free ? 'This computer' : `${PLACES[where].name} · ${gpus.find((g) => g.id === gpu)?.label || gpu}`],
        ...(where === 'modal' ? [['Workspace', cloud.workspace]] : []),
        ['Time', `about ${e.minutes} minutes (${e.steps} steps)${free ? ', a first estimate here' : ''}`],
        ['Cost', free ? 'free' : `about $${e.dollars}${opts.budget && e.dollars > opts.budget ? `, capped at $${opts.budget}` : ''}`]
      ],
      confirm: extra ? 'Train more' : 'Start training'
    })
    if (!yes) return
    act('Starting', () => T.start(trainingId, extra ? { gpu, more: extra, options: { budget: free ? null : opts.budget } } : { gpu, epochs: Number(epochs) || undefined, options: { ...opts, budget: free ? null : opts.budget } }))
  }

  return (
    <>
      <section className="block create-step">
        <StepHead n={1} title="The set" sub={`${kept} still${kept === 1 ? '' : 's'} and ${clips} talking clip${clips === 1 ? '' : 's'}`} />
        <p className="small dim">Claire had 8 stills, 7 face crops and 14 clips; Tess 15, 15 and 48 voice clips. 6–10 stills and 8–14 clips is a good start.</p>
        {(kept < 4 || kept + clips < 8) && <p className="small pink">Too few to learn a face yet: keep at least 4 stills and 8 items in all.</p>}
        <button className="link-btn mono" onClick={() => act('Building the dataset', () => T.openDataset(trainingId))}>
          Open the dataset folder (to train in Fizgig yourself) ↗
        </button>
      </section>

      <section className="block create-step">
        <StepHead n={2} title="The recipe" sub="Fizgig’s own H3 recipes. Standard suits most characters." />
        <div className="train-presets">
          {PRESET_ORDER.map((k) => {
            const pe = est?.presets?.[k]
            return (
              <button key={k} className={`train-preset ${(opts.preset || 'standard') === k ? 'on' : ''}`} disabled={running} onClick={() => (set({ preset: k }), setEpochs(''))}>
                {k === 'standard' && <span className="wel-rec mono">Default</span>}
                <h3>{PRESET_TEXT[k][0]}</h3>
                {pe && (
                  <span className="mono small train-preset-cost">
                    {pe.epochs} epochs · ~{pe.minutes} min · {free ? 'free' : `~$${pe.dollars}`}
                  </span>
                )}
                <p className="dim small">{PRESET_TEXT[k][1]}</p>
              </button>
            )
          })}
        </div>
        <div className="train-rows">
          <Seg
            label="What it learns"
            value={opts.learn || 'look_voice'}
            onChange={(v) => set({ learn: v })}
            disabled={running}
            options={[
              ['look_voice', 'Look and voice'],
              ['look', 'Look only']
            ]}
            hint={opts.learn === 'look' ? 'Stills only: cheaper and quicker. Shots then use the voice you give them.' : 'Stills and the talking clips: their face, how they move and how they sound.'}
          />
          <Seg
            label="Detail"
            value={opts.detail || 'normal'}
            onChange={(v) => set({ detail: v })}
            disabled={running}
            options={[
              ['normal', 'Normal'],
              ['fine', 'Fine detail']
            ]}
            hint={opts.detail === 'fine' ? 'About 0.5 MP: small things like scars, tattoos and jewellery hold better. About twice the time and cost.' : '0.25 MP, Fizgig’s tested default.'}
          />
          <Seg
            label="Focus"
            value={opts.mode || 'likeness'}
            onChange={(v) => set({ mode: v })}
            disabled={running}
            options={[
              ['likeness', 'The person'],
              ['whole', 'Their whole look']
            ]}
            hint={opts.mode === 'whole' ? 'Reaches more of the model (Fizgig’s More Blocks): their style and movement too, with less of what H3 already knows kept.' : 'H3’s identity blocks only (Fizgig’s Default): the best likeness, soonest, and H3 keeps its own range.'}
          />
          <Seg
            label="Checkpoints"
            value={Number(opts.checkpoints) || 20}
            onChange={(v) => set({ checkpoints: v })}
            disabled={running}
            options={[
              [10, 'About 10'],
              [20, 'About 20'],
              [40, 'About 40']
            ]}
          />
        </div>
        <button className="link-btn mono train-adv-toggle" onClick={() => setAdvanced((a) => !a)} aria-expanded={advanced}>
          {advanced ? '− Advanced' : '+ Advanced: rank, epochs, seed, captions, schedule'}
        </button>
        {advanced && (
          <div className="train-rows train-adv">
            <Seg
              label="Rank"
              value={opts.rank ?? null}
              onChange={(v) => set({ rank: v })}
              disabled={running}
              options={[
                [null, `Preset (${PRESET_RANK[opts.preset || 'standard']})`],
                [8, '8'],
                [16, '16'],
                [32, '32']
              ]}
              hint="Higher holds more detail in a bigger file, and can be less flexible."
            />
            <div className="train-row">
              <span className="train-row-label mono small">Epochs</span>
              <div className="train-inline">
                <input className="mini" type="number" min={10} max={200} placeholder={String(est?.presets?.[opts.preset || 'standard']?.epochs ?? '')} value={epochs} disabled={running} onChange={(e) => setEpochs(e.target.value)} />
                <span className="dim small">Blank: the preset’s own, from the size of the set.</span>
              </div>
            </div>
            <div className="train-row">
              <span className="train-row-label mono small">Seed</span>
              <input className="mini" type="number" min={0} value={opts.seed ?? 42} disabled={running} onChange={(e) => set({ seed: Number(e.target.value) })} />
            </div>
            <Seg
              label="Caption dropout"
              value={opts.captionDropout ?? 0.05}
              onChange={(v) => set({ captionDropout: v })}
              disabled={running}
              options={[
                [0, 'Off'],
                [0.05, '0.05'],
                [0.1, '0.10 (strong)']
              ]}
              hint="How often a step trains without its caption, so the trigger carries more of the look."
            />
            <Seg
              label="Schedule"
              value={opts.cleanEnd ?? 60}
              onChange={(v) => set({ cleanEnd: v })}
              disabled={running}
              options={[
                [60, 'Likeness and style'],
                [8, 'Movement']
              ]}
              hint="Fizgig’s clean-end share: 60% of steps on nearly clean pictures (the tuned default), or 8%, weighted to movement and composition."
            />
            <Seg
              label="Base precision"
              value={opts.precision || 'auto'}
              onChange={(v) => set({ precision: v })}
              disabled={running}
              options={[
                ['auto', 'Auto'],
                ['int8', 'Accurate (int8)']
              ]}
              hint="Auto lets Fizgig fit the card; on a 24 GB card it can drop to a 4-bit base, which is quicker but a little less accurate. int8 is the checkpoint’s own base, as the cloud GPUs train on."
            />
          </div>
        )}
      </section>

      <section className="block create-step">
        <StepHead n={3} title="Where it trains" sub="Free on your own graphics card, or rented by the second." />
        <div className="train-presets train-places">
          {['local', 'runpod', 'modal'].map((w) => {
            const list = meta.gpusBy?.[w] || []
            const from = list.length ? Math.min(...list.map((g) => g.perHour)) : 0
            return (
              <button key={w} className={`train-preset ${where === w ? 'on' : ''}`} disabled={running} onClick={() => set({ where: w })}>
                {readyBy[w] ? <span className="wel-rec mono cw-ready">Ready</span> : w === 'local' && pcCanTrain ? <span className="wel-rec mono cw-ready">Your computer can</span> : null}
                <h3>{PLACES[w].name}</h3>
                <span className="mono small train-preset-cost">{w === 'local' ? 'Free' : `from $${from.toFixed(2)} an hour`}</span>
                <p className="dim small">
                  {w === 'local'
                    ? 'Fizgig on your graphics card. A few hours; don’t render meanwhile.'
                    : w === 'runpod'
                      ? 'Your RunPod account, by the second. Its storage costs about $5.60 a month while it’s kept.'
                      : 'Your Modal account, by the second. Theo trained here in 56 minutes for about $4.10.'}
                </p>
              </button>
            )
          })}
        </div>
        {!ready && where === 'modal' && (
          <p className="small train-ready-note">
            Training runs on your own Modal account.{' '}
            <button className="link-btn" onClick={() => go('cloud')}>
              Set up the Cloud tools and sign in first
            </button>{' '}
            (steps 1 and 2 on the Cloud page; you don't need the rest).
          </p>
        )}
        {!ready && where === 'runpod' && (
          <p className="small train-ready-note">
            Add your RunPod API key first.{' '}
            <button className="link-btn" onClick={() => window.dispatchEvent(new CustomEvent('iv:cloud-wizard'))}>
              Connect RunPod
            </button>{' '}
            (only the account step; training sets up its own storage).
          </p>
        )}
        {where === 'local' && local && !ready && (
          <div className="small train-ready-note">
            {!local.fizgig ? (
              <p>
                Training here uses Fizgig.{' '}
                <button className="link-btn" onClick={() => window.ivstudio.links.open('https://github.com/shootthesound/Fizgig')}>
                  Install Fizgig
                </button>
                , then{' '}
                <button className="link-btn" onClick={() => act('Checking Fizgig', async () => (await T.chooseFizgig()) && checkLocal())}>
                  pick its folder
                </button>
                .
              </p>
            ) : local.error ? (
              <p>{local.error}</p>
            ) : (
              <p>These H3 training files aren’t in this computer’s ComfyUI yet: {local.missing.join(', ')}.</p>
            )}
          </div>
        )}
        {where === 'local' && local?.fizgig && <p className="mono small dim">Fizgig: {local.fizgig}</p>}
        {!free && (
          <div className="cloud-gpus">
            {gpus.map((g) => (
              <button key={g.id} className={`mode-card ${gpu === g.id ? 'on' : ''}`} disabled={running} onClick={() => setGpu(g.id)}>
                <span className="mode-name">{g.label}</span>
                <span className="mono">${g.perHour.toFixed(2)} an hour, by the second</span>
                <span className="dim small">{g.note}</span>
              </button>
            ))}
          </div>
        )}
        {!free && <div className="train-rows">
          <div className="train-row">
            <span className="train-row-label mono small">Spending cap</span>
            <div>
              <div className="train-inline">
                <div className="segmented wrap">
                  {BUDGETS.map((b) => (
                    <button key={String(b)} className={(opts.budget ?? null) === b && !customBudget ? 'on' : ''} disabled={running} onClick={() => (set({ budget: b }), setCustomBudget(''))}>
                      {b ? `$${b}` : 'No cap'}
                    </button>
                  ))}
                </div>
                <input
                  className="mini"
                  type="number"
                  min={0.5}
                  step={0.5}
                  placeholder="$"
                  aria-label="Your own cap in dollars"
                  value={customBudget}
                  disabled={running}
                  onChange={(e) => (setCustomBudget(e.target.value), set({ budget: Number(e.target.value) > 0 ? Number(e.target.value) : null }))}
                />
              </div>
              <p className="dim small train-row-hint">Training stops itself at the cap, even if IV Studio is closed, and keeps the checkpoints saved so far.</p>
            </div>
          </div>
        </div>}
        {est && kept >= 4 && (
          <p className="train-sum">
            {free ? (
              <>
                About <span className="pink">{est.minutes} minutes</span> on your graphics card, free (a first estimate; the run measures it): {est.epochs} epochs, {est.steps} steps, rank {est.rank}, about {est.checkpoints} checkpoints.
              </>
            ) : (
              <>
                About <span className="pink">{est.minutes} minutes</span> and <span className="pink">${est.dollars}</span> of {PLACES[where].name} time: {est.epochs} epochs, {est.steps} steps, rank {est.rank}, about {est.checkpoints} checkpoints.
                {est.capped && <span className="pink"> Your {budgetLabel} cap stops it before the end; the checkpoints saved by then stay.</span>} The GPU stops by itself when training ends.
              </>
            )}
          </p>
        )}
        {!running && (
          <button className="btn btn-primary" disabled={!ready || kept < 4 || !est} onClick={() => start()}>
            {st ? 'Train again from the start' : 'Start training'}
          </button>
        )}
      </section>

      {st && (
        <section className="block create-step">
          <StepHead n={4} title="Progress" />
          <p className="small">
            {STATE_TEXT[st] || st}
            {p?.epoch ? ` · epoch ${p.epoch} of ${p.epochs}` : p?.stage ? ` · ${p.stage}` : ''}
          </p>
          {p?.epoch && (
            <div className="char-progress">
              <span style={{ width: `${(100 * p.epoch) / p.epochs}%` }} />
            </div>
          )}
          {t.train.budgetHit && <p className="small pink">It reached your spending cap and stopped; the checkpoints saved by then are ready to test.</p>}
          {t.train.error && <p className="small pink">{t.train.error}</p>}
          {st === 'training' && <p className="small dim">It keeps training {t.train.where === 'local' ? 'on this computer' : `on ${PLACES[t.train.where || 'modal'].name}`} if you close IV Studio; come back here to see how far it got.</p>}
          {running && (
            <button className="link-btn mono" onClick={async () => (await ask({ title: 'Stop training?', message: 'Billing stops at once. The epochs saved so far stay in your Modal storage.', confirm: 'Stop training', danger: true })) && act('Stopping', () => T.stop(trainingId))}>
              Stop training
            </button>
          )}
          {st === 'done' && (
            <button className="btn btn-primary" onClick={next}>
              Next: pick the best checkpoint
            </button>
          )}
          {canMore && (
            <div className="train-more">
              <div>
                <h3>Train more</h3>
                <p className="dim small">Not quite there? Carry on from where it stopped (epoch {t.train.epochs}), with the same recipe. The new checkpoints join the list.</p>
              </div>
              <div className="train-inline">
                <div className="segmented">
                  {MORE.map((m) => (
                    <button key={m} className={more === m ? 'on' : ''} onClick={() => setMore(m)}>
                      +{m} epochs
                    </button>
                  ))}
                </div>
                {moreEst && <span className="mono small dim">~{moreEst.minutes} min · {t.train.where === 'local' ? 'free' : `~$${moreEst.dollars}`}</span>}
                <button className="btn" disabled={!ready || !moreEst} onClick={() => start(more)}>
                  Train {more} more
                </button>
              </div>
            </div>
          )}
          {log.length > 0 && (
            <pre className="code cloud-log" ref={logEl}>
              {log.join('\n')}
            </pre>
          )}
        </section>
      )}
    </>
  )
}

function Pick({ t, job, act, trainingId, go, setCharacters }) {
  const T = window.ivstudio.training
  const epochs = t.checkpoints.map((c) => c.epoch)
  const last = epochs.at(-1)
  const suggested = [...new Set([Math.round(last * 0.5), Math.round(last * 0.75), last].map((e) => epochs.reduce((a, b) => (Math.abs(b - e) < Math.abs(a - e) ? b : a), epochs[0])))].filter(Boolean)
  const [chosen, setChosen] = useState(suggested)
  if (!t.train || t.train.state !== 'done') return <p className="small dim">Train first; the checkpoints show up here when it's done.</p>
  async function test() {
    await act('Downloading the checkpoints', () => T.fetch(trainingId, chosen))
    await act('Rendering the tests', () => T.test(trainingId, { epochs: chosen }))
  }
  async function score() {
    await act('Scoring the tests for likeness', () => T.score(trainingId))
  }
  async function adopt(epoch) {
    await act('Saving the character', () => T.adopt(trainingId, epoch))
    setCharacters(await window.ivstudio.characters.list())
  }
  return (
    <>
      <section className="block create-step">
        <StepHead n={1} title="Test checkpoints" />
        <p className="small dim">Training saved a checkpoint every few epochs. Trainer previews mislead, so judge them in H3 itself: the same shot and seed for each. Late epochs often look best.</p>
        <div className="char-epochs">
          {epochs.map((e) => (
            <button key={e} className={`mono ${chosen.includes(e) ? 'on' : ''}`} onClick={() => setChosen(chosen.includes(e) ? chosen.filter((x) => x !== e) : [...chosen, e].sort((a, b) => a - b))}>
              {e}
            </button>
          ))}
        </div>
        <button className="btn btn-primary" disabled={!chosen.length} onClick={test}>
          Test {chosen.length} checkpoint{chosen.length === 1 ? '' : 's'}
        </button>
      </section>
      {t.tests.length > 0 && (
        <section className="block create-step">
          <StepHead n={2} title="Choose one" sub="Watch them. The likeness scores compare three frames of each with the picked face: a guide, not a verdict." />
          <div className="train-score-row">
            <button className="btn btn-small" disabled={!t.tests.some((x) => job(x.jobId)?.status === 'success')} onClick={score}>
              {t.scoredAt ? 'Score them again' : 'Score them for likeness'}
            </button>
            {t.bestEpoch != null && <span className="mono small">Closest to the face: epoch {t.bestEpoch}</span>}
          </div>
          <div className="char-clips">
            {[...t.tests].sort((a, b) => a.epoch - b.epoch).map((x) => (
              <div key={x.epoch} className={`char-clip ${t.chosenEpoch === x.epoch ? 'chosen' : ''} ${t.bestEpoch === x.epoch ? 'best' : ''}`}>
                {t.bestEpoch === x.epoch && <span className="wel-rec mono train-best">Best likeness</span>}
                <Render j={job(x.jobId)} kind="video" />
                <div className="row-actions">
                  <span className="mono">
                    Epoch {x.epoch}
                    {x.score != null && <span className="dim"> · likeness {x.score.toFixed(2)}</span>}
                  </span>
                  <button className="btn btn-small" disabled={job(x.jobId)?.status !== 'success'} onClick={() => adopt(x.epoch)}>
                    {t.chosenEpoch === x.epoch ? 'Chosen ✓' : 'Use this one'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
      {t.characterId && (
        <section className="block create-step">
          <p className="small">
            <span className="cloud-ok">●</span> {t.name} is a character now (epoch {t.chosenEpoch} at 0.8). Pick them in Create or Sequences, and write {'{char}'} in the prompt.
          </p>
          <button className="btn btn-primary" onClick={() => go('create')}>
            Make a shot with {t.name.split(' ')[0]}
          </button>
        </section>
      )}
    </>
  )
}
