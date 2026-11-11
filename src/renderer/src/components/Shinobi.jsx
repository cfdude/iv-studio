import { useEffect, useRef, useState } from 'react'
import Hero from './Hero'
import Stage from './Stage'
import { ToolShelf, ShelfTile, Step, Choices, Summary, SummaryDock, SummaryFrame, WorkflowNeeds } from './FlowKit'
import { AspectTiles } from './CreateKit'
import { SetCode } from './SettingsKit'
import TileDelete from './TileDelete'
import { fileUrl } from './edit/model'

const ASPECTS = [
  ['16:9', 1280, 720],
  ['9:16', 1080, 1920],
  ['1:1', 1080, 1080]
]
const RUNNING = ['running', 'queued']
const base = (p) => String(p).split(/[\\/]/).pop()

// Set up the engine once, then films: create one or open one.
export function ShinobiList({ openShinobi, notify, go }) {
  const [st, setSt] = useState(null)
  const [list, setList] = useState([])
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState([])
  const load = () => window.ivstudio.shinobi.status().then((s) => (setSt(s), s.installed && window.ivstudio.shinobi.projects().then(setList)))
  useEffect(() => {
    load()
    return window.ivstudio.shinobi.onLog((l) => setLog((x) => [...x.slice(-40), l]))
  }, [])
  async function install() {
    setBusy(true)
    try {
      await window.ivstudio.shinobi.install()
      await load()
    } catch (err) {
      notify(err.message)
    } finally {
      setBusy(false)
    }
  }
  async function create() {
    try {
      openShinobi((await window.ivstudio.shinobi.create(name.trim())).project_id)
    } catch (err) {
      notify(err.message)
    }
  }
  if (!st) return null
  return (
    <div className="shinobi flow-page">
      <Stage effect="slash" art="shinobi" title="Shinobi" kicker="Edits your agent cuts" back={go && { label: 'Workflows', onClick: () => go('workflows') }}>
        {st.installed ? (
          <>
            <div className="stage-panel">
              <input value={name} placeholder="Name your film, e.g. Theo teaser" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && create()} aria-label="Film name" />
              <button className="btn btn-primary" disabled={!name.trim()} onClick={create}>
                Start a film
              </button>
            </div>
            <p className="stage-note small">Cuts on the beat, speed ramps, camera moves, typography, effects and sound, written by your agent (or a recipe) and rendered on this computer.</p>
          </>
        ) : (
          <>
            <div className="stage-panel stage-setup">
              <span className="stage-drop-text">Set up Shinobi once · about 440 MB</span>
              <button className="btn btn-primary" disabled={busy || !st.browser} onClick={install}>
                {busy ? 'Setting up…' : 'Set up Shinobi'}
              </button>
            </div>
            <p className="stage-note small">{st.browser ? `It renders with ${base(st.browser).replace('.exe', '')} and IV Studio's own ffmpeg, at a fixed version in IV Studio's own folder. Nothing else on your computer changes.` : 'Shinobi needs Microsoft Edge or Google Chrome to draw frames.'}</p>
          </>
        )}
        <WorkflowNeeds page="shinobi" />
      </Stage>
      {busy && log.length > 0 && <pre className="code cloud-log">{log.join('\n')}</pre>}

      {st.installed && (
        <ToolShelf label="Your films" count={list.length} empty="No films yet. Name one in the bar above.">
          {list.map((p) => (
            <ShelfTile
              key={p.id}
              onOpen={() => openShinobi(p.id)}
              media={p.cover ? <video src={`${fileUrl(p.cover)}#t=0.5`} muted preload="metadata" /> : <span className="shelf-empty-art">No render yet</span>}
              status={p.renders ? `${p.renders} render${p.renders === 1 ? '' : 's'}` : null}
              name={p.name}
              meta={[`${p.assets} media`]}
              del={<TileDelete name={p.name} keeps="Its renders go too (copy any you want to keep, or send them to Edit first). Your original files stay." notify={notify} onDelete={async () => (await window.ivstudio.shinobi.delete(p.id), setList(await window.ivstudio.shinobi.projects()))} />}
            />
          ))}
        </ToolShelf>
      )}
    </div>
  )
}

// One film: brief and media, a first cut from a recipe, the hand-off to an agent, renders.
export function ShinobiProject({ projectId, notify, go }) {
  const [p, setP] = useState(null)
  const [presets, setPresets] = useState([])
  const [lib, setLib] = useState(null)
  const [brief, setBrief] = useState('')
  const [preset, setPreset] = useState(null)
  const [aspect, setAspect] = useState('16:9')
  const [seconds, setSeconds] = useState(8)
  const [text, setText] = useState('')
  const [previews, setPreviews] = useState([])
  const [busy, setBusy] = useState(null)
  const [tools, setTools] = useState(null)
  const [query, setQuery] = useState('')
  const S = window.ivstudio.shinobi
  const load = () => S.project(projectId).then((x) => (setP(x), x))
  useEffect(() => {
    load().then((x) => setBrief(x.brief))
    S.presets().then((list) => (setPresets(list), setPreset(list[0]?.name)))
  }, [projectId])
  const rendering = p?.renders.some((r) => RUNNING.includes(r.state))
  useEffect(() => {
    if (!rendering) return
    const h = setInterval(load, 2500)
    return () => clearInterval(h)
  }, [rendering])

  async function act(label, fn) {
    setBusy(label)
    try {
      return await fn()
    } catch (err) {
      notify(err.message)
    } finally {
      setBusy(null)
    }
  }
  if (!p) return null
  const visual = p.assets.filter((a) => a.kind !== 'audio')
  const music = p.assets.find((a) => a.kind === 'audio')
  const chosen = presets.find((x) => x.name === preset)
  const [, W, H] = ASPECTS.find((a) => a[0] === aspect)
  // A style that needs music says so ("needs music; 3+ clips"); "music optional" doesn't count.
  const needsMusic = chosen && /\bmusic\b/i.test(chosen.needs) && !/music optional/i.test(chosen.needs)

  const lastRender = [...p.renders].reverse().find((r) => r.video)
  const cover = lastRender ? { path: lastRender.video, kind: 'video' } : visual[0] ? { path: visual[0].path, kind: visual[0].kind } : null
  const facts = [
    ['Media', `${visual.length} picture${visual.length === 1 ? '' : 's'} or clip${visual.length === 1 ? '' : 's'}`],
    ['Sound', music ? music.name : 'none yet'],
    ['Edit', p.timeline ? `${p.timeline.seconds} s · ${p.timeline.shots} shots` : 'not built yet'],
    ['Renders', String(p.renders.length)]
  ]
  const action = { label: rendering ? 'Rendering…' : p.timeline ? 'Render the saved edit' : 'Build a first cut first', disabled: !p.timeline || rendering || !!busy, onClick: () => render() }
  async function firstCut() {
    await act('Building the first cut', async () => {
      const r = await S.call('build_recipe', { project_id: projectId, family: chosen.family, asset_ids: visual.map((a) => a.id), music_asset_id: music?.id ?? null, text: text || null, seconds, width: W, height: H, fps: 30 })
      const cur = await S.call('get_project', { project_id: projectId })
      await S.call('save_timeline', { project_id: projectId, timeline: r.timeline || r, revision: cur.revision ?? null })
      // the cut's own length: a song shorter than the asked seconds ends it sooner
      const total = (r.timeline || r)?.canvas?.frames || seconds * 30
      const frames = [0.1, 0.35, 0.6, 0.85].map((f) => Math.round(f * total))
      setPreviews((await S.call('preview_timeline', { project_id: projectId, frames })).preview_images || [])
      await load()
    })
  }
  async function render() {
    await act('Starting the render', async () => {
      await S.call('start_render', { project_id: projectId, request_id: `iv-${Date.now().toString(36)}` })
      await load()
    })
  }
  const agentBrief = `Edit a film with Shinobi, IV Studio's agent-driven editor (its MCP tools: shinobi_tools to list them, shinobi to call one).

Project: "${p.name}" (project_id ${p.id}).
Media already imported:
${p.assets.map((a) => `- ${a.id}: ${a.kind}, ${a.name}`).join('\n') || '- none yet'}
${p.timeline ? `There is a saved timeline (${p.timeline.seconds} s) you can build on.` : 'No timeline yet.'}

What I want:
${brief || '(describe the film here)'}

Read the guides first (shinobi read_guide: agent, timeline, effects). Look at the media with preview_source before choosing shots, preview the timeline before rendering, and render with start_render. Tell me when it's ready; I'll review it in IV Studio's Shinobi page.`

  return (
    <div className="shinobi create-v2 flow-page">
      <Hero art="shinobi" help="shinobi-film" title={p.name} kicker="Shinobi film" back={go && { label: 'All films', onClick: () => go('shinobi') }} />
      {busy && <p className="mono small dim">{busy}…</p>}

      <div className="create-layout">
      <div className="create-steps">
      <Step n={1} title="Brief and media" sub="What the film is, and the pictures, clips and sound it's cut from.">
        <textarea rows={4} value={brief} placeholder="What's the film? Mood, pace, length, aspect, music, the words on screen…" onChange={(e) => setBrief(e.target.value)} onBlur={() => S.saveBrief(projectId, brief)} />
        <div className="media-actions">
          <button className="btn btn-small" onClick={() => act('Importing', async () => setP({ ...(await S.importFiles(projectId)), brief }))}>
            + Files
          </button>
          <button className="btn btn-small" onClick={async () => setLib(lib ? null : await window.ivstudio.edits.library())}>
            + IV Studio render
          </button>
        </div>
        {lib && (
          <div className="ed-lib shinobi-lib">
            {lib.slice(0, 40).map((item) => (
              <button key={item.key} className="ed-lib-item" onClick={() => act('Importing', async () => (setP({ ...(await S.importRender(projectId, item)), brief }), setLib(null)))}>
                <span>{item.label}</span>
                <span className="mono dim small">{item.group}</span>
              </button>
            ))}
          </div>
        )}
        {p.assets.length > 0 && (
          <div className="media-tiles">
            {p.assets.map((a) => (
              <div key={a.id} className={`media-tile ${a.kind}`}>
                <div className="media-thumb">
                  {a.kind === 'image' && <img src={fileUrl(a.path)} alt="" />}
                  {a.kind === 'video' && <video src={`${fileUrl(a.path)}#t=0.3`} muted preload="metadata" />}
                  {a.kind === 'audio' && <span className="media-wave">♪</span>}
                </div>
                <div className="media-meta">
                  <span className="mono pink">{a.kind}</span>
                  <span className="media-name" title={a.name}>
                    {a.name}
                  </span>
                  {a.kind === 'video' && (
                    <button className="link-btn mono small" onClick={() => act('Taking its sound', async () => setP({ ...(await S.importAudioOf(projectId, a.path)), brief }))}>
                      Use its sound as the soundtrack
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Step>

      <Step n={2} title="A first cut" sub="No agent needed: pick a style and Shinobi lays out a starting edit from your media. Your agent can take it from there.">
        <Choices label="Style" className="shinobi-presets" value={preset} onChange={setPreset} options={presets.map((x) => [x.name, x.title, x.about, `Needs ${x.needs}`])} />
        <AspectTiles aspects={ASPECTS.map(([a]) => a)} value={aspect} onChange={setAspect} />
        <div className="create-grid">
          <label className="create-field">
            <span className="create-label mono">Seconds</span>
            <input className="mini" type="number" min={3} max={60} value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} />
          </label>
          <label className="create-field">
            <span className="create-label mono">Title</span>
            <input value={text} placeholder="optional words on screen" onChange={(e) => setText(e.target.value)} />
          </label>
        </div>
        <button className="btn btn-primary" disabled={!visual.length || !chosen || !!busy || (needsMusic && !music)} onClick={firstCut}>
          Build the first cut
        </button>
        {!visual.length && <p className="small dim">Add some pictures or clips first.</p>}
        {visual.length > 0 && needsMusic && !music && <p className="small pink">{chosen.title} cuts to music: add a soundtrack (a sound file, or "Use its sound as the soundtrack" on a clip).</p>}
        {previews.length > 0 && (
          <div className="shinobi-previews">
            {previews.map((f) => (
              <img key={f} src={fileUrl(f)} alt="" />
            ))}
          </div>
        )}
        {p.timeline && (
          <p className="mono small dim">
            Saved edit: {p.timeline.seconds} s · {p.timeline.width}×{p.timeline.height} · {p.timeline.fps} fps · {p.timeline.shots} shots · {p.timeline.texts} titles
          </p>
        )}
      </Step>

      <Step n={3} title="Hand it to your agent" sub="Your agent edits through IV Studio's MCP (Settings → Agents). This message tells it which film, what's in it and what you want.">
        <div onClick={() => S.saveBrief(projectId, brief)}>
          <SetCode text={agentBrief} label="Copy for your agent" tall />
        </div>
        <details className="shinobi-tools" onToggle={(e) => e.target.open && !tools && S.tools().then(setTools)}>
          <summary className="mono dim">Everything Shinobi can do ({tools?.length || 72} tools)</summary>
          <input value={query} placeholder="Search: beat, captions, 3D, speed…" onChange={(e) => setQuery(e.target.value)} />
          {(tools || [])
            .filter((t) => !query || `${t.name} ${t.description}`.toLowerCase().includes(query.toLowerCase()))
            .map((t) => (
              <div key={t.name} className="shinobi-tool">
                <span className="mono pink">{t.name}</span>
                <span className="small">{t.description}</span>
              </div>
            ))}
        </details>
      </Step>

      <Step n={4} title="Render and review" sub={p.timeline ? 'Render the saved edit, then send a render to Edit or show it in its folder.' : 'Build a first cut, or ask your agent for an edit, first.'}>
        <div className="char-clips">
          {p.renders.map((r) => (
            <div key={r.id} className="char-clip">
              {r.video ? <video className="char-video" src={fileUrl(r.video)} controls preload="metadata" /> : <div className="char-pending mono small dim">{RUNNING.includes(r.state) ? 'Rendering…' : r.error || r.state}</div>}
              <div className="row-actions">
                <span className="mono small dim">{r.requestId}</span>
                {r.video && (
                  <>
                    <button className="link-btn mono" onClick={() => act('Making an edit', async () => (await window.ivstudio.shinobi.addToEdit(r.video, p.name), notify('Added to a new edit on the Edit page.', 'info')))}>
                      To Edit
                    </button>
                    <button className="link-btn mono" onClick={() => window.ivstudio.files.reveal({ path: r.video })}>
                      Show
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </Step>
      </div>

      <Summary label="Your film" kind={aspect} frame={<SummaryFrame aspect={aspect} src={cover && fileUrl(cover.path)} video={cover && cover.kind !== 'image'} tag={p.timeline ? `${p.timeline.seconds} s edit` : null} />} facts={facts} action={action} />
      </div>
      <SummaryDock facts={facts} action={action} />
    </div>
  )
}
