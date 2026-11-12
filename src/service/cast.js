// @ mentions: the person's cast (character presets) and places, written @Name in any prompt. At render time a mention
// becomes the shot's {char} (the picked character, whose LoRA carries them) or a <Subject N> with that member's
// picture attached as a reference, in the full-reference format of MiniMax's H3 guide. Places live in the app data's
// places.json (with their pictures in places\); the places of every film with a picture are offered too.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}
// The name a member is mentioned by: a character's first name, a place's name without spaces ("Bus Stop" -> BusStop).
export const handleOf = (name, kind) => (kind === 'character' ? String(name).split(/\s+/)[0] : String(name).replace(/[^A-Za-z0-9-]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ''))).replace(/^[^A-Za-z]+/, '')

export class Cast {
  // characters: () => presets; facePicture: (preset) => a face picture file or null (Projects' lookup, with the catalogue)
  constructor({ dataDir, characters, facePicture }) {
    this.dataDir = dataDir
    this.characters = characters
    this.facePicture = facePicture
  }
  placesFile = () => path.join(this.dataDir, 'places.json')
  places() {
    return readJson(this.placesFile(), [])
  }
  savePlace({ id, name, description = '', picture }) {
    if (!String(name || '').trim()) throw new Error('Give the place a name.')
    const list = this.places()
    const place = list.find((p) => p.id === id) || { id: crypto.randomUUID().slice(0, 8) }
    place.name = name.trim()
    place.description = description.trim()
    if (picture && picture !== place.picture) {
      if (!fs.existsSync(picture)) throw new Error("That picture isn't there.")
      const dir = path.join(this.dataDir, 'places')
      fs.mkdirSync(dir, { recursive: true })
      const copy = path.join(dir, `${place.id}-${Date.now()}${path.extname(picture).toLowerCase() || '.png'}`)
      fs.copyFileSync(picture, copy)
      place.picture = copy
    }
    if (!place.picture) throw new Error('A place needs a picture, so the shot can keep it.')
    const taken = this.members().find((m) => m.handle.toLowerCase() === handleOf(place.name, 'place').toLowerCase() && m.id !== place.id)
    if (taken) throw new Error(`@${taken.handle} is already ${taken.kind === 'character' ? 'a character' : 'a place'}. Give this place another name.`)
    fs.writeFileSync(this.placesFile(), JSON.stringify([...list.filter((p) => p.id !== place.id), place], null, 2))
    return place
  }
  deletePlace(id) {
    fs.writeFileSync(this.placesFile(), JSON.stringify(this.places().filter((p) => p.id !== id), null, 2))
  }
  // Places from the person's films (Projects) that have a picture, as read-only members.
  filmPlaces() {
    const dir = path.join(this.dataDir, 'productions')
    if (!fs.existsSync(dir)) return []
    const out = []
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      const film = readJson(path.join(dir, f), null)
      for (const l of film?.locations || []) if (l.pictures?.[0] && fs.existsSync(l.pictures[0])) out.push({ id: `${film.id}:${l.id}`, name: l.name, description: l.description || '', picture: l.pictures[0], film: film.name })
    }
    return out
  }
  // Everyone and everywhere that can be mentioned: [{ handle, kind, id, name, picture, description, film? }].
  members() {
    const seen = new Set()
    const out = []
    const push = (m) => {
      const key = m.handle.toLowerCase()
      if (!m.handle || seen.has(key)) return
      seen.add(key)
      out.push(m)
    }
    for (const c of this.characters()) push({ handle: handleOf(c.name, 'character'), kind: 'character', id: c.id, name: c.name, picture: this.facePicture(c) })
    for (const p of this.places()) push({ handle: handleOf(p.name, 'place'), kind: 'place', id: p.id, name: p.name, picture: p.picture, description: p.description })
    for (const p of this.filmPlaces()) push({ handle: handleOf(p.name, 'place'), kind: 'place', id: p.id, name: p.name, picture: p.picture, description: p.description, film: p.film })
    return out
  }
}

const MENTION = /(^|[^\w@<])@([A-Za-z][\w-]*)/g
export const mentionsIn = (text) => [...String(text || '').matchAll(MENTION)].map((m) => m[2])

const FIELDS = /(^|\n)\s*(integrated_multimodal_description|detailed_description|overall_soundscape|non_diegetic_music|subject_definitions|summary|retention_analysis)\s*:\s*/g
function split(prompt) {
  const out = {}
  const marks = [...String(prompt).matchAll(FIELDS)].map((m) => ({ name: m[2], at: m.index, start: m.index + m[0].length }))
  marks.forEach((m, i) => (out[m.name] = prompt.slice(m.start, i + 1 < marks.length ? marks[i + 1].at : prompt.length).trim()))
  out._head = marks.length ? prompt.slice(0, marks[0].at).trim() : String(prompt).trim()
  return out
}

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// More than one character in a shot (GitHub #30): the others picked in Create's "Who's in it" (request.with, preset
// ids; request.character stays the one whose LoRA carries them) join the prompt as @ mentions, which
// resolveMentions then attaches as their face pictures. Their name in the prompt becomes the mention; someone the
// prompt doesn't name gets a sentence at the start of [Shot 1]. Returns the request without `with`.
export function withCast(request, members) {
  const { with: also, ...rest } = request
  const ids = [...new Set((also || []).filter((id) => id && id !== 'none' && id !== request.character))]
  if (!ids.length) return rest
  let prompt = String(rest.prompt || '')
  const add = []
  for (const id of ids) {
    const m = members.find((x) => x.kind === 'character' && x.id === id)
    if (!m || mentionsIn(prompt).some((h) => h.toLowerCase() === m.handle.toLowerCase())) continue
    const names = [...new Set([m.name, m.name.split(/\s+/)[0]])].map(escapeRe).join('|')
    const re = new RegExp(`(^|[^\\w@<{])(?:${names})\\b`, 'g')
    if (re.test(prompt)) prompt = prompt.replace(re, `$1@${m.handle}`)
    else add.push(`@${m.handle}`)
  }
  if (add.length) {
    const line = `${add.length > 1 ? `${add.slice(0, -1).join(', ')} and ${add[add.length - 1]} are` : `${add[0]} is`} also in the shot.`
    const at = prompt.indexOf('[Shot 1]')
    prompt = at >= 0 ? `${prompt.slice(0, at + 8)} ${line}${prompt.slice(at + 8)}` : `${prompt.trim()}${prompt.trim() ? ' ' : ''}${line}`
  }
  return { ...rest, prompt }
}

// A request whose prompt has @ mentions -> the request to render: mentions resolved, members' pictures attached.
// Returns { request, notes: [{ level, message }] }. members: Cast.members(); character: the request's picked preset id.
export function resolveMentions(request, members) {
  const handles = [...new Set(mentionsIn(request.prompt).map((h) => h.toLowerCase()))]
  if (!handles.length) return { request, notes: [] }
  const notes = []
  const find = (h) => members.find((m) => m.handle.toLowerCase() === h)
  const known = handles.map(find).filter(Boolean)
  for (const h of handles) if (!find(h)) notes.push({ level: 'error', message: `@${h} isn't in your cast or places.` })
  const lora = known.find((m) => m.kind === 'character' && m.id === request.character)
  const others = known.filter((m) => m !== lora)
  const replace = (text, member, by) => text.replace(new RegExp(`(^|[^\\w@<])@${member.handle}\\b`, 'gi'), `$1${by}`)
  let prompt = request.prompt
  if (lora) prompt = replace(prompt, lora, '{char}')
  if (!others.length) return { request: { ...request, prompt }, notes }

  // Members with a picture become referenced subjects; frames and continue modes can't take more pictures.
  const pictured = others.filter((m) => m.picture)
  for (const m of others.filter((x) => !x.picture)) {
    prompt = replace(prompt, m, m.kind === 'character' ? m.name.split(/\s+/)[0] : m.name)
    notes.push({ level: 'warning', message: `@${m.handle} has no picture, so it's written as "${m.name}" and H3 will imagine ${m.kind === 'character' ? 'them' : 'it'}.` })
  }
  if (!pictured.length) return { request: { ...request, prompt }, notes }
  if (request.mode === 'frames' || request.mode === 'continue') {
    for (const m of pictured) prompt = replace(prompt, m, m.kind === 'character' ? m.name.split(/\s+/)[0] : m.name)
    notes.push({ level: 'warning', message: `${request.mode === 'frames' ? 'First / last frame' : 'Continue'} mode can't attach pictures, so ${pictured.map((m) => `@${m.handle}`).join(', ')} ${pictured.length > 1 ? 'are' : 'is'} written as words. Use References mode to keep ${pictured.length > 1 ? 'their' : 'its'} look.` })
    return { request: { ...request, prompt }, notes }
  }

  const media = [...(request.media || [])]
  const s = split(prompt)
  let body = s.detailed_description ?? s.integrated_multimodal_description ?? s._head
  let defs = s.subject_definitions ? s.subject_definitions.split('\n').filter(Boolean) : []
  let retention = s.retention_analysis ? s.retention_analysis.split('\n').filter(Boolean) : []
  let summary = s.summary
  const existing = [...String(prompt).matchAll(/<Subject (\d+)>/g)].map((m) => Number(m[1]))
  let next = existing.length ? Math.max(...existing) + 1 : 1
  const shots = Math.max(1, (body.match(/\[Shot \d+\]/g) || []).length)
  const inShots = Array.from({ length: shots }, (_, i) => `[Shot ${i + 1}]`).join(', ')
  for (const m of pictured) {
    let at = media.findIndex((x) => (x.file || x.path) === m.picture)
    if (at < 0) media.push({ kind: 'picture', file: m.picture })
    const label = `<Picture ${media.filter((x, i) => x.kind === 'picture' && i <= (at < 0 ? media.length - 1 : at)).length}>`
    const subject = `<Subject ${next++}>`
    const fix = (t) => replace(t, m, subject)
    body = fix(body)
    summary = summary && fix(summary)
    defs = defs.map(fix)
    defs.push(m.kind === 'character' ? `${subject} is ${m.name}, the person in ${label}.` : `${subject} is the place in ${label}: ${m.name}${m.description ? `, ${m.description.replace(/[.\s]+$/, '')}` : ''}.`)
    retention.push(m.kind === 'character' ? `${subject} (appears in ${inShots}): fully_preserved - ${m.name.split(/\s+/)[0]}'s face, hair and build; pose and clothes follow the shot.` : `${subject} (appears in ${inShots}): fully_preserved - the place, its furniture, light and colours; the framing is newly directed.`)
  }
  const switched = request.mode !== 'reference'
  if (!summary) summary = `[reference generation] The target video follows the shots below, with ${pictured.map((m) => (m.kind === 'character' ? m.name.split(/\s+/)[0] : `the place ${m.name}`)).join(' and ')} kept from ${pictured.length > 1 ? 'their pictures' : 'its picture'}.`
  const out = [
    `subject_definitions:\n${defs.join('\n')}`,
    `summary:\n${summary}`,
    `retention_analysis:\n${retention.join('\n')}`,
    `detailed_description:\n${body.replace(/\s+(\[Shot \d+\])/g, '\n$1').trim()}`,
    `overall_soundscape:\n${s.overall_soundscape || 'Quiet room tone.'}`,
    `non_diegetic_music:\n${s.non_diegetic_music || 'N/A'}`
  ].join('\n\n')
  if (switched) notes.push({ level: 'info', message: `${pictured.map((m) => `@${m.handle}`).join(', ')} ${pictured.length > 1 ? 'have pictures' : 'has a picture'}, so this shot renders in References mode with ${pictured.length > 1 ? 'them' : 'it'} attached.` })
  return { request: { ...request, mode: 'reference', prompt: out, media }, notes }
}
