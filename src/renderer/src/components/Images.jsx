import { useEffect, useMemo, useState } from 'react'
import Hero from './Hero'
import { LoraPicker, LoraThumb, loraTitle, useYours } from './Loras'
import { fileUrl } from './edit/model'
import { ask } from './Confirm'
import { AspectTiles, DropIcon, ImageModeIcon, StepHead } from './CreateKit'
import PictureTools from './PictureTools'
import HfLogin from './HfLogin'

const I = () => window.ivstudio.images
const MODES = [
  ['generate', 'Generate', 'Make pictures from a prompt.'],
  ['edit', 'Edit', 'Change a picture with an instruction. Only models that can edit.'],
  ['tools', 'Tools', 'Inpaint, relight, remove the background, upscale, depth map.']
]
const ASPECTS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9']
const SIZES = [0.5, 1, 1.5, 2]
const DONE = ['success', 'error', 'cancelled']
const FORM_KEY = 'iv.imageForm'
const fresh = () => ({ mode: 'generate', family: null, model: null, prompt: '', negative: '', loras: [], aspect: '1:1', megapixels: 1, count: 1, seed: '', steps: '', cfg: '', refs: [] })
const savedForm = () => {
  try {
    return { ...fresh(), ...JSON.parse(localStorage.getItem(FORM_KEY) || '{}') }
  } catch {
    return fresh()
  }
}
const shortName = (model) => String(model).split(/[\\/]/).pop().replace(/\.(safetensors|gguf)$/i, '')
const sizeOf = (aspect, mp) => {
  const ar = { '1:1': 1, '16:9': 16 / 9, '9:16': 9 / 16, '4:3': 4 / 3, '3:4': 3 / 4, '3:2': 3 / 2, '2:3': 2 / 3, '21:9': 21 / 9 }[aspect] || 1
  const px = mp * 1024 * 1024
  return [Math.round(Math.sqrt(px * ar) / 32) * 32, Math.round(Math.sqrt(px / ar) / 32) * 32]
}

const GB = (b) => `${(b / 1024 ** 3).toFixed(1)} GB`
const ACTIVE = ['queued', 'downloading', 'verifying']

// A model family that isn't set up yet (GitHub #22): what it is, the files it needs and which are already here, one
// button that downloads the rest into ComfyUI (the same downloader as Settings → Setup), a Hugging Face login when one
// is gated, and anything else it needs (a newer ComfyUI, a turbo LoRA).
function FamilySetup({ f, remote, notify, go, onReady }) {
  const [dl, setDl] = useState({})
  useEffect(() => {
    window.ivstudio.models.status().then(setDl, () => {})
    return window.ivstudio.models.onUpdate((u) => {
      setDl((all) => ({ ...all, [u.id]: u }))
      if (u.status === 'done') onReady()
      if (u.status === 'error') notify(u.error || 'The download stopped.')
    })
  }, [])
  const files = f.setup || []
  const want = files.filter((x) => !x.present)
  const going = want.filter((x) => ACTIVE.includes(dl[x.id]?.status))
  const todo = want.filter((x) => !ACTIVE.includes(dl[x.id]?.status))
  const bytes = todo.reduce((n, x) => n + x.size, 0)
  const gated = want.filter((x) => x.gated)
  const pages = [...new Map(gated.map((x) => [x.gated, { url: x.gated, label: x.label.replace(/ \(.*\)$/, '') }])).values()]
  const other = f.missing.filter((m) => !/^text encoder|^VAE /.test(m))
  const pct = (x) => {
    const st = dl[x.id]
    return st?.total ? Math.floor((st.received / st.total) * 100) : null
  }
  const busyFile = (x) => ACTIVE.includes(dl[x.id]?.status)
  return (
    <div className="family-setup">
      <div className="family-setup-head">
        <h3>{f.label} isn’t set up yet</h3>
        <p className="small dim">
          {f.note} <span className="mono">Licence: {f.licence}</span>
        </p>
      </div>
      {files.length > 0 ? (
        <ul className="family-setup-files">
          {files.map((x) => (
            <li key={x.id} className={x.present ? 'ok' : ''}>
              <span className="check-icon" aria-hidden="true">
                {x.present ? '●' : busyFile(x) ? '◌' : '○'}
              </span>
              <span className="family-setup-name">{x.label}</span>
              <span className="mono dim small">{x.present ? 'Here' : busyFile(x) ? (pct(x) == null ? 'Waiting…' : `${pct(x)}%`) : x.size ? GB(x.size) : ''}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="small dim">IV Studio has no download for this one. Put its model files in ComfyUI’s models folders, then check again.</p>
      )}
      {other.length > 0 && <p className="small pink">Also needs {other.join(', ')}.</p>}
      {remote ? (
        <p className="small dim">In the cloud, IV Studio downloads a model into your cloud storage the first time you use it.</p>
      ) : (
        <>
          {gated.length > 0 && <HfLogin notify={notify} pages={pages} />}
          <div className="family-setup-actions">
            {todo.length > 0 && (
              <button className="btn btn-primary" onClick={() => window.ivstudio.models.download(todo.map((x) => x.id)).catch((err) => notify(err.message))}>
                Download {todo.length === want.length ? (todo.length === 1 ? 'it' : `all ${todo.length}`) : `the other ${todo.length}`} · {GB(bytes)}
              </button>
            )}
            {going.length > 0 && (
              <span className="mono small dim">
                Downloading {going.length} file{going.length === 1 ? '' : 's'}. You can keep working.
              </span>
            )}
            <button className="btn" onClick={onReady}>
              Check again
            </button>
            <button className="link-btn mono small" onClick={() => go?.('setup')}>
              Settings → Setup
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// Create -> Image: Generate and Edit with the person's own image models, their LoRAs, and a gallery.
export default function Images({ kindSwitch, notify, go, pictureToShot, incomingLora = null, clearIncomingLora = () => {}, incomingPicture = null, clearIncomingPicture = () => {} }) {
  const [status, setStatus] = useState(null)
  const [form, setForm] = useState(savedForm)
  const [sets, setSets] = useState([])
  const [busy, setBusy] = useState(false)
  const [picking, setPicking] = useState(false)
  const [viewing, setViewing] = useState(null) // { set, i }
  const [toFix, setToFix] = useState(null) // a picture handed to Tools from the viewer
  const [more, setMore] = useState(false)
  const [setupFam, setSetupFam] = useState(null) // a family that isn't set up, opened to see what it needs
  const [yours, , reloadYours] = useYours()
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))
  // an iv:go with a mode (App.jsx) can open Image on Generate or Edit
  useEffect(() => {
    const go = (e) => e.detail?.create === 'image' && e.detail.mode && set({ mode: e.detail.mode })
    window.addEventListener('iv:learn', go)
    return () => window.removeEventListener('iv:learn', go)
  }, [])

  const loadStatus = () => I().status().then(setStatus, (err) => setStatus({ error: err.message, families: [] }))
  useEffect(() => {
    loadStatus()
    I().list().then(setSets, () => {})
  }, [])
  useEffect(() => {
    try {
      localStorage.setItem(FORM_KEY, JSON.stringify({ ...form, refs: [] }))
    } catch {}
  }, [form])
  // while a set is being made, keep it up to date
  const running = sets.some((s) => !DONE.includes(s.status))
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => I().list().then(setSets, () => {}), 2000)
    return () => clearInterval(t)
  }, [running])

  const families = status?.families || []
  // a stale saved form from before Tools, or Tools picked: the model steps below stay on generate/edit
  const usable = families.filter((f) => f.ready && (form.mode !== 'edit' || f.edit))
  const fam = families.find((f) => f.id === form.family && f.ready) || null
  // a LoRA sent from the LoRAs page: switch to its model and put it in the tray
  useEffect(() => {
    if (!incomingLora || !status) return
    const f = families.find((x) => x.id === incomingLora.family && x.ready)
    clearIncomingLora()
    if (!f) return notify(`${incomingLora.title || loraTitle(incomingLora.name)} is for a picture model that isn’t set up on this computer yet (Setup).`)
    const info = loraInfo(incomingLora.name)
    const words = info?.prefs?.autoTrigger !== false ? (incomingLora.words || []).filter((w) => w && !form.prompt.includes(w)) : []
    const keep = f.id === form.family ? form.loras.filter((l) => l.name !== incomingLora.name) : []
    set({ mode: form.mode === 'edit' && f.edit ? 'edit' : 'generate', family: f.id, model: f.models.includes(form.model) ? form.model : f.models[0], loras: [...keep, { name: incomingLora.name, strength: info?.prefs?.strength ?? 1 }], prompt: words.length ? `${words.join(', ')}. ${form.prompt}` : form.prompt })
    notify(`${incomingLora.title || loraTitle(incomingLora.name)} is on, with ${f.label}.`, 'info')
  }, [incomingLora, status])
  // a picture handed over to change (a finished version's last frame): Edit, with it as the picture to edit
  useEffect(() => {
    if (!incomingPicture || !status) return
    clearIncomingPicture()
    I().list().then(setSets, () => {})
    editThis(incomingPicture)
    if (families.some((x) => x.ready && x.edit)) notify('The last frame is ready to edit. Say what to change, then make it.', 'info')
  }, [incomingPicture, status])
  // keep a family and checkpoint that fit the mode
  useEffect(() => {
    if (!status) return
    let f = fam && (form.mode !== 'edit' || fam.edit) ? fam : usable[0]
    if (!f) return
    const model = f.models.includes(form.model) ? form.model : f.models[0]
    if (f.id !== form.family || model !== form.model) set({ family: f.id, model, loras: f.id === form.family ? form.loras : [] })
  }, [status, form.mode, form.family])

  const loraInfo = (name) => yours?.find((x) => x.name === name)
  function addLora({ name, words = [], title }) {
    if (form.loras.some((l) => l.name === name)) return notify(`${title || loraTitle(name)} is already on.`, 'info')
    const info = loraInfo(name)
    const add = info?.prefs?.autoTrigger !== false ? words.filter((w) => w && !form.prompt.includes(w)) : []
    set({ loras: [...form.loras, { name, strength: info?.prefs?.strength ?? 1 }], prompt: add.length ? `${add.join(', ')}. ${form.prompt}` : form.prompt })
    if (add.length) notify(`Added ${title || loraTitle(name)} and its trigger words (${add.join(', ')}).`, 'info')
    setPicking(false)
    reloadYours()
  }
  async function addRefs(paths) {
    const max = fam?.maxRefs || 6
    const next = [...form.refs, ...paths].slice(0, max)
    if (form.refs.length + paths.length > max) notify(`${fam?.label || 'This model'} takes up to ${max} picture${max > 1 ? 's' : ''}.`, 'info')
    set({ refs: next })
  }
  function drop(e) {
    e.preventDefault()
    const files = [...(e.dataTransfer?.files || [])].map((f) => window.ivstudio.media.pathFor(f)).filter((p) => /\.(png|jpe?g|webp|bmp)$/i.test(p || ''))
    if (files.length) addRefs(files)
  }

  async function make() {
    setBusy(true)
    try {
      const rec = await I().create({ ...form, seed: form.seed === '' ? null : Number(form.seed), steps: form.steps === '' ? null : Number(form.steps), cfg: form.cfg === '' ? null : Number(form.cfg) })
      setSets((all) => [rec, ...all])
    } catch (err) {
      notify(err.message)
    } finally {
      setBusy(false)
    }
  }
  function editThis(file) {
    const f = fam?.edit ? fam : families.find((x) => x.ready && x.edit)
    if (!f) return notify('None of your image models can edit pictures yet.')
    set({ mode: 'edit', family: f.id, model: f.models.includes(form.model) ? form.model : f.models[0], refs: [file], prompt: '' })
    setViewing(null)
    document.querySelector('.images-page')?.scrollIntoView({ behavior: 'smooth' })
  }
  async function remove(s) {
    if (!(await ask({ title: 'Delete these pictures?', message: `“${s.name}” and its ${s.files?.length || 0} picture${s.files?.length === 1 ? '' : 's'} leave IV Studio. ComfyUI's own copies stay in its output folder.`, confirm: 'Delete' }))) return
    try {
      await I().delete(s.id)
      setSets((all) => all.filter((x) => x.id !== s.id))
      setViewing(null)
    } catch (err) {
      notify(err.message)
    }
  }

  const [w, h] = sizeOf(form.aspect, form.megapixels)
  const editMode = form.mode === 'edit'
  const blocked = !fam || !form.model || (editMode && !form.refs.length)
  const n = editMode ? { model: 2, refs: 3, prompt: 4, shape: 5 } : { model: 2, prompt: 3, shape: 4 }
  const makeLabel = busy ? 'Starting…' : editMode ? `Edit${form.count > 1 ? ` · ${form.count} versions` : ''}` : `Make ${form.count} picture${form.count > 1 ? 's' : ''}`
  const canMake = !(busy || blocked || !form.prompt.trim())
  const toolsMode = form.mode === 'tools'
  const modeStep = (
    <section className="create-step">
      <StepHead n={1} title="What to make" sub="A new picture from words, a picture you have changed by an instruction, or a one-step fix." />
      <div className="mode-cards create-modes">
        {MODES.map(([id, label, hint]) => (
          <button key={id} className={`mode-card ${form.mode === id ? 'on' : ''}`} onClick={() => set({ mode: id })}>
            <ImageModeIcon id={id} />
            <span className="mode-name">{label}</span>
            <span className="dim small">{hint}</span>
          </button>
        ))}
      </div>
    </section>
  )
  return (
    <div className="images-page create-v2">
      <Hero art="create" title="Create" kicker="New image" help="image" />
      {kindSwitch}
      {status?.error && <p className="notice">{status.error}</p>}

      {toolsMode ? (
        <PictureTools modeStep={modeStep} notify={notify} onQueued={(rec) => setSets((all) => [rec, ...all])} incoming={toFix} clearIncoming={() => setToFix(null)} />
      ) : (
      <div className="create-layout">
        <div className="create-steps">
          {modeStep}

          <section className="create-step">
            <StepHead n={n.model} title="The model" sub={editMode ? 'Only models that can edit are on.' : 'Your image models in ComfyUI. Each has its own look.'} />
            <div className="family-cards" role="radiogroup" aria-label="Model family">
              {families.map((f) => {
                // a family that isn't set up stays clickable and opens what it needs; edit mode still rules out the ones
                // that can't edit
                const off = editMode && (f.ready ? !f.edit : !f.canEdit)
                const why = !f.ready ? 'Not set up yet: click to see what it needs.' : editMode && !f.edit ? f.editNote : f.note
                const pickIt = () => {
                  if (!f.ready) return setSetupFam(setupFam === f.id ? null : f.id)
                  setSetupFam(null)
                  set({ family: f.id, model: f.models[0], loras: [], ...((f.sizes || SIZES).includes(form.megapixels) ? {} : { megapixels: f.defaultMp || (f.sizes || SIZES)[0] }) })
                }
                return (
                  <button key={f.id} role="radio" aria-checked={form.family === f.id && f.ready} aria-expanded={!f.ready ? setupFam === f.id : undefined} className={`family-card ${form.family === f.id && f.ready ? 'on' : ''} ${!f.ready ? 'unset' : ''} ${setupFam === f.id ? 'open' : ''}`} disabled={off} title={why} onClick={pickIt}>
                    <span className="family-name">{f.label}</span>
                    <span className="family-tags mono">
                      {!f.ready ? 'not set up ▸' : f.edit ? 'makes · edits' : 'makes'}
                    </span>
                  </button>
                )
              })}
              {!status && <span className="dim small">Checking your image models…</span>}
            </div>
            {setupFam && families.some((f) => f.id === setupFam && !f.ready) && <FamilySetup key={setupFam} f={families.find((f) => f.id === setupFam)} remote={status?.remote} notify={notify} go={go} onReady={loadStatus} />}
            {fam && (
              <>
                <div className="create-field">
                  <span className="create-label mono">Checkpoint</span>
                  <select value={form.model || ''} onChange={(e) => set({ model: e.target.value })}>
                    {fam.models.map((m) => (
                      <option key={m} value={m}>
                        {shortName(m)}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="small dim image-family-note">
                  {fam.note} <span className="mono">Licence: {fam.licence}</span>
                </p>
              </>
            )}
            <div className="create-field">
              <span className="create-label mono">LoRAs</span>
              <div className="lora-tray">
                {form.loras.map((l, i) => {
                  const info = loraInfo(l.name)
                  return (
                    <div key={l.name} className="lora-chip">
                      <LoraThumb className="small" preview={info?.prefs?.picture ? { file: info.prefs.picture, type: 'image' } : info?.civitai?.preview} label={loraTitle(l.name)} mature={info?.civitai?.mature} />
                      <div className="lora-chip-body">
                        <span className="lora-chip-name" title={l.name}>
                          {info?.civitai?.name || loraTitle(l.name)}
                        </span>
                        <div className="lora-chip-strength">
                          <input type="range" min={0} max={1.5} step={0.05} value={l.strength} onChange={(e) => set({ loras: form.loras.map((x, j) => (j === i ? { ...x, strength: Number(e.target.value) } : x)) })} />
                          <span className="mono small">{Number(l.strength).toFixed(2)}</span>
                        </div>
                      </div>
                      <button className="lora-chip-x" title="Take it off" onClick={() => set({ loras: form.loras.filter((_, j) => j !== i) })}>
                        ×
                      </button>
                    </div>
                  )
                })}
                <button className="lora-add" disabled={!fam} onClick={() => setPicking(true)}>
                  + Add LoRA
                </button>
              </div>
            </div>
            {picking && <LoraPicker family={fam?.id || 'h3'} notify={notify} go={go} onClose={() => setPicking(false)} onPick={addLora} />}
          </section>

          {editMode && (
            <section className="create-step">
              <StepHead n={n.refs} title="The picture to edit" sub={(fam?.maxRefs || 0) > 1 ? 'Add more pictures to bring things in from them, e.g. “put the jacket from picture 2 on her”.' : 'The picture to change.'} />
              <div className="image-refs create-drop" onDragOver={(e) => e.preventDefault()} onDrop={drop}>
                {form.refs.map((r, i) => (
                  <div key={r + i} className="image-ref">
                    <img src={fileUrl(r)} alt="" />
                    <span className="mono small">{form.refs.length > 1 ? `Picture ${i + 1}` : 'The picture'}</span>
                    <button className="lora-chip-x" title="Take it out" onClick={() => set({ refs: form.refs.filter((_, j) => j !== i) })}>
                      ×
                    </button>
                  </div>
                ))}
                {form.refs.length < (fam?.maxRefs || 6) && (
                  <button className="image-ref add" onClick={async () => addRefs(await window.ivstudio.files.pick('picture'))}>
                    <DropIcon />
                    <span>+ Picture</span>
                    <span className="small dim">or drop one here</span>
                  </button>
                )}
              </div>
            </section>
          )}

          <section className="create-step">
            <StepHead n={n.prompt} title={editMode ? 'What to change' : 'What it shows'} sub={editMode ? 'Say what to change, and what to keep.' : 'Subject, place, light and style.'} />
            <textarea className="prompt image-prompt" value={form.prompt} placeholder={editMode ? 'Make it night, keep her face and pose.' : 'An old farmer kneeling in a golden field at sunset, a 3D animated film still.'} onChange={(e) => set({ prompt: e.target.value })} aria-label={editMode ? 'What to change' : 'Prompt'} />
            {fam?.tips && (
              <details className="image-tips small">
                <summary className="mono">How to write for {fam.label}</summary>
                <p className="dim">{fam.tips}</p>
              </details>
            )}
            <div className={`more-settings ${more ? 'open' : ''}`}>
              <button type="button" className="more-settings-toggle mono" onClick={() => setMore(!more)} aria-expanded={more}>
                {more ? '−' : '+'} More: {fam?.noNegative ? 'steps, CFG' : 'negative prompt, steps, CFG'}
                <span className="dim">{[form.negative && 'negative', form.steps !== '' && `${form.steps} steps`, form.cfg !== '' && `CFG ${form.cfg}`].filter(Boolean).join(' · ')}</span>
              </button>
              {more && (
                <div className="more-settings-body">
                  {!fam?.noNegative && (
                    <div className="create-field">
                      <span className="create-label mono">Negative</span>
                      <input value={form.negative} placeholder="What to keep out (used when CFG is above 1)" onChange={(e) => set({ negative: e.target.value })} />
                    </div>
                  )}
                  <div className="create-grid">
                    <div className="create-field">
                      <span className="create-label mono">Steps</span>
                      <input type="number" min={1} max={100} value={form.steps} placeholder={fam ? `${fam.steps} (its own)` : ''} onChange={(e) => set({ steps: e.target.value })} />
                    </div>
                    <div className="create-field">
                      <span className="create-label mono">CFG</span>
                      <input type="number" min={0} max={20} step={0.1} value={form.cfg} placeholder={fam ? `${fam.cfg} (its own)` : ''} onChange={(e) => set({ cfg: e.target.value })} />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>

          <section className="create-step">
            <StepHead n={n.shape} title="Shape and size" sub={editMode ? 'An edit keeps the picture’s own shape.' : 'The shape, how big, and how many to make at once.'} />
            {!editMode && <AspectTiles aspects={ASPECTS} value={form.aspect} onChange={(aspect) => set({ aspect })} />}
            <div className="create-grid">
              <div className="create-field">
                <span className="create-label mono">Size</span>
                <div className="segmented">
                  {(fam?.sizes || SIZES).map((m) => (
                    <button key={m} className={form.megapixels === m ? 'on' : ''} onClick={() => set({ megapixels: m })}>
                      {m} MP
                    </button>
                  ))}
                </div>
              </div>
              <div className="create-field">
                <span className="create-label mono">How many</span>
                <div className="segmented">
                  {[1, 2, 3, 4].map((k) => (
                    <button key={k} className={form.count === k ? 'on' : ''} onClick={() => set({ count: k })}>
                      {k}
                    </button>
                  ))}
                </div>
              </div>
              <div className="create-field">
                <span className="create-label mono">Seed</span>
                <div className="seed">
                  <input type="number" min={0} value={form.seed} placeholder="Random" onChange={(e) => set({ seed: e.target.value })} aria-label="Seed" />
                  <button className="seed-roll" onClick={() => set({ seed: String(Math.floor(Math.random() * 2 ** 31)) })} title="A new seed" aria-label="A new seed">
                    ⟳
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* Your picture: its shape, what will be made, and the button. Pinned while the steps scroll. */}
        <aside className="shot-card" aria-label="Your picture">
          <div className="shot-card-head mono">
            <span>Your picture</span>
            <span className="dim">{editMode ? 'Edit' : 'Generate'}</span>
          </div>
          <PictureFrame aspect={editMode ? null : form.aspect} picture={editMode ? form.refs[0] : null} count={form.count} />
          <dl className="shot-facts">
            <div>
              <dt>Model</dt>
              <dd>{fam ? `${fam.label} · ${shortName(form.model)}` : status ? 'None ready' : 'Checking…'}</dd>
            </div>
            {form.loras.length > 0 && (
              <div>
                <dt>LoRAs</dt>
                <dd>{form.loras.map((l) => loraInfo(l.name)?.civitai?.name || loraTitle(l.name)).join(', ')}</dd>
              </div>
            )}
            {editMode && (
              <div>
                <dt>Pictures</dt>
                <dd>{form.refs.length ? `${form.refs.length}` : <span className="pink">none yet</span>}</dd>
              </div>
            )}
            <div>
              <dt>Size</dt>
              <dd>{editMode ? `about ${form.megapixels} MP, its own shape` : `${w} × ${h}`}</dd>
            </div>
            <div>
              <dt>Makes</dt>
              <dd>
                {form.count} · seed {form.seed === '' ? 'random' : form.seed}
              </dd>
            </div>
          </dl>
          <button className="btn btn-primary shot-card-go" disabled={!canMake} onClick={make}>
            {makeLabel}
          </button>
        </aside>
      </div>
      )}

      {sets.length > 0 && (
        <section className="audio-section image-gallery">
          <div className="audio-section-head">
            <h2>
              Your pictures <span className="count">{sets.length}</span>
            </h2>
          </div>
          <div className="image-sets">
            {sets.map((s) => (
              <div key={s.id} className="image-set">
                <div className="image-set-head">
                  <span className="image-set-name" title={s.prompt}>
                    {s.name}
                  </span>
                  <span className="mono small dim">
                    {s.mode === 'frame' ? 'Last frame of a video' : s.mode === 'tool' ? `${s.familyLabel} · tool` : `${s.familyLabel} · ${s.mode === 'edit' ? 'edit' : 'generate'} · seed ${s.seed}`}
                  </span>
                  <button className="link-btn small" onClick={() => remove(s)}>
                    Delete
                  </button>
                </div>
                {s.status === 'success' ? (
                  <div className="image-thumbs">
                    {s.files.map((f, i) => (
                      <button key={f} className="image-thumb" onClick={() => setViewing({ set: s, i })}>
                        <img src={fileUrl(f)} alt={`${s.name}, picture ${i + 1}`} loading="lazy" />
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="char-pending mono small dim">
                    {s.status === 'error' ? s.error : s.status === 'running' ? `Making it${s.progress?.max ? ` · ${Math.round((100 * s.progress.value) / s.progress.max)}%` : '…'}` : s.status === 'cancelled' ? 'Stopped' : `Queued${s.queuePosition ? ` · ${s.queuePosition}` : ''}`}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Narrow windows: what will be made, and the button, as a bar at the bottom of the window. */}
      {!toolsMode && (
      <section className="go-dock create-dock">
        <div className="go-info">
          <span className="mono">{fam ? `${form.count} picture${form.count > 1 ? 's' : ''} · ${editMode ? `about ${form.megapixels} MP, the picture's shape` : `${w} × ${h}`} · ${fam.label}` : status ? 'No image model is ready' : 'Checking your image models…'}</span>
          {fam && <span className="mono dim">{shortName(form.model)}{form.loras.length ? ` · ${form.loras.length} LoRA${form.loras.length > 1 ? 's' : ''}` : ''}</span>}
        </div>
        <button className="btn btn-primary" disabled={!canMake} onClick={make}>
          {makeLabel}
        </button>
      </section>
      )}

      {viewing && (
        <ImageViewer
          set={viewing.set}
          index={viewing.i}
          onIndex={(i) => setViewing({ ...viewing, i })}
          onClose={() => setViewing(null)}
          onEdit={editThis}
          onFix={(f) => (setToFix(f), set({ mode: 'tools' }), setViewing(null), document.querySelector('.images-page')?.scrollIntoView({ behavior: 'smooth' }))}
          onShot={(f) => (setViewing(null), pictureToShot?.(f))}
          onEditTimeline={async (f) => {
            try {
              const e = await I().toEdit(f, viewing.set.name)
              notify(`Added to the edit “${e.name}”.`, 'info')
            } catch (err) {
              notify(err.message)
            }
          }}
          onAgain={() => {
            const v = viewing.set
            if (v.mode === 'tool') {
              setToFix(v.refs?.[0] || null)
              set({ mode: 'tools' })
            } else if (v.mode === 'frame') set({ mode: 'edit', refs: v.files || [] })
            else set({ mode: v.mode, family: v.family, model: v.model, prompt: v.prompt, negative: v.negative || '', loras: v.loras || [], aspect: v.aspect, megapixels: v.megapixels, count: v.count, seed: '', refs: v.refs || [] })
            setViewing(null)
          }}
        />
      )}
    </div>
  )
}

// The picture-to-be in its shape (or the picture being edited), with a stack for more than one.
function PictureFrame({ aspect, picture, count }) {
  // an edit keeps the picture's own shape: read it from the picture
  const [own, setOwn] = useState(null)
  useEffect(() => setOwn(null), [picture])
  const [w, h] = own || (aspect || '1:1').split(':').map(Number)
  return (
    <div className="shot-frame-wrap">
      <div className={`shot-frame ${count > 1 ? 'stacked' : ''}`} style={{ aspectRatio: `${w} / ${h}`, '--ar': w / h }}>
        {picture ? <img src={fileUrl(picture)} alt="" onLoad={(e) => setOwn([e.target.naturalWidth, e.target.naturalHeight])} /> : <span className="shot-frame-empty mono">{aspect}</span>}
        {count > 1 && <span className="shot-frame-len mono">× {count}</span>}
      </div>
    </div>
  )
}

// A picture large, with what to do next. ← → move through the set, Esc closes.
function ImageViewer({ set, index, onIndex, onClose, onEdit, onFix, onShot, onEditTimeline, onAgain }) {
  const file = set.files[index]
  useEffect(() => {
    const key = (e) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') onIndex((index + 1) % set.files.length)
      if (e.key === 'ArrowLeft') onIndex((index + set.files.length - 1) % set.files.length)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [index, set])
  return (
    <div className="lora-picker-backdrop" onClick={onClose}>
      <div className="image-viewer" onClick={(e) => e.stopPropagation()}>
        <img src={fileUrl(file)} alt={set.name} />
        <div className="image-viewer-side">
          <p className="image-set-name">{set.name}</p>
          <p className="small dim">{set.prompt}</p>
          <p className="mono small dim">
            {set.mode === 'tool' || set.mode === 'frame' ? set.familyLabel : `${set.familyLabel} · ${shortName(set.model)} · seed ${set.seed}`}
            {set.files.length > 1 ? ` · ${index + 1} of ${set.files.length}` : ''}
          </p>
          <div className="image-viewer-actions">
            <button className="btn btn-primary" onClick={() => onShot(file)}>
              Use in a shot
            </button>
            <button className="btn" onClick={() => onEdit(file)}>
              Edit this
            </button>
            <button className="btn" onClick={() => onFix(file)} title="Inpaint, relight, remove the background, upscale or make a depth map">
              Fix this…
            </button>
            <button className="btn" onClick={() => onEditTimeline(file)}>
              Add to edit
            </button>
            <button className="btn" onClick={onAgain}>
              Make more like this
            </button>
            <button className="btn" onClick={() => window.ivstudio.files.reveal({ path: file })}>
              Show file
            </button>
            <button className="link-btn mono" onClick={onClose}>
              Close ×
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
