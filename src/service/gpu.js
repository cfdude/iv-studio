// One rule for "the GPU": a device of the connected ComfyUI (from /system_stats `devices`).
// The first cuda device, else the first mps (Apple) device, else none. Setup, music, the title-bar readout and the
// SeedVR2 decision all read it from here, so they cannot disagree. Pure: no Node imports, no I/O.

const GB = 1024 ** 3

// The GPU: first cuda, else first mps, else null.
export function findGpu(devices) {
  const list = Array.isArray(devices) ? devices : []
  return list.find((d) => d?.type === 'cuda') || list.find((d) => d?.type === 'mps') || null
}

// Total memory of a device in GB (VRAM for cuda, unified memory for mps); 0 when it reports none.
export function gpuMemoryGb(device) {
  const bytes = Number(device?.vram_total)
  return bytes > 0 ? bytes / GB : 0
}

// A short name: the cuda card name cleaned ("cuda:0 NVIDIA GeForce RTX 4090 : cudaMallocAsync" -> "NVIDIA GeForce RTX 4090"),
// or "Apple GPU" for mps.
export function gpuLabel(device) {
  if (device?.type === 'mps') return 'Apple GPU'
  return String(device?.name ?? '')
    .replace(/^cuda:\d+\s+/, '')
    .replace(/\s+:\s*\w+$/, '')
}

// The label with its memory, as the setup check shows it.
export function gpuDetail(device) {
  const gb = gpuMemoryGb(device).toFixed(0)
  return device?.type === 'mps' ? `Apple GPU · ${gb} GB unified memory` : `${gpuLabel(device)} · ${gb} GB`
}

// Advice for a GPU with under 16 GB (a 16 GB device reports about 15). VRAM for cuda, memory for mps.
export function lowMemoryAdvice(device) {
  const gb = gpuMemoryGb(device)
  if (!gb || gb >= 15) return undefined
  return `Under 16 GB of ${device.type === 'mps' ? 'memory' : 'VRAM'}: keep previews at 0.4 MP and finals at or below 1.5 MP.`
}

// Why ComfyUI has no usable GPU, for the setup check, when findGpu(devices) is null.
export function nonGpuDetail(devices) {
  const list = Array.isArray(devices) ? devices.filter(Boolean) : []
  if (!list.length) return 'No GPU reported'
  // Name an accelerator we do not support before a plain CPU entry.
  const other = list.find((d) => d.type !== 'cpu')
  if (!other) return 'cpu (not a GPU)'
  return `${other.name || other.type} (not supported yet)`
}

// The title bar's GPU segment from /system_stats: null without a cuda or mps device. An Apple GPU shares the Mac's
// one pool of memory, so its "in use" is the same figure as RAM's (`unified` = { total, free } from ramReadout):
// ComfyUI's own free number comes from the OS's free/available page count, which reads cached memory as used.
export function statsReadout(stats, unified) {
  const d = findGpu(stats?.devices)
  if (!d) return { gpu: null }
  const apple = d.type === 'mps' && unified?.total > 0
  return { gpu: { name: gpuLabel(d), total: apple ? unified.total : d.vram_total, free: apple ? unified.free : d.vram_free, comfyHeld: d.torch_vram_total } }
}

export const SEEDVR2_MPS_MESSAGE = 'SeedVR2 isn\'t available on an Apple GPU yet.'

// SeedVR2 is pinned to a CUDA device. Returns the refusal for an Apple GPU, else null.
// `kind` is the GPU type from capabilities() ('cuda', 'mps' or null).
export function seedvr2Refusal(kind) {
  return kind === 'mps' ? SEEDVR2_MPS_MESSAGE : null
}

export const APPLE_UPSCALER_FIX = "Update ComfyUI to 0.44 or newer. Older versions can't upscale H3 video on an Apple GPU."

// The setup check's GPU item for a local ComfyUI: { status, detail, fix }.
// cuda and mps are judged alike: ok at 15 GB or more, else a warning with the size advice. On an Apple GPU the
// H3 upscaler also needs ComfyUI 0.44+ (see appleUpscalerCheck), which is a separate item.
export function gpuCheck(devices) {
  const gpu = findGpu(devices)
  if (!gpu) return { status: 'missing', detail: nonGpuDetail(devices), fix: undefined }
  const gb = gpuMemoryGb(gpu)
  return { status: gb < 15 ? 'warn' : 'ok', detail: gpuDetail(gpu), fix: lowMemoryAdvice(gpu) }
}

// On an Apple GPU, H3's latent upscaler node pack only takes cuda, rocm or cpu, so the app needs ComfyUI's built-in
// one (0.44+). Returns a blocking item when it is missing, else null (also null for any other GPU).
// `objectInfo` is ComfyUI's /object_info.
export function appleUpscalerCheck(devices, objectInfo) {
  if (findGpu(devices)?.type !== 'mps') return null
  if (objectInfo?.MiniMaxH3LatentUpscaleWithModel && objectInfo?.LatentUpscaleModelLoader) return null
  return { status: 'missing', detail: "This ComfyUI doesn't have H3's built-in upscaler", fix: APPLE_UPSCALER_FIX }
}
