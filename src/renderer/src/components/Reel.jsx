import { useEffect, useState } from 'react'
import { fileUrl } from './edit/model'
import { AspectTiles } from './CreateKit'
import { Step, Choices, DropZone, Summary, SummaryDock, SummaryFrame, StageDrop, WorkflowNeeds } from './FlowKit'
import Stage from './Stage'

// Reel: pictures (and clips) plus a song, cut to the song's beat with slow camera moves, as an edit
// (src/service/reel.js). The edit opens in Edit, ready to fine-tune and export.
const PACES = [
  ['calm', 'Calm', 'About 3 s a picture.'],
  ['normal', 'Normal', 'About 2 s a picture.'],
  ['fast', 'Fast', 'About 1 s a picture.']
]
const FORMATS = { '16:9': '1080p', '9:16': 'vertical', '1:1': 'square' }
const IMAGE = /\.(png|jpe?g|webp|bmp)$/i
const VIDEO = /\.(mp4|mov|webm|mkv|m4v)$/i
const AUDIO = /\.(mp3|wav|flac|m4a|ogg|aac)$/i
const base = (p) => String(p).split(/[\\/]/).pop()

export default function Reel({ notify, openEdit, go }) {
  const [items, setItems] = useState([])
  const [songs, setSongs] = useState([])
  const [song, setSong] = useState(null) // { file, name }
  const [pace, setPace] = useState('normal')
  const [aspect, setAspect] = useState('16:9')
  const [name, setName] = useState('')
  const [making, setMaking] = useState(false)
  useEffect(() => {
    window.ivstudio.music
      .list()
      .then((l) => setSongs((l || []).filter((s) => s.status === 'success' && s.file)))
      .catch(() => {})
  }, [])
  const pick = async (kind) => {
    const files = await window.ivstudio.files.pick(kind)
    return (Array.isArray(files) ? files : files ? [files] : []).map((f) => f.path || f)
  }
  const addItems = async (kind) => setItems([...items, ...(await pick(kind))])
  // dropped files: pictures and clips join the reel; a sound file becomes the song
  const dropped = (paths) => {
    setItems((list) => [...list, ...paths.filter((p) => IMAGE.test(p) || VIDEO.test(p))])
    const s = paths.find((p) => AUDIO.test(p))
    if (s) setSong({ file: s, name: base(s) })
  }
  const move = (i, d) => {
    const next = [...items]
    ;[next[i], next[i + d]] = [next[i + d], next[i]]
    setItems(next)
  }
  async function make() {
    setMaking(true)
    try {
      const r = await window.ivstudio.reels.make({ name: name.trim() || 'Reel', items, song: song.file, pace, format: FORMATS[aspect] })
      notify(`${r.used} pictures cut to ${r.bpm ? `${r.bpm} BPM` : 'an even pace'} in ${r.seconds.toFixed(1)} s${r.left ? `; ${r.left} didn't fit the song` : ''}. Export it from Edit.`, 'info')
      openEdit(r.editId)
    } catch (err) {
      notify(err.message)
    } finally {
      setMaking(false)
    }
  }
  const own = song && !songs.some((s) => s.file === song.file)
  const action = {
    label: making ? 'Finding the beat…' : items.length && song ? `Make the reel` : !items.length ? 'Add pictures first' : 'Pick a song',
    disabled: !items.length || !song || making,
    onClick: make
  }
  const facts = [
    ['Pictures', items.length ? `${items.length} in order` : 'none yet'],
    ['Song', song ? song.name : 'none yet'],
    ['Pace', PACES.find(([id]) => id === pace)[1]],
    ['Shape', aspect]
  ]

  return (
    <div className="reel-page create-v2 flow-page">
      <Stage effect="beat" art="music" title="Reel" kicker="Pictures and a song, cut to the beat" help="reel" back={{ label: 'Workflows', onClick: () => go('workflows') }}>
        <StageDrop onFiles={dropped}>
          <span className="stage-drop-text">{items.length || song ? `${items.length} picture${items.length === 1 ? '' : 's'}${song ? ` · ♪ ${song.name}` : ''}` : 'Drop pictures and a song here'}</span>
          <button className="btn btn-small" onClick={() => addItems('picture')}>
            + Pictures
          </button>
          <button
            className="btn btn-small"
            onClick={async () => {
              const [f] = await pick('audio')
              if (f) setSong({ file: f, name: base(f) })
            }}
          >
            + A song
          </button>
        </StageDrop>
        <p className="stage-note small">It lands in Edit as an ordinary edit: trim, reorder, add titles and export it there.</p>
        <WorkflowNeeds page="reel" />
      </Stage>

      <div className="create-layout">
        <div className="create-steps">
          <Step n={1} title="The pictures" sub="In the order they should play. Clips work too.">
            <DropZone onFiles={dropped} filled={items.length > 0} empty="Drop pictures or clips here">
              {items.length > 0 && (
                <div className="reel-items">
                  {items.map((f, i) => (
                    <figure key={`${f}${i}`} className="reel-item">
                      {IMAGE.test(f) ? <img src={fileUrl(f)} alt="" /> : <video src={`${fileUrl(f)}#t=0.3`} muted preload="metadata" />}
                      <span className="reel-n mono">{i + 1}</span>
                      <figcaption className="mono small">
                        <button className="link-btn" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Earlier">
                          ‹
                        </button>
                        <button className="link-btn" disabled={i === items.length - 1} onClick={() => move(i, 1)} aria-label="Later">
                          ›
                        </button>
                        <button className="link-btn" onClick={() => setItems(items.filter((_, j) => j !== i))} aria-label="Remove">
                          ×
                        </button>
                      </figcaption>
                    </figure>
                  ))}
                </div>
              )}
              <div className="media-actions">
                <button className="btn btn-small" onClick={() => addItems('picture')}>
                  + Pictures
                </button>
                <button className="btn btn-small" onClick={() => addItems('video')}>
                  + A clip
                </button>
                {items.length > 0 && (
                  <button className="link-btn mono small" onClick={() => setItems([])}>
                    Clear
                  </button>
                )}
              </div>
            </DropZone>
          </Step>

          <Step n={2} title="The song" sub="Reel finds its beat by itself. Songs you make on Audio → Music show here.">
            <Choices
              className="reel-songs"
              label="Song"
              value={song?.file}
              onChange={(file) => {
                const s = songs.find((x) => x.file === file)
                if (s) setSong({ file: s.file, name: s.name })
              }}
              options={songs.map((s) => [s.file, s.name, null, `${Math.round(s.duration || s.seconds || 0)} s`])}
            />
            <div className="media-actions flow-left">
              <button
                className="btn btn-small"
                onClick={async () => {
                  const [f] = await pick('audio')
                  if (f) setSong({ file: f, name: base(f) })
                }}
              >
                {own ? `♪ ${song.name}` : '+ A sound file from this computer'}
              </button>
            </div>
          </Step>

          <Step n={3} title="Pace and shape" sub="Each picture holds a whole number of beats near the pace, and the cuts keep to the song’s bars.">
            <Choices label="Pace" options={PACES} value={pace} onChange={setPace} className="flow-three" />
            <AspectTiles aspects={Object.keys(FORMATS)} value={aspect} onChange={setAspect} />
            <label className="create-field">
              <span className="create-label mono">Name</span>
              <input value={name} placeholder="Reel" onChange={(e) => setName(e.target.value)} />
            </label>
            <p className="small dim">A song without a clear beat is cut evenly. The reel ends with the pictures or the song, whichever comes first.</p>
          </Step>
        </div>

        <Summary label="Your reel" kind={PACES.find(([id]) => id === pace)[1]} frame={<SummaryFrame aspect={aspect} src={items[0] && fileUrl(items[0])} video={items[0] && !IMAGE.test(items[0])} tag={items.length ? `${items.length} picture${items.length === 1 ? '' : 's'}` : null} />} facts={facts} action={action} />
      </div>
      <SummaryDock facts={facts} action={action} />
    </div>
  )
}
