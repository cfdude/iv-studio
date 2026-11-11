// LoRAs from Civitai, and the LoRAs already on this PC, shown as pictures rather than file names.
// Civitai's public API (civitai.com/api/v1) needs no account to search; downloading a file needs the
// person's own Civitai API key (made on civitai.com: profile menu > Account settings > API keys). Mature
// LoRAs come from civitai.red, Civitai's unrestricted address, and only when the person has turned
// "Show mature LoRAs" on in Settings. Models and previews Civitai flags as a real person (poi) or a minor
// are never shown, in any mode.
// Installed LoRAs are identified by the SHA-256 of the file (Civitai's by-hash lookup), the way
// Pixaroma's LoRA Loader does it; the results, a small preview clip and the person's own settings for each
// LoRA (favourite, strength, trigger words) are kept in the data folder's loras/.
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable, Transform } from 'node:stream'
import { comboOptions } from './setup.js'

export const CIVITAI_SITES = { safe: 'https://civitai.com', mature: 'https://civitai.red' }
export const LORA_BASE = 'MiniMax H3'
// Every model family IV Studio runs, as Civitai names its base models (checked against civitai.com/api/v1 on
// 2026-11-09), how its LoRAs on this PC are recognised when Civitai doesn't know them (the folder or file name;
// the same patterns as images.js), and the folder a download goes to under loras/Civitai/. ids match images.js's
// families, so Create -> Image's LoRA tray and the LoRAs page share them. Order matters for names: Flux 3 before
// Flux.2, whose "klein" would catch it.
export const LORA_FAMILIES = [
  // "H3 Image" names belong to H3 Image below, not to the video model
  { id: 'h3', label: 'MiniMax H3', kind: 'video', bases: ['MiniMax H3'], pattern: 'minimax[ _-]?h3(?![ _-]?image)|(^|[\\/_ -])h3(?![ _-]?image)([\\/_ -]|$)|mmh3|t3ss4', folder: 'MiniMax H3', uses: 'Shots, sequences, films and H3 stills' },
  { id: 'h3image', label: 'MiniMax H3 Image', kind: 'image', bases: [], pattern: 'minimax[ _-]?h3[ _-]?image|(^|[\\/_ -])h3[ _-]?image', folder: 'MiniMax H3 Image', uses: 'Pictures: make and edit (Civitai has no H3 Image category yet; yours show under Yours)' },
  { id: 'ltx', label: 'LTX-2.5', kind: 'video', bases: ['LTXV 2.5'], pattern: 'ltx[ _-]?(v|video)?[ _-]?2\\.?5', folder: 'LTX-2.5', uses: 'Your own ComfyUI workflows (IV Studio’s LTX effects bring their own LoRAs)' },
  { id: 'wan', label: 'Wan 2.1', kind: 'video', bases: ['Wan Video 14B i2v 480p', 'Wan Video 14B i2v 720p', 'Wan Video 14B t2v'], pattern: 'wan[ _-]?2\\.?1|wan_?14b', folder: 'Wan 2.1', uses: 'Your own ComfyUI workflows (the Effects gallery brings its own LoRAs)' },
  { id: 'flux3', label: 'Flux 3 Klein', kind: 'image', bases: ['Flux.3 Klein'], pattern: 'flux ?\\.?3', folder: 'Flux 3 Klein', uses: 'Pictures: make and edit, inpaint' },
  { id: 'flux2', label: 'Flux.2 Klein 9B', kind: 'image', bases: ['Flux.2 Klein 9B'], pattern: 'flux ?\\.?2|klein|klien', folder: 'Flux.2 Klein', uses: 'Pictures: make and edit' },
  { id: 'krea2', label: 'Krea 2', kind: 'image', bases: ['Krea 2'], pattern: 'krea', folder: 'Krea 2', uses: 'Pictures: make and edit' },
  { id: 'qwen21', label: 'Qwen Image 2.1', kind: 'image', bases: ['Qwen 2.1'], pattern: 'qwen[ _-]?(image[ _-]?)?2\\.1', folder: 'Qwen 2.1', uses: 'Pictures: make and edit, relight' },
  { id: 'zimage', label: 'Z-Image Turbo', kind: 'image', bases: ['ZImageTurbo'], pattern: 'z[-_ ]?image|\\bzit\\b', folder: 'Z-Image', uses: 'Pictures: make, character design' },
  { id: 'sdxl', label: 'SDXL', kind: 'image', bases: ['SDXL 1.0', 'Pony', 'Illustrious'], pattern: 'sdxl|\\bxl\\b|[-_]xl[-_.]|pony|illustrious|noob', folder: 'SDXL', uses: 'Pictures: make' },
  { id: 'moss', label: 'Moss', kind: 'image', bases: [], pattern: 'moss', folder: 'Moss', uses: 'Pictures: make (Civitai has no Moss category; yours show under Yours)' }
]
const FAMILY_BY_BASE = new Map(LORA_FAMILIES.flatMap((f) => f.bases.map((b) => [b, f.id])))
const ALL_BASES = LORA_FAMILIES.flatMap((f) => f.bases)
export const familyById = (id) => LORA_FAMILIES.find((f) => f.id === id) || null
// Which family a LoRA is for: what Civitai says about it, else its folder or file name.
export function familyOf({ name = '', civitai = null } = {}) {
  if (civitai?.baseModel) return FAMILY_BY_BASE.get(civitai.baseModel) || null
  return LORA_FAMILIES.find((f) => new RegExp(f.pattern, 'i').test(name))?.id || null
}
// Filter chips: Civitai tags the H3 LoRAs most often carry (checked 2026-10-29).
export const LORA_TAGS = [
  ['', 'All'],
  ['style', 'Style'],
  ['concept', 'Concept'],
  ['cinematic', 'Cinematic'],
  ['motion', 'Motion'],
  ['camera', 'Camera'],
  ['effect', 'Effect'],
  ['turbo', 'Speed'],
  ['tool', 'Tool']
]
export const LORA_SORTS = ['Most Downloaded', 'Highest Rated', 'Newest']
const PREVIEW_WIDTH = 450
const FULL_WIDTH = 1280 // the LoRA pop-up's full view

// How a preview was made, from Civitai's generation data: the prompt and the main settings, when it has them.
function madeWith(meta) {
  if (!meta || typeof meta !== 'object') return null
  const pick = (k) => (meta[k] == null || meta[k] === '' ? null : String(meta[k]))
  const made = {
    prompt: pick('prompt')?.slice(0, 2000) || null,
    negative: pick('negativePrompt')?.slice(0, 800) || null,
    settings: [['Seed', 'seed'], ['Steps', 'steps'], ['CFG', 'cfgScale'], ['Sampler', 'sampler'], ['Size', 'Size']].map(([label, k]) => pick(k) && `${label} ${pick(k)}`).filter(Boolean)
  }
  return made.prompt || made.settings.length ? made : null
}
// Civitai's content levels are bit flags: 1 PG, 2 PG-13, 4 R, 8 X, 16 XXX. Safe mode shows PG and PG-13.
const SAFE_LEVEL = 2

const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2))
  fs.renameSync(`${file}.tmp`, file)
}
const slug = (s) => String(s || 'lora').replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g, '').slice(0, 60) || 'lora'
const now = () => new Date().toISOString()
// Civitai descriptions are HTML; the app shows plain text.
const plain = (html) =>
  String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()

// A small version of a Civitai picture or clip: 450 px wide (or width), clips transcoded to MP4.
export function previewUrl(img, width = PREVIEW_WIDTH) {
  try {
    const u = new URL(img.url)
    const [key, id, ...rest] = u.pathname.split('/').filter(Boolean)
    const last = rest.at(-1)
    const video = img.type === 'video'
    const name = last && last.includes('.') ? last.replace(/\.\w+$/, video ? '.mp4' : '.jpeg') : video ? 'preview.mp4' : 'preview.jpeg'
    return `${u.origin}/${key}/${id}/${video ? `transcode=true,width=${width},optimized=true` : `width=${width},optimized=true`}/${name}`
  } catch {
    return null
  }
}

export class Civitai {
  // key(): the person's Civitai API key or null. mature(): whether "Show mature LoRAs" is on.
  constructor({ dataDir, comfy, key = () => null, mature = () => false, onProgress }) {
    this.dir = path.join(dataDir, 'loras')
    this.comfy = comfy
    this.key = key
    this.mature = mature
    this.onProgress = onProgress || (() => {})
    this.downloads = new Map() // versionId -> {status, received, total, error, name}
  }

  site = () => (this.mature() ? CIVITAI_SITES.mature : CIVITAI_SITES.safe)
  libraryFile = () => path.join(this.dir, 'library.json')
  library = () => readJson(this.libraryFile(), { files: {}, prefs: {} })
  saveLibrary = (lib) => writeJson(this.libraryFile(), lib)

  async api(route, { timeout = 30000 } = {}) {
    const key = this.key()
    let res
    try {
      res = await fetch(`${this.site()}/api/v1${route}`, { headers: key ? { Authorization: `Bearer ${key}` } : {}, signal: AbortSignal.timeout(timeout) })
    } catch (err) {
      throw new Error(`Couldn't reach Civitai (${err.name === 'TimeoutError' ? 'it took too long' : err.message}).`)
    }
    if (res.status === 404) return null
    if (res.status === 401 || res.status === 403) throw new Error('Civitai refused the request. Check your Civitai API key in Settings.')
    if (!res.ok) throw new Error(`Civitai answered ${res.status}.`)
    return res.json()
  }

  // Whether a model, version or picture may be shown in the current mode.
  allowed(item) {
    if (!item || item.poi || item.minor) return false
    return this.mature() || (item.nsfwLevel ?? 1) <= SAFE_LEVEL || item.nsfw === false
  }
  // detail: also a large version (for the LoRA pop-up's full view) and how the picture was made, when Civitai says.
  previews(images, max = 6, detail = false) {
    return (images || [])
      .filter((i) => !i.poi && !i.minor && (this.mature() || (i.nsfwLevel ?? 1) <= SAFE_LEVEL))
      .slice(0, max)
      .map((i) => ({ url: previewUrl(i), type: i.type === 'video' ? 'video' : 'image', width: i.width, height: i.height, mature: (i.nsfwLevel ?? 1) > SAFE_LEVEL, ...(detail ? { full: previewUrl(i, FULL_WIDTH), made: madeWith(i.meta) } : {}) }))
      .filter((p) => p.url)
  }
  // The file a version downloads: its primary SafeTensors model file.
  pickFile(version) {
    const files = (version?.files || []).filter((f) => f.type === 'Model' || /\.safetensors$/i.test(f.name))
    return files.find((f) => f.primary) || files.find((f) => /\.safetensors$/i.test(f.name)) || files[0] || null
  }
  summary(m) {
    const v = m.modelVersions?.[0]
    const file = this.pickFile(v)
    const installed = this.installedShas()
    return {
      id: m.id,
      name: m.name,
      creator: m.creator?.username || null,
      tags: (m.tags || []).slice(0, 6),
      downloads: m.stats?.downloadCount || 0,
      likes: m.stats?.thumbsUpCount || 0,
      mature: !!m.nsfw,
      version: v ? { id: v.id, name: v.name, baseModel: v.baseModel, trainedWords: v.trainedWords || [] } : null,
      file: file ? { id: file.id, name: file.name, size: Math.round(file.sizeKB * 1024), sha256: file.hashes?.SHA256?.toLowerCase() || null } : null,
      // the newest version's clips, or an earlier version's when it has none to show
      previews: this.previews((m.modelVersions || []).find((x) => this.previews(x.images, 1).length)?.images, 2),
      installed: !!(file?.hashes?.SHA256 && installed.has(file.hashes.SHA256.toLowerCase()))
    }
  }

  // One page of a family's LoRAs (family: an id from LORA_FAMILIES, or 'all'). cursor: from the previous page's next.
  async search({ query = '', tag = '', sort = LORA_SORTS[0], cursor = null, limit = 24, family = 'h3' } = {}) {
    const fam = familyById(family)
    const bases = family === 'all' ? ALL_BASES : fam?.bases
    if (!bases) throw new Error(`Unknown model family "${family}". One of: ${LORA_FAMILIES.map((f) => f.id).join(', ')}, all.`)
    if (!bases.length) return { items: [], next: null, mature: this.mature(), none: `Civitai has no ${fam.label} category. Your own ${fam.label} LoRAs show under Yours.` }
    const q = new URLSearchParams({ types: 'LORA', limit: String(Math.min(Math.max(limit, 1), 100)), sort, nsfw: this.mature() ? 'true' : 'false' })
    for (const b of bases) q.append('baseModels', b)
    if (query.trim()) q.set('query', query.trim())
    if (tag) q.set('tag', tag)
    if (cursor) q.set('cursor', String(cursor))
    const page = await this.api(`/models?${q}`)
    const items = (page?.items || []).filter((m) => this.allowed(m)).map((m) => this.summary(m))
    return { items, next: page?.metadata?.nextCursor || null, mature: this.mature() }
  }

  // Everything about one model: its versions, example clips, trigger words, licence and description.
  async model(id) {
    const m = await this.api(`/models/${Number(id)}`)
    if (!m || !this.allowed(m)) throw new Error('That LoRA isn’t available here.')
    const installed = this.installedShas()
    return {
      ...this.summary(m),
      description: plain(m.description).slice(0, 4000),
      url: `${this.site()}/models/${m.id}`,
      licence: { commercial: (m.allowCommercialUse || []).length > 0, commercialUses: m.allowCommercialUse || [], derivatives: !!m.allowDerivatives, creditNeeded: !m.allowNoCredit },
      versions: (m.modelVersions || [])
        .filter((v) => FAMILY_BY_BASE.has(v.baseModel))
        .map((v) => {
          const f = this.pickFile(v)
          return { id: v.id, name: v.name, baseModel: v.baseModel, family: FAMILY_BY_BASE.get(v.baseModel), publishedAt: v.publishedAt, trainedWords: v.trainedWords || [], notes: plain(v.description).slice(0, 1500), file: f ? { id: f.id, name: f.name, size: Math.round(f.sizeKB * 1024), sha256: f.hashes?.SHA256?.toLowerCase() || null } : null, previews: this.previews(v.images, 16, true), installed: !!(f?.hashes?.SHA256 && installed.has(f.hashes.SHA256.toLowerCase())) }
        })
    }
  }

  // ---------- this PC's LoRAs ----------
  async loraFolders() {
    const folders = await this.comfy.req('/experiment/models')
    return folders.find((f) => f.name === 'loras')?.folders || []
  }
  installedShas() {
    return new Set(Object.values(this.library().files).map((f) => f.sha256).filter(Boolean))
  }

  // Every LoRA ComfyUI can load, with what's known about it.
  async yours() {
    const info = await this.comfy.objectInfo('LoraLoaderModelOnly')
    const names = comboOptions(info, 'LoraLoaderModelOnly', 'lora_name') || []
    const folders = await this.loraFolders()
    const lib = this.library()
    const items = []
    for (const name of names) {
      const file = folders.map((d) => path.join(d, ...name.split(/[\\/]/))).find((p) => fs.existsSync(p))
      const st = file ? fs.statSync(file) : null
      const known = lib.files[name]
      const fresh = known && st && known.size === st.size && known.mtime === st.mtimeMs
      const civitai = fresh ? known.civitai : null
      // the model it's for: the person's own choice, else what Civitai says, else the folder or file name
      const prefs = lib.prefs[name] || {}
      const family = prefs.family || familyOf({ name, civitai })
      items.push({ name, file: file || null, size: st?.size || null, sha256: fresh ? known.sha256 : null, civitai, checked: fresh ? known.checkedAt : null, family, h3: family === 'h3', prefs })
    }
    return items
  }

  // Hashes one installed LoRA and looks it up on Civitai; keeps the answer and a preview clip.
  async identify(name) {
    const items = await this.yours()
    const it = items.find((x) => x.name === name)
    if (!it?.file) throw new Error(`ComfyUI has no LoRA called ${name}.`)
    const st = fs.statSync(it.file)
    const hash = createHash('sha256')
    await pipeline(fs.createReadStream(it.file), new Transform({ transform: (c, _e, cb) => (hash.update(c), cb()) }))
    const sha256 = hash.digest('hex')
    const v = await this.api(`/model-versions/by-hash/${sha256}`)
    let civitai = null
    if (v && !v.poi && !v.minor && !v.model?.poi && !v.model?.minor) {
      const shown = this.previews(v.images, 1)[0] || null
      civitai = { modelId: v.modelId, versionId: v.id, name: v.model?.name || v.name, version: v.name, baseModel: v.baseModel, trainedWords: v.trainedWords || [], mature: !!v.model?.nsfw, preview: shown ? await this.cachePreview(v.id, shown).catch(() => null) : null }
    }
    const lib = this.library()
    lib.files[name] = { size: st.size, mtime: st.mtimeMs, sha256, civitai, checkedAt: now() }
    this.saveLibrary(lib)
    return { ...it, sha256, civitai, checked: lib.files[name].checkedAt }
  }

  // The person's own settings for a LoRA: favourite, strength, trigger words, whether they go in the prompt.
  setPrefs(name, patch) {
    const lib = this.library()
    const cur = lib.prefs[name] || {}
    if (patch.family != null && !familyById(patch.family)) throw new Error(`Unknown model family "${patch.family}".`)
    for (const k of ['favourite', 'strength', 'triggers', 'autoTrigger', 'picture', 'family']) if (patch[k] !== undefined) cur[k] = patch[k]
    if (cur.family === null) delete cur.family
    lib.prefs[name] = cur
    this.saveLibrary(lib)
    return cur
  }

  async cachePreview(versionId, preview) {
    const ext = preview.type === 'video' ? '.mp4' : '.jpeg'
    const file = path.join(this.dir, 'previews', `${versionId}${ext}`)
    if (fs.existsSync(file)) return { file, type: preview.type, mature: preview.mature }
    const res = await fetch(preview.url, { signal: AbortSignal.timeout(60000) })
    if (!res.ok) throw new Error(`preview ${res.status}`)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()))
    return { file, type: preview.type, mature: preview.mature }
  }

  // ---------- downloads ----------
  downloadState = () => Object.fromEntries(this.downloads)
  set(versionId, patch) {
    const s = { ...this.downloads.get(versionId), ...patch }
    this.downloads.set(versionId, s)
    this.onProgress({ versionId, ...s })
    return s
  }

  // Downloads a version's file into ComfyUI's loras folder (Civitai/<model>/), checked against the SHA-256
  // Civitai publishes. Returns the LoRA name ComfyUI loads it by.
  async download({ modelId, versionId }) {
    const key = this.key()
    if (!key) throw new Error('Downloading from Civitai needs your own Civitai API key: add it in Settings → Civitai. It’s free, from civitai.com → profile menu → Account settings → API keys.')
    const m = await this.model(modelId)
    const v = m.versions.find((x) => x.id === Number(versionId)) || m.versions[0]
    if (!v?.file) throw new Error('That version has no file to download.')
    if (this.downloads.get(v.id)?.status === 'downloading') throw new Error('That LoRA is already downloading.')
    const [root] = await this.loraFolders()
    if (!root) throw new Error('ComfyUI has no loras folder.')
    // H3 LoRAs keep their old place (loras/Civitai/<model>/); other families get a folder of their own
    const fam = familyById(FAMILY_BY_BASE.get(v.baseModel))
    const rel = fam && fam.id !== 'h3' ? path.join('Civitai', fam.folder, slug(m.name), v.file.name) : path.join('Civitai', slug(m.name), v.file.name)
    const target = path.join(root, rel)
    if (fs.existsSync(target)) return this.finish(m, v, target, rel)
    const part = `${target}.part`
    fs.mkdirSync(path.dirname(target), { recursive: true })
    const free = fs.statfsSync(path.dirname(target))
    if (free.bavail * free.bsize < v.file.size + 1024 ** 3) throw new Error(`Not enough free space for ${(v.file.size / 1024 ** 3).toFixed(1)} GB.`)
    this.set(v.id, { status: 'downloading', name: m.name, received: 0, total: v.file.size, error: null })
    try {
      // the key goes in the query: Civitai redirects to a signed storage URL, and a redirect drops headers
      const url = `${this.site()}/api/download/models/${v.id}?type=Model&format=SafeTensor&token=${encodeURIComponent(key)}`
      const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(6 * 60 * 60 * 1000) })
      if (res.status === 401 || res.status === 403) throw new Error('Civitai refused the download. Check your API key, and that this LoRA isn’t limited to early-access buyers.')
      if (!res.ok) throw new Error(`Civitai answered ${res.status}.`)
      const hash = createHash('sha256')
      let received = 0
      let last = 0
      const counter = new Transform({
        transform: (chunk, _e, cb) => {
          hash.update(chunk)
          received += chunk.length
          if (Date.now() - last > 500) {
            last = Date.now()
            this.set(v.id, { received })
          }
          cb(null, chunk)
        }
      })
      await pipeline(Readable.fromWeb(res.body), counter, fs.createWriteStream(part))
      this.set(v.id, { status: 'verifying', received })
      const digest = hash.digest('hex')
      if (v.file.sha256 && digest !== v.file.sha256) {
        fs.rmSync(part, { force: true })
        throw new Error('The download didn’t match the checksum Civitai publishes, so it was removed. Try again.')
      }
      fs.renameSync(part, target)
      return await this.finish(m, v, target, rel, digest)
    } catch (err) {
      this.set(v.id, { status: 'error', error: err.message })
      throw err
    }
  }

  async finish(m, v, target, rel, sha256 = v.file.sha256) {
    const st = fs.statSync(target)
    const lib = this.library()
    const shown = v.previews[0] || m.previews[0] || null
    lib.files[rel] = { size: st.size, mtime: st.mtimeMs, sha256, civitai: { modelId: m.id, versionId: v.id, name: m.name, version: v.name, baseModel: v.baseModel, trainedWords: v.trainedWords, mature: m.mature, preview: shown ? await this.cachePreview(v.id, shown).catch(() => null) : null }, checkedAt: now() }
    this.saveLibrary(lib)
    this.set(v.id, { status: 'done', received: st.size, path: target, lora: rel })
    return { lora: rel, path: target, sha256, name: m.name, trainedWords: v.trainedWords, family: FAMILY_BY_BASE.get(v.baseModel) || null }
  }
}
