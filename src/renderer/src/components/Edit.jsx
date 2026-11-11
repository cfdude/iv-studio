import { useEffect, useState } from 'react'
import Stage from './Stage'
import QuickBar from './AudioQuick'
import TileDelete from './TileDelete'
import { fileUrl, timecode } from './edit/model'
import { groupBy, whenGroup } from './Library'
import Loading from './Loading'

export { default as EditEditor } from './edit/Editor'

export function EditList({ openEdit, notify }) {
  const [list, setList] = useState(null)
  const [q, setQ] = useState('')
  useEffect(() => {
    window.ivstudio.edits.list().then(setList)
  }, [])
  async function create() {
    try {
      openEdit((await window.ivstudio.edits.create('Untitled edit')).id)
    } catch (err) {
      notify(err.message)
    }
  }
  const shown = (list || []).filter((e) => !q.trim() || e.name.toLowerCase().includes(q.trim().toLowerCase()))
  const groups = groupBy(shown, (e) => whenGroup(e.updatedAt))
  return (
    <div className="edits shelf-page">
      <Stage effect="snip" art="edit" title="Edit" kicker="Infinite Variance">
        <QuickBar search label="Search edits" placeholder="Search your edits" value={q} onChange={setQ} results=".shelf-bar" found={shown.length} noun="edit" alt={{ label: '+ New edit', onClick: create }} />
      </Stage>
      <p className="lede">
        Cut your shots and sequences together.
        <span className="lede-small dim">A multi-track timeline with trims, fades, titles and sound, played live and exported as one MP4.</span>
      </p>
      <div className="shelf-bar">
        <span className="shelf-count mono">
          {list ? `${list.length} edit${list.length === 1 ? '' : 's'}` : ''}
        </span>
      </div>
      {list === null && <Loading label="Loading your edits" />}
      {list?.length === 0 && (
        <div className="shelf-blank">
          <p>No edits yet. Start one, then drop your shots, songs and lines onto its timeline.</p>
          <button className="btn btn-primary" onClick={create}>
            Start an edit
          </button>
        </div>
      )}
      {list?.length > 0 && shown.length === 0 && <p className="dim">No edits match.</p>}
      {groups.map(([label, items]) => (
        <section key={label} className="shelf-group">
          <h2 className="shelf-group-head mono">
            {label} <span className="dim">{items.length}</span>
          </h2>
          <div className="shelf-grid">
            {items.map((e) => (
              <div key={e.id} className="tile-wrap shelf-item">
                <button className="shelf-tile" onClick={() => openEdit(e.id)}>
                  <span className="shelf-media">
                    {e.cover ? e.cover.kind === 'picture' ? <img src={fileUrl(e.cover.path)} alt="" loading="lazy" /> : <video src={`${fileUrl(e.cover.path)}#t=${(e.cover.at || 0) + 0.3}`} muted preload="metadata" /> : <span className="shelf-empty mono">Empty timeline</span>}
                    <span className="shelf-status mono edit-len">{timecode(e.seconds)}</span>
                    {e.format && <span className="shelf-format mono">{e.format}</span>}
                  </span>
                  <span className="shelf-body">
                    <span className="shelf-name">{e.name}</span>
                    <span className="shelf-meta mono">
                      <span>
                        {e.clips} clip{e.clips === 1 ? '' : 's'} · {e.exports} export{e.exports === 1 ? '' : 's'}
                      </span>
                      <span>{new Date(e.updatedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                    </span>
                  </span>
                </button>
                <TileDelete name={e.name} keeps="Its media files and exported videos stay on disk." notify={notify} onDelete={async () => (await window.ivstudio.edits.delete(e.id), setList(await window.ivstudio.edits.list()))} />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
