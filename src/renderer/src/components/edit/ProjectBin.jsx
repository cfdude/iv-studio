import { useMemo, useState } from 'react'
import { media as comfyMedia } from '../../media'
import { fileUrl, timecode } from './model'
import { Wave, usePeaks } from './thumbs'
import Loading from '../Loading'

const BINS = [
  ['all', 'All'],
  ['video', 'Video'],
  ['image', 'Pictures'],
  ['audio', 'Sound']
]
const words = (q) => q.toLowerCase().split(/\s+/).filter(Boolean)

function Thumb({ m }) {
  const wave = usePeaks(m.kind === 'audio' ? m : null)
  if (m.kind === 'video') return <video src={`${fileUrl(m.path)}#t=0.4`} muted preload="metadata" />
  if (m.kind === 'image') return <img src={fileUrl(m.path)} alt="" />
  return <div className="bin-wave">{wave ? <Wave wave={wave} from={0} to={m.duration || 1} width={150} height={48} /> : <span className="mono">♪</span>}</div>
}

// The project panel: this edit's media as thumbnails (click to load it in the source monitor, drag it onto
// a track), sorted into kind bins and searchable, plus everything in the IV Studio Library one click away.
export default function ProjectBin({ media, sourceId, onSource, onAdd, onTitle, notify }) {
  const [tab, setTab] = useState('project')
  const [bin, setBin] = useState('all')
  const [q, setQ] = useState('')
  const [lib, setLib] = useState(null)
  const [busy, setBusy] = useState(null)
  const all = Object.values(media)
  const list = all.filter((m) => (bin === 'all' || m.kind === bin) && words(q).every((w) => m.name.toLowerCase().includes(w)))
  const libList = useMemo(() => (lib || []).filter((i) => words(q).every((w) => `${i.label} ${i.group} ${i.setName || ''}`.toLowerCase().includes(w))), [lib, q])

  async function pick() {
    try {
      const added = await window.ivstudio.edits.pickFiles()
      added.forEach((m) => onAdd(m))
    } catch (err) {
      notify(err.message)
    }
  }
  async function openLibrary() {
    setTab('library')
    if (!lib) setLib(await window.ivstudio.edits.library().catch((err) => (notify(err.message), [])))
  }
  async function addOutput(item) {
    setBusy(item.key)
    try {
      const m = await window.ivstudio.edits.addOutput(item)
      onAdd(m, { place: false })
      onSource(m.id)
      notify(`${m.name} is in the bin and the source monitor.`)
    } catch (err) {
      notify(err.message)
    } finally {
      setBusy(null)
    }
  }
  const libSrc = (f) => (f.path ? fileUrl(f.path) : comfyMedia(f.url))

  return (
    <section className="ed-panel ed-bin">
      <header className="ed-panel-head">
        <div className="ed-tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'project'} className={tab === 'project' ? 'on' : ''} onClick={() => setTab('project')}>
            Project <span className="dim">{all.length}</span>
          </button>
          <button role="tab" aria-selected={tab === 'library'} className={tab === 'library' ? 'on' : ''} onClick={openLibrary}>
            Library
          </button>
        </div>
      </header>
      <div className="ed-bin-tools">
        <input className="ed-search" value={q} placeholder="Search" onChange={(e) => setQ(e.target.value)} />
        {tab === 'project' && (
          <>
            <button className="btn btn-small" onClick={pick} title="Add files from this computer">
              + Files
            </button>
            <button className="btn btn-small" onClick={onTitle} title="Add a title at the playhead">
              + Title
            </button>
          </>
        )}
      </div>
      {tab === 'project' && (
        <>
          <div className="ed-bins">
            {BINS.map(([id, label]) => (
              <button key={id} className={bin === id ? 'on' : ''} onClick={() => setBin(id)}>
                {label} <span className="dim">{id === 'all' ? all.length : all.filter((m) => m.kind === id).length}</span>
              </button>
            ))}
          </div>
          <div className="bin-grid">
            {all.length === 0 && <p className="small dim">Add files, or open the Library tab for your IV Studio renders, songs and lines.</p>}
            {all.length > 0 && list.length === 0 && <p className="small dim">Nothing matches.</p>}
            {list.map((m) => (
              <button
                key={m.id}
                className={`bin-tile ${m.kind} ${sourceId === m.id ? 'on' : ''}`}
                draggable
                onDragStart={(e) => e.dataTransfer.setData('application/x-iv-media', m.id)}
                onClick={() => onSource(m.id)}
                title={`${m.path}\nClick: open in the source monitor. Drag: onto a track.`}
              >
                <span className="bin-thumb">
                  <Thumb m={m} />
                  <span className="bin-dur mono">{m.kind === 'image' ? 'still' : timecode(m.duration || 0)}</span>
                </span>
                <span className="bin-name small">{m.name}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {tab === 'library' && (
        <div className="bin-grid">
          {lib === null && <Loading label="Loading" small />}
          {lib && libList.length === 0 && <p className="small dim">{lib.length ? 'Nothing matches.' : 'Nothing made yet.'}</p>}
          {libList.map((item) => (
            <button key={item.key} className={`bin-tile ${item.type === 'video' ? 'video' : 'audio'}`} disabled={!!busy} onClick={() => addOutput(item)} title={`${item.group} · ${item.label}\nClick to add it to this edit`}>
              <span className="bin-thumb">
                {item.type === 'video' ? <video src={`${libSrc(item.file)}#t=0.4`} muted preload="metadata" /> : <div className="bin-wave mono">{item.type === 'music' ? '♪' : '“ ”'}</div>}
                <span className="bin-dur mono">{busy === item.key ? 'Adding…' : item.duration ? timecode(item.duration) : item.group}</span>
              </span>
              <span className="bin-name small">{item.setName || item.label}</span>
              {item.variant && <span className="bin-sub mono dim">{item.variant}</span>}
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
