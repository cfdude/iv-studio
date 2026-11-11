import { useEffect, useRef, useState } from 'react'
import SetupProgress, { useSetupProgress } from './SetupProgress'
import ModalAccount from './ModalAccount'
import { createPortal } from 'react-dom'
import Hero from './Hero'
import { StepHead } from './CreateKit'

// The cloud setup wizard: pick a service, connect the account, choose a GPU, set it up, switch to it. Opened from
// Check my PC (when the cloud is picked) and from the Cloud page (Guided setup). It drives the same calls as the
// Cloud page's own steps (window.ivstudio.cloud.*), so either way ends in the same place.
const STEPS = [
  ['service', 'Service', 'Who rents the GPU'],
  ['account', 'Account', 'Connect it'],
  ['gpu', 'GPU', 'Size and shut-off'],
  ['setup', 'Set up', 'Once, about 30 min'],
  ['ready', 'Ready', 'Switch it on']
]
const IDLE = [
  [180, '3 min'],
  [300, '5 min'],
  [600, '10 min'],
  [1200, '20 min']
]
const LABEL = { runpod: 'RunPod', modal: 'Modal', comfycloud: 'Comfy Cloud' }
const cheapest = (list) => (list?.length ? Math.min(...list.map((g) => g.perHour)) : null)

const Icon = ({ name }) => {
  const p = {
    runpod: <><rect x="4" y="5" width="16" height="6" rx="1" /><rect x="4" y="13" width="16" height="6" rx="1" /><path d="M7.5 8h.01M7.5 16h.01M11 8h5M11 16h5" /></>,
    modal: <><path d="M7 18h10a4 4 0 0 0 .6-8A6 6 0 0 0 6.2 9.3 4.4 4.4 0 0 0 7 18z" /><path d="M12 11v5M9.5 13.5h5" /></>,
    comfycloud: <><path d="M7 18h10a4 4 0 0 0 .6-8A6 6 0 0 0 6.2 9.3 4.4 4.4 0 0 0 7 18z" /><circle cx="12" cy="13.5" r="2" /></>,
    check: <path d="M5 12.5l4.2 4.2L19 7" />
  }[name]
  return (
    <svg className="wel-icon" viewBox="0 0 24 24" aria-hidden="true">
      {p}
    </svg>
  )
}

export default function CloudWizard({ onClose, notify, recheck, info }) {
  const [step, setStep] = useState('service')
  const [st, setSt] = useState(null)
  const [busy, setBusy] = useState(null)
  const [log, setLog] = useState([])
  const [gpu, setGpu] = useState(null)
  const [idle, setIdle] = useState(300)
  const [rpGpus, setRpGpus] = useState(null)
  const [key, setKey] = useState('')
  const [woke, setWoke] = useState(null)
  const logEl = useRef(null)
  const at = STEPS.findIndex(([id]) => id === step)

  const refresh = () => window.ivstudio.cloud.status().then((s) => (setSt(s), s))
  const progress = useSetupProgress(st?.setup)
  useEffect(() => {
    refresh().then((s) => {
      setIdle((s.provider === 'runpod' ? s.runpod?.idleSeconds : s.cloud?.idleSeconds) || 300)
      setGpu((s.provider === 'runpod' ? s.runpod?.gpu : s.cloud?.gpu) || null)
    })
    return window.ivstudio.cloud.onLog((line) => setLog((l) => [...l.slice(-300), line]))
  }, [])
  // braces: scrollTo returns a Promise in Electron's Chromium, and React would take it for a cleanup function
  useEffect(() => {
    logEl.current?.scrollTo(0, logEl.current.scrollHeight)
  }, [log])
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && !busy && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [busy])
  // RunPod's live prices and stock, once there's a key
  useEffect(() => {
    if (st?.provider === 'runpod' && st.runpod?.hasKey && !rpGpus) window.ivstudio.cloud.runpodCatalog().then(setRpGpus, () => {})
  }, [st?.provider, st?.runpod?.hasKey])

  async function run(label, fn) {
    setBusy(label)
    try {
      return await fn()
    } catch (err) {
      notify?.(err.message)
    } finally {
      setBusy(null)
      await refresh()
    }
  }

  if (!st) return null
  const p = st.provider
  const onCloud = st.target === 'cloud'
  const gpus = p === 'runpod' ? rpGpus || st.runpodGpus || [] : st.gpus || []
  const pick = gpu && gpus.some((g) => g.id === gpu) ? gpu : gpus[0]?.id
  const chosen = gpus.find((g) => g.id === pick)
  const account = p === 'runpod' ? !!st.runpod?.hasKey : p === 'comfycloud' ? !!st.comfycloud?.hasKey : !!st.workspace
  const ready = p === 'comfycloud' ? !!st.comfycloud?.hasKey : p === 'runpod' ? !!st.runpod?.ready : !!(st.cloud?.url && st.cloud?.modelsAt)
  // what's actually set up (the Ready summary), which can differ from this session's pick until Set up runs again
  const cfg = p === 'runpod' ? { gpu: st.runpod?.gpu, idle: st.runpod?.idleSeconds } : { gpu: st.cloud?.gpu, idle: st.cloud?.idleSeconds }
  const cfgLabel = (gpus.find((g) => g.id === cfg.gpu)?.label || cfg.gpu || '').split(' ·')[0]
  const changed = ready && p !== 'comfycloud' && cfg.gpu && (pick !== cfg.gpu || (cfg.idle && idle !== cfg.idle))
  const steps = p === 'comfycloud' ? STEPS.filter(([id]) => id !== 'gpu' && id !== 'setup') : STEPS
  const idx = steps.findIndex(([id]) => id === step)
  const canNext = step === 'service' ? !!p : step === 'account' ? account : step === 'gpu' ? !!pick : step === 'setup' ? ready : true
  const next = () => setStep(steps[Math.min(steps.length - 1, idx + 1)][0])
  const back = () => setStep(steps[Math.max(0, idx - 1)][0])

  async function choose(id) {
    if (id === p) return
    if (onCloud) return notify?.('Switch to This computer on the Cloud page first, then change the cloud service.')
    await run('Switching', () => window.ivstudio.cloud.provider(id))
    setGpu(null)
    setKey('')
  }
  async function saveKey() {
    const k = key.trim()
    if (!k) return
    await run('Checking the key', async () => {
      if (p === 'runpod') await window.ivstudio.cloud.runpodKey(k)
      else {
        await window.ivstudio.cloud.comfyCloudKey(k)
        await window.ivstudio.cloud.comfyCloudCheck()
      }
      setKey('')
      notify?.('Key saved (encrypted on this computer).', 'ok')
    })
  }
  async function setUp() {
    setLog([])
    await run('Setting up', async () => {
      if (p === 'runpod') await window.ivstudio.cloud.runpodSetUp({ gpu: pick, idleSeconds: idle })
      else await window.ivstudio.cloud.setUp({ gpu: pick, idleSeconds: idle })
    })
  }
  async function switchOn() {
    await run('Waking the cloud GPU', async () => {
      await window.ivstudio.cloud.use('cloud')
      const w = await window.ivstudio.cloud.wake()
      setWoke(`${p === 'comfycloud' ? 'Comfy Cloud' : 'The cloud GPU'} is ready${w?.gpu ? ` (${String(w.gpu).replace(/^cuda:\d+ /, '').replace(/ : \w+$/, '')})` : ''}${w?.seconds ? ` after ${w.seconds} s` : ''}.`)
      await recheck?.()
    })
  }

  const titles = {
    service: ['Set up the cloud', 'Render on a rented GPU, billed by use'],
    account: [`Connect ${LABEL[p]}`, 'Your own account; IV Studio keeps the key here'],
    gpu: ['Pick a GPU', 'Bigger is faster; it shuts itself off'],
    setup: ['Set it up', 'Once, then every render just wakes it'],
    ready: [ready ? 'Ready' : 'Almost there', 'Switch between this computer and the cloud any time']
  }

  return createPortal(
    <div className="welcome cloud-wiz" role="dialog" aria-modal="true" aria-label="Set up the cloud">
      <div className="welcome-panel">
        <button className="welcome-skip link-btn mono" onClick={onClose} disabled={!!busy} title={busy ? 'Wait for this step to finish' : 'Close (Esc). Find it again on the Cloud page.'}>
          Close ×
        </button>
        <div className="welcome-scroll">
          <div key={step} className="welcome-hero-wrap">
            <Hero art={step === 'ready' && ready ? '' : 'cloud'} title={titles[step][0]} kicker={titles[step][1]} help={false} />
          </div>
          <ol className="wizard-steps welcome-steps" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }} aria-label="Steps">
            {steps.map(([id, label, sub], i) => (
              <li key={id} className={`${step === id ? 'on' : ''} ${i <= idx ? 'reached' : ''}`}>
                <button onClick={() => i <= idx && setStep(id)} disabled={i > idx} aria-current={step === id ? 'step' : undefined}>
                  <span className="wizard-n">{i < idx ? '✓' : i + 1}</span>
                  <span className="wizard-label">{label}</span>
                  <span className="wizard-sub dim small">{sub}</span>
                </button>
              </li>
            ))}
          </ol>

          <div className="welcome-body" key={`b-${step}`}>
            {step === 'service' && (
              <section className="block create-step">
                <StepHead n={1} title="Which cloud service?" sub="All three bill your own account; IV Studio adds nothing on top." />
                {onCloud && <p className="wel-note small">You’re rendering in the cloud now. Switch to This computer on the Cloud page to change the service.</p>}
                <div className="wel-ways cw-services">
                  {[
                    ['runpod', 'Rent a GPU by the second. Your storage stays between sessions (about $7 a month for 100 GB).', `from $${(cheapest(st.runpodGpus) ?? 0).toFixed(2)} an hour`, 'Shots, sequences and your characters', 'RunPod'],
                    ['modal', 'By the second, and the GPU scales to zero. Storage is free up to 1 TiB. Needs a small install (about 100 MB).', `from $${(cheapest(st.gpus) ?? 0).toFixed(2)} an hour`, 'Shots, sequences and your characters', 'Modal'],
                    ['comfycloud', 'Comfy’s own ComfyUI, on a paid Comfy Cloud plan. Billed per run. It has Comfy’s nodes and models only.', 'per run', 'Pictures and music; shots need IV Studio’s node packs, which it can’t take', 'Comfy Cloud']
                  ].map(([id, desc, price, works, name]) => {
                    const done = id === 'comfycloud' ? !!st.comfycloud?.hasKey : id === 'runpod' ? !!st.runpod?.ready : !!(st.cloud?.url && st.cloud?.modelsAt)
                    return (
                      <button key={id} className={`wel-way ${p === id ? 'on' : ''}`} disabled={!!busy} onClick={() => choose(id)} aria-pressed={p === id}>
                        {id === 'runpod' && !done && <span className="wel-rec mono">Recommended</span>}
                        {done && <span className="wel-rec mono cw-ready">Ready</span>}
                        <Icon name={id} />
                        <h3>{name}</h3>
                        <span className="cw-price mono small">{price}</span>
                        <p className="dim small">{desc}</p>
                        <p className="cw-works small">
                          <b>Works:</b> {works}
                        </p>
                      </button>
                    )
                  })}
                </div>
              </section>
            )}

            {step === 'account' && (
              <section className="block create-step">
                <StepHead n={2} title={p === 'modal' ? 'Install and sign in' : `Your ${LABEL[p]} key`} sub={p === 'modal' ? 'Modal signs in through your browser.' : 'Saved encrypted on this computer; the window never sees it again.'} />
                {p === 'modal' ? (
                  <div className="cw-tasks">
                    <Task done={st.toolkit} title="Cloud tools" text="A private copy of Modal’s client in IV Studio’s own folder (about 100 MB). Nothing else on your computer changes.">
                      {!st.toolkit && (
                        <button className="btn btn-primary" disabled={!!busy} onClick={() => run('Installing the cloud tools', () => window.ivstudio.cloud.install())}>
                          Install
                        </button>
                      )}
                      {st.toolkitUpdate && (
                        <button className="btn" disabled={!!busy} onClick={() => run('Updating the cloud tools', () => window.ivstudio.cloud.install())}>
                          Update to {st.toolkitUpdate}
                        </button>
                      )}
                    </Task>
                    <Task done={!!st.workspace} title="Modal account" text={st.workspace ? '' : 'Opens Modal’s sign-in page in your browser. New to Modal? Signing up is free.'}>
                      <ModalAccount st={st} busy={busy} run={run} info={info} notify={notify} onChanged={refresh} compact />
                    </Task>
                  </div>
                ) : account ? (
                  <div className="wel-allhere">
                    <Icon name="check" />
                    <p>{p === 'comfycloud' && !st.comfycloud?.ownKey ? 'Using the Comfy.org key you saved for the prompt writer.' : `A ${LABEL[p]} key is saved.`}</p>
                  </div>
                ) : (
                  <>
                    <ol className="cw-howto">
                      {p === 'runpod' ? (
                        <>
                          <li>
                            <button className="link-btn" onClick={() => window.ivstudio.links.open(info?.links?.runpodSignup || 'https://www.runpod.io')}>
                              Create a RunPod account
                            </button>{' '}
                            and add some credit ($10 covers hours of rendering).
                            {info?.links?.runpodSignup && <span className="cloud-support"> New accounts made through this link get a one-time RunPod credit of $5 to $500 after adding their first $10, and it supports IV Studio at no extra cost to you.</span>}
                          </li>
                          <li>
                            Make a key on{' '}
                            <button className="link-btn" onClick={() => window.ivstudio.links.open('https://console.runpod.io/user/settings')}>
                              Settings → API Keys
                            </button>{' '}
                            with read/write.
                          </li>
                          <li>Paste it here. IV Studio uses it only to make your storage and start and stop your own pods.</li>
                        </>
                      ) : (
                        <>
                          <li>
                            Comfy Cloud’s API needs a paid plan:{' '}
                            <button className="link-btn" onClick={() => window.ivstudio.links.open('https://www.comfy.org/cloud/pricing')}>
                              plans and pricing
                            </button>
                            .
                          </li>
                          <li>
                            <button className="link-btn" onClick={() => window.ivstudio.links.open('https://platform.comfy.org/profile/api-keys')}>
                              Make an API key
                            </button>{' '}
                            and paste it here. IV Studio then asks Comfy Cloud what it can run (free).
                          </li>
                        </>
                      )}
                    </ol>
                    <div className="key-form cw-key">
                      <input type="password" value={key} placeholder={p === 'runpod' ? 'RunPod API key (rpa_…)' : 'Comfy API key (comfyui-…)'} onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveKey()} autoComplete="off" />
                      <button className="btn btn-primary" disabled={!!busy || !key.trim()} onClick={saveKey}>
                        Check and save
                      </button>
                    </div>
                  </>
                )}
                {p === 'comfycloud' && st.comfycloud?.survey && <Survey s={st.comfycloud.survey} />}
              </section>
            )}

            {step === 'gpu' && (
              <section className="block create-step">
                <StepHead n={3} title="GPU and shut-off" sub="Every GPU here runs MiniMax H3. You can change it later." />
                <div className="cw-gpus">
                  {gpus.map((g) => (
                    <button key={g.id} className={`wel-way cw-gpu ${pick === g.id ? 'on' : ''}`} onClick={() => setGpu(g.id)} aria-pressed={pick === g.id}>
                      <h3>{g.label}</h3>
                      <span className="cw-price mono small">${g.perHour.toFixed(2)} an hour</span>
                      <p className="dim small">
                        {g.note}
                        {g.inStock === false ? ' · busy right now' : g.inStock ? ' · free now' : ''}
                      </p>
                    </button>
                  ))}
                </div>
                <div className="wel-seg-row cw-idle">
                  <span className="mono small">Shut down after</span>
                  <div className="segmented">
                    {IDLE.map(([s, label]) => (
                      <button key={s} className={idle === s ? 'on' : ''} onClick={() => setIdle(s)}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                {chosen && (
                  <p className="wel-note small">
                    <strong>What it costs:</strong> a 10-second shot finished at 2 MP takes about 3–5 minutes of GPU, roughly ${((chosen.perHour * 4) / 60).toFixed(2)} on the {chosen.label.split(' ·')[0]}. With nothing to do for {IDLE.find(([s]) => s === idle)?.[1]}, the GPU switches off and billing stops.
                  </p>
                )}
              </section>
            )}

            {step === 'setup' && (
              <section className="block create-step">
                <StepHead n={4} title={ready ? 'Set up' : 'Set it up once'} sub={p === 'runpod' ? 'A storage volume, ComfyUI, the node packs, the H3 models and your characters.' : 'IV Studio’s cloud image, the H3 models and your characters.'} />
                {changed && !busy && (
                  <p className="wel-note small">
                    <strong>Changed:</strong> it’s set up for the {cfgLabel}{cfg.idle ? ` with a ${Math.round(cfg.idle / 60)}-minute shut-off` : ''}. Set up again to use your new choice; otherwise it stays as it is.
                  </p>
                )}
                {ready && !busy ? (
                  <div className="wel-allhere">
                    <Icon name="check" />
                    <p>{LABEL[p]} is set up. Run it again only after changing GPU or adding characters.</p>
                  </div>
                ) : (
                  <p className="wel-lede">
                    {p === 'runpod'
                      ? 'Makes a 100 GB network volume in a data center that has your GPU, installs ComfyUI and every node pack matched to this version, downloads the H3 models onto it (about 60 GB, once) and uploads your characters. It takes 20–40 minutes, under about $1 of GPU time on an L40S. The volume costs about $7 a month while it exists.'
                      : 'Builds IV Studio’s cloud image (ComfyUI and every node pack, matched to this version), downloads the H3 models into your Modal storage (about 60 GB, once) and uploads your characters. It takes 20–40 minutes and a few cents of CPU time.'}
                  </p>
                )}
                <div className="cw-setup-row">
                  <button className="btn btn-primary" disabled={!!busy || !account || onCloud} onClick={setUp}>
                    {busy === 'Setting up' ? 'Setting up…' : ready ? 'Set up again' : `Set up ${LABEL[p]}`}
                  </button>
                  {busy === 'Setting up' && <span className="mono small dim">Keeps going if you close this; the Cloud page and the top bar show it.</span>}
                </div>
                {progress && progress.provider === p && (!progress.finishedAt || Date.now() - progress.finishedAt < 30 * 60 * 1000) ? (
                  <SetupProgress progress={progress} log={log} />
                ) : (
                  (log.length > 0 || busy === 'Setting up') && (
                    <pre className="code cloud-log cw-log" ref={logEl}>
                      {log.join('\n') || 'Starting…'}
                    </pre>
                  )
                )}
              </section>
            )}

            {step === 'ready' && (
              <section className="block create-step">
                <StepHead n={steps.length} title={onCloud ? 'Rendering in the cloud' : ready ? 'Switch it on' : 'Not set up yet'} sub="The top bar shows the GPU’s time and cost while it runs." />
                <dl className="wel-summary">
                  <div>
                    <dt className="mono small">Service</dt>
                    <dd>{LABEL[p]}</dd>
                  </div>
                  {p !== 'comfycloud' && (
                    <div>
                      <dt className="mono small">GPU</dt>
                      <dd>{ready ? cfgLabel : (chosen?.label || pick || '').split(' ·')[0]}</dd>
                    </div>
                  )}
                  {p !== 'comfycloud' && (
                    <div>
                      <dt className="mono small">Shuts off after</dt>
                      <dd>{IDLE.find(([s]) => s === (ready ? cfg.idle || idle : idle))?.[1] || `${Math.round((cfg.idle || idle) / 60)} min`}</dd>
                    </div>
                  )}
                  <div>
                    <dt className="mono small">Status</dt>
                    <dd>{onCloud ? 'On' : ready ? 'Ready' : 'Not set up'}</dd>
                  </div>
                </dl>
                {woke && (
                  <div className="wel-allhere">
                    <Icon name="check" />
                    <p>{woke}</p>
                  </div>
                )}
                {!ready && <p className="wel-lede">Go back a step to finish setting it up.</p>}
              </section>
            )}
          </div>
        </div>

        <footer className="welcome-foot">
          <span className="mono small dim">{busy ? `${busy}…` : `Step ${idx + 1} of ${steps.length}`}</span>
          <div className="welcome-foot-btns">
            {idx > 0 && (
              <button className="btn" onClick={back} disabled={!!busy}>
                ← Back
              </button>
            )}
            {step !== 'ready' && (
              <button className="btn btn-primary" onClick={next} disabled={!!busy || !canNext} title={canNext ? undefined : step === 'account' ? 'Connect the account first' : step === 'setup' ? 'Set it up first' : undefined}>
                Next →
              </button>
            )}
            {step === 'ready' &&
              (onCloud ? (
                <button className="btn btn-primary" onClick={onClose}>
                  Done
                </button>
              ) : (
                <>
                  <button className="btn" onClick={onClose} disabled={!!busy}>
                    Stay on this computer for now
                  </button>
                  <button className="btn btn-primary" onClick={switchOn} disabled={!!busy || !ready}>
                    Render in the cloud →
                  </button>
                </>
              ))}
          </div>
        </footer>
      </div>
    </div>,
    document.body
  )
}

function Task({ done, title, text, children }) {
  return (
    <div className={`cw-task ${done ? 'done' : ''}`}>
      <span className="wel-scan-mark">{done ? <Icon name="check" /> : null}</span>
      <div>
        <h3>{title}</h3>
        <p className="dim small">{text}</p>
      </div>
      <div className="cw-task-act">{children}</div>
    </div>
  )
}

function Survey({ s }) {
  const rows = [
    ['Shots', s.shots.ready, s.shots.note],
    ['Pictures', s.pictures.some((x) => x.ready), s.pictures.map((x) => `${x.label}: ${x.note}`).join(' · ')],
    ['Music', s.music.some((x) => x.ready), s.music.map((x) => `${x.label}: ${x.note}`).join(' · ')]
  ]
  return (
    <ul className="wel-scan cw-survey">
      {rows.map(([label, ok, note]) => (
        <li key={label} className={ok ? 'done' : 'done s-weak'}>
          <span className="wel-scan-mark">{ok ? <Icon name="check" /> : '–'}</span>
          <span className="wel-scan-label">{label}</span>
          <span className="wel-scan-value mono small">{note}</span>
        </li>
      ))}
    </ul>
  )
}
