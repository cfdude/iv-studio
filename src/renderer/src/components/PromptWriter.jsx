import { useEffect, useState } from 'react'
import { ask } from './Confirm'
import StageBoard from './StageBoard'
import { cameraWords, defaultStage, previsWords, stagingWords } from '../../../service/staging'

const HARNESS_NAME = { claude: 'Claude Code', codex: 'Codex' }

// "Write it for me": a plain-words idea in, a finished H3 prompt out. context carries what the writer
// should respect (mode, seconds, aspect, character, media, sequence, previous shot). names: who can go on the
// staging board; its exact screen-side words go to the writer with the idea. onPrevis(clip): the board's grey
// previs clip, for the form to add as a video reference (then the words name it as <Video n>).
export default function PromptWriter({ context, current, onWritten, notify, go, compact = false, names = null, onPrevis = null }) {
  const [idea, setIdea] = useState('')
  const [board, setBoard] = useState(false)
  const [stage, setStage] = useState(null)
  const [previs, setPrevis] = useState(null)
  const [drawing, setDrawing] = useState(false)
  // the clip still in the references, as which video
  const previsN = previs ? (context.media || []).filter((m) => m.kind === 'video').findIndex((m) => m.file === previs.file) + 1 : 0
  async function makePrevis() {
    setDrawing(true)
    try {
      const clip = await window.ivstudio.previs.make({ stage, seconds: context.seconds, aspect: context.aspect, name: idea.slice(0, 30) || 'previs' })
      setPrevis({ ...clip, stage })
      onPrevis(clip)
    } catch (err) {
      notify(err.message)
    } finally {
      setDrawing(false)
    }
  }
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState(null)
  const [undo, setUndo] = useState(null)

  useEffect(() => {
    window.ivstudio.prompts.status().then(setStatus).catch(() => setStatus(null))
  }, [])

  const engine = status?.engine || 'local'
  const harness = engine === 'claude' || engine === 'codex'
  const blocker =
    status &&
    (engine === 'contextir'
      ? !status.hasComfyKey && 'MiniMax Context IR needs your Comfy.org API key.'
      : harness
        ? !status.harnesses?.[engine]?.installed && `${HARNESS_NAME[engine]} isn't installed on this computer.`
        : !status.installed
        ? 'The free writer needs Ollama.'
        : status.running && !status.models.some((m) => m.name === status.model) && `The writer model ${status.model} isn't installed yet.`)

  // What the local writer will look at: pictures, frames from videos, or the clip a Continue shot carries on.
  const visual = (context.media || []).filter((m) => m.kind === 'picture' || m.kind === 'video')
  const sees = status?.models?.find((m) => m.name === status.model)?.vision
  const seeing =
    harness && visual.length > 0
      ? `${HARNESS_NAME[engine]} looks at your ${visual.length === 1 ? (visual[0].kind === 'video' ? 'video' : 'picture') : `${visual.length} references`} and writes what it sees.`
      : engine === 'local' && visual.length > 0 && status?.running
      ? sees
        ? `Looks at your ${visual.length === 1 ? (visual[0].kind === 'video' ? 'video' : 'picture') : `${visual.length} references`} and writes what it sees.`
        : `${status.model} can't see pictures; choose a model marked "sees pictures" in Settings to have it look at your references.`
      : null

  async function write() {
    setBusy(true)
    try {
      const staged =
        (board && stage?.people?.length ? `${idea.trim()}\nStaging (follow it exactly): ${stagingWords(stage)}\nCamera: ${cameraWords(stage)}.` : idea) +
        (previsN ? `\n${previsWords(previs.stage, previsN)} Say so in the prompt, with these words.` : '')
      const text = await window.ivstudio.prompts.write({ ...context, idea: staged })
      setUndo(current || '')
      onWritten(text)
    } catch (err) {
      notify(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`writer ${compact ? 'compact' : ''}`}>
      <div className="writer-head">
        <span className="mono label writer-label">✦ Write it for me</span>
        <span className="mono dim small">{engine === 'contextir' ? `MiniMax Context IR · ${status?.contextIrPrice?.split(' (')[0] || 'paid'}` : harness ? `${HARNESS_NAME[engine]} · your plan` : `Local writer · free`}</span>
      </div>
      <div className="writer-row">
        <textarea rows={compact ? 2 : 2} value={idea} placeholder={context.sequence ? 'What happens in this shot, in plain words' : 'Your idea in plain words, e.g. Tess in a parked car at night admits she kept the letter'} onChange={(e) => setIdea(e.target.value)} />
        <button className="btn btn-primary" disabled={busy || !idea.trim() || !!blocker} onClick={write}>
          {busy ? 'Writing…' : current?.trim() ? 'Rewrite prompt' : 'Write my prompt'}
        </button>
      </div>
      {names && (
        <button className={`link-btn mono small writer-stage ${board ? 'pink' : ''}`} onClick={() => (setBoard(!board), !stage && setStage(defaultStage(names.slice(0, 1))))}>
          {board ? '✦ Leave the staging to the writer' : '✦ Stage it on a board'}
        </button>
      )}
      {names && board && <StageBoard stage={stage} names={names} start={names.slice(0, 1)} onChange={setStage} />}
      {names && board && onPrevis && (
        <p className="small writer-note">
          <button className="btn btn-small" disabled={drawing || !stage?.people?.length} onClick={makePrevis}>
            {drawing ? 'Drawing…' : previsN ? 'Draw the previs again' : 'Make a previs clip'}
          </button>{' '}
          <span className="dim">
            {previsN ? `The previs is <Video ${previsN}> in your references; the writer tells H3 to follow its camera move.` : 'A grey clip of the camera move and the walks, added as a reference. Worth it for an arc round people, which H3 barely does from words; a push, track or walk works as well from the staging words, and faster.'}
          </span>
        </p>
      )}
      {seeing && !blocker && <p className={`small writer-note ${sees ? 'dim' : 'pink'}`}>✦ {seeing}</p>}
      {blocker && (
        <p className="small pink writer-note">
          {blocker}{' '}
          <button className="link-btn" onClick={() => go('settings')}>
            Set it up in Settings
          </button>
        </p>
      )}
      {undo != null && !busy && (
        <p className="small dim writer-note">
          Prompt written below; edit it freely.{' '}
          <button
            className="link-btn"
            onClick={() => {
              onWritten(undo)
              setUndo(null)
            }}
          >
            Undo
          </button>
        </p>
      )}
    </div>
  )
}

// A short story -> every shot of a sequence (the writer chosen in Settings; Context IR falls back to the local one).
export function StoryWriter({ character, shotSeconds, existing, onShots, notify }) {
  const [open, setOpen] = useState(false)
  const [story, setStory] = useState('')
  const [count, setCount] = useState(Math.max(2, existing || 3))
  const [busy, setBusy] = useState(false)

  async function write() {
    if (existing && !(await ask({ title: 'Replace your shots?', message: 'The shots you have are replaced with new ones written from the story.', confirm: 'Write new shots', danger: true }))) return
    setBusy(true)
    try {
      onShots(await window.ivstudio.prompts.story({ story, shots: count, seconds: shotSeconds, character }))
    } catch (err) {
      notify(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (!open)
    return (
      <button className="link-btn mono story-toggle" onClick={() => setOpen(true)}>
        ✦ Write all shots from a story
      </button>
    )
  return (
    <div className="writer">
      <div className="writer-head">
        <span className="mono label writer-label">✦ Write all shots from a story</span>
        <button className="link-btn mono" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
      <textarea rows={4} value={story} placeholder="A few sentences: who, where, what happens and what they say. {char} works here." onChange={(e) => setStory(e.target.value)} />
      <div className="writer-row tight">
        <div className="segmented">
          {[2, 3, 4, 5, 6].map((n) => (
            <button key={n} className={count === n ? 'on' : ''} onClick={() => setCount(n)}>
              {n} shots
            </button>
          ))}
        </div>
        <button className="btn btn-primary" disabled={busy || !story.trim()} onClick={write}>
          {busy ? 'Writing…' : 'Write the shots'}
        </button>
      </div>
      <p className="small dim writer-note">Uses the writer chosen in Settings (the local one if that's Context IR). Each shot follows the join rules so they play as one take.</p>
    </div>
  )
}
