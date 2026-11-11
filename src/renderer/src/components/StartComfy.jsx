import { useEffect, useState } from 'react'

// "Start ComfyUI": runs the person's own ComfyUI launcher (Settings → ComfyUI) and rechecks once it answers.
// Shown in the title bar and on Setup while ComfyUI on this PC isn't running.
export default function StartComfy({ notify, recheck, className = 'btn btn-small' }) {
  const [state, setState] = useState(null)
  useEffect(() => {
    window.ivstudio.comfy.launcher().then((l) => l.starting && setState('starting')).catch(() => {})
    return window.ivstudio.comfy.onState((s) => {
      setState(s.state === 'starting' ? 'starting' : null)
      if (s.state === 'up') recheck?.()
      if (s.state === 'failed') notify?.(s.detail)
    })
  }, [])
  async function start() {
    setState('starting')
    try {
      await window.ivstudio.comfy.start()
      recheck?.()
    } catch (err) {
      notify?.(err.message)
    } finally {
      setState(null)
    }
  }
  return (
    <button className={className} disabled={state === 'starting'} onClick={start} title="Start ComfyUI with your own launcher (Settings → ComfyUI)">
      {state === 'starting' ? 'Starting ComfyUI…' : 'Start ComfyUI'}
    </button>
  )
}

// "Restart ComfyUI": after installing node packs or models, or when ComfyUI misbehaves. ComfyUI-Manager's own
// restart when it's there, else IV Studio stops this ComfyUI and starts it again with your launcher
// (main: comfy:restart). When ComfyUI is rendering it asks first: the button turns into "Restart anyway".
export function RestartComfy({ notify, recheck, className = 'btn btn-small', label = 'Restart ComfyUI' }) {
  const [state, setState] = useState(null) // null | 'restarting' | { busy: message }
  useEffect(
    () =>
      window.ivstudio.comfy.onState((s) => {
        if (s.state === 'restarting') setState('restarting')
        if (s.state === 'up' || s.state === 'failed') setState((x) => (x === 'restarting' ? null : x))
      }),
    []
  )
  async function restart(force = false) {
    setState('restarting')
    try {
      const r = await window.ivstudio.comfy.restart({ force })
      if (r?.busy) return setState({ busy: r.message })
      setState(null)
      notify?.(r?.restarted ? `ComfyUI restarted in ${r.seconds} s.` : 'ComfyUI started.', 'info')
      recheck?.()
    } catch (err) {
      setState(null)
      notify?.(err.message)
    }
  }
  if (state?.busy)
    return (
      <span className="restart-ask">
        <span className="small pink">{state.busy}</span>
        <button className={`${className} danger`} onClick={() => restart(true)}>
          Restart anyway
        </button>
        <button className="link-btn mono small" onClick={() => setState(null)}>
          Wait
        </button>
      </span>
    )
  return (
    <button className={className} disabled={state === 'restarting'} onClick={() => restart(false)} title="Restart this computer’s ComfyUI, e.g. after installing node packs or models">
      {state === 'restarting' ? 'Restarting ComfyUI…' : label}
    </button>
  )
}
