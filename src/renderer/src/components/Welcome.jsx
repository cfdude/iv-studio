import { useEffect, useMemo, useRef, useState } from 'react'
import { finishFor, previewFor, SPEED_IDS, SPEEDS } from '../../../service/speed'
import { createPortal } from 'react-dom'
import Hero from './Hero'
import GetComfy from './GetComfy'
import { StepHead } from './CreateKit'
import { startTour } from '../tours'
import { setSimpleWords, simpleWords } from '../words'
import { highContrast, setContrast } from '../a11y'
import { UsageAsk } from './Privacy'
import { openStarter } from './Starters'
import { AgentRows, useAgentSetup } from './AgentSetup'
import { openH3Terms, useH3Terms } from './H3Terms'

// The welcome wizard (Check my PC): opens on first launch, and again from Settings. It reads this computer
// (hardware:scan; nothing leaves the PC), says plainly what it can do, suggests a way of working (this PC, the
// cloud or both), the defaults for shots and the writer, and the models worth downloading, then applies what the
// person picked (hardware:apply). Each stage has its own banner art (assets/pages/pc-*.webp, drawn with Codex).
const STEPS = [
  ['hello', 'Welcome', 'What IV Studio does'],
  ['scan', 'Scan', 'Reading your computer'],
  ['pc', 'Your computer', 'What it can do'],
  ['way', 'Your way', 'Where things render'],
  ['get', 'Downloads', 'What to get'],
  ['done', 'Ready', 'Off you go']
]
const ART = { hello: '', scan: 'pc-scan', pc: 'pc-card', way: 'pc-path', get: 'pc-path', done: '' }
const GB = 1024 ** 3
const gbs = (b) => (b / GB >= 1000 ? `${(b / GB / 1024).toFixed(1)} TB` : `${b / GB >= 100 ? Math.round(b / GB) : (b / GB).toFixed(b / GB < 10 ? 1 : 0)} GB`)
const WRITERS = { claude: 'Claude Code', codex: 'Codex', local: 'Local (Ollama)' }

// small line icons, in the app's style
const Icon = ({ name }) => {
  const p = {
    gpu: <><rect x="3" y="7" width="18" height="10" rx="1" /><circle cx="9" cy="12" r="2.6" /><circle cx="16" cy="12" r="2.6" /><path d="M3 17v2M7 17v1.5M11 17v1.5M15 17v1.5" /></>,
    ram: <><rect x="3" y="8" width="18" height="8" rx="1" /><path d="M7 11h2M11 11h2M15 11h2M6 16v2M10 16v2M14 16v2M18 16v2" /></>,
    cpu: <><rect x="7" y="7" width="10" height="10" rx="1" /><path d="M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4" /></>,
    disk: <><ellipse cx="12" cy="6.5" rx="7.5" ry="2.5" /><path d="M4.5 6.5v11c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5v-11M4.5 12c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5" /></>,
    writer: <><path d="M4 20l1-4L16 5l3 3L8 19l-4 1z" /><path d="M14 7l3 3" /></>,
    pc: <><rect x="3" y="4" width="18" height="12" rx="1" /><path d="M9 20h6M12 16v4" /></>,
    cloud: <path d="M7 18h10a4 4 0 0 0 .6-8A6 6 0 0 0 6.2 9.3 4.4 4.4 0 0 0 7 18z" />,
    both: <><rect x="2.5" y="8" width="11" height="8" rx="1" /><path d="M6 20h4M8 16v4" /><path d="M14.5 11h5.5a3 3 0 0 0 .4-6A4.4 4.4 0 0 0 12.6 6" /></>,
    check: <path d="M5 12.5l4.2 4.2L19 7" />
  }[name]
  return (
    <svg className="wel-icon" viewBox="0 0 24 24" aria-hidden="true">
      {p}
    </svg>
  )
}

const STATE_WORD = { great: 'Great', good: 'Good', ok: 'Fine', weak: 'Limited' }

export default function Welcome({ onClose, go, notify, first }) {
  const [step, setStep] = useState('hello')
  const [data, setData] = useState(null) // { scan, rec, promptEngine }
  const [error, setError] = useState(null)
  const [shown, setShown] = useState(0) // scan rows revealed so far
  const [way, setWay] = useState(null)
  const [prefs, setPrefs] = useState(null)
  const [writer, setWriter] = useState(null)
  const [pick, setPick] = useState(null) // model group ids to download
  const [packs, setPacks] = useState(true)
  const [started, setStarted] = useState(null) // what Download started
  const [comfyStarting, setComfyStarting] = useState(false)
  // how much they know about AI video and pictures, and Simple words (words.js), which follows the answer
  const [level, setLevel] = useState(null)
  const [simple, setSimple] = useState(simpleWords)
  const words = (on) => (setSimple(on), setSimpleWords(on))
  const [hc, setHc] = useState(highContrast)
  const contrast = (on) => (setHc(on), setContrast(on))
  const knows = (id) => (setLevel(id), words(id === 'new'))
  // anonymous usage counting (Privacy.jsx): off unless they say yes here; an earlier yes stays yes
  const [count, setCount] = useState(false)
  const countWas = useRef(null)
  useEffect(() => {
    window.ivstudio.usage.status().then((s) => ((countWas.current = s.choice), setCount(s.choice === 'on')), () => {})
  }, [])
  const body = useRef(null)
  const at = STEPS.findIndex(([id]) => id === step)
  const stepRef = useRef(step)
  stepRef.current = step
  const skipRef = useRef(null) // Esc always runs the latest close (with the latest choices)

  async function scan() {
    setError(null)
    setShown(0)
    setData(null)
    try {
      const d = await window.ivstudio.hardware.scan()
      setData(d)
      setWay((w) => w || d.rec.tier.renderOn)
      setPrefs((p) => p || d.rec.prefs)
      setWriter((w) => w || d.rec.writer)
      setPick(d.rec.downloads.filter((g) => g.recommended).map((g) => g.id))
    } catch (e) {
      setError(e.message)
    }
  }
  // the checklist ticks over one row at a time once the scan is back
  const rows = useMemo(() => (data ? scanRows(data) : []), [data])
  useEffect(() => {
    if (!data || shown >= rows.length) return
    const t = setTimeout(() => setShown((n) => n + 1), 170)
    return () => clearTimeout(t)
  }, [data, shown, rows.length])
  useEffect(() => {
    if (step === 'scan' && !data && !error) scan()
    body.current?.scrollTo?.({ top: 0 })
  }, [step])
  useEffect(() => {
    const key = (e) => e.key === 'Escape' && skipRef.current()
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])

  const rec = data?.rec
  // Claude Code and Codex: what the scan found, plus anything installed from the "Do you use..." card since
  const agents = useAgentSetup()
  const scanInstalls = data?.scan?.installs || {}
  const installs = { ...scanInstalls, claude: scanInstalls.claude || !!agents?.claude?.installed, codex: scanInstalls.codex || !!agents?.codex?.installed }
  const scanned = data && shown >= rows.length

  async function finish(target, cloudWizard = false) {
    try {
      await window.ivstudio.hardware.apply({ shotPrefs: prefs, promptEngine: writer !== data?.promptEngine ? writer : undefined, hardware: summaryOf(data), plainWords: simple, highContrast: hc, ...(level ? { aiLevel: level } : {}) })
    } catch (e) {
      notify?.(e.message)
    }
    // the answer to "Help improve IV Studio?" is saved here, once they've seen the question
    if (countWas.current === null || (countWas.current === 'on') !== count) await window.ivstudio.usage.set(count).catch(() => {})
    window.dispatchEvent(new CustomEvent('iv:settings'))
    onClose()
    if (target === 'tour') setTimeout(() => startTour('full'), 400)
    else if (target) go(target)
    if (cloudWizard) window.dispatchEvent(new CustomEvent('iv:cloud-wizard'))
  }
  async function skip() {
    if (stepRef.current === 'done') return finish()
    try {
      await window.ivstudio.hardware.apply({ plainWords: simple, highContrast: hc, ...(level ? { aiLevel: level } : {}) })
    } catch {}
    window.dispatchEvent(new CustomEvent('iv:settings'))
    onClose()
  }
  async function download() {
    const groups = rec.downloads.filter((g) => pick.includes(g.id) && !g.have)
    const ids = groups.flatMap((g) => g.missing)
    try {
      if (ids.length) await window.ivstudio.models.download(ids)
      if (packs) window.ivstudio.setup.installNodes().catch(() => {})
      setStarted({ groups: groups.map((g) => g.label), bytes: groups.reduce((s, g) => s + g.bytes, 0), packs })
    } catch (e) {
      notify?.(e.message)
    }
  }
  async function startComfy() {
    setComfyStarting(true)
    try {
      await window.ivstudio.comfy.start()
      await scan()
    } catch (e) {
      notify?.(e.message)
    }
    setComfyStarting(false)
  }

  skipRef.current = skip
  const next = () => setStep(STEPS[Math.min(STEPS.length - 1, at + 1)][0])
  const back = () => setStep(STEPS[Math.max(0, at - 1)][0])
  const canNext = step !== 'scan' || scanned

  const titles = {
    hello: ['Welcome to IV Studio', 'Let’s set it up for your computer'],
    scan: ['Checking your computer', 'Nothing leaves this computer'],
    pc: ['Your computer', 'What this computer can do'],
    way: ['Your way of working', 'Where things render, and the defaults'],
    get: ['What to download', 'Models go into ComfyUI’s own folders'],
    done: ['You’re set', 'Change any of this later in Settings']
  }

  return createPortal(
    <div className="welcome" role="dialog" aria-modal="true" aria-label="Welcome to IV Studio">
      <div className="welcome-panel">
        <button className="welcome-skip link-btn mono" onClick={skip} title="Close the wizard (Esc). Open it again from Settings → Check my computer.">
          {step === 'done' ? 'Done' : first ? 'Skip for now' : 'Close'} ×
        </button>
        <div className="welcome-scroll" ref={body}>
          <div key={step} className="welcome-hero-wrap">
            <Hero art={ART[step]} title={titles[step][0]} kicker={titles[step][1]} help={false} />
          </div>
          <ol className="wizard-steps welcome-steps" aria-label="Steps">
            {STEPS.map(([id, label, sub], i) => (
              <li key={id} className={`${step === id ? 'on' : ''} ${i <= at ? 'reached' : ''}`}>
                <button onClick={() => (i <= at || (data && i <= 4) ? setStep(id) : null)} aria-current={step === id ? 'step' : undefined} disabled={i > at && !(data && scanned)}>
                  <span className="wizard-n">{i < at ? '✓' : i + 1}</span>
                  <span className="wizard-label">{label}</span>
                  <span className="wizard-sub dim small">{sub}</span>
                </button>
              </li>
            ))}
          </ol>

          <div className="welcome-body" key={`b-${step}`}>
            {step === 'hello' && <Hello level={level} knows={knows} simple={simple} words={words} hc={hc} contrast={contrast} />}
            {step === 'scan' && <Scan rows={rows} shown={shown} error={error} retry={scan} />}
            {step === 'pc' && rec && <YourPc rec={rec} scan={data.scan} />}
            {step === 'way' && rec && <Way rec={rec} way={way} setWay={setWay} prefs={prefs} setPrefs={setPrefs} writer={writer} setWriter={setWriter} installs={installs} agents={agents} scan={data.scan} notify={notify} />}
            {step === 'get' && rec && <Get rec={rec} way={way} pick={pick} setPick={setPick} packs={packs} setPacks={setPacks} installs={installs} scan={data.scan} started={started} download={download} startComfy={startComfy} comfyStarting={comfyStarting} rescan={scan} notify={notify} />}
            {step === 'done' && rec && <Done rec={rec} way={way} prefs={prefs} writer={writer} started={started} onTour={() => finish('tour')} count={count} setCount={setCount} />}
          </div>
        </div>

        <footer className="welcome-foot">
          <span className="mono small dim">
            Step {at + 1} of {STEPS.length}
          </span>
          <div className="welcome-foot-btns">
            {at > 0 && (
              <button className="btn" onClick={back}>
                ← Back
              </button>
            )}
            {step === 'hello' && (
              <button className="btn btn-primary" onClick={next}>
                Check my computer →
              </button>
            )}
            {step !== 'hello' && step !== 'done' && (
              <button className="btn btn-primary" onClick={next} disabled={!canNext}>
                {step === 'scan' ? (scanned ? 'See what it means →' : 'Scanning…') : 'Next →'}
              </button>
            )}
            {step === 'done' && (
              <>
                {/* the cloud: straight into its own setup wizard (and its page behind it) */}
                {way !== 'local' && (
                  <button className={`btn ${way === 'cloud' ? 'btn-primary' : ''}`} onClick={() => finish('cloud', true)}>
                    Set up the cloud{way === 'cloud' ? ' →' : ''}
                  </button>
                )}
                {/* Create opens with the first starter filled in (starters.js), ready to hunt */}
                <button className={`btn ${way === 'cloud' ? '' : 'btn-primary'}`} onClick={() => finish('create').then(() => setTimeout(() => openStarter('first'), 600))}>
                  Make your first shot{way === 'cloud' ? '' : ' →'}
                </button>
              </>
            )}
          </div>
        </footer>
      </div>
    </div>,
    document.body
  )
}

const LEVELS = [
  ['new', 'New to it', 'I haven’t made AI video or pictures before.'],
  ['some', 'Tried a little', 'I’ve used an app or two.'],
  ['lots', 'Know it well', 'LoRAs, seeds and samplers are old friends.']
]

function Hello({ level, knows, simple, words, hc, contrast }) {
  const what = [
    ['Shots', 'Write an idea, hunt a few takes, pick one and finish it at full size.'],
    ['Characters and voices', 'Your own cast, with faces, voices and trained looks.'],
    ['Films and edits', 'Short films from a script, cut together in the editor.'],
    ['On your computer or in the cloud', 'Free on your own graphics card, or rented by the minute.']
  ]
  return (
    <section className="block create-step">
      <StepHead n={1} title="What IV Studio does" sub="A studio for making video with open models, on your computer." />
      <div className="wel-what">
        {what.map(([t, d], i) => (
          <div key={t} className="wel-what-card" style={{ '--i': i }}>
            <h3>{t}</h3>
            <p className="dim small">{d}</p>
          </div>
        ))}
      </div>
      <p className="wel-lede">
        First, a quick look at this computer: its graphics card, memory and free space. IV Studio reads them here and keeps them here, then suggests how to work and what to download. It takes a few seconds.
      </p>
      <div className="wel-know">
        <h3>How much do you know about making AI video and pictures?</h3>
        <div className="wel-ways wel-levels">
          {LEVELS.map(([id, title, desc]) => (
            <button key={id} className={`wel-way ${level === id ? 'on' : ''}`} onClick={() => knows(id)} aria-pressed={level === id}>
              <h3>{title}</h3>
              <p className="dim small words-exact">{desc}</p>
            </button>
          ))}
        </div>
        <label className="switch-toggle wel-simple">
          <input type="checkbox" checked={simple} onChange={(e) => words(e.target.checked)} />
          <span className="switch-track">
            <span className="switch-knob" />
          </span>
          <span>
            <strong>Simple words</strong>
            <span className="dim small words-exact">The app says “trained look” for LoRA, “variation number” for seed, “quick sharpen” for DLSS and so on. Everything else stays the same. Change it any time in Settings.</span>
          </span>
        </label>
        <label className="switch-toggle wel-simple">
          <input type="checkbox" checked={hc} onChange={(e) => contrast(e.target.checked)} />
          <span className="switch-track">
            <span className="switch-knob" />
          </span>
          <span>
            <strong>Higher contrast text</strong>
            <span className="dim small">Grey text turns close to white, so it’s easier to read. Settings → Accessibility also has bigger text, less motion and clearer focus outlines.</span>
          </span>
        </label>
      </div>
    </section>
  )
}

// the scan's checklist rows, from what came back
function scanRows({ scan, rec }) {
  const v = Object.fromEntries(rec.verdicts.map((x) => [x.id, x]))
  const i = scan.installs || {}
  return [
    { icon: 'gpu', label: 'Graphics card', value: v.gpu?.value, state: v.gpu?.state },
    { icon: 'ram', label: 'Memory', value: v.ram?.value, state: v.ram?.state },
    { icon: 'cpu', label: 'Processor', value: v.cpu?.value, state: v.cpu?.state },
    { icon: 'disk', label: 'Drives', value: (scan.drives || []).map((d) => `${d.path.replace(/\\$/, '')} ${gbs(d.free)} free`).join(' · ') || 'Unknown', state: v.disk?.state || 'ok' },
    { icon: 'pc', label: 'ComfyUI', value: i.comfyRunning ? 'Running' : i.comfyElsewhere ? `Running at ${i.comfyElsewhere.replace(/^https?:\/\//, '')}` : i.comfyFound ? 'Installed, not running' : 'Not found', state: i.comfyRunning ? 'great' : i.comfyElsewhere ? 'good' : i.comfyFound ? 'ok' : 'weak' },
    { icon: 'writer', label: 'Prompt writers', value: [i.claude && 'Claude Code', i.codex && 'Codex', i.ollama && 'Ollama'].filter(Boolean).join(' · ') || 'None yet', state: i.claude || i.codex || i.ollama ? 'good' : 'ok' },
    { icon: 'ram', label: 'Voices', value: i.voices ? 'Set up' : 'Not set up yet', state: i.voices ? 'good' : 'ok' },
    { icon: 'cloud', label: 'Cloud', value: i.cloud ? 'Set up' : 'Not set up yet', state: i.cloud ? 'good' : 'ok' }
  ]
}

function Scan({ rows, shown, error, retry }) {
  const placeholder = ['Graphics card', 'Memory', 'Processor', 'Drives', 'ComfyUI', 'Prompt writers', 'Voices', 'Cloud']
  return (
    <section className="block create-step">
      <StepHead n={2} title="Reading your computer" sub="Graphics card, memory, processor, drives and what’s installed." />
      {error ? (
        <div className="wel-error">
          <p>The scan didn’t finish: {error}</p>
          <button className="btn" onClick={retry}>
            Try again
          </button>
        </div>
      ) : (
        <ul className="wel-scan">
          {placeholder.map((label, k) => {
            const r = rows[k]
            const done = r && k < shown
            return (
              <li key={label} className={done ? `done s-${r.state}` : k === shown ? 'now' : ''}>
                <span className="wel-scan-mark">{done ? <Icon name="check" /> : <span className="wel-spin" />}</span>
                <span className="wel-scan-label">{label}</span>
                <span className="wel-scan-value mono small">{done ? r.value : 'checking…'}</span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

// a bar for an amount against a scale (VRAM against 32 GB, RAM against 128 GB, free against the drive)
const Meter = ({ value, max }) => (
  <span className="wel-meter" aria-hidden="true">
    <span style={{ width: `${Math.max(3, Math.min(100, (value / max) * 100))}%` }} />
  </span>
)

function YourPc({ rec, scan }) {
  const gpu = (scan.gpus || []).find((g) => g.vram) || null
  const meter = { gpu: gpu && [gpu.vram, 32 * GB], ram: [scan.ram, 64 * GB] }
  return (
    <>
      <section className={`wel-verdict t-${rec.tier.id}`}>
        <span className="wel-verdict-kicker mono">Verdict</span>
        <h2>{rec.tier.title}</h2>
        <p>{rec.tier.summary}</p>
      </section>
      <div className="wel-cards">
        {rec.verdicts.map((v, i) => (
          <article key={v.id} className={`wel-card s-${v.state}`} style={{ '--i': i }}>
            <header>
              <Icon name={v.id === 'disk' ? 'disk' : v.id === 'writer' ? 'writer' : v.id} />
              <span className="mono small">{v.label}</span>
              <span className={`wel-state s-${v.state}`}>{STATE_WORD[v.state]}</span>
            </header>
            <strong>{v.value}</strong>
            {meter[v.id] && <Meter value={meter[v.id][0]} max={meter[v.id][1]} />}
            <p className="dim small">{v.say}</p>
          </article>
        ))}
      </div>
      {rec.tips.length > 0 && (
        <ul className="wel-tips">
          {rec.tips.map((t) => (
            <li key={t.text} className={`t-${t.state}`}>
              {t.text}
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

const WAYS = [
  ['local', 'pc', 'This computer', 'Everything renders on your graphics card. Free, private, as fast as your card.'],
  ['both', 'both', 'Both', 'Pictures, music and voices here; the heaviest video in the cloud when you need it.'],
  ['cloud', 'cloud', 'The cloud', 'Video renders on RunPod, Modal or Comfy Cloud, billed by the minute or per run.']
]

function Seg({ value, options, onChange, label }) {
  return (
    <div className="wel-seg-row">
      <span className="mono small">{label}</span>
      <div className="segmented">
        {options.map(([v, t, off]) => (
          <button key={String(v)} className={value === v ? 'on' : ''} disabled={off} onClick={() => onChange(v)} title={off || undefined}>
            {t}
          </button>
        ))}
      </div>
    </div>
  )
}

// a speed preset's values in the shape Check my PC saves (shotPrefs)
function prefsForSpeed(id) {
  const p = previewFor(id)
  return { speed: id, previewMp: p.megapixels, quality: p.steps === 4 ? 'draft' : 'standard', finalMp: finishFor(id).megapixels }
}

function Way({ rec, way, setWay, prefs, setPrefs, writer, setWriter, installs, agents, scan, notify }) {
  const set = (p) => setPrefs((x) => ({ ...x, ...p }))
  const [videos, setVideos] = useState(null)
  useEffect(() => {
    window.ivstudio.folders.videos().then(setVideos, () => {})
  }, [])
  async function chooseVideos() {
    try {
      const v = await window.ivstudio.folders.chooseVideos()
      if (v) setVideos(v)
    } catch (e) {
      notify?.(e.message)
    }
  }
  const nvidiaOk = (scan.gpus || []).some((g) => g.vendor === 'nvidia')
  const dlssOk = scan.os?.platform === 'win32' && nvidiaOk
  return (
    <>
      <section className="block create-step">
        <StepHead n={4} title="Where things render" sub="Pick one; switch any time on the Cloud page." />
        <div className="wel-ways">
          {WAYS.map(([id, icon, title, desc]) => (
            <button key={id} className={`wel-way ${way === id ? 'on' : ''}`} onClick={() => setWay(id)} aria-pressed={way === id}>
              {rec.tier.renderOn === id && <span className="wel-rec mono">Recommended</span>}
              <Icon name={icon} />
              <h3>{title}</h3>
              <p className="dim small">{desc}</p>
            </button>
          ))}
        </div>
      </section>
      <section className="block create-step wel-agents">
        <StepHead title="Do you use Claude Code or Codex?" sub="If you have either, IV Studio can use it on your own plan to write your prompts and to make a whole idea for you from the Dashboard." />
        <AgentRows setup={agents} notify={notify} />
        <p className="dim small wel-agents-skip">Don’t use either? That’s fine: skip this. The Local writer works without them, and you can add them any time in Settings → Agents.</p>
      </section>
      <section className="block create-step">
        <StepHead title="Defaults for your shots" sub="Set to suit this computer. Every shot can still change them." />
        <div className="wel-segs">
          <Seg label="Speed" value={prefs.speed} onChange={(v) => set(prefsForSpeed(v))} options={SPEED_IDS.map((id) => [id, `${SPEEDS[id].label}${rec.prefs.speed === id ? ' · suits this computer' : ''}`])} />
          {SPEEDS[prefs.speed] && <p className="dim small wel-speed">{SPEEDS[prefs.speed].say} {SPEEDS[prefs.speed].trade}</p>}
          <Seg label="Enhancer" value={prefs.enhancer} onChange={(v) => set(v === 'upscale' ? { enhancer: v, upscale2x: true, fps: 48 } : { enhancer: v })} options={[['dlss', 'DLSS 5', !dlssOk && 'Needs an NVIDIA RTX card on Windows'], ['upscale', '2× upscale'], ['seedvr2', 'SeedVR2', !nvidiaOk && "Needs an NVIDIA card. It isn't available on an Apple GPU yet."]]} />
          <Seg
            label="Prompt writer"
            value={writer}
            onChange={setWriter}
            options={[
              ['claude', 'Claude Code', !installs.claude && 'Claude Code isn’t on this computer'],
              ['codex', 'Codex', !installs.codex && 'Codex isn’t on this computer'],
              ['local', 'Local (Ollama)']
            ]}
          />
        </div>
        <p className="wel-note dim small">
          <strong>Training a character:</strong> {rec.training.say}
        </p>
      </section>
      <section className="block create-step">
        <StepHead title="Where finished videos go" sub="Films and edits you export, and cloud renders brought to this computer. Change it any time in Settings → Folders." />
        <div className="wel-videos">
          <span className="mono wel-videos-path">{videos?.path || '…'}</span>
          {videos?.free != null && <span className="mono small dim">{gbs(videos.free)} free</span>}
          <button className="btn btn-small" disabled={!videos || videos.incognito} onClick={chooseVideos}>
            Change…
          </button>
        </div>
        <p className="wel-note dim small">Renders made on this computer are kept in ComfyUI’s own output folder, on the drive ComfyUI is on{scan.modelsDrive ? ` (${scan.modelsDrive.path.replace(/\\$/, '')})` : ''}.</p>
      </section>
    </>
  )
}

// No ComfyUI answering at the saved address: one found on another port ("Use it"), its address typed in, a check
// again for a ComfyUI still loading, Start ComfyUI, or (none on this PC) Get ComfyUI for me.
function FindComfy({ installs, startComfy, comfyStarting, rescan, notify }) {
  const [addr, setAddr] = useState('')
  const [busy, setBusy] = useState(false)
  async function use(url) {
    setBusy(true)
    try {
      await window.ivstudio.settings.set({ comfyUrl: url })
      window.dispatchEvent(new CustomEvent('iv:settings'))
      await rescan()
    } catch (e) {
      notify?.(e.message)
    }
    setBusy(false)
  }
  async function again() {
    setBusy(true)
    await rescan()
    setBusy(false)
  }
  const at = installs.comfyElsewhere
  return (
    <div className="wel-callout wel-find">
      {at ? (
        <>
          <p>
            ComfyUI is running at <span className="mono">{at.replace(/^http:\/\//, '')}</span>, not at the address IV Studio had saved.
          </p>
          <button className="btn btn-primary" onClick={() => use(at)} disabled={busy}>
            Use it
          </button>
        </>
      ) : (
        <>
          <p>{installs.comfyFound ? 'ComfyUI isn’t answering, so IV Studio can’t see which models you already have, or download into it. If it’s still starting up, wait for it to finish loading, then check again.' : 'No ComfyUI found on this computer. Install ComfyUI (the Desktop app from comfy.org, or the portable build), then check again.'}</p>
          <div className="wel-find-btns">
            {installs.comfyFound && (
              <button className="btn btn-primary" onClick={startComfy} disabled={comfyStarting || busy}>
                {comfyStarting ? 'Starting ComfyUI…' : 'Start ComfyUI'}
              </button>
            )}
            <button className="btn" onClick={again} disabled={busy || comfyStarting}>
              {busy ? 'Checking…' : 'Check again'}
            </button>
          </div>
        </>
      )}
      <div className="wel-find-addr">
        <span className="small dim">Already running at another address? Type it as you would in a browser:</span>
        <div className="set-inline grow">
          <input value={addr} placeholder="localhost:8000" onChange={(e) => setAddr(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addr.trim() && use(addr.trim())} />
          <button className="btn btn-small" disabled={!addr.trim() || busy} onClick={() => use(addr.trim())}>
            Use this address
          </button>
        </div>
      </div>
      {!installs.comfyFound && !at && <GetComfy notify={notify} recheck={rescan} />}
    </div>
  )
}

function Get({ rec, way, pick, setPick, packs, setPacks, installs, scan, started, download, startComfy, comfyStarting, rescan, notify }) {
  if (way === 'cloud')
    return (
      <section className="block create-step">
        <StepHead n={5} title="Nothing to download here" sub="In the cloud, the models live on your cloud storage." />
        <p className="wel-lede">The Cloud page sets up RunPod, Modal or Comfy Cloud and fetches the models there the first time. This computer only needs IV Studio.</p>
      </section>
    )
  const groups = rec.downloads
  const toggle = (id) => setPick((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  const chosen = groups.filter((g) => pick.includes(g.id) && !g.have)
  const bytes = chosen.reduce((s, g) => s + g.bytes, 0)
  const md = scan.modelsDrive
  const short = md && bytes > md.free
  const allHere = installs.modelsKnown && groups.every((g) => g.have || !g.recommended) && !groups.some((g) => g.recommended)
  return (
    <section className="block create-step">
      <StepHead n={5} title="What to download" sub="The ones for how you’ll work are ticked. Each is checked against its published fingerprint." />
      <p className="wel-lede">IV Studio uses the ComfyUI already on this computer, wherever it is (the Desktop app, or a portable ComfyUI on another drive), or gets one for you. These download into that ComfyUI’s models folder, so they go on its drive.</p>
      {!installs.modelsKnown && <FindComfy installs={installs} startComfy={startComfy} comfyStarting={comfyStarting} rescan={rescan} notify={notify} />}
      {allHere && (
        <div className="wel-allhere">
          <Icon name="check" />
          <p>Everything this way of working needs is already on this computer. Tick anything extra you’d like.</p>
        </div>
      )}
      <ul className="wel-downloads">
        {groups.map((g) => (
          <li key={g.id} className={`${g.have ? 'have' : ''} ${pick.includes(g.id) ? 'on' : ''}`}>
            <label>
              {g.have ? <span className="wel-have"><Icon name="check" /></span> : <input type="checkbox" checked={pick.includes(g.id)} disabled={!installs.modelsKnown || !!started} onChange={() => toggle(g.id)} />}
              <span className="wel-dl-name">{g.label}</span>
              {g.recommended && <span className="wel-rec mono">Recommended</span>}
              <span className="wel-dl-size mono small">{g.have ? 'Already here' : g.size}</span>
            </label>
          </li>
        ))}
      </ul>
      <label className="wel-packs">
        <input type="checkbox" checked={packs} disabled={!installs.modelsKnown || !!started} onChange={(e) => setPacks(e.target.checked)} />
        <span>Also add the ComfyUI node packs IV Studio uses (pinned versions; existing ones are left alone)</span>
      </label>
      <div className="wel-get-foot">
        <span className={`mono small ${short ? 'wel-short' : ''}`}>
          {gbs(bytes)} selected{md ? ` · ${gbs(md.free)} free on ${md.path}` : ''}
          {short ? ' · not enough room' : ''}
        </span>
        {started ? (
          <span className="wel-started">
            <Icon name="check" /> Downloading in the background: {gbs(started.bytes)}
            {started.packs ? ' and the node packs' : ''}. Follow it in Settings → Setup.
          </span>
        ) : (
          <button className="btn btn-primary" onClick={download} disabled={!installs.modelsKnown || (!chosen.length && !packs) || short}>
            Download {chosen.length ? gbs(bytes) : 'node packs'}
          </button>
        )}
      </div>
    </section>
  )
}

function Done({ rec, way, prefs, writer, started, onTour, count, setCount }) {
  const w = WAYS.find(([id]) => id === way)
  const lines = [
    ['Renders', w ? w[2] : way],
    ['Speed', SPEEDS[prefs.speed]?.label || 'Quality'],
    ['Previews', `${prefs.previewMp} MP · ${prefs.quality === 'draft' ? 'Draft' : 'Standard'}`],
    ['Finals', `${prefs.finalMp} MP${SPEEDS[prefs.speed]?.upscale2x ? ' + 2x' : ''} with ${{ dlss: 'DLSS 5', upscale: 'the 2× upscale', seedvr2: 'SeedVR2' }[prefs.enhancer] || 'SeedVR2'}`],
    ['Prompt writer', WRITERS[writer]],
    ['Downloads', started ? `${gbs(started.bytes)} on the way` : way === 'cloud' ? 'In the cloud' : rec.downloads.some((g) => g.recommended) ? 'Not started' : 'All here']
  ]
  return (
    <section className="block create-step">
      <StepHead n={6} title="Here’s your setup" sub="Applied when you leave this page." />
      <dl className="wel-summary">
        {lines.map(([k, v]) => (
          <div key={k}>
            <dt className="mono small">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <p className="wel-lede">{way === 'local' ? 'Make your first shot: it opens with an example already written, so you can press Hunt, pick the take you like and finish it. Or write your own.' : 'Set up the cloud first (one sign-in), then make your first shot.'}</p>
      {/* the full tour (tours.js full): page by page, and how to get each page's own tour */}
      <div className="wel-tour">
        <span className="wel-tour-q" aria-hidden="true">?</span>
        <div>
          <strong>New here? Take the tour</strong>
          <p className="small dim">Two minutes, page by page, ending on the How it works button every page has. End it any time.</p>
        </div>
        <button className="btn" onClick={onTour}>
          Take the tour →
        </button>
      </div>
      <WelcomeTerms />
      <UsageAsk on={count} onChange={setCount} />
    </section>
  )
}

// MiniMax H3's terms (terms.js): read and agreed here, or at the first H3 render
function WelcomeTerms() {
  const terms = useH3Terms()
  if (!terms) return null
  return (
    <div className="wel-tour wel-terms">
      <span className="wel-tour-q" aria-hidden="true">
        {terms.accepted ? '✓' : '§'}
      </span>
      <div>
        <strong>The rules for MiniMax H3</strong>
        <p className="small dim">
          {terms.accepted
            ? 'You’ve agreed to IV Studio’s terms for H3. They’re in Settings › About whenever you want them.'
            : 'Shots are made with MiniMax H3. Before the first one, read its rules (real people only with consent, nothing involving minors, say it’s AI when you post it) and agree once.'}
        </p>
      </div>
      <button className="btn" onClick={() => openH3Terms({ accepted: terms.accepted })}>
        {terms.accepted ? 'Read them' : 'Read and agree →'}
      </button>
    </div>
  )
}

// what Settings shows afterwards
function summaryOf(d) {
  if (!d) return null
  const g = (d.scan.gpus || [])[0]
  return { at: d.scan.at, tier: d.rec.tier.id, title: d.rec.tier.title, gpu: g ? `${g.name}${g.vram ? ` · ${gbs(g.vram)}` : ''}` : null, ram: gbs(d.scan.ram), cpu: d.scan.cpu?.model, canTrain: !!d.rec.training?.localReady }
}
