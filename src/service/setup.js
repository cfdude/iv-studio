// Readiness check: is ComfyUI up, is there a capable GPU, are the node packs and models IV Studio needs there?
// Everything is read from ComfyUI itself (/system_stats and /object_info), so it works with any install.

import fs from 'node:fs'
import path from 'node:path'
import { findComfyElsewhere } from './comfylauncher.js'
import { appleUpscalerCheck, findGpu, gpuCheck } from './gpu.js'
import { packVersion } from './nodepacks.js'

// Why a ComfyUI request failed, as a Setup item's status, detail and fix:
// - busy: ComfyUI took the connection but didn't answer in time (loading, rendering or short on memory); it's running,
//   so nobody is told to start it.
// - down: nothing listens there. When a ComfyUI answers on another usual port of this PC (the ComfyUI Desktop app's
//   8000, say), address is that one, for "Use this address".
export async function whyUnreached(comfy, err, { ports } = {}) {
  if (err?.busy && !comfy.remote) return { status: 'warn', busy: true, detail: err.message, fix: 'IV Studio checks again by itself in a few seconds.' }
  const elsewhere = err?.down && !comfy.remote ? await findComfyElsewhere(comfy.url, ports ? { ports } : {}).catch(() => null) : null
  if (elsewhere) return { status: 'missing', down: true, address: elsewhere, detail: `Nothing answers at ${comfy.url}, but a ComfyUI answers at ${elsewhere}.`, fix: `Use ${elsewhere} as ComfyUI’s address (Settings → ComfyUI).` }
  return { status: 'missing', down: !!err?.down, detail: err?.message || String(err), fix: 'Start ComfyUI, or set its address in Settings.' }
}

const TEMPLATE_SKIP = new Set(['PixaromaGroupSwitch', 'PixaromaLabel', 'MarkdownNote', 'Note'])

export function comboOptions(info, cls, input) {
  const spec = info[cls]?.input?.required?.[input] || info[cls]?.input?.optional?.[input]
  if (!spec) return null
  return Array.isArray(spec[0]) ? spec[0] : spec[1]?.options || []
}

const base = (o) => o.replace(/\\/g, '/').split('/').pop()
// Which workflows each model's pick in Settings → Models covers (plan.js: text, frames and continue run fl2va).
const PICKS = { fl2va: ['text', 'frames', 'continue'], ref2va: ['reference', 'take', 'retake'] }

// The file this ComfyUI has for a model: IV Studio's own build (match, alt), else another version of the same
// model (accept: patterns, like the fp8 or NVFP4 build ComfyUI's templates download), else the one picked in
// Settings → Models. { file, how: 'exact' | 'version' | 'picked' } or null. Files in subfolders keep their path.
export function resolveModel(m, opts, chosen = {}) {
  const names = [m.match, ...(m.alt || [])]
  const exact = opts.find((o) => names.includes(base(o)))
  if (exact) return { file: exact, how: 'exact' }
  const version = (m.accept || []).map((a) => new RegExp(a, 'i')).reduce((hit, re) => hit || opts.find((o) => re.test(base(o))), null)
  if (version) return { file: version, how: 'version' }
  // acceptPath: patterns on the whole name, folder included (a picture model's fine-tunes in its own folder, as
  // Create → Image reads the family)
  const inFolder = (m.acceptPath || []).map((a) => new RegExp(a, 'i')).reduce((hit, re) => hit || opts.find((o) => re.test(o)), null)
  if (inFolder) return { file: inFolder, how: 'version' }
  const pick = (PICKS[m.id] || []).map((k) => chosen[k]).find((f) => f && opts.includes(f))
  return pick ? { file: pick, how: 'picked' } : null
}

// The files ComfyUI lists for a model: its loader's, and altLoader's (the latent upscaler is read by the LBH node
// pack or, on ComfyUI 0.44+, by ComfyUI's own loader, from the same folder). null when neither loader is there.
export function modelOptions(info, m) {
  const lists = [m.loader, m.altLoader].filter(Boolean).map((l) => comboOptions(info, ...l.split('.'))).filter(Boolean)
  return lists.length ? [...new Set(lists.flat())] : null
}

// For every model, the name this ComfyUI lists it under (Comfy.submit swaps it into every graph, matched by file
// name: IV Studio's graphs may name a file in a subfolder, such as "Minimax H3\", that this ComfyUI keeps at the top
// of its models folder, or the other way round; GitHub #29). Required models may be another version of the file;
// optional ones only the same file, in whatever folder (an optional picture model is never swapped for a fine-tune).
// info needs only the models' loader nodes.
export function modelFileMap(manifest, info, chosen = {}) {
  const map = {}
  for (const m of manifest.models) {
    const r = resolveModel(m, modelOptions(info, m) || [], m.optional ? {} : chosen)
    if (r && (!m.optional || r.how === 'exact')) map[m.match] = r.file
  }
  return map
}

export const fileBase = base

// Two LoRA names are the same file when they differ only by separator ('\\' from Windows, '/' from a Mac or Linux
// ComfyUI). Case counts: ComfyUI takes the exact name from its list, so a different case fails at render time.
export const sameLora = (a, b) => String(a || '').replace(/\\/g, '/') === String(b || '').replace(/\\/g, '/')

// catalog: the ready-made characters IV Studio ships ({ id, lora }); a saved character with one of those ids can be
// downloaded even if its saved record doesn't say so (a record copied from another computer has no catalog flag).
export async function checkSetup({ comfy, template, manifest, characters, chosen = {}, catalog = [] }) {
  const items = []
  let stats
  try {
    stats = await comfy.systemStats()
    items.push({ id: 'comfyui', label: 'ComfyUI', status: 'ok', detail: `Version ${stats.system?.comfyui_version || '?'} at ${comfy.url}` })
  } catch (err) {
    items.push({ id: 'comfyui', label: 'ComfyUI', ...(await whyUnreached(comfy, err)) })
    return { ready: false, items }
  }

  // Comfy Cloud reports no devices: it runs each job on one of Comfy's own GPUs
  if (comfy.hosted) items.push({ id: 'gpu', label: 'GPU', status: 'ok', detail: `Comfy Cloud's GPUs${stats.system?.cloud_version ? ` · cloud ${stats.system.cloud_version}` : ''}` })
  else items.push({ id: 'gpu', label: 'GPU', ...gpuCheck(stats.devices) })

  const info = await comfy.objectInfo()
  const upscaler = comfy.hosted ? null : appleUpscalerCheck(stats.devices, info)
  if (upscaler) items.push({ id: 'gpu-upscaler', label: 'ComfyUI version', ...upscaler })
  const needed = [...new Set(Object.values(template).map((n) => n.class_type))].filter((c) => !TEMPLATE_SKIP.has(c))
  const missingClasses = needed.filter((c) => !info[c])
  const linux = !['nt', 'win32'].includes(stats.system?.os)
  // A pack whose folder is already in custom_nodes but whose nodes ComfyUI lacks was installed after ComfyUI started:
  // it loads on the next restart. Only this PC's ComfyUI says where its custom_nodes are.
  let customNodes = null
  if (!comfy.remote) {
    try {
      const paths = await comfy.req('/internal/folder_paths', { timeout: 8000 })
      customNodes = (paths.custom_nodes || []).map((x) => (Array.isArray(x) ? x[0] : x)).filter(Boolean)
    } catch {}
  }
  const onDisk = (dir) => !!dir && !!customNodes?.some((d) => fs.existsSync(path.join(d, dir)))
  // ComfyUI writes __pycache__ into a pack's folder when it imports it, so a pack folder that has one was already
  // loaded once: if its nodes are still missing, the import failed and another restart won't change that.
  const triedToLoad = (dir) => !!customNodes?.some((d) => fs.existsSync(path.join(d, dir, '__pycache__')))
  // a pack for CUDA only (SeedVR2) is never asked of an Apple GPU; no GPU reported (Comfy Cloud, CPU) leaves it alone
  const gpuKind = findGpu(stats.devices)?.type || null
  // Shots need the packs in the workflow; the others are for one feature each (Sequences, Replace, SeedVR2...).
  for (const pack of manifest.node_packs) {
    if (pack.cudaOnly && gpuKind && gpuKind !== 'cuda') continue
    if ((linux && pack.windowsOnly) || (!linux && pack.linuxOnly)) {
      // DLSS is Windows-only; on Linux (the cloud) IV Studio finishes with its own upscale + RIFE instead.
      if (pack.windowsOnly && pack.classes.some((c) => missingClasses.includes(c))) items.push({ id: `pack:${pack.label}`, label: pack.label, status: 'warn', detail: 'Windows only. Finals here use a 2× AI upscale and RIFE frame interpolation instead.', kind: 'node_pack', for: pack.for })
      continue
    }
    const miss = pack.classes.filter((c) => (needed.includes(c) ? missingClasses.includes(c) : !info[c]))
    // a pack this ComfyUI now has built in (the H3 latent upscaler, ComfyUI 0.44+): IV Studio uses ComfyUI's own nodes
    if (miss.length && pack.builtIn?.every((c) => info[c])) {
      items.push({ id: `pack:${pack.label}`, label: pack.label, status: 'ok', detail: `Built into this ComfyUI${stats.system?.comfyui_version ? ` (${stats.system.comfyui_version})` : ''}, so the node pack isn't needed`, kind: 'node_pack', for: pack.for, dir: pack.dir })
      continue
    }
    const core = pack.classes.some((c) => needed.includes(c))
    const outdated = pack.bundled && pack.version && customNodes?.some((d) => fs.existsSync(path.join(d, pack.dir)) && packVersion(path.join(d, pack.dir)) < pack.version)
    if (miss.length && outdated) {
      items.push({ id: `pack:${pack.label}`, label: pack.label, status: 'warn', detail: `A newer version comes with IV Studio (missing nodes: ${miss.join(', ')})`, fix: 'Install the missing node packs to update it, then restart ComfyUI.', kind: 'node_pack', for: pack.for, dir: pack.dir })
      continue
    }
    if (miss.length && onDisk(pack.dir) && triedToLoad(pack.dir)) {
      items.push({ id: `pack:${pack.label}`, label: pack.label, status: core ? 'missing' : 'warn', detail: 'Installed but failed to load. ComfyUI tried and left out its nodes.', fix: 'See ComfyUI’s log (the window or terminal ComfyUI runs in) for the error. A missing Python requirement is the usual cause.', kind: 'node_pack', for: pack.for, dir: pack.dir, loadFailed: true })
      continue
    }
    if (miss.length && onDisk(pack.dir)) {
      items.push({ id: `pack:${pack.label}`, label: pack.label, status: core ? 'missing' : 'warn', detail: 'Installed. ComfyUI loads it when it restarts.', fix: 'Restart ComfyUI to load it.', kind: 'node_pack', for: pack.for, dir: pack.dir, restartNeeded: true })
      continue
    }
    const status = !miss.length ? 'ok' : core ? 'missing' : 'warn'
    items.push({ id: `pack:${pack.label}`, label: pack.label, status, detail: miss.length ? `Missing nodes: ${miss.join(', ')}` : 'Installed', fix: miss.length ? (core ? 'Needed for every shot. Install the missing node packs above, then restart ComfyUI.' : `Needed for ${pack.for}.`) : undefined, kind: 'node_pack', for: pack.for, dir: pack.dir, url: /^https:/.test(pack.url) ? pack.url : undefined })
  }
  const unknown = missingClasses.filter((c) => !manifest.node_packs.some((p) => p.classes.includes(c)))
  if (unknown.length) items.push({ id: 'pack:other', label: 'Other nodes', status: 'missing', detail: unknown.join(', '), kind: 'node_pack' })

  for (const m of manifest.models) {
    const opts = modelOptions(info, m) || []
    // optional: only for one tool, so missing is a warning; alt/accept: other names and versions that count as present
    const r = resolveModel(m, opts, chosen)
    const found = r?.file
    const detail = !r ? `Not found (${m.match})` : r.how === 'version' ? `${found} · another version of ${m.match}, used in its place` : r.how === 'picked' ? `${found} · your pick in Settings → Models` : found
    items.push({ id: `model:${m.id}`, label: m.optional ? `${m.label} · for ${m.optionalFor || 'optional tools'}` : m.label, status: found ? 'ok' : m.optional ? 'warn' : 'missing', detail, fix: found ? undefined : `Download into models/${m.folder}`, kind: 'model', model: m.id, size: m.size, optional: !!m.optional, name: m.label, for: m.optional ? m.optionalFor || 'Optional tools' : undefined, page: m.url.match(/^https:\/\/huggingface\.co\/[^/]+\/[^/]+/)?.[0], gated: m.gated || undefined })
  }

  const loras = comboOptions(info, 'LoraLoaderModelOnly', 'lora_name') || []
  const refmodNames = comboOptions(info, 'MiniMaxH3RefModsLoader', 'mod_1') || []
  for (const c of characters) {
    // a RefMod character (refmods.js) needs its RefMod; any other its LoRA
    if (!c.lora && c.refmod) {
      const has = refmodNames.includes(c.refmod)
      items.push({ id: `character:${c.id}`, label: `Character: ${c.name}`, status: has ? 'ok' : 'warn', detail: has ? `RefMod ${c.refmod}` : `RefMod not found: ${c.refmod}`, kind: 'character' })
      continue
    }
    const ok = !!c.lora && loras.some((l) => sameLora(l, c.lora))
    // only the ready-made character's own LoRA can be downloaded: a person's character that reuses its id has another
    // LoRA, and Download would overwrite it
    const shipped = !!c.catalog || catalog.some((e) => e.id === c.id && e.lora?.file && sameLora(c.lora, `${e.lora.folder}/${e.lora.file}`))
    items.push({ id: `character:${c.id}`, label: `Character: ${c.name}`, status: ok ? 'ok' : 'warn', detail: ok ? c.lora : `LoRA not found: ${c.lora}`, kind: 'character', download: !ok && shipped ? c.id : undefined })
  }

  const blocking = items.filter((i) => i.status === 'missing')
  return { ready: blocking.length === 0, items, refmods: comboOptions(info, 'MiniMaxH3RefModsLoader', 'mod_1')?.filter((m) => m !== '(none)') || [], loras }
}
