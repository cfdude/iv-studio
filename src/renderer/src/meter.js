// What the title bar's memory meter shows, from the main process's system:stats ({ ram, gpu }). Pure, so it is tested
// without a window.
const GB = (b) => (b / 1024 ** 3).toFixed(1)

// An Apple Silicon Mac's GPU and RAM are one pool of unified memory (SB-25), so they are one meter, "Memory"; any
// other computer has a GPU meter (its own VRAM) and a RAM meter.
export function meterParts(st) {
  if (!st) return []
  const ram = { label: 'RAM', used: st.ram.total - st.ram.free, total: st.ram.total }
  if (!st.gpu) return [ram]
  if (st.gpu.unified) return [{ ...ram, label: 'Memory' }]
  return [{ label: 'GPU', used: st.gpu.total - st.gpu.free, total: st.gpu.total }, ram]
}

export function meterTitle(st) {
  if (!st) return ''
  if (st.gpu?.unified) return `Memory: ${GB(st.ram.total - st.ram.free)} of ${GB(st.ram.total)} GB in use. The graphics chip shares it with the rest of the Mac, so there is one meter${st.gpu.comfyHeld ? `; ComfyUI holds ${GB(st.gpu.comfyHeld)} GB of it` : ''}.`
  return [st.gpu && `${st.gpu.name}: ${GB(st.gpu.total - st.gpu.free)} of ${GB(st.gpu.total)} GB in use, ${GB(st.gpu.comfyHeld)} GB of it held by ComfyUI.`, `RAM: ${GB(st.ram.total - st.ram.free)} of ${GB(st.ram.total)} GB in use.`].filter(Boolean).join(' ')
}
