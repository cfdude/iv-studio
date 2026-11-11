import { useEffect, useRef, useState } from 'react'
import SetupProgress, { useSetupProgress } from './SetupProgress'
import ModalAccount from './ModalAccount'
import Stage from './Stage'
import { ask } from './Confirm'
import { keychainRefusedText, rendersFolderText } from '../../../shared/platform'
import { secretRemedy } from '../../../service/secrets'
import { BetaJoin, useUsage } from './Privacy'

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
  if (usage.hosted)
    return (
      <button className="mono cloud-meter" onClick={onOpen} title="Rendering on Comfy Cloud: each run is billed to your Comfy account, and nothing runs between renders. Click for the Cloud page.">
        <span className="cloud-meter-dot" />
        Comfy Cloud · billed per run
      </button>
    )
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

// The cloud services, as cards on the Cloud page.
const PROVIDERS = [
  { id: 'runpod', label: 'RunPod', line: 'Your own account. Billed by the second while the GPU is up.' },
  { id: 'modal', label: 'Modal', line: 'Your own account. Billed by the second while the GPU is up.' },
  { id: 'comfycloud', label: 'Comfy Cloud', line: 'Comfy’s own ComfyUI. Billed per run; only Comfy’s nodes and models.' }
]

const IDLE = [
  [180, '3 min'],
  [300, '5 min'],
  [600, '10 min'],
  [1200, '20 min']
]

// Models beyond H3 come into the person's cloud storage the first time a feature needs them (the app asks first).
// Some are behind a licence on Hugging Face (Flux.2 Klein 9B, Flux 3 Klein, the LTX effects): those need the
// person's own Hugging Face token, after they accept the licence there.
function CloudModelsStep({ st, busy, run, notify, refresh }) {
  const [token, setToken] = useState('')
  async function save(k) {
    await run(k ? 'Checking the token' : 'Removing the token', async () => {
      const r = await window.ivstudio.cloud.hfToken(k)
      setToken('')
      if (k) notify(`Hugging Face token saved (encrypted on this computer)${r?.name ? ` for ${r.name}` : ''}.`)
    })
    refresh()
  }
  return (
    <section className="group cloud-models">
      <div className="group-head">
        <h2>Models for everything else</h2>
        <p className={`mono small ${st.hasHfToken ? 'cloud-ok' : 'dim'}`}>{st.hasHfToken ? '● Hugging Face token saved' : 'Optional'}</p>
      </div>
      <div className="group-body">
        <p className="small dim">
          Setup puts H3’s models in your cloud storage. Pictures, music, sounds, Replace, Effects and SeedVR2 bring their own models the first time you use them there: IV Studio says how big they are and asks before downloading. A few are behind a licence on Hugging Face (Flux.2 Klein 9B, Flux 3 Klein and the LTX effects). To use those in the cloud, accept each licence on its Hugging Face page, then add a Read token from huggingface.co → Settings → Access Tokens.
        </p>
        {st.hasHfToken ? (
          <p className="small">
            A Hugging Face token is saved (encrypted on this computer). It’s used only to download those files into your own cloud storage.{' '}
            <button className="link-btn" disabled={!!busy} onClick={() => save('')}>
              Remove it
            </button>
          </p>
        ) : (
          <>
            {st.secretStoreRefused && <p className="small">{keychainRefusedText('darwin')}</p>}
            {st.removable?.includes('hfToken') && (
              <p className="small">
                The saved Hugging Face token can’t be read.{' '}
                <button className="link-btn" disabled={!!busy} onClick={() => save('')}>
                  Remove it
                </button>
              </p>
            )}
            <div className="key-form">
              <input type="password" placeholder="hf_…" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" spellCheck={false} aria-label="Hugging Face token" />
              <button className="btn btn-small" disabled={!!busy || !token.trim()} onClick={() => save(token.trim())}>
                Save token
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  )
}

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
      if (k) notify('RunPod key saved (encrypted on this computer).')
    })
    refresh()
  }
  return (
    <>
      <Step n={1} title="RunPod account" done={!!rp.hasKey}>
        {rp.hasKey ? (
          <p className="small">
            A RunPod API key is saved (encrypted on this computer).{' '}
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
              {links?.runpodSignup && <span className="cloud-support"> New accounts made through this link get a one-time RunPod credit of $5 to $500 after adding their first $10, and it supports IV Studio at no extra cost to you.</span>}
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

// Comfy Cloud: Comfy's hosted ComfyUI. A key, then a check of what IV Studio can do there (it can't take node packs).
function ComfyCloudSteps({ st, busy, run, notify, refresh }) {
  const cc = st.comfycloud || {}
  const [key, setKey] = useState('')
  const survey = cc.survey
  async function saveKey(k) {
    await run(k ? 'Checking the key' : 'Removing the key', async () => {
      await window.ivstudio.cloud.comfyCloudKey(k)
      setKey('')
      if (k) {
        notify('Comfy API key saved (encrypted on this computer). Checking what works there…')
        await window.ivstudio.cloud.comfyCloudCheck()
      }
    })
    refresh()
  }
  const mark = (ok) => <span className={`cc-mark ${ok ? 'ok' : 'no'}`}>{ok ? '✓' : '–'}</span>
  return (
    <>
      <Step n={1} title="Comfy account" done={!!cc.hasKey}>
        {cc.hasKey ? (
          <p className="small">
            {cc.ownKey ? 'A Comfy API key is saved (encrypted on this computer).' : 'Using the Comfy.org key you saved for the prompt writer.'}{' '}
            {cc.ownKey && (
              <button className="link-btn" disabled={!!busy} onClick={() => saveKey('')}>
                Remove it
              </button>
            )}
          </p>
        ) : null}
        {(!cc.hasKey || !cc.ownKey) && (
          <>
            {st.secretStoreRefused && <p className="small dim">{keychainRefusedText('darwin')}</p>}
            {st.removable?.includes('comfyCloudKey') && (
              <p className="small dim">
                The saved Comfy Cloud key can’t be used.{' '}
                <button className="link-btn" disabled={!!busy} onClick={() => saveKey('')}>
                  Remove it
                </button>
              </p>
            )}
            <div className="key-form">
              <input type="password" value={key} placeholder="Comfy API key (comfyui-…)" onChange={(e) => setKey(e.target.value)} autoComplete="off" />
              <button className="btn btn-small" disabled={!!busy || !key.trim()} onClick={() => saveKey(key.trim())}>
                Save
              </button>
            </div>
            <p className="small dim">
              Comfy Cloud's API needs a paid Comfy Cloud plan.{' '}
              <button className="link-btn" onClick={() => window.ivstudio.links.open('https://platform.comfy.org/profile/api-keys')}>
                Make an API key
              </button>{' '}
              ·{' '}
              <button className="link-btn" onClick={() => window.ivstudio.links.open('https://www.comfy.org/cloud/pricing')}>
                Plans and pricing
              </button>
            </p>
          </>
        )}
      </Step>
      <Step n={2} title="What works there" done={!!survey}>
        <p className="small dim">Comfy Cloud runs ComfyUI's own nodes and the node packs Comfy chooses, with its own model library. You can't add node packs there, so IV Studio asks it what it has. Asking is free.</p>
        <button className="btn btn-small" disabled={!!busy || !cc.hasKey} onClick={() => run('Asking Comfy Cloud', () => window.ivstudio.cloud.comfyCloudCheck())}>
          {survey ? 'Check again' : 'Check what works'}
        </button>
        {survey && (
          <div className="cc-survey">
            <div className="cc-row">
              {mark(survey.shots.ready)}
              <span>
                <b>Shots</b> <span className="small dim">{survey.shots.note}</span>
              </span>
            </div>
            <div className="cc-row">
              {mark(survey.pictures.some((p) => p.ready))}
              <span>
                <b>Pictures</b>{' '}
                <span className="small dim">
                  {survey.pictures.map((p) => `${p.label}: ${p.note}`).join(' · ')}
                </span>
              </span>
            </div>
            <div className="cc-row">
              {mark(survey.music.some((m) => m.ready))}
              <span>
                <b>Music</b> <span className="small dim">{survey.music.map((m) => `${m.label}: ${m.note}`).join(' · ')}</span>
              </span>
            </div>
            <p className="mono small dim">Checked {new Date(cc.checkedAt).toLocaleString()}</p>
          </div>
        )}
      </Step>
    </>
  )
}

// Cloud mode on the user's own Modal or RunPod account, or on Comfy Cloud: pick one, set it up, then switch.
export default function Cloud({ notify, recheck, setup, info }) {
  const [beta, setBeta] = useUsage()
  const [st, setSt] = useState(null)
  const [gpu, setGpu] = useState('L40S')
  const [idle, setIdle] = useState(300)
  const [busy, setBusy] = useState(null)
  const [log, setLog] = useState([])
  const [wake, setWake] = useState(null)
  const logEl = useRef(null)

  const progress = useSetupProgress(st?.setup)
  const refresh = () =>
    window.ivstudio.cloud.status().then((s) => {
      setSt(s)
      if (s.cloud?.gpu) setGpu(s.cloud.gpu)
      if (s.cloud?.idleSeconds) setIdle(s.cloud.idleSeconds)
    })

  // the cloud wizard changed things
  useEffect(() => {
    const again = () => refresh()
    window.addEventListener('iv:cloud-changed', again)
    return () => window.removeEventListener('iv:cloud-changed', again)
  }, [])
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
    setLog([])
    await run('Setting up', () => window.ivstudio.cloud.setUp({ gpu, idleSeconds: idle }))
  }

  async function use(target) {
    await run(target === 'cloud' ? 'Waking the cloud GPU' : 'Switching', async () => {
      await window.ivstudio.cloud.use(target)
      if (target === 'cloud') {
        setWake('waking')
        const w = await window.ivstudio.cloud.wake()
        setWake(`${st.provider === 'comfycloud' ? 'Comfy Cloud' : 'Cloud GPU'} ready${w.gpu ? ` (${w.gpu.replace(/^cuda:\d+ /, '').replace(/ : \w+$/, '')})` : ''} in ${w.seconds} s.`)
      } else setWake(null)
      await recheck()
    })
  }

  if (!st) return null
  const chosen = st.gpus.find((g) => g.id === gpu)
  const runpod = st.provider === 'runpod'
  const comfyCloud = st.provider === 'comfycloud'
  const setUpDone = comfyCloud ? !!st.comfycloud?.hasKey : runpod ? !!st.runpod?.ready : !!(st.cloud?.url && st.cloud?.modelsAt && st.hasToken)
  const onCloud = st.target === 'cloud'

  return (
    <div className="cloud">
      <Stage effect="dream" art="cloud" title="Cloud" kicker="Your own GPU · by the second">
        {/* where renders go, switched here as in Render on below, and the guided setup */}
        <div className="stage-panel stage-quick stage-cloud">
          <div className="segmented" role="radiogroup" aria-label="Render on">
            <button role="radio" aria-checked={!onCloud} className={!onCloud ? 'on' : ''} disabled={!!busy} onClick={() => !onCloud || use('local')}>
              This computer
            </button>
            <button role="radio" aria-checked={onCloud} className={onCloud ? 'on' : ''} disabled={!!busy || !setUpDone} title={setUpDone ? '' : 'Set up a cloud first'} onClick={() => onCloud || use('cloud')}>
              Cloud
            </button>
          </div>
          <span className="stage-cloud-status mono small">{busy ? `${busy}…` : onCloud ? wake || `Rendering on ${PROVIDERS.find((p) => p.id === st.provider)?.label}` : 'Rendering on this computer'}</span>
          <button className="btn btn-primary" onClick={() => window.dispatchEvent(new CustomEvent('iv:cloud-wizard'))}>
            Guided setup
          </button>
        </div>
      </Stage>
      <p className="lede">
        No strong graphics card? Render on a cloud GPU instead.
        <span className="lede-small dim">Pick a cloud service below and set it up once; then switch between this computer and the cloud whenever you like.</span>
      </p>
      {/* the hosted cloud beta's waitlist (Privacy.jsx); only there while a signup address exists */}
      {beta?.betaOpen && (
        <section className="block cloud-beta">
          <strong className="cloud-beta-title">Rather not set anything up?</strong>
          <BetaJoin status={beta} setStatus={setBeta} notify={notify} />
        </section>
      )}
      {['cloudToken', 'runpodToken'].filter((n) => st.removable?.includes(n)).map((n) => (
        <p key={n} className="notice">
          {secretRemedy(n).text} ({n === 'cloudToken' ? 'Modal' : 'RunPod'}) You can also remove the saved sign-in; your account, storage and any running GPU stay as they are.{' '}
          <button className="link-btn" disabled={!!busy} onClick={() => run('Removing the sign-in', () => window.ivstudio.cloud.clearToken(n))}>
            Remove it
          </button>
        </p>
      ))}
      <div className="cloud-guided">
        <button className="btn btn-primary" onClick={() => window.dispatchEvent(new CustomEvent('iv:cloud-wizard'))}>
          Guided setup →
        </button>
        <span className="small dim">A few steps: pick a service, connect it, choose a GPU, set it up, switch it on.</span>
      </div>

      <section className="cloud-control">
        <div className="cloud-control-head">
          <span className="mono label">Render on</span>
          <span className={`cloud-status mono small ${onCloud ? 'on' : ''}`}>
            <span className="cloud-status-dot" />
            {busy ? `${busy}…` : onCloud ? wake || `Rendering on ${PROVIDERS.find((p) => p.id === st.provider)?.label}` : 'Rendering on this computer'}
          </span>
          {setUpDone && !comfyCloud && <ShutDownGpu notify={notify} className="btn btn-small cloud-stop" />}
        </div>
        <div className="cloud-choices two">
          <button className={`cloud-choice ${!onCloud ? 'on' : ''}`} disabled={!!busy} aria-pressed={!onCloud} onClick={() => !onCloud || use('local')}>
            <span className="cloud-choice-name">This computer</span>
            <span className="small dim">Your own graphics card. Free.</span>
          </button>
          <button className={`cloud-choice ${onCloud ? 'on' : ''}`} disabled={!!busy || !setUpDone} aria-pressed={onCloud} title={setUpDone ? undefined : 'Set the cloud service up below first'} onClick={() => onCloud || use('cloud')}>
            <span className="cloud-choice-name">The cloud</span>
            <span className="small dim">{setUpDone ? `${PROVIDERS.find((p) => p.id === st.provider)?.label}, ready` : `Set up ${PROVIDERS.find((p) => p.id === st.provider)?.label} below first`}</span>
          </button>
        </div>

        <div className="cloud-control-head">
          <span className="mono label">Cloud service</span>
          {onCloud && <span className="small dim">Switch to This computer to change it.</span>}
        </div>
        <div className="cloud-choices three">
          {PROVIDERS.map((p) => {
            const ready = p.id === 'comfycloud' ? !!st.comfycloud?.hasKey : p.id === 'runpod' ? !!st.runpod?.ready : !!(st.cloud?.url && st.cloud?.modelsAt)
            return (
              <button key={p.id} className={`cloud-choice small-choice ${st.provider === p.id ? 'on' : ''}`} disabled={!!busy || onCloud} aria-pressed={st.provider === p.id} onClick={() => st.provider === p.id || run('Switching', () => window.ivstudio.cloud.provider(p.id))}>
                <span className="cloud-choice-top">
                  <span className="cloud-choice-name">{p.label}</span>
                  {ready && <span className="mono cloud-ok cloud-ready">Ready</span>}
                </span>
                <span className="small dim">{p.line}</span>
              </button>
            )
          })}
        </div>
      </section>

      {comfyCloud && <ComfyCloudSteps st={st} busy={busy} run={run} notify={notify} refresh={refresh} />}
      {runpod && <RunPodSteps st={st} busy={busy} run={run} notify={notify} refresh={refresh} links={info?.links} />}
      {!runpod && !comfyCloud && (
        <>
          <Step n={1} title="Cloud tools" done={st.toolkit}>
            <p className="small dim">A private copy of Modal's client in IV Studio's own folder (about 100 MB). Nothing else on your computer changes.</p>
            {!st.toolkit && (
              <button className="btn btn-small" disabled={!!busy} onClick={() => run('Installing', () => window.ivstudio.cloud.install())}>
                Install the cloud tools
              </button>
            )}
            {st.toolkitUpdate && (
              <p className="small">
                Modal’s client {st.toolkitVersion || ''} updates to {st.toolkitUpdate} by itself before the next setup or render (about a minute).{' '}
                <button className="link-btn" disabled={!!busy} onClick={() => run('Updating the cloud tools', () => window.ivstudio.cloud.install())}>
                  Update now
                </button>
              </p>
            )}
          </Step>

          <Step n={2} title="Modal account" done={!!st.workspace}>
            <ModalAccount st={st} busy={busy} run={run} info={info} notify={notify} onChanged={refresh} />
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

      {progress && progress.provider === (st.provider || 'modal') && (!progress.finishedAt || Date.now() - progress.finishedAt < 30 * 60 * 1000) ? (
        <SetupProgress progress={progress} log={log} />
      ) : (
        (log.length > 0 || busy) && (
          <pre className="code cloud-log" ref={logEl}>
            {log.join('\n') || 'Starting…'}
          </pre>
        )
      )}

      {!comfyCloud && <CloudModelsStep st={st} busy={busy} run={run} notify={notify} refresh={refresh} />}

      <section className="group cloud-different">
        <div className="group-head">
          <h2>What's different in the cloud</h2>
        </div>
        <div className="group-body">
          <p className="small dim">
            On Comfy Cloud, what works depends on the nodes and models Comfy offers there (the check above lists it); pictures and music use ComfyUI’s own nodes. On Modal and RunPod, nearly everything works as on this computer: shots, sequences, pictures and picture tools, Projects sketches, character design, music, sounds, Cut out, Reframe, Replace, Effects, SeedVR2 and voices (set them up once on the Voices page). Each feature’s models are downloaded into your cloud storage the first time you use it, after IV Studio asks. The final DLSS clean-up only runs on Windows, so cloud finals use a 2× AI upscale (Real-ESRGAN) and frame interpolation (RIFE, 48/72/120 fps), or SeedVR2. Live step pictures, Replace’s old engine and New angle stay on computers. Finished videos download to {rendersFolderText(info?.platform)} when you open them.
          </p>
        </div>
      </section>
    </div>
  )
}
