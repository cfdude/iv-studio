import { useCallback, useEffect, useMemo, useState } from 'react'
import { media } from '../media'
import Hero from './Hero'
import Findings from './Findings'
import { LiveFrame } from './Live'
import { CompareViewer, PromptDiff, runChanges } from './Compare'
import { lintPrompt } from '../../../service/lint'
import { enhancerChoices, finishDefaults, fpsFor, pickEnhancer } from '../finish'

const DONE = ['success', 'error', 'cancelled']
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
const ENGINE = { claude: 'Claude Code', codex: 'Codex', local: 'the local writer' }
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
  upscale: 'Upscales 2× and adds frames (Real-ESRGAN and RIFE). Works on any computer.',
  seedvr2: 'Restores detail after the finish. Slower; 24 fps.'
}

function FinishPanel({ job, candidate, onStart, notify, caps, remote }) {
  const choices = enhancerChoices(caps, remote)
  const [opts, setOpts] = useState({ megapixels: 2, upscale2x: false, fps: 0, audio: 'pass', enhancer: pickEnhancer('dlss', choices), enhanceResolution: 1080 })
  // the defaults Check my PC chose for this computer, once this ComfyUI has been read (what it can do decides what they become)
  const capsRead = !!caps
  useEffect(() => {
    window.ivstudio.settings.get().then((s) => {
      if (s.shotPrefs) setOpts((o) => ({ ...o, ...finishDefaults(s.shotPrefs, caps, remote) }))
    }, () => {})
  }, [capsRead])
  const enhancer = pickEnhancer(opts.enhancer, choices)
  const seedvr2 = enhancer === 'seedvr2'
  const upscale = enhancer === 'upscale'
  const FPS = fpsFor(caps, enhancer)
  const [size, setSize] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (patch) => setOpts((o) => ({ ...o, ...patch }))
  const single = job.plan.request?.mode === 'continue'
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
        </div>
      )}
      {choices.length > 1 && (
        <div className="row">
          <span className="row-label">Enhancer</span>
          <div className="enhancer-pick">
            <div className="segmented">
              {choices.map((c) => (
                <button key={c} className={enhancer === c ? 'on' : ''} onClick={() => set({ enhancer: c, ...(c === 'seedvr2' ? { upscale2x: false, fps: 0 } : {}), ...(!fpsFor(caps, c).includes(opts.fps) ? { fps: 0 } : {}) })}>
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
          <div className="row">
            <span className="row-label">Frame rate</span>
            <div className="segmented">
              {FPS.map((f) => (
                <button key={f} className={opts.fps === f ? 'on' : ''} onClick={() => set({ fps: f })}>
                  {f ? f : '24'}
                </button>
              ))}
            </div>
            {upscale && !caps?.rife && <span className="dim small">Frame rates above 24 need the Frame Interpolation (RIFE) pack: install it in Setup.</span>}
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
      <div className="finish-go">
        <span className="mono">{size ? `${size.width} × ${size.height} · ${size.fps} fps${single ? ' · single pass' : ''}` : '…'}</span>
        <button className="btn btn-primary" disabled={busy} onClick={go}>
          {busy ? 'Starting…' : 'Finish'}
        </button>
      </div>
    </div>
  )
}

export default function Shot({ projectId, jobs: live, setJobs, notify, go, caps, remote, editRun, openSequence, characters = [] }) {
  const [project, setProject] = useState(null)
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
  // takes marked for Compare (up to two): { key, url, label, prompt }; the viewer opens when there are two
  const [marked, setMarked] = useState([])
  const [comparing, setComparing] = useState(false)
  const mark = (take) => {
    const next = marked.some((m) => m.key === take.key) ? marked.filter((m) => m.key !== take.key) : [...marked, take].slice(-2)
    setMarked(next)
    if (next.length === 2) setComparing(true)
  }
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
  const pick = (run, candidate) => {
    setPicked({ ...picked, [run.id]: candidate })
    if (run.ranking) window.ivstudio.rank.learn(run.id, candidate).catch(() => {})
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
        {marked.length === 1 && <span className="mono dim small">1 take marked: mark another to compare them</span>}
      </div>
      {seqRuns && (
        <p className="notice seq-runs-note">
          These are the shot-by-shot renders of the sequence {seqRuns.sequenceName}. Edit, pick and finish them in the sequence, so every new render stays part of it.
        </p>
      )}
      {comparing && marked.length === 2 && (
        <CompareViewer
          a={marked[0]}
          b={marked[1]}
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
        const findings = req.prompt ? lintPrompt(req.prompt, { mode: req.mode, seconds: req.seconds, media: req.media || [], character: ch ? { name: ch.name, trigger: ch.trigger } : null, voiceLine: req.voiceLine }) : []
        const notes = findings.filter((f) => f.level !== 'info').length
        const takeOf = (key, url, label) => ({ key: `${run.id}:${key}`, url: media(url), label: `Run ${runs.length - i} · ${label}`, prompt: written })
        return (
          <section key={run.id} className="run run-card">
            <div className="run-head">
              <span className="run-badge">
                <span className="mono">Run</span>
                <span className="run-n">{String(runs.length - i).padStart(2, '0')}</span>
              </span>
              <span className="run-chips mono">
                {[MODE_NAME[req.mode] || req.mode, `${run.plan.resolved?.width}×${run.plan.resolved?.height}`, `${run.plan.resolved?.seconds} s`, `seed ${req.seed}`, ch?.name, run.seconds && `${run.seconds} s render`]
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
              {editRun && (
                <button className="btn btn-small run-edit" onClick={() => editRun(run, project)}>
                  {seqRuns ? 'Edit in the sequence' : 'Edit and run again'}
                </button>
              )}
              {changes.length > 0 && <span className="run-changes mono small">Changed: {changes.join(' · ')}</span>}
            </div>
            <Progress job={run} />
            {run.status === 'error' && <p className="notice">{run.error}</p>}
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
            {previews.length > 1 && !run.ranking && (
              <button className="link-btn mono small rank-btn" disabled={!!ranking[run.id]} onClick={() => rank(run)}>
                {ranking[run.id] ? 'Ranking the takes… (a minute when there are lines to hear)' : '★ Rank these takes'}
              </button>
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
                      <button className={`link-btn mono small ${isMarked(`${run.id}:${o.candidate}`) ? 'pink' : ''}`} onClick={() => mark(takeOf(o.candidate, o.url, `#${o.candidate} · seed ${o.seed}`))}>
                        {isMarked(`${run.id}:${o.candidate}`) ? 'Marked' : 'Compare'}
                      </button>
                      <button className={`btn btn-small take-pick ${picked[run.id] === o.candidate ? 'btn-primary' : ''}`} onClick={() => pick(run, o.candidate)}>
                        {picked[run.id] === o.candidate ? '✓ Picked' : 'Pick'}
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
            {picked[run.id] && <FinishPanel job={run} candidate={picked[run.id]} onStart={onStart} notify={notify} caps={caps} remote={remote} />}
            {finishesOf(run.id).map((f) => {
              const final = f.outputs.find((o) => o.kind === 'final')
              return (
                <div key={f.id} className="final final-card">
                  <div className="final-head">
                    <span className="final-badge mono">★ Final · take {f.plan.finish?.candidate}</span>
                    <span className="run-chips mono">
                      {[f.plan.resolved?.finishWidth && `${f.plan.resolved.finishWidth}×${f.plan.resolved.finishHeight}, SeedVR2 to`, `${f.plan.resolved?.width}×${f.plan.resolved?.height}`, `${f.plan.resolved?.fps} fps`, f.seconds && `${f.seconds} s render`]
                        .filter(Boolean)
                        .map((c) => (
                          <span key={c}>{c}</span>
                        ))}
                    </span>
                    <span className="final-actions">
                    {final?.path && (
                      <button className="link-btn mono" onClick={() => window.ivstudio.files.reveal(final).catch((err) => notify(err.message))}>
                        {remote ? 'Download' : 'Show in folder'}
                      </button>
                    )}
                    {final?.url && (
                      <button className={`link-btn mono ${isMarked(`${run.id}:${f.id}`) ? 'pink' : ''}`} onClick={() => mark(takeOf(f.id, final.url, `final of #${f.plan.finish?.candidate}`))}>
                        {isMarked(`${run.id}:${f.id}`) ? 'Marked' : 'Compare'}
                      </button>
                    )}
                    {final?.path && !remote && (
                      <button className="link-btn mono" disabled={!!reviewing[`${f.id}:0`]} onClick={() => review(f, 0)}>
                        {reviewing[`${f.id}:0`] ? 'Reviewing…' : 'Review'}
                      </button>
                    )}
                    </span>
                  </div>
                  <Progress job={f} />
                  {f.status === 'error' && <p className="notice">{f.error}</p>}
                  {final && <video className="final-video" data-take={`${f.id}:final`} src={media(final.url)} controls preload="metadata" />}
                  {f.reviews?.final && <ReviewCard review={f.reviews.final} title="Review of the final" videoKey={`${f.id}:final`} before={written} onRun={(p) => editRun?.(run, project, p)} />}
                  {final?.path && !remote && (caps?.dlss !== false || enhancerChoices(caps, remote).includes('seedvr2')) && (
                    <div className="enhance-row">
                      <span className="enhance-label mono">Enhance</span>
                      <span className="dim small enhance-sub">a sharper copy beside this one</span>
                      {caps?.dlss !== false &&
                        [1, 2].map((scale) => (
                          <button key={`d${scale}`} className="btn btn-small" disabled={!!enhancing[f.id]} onClick={() => enhance(f, { engine: 'dlss', scale })}>
                            DLSS 5 · {scale}×
                          </button>
                        ))}
                      {enhancerChoices(caps, remote).includes('seedvr2') && [1080, 1440].map((r) => (
                        <button key={`s${r}`} className="btn btn-small" disabled={!!enhancing[f.id]} onClick={() => enhance(f, { engine: 'seedvr2', resolution: r })}>
                          SeedVR2 · {r}p
                        </button>
                      ))}
                    </div>
                  )}
                  {jobs
                    .filter((e) => e.kind === 'enhance' && e.parent === f.id)
                    .map((e) => {
                      const out = e.outputs?.find((o) => o.kind === 'final')
                      return (
                        <div key={e.id} className="final enhanced">
                          <div className="final-head">
                            <span className="final-badge mono enhanced-badge">Enhanced · {e.plan?.enhance?.engine === 'dlss' ? `DLSS 5 ${e.plan.enhance.scale}×` : `SeedVR2 ${e.plan?.enhance?.resolution}p`}</span>
                            <span className="mono dim">{e.seconds ? `${e.seconds} s render` : ''}</span>
                            {out?.path && (
                              <button className="link-btn mono" onClick={() => window.ivstudio.files.reveal(out).catch((err) => notify(err.message))}>
                                Show in folder
                              </button>
                            )}
                            {out?.url && final?.url && (
                              <button className="link-btn mono" onClick={() => (setMarked([takeOf(f.id, final.url, `final of #${f.plan.finish?.candidate}`), takeOf(e.id, out.url, e.plan?.enhance?.engine === 'dlss' ? `DLSS 5 ${e.plan.enhance.scale}×` : `SeedVR2 ${e.plan?.enhance?.resolution}p`)]), setComparing(true))}>
                                Compare with the final
                              </button>
                            )}
                          </div>
                          <Progress job={e} />
                          {e.status === 'error' && <p className="notice">{e.error}</p>}
                          {out && <video className="final-video" src={media(out.url)} controls preload="metadata" />}
                        </div>
                      )
                    })}
                </div>
              )
            })}
          </section>
        )
      })}
    </div>
  )
}
