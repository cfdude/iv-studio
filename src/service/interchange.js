// An edit out to a real editor: the timeline as FCP 7 XML (Premiere Pro and DaVinci Resolve both import it),
// FCPXML 1.10 (Resolve, Final Cut Pro) and a CMX3600 EDL of V1, with every file it uses copied into a Media folder
// beside them, and the folder zipped to send. The writers are pure (edit in, text out); exportInterchange does the
// files. What carries over: every video and sound track with its clips' timing and trims, pictures, clip volume,
// hidden, muted and locked tracks, markers, and titles (as text in FCPXML, as markers everywhere). Fades and the
// titles' look don't carry over; README.txt in the folder says so.
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { pathToFileURL } from 'node:url'
import { clipEnd, clipLength, tracksOf, videoLayers } from './timeline.js'

const FORMATS = { '1080p': [1920, 1080], '4k': [3840, 2160], vertical: [1080, 1920], square: [1080, 1080] }
export const sizeOf = (e) => FORMATS[e.settings?.format] || FORMATS['1080p']
export const fpsOf = (e) => Math.round(e.settings?.fps || 24)
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const fr = (sec, fps) => Math.max(0, Math.round(sec * fps))
export const editFrames = (e) => (e.clips || []).reduce((m, c) => Math.max(m, fr(clipEnd(c), fpsOf(e))), 0)

// The clips that go out: on a known track, with their media (titles need only their text), sorted by start.
function usable(e) {
  const tracks = tracksOf(e)
  const ids = new Set(tracks.map((t) => t.id))
  return (e.clips || [])
    .filter((c) => ids.has(c.track) && (c.track === 'T1' ? c.text?.content : e.media?.[c.media]))
    .filter((c) => clipLength(c) > 0 || e.media?.[c.media]?.kind === 'image')
    .sort((a, b) => a.start - b.start)
}
const titleText = (c) => String(c.text?.content || '').replace(/\s+/g, ' ').trim()

// Timecode HH:MM:SS:FF at a whole frame rate (non-drop).
export function timecode(frames, fps) {
  const f = frames % fps
  const s = Math.floor(frames / fps)
  const p = (n) => String(n).padStart(2, '0')
  return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}:${p(f)}`
}

// ---------- CMX3600 EDL: V1 only (the format carries one picture track) ----------
export function cmx3600(e, { mediaPath = (m) => m.path } = {}) {
  const fps = fpsOf(e)
  const lines = [`TITLE: ${String(e.name || 'IV Studio edit').replace(/[^\x20-\x7e]/g, '').slice(0, 60)}`, 'FCM: NON-DROP FRAME', '']
  let n = 0
  for (const c of usable(e).filter((x) => x.track === 'V1')) {
    const m = e.media[c.media]
    n++
    const len = fr(clipEnd(c), fps) - fr(c.start, fps)
    const src = m.kind === 'image' ? 0 : fr(c.in, fps)
    const rec = fr(c.start, fps)
    lines.push(`${String(n).padStart(3, '0')}  AX       V     C        ${timecode(src, fps)} ${timecode(src + len, fps)} ${timecode(rec, fps)} ${timecode(rec + len, fps)}`)
    lines.push(`* FROM CLIP NAME: ${path.basename(mediaPath(m))}`)
    lines.push(`* SOURCE FILE: ${mediaPath(m)}`)
    lines.push('')
  }
  for (const k of e.markers || []) lines.push(`* MARKER ${timecode(fr(k.t, fps), fps)} ${String(k.label || '').replace(/\s+/g, ' ')}`)
  return lines.join('\r\n') + '\r\n'
}

// ---------- FCP 7 XML (xmeml 4) ----------
const fileUrl = (p) => `file://localhost${pathToFileURL(p).pathname}`
const rate = (fps) => `<rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>`
export function fcp7Xml(e, { mediaPath = (m) => m.path } = {}) {
  const fps = fpsOf(e)
  const [W, H] = sizeOf(e)
  const tracks = tracksOf(e)
  const clips = usable(e)
  const total = editFrames(e)
  const files = new Map() // media id -> { id, written }
  const fileRef = (m) => {
    const known = files.get(m.id)
    if (known) return `<file id="${known.id}"/>`
    const id = `file-${files.size + 1}`
    files.set(m.id, { id })
    const dur = m.kind === 'image' ? total || fps * 5 : fr(m.duration || 0, fps)
    const video = m.kind !== 'audio' ? `<video><samplecharacteristics>${rate(fps)}<width>${m.width || W}</width><height>${m.height || H}</height><pixelaspectratio>square</pixelaspectratio></samplecharacteristics></video>` : ''
    const audio = m.kind === 'audio' || m.hasAudio ? '<audio><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate></samplecharacteristics><channelcount>2</channelcount></audio>' : ''
    return `<file id="${id}"><name>${esc(path.basename(mediaPath(m)))}</name><pathurl>${esc(fileUrl(mediaPath(m)))}</pathurl>${rate(fps)}<duration>${dur}</duration><media>${video}${audio}</media></file>`
  }
  const level = (v) => (v != null && Math.abs(v - 1) > 0.001 ? `<filter><effect><name>Audio Levels</name><effectid>audiolevels</effectid><effectcategory>audiolevels</effectcategory><effecttype>audiolevels</effecttype><mediatype>audio</mediatype><parameter authoringApp="PremierePro"><parameterid>level</parameterid><name>Level</name><valuemin>0</valuemin><valuemax>3.98109</valuemax><value>${Math.min(3.98109, Math.max(0, v)).toFixed(5)}</value></parameter></effect></filter>` : '')
  const item = (c, id, kind, extra = '') => {
    const m = e.media[c.media]
    const start = fr(c.start, fps)
    const end = fr(clipEnd(c), fps)
    const inF = m.kind === 'image' ? 0 : fr(c.in, fps)
    const dur = m.kind === 'image' ? total || end - start : fr(m.duration || clipEnd(c), fps)
    return `<clipitem id="${id}"><name>${esc(m.name || path.basename(mediaPath(m)))}</name><enabled>TRUE</enabled><duration>${dur}</duration>${rate(fps)}<start>${start}</start><end>${end}</end><in>${inF}</in><out>${inF + end - start}</out>${fileRef(m)}${kind === 'audio' ? `<sourcetrack><mediatype>audio</mediatype><trackindex>1</trackindex></sourcetrack>${level(c.volume)}` : m.kind === 'image' ? '<stillframe>TRUE</stillframe>' : ''}${extra}</clipitem>`
  }
  // video tracks bottom up; a video clip's own sound gets an audio track of its own ("V1 sound") before A1..An
  const vtracks = videoLayers(tracks)
  const atracks = tracks.filter((t) => t.kind === 'audio')
  const soundOf = vtracks.filter((t) => clips.some((c) => c.track === t.id && e.media[c.media]?.hasAudio && !c.muted))
  const vXml = []
  const aXml = []
  const linkId = (c, kind) => `clipitem-${c.id}-${kind}`
  for (const t of vtracks) {
    const items = clips.filter((c) => c.track === t.id).map((c) => {
      const m = e.media[c.media]
      const sound = m.hasAudio && !c.muted && soundOf.includes(t)
      const links = sound ? `<link><linkclipref>${linkId(c, 'v')}</linkclipref><mediatype>video</mediatype></link><link><linkclipref>${linkId(c, 'a')}</linkclipref><mediatype>audio</mediatype></link>` : ''
      return item(c, linkId(c, 'v'), 'video', links)
    })
    vXml.push(`<track><enabled>${t.hidden ? 'FALSE' : 'TRUE'}</enabled><locked>${t.locked ? 'TRUE' : 'FALSE'}</locked>${items.join('')}</track>`)
  }
  for (const t of soundOf) {
    const items = clips.filter((c) => c.track === t.id && e.media[c.media]?.hasAudio && !c.muted).map((c) => item(c, linkId(c, 'a'), 'audio', `<link><linkclipref>${linkId(c, 'v')}</linkclipref><mediatype>video</mediatype></link><link><linkclipref>${linkId(c, 'a')}</linkclipref><mediatype>audio</mediatype></link>`))
    aXml.push(`<track><enabled>${t.hidden ? 'FALSE' : 'TRUE'}</enabled><locked>${t.locked ? 'TRUE' : 'FALSE'}</locked>${items.join('')}</track>`)
  }
  const solo = atracks.some((t) => t.solo)
  for (const t of atracks) {
    const items = clips.filter((c) => c.track === t.id && !c.muted).map((c) => item(c, `clipitem-${c.id}`, 'audio'))
    aXml.push(`<track><enabled>${t.muted || (solo && !t.solo) ? 'FALSE' : 'TRUE'}</enabled><locked>${t.locked ? 'TRUE' : 'FALSE'}</locked>${items.join('')}</track>`)
  }
  const marker = (name, comment, at) => `<marker><name>${esc(name)}</name><comment>${esc(comment)}</comment><in>${at}</in><out>-1</out></marker>`
  const markers = [...(e.markers || []).map((k) => marker(k.label || 'Marker', '', fr(k.t, fps))), ...clips.filter((c) => c.track === 'T1').map((c) => marker(`Title: ${titleText(c).slice(0, 60)}`, titleText(c), fr(c.start, fps)))]
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="4"><sequence id="sequence-1"><name>${esc(e.name || 'IV Studio edit')}</name><duration>${total}</duration>${rate(fps)}<timecode>${rate(fps)}<string>00:00:00:00</string><frame>0</frame><displayformat>NDF</displayformat></timecode><media><video><format><samplecharacteristics>${rate(fps)}<width>${W}</width><height>${H}</height><pixelaspectratio>square</pixelaspectratio><fielddominance>none</fielddominance></samplecharacteristics></format>${vXml.join('')}</video><audio><numOutputChannels>2</numOutputChannels><format><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate></samplecharacteristics></format>${aXml.join('')}</audio></media>${markers.join('')}</sequence></xmeml>
`
}

// ---------- FCPXML 1.10 ----------
// V1 is the primary storyline (its clips with gaps between); every other track's clips connect to the spine
// element under their start, in lanes: V2.. above (1, 2, ..), titles over the top video lane, sound below (-1, ..).
export function fcpxml(e, { mediaPath = (m) => m.path } = {}) {
  const fps = fpsOf(e)
  const [W, H] = sizeOf(e)
  const T = (frames) => (frames === 0 ? '0s' : `${frames}/${fps}s`)
  const tracks = tracksOf(e)
  const clips = usable(e)
  const total = editFrames(e)
  const res = [`<format id="r1" name="IV Studio ${W}x${H} ${fps}p" frameDuration="1/${fps}s" width="${W}" height="${H}"/>`]
  const assets = new Map()
  const assetOf = (m) => {
    if (assets.has(m.id)) return assets.get(m.id)
    const id = `r${res.length + 1}`
    const video = m.kind !== 'audio'
    const audio = m.kind === 'audio' || !!m.hasAudio
    const dur = m.kind === 'image' ? '0s' : T(fr(m.duration || 0, fps))
    res.push(`<asset id="${id}" name="${esc(m.name || path.basename(mediaPath(m)))}" start="0s" duration="${dur}" hasVideo="${video ? 1 : 0}" hasAudio="${audio ? 1 : 0}"${video ? ' format="r1"' : ''}${audio ? ' audioSources="1" audioChannels="2" audioRate="48000"' : ''}><media-rep kind="original-media" src="${esc(pathToFileURL(mediaPath(m)).href)}"/></asset>`)
    assets.set(m.id, id)
    return id
  }
  let titleFx = null
  const titleRef = () => titleFx || ((titleFx = `r${res.length + 1}`), res.push(`<effect id="${titleFx}" name="Basic Title" uid=".../Titles.localized/Bumper:Opener.localized/Basic Title.localized/Basic Title.moti"/>`), titleFx)
  const vol = (c) => (c.volume != null && Math.abs(c.volume - 1) > 0.001 ? `<adjust-volume amount="${c.volume > 0 ? (20 * Math.log10(c.volume)).toFixed(2) : -96}dB"/>` : '')
  const lanes = new Map()
  const vlayers = videoLayers(tracks)
  vlayers.forEach((t, k) => lanes.set(t.id, k))
  lanes.set('T1', vlayers.length)
  tracks.filter((t) => t.kind === 'audio').forEach((t, k) => lanes.set(t.id, -(k + 1)))
  const hidden = (t) => tracks.find((x) => x.id === t)?.hidden || (tracks.find((x) => x.id === t)?.kind === 'audio' && (tracks.find((x) => x.id === t)?.muted || (tracks.some((x) => x.solo) && !tracks.find((x) => x.id === t)?.solo)))
  // an element for one clip; offset in its parent's time
  let ts = 0
  const element = (c, offset, lane) => {
    const s = fr(c.start, fps)
    const d = fr(clipEnd(c), fps) - s
    const laneAttr = lane ? ` lane="${lane}"` : ''
    const on = hidden(c.track) ? ' enabled="0"' : ''
    if (c.track === 'T1') {
      ts++
      const size = Math.round(((c.text.size || 8) * H) / 100)
      return `<title ref="${titleRef()}"${laneAttr} offset="${T(offset)}" name="${esc(titleText(c).slice(0, 40))}" start="0s" duration="${T(d)}"${on}><text><text-style ref="ts${ts}">${esc(c.text.content)}</text-style></text><text-style-def id="ts${ts}"><text-style font="Barlow Condensed" fontSize="${size}" fontColor="1 1 1 1" alignment="center"/></text-style-def></title>`
    }
    const m = e.media[c.media]
    const ref = assetOf(m)
    if (m.kind === 'image') return `<video ref="${ref}"${laneAttr} offset="${T(offset)}" name="${esc(m.name)}" start="0s" duration="${T(d)}"${on}/>`
    // a muted clip keeps its sound, turned all the way down, so it can be brought back in the editor
    return `<asset-clip ref="${ref}"${laneAttr} offset="${T(offset)}" name="${esc(m.name)}" start="${T(fr(c.in, fps))}" duration="${T(d)}"${on}>${c.muted ? '<adjust-volume amount="-96dB"/>' : vol(c)}`
  }
  // the spine: V1's clips and the gaps between them
  const spine = []
  let at = 0
  for (const c of clips.filter((x) => x.track === 'V1')) {
    const s = fr(c.start, fps)
    if (s > at) spine.push({ gap: true, offset: at, start: 0, dur: s - at, kids: [] })
    if (s < at) continue // overlapping clips on V1 can't both be in one storyline; the first wins
    spine.push({ clip: c, offset: s, start: e.media[c.media].kind === 'image' ? 0 : fr(c.in, fps), dur: fr(clipEnd(c), fps) - s, kids: [] })
    at = s + spine[spine.length - 1].dur
  }
  if (at < total || !spine.length) spine.push({ gap: true, offset: at, start: 0, dur: Math.max(1, total - at), kids: [] })
  const parentAt = (f) => spine.find((p) => f >= p.offset && f < p.offset + p.dur) || spine[spine.length - 1]
  for (const c of clips.filter((x) => x.track !== 'V1')) {
    const s = fr(c.start, fps)
    const p = parentAt(s)
    p.kids.push(element(c, p.start + (s - p.offset), lanes.get(c.track)) + (c.track === 'T1' || e.media[c.media]?.kind === 'image' ? '' : '</asset-clip>'))
  }
  const markers = [...(e.markers || []).map((k) => [fr(k.t, fps), k.label || 'Marker']), ...clips.filter((c) => c.track === 'T1').map((c) => [fr(c.start, fps), `Title: ${titleText(c).slice(0, 60)}`])]
  for (const [f, label] of markers) {
    const p = parentAt(f)
    p.kids.push(`<marker start="${T(p.start + (f - p.offset))}" duration="1/${fps}s" value="${esc(label)}"/>`)
  }
  const spineXml = spine
    .map((p) => {
      if (p.gap) return `<gap name="Gap" offset="${T(p.offset)}" start="0s" duration="${T(p.dur)}">${p.kids.join('')}</gap>`
      const el = element(p.clip, p.offset, 0)
      return e.media[p.clip.media].kind === 'image' ? el.replace(/\/>$/, `>${p.kids.join('')}</video>`) : `${el}${p.kids.join('')}</asset-clip>`
    })
    .join('')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.10"><resources>${res.join('')}</resources><library><event name="IV Studio"><project name="${esc(e.name || 'IV Studio edit')}"><sequence format="r1" duration="${T(Math.max(1, total))}" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k"><spine>${spineXml}</spine></sequence></project></event></library></fcpxml>
`
}

// ---------- a small zip writer (no compression for media, deflate for text; no zip64, so under 4 GB) ----------
const CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf, crc = 0) {
  if (zlib.crc32) return zlib.crc32(buf, crc)
  let c = ~crc >>> 0
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return ~c >>> 0
}
export function writeZip(zipFile, entries) {
  // entries: [{ name, file }] (paths in the zip use forward slashes)
  const fd = fs.openSync(zipFile, 'w')
  const central = []
  let offset = 0
  const write = (b) => (fs.writeSync(fd, b), (offset += b.length))
  const CHUNK = 8 * 1024 * 1024
  try {
    for (const { name, file } of entries) {
      const size = fs.statSync(file).size
      const text = /\.(xml|fcpxml|edl|txt|json)$/i.test(name) && size < 64 * 1024 * 1024
      let data = null
      let crc = 0
      if (text) {
        const raw = fs.readFileSync(file)
        crc = crc32(raw)
        data = zlib.deflateRawSync(raw)
      } else {
        const f = fs.openSync(file, 'r')
        const b = Buffer.alloc(CHUNK)
        for (let n; (n = fs.readSync(f, b, 0, CHUNK, null)) > 0; ) crc = crc32(b.subarray(0, n), crc)
        fs.closeSync(f)
      }
      const comp = text ? data.length : size
      if (offset + comp > 0xffffffff || size > 0xffffffff) throw new Error('The zip would pass 4 GB; send the folder instead.')
      const nameBuf = Buffer.from(name, 'utf8')
      const head = Buffer.alloc(30)
      head.writeUInt32LE(0x04034b50, 0)
      head.writeUInt16LE(20, 4)
      head.writeUInt16LE(0x0800, 6) // UTF-8 names
      head.writeUInt16LE(text ? 8 : 0, 8)
      head.writeUInt32LE(crc >>> 0, 14)
      head.writeUInt32LE(comp, 18)
      head.writeUInt32LE(size, 22)
      head.writeUInt16LE(nameBuf.length, 26)
      const at = offset
      write(head)
      write(nameBuf)
      if (text) write(data)
      else {
        const f = fs.openSync(file, 'r')
        const b = Buffer.alloc(CHUNK)
        for (let n; (n = fs.readSync(f, b, 0, CHUNK, null)) > 0; ) write(b.subarray(0, n))
        fs.closeSync(f)
      }
      const cen = Buffer.alloc(46)
      cen.writeUInt32LE(0x02014b50, 0)
      cen.writeUInt16LE(20, 4)
      cen.writeUInt16LE(20, 6)
      cen.writeUInt16LE(0x0800, 8)
      cen.writeUInt16LE(text ? 8 : 0, 10)
      cen.writeUInt32LE(crc >>> 0, 16)
      cen.writeUInt32LE(comp, 20)
      cen.writeUInt32LE(size, 24)
      cen.writeUInt16LE(nameBuf.length, 28)
      cen.writeUInt32LE(at, 42)
      central.push(Buffer.concat([cen, nameBuf]))
    }
    const start = offset
    for (const c of central) write(c)
    const end = Buffer.alloc(22)
    end.writeUInt32LE(0x06054b50, 0)
    end.writeUInt16LE(central.length, 8)
    end.writeUInt16LE(central.length, 10)
    end.writeUInt32LE(offset - start, 12)
    end.writeUInt32LE(start, 16)
    write(end)
  } finally {
    fs.closeSync(fd)
  }
}

const safe = (s) => String(s || 'edit').replace(/\s*·\s*/g, ' - ').replace(/[^\w -]+/g, '').replace(/\s+/g, ' ').trim() || 'edit'
// Writes "<edit> - for Premiere and Resolve" into outDir: Media\ (copies of every file the timeline uses), the
// three timeline files and README.txt; zip: also "<that>.zip" beside it. Returns what was written.
export async function exportInterchange(e, outDir, { zip = true, stamp = new Date() } = {}) {
  const clips = usable(e)
  if (!clips.length) throw new Error('The timeline is empty.')
  const used = [...new Set(clips.filter((c) => c.track !== 'T1').map((c) => c.media))].map((id) => e.media[id])
  const missing = used.filter((m) => !fs.existsSync(m.path))
  if (missing.length) throw new Error(`Missing files: ${missing.map((m) => m.name).join(', ')}`)
  const base = `${safe(e.name)} - for Premiere and Resolve ${stamp.toISOString().slice(0, 16).replace(/[:T]/g, '-')}`
  const dir = path.join(outDir, base)
  const mediaDir = path.join(dir, 'Media')
  fs.mkdirSync(mediaDir, { recursive: true })
  // copies, named after the file, made unique when two differ
  const copies = new Map()
  const taken = new Set()
  for (const m of used) {
    const ext = path.extname(m.path)
    let name = `${safe(path.basename(m.path, ext))}${ext}`
    for (let k = 2; taken.has(name.toLowerCase()); k++) name = `${safe(path.basename(m.path, ext))} ${k}${ext}`
    taken.add(name.toLowerCase())
    const to = path.join(mediaDir, name)
    await fs.promises.copyFile(m.path, to)
    copies.set(m.id, to)
  }
  const mediaPath = (m) => copies.get(m.id) || m.path
  const name = safe(e.name)
  const files = {
    xml: path.join(dir, `${name} (Premiere, Resolve).xml`),
    fcpxml: path.join(dir, `${name} (Resolve, Final Cut).fcpxml`),
    edl: path.join(dir, `${name} V1.edl`),
    readme: path.join(dir, 'README.txt')
  }
  fs.writeFileSync(files.xml, fcp7Xml(e, { mediaPath }))
  fs.writeFileSync(files.fcpxml, fcpxml(e, { mediaPath }))
  fs.writeFileSync(files.edl, cmx3600(e, { mediaPath }))
  const fps = fpsOf(e)
  const [W, H] = sizeOf(e)
  fs.writeFileSync(
    files.readme,
    [
      `${e.name || 'IV Studio edit'}, from IV Studio`,
      `${W}x${H}, ${fps} fps, ${(editFrames(e) / fps).toFixed(2)} s, ${clips.length} clips, ${used.length} files in Media.`,
      '',
      'Premiere Pro: File > Import, pick the .xml. DaVinci Resolve: File > Import > Timeline, pick the .xml or the .fcpxml.',
      'Final Cut Pro: File > Import > XML, pick the .fcpxml. The .edl holds V1 only, for any editor that reads CMX3600.',
      'The timeline points at the files in Media. If you move this folder or open it on another computer, relink to Media when asked.',
      '',
      'Carried over: every video and sound track, clip timing and trims, pictures, clip volume, hidden, muted and locked tracks, markers.',
      'Titles come over as markers with their words (and as text in the .fcpxml); set their look in your editor.',
      'Not carried over: fades, title styling, and the export loudness setting.',
      used.some((m) => m.alpha) ? 'Cut-outs are WebM files with a see-through background; Premiere may need a WebM plug-in to read them.' : ''
    ]
      .filter((l) => l != null)
      .join('\r\n')
  )
  let zipFile = null
  if (zip) {
    zipFile = `${dir}.zip`
    const entries = [files.xml, files.fcpxml, files.edl, files.readme].map((f) => ({ name: `${base}/${path.basename(f)}`, file: f }))
    for (const f of copies.values()) entries.push({ name: `${base}/Media/${path.basename(f)}`, file: f })
    writeZip(zipFile, entries)
  }
  return { folder: dir, zip: zipFile, ...files, media: [...copies.values()] }
}
