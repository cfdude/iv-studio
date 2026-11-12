import { useEffect, useMemo, useState } from 'react'
import Stage from './Stage'
import { SettingsTabs } from './Settings'
import StartComfy, { RestartComfy } from './StartComfy'
import GetComfy from './GetComfy'
import ComfyUpdates from './ComfyUpdates'
import { Pill } from './SettingsKit'
import HfLogin from './HfLogin'

// Settings → Setup: what IV Studio needs on this PC, laid out so the answer comes first. A status card says
// whether shots can render and holds the one or two actions that fix it (and Restart ComfyUI). Below, five
// folding cards: ComfyUI, Models for shots, Node packs, Optional tools (grouped by the tool that uses them, each
// group downloadable at once) and Characters. A card opens by itself when something in it needs you, and
// "Needs you" hides everything that's already fine.
const ICON = { ok: '●', warn: '▲', missing: '✕' }
const GB = (b) => `${(b / 1024 ** 3).toFixed(1)} GB`
const ACTIVE = ['queued', 'downloading', 'verifying']
const VIEW_KEY = 'iv.setupView'

// Optional models, by the part of IV Studio that uses them (models.json optionalFor), each with what it does and
// where to find it (GitHub #21: a title alone wasn't enough to decide). First match wins, so the order matters.
const AREAS = [
  ['Live preview', /live step/i, 'The Live preview switch above the queue', 'Step-by-step pictures of a shot while it renders (a tiny H3 decoder, 0.1 GB).'],
  ['Picture tools', /relight|remove background|depth maps/i, 'Create → Image → Tools', 'Relight a picture, remove the background of a picture or a video clip (also in the editor), and make depth and normal maps.'],
  ['Replace', /^replace/i, 'Workflows → Replace', 'Swap a person in a video for one of your characters, or change the whole scene in words, keeping the motion and sound.'],
  ['Picture models', /create → image|pictures/i, 'Create → Image', 'Extra models for making pictures, each with its own look. Flux.2 Klein, Flux 3 Klein, Krea 2, Qwen Image 2.1 and MiniMax H3 Image can also edit a picture you give them. Z-Image Turbo also draws the design stills for training a character. Get only the ones you want: each card in Create → Image says what it needs.'],
  ['Video effects', /dub|clean plate|day to night|water|sdr/i, 'Edit → right-click a clip → Effects…', 'Dub a line into another language with lip sync, Clean plate (remove people), Day to night, Add water and SDR to HDR, on LTX-2.5. Works best with 64 GB of RAM.'],
  ['Photo effects and transitions', /^effects$|transformation|transition/i, 'Workflows → Effects', 'One-click effects that animate a photo (Wan 2.1 480p with a LoRA per effect), plus Transformations and Transitions between two pictures (these also use the LTX-2.5 files from Video effects).'],
  ['Slow motion', /smooth|slow/i, 'Edit → right-click a clip → Effects…', 'Smooth a choppy clip or slow it down by drawing the frames in between. Small and fast.'],
  ['Music and sounds', /music|sound/i, 'Audio → Music and Audio → Sounds', 'Songs with vocals or instrumentals and sound effects from a description.'],
  ['Training on this computer', /training characters/i, 'Characters → Train your own → Train a LoRA → This computer', 'The files the trainer needs to train a character LoRA on your own graphics card (with the H3 fl2va model and audio VAE you already have). Not needed to train in the cloud.'],
  ['Places in Projects', /character|angles of a place|projects/i, 'Projects → Cast and places → More angles', 'Draws a place from new camera angles so shots in one room match (a camera-angle LoRA for Qwen Image 2.1, which comes from Picture models).']
]
const areaOf = (i) => AREAS.find(([, re]) => re.test(i.for || ''))?.[0] || 'Other tools'
const areaInfo = (name) => AREAS.find(([n]) => n === name) || [name, null, null, null]

function ModelAction({ item, dl }) {
  if (item.status === 'ok') return item.size ? <span className="mono dim small">{GB(item.size)}</span> : <span />
  const s = dl[item.model]
  if (s && ACTIVE.includes(s.status)) {
    const pct = s.total ? Math.floor((s.received / s.total) * 100) : null
    return (
      <div className="dl">
        <div className="bar">
          <span style={{ width: `${pct ?? 6}%` }} className={pct == null ? 'indeterminate' : ''} />
        </div>
        <span className="mono dim">{s.status === 'queued' ? 'Queued' : s.status === 'verifying' ? 'Checking…' : `${pct}% of ${GB(s.total)}`}</span>
        <button className="link-btn mono" onClick={() => window.ivstudio.models.cancel(item.model)}>
          Pause
        </button>
      </div>
    )
  }
  return (
    <div className="dl">
      {s?.status === 'paused' && <span className="mono dim">Paused</span>}
      <button className="btn btn-small" onClick={() => window.ivstudio.models.download([item.model])}>
        {s?.status === 'paused' ? 'Resume' : 'Download'}
        {item.size ? ` · ${GB(item.size)}` : ''}
      </button>
    </div>
  )
}

// A ready-made character whose LoRA isn't in ComfyUI: the same download as the Characters page (characters:install)
function CharacterAction({ item, recheck, notify }) {
  const [pct, setPct] = useState(null)
  const id = item.download
  useEffect(() => window.ivstudio.characters.onProgress(({ id: cid, progress }) => cid === id && setPct(Math.round(progress * 100))), [id])
  if (!id || item.status === 'ok') return <span />
  async function get() {
    setPct(0)
    try {
      await window.ivstudio.characters.install(id)
      recheck()
    } catch (err) {
      notify(err.message)
    } finally {
      setPct(null)
    }
  }
  return (
    <div className="dl">
      <button className="btn btn-small" disabled={pct != null} onClick={get}>
        {pct != null ? `Downloading ${pct}%` : 'Download'}
      </button>
    </div>
  )
}

const STEP = { copying: 'Copying', downloading: 'Downloading', unpacking: 'Unpacking', requirements: 'Installing its requirements', done: 'Installed', skipped: 'Left alone', failed: 'Failed' }

// Installs every missing node pack into this PC's ComfyUI (nodepacks.js), a line per pack as it goes, then offers
// to restart ComfyUI so they load. The status card's button starts it too (the iv:installNodes event).
function NodeInstaller({ missing, recheck, notify }) {
  const [busy, setBusy] = useState(false)
  const [lines, setLines] = useState({})
  const [done, setDone] = useState(null)
  useEffect(() => window.ivstudio.setup.onNodes((u) => setLines((all) => ({ ...all, [u.dir]: u }))), [])
  async function install() {
    setBusy(true)
    setLines({})
    setDone(null)
    try {
      setDone(await window.ivstudio.setup.installNodes())
      recheck()
    } catch (err) {
      notify(err.message)
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    const go = () => !busy && install()
    window.addEventListener('iv:installNodes', go)
    return () => window.removeEventListener('iv:installNodes', go)
  }, [busy])
  const list = Object.values(lines)
  return (
    <div className="node-install">
      {((missing > 0 && !done?.restart) || busy) && (
        <div className="setup-inline">
          <button className="btn btn-small" disabled={busy} onClick={install}>
            {busy ? 'Installing…' : `Install ${missing} missing node pack${missing === 1 ? '' : 's'}`}
          </button>
          {!busy && <span className="dim small">At the versions IV Studio is tested with, with their requirements. Packs you already have are left alone.</span>}
        </div>
      )}
      {list.length > 0 && (
        <ul className="checks node-lines">
          {list.map((u) => (
            <li key={u.dir} className={u.step === 'failed' ? 'missing' : u.step === 'done' ? 'ok' : 'warn'}>
              <span className="check-icon">{u.step === 'failed' ? ICON.missing : u.step === 'done' ? ICON.ok : ICON.warn}</span>
              <div>
                <div>{u.label}</div>
                <div className="dim small">
                  {STEP[u.step] || u.step}
                  {u.detail ? ` · ${u.detail}` : ''}
                </div>
              </div>
              <span />
            </li>
          ))}
        </ul>
      )}
      {done?.restart && (
        <div className="setup-restart notice">
          <span>ComfyUI loads new node packs when it starts. Restart it now.</span>
          <RestartComfy className="btn btn-small btn-primary" notify={notify} recheck={() => (setDone(null), recheck())} label="Restart ComfyUI now" />
        </div>
      )}
    </div>
  )
}

function Row({ i, dl, remote, recheck, notify, licence }) {
  return (
    <li className={i.status}>
      <span className="check-icon">{ICON[i.status]}</span>
      <div className="setup-row-text">
        <div className="setup-row-name">{i.kind === 'model' ? i.name || i.label : i.label}</div>
        <div className="dim small setup-row-detail" title={i.detail}>
          {i.kind === 'model' && i.status !== 'ok' ? `Not on this computer yet${i.fix ? ` · goes in ${i.fix.replace(/^Download into /, '')}` : ''}` : i.detail}
          {i.status !== 'ok' && i.page && (
            <button className="link-btn mono small setup-row-link" onClick={() => window.ivstudio.links.open(i.page)}>
              Page and licence
            </button>
          )}
          {i.status !== 'ok' && licence && licence !== 'unknown' && <span className={`hf-licence ${licence}`}> · {licence === 'accepted' ? 'licence accepted' : 'needs its licence'}</span>}
        </div>
        {i.fix && i.status !== 'ok' && i.kind !== 'model' && <div className="small pink">{i.fix}</div>}
        {i.id === 'comfyui' && i.address && (
          <button
            className="btn btn-small"
            onClick={async () => {
              await window.ivstudio.settings.set({ comfyUrl: i.address })
              recheck()
            }}
          >
            Use {i.address}
          </button>
        )}
        {i.id === 'comfyui' && i.status !== 'ok' && !i.busy && !i.address && !remote && <GetComfy notify={notify} recheck={recheck} />}
        {i.status !== 'ok' && i.url && (
          <button className="link-btn mono small" onClick={() => window.ivstudio.links.open(i.url)}>
            Its GitHub page
          </button>
        )}
      </div>
      {i.kind === 'model' && !remote ? <ModelAction item={i} dl={dl} /> : i.kind === 'character' && i.download && !remote ? <CharacterAction item={i} recheck={recheck} notify={notify} /> : <span />}
    </li>
  )
}

function Section({ n, id, title, sub, pill, open, onToggle, children }) {
  return (
    <section className={`set-card setup-section ${open ? 'open' : ''}`} data-setup={id}>
      <button className="set-card-head setup-section-head" onClick={onToggle} aria-expanded={open}>
        <span className="set-card-n">{String(n).padStart(2, '0')}</span>
        <span className="set-card-title">
          <h2>{title}</h2>
          {sub && <span className="dim small">{sub}</span>}
        </span>
        <span className="set-card-aside">{pill}</span>
        <span className="setup-chevron" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open && <div className="set-card-body">{children}</div>}
    </section>
  )
}

export default function Setup({ setup, recheck, checking, remote, go, notify }) {
  const [dl, setDl] = useState({})
  const [view, setViewState] = useState(() => localStorage.getItem(VIEW_KEY) || 'attention')
  const [toggled, setToggled] = useState({})
  const [openAreas, setOpenAreas] = useState({}) // optional tool groups showing their files
  const items = setup?.items || []
  const setView = (v) => (setViewState(v), localStorage.setItem(VIEW_KEY, v))

  useEffect(() => {
    window.ivstudio.models.status().then(setDl)
    return window.ivstudio.models.onUpdate((u) => {
      setDl((all) => ({ ...all, [u.id]: u }))
      if (u.status === 'done') recheck()
    })
  }, [recheck])

  const [licences, setLicences] = useState({})
  const comfyItem = items.find((i) => i.id === 'comfyui')
  const gpuItem = items.find((i) => i.id === 'gpu')
  const comfyUp = comfyItem?.status === 'ok'
  const required = items.filter((i) => i.kind === 'model' && !i.optional)
  const optional = items.filter((i) => i.kind === 'model' && i.optional)
  const packs = items.filter((i) => i.kind === 'node_pack')
  const chars = items.filter((i) => i.kind === 'character')
  const missingModels = remote ? [] : required.filter((i) => i.status !== 'ok' && !ACTIVE.includes(dl[i.model]?.status))
  const missingBytes = missingModels.reduce((n, i) => n + (i.size || 0), 0)
  const missingPacks = remote ? [] : packs.filter((i) => i.status !== 'ok' && i.dir && !i.restartNeeded && !i.loadFailed)
  const waitingPacks = remote ? [] : packs.filter((i) => i.restartNeeded)
  const downloading = Object.values(dl).filter((s) => ACTIVE.includes(s.status)).length
  const errors = Object.entries(dl).filter(([, s]) => s.status === 'error')

  const sections = [
    { id: 'comfy', title: 'ComfyUI', sub: 'The engine IV Studio renders with.', list: [comfyItem, gpuItem].filter(Boolean) },
    { id: 'core', title: 'Models for shots', sub: 'MiniMax H3 and what every shot needs.', list: required },
    { id: 'packs', title: 'Node packs', sub: 'Extra ComfyUI nodes IV Studio’s tools use.', list: packs },
    { id: 'extras', title: 'Optional tools', sub: 'Only what you want to use. None of it is needed for shots.', list: optional, optional: true },
    { id: 'chars', title: 'Characters', sub: 'Each character’s LoRA or RefMod.', list: chars }
  ].filter((x) => x.list.length)
  const issues = (x) => x.list.filter((i) => (x.optional ? false : i.status !== 'ok'))
  const attention = sections.reduce((n, x) => n + issues(x).length, 0)
  const isOpen = (x) => (toggled[x.id] ?? (issues(x).length > 0 || x.id === 'comfy'))
  // one count everywhere: what needs you (outside the optional tools); blocking is the part that stops shots
  const blocking = items.filter((i) => i.status === 'missing' && !i.optional).length
  const verdict = !setup
    ? { tone: '', title: 'Checking this computer…', sub: '' }
    : !comfyUp
      ? { tone: 'warn', title: comfyItem?.busy ? 'ComfyUI is busy' : 'ComfyUI isn’t running', sub: comfyItem?.detail || '' }
      : blocking
        ? { tone: 'warn', title: `${attention} thing${attention === 1 ? '' : 's'} need${attention === 1 ? 's' : ''} you`, sub: `${blocking === attention ? 'They stop' : `${blocking} of them stop`} shots rendering. Use the buttons here, or open the cards below.` }
        : attention
          ? { tone: 'ok', title: 'Ready to make shots', sub: `${attention} thing${attention === 1 ? '' : 's'} only some tools need: see the cards below.` }
          : { tone: 'ok', title: 'Ready to make shots', sub: `${optional.filter((i) => i.status === 'ok').length} of ${optional.length} optional tools’ models downloaded.` }

  const groups = useMemo(() => {
    const m = new Map()
    for (const i of optional) {
      const a = areaOf(i)
      if (!m.has(a)) m.set(a, [])
      m.get(a).push(i)
    }
    // shown in this order (AREAS is in match order); anything unknown last
    const ORDER = ['Picture models', 'Picture tools', 'Video effects', 'Photo effects and transitions', 'Slow motion', 'Music and sounds', 'Replace', 'Places in Projects', 'Live preview']
    const rank = (n) => (ORDER.includes(n) ? ORDER.indexOf(n) : ORDER.length)
    return [...m.entries()].sort((a, b) => rank(a[0]) - rank(b[0]))
  }, [optional])

  const rows = (list) => (
    <ul className="checks setup-rows">
      {list.map((i) => (
        <Row key={i.id} i={i} dl={dl} remote={remote} recheck={recheck} notify={notify} licence={i.gated ? licences[i.gated] : undefined} />
      ))}
    </ul>
  )

  return (
    <div className="setup">
      <Stage effect="dial" art="settings" title="Settings" kicker="Infinite Variance" help="setup" />
      <SettingsTabs tab="setup" go={go} setup={setup} />

      <section className={`setup-summary ${verdict.tone}`}>
        <div className="setup-summary-text">
          <span className="mono small dim">This computer</span>
          <h2>{verdict.title}</h2>
          {verdict.sub && <p className="dim small">{verdict.sub}</p>}
          <div className="setup-chips">
            {comfyItem && <Pill tone={comfyUp ? 'ok' : 'warn'}>{comfyUp ? `ComfyUI ${(/Version ([^ ]+)/.exec(comfyItem.detail) || [])[1] || 'ready'}` : comfyItem.busy ? 'ComfyUI busy' : 'ComfyUI off'}</Pill>}
            {gpuItem && <Pill tone={gpuItem.status === 'ok' ? 'ok' : 'warn'}>{gpuItem.detail?.split(' · ')[0] || 'GPU'}</Pill>}
            {downloading > 0 && <Pill>{downloading} downloading</Pill>}
          </div>
        </div>
        <div className="setup-summary-actions">
          {missingModels.length > 0 && comfyUp && (
            <button className="btn btn-primary" onClick={() => window.ivstudio.models.download(missingModels.map((i) => i.model))}>
              Download {missingModels.length} model{missingModels.length === 1 ? '' : 's'}
              {missingBytes ? ` · ${GB(missingBytes)}` : ''}
            </button>
          )}
          {missingPacks.length > 0 && comfyUp && (
            <button className={missingModels.length ? 'btn' : 'btn btn-primary'} onClick={() => (setToggled((t) => ({ ...t, packs: true })), window.dispatchEvent(new Event('iv:installNodes')))}>
              Install {missingPacks.length} node pack{missingPacks.length === 1 ? '' : 's'}
            </button>
          )}
          {!remote && !comfyUp && !comfyItem?.busy && !comfyItem?.address && <StartComfy className="btn btn-primary" notify={notify} recheck={recheck} />}
          {!remote && (comfyUp || comfyItem?.busy) && (
            <RestartComfy
              className={waitingPacks.length && !missingModels.length && !missingPacks.length ? 'btn btn-primary' : 'btn'}
              notify={notify}
              recheck={recheck}
              label={waitingPacks.length ? `Restart ComfyUI to load ${waitingPacks.length} node pack${waitingPacks.length === 1 ? '' : 's'}` : 'Restart ComfyUI'}
            />
          )}
          <button className="btn" disabled={checking} onClick={recheck}>
            {checking ? 'Checking…' : 'Check again'}
          </button>
        </div>
      </section>

      {errors.map(([id, s]) => (
        <p key={id} className="notice">
          {items.find((i) => i.model === id)?.name || id}: {s.error}
        </p>
      ))}

      {/* what the cards below list: one bar above them that stays in view while scrolling (GitHub #21) */}
      <div className="setup-toolbar">
        <span className="mono small dim setup-toolbar-label">Show</span>
        <div className="setup-view segmented" role="tablist" aria-label="Show">
          <button role="tab" aria-selected={view === 'attention'} className={view === 'attention' ? 'on' : ''} onClick={() => setView('attention')}>
            Needs you · {attention}
          </button>
          <button role="tab" aria-selected={view === 'all'} className={view === 'all' ? 'on' : ''} onClick={() => setView('all')}>
            Everything · {items.length}
          </button>
        </div>
        <span className="dim small setup-toolbar-hint">{view === 'attention' ? 'Only what needs fixing. Optional tools always show, each with what it does.' : 'Every check, model and node pack, set up or not.'}</span>
      </div>

      {sections.map((x, k) => {
        const bad = issues(x)
        const okCount = x.list.filter((i) => i.status === 'ok').length
        const pill = x.optional ? <Pill>{`${okCount} of ${x.list.length} downloaded`}</Pill> : bad.length ? <Pill tone="warn">{`${bad.length} to fix`}</Pill> : <Pill tone="ok">{`All ${x.list.length} ready`}</Pill>
        const shown = view === 'all' ? x.list : bad
        if (view === 'attention' && !bad.length && x.id !== 'comfy' && x.id !== 'extras') return <Section key={x.id} n={k + 1} id={x.id} title={x.title} sub={x.sub} pill={pill} open={!!toggled[x.id]} onToggle={() => setToggled((t) => ({ ...t, [x.id]: !t[x.id] }))}>{rows(x.list)}</Section>
        return (
          <Section key={x.id} n={k + 1} id={x.id} title={x.title} sub={x.sub} pill={pill} open={isOpen(x)} onToggle={() => setToggled((t) => ({ ...t, [x.id]: !isOpen(x) }))}>
            {x.id === 'comfy' && (
              <>
                {rows(x.list)}
                {!remote && comfyUp && <ComfyUpdates notify={notify} recheck={recheck} />}
              </>
            )}
            {x.id === 'packs' && (
              <>
                {!remote && <NodeInstaller missing={missingPacks.length} recheck={recheck} notify={notify} />}
                {!remote && waitingPacks.length > 0 && (
                  <div className="setup-restart notice">
                    <span>
                      {waitingPacks.map((i) => i.label).join(', ')} {waitingPacks.length === 1 ? 'is' : 'are'} installed. ComfyUI loads new node packs when it starts.
                    </span>
                    <RestartComfy className="btn btn-small btn-primary" notify={notify} recheck={recheck} label="Restart ComfyUI now" />
                  </div>
                )}
                {shown.length ? rows(shown) : <p className="dim small">Every node pack is installed.</p>}
              </>
            )}
            {x.id === 'extras' && !remote && optional.some((i) => i.gated && i.status !== 'ok') && (
              <HfLogin notify={notify} onLicences={setLicences} pages={[...new Map(optional.filter((i) => i.gated && i.status !== 'ok').map((i) => [i.gated, { url: i.gated, label: i.name.replace(/ \(.*\)$/, '') }])).values()]} />
            )}
            {x.id === 'extras' &&
              groups.map(([area, list]) => {
                const want = list.filter((i) => i.status !== 'ok' && !ACTIVE.includes(dl[i.model]?.status))
                const bytes = want.reduce((n, i) => n + (i.size || 0), 0)
                const total = list.reduce((n, i) => n + (i.size || 0), 0)
                const [, , where, what] = areaInfo(area)
                const showFiles = openAreas[area] ?? view === 'all'
                return (
                  <div key={area} className="setup-area">
                    <div className="setup-area-head">
                      <h3>{area}</h3>
                      <span className="mono dim small">
                        {list.length - want.length} of {list.length}
                      </span>
                      {want.length > 0 && !remote && (
                        <button className="btn btn-small" onClick={() => window.ivstudio.models.download(want.map((i) => i.model))}>
                          Download {want.length === list.length ? 'all' : `the other ${want.length}`} · {GB(bytes)}
                        </button>
                      )}
                    </div>
                    {what && <p className="small setup-area-what">{what}</p>}
                    <div className="setup-area-meta">
                      {where && <span className="mono small dim">Where: {where}</span>}
                      <button className="link-btn mono small" aria-expanded={showFiles} onClick={() => setOpenAreas((o) => ({ ...o, [area]: !showFiles }))}>
                        {showFiles ? 'Hide the files ▾' : `What’s in it · ${list.length} file${list.length === 1 ? '' : 's'}${total ? `, ${GB(total)}` : ''} ▸`}
                      </button>
                    </div>
                    {showFiles && rows(list)}
                  </div>
                )
              })}
            {(x.id === 'core' || x.id === 'chars') && (shown.length ? rows(shown) : <p className="dim small">All ready.</p>)}
          </Section>
        )
      })}
    </div>
  )
}
