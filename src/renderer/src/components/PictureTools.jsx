import { useEffect, useRef, useState } from 'react'
import { fileUrl } from './edit/model'
import { DropIcon, StepHead } from './CreateKit'

// Create -> Image -> Tools: one-step fixes for a picture (picturetools.js): inpaint, relight, remove background,
// upscale and depth map. Results land in the picture gallery below, like any set.
const I = () => window.ivstudio.images
const GB = (b) => `${(b / 1024 ** 3).toFixed(1)} GB`
const ACTIVE_DL = ['queued', 'downloading', 'verifying']
const ICON = {
  inpaint: 'M6 26l4-1 14-14-3-3L7 22zM19 10l3 3M5 6h9M5 10h5',
  relight: 'M16 4v3M16 25v3M6.5 6.5l2 2M23.5 23.5l2 2M4 16h3M25 16h3M6.5 25.5l2-2M23.5 8.5l2-2M16 11a5 5 0 100 10 5 5 0 000-10z',
  removebg: 'M5 5h22v22H5zM5 5l22 22M16 9a4 4 0 110 8 4 4 0 010-8zM9 27c0-4 3-7 7-7s7 3 7 7',
  upscale: 'M5 27V17h10v10zM12 5h15v15M19 13l8-8M21 5h6v6',
  depth: 'M4 24l12-6 12 6-12 6zM4 17l12-6 12 6M4 10l12-6 12 6'
}
const blank = { tool: 'removebg', picture: null, prompt: '', light: null, direction: '', quality: '', brightness: '', color: '', details: '', scale: 2, output: 'depth_colored', seed: '' }

// A brush over the picture: white strokes are the part to change (saved as a black-and-white mask).
function MaskPainter({ picture, onMask }) {
  const img = useRef(null)
  const canvas = useRef(null)
  const [size, setSize] = useState(36)
  const [painted, setPainted] = useState(false)
  const drawing = useRef(false)
  function fit() {
    const c = canvas.current
    const i = img.current
    if (!c || !i?.naturalWidth) return
    c.width = i.naturalWidth
    c.height = i.naturalHeight
    clear()
  }
  function clear() {
    const c = canvas.current
    if (!c) return
    c.getContext('2d').clearRect(0, 0, c.width, c.height)
    setPainted(false)
    onMask(null)
  }
  function at(e) {
    const c = canvas.current
    const r = c.getBoundingClientRect()
    return [((e.clientX - r.left) / r.width) * c.width, ((e.clientY - r.top) / r.height) * c.height, c.width / r.width]
  }
  function paint(e) {
    if (!drawing.current) return
    const [x, y, k] = at(e)
    const g = canvas.current.getContext('2d')
    g.fillStyle = 'rgba(244, 72, 89, 0.55)'
    g.beginPath()
    g.arc(x, y, (size / 2) * k, 0, Math.PI * 2)
    g.fill()
    setPainted(true)
  }
  // the mask itself: white where painted, black elsewhere, at the picture's size
  function done() {
    const c = canvas.current
    const out = document.createElement('canvas')
    out.width = c.width
    out.height = c.height
    const g = out.getContext('2d')
    g.fillStyle = '#000'
    g.fillRect(0, 0, out.width, out.height)
    const src = c.getContext('2d').getImageData(0, 0, c.width, c.height)
    const dst = g.getImageData(0, 0, out.width, out.height)
    for (let p = 0; p < src.data.length; p += 4) if (src.data[p + 3] > 0) dst.data[p] = dst.data[p + 1] = dst.data[p + 2] = 255
    g.putImageData(dst, 0, 0)
    onMask(out.toDataURL('image/png'))
  }
  return (
    <div className="mask-painter">
      <div className="mask-stage">
        <img ref={img} src={fileUrl(picture)} alt="" onLoad={fit} draggable={false} />
        <canvas
          ref={canvas}
          onPointerDown={(e) => (e.currentTarget.setPointerCapture(e.pointerId), (drawing.current = true), paint(e))}
          onPointerMove={paint}
          onPointerUp={() => ((drawing.current = false), painted && done())}
          onPointerCancel={() => (drawing.current = false)}
          aria-label="Paint over the part to change"
        />
      </div>
      <div className="mask-tools">
        <label className="mono small">
          Brush
          <input type="range" min={8} max={120} value={size} onChange={(e) => setSize(Number(e.target.value))} aria-label="Brush size" />
        </label>
        <button className="link-btn small" disabled={!painted} onClick={clear}>
          Clear
        </button>
        <span className="dim small">{painted ? 'Painted. Paint more, or say what it becomes below.' : 'Paint over the part to change.'}</span>
      </div>
    </div>
  )
}

export default function PictureTools({ modeStep, notify, onQueued, incoming, clearIncoming }) {
  const [st, setSt] = useState(null)
  const [form, setForm] = useState(blank)
  const [mask, setMask] = useState(null) // a PNG data URL
  const [busy, setBusy] = useState(false)
  const [dl, setDl] = useState({})
  const [shape, setShape] = useState([1, 1]) // the picture's own width and height, for the summary frame
  const set = (p) => setForm((f) => ({ ...f, ...p }))
  const check = () => I().toolsStatus().then(setSt, (err) => setSt({ error: err.message, tools: [] }))
  useEffect(() => {
    check()
    window.ivstudio.models.status().then(setDl)
    return window.ivstudio.models.onUpdate((u) => setDl((all) => ({ ...all, [u.id]: u })))
  }, [])
  // a picture handed over from the gallery's "Fix this"
  useEffect(() => {
    if (incoming) {
      set({ picture: incoming })
      setMask(null)
      clearIncoming?.()
    }
  }, [incoming])
  useEffect(() => {
    if (st?.relight && !form.light) set({ light: st.relight.light[0][0] })
  }, [st])
  const tool = st?.tools?.find((t) => t.id === form.tool)
  const missingBytes = (tool?.missing || []).reduce((n, m) => n + (m.size || 0), 0)
  const downloading = (tool?.missing || []).some((m) => ACTIVE_DL.includes(dl[m.id]?.status))
  useEffect(() => {
    if (tool?.missing?.length && tool.missing.every((m) => dl[m.id]?.status === 'done')) check()
  }, [dl])
  function drop(e) {
    e.preventDefault()
    const f = [...(e.dataTransfer?.files || [])].map((x) => window.ivstudio.media.pathFor(x)).find((p) => /\.(png|jpe?g|webp|bmp)$/i.test(p || ''))
    if (f) (set({ picture: f }), setMask(null))
  }
  async function run() {
    setBusy(true)
    try {
      const maskFile = form.tool === 'inpaint' && mask ? await I().saveMask(mask) : null
      const { picture, ...rest } = form
      const rec = await I().tool({ ...rest, image: picture, mask: maskFile, seed: form.seed === '' ? null : Number(form.seed), scale: Number(form.scale) })
      onQueued(rec)
      notify(`${tool.label} started: it lands in Your pictures below.`, 'info')
    } catch (err) {
      notify(err.message)
    } finally {
      setBusy(false)
    }
  }
  const R = st?.relight
  const ready = !!tool?.ready && !!form.picture && (form.tool !== 'inpaint' || (mask && form.prompt.trim()))
  const label = busy ? 'Starting…' : tool ? tool.label : 'Run'
  const pick = (k, list) => (
    <div className="segmented wrap">
      {list.map(([v, l]) => (
        <button key={l} className={form[k] === v ? 'on' : ''} onClick={() => set({ [k]: v })}>
          {l}
        </button>
      ))}
    </div>
  )
  return (
    <div className="create-layout">
      <div className="create-steps">
        {modeStep}
        <section className="create-step picture-tools">
          <StepHead n={2} title="The tool" sub="One step, one picture. The result joins Your pictures below." />
          <div className="mode-cards tool-cards" role="radiogroup" aria-label="Tool">
            {(st?.tools || []).map((t) => (
              <button key={t.id} role="radio" aria-checked={form.tool === t.id} className={`mode-card ${form.tool === t.id ? 'on' : ''}`} onClick={() => set({ tool: t.id })} title={t.ready ? t.short : t.note || `Needs ${t.missing.map((m) => m.label).join(', ')}`}>
                <svg className="mode-icon" viewBox="0 0 32 32" width="30" height="30" aria-hidden="true">
                  <path d={ICON[t.id]} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="mode-name">{t.label}</span>
                <span className="dim small">{t.ready ? t.short : 'Not set up'}</span>
              </button>
            ))}
            {!st && <span className="dim small">Checking ComfyUI…</span>}
          </div>
          {tool && !tool.ready && (
            <div className="music-needed">
              {tool.missing?.length ? (
                <>
                  <p className="small">
                    {tool.label} needs {tool.missing.map((m) => m.label).join(', ')} ({GB(missingBytes)}), checked against the SHA-256 Hugging Face publishes.
                  </p>
                  <button className="btn btn-primary" disabled={downloading} onClick={() => window.ivstudio.models.download(tool.missing.map((m) => m.id))}>
                    {downloading ? 'Downloading…' : `Download · ${GB(missingBytes)}`}
                  </button>
                </>
              ) : (
                <p className="small">{tool.note}</p>
              )}
            </div>
          )}
        </section>

        <section className="create-step">
          <StepHead n={3} title="The picture" sub={form.tool === 'inpaint' ? 'Then paint over the part to change.' : 'Any picture: one of yours below, or a file.'} />
          {form.picture && form.tool === 'inpaint' ? (
            <MaskPainter key={form.picture} picture={form.picture} onMask={setMask} />
          ) : (
            <div className="image-refs create-drop" onDragOver={(e) => e.preventDefault()} onDrop={drop}>
              {form.picture && (
                <div className="image-ref">
                  <img src={fileUrl(form.picture)} alt="" />
                  <span className="mono small">The picture</span>
                  <button className="lora-chip-x" title="Take it out" onClick={() => set({ picture: null })}>
                    ×
                  </button>
                </div>
              )}
              {!form.picture && (
                <button className="image-ref add" onClick={async () => { const [f] = (await window.ivstudio.files.pick('picture')) || []; f && set({ picture: f }) }}>
                  <DropIcon />
                  <span>+ Picture</span>
                  <span className="small dim">or drop one here</span>
                </button>
              )}
            </div>
          )}
          {form.picture && form.tool === 'inpaint' && (
            <div className="media-actions flow-left">
              <button className="btn btn-small" onClick={() => (set({ picture: null }), setMask(null))}>
                Another picture
              </button>
            </div>
          )}
        </section>

        {form.tool === 'inpaint' && (
          <section className="create-step">
            <StepHead n={4} title="What it becomes" sub="Say what the painted part should be. The rest stays as it is." />
            <textarea className="prompt image-prompt" value={form.prompt} placeholder="A red leather jacket." onChange={(e) => set({ prompt: e.target.value })} aria-label="What the painted part becomes" />
          </section>
        )}
        {form.tool === 'relight' && R && (
          <section className="create-step">
            <StepHead n={4} title="The light" sub="Pick a light, then fine-tune where it comes from and how it feels." />
            <div className="create-field">
              <span className="create-label mono">Light</span>
              {pick('light', R.light)}
            </div>
            <div className="create-field">
              <span className="create-label mono">From</span>
              {pick('direction', R.direction)}
            </div>
            <div className="create-field">
              <span className="create-label mono">Shadows</span>
              {pick('quality', R.quality)}
            </div>
            <div className="create-field">
              <span className="create-label mono">Brightness</span>
              {pick('brightness', R.brightness)}
            </div>
            <div className="create-field">
              <span className="create-label mono">Colour</span>
              {pick('color', R.color)}
            </div>
            <div className="create-field">
              <span className="create-label mono">Anything else</span>
              <input value={form.details} placeholder="Keep the window reflections." onChange={(e) => set({ details: e.target.value })} />
            </div>
          </section>
        )}
        {form.tool === 'upscale' && (
          <section className="create-step">
            <StepHead n={4} title="How big" sub="SeedVR2 restores detail as it enlarges. 4× of a big picture takes a while." />
            {pick('scale', [[2, '2×'], [4, '4×']])}
          </section>
        )}
        {form.tool === 'depth' && st?.depthOutputs && (
          <section className="create-step">
            <StepHead n={4} title="What map" sub="Depth for compositing and grading, normals for 3D and relighting." />
            {pick('output', st.depthOutputs)}
          </section>
        )}
      </div>

      <aside className="shot-card" aria-label="Your picture">
        <div className="shot-card-head mono">
          <span>Your picture</span>
          <span className="dim">{tool?.label || 'Tools'}</span>
        </div>
        <div className="shot-frame-wrap">
          <div className="shot-frame" style={{ aspectRatio: `${shape[0]} / ${shape[1]}`, '--ar': shape[0] / shape[1] }}>
            {form.picture ? <img src={fileUrl(form.picture)} alt="" onLoad={(e) => setShape([e.target.naturalWidth, e.target.naturalHeight])} /> : <span className="shot-frame-empty mono">no picture yet</span>}
          </div>
        </div>
        <dl className="shot-facts">
          <div>
            <dt>Tool</dt>
            <dd>{tool ? `${tool.label}${tool.ready ? '' : ' · not set up'}` : 'Checking…'}</dd>
          </div>
          {form.tool === 'inpaint' && (
            <div>
              <dt>Mask</dt>
              <dd>{mask ? 'painted' : <span className="pink">not painted yet</span>}</dd>
            </div>
          )}
        </dl>
        <button className="btn btn-primary shot-card-go" disabled={busy || !ready} onClick={run}>
          {label}
        </button>
      </aside>

      <section className="go-dock create-dock">
        <div className="go-info">
          <span className="mono">{tool ? `${tool.label} · ${form.picture ? form.picture.split(/[\\/]/).pop() : 'no picture yet'}` : 'Checking ComfyUI…'}</span>
        </div>
        <button className="btn btn-primary" disabled={busy || !ready} onClick={run}>
          {label}
        </button>
      </section>
    </div>
  )
}
