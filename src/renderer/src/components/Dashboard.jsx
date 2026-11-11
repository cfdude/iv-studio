import { useEffect, useState } from 'react'
import { fileUrl } from './edit/model'
import { ART } from './Hero'
import Stage from './Stage'
import QuickBar from './AudioQuick'
import { sendIdea } from './PromptWriter'
import { Tile, toSets, Viewer } from './MediaLibrary'
import Loading from './Loading'
import { AgentPanel, useAgentRun } from './AgentRun'
import WhatsNew, { NewsChip } from './WhatsNew'
import { askAgent, useAgentName } from './ChatPanel'
import { ask } from './Confirm'

// The home page: start something in one click, pick up the latest renders, and the cast with their voices.
// Each quick-start card shows its page's own banner art.
const QUICK = [
  ['shot', 'New shot', 'An idea in plain words becomes H3 previews.', 'shots'],
  ['picture', 'New picture', 'Make or edit a picture on six image models.', 'library'],
  ['film', 'Short film', 'A script becomes shots, takes and a rough cut.', 'projects'],
  ['edit', 'Cut an edit', 'Your renders, music and titles on a timeline.', 'edit'],
  ['music', 'New song', 'A song or a score, made on this computer.', 'music'],
  ['line', 'Voice line', "Words in a character's own voice.", 'lines'],
  ['sizzle', 'Website film', 'A web address becomes a promo film.', 'sizzle'],
  ['character', 'New character', 'Design and train a recurring actor.', 'characters']
]
const RECENT = 8

// Your recipes (recipes.js): requests that worked in the chat, saved by its agent when you asked ("save this as a
// recipe"). A click sends it to the chat again; × takes the button away.
function Recipes({ notify }) {
  const [list, setList] = useState([])
  const agent = useAgentName()
  useEffect(() => {
    window.ivstudio.recipes.list().then(setList, () => {})
    return window.ivstudio.recipes.onChange(setList)
  }, [])
  if (!list.length) return null
  async function remove(r) {
    if (!(await ask({ title: `Remove “${r.name}”?`, message: 'The button goes from the Dashboard. You can ask the chat to save it again.', confirm: 'Remove it' }))) return
    try {
      setList(await window.ivstudio.recipes.remove(r.id))
    } catch (err) {
      notify(err.message)
    }
  }
  return (
    <div className="dash-recipes">
      <p className="mono small dim">Your recipes{agent ? ` · ${agent} makes them again` : ''}</p>
      <div className="recipe-row">
        {list.map((r) => (
          <span key={r.id} className="recipe">
            <button className="recipe-go" disabled={!agent} title={agent ? r.instruction : 'Install Claude Code or Codex to use recipes'} onClick={() => askAgent({ text: r.instruction, about: `the recipe “${r.name}”`, send: true })}>
              <span className="recipe-name">{r.name}</span>
              {r.note && <span className="small dim">{r.note}</span>}
            </button>
            <button className="lora-chip-x recipe-x" aria-label={`Remove the recipe ${r.name}`} onClick={() => remove(r)}>
              ×
            </button>
          </span>
        ))}
      </div>
    </div>
  )
}

export default function Dashboard(ctx) {
  const { characters, start, startShotWith, go, notify, info, setup } = ctx
  const [idea, setIdea] = useState('')
  // a Mac renders H3 on its own Apple GPU (ComfyUI 0.44+) or in the cloud: until one is set up, say so
  const macLocal = info?.platform === 'darwin' && setup && !setup.remote
  const [items, setItems] = useState(null)
  const [edits, setEdits] = useState([])
  const [voices, setVoices] = useState([])
  const [ready, setReady] = useState([])
  const [open, setOpen] = useState(null)
  const [newsOpen, setNewsOpen] = useState(false)
  // the person's own Claude Code or Codex can make the idea here instead (AgentRun.jsx)
  const agent = useAgentRun()
  const agentBusy = agent?.run?.status === 'running'
  const letAgent = async () => {
    try {
      await window.ivstudio.agentRun.start(idea)
      setIdea('')
    } catch (err) {
      notify(err.message)
    }
  }
  useEffect(() => {
    window.ivstudio.library.all().then(setItems, (err) => (notify(err.message), setItems([])))
    window.ivstudio.edits.list().then(setEdits, () => {})
    window.ivstudio.voices.list().then(setVoices, () => {})
    window.ivstudio.characters.catalog().then(setReady, () => {})
  }, [])
  const sets = items ? toSets(items).slice(0, RECENT) : []
  const face = (c) => c.picture || ready.find((r) => r.id === c.id)?.picture
  const voiceOf = (c) => voices.find((v) => v.id === c.voiceId)

  return (
    <div className="dashboard">
      <Stage effect="pulse" art="eye" title="What if?" kicker="Infinite Variance Studio" help="home">
        {/* straight into Create, where the prompt writer turns the words into a shot (PromptWriter sendIdea) */}
        <QuickBar
          label="What do you want to make?"
          placeholder="What do you want to make? A fox crossing a frozen lake at dawn…"
          value={idea}
          onChange={setIdea}
          goLabel="Make it"
          disabled={!idea.trim()}
          onGo={() => (start('shot'), sendIdea(idea, true), setIdea(''))}
          after={
            agent?.pick && (
              <button
                className="btn agent-go"
                disabled={!idea.trim() || agentBusy || agent.cloud}
                title={agent.cloud ? `${agent.name} only renders on this computer: switch Cloud to This computer to use it` : agentBusy ? `${agent.name} is still working on the last idea` : `${agent.name} writes the prompt and renders the previews here, on this computer`}
                onClick={letAgent}
              >
                Let {agent.name} make it
              </button>
            )
          }
        />
      </Stage>
      <AgentPanel run={agent?.run} go={go} onStop={() => window.ivstudio.agentRun.stop().catch((err) => notify(err.message))} onDismiss={() => window.ivstudio.agentRun.dismiss().catch(() => {})} />
      {/* once after an update: a small button that opens what this version brought (news.js, WhatsNew.jsx); all of
          it stays on Settings → Updates */}
      <NewsChip news={ctx.news} onOpen={() => setNewsOpen(true)} onDismiss={ctx.dismissNews} />
      {newsOpen && ctx.news && <WhatsNew news={ctx.news} go={go} onClose={() => (setNewsOpen(false), ctx.dismissNews())} />}
      {macLocal && (
        <p className="notice">
          On a Mac, shots render on your Apple GPU through ComfyUI 0.44 or newer, or in the cloud. For the cloud, set up your own RunPod or Modal account, or Comfy Cloud, and IV Studio sends the work there.{' '}
          <button className="link-btn" onClick={() => go('cloud')}>
            Set up the cloud →
          </button>
        </p>
      )}

      <section className="block">
        <p className="mono label">01 · Start something</p>
        <div className="quick-cards">
          {QUICK.map(([id, title, blurb, art]) => (
            <button key={id} className="quick-card" onClick={() => start(id)}>
              <span className="quick-art" style={ART[art] ? { backgroundImage: `url("${ART[art]}")` } : undefined} aria-hidden="true" />
              <span className="quick-text">
                <span className="quick-title">{title}</span>
                <span className="small dim">{blurb}</span>
              </span>
            </button>
          ))}
        </div>
        <Recipes notify={notify} />
      </section>

      <section className="block">
        <div className="dash-head">
          <p className="mono label">02 · Recent</p>
          <button className="link-btn mono" onClick={() => go('media')}>
            Everything in the Library →
          </button>
        </div>
        {items === null && <Loading label="Loading your renders" />}
        {items && sets.length === 0 && <p className="dim">Nothing made yet. Start with a shot or a picture above.</p>}
        <div className="lib-grid dash-recent">
          {sets.map((s, i) => (
            <Tile key={s.key} set={s} onOpen={() => setOpen([i, 0])} />
          ))}
        </div>
        {open && sets[open[0]] && <Viewer sets={sets} at={open} setAt={setOpen} onClose={() => setOpen(null)} edits={edits} {...ctx} />}
      </section>

      <section className="block">
        <div className="dash-head">
          <p className="mono label">03 · Your cast</p>
          <button className="link-btn mono" onClick={() => go('characters')}>
            All characters →
          </button>
        </div>
        {characters.length === 0 && <p className="dim">No characters yet. Download Tess or Theo, or train your own, on the Characters page.</p>}
        <div className="cast-cards">
          {characters.map((c) => {
            const v = voiceOf(c)
            return (
              <div key={c.id} className="cast-card">
                <div className="cast-face">{face(c) ? <img src={fileUrl(face(c))} alt="" /> : <span>{c.name.slice(0, 1)}</span>}</div>
                <div className="cast-body">
                  <span className="cast-name">{c.name}</span>
                  <span className="mono small dim">{v ? `Voice · ${v.name}` : 'No voice yet'}</span>
                  <div className="cast-actions">
                    <button className="btn btn-small btn-primary" onClick={() => startShotWith(c.id)}>
                      New shot
                    </button>
                    {v && (
                      <button className="btn btn-small" onClick={() => start('line')}>
                        Say a line
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}
