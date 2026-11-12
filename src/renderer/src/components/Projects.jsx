import { useEffect, useRef, useState } from 'react'
import { media } from '../media'
import { ask } from './Confirm'
import StageBoard from './StageBoard'
import { needsPrevis } from '../../../service/staging'
import { fileUrl } from './edit/model'
import Hero from './Hero'
import Stage from './Stage'
import QuickBar from './AudioQuick'
import Loading from './Loading'
import { dayGroup, groupBy, WHEN, inWhen, Chips, useMore, Groups, FilterPanel } from './ShelfKit'
import { LoraPicker } from './Loras'
import { askAgent, useAgentName } from './ChatPanel'
import { CinemaChips, CinemaPicker, LookbookBox, PromptTools, useSlate } from './CraftKit'

// Projects: a short film made step by step (src/service/productions.js). The list of films, and one film as a
// six-step wizard: Idea, Story, Cast and places, Storyboard, Film it, Watch. The storyboard is the heart of it:
// every shot is a panel with a sketch, its action and its line, and the same board fills in with takes.
const P = () => window.ivstudio.productions
const STEPS = [
  ['idea', 'Idea'],
  ['story', 'Story'],
  ['cast', 'Cast and places'],
  ['board', 'Storyboard'],
  ['film', 'Film it'],
  ['watch', 'Watch']
]
const FORMATS = [
  ['16:9', 'Widescreen', 'YouTube, TV, a big screen'],
  ['9:16', 'Vertical', 'TikTok, Reels, Shorts'],
  ['1:1', 'Square', 'Feeds and posts']
]
const LENGTHS = [
  [30, '30 seconds'],
  [60, '1 minute'],
  [120, '2 minutes'],
  [300, '5 minutes']
]
const LOOKS = [
  ['Natural', 'natural light, realistic colours, soft film grain'],
  ['Cinematic', 'anamorphic widescreen look, dramatic contrast, rich colour grade, shallow depth of field'],
  ['Vintage 16 mm', '16 mm film, heavy grain, faded warm colours, soft focus'],
  ['Noir', 'black and white, hard shadows, high contrast'],
  ['Dreamy', 'soft haze, pastel colours, glowing backlight'],
  ['Animated', 'stylised 3D animation, bright saturated colours, soft shapes']
]
const ANGLE_NAMES = { quarter: 'Turned a little', side: 'From the side', wide: 'Wider' }
const CAMERAS = ['Wide shot, static', 'Medium shot, static', 'Close-up, static', 'Wide shot, slow push in', 'Medium shot, handheld', 'Close-up, slow push in', 'Tracking shot following them', 'Over the shoulder']
const FILM_STATE = {
  draft: ['Not planned', ''],
  ready: ['Not filmed yet', ''],
  speaking: ['Saying the line…', 'busy'],
  queued: ['Waiting to film', 'busy'],
  rendering: ['Filming…', 'busy'],
  pick: ['Pick a take', 'pick'],
  finishing: ['Finishing…', 'busy'],
  finished: ['Done', 'ok'],
  error: ['Failed', 'bad']
}
const EXAMPLE = `Title: One More Try

INT. POTTERY STUDIO - DAY

Rain taps the skylight. TESS, clay to the elbows, lifts a finished bowl off the wheel and turns it in the light.

TESS
(to herself)
That's the one.

She sets it on a shelf crowded with a dozen almost identical bowls, and laughs.

EXT. STREET OUTSIDE THE STUDIO - DAY

Tess runs through the rain to her car, the bowl wrapped in a towel against her chest.

TESS
Don't you dare break.
`
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`
const src = (o) => (o?.path ? fileUrl(o.path) : media(o?.url))
const first = (x) => String(x || '').split(/\s+/)[0].toLowerCase()
// a name in capitals, as a script's cue writes it, the way people read it: "MR. WHISKERS" -> "Mr. Whiskers"
const nice = (n) => (n && n === n.toUpperCase() ? n.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : n)
const ratio = (aspect) => aspect.replace(':', ' / ')
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
// about how long a hunt takes on a 4090: ~14 s of GPU per second of preview
const estimate = (shots, previews) => Math.max(1, Math.round(shots.reduce((n, s) => n + s.seconds, 0) * previews * 14 / 60))

// faces for characters: their own picture, or the ready-made catalogue's
function useFaces() {
  const [ready, setReady] = useState([])
  useEffect(() => {
    window.ivstudio.characters.catalog().then(setReady, () => {})
  }, [])
  return (ch) => ch && (ch.picture || ready.find((r) => r.id === ch.id)?.picture)
}

// ---------- the list ----------
// Where a film is: the wizard's steps, gathered into four stages for the filter.
const STAGES = [
  ['writing', 'Writing', ['idea', 'story']],
  ['planning', 'Planning', ['cast', 'board']],
  ['filming', 'Filming', ['film']],
  ['done', 'Watching', ['watch']]
]
const SORT_FILMS = [
  ['new', 'Newest'],
  ['old', 'Oldest'],
  ['name', 'Name'],
  ['shots', 'Most shots']
]

export function ProjectsList({ notify, openProject }) {
  const [items, setItems] = useState(null)
  const [busy, setBusy] = useState(false)
  const [q, setQ] = useState('')
  const agent = useAgentName()
  const [stage, setStage] = useState('all')
  const [period, setPeriod] = useState('any')
  const [shape, setShape] = useState('all')
  const [sort, setSort] = useState('new')
  const load = () => P().list().then(setItems, (err) => (notify(err.message), setItems([])))
  useEffect(() => {
    load()
  }, [])
  async function create() {
    setBusy(true)
    try {
      const p = await P().create({ name: 'Untitled film', aspect: '16:9', targetSeconds: 60 })
      openProject(p.id)
    } catch (err) {
      notify(err.message)
      setBusy(false)
    }
  }
  async function remove(p) {
    if (!(await ask({ title: `Delete "${p.name}"?`, message: 'The project goes. Its shots stay in Shots and the Library, and its edit stays in Edit.', confirm: 'Delete it' }))) return
    await P().delete(p.id).catch((err) => notify(err.message))
    load()
  }
  const label = Object.fromEntries(STEPS)
  const all = items || []
  const now = Date.now()
  const stageOf = (p) => STAGES.find(([, , steps]) => steps.includes(p.step || 'idea'))?.[0] || 'writing'
  const tests = {
    stage: (p) => stage === 'all' || stageOf(p) === stage,
    period: (p) => inWhen(period, p.updatedAt, now),
    shape: (p) => shape === 'all' || p.aspect === shape,
    q: (p) => !q.trim() || `${p.name} ${p.logline || ''}`.toLowerCase().includes(q.trim().toLowerCase())
  }
  const passing = (except) => all.filter((p) => Object.entries(tests).every(([k, t]) => k === except || t(p)))
  const count = (except, fn) => passing(except).filter(fn).length
  let shown = passing()
  if (sort === 'old') shown = [...shown].reverse()
  if (sort === 'name') shown = [...shown].sort((x, y) => x.name.localeCompare(y.name))
  if (sort === 'shots') shown = [...shown].sort((x, y) => (y.shots || 0) - (x.shots || 0))
  const groups = sort === 'new' || sort === 'old' ? groupBy(shown, (p) => dayGroup(p.updatedAt, now)) : [[sort === 'name' ? 'A to Z' : 'Most shots first', shown]]
  const [limit, more] = useMore(shown.length, 24, `${q}|${stage}|${period}|${shape}|${sort}`)
  const shapes = [...new Set(all.map((p) => p.aspect).filter(Boolean))]

  return (
    <div className="projects shelf-page">
      <Stage effect="spotlight" art="projects" title="Projects" kicker="A short film, step by step">
        <QuickBar search label="Search films" placeholder="Search your films" value={q} onChange={setQ} results=".shelf-tools" found={shown.length} noun="film" alt={{ label: '+ New film', onClick: create, disabled: busy }} />
      </Stage>
      <p className="lede">
        Turn an idea into a short film.
        <span className="lede-small dim">Say what it's about, get a script, cast your characters, see it as a storyboard, then film it shot by shot and watch it come together.</span>
        {agent && (
          <button className="btn btn-small proj-ask" onClick={() => askAgent({ text: 'Let’s make a short film together, one step at a time. It’s about ' })} title={`${agent} walks it through script, cast, storyboard, shots and rough cut, and stops for your OK at each step`}>
            Make one with {agent}
          </button>
        )}
      </p>
      <div className="shelf-tools">
        <div className="shelf-bar">
          <div className="segmented" role="tablist" aria-label="Where it is">
            {[['all', 'All', count('stage', () => true)], ...STAGES.map(([id, name]) => [id, name, count('stage', (p) => stageOf(p) === id)])].map(([id, name, n]) => (
              <button key={id} role="tab" aria-selected={stage === id} className={stage === id ? 'on' : ''} onClick={() => setStage(id)}>
                {name} <span className="dim">{n}</span>
              </button>
            ))}
          </div>
          <label className="shelf-sort mono">
            Sort
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              {SORT_FILMS.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {all.length > 0 && (
          <FilterPanel id="projects" total={all.length} shown={shown.length} onClear={() => (setPeriod('any'), setShape('all'))} active={[period !== 'any' && WHEN.find(([w]) => w === period)[1], shape !== 'all' && shape].filter(Boolean)}>
            <Chips label="When" value={period} onChange={setPeriod} options={WHEN.map(([id, name]) => [id, name, id === 'any' ? undefined : count('period', (p) => inWhen(id, p.updatedAt, now))])} />
            {shapes.length > 1 && <Chips label="Shape" value={shape} onChange={setShape} options={[['all', 'Any'], ...shapes.map((x) => [x, x, count('shape', (p) => p.aspect === x)])]} />}
          </FilterPanel>
        )}
      </div>
      {items === null && <Loading label="Loading your films" />}
      {items?.length === 0 && (
        <div className="shelf-blank">
          <p>No films yet. Start from an idea, or a script you already have.</p>
          <button className="btn btn-primary" disabled={busy} onClick={create}>
            Start a film
          </button>
        </div>
      )}
      {items?.length > 0 && shown.length === 0 && <p className="dim">No films match.</p>}
      <Groups
        groups={groups}
        limit={limit}
        render={(p) => (
          <div key={p.id} className="proj-card" role="button" tabIndex={0} onClick={() => openProject(p.id)} onKeyDown={(e) => e.key === 'Enter' && openProject(p.id)}>
            <div className="proj-card-cover">{p.cover ? <img src={fileUrl(p.cover)} alt="" loading="lazy" /> : <span className="mono small dim">{p.aspect}</span>}</div>
            <span className="proj-card-name">{p.name}</span>
            {p.logline && <span className="small dim proj-card-logline">{p.logline}</span>}
            <span className="proj-card-foot mono small">
              <span className="proj-step-pill">
                {STEPS.findIndex(([id]) => id === p.step) + 1} · {label[p.step] || 'Idea'}
              </span>
              <span className="dim">{p.shots ? plural(p.shots, 'shot') : p.scenes ? plural(p.scenes, 'scene') : 'just started'}</span>
              <button
                className="link-btn mono small proj-card-x"
                title="Delete"
                onClick={(e) => {
                  e.stopPropagation()
                  remove(p)
                }}
              >
                ×
              </button>
            </span>
          </div>
        )}
      />
      {more}
    </div>
  )
}

// ---------- one film ----------
export function ProjectPage({ productionId, notify, go, openShot, openEdit, characters }) {
  const [v, setV] = useState(null)
  const top = useRef(null)
  const timer = useRef(null)
  const load = () => P().get(productionId).then(setV, (err) => notify(err.message))
  useEffect(() => {
    load()
    const off = P().onChanged((u) => u.id === productionId && load())
    return () => (off(), clearTimeout(timer.current))
  }, [productionId])
  // while anything is being written, planned, sketched or filmed, look again every few seconds
  useEffect(() => {
    clearTimeout(timer.current)
    if (v && (v.writing || v.filming || v.breakdown?.state === 'running' || v.totals.rendering > 0 || v.totals.sketching > 0)) timer.current = setTimeout(load, 4000)
  }, [v])
  if (!v) return null
  const act = async (fn, ok) => {
    try {
      const r = await fn()
      const said = typeof ok === 'function' ? ok(r) : ok
      if (said) notify(said, 'info')
      await load()
      return r
    } catch (err) {
      notify(err.message)
    }
  }
  const setStep = (step) => {
    setV((cur) => ({ ...cur, step })) // from the newest film: a save just before (Story's Next) has reloaded it
    P().update(v.id, { step }).catch(() => {})
    top.current?.scrollIntoView({ block: 'start' })
  }
  const at = STEPS.findIndex(([id]) => id === v.step)
  const ctx = { v, setV, act, load, notify, go, openShot, openEdit, characters, setStep }
  const t = v.totals
  const filmed = t.finished + t.pick
  const status = {
    idea: v.logline ? v.aspect : '',
    story: v.scenes.length ? plural(v.scenes.length, 'scene') : '',
    cast: v.cast.length ? `${v.cast.length} cast` : '',
    board: t.shots ? plural(t.shots, 'panel') : '',
    film: t.shots && filmed ? `${filmed} of ${t.shots}` : '',
    watch: v.editId ? 'cut' : ''
  }
  return (
    <div className="project" ref={top}>
      <Hero art="projects" help="project" back={{ label: 'All films', onClick: () => go('projects') }} kicker={`Short film · ${v.aspect} · ${t.shots ? `${clock(t.seconds)} planned · ` : ''}${clock(v.targetSeconds)} goal`}>
        <input className="shot-name hero-title-input" value={v.name} aria-label="Film title" onChange={(e) => setV({ ...v, name: e.target.value })} onBlur={(e) => act(() => P().update(v.id, { name: e.target.value.trim() || 'Untitled film' }))} />
      </Hero>
      <nav className="wiz-steps" aria-label="Steps">
        {STEPS.map(([id, label], i) => (
          <button key={id} className={`wiz-step-btn ${i === at ? 'on' : i < at ? 'done' : ''}`} aria-current={i === at ? 'step' : undefined} onClick={() => setStep(id)}>
            <span className="wiz-step-n">{i < at ? '✓' : i + 1}</span>
            <span className="wiz-step-text">
              <span className="wiz-step-label">{label}</span>
              <span className="wiz-step-status mono">{status[id] || ' '}</span>
            </span>
          </button>
        ))}
      </nav>
      {v.step === 'idea' && <Idea {...ctx} />}
      {v.step === 'story' && <Story {...ctx} />}
      {v.step === 'cast' && <Cast {...ctx} />}
      {v.step === 'board' && <Board {...ctx} mode="board" />}
      {v.step === 'film' && <Board {...ctx} mode="film" />}
      {v.step === 'watch' && <Watch {...ctx} />}
    </div>
  )
}

function Foot({ back, next, label, disabled, hint, busy }) {
  return (
    <div className="wiz-foot">
      {back ? (
        <button className="btn" onClick={back}>
          ‹ Back
        </button>
      ) : (
        <span />
      )}
      <span className="small dim wiz-foot-hint">{hint}</span>
      {next && (
        <button className="btn btn-primary wiz-next" disabled={disabled || busy} onClick={next}>
          {busy ? 'Saving…' : label} ›
        </button>
      )}
    </div>
  )
}

// ---------- 1 · Idea ----------
function Idea({ v, act, setStep }) {
  const [logline, setLogline] = useState(v.logline || '')
  const save = (patch) => act(() => P().update(v.id, patch))
  const next = async () => {
    if (logline !== v.logline) await save({ logline })
    setStep('story')
  }
  return (
    <section className="wiz-page">
      <h2 className="wiz-q">What's your film about?</h2>
      <p className="wiz-help">A sentence or two is plenty. You can change everything later.</p>
      <textarea className="wiz-big" rows={3} value={logline} placeholder="For example: a potter who can never stop at one more bowl." onChange={(e) => setLogline(e.target.value)} onBlur={() => logline !== v.logline && save({ logline })} />
      <h3 className="wiz-q2">Where will people watch it?</h3>
      <div className="wiz-choices">
        {FORMATS.map(([a, label, sub]) => (
          <button key={a} className={`wiz-choice ${v.aspect === a ? 'on' : ''}`} onClick={() => save({ aspect: a })}>
            <span className="wiz-frame-box">
              <span className={`wiz-frame ${a === '16:9' ? '' : 'tall'}`} style={{ aspectRatio: ratio(a) }} />
            </span>
            <span className="wiz-choice-name">{label}</span>
            <span className="small dim">{sub}</span>
          </button>
        ))}
      </div>
      <h3 className="wiz-q2">How long?</h3>
      <div className="wiz-pills">
        {LENGTHS.map(([s, l]) => (
          <button key={s} className={v.targetSeconds === s ? 'on' : ''} onClick={() => save({ targetSeconds: s })}>
            {l}
          </button>
        ))}
      </div>
      <p className="wiz-help">Every shot is up to 10 seconds, so a minute is about 8 to 12 shots. Short films come out best.</p>
      <Foot next={next} label="Next: the story" disabled={!logline.trim()} hint={logline.trim() ? '' : 'Say what it’s about to go on.'} />
    </section>
  )
}

// ---------- 2 · Story ----------
function Story({ v, act, notify, setStep }) {
  const [text, setText] = useState(v.script?.text || '')
  const [editing, setEditing] = useState(!!v.script?.text)
  const [saving, setSaving] = useState(false)
  const file = useRef(null)
  useEffect(() => {
    // a script written by the writer (or an agent) replaces what's shown
    if (v.writing) return
    setText(v.script?.text || '')
    if (v.script?.text) setEditing(true)
  }, [v.script?.text, v.writing])
  const dirty = text !== (v.script?.text || '')
  const write = async () => {
    if (!v.logline?.trim()) return notify('Say what the film is about on the Idea step first.')
    if (text.trim() && !(await ask({ title: 'Write a new script?', message: 'The writer starts again from your idea and replaces the script here.', confirm: 'Write a new one' }))) return
    act(() => P().writeScript(v.id), 'Your script is ready. Read it through and change anything you like.')
    setEditing(true)
  }
  const pickFile = (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    const r = new FileReader()
    r.onload = () => (setText(String(r.result)), setEditing(true))
    r.readAsText(f)
    e.target.value = ''
  }
  const save = async () => {
    if (!dirty) return v
    setSaving(true)
    const p = await act(() => P().setScript(v.id, text))
    setSaving(false)
    return p
  }
  const next = async () => {
    if (await save()) setStep('cast')
  }
  const lines = v.scenes.reduce((n, s) => n + s.elements.filter((e) => e.type === 'dialogue').length, 0)
  const input = <input ref={file} type="file" accept=".txt,.fountain,.text,.md" hidden onChange={pickFile} />
  if (v.writing)
    return (
      <section className="wiz-page">
        <div className="wiz-working">
          <span className="wiz-spinner" aria-hidden="true" />
          <h2 className="wiz-q">Writing your script…</h2>
          <p className="wiz-help">The writer on this PC turns your idea into scenes and lines. It takes a minute or two.</p>
        </div>
      </section>
    )
  if (!editing)
    return (
      <section className="wiz-page">
        <h2 className="wiz-q">How do you want to start the story?</h2>
        <p className="wiz-help">Whichever you pick, you can read and change every word.</p>
        <div className="wiz-choices three">
          <button className="wiz-choice big" onClick={write}>
            <span className="wiz-choice-icon" aria-hidden="true">
              ✦
            </span>
            <span className="wiz-choice-name">Write it for me</span>
            <span className="small dim">A first draft from your idea, about {LENGTHS.find(([s]) => s === v.targetSeconds)?.[1] || clock(v.targetSeconds)} long.</span>
          </button>
          <button className="wiz-choice big" onClick={() => setEditing(true)}>
            <span className="wiz-choice-icon" aria-hidden="true">
              ✎
            </span>
            <span className="wiz-choice-name">I'll write it</span>
            <span className="small dim">Plain words are fine. No screenplay rules needed.</span>
          </button>
          <button className="wiz-choice big" onClick={() => file.current.click()}>
            <span className="wiz-choice-icon" aria-hidden="true">
              ⇪
            </span>
            <span className="wiz-choice-name">I have a script</span>
            <span className="small dim">Bring in a .txt or .fountain file.</span>
          </button>
        </div>
        {input}
        <Foot back={() => setStep('idea')} />
      </section>
    )
  return (
    <section className="wiz-page">
      <div className="wiz-head">
        <h2 className="wiz-q">Your story</h2>
        <span className="wiz-tools">
          <button className="link-btn mono small" onClick={write}>
            ✦ Write it for me
          </button>
          <button className="link-btn mono small" onClick={() => file.current.click()}>
            Bring in a file
          </button>
          {!text.trim() && (
            <button className="link-btn mono small" onClick={() => setText(EXAMPLE)}>
              Show me an example
            </button>
          )}
        </span>
      </div>
      {input}
      <div className="wiz-script">
        <textarea className="wiz-paper" rows={20} value={text} spellCheck placeholder={'In the kitchen, at night. Tess stares at the toaster.\n\nTESS\nToast is done.'} onChange={(e) => setText(e.target.value)} onBlur={save} />
        <aside className="wiz-tip">
          <p className="mono label">How to write it</p>
          <p className="small">Write what we see and hear, in order.</p>
          <p className="small">
            When someone talks, put their name in capitals on its own line, and what they say on the line under it:
          </p>
          <pre className="wiz-tip-eg">{'TESS\nToast is done.'}</pre>
          <p className="small">
            A new place starts with a line like <code>INT. KITCHEN - NIGHT</code> (inside) or <code>EXT. BEACH - DAY</code> (outside).
          </p>
        </aside>
      </div>
      <Foot back={() => setStep('idea')} next={next} label="Next: cast and places" disabled={!text.trim()} busy={saving} hint={v.scenes.length ? `${plural(v.scenes.length, 'scene')} · ${plural(lines, 'spoken line')}` : ''} />
    </section>
  )
}

// ---------- 3 · Cast and places ----------
function Cast({ v, act, characters, notify, go, setStep }) {
  const face = useFaces()
  const [picking, setPicking] = useState(false)
  const [look, setLook] = useState(v.look?.notes || '')
  const [cinema, setCinema] = useState(false)
  const slate = useSlate()
  const save = (patch, ok) => act(() => P().update(v.id, patch), ok)
  const saveLook = (patch) => save({ look: { ...v.look, ...patch } })
  // everyone who speaks in the script, plus anyone cast who doesn't
  const speakers = [...new Set(v.scenes.flatMap((s) => s.elements.filter((e) => e.type === 'dialogue').map((e) => e.who)))]
  const roles = [...speakers, ...v.cast.filter((c) => !speakers.some((s) => first(s) === first(c.as))).map((c) => c.as)]
  const playedBy = (role) => v.cast.find((c) => first(c.as) === first(role))
  const madeUp = (role) => v.cast.find((c) => !c.characterId && first(c.as) === first(role))
  // a speaker no character plays gets a face drawn for this film (kept with its description); anyone else is taken out
  const castRole = (role, characterId) => {
    const old = madeUp(role)
    const drawn = { as: role, characterId: null, description: old?.description || '', face: old?.face || null }
    save({ cast: [...v.cast.filter((c) => first(c.as) !== first(role)), ...(characterId ? [{ characterId, as: role }] : speakers.includes(role) ? [drawn] : [])] })
  }
  const setMade = (role, patch) => save({ cast: [...v.cast.filter((c) => first(c.as) !== first(role)), { as: role, characterId: null, description: '', face: null, ...madeUp(role), ...patch }] })
  const [drawing, setDrawing] = useState('')
  const draw = (key, fn, ok) => async () => (setDrawing(key), await act(fn, ok), setDrawing(''))
  const extras = characters.filter((c) => !v.cast.some((x) => x.characterId === c.id))
  const pictureFor = async (i) => {
    const files = await window.ivstudio.files.pick('picture')
    const list = (Array.isArray(files) ? files : files ? [files] : []).map((f) => f.path || f)
    if (list.length) save({ locations: v.locations.map((x, j) => (j === i ? { ...x, pictures: [list[0], ...x.pictures.filter((p) => p !== list[0])] } : x)) })
  }
  const setPlace = (i, patch) => save({ locations: v.locations.map((x, j) => (j === i ? { ...x, ...patch } : x)) })
  // the person's own picture as a made-up role's face, instead of a drawn one
  const facePicture = async (role) => {
    const files = await window.ivstudio.files.pick('picture')
    const file = (Array.isArray(files) ? files : files ? [files] : []).map((f) => f.path || f)[0]
    if (file) act(() => P().useFace(v.id, role, file), `${role} has your picture as their face. Their sketches are marked to redraw.`)
  }
  // someone who appears but never speaks (an animal, a passer-by): a made-up role so they can have a face too
  const [extra, setExtra] = useState('')
  const addExtra = () => {
    const name = extra.trim()
    if (!name || roles.some((r) => first(r) === first(name))) return setExtra('')
    save({ cast: [...v.cast, { as: name, characterId: null, description: '', face: null }] }, `${name} is in the cast.`)
    setExtra('')
  }
  const preset = LOOKS.find(([, t]) => t === look)
  return (
    <section className="wiz-page">
      <h2 className="wiz-q">Who's in it?</h2>
      <p className="wiz-help">
        A character keeps the same face and voice in every shot. Make new ones on the{' '}
        <button className="link-btn" onClick={() => go('characters')}>
          Characters page
        </button>
        .
      </p>
      {!roles.length && <p className="dim small">No one speaks in the script yet. Add anyone who appears below.</p>}
      <div className="wiz-cast">
        {roles.map((role) => {
          const c = playedBy(role)
          const ch = characters.find((x) => x.id === c?.characterId)
          const made = ch ? null : madeUp(role)
          const pic = face(ch) || made?.face
          return (
            <div key={role} className={`wiz-role ${ch || made?.face ? 'on' : ''}`}>
              <div className="wiz-role-face">{pic ? <img src={fileUrl(pic)} alt="" /> : <span>{role.slice(0, 1)}</span>}</div>
              <span className="wiz-role-name">{role}</span>
              <select value={c?.characterId || ''} onChange={(e) => castRole(role, e.target.value)} aria-label={`Who plays ${role}`}>
                <option value="">{speakers.includes(role) || made ? 'Made up for this film' : 'Not in it'}</option>
                {characters.map((x) => (
                  <option key={x.id} value={x.id}>
                    Played by {x.name}
                  </option>
                ))}
              </select>
              {ch && !ch.voiceId && <span className="mono small dim">No voice yet: H3 gives them one.</span>}
              {!ch && (speakers.includes(role) || made) && (
                <>
                  <textarea rows={2} key={`d${made?.description || ''}`} defaultValue={made?.description || ''} placeholder="What do they look like? Age, hair, clothes." aria-label={`What ${role} looks like`} onBlur={(e) => e.target.value !== (made?.description || '') && setMade(role, { description: e.target.value })} />
                  <span className="wiz-role-acts">
                    <button className="link-btn mono small" disabled={!!drawing} onClick={draw(role, () => P().drawFace(v.id, role, { again: !!made?.face }), `${role}'s face is drawn. Their sketches are marked to redraw.`)}>
                      {drawing === role ? 'Drawing…' : made?.face ? 'Draw a new face' : 'Draw their face now'}
                    </button>
                    <button className="link-btn mono small" disabled={!!drawing} onClick={() => facePicture(role)}>
                      Use a picture
                    </button>
                  </span>
                  {!made?.face && drawing !== role && <span className="mono small dim">Or it's drawn when the storyboard is sketched. A picture of just their face works best.</span>}
                </>
              )}
            </div>
          )
        })}
      </div>
      <div className="wiz-extras">
        <span className="small dim">Someone who doesn't speak:</span>
        <input className="wiz-extra-name" value={extra} placeholder="A name, e.g. Bramble the dog" aria-label="Someone who doesn't speak" onChange={(e) => setExtra(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addExtra()} />
        <button className="btn btn-small" disabled={!extra.trim()} onClick={addExtra}>
          Add
        </button>
      </div>
      {extras.length > 0 && (
        <div className="wiz-extras">
          <span className="small dim">Add someone else:</span>
          {extras.map((c) => (
            <button key={c.id} className="wiz-extra" onClick={() => save({ cast: [...v.cast, { characterId: c.id, as: c.name.split(' ')[0] }] })}>
              <span className="wiz-extra-face">{face(c) ? <img src={fileUrl(face(c))} alt="" /> : c.name.slice(0, 1)}</span>
              {c.name.split(' ')[0]}
            </button>
          ))}
        </div>
      )}

      <h2 className="wiz-q wiz-q-gap">Where does it happen?</h2>
      <p className="wiz-help">Describe each place, or add a photo of it. Every shot there uses it. With no photo, one is drawn for you when the storyboard is sketched.</p>
      <div className="wiz-places">
        {v.locations.map((l, i) => (
          <div key={l.id} className="wiz-place">
            <button className="wiz-place-pic" style={{ aspectRatio: ratio(v.aspect) }} onClick={() => pictureFor(i)} title={l.pictures[0] ? 'Change the photo' : 'Add a photo'}>
              {l.pictures[0] ? <img src={fileUrl(l.pictures[0])} alt="" /> : <span className="small dim">+ Add a photo</span>}
            </button>
            <input className="wiz-place-name" defaultValue={l.name} aria-label="Place name" onBlur={(e) => e.target.value !== l.name && setPlace(i, { name: e.target.value })} />
            <textarea rows={3} defaultValue={l.description} placeholder="What does it look like? The room, the light, the colours." onBlur={(e) => e.target.value !== l.description && setPlace(i, { description: e.target.value })} />
            <span className="wiz-place-foot">
              {l.pictures[0] && (
                <button className="link-btn mono small" onClick={() => setPlace(i, { pictures: [] })}>
                  Remove photo
                </button>
              )}
              <button className="link-btn mono small" onClick={() => save({ locations: v.locations.filter((_, j) => j !== i) })}>
                Remove place
              </button>
            </span>
            {l.pictures[0] && (
              <div className="wiz-angles">
                {(l.angles || [])
                  .filter((a) => ANGLE_NAMES[a.view] && (!a.from || a.from === l.pictures[0]))
                  .map((a) => (
                    <figure key={a.view} title={ANGLE_NAMES[a.view]}>
                      <img src={fileUrl(a.file)} alt="" style={{ aspectRatio: ratio(v.aspect) }} />
                      <figcaption className="mono small dim">{ANGLE_NAMES[a.view]}</figcaption>
                    </figure>
                  ))}
                <button className="link-btn mono small" disabled={!!drawing} title="The same place from a quarter turn, from the side and from further back, so shots from other angles keep the room (about a minute each)" onClick={draw(l.id, () => P().drawAngles(v.id, l.id), 'More angles drawn. Turned and wide shots use them.')}>
                  {drawing === l.id ? 'Drawing the angles…' : (l.angles || []).some((a) => ANGLE_NAMES[a.view] && (!a.from || a.from === l.pictures[0])) ? 'Draw the angles again' : '+ More angles'}
                </button>
              </div>
            )}
          </div>
        ))}
        <button className="wiz-place wiz-place-add" onClick={() => save({ locations: [...v.locations, { name: 'New place', description: '', pictures: [] }] })}>
          + Add a place
        </button>
      </div>

      <h2 className="wiz-q wiz-q-gap">What should it look like?</h2>
      <div className="wiz-pills">
        {LOOKS.map(([name, notes]) => (
          <button key={name} className={look === notes ? 'on' : ''} onClick={() => (setLook(notes), save({ look: { ...v.look, notes } }))}>
            {name}
          </button>
        ))}
      </div>
      <textarea className="wiz-look" rows={2} value={look} placeholder="Or say it in your own words: 35 mm film, warm lamp light, muted greens." onChange={(e) => setLook(e.target.value)} onBlur={() => look !== (v.look?.notes || '') && save({ look: { ...v.look, notes: look } })} />
      {!preset && look && <p className="mono small dim">Your own look.</p>}
      <div className="lora-tray">
        {(v.look?.loras || []).map((l, i) => (
          <div key={l.name} className="lora-chip">
            <div className="lora-chip-body">
              <span className="lora-chip-name" title={l.name}>
                {l.title || l.name.split(/[\\/]/).pop()}
              </span>
              <div className="lora-chip-strength">
                <input type="range" min={0} max={1.5} step={0.05} defaultValue={l.strength} onMouseUp={(e) => save({ look: { ...v.look, loras: v.look.loras.map((x, j) => (j === i ? { ...x, strength: Number(e.target.value) } : x)) } })} />
                <span className="mono small">{Number(l.strength).toFixed(2)}</span>
              </div>
            </div>
            <button className="lora-chip-x" aria-label="Remove" onClick={() => save({ look: { ...v.look, loras: v.look.loras.filter((_, j) => j !== i) } })}>
              ×
            </button>
          </div>
        ))}
        <button className="lora-add" onClick={() => setPicking(true)}>
          + Style LoRA
        </button>
      </div>
      {picking && <LoraPicker notify={notify} go={go} onClose={() => setPicking(false)} onPick={(l) => (setPicking(false), save({ look: { ...v.look, loras: [...(v.look?.loras || []), { name: l.name, strength: 0.8, title: l.title }] } }))} />}
      <div className="wiz-craft" data-tour="film-cinema">
        <h3 className="wiz-q-small">Cinematography</h3>
        <p className="small dim">Film stock, lenses, light and camera for the whole film. Each goes into every shot's prompt.</p>
        <CinemaChips value={v.look?.setups || []} onChange={(setups) => saveLook({ setups })} onOpen={() => setCinema(true)} label={v.look?.setups?.length ? 'Add more' : 'Choose the cinematography'} />
      </div>
      {cinema && <CinemaPicker value={v.look?.setups || []} onChange={(setups) => saveLook({ setups })} onClose={() => setCinema(false)} />}
      <div className="wiz-craft" data-tour="film-lookbook">
        <h3 className="wiz-q-small">Lookbook</h3>
        <p className="small dim">Name a film, a director or a cinematographer, or describe the look. It becomes look language for every shot, with no names in it.</p>
        <LookbookBox value={v.look?.lookbook || null} onChange={(lookbook) => saveLook({ lookbook })} writer={slate?.writer} />
      </div>

      <details className="wiz-more">
        <summary className="mono small">Props (optional)</summary>
        <p className="small dim">Things that matter to the story, like a car or a ring. Their description goes into every shot's prompt that names them.</p>
        <div className="wiz-places">
          {v.props.map((x, i) => (
            <div key={x.id} className="wiz-place">
              <input className="wiz-place-name" defaultValue={x.name} onBlur={(e) => e.target.value !== x.name && save({ props: v.props.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)) })} />
              <textarea rows={2} defaultValue={x.description} placeholder="What it looks like." onBlur={(e) => e.target.value !== x.description && save({ props: v.props.map((y, j) => (j === i ? { ...y, description: e.target.value } : y)) })} />
              <button className="link-btn mono small" onClick={() => save({ props: v.props.filter((_, j) => j !== i) })}>
                Remove
              </button>
            </div>
          ))}
          <button className="wiz-place wiz-place-add" onClick={() => save({ props: [...v.props, { name: 'Prop', description: '', pictures: [] }] })}>
            + Add a prop
          </button>
        </div>
      </details>
      <Foot back={() => setStep('story')} next={() => setStep('board')} label="Next: the storyboard" />
    </section>
  )
}

// ---------- 4 · Storyboard and 5 · Film it: one board of panels ----------
function Board({ v, act, characters, openShot, setStep, mode }) {
  const [open, setOpen] = useState(null) // { sceneId, shotId } in the drawer
  const [takes, setTakes] = useState(null) // shot id whose takes are being picked
  // takes per shot, remembered on this PC
  const [previews, setPreviewCount] = useState(() => {
    try {
      return Number(localStorage.getItem('iv.filmTakes')) === 2 ? 2 : 3
    } catch {
      return 3
    }
  })
  const setPreviews = (n) => {
    setPreviewCount(n)
    try {
      localStorage.setItem('iv.filmTakes', String(n))
    } catch {}
  }
  const [fromSketch, setFromSketch] = useState(true)
  const face = useFaces()
  const b = v.breakdown
  const t = v.totals
  const planning = b?.state === 'running'
  const all = v.scenes.flatMap((s) => s.shots)
  const stale = v.scenes.filter((s) => s.stale || !s.shots.length)
  const unsketched = all.filter((s) => !s.sketch && !s.sketchSet).length
  const plan = () => act(() => P().breakDown(v.id, { sketch: true }), 'Planning the shots. Each panel gets a sketch when its shot is planned.')
  const toFilm = all.filter((s) => s.prompt && !s.projectId)
  const shotAt = open && v.scenes.find((s) => s.id === open.sceneId)?.shots.find((s) => s.id === open.shotId)
  const takesShot = takes && all.find((s) => s.id === takes)
  const film = mode === 'film'
  // the animatic: { making } while it's built, then { file, seconds, ... } in a player
  const [animatic, setAnimatic] = useState(null)
  const playAnimatic = async (voice) => {
    setAnimatic({ making: true, voice })
    const r = await act(() => P().animatic(v.id, { voice }))
    setAnimatic(r?.file ? { ...r, open: true } : null)
  }
  const unvoiced = all.filter((s) => s.line && !s.voiceLine && characters.find((c) => c.id === s.character)?.voiceId).length

  if (!v.scenes.length)
    return (
      <section className="wiz-page">
        <div className="wiz-working">
          <h2 className="wiz-q">The story comes first</h2>
          <p className="wiz-help">The storyboard is made from your script.</p>
          <button className="btn btn-primary" onClick={() => setStep('story')}>
            Go to the story
          </button>
        </div>
      </section>
    )
  if (!all.length && !planning)
    return (
      <section className="wiz-page">
        <div className="wiz-board-empty">
          <div className="wiz-ghosts" aria-hidden="true">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} style={{ aspectRatio: ratio(v.aspect) }} />
            ))}
          </div>
          <h2 className="wiz-q">Turn the script into a storyboard</h2>
          <p className="wiz-help">IV Studio reads your script and plans every shot: what we see, the camera and who speaks. Then it sketches each panel, so you can see the film before you make it. Planning uses your prompt writer (Settings → Prompt writer) and takes a minute or two.</p>
          {b?.state === 'error' && <p className="small pink">The last try stopped: {b.error}</p>}
          <button className="btn btn-primary wiz-next" onClick={plan}>
            ✦ Plan my storyboard
          </button>
        </div>
        <Foot back={() => setStep('cast')} />
      </section>
    )
  return (
    <section className="wiz-page wide">
      {film ? (
        <div className="wiz-banner">
          <div>
            <h2 className="wiz-q">Film it</h2>
            <p className="wiz-help">
              Each shot is filmed {previews} ways{fromSketch && t.sketched ? ', starting from its sketch' : ''}. Pick the take you like best and it's finished in full quality. A character with a voice speaks their lines in it, once voices are set up on Audio → Voices.
            </p>
          </div>
          <div className="wiz-banner-act">
            <span className="mono small dim">
              {v.filming ? `Saying the lines first · ${plural(v.filming.waiting, 'shot')} to go` : `${t.finished} done · ${t.pick} to pick · ${t.rendering} filming`}
            </span>
            {t.sketched > 0 && (
              <label className="wiz-check small" title="Each shot opens exactly on its storyboard sketch, so the film keeps its framing and faces">
                <input type="checkbox" checked={fromSketch} onChange={(e) => setFromSketch(e.target.checked)} /> Start each shot from its sketch
              </label>
            )}
            <div className="segmented" title="Takes per shot">
              {[2, 3].map((n) => (
                <button key={n} className={previews === n ? 'on' : ''} onClick={() => setPreviews(n)}>
                  {n} takes
                </button>
              ))}
            </div>
            <button className="btn btn-primary" disabled={!toFilm.length || !!v.filming} onClick={() => act(() => P().renderScene(v.id, null, { previews, fromSketch }), (jobs) => `Filming ${plural(jobs.length, 'shot')}.`)}>
              {v.filming ? 'Getting the shots ready…' : toFilm.length ? `Film ${toFilm.length === all.length ? 'every shot' : `the ${plural(toFilm.length, 'shot')} left`} · about ${estimate(toFilm, previews)} min` : 'Every shot is filmed'}
            </button>
          </div>
        </div>
      ) : (
        <div className="wiz-banner">
          <div>
            <h2 className="wiz-q">Your storyboard</h2>
            <p className="wiz-help">Click a panel to change what happens, the camera or the line. Happy with it? Go on and film it.</p>
          </div>
          <div className="wiz-banner-act">
            {planning ? (
              <span className="mono small busy">
                Planning scene {Math.min(b.scenesDone + 1, b.scenes)} of {b.scenes} · prompts {b.shotsDone} of {b.shots}
              </span>
            ) : (
              <>
                {t.sketching > 0 && <span className="mono small busy">Sketching {plural(t.sketching, 'panel')}…</span>}
                <button className="btn btn-small" disabled={!!animatic?.making || !all.length} title="The sketches played in order with the lines, before anything is filmed" onClick={() => playAnimatic(false)}>
                  {animatic?.making ? 'Making the animatic…' : '▶ Play the animatic'}
                </button>
                {stale.length > 0 && (
                  <button className="btn btn-small btn-primary" onClick={plan}>
                    Plan the {plural(stale.length, 'changed scene')}
                  </button>
                )}
                {unsketched > 0 && !t.sketching && (
                  <button className="btn btn-small" onClick={() => act(() => P().sketch(v.id), (r) => `Sketching ${plural(r.length, 'panel')}.`)}>
                    Sketch {unsketched === all.length ? 'every panel' : `the ${plural(unsketched, 'panel')} left`}
                  </button>
                )}
                <span className="wiz-shotlist" data-tour="film-shotlist">
                  <button className="link-btn mono small" title="The shot list as a Markdown document, a table per scene" onClick={() => act(() => P().shotList(v.id, 'md'), (f) => (f ? `Shot list saved: ${f}` : null))}>
                    Shot list
                  </button>
                  <button className="link-btn mono small" title="One row per shot, with its prompt, for a spreadsheet" onClick={() => act(() => P().shotList(v.id, 'csv'), (f) => (f ? `Shot list saved: ${f}` : null))}>
                    CSV
                  </button>
                </span>
                <button
                  className="link-btn mono small"
                  onClick={async () => (await ask({ title: 'Plan it all again?', message: 'Every scene gets new shots, prompts and sketches. Anything you filmed stays in Shots and the Library.', confirm: 'Plan it again' })) && act(() => P().breakDown(v.id, { redo: true, sketch: true }))}
                >
                  Plan it all again
                </button>
              </>
            )}
          </div>
        </div>
      )}
      {b?.sketchError && !film && <p className="small pink">Sketches: {b.sketchError}</p>}
      {b?.state === 'done' && !film && b.cutScenes?.length > 0 && (
        <p className="small pink">
          The writer’s answer for scene {b.cutScenes.join(', ')} was cut short, so it may be missing its last moments. Check it, or{' '}
          <button className="link-btn small" onClick={() => act(() => P().breakDown(v.id, { sceneIds: b.cutScenes.map((n) => v.scenes[n - 1]?.id).filter(Boolean), sketch: true }))}>
            plan {b.cutScenes.length === 1 ? 'it' : 'them'} again
          </button>
          .
        </p>
      )}
      {b?.state === 'done' && !film && b.promptErrors > 0 && (
        <p className="small pink">{b.promptErrors === 1 ? 'One shot has' : `${b.promptErrors} shots have`} no prompt yet: the writer’s answer couldn’t be read. Open the shot and press Write the prompt.</p>
      )}
      {b?.state === 'done' && !film && b.restoredLines > 0 && (
        <p className="small dim">
          The writer left out {b.restoredLines === 1 ? 'one line' : `${b.restoredLines} lines`} of your script, so {b.restoredLines === 1 ? 'it has a shot' : 'they have shots'} of {b.restoredLines === 1 ? 'its' : 'their'} own, in a plain medium close-up. Open {b.restoredLines === 1 ? 'it' : 'them'} to change the camera or the action.
        </p>
      )}
      {v.scenes.map((sc, k) => (
        <div key={sc.id} className="wiz-scene">
          <div className="wiz-scene-head">
            <span className="wiz-scene-n">Scene {k + 1}</span>
            <span className="wiz-scene-place">
              {sc.location || sc.heading}
              {sc.time ? ` · ${sc.time.toLowerCase()}` : ''}
            </span>
            <span className="mono small dim">{clock(sc.shots.reduce((n, s) => n + s.seconds, 0))}</span>
            {sc.stale && <span className="mono small pink">script changed</span>}
            {film && sc.shots.some((s) => s.prompt && !s.projectId) && (
              <button className="link-btn mono small" onClick={() => act(() => P().renderScene(v.id, sc.id, { previews, fromSketch }), (jobs) => `Filming ${plural(jobs.length, 'shot')}.`)}>
                Film this scene
              </button>
            )}
          </div>
          {!film && <SceneTools v={v} sc={sc} k={k} act={act} planning={planning} />}
          <div className="wiz-panels">
            {sc.shots.map((sh, i) => (
              <Panel
                key={sh.id}
                v={v}
                sh={sh}
                n={i + 1}
                film={film}
                ch={characters.find((c) => c.id === sh.character)}
                face={face}
                onClick={() => (film && sh.state.status === 'pick' ? setTakes(sh.id) : setOpen({ sceneId: sc.id, shotId: sh.id }))}
              />
            ))}
            {!film && !planning && (
              <button
                className="wiz-panel wiz-panel-add"
                style={{ '--ratio': ratio(v.aspect) }}
                onClick={async () => {
                  const p = await act(() => P().editShot(v.id, sc.id, sc.shots.at(-1)?.id || null, { add: true, action: '', seconds: 5 }))
                  const added = p?.scenes.find((s) => s.id === sc.id)?.shots.at(-1)
                  if (added) setOpen({ sceneId: sc.id, shotId: added.id })
                }}
              >
                <span className="wiz-panel-frame">+</span>
                <span className="small dim">Add a shot</span>
              </button>
            )}
            {planning && !sc.shots.length && <div className="wiz-panel wiz-panel-ghost" style={{ '--ratio': ratio(v.aspect) }} />}
          </div>
        </div>
      ))}
      {film ? (
        <Foot back={() => setStep('board')} next={() => setStep('watch')} label="Next: watch it" disabled={!t.finished && !t.pick} hint={!t.finished && !t.pick ? 'Film a shot to watch it.' : ''} />
      ) : (
        <Foot back={() => setStep('cast')} next={() => setStep('film')} label="Next: film it" disabled={planning || !all.some((s) => s.prompt)} />
      )}
      {shotAt && <ShotDrawer v={v} sceneId={open.sceneId} sh={shotAt} act={act} characters={characters} face={face} openShot={openShot} film={film} previews={previews} fromSketch={fromSketch} onTakes={() => (setOpen(null), setTakes(shotAt.id))} onClose={() => setOpen(null)} />}
      {takesShot && <Takes v={v} sh={takesShot} act={act} onClose={() => setTakes(null)} onOpen={() => (setTakes(null), setOpen({ sceneId: v.scenes.find((s) => s.shots.some((x) => x.id === takesShot.id)).id, shotId: takesShot.id }))} />}
      {(animatic?.open || (animatic?.making && animatic.voice)) && <Animatic v={v} a={animatic} unvoiced={unvoiced} onVoice={() => playAnimatic(true)} onClose={() => setAnimatic(null)} />}
    </section>
  )
}

// A scene's coverage plan (Slate's twelve, by Sam Wasserman) and its continuity check.
function SceneTools({ v, sc, k, act, planning }) {
  const slate = useSlate()
  const [checking, setChecking] = useState(false)
  const c = sc.continuity
  const check = async () => {
    setChecking(true)
    await act(() => P().continuity(v.id, sc.id), (issues) => (issues?.length ? `${issues.length} continuity ${issues.length === 1 ? 'note' : 'notes'} on scene ${k + 1}.` : `Scene ${k + 1} reads clean.`))
    setChecking(false)
  }
  const plan = slate?.plans.find((p) => p.id === sc.coverage?.id)
  return (
    <>
      <div className="wiz-scene-tools">
        <label className="small dim" title={plan ? plan.description : 'How the scene is covered: the planner\'s own choice, or one of the coverage plans. Changing it plans the scene again.'}>
          Coverage{' '}
          <select value={sc.coverage?.id || ''} disabled={planning || !slate} aria-label={`Coverage for scene ${k + 1}`} onChange={(e) => act(() => P().coverage(v.id, sc.id, e.target.value || null), e.target.value ? 'Coverage set. Plan the changed scene to get its shots.' : 'Coverage set back to the planner\'s choice.')}>
            <option value="">The planner's choice</option>
            {['Shot Coverage', 'Angle Coverage', 'Story'].map((g) => (
              <optgroup key={g} label={g}>
                {(slate?.plans || [])
                  .filter((p) => p.group === g)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label} · {p.shots.length} shots
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
        <button className="link-btn mono small" disabled={checking || planning || sc.shots.filter((s) => s.prompt).length < 2} title="A script supervisor's read of the scene's shots: looks, wardrobe, props, light, time of day, screen sides and how each shot ends against the next" onClick={check}>
          {checking ? 'Checking continuity…' : 'Check continuity'}
        </button>
      </div>
      {c && (
        <div className="wiz-continuity">
          {c.issues.length ? (
            c.issues.map((x, i) => (
              <div key={i} className="wiz-continuity-row">
                <span className={`mono small ${x.severity === 'error' ? 'pink' : 'dim'}`}>{x.severity === 'error' ? 'Fix' : 'Check'}</span>
                <span className="mono small dim">{x.shots.length ? `Shot ${x.shots.join(', ')}` : ''}</span>
                <span className="small">
                  {x.issue} <span className="dim">{x.fix}</span>
                </span>
              </div>
            ))
          ) : (
            <p className="small dim">Continuity reads clean.</p>
          )}
        </div>
      )}
    </>
  )
}

// The animatic in a player: the storyboard as a film, with the lines, before anything is filmed.
function Animatic({ v, a, unvoiced, onVoice, onClose }) {
  useEffect(() => {
    const key = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wiz-animatic" role="dialog" aria-label="Animatic">
        <div className="modal-head">
          <h3>The animatic · {clock(a.seconds || 0)}</h3>
          <button className="lora-chip-x" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        {a.making ? (
          <p className="mono small busy">Saying the lines in your characters' voices, then making the animatic…</p>
        ) : (
          <video key={`${a.file}${a.at}`} src={`${fileUrl(a.file)}&t=${encodeURIComponent(a.at)}`} controls autoPlay style={{ aspectRatio: ratio(v.aspect) }} />
        )}
        <div className="modal-foot">
          <span className="small dim">
            {a.making ? '' : `${plural(a.shots || 0, 'shot')}, ${a.sketched} with sketches, ${a.voiced} with spoken lines. Too slow or too long? Change shot lengths on the board, then play it again.`}
          </span>
          {!a.making && unvoiced > 0 && (
            <button className="btn btn-small" onClick={onVoice}>
              Say the {plural(unvoiced, 'line')} in their voices
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function Panel({ v, sh, n, film, ch, face, onClick }) {
  const st = sh.state
  const [label, tone] = FILM_STATE[st.status] || FILM_STATE.draft
  const video = film && (st.final || (st.candidates?.length ? st.candidates.find((c) => c.n === st.picked) || st.candidates[0] : null))
  return (
    <button className={`wiz-panel ${film ? `film ${st.status}` : ''}`} style={{ '--ratio': ratio(v.aspect) }} onClick={onClick}>
      <span className="wiz-panel-frame">
        {video ? (
          <video src={src(video)} muted loop playsInline preload="metadata" poster={sh.sketch ? fileUrl(sh.sketch) : undefined} onMouseEnter={(e) => e.target.play().catch(() => {})} onMouseLeave={(e) => e.target.pause()} />
        ) : sh.sketch ? (
          <img src={fileUrl(sh.sketch)} alt="" />
        ) : (
          <span className="wiz-panel-blank mono small">{sh.sketchSet ? 'Sketching…' : sh.prompt ? 'No sketch yet' : v.breakdown?.state === 'running' ? 'Planning…' : 'No prompt yet'}</span>
        )}
        <span className="wiz-panel-n">{n}</span>
        {sh.slot && <span className="wiz-panel-slot wiz-panel-cont">{sh.slot}</span>}
        <span className="wiz-panel-secs mono">{sh.seconds}s</span>
        {sh.continues && (
          <span className="wiz-panel-cont mono" title="Carries straight on from the shot before, as one unbroken take">
            ↳ one take
          </span>
        )}
        {ch && face(ch) && <img className="wiz-panel-face" src={fileUrl(face(ch))} alt={ch.name} title={ch.name} />}
        {film && <span className={`wiz-panel-state ${tone}`}>{st.status === 'pick' ? `${label} · ${st.candidates.length}` : label}</span>}
      </span>
      <span className="wiz-panel-action">{sh.action || <span className="dim">Say what happens.</span>}</span>
      {sh.line && (
        <span className="wiz-panel-line">
          <b>{nice(sh.speaker) || 'Someone'}:</b> “{sh.line}”
        </span>
      )}
    </button>
  )
}

// A shot opened from the board: what happens, the camera, the line and its length, plus its sketch and prompt.
function ShotDrawer({ v, sceneId, sh, act, characters, face, openShot, film, previews, fromSketch, onTakes, onClose }) {
  const [changed, setChanged] = useState(false)
  const slate = useSlate()
  const [working, setWorking] = useState('')
  const sc = v.scenes.find((s) => s.id === sceneId)
  const i = sc.shots.findIndex((s) => s.id === sh.id)
  const edit = (patch, text = true) => (text && setChanged(true), act(() => P().editShot(v.id, sceneId, sh.id, patch)))
  const st = sh.state
  const named = [...new Set([...v.cast.map((c) => c.as), ...sc.elements.filter((e) => e.type === 'dialogue').map((e) => e.who)])]
  // the writer may give the speaker in another case ("TESS"): show it as the script's name
  const speaker = sh.speaker ? named.find((s) => first(s) === first(sh.speaker)) || sh.speaker : ''
  const speakers = speaker && !named.includes(speaker) ? [...named, speaker] : named
  const busy = (what, fn) => async () => (setWorking(what), await fn(), setWorking(''))
  // the staging board, and the scene's last staged shot before this one (for the line between two people)
  const [board, setBoard] = useState(!!sh.stage)
  const before = sc.shots.slice(0, i).reverse().find((s) => s.stage)?.stage || null
  useEffect(() => {
    const key = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="wiz-drawer" role="dialog" aria-label={`Shot ${i + 1}`}>
        <div className="wiz-drawer-head">
          <span className="wiz-scene-n">
            Scene {v.scenes.indexOf(sc) + 1} · Shot {i + 1}
          </span>
          <button className="lora-chip-x" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="wiz-drawer-frame" style={{ aspectRatio: ratio(v.aspect) }}>
          {film && st.final ? <video src={src(st.final)} controls preload="metadata" /> : sh.sketch ? <img src={fileUrl(sh.sketch)} alt="" /> : <span className="mono small dim">{sh.sketchSet ? 'Sketching…' : 'No sketch yet'}</span>}
        </div>
        {(changed || sh.sketchStale) && (
          <div className="wiz-drawer-note">
            <span className="small">{sh.sketchStale ? 'The sketch is from before the shot changed, so filming starts without it. Update the prompt and sketch to match?' : 'You changed the shot. Update its prompt and sketch to match?'}</span>
            <button
              className="btn btn-small btn-primary"
              disabled={!!working}
              onClick={busy('update', async () => {
                await act(() => P().writePrompt(v.id, sceneId, sh.id))
                await act(() => P().sketch(v.id, { shotIds: [sh.id] }))
                setChanged(false)
              })}
            >
              {working === 'update' ? 'Updating…' : 'Update them'}
            </button>
          </div>
        )}
        <label className="wiz-field">
          <span className="mono small dim">What we see</span>
          <textarea rows={3} defaultValue={sh.action} placeholder="Tess lifts the bowl off the wheel and turns it in the light." onBlur={(e) => e.target.value !== sh.action && edit({ action: e.target.value })} />
        </label>
        <div className="wiz-field">
          <span className="wiz-field-head">
            <span className="mono small dim">Who stands where</span>
            <button className={`link-btn mono small ${board ? 'pink' : ''}`} onClick={() => setBoard(!board)}>
              {board ? 'Hide the board' : sh.stage ? 'Open the board' : 'Draw it on a board'}
            </button>
          </span>
          {board && <StageBoard stage={sh.stage} names={named} start={sh.characters} before={before} onChange={(stage) => edit({ stage })} />}
          {board && needsPrevis(sh.stage) && <span className="small dim">The camera arcs, so this shot films from a previs of the board: a grey clip of the move that H3 follows.</span>}
          <textarea key={`st${sh.staging}`} rows={2} defaultValue={sh.staging || ''} placeholder="Tess screen-left at the wheel, facing right; Theo in the doorway screen-right, looking at her." onBlur={(e) => e.target.value !== (sh.staging || '') && edit({ staging: e.target.value })} />
        </div>
        <label className="wiz-field">
          <span className="mono small dim">Camera</span>
          <input key={`cam${sh.camera}`} list="wiz-cameras" defaultValue={sh.camera} placeholder="Medium shot, static" onBlur={(e) => e.target.value !== sh.camera && edit({ camera: e.target.value })} />
          <datalist id="wiz-cameras">
            {CAMERAS.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
        <label className="wiz-field">
          <span className="mono small dim">How it ends (the next shot starts here)</span>
          <textarea rows={2} defaultValue={sh.ends || ''} placeholder="Tess holds the bowl in both hands, still screen-left, now looking at Theo." onBlur={(e) => e.target.value !== (sh.ends || '') && edit({ ends: e.target.value })} />
        </label>
        <div className="wiz-field-row">
          <label className="wiz-field">
            <span className="mono small dim">Who speaks</span>
            <select value={speaker} onChange={(e) => edit({ speaker: e.target.value, ...(e.target.value ? {} : { line: '' }) })}>
              <option value="">No one</option>
              {speakers.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="wiz-field">
            <span className="mono small dim">Length · {sh.seconds} s</span>
            <input type="range" min={3} max={10} step={1} defaultValue={sh.seconds} onMouseUp={(e) => Number(e.target.value) !== sh.seconds && edit({ seconds: Number(e.target.value) }, false)} onKeyUp={(e) => Number(e.target.value) !== sh.seconds && edit({ seconds: Number(e.target.value) }, false)} />
          </label>
        </div>
        {speaker && (
          <label className="wiz-field">
            <span className="mono small dim">What {speaker} says</span>
            <input defaultValue={sh.line} placeholder="Exact words" onBlur={(e) => e.target.value !== sh.line && edit({ line: e.target.value })} />
          </label>
        )}
        <label className="wiz-field">
          <span className="mono small dim">Character in this shot</span>
          <select value={sh.character || 'none'} onChange={(e) => edit({ character: e.target.value })}>
            <option value="none">No character preset (anyone made up keeps their drawn face)</option>
            {characters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        {sh.voiceLine && (
          <div className="wiz-field">
            <span className="mono small dim">{sh.voiceLine.recorded ? `The line, recorded (${sh.voiceLine.recorded})` : `The line in ${characters.find((c) => c.id === sh.character)?.name.split(' ')[0] || 'their'}'s voice`}</span>
            <audio key={sh.voiceLine.file} src={fileUrl(sh.voiceLine.file)} controls preload="none" />
            <span className="wiz-line-again">
              {sh.voiceLine.heard != null && <span className="mono small dim">Heard: “{sh.voiceLine.heard}”</span>}
              {characters.find((c) => c.id === sh.character)?.voiceId && (
                <button className="link-btn mono small" disabled={!!working} onClick={busy('speak', () => act(() => P().speak(v.id, sh.id, { again: true }), 'A new take of the line. Film new takes to use it.'))}>
                  {working === 'speak' ? 'Saying it…' : sh.voiceLine.recorded ? 'Use their voice instead' : 'Say it again'}
                </button>
              )}
            </span>
          </div>
        )}
        {(speaker || sh.line) && (
          <span className="wiz-line-again">
            <button
              className="link-btn mono small"
              disabled={!!working}
              title="A recording of the line (your own voice, an actor, a take from elsewhere). The shot lip-syncs to it."
              onClick={busy('record', async () => {
                const files = await window.ivstudio.files.pick('audio')
                const file = (Array.isArray(files) ? files : [files]).filter(Boolean)[0]
                if (file) await act(() => P().useRecording(v.id, sh.id, file.path || file), (r) => `The recording is the line${r?.heard ? `: heard “${r.heard}”` : ''}. Film new takes to use it.`)
              })}
            >
              {working === 'record' ? 'Reading the recording…' : sh.voiceLine?.recorded ? 'Use another recording' : '♪ Use a recording of the line'}
            </button>
          </span>
        )}
        {i > 0 && (
          <label className="wiz-check small" title="This shot films on from the end of the shot before it, as one unbroken take: no cut. Film and pick the shot before first; this one is filmed as a single take.">
            <input type="checkbox" checked={!!sh.continues} onChange={(e) => edit({ continues: e.target.checked }, false)} /> Carry straight on from shot {i} (one unbroken take)
          </label>
        )}
        <details className="wiz-more">
          <summary className="mono small">The prompt H3 gets</summary>
          <textarea className="prompt" rows={9} defaultValue={sh.prompt} key={sh.prompt} onBlur={(e) => e.target.value !== sh.prompt && edit({ prompt: e.target.value }, false)} />
          <PromptTools
            prompt={sh.prompt}
            writer={slate?.writer}
            disabled={!!working}
            run={({ tool, note }) => act(() => P().rework(v.id, sceneId, sh.id, { tool, note }))}
            variants={() => P().variants(v.id, sceneId, sh.id)}
            onUse={(prompt, why) => act(() => P().setPrompt(v.id, sceneId, sh.id, prompt, why))}
            history={sh.history || []}
            onRestore={(index) => act(() => P().restorePrompt(v.id, sceneId, sh.id, index), 'The earlier prompt is back.')}
          />
        </details>
        {st.error && <p className="small pink">{st.error}</p>}
        <div className="wiz-drawer-acts">
          {film ? (
            <>
              {st.candidates?.length > 0 && (
                <button className="btn btn-small" onClick={onTakes}>
                  See the takes
                </button>
              )}
              {sh.prompt && !['rendering', 'finishing'].includes(st.status) && (
                <button className="btn btn-small btn-primary" onClick={() => act(() => P().render(v.id, sh.id, { previews, fromSketch }), `Filming ${previews} takes.`)}>
                  {sh.projectId ? 'Film new takes' : 'Film this shot'}
                </button>
              )}
              {sh.projectId && (
                <button className="link-btn mono small" onClick={() => openShot(sh.projectId)}>
                  Open in Shots ›
                </button>
              )}
            </>
          ) : (
            <>
              <button className="btn btn-small" disabled={!!working || !sh.action} onClick={busy('sketch', () => act(() => P().sketch(v.id, { shotIds: [sh.id] }), 'Sketching the panel.'))}>
                {sh.sketch ? 'Redraw the sketch' : 'Sketch it'}
              </button>
              <button className="btn btn-small" disabled={!!working || !sh.action} onClick={busy('prompt', () => act(() => P().writePrompt(v.id, sceneId, sh.id), 'Prompt rewritten.'))}>
                {working === 'prompt' ? 'Writing…' : sh.prompt ? 'Rewrite the prompt' : 'Write the prompt'}
              </button>
            </>
          )}
          <span className="wiz-drawer-moves">
            <button className="link-btn mono small" disabled={i === 0} onClick={() => edit({ move: -1 }, false)}>
              ‹ Earlier
            </button>
            <button className="link-btn mono small" disabled={i === sc.shots.length - 1} onClick={() => edit({ move: 1 }, false)}>
              Later ›
            </button>
            <button className="link-btn mono small pink" onClick={async () => (await ask({ title: 'Remove this shot?', message: 'Anything filmed for it stays in Shots and the Library.', confirm: 'Remove it' })) && (await edit({ remove: true }, false), onClose())}>
              Remove
            </button>
          </span>
        </div>
      </div>
    </div>
  )
}

// A shot's takes side by side; picking one finishes it at 2 MP.
function Takes({ v, sh, act, onClose, onOpen }) {
  const st = sh.state
  useEffect(() => {
    const key = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wiz-takes" role="dialog" aria-label="Pick a take">
        <div className="modal-head">
          <h2>Pick a take</h2>
          <span className="small dim">{sh.action}</span>
        </div>
        <div className="wiz-takes-row">
          {(st.candidates || []).map((c) => (
            <figure key={c.n} className={st.picked === c.n ? 'on' : ''}>
              <video src={src(c)} controls loop playsInline preload="metadata" style={{ aspectRatio: ratio(v.aspect) }} />
              <button className="btn btn-primary" disabled={st.status === 'finishing'} onClick={() => act(() => P().finish(v.id, sh.id, c.n), `Finishing take ${c.n} in full quality.`).then(onClose)}>
                Use take {c.n}
              </button>
            </figure>
          ))}
        </div>
        <div className="modal-foot">
          <span className="small dim">None of them right? Open the shot to change it, say the line again or film new takes.</span>
          <span className="wiz-takes-acts">
            <button className="btn" onClick={onOpen}>
              Open the shot
            </button>
            <button className="btn" onClick={onClose}>
              Close
            </button>
          </span>
        </div>
      </div>
    </div>
  )
}

// ---------- 6 · Watch ----------
function Watch({ v, act, openEdit, setStep, notify }) {
  const shots = v.scenes.flatMap((s) => s.shots)
  const pieces = shots.map((sh) => {
    const st = sh.state
    const take = st.final || (st.candidates?.length ? st.candidates.find((c) => c.n === st.picked) || st.candidates[0] : null)
    return { sh, take, final: !!st.final }
  })
  const playable = pieces.filter((p) => p.take)
  const [at, setAt] = useState(0)
  const [exporting, setExporting] = useState(false)
  const cur = playable[at]
  const previewsOnly = playable.filter((p) => !p.final).length
  const cut = () => act(() => P().roughCut(v.id))
  async function exportFilm() {
    setExporting(true)
    try {
      const r = await P().roughCut(v.id)
      const file = await window.ivstudio.edits.export(r.editId)
      notify(`Saved ${file}`, 'info')
      window.ivstudio.files.reveal(file).catch(() => {})
    } catch (err) {
      notify(err.message)
    }
    setExporting(false)
  }
  if (!playable.length)
    return (
      <section className="wiz-page">
        <div className="wiz-working">
          <h2 className="wiz-q">Nothing filmed yet</h2>
          <p className="wiz-help">Film a few shots and they play here in order.</p>
          <button className="btn btn-primary" onClick={() => setStep('film')}>
            Go to Film it
          </button>
        </div>
      </section>
    )
  return (
    <section className="wiz-page wide">
      <div className="wiz-watch" style={{ '--ratio': ratio(v.aspect) }}>
        <video key={cur.take.path || cur.take.url} className="wiz-watch-video" src={src(cur.take)} autoPlay={at > 0} controls playsInline onEnded={() => at + 1 < playable.length && setAt(at + 1)} />
      </div>
      <div className="wiz-strip">
        {pieces.map((p) => {
          const k = playable.indexOf(p)
          return (
            <button key={p.sh.id} className={`wiz-strip-cell ${k === at ? 'on' : ''} ${p.take ? (p.final ? 'final' : 'preview') : 'missing'}`} style={{ flexGrow: p.sh.seconds }} disabled={!p.take} onClick={() => setAt(k)} title={p.sh.action}>
              {p.sh.sketch && <img src={fileUrl(p.sh.sketch)} alt="" />}
            </button>
          )
        })}
      </div>
      <p className="mono small dim">
        {playable.length} of {plural(shots.length, 'shot')} filmed · {clock(playable.reduce((n, p) => n + p.sh.seconds, 0))}
        {previewsOnly > 0 ? ` · ${plural(previewsOnly, 'shot')} still a quick preview: pick its take on Film it to finish it` : ''}
      </p>
      <div className="wiz-watch-acts">
        <button className="btn btn-primary" disabled={exporting} onClick={exportFilm}>
          {exporting ? 'Saving the film…' : 'Save the film as a video'}
        </button>
        <button
          className="btn"
          onClick={async () => {
            const r = await cut()
            if (r?.editId) openEdit(r.editId)
          }}
        >
          Fine-tune in the editor
        </button>
        <span className="small dim">The editor is where you add music, titles and trims.</span>
      </div>
      <Foot back={() => setStep('film')} />
    </section>
  )
}
