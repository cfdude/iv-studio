// Readiness check: is ComfyUI up, is there a capable GPU, are the node packs and models IV Studio needs there?
// Everything is read from ComfyUI itself (/system_stats and /object_info), so it works with any install.
import { findGpu, gpuDetail, gpuMemoryGb, lowMemoryAdvice, nonGpuDetail } from './gpu.js'

const TEMPLATE_SKIP = new Set(['PixaromaGroupSwitch', 'PixaromaLabel', 'MarkdownNote', 'Note'])

export function comboOptions(info, cls, input) {
  const spec = info[cls]?.input?.required?.[input] || info[cls]?.input?.optional?.[input]
  if (!spec) return null
  return Array.isArray(spec[0]) ? spec[0] : spec[1]?.options || []
}

export async function checkSetup({ comfy, template, manifest, characters }) {
  const items = []
  let stats
  try {
    stats = await comfy.systemStats()
    items.push({ id: 'comfyui', label: 'ComfyUI', status: 'ok', detail: `Version ${stats.system?.comfyui_version || '?'} at ${comfy.url}` })
  } catch (err) {
    items.push({ id: 'comfyui', label: 'ComfyUI', status: 'missing', detail: err.message, fix: 'Start ComfyUI, or set its address in Settings.' })
    return { ready: false, items }
  }

  const gpu = findGpu(stats.devices)
  const vramGb = gpuMemoryGb(gpu)
  items.push({
    id: 'gpu',
    label: 'GPU',
    status: !gpu ? 'missing' : vramGb && vramGb < 15 ? 'warn' : 'ok',
    detail: gpu ? gpuDetail(gpu) : nonGpuDetail(stats.devices),
    fix: gpu ? lowMemoryAdvice(gpu) : undefined
  })

  const info = await comfy.objectInfo()
  const needed = [...new Set(Object.values(template).map((n) => n.class_type))].filter((c) => !TEMPLATE_SKIP.has(c))
  const missingClasses = needed.filter((c) => !info[c])
  const linux = !['nt', 'win32'].includes(stats.system?.os)
  for (const pack of manifest.node_packs) {
    const miss = pack.classes.filter((c) => missingClasses.includes(c))
    // DLSS is Windows-only; on Linux (the cloud) IV Studio finishes with its own upscale + RIFE instead.
    if (miss.length && linux && pack.classes.includes('DLSS5_Enhance_Video')) {
      items.push({ id: `pack:${pack.label}`, label: pack.label, status: 'warn', detail: 'Windows only. Finals here use a 2× AI upscale and RIFE frame interpolation instead.', kind: 'node_pack' })
      continue
    }
    items.push({ id: `pack:${pack.label}`, label: pack.label, status: miss.length ? 'missing' : 'ok', detail: miss.length ? `Missing nodes: ${miss.join(', ')}` : 'Installed', fix: miss.length ? `Install from ${pack.url}, then restart ComfyUI.` : undefined, kind: 'node_pack', url: /^https:/.test(pack.url) ? pack.url : undefined })
  }
  const unknown = missingClasses.filter((c) => !manifest.node_packs.some((p) => p.classes.includes(c)))
  if (unknown.length) items.push({ id: 'pack:other', label: 'Other nodes', status: 'missing', detail: unknown.join(', '), kind: 'node_pack' })

  for (const m of manifest.models) {
    const [cls, input] = m.loader.split('.')
    const opts = comboOptions(info, cls, input) || []
    // optional: only for designing characters, so missing is a warning; alt: other names that count as present
    const names = [m.match, ...(m.alt || [])]
    const found = opts.find((o) => names.includes(o.replace(/\\/g, '/').split('/').pop()))
    items.push({ id: `model:${m.id}`, label: m.optional ? `${m.label} · for ${m.optionalFor || 'optional tools'}` : m.label, status: found ? 'ok' : m.optional ? 'warn' : 'missing', detail: found || `Not found (${m.match})`, fix: found ? undefined : `Download into models/${m.folder}`, kind: 'model', model: m.id, size: m.size, optional: !!m.optional, page: m.url.match(/^https:\/\/huggingface\.co\/[^/]+\/[^/]+/)?.[0] })
  }

  const loras = comboOptions(info, 'LoraLoaderModelOnly', 'lora_name') || []
  for (const c of characters) {
    const ok = loras.some((l) => l.replace(/\\/g, '/') === c.lora.replace(/\\/g, '/'))
    items.push({ id: `character:${c.id}`, label: `Character: ${c.name}`, status: ok ? 'ok' : 'warn', detail: ok ? c.lora : `LoRA not found: ${c.lora}`, kind: 'character' })
  }

  const blocking = items.filter((i) => i.status === 'missing')
  return { ready: blocking.length === 0, items, refmods: comboOptions(info, 'MiniMaxH3RefModsLoader', 'mod_1')?.filter((m) => m !== '(none)') || [], loras }
}
