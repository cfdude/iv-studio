import { useEffect, useRef, useState } from 'react'
import Hero from './Hero'
import { ask } from './Confirm'
import { rendersFolderText } from '../../../shared/platform'
import { secretRemedy } from '../../../service/secrets'
import { usePlatform } from '../platform'

// The title-bar meter while rendering in the cloud: GPU time and its estimated cost since IV Studio opened,
// ticking while a GPU is up. Modal is asked every 30 s which containers run; each one counts from its own
// start until it was last seen. Clicking it opens the Cloud page (Shut down GPU is there).
const seen = new Map() // container id -> { start, last }, kept while the window is open
const clock = (s) => {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(Math.floor(s % 60)).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}
export function CloudMeter({ onOpen }) {
  const [usage, setUsage] = useState(null)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    let live = true
    const poll = () =>
      window.ivstudio.cloud
        .usage()
        .then((u) => {
          if (!live) return
          const t = Date.now()
          for (const c of u.running) seen.set(c.id, { start: c.startedAt || t, last: t })
          setUsage(u)
        })
        .catch(() => {})
    poll()
    const p = setInterval(poll, 30000)
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => {
      live = false
      clearInterval(p)
      clearInterval(tick)
    }
  }, [])
  if (!usage) return null
  const on = usage.running.length > 0
  const ids = new Set(usage.running.map((c) => c.id))
  const seconds = [...seen].reduce((sum, [id, c]) => sum + Math.max(0, ((ids.has(id) ? now : c.last) - c.start) / 1000), 0)
  const cost = (seconds / 3600) * usage.perHour
  return (
    <button className={`mono cloud-meter ${on ? 'on' : ''}`} onClick={onOpen} title={`Cloud GPU time and estimated cost since IV Studio opened (${usage.gpu} at $${usage.perHour.toFixed(2)} an hour, billed by the second). Click for the Cloud page.`}>
      <span className="cloud-meter-dot" />
      {on ? 'GPU on' : 'GPU off'} · {clock(seconds)} · ${cost.toFixed(2)}
    </button>
  )
}

// Shuts the cloud GPU down now, on top of the idle timer. On the Cloud page.
export function ShutDownGpu({ notify, className = 'btn btn-small' }) {
  const [stopping, setStopping] = useState(false)
  async function stop() {
    const ok = await ask({
      title: 'Shut down the cloud GPU?',
      message: 'The cloud stops it now, so billing stops now too. A render running in the cloud is lost. The next render wakes the GPU again (about 1–3 minutes on Modal, 2–5 on RunPod).',
      confirm: 'Shut down GPU'
    })
    if (!ok) return
    setStopping(true)
    try {
      const { stopped } = await window.ivstudio.cloud.stop()
      notify(stopped ? 'Cloud GPU shut down. Billing has stopped.' : 'The cloud GPU was already off.')
    } catch (err) {
      notify(err.message)
    } finally {
      setStopping(false)
    }
  }
  return (
    <button className={className} disabled={stopping} onClick={stop} title="Stop the cloud GPU now instead of waiting for it to idle off">
      {stopping ? 'Shutting down…' : 'Shut down GPU'}
    </button>
  )
}

const IDLE = [
  [180, '3 min'],
  [300, '5 min'],
  [600, '10 min'],
  [1200, '20 min']
]

function Step({ n, title, done, children }) {
  return (
    <section className={`group cloud-step ${done ? 'done' : ''}`}>
      <div className="group-head">
        <h2>
          <span className="mono dim cloud-n">{String(n).padStart(2, '0')}</span> {title}
        </h2>
        <p className={`mono small ${done ? 'cloud-ok' : 'dim'}`}>{done ? '● Done' : 'To do'}</p>
      </div>
      <div className="group-body">{children}</div>
    </section>
  )
}

// RunPod: the person's API key, a GPU and shut-off time, then Set up (volume, install, models, characters).
function RunPodSteps({ st, busy, run, notify, refresh, links }) {
  const rp = st.runpod || {}
  const [key, setKey] = useState('')
  const [gpus, setGpus] = useState(st.runpodGpus.map((g) => ({ ...g, inStock: null })))
  const [gpu, setGpu] = useState(rp.gpu || st.runpodGpus[0].id)
  const [idle, setIdle] = useState(rp.idleSeconds || 300)
  useEffect(() => {
    if (rp.hasKey) window.ivstudio.cloud.runpodCatalog().then(setGpus).catch(() => {})
  }, [rp.hasKey])
  const chosen = gpus.find((g) => g.id === gpu)
  async function saveKey(k) {
    await run(k ? 'Checking the key' : 'Removing the key', async () => {
      await window.ivstudio.cloud.runpodKey(k)
      setKey('')
      if (k) notify('RunPod key saved (encrypted on this PC).')
    })
    refresh()
  }
  return (
    <>
      <Step n={1} title="RunPod account" done={!!rp.hasKey}>
        {rp.hasKey ? (
          <p className="small">
            A RunPod API key is saved (encrypted on this PC).{' '}
            <button className="link-btn" disabled={!!busy} onClick={() => saveKey('')}>
              Remove it
            </button>
          </p>
        ) : (
          <>
            {st.removable?.includes('runpodKey') && (
              <p className="small dim">
                The saved RunPod key can’t be used.{' '}
                <button className="link-btn" disabled={!!busy} onClick={() => saveKey('')}>
                  Remove it
                </button>
              </p>
            )}
            <div className="key-form">
              <input type="password" value={key} placeholder="RunPod API key (rpa_…)" onChange={(e) => setKey(e.target.value)} autoComplete="off" />
              <button className="btn btn-small" disabled={!!busy || !key.trim()} onClick={() => saveKey(key.trim())}>
                Save
              </button>
            </div>
            <p className="small dim">
              New to RunPod?{' '}
              <button className="link-btn" onClick={() => window.ivstudio.links.open(links?.runpodSignup || 'https://www.runpod.io')}>
                Create an account
              </button>{' '}
              and add some credit, then make a key on{' '}
              <button className="link-btn" onClick={() => window.ivstudio.links.open('https://console.runpod.io/user/settings')}>
                Settings → API Keys
              </button>{' '}
              (read/write). IV Studio uses it only to make your storage volume and to start and stop your own pods.
            </p>
          </>
        )}
      </Step>

      <Step n={2} title="GPU and shut-off" done={!!rp.ready}>
        <div className="cloud-gpus">
          {gpus.map((g) => (
            <button key={g.id} className={`mode-card ${gpu === g.id ? 'on' : ''}`} onClick={() => setGpu(g.id)}>
              <span className="mode-name">{g.label}</span>
              <span className="mono">${g.perHour.toFixed(2)} an hour, by the second</span>
              <span className="dim small">
                {g.note}
                {g.inStock === false ? ' · busy right now' : g.inStock ? ' · free now' : ''}
              </span>
            </button>
          ))}
        </div>
        <div className="row">
          <span className="row-label">Shut down after</span>
          <div className="segmented">
            {IDLE.map(([s, label]) => (
              <button key={s} className={idle === s ? 'on' : ''} onClick={() => setIdle(s)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <p className="small dim">
          With nothing to do for {IDLE.find(([s]) => s === idle)?.[1]}, the pod deletes itself and GPU billing stops; your volume keeps ComfyUI, the models and every render. If your GPU is taken when a render needs one, IV Studio starts the next H3-ready GPU free in your volume's data center. The next render wakes it again (about 2–5 minutes).
          {chosen && ` A 10-second 2 MP shot takes roughly 3–5 minutes of GPU, about $${((chosen.perHour * 4) / 60).toFixed(2)}.`}
        </p>
      </Step>

      <Step n={3} title="Set up" done={!!rp.ready}>
        <p className="small dim">
          Makes a 100 GB network volume in a RunPod data center that has your GPU, starts a pod that installs ComfyUI and every node pack (matched to this version) and downloads the H3 models onto the volume (about 60 GB, once), then uploads your characters. The first time takes 20–40 minutes of GPU time, under about $1 on an L40S. RunPod bills the volume while it exists (about $7 a month for 100 GB); delete it on RunPod's Storage page when you're done with the cloud.
        </p>
        <button className="btn btn-primary" disabled={!!busy || !rp.hasKey || st.target === 'cloud'} onClick={() => run('Setting up RunPod', () => window.ivstudio.cloud.runpodSetUp({ gpu, idleSeconds: idle }))}>
          {rp.ready ? 'Set up again' : 'Set up RunPod'}
        </button>
        {rp.volumeId && (
          <p className="mono small dim">
            {gpus.find((g) => g.id === rp.gpu)?.label || rp.gpu} · shuts down after {Math.round((rp.idleSeconds || 300) / 60)} min · volume {rp.volumeId} in {rp.dataCenter}
          </p>
        )}
      </Step>
    </>
  )
}

// Cloud mode on the user's own Modal or RunPod account: pick one, set it up, then switch.
export default function Cloud({ notify, recheck, setup, info }) {
  const platform = usePlatform()
  const [st, setSt] = useState(null)
  const [gpu, setGpu] = useState('L40S')
  const [idle, setIdle] = useState(300)
  const [busy, setBusy] = useState(null)
  const [log, setLog] = useState([])
  const [wake, setWake] = useState(null)
  const logEl = useRef(null)

  const refresh = () =>
    window.ivstudio.cloud.status().then((s) => {
      setSt(s)
      if (s.cloud?.gpu) setGpu(s.cloud.gpu)
      if (s.cloud?.idleSeconds) setIdle(s.cloud.idleSeconds)
    })

  useEffect(() => {
    refresh()
    return window.ivstudio.cloud.onLog((line) => setLog((l) => [...l.slice(-400), line]))
  }, [])
  useEffect(() => {
    logEl.current?.scrollTo(0, logEl.current.scrollHeight)
  }, [log])

  async function run(label, fn) {
    setBusy(label)
    try {
      await fn()
    } catch (err) {
      notify(err.message)
    } finally {
      setBusy(null)
      refresh()
    }
  }

  async function setUp() {
    await run('Setting up', async () => {
      await window.ivstudio.cloud.deploy({ gpu, idleSeconds: idle })
      await window.ivstudio.cloud.fetchModels()
      await window.ivstudio.cloud.uploadCharacters()
    })
  }

  async function use(target) {
    await run(target === 'cloud' ? 'Waking the cloud GPU' : 'Switching', async () => {
      await window.ivstudio.cloud.use(target)
      if (target === 'cloud') {
        setWake('waking')
        const w = await window.ivstudio.cloud.wake()
        setWake(`Cloud GPU ready${w.gpu ? ` (${w.gpu.replace(/^cuda:\d+ /, '').replace(/ : \w+$/, '')})` : ''} in ${w.seconds} s.`)
      } else setWake(null)
      await recheck()
    })
  }

  if (!st) return null
  const chosen = st.gpus.find((g) => g.id === gpu)
  const runpod = st.provider === 'runpod'
  const setUpDone = runpod ? !!st.runpod?.ready : !!(st.cloud?.url && st.cloud?.modelsAt && st.hasToken)
  const onCloud = st.target === 'cloud'

  return (
    <div className="cloud">
      <Hero art="cloud" title="Cloud" kicker="Your own GPU · by the second" />
      <p className="lede">
        No strong graphics card? Render on a cloud GPU in your own RunPod or Modal account.
        <span className="lede-small dim">Pick one. Either way the GPU bills by the second only while it’s up, and shuts itself off when you stop. IV Studio sets everything up.</span>
      </p>

      {['cloudToken', 'runpodToken'].filter((n) => st.removable?.includes(n)).map((n) => (
        <p key={n} className="notice">
          {secretRemedy(n).text} ({n === 'cloudToken' ? 'Modal' : 'RunPod'}) You can also remove the saved sign-in; your account, storage and any running GPU stay as they are.{' '}
          <button className="link-btn" disabled={!!busy} onClick={() => run('Removing the sign-in', () => window.ivstudio.cloud.clearToken(n))}>
            Remove it
          </button>
        </p>
      ))}

      <div className="cloud-switch">
        <span className="row-label">Cloud</span>
        <div className="segmented">
          {[
            ['runpod', 'RunPod'],
            ['modal', 'Modal']
          ].map(([id, label]) => (
            <button
              key={id}
              className={st.provider === id ? 'on' : ''}
              disabled={!!busy || onCloud}
              title={onCloud ? 'Switch rendering to My PC first' : undefined}
              onClick={() => run('Switching', () => window.ivstudio.cloud.provider(id))}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="cloud-switch">
        <div className="segmented">
          <button className={!onCloud ? 'on' : ''} disabled={!!busy} onClick={() => use('local')}>
            My PC
          </button>
          <button className={onCloud ? 'on' : ''} disabled={!!busy || !setUpDone} onClick={() => use('cloud')}>
            Cloud
          </button>
        </div>
        <span className="mono small dim">{busy ? `${busy}…` : onCloud ? wake || 'Rendering in the cloud.' : 'Rendering on this PC.'}</span>
        {setUpDone && <ShutDownGpu notify={notify} className="btn btn-small cloud-stop" />}
      </div>

      {runpod && <RunPodSteps st={st} busy={busy} run={run} notify={notify} refresh={refresh} links={info?.links} />}
      {!runpod && (
        <>
          <Step n={1} title="Cloud tools" done={st.toolkit}>
            <p className="small dim">A private copy of Modal's client in IV Studio's own folder (about 100 MB). Nothing else on your PC changes.</p>
            {!st.toolkit && (
              <button className="btn btn-small" disabled={!!busy} onClick={() => run('Installing', () => window.ivstudio.cloud.install())}>
                Install the cloud tools
              </button>
            )}
          </Step>

          <Step n={2} title="Modal account" done={!!st.workspace}>
            {st.workspace ? (
              <p className="small">
                Signed in to the Modal workspace <span className="mono">{st.workspace}</span>.
              </p>
            ) : (
              <>
                <p className="small dim">
                  Opens Modal's sign-in page in your browser. New to Modal? Signing up is free.{' '}
                  <button className="link-btn" onClick={() => window.ivstudio.links.open(info?.links?.modalSignup || 'https://modal.com/signup')}>
                    Create an account
                  </button>
                  {info?.links?.modalSignup && (
                    <span className="cloud-support">
                      {' '}
                      This is IV Studio's referral link: signing up through it supports the app, and costs you nothing extra.
                    </span>
                  )}
                </p>
                <button className="btn btn-small" disabled={!!busy || !st.toolkit} onClick={() => run('Waiting for Modal sign-in', () => window.ivstudio.cloud.signIn())}>
                  Sign in with Modal
                </button>
              </>
            )}
          </Step>

          <Step n={3} title="GPU and shut-off" done={!!st.cloud?.url}>
            <div className="cloud-gpus">
              {st.gpus.map((g) => (
                <button key={g.id} className={`mode-card ${gpu === g.id ? 'on' : ''}`} onClick={() => setGpu(g.id)}>
                  <span className="mode-name">{g.label}</span>
                  <span className="mono">${g.perHour.toFixed(2)} an hour, by the second</span>
                  <span className="dim small">{g.note}</span>
                </button>
              ))}
            </div>
            <div className="row">
              <span className="row-label">Shut down after</span>
              <div className="segmented">
                {IDLE.map(([s, label]) => (
                  <button key={s} className={idle === s ? 'on' : ''} onClick={() => setIdle(s)}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <p className="small dim">
              With nothing to do for {IDLE.find(([s]) => s === idle)?.[1]}, the GPU switches off and billing stops. Shut down GPU (above) switches it off at once; the top bar's meter shows its time and cost. The next render wakes it again (about 1–3 minutes). Storage for the models is free on Modal (first 1 TiB).
              {chosen && ` A 10-second 2 MP shot takes roughly 3–5 minutes of GPU, about $${((chosen.perHour * 4) / 60).toFixed(2)}.`}
            </p>
          </Step>

          <Step n={4} title="Set up" done={setUpDone}>
            <p className="small dim">
              Builds IV Studio's cloud image (ComfyUI and every node pack, matched to this version), downloads the H3 models into your Modal storage (about 60 GB, once), and uploads your characters. The first time takes 20–40 minutes and costs a few cents of CPU time. Run it again after changing GPU or adding characters.
            </p>
            <button className="btn btn-primary" disabled={!!busy || !st.workspace} onClick={setUp}>
              {setUpDone ? 'Set up again' : 'Set up the cloud'}
            </button>
            {st.cloud?.url && (
              <p className="mono small dim">
                {st.cloud.gpu} · shuts down after {Math.round(st.cloud.idleSeconds / 60)} min · {st.cloud.workspace}
              </p>
            )}
          </Step>
        </>
      )}

      {(log.length > 0 || busy) && (
        <pre className="code cloud-log" ref={logEl}>
          {log.join('\n') || 'Starting…'}
        </pre>
      )}

      <section className="group">
        <div className="group-head">
          <h2>What's different in the cloud</h2>
        </div>
        <div className="group-body">
          <p className="small dim">
            Everything in Create, Sequences and the prompt writer works the same on Modal and RunPod. The final DLSS clean-up only runs on Windows, so cloud finals use a 2× AI upscale (Real-ESRGAN) and frame interpolation (RIFE, 48/72/120 fps) instead. Finished videos download to {rendersFolderText(platform)} when you open them.
          </p>
        </div>
      </section>
    </div>
  )
}
