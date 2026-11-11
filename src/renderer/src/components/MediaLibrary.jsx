import { useEffect, useMemo, useRef, useState } from 'react'
import { useSelection } from '../selection'
import { media } from '../media'
import Stage from './Stage'
import QuickBar from './AudioQuick'
import { fileUrl } from './edit/model'
import Loading from './Loading'
import { dayGroup, groupBy, WHEN, inWhen, Chips, Near, useMore, Groups, FilterPanel } from './ShelfKit'
import { askAgent, useAgentName } from './ChatPanel'

// Everything made in IV Studio in one place: shot, sequence and Replace renders, Edit exports, pictures
// (Create -> Image), songs and voice lines. The takes of one shot (its previews and finals), of one sequence or of one edit are a single
// tile; clicking it opens a viewer that plays them big and steps through every version.
const FILTERS = [
  ['all', 'All'],
  ['video', 'Videos'],
  ['image', 'Images'],
  ['music', 'Music'],
  ['voice', 'Voice lines']
]
const src = (file) => (file.path ? fileUrl(file.path) : media(file.url))
const secs = (d) => (d ? (d >= 60 ? `${Math.floor(d / 60)}:${String(Math.round(d % 60)).padStart(2, '0')}` : `${Math.round(d)}s`) : null)
const day = (at) => (at ? new Date(at).toLocaleDateString() : '')

// Items grouped into sets (a shot, a sequence, an edit), best version first, newest set first.
export function toSets(items) {
  const map = new Map()
  for (const i of items) {
    const k = i.set || i.key
    if (!map.has(k)) map.set(k, { key: k, name: i.setName || i.label, group: i.group, type: i.type, items: [] })
    map.get(k).items.push(i)
  }
  const sets = [...map.values()]
  for (const s of sets) {
    s.items.sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0) || String(b.at).localeCompare(String(a.at)))
    s.at = s.items.reduce((m, i) => (String(i.at) > m ? String(i.at) : m), '')
    s.cover = s.items[0]
  }
  return sets.sort((a, b) => b.at.localeCompare(a.at))
}

// Pictures and videos sit in a frame of their own shape, as big as the stage allows (see .viewer-frame).
function Player({ item }) {
  const [ar, setAr] = useState(null)
  useEffect(() => setAr(null), [item.key])
  const frame = (child) => (
    <div className="viewer-frame" style={{ '--ar': ar || 16 / 9, visibility: ar ? 'visible' : 'hidden' }}>
      {child}
    </div>
  )
  if (item.type === 'video') return frame(<video key={item.key} className="viewer-media" src={src(item.file)} controls autoPlay playsInline onLoadedMetadata={(e) => setAr(e.target.videoWidth / e.target.videoHeight || 16 / 9)} />)
  if (item.type === 'image') return frame(<img key={item.key} className="viewer-media" src={src(item.file)} alt={item.label} onLoad={(e) => setAr(e.target.naturalWidth / e.target.naturalHeight || 1)} />)
  return (
    <div className="viewer-sound">
      <div className="viewer-sound-art mono">{item.type === 'music' ? '♪' : '“ ”'}</div>
      {item.type === 'voice' && <p className="viewer-words">{item.label}</p>}
      <audio key={item.key} src={src(item.file)} controls autoPlay />
    </div>
  )
}

// The pop-up: one version big, every version of the set underneath, and the next or previous set a click
// (or an arrow key) away.
export function Viewer({ sets, at, setAt, onClose, edits, notify, sendToCreate, pictureToShot, openEdit, openShot, openSequence }) {
  const [si, ii] = at
  const set = sets[si]
  const item = set?.items[ii]
  const [target, setTarget] = useState('')
  // for the chat: what's open in the viewer (selection.js)
  useSelection('viewer', item ? { open: `${set?.setName || item.label}${item.variant ? `, ${item.variant}` : ''} in the Library viewer`, kind: item.type, ...(item.file?.path ? { file: item.file.path } : {}) } : null, [item?.key])
  // the person's own Claude Code or Codex (ChatPanel.jsx): the chat opens with this item attached
  const agent = useAgentName()
  // every version of every set, in order, for the arrow keys
  const flat = useMemo(() => sets.flatMap((s, a) => s.items.map((_, b) => [a, b])), [sets])
  const pos = flat.findIndex(([a, b]) => a === si && b === ii)
  const step = (d) => {
    const next = flat[pos + d]
    if (next) setAt(next)
  }
  const stepSet = (d) => sets[si + d] && setAt([si + d, 0])
  useEffect(() => {
    const key = (e) => {
      if (e.target.tagName === 'SELECT') return
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') (e.preventDefault(), step(1))
      else if (e.key === 'ArrowLeft') (e.preventDefault(), step(-1))
      else if (e.key === 'ArrowDown') (e.preventDefault(), stepSet(1))
      else if (e.key === 'ArrowUp') (e.preventDefault(), stepSet(-1))
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })
  if (!item) return null
  async function toEdit() {
    try {
      openEdit((await window.ivstudio.library.toEdit(item, target || null)).id)
    } catch (err) {
      notify(err.message)
    }
  }
  const KIND_WORD = { video: 'video', image: 'picture', music: 'song', voice: 'voice line', sound: 'sound' }
  const askAbout = () => {
    const ids = [item.projectId && `shot id ${item.projectId}`, item.sequenceId && `sequence id ${item.sequenceId}`, item.jobId && `job ${item.jobId}`].filter(Boolean)
    onClose()
    askAgent({ about: `the ${KIND_WORD[item.type] || 'item'} “${set.name}”${item.variant ? ` (${item.variant})` : ''}: ${item.file.path}${ids.length ? `; ${ids.join(', ')}` : ''}` })
  }
  const sound = item.type !== 'video' && item.type !== 'image'
  const meta = [item.detail, secs(item.duration), new Date(item.at).toLocaleString()].filter(Boolean)
  // the one main thing to do next: pictures and sounds go into a shot; a render opens its shot or sequence
  const primary = item.type === 'image'
    ? { label: 'Use in a shot', run: () => (onClose(), pictureToShot(item.file.path)) }
    : sound
      ? { label: 'Use in a shot', run: () => sendToCreate({ kind: item.type === 'music' ? 'music' : 'line', file: item.file.path, text: item.type === 'voice' ? item.label : '', name: set.name }) }
      : item.projectId
        ? { label: 'Open shot', run: () => openShot(item.projectId) }
        : item.sequenceId
          ? { label: 'Open sequence', run: () => openSequence(item.sequenceId) }
          : null
  return (
    <div className="viewer-backdrop" onClick={onClose}>
      <div className="viewer" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={set.name}>
        <div className={`viewer-stage ${sound ? 'is-sound' : ''}`}>
          <Player item={item} />
          <button className="viewer-nav prev" disabled={pos <= 0} onClick={() => step(-1)} aria-label="Previous">
            ‹
          </button>
          <button className="viewer-nav next" disabled={pos >= flat.length - 1} onClick={() => step(1)} aria-label="Next">
            ›
          </button>
        </div>
        <aside className="viewer-side">
          <div className="viewer-head">
            <span className="mono small dim">
              {set.group} · {pos + 1} of {flat.length}
            </span>
            <button className="viewer-close" onClick={onClose} aria-label="Close" title="Close (Esc)">
              ×
            </button>
          </div>
          <h2 className="viewer-name">{set.name}</h2>
          <div className="viewer-meta">
            <span className="viewer-variant">{item.variant || item.label}</span>
            {meta.length > 0 && <span className="mono small dim">{meta.join(' · ')}</span>}
          </div>
          <Details item={item} notify={notify} />
          {set.items.length > 1 && (
            <div className="viewer-versions">
              <span className="mono small dim">{set.items.length} versions</span>
              <div className="viewer-strip">
                {set.items.map((x, k) => (
                  <button key={x.key} className={`viewer-thumb ${k === ii ? 'on' : ''}`} onClick={() => setAt([si, k])} aria-current={k === ii ? 'true' : undefined}>
                    <span className="viewer-thumb-pic">
                      {x.type === 'video' ? <video src={`${src(x.file)}#t=0.3`} muted preload="metadata" /> : x.type === 'image' ? <img src={src(x.file)} alt="" loading="lazy" /> : <span className="viewer-thumb-sound">{x.type === 'music' ? '♪' : '“ ”'}</span>}
                    </span>
                    <span className="viewer-thumb-text">
                      <span className="viewer-thumb-label">{x.variant || x.label}</span>
                      {(x.detail || x.duration) && <span className="mono small dim">{[x.detail, secs(x.duration)].filter(Boolean).join(' · ')}</span>}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="viewer-actions">
            {primary && (
              <button className="btn btn-primary" onClick={primary.run}>
                {primary.label}
              </button>
            )}
            {item.projectId && primary?.label === 'Use in a shot' && (
              <button className="btn" onClick={() => openShot(item.projectId)}>
                Open shot
              </button>
            )}
            {item.sequenceId && primary?.label !== 'Open sequence' && (
              <button className="btn" onClick={() => openSequence(item.sequenceId)}>
                Open sequence
              </button>
            )}
            <div className="viewer-to-edit">
              <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Which edit">
                <option value="">A new edit</option>
                {edits.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
              <button className="btn" onClick={toEdit}>
                Add to edit
              </button>
            </div>
            {agent && (
              <button className="btn viewer-ask" onClick={askAbout} title={`Ask ${agent} about this in the chat`}>
                Ask {agent} about this
              </button>
            )}
            <button className="link-btn mono viewer-reveal" onClick={() => window.ivstudio.files.reveal(item.file).catch((err) => notify(err.message))}>
              Show file
            </button>
          </div>
          <span className="mono small dim viewer-keys">← → versions · ↑ ↓ next · Esc</span>
        </aside>
      </div>
    </div>
  )
}

// How a version was made: the render's facts (model, size, length, seed, finish, render time, cost...) and the
// prompt it came from, with Copy. Folded or open as last left (localStorage iv.viewerDetails).
function Details({ item, notify }) {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem('iv.viewerDetails') !== 'closed'
    } catch {
      return true
    }
  })
  const [full, setFull] = useState(false)
  useEffect(() => setFull(false), [item.key])
  const facts = item.facts || []
  if (!facts.length && !item.prompt && !item.about) return null
  const flip = () => {
    setOpen(!open)
    try {
      localStorage.setItem('iv.viewerDetails', open ? 'closed' : 'open')
    } catch {}
  }
  const copy = () => navigator.clipboard.writeText(item.prompt).then(() => notify?.('Prompt copied.', 'ok'), () => notify?.('Couldn’t copy the prompt.'))
  return (
    <div className="viewer-details">
      <button className="viewer-details-head mono small" onClick={flip} aria-expanded={open}>
        <span>{open ? '▾' : '▸'}</span> How it was made
      </button>
      {open && (
        <>
          {item.about && (
            <div className="viewer-about">
              <span className="mono small dim">What’s in it</span>
              <p className="small">{item.about.sentence}</p>
              <span className="viewer-tags">
                {item.about.tags.map((t) => (
                  <span key={t} className="chip small">
                    {t}
                  </span>
                ))}
              </span>
            </div>
          )}
          {facts.length > 0 && (
            <dl className="viewer-facts">
              {facts.map(([k, v]) => (
                <div key={k}>
                  <dt className="mono small dim">{k}</dt>
                  <dd className="words-exact">{v}</dd>
                </div>
              ))}
            </dl>
          )}
          {item.prompt && (
            <div className="viewer-prompt">
              <div className="viewer-prompt-head">
                <span className="mono small dim">Prompt</span>
                <button className="link-btn mono small" onClick={copy}>
                  Copy
                </button>
              </div>
              <p className={`words-exact ${full ? 'full' : ''}`}>{item.prompt}</p>
              {item.prompt.length > 220 && (
                <button className="link-btn mono small" onClick={() => setFull(!full)}>
                  {full ? 'Show less' : 'Show all'}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

export function Tile({ set, onOpen }) {
  const c = set.cover
  const ref = useRef(null)
  const count = set.items.length
  return (
    <button className={`lib-item lib-tile ${c.type !== 'video' && c.type !== 'image' ? 'lib-sound' : ''}`} onClick={onOpen} onMouseEnter={() => ref.current?.play?.().catch(() => {})} onMouseLeave={() => ref.current?.pause?.()}>
      {c.type === 'video' ? (
        <div className="tile-media">
          <Near className="shelf-near">
            <video ref={ref} src={`${src(c.file)}#t=0.3`} muted loop playsInline preload="metadata" />
          </Near>
          <span className="lib-play" aria-hidden="true">
            ▶
          </span>
        </div>
      ) : c.type === 'image' ? (
        <div className="tile-media">
          <img src={src(c.file)} alt="" loading="lazy" />
        </div>
      ) : (
        <div className="lib-wave mono">{c.type === 'music' ? '♪' : '“ ”'}</div>
      )}
      {count > 1 && <span className="lib-count mono">{count} {c.type === 'image' ? 'pictures' : 'versions'}</span>}
      {c.model && <span className={`lib-model mono ${c.model}`}>{c.model === 'seedance' ? 'Seedance' : 'H3'}</span>}
      <span className="tile-body">
        <span className="tile-name" title={set.name}>
          {set.name}
        </span>
        <span className="tile-info small">{c.tile || [c.detail, secs(c.duration)].filter(Boolean).join(' · ') || c.variant}</span>
        <span className="mono dim small tile-where">{[set.group, day(set.at)].filter(Boolean).join(' · ')}</span>
      </span>
    </button>
  )
}

const MODES = [
  ['text', 'Text'],
  ['reference', 'References'],
  ['frames', 'Frames'],
  ['continue', 'Continue']
]
const SORTS = [
  ['new', 'Newest'],
  ['old', 'Oldest'],
  ['name', 'Name'],
  ['versions', 'Most versions'],
  ['longest', 'Longest']
]

// How far the Library's search-by-content has got (describe.js): "142 of 300 described, more while nothing renders".
function DescribeStatus() {
  const [st, setSt] = useState(null)
  useEffect(() => {
    window.ivstudio.library.describeStatus().then(setSt, () => {})
    return window.ivstudio.library.onDescribe(setSt)
  }, [])
  if (!st?.total) return null
  if (!st.enabled) return <p className="small dim describe-status">Search by what’s in a file is off (Settings → Prompt writer).</p>
  return (
    <p className="small dim describe-status" title="Your prompt writer looks at each new video and picture while nothing renders, so search finds “red car” or “beach at night”. It stops as soon as a render starts.">
      {st.described === st.total ? `Search knows what’s in all ${st.total} videos and pictures.` : `Search knows what’s in ${st.described} of ${st.total} videos and pictures${st.running ? '; looking at one now' : '; more while nothing renders'}.`}
      {st.error && <span className="pink"> {st.error}</span>}
    </p>
  )
}

export default function MediaLibrary(ctx) {
  const characters = ctx.characters || []
  const [items, setItems] = useState(null)
  const [edits, setEdits] = useState([])
  const [open, setOpen] = useState(null) // [set index, version index]
  const [filter, setFilter] = useState(() => {
    try {
      return localStorage.getItem('iv.libraryFilter') || 'all'
    } catch {
      return 'all'
    }
  })
  const [q, setQ] = useState('')
  const [period, setPeriod] = useState('any')
  const [from, setFrom] = useState('all')
  const [mode, setMode] = useState('all')
  const [who, setWho] = useState('all')
  const [shape, setShape] = useState('all')
  const [model, setModel] = useState('all')
  const [sort, setSort] = useState('new')
  useEffect(() => {
    window.ivstudio.library.all().then(setItems, (err) => (ctx.notify(err.message), setItems([])))
    window.ivstudio.edits.list().then(setEdits, () => {})
  }, [])
  const pick = (f) => {
    setFilter(f)
    try {
      localStorage.setItem('iv.libraryFilter', f)
    } catch {}
  }
  const allSets = useMemo(() => toSets(items || []), [items])
  const now = Date.now()
  // who's in a shot: one of your characters, nobody, or a character that's since gone
  const whoOf = (set) => {
    const c = set.cover.character
    return !c ? null : c === 'none' || characters.some((x) => x.id === c) ? c : 'other'
  }
  const nameOf = (id) => (id === 'none' ? 'Nobody' : id === 'other' ? 'Someone else' : characters.find((c) => c.id === id)?.name?.split(' ')[0] || id)
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  // each filter's own test, so a row's counts show what the other filters leave
  const tests = {
    type: (x) => filter === 'all' || x.type === filter,
    period: (x) => inWhen(period, x.at, now),
    from: (x) => from === 'all' || x.group === from,
    mode: (x) => mode === 'all' || x.cover.mode === mode,
    who: (x) => who === 'all' || whoOf(x) === who,
    shape: (x) => shape === 'all' || x.cover.aspect === shape,
    model: (x) => model === 'all' || x.items.some((i) => i.model === model),
    // words in a name, a detail, the prompt a render was made from, or what's in it (describe.js)
    q: (x) => words.every((w) => `${x.name} ${x.group} ${x.items.map((i) => `${i.label} ${i.detail || ''} ${i.prompt || ''} ${i.about ? `${i.about.sentence} ${i.about.tags.join(' ')}` : ''}`).join(' ')}`.toLowerCase().includes(w))
  }
  const passing = (except) => allSets.filter((x) => Object.entries(tests).every(([k, t]) => k === except || t(x)))
  const count = (except, fn) => passing(except).filter(fn).length
  const key = `${q}|${filter}|${period}|${from}|${mode}|${who}|${shape}|${model}|${sort}`
  const sets = useMemo(() => {
    let list = passing()
    if (sort === 'old') list = [...list].reverse()
    if (sort === 'name') list = [...list].sort((x, y) => x.name.localeCompare(y.name))
    if (sort === 'versions') list = [...list].sort((x, y) => y.items.length - x.items.length)
    if (sort === 'longest') list = [...list].sort((x, y) => (y.cover.duration || 0) - (x.cover.duration || 0))
    return list.map((x, i) => ({ ...x, idx: i }))
  }, [allSets, key])
  const groups = sort === 'new' || sort === 'old' ? groupBy(sets, (x) => dayGroup(x.at, now)) : [[sort === 'name' ? 'A to Z' : sort === 'longest' ? 'Longest first' : 'Most versions first', sets]]
  const [limit, more] = useMore(sets.length, 36, key)
  const sources = [...new Set(allSets.map((x) => x.group))]
  const people = [...new Set(allSets.map(whoOf).filter(Boolean))]
  const shapes = [...new Set(allSets.map((x) => x.cover.aspect).filter(Boolean))]
  const models = [...new Set(allSets.flatMap((x) => x.items.map((i) => i.model)).filter(Boolean))]
  const clear = () => (setPeriod('any'), setFrom('all'), setMode('all'), setWho('all'), setShape('all'), setModel('all'))
  const active = [period !== 'any' && WHEN.find(([w]) => w === period)[1], from !== 'all' && from, mode !== 'all' && MODES.find(([m]) => m === mode)?.[1], who !== 'all' && nameOf(who), shape !== 'all' && shape, model !== 'all' && (model === 'seedance' ? 'Seedance' : 'H3')].filter(Boolean)

  return (
    <div className="media-library">
      <Stage effect="photos" art="library" title="Library" kicker="Everything you've made">
        <QuickBar search label="Search the Library" placeholder="Search everything: videos, pictures, songs, lines, even prompts" value={q} onChange={setQ} results=".shelf-tools" found={sets.length} />
      </Stage>
      <p className="lede">
        Every video, picture, song and line you’ve made.
        <span className="lede-small dim">Each tile holds all its versions. Open one to watch them and see how each was made.</span>
      </p>
      <DescribeStatus />
      <div className="shelf-tools">
        <div className="shelf-bar">
          <div className="segmented" role="tablist" aria-label="What">
            {FILTERS.map(([id, label]) => (
              <button key={id} role="tab" aria-selected={filter === id} className={filter === id ? 'on' : ''} onClick={() => pick(id)}>
                {label} <span className="dim">{items ? count('type', (x) => id === 'all' || x.type === id) : ''}</span>
              </button>
            ))}
          </div>
          <label className="shelf-sort mono">
            Sort
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              {SORTS.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {allSets.length > 0 && (
          <FilterPanel id="library" total={allSets.length} shown={sets.length} onClear={clear} active={active}>
            <Chips label="When" value={period} onChange={setPeriod} options={WHEN.map(([id, label]) => [id, label, id === 'any' ? undefined : count('period', (x) => inWhen(id, x.at, now))])} />
            {sources.length > 1 && <Chips label="From" value={from} onChange={setFrom} options={[['all', 'Anywhere'], ...sources.map((g) => [g, g, count('from', (x) => x.group === g)])]} />}
            {allSets.some((x) => x.cover.mode) && <Chips label="Kind" value={mode} onChange={setMode} options={[['all', 'Any'], ...MODES.map(([id, label]) => [id, label, count('mode', (x) => x.cover.mode === id)])]} />}
            {people.length > 1 && <Chips label="Who" value={who} onChange={setWho} options={[['all', 'Anyone'], ...people.map((id) => [id, nameOf(id), count('who', (x) => whoOf(x) === id)])]} />}
            {shapes.length > 1 && <Chips label="Shape" value={shape} onChange={setShape} options={[['all', 'Any'], ...shapes.map((x) => [x, x, count('shape', (y) => y.cover.aspect === x)])]} />}
            {models.length > 1 && <Chips label="Model" value={model} onChange={setModel} options={[['all', 'Any'], ...models.map((m) => [m, m === 'seedance' ? 'Seedance 2.5' : 'MiniMax H3', count('model', (y) => y.items.some((i) => i.model === m))])]} />}
          </FilterPanel>
        )}
      </div>
      {items === null && <Loading label="Loading your library" />}
      {items && sets.length === 0 && (
        <p className="dim">
          {items.length ? (
            <>
              Nothing matches.{' '}
              <button className="link-btn" onClick={() => (clear(), setQ(''), pick('all'))}>
                Show everything
              </button>
            </>
          ) : (
            'Nothing made yet. Make a shot on Create, or a song on Audio > Music.'
          )}
        </p>
      )}
      <Groups groups={groups} limit={limit} gridClass="lib-grid" render={(x) => <Tile key={x.key} set={x} onOpen={() => setOpen([x.idx, 0])} />} />
      {more}
      {open && sets[open[0]] && <Viewer sets={sets} at={open} setAt={setOpen} onClose={() => setOpen(null)} edits={edits} {...ctx} />}
    </div>
  )
}
