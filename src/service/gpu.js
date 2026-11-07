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

// The title bar's GPU segment from /system_stats: null without a cuda or mps device.
export function statsReadout(stats) {
  const d = findGpu(stats?.devices)
  return { gpu: d ? { name: gpuLabel(d), total: d.vram_total, free: d.vram_free, comfyHeld: d.torch_vram_total } : null }
}

export const SEEDVR2_MPS_MESSAGE = 'SeedVR2 isn\'t available on an Apple GPU yet.'

// SeedVR2 is pinned to a CUDA device. Returns the refusal for an Apple GPU, else null.
// `kind` is the GPU type from capabilities() ('cuda', 'mps' or null).
export function seedvr2Refusal(kind) {
  return kind === 'mps' ? SEEDVR2_MPS_MESSAGE : null
}
