import { useCallback, useEffect, useRef, useState } from 'react'
import { media } from '../media'
import { Progress } from './Shot'
import Failure from './Failure'
import Hero from './Hero'
import Stage from './Stage'
import { ToolShelf, ShelfTile, Step, Choices, WorkflowNeeds } from './FlowKit'
import { AspectTiles } from './CreateKit'
import TileDelete from './TileDelete'
import PromptWriter, { StoryWriter } from './PromptWriter'
import { LoraPicker, LoraThumb, loraTitle, useYours } from './Loras'

const MAX_LORAS = 4 // sequence.js MAX_SEQUENCE_LORAS

const DONE = ['success', 'error', 'cancelled']
const ASPECTS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9']
const SIZES = [0.6, 0.9, 1.2]
const RETAKE_MODES = [
  ['both', 'Picture and sound'],
  ['video', 'Picture only'],
  ['audio', 'Sound only']
]
// Measured on an RTX 4090: a 0.4 MP take renders at about 19 s per second of video; time grows with pixels.
const estimateMinutes = (seconds, mp) => Math.max(1, Math.round((seconds * 19 * (mp / 0.4)) / 60))
const newId = () => Math.random().toString(36).slice(2, 8)

const SHOT_HINT =
  'Shots join into one continuous video. Describe the place the same way in every shot. Each later shot opens holding the previous shot\'s closing pose and stays quiet for about two seconds before anyone speaks. Every shot ends settled, with the line finished and about two seconds to spare. Keep lines to about 15 words for 10 s shots, 27 for 15 s. Write {char} where the character goes; dialogue as <d>[English] Your line.</d>'

export function SequenceList({ openSequence, notify, go }) {
  const [list, setList] = useState(null)
  const [name, setName] = useState('')
  const [q, setQ] = useState('')
  useEffect(() => {
    window.ivstudio.sequences.list().then(setList)
  }, [])

  async function create() {
    try {
      openSequence((await window.ivstudio.sequences.create({ name: name.trim() || 'Untitled sequence' })).id)
    } catch (err) {
      notify(err.message)
    }
  }
  const shown = (list || []).filter((x) => !q.trim() || x.name.toLowerCase().includes(q.trim().toLowerCase()))

  return (
    <div className="sequences flow-page">
      <Stage effect="film" art="sequences" title="Sequences" kicker="Several shots, one continuous take" back={go && { label: 'Workflows', onClick: () => go('workflows') }}>
        <div className="stage-panel">
          <input value={name} placeholder="Name a new sequence, e.g. The kitchen letter" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} aria-label="Sequence name" />
          <button className="btn btn-primary" onClick={create}>
            New sequence
          </button>
        </div>
        <p className="stage-note small">Write the shots, render them as one seamless take or shot by shot, redo any stretch, then render out the final.</p>
        <WorkflowNeeds page="sequences" />
      </Stage>

      <ToolShelf label="Your sequences" count={shown.length} q={q} setQ={setQ} empty="No sequences yet. Name one in the bar above.">
        {shown.map((x) => (
          <ShelfTile
            key={x.id}
            onOpen={() => openSequence(x.id)}
            media={<span className="shelf-empty-art">{x.shots} shot{x.shots === 1 ? '' : 's'}</span>}
            status={x.renders ? 'Final ready' : x.versions ? `${x.versions} version${x.versions === 1 ? '' : 's'}` : 'Not rendered'}
            name={x.name}
            meta={[x.method === 'take' ? 'One take' : 'Shot by shot', new Date(x.updatedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })]}
            del={<TileDelete name={x.name} notify={notify} onDelete={async () => (await window.ivstudio.sequences.delete(x.id), setList(await window.ivstudio.sequences.list()))} />}
          />
        ))}
      </ToolShelf>
    </div>
  )
}

function Seg({ value, options, onChange, format = (v) => v }) {
  return (
    <div className="segmented">
      {options.map((o) => {
        const [v, label] = Array.isArray(o) ? o : [o, format(o)]
        return (
          <button key={String(v)} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>
            {label}
          </button>
        )
      })}
    </div>
  )
}

function ShotCard({ shot, i, count, onChange, onMove, onDuplicate, onDelete, writer, focused }) {
  const [writing, setWriting] = useState(false)
  return (
    <div id={`seq-shot-${shot.id}`} className={`seq-shot ${focused ? 'focused' : ''}`}>
      <div className="seq-shot-head">
        <span className="seq-shot-no">Shot {i + 1}</span>
        <div className="seq-shot-tools">
          <button className="link-btn mono" disabled={i === 0} onClick={() => onMove(-1)} title="Move up">
            ↑
          </button>
          <button className="link-btn mono" disabled={i === count - 1} onClick={() => onMove(1)} title="Move down">
            ↓
          </button>
          <button className="link-btn mono" onClick={() => setWriting(!writing)}>
            {writing ? 'Hide writer' : '✦ Write it for me'}
          </button>
          <button className="link-btn mono" onClick={onDuplicate}>
            Duplicate
          </button>
          <button className="link-btn mono danger" disabled={count === 1} onClick={onDelete}>
            Delete
          </button>
        </div>
      </div>
      {writing && <PromptWriter compact context={writer.context} current={shot.prompt} onWritten={(prompt) => onChange({ prompt })} notify={writer.notify} go={writer.go} />}
      <textarea className="prompt seq-prompt" rows={5} value={shot.prompt} placeholder="{char} sits at the kitchen table… and says: <d>[English] …</d>" onChange={(e) => onChange({ prompt: e.target.value })} />
    </div>
  )
}

// Pick a stretch of a version and redo it.
function RetakePanel({ version, onStart, notify }) {
  const video = useRef(null)
  const [duration, setDuration] = useState(0)
  const [range, setRange] = useState([0, 3])
  const [prompt, setPrompt] = useState('')
  const [mode, setMode] = useState('both')
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setRange((r) => (k === 0 ? [Math.min(v, r[1] - 0.2), r[1]] : [r[0], Math.max(v, r[0] + 0.2)]))
  const at = () => +(video.current?.currentTime || 0).toFixed(1)

  async function go() {
    setBusy(true)
    try {
      onStart(await window.ivstudio.sequences.retake(version.seqId, { versionId: version.id, prompt, start: range[0], end: range[1], mode }))
    } catch (err) {
      notify(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="finish-panel">
      <p className="mono label">Retake part of {version.label}</p>
      <video ref={video} className="final-video" src={media(version.file.url)} controls preload="metadata" onLoadedMetadata={(e) => setDuration(+e.target.duration.toFixed(1))} />
      <div className="timeline">
        <div className="timeline-track">
          <span className="timeline-sel" style={{ left: `${(range[0] / (duration || 1)) * 100}%`, width: `${((range[1] - range[0]) / (duration || 1)) * 100}%` }} />
        </div>
        <input type="range" min={0} max={duration || 1} step={0.1} value={range[0]} onChange={(e) => set(0, Number(e.target.value))} />
        <input type="range" min={0} max={duration || 1} step={0.1} value={range[1]} onChange={(e) => set(1, Number(e.target.value))} />
      </div>
      <div className="row">
        <span className="row-label">Stretch</span>
        <div className="seed">
          <span className="mono">
            {range[0].toFixed(1)}–{range[1].toFixed(1)} s
          </span>
          <button className="btn btn-small" onClick={() => set(0, at())}>
            Start at playhead
          </button>
          <button className="btn btn-small" onClick={() => set(1, at())}>
            End at playhead
          </button>
        </div>
      </div>
      <div className="row">
        <span className="row-label">Redo</span>
        <Seg value={mode} options={RETAKE_MODES} onChange={setMode} />
      </div>
      <textarea className="prompt" rows={4} value={prompt} placeholder="What happens in this stretch, written like a shot prompt. {char} works here too." onChange={(e) => setPrompt(e.target.value)} />
      <div className="finish-go">
        <span className="mono dim">Everything outside the stretch stays as it is. Takes several minutes: the whole video is re-encoded.</span>
        <button className="btn btn-primary" disabled={busy || !prompt.trim()} onClick={go}>
          {busy ? 'Starting…' : 'Retake'}
        </button>
      </div>
    </div>
  )
}

function RenderOutPanel({ version, method, onStart, notify, caps }) {
  const FPS = caps?.fps || [0, 30, 50, 60, 120]
  const [opts, setOpts] = useState({ normalize: method === 'shots', scale: 1, fps: 0 })
  const [busy, setBusy] = useState(false)
  const set = (patch) => setOpts((o) => ({ ...o, ...patch }))
  async function go() {
    setBusy(true)
    try {
      onStart(await window.ivstudio.sequences.renderOut(version.seqId, { versionId: version.id, ...opts }))
    } catch (err) {
      notify(err.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="finish-panel">
      <p className="mono label">Render out {version.label}</p>
      <div className="row">
        <span className="row-label">Smooth colour</span>
        <Seg value={opts.normalize} options={[[false, 'Off'], [true, 'On']]} onChange={(normalize) => set({ normalize })} />
      </div>
      <div className="row">
        <span className="row-label">{caps?.dlss === false ? '2× upscale' : 'RTX upscale'}</span>
        <Seg value={opts.scale} options={[[1, 'Off'], [2, '2×']]} onChange={(scale) => set({ scale })} />
      </div>
      <div className="row">
        <span className="row-label">Frame rate</span>
        <Seg value={opts.fps} options={FPS} format={(f) => (f ? f : '24')} onChange={(fps) => set({ fps })} />
      </div>
      <div className="finish-go">
        <span className="mono dim">{caps?.dlss === false ? 'Cloud finish' : 'DLSS clean-up'}{opts.normalize ? ', colour matched across the joins' : ''}.</span>
        <button className="btn btn-primary" disabled={busy} onClick={go}>
          {busy ? 'Starting…' : 'Render out'}
        </button>
      </div>
    </div>
  )
}

// Shot by shot: hunt, pick and finish each shot in order.
function ShotRow({ seqId, i, shot, state, live, onStart, notify, flush }) {
  const [picked, setPicked] = useState(1)
  const [busy, setBusy] = useState(false)
  const pj = state?.previews && (live[state.previews.id] || state.previews)
  const fj = state?.finish && (live[state.finish.id] || state.finish)
  const previews = pj?.outputs?.filter((o) => o.kind === 'preview') || []
  const status = state?.fresh ? 'Finished' : state?.stale ? 'Changed since it was rendered' : fj && !DONE.includes(fj.status) ? 'Finishing' : pj && !DONE.includes(pj.status) ? 'Hunting' : previews.length ? 'Pick a preview' : 'Not started'

  async function act(fn) {
    setBusy(true)
    try {
      await flush()
      onStart(await fn())
    } catch (err) {
      notify(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`seq-row ${state?.fresh ? 'done' : ''}`}>
      <div className="seq-row-head">
        <span className="seq-shot-no">Shot {i + 1}</span>
        <span className={`mono small ${state?.stale ? 'pink' : 'dim'}`}>{status}</span>
        <span className="dim small seq-row-prompt" title={shot.prompt}>
          {shot.prompt.slice(0, 90)}
        </span>
        <button className="btn btn-small" disabled={busy || !state?.ready || !shot.prompt.trim() || (pj && !DONE.includes(pj.status))} onClick={() => act(() => window.ivstudio.sequences.huntShot(seqId, i, {}))} title={state?.ready ? '' : `Finish shot ${i} first`}>
          {pj ? 'Hunt again' : i === 0 ? 'Hunt 3 previews' : 'Render preview'}
        </button>
      </div>
      <Progress job={pj} />
      <Progress job={fj} />
      {pj?.status === 'error' && <Failure job={pj} notify={notify} />}
      {fj?.status === 'error' && <Failure job={fj} notify={notify} />}
      {previews.length > 0 && !state?.fresh && (
        <>
          <div className={`candidates n${previews.length}`}>
            {previews.map((o) => (
              <figure key={o.candidate} className={`candidate ${picked === o.candidate ? 'on' : ''}`}>
                <video src={media(o.url)} controls loop preload="metadata" />
                <figcaption>
                  <span className="mono">#{o.candidate}</span>
                  {previews.length > 1 && (
                    <button className="btn btn-small" onClick={() => setPicked(o.candidate)}>
                      {picked === o.candidate ? 'Picked' : 'Pick'}
                    </button>
                  )}
                </figcaption>
              </figure>
            ))}
          </div>
          <button className="btn btn-primary seq-use" disabled={busy || (fj && !DONE.includes(fj.status))} onClick={() => act(() => window.ivstudio.sequences.finishShot(seqId, i, { candidate: picked }))}>
            Use #{picked}
          </button>
        </>
      )}
      {state?.fresh && state.raw && <video className="seq-row-video" src={media(state.raw.url)} controls preload="metadata" />}
    </div>
  )
}

// shotFocus: { runId, prompt } from a shot-by-shot run's "Edit and run again": open on that run's shot (with the
// revised prompt, if any) so the edit renders through the sequence and stays that shot's.
export function SequenceEditor({ sequenceId, characters, notify, go, jobs: live, caps, remote, shotFocus, clearShotFocus }) {
  const [seq, setSeq] = useState(null)
  const [view, setView] = useState(null)
  const [panel, setPanel] = useState(null) // {kind: 'retake'|'out', versionId}
  const [busy, setBusy] = useState(false)
  const [picking, setPicking] = useState(false)
  const [focused, setFocused] = useState(null) // the id of the shot a run's edit opened on
  const [yours, , reloadYours] = useYours()
  const saveTimer = useRef(null)
  const pendingSave = useRef(null)

  const load = useCallback(async () => {
    const v = await window.ivstudio.sequences.get(sequenceId)
    setView(v)
    setSeq((s) => s || v.sequence)
    const open = v.sequence.jobs.filter((id) => {
      const all = [...v.versions.map((x) => x.job), ...v.renders.map((x) => x.job), ...v.shots.flatMap((x) => [x.previews, x.finish])].filter(Boolean)
      const j = all.find((x) => x.id === id)
      return j && !DONE.includes(j.status)
    })
    if (open.length) window.ivstudio.jobs.watch(open)
    return v
  }, [sequenceId])

  useEffect(() => {
    load()
  }, [load])

  // Reload when a job of this sequence changes state.
  const liveKey = view ? view.sequence.jobs.map((id) => live[id]?.status || '').join() : ''
  useEffect(() => {
    if (view) load()
  }, [liveKey])

  async function flush() {
    clearTimeout(saveTimer.current)
    if (pendingSave.current) {
      const patch = pendingSave.current
      pendingSave.current = null
      await window.ivstudio.sequences.save(sequenceId, patch)
    }
  }
  // Edits show at once and save half a second after the last change (flush() saves before any render).
  function edit(patch) {
    setSeq((s) => ({ ...s, ...patch }))
    pendingSave.current = { ...(pendingSave.current || {}), ...patch }
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => flush().then(load).catch((err) => notify(err.message)), 500)
  }
  useEffect(() => () => flush(), [])

  const shots = seq?.shots || []
  const setShot = (i, patch) => edit({ shots: shots.map((s, j) => (j === i ? { ...s, ...patch } : s)) })
  const moveShot = (i, d) => {
    const next = [...shots]
    ;[next[i], next[i + d]] = [next[i + d], next[i]]
    edit({ shots: next })
  }

  useEffect(() => {
    if (!shotFocus || !seq || !view) return
    clearShotFocus?.()
    ;(async () => {
      const info = view.sequence.projectId ? await window.ivstudio.sequences.runsOf(view.sequence.projectId).catch(() => null) : null
      const r = info?.runs?.[shotFocus.runId]
      const i = r?.index ?? -1
      if (i < 0 || !shots[i]) return notify(r?.problem ? `That run no longer fits this sequence. ${r.problem}` : "Couldn't tell which shot that run was. Edit the shot here and render it again.", 'info')
      if (shotFocus.prompt) setShot(i, { prompt: shotFocus.prompt })
      setFocused(shots[i].id)
      requestAnimationFrame(() => document.getElementById(`seq-shot-${shots[i].id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
      const next = seq.method === 'shots' ? `render shot ${i + 1} again under Render` : 'render the take again'
      notify(`Shot ${i + 1}${shotFocus.prompt ? ' has the revised prompt' : ''}. Change it here, then ${next}, so the new render stays part of the sequence.`, 'info')
    })()
  }, [shotFocus, seq, view])

  // Extra LoRAs for every shot, after the character's. Adding one puts its trigger words at the start of each
  // written shot that lacks them (as Create does), unless that LoRA's auto-trigger is off.
  const loras = seq?.loras || []
  const loraInfo = (name) => yours?.find((x) => x.name === name)
  function addLora({ name, words = [], title }) {
    setPicking(false)
    if (loras.some((l) => l.name === name)) return notify(`${title || loraTitle(name)} is already in the sequence.`, 'info')
    if (loras.length >= MAX_LORAS) return notify(`A sequence takes up to ${MAX_LORAS} LoRAs. Take one out first.`, 'info')
    const info = loraInfo(name)
    const strength = info?.prefs?.strength ?? 1
    const auto = info?.prefs?.autoTrigger !== false
    const add = auto ? words.filter(Boolean) : []
    let changed = 0
    const nextShots = shots.map((s) => {
      const missing = add.filter((w) => !s.prompt.includes(w))
      if (!s.prompt.trim() || !missing.length) return s
      changed++
      return { ...s, prompt: `${missing.join(', ')}. ${s.prompt}` }
    })
    edit({ loras: [...loras, { name, strength, ...(title && { title }) }], ...(changed && { shots: nextShots }) })
    notify(changed ? `Added ${title || loraTitle(name)} and its trigger words (${add.join(', ')}) to ${changed} shot${changed === 1 ? '' : 's'}.` : `Added ${title || loraTitle(name)} to every shot.`, 'info')
    reloadYours()
  }

  async function act(fn) {
    setBusy(true)
    try {
      await flush()
      const job = await fn()
      window.ivstudio.jobs.watch([job.id])
      await load()
      setPanel(null)
    } catch (err) {
      notify(err.message)
    } finally {
      setBusy(false)
    }
  }
  const onStart = (job) => {
    window.ivstudio.jobs.watch([job.id])
    load()
    setPanel(null)
  }

  if (!seq || !view) return null
  const char = characters.find((c) => c.id === seq.character)
  // a sequence renders its character with a LoRA (sequence.js refuses RefMod-only characters), so only those are offered
  const withLora = characters.filter((c) => c.lora)
  const refmodOnly = characters.filter((c) => !c.lora && c.refmod)
  const total = shots.length * seq.shotSeconds
  const takeRunning = view.versions.some((v) => v.kind === 'take' && v.job && !DONE.includes((live[v.job.id] || v.job).status))

  return (
    <div className="sequence create-v2 flow-page">
      <Hero art="sequences" help="sequence" back={{ label: 'All sequences', onClick: () => go('sequences') }} kicker={`Sequence · ${shots.length} shot${shots.length === 1 ? '' : 's'} · ${total} s`}>
        <input className="shot-name" value={seq.name} onChange={(e) => edit({ name: e.target.value })} />
      </Hero>

      <div className="create-steps">
      <Step n={1} title="How it renders">
        <Choices
          label="How it renders"
          className="flow-two"
          value={seq.method}
          onChange={(method) => edit({ method })}
          options={[
            ['take', 'One take', 'All shots render together as one seamless take: no cuts, matched colour, unbroken sound. All or nothing.'],
            ['shots', 'Shot by shot', 'Hunt and pick each shot in turn; each carries on from the end of the one before. Change a shot and only the shots after it need redoing.']
          ]}
        />
      </Step>

      <Step n={2} title="The shots" sub={char ? `Write {char} for ${char.name.split(' ')[0]} (${char.trigger}). Up to 8 shots of ${seq.shotSeconds} s.` : `No character. Up to 8 shots of ${seq.shotSeconds} s.`}>
        <StoryWriter
          character={seq.character}
          shotSeconds={seq.shotSeconds}
          existing={shots.filter((s) => s.prompt.trim()).length}
          onShots={(list) => edit({ shots: list.map((prompt, k) => ({ id: shots[k]?.id || newId(), prompt, mode: 'text', media: [] })) })}
          notify={notify}
        />
        <details className="seq-hint">
          <summary className="mono dim">How to write shots that join cleanly</summary>
          <p className="small dim">{SHOT_HINT}</p>
        </details>
        {shots.map((s, i) => (
          <ShotCard
            key={s.id}
            shot={s}
            i={i}
            count={shots.length}
            onChange={(p) => setShot(i, p)}
            onMove={(d) => moveShot(i, d)}
            onDuplicate={() => edit({ shots: [...shots.slice(0, i + 1), { ...s, id: newId() }, ...shots.slice(i + 1)] })}
            onDelete={() => edit({ shots: shots.filter((_, j) => j !== i) })}
            writer={{ notify, go, context: { mode: 'text', seconds: seq.shotSeconds, aspect: seq.aspect, character: seq.character, sequence: true, previous: i > 0 ? shots[i - 1].prompt : null } }}
            focused={focused === s.id}
          />
        ))}
        <button className="btn btn-small seq-add" disabled={shots.length >= 8} onClick={() => edit({ shots: [...shots, { id: newId(), prompt: '', mode: 'text', media: [] }] })}>
          + Add shot
        </button>
      </Step>

      <Step n={3} title="Look and size" sub="Who plays it, its LoRAs, the frame, the size and each shot's length.">
        <div className="row">
          <span className="row-label">Character</span>
          <Seg value={seq.character} options={[...withLora.map((c) => [c.id, c.name.split(' ')[0]]), ['none', 'None']]} onChange={(character) => edit({ character })} />
        </div>
        {refmodOnly.length > 0 && (
          <p className="small dim seq-refmod-note">
            {refmodOnly.map((c) => c.name.split(' ')[0]).join(', ')} {refmodOnly.length === 1 ? 'is a RefMod character' : 'are RefMod characters'}: a sequence needs a character with a LoRA, so {refmodOnly.length === 1 ? 'that one plays' : 'they play'} in Create instead.
            {char && !char.lora && ' This sequence still names one; pick another or None.'}
          </p>
        )}
        <div className="row seq-loras">
          <span className="row-label">LoRAs</span>
          <div className="lora-tray">
            {loras.map((l, i) => {
              const info = loraInfo(l.name)
              return (
                <div key={l.name} className="lora-chip">
                  <LoraThumb className="small" preview={info?.prefs?.picture ? { file: info.prefs.picture, type: 'image' } : info?.civitai?.preview} label={loraTitle(l.name)} mature={info?.civitai?.mature} />
                  <div className="lora-chip-body">
                    <span className="lora-chip-name" title={l.name}>
                      {info?.civitai?.name || l.title || loraTitle(l.name)}
                    </span>
                    <div className="lora-chip-strength">
                      <input type="range" min={0} max={1.5} step={0.05} value={l.strength} aria-label={`${loraTitle(l.name)} strength`} onChange={(e) => edit({ loras: loras.map((x, j) => (j === i ? { ...x, strength: Number(e.target.value) } : x)) })} />
                      <span className="mono small">{Number(l.strength).toFixed(2)}</span>
                    </div>
                  </div>
                  <button className="lora-chip-x" title="Take it out of the sequence" aria-label={`Remove ${loraTitle(l.name)}`} onClick={() => edit({ loras: loras.filter((_, j) => j !== i) })}>
                    ×
                  </button>
                </div>
              )
            })}
            {loras.length < MAX_LORAS && (
              <button className="lora-add" onClick={() => setPicking(true)}>
                + Add LoRA
              </button>
            )}
          </div>
        </div>
        {picking && <LoraPicker notify={notify} go={go} onClose={() => setPicking(false)} onPick={addLora} />}
        <AspectTiles aspects={ASPECTS} value={seq.aspect} onChange={(aspect) => edit({ aspect })} />
        <div className="row">
          <span className="row-label">Size</span>
          <Seg value={seq.megapixels} options={SIZES} format={(mp) => `${mp} MP`} onChange={(megapixels) => edit({ megapixels })} />
        </div>
        <div className="row">
          <span className="row-label">Shot length</span>
          <Seg value={seq.shotSeconds} options={[[10, '10 s'], [15, '15 s']]} onChange={(shotSeconds) => edit({ shotSeconds })} />
        </div>
        <div className="row">
          <span className="row-label">Seed</span>
          <div className="seed">
            <input type="number" value={seq.seed} onChange={(e) => edit({ seed: Math.max(0, Number(e.target.value) || 0) })} />
            <button className="btn btn-small" onClick={() => edit({ seed: Math.floor(Math.random() * 1e9) })}>
              🎲 New seed
            </button>
          </div>
        </div>
        {seq.method === 'take' && (
          <div className="row">
            <span className="row-label">Voice sample</span>
            <div className="voice-control">
              <button
                className="btn btn-small"
                onClick={async () => {
                  const [file] = await window.ivstudio.files.pick('audio')
                  if (file) edit({ voiceRef: file })
                }}
              >
                {seq.voiceRef ? 'Change' : '+ Voice to keep'}
              </button>
              {seq.voiceRef ? (
                <>
                  <span className="mono small">{seq.voiceRef.split(/[\\/]/).pop()}</span>
                  <button className="link-btn mono" onClick={() => edit({ voiceRef: null })}>
                    Remove
                  </button>
                </>
              ) : (
                <span className="dim small">Optional. A short clean recording the whole take keeps as the voice.</span>
              )}
            </div>
          </div>
        )}
      </Step>

      <Step n={4} title="Render" sub={`${shots.length} shot${shots.length === 1 ? '' : 's'} · ${total} s · roughly ${estimateMinutes(total, seq.megapixels)} min${seq.method === 'shots' ? ' in total, plus picking' : ''}`}>
        {seq.method === 'take' ? (
          <button className="btn btn-primary big" disabled={busy || takeRunning || shots.some((s) => !s.prompt.trim())} onClick={() => act(() => window.ivstudio.sequences.take(sequenceId))}>
            {takeRunning ? 'Rendering…' : view.versions.some((v) => v.kind === 'take') ? 'Render another take' : 'Render take'}
          </button>
        ) : (
          shots.map((s, i) => <ShotRow key={s.id} seqId={sequenceId} i={i} shot={s} state={view.shots[i]} live={live} onStart={onStart} notify={notify} flush={flush} />)
        )}
      </Step>

      <Step n={5} title="Versions" sub="Takes, the shot-by-shot result and retakes. Retake redoes a stretch; Render out makes the final.">
        {view.versions.length === 0 && <p className="dim small">Renders, the shot-by-shot result and retakes appear here.</p>}
        {view.versions.map((v) => {
          const j = v.job && (live[v.job.id] || v.job)
          const ver = { ...v, seqId: sequenceId }
          return (
            <div key={v.id} className="final">
              <div className="final-head">
                <span className="mono pink">{v.label}</span>
                {j?.seconds ? <span className="mono dim">{j.seconds} s render</span> : null}
                {v.file?.path && (
                  <>
                    <button className="link-btn mono" onClick={() => setPanel(panel?.versionId === v.id && panel.kind === 'retake' ? null : { kind: 'retake', versionId: v.id })}>
                      Retake…
                    </button>
                    <button className="link-btn mono" onClick={() => setPanel(panel?.versionId === v.id && panel.kind === 'out' ? null : { kind: 'out', versionId: v.id })}>
                      Render out…
                    </button>
                    <button className="link-btn mono" onClick={() => window.ivstudio.files.reveal(v.file).catch((err) => notify(err.message))}>
                      {remote ? 'Download' : 'Show in folder'}
                    </button>
                  </>
                )}
              </div>
              <Progress job={j} />
              {j?.status === 'error' && <Failure job={j} notify={notify} />}
              {v.prompt && <p className="mono dim small">{v.prompt}</p>}
              {panel?.versionId === v.id && panel.kind === 'retake' ? (
                <RetakePanel version={ver} onStart={onStart} notify={notify} />
              ) : (
                v.file && <video className="final-video" src={media(v.file.url)} controls preload="metadata" />
              )}
              {panel?.versionId === v.id && panel.kind === 'out' && <RenderOutPanel version={ver} method={seq.method} onStart={onStart} notify={notify} caps={caps} />}
            </div>
          )
        })}
      </Step>

      {view.renders.length > 0 && (
        <Step n={6} title="Finals" sub="Rendered out, ready to use.">
          {view.renders.map((r) => {
            const j = r.job && (live[r.job.id] || r.job)
            const v = view.versions.find((x) => x.id === r.versionId)
            return (
              <div key={r.id} className="final">
                <div className="final-head">
                  <span className="mono pink">Final of {v?.label || r.versionId}</span>
                  <span className="mono dim">
                    {r.normalize ? 'colour smoothed · ' : ''}
                    {r.scale === 2 ? 'RTX 2× · ' : ''}
                    {r.fps || 24} fps{j?.seconds ? ` · ${j.seconds} s render` : ''}
                  </span>
                  {r.file?.path && (
                    <button className="link-btn mono" onClick={() => window.ivstudio.files.reveal(r.file).catch((err) => notify(err.message))}>
                      {remote ? 'Download' : 'Show in folder'}
                    </button>
                  )}
                </div>
                <Progress job={j} />
                {j?.status === 'error' && <Failure job={j} notify={notify} />}
                {r.file && <video className="final-video" src={media(r.file.url)} controls preload="metadata" />}
              </div>
            )
          })}
        </Step>
      )}
      </div>
    </div>
  )
}
