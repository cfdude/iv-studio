import { useCallback, useEffect, useMemo, useState } from 'react'
import { setSelection } from '../selection'
import { confirmSpend } from './ComfyAccount'
import { finishFor, savedSpeed, SPEEDS } from '../../../service/speed'
import { media } from '../media'
import Hero from './Hero'
import Findings from './Findings'
import Failure from './Failure'
import { shapeOfPlan } from '../../../service/timing'
import { LiveFrame } from './Live'
import { CompareViewer, PromptDiff, runChanges } from './Compare'
import { askAgent, useAgentName } from './ChatPanel'
import { lintPrompt } from '../../../service/lint'
import { runAskWords } from '../runAsk'
import { dlssOn, enhancerChoices, finishDefaults, fpsChoices, fpsFor, pickEnhancer } from '../finish'
import { lintSeedance } from '../../../service/seedlint'

const DONE = ['success', 'error', 'cancelled']
// A local upscaler's strength: a slider with its value, the default marked, and a line saying what it does.
function Strength({ label, value, min, max, step, def, onChange, hint, plain, format = (v) => v.toFixed(2) }) {
  return (
    <div className="row">
      <span className="row-label">{label}</span>
      <div className="enhancer-pick strength-pick">
        <div className="strength-slider">
          <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label} />
          <span className="mono strength-value">{format(value)}</span>
          {Math.abs(value - def) > 1e-6 && (
            <button className="link-btn mono small" onClick={() => onChange(def)}>
              Default
            </button>
          )}
        </div>
        {hint && (
          <span className="dim small" data-plain={plain}>
            {hint}
          </span>
        )}
      </div>
    </div>
  )
}
const DLSS_STYLES = ['Default', 'Natural', 'Cinematic']
// DLSS 5's strength (its noise reduction) and style, as two rows
function DlssLook({ strength, style, onChange, label = 'DLSS strength' }) {
  return (
    <>
      <Strength label={label} value={strength} min={0} max={2} step={0.1} def={0.8} onChange={(v) => onChange({ dlssStrength: v })} format={(v) => v.toFixed(1)} hint={strength < 0.5 ? 'Gentle: closest to the take, little added texture.' : strength > 1.2 ? 'Strong: more contrast and skin texture; it can look gritty.' : 'Balanced: IV Studio’s tested setting is 0.8.'} />
      <div className="row">
        <span className="row-label">DLSS style</span>
        <div className="segmented">
          {DLSS_STYLES.map((s) => (
            <button key={s} className={style === s ? 'on' : ''} onClick={() => onChange({ dlssStyle: s })}>
              {s}
            </button>
          ))}
        </div>
      </div>
    </>
  )
}
const SEEDVR2_PLAIN = (v) => (v === 0 ? 'Brings back what is there, nothing made up.' : v < 0.2 ? 'Lets it redraw a little more.' : 'Lets it redraw more: smoother skin, but faces can change.')
const H3_PLAIN = (v) => (v <= 0.1 ? 'A light redraw: a bit more detail, faces change a little.' : v <= 0.2 ? 'A stronger redraw: more detail, faces change more.' : 'A heavy redraw: lots changes, faces too.')
const SEEDVR2_HINT = (v) => (v === 0 ? 'Restores what is there, faithfully (the default).' : v < 0.2 ? 'A little more redrawing.' : 'More redrawing: smoother skin, but faces can drift from the take.')
const H3_HINT = (v) => (v <= 0.1 ? 'The lightest H3 pass: adds detail, faces shift a little.' : v <= 0.2 ? 'More of H3’s detail; faces change more.' : 'Strong: H3 redraws a lot, faces change (0.4 is H3’s own finish).')
// What a finish is called on its card and in Compare: H3's own, or how a Seedance take was finished
export function finalLabel(f) {
  const n = f.plan?.finish?.candidate
  const way = f.plan?.engine === 'seedance' ? f.plan.finish?.way : null
  if (way === 'seedance') return `Final · take ${n} · Seedance 1080p`
  if (way === 'local' && f.plan.finish?.refiner === 'h3seedvr2') return `Final · take ${n} · H3 ${typeof f.plan.finish.strength === 'number' ? f.plan.finish.strength : f.plan.finish.strength || 'light'}, before SeedVR2`
  if (way === 'local' && f.plan.finish?.refiner === 'h3') return `Final · take ${n} · H3 ${typeof f.plan.finish.strength === 'number' ? f.plan.finish.strength : f.plan.finish.strength || 'light'} + DLSS 5`
  if (way === 'local' || way === 'take') return `Final · take ${n} · as it came`
  return `Final · take ${n}`
}
// The same, short, for Compare: "Take 1 · Seedance 1080p", "Take 1 · SeedVR2 1080p"
export function shortLabel(f, e = null) {
  const n = f.plan?.finish?.candidate
  if (e) return `Take ${n} · ${enhanceLabel(e)}`
  return finalLabel(f).replace(/^Final · take \d+/, `Take ${n} final`)
}
export const enhanceLabel = (e) => {
  const en = e.plan?.enhance || {}
  if (en.engine === 'dlss') return `DLSS 5 ${en.scale}×${en.strength != null && en.strength !== 0.8 ? ` · strength ${en.strength}` : ''}${en.style && en.style !== 'Default' ? ` · ${en.style}` : ''}`
  return `SeedVR2 ${en.resolution}p${en.detail ? ` · detail ${en.detail}` : ''}`
}
const FINAL_MP = [1, 1.5, 2]
const MODE_NAME = { text: 'Text', reference: 'References', frames: 'First / last frame', continue: 'Continue' }

export function Progress({ job }) {
  if (!job || DONE.includes(job.status)) return null
  const p = job.progress
  const pct = p ? Math.round((p.value / p.max) * 100) : null
  return (
    <div className="progress">
      <div className="bar">
        <span style={{ width: `${pct ?? 6}%` }} className={pct == null ? 'indeterminate' : ''} />
      </div>
      <span className="mono dim">
        {job.status === 'queued' ? `Queued${job.queuePosition ? ` · #${job.queuePosition}` : ''}` : p ? `Step ${p.value}/${p.max}` : 'Working…'}
      </span>
      <button className="link-btn mono" onClick={() => window.ivstudio.jobs.cancel(job.id)}>
        Cancel
      </button>
      {job.status !== 'queued' && <LiveFrame promptId={job.promptId} takes={job.plan?.resolved?.previews || 1} />}
    </div>
  )
}

// A take reviewed against its prompt (review.js): the verdict, what works, each problem at its seconds (a click
// plays the take from there), the fix, and the revised prompt to run again.
const VERDICT = { usable: 'Usable as it is', usable_with_fixes: 'Usable, with fixes', redo: 'Redo it' }
const ENGINE = { claude: 'Claude Code', codex: 'Codex', hermes: 'Hermes', local: 'the local writer' }
function ReviewCard({ review, title, videoKey, before, onRun }) {
  const seek = (t) => {
    const v = document.querySelector(`video[data-take="${videoKey}"]`)
    if (v) (v.currentTime = t, v.play().catch(() => {}))
  }
  return (
    <div className={`review-card ${review.verdict}`}>
      <div className="review-head">
        <span className="mono small">{title}</span>
        <span className="mono pink small">{VERDICT[review.verdict]}</span>
        <span className="dim small">by {ENGINE[review.engine] || review.engine}</span>
      </div>
      {review.engine === 'local' && <p className="dim small">The local writer only reviews roughly. Claude Code or Codex (Settings → Prompt writer) see far more.</p>}
      {review.works?.length > 0 && <p className="small"><span className="dim">Works: </span>{review.works.join(' · ')}</p>}
      {review.issues?.length > 0 && (
        <ul className="review-issues">
          {review.issues.map((x, i) => (
            <li key={i}>
              <button className="link-btn mono small" onClick={() => seek(x.from)}>
                {x.from}–{x.to} s
              </button>{' '}
              <span className="mono dim small">{x.kind}</span> {x.what}
              {x.again ? <span className="pink small"> (came back after a revision)</span> : x.unmet && <span className="dim small"> (the prompt asked for this)</span>}
            </li>
          ))}
        </ul>
      )}
      <p className="small">
        <span className="mono">{review.fix?.label}</span>
        {review.fix?.kind === 'clean_stretch' && (
          <>
            {' '}
            <button className="link-btn mono small" onClick={() => seek(review.fix.from)}>
              {review.fix.from}–{review.fix.to} s
            </button>
          </>
        )}
        {review.fix?.why ? `: ${review.fix.why}` : ''}
      </p>
      {review.repeat && <p className="notice small">{review.repeat}</p>}
      {review.revisedPrompt && (
        <div className="review-actions">
          <button className="btn btn-small" onClick={() => onRun(review.revisedPrompt)}>
            Edit and run again with this prompt
          </button>
          {review.revisedErrors?.length > 0 && <span className="notice small">The checker still finds: {review.revisedErrors.join(' ')}</span>}
          <details>
            <summary className="mono dim small">What it changes</summary>
            <PromptDiff before={before} after={review.revisedPrompt} />
          </details>
        </div>
      )}
    </div>
  )
}

const ENHANCER_NAMES = { dlss: 'DLSS 5', upscale: '2× upscale', seedvr2: 'SeedVR2' }
const ENHANCER_HINTS = {
  dlss: 'Cleans up and can upscale 2× and add frames. Quick.',
  upscale: 'Upscales 2× and adds frames (Real-ESRGAN and RIFE), without DLSS 5.',
  seedvr2: 'Restores detail after the finish. Slower; 24 fps.'
}

// Finishing a Seedance 2.5 take (seedance.js). Three ways:
//   seedance  a draft only: Seedance renders it again at 1080p from the draft (paid, priced and confirmed first)
//   local     free on this PC: SeedVR2 restores it to 1080p or 1440p (keeps faces), or H3 refines it at 1-2 MP at a
//             light strength and DLSS 5 cleans it up (h3refine.js; faces shift a little)
//   take      the take itself becomes the final, as it is
function SeedanceFinishPanel({ job, candidate, onStart, notify, caps, remote, ownCloud, characters = [] }) {
  const draft = !!job.plan.resolved?.draft
  // only what runs on this machine: SeedVR2 needs a CUDA GPU (never an Apple GPU; or the person's own cloud), DLSS 5
  // needs DLSS in this ComfyUI, and H3's pass needs one of the two to follow it
  const seedvr2Ok = !!ownCloud || caps?.gpuKind === 'cuda'
  const dlssOk = !ownCloud && dlssOn(caps)
  const engines = [seedvr2Ok && 'seedvr2', dlssOk && 'dlss', !ownCloud && dlssOk && 'h3', !ownCloud && seedvr2Ok && 'h3seedvr2'].filter(Boolean)
  // free on this PC first; paid Seedance 1080p is one click away (and asks before it spends)
  // (the person's own cloud finishes with SeedVR2 there; Comfy Cloud has no free finish)
  const [wayPicked, setWay] = useState(remote && !ownCloud ? (draft ? 'seedance' : 'take') : 'local')
  const [opts, setOpts] = useState({ engine: 'seedvr2', resolution: 1080, megapixels: 2, strength: 0.1, detail: 0, dlssStrength: 0.8, dlssStyle: 'Default', upscale2x: false, useLora: false })
  const set = (patch) => setOpts((o) => ({ ...o, ...patch }))
  const engine = engines.includes(opts.engine) ? opts.engine : engines[0] || 'seedvr2'
  const local = ownCloud || (!remote && engines.length > 0)
  const [price, setPrice] = useState(null)
  const [size, setSize] = useState(null)
  const [busy, setBusy] = useState(false)
  const ch = characters.find((c) => c.id === job.plan.request?.character)
  const way = wayPicked === 'local' && !local ? (draft ? 'seedance' : 'take') : wayPicked
  useEffect(() => {
    let live = true
    window.ivstudio.render.priceFinish({ jobId: job.id, way }).then((p) => live && setPrice(p), () => live && setPrice(null))
    window.ivstudio.render.planFinish(job.id, { candidate, way, ...opts, engine }).then((r) => live && setSize(r), () => live && setSize(null))
    return () => (live = false)
  }, [job.id, way, opts, engine])
  async function go() {
    setBusy(true)
    try {
      let spend
      if (way === 'seedance') {
        spend = await confirmSpend(await window.ivstudio.render.priceFinish({ jobId: job.id, way }), { what: `take ${candidate} at 1080p` })
        if (!spend) return
      }
      onStart(await window.ivstudio.render.finish({ jobId: job.id, candidate, way, ...(way === 'local' ? { ...opts, engine } : {}), ...(spend ? { spend } : {}) }))
    } catch (err) {
      notify(err.message)
    } finally {
      setBusy(false)
    }
  }
  const ways = [...(draft ? [['seedance', 'Seedance 1080p']] : []), ...(ownCloud ? [['local', 'In your cloud']] : remote || !local ? [] : [['local', 'On this computer · free']]), ['take', 'As it is']]
  const note =
    way === 'seedance'
      ? `Seedance renders this draft again at 1080p, on your Comfy.org credits. ComfyUI prices it as ${price?.label || '…'}${price?.likelyUsd ? `; at this length it is likely about $${price.likelyUsd.toFixed(2)} (the 1080p rate)` : ''}. You agree to the top of the range.`
      : way === 'local'
        ? ownCloud
          ? 'Finished with SeedVR2 on your cloud GPU, billed by the second while it runs.'
          : 'Finished on your graphics card, free.'
        : 'The take becomes the shot’s final now. Enhance (DLSS 5 or SeedVR2) can still run on it afterwards.'
  const enginePlain = {
    seedvr2: 'Makes it bigger and adds back fine detail, keeping the faces, movement and sound. The cleanest result; about 4 minutes for a 5-second shot.',
    dlss: 'Makes it bigger fast (about 15 seconds), keeping the faces, movement and sound. It adds some skin texture; less strength keeps it gentler.',
    h3: 'The video model draws it again at full size, keeping the movement and sound, then quick sharpen tidies it. Faces change a little. About 3 minutes.',
    h3seedvr2: 'The video model draws it again at full size, keeping the movement and sound, then detail restore adds back fine detail. Faces change a little. About 7 minutes.'
  }[engine]
  const engineNote =
    engine === 'seedvr2'
      ? 'Restores detail and upscales, keeping Seedance’s faces, motion and sound. The cleanest; about 4 minutes for 5 s at 1080p.'
      : engine === 'dlss'
        ? 'Upscales, keeping Seedance’s faces, motion and sound. The quickest, about 15 s; it adds some skin texture (lower strength stays closer to the take).'
        : engine === 'h3seedvr2'
          ? 'H3 renders it again at full size, keeping Seedance’s motion and sound, then SeedVR2 restores detail. H3’s look with SeedVR2’s clean finish; faces shift a little. About 7 minutes.'
          : 'H3 renders it again at full size, keeping Seedance’s motion and sound, then DLSS 5 cleans it up. More of H3’s look; faces shift a little. About 3 minutes.'
  return (
    <div className="finish-panel">
      <div className="finish-head">
        <span className="finish-kicker mono">Finish</span>
        <h3>Take {candidate}</h3>
        <span className="dim small">{draft ? 'A 480p Seedance draft.' : 'A Seedance take at final quality.'}</span>
      </div>
      <div className="finish-grid">
        <div className="row">
          <span className="row-label">How</span>
          <div className="enhancer-pick">
            <div className="segmented">
              {ways.map(([id, label]) => (
                <button key={id} className={way === id ? 'on' : ''} onClick={() => setWay(id)}>
                  {label}
                </button>
              ))}
            </div>
            <span className="dim small">{note}</span>
          </div>
        </div>
        {way === 'local' && (
          <div className="row">
            <span className="row-label">With</span>
            <div className="enhancer-pick">
            <div className="segmented">
              {engines.map((id) => (
                <button key={id} className={engine === id ? 'on' : ''} onClick={() => set({ engine: id })}>
                  {{ seedvr2: 'SeedVR2', dlss: 'DLSS 5', h3: 'H3 + DLSS 5', h3seedvr2: 'H3 + SeedVR2' }[id]}
                </button>
              ))}
            </div>
            <span className="dim small" data-plain={enginePlain}>
              {engineNote}
            </span>
            </div>
          </div>
        )}
        {way === 'local' && (engine === 'seedvr2' || engine === 'dlss') && (
          <div className="row">
            <span className="row-label">Size</span>
            <div className="segmented">
              {[1080, 1440].map((r) => (
                <button key={r} className={opts.resolution === r ? 'on' : ''} onClick={() => set({ resolution: r })}>
                  {r}p
                </button>
              ))}
            </div>
          </div>
        )}
        {way === 'local' && engine === 'seedvr2' && <Strength label="Added detail" value={opts.detail} min={0} max={0.5} step={0.05} def={0} onChange={(v) => set({ detail: v })} hint={SEEDVR2_HINT(opts.detail)} plain={SEEDVR2_PLAIN(opts.detail)} />}
        {way === 'local' && engine === 'dlss' && <DlssLook strength={opts.dlssStrength} style={opts.dlssStyle} onChange={set} />}
        {way === 'local' && (engine === 'h3' || engine === 'h3seedvr2') && (
          <>
            <div className="row">
              <span className="row-label">{engine === 'h3' ? 'Final size' : 'H3 size'}</span>
              <div className="segmented">
                {FINAL_MP.map((mp) => (
                  <button key={mp} className={opts.megapixels === mp ? 'on' : ''} onClick={() => set({ megapixels: mp })}>
                    {mp} MP
                  </button>
                ))}
              </div>
            </div>
            <Strength label="H3 strength" value={opts.strength} min={0.05} max={0.5} step={0.05} def={0.1} onChange={(v) => set({ strength: v })} hint={H3_HINT(opts.strength)} plain={H3_PLAIN(opts.strength)} />
            {engine === 'h3' ? (
              <>
                <DlssLook strength={opts.dlssStrength} style={opts.dlssStyle} onChange={set} label="Then DLSS" />
                <div className="row">
                  <span className="row-label">RTX upscale</span>
                  <div className="segmented">
                    <button className={!opts.upscale2x ? 'on' : ''} onClick={() => set({ upscale2x: false })}>
                      Off
                    </button>
                    <button className={opts.upscale2x ? 'on' : ''} onClick={() => set({ upscale2x: true })}>
                      2×
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="row">
                  <span className="row-label">SeedVR2 size</span>
                  <div className="segmented">
                    {[1080, 1440].map((r) => (
                      <button key={r} className={opts.resolution === r ? 'on' : ''} onClick={() => set({ resolution: r })}>
                        {r}p
                      </button>
                    ))}
                  </div>
                </div>
                <Strength label="SeedVR2 detail" value={opts.detail} min={0} max={0.5} step={0.05} def={0} onChange={(v) => set({ detail: v })} hint={SEEDVR2_HINT(opts.detail)} plain={SEEDVR2_PLAIN(opts.detail)} />
              </>
            )}
            {ch?.lora && (
              <div className="row">
                <span className="row-label">{ch.name.split(' ')[0]}’s LoRA</span>
                <div className="enhancer-pick">
                  <div className="segmented">
                    <button className={!opts.useLora ? 'on' : ''} onClick={() => set({ useLora: false })}>
                      Off
                    </button>
                    <button className={opts.useLora ? 'on' : ''} onClick={() => set({ useLora: true })}>
                      On
                    </button>
                  </div>
                  <span className="dim small">Off keeps the face from Seedance. On pulls it toward the trained {ch.name.split(' ')[0]}.</span>
                </div>
              </div>
            )}
          </>
        )}
      </div>
      <div className="finish-go">
        <span className="mono">{way === 'seedance' ? `1080p · ${price ? price.label : '…'}` : size ? `${size.width} × ${size.height} · ${size.fps || 24} fps · free` : '…'}</span>
        <button className="btn btn-primary" disabled={busy} onClick={go}>
          {busy ? 'Starting…' : way === 'seedance' ? `Finish · up to ${price?.max ? `$${price.max.toFixed(2)}` : '…'}` : way === 'local' ? 'Finish' : 'Use this take'}
        </button>
      </div>
    </div>
  )
}

// What a finish can offer on this ComfyUI (finish.js), plus SeedVR2 in the person's own cloud (RunPod, Modal), which runs it on CUDA
const finishChoices = (caps, remote, ownCloud) => {
  const c = enhancerChoices(caps, remote)
  return ownCloud && !c.includes('seedvr2') ? [...c, 'seedvr2'] : c
}

function FinishPanel({ job, candidate, onStart, notify, caps, remote, ownCloud }) {
  const choices = finishChoices(caps, remote, ownCloud)
  const dlss = dlssOn(caps)
  const [opts, setOpts] = useState({ megapixels: 2, upscale2x: false, fps: 0, audio: 'pass', enhancer: pickEnhancer('dlss', choices), enhanceResolution: 1080, dlssStrength: 0.8, dlssStyle: 'Default' })
  const [shotSpeed, setShotSpeed] = useState(job.plan.request?.speed || null)
  // the shot's speed preset (else the saved one) sets the finish size and the 2x; the defaults Check my computer chose
  // set the enhancer, and on the 2× upscale its 2× and frame rate. Read again once this ComfyUI has been read (what
  // it can do decides what they become).
  const capsRead = !!caps
  useEffect(() => {
    window.ivstudio.settings.get().then((s) => {
      const id = job.plan.request?.speed || savedSpeed(s)
      setShotSpeed(id)
      const d = s.shotPrefs ? finishDefaults(s.shotPrefs, caps, remote) : {}
      delete d.megapixels // the shot's own preset decides the size
      const enh = pickEnhancer(d.enhancer || 'dlss', choices)
      const f = finishFor(id, { upscale2x: enh === 'upscale' ? !!caps?.esrgan : caps?.upscale2x !== false })
      setOpts((o) => ({ ...o, ...f, ...d }))
    }, () => {})
  }, [capsRead])
  const enhancer = pickEnhancer(opts.enhancer, choices)
  const seedvr2 = enhancer === 'seedvr2'
  const upscale = enhancer === 'upscale'
  const FPS = fpsChoices(caps, enhancer, opts.fps)
  const canFps = fpsFor(caps, enhancer)
  const [size, setSize] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (patch) => setOpts((o) => ({ ...o, ...patch }))
  // a Continue shot from the app's own chains finishes in one pass at preview size; one made in Create (continueFull) gets the full finish
  const single = job.plan.request?.mode === 'continue' && !job.plan.request?.continueFull
  // how long this finish will take here, from this machine's own finishes (src/service/timing.js)
  const [eta, setEta] = useState(null)
  useEffect(() => {
    const r = job.plan.resolved || {}
    const want = { kind: 'finish', megapixels: opts.megapixels, upscale2x: opts.upscale2x, enhancer: opts.enhancer, seconds: (r.frames || 0) / (r.fps || 24), fps: r.fps || 24 }
    if (!shapeOfPlan(want)) return setEta(null)
    let alive = true
    window.ivstudio.timing.estimate(want).then((e) => alive && setEta(e), () => alive && setEta(null))
    return () => (alive = false)
  }, [opts.megapixels, opts.upscale2x, opts.enhancer, job.id])
  const hasVoice = !!job.plan.request?.voiceLine

  useEffect(() => {
    window.ivstudio.render
      .planFinish(job.id, { candidate, ...opts, enhancer })
      .then(setSize)
      .catch(() => setSize(null))
  }, [opts, enhancer, job.id, candidate])

  async function go() {
    setBusy(true)
    try {
      onStart(await window.ivstudio.render.finish({ jobId: job.id, candidate, ...opts, enhancer }))
    } catch (err) {
      notify(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="finish-panel">
      <div className="finish-head">
        <span className="finish-kicker mono">Finish</span>
        <h3>Take {candidate}</h3>
        <span className="dim small">Rendered again at full size from this take, then cleaned up and sharpened.</span>
      </div>
      <div className="finish-grid">
      {!single && (
        <div className="row">
          <span className="row-label">Final size</span>
          <div className="segmented">
            {FINAL_MP.map((mp) => (
              <button key={mp} className={opts.megapixels === mp ? 'on' : ''} onClick={() => set({ megapixels: mp })}>
                {mp} MP
              </button>
            ))}
          </div>
          {shotSpeed && <span className="dim small finish-speed">Started from the {SPEEDS[shotSpeed].label} speed preset.{opts.megapixels >= 2 ? ' A 2 MP pass is the slowest step on cards under 22 GB.' : ''}</span>}
        </div>
      )}
      {choices.length > 1 && (
        <div className="row">
          <span className="row-label">Enhancer</span>
          <div className="enhancer-pick">
            <div className="segmented">
              {choices.map((c) => (
                <button key={c} className={enhancer === c ? 'on' : ''} onClick={() => set({ enhancer: c, ...(c === 'seedvr2' || (c === 'upscale' && !caps?.esrgan) ? { upscale2x: false } : {}), ...(c === 'seedvr2' ? { fps: 0 } : {}), ...(!fpsFor(caps, c).includes(opts.fps) ? { fps: 0 } : {}) })}>
                  {ENHANCER_NAMES[c]}
                </button>
              ))}
            </div>
            <span className="dim small">{ENHANCER_HINTS[enhancer]}</span>
          </div>
        </div>
      )}
      {seedvr2 ? (
        <div className="row">
          <span className="row-label">SeedVR2 size</span>
          <div className="segmented">
            {[1080, 1440, 2160].map((r) => (
              <button key={r} className={opts.enhanceResolution === r ? 'on' : ''} onClick={() => set({ enhanceResolution: r })}>
                {r}p
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="row">
            <span className="row-label">{enhancer === 'dlss' ? 'RTX upscale' : '2× upscale'}</span>
            <div className="segmented">
              <button className={!opts.upscale2x ? 'on' : ''} onClick={() => set({ upscale2x: false })}>
                Off
              </button>
              <button className={opts.upscale2x ? 'on' : ''} disabled={upscale && !caps?.esrgan} title={upscale && !caps?.esrgan ? 'Download Real-ESRGAN x2 in Setup first' : undefined} onClick={() => set({ upscale2x: true })}>
                2×
              </button>
            </div>
          </div>
          {enhancer === 'dlss' && dlss && !remote && <DlssLook strength={opts.dlssStrength} style={opts.dlssStyle} onChange={set} />}
          <div className="row">
            <span className="row-label">Frame rate</span>
            <div className="segmented">
              {FPS.map((f) => (
                <button key={f} className={opts.fps === f ? 'on' : ''} disabled={!!f && !canFps.includes(f)} title={f && !canFps.includes(f) ? 'Needs the Frame Interpolation (RIFE) pack' : undefined} onClick={() => set({ fps: f })}>
                  {f ? f : '24'}
                </button>
              ))}
            </div>
            {upscale && !caps?.rife && <span className="dim small">Frame rates above 24 need the Frame Interpolation (RIFE) pack: install it (Setup lists it on a Mac or Linux).</span>}
          </div>
        </>
      )}
      {!single && (
        <div className="row">
          <span className="row-label">Sound</span>
          <div className="segmented">
            <button className={opts.audio === 'pass' ? 'on' : ''} onClick={() => set({ audio: 'pass' })}>
              Generated
            </button>
            <button className={opts.audio === 'preview' ? 'on' : ''} onClick={() => set({ audio: 'preview' })} title="Keeps a voice cloned from an <Audio> reference or RefMod">
              Preview's
            </button>
            {hasVoice && (
              <button className={opts.audio === 'voice' ? 'on' : ''} onClick={() => set({ audio: 'voice' })}>
                My recording
              </button>
            )}
          </div>
        </div>
      )}
      </div>
      {eta?.line && <p className="eta-line small dim">{eta.line}</p>}
      <div className="finish-go">
        <span className="mono">{size ? `${size.width} × ${size.height} · ${size.fps} fps${single ? ' · single pass' : ''}` : '…'}</span>
        <button className="btn btn-primary" disabled={busy} onClick={go}>
          {busy ? 'Starting…' : 'Finish'}
        </button>
      </div>
    </div>
  )
}

// A run's finished versions in one card: a chip for every final (however it was finished) and every enhanced copy,
// one player for the chosen one, its actions in one row, and Enhance folded behind a button. Replaces a stack of
// full-size players, so a shot with several finishes doesn't run on for screens.
function VersionsCard({ run, finishes, jobs, remote, ownCloud, caps, notify, marks, onMark, onCompare, review, reviewing, enhance, enhancing, written, editRun, project, versionOf, shotFromVersion, pictureToEdit }) {
  // Enhance offers only what runs here: DLSS 5 where ComfyUI has it, SeedVR2 on a CUDA GPU or the person's own cloud
  const dlssOk = dlssOn(caps)
  const seedvr2Ok = !!ownCloud || enhancerChoices(caps, remote).includes('seedvr2')
  const enhanceOk = dlssOk || seedvr2Ok
  const list = []
  for (const f of finishes) {
    list.push({ key: f.id, job: f, finish: f, out: f.outputs.find((o) => o.kind === 'final'), label: shortLabel(f), kind: 'final' })
    for (const e of jobs.filter((x) => x.kind === 'enhance' && x.parent === f.id)) list.push({ key: e.id, job: e, finish: f, out: e.outputs?.find((o) => o.kind === 'final'), label: shortLabel(f, e), kind: 'enhance' })
  }
  const ready = list.filter((v) => v.out?.url)
  // a chip's words: how the final was made, or the enhancer of a copy; the take number only when several takes were finished
  const takes = new Set(finishes.map((f) => f.plan?.finish?.candidate))
  const how = (f) => {
    const w = finalLabel(f).split(' · ').slice(2).join(' · ')
    return w || 'final'
  }
  const chipOf = (x) => `${takes.size > 1 ? `Take ${x.finish.plan?.finish?.candidate} · ` : ''}${x.kind === 'final' ? how(x.finish) : `→ ${enhanceLabel(x.job)}`}`
  const [chosen, setChosen] = useState(null)
  const [more, setMore] = useState(false)
  const [frameMenu, setFrameMenu] = useState(false)
  const [carrying, setCarrying] = useState(null) // 'continue' | 'frame' while the file is fetched or read
  const [look, setLook] = useState({ dlssStrength: 0.8, dlssStyle: 'Default', detail: 0 })
  const setL = (patch) => setLook((l) => ({ ...l, ...patch }))
  // the newest version that has a video, unless one was chosen
  const v = list.find((x) => x.key === chosen) || [...ready].reverse()[0] || list[list.length - 1]
  if (!v) return null
  const f = v.finish
  // an enhanced copy's own size: DLSS scales the final, SeedVR2 sets its short side
  const base = f.plan.resolved || {}
  const en = v.kind === 'enhance' ? v.job.plan?.enhance : null
  const res = !en
    ? base
    : en.engine === 'dlss'
      ? { width: Math.round((base.width * en.scale) / 2) * 2, height: Math.round((base.height * en.scale) / 2) * 2, fps: base.fps }
      : { width: Math.round((base.width * en.resolution) / Math.min(base.width, base.height) / 2) * 2, height: Math.round((base.height * en.resolution) / Math.min(base.width, base.height) / 2) * 2, fps: base.fps }
  const chips = [res?.width && `${res.width}×${res.height}`, (res?.fps || 24) && `${res?.fps || 24} fps`, v.job.seconds && `${v.job.seconds} s render`].filter(Boolean)
  const markKey = `${run.id}:${v.key}`
  const state = (x) => (x.out?.url ? '' : x.job.status === 'error' ? 'error' : 'busy')
  // Continue from this: the version as a Continue shot's source video (a cloud render is downloaded first)
  async function carryOn() {
    setCarrying('continue')
    try {
      const file = await window.ivstudio.media.localCopy({ path: v.out.path || null, url: v.out.url })
      shotFromVersion(run, 'continue', file)
    } catch (err) {
      notify(err.message)
    } finally {
      setCarrying(null)
    }
  }
  // Use the last frame: saved as a picture (Library, Create -> Image), then a first frame, a picture to edit, or kept
  async function takeFrame(then) {
    setCarrying('frame')
    try {
      const rec = await window.ivstudio.images.lastFrame({ file: { path: v.out.path || null, url: v.out.url }, name: `${project?.name || 'Shot'} · last frame` })
      const file = rec.files[0]
      setFrameMenu(false)
      if (then === 'shot') shotFromVersion(run, 'frames', file)
      else if (then === 'edit') pictureToEdit(file)
      else notify(`Saved "${rec.name}" to the Library (Images).`, 'ok')
    } catch (err) {
      notify(err.message)
    } finally {
      setCarrying(null)
    }
  }
  return (
    <div className="versions-card">
      <div className="versions-head">
        <span className="final-badge mono">★ Finished versions</span>
        {ready.length > 1 && (
          <button className="btn btn-small" onClick={() => onCompare(ready.slice(-4).map((x) => versionOf(run, x.key, x.out.url, x.label)))}>
            Compare {Math.min(ready.length, 4)} versions
          </button>
        )}
      </div>
      <div className="version-chips" role="tablist" aria-label="Finished versions">
        {list.map((x) => (
          <button key={x.key} role="tab" aria-selected={x.key === v.key} className={`version-chip ${x.key === v.key ? 'on' : ''} ${state(x)}`} onClick={() => (setChosen(x.key), setSelection('shot', { version: `${project?.name ? `${project.name}: ` : ''}${x.label}`, ...(x.out?.path ? { file: x.out.path } : {}) }))} title={x.job.status === 'error' ? x.job.error : ''}>
            {chipOf(x)}
            {state(x) === 'busy' && <span className="version-dot" aria-label="rendering" />}
            {state(x) === 'error' && <span className="version-err">!</span>}
          </button>
        ))}
      </div>
      <div className="version-main">
        <div className="version-meta">
          <span className="mono">{v.label}</span>
          <span className="run-chips mono">
            {chips.map((c) => (
              <span key={c}>{c}</span>
            ))}
          </span>
        </div>
        <Progress job={v.job} />
        {v.job.status === 'error' && <Failure job={v.job} notify={notify} />}
        {v.out?.url && <video key={v.key} className="final-video" data-take={`${f.id}:final`} src={media(v.out.url)} controls preload="metadata" />}
        <div className="version-actions">
          {v.out?.path && (
            <button className="link-btn mono" onClick={() => window.ivstudio.files.reveal(v.out).catch((err) => notify(err.message))}>
              {remote ? 'Download' : 'Show in folder'}
            </button>
          )}
          {v.out?.url && (
            <button className={`link-btn mono ${marks(markKey) ? 'pink' : ''}`} onClick={() => onMark(versionOf(run, v.key, v.out.url, v.label))}>
              {marks(markKey) ? 'Marked' : 'Mark'}
            </button>
          )}
          {v.kind === 'final' && v.out?.path && !remote && (
            <button className="link-btn mono" disabled={!!reviewing[`${f.id}:0`]} onClick={() => review(f, 0)}>
              {reviewing[`${f.id}:0`] ? 'Reviewing…' : 'Review'}
            </button>
          )}
          {v.kind === 'final' && v.out?.path && (!remote || ownCloud) && enhanceOk && (
            <button className={`link-btn mono ${more ? 'pink' : ''}`} onClick={() => (setMore(!more), setFrameMenu(false))} aria-expanded={more}>
              Enhance {more ? '▴' : '▾'}
            </button>
          )}
          {v.out?.url && shotFromVersion && (
            <button className="link-btn mono version-carry" disabled={!!carrying} onClick={() => carryOn()} title="A new shot that picks up where this version ends">
              {carrying === 'continue' ? 'Opening…' : 'Continue from this'}
            </button>
          )}
          {v.out?.url && (
            <button className={`link-btn mono version-lastframe ${frameMenu ? 'pink' : ''}`} disabled={!!carrying} onClick={() => (setFrameMenu(!frameMenu), setMore(false))} aria-expanded={frameMenu}>
              {carrying === 'frame' ? 'Reading the frame…' : `Use the last frame ${frameMenu ? '▴' : '▾'}`}
            </button>
          )}
        </div>
        {frameMenu && v.out?.url && (
          <div className="lastframe-drawer">
            <span className="dim small">The final frame of this version, saved as a picture in the Library.</span>
            <div className="lastframe-actions">
              {shotFromVersion && (
                <button className="btn btn-small" disabled={!!carrying} onClick={() => takeFrame('shot')}>
                  Start a shot from it
                </button>
              )}
              {pictureToEdit && (
                <button className="btn btn-small" disabled={!!carrying} onClick={() => takeFrame('edit')}>
                  Edit it as a picture
                </button>
              )}
              <button className="btn btn-small" disabled={!!carrying} onClick={() => takeFrame('save')}>
                Just save it
              </button>
            </div>
          </div>
        )}
        {more && v.kind === 'final' && v.out?.path && (!remote || ownCloud) && enhanceOk && (
          <div className="enhance-drawer">
            <span className="dim small enhance-sub">A sharper copy, added beside this one. Set the strength, then pick the size.</span>
            <div className="finish-grid enhance-grid">
              {dlssOk && (
                <>
                  <DlssLook strength={look.dlssStrength} style={look.dlssStyle} onChange={setL} />
                  <div className="row">
                    <span className="row-label">DLSS 5</span>
                    <div className="enhancer-pick">
                      <div className="segmented">
                        {[1, 2].map((scale) => (
                          <button key={`d${scale}`} disabled={!!enhancing[f.id]} onClick={() => (enhance(f, { engine: 'dlss', scale, strength: look.dlssStrength, style: look.dlssStyle }), setMore(false))}>
                            Make {scale}×
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </>
              )}
              {seedvr2Ok && (
                <>
                  <Strength label="SeedVR2 detail" value={look.detail} min={0} max={0.5} step={0.05} def={0} onChange={(v) => setL({ detail: v })} hint={SEEDVR2_HINT(look.detail)} plain={SEEDVR2_PLAIN(look.detail)} />
                  <div className="row">
                    <span className="row-label">SeedVR2</span>
                    <div className="enhancer-pick">
                      <div className="segmented">
                        {[1080, 1440].map((r) => (
                          <button key={`s${r}`} disabled={!!enhancing[f.id]} onClick={() => (enhance(f, { engine: 'seedvr2', resolution: r, detail: look.detail }), setMore(false))}>
                            Make {r}p
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
        {v.kind === 'final' && f.reviews?.final && <ReviewCard review={f.reviews.final} title="Review of the final" videoKey={`${f.id}:final`} before={written} onRun={(p) => editRun?.(run, project, p)} />}
      </div>
    </div>
  )
}

// The finish settings for a picked take, in a dialog over the page, so nothing has to be scrolled to.
function FinishDialog({ children, onClose }) {
  useEffect(() => {
    const key = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal finish-modal" role="dialog" aria-modal="true" aria-label="Finish a take">
        <button className="finish-modal-x" onClick={onClose} aria-label="Close">
          ×
        </button>
        {children}
      </div>
    </div>
  )
}

export default function Shot({ projectId, jobs: live, setJobs, notify, go, caps, remote, ownCloud, editRun, openSequence, openEdit, shotFromVersion, pictureToEdit, characters = [] }) {
  // the version picked for the chat goes when the shot page does (selection.js)
  useEffect(() => () => setSelection('shot', null), [])
  const [project, setProject] = useState(null)
  // the person's own Claude Code or Codex, for "Chat with … about this run" and "Have … pick the best take" on a run (ChatPanel.jsx)
  const agent = useAgentName()
  // a sequence's shot-by-shot project: which shot each run is (sequences.runsOf), so edits go back through it
  const [seqRuns, setSeqRuns] = useState(null)
  const [linking, setLinking] = useState(null)
  async function linkRun(run, index) {
    setLinking(run.id)
    try {
      await window.ivstudio.sequences.linkRun(seqRuns.sequenceId, { jobId: run.id, index })
      setSeqRuns(await window.ivstudio.sequences.runsOf(projectId))
      notify(`That run is shot ${index + 1} of ${seqRuns.sequenceName} now. Pick and finish it there.`, 'info')
    } catch (err) {
      notify(err.message)
    } finally {
      setLinking(null)
    }
  }
  const [jobIds, setJobIds] = useState([])
  const [picked, setPicked] = useState({})
  const [name, setName] = useState('')
  // versions marked for Compare (up to four: takes, finals, enhanced copies): { key, url, label, prompt }; the
  // Compare button opens them once two are marked
  const [marked, setMarked] = useState([])
  const [comparing, setComparing] = useState(false)
  const mark = (take) => setMarked((m) => (m.some((x) => x.key === take.key) ? m.filter((x) => x.key !== take.key) : [...m, take].slice(-4)))
  const compareNow = (list) => (setMarked(list), setComparing(true))
  const isMarked = (key) => marked.some((m) => m.key === key)
  // take ranking (ranking.js): runs as they finish are ranked by the app; older ones on request
  const [ranking, setRanking] = useState({})
  async function rank(run) {
    setRanking((r) => ({ ...r, [run.id]: true }))
    try {
      const job = await window.ivstudio.rank.job(run.id)
      setJobs((all) => ({ ...all, [job.id]: job }))
    } catch (err) {
      notify(err.message)
    } finally {
      setRanking((r) => ({ ...r, [run.id]: false }))
    }
  }
  // a take that cuts away mid-shot (ranking.js): its longest stretch without the cut, to an edit or to carry on from
  const [cleaning, setCleaning] = useState({})
  async function useClean(run, candidate, forContinue) {
    const key = `${run.id}:${candidate}`
    setCleaning((c) => ({ ...c, [key]: true }))
    try {
      const part = await window.ivstudio.rank.clean(run.id, candidate, { forContinue })
      if (forContinue) {
        const asked = run.plan.asked || {}
        editRun?.({ ...run, plan: { ...run.plan, request: { ...run.plan.request, mode: 'continue' }, asked: { ...asked, mode: 'continue', media: [{ kind: 'video', file: part.path }] } } }, project)
        notify(`The part ${part.from === 0 ? 'before' : 'after'} the cut (${part.seconds} s, ${part.frames} frames) is the source. Write what happens next and hunt.`, 'info')
      } else {
        const e = await window.ivstudio.library.toEdit({ file: { path: part.path }, label: `${project.name} #${candidate} without the cut`, type: 'video' })
        openEdit?.(e.id)
      }
    } catch (err) {
      notify(err.message)
    } finally {
      setCleaning((c) => ({ ...c, [key]: false }))
    }
  }
  // Enhance (SeedVR2) on a finished video: a new job under it
  const [enhancing, setEnhancing] = useState({})
  async function enhance(f, opts) {
    setEnhancing((e) => ({ ...e, [f.id]: true }))
    try {
      onStart(await window.ivstudio.render.enhance({ jobId: f.id, ...opts }))
      notify(`Enhancing with ${opts.engine === 'dlss' ? `DLSS 5 at ${opts.scale}×` : `SeedVR2 at ${opts.resolution}p`}. It shows here when it's done.`, 'info')
    } catch (err) {
      notify(err.message)
    } finally {
      setEnhancing((e) => ({ ...e, [f.id]: false }))
    }
  }
  // a take reviewed against its prompt by the person's writer (review.js)
  const [reviewing, setReviewing] = useState({})
  async function review(job, candidate) {
    const key = `${job.id}:${candidate}`
    setReviewing((r) => ({ ...r, [key]: true }))
    try {
      const next = await window.ivstudio.review.take(job.id, candidate)
      setJobs((all) => ({ ...all, [next.id]: next }))
    } catch (err) {
      notify(err.message)
    } finally {
      setReviewing((r) => ({ ...r, [key]: false }))
    }
  }
  // the take being finished: { runId, candidate } while the Finish dialog is open
  const [finishing, setFinishing] = useState(null)
  const pick = (run, candidate) => {
    if (picked[run.id] !== candidate && run.ranking) window.ivstudio.rank.learn(run.id, candidate).catch(() => {})
    setPicked({ ...picked, [run.id]: candidate })
    setFinishing({ runId: run.id, candidate })
  }

  const load = useCallback(async () => {
    const { project, jobs } = await window.ivstudio.projects.get(projectId)
    setProject(project)
    setName(project.name)
    setJobIds(jobs.map((j) => j.id))
    setSeqRuns(project.sequenceId ? await window.ivstudio.sequences.runsOf(projectId).catch(() => null) : null)
    setJobs((all) => ({ ...all, ...Object.fromEntries(jobs.map((j) => [j.id, all[j.id] && !DONE.includes(j.status) ? all[j.id] : j])) }))
    const open = jobs.filter((j) => !DONE.includes(j.status)).map((j) => j.id)
    if (open.length) window.ivstudio.jobs.watch(open)
  }, [projectId, setJobs])

  useEffect(() => {
    load()
  }, [load])

  const jobs = useMemo(() => jobIds.map((id) => live[id]).filter(Boolean), [jobIds, live])
  // a finish with SeedVR2 as its enhancer starts its enhance step when it's done: that job joins the page
  useEffect(() => {
    const chained = jobs.map((j) => j.enhanceJob).filter((id) => id && !jobIds.includes(id))
    if (chained.length) load()
  }, [jobs, jobIds, load])
  const runs = jobs.filter((j) => j.kind === 'previews').reverse()
  const finishesOf = (id) => jobs.filter((j) => j.parent === id).reverse()

  const onStart = (job) => {
    setJobIds((ids) => [...ids, job.id])
    setJobs((all) => ({ ...all, [job.id]: job }))
  }

  // Every version of the shot (takes, finals, enhanced copies), for Compare's slot menus
  const versionOf = (run, key, url, label) => ({ key: `${run.id}:${key}`, url: media(url), label: runs.length > 1 ? `Run ${runs.length - runs.indexOf(run)} · ${label}` : label, prompt: run.plan.asked?.prompt ?? run.plan.request?.prompt })
  const versions = []
  for (const run of runs) {
    for (const o of run.outputs.filter((x) => x.kind === 'preview' && x.url)) versions.push(versionOf(run, o.candidate, o.url, `#${o.candidate}${o.seed != null && run.plan?.engine !== 'seedance' ? ` · seed ${o.seed}` : ''}`))
    for (const f of finishesOf(run.id)) {
      const fin = f.outputs.find((o) => o.kind === 'final')
      if (fin?.url) versions.push(versionOf(run, f.id, fin.url, shortLabel(f)))
      for (const e of jobs.filter((x) => x.kind === 'enhance' && x.parent === f.id)) {
        const out = e.outputs?.find((o) => o.kind === 'final')
        if (out?.url) versions.push(versionOf(run, e.id, out.url, shortLabel(f, e)))
      }
    }
  }

  if (!project) return null

  return (
    <div className="shot shot-v2">
      <Hero art="shots" help="shot" back={{ label: 'All shots', onClick: () => go('library') }} kicker={`Shot · ${runs.length} run${runs.length === 1 ? '' : 's'}`}>
        <input className="shot-name" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name !== project.name && window.ivstudio.projects.rename(projectId, name)} />
      </Hero>
      <div className="shot-actions">
        {seqRuns ? (
          <button className="btn btn-primary" onClick={() => openSequence?.(seqRuns.sequenceId)}>
            Open {seqRuns.sequenceName}
          </button>
        ) : runs[0] && editRun ? (
          <button className="btn btn-primary" onClick={() => editRun(runs[0], project)}>
            ↻ Edit the latest and run again
          </button>
        ) : (
          <button className="btn btn-small" onClick={() => go('create')}>
            New run
          </button>
        )}
        {marked.length === 1 && <span className="mono dim small">1 marked: mark another take, final or enhanced copy to compare</span>}
        {marked.length >= 2 && (
          <span className="compare-bar">
            <button className="btn btn-small btn-primary" onClick={() => setComparing(true)}>
              Compare {marked.length}
            </button>
            <button className="link-btn mono small" onClick={() => setMarked([])}>
              Clear
            </button>
          </span>
        )}
      </div>
      {seqRuns && (
        <p className="notice seq-runs-note">
          These are the shot-by-shot renders of the sequence {seqRuns.sequenceName}. Edit, pick and finish them in the sequence, so every new render stays part of it.
        </p>
      )}
      {finishing && (() => {
        const run = runs.find((r) => r.id === finishing.runId)
        if (!run) return null
        const started = (job) => (onStart(job), setFinishing(null))
        return (
          <FinishDialog onClose={() => setFinishing(null)}>
            {run.plan?.engine === 'seedance' ? <SeedanceFinishPanel job={run} candidate={finishing.candidate} onStart={started} notify={notify} caps={caps} remote={remote} ownCloud={ownCloud} characters={characters} /> : <FinishPanel job={run} candidate={finishing.candidate} onStart={started} notify={notify} caps={caps} remote={remote} ownCloud={ownCloud} />}
          </FinishDialog>
        )
      })()}
      {comparing && marked.length >= 2 && (
        <CompareViewer
          items={marked}
          pool={versions}
          onClose={() => {
            setComparing(false)
            setMarked([])
          }}
        />
      )}

      {runs.length === 0 && <p className="dim">No runs yet.</p>}
      {runs.map((run, i) => {
        const previews = run.outputs.filter((o) => o.kind === 'preview')
        const req = run.plan.request || {}
        const written = run.plan.asked?.prompt ?? req.prompt
        const before = runs[i + 1]
        const changes = runChanges(req, before?.plan.request)
        const ch = characters.find((c) => c.id === req.character)
        const findings = !req.prompt ? [] : run.plan?.engine === 'seedance' ? lintSeedance(req.prompt, { mode: req.mode, seconds: req.seconds, refs: run.plan.refs || {} }) : lintPrompt(req.prompt, { mode: req.mode, seconds: req.seconds, media: req.media || [], character: ch ? { name: ch.name, trigger: ch.trigger } : null, voiceLine: req.voiceLine })
        const notes = findings.filter((f) => f.level !== 'info').length
        return (
          <section key={run.id} className="run run-card">
            <div className="run-head">
              <span className="run-badge">
                <span className="mono">Run</span>
                <span className="run-n">{String(runs.length - i).padStart(2, '0')}</span>
              </span>
              <span className="run-chips mono">
                {[run.plan?.engine === 'seedance' && `Seedance 2.5 ${run.plan.resolved?.draft ? 'Draft' : run.plan.resolved?.tier}`, MODE_NAME[req.mode] || req.mode, `${run.plan.resolved?.width}×${run.plan.resolved?.height}`, `${run.plan.resolved?.seconds} s`, run.plan?.engine !== 'seedance' && `seed ${req.seed}`, ch?.name, run.seconds && `${run.seconds} s render`]
                  .filter(Boolean)
                  .map((c) => (
                    <span key={c}>{c}</span>
                  ))}
              </span>
              {seqRuns?.runs[run.id]?.linked && <span className="mono small pink">Shot {seqRuns.runs[run.id].index + 1}</span>}
              {seqRuns?.runs[run.id] && !seqRuns.runs[run.id].linked && (
                <span className="mono small dim" title={seqRuns.runs[run.id].problem || ''}>
                  Not in the sequence{seqRuns.runs[run.id].problem ? `: ${seqRuns.runs[run.id].problem}` : ''}
                </span>
              )}
              {seqRuns?.runs[run.id] && !seqRuns.runs[run.id].linked && !seqRuns.runs[run.id].problem && (
                <button className="btn btn-small" disabled={linking === run.id} onClick={() => linkRun(run, seqRuns.runs[run.id].index)}>
                  {linking === run.id ? 'Linking…' : `Use as shot ${seqRuns.runs[run.id].index + 1}`}
                </button>
              )}
              {/* the latest run is edited from the button at the top of the page; older runs have their own */}
              {editRun && (seqRuns || i > 0) && (
                <button className="btn btn-small run-edit" onClick={() => editRun(run, project)}>
                  {seqRuns ? 'Edit in the sequence' : 'Edit and run again'}
                </button>
              )}
              {changes.length > 0 && <span className="run-changes mono small">Changed: {changes.join(' · ')}</span>}
              {agent && (
                <button className="btn btn-small run-ask" onClick={() => askAgent({ about: `run ${runs.length - i} of this shot (previews job ${run.id})` })} title={runAskWords(agent).chat.title}>
                  {runAskWords(agent).chat.label}
                </button>
              )}
            </div>
            <Progress job={run} />
            {run.status === 'error' && <Failure job={run} notify={notify} />}
            {req.prompt && (
              <details className="run-prompt">
                <summary className="mono dim">
                  Prompt{notes ? ` · ${notes} checker note${notes > 1 ? 's' : ''}` : ''}
                </summary>
                <pre>{written}</pre>
                {written !== req.prompt && (
                  <details className="run-resolved">
                    <summary className="mono dim small">As rendered (with the @ mentions resolved)</summary>
                    <pre>{req.prompt}</pre>
                  </details>
                )}
                {before?.plan.request?.prompt && before.plan.request.prompt !== req.prompt && (
                  <details className="run-resolved">
                    <summary className="mono dim small">What changed since run {runs.length - i - 1}</summary>
                    <PromptDiff before={before.plan.asked?.prompt ?? before.plan.request.prompt} after={written} />
                  </details>
                )}
                <Findings findings={findings} compact />
                <button className="link-btn small" onClick={() => navigator.clipboard.writeText(written).then(() => notify('Prompt copied.', 'info'), () => notify('Could not copy the prompt.'))}>
                  Copy the prompt
                </button>
              </details>
            )}
            {previews.length > 1 && (!run.ranking || (agent && run.status === 'success')) && (
              <div className="run-pick">
                {!run.ranking && (
                  <button className="link-btn mono small rank-btn" disabled={!!ranking[run.id]} onClick={() => rank(run)}>
                    {ranking[run.id] ? 'Ranking the takes… (a minute when there are lines to hear)' : '★ Rank these takes'}
                  </button>
                )}
                {agent && run.status === 'success' && (
                  <button
                    className="btn btn-small run-pick-ask"
                    onClick={() =>
                      askAgent({
                        send: true,
                        about: `run ${runs.length - i} of this shot (previews job ${run.id}, ${previews.length} takes)`,
                        text: 'Which of these takes would you finish, and why? Use rank_takes, then review_take on the two best, and answer in a few short sentences. Don’t finish or render anything until I say so.'
                      })
                    }
                    title={runAskWords(agent).pick.title}
                  >
                    {runAskWords(agent).pick.label}
                  </button>
                )}
              </div>
            )}
            {previews.length > 0 && (
              <div className={`candidates n${previews.length}`}>
                {previews.map((o) => {
                  const r = run.ranking?.takes?.find((t) => t.candidate === o.candidate)
                  return (
                  <figure key={o.candidate} className={`candidate ${picked[run.id] === o.candidate ? 'on' : ''} ${r?.best ? 'best' : ''}`}>
                    {r && (
                      <div className="take-rank" title={Object.entries(r.parts).filter(([, v]) => v != null).map(([k, v]) => `${k} ${Math.round(v * 100)}%`).join(' · ')}>
                        <span className="mono small">{r.best ? '★ Best take' : `Score ${Math.round((r.score ?? 0) * 100)}`}</span>
                        {r.reasons?.length > 0 && <span className="small dim">{r.reasons.join(' · ')}</span>}
                        {r.raw?.cuts?.length > 0 && r.raw.clean && (
                          <span className="take-clean" title="IV Studio looks for hard cuts in a take whose prompt asks for one shot. It doesn't catch slow dissolves.">
                            <button className="link-btn mono small" disabled={!!cleaning[`${run.id}:${o.candidate}`]} onClick={() => useClean(run, o.candidate, false)}>
                              {cleaning[`${run.id}:${o.candidate}`] ? 'Cutting…' : `Use ${r.raw.clean.from.toFixed(1)} to ${r.raw.clean.to.toFixed(1)} s (${r.raw.clean.start === 0 ? 'before' : 'after'} the cut)`}
                            </button>
                            {r.raw.cleanH3 && !remote && (
                              <button className="link-btn mono small" disabled={!!cleaning[`${run.id}:${o.candidate}`]} onClick={() => useClean(run, o.candidate, true)}>
                                Carry on from it
                              </button>
                            )}
                          </span>
                        )}
                      </div>
                    )}
                    <video src={media(o.url)} data-take={`${run.id}:${o.candidate}`} controls loop preload="metadata" />
                    <figcaption>
                      <span className="take-id">
                        <span className="take-n">Take {o.candidate}</span>
                        <span className="mono small dim">seed {o.seed}</span>
                      </span>
                      {!remote && (
                        <button className="link-btn mono small" disabled={!!reviewing[`${run.id}:${o.candidate}`]} onClick={() => review(run, o.candidate)}>
                          {reviewing[`${run.id}:${o.candidate}`] ? 'Reviewing…' : 'Review'}
                        </button>
                      )}
                      <button className={`link-btn mono small ${isMarked(`${run.id}:${o.candidate}`) ? 'pink' : ''}`} onClick={() => mark(versionOf(run, o.candidate, o.url, `#${o.candidate}${o.seed != null && run.plan?.engine !== 'seedance' ? ` · seed ${o.seed}` : ''}`))}>
                        {isMarked(`${run.id}:${o.candidate}`) ? 'Marked' : 'Mark'}
                      </button>
                      <button className={`btn btn-small take-pick ${picked[run.id] === o.candidate ? 'btn-primary' : ''}`} onClick={() => pick(run, o.candidate)}>
                        {picked[run.id] === o.candidate ? 'Finish ✓' : 'Pick'}
                      </button>
                    </figcaption>
                  </figure>
                  )
                })}
              </div>
            )}
            {previews
              .filter((o) => run.reviews?.[o.candidate])
              .map((o) => (
                <ReviewCard key={`rv${o.candidate}`} review={run.reviews[o.candidate]} title={`Review of #${o.candidate}`} videoKey={`${run.id}:${o.candidate}`} before={written} onRun={(p) => editRun?.(run, project, p)} />
              ))}
            {finishesOf(run.id).length > 0 && (
              <VersionsCard
                key={`v${run.id}`}
                run={run}
                finishes={finishesOf(run.id).slice().reverse()}
                jobs={jobs}
                remote={remote}
                ownCloud={ownCloud}
                caps={caps}
                notify={notify}
                marks={isMarked}
                onMark={mark}
                onCompare={compareNow}
                review={review}
                reviewing={reviewing}
                enhance={enhance}
                enhancing={enhancing}
                written={written}
                editRun={editRun}
                project={project}
                versionOf={versionOf}
                shotFromVersion={shotFromVersion}
                pictureToEdit={pictureToEdit}
              />
            )}
          </section>
        )
      })}
    </div>
  )
}
