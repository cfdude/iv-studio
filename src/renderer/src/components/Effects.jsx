import { useEffect, useMemo, useState } from 'react'
import { fileUrl } from './edit/model'
import { ask } from './Confirm'
import { Step, Choices, DropZone, Summary, SummaryDock, SummaryFrame, StageDrop, WorkflowNeeds } from './FlowKit'
import { Field } from './edit/ClipFx'
import Stage from './Stage'

// Workflows → Effects: a photo becomes a short clip, three ways (Freefield's apps, freefield.js): an effect from a
// gallery (Wan 2.1 and its effect LoRAs), a transformation that keeps the face (Flux 3 Klein + LTX-2.5), or a
// transition from one picture into another (LTX-2.5). Every result is kept on this page and in the Library.
const MODES = [
  ['effects', 'Effect', 'Cakeify, explode, inflate, money rain, a 360° orbit… 24 in all.'],
  ['morph', 'Transformation', 'The photo turns into a new version of itself and keeps the face.'],
  ['transitions', 'Transition', 'One picture morphs into another.']
]
const ASPECT = { portrait: '9:16', landscape: '16:9', square: '1:1' }
const IMAGE = /\.(png|jpe?g|webp|bmp)$/i
const base = (p) => String(p).split(/[\\/]/).pop()

export default function Effects({ notify, go, openEdit }) {
  const [metas, setMetas] = useState({})
  const [status, setStatus] = useState({})
  const [mode, setMode] = useState('effects')
  const [photo, setPhoto] = useState(null)
  const [last, setLast] = useState(null)
  const [values, setValues] = useState({})
  const [runs, setRuns] = useState([])
  const [working, setWorking] = useState(0)
  const reload = () => window.ivstudio.clipfx.runs().then((all) => setRuns(all.filter((r) => MODES.some(([m]) => m === r.fx))), () => {})
  useEffect(() => {
    window.ivstudio.clipfx.meta().then((all) => setMetas(Object.fromEntries(all.filter((m) => MODES.some(([id]) => id === m.fx)).map((m) => [m.fx, m]))))
    window.ivstudio.clipfx.status().then(setStatus, () => {})
    reload()
  }, [])
  const meta = metas[mode]
  useEffect(() => {
    if (meta) setValues(Object.fromEntries((meta.inputs || []).filter((i) => i.default !== undefined && !['image', 'video'].includes(i.type)).map((i) => [i.id, i.default])))
  }, [mode, meta?.fx])
  const choice = meta?.inputs.find((i) => i.id === 'effect')
  const fields = useMemo(() => (meta?.inputs || []).filter((i) => !['image', 'video', 'seed'].includes(i.type) && i.id !== 'effect'), [meta])
  const st = status[mode]
  const blocked = !st ? 'Checking ComfyUI…' : st.ready ? null : st.missingNodes?.length ? 'Needs node packs: Settings → Setup → Install missing node packs, then restart ComfyUI.' : st.missingModels?.length ? `Needs ${st.missingModels.join(', ')}: download on Setup.` : st.error || 'Not set up.'
  const need2 = mode === 'transitions'
  const ready = !blocked && photo && (!need2 || last)
  function dropped(files) {
    const pics = files.filter((f) => IMAGE.test(f))
    if (!pics.length) return
    if (need2 && photo && !last) setLast(pics[0])
    else {
      setPhoto(pics[0])
      if (need2 && pics[1]) setLast(pics[1])
    }
  }
  async function pick(setter) {
    const [f] = (await window.ivstudio.files.pick('picture')) || []
    if (f) setter(f)
  }
  async function run() {
    setWorking((n) => n + 1)
    notify(`${meta.label}: working. It lands below when it's done (a few minutes).`, 'info')
    try {
      await window.ivstudio.clipfx.run({ fx: mode, file: photo, last: need2 ? last : null, values })
      notify(`${meta.label} done.`, 'info')
    } catch (err) {
      notify(err.message)
    } finally {
      setWorking((n) => n - 1)
      reload()
    }
  }
  async function toEdit(r) {
    try {
      const f = r.files.find((x) => x.kind === 'video') || r.files[0]
      const e = await window.ivstudio.library.toEdit({ file: { path: f.file }, label: r.title, type: 'video' })
      openEdit?.(e.id)
    } catch (err) {
      notify(err.message)
    }
  }
  async function remove(r) {
    if (!(await ask({ title: `Delete “${r.title}”?`, message: 'Its video in IV Studio’s data folder goes too.', confirm: 'Delete', danger: true }))) return
    await window.ivstudio.clipfx.deleteRun(r.id).catch((err) => notify(err.message))
    reload()
  }
  const aspect = ASPECT[values.aspect] || '9:16'
  const facts = [
    ['Kind', meta?.label || '…'],
    choice && ['Look', choice.options.find((o) => o.value === values.effect)?.label || '…'],
    ['Picture', photo ? base(photo) : 'none yet'],
    need2 && ['Last frame', last ? base(last) : 'none yet']
  ].filter(Boolean)
  const action = { label: working ? `Working (${working})…` : meta ? `Make the ${meta.label.toLowerCase()}` : 'Make it', onClick: run, disabled: !ready }
  return (
    <div className="effects-page create-v2 flow-page">
      <Stage effect="burst" art="effects" title="Effects" kicker="A photo, made into a moment" help="effects" back={{ label: 'Workflows', onClick: () => go('workflows') }}>
        <StageDrop onFiles={dropped}>
          <span className="stage-drop-text">{photo ? base(photo) : 'Drop a photo here'}</span>
          <button className="btn btn-small" onClick={() => pick(setPhoto)}>
            + A photo
          </button>
        </StageDrop>
        <p className="stage-note small">Each one is a short clip with motion, made on this PC. Put it in an edit from here or from the Library.</p>
        <WorkflowNeeds page="effects" />
      </Stage>

      <div className="create-layout">
        <div className="create-steps">
          <Step n={1} title="What happens" sub="An effect from the gallery, a transformation that keeps the face, or a transition between two pictures.">
            <Choices label="Kind" options={MODES} value={mode} onChange={setMode} className="flow-three" />
            {blocked && st && <p className="small pink">{blocked}</p>}
          </Step>

          <Step n={2} title={need2 ? 'The two pictures' : 'The photo'} sub={need2 ? 'The first frame and the last; the clip morphs from one into the other.' : 'A clear photo works best: one subject, well lit.'}>
            <div className="effects-photos">
              <DropZone onFiles={dropped} filled={!!photo} empty={need2 ? 'Drop the first frame here' : 'Drop a photo here'}>
                {photo && <img className="effects-photo" src={fileUrl(photo)} alt="" />}
                <div className="media-actions">
                  <button className="btn btn-small" onClick={() => pick(setPhoto)}>
                    {photo ? 'Another picture' : need2 ? '+ First frame' : '+ A photo'}
                  </button>
                </div>
              </DropZone>
              {need2 && (
                <DropZone onFiles={(fs) => fs.filter((f) => IMAGE.test(f))[0] && setLast(fs.filter((f) => IMAGE.test(f))[0])} filled={!!last} empty="Drop the last frame here">
                  {last && <img className="effects-photo" src={fileUrl(last)} alt="" />}
                  <div className="media-actions">
                    <button className="btn btn-small" onClick={() => pick(setLast)}>
                      {last ? 'Another picture' : '+ Last frame'}
                    </button>
                  </div>
                </DropZone>
              )}
            </div>
          </Step>

          {choice && (
            <Step n={3} title={mode === 'morph' ? 'The transformation' : 'The effect'} sub={mode === 'morph' ? 'What the photo becomes.' : 'What happens to the photo.'}>
              <div className="effect-gallery" role="radiogroup" aria-label={choice.label}>
                {choice.options.map((o) => (
                  <button key={o.value} role="radio" aria-checked={values.effect === o.value} className={`effect-chip ${values.effect === o.value ? 'on' : ''}`} onClick={() => setValues((s) => ({ ...s, effect: o.value }))}>
                    {o.label}
                  </button>
                ))}
              </div>
            </Step>
          )}

          <Step n={choice ? 4 : 3} title="Fine-tune" sub="Leave these as they are for a first try.">
            <div className="fx-form">
              {fields.map((input) => (
                <Field key={input.id} input={input} value={values[input.id]} onChange={(v) => setValues((s) => ({ ...s, [input.id]: v }))} />
              ))}
            </div>
          </Step>
        </div>

        <Summary label="Your clip" kind={meta?.label} frame={<SummaryFrame aspect={aspect} src={photo && fileUrl(photo)} tag={meta?.label} />} facts={facts} action={action} note={blocked} />
      </div>
      <SummaryDock facts={facts} action={action} />

      {runs.length > 0 && (
        <section className="audio-section effects-runs">
          <div className="audio-section-head">
            <h2>
              Made here <span className="count">{runs.length}</span>
            </h2>
          </div>
          <div className="effects-grid">
            {runs.map((r) => {
              const v = r.files?.find((f) => f.kind === 'video')
              return (
                <div key={r.id} className="effects-run">
                  {v ? <video src={fileUrl(v.file)} controls loop preload="metadata" /> : <div className="effects-run-wait mono small dim">{r.status === 'error' ? `Failed: ${r.error}` : 'Working…'}</div>}
                  <div className="effects-run-foot">
                    <span className="small">{r.title}</span>
                    <span className="effects-run-actions">
                      {v && (
                        <button className="btn btn-small" onClick={() => toEdit(r)}>
                          Add to edit
                        </button>
                      )}
                      {v && (
                        <button className="link-btn small" onClick={() => window.ivstudio.files.reveal({ path: v.file })}>
                          Show file
                        </button>
                      )}
                      <button className="link-btn small" onClick={() => remove(r)}>
                        Delete
                      </button>
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}
