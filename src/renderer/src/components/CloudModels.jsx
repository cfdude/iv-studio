import { useEffect, useState } from 'react'
import { ask } from './Confirm'

// The person's own cloud (RunPod, Modal) gets each model the first time a render needs it (cloudprep.js). The main
// process asks here before downloading anything into their cloud storage (cloud:ask), and reports how the download
// and this PC's LoRA uploads go (cloud:prep), shown as a small card at the bottom of the window.
const gb = (bytes) => `${Math.max(0.1, Math.round((bytes / 1e9) * 10) / 10)} GB`

export default function CloudModels() {
  const [state, setState] = useState(null)
  useEffect(() => {
    const offAsk = window.ivstudio.cloud.onAsk?.(async (q) => {
      const n = q.downloads.length
      const where = q.provider === 'runpod' ? 'your RunPod network volume' : 'your Modal storage'
      const details = q.downloads.map((d) => [gb(d.size || 0), d.label])
      if (q.grow) details.push(['Storage', `Grows from ${q.grow.fromGb} to ${q.grow.toGb} GB: about $${q.grow.monthlyUsd.toFixed(2)} more a month ($${q.grow.totalMonthlyUsd.toFixed(2)} a month in all) while you keep it`])
      const ok = await ask({
        kicker: 'Your cloud storage',
        title: `Download ${n === 1 ? 'a model' : `${n} models`} into ${where}?`,
        message: `This needs ${gb(q.bytes)} your cloud doesn’t have yet. It’s downloaded once and kept for next time${q.provider === 'runpod' ? ', in the cloud GPU you’re already using (billed by the second while it runs)' : ', on a CPU in your Modal account (a few cents)'}. Each file is checked against its published checksum.`,
        details,
        confirm: q.grow ? 'Grow storage and download' : 'Download'
      })
      window.ivstudio.cloud.answer({ id: q.id, ok })
    })
    let clear = null
    const offPrep = window.ivstudio.cloud.onPrep?.((e) => {
      clearTimeout(clear)
      if (e.state === 'done') return setState(null)
      setState((s) => ({ ...(e.state === 'downloading' && e.items ? { items: e.items } : { items: s?.items }), ...e }))
      if (e.state === 'error') clear = setTimeout(() => setState(null), 15000)
    })
    return () => (offAsk?.(), offPrep?.())
  }, [])
  if (!state) return null
  const pct = state.percent != null ? `${state.percent}%` : null
  const line =
    state.state === 'uploading'
      ? `Uploading ${state.label} to your cloud storage (${state.index} of ${state.count})`
      : state.state === 'waiting'
        ? state.detail
        : state.state === 'error'
          ? `The download stopped: ${state.error}`
          : state.label
            ? `Downloading ${state.label}${state.count > 1 ? ` (${state.index} of ${state.count})` : ''} into your cloud storage`
            : `Getting ${state.items?.length === 1 ? state.items[0].label : `${state.items?.length || ''} models`} ready in your cloud storage`
  return (
    <div className={`cloud-prep ${state.state === 'error' ? 'error' : ''}`} role="status" aria-live="polite">
      <span className="mono label">Cloud storage</span>
      <span className="cloud-prep-line">{line}</span>
      {pct && state.state === 'downloading' && (
        <span className="cloud-prep-bar" aria-hidden="true">
          <span style={{ width: pct }} />
        </span>
      )}
      {pct && state.state === 'downloading' && <span className="mono small">{pct}</span>}
      <span className="dim small">The render starts by itself when it’s done.</span>
    </div>
  )
}
