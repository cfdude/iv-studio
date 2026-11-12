import { useEffect, useState } from 'react'
import { fileUrl } from './edit/model'
import { Step } from './FlowKit'

// Replace's Remake engine (remake.js): swap people or change the scene. IV Studio paints a frame of each shot, the
// person approves them, the writer writes the prompt, and Remake renders with the source's motion and soundtrack.
export default function RemakeFlow({ kind, video, notify, onStarted }) {
  const X = window.ivstudio.remake
  const [check, setCheck] = useState(null)
  const [faces, setFaces] = useState([])
  const [people, setPeople] = useState([]) // [{picture, name, characterId, lora, who}], up to two
  const face = people[0]
  const [ask, setAsk] = useState('')
  const [session, setSession] = useState(null)
  const [busy, setBusy] = useState(null)
  const [progress, setProgress] = useState({})
  const [takes, setTakes] = useState(1)
  const [useLora, setUseLora] = useState(false)
  const [prompt, setPrompt] = useState('')

  useEffect(() => {
    X.faces().then(setFaces)
    return X.onProgress((u) => setProgress((p) => ({ ...p, [u.frame]: u.step })))
  }, [])
  useEffect(() => {
    setCheck(null)
    X.check(kind).then(setCheck, (err) => setCheck({ ready: false, error: err.message, packs: [], models: [] }))
    setSession(null)
  }, [kind])
  useEffect(() => setSession(null), [video?.path, video?.section?.start, video?.section?.length])
  useEffect(() => setPrompt(session?.prompt || ''), [session?.prompt])

  const section = video?.section || { start: 0, length: 0 }
  const ready = !!video && check?.ready && (kind === 'swap' ? people.length > 0 : ask.trim().length > 2)
  const addPerson = (p) => setPeople((list) => (list.some((x) => x.picture === p.picture) ? list : [...list, { ...p, who: '' }].slice(-2)))
  const painted = session?.keyframes?.filter((k) => k.painted && !k.skip) || []

  async function step(label, fn) {
    setBusy(label)
    try {
      return await fn()
    } catch (err) {
      notify(err.message)
    } finally {
      setBusy(null)
    }
  }
  // soft mouth (softmouth.js): the source's mouths blurred first, so the new person doesn't mouth its words
  const [soft, setSoft] = useState(false)
  useEffect(() => setSoft(false), [video?.path])
  const paintInput = () => (kind === 'swap' ? { people: people.map(({ picture, name, who }) => ({ picture, name, who })) } : { ask })
  const paint = () =>
    step('Painting the frames', async () => {
      setProgress({})
      const src = kind === 'swap' && soft ? (await window.ivstudio.softMouth.make(video.path)).path : video.path
      // the session was prepared from the softened source or not; a change of mind starts it again (setSoft clears it)
      const s = session && session.kind === kind ? session : await X.prepare({ video: src, section, kind })
      setSession(s)
      setSession(await X.paint(s.id, paintInput()))
    })
  const repaint = (frame) => step('Painting again', async () => setSession(await X.paint(session.id, { ...paintInput(), only: [frame] })))
  const own = (frame) =>
    step('Using your picture', async () => {
      const [file] = await window.ivstudio.files.pick('picture')
      if (file) setSession(await X.usePicture(session.id, frame, file))
    })
  const skip = (frame, on) => step('Saving', async () => setSession(await X.setKeyframe(session.id, frame, { skip: on })))
  const write = () => step('Writing the prompt', async () => setSession(await X.write(session.id)))
  const render = () =>
    step('Starting', async () => {
      if (prompt && prompt !== session.prompt) await X.setPrompt(session.id, prompt)
      const r = await X.render(session.id, { takes, characterId: kind === 'swap' && useLora && people.length === 1 ? face?.characterId : null })
      setSession(r.session)
      notify(`Started ${r.jobs.length === 1 ? 'the remake' : `${r.jobs.length} takes`}: it shows under Runs when it’s done (a few minutes each).`, 'info')
      onStarted?.()
    })

  return (
    <>
      {check && !check.ready && (
        <section className="group replace-missing">
          <div className="group-head">
            <h2>{check.cloud ? 'Not in the cloud yet' : 'Needed first'}</h2>
          </div>
          <div className="group-body">
            {check.error && <p className="small pink">{check.error}</p>}
            {check.packs.map((p) => (
              <p key={p.name} className="small">
                {p.name} <span className="dim mono">({p.missing.join(', ')})</span>
              </p>
            ))}
            {check.models.map((m) => (
              <p key={m.name} className="small">
                {m.name}: download it in Settings → Setup.
              </p>
            ))}
          </div>
        </section>
      )}

      {kind === 'swap' ? (
        <Step n={2} title="Who goes in" sub="One or two people: your characters, or a picture of who should appear.">
          <label className="soft-mouth small" title="Blurs the mouths in the source before Remake sees it, so the new person doesn’t mouth the source’s words. For a silent swap, or one you’ll give new words later. Needs the face models (Characters).">
            <input type="checkbox" checked={soft} onChange={(e) => (setSoft(e.target.checked), setSession(null))} />
            Soft mouth: the new person doesn’t mouth the source’s words
          </label>
          <div className="media-actions">
            <button className="btn btn-small" disabled={people.length >= 2} onClick={async () => { const [file] = await window.ivstudio.files.pick('picture'); if (file) addPerson({ picture: file, name: '' }) }}>
              + Picture
            </button>
            {faces.map((f) => (
              <button key={f.id} className="btn btn-small" disabled={people.length >= 2 || people.some((x) => x.picture === f.picture)} onClick={() => addPerson(f)}>
                {f.name}
              </button>
            ))}
          </div>
          {people.length > 0 && (
            <div className="media-tiles">
              {people.map((p, i) => (
                <div key={p.picture} className="media-tile">
                  <div className="media-thumb">
                    <img src={fileUrl(p.picture)} alt="" />
                  </div>
                  <input className="small" value={p.name || ''} placeholder="their name (optional)" onChange={(e) => setPeople(people.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                  <input className="small" value={p.who} placeholder={people.length > 1 ? 'replaces: the woman on the left' : 'replaces: the main person'} onChange={(e) => setPeople(people.map((x, j) => (j === i ? { ...x, who: e.target.value } : x)))} />
                  <button className="media-remove" onClick={() => setPeople(people.filter((_, j) => j !== i))}>
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          {people.length === 1 && face?.lora && (
            <label className="me-snap small">
              <input type="checkbox" checked={useLora} onChange={(e) => setUseLora(e.target.checked)} /> Also use {face.name}'s LoRA
            </label>
          )}
        </Step>
      ) : (
        <Step n={2} title="What changes" sub="Say it in plain words. The people stay as they are; for new people use Swap people.">
          <textarea className="remake-ask" rows={2} value={ask} placeholder={'a snowy winter evening · remove the wind turbines · it’s a rainy neon city at night · the car is a bright red 1960s convertible'} onChange={(e) => setAsk(e.target.value)} />
        </Step>
      )}

      <Step n={3} title="The painted frames" sub="IV Studio paints a frame of each shot the way the result should look. They decide how it turns out, so check them: paint one again, use your own picture, or leave one out.">
        <button className="btn" disabled={!ready || !!busy} onClick={paint}>
          {busy === 'Painting the frames' ? `Painting… ${Object.values(progress).filter((x) => x === 'painted').length}/${session?.keyframes?.length || '?'}` : session?.keyframes?.some((k) => k.painted) ? 'Paint them all again' : 'Paint the frames'}
        </button>
        {session?.keyframes?.length > 0 && (
          <div className="remake-frames">
            {session.keyframes.map((k) => (
              <div key={k.frame} className={`remake-frame ${k.skip ? 'skipped' : ''}`}>
                <div className="remake-pair">
                  <img src={fileUrl(k.file)} alt="" title="the source" />
                  {k.painted ? <img src={`${fileUrl(k.painted)}?v=${encodeURIComponent(k.painted)}`} alt="" title="painted" /> : <div className="remake-wait mono small dim">{progress[k.frame] === 'painting' ? 'painting…' : progress[k.frame] === 'painting again' ? 'painting again…' : 'not painted'}</div>}
                </div>
                {k.check && (
                  <p className={`small ${k.check.added || (k.check.score != null && k.check.score < 0.3) ? 'pink' : 'dim'}`}>
                    {k.check.added ? 'Someone was added: paint it again or use your own picture.' : k.check.score == null ? '' : k.check.score >= 0.45 ? `Looks like ${people[0]?.name || 'them'} (${k.check.score.toFixed(2)}).` : k.check.score >= 0.3 ? `Some likeness (${k.check.score.toFixed(2)}).` : `Doesn’t look much like ${people[0]?.name || 'them'} (${k.check.score.toFixed(2)}).`}
                  </p>
                )}
                <div className="row-actions">
                  <span className="mono small dim">{k.time}</span>
                  <button className="link-btn mono" disabled={!!busy || !ready} onClick={() => repaint(k.frame)}>
                    Paint again
                  </button>
                  <button className="link-btn mono" disabled={!!busy} onClick={() => own(k.frame)}>
                    My picture
                  </button>
                  <button className="link-btn mono" disabled={!!busy || (!k.skip && painted.length < 2)} onClick={() => skip(k.frame, !k.skip)}>
                    {k.skip ? 'Use it' : 'Leave out'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Step>

      {painted.length > 0 && (
        <Step n={4} title="Remake it" sub="Each take takes a few minutes; they show under Runs when done.">
          <div className="row">
            <span className="row-label">Takes</span>
            <div className="segmented">
              {[1, 2, 3].map((n) => (
                <button key={n} className={takes === n ? 'on' : ''} onClick={() => setTakes(n)}>
                  {n}
                </button>
              ))}
            </div>
            <span className="small dim">each takes a few minutes</span>
          </div>
          <details className="replace-settings">
            <summary className="mono label">The prompt {session.prompt ? `(by ${session.writer === 'local' ? 'the local writer' : session.writer === 'claude' ? 'Claude Code' : session.writer === 'codex' ? 'Codex' : session.writer === 'hermes' ? 'Hermes' : session.writer})` : '(written when you start)'}</summary>
            {session.prompt ? (
              <>
                <textarea className="remake-prompt mono small" rows={14} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
                {session.promptProblems?.length > 0 && <p className="small pink">Check: {session.promptProblems.join('; ')}</p>}
              </>
            ) : null}
            <button className="btn btn-small" disabled={!!busy} onClick={write}>
              {busy === 'Writing the prompt' ? 'Writing…' : session.prompt ? 'Write it again' : 'Write it now'}
            </button>
          </details>
          <div className="replace-go">
            <button className="btn btn-primary" disabled={!!busy || !check?.ready} onClick={render}>
              {busy === 'Starting' ? (session.prompt ? 'Starting…' : 'Writing the prompt…') : kind === 'swap' ? 'Swap them' : 'Change it'}
            </button>
          </div>
        </Step>
      )}
      {busy && busy !== 'Painting the frames' && busy !== 'Starting' && <p className="small dim">{busy}…</p>}
    </>
  )
}
