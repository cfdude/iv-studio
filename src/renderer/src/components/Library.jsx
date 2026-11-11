import { useMemo, useEffect, useRef, useState } from 'react'
import { media } from '../media'
import Stage from './Stage'
import QuickBar from './AudioQuick'
import TileDelete from './TileDelete'
import Loading from './Loading'
import { dayGroup, groupBy, WHEN, inWhen, Chips, Near, useMore, Groups, FilterPanel } from './ShelfKit'

// Shots: every shot, newest first, a group per day. Status, when, kind of shot, who's in it and its shape filter
// it; search and sort sit beside them. Tiles load their video only once they're near the screen, and more tiles
// arrive as you scroll, so a long history opens at once.

export { groupBy }
export const whenGroup = dayGroup

const when = (at) => new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
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
  ['runs', 'Most runs']
]
const isDone = (p) => p.finals > 0
const isOpen = (p) => p.running || (!p.finals && p.jobCount)

function ShotTile({ p, onOpen, onDelete }) {
  const ref = useRef(null)
  const status = p.running ? ['rendering', 'Rendering'] : p.finals > 0 ? ['done', p.finals === 1 ? 'Finished' : `${p.finals} finals`] : ['takes', p.jobCount ? 'Takes to pick' : 'Empty']
  return (
    <div className="tile-wrap shelf-item">
      <button className="shelf-tile" onClick={onOpen} onMouseEnter={() => ref.current?.play?.().catch(() => {})} onMouseLeave={() => ref.current && (ref.current.pause(), (ref.current.currentTime = 0.3))}>
        <span className="shelf-media">
          {p.cover ? (
            <Near className="shelf-near">
              <video ref={ref} src={`${media(p.cover)}#t=0.3`} muted loop playsInline preload="metadata" />
            </Near>
          ) : (
            <span className="shelf-empty mono">No take yet</span>
          )}
          <span className={`shelf-status mono ${status[0]}`}>
            {status[0] === 'rendering' && <span className="shelf-dot" />}
            {status[1]}
          </span>
          {p.aspect && <span className="shelf-format mono">{p.aspect}</span>}
          {p.cover && (
            <span className="shelf-play" aria-hidden="true">
              ▶
            </span>
          )}
        </span>
        <span className="shelf-body">
          <span className="shelf-name">{p.name}</span>
          <span className="shelf-meta mono">
            <span>{[MODES.find(([m]) => m === p.mode)?.[1], `${p.jobCount} run${p.jobCount === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}</span>
            <span>{when(p.updatedAt)}</span>
          </span>
        </span>
      </button>
      {onDelete}
    </div>
  )
}

export default function Library({ openShot, go, notify, characters = [] }) {
  const [projects, setProjects] = useState(null)
  const [q, setQ] = useState('')
  const [show, setShow] = useState('all')
  const [period, setPeriod] = useState('any')
  const [mode, setMode] = useState('all')
  const [who, setWho] = useState('all')
  const [shape, setShape] = useState('all')
  const [sort, setSort] = useState('new')

  useEffect(() => {
    window.ivstudio.projects.list().then(setProjects)
  }, [])

  const all = projects || []
  // who's in it: one of your characters, nobody, or a character that's since gone
  const whoOf = (p) => (p.character === 'none' || characters.some((c) => c.id === p.character) ? p.character : 'other')
  const now = Date.now()
  // each filter's own test, so a row's counts show what the other filters leave
  const tests = {
    show: (p) => show === 'all' || (show === 'done' ? isDone(p) : isOpen(p)),
    period: (p) => inWhen(period, p.updatedAt, now),
    mode: (p) => mode === 'all' || p.mode === mode,
    who: (p) => who === 'all' || whoOf(p) === who,
    shape: (p) => shape === 'all' || p.aspect === shape,
    q: (p) => !q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase())
  }
  const passing = (except) => all.filter((p) => Object.entries(tests).every(([k, t]) => k === except || t(p)))
  const count = (except, fn) => passing(except).filter(fn).length

  const key = `${q}|${show}|${period}|${mode}|${who}|${shape}|${sort}`
  const shown = useMemo(() => {
    const list = passing()
    if (sort === 'old') return [...list].reverse()
    if (sort === 'name') return [...list].sort((a, b) => a.name.localeCompare(b.name))
    if (sort === 'runs') return [...list].sort((a, b) => b.jobCount - a.jobCount)
    return list
  }, [projects, key])
  const groups = sort === 'name' ? [['A to Z', shown]] : sort === 'runs' ? [['Most runs first', shown]] : groupBy(shown, (p) => dayGroup(p.updatedAt, now))
  const [limit, more] = useMore(shown.length, 36, key)

  const people = [...new Set(all.map(whoOf))]
  const shapes = [...new Set(all.map((p) => p.aspect).filter(Boolean))]
  const nameOf = (id) => (id === 'none' ? 'Nobody' : id === 'other' ? 'Someone else' : characters.find((c) => c.id === id)?.name?.split(' ')[0] || id)
  const clear = () => (setPeriod('any'), setMode('all'), setWho('all'), setShape('all'))

  return (
    <div className="library shelf-page">
      <Stage effect="projector" art="shots" title="Shots" kicker="Infinite Variance">
        <QuickBar search label="Search shots" placeholder="Search your shots, even the words of a prompt" value={q} onChange={setQ} results=".shelf-tools" found={shown.length} noun="shot" alt={{ label: '+ New shot', onClick: () => go('create') }} />
      </Stage>
      <p className="lede">
        Every shot you've made.
        <span className="lede-small dim">Open one to watch its takes, pick the best, finish it at full size, or try again from the same settings.</span>
      </p>
      <div className="shelf-tools">
        <div className="shelf-bar">
          <div className="segmented" role="tablist" aria-label="Show">
            {[
              ['all', 'All', count('show', () => true)],
              ['done', 'Finished', count('show', isDone)],
              ['open', 'To pick or rendering', count('show', isOpen)]
            ].map(([id, label, n]) => (
              <button key={id} role="tab" aria-selected={show === id} className={show === id ? 'on' : ''} onClick={() => setShow(id)}>
                {label} <span className="dim">{n}</span>
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
        {all.length > 0 && (
          <FilterPanel
            id="shots"
            total={all.length}
            shown={shown.length}
            onClear={clear}
            active={[period !== 'any' && WHEN.find(([w]) => w === period)[1], mode !== 'all' && MODES.find(([m]) => m === mode)?.[1], who !== 'all' && nameOf(who), shape !== 'all' && shape].filter(Boolean)}
          >
            <Chips label="When" value={period} onChange={setPeriod} options={WHEN.map(([id, label]) => [id, label, id === 'any' ? undefined : count('period', (p) => inWhen(id, p.updatedAt, now))])} />
            <Chips label="Kind" value={mode} onChange={setMode} options={[['all', 'Any'], ...MODES.map(([id, label]) => [id, label, count('mode', (p) => p.mode === id)])]} />
            {people.length > 1 && <Chips label="Who" value={who} onChange={setWho} options={[['all', 'Anyone'], ...people.map((id) => [id, nameOf(id), count('who', (p) => whoOf(p) === id)])]} />}
            {shapes.length > 1 && <Chips label="Shape" value={shape} onChange={setShape} options={[['all', 'Any'], ...shapes.map((a) => [a, a, count('shape', (p) => p.aspect === a)])]} />}
          </FilterPanel>
        )}
      </div>
      {projects === null && <Loading label="Loading your shots" />}
      {projects?.length === 0 && (
        <div className="shelf-blank">
          <p>Nothing yet.</p>
          <button className="btn btn-primary" onClick={() => go('create')}>
            Make your first shot
          </button>
        </div>
      )}
      {projects?.length > 0 && shown.length === 0 && (
        <p className="dim">
          No shots match.{' '}
          <button className="link-btn" onClick={() => (clear(), setQ(''), setShow('all'))}>
            Show them all
          </button>
        </p>
      )}
      <Groups
        groups={groups}
        limit={limit}
        render={(p) => (
          <ShotTile
            key={p.id}
            p={p}
            onOpen={() => openShot(p.id)}
            onDelete={<TileDelete name={p.name} keeps="Its videos stay in ComfyUI's output folder." notify={notify} onDelete={async () => (await window.ivstudio.projects.delete(p.id), setProjects(await window.ivstudio.projects.list()))} />}
          />
        )}
      />
      {more}
    </div>
  )
}
