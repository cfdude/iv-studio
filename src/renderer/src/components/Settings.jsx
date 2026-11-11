import { useEffect, useState } from 'react'
import StartComfy, { RestartComfy } from './StartComfy'
import { UpdateSettings } from './Update'
import { ART } from './Hero'
import Stage from './Stage'
import { ask } from './Confirm'
import { setUnblurred } from './Loras'
import { SetCard, SetField, SetSwitch, Pill, SetPath, SetCode } from './SettingsKit'
import { startTour } from '../tours'
import { comfyLauncherHelp, keychainRefusedText } from '../../../shared/platform'
import { secretRemedy } from '../../../service/secrets'
import { usePlatform } from '../platform'
import { AccountCard } from './ComfyAccount'
import Credits from './Credits'
import { openH3Terms, reportMisuse, useH3Terms } from './H3Terms'
import { SAFEGUARDS_URL } from '../../../service/terms'
import { SpeedCards } from './Speed'
import { savedSpeed } from '../../../service/speed'
import { PrivacyCard } from './Privacy'
import { AgentRows, useAgentSetup } from './AgentSetup'

const WRITER_MODEL = 'huihui_ai/qwen3-vl-abliterated:8b-instruct'
const GB = (b) => `${(b / 1e9).toFixed(1)} GB`
const open = (url) => window.ivstudio.links.open(url)

// The page's topics, in order: the index on the left and each card's number come from here.
const SECTIONS = [
  ['pc', 'Your computer'],
  ['words', 'Words'],
  ['access', 'Accessibility'],
  ['comfy', 'ComfyUI'],
  ['folders', 'Folders'],
  ['data', 'Data folder'],
  ['models', 'Models'],
  ['writer', 'Prompt writer'],
  ['account', 'Comfy account'],
  ['civitai', 'Civitai'],
  ['agents', 'Agents'],
  ['privacy', 'Privacy'],
  ['updates', 'Updates'],
  ['about', 'About']
]

const WORKFLOWS = [
  ['text', 'Text', 'fl2va'],
  ['frames', 'First / last frame', 'fl2va'],
  ['continue', 'Continue a video', 'fl2va'],
  ['reference', 'References', 'ref2va'],
  ['take', 'Sequences · one take', 'ref2va'],
  ['retake', 'Sequences · retake', 'ref2va']
]
const short = (n) => n.split(/[\\/]/).pop().replace(/\.safetensors$/, '')
const kindOf = (n) => (/fl2va/i.test(n) ? 'fl2va' : /ref2va|omniref/i.test(n) ? 'ref2va' : null)

// The welcome wizard's scan, and a way back into it.
function PcCard({ n, settings, setSettings, notify }) {
  const hw = settings.hardware
  const speed = savedSpeed(settings)
  async function pickSpeed(id) {
    try {
      setSettings(await window.ivstudio.settings.set({ speed: id }))
    } catch (err) {
      notify(err.message)
    }
  }
  const check = () => window.dispatchEvent(new CustomEvent('iv:welcome'))
  return (
    <SetCard
      id="pc"
      n={n}
      title="Your computer"
      sub="What this computer can do, and the defaults that suit it."
      aside={
        <button className="btn btn-small" onClick={check}>
          {hw ? 'Check again' : 'Check my computer'}
        </button>
      }
    >
      <div className="set-pc">
        {ART['pc-card'] && <div className="set-pc-art" style={{ backgroundImage: `url("${ART['pc-card']}")` }} aria-hidden="true" />}
        {hw ? (
          <div className="set-pc-sum">
            <strong>{hw.title}</strong>
            <div className="set-chips">
              {hw.gpu && <span className="set-chip mono">{hw.gpu}</span>}
              {hw.ram && <span className="set-chip mono">{hw.ram} RAM</span>}
              {hw.at && <span className="set-chip mono dim">Checked {new Date(hw.at).toLocaleDateString()}</span>}
            </div>
          </div>
        ) : (
          <div className="set-pc-sum">
            <strong>Not checked yet</strong>
            <p className="small dim">A one-minute look at your graphics card, memory and drives, then the settings that suit them.</p>
          </div>
        )}
      </div>
      <SetField label="Speed" hint="How Create starts each shot: preview size, steps and takes, and the finish. Smaller cards need the quicker presets; any shot can still change it.">
        <SpeedCards value={speed} onPick={pickSpeed} recommended={settings.shotPrefs?.speed} />
      </SetField>
    </SetCard>
  )
}

// Simple words (words.js): plain words for people new to AI video and pictures; only the words change
const WORD_SAMPLES = [
  ['LoRA', 'trained look'],
  ['RefMod', 'reference pack'],
  ['seed', 'variation number'],
  ['sampler', 'drawing method'],
  ['DLSS 5', 'quick sharpen'],
  ['SeedVR2', 'detail restore'],
  ['upscale', 'enlarge'],
  ['prompt', 'description']
]
function WordsCard({ n, settings, setSettings }) {
  const set = async (patch) => {
    setSettings(await window.ivstudio.settings.set(patch))
    window.dispatchEvent(new CustomEvent('iv:settings'))
  }
  return (
    <SetCard id="words" n={n} title="Words" sub="How IV Studio talks to you." aside={settings.plainWords ? <Pill tone="ok">Simple</Pill> : <Pill>Standard</Pill>}>
      <SetField label="Simple words" hint="For people new to AI video and pictures: the app explains itself in everyday words. Only the words change; every page, control and setting stays the same.">
        <SetSwitch checked={settings.plainWords} onChange={(on) => set({ plainWords: on })}>
          {settings.plainWords ? 'On' : 'Off'}
        </SetSwitch>
      </SetField>
      <SetField label="For example">
        <div className="set-words words-exact">
          {WORD_SAMPLES.map(([a, b]) => (
            <span key={a} className="set-chip">
              <span className="mono">{a}</span> → {b}
            </span>
          ))}
        </div>
      </SetField>
    </SetCard>
  )
}

// Accessibility (a11y.js and styles.css; text size is the window's zoom, in main). Each applies at once.
const TEXT_SIZE = [
  ['normal', 'Normal'],
  ['large', 'Large'],
  ['larger', 'Larger']
]
function AccessCard({ n, settings, setSettings, notify }) {
  const set = async (patch) => {
    try {
      setSettings(await window.ivstudio.settings.set(patch))
      window.dispatchEvent(new CustomEvent('iv:settings'))
    } catch (err) {
      notify(err.message)
    }
  }
  const on = ['highContrast', 'reduceMotion', 'focusRings', 'underlineLinks'].filter((k) => settings[k]).length + (settings.textSize && settings.textSize !== 'normal' ? 1 : 0)
  return (
    <SetCard id="access" n={n} title="Accessibility" sub="Make IV Studio easier to read and to use. Each change applies straight away." aside={on ? <Pill tone="ok">{on} on</Pill> : null}>
      <SetField label="Text size" hint="Makes everything bigger: text, buttons and pictures, the way browser zoom does.">
        <div className="segmented" role="radiogroup" aria-label="Text size">
          {TEXT_SIZE.map(([id, label]) => (
            <button key={id} role="radio" aria-checked={(settings.textSize || 'normal') === id} className={(settings.textSize || 'normal') === id ? 'on' : ''} onClick={() => set({ textSize: id })}>
              {label}
            </button>
          ))}
        </div>
      </SetField>
      <SetField label="Higher contrast text" hint="Grey secondary text turns close to white, and lines are stronger.">
        <SetSwitch checked={settings.highContrast} onChange={(v) => set({ highContrast: v })}>
          {settings.highContrast ? 'On' : 'Off'}
        </SetSwitch>
      </SetField>
      <SetField label="Reduce motion" hint="Stops animations, sliding panels and the moving pictures on the Workflows pages. Also follows your system’s own setting.">
        <SetSwitch checked={settings.reduceMotion} onChange={(v) => set({ reduceMotion: v })}>
          {settings.reduceMotion ? 'On' : 'Off'}
        </SetSwitch>
      </SetField>
      <SetField label="Clear focus outlines" hint="A thick yellow ring shows which control the keyboard is on (Tab moves it).">
        <SetSwitch checked={settings.focusRings} onChange={(v) => set({ focusRings: v })}>
          {settings.focusRings ? 'On' : 'Off'}
        </SetSwitch>
      </SetField>
      <SetField label="Underline links" hint="Links are underlined, so they don’t rely on colour alone.">
        <SetSwitch checked={settings.underlineLinks} onChange={(v) => set({ underlineLinks: v })}>
          {settings.underlineLinks ? 'On' : 'Off'}
        </SetSwitch>
      </SetField>
    </SetCard>
  )
}

// The ComfyUI IV Studio renders on, and how IV Studio starts it: the person's own launcher (found or picked).
function ComfyCard({ n, settings, setSettings, notify, recheck, comfyUp, comfyBusy }) {
  const [url, setUrl] = useState(settings.comfyUrl)
  const [l, setL] = useState(null)
  useEffect(() => setUrl(settings.comfyUrl), [settings.comfyUrl])
  useEffect(() => {
    window.ivstudio.comfy.launcher().then(setL).catch(() => {})
  }, [settings.comfyUrl, settings.comfyLauncher])
  async function saveUrl() {
    try {
      setSettings(await window.ivstudio.settings.set({ comfyUrl: url.trim() }))
      recheck()
    } catch (err) {
      notify(err.message)
    }
  }
  const set = async (patch) => setSettings(await window.ivstudio.settings.set(patch))
  async function choose() {
    if (await window.ivstudio.comfy.chooseLauncher()) setSettings(await window.ivstudio.settings.get())
  }
  async function chooseFolder() {
    try {
      if (await window.ivstudio.comfy.chooseFolder()) setSettings(await window.ivstudio.settings.get())
    } catch (err) {
      notify(err.message)
    }
  }
  const platform = usePlatform()
  const inFolder = l?.inFolder?.some((f) => f.path === l.using)
  return (
    <SetCard
      id="comfy"
      n={n}
      title="ComfyUI"
      sub="IV Studio uses the ComfyUI you already have, on any drive (or gets one for you: Setup → Get ComfyUI for me). H3 models, LoRAs from Civitai and your renders all go into that ComfyUI’s own folders."
      aside={comfyUp ? <Pill tone="ok">Ready</Pill> : comfyBusy ? <Pill tone="warn">Busy</Pill> : <Pill tone="warn">Not running</Pill>}
    >
      <SetField label="Address" hint="Where ComfyUI answers, such as localhost:8188 (portable) or localhost:8000 (the Desktop app). Typing http:// is optional.">
        <div className="set-inline grow">
          <input value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && url.trim() !== settings.comfyUrl && saveUrl()} />
          <button className="btn btn-small" disabled={url.trim() === settings.comfyUrl} onClick={saveUrl}>
            Save
          </button>
        </div>
      </SetField>
      {l && !l.local && (
        <SetField label="Starting it">
          <p className="small dim set-plain">IV Studio can start ComfyUI only when it runs on this computer.</p>
        </SetField>
      )}
      {l?.local && (
        <>
          <SetField label="ComfyUI folder">
            <div className="set-inline grow">
              <SetPath path={l.folder} />
              <button className="btn btn-small" onClick={chooseFolder}>
                Choose folder…
              </button>
            </div>
          </SetField>
          {l.folder && l.inFolder.length > 0 && (
            <SetField label="Start file">
              <select value={inFolder ? l.using : ''} onChange={(e) => set({ comfyLauncher: e.target.value })}>
                {!inFolder && <option value="">(another launcher, below)</option>}
                {l.inFolder.map((f) => (
                  <option key={f.path} value={f.path}>
                    {f.label}
                  </option>
                ))}
              </select>
            </SetField>
          )}
          <SetField label="Start it with" hint={comfyLauncherHelp(platform)}>
            <div className="set-inline grow">
              <SetPath path={l.using} empty="No launcher found" />
              <button className="btn btn-small" onClick={choose}>
                Choose…
              </button>
              {!comfyUp && !comfyBusy && <StartComfy notify={notify} recheck={recheck} />}
              {(comfyUp || comfyBusy) && <RestartComfy notify={notify} recheck={recheck} />}
            </div>
            {!l.chosen && !l.folder && l.found.length > 1 && (
              <div className="set-found">
                <span className="mono small dim">Also found</span>
                {l.found.slice(1, 5).map((f) => (
                  <button key={f.path} className="set-chip mono" title={`Use ${f.path}`} onClick={() => set({ comfyLauncher: f.path })}>
                    {f.path}
                  </button>
                ))}
              </div>
            )}
          </SetField>
          <SetField label="On open" hint="ComfyUI keeps running after IV Studio closes.">
            <SetSwitch checked={settings.comfyAutoStart !== false} onChange={(on) => set({ comfyAutoStart: on })}>
              Start ComfyUI when IV Studio opens, if it isn’t running already
            </SetSwitch>
          </SetField>
        </>
      )}
    </SetCard>
  )
}

// Where in ComfyUI's output folder renders save, normally and in Incognito.
function FolderCard({ n, settings, setSettings, notify, incognito }) {
  const [normal, setNormal] = useState(settings.outputFolder || '')
  const [hidden, setHidden] = useState(settings.privateFolder || '')
  const changed = normal.trim() !== (settings.outputFolder || '') || hidden.trim() !== (settings.privateFolder || '')
  async function save() {
    try {
      const s = await window.ivstudio.settings.set({ outputFolder: normal, privateFolder: hidden })
      setSettings(s)
      setNormal(s.outputFolder)
      setHidden(s.privateFolder)
      notify('Saved. The next render goes there.', 'info')
    } catch (err) {
      notify(err.message)
    }
  }
  const enter = (e) => e.key === 'Enter' && changed && save()
  const [videos, setVideos] = useState(null)
  useEffect(() => {
    window.ivstudio.folders.videos().then(setVideos, () => {})
  }, [])
  async function chooseVideos() {
    try {
      const v = await window.ivstudio.folders.chooseVideos()
      if (v) (setVideos(v), notify('Saved. Finished videos go there from now on.', 'info'))
    } catch (err) {
      notify(err.message)
    }
  }
  return (
    <SetCard
      id="folders"
      n={n}
      title="Folders"
      sub="Where finished videos go, and where in ComfyUI’s output folder renders save. Files already made stay where they are."
      aside={incognito ? <Pill tone="warn">In Incognito now</Pill> : null}
      foot={`Use a folder name, or a path such as Studio\\Private; it always stays inside ComfyUI’s folders. Pictures, videos and sounds you add in Incognito go into input\\${hidden.trim() || 'IV Private'}.`}
    >
      <SetField label="Finished videos" hint={`Films and edits you export, and cloud renders brought to this computer.${videos?.free != null ? ` ${(videos.free / 1024 ** 3).toFixed(0)} GB free there.` : ''} Renders made on this computer stay in ComfyUI’s output folder, on its drive.`}>
        <div className="set-inline grow">
          <SetPath path={videos?.path} />
          <button className="btn btn-small" disabled={videos?.incognito} onClick={chooseVideos}>
            Choose folder…
          </button>
          {videos?.custom && (
            <button className="link-btn" onClick={async () => setVideos(await window.ivstudio.folders.resetVideos())}>
              Back to Videos
            </button>
          )}
        </div>
      </SetField>
      <SetField label="Normal renders">
        <div className="set-prefixed">
          <span className="mono">output\</span>
          <input value={normal} placeholder="straight into output" onChange={(e) => setNormal(e.target.value)} onKeyDown={enter} />
        </div>
      </SetField>
      <SetField label="Incognito renders">
        <div className="set-prefixed">
          <span className="mono">output\</span>
          <input value={hidden} placeholder="IV Private" onChange={(e) => setHidden(e.target.value)} onKeyDown={enter} />
        </div>
      </SetField>
      {changed && (
        <div className="set-actions">
          <button className="link-btn" onClick={() => (setNormal(settings.outputFolder || ''), setHidden(settings.privateFolder || ''))}>
            Undo
          </button>
          <button className="btn btn-small btn-primary" onClick={save}>
            Save folders
          </button>
        </div>
      )}
    </SetCard>
  )
}

// Which H3 model each workflow runs: fine-tunes differ (realism, animation, speed).
function ModelCard({ n, settings, setSettings, notify }) {
  const [info, setInfo] = useState(null)
  useEffect(() => {
    window.ivstudio.h3Models().then(setInfo).catch((err) => setInfo({ error: err.message }))
  }, [])
  const choices = settings.models || {}
  async function choose(id, name) {
    try {
      setSettings(await window.ivstudio.settings.set({ models: { ...choices, [id]: name || undefined } }))
    } catch (err) {
      notify(err.message)
    }
  }
  const custom = WORKFLOWS.filter(([id]) => choices[id]).length
  return (
    <SetCard
      id="models"
      n={n}
      title="Models"
      sub="The main H3 model each workflow runs. Fine-tunes lean towards realism, animation or speed."
      aside={info?.models ? <Pill>{custom ? `${custom} changed` : 'All defaults'}</Pill> : null}
      foot="fl2va models land on exact frames; ref2va models follow reference pictures and keep a voice across shots. A cloud ComfyUI only lists the models in its own storage."
    >
      {info?.error && <p className="small pink set-plain">ComfyUI didn't answer: {info.error}</p>}
      {!info && <p className="small dim set-plain">Asking ComfyUI…</p>}
      {info?.models &&
        WORKFLOWS.map(([id, label, want]) => {
          const value = choices[id] || ''
          const kind = kindOf(value || info.defaults[id])
          return (
            <SetField key={id} label={label} tag={want} warn={kind && kind !== want ? `This workflow expects a ${want} model.` : null}>
              <select className={value ? 'set-changed' : ''} value={value} onChange={(e) => choose(id, e.target.value)}>
                <option value="">Default · {short(info.defaults[id])}</option>
                {info.models.map((m) => (
                  <option key={m} value={m}>
                    {short(m)}
                    {kindOf(m) ? ` · ${kindOf(m)}` : ''}
                  </option>
                ))}
              </select>
            </SetField>
          )
        })}
    </SetCard>
  )
}

// The person's own Claude Code or Codex as the writer: whether it's on this PC, and which of its models writes.
const HARNESS = {
  claude: { name: 'Claude Code', maker: 'Anthropic', login: 'Claude', get: 'https://claude.com/claude-code', key: 'claudeModel' },
  codex: { name: 'Codex', maker: 'OpenAI', login: 'ChatGPT', get: 'https://openai.com/codex', key: 'codexModel' }
}

function WriterCard({ n, settings, setSettings, notify }) {
  const [status, setStatus] = useState(null)
  const [key, setKey] = useState('')
  const [pull, setPull] = useState(null)
  const [addr, setAddr] = useState(settings.ollamaUrl || '')
  const refresh = () => window.ivstudio.prompts.status().then(setStatus).catch(() => setStatus(null))
  useEffect(() => {
    refresh()
    return window.ivstudio.prompts.onPull((ev) => setPull(ev))
  }, [])
  useEffect(() => setAddr(settings.ollamaUrl || ''), [settings.ollamaUrl])
  // Claude Code or Codex installed from here: look again, so its models show
  const agents = useAgentSetup()
  const agentsFound = `${!!agents?.claude?.installed}${!!agents?.codex?.installed}`
  useEffect(() => {
    if (agents) refresh()
  }, [agentsFound])

  const save = async (patch) => {
    try {
      setSettings(await window.ivstudio.settings.set(patch))
      refresh()
    } catch (err) {
      notify(err.message)
    }
  }
  async function install(model) {
    setPull({ status: 'starting' })
    try {
      await window.ivstudio.prompts.pull(model)
      await save({ ollamaModel: model })
    } catch (err) {
      notify(err.message)
    } finally {
      setPull(null)
    }
  }
  async function saveKey(k) {
    try {
      setSettings(await window.ivstudio.settings.setComfyKey(k))
      setKey('')
      refresh()
    } catch (err) {
      notify(err.message)
    }
  }

  const engine = settings.promptEngine
  const models = status?.models || []
  const hasModel = models.some((m) => m.name === settings.ollamaModel)
  const pct = pull?.total ? Math.floor((pull.completed / pull.total) * 100) : null
  const addrChanged = addr.trim() !== (settings.ollamaUrl || '')
  const missing = (id) => (id === 'local' ? status && !status.installed : id === 'contextir' ? !settings.hasComfyKey : id === 'openai' ? !settings.openaiUrl || !settings.openaiModel : status && !status.harnesses?.[id]?.installed)
  const ENGINES = [
    ['local', 'Local', 'Free · your own Ollama', 'Not installed'],
    ['claude', 'Claude Code', 'Your Claude plan', 'Not installed'],
    ['codex', 'Codex', 'Your ChatGPT plan', 'Not installed'],
    ['openai', 'OpenAI-compatible', 'Your own server or API', 'Needs setting up'],
    ['contextir', 'Context IR', 'MiniMax · paid per prompt', 'Needs a key']
  ]
  const h = HARNESS[engine]
  const harness = status?.harnesses?.[engine]

  return (
    <SetCard
      id="writer"
      n={n}
      title="Prompt writer"
      sub="Writes the H3 prompt from your idea in plain words (✦ Write it for me)."
      foot={
        engine !== 'contextir' && (
          <>
            It follows MiniMax's own H3 prompt guide, downloaded from MiniMax the first time it writes, under the{' '}
            <button className="link-btn" onClick={() => open('https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/LICENSE')}>
              MiniMax H3 Community License
            </button>
            .
          </>
        )
      }
    >
      <div className="set-engines" role="radiogroup" aria-label="Prompt writer">
        {ENGINES.map(([id, name, line, off]) => (
          <button key={id} role="radio" aria-checked={engine === id} className={`set-engine ${engine === id ? 'on' : ''}`} onClick={() => save({ promptEngine: id })}>
            <span className="set-engine-name">{name}</span>
            <span className="small dim">{line}</span>
            {missing(id) && <span className="set-engine-off mono">{off}</span>}
          </button>
        ))}
      </div>

      {h && harness && (!harness.installed || (agents?.[engine] && agents[engine].signedIn !== true)) && (
        <SetField label={h.name}>
          <AgentRows setup={agents} notify={notify} only={engine} />
        </SetField>
      )}
      {h && harness?.installed && (
        <SetField label="Model" hint={`Your own ${h.name} writes on your ${h.login} login and plan, with no tools except reading your reference pictures; your idea and pictures go to ${h.maker}. It doesn't use this computer's GPU, so it's as quick while ComfyUI renders.`}>
          <select value={settings[h.key] || ''} onChange={(e) => save({ [h.key]: e.target.value })}>
            {harness.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </SetField>
      )}

      {engine === 'local' && (
        <>
          <SetField label="Ollama address" hint={`Empty means Ollama on this computer (or OLLAMA_HOST). For another container or computer, enter its address, like 192.168.1.20:11434.${status && !status.local ? (status.running ? ' Connected.' : ` Not answering at ${status.url}.`) : ''}`}>
            <div className="set-inline grow">
              <input value={addr} placeholder={status?.url || 'http://127.0.0.1:11434'} onChange={(e) => setAddr(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addrChanged && save({ ollamaUrl: addr })} />
              <button className="btn btn-small" disabled={!addrChanged} onClick={() => save({ ollamaUrl: addr })}>
                Save
              </button>
            </div>
          </SetField>
          {status && !status.installed ? (
            <SetField label="Model">
              <p className="small pink set-plain">
                Ollama isn't installed.{' '}
                <button className="link-btn" onClick={() => open('https://ollama.com/download')}>
                  Get Ollama
                </button>
              </p>
            </SetField>
          ) : (
            status && (
              <SetField label="Model" hint="It loads only while writing, then frees the GPU for rendering. Private and free.">
                {models.length ? (
                  <select value={hasModel ? settings.ollamaModel : ''} onChange={(e) => save({ ollamaModel: e.target.value })}>
                    {!hasModel && <option value="">Choose a model</option>}
                    {models.map((m) => (
                      <option key={m.name} value={m.name}>
                        {m.name} · {GB(m.size)}
                        {m.vision ? ' · sees pictures' : ''}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="small dim set-plain">{status.running ? 'No models yet.' : 'Ollama starts when you first write a prompt.'}</p>
                )}
                {!models.some((m) => m.name === WRITER_MODEL) && (
                  <div className="dl set-dl">
                    {pull ? (
                      <>
                        <div className="bar">
                          <span style={{ width: `${pct ?? 6}%` }} className={pct == null ? 'indeterminate' : ''} />
                        </div>
                        <span className="mono dim">{pct != null ? `${pct}%` : pull.status}</span>
                      </>
                    ) : (
                      <button className="btn btn-small" onClick={() => install(WRITER_MODEL)}>
                        Install the recommended writer (about 6 GB)
                      </button>
                    )}
                  </div>
                )}
              </SetField>
            )
          )}
        </>
      )}

      {engine === 'openai' && <OpenAiWriter settings={settings} setSettings={setSettings} save={save} notify={notify} />}

      {engine === 'contextir' && (
        <SetField
          label="Comfy.org key"
          hint={`MiniMax's own prompt rewriter, in the exact format H3 was trained on; it looks at your reference media. Paid through your Comfy.org account, ${status?.contextIrPrice || 'a few cents a prompt'}, and runs through ComfyUI.`}
        >
          {settings.secretStoreRefused ? (
            <>
              <p className="set-hint">{keychainRefusedText('darwin')}</p>
              <RemoveSaved name="comfyApiKey" settings={settings} onRemove={() => saveKey('')} />
            </>
          ) : settings.hasComfyKey ? (
            <div className="set-inline">
              <Pill tone="ok">Saved · encrypted on this computer</Pill>
              <button className="link-btn" onClick={() => saveKey('')}>
                Remove
              </button>
            </div>
          ) : (
            <>
              <RemoveSaved name="comfyApiKey" settings={settings} onRemove={() => saveKey('')} />
              <div className="set-inline grow">
                <input type="password" value={key} placeholder="comfyui-…" onChange={(e) => setKey(e.target.value)} autoComplete="off" />
                <button className="btn btn-small" disabled={!key.trim()} onClick={() => saveKey(key)}>
                  Save
                </button>
              </div>
              <p className="set-hint">
                Make one at{' '}
                <button className="link-btn" onClick={() => open('https://platform.comfy.org/login')}>
                  platform.comfy.org
                </button>{' '}
                and add credits there. The key stays on this computer.
              </p>
            </>
          )}
        </SetField>
      )}
      <SetField label="Search by what’s in a file" hint="While nothing renders, the local writer (Ollama, or your OpenAI-compatible server when it sees pictures) looks at each new video and picture in the Library and writes a sentence and a few tags, so search finds “red car” or “beach at night”. It stops when a render starts.">
        <SetSwitch checked={settings.describeLibrary !== false} onChange={async (on) => setSettings(await window.ivstudio.settings.set({ describeLibrary: on }))}>
          {settings.describeLibrary !== false ? 'On' : 'Off'}
        </SetSwitch>
      </SetField>
    </SetCard>
  )
}

// "Remove it" for a saved key that can't be opened, or that a refused Mac Keychain hides. Clearing needs no encryption.
function RemoveSaved({ name, settings, onRemove }) {
  if (!settings.removable?.includes(name)) return null
  return (
    <p className="set-hint">
      The saved key can’t be used.{' '}
      <button className="link-btn" onClick={onRemove}>
        Remove it
      </button>
    </p>
  )
}

// Saved keys the system won't open, and what to do about each. On a Mac whose Keychain refused access there is
// nothing to re-enter yet, so the allow-in-Keychain text shows, with Remove next to each key.
function SecretNotice({ settings }) {
  if (settings.secretStoreRefused) return <p className="notice">{keychainRefusedText('darwin')}</p>
  const names = settings.unreadable || []
  if (!names.length) return null
  return (
    <>
      {names.map((name) => (
        <p key={name} className="notice">
          {secretRemedy(name).text}
        </p>
      ))}
    </>
  )
}

// Prompt writer → OpenAI-compatible (GitHub #15): any server that speaks the OpenAI API (llama.cpp, llama-swap,
// vLLM, LM Studio, LiteLLM, LocalAI, OpenAI). It writes exactly as the local writer does; the address, model and
// "sees pictures" are plain settings, the key and extra headers are stored encrypted (settings:setOpenaiSecrets).
function OpenAiWriter({ settings, setSettings, save, notify }) {
  const [addr, setAddr] = useState(settings.openaiUrl || '')
  const [model, setModel] = useState(settings.openaiModel || '')
  const [key, setKey] = useState('')
  const [headers, setHeaders] = useState('')
  const [check, setCheck] = useState(null) // { ok, url, models, error } | 'checking'
  useEffect(() => setAddr(settings.openaiUrl || ''), [settings.openaiUrl])
  useEffect(() => setModel(settings.openaiModel || ''), [settings.openaiModel])
  const look = () => {
    if (!settings.openaiUrl) return setCheck(null)
    setCheck('checking')
    window.ivstudio.prompts.openai().then(setCheck).catch((err) => setCheck({ ok: false, models: [], error: err.message }))
  }
  // look again whenever the address or the key changes
  useEffect(look, [settings.openaiUrl, settings.hasOpenaiKey, settings.hasOpenaiHeaders])
  const secrets = async (patch, done) => {
    try {
      setSettings(await window.ivstudio.settings.setOpenaiSecrets(patch))
      done?.()
    } catch (err) {
      notify(err.message)
    }
  }
  const addrChanged = addr.trim() !== (settings.openaiUrl || '')
  const modelChanged = model.trim() !== (settings.openaiModel || '')
  const models = check && check !== 'checking' ? check.models || [] : []
  const listed = !models.length || models.includes(settings.openaiModel)
  const state =
    check === 'checking' ? (
      <Pill>Checking…</Pill>
    ) : check?.ok ? (
      <Pill tone="ok">{models.length ? `Connected · ${models.length} model${models.length === 1 ? '' : 's'}` : 'Connected'}</Pill>
    ) : check ? (
      <Pill tone="warn">Not answering</Pill>
    ) : null
  return (
    <>
      <SetField
        label="Address"
        hint={check && check !== 'checking' && !check.ok ? check.error : 'The server’s OpenAI API address: llama.cpp and llama-swap localhost:8080, LM Studio localhost:1234, vLLM localhost:8000, LiteLLM localhost:4000, or https://api.openai.com/v1. IV Studio adds /v1 when there’s no path.'}
      >
        <div className="set-inline grow">
          <input value={addr} placeholder="http://localhost:8080/v1" onChange={(e) => setAddr(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addrChanged && save({ openaiUrl: addr })} aria-label="OpenAI-compatible server address" />
          <button className="btn btn-small" disabled={!addrChanged} onClick={() => save({ openaiUrl: addr })}>
            Save
          </button>
          {settings.openaiUrl && !addrChanged && (
            <button className="btn btn-small" disabled={check === 'checking'} onClick={look}>
              Check
            </button>
          )}
          {state}
        </div>
      </SetField>
      <SetField
        label="Model"
        warn={!listed ? `The server doesn’t list ${settings.openaiModel}.` : null}
        hint="The model name the server expects. With llama-swap, the name picks the model it loads. Your idea and pictures go to this server; nothing is unloaded by IV Studio."
      >
        <div className="set-inline grow">
          <input value={model} list="iv-openai-models" placeholder={models[0] || 'qwen3-vl-8b'} onChange={(e) => setModel(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && modelChanged && save({ openaiModel: model })} aria-label="Model name" />
          <datalist id="iv-openai-models">
            {models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          <button className="btn btn-small" disabled={!modelChanged} onClick={() => save({ openaiModel: model })}>
            Save
          </button>
        </div>
      </SetField>
      <SetField label="Pictures" hint="Turn on for a vision model (Qwen-VL, Gemma 3, GPT-4o…). It then looks at your reference pictures, and can review takes and read shots for Rebuild and Remake.">
        <SetSwitch checked={settings.openaiVision} onChange={(on) => save({ openaiVision: on })}>
          It can see pictures
        </SetSwitch>
      </SetField>
      <SetField label="API key" tag="optional" hint="Only if the server asks for one (OpenAI, a hosted provider, a LiteLLM with keys). Sent as Authorization: Bearer. Stored encrypted on this computer. Agents using IV Studio's MCP server read it from IV_STUDIO_LLM_KEY or OPENAI_API_KEY instead.">
        {settings.hasOpenaiKey ? (
          <div className="set-inline">
            <Pill tone="ok">Saved · encrypted on this computer</Pill>
            <button className="link-btn" onClick={() => secrets({ key: '' })}>
              Remove
            </button>
          </div>
        ) : (
          <>
            <RemoveSaved name="openaiKey" settings={settings} onRemove={() => secrets({ key: '' })} />
            <div className="set-inline grow">
              <input type="password" value={key} placeholder="sk-…" onChange={(e) => setKey(e.target.value)} autoComplete="off" aria-label="API key" />
              <button className="btn btn-small" disabled={!key.trim()} onClick={() => secrets({ key }, () => setKey(''))}>
                Save
              </button>
            </div          </div>
          </>
        )}
      </SetField>
      <SetField label="Extra headers" tag="optional" hint="One per line, like X-Api-Version: 2. For providers that want more than a key. Stored encrypted; agents read them from IV_STUDIO_LLM_HEADERS.">
        {settings.hasOpenaiHeaders ? (
          <div className="set-inline">
            <Pill tone="ok">Saved · encrypted on this computer</Pill>
            <button className="link-btn" onClick={() => secrets({ headers: '' })}>
              Remove
            </button>
          </div>
        ) : (
          <>
            <RemoveSaved name="openaiHeaders" settings={settings} onRemove={() => secrets({ headers: '' })} />
            <div className="set-inline grow">
              <textarea rows={2} value={headers} placeholder="X-Header-Name: value" onChange={(e) => setHeaders(e.target.value)} aria-label="Extra headers" />
              <button className="btn btn-small" disabled={!headers.trim()} onClick={() => secrets({ headers }, () => setHeaders(''))}>
                Save
              </button>
            </div          </div>
          </>
        )}
      </SetField>
    </>
  )
}

// Civitai: the person's own API key (for downloading LoRAs) and the opt-in for mature LoRAs.
function CivitaiCard({ n, settings, setSettings, notify }) {
  const [key, setKey] = useState('')
  async function saveKey(k) {
    try {
      setSettings(await window.ivstudio.settings.setCivitaiKey(k))
      setKey('')
    } catch (err) {
      notify(err.message)
    }
  }
  async function mature(on) {
    if (on && !(await ask({ title: 'Show mature LoRAs?', message: 'Only if you are 18 or over. LoRAs then come from civitai.red, Civitai’s unrestricted address, and adult LoRAs and previews can appear (previews stay blurred until you click them). LoRAs of real people and anything involving minors are never shown.', confirm: 'I’m 18 or over, show them' }))) return
    // turning mature off also puts the blur back
    const s = await window.ivstudio.settings.set(on ? { civitaiMature: true } : { civitaiMature: false, civitaiUnblur: false })
    setSettings(s)
    setUnblurred(s.civitaiMature && s.civitaiUnblur)
  }
  async function unblur(on) {
    const s = await window.ivstudio.settings.set({ civitaiUnblur: on })
    setSettings(s)
    setUnblurred(s.civitaiMature && s.civitaiUnblur)
  }
  return (
    <SetCard id="civitai" n={n} title="Civitai" sub="Where the LoRAs page finds LoRAs to download.">
      <SetField label="API key">
        {settings.secretStoreRefused ? (
          <>
            <p className="set-hint">{keychainRefusedText('darwin')}</p>
            <RemoveSaved name="civitaiKey" settings={settings} onRemove={() => saveKey('')} />
          </>
        ) : settings.hasCivitaiKey ? (
          <div className="set-inline">
            <Pill tone="ok">Saved · encrypted on this computer</Pill>
            <button className="link-btn" onClick={() => saveKey('')}>
              Remove
            </button>
          </div>
        ) : (
          <>
            <RemoveSaved name="civitaiKey" settings={settings} onRemove={() => saveKey('')} />
            <div className="set-inline grow">
              <input type="password" value={key} placeholder="Civitai API key" onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && key.trim() && saveKey(key)} autoComplete="off" />
              <button className="btn btn-small" disabled={!key.trim()} onClick={() => saveKey(key)}>
                Save
              </button>
            </div>
            <p className="set-hint">
              Searching works without one; downloading needs it. It’s free: on{' '}
              <button className="link-btn" onClick={() => open('https://civitai.com/user/account')}>
                civitai.com
              </button>{' '}
              open Account settings, then API keys. The key stays on this computer.
            </p>
          </>
        )}
      </SetField>
      <SetField label="Mature LoRAs" hint="18+ only. LoRAs of real people and anything involving minors are never shown.">
        <SetSwitch checked={settings.civitaiMature} onChange={mature}>
          Show mature LoRAs
        </SetSwitch>
        {settings.civitaiMature && (
          <SetSwitch checked={settings.civitaiUnblur} onChange={unblur}>
            Show their previews without the blur
          </SetSwitch>
        )}
      </SetField>
    </SetCard>
  )
}

// The chat's spending limit (spending.js): off by default; when on, Seedance steps priced under both amounts, and
// covered by the Comfy.org balance, go ahead without an Allow card. 211 Comfy credits = $1.
const BUDGET = { on: false, daily: 1000, perStep: 250 }
const asUsd = (credits) => `$${(credits / 211).toFixed(2)}`
function SpendingField({ settings, setSettings, notify }) {
  const b = { ...BUDGET, ...(settings.chatBudget || {}) }
  const [daily, setDaily] = useState(String(b.daily))
  const [perStep, setPerStep] = useState(String(b.perStep))
  const [today, setToday] = useState(null)
  useEffect(() => {
    setDaily(String(b.daily))
    setPerStep(String(b.perStep))
    window.ivstudio.chat.spending?.().then(setToday).catch(() => {})
  }, [b.on, b.daily, b.perStep])
  // the chat spending something changes today's figure
  useEffect(() => {
    return window.ivstudio.chat.onChange(() => {
      window.ivstudio.chat.spending?.().then(setToday).catch(() => {})
    })
  }, [])
  const whole = (v, fallback) => {
    const x = Math.round(Number(v))
    return v !== '' && Number.isFinite(x) && x >= 0 ? x : fallback
  }
  async function save(patch) {
    try {
      setSettings(await window.ivstudio.settings.set({ chatBudget: { on: b.on, daily: b.daily, perStep: b.perStep, ...patch } }))
    } catch (err) {
      notify(err.message)
    }
  }
  const amount = (label, value, setValue, key) => (
    <label className="set-budget-row">
      <span className="set-budget-label small">{label}</span>
      <input
        type="number"
        min="0"
        step="50"
        value={value}
        aria-label={label}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => save({ [key]: whole(value, b[key]) })}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
      <span className="small dim">credits · about {asUsd(whole(value, b[key]))}</span>
    </label>
  )
  return (
    <SetField
      label="Spending limit"
      hint="For IV Studio’s chat. Off: every step that spends Comfy.org credits asks first. On: a Seedance step goes ahead without asking when its price (IV Studio’s own, the top of any range) fits both amounts and your balance covers it. Cloud-GPU renders, character training and anything without a known price always ask. Every paid step counts when it starts, even if the render later fails; the day starts at midnight."
    >
      <SetSwitch checked={b.on} onChange={(on) => save({ on })}>
        Let the chat spend credits without asking, up to a limit
      </SetSwitch>
      {b.on && (
        <div className="set-budget">
          {amount('A day', daily, setDaily, 'daily')}
          {amount('One step', perStep, setPerStep, 'perStep')}
        </div>
      )}
      {today?.on && <p className="set-hint mono small">{today.label}</p>}
    </SetField>
  )
}

// Agents (MCP): a message to paste into any agent, the manual commands, and the Claude Code skill.
function AgentCard({ n, mcp, settings, setSettings, notify }) {
  const [agents, setAgents] = useState(null)
  const [client, setClient] = useState('claude')
  const setup = useAgentSetup()
  const refresh = () => window.ivstudio.agents.info().then(setAgents)
  useEffect(() => {
    refresh()
  }, [])
  if (!mcp || !agents) return null
  const cmd = `"${mcp.command}" "${mcp.args[0]}"`
  const manual = {
    claude: `claude mcp add -s user iv-studio -e ELECTRON_RUN_AS_NODE=1 -- ${cmd}`,
    codex: `codex mcp add iv-studio --env ELECTRON_RUN_AS_NODE=1 -- ${cmd}`,
    json: JSON.stringify({ mcpServers: { 'iv-studio': mcp } }, null, 2)
  }
  async function installSkill() {
    try {
      await window.ivstudio.agents.installSkill()
      refresh()
    } catch (err) {
      notify(err.message)
    }
  }
  const skill = !agents.skillInstalled ? null : agents.skillCurrent ? 'ok' : 'warn'
  return (
    <SetCard id="agents" n={n} title="Agents" sub="Claude Code, Codex and other agents can render, sequence and edit in IV Studio, with the same projects and results you see here." aside={<Pill>MCP</Pill>}>
      <SetField label="On this computer" hint="Your own Claude Code or Codex, on your own plan. Install puts it in with the maker's own installer; Sign in opens its browser login.">
        <AgentRows setup={setup} notify={notify} />
      </SetField>
      <SpendingField settings={settings} setSettings={setSettings} notify={notify} />
      <SetField label="Easiest" hint="One message: your agent adds IV Studio, reads its guide and checks your setup.">
        <SetCode text={agents.paste} label="Copy message" tall />
      </SetField>
      <SetField label="Add it yourself">
        <div className="segmented set-seg">
          {[
            ['claude', 'Claude Code'],
            ['codex', 'Codex'],
            ['json', 'Other (JSON)']
          ].map(([id, label]) => (
            <button key={id} className={client === id ? 'on' : ''} onClick={() => setClient(id)}>
              {label}
            </button>
          ))}
        </div>
        <SetCode text={manual[client]} label="Copy" />
      </SetField>
      <SetField label="Claude Code skill" hint="Teaches Claude Code IV Studio's workflow (shots, H3 prompts, sequences, edits and the house rules) so it picks the right tools without being told.">
        <div className="set-inline">
          {skill && <Pill tone={skill}>{skill === 'ok' ? 'Added' : 'Out of date'}</Pill>}
          {skill !== 'ok' && (
            <button className="btn btn-small" onClick={installSkill}>
              {skill ? 'Update the skill' : 'Add the skill to Claude Code'}
            </button>
          )}
          <button className="link-btn mono small" onClick={() => open('https://github.com/hollisorg/iv-studio/blob/main/skills/iv-studio/SKILL.md')}>
            View on GitHub ↗
          </button>
        </div>
        {agents.skillInstalled && <SetPath path={agents.skillFile} />}
      </SetField>
    </SetCard>
  )
}

function AboutCard({ n, info }) {
  const [credits, setCredits] = useState(false)
  const terms = useH3Terms()
  const agreed = terms?.at ? new Date(terms.at).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : null
  return (
    <SetCard id="about" n={n} title="About" aside={terms && (terms.accepted ? <Pill tone="ok">Terms agreed</Pill> : <Pill tone="warn">Terms to agree</Pill>)}>
      <SetField label="IV Studio">
        <div className="set-inline">
          <span className="set-big mono">v{info?.version}</span>
          <button className="link-btn mono small" onClick={() => open('https://github.com/hollisorg/iv-studio')}>
            GitHub ↗
          </button>
          <button className="link-btn mono small" onClick={() => open('https://infinitevariance.ai')}>
            infinitevariance.ai ↗
          </button>
          <button className="link-btn mono small" onClick={() => window.ivstudio.learn.openGuide().catch(() => {})}>
            The guide (PDF) ↗
          </button>
        </div>
      </SetField>
      <SetField
        label="Terms of use"
        hint="IV Studio is Powered by MiniMax H3. Using H3 means agreeing to IV Studio’s terms, which carry MiniMax’s use restrictions: real people only with consent, nothing involving minors, say it’s AI when you post it, and more. You’re asked once, before your first H3 render."
      >
        <div className="set-inline about-terms">
          {terms?.accepted ? <span className="small">Agreed on {agreed}</span> : <span className="small pink">Not agreed yet</span>}
          <button className={`btn btn-small ${terms && !terms.accepted ? 'btn-primary' : ''}`} onClick={() => openH3Terms({ accepted: !!terms?.accepted })}>
            {terms && !terms.accepted ? 'Read and agree' : 'Read the terms'}
          </button>
          <button className="link-btn mono small" onClick={() => window.ivstudio.terms.openLicense().catch(() => {})}>
            MiniMax’s licence ↗
          </button>
        </div>
      </SetField>
      <SetField label="Report misuse" hint="Seen something made with IV Studio that breaks the terms, or that uses you or someone else without consent? Email us. Every report is read and acted on.">
        <div className="set-inline about-report">
          <button className="btn btn-small" onClick={reportMisuse}>
            Report misuse
          </button>
          <span className="mono small">{terms?.abuseEmail || 'abuse@infinitevariance.ai'}</span>
          <button className="link-btn mono small" onClick={() => open(SAFEGUARDS_URL)}>
            How we keep it safe ↗
          </button>
        </div>
      </SetField>
      <SetField label="Tour" hint="A two-minute walk round IV Studio, page by page. Each page also has its own How it works button.">
        <div className="set-inline">
          <button className="btn btn-small" onClick={() => startTour('full')}>
            Take the full tour
          </button>
        </div>
      </SetField>
      <SetField label="Credits" hint="Every model, tool, node pack and library IV Studio is built on: who made it, what it does here and its licence.">
        <div className="set-inline">
          <button className="btn btn-small about-credits" onClick={() => setCredits(true)}>
            Credits
          </button>
        </div>
      </SetField>
      {credits && <Credits onClose={() => setCredits(false)} />}
    </SetCard>
  )
}

// Settings and Setup (what ComfyUI has and needs) are two tabs of one page; Setup's dot shows what to fix.
export function SettingsTabs({ tab, go, setup }) {
  const missing = setup?.items?.filter((i) => i.status === 'missing').length || 0
  return (
    <div className="section-switch settings-tabs" role="tablist" aria-label="Settings or Setup">
      {[
        ['settings', 'Settings'],
        ['setup', 'Setup']
      ].map(([id, label]) => (
        <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => go(id)}>
          {label}
          {id === 'setup' && missing > 0 && <span className="tab-count">{missing} to fix</span>}
        </button>
      ))}
    </div>
  )
}

// The page's own scroll box (the routed page scrolls, not the window).
function scroller(el) {
  let s = el
  while (s && !/(auto|scroll)/.test(getComputedStyle(s).overflowY)) s = s.parentElement
  return s
}

// Where IV Studio keeps its own data (projects, edits, voices, trainings, the voice engine and Shinobi), and moving
// it to another drive: copy, check, then restart on the new folder. ComfyUI's models, LoRAs and renders aren't
// here; they live in ComfyUI's folders, on whatever drive ComfyUI is on.
function DataCard({ n, notify }) {
  const [info, setInfo] = useState(null)
  const [size, setSize] = useState(null)
  const [plan, setPlan] = useState(null) // { to, free }: picked, not started
  const [progress, setProgress] = useState(null)
  const [moved, setMoved] = useState(null)
  const [busy, setBusy] = useState(false)
  const refresh = () => window.ivstudio.data.info().then(setInfo).catch((err) => notify(err.message))
  useEffect(() => {
    refresh()
    window.ivstudio.data.size().then(setSize).catch(() => {})
    return window.ivstudio.data.onProgress(setProgress)
  }, [])
  if (!info) return null
  async function choose() {
    try {
      const p = await window.ivstudio.data.choose()
      if (p) setPlan(p)
    } catch (err) {
      notify(err.message)
    }
  }
  async function move() {
    setBusy(true)
    setProgress({ phase: 'counting' })
    try {
      setMoved(await window.ivstudio.data.move(plan.to))
      setPlan(null)
    } catch (err) {
      notify(err.message)
      setProgress(null)
    } finally {
      setBusy(false)
    }
  }
  async function removeOld() {
    if (!(await ask({ title: 'Remove the old copy?', message: `This deletes IV Studio’s old data in ${info.old.dir}. The copy IV Studio uses now, in ${info.dir}, stays.`, confirm: 'Remove the old copy', danger: true }))) return
    setBusy(true)
    try {
      await window.ivstudio.data.removeOld()
      await refresh()
      notify('Old copy removed.', 'info')
    } catch (err) {
      notify(err.message)
    } finally {
      setBusy(false)
    }
  }
  const pct = progress?.total ? Math.floor((progress.done / progress.total) * 100) : null
  const phase = { counting: 'Counting files…', copying: 'Copying…', copied: 'Checking the copy…', checking: 'Checking the copy…', checked: 'Checking the copy…', done: 'Done' }[progress?.phase] || ''
  const where = { portable: 'Portable', moved: 'Moved', env: 'Set by IV_STUDIO_DATA' }[info.source]
  return (
    <SetCard
      id="data"
      n={n}
      title="Data folder"
      sub="What IV Studio makes and installs for itself: projects, edits, characters, voices, trainings, the voice engine and Shinobi. ComfyUI’s models, LoRAs and your renders aren’t here; they stay in ComfyUI’s own folders."
      aside={info.moved ? <Pill tone="warn">Drive not found</Pill> : where ? <Pill>{where}</Pill> : null}
    >
      <SetField label="Folder" hint={size ? `${GB(size.bytes)} in ${size.files.toLocaleString()} files${info.free != null ? ` · ${GB(info.free)} free on that drive` : ''}.` : 'Measuring…'}>
        <div className="set-inline grow">
          <SetPath path={info.dir} />
          <button className="btn btn-small" onClick={() => window.ivstudio.files.reveal(info.dir)}>
            Show
          </button>
        </div>
      </SetField>
      {info.moved && (
        <SetField label="Moved data" warn={`Your data was moved to ${info.moved}, which isn’t there now. This run uses the default folder; connect the drive and restart IV Studio.`} />
      )}
      <SetField label="Another drive" hint={info.canMove ? 'Copies everything, checks the copy, then IV Studio restarts on it. The current folder isn’t changed until you remove it.' : null}>
        {!info.canMove && <p className="small dim set-plain">{info.whyNot}</p>}
        {info.canMove && !moved && !plan && (
          <div className="set-inline">
            <button className="btn btn-small" disabled={busy} onClick={choose}>
              Move to another drive…
            </button>
          </div>
        )}
        {plan && !moved && (
          <>
            <p className="small set-plain">
              Copy everything to <span className="mono">{plan.to}</span>
              {plan.free != null ? ` (${GB(plan.free)} free there)` : ''}. Let renders and downloads finish first.
            </p>
            {busy ? (
              <div className="dl">
                <div className="bar">
                  <span style={{ width: `${pct ?? 6}%` }} className={pct == null ? 'indeterminate' : ''} />
                </div>
                <span className="mono dim">
                  {phase}
                  {pct != null && progress?.phase === 'copying' ? ` ${pct}% of ${GB(progress.total)}` : ''}
                </span>
              </div>
            ) : (
              <div className="set-actions">
                <button className="link-btn" onClick={() => setPlan(null)}>
                  Cancel
                </button>
                <button className="btn btn-small btn-primary" onClick={move}>
                  Move
                </button>
              </div>
            )}
          </>
        )}
        {moved && (
          <>
            <p className="small set-plain">
              Copied and checked: {GB(moved.bytes)} in {moved.files.toLocaleString()} files, now in <span className="mono">{moved.to}</span>. IV Studio uses it from its next start.
            </p>
            <div className="set-inline">
              <button className="btn btn-small btn-primary" onClick={() => window.ivstudio.data.restart()}>
                Restart IV Studio now
              </button>
            </div>
          </>
        )}
      </SetField>
      {info.old && !moved && (
        <SetField label="Old copy" hint="Left behind by the move, in case you want it. IV Studio doesn’t use it.">
          <div className="set-inline grow">
            <SetPath path={info.old.dir} />
            <button className="btn btn-small" disabled={busy} onClick={removeOld}>
              Remove
            </button>
          </div>
        </SetField>
      )}
    </SetCard>
  )
}

export default function Settings({ info, recheck, notify, go, setup }) {
  const [settings, setSettings] = useState(null)
  const [active, setActive] = useState('pc')

  useEffect(() => {
    const load = () => window.ivstudio.settings.get().then(setSettings)
    load()
    // the welcome wizard (Check my PC) changed the writer or the PC summary
    window.addEventListener('iv:settings', load)
    return () => window.removeEventListener('iv:settings', load)
  }, [])

  // the index follows the card at the top of the page
  const ready = !!settings
  useEffect(() => {
    const root = document.querySelector('.settings-v2')
    const sc = root && scroller(root)
    if (!sc) return
    const on = () => {
      const cards = [...root.querySelectorAll('.set-card')]
      if (!cards.length) return
      const line = sc.getBoundingClientRect().top + sc.clientHeight * 0.3
      let cur = cards[0].dataset.set
      for (const c of cards) if (c.getBoundingClientRect().top <= line) cur = c.dataset.set
      if (sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 4) cur = cards[cards.length - 1].dataset.set
      setActive(cur)
    }
    sc.addEventListener('scroll', on, { passive: true })
    const t = setTimeout(on, 300)
    return () => (sc.removeEventListener('scroll', on), clearTimeout(t))
  }, [ready])

  if (!settings) return null
  const comfyUp = setup?.items?.some((i) => i.id === 'comfyui' && i.status === 'ok')
  const comfyBusy = setup?.items?.some((i) => i.id === 'comfyui' && i.busy)
  const shown = SECTIONS.filter(([id]) => id !== 'agents' || info?.mcp)
  const n = (id) => shown.findIndex(([s]) => s === id) + 1
  const jump = (id) => {
    setActive(id)
    document.getElementById(`set-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const common = { settings, setSettings, notify }

  return (
    <div className="settings settings-v2">
      <Stage effect="dial" art="settings" title="Settings" kicker="Infinite Variance" />
      <SettingsTabs tab="settings" go={go} setup={setup} />

      <SecretNotice settings={settings} />

      <div className="set-layout">
        <nav className="set-nav" aria-label="Settings sections">
          {shown.map(([id, label], i) => (
            <button key={id} className={active === id ? 'on' : ''} aria-current={active === id ? 'true' : undefined} onClick={() => jump(id)}>
              <span className="mono">{String(i + 1).padStart(2, '0')}</span>
              {label}
            </button>
          ))}
        </nav>

        <div className="set-cards">
          <PcCard n={n('pc')} {...common} />
          <WordsCard n={n('words')} {...common} />
          <AccessCard n={n('access')} {...common} />
          <ComfyCard n={n('comfy')} {...common} recheck={recheck} comfyUp={comfyUp} comfyBusy={comfyBusy} />
          <FolderCard n={n('folders')} {...common} incognito={!!info?.incognito} />
          <DataCard n={n('data')} notify={notify} />
          <ModelCard n={n('models')} {...common} />
          <WriterCard n={n('writer')} {...common} />
          <AccountCard n={n('account')} notify={notify} />
          <CivitaiCard n={n('civitai')} {...common} />
          <AgentCard n={n('agents')} mcp={info?.mcp} {...common} />
          <PrivacyCard n={n('privacy')} notify={notify} />
          <UpdateSettings n={n('updates')} notify={notify} />
          <AboutCard n={n('about')} info={info} />
        </div>
      </div>
    </div>
  )
}
