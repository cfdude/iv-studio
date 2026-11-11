import { useEffect, useMemo, useRef, useState } from 'react'
import Stage from './Stage'
import QuickBar from './AudioQuick'
import { fileUrl } from './edit/model'
import Loading from './Loading'

// LoRAs as pictures, for every model family IV Studio runs (civitai.js LORA_FAMILIES: MiniMax H3, LTX-2.5, Wan 2.1,
// Flux 3 Klein, Flux.2 Klein, Krea 2, Qwen Image 2.1, Z-Image, SDXL, Moss): Civitai's (Discover) and the ones on this
// PC (Yours), with clips that play on hover. LoraPicker is the same thing in a dialog, for Create's LoRA trays and
// for Characters; it opens on the family the tray is for.
const L = () => window.ivstudio.loras
const MB = (b) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : `${Math.round(b / 1024 ** 2)} MB`)
const K = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n))
export const loraTitle = (name) => String(name).split(/[\\/]/).pop().replace(/\.safetensors$/i, '').replace(/[_]+/g, ' ')
const folderOf = (name) => {
  const parts = String(name).split(/[\\/]/)
  return parts.length > 1 ? parts.slice(0, -1).join(' / ') : 'Top level'
}

// The family bar: video models, then picture models, each with how many of its LoRAs this PC has.
const FAMILY_KEY = 'iv.loraFamily'
export function savedFamily() {
  try {
    return localStorage.getItem(FAMILY_KEY) || 'h3'
  } catch {
    return 'h3'
  }
}
function FamilyBar({ families = [], value, onChange, counts = {} }) {
  const group = (kind, title) => (
    <div className="lora-fam-group">
      <span className="mono small dim lora-fam-kind">{title}</span>
      {families
        .filter((f) => f.kind === kind)
        .map((f) => (
          <button key={f.id} className={`lora-tag ${value === f.id ? 'on' : ''}`} title={f.uses} onClick={() => onChange(f.id)}>
            {f.label}
            {counts[f.id] ? <span className="lora-fam-n">{counts[f.id]}</span> : null}
          </button>
        ))}
    </div>
  )
  return (
    <div className="lora-families" role="group" aria-label="Model">
      {group('video', 'Video')}
      {group('image', 'Pictures')}
    </div>
  )
}
const famLabel = (meta, id) => meta?.families?.find((f) => f.id === id)?.label || 'H3'

// Whether mature previews show without the blur: Settings -> Civitai, only after the 18+ opt-in.
let unblurred = false
const unblurWatchers = new Set()
export function setUnblurred(on) {
  unblurred = !!on
  unblurWatchers.forEach((f) => f(unblurred))
}
window.ivstudio?.settings
  .get()
  .then((s) => setUnblurred(s.civitaiMature && s.civitaiUnblur))
  .catch(() => {})
function useUnblurred() {
  const [on, setOn] = useState(unblurred)
  useEffect(() => {
    unblurWatchers.add(setOn)
    return () => unblurWatchers.delete(setOn)
  }, [])
  return on
}

// A clip or picture that plays on hover. Mature previews stay blurred until clicked, unless the person
// chose to see them unblurred.
export function LoraThumb({ preview, label, mature = false, className = '' }) {
  const [clicked, setShown] = useState(false)
  const unblur = useUnblurred()
  const shown = !mature || clicked || unblur
  const ref = useRef(null)
  const src = preview?.url || (preview?.file ? fileUrl(preview.file) : null)
  if (!src)
    return (
      <div className={`lora-thumb empty ${className}`}>
        <span>{String(label || '').replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2) || '?'}</span>
      </div>
    )
  return (
    <div
      className={`lora-thumb ${shown ? '' : 'veiled'} ${className}`}
      onMouseEnter={() => shown && ref.current?.play?.().catch(() => {})}
      onMouseLeave={() => ref.current?.pause?.()}
      onClick={(e) => {
        if (!shown) {
          e.stopPropagation()
          setShown(true)
        }
      }}
    >
      {preview.type === 'video' ? <video ref={ref} src={src} muted loop playsInline preload="metadata" /> : <img src={src} alt="" loading="lazy" />}
      {!shown && <span className="lora-veil mono">Mature · click to show</span>}
    </div>
  )
}

function useProgress() {
  const [dl, setDl] = useState({})
  useEffect(() => {
    L().downloads().then(setDl, () => {})
    return L().onProgress((u) => setDl((all) => ({ ...all, [u.versionId]: u })))
  }, [])
  return dl
}

// ---------- Discover: Civitai ----------
// query / setQuery: the search words, when the page above owns them (the LoRAs page's banner shares them)
function Discover({ meta, onOpen, compact = false, family = 'h3', query: shared, setQuery: setShared }) {
  const [own, setOwn] = useState('')
  const query = setShared ? shared : own
  const setQuery = setShared || setOwn
  const [tag, setTag] = useState('')
  const [sort, setSort] = useState('Most Downloaded')
  const [items, setItems] = useState([])
  const [next, setNext] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [none, setNone] = useState(null)
  const typed = useRef(null)
  async function load(more = false) {
    setBusy(true)
    setError(null)
    try {
      const page = await L().search({ query, tag, sort, family, cursor: more ? next : null, limit: compact ? 18 : 24 })
      setItems((x) => (more ? [...x, ...page.items] : page.items))
      setNext(page.next)
      setNone(page.none || null)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    clearTimeout(typed.current)
    typed.current = setTimeout(() => load(false), query ? 450 : 0)
    return () => clearTimeout(typed.current)
  }, [query, tag, sort, family])
  return (
    <div className="lora-discover">
      <div className="lora-bar">
        <input className="lora-search" value={query} placeholder={`Search ${famLabel(meta, family)} LoRAs: cinematic, anime, painterly, turbo…`} onChange={(e) => setQuery(e.target.value)} />
        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          {(meta?.sorts || []).map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>
      <div className="lora-tags">
        {(meta?.tags || []).map(([id, label]) => (
          <button key={id || 'all'} className={`lora-tag ${tag === id ? 'on' : ''}`} onClick={() => setTag(id)}>
            {label}
          </button>
        ))}
        {meta?.mature && <span className="mono small pink lora-mode">Mature on · civitai.red</span>}
      </div>
      {error && <p className="notice">{error}</p>}
      <div className={`lora-grid ${compact ? 'compact' : ''}`}>
        {items.map((m) => (
          <button key={m.id} className={`lora-card ${m.installed ? 'installed' : ''}`} onClick={() => onOpen(m)}>
            <LoraThumb preview={m.previews[0]} label={m.name} mature={m.mature || m.previews[0]?.mature} />
            <span className="lora-card-body">
              <span className="lora-name">{m.name}</span>
              <span className="mono small dim lora-stats" title={`${m.downloads} downloads`}>
                {[`↓ ${K(m.downloads)}`, m.file && MB(m.file.size)].filter(Boolean).join(' · ')}
              </span>
              {m.creator && <span className="small dim lora-creator">{m.creator}</span>}
            </span>
            {m.installed && <span className="lora-badge mono">Installed</span>}
          </button>
        ))}
      </div>
      {!busy && !error && items.length === 0 && <p className="dim">{none || 'Nothing matches. Try another word or tag.'}</p>}
      <div className="lora-more">{busy ? <Loading label="Loading more" small /> : next && <button className="btn btn-small" onClick={() => load(true)}>Show more</button>}</div>
      <p className="small dim">From Civitai. Each LoRA keeps its maker's licence, shown before you download. LoRAs of real people aren't shown.</p>
    </div>
  )
}

// One Civitai LoRA: its clips, trigger words, licence and notes, with Download and Use.
// A LoRA from Civitai in a centered pop-up: its previews as a gallery on the left (click one to see it full size,
// with how it was made), everything else on the right. Esc closes the full view first, then the pop-up.
function Details({ id, meta, onClose, onUse, go }) {
  const [m, setM] = useState(null)
  const [error, setError] = useState(null)
  const [version, setVersion] = useState(null)
  const [busy, setBusy] = useState(false)
  const [viewing, setViewing] = useState(null) // index into the gallery
  const [revealed, setRevealed] = useState(() => new Set())
  const [copied, setCopied] = useState(null)
  const unblur = useUnblurred()
  const dl = useProgress()
  useEffect(() => {
    L()
      .model(id)
      .then((x) => (setM(x), setVersion(x.versions[0]?.id || null)), (err) => setError(err.message))
  }, [id])
  const v = m?.versions.find((x) => x.id === version)
  const gallery = (v?.previews.length ? v.previews : m?.previews) || []
  const shown = (i) => !gallery[i]?.mature || unblur || revealed.has(i)
  const reveal = (i) => setRevealed((r) => new Set(r).add(i))
  // Esc and the arrows belong to the pop-up while it's open (the picker underneath also listens for Esc)
  useEffect(() => {
    const key = (e) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation()
        viewing != null ? setViewing(null) : onClose()
      } else if (viewing != null && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        e.preventDefault()
        setViewing((i) => (i + (e.key === 'ArrowRight' ? 1 : -1) + gallery.length) % gallery.length)
      }
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [viewing, gallery.length])
  const state = v ? dl[v.id] : null
  async function download() {
    setBusy(true)
    try {
      const r = await L().download({ modelId: m.id, versionId: v.id })
      setM((x) => ({ ...x, versions: x.versions.map((y) => (y.id === v.id ? { ...y, installed: true, lora: r.lora } : y)) }))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  function copy(text, what) {
    navigator.clipboard?.writeText(text).then(() => (setCopied(what), setTimeout(() => setCopied(null), 1500)), () => {})
  }
  const pct = state?.total ? Math.floor((state.received / state.total) * 100) : 0
  const installedName = v?.lora || state?.lora
  const view = viewing != null ? gallery[viewing] : null
  return (
    <div className="lora-modal-backdrop" onClick={onClose}>
      <div className="lora-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={m?.name || 'LoRA'}>
        <div className="lora-modal-gallery">
          {!m && !error && <Loading label="Loading" />}
          {m && gallery.length === 0 && <p className="dim">No previews to show.</p>}
          <div className="lora-modal-grid" style={{ columnCount: gallery.length <= 1 ? 1 : gallery.length <= 4 ? 2 : 3 }}>
            {gallery.map((p, i) => (
              <button key={i} className={`lora-modal-thumb ${shown(i) ? '' : 'veiled'}`} onClick={() => (shown(i) ? setViewing(i) : reveal(i))} title={shown(i) ? 'See it full size' : 'Mature: click to show'}>
                {p.type === 'video' ? <video src={p.url} muted loop autoPlay={shown(i)} playsInline preload="metadata" /> : <img src={p.url} alt="" loading="lazy" />}
                {!shown(i) && <span className="lora-veil mono">Mature · click to show</span>}
                {p.type === 'video' && shown(i) && <span className="lora-modal-kind mono">Clip</span>}
              </button>
            ))}
          </div>
        </div>

        <aside className="lora-modal-info">
          <div className="lora-modal-head">
            <span className="mono small dim">Civitai{(v || m?.version)?.baseModel ? ` · ${(v || m.version).baseModel}` : ''}</span>
            <button className="link-btn mono" onClick={onClose}>
              Close ×
            </button>
          </div>
          {error && <p className="small pink">{error}</p>}
          {m && (
            <>
              <h2 className="lora-details-title">{m.name}</h2>
              <div className="lora-modal-stats mono small">
                {m.creator && <span>by {m.creator}</span>}
                <span>↓ {K(m.downloads)}</span>
                <span>♥ {K(m.likes)}</span>
                {v?.publishedAt && <span>{new Date(v.publishedAt).toLocaleDateString()}</span>}
              </div>

              {m.versions.length > 1 && (
                <label className="lora-modal-field">
                  <span className="mono small dim">Version</span>
                  <select value={version || ''} onChange={(e) => (setVersion(Number(e.target.value)), setViewing(null), setRevealed(new Set()))}>
                    {m.versions.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                        {x.installed ? ' · installed' : ''}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {v?.file && (
                <div className="lora-actions">
                  {v.installed || installedName ? (
                    <>
                      <span className="mono small cloud-ok">● Installed</span>
                      {onUse && installedName && !['ltx', 'wan'].includes(v.family) && (
                        <button className="btn btn-primary" onClick={() => onUse({ name: installedName, words: v.trainedWords, title: m.name, family: v.family })}>
                          {v.family && v.family !== 'h3' ? 'Use in a picture' : 'Use in a shot'}
                        </button>
                      )}
                      {['ltx', 'wan'].includes(v.family) && <span className="small dim">In ComfyUI’s loras folder, for your own workflows.</span>}
                    </>
                  ) : state && ['downloading', 'verifying'].includes(state.status) ? (
                    <div className="dl">
                      <div className="bar">
                        <span style={{ width: `${pct}%` }} />
                      </div>
                      <span className="mono dim">{state.status === 'verifying' ? 'Checking…' : `${pct}% of ${MB(state.total)}`}</span>
                    </div>
                  ) : meta?.hasKey ? (
                    <button className="btn btn-primary" disabled={busy} onClick={download}>
                      Download · {MB(v.file.size)}
                    </button>
                  ) : (
                    <p className="small">
                      Downloading needs your own free Civitai API key.{' '}
                      {go ? (
                        <button className="link-btn" onClick={() => go('settings')}>
                          Add it in Settings
                        </button>
                      ) : (
                        'Add it in Settings → Civitai.'
                      )}
                    </p>
                  )}
                </div>
              )}

              {v?.trainedWords.length > 0 && (
                <div className="lora-modal-section">
                  <span className="mono small dim">Trigger words {copied === 'words' ? '· copied' : '· click to copy'}</span>
                  <div className="lora-words">
                    {v.trainedWords.map((w) => (
                      <button key={w} className="lora-word mono" onClick={() => copy(w, 'words')}>
                        {w}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="lora-modal-section">
                <span className="mono small dim">Licence</span>
                <div className="lora-licence">
                  <span className={`lora-pill ${m.licence.commercial ? 'ok' : 'warn'}`}>{m.licence.commercial ? 'Commercial use allowed' : 'Not for commercial use'}</span>
                  {m.licence.creditNeeded && <span className="lora-pill">Credit the maker</span>}
                  {!m.licence.derivatives && <span className="lora-pill">No derivatives</span>}
                  {v?.file && <span className="lora-pill">SHA-256 checked</span>}
                </div>
                {m.licence.commercialUses?.length > 0 && <span className="small dim">Allowed: {m.licence.commercialUses.join(', ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()}</span>}
              </div>

              {v?.file && (
                <div className="lora-modal-section">
                  <span className="mono small dim">File</span>
                  <span className="small lora-modal-file" title={v.file.name}>
                    {v.file.name} · {MB(v.file.size)}
                  </span>
                </div>
              )}

              {m.tags?.length > 0 && (
                <div className="lora-modal-section">
                  <span className="mono small dim">Tags</span>
                  <div className="lora-words">
                    {m.tags.map((t) => (
                      <span key={t} className="lora-pill">
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {(v?.notes || m.description) && (
                <div className="lora-modal-section">
                  <span className="mono small dim">About</span>
                  {v?.notes && <p className="lora-desc small">{v.notes}</p>}
                  {m.description && m.description !== v?.notes && <p className="lora-desc small">{m.description}</p>}
                </div>
              )}

              <button className="link-btn mono small" onClick={() => window.ivstudio.links.open(m.url)}>
                Open on Civitai ↗
              </button>
            </>
          )}
        </aside>

        {view && (
          <div className="lora-full" onClick={() => setViewing(null)}>
            <div className="lora-full-stage" onClick={(e) => e.stopPropagation()}>
              <button className="lora-full-nav prev" onClick={() => setViewing((viewing - 1 + gallery.length) % gallery.length)} aria-label="Previous">
                ‹
              </button>
              <div className={`lora-full-media ${shown(viewing) ? '' : 'veiled'}`} onClick={() => !shown(viewing) && reveal(viewing)}>
                {view.type === 'video' ? <video key={view.full || view.url} src={view.full || view.url} controls autoPlay loop playsInline /> : <img key={view.full || view.url} src={view.full || view.url} alt="" />}
                {!shown(viewing) && <span className="lora-veil mono">Mature · click to show</span>}
              </div>
              <button className="lora-full-nav next" onClick={() => setViewing((viewing + 1) % gallery.length)} aria-label="Next">
                ›
              </button>
            </div>
            <div className="lora-full-info" onClick={(e) => e.stopPropagation()}>
              <span className="mono small dim">
                {viewing + 1} / {gallery.length}
                {view.width ? ` · ${view.width}×${view.height}` : ''} · ← → · Esc
              </span>
              {view.made?.prompt && (
                <p className="small lora-full-prompt">
                  {view.made.prompt}{' '}
                  <button className="link-btn mono small" onClick={() => copy(view.made.prompt, 'prompt')}>
                    {copied === 'prompt' ? 'Copied' : 'Copy prompt'}
                  </button>
                </p>
              )}
              {view.made?.settings?.length > 0 && <span className="mono small dim">{view.made.settings.join(' · ')}</span>}
              <button className="link-btn mono small" onClick={() => setViewing(null)}>
                Back to the LoRA
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export function useYours() {
  const [items, setItems] = useState(null)
  const reload = () => L().yours().then(setItems, () => setItems([]))
  useEffect(() => {
    reload()
  }, [])
  return [items, setItems, reload]
}

// family: a family id (civitai.js LORA_FAMILIES) narrows the list to that model's LoRAs; All shows every one.
function Yours({ items, setItems, onPick, onOpenCivitai, compact = false, notify, family = 'h3', meta }) {
  const [all, setAll] = useState(false)
  const [q, setQ] = useState('')
  const [looking, setLooking] = useState(null)
  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    const mine = (x) => x.family === family
    return (items || []).filter((x) => (all || mine(x)) && words.every((w) => `${x.name} ${x.civitai?.name || ''}`.toLowerCase().includes(w)))
  }, [items, all, q, family])
  const groups = useMemo(() => {
    const map = new Map()
    for (const x of [...shown].sort((a, b) => (b.prefs.favourite ? 1 : 0) - (a.prefs.favourite ? 1 : 0))) {
      const g = x.prefs.favourite ? '★ Favourites' : folderOf(x.name)
      if (!map.has(g)) map.set(g, [])
      map.get(g).push(x)
    }
    return [...map.entries()]
  }, [shown])
  const unknown = shown.filter((x) => !x.checked)
  async function identify(list) {
    for (const [i, x] of list.entries()) {
      setLooking({ name: x.name, n: i + 1, of: list.length })
      try {
        const r = await L().identify(x.name)
        setItems((all) => all.map((y) => (y.name === x.name ? { ...y, ...r } : y)))
      } catch (err) {
        notify?.(err.message)
      }
    }
    setLooking(null)
  }
  async function setFamily(x, id) {
    try {
      const prefs = await L().prefs(x.name, { family: id || null })
      setItems((all) => all.map((y) => (y.name === x.name ? { ...y, prefs, family: id || y.civitaiFamily || null } : y)))
      if (!id) L().yours().then(setItems, () => {})
    } catch (err) {
      notify?.(err.message)
    }
  }
  async function fav(x) {
    const prefs = await L().prefs(x.name, { favourite: !x.prefs.favourite })
    setItems((all) => all.map((y) => (y.name === x.name ? { ...y, prefs } : y)))
  }
  return (
    <div className="lora-yours">
      <div className="lora-bar">
        <input className="lora-search" value={q} placeholder="Search your LoRAs" onChange={(e) => setQ(e.target.value)} />
        <div className="segmented">
          <button className={all ? '' : 'on'} onClick={() => setAll(false)}>
            {famLabel(meta, family)} · {(items || []).filter((x) => x.family === family).length}
          </button>
          <button className={all ? 'on' : ''} onClick={() => setAll(true)}>
            All · {(items || []).length}
          </button>
        </div>
        {unknown.length > 0 && (
          <button className="btn btn-small" disabled={!!looking} onClick={() => identify(unknown)}>
            {looking ? `Looking up ${looking.n} of ${looking.of}…` : `Find ${unknown.length} on Civitai`}
          </button>
        )}
      </div>
      {items === null && <p className="mono dim">Reading ComfyUI's LoRAs…</p>}
      {groups.map(([g, list]) => (
        <div key={g} className="lora-group">
          <p className="mono small dim lora-group-name">
            {g} · {list.length}
          </p>
          <div className={`lora-grid ${compact ? 'compact' : ''}`}>
            {list.map((x) => (
              <div key={x.name} className="lora-card mine" onClick={() => onPick?.(x)} role={onPick ? 'button' : undefined}>
                <LoraThumb preview={x.prefs.picture ? { file: x.prefs.picture, type: 'image' } : x.civitai?.preview} label={loraTitle(x.name)} mature={x.civitai?.mature} />
                <span className="lora-card-body">
                  <span className="lora-name" title={x.name}>
                    {x.civitai?.name || loraTitle(x.name)}
                  </span>
                  <span className="mono small dim">
                    {x.size ? MB(x.size) : ''}
                    {x.civitai?.trainedWords?.length ? ` · ${x.civitai.trainedWords[0]}` : ''}
                  </span>
                </span>
                <span className="lora-card-tools">
                  <button className={`lora-fav ${x.prefs.favourite ? 'on' : ''}`} title={x.prefs.favourite ? 'Remove from favourites' : 'Add to favourites'} onClick={(e) => (e.stopPropagation(), fav(x))}>
                    ★
                  </button>
                  {!x.checked && (
                    <button className="link-btn mono small" disabled={!!looking} onClick={(e) => (e.stopPropagation(), identify([x]))}>
                      Find
                    </button>
                  )}
                  {(all || !x.family) && meta?.families && (
                    <select className="lora-fam-pick mono small" value={x.prefs.family || ''} title="Which model this LoRA is for" onClick={(e) => e.stopPropagation()} onChange={(e) => setFamily(x, e.target.value)}>
                      <option value="">{x.family && !x.prefs.family ? `${famLabel(meta, x.family)} (found)` : x.family ? 'Back to what was found' : 'Which model?'}</option>
                      {meta.families.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                  )}
                  {x.civitai && onOpenCivitai && (
                    <button className="link-btn mono small" onClick={(e) => (e.stopPropagation(), onOpenCivitai(x.civitai.modelId))}>
                      Info
                    </button>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
      {items && shown.length === 0 && <p className="dim">{q ? 'Nothing matches.' : `No ${famLabel(meta, family)} LoRAs in ComfyUI yet. Find some in Discover, or open All and say which model a LoRA is for.`}</p>}
    </div>
  )
}

// ---------- Recommended: a short shelf of tested H3 LoRAs (recommended.js), pinned and checked on download ----------
const MODE_LABEL = { text: 'Text', frames: 'First / last frame', reference: 'References' }
const mb = (b) => `${Math.round(b / 1e6)} MB`
function Recommended({ notify, onUse, go }) {
  const [data, setData] = useState(null)
  const load = () => window.ivstudio.loras.recommended().then(setData, (err) => (notify(err.message), setData({ list: [], onDisk: {}, state: {} })))
  useEffect(() => {
    load()
    return window.ivstudio.loras.onRecommended((u) => {
      setData((d) => (d ? { ...d, state: { ...d.state, [u.id]: u } } : d))
      if (u.status === 'done') load()
    })
  }, [])
  if (!data) return <Loading label="Reading your LoRAs" />
  return (
    <div className="rec-shelf">
      <p className="small dim">
        LoRAs we’ve tried with MiniMax H3, each fixed to one tested file and checked when it downloads. They go into ComfyUI’s <span className="mono">loras\MiniMax H3\Recommended</span> folder. Each keeps its maker’s licence.
      </p>
      <div className="rec-grid">
        {data.list.map((r) => {
          const have = data.onDisk[r.id]
          const st = data.state[r.id]
          const busy = st && ['queued', 'downloading', 'verifying'].includes(st.status)
          return (
            <article key={r.id} className={`rec-card ${have ? 'have' : ''}`}>
              <header>
                <h3>{r.name}</h3>
                <button className="link-btn mono small" onClick={() => window.ivstudio.links.open(r.page)} title={r.page}>
                  by {r.author} ↗
                </button>
              </header>
              <p className="small">{r.what}</p>
              <dl className="rec-facts small">
                <div>
                  <dt className="dim">Works in</dt>
                  <dd>{r.use === 'turnaround' ? 'Characters → Turnaround sheet' : r.works.map((w) => MODE_LABEL[w]).join(', ')}</dd>
                </div>
                <div>
                  <dt className="dim">How</dt>
                  <dd>{r.how}</dd>
                </div>
                <div>
                  <dt className="dim">Licence</dt>
                  <dd>{r.licence}</dd>
                </div>
                {r.trigger && (
                  <div>
                    <dt className="dim">Trigger</dt>
                    <dd className="mono">{r.trigger}</dd>
                  </div>
                )}
              </dl>
              <footer>
                {have ? (
                  <>
                    <span className="mono small cloud-ok">● On this PC</span>
                    {r.use === 'turnaround' ? (
                      <button className="btn btn-small" onClick={() => go?.('characters')}>
                        Open Characters
                      </button>
                    ) : (
                      <button className="btn btn-small btn-primary" onClick={() => onUse({ name: have, words: r.trigger ? [r.trigger] : [], title: r.name, strength: r.strength })}>
                        Use in a shot
                      </button>
                    )}
                  </>
                ) : busy ? (
                  <>
                    <span className="mono small">{st.status === 'downloading' && st.total ? `${Math.round((100 * st.received) / st.total)}%` : st.status === 'verifying' ? 'Checking…' : 'Waiting…'}</span>
                    <button className="link-btn small" onClick={() => window.ivstudio.loras.recommendedCancel(r.id)}>
                      Stop
                    </button>
                  </>
                ) : (
                  <>
                    {st?.status === 'error' && <span className="small pink">{st.error}</span>}
                    <button className="btn btn-small" onClick={() => window.ivstudio.loras.recommendedDownload(r.id).catch((err) => notify(err.message))}>
                      Download · {mb(r.size)}
                    </button>
                  </>
                )}
              </footer>
            </article>
          )
        })}
      </div>
    </div>
  )
}

// ---------- the page ----------
export function LorasPage({ notify, go, addLoraToCreate }) {
  const [tab, setTab] = useState('discover')
  const [query, setQuery] = useState('')
  const [meta, setMeta] = useState(null)
  const [family, setFamilyState] = useState(savedFamily)
  const setFamily = (id) => {
    setFamilyState(id)
    try {
      localStorage.setItem(FAMILY_KEY, id)
    } catch {}
  }
  const [open, setOpen] = useState(null)
  const [items, setItems, reload] = useYours()
  const counts = useMemo(() => {
    const c = {}
    for (const x of items || []) if (x.family) c[x.family] = (c[x.family] || 0) + 1
    return c
  }, [items])
  useEffect(() => {
    L().meta().then(setMeta)
  }, [])
  const use = (l) => addLoraToCreate?.({ family, ...l })
  const fam = meta?.families?.find((f) => f.id === family)
  return (
    <div className="loras">
      <Stage effect="flare" art="loras" title="LoRAs" kicker="Looks, moves and styles">
        <QuickBar search label="Search Civitai" placeholder={`Search Civitai for ${fam?.label || 'H3'} LoRAs: cinematic, anime, painterly…`} value={query} onChange={(v) => (setQuery(v), setTab('discover'))} results=".lora-tabs" />
      </Stage>
      <p className="lede">
        Change how your models look and move.
        <span className="lede-small dim">Pick a model, then find its LoRAs on Civitai and download them straight into ComfyUI, or browse the ones you already have. Shots use MiniMax H3's; pictures use their own model's.</span>
      </p>
      <FamilyBar families={meta?.families} value={family} onChange={setFamily} counts={counts} />
      {fam && <p className="small dim lora-fam-uses">{fam.label}: {fam.uses}.</p>}
      <div className="lora-tabs segmented">
        <button className={tab === 'discover' ? 'on' : ''} onClick={() => setTab('discover')}>
          Discover
        </button>
        <button className={tab === 'yours' ? 'on' : ''} onClick={() => (setTab('yours'), reload())}>
          Yours{items ? ` · ${counts[family] || 0}` : ''}
        </button>
        {family === 'h3' && (
          <button className={tab === 'recommended' ? 'on' : ''} onClick={() => setTab('recommended')}>
            Recommended
          </button>
        )}
      </div>
      <div className="lora-layout">
        <div>
          {tab === 'recommended' && family === 'h3' ? (
            <Recommended notify={notify} go={go} onUse={(l) => use({ ...l, family: 'h3' })} />
          ) : tab === 'discover' ? (
            <Discover meta={meta} family={family} onOpen={(m) => setOpen(m.id)} query={query} setQuery={setQuery} />
          ) : (
            <Yours meta={meta} family={family} items={items} setItems={setItems} notify={notify} onOpenCivitai={(id) => setOpen(id)} onPick={['ltx', 'wan'].includes(family) ? null : (x) => use({ name: x.name, words: x.prefs.triggers || x.civitai?.trainedWords || [], title: x.civitai?.name || loraTitle(x.name), family: x.family || family })} />
          )}
        </div>
        {open && <Details key={open} id={open} meta={meta} go={go} onClose={() => setOpen(null)} onUse={(l) => (reload(), use(l))} />}
      </div>
    </div>
  )
}

// The same in a dialog: Yours first, Discover a tab away. onPick({name, words, title}).
// family: the model the tray is for (a LORA_FAMILIES id; Create's video tray is h3, Create -> Image its family);
// both tabs show that model's LoRAs.
export function LoraPicker({ onPick, onClose, notify, go, family = 'h3' }) {
  const [tab, setTab] = useState('yours')
  const [meta, setMeta] = useState(null)
  const [open, setOpen] = useState(null)
  const [items, setItems, reload] = useYours()
  useEffect(() => {
    L().meta().then(setMeta)
    const esc = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [])
  return (
    <div className="lora-picker-backdrop" onClick={onClose}>
      <div className="lora-picker" onClick={(e) => e.stopPropagation()}>
        <div className="lora-picker-head">
          <div className="segmented">
            <button className={tab === 'yours' ? 'on' : ''} onClick={() => (setTab('yours'), reload())}>
              Your LoRAs
            </button>
            <button className={tab === 'discover' ? 'on' : ''} onClick={() => setTab('discover')}>
              Find on Civitai
            </button>
          </div>
          <span className="mono small dim lora-picker-for">For {famLabel(meta, family)}</span>
          <button className="link-btn mono" onClick={onClose}>
            Close ×
          </button>
        </div>
        <div className="lora-layout">
          <div>
            {tab === 'yours' ? (
              <Yours compact meta={meta} family={family} items={items} setItems={setItems} notify={notify} onOpenCivitai={(id) => setOpen(id)} onPick={(x) => onPick({ name: x.name, words: x.prefs.triggers || x.civitai?.trainedWords || [], title: x.civitai?.name || loraTitle(x.name) })} />
            ) : (
              <Discover compact meta={meta} family={family} onOpen={(m) => setOpen(m.id)} />
            )}
          </div>
          {open && <Details key={open} id={open} meta={meta} go={go && ((p) => (onClose(), go(p)))} onClose={() => setOpen(null)} onUse={(l) => onPick(l)} />}
        </div>
      </div>
    </div>
  )
}
