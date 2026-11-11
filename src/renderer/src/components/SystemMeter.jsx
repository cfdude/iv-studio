import { useEffect, useState } from 'react'

// The title bar's GPU and memory readout (Valtz's idea): VRAM in use on this PC's GPU and RAM in use, refreshed
// every few seconds while the window is visible. Over 90% turns red, which is when a render starts swapping.
const GB = (b) => (b / 1024 ** 3).toFixed(1)
const EVERY = 4000

export default function SystemMeter({ notify }) {
  const [st, setSt] = useState(null)
  const [freeing, setFreeing] = useState(false)
  useEffect(() => {
    let live = true
    const read = () => document.visibilityState === 'visible' && window.ivstudio.system.stats().then((s) => live && setSt(s), () => {})
    read()
    const t = setInterval(read, EVERY)
    // back from hidden: read now, not up to 4 s later with the numbers from before it was hidden
    document.addEventListener('visibilitychange', read)
    return () => {
      live = false
      clearInterval(t)
      document.removeEventListener('visibilitychange', read)
    }
  }, [])
  // Free memory: what IV Studio and ComfyUI hold, let go of now (ComfyUI waits for a running render to finish)
  async function free() {
    setFreeing(true)
    try {
      const r = await window.ivstudio.system.free()
      const gb = (a, b) => (a != null && b != null ? Math.max(0, (a - b) / 1024 ** 3) : null)
      const v = gb(r.before.vram, r.after.vram)
      const m = gb(r.before.ram, r.after.ram) // an Apple GPU is the same memory as RAM: say it once
      notify?.(r.busy ? 'A render is running: ComfyUI frees its memory when it finishes.' : `Freed ${v != null ? `${v.toFixed(1)} GB of GPU memory` : 'GPU memory'}${m != null && m >= 0.1 && st?.gpu?.name !== 'Apple GPU' ? ` and ${m.toFixed(1)} GB of RAM` : ''}.`, 'info')
      window.ivstudio.system.stats().then(setSt, () => {})
    } catch (err) {
      notify?.(err.message)
    } finally {
      setFreeing(false)
    }
  }
  if (!st) return null
  const parts = []
  if (st.gpu) parts.push({ label: 'GPU', used: st.gpu.total - st.gpu.free, total: st.gpu.total })
  parts.push({ label: 'RAM', used: st.ram.total - st.ram.free, total: st.ram.total })
  const full = parts.some((p) => p.used / p.total > 0.9)
  const title = [st.gpu && `${st.gpu.name}: ${GB(st.gpu.total - st.gpu.free)} of ${GB(st.gpu.total)} GB in use, ${GB(st.gpu.comfyHeld)} GB of it held by ComfyUI.`, `RAM: ${GB(st.ram.total - st.ram.free)} of ${GB(st.ram.total)} GB in use.`].filter(Boolean).join(' ')
  return (
    <span className="system-meter mono" title={title}>
      {parts.map((p) => {
        const share = p.used / p.total
        return (
          <span key={p.label} className={`system-meter-part ${share > 0.9 ? 'full' : ''}`}>
            {p.label} {GB(p.used)}/{GB(p.total)}
            <span className="system-meter-bar">
              <span style={{ width: `${Math.min(100, share * 100)}%` }} />
            </span>
          </span>
        )
      })}
      <button
        className={`system-free ${full ? 'urge' : ''}`}
        disabled={freeing}
        onClick={free}
        aria-label="Free GPU and RAM memory"
        title={`Free up GPU and RAM memory now${full ? ' (it’s nearly full)' : ''}: ComfyUI unloads its models (after a running render finishes), IV Studio’s voice engine stops, and the prompt writer lets go. Nothing is deleted; the next render loads what it needs again.`}
      >
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
          <rect x="3.5" y="3.5" width="9" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path d="M6 1.5v2M10 1.5v2M6 12.5v2M10 12.5v2M1.5 6h2M1.5 10h2M12.5 6h2M12.5 10h2" stroke="currentColor" strokeWidth="1.2" />
          <path d="M8 10.2V5.8M6.2 7.4 8 5.6l1.8 1.8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="system-free-label">{freeing ? 'Freeing…' : 'Free memory'}</span>
      </button>
    </span>
  )
}
