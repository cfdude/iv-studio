import { useEffect, useState } from 'react'
import StartComfy from './StartComfy'
import { UpdateSettings } from './Update'
import Hero from './Hero'
import { ask } from './Confirm'
import { setUnblurred } from './Loras'
import { comfyLauncherHelp, sepText } from '../../../shared/platform'
import { usePlatform } from '../platform'

const WRITER_MODEL = 'huihui_ai/qwen3-vl-abliterated:8b-instruct'
const GB = (b) => `${(b / 1e9).toFixed(1)} GB`

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

// Which H3 model each workflow runs: fine-tunes differ (realism, animation, speed).
function ModelSettings({ settings, setSettings, notify }) {
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
  return (
    <section className="group">
      <div className="group-head">
        <h2>Models</h2>
        <p className="dim small">The main H3 model each workflow runs. Fine-tunes lean towards realism, animation or speed.</p>
      </div>
      <div className="group-body">
        {info?.error && <p className="small pink">ComfyUI didn't answer: {info.error}</p>}
        {info?.models &&
          WORKFLOWS.map(([id, label, want]) => {
            const value = choices[id] || ''
            const picked = value || info.defaults[id]
            const kind = kindOf(picked)
            return (
              <div key={id} className="row">
                <span className="row-label">{label}</span>
                <div className="model-pick">
                  <select value={value} onChange={(e) => choose(id, e.target.value)}>
                    <option value="">Default · {short(info.defaults[id])}</option>
                    {info.models.map((m) => (
                      <option key={m} value={m}>
                        {short(m)}
                        {kindOf(m) ? ` · ${kindOf(m)}` : ''}
                      </option>
                    ))}
                  </select>
                  {kind && kind !== want && <span className="small pink">This workflow expects a {want} model.</span>}
                </div>
              </div>
            )
          })}
        <p className="small dim">
          Text, First / last frame and Continue use an fl2va-type model (it lands on exact frames). References and Sequences use a ref2va-type model (it follows reference pictures and keeps a voice across shots). A cloud ComfyUI only lists the models in its own storage.
        </p>
      </div>
    </section>
  )
}

// The person's own Claude Code or Codex as the writer: whether it's on this PC, and which of its models writes.
const HARNESS = {
  claude: { name: 'Claude Code', maker: 'Anthropic', login: 'Claude', get: 'https://claude.com/claude-code', key: 'claudeModel' },
  codex: { name: 'Codex', maker: 'OpenAI', login: 'ChatGPT', get: 'https://openai.com/codex', key: 'codexModel' }
}
function HarnessWriter({ engine, settings, harness, save }) {
  const h = HARNESS[engine]
  if (!harness) return null
  if (!harness.installed)
    return (
      <p className="small pink">
        {h.name} isn't installed on this PC.{' '}
        <button className="link-btn" onClick={() => window.ivstudio.links.open(h.get)}>
          Get {h.name}
        </button>
      </p>
    )
  return (
    <>
      <p className="small dim">
        Your own {h.name} on this PC writes the prompt, on your {h.login} login and plan. It runs with no tools except reading your reference pictures, and nothing is saved there. Your idea and reference pictures go to {h.maker} to write it. It
        doesn't use this PC's GPU, so it's as quick while ComfyUI renders.
      </p>
      <div className="row">
        <span className="row-label">Model</span>
        <select value={settings[h.key] || ''} onChange={(e) => save({ [h.key]: e.target.value })}>
          {harness.models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </div>
    </>
  )
}

// Prompt writer: which engine writes prompts, the free local model, and the Comfy.org key for Context IR.
// Civitai: the person's own API key (for downloading LoRAs) and the opt-in for mature LoRAs.
function CivitaiSettings({ settings, setSettings, notify }) {
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
    <section className="group">
      <div className="group-head">
        <h2>Civitai</h2>
        <p className="dim small">Where the LoRAs page finds LoRAs to download.</p>
      </div>
      <div className="group-body">
        {settings.hasCivitaiKey ? (
          <p className="small">
            A Civitai API key is saved (encrypted on this PC).{' '}
            <button className="link-btn" onClick={() => saveKey('')}>
              Remove it
            </button>
          </p>
        ) : (
          <>
            <div className="key-form">
              <input type="password" value={key} placeholder="Civitai API key" onChange={(e) => setKey(e.target.value)} autoComplete="off" />
              <button className="btn btn-small" disabled={!key.trim()} onClick={() => saveKey(key)}>
                Save
              </button>
            </div>
            <p className="small dim">
              Searching works without one; downloading needs it. It’s free: on{' '}
              <button className="link-btn" onClick={() => window.ivstudio.links.open('https://civitai.com/user/account')}>
                civitai.com
              </button>{' '}
              open Account settings, then API keys, and add one. The key stays on this PC.
            </p>
          </>
        )}
        <label className="consent">
          <input type="checkbox" checked={!!settings.civitaiMature} onChange={(e) => mature(e.target.checked)} />
          <span>Show mature LoRAs (18+). Off by default.</span>
        </label>
        {settings.civitaiMature && (
          <label className="consent">
            <input type="checkbox" checked={!!settings.civitaiUnblur} onChange={(e) => unblur(e.target.checked)} />
            <span>Show mature previews without the blur. Off by default.</span>
          </label>
        )}
      </div>
    </section>
  )
}

// Folders: where in ComfyUI's output folder renders save, normally and in Incognito.
function FolderSettings({ settings, setSettings, notify, incognito }) {
  const sep = sepText(usePlatform())
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
  return (
    <section className="group">
      <div className="group-head">
        <h2>Folders</h2>
        <p className="dim small">Where in ComfyUI’s output folder renders save. The next render uses them; renders already made stay where they are.</p>
      </div>
      <div className="group-body">
        <label className="folder-row">
          <span>Normal renders</span>
          <span className="mono dim">output{sep}</span>
          <input value={normal} placeholder="straight into output" onChange={(e) => setNormal(e.target.value)} />
        </label>
        <label className="folder-row">
          <span>Incognito renders</span>
          <span className="mono dim">output{sep}</span>
          <input value={hidden} placeholder="IV Private" onChange={(e) => setHidden(e.target.value)} />
        </label>
        <p className="small dim">
          Incognito’s pictures, videos and sounds you add also go into input{sep}{hidden.trim() || 'IV Private'}. Use a folder name, or a path such as
          Studio{sep}Private; it always stays inside ComfyUI’s folders.{incognito ? ' You’re in Incognito now.' : ''}
        </p>
        <button className="btn btn-small" disabled={!changed} onClick={save}>
          Save folders
        </button>
      </div>
    </section>
  )
}

function WriterSettings({ settings, setSettings, notify }) {
  const [status, setStatus] = useState(null)
  const [key, setKey] = useState('')
  const [pull, setPull] = useState(null)
  const refresh = () => window.ivstudio.prompts.status().then(setStatus).catch(() => setStatus(null))

  useEffect(() => {
    refresh()
    return window.ivstudio.prompts.onPull((ev) => setPull(ev))
  }, [])

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

  return (
    <section className="group">
      <div className="group-head">
        <h2>Prompt writer</h2>
        <p className="dim small">Writes the H3 prompt from your idea in plain words (✦ Write it for me).</p>
      </div>
      <div className="group-body">
        <div className="segmented">
          <button className={engine === 'local' ? 'on' : ''} onClick={() => save({ promptEngine: 'local' })}>
            Local · free
          </button>
          <button className={engine === 'claude' ? 'on' : ''} onClick={() => save({ promptEngine: 'claude' })}>
            Claude Code
          </button>
          <button className={engine === 'codex' ? 'on' : ''} onClick={() => save({ promptEngine: 'codex' })}>
            Codex
          </button>
          <button className={engine === 'contextir' ? 'on' : ''} onClick={() => save({ promptEngine: 'contextir' })}>
            MiniMax Context IR
          </button>
        </div>

        {engine !== 'contextir' && (
          <p className="small dim">
            It follows MiniMax's own H3 prompt guide, which IV Studio downloads from MiniMax the first time it writes, under the{' '}
            <button className="link-btn" onClick={() => window.ivstudio.links.open('https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/LICENSE')}>
              MiniMax H3 Community License
            </button>
            .
          </p>
        )}

        {engine === 'claude' || engine === 'codex' ? (
          <HarnessWriter engine={engine} settings={settings} harness={status?.harnesses?.[engine]} save={save} />
        ) : engine === 'local' ? (
          <>
            <p className="small dim">
              A model in Ollama on this PC, with IV Studio's H3 rules. Private and free. It loads only while writing, then frees the GPU for rendering.
            </p>
            {!status ? null : !status.installed ? (
              <p className="small pink">
                Ollama isn't installed.{' '}
                <button className="link-btn" onClick={() => window.ivstudio.links.open('https://ollama.com/download')}>
                  Get Ollama
                </button>
              </p>
            ) : (
              <>
                <div className="row">
                  <span className="row-label">Model</span>
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
                    <span className="small dim">{status.running ? 'No models yet.' : 'Ollama starts when you first write a prompt.'}</span>
                  )}
                </div>
                {!models.some((m) => m.name === WRITER_MODEL) && (
                  <div className="dl">
                    {pull ? (
                      <>
                        <div className="bar">
                          <span style={{ width: `${pct ?? 6}%` }} className={pct == null ? 'indeterminate' : ''} />
                        </div>
                        <span className="mono dim">{pct != null ? `${pct}%` : pull.status}</span>
                      </>
                    ) : (
                      <button className="btn btn-small" onClick={() => install(WRITER_MODEL)}>
                        Install the recommended writer ({WRITER_MODEL}, about 6 GB)
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
          </>
        ) : (
          <>
            <p className="small dim">
              MiniMax's own prompt rewriter: it writes in the exact format H3 was trained on and looks at your reference media. Paid through your Comfy.org account, {status?.contextIrPrice || 'a few cents a prompt'}. It runs through ComfyUI.
            </p>
            {settings.hasComfyKey ? (
              <p className="small">
                A Comfy.org API key is saved (encrypted on this PC).{' '}
                <button className="link-btn" onClick={() => saveKey('')}>
                  Remove it
                </button>
              </p>
            ) : (
              <>
                <div className="key-form">
                  <input type="password" value={key} placeholder="Comfy.org API key (comfyui-…)" onChange={(e) => setKey(e.target.value)} autoComplete="off" />
                  <button className="btn btn-small" disabled={!key.trim()} onClick={() => saveKey(key)}>
                    Save
                  </button>
                </div>
                <p className="small dim">
                  Create one at{' '}
                  <button className="link-btn" onClick={() => window.ivstudio.links.open('https://platform.comfy.org/login')}>
                    platform.comfy.org
                  </button>{' '}
                  and add credits there. The key stays on this PC.
                </p>
              </>
            )}
          </>
        )}
      </div>
    </section>
  )
}

// A block of text with a Copy button.
function Copyable({ text, label = 'Copy' }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="copyable">
      <pre className="code">{text}</pre>
      <button
        className="btn btn-small"
        onClick={() => {
          navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }}
      >
        {copied ? 'Copied' : label}
      </button>
    </div>
  )
}

// Agents (MCP): a message to paste into any agent, the manual commands, and the Claude Code skill.
function AgentSettings({ mcp, notify }) {
  const [agents, setAgents] = useState(null)
  const [client, setClient] = useState('claude')
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
  return (
    <section className="group">
      <div className="group-head">
        <h2>Agents (MCP)</h2>
        <p className="dim small">Claude Code, Codex and other agents can render, sequence and edit in IV Studio, with the same projects and results you see here.</p>
      </div>
      <div className="group-body">
        <p className="mono label">Paste into your agent</p>
        <p className="small dim">One message: your agent adds IV Studio, reads its guide and checks your setup.</p>
        <Copyable text={agents.paste} label="Copy message" />

        <p className="mono label">Or add it yourself</p>
        <div className="segmented">
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
        <Copyable text={manual[client]} label="Copy command" />

        <p className="mono label">Claude Code skill</p>
        <p className="small dim">
          Teaches Claude Code IV Studio's workflow (shots, H3 prompts, sequences, timeline edits and the house rules) so it picks the right tools without being told. The server also hands every agent a short version, and the full guide through get_guide.
        </p>
        <div className="row-actions">
          <button className="btn btn-small" onClick={installSkill}>
            {!agents.skillInstalled ? 'Add the skill to Claude Code' : agents.skillCurrent ? 'Skill added ✓' : 'Update the skill'}
          </button>
          <button className="link-btn mono" onClick={() => window.ivstudio.links.open('https://github.com/hollisorg/iv-studio/blob/main/skills/iv-studio/SKILL.md')}>
            View it on GitHub ↗
          </button>
        </div>
        {agents.skillInstalled && <p className="mono small dim">{agents.skillFile}</p>}
        <p className="dim small">Tools for setup, shots, sequences, prompt writing, references, renders, timeline editing, character training, models and characters.</p>
      </div>
    </section>
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

// How IV Studio starts ComfyUI: the person's own launcher (found or picked) and whether to start it on open.
function ComfyLauncher({ settings, setSettings, notify, recheck, comfyUp }) {
  const platform = usePlatform()
  const [l, setL] = useState(null)
  const load = () => window.ivstudio.comfy.launcher().then(setL).catch(() => {})
  useEffect(() => {
    load()
  }, [settings.comfyUrl, settings.comfyLauncher])
  async function choose() {
    const file = await window.ivstudio.comfy.chooseLauncher()
    if (file) setSettings(await window.ivstudio.settings.get())
  }
  async function useFound(file) {
    setSettings(await window.ivstudio.settings.set({ comfyLauncher: file }))
  }
  async function chooseFolder() {
    try {
      if (await window.ivstudio.comfy.chooseFolder()) setSettings(await window.ivstudio.settings.get())
    } catch (err) {
      notify(err.message)
    }
  }
  async function autoStart(on) {
    setSettings(await window.ivstudio.settings.set({ comfyAutoStart: on }))
  }
  if (!l) return null
  if (!l.local) return <p className="small dim">IV Studio can start ComfyUI only when it runs on this PC.</p>
  return (
    <div className="comfy-launcher">
      <div className="row">
        <span className="row-label">ComfyUI folder</span>
        <span className="launcher-path small" title={l.folder || ''}>{l.folder || 'Not set'}</span>
        <button className="btn btn-small" onClick={chooseFolder}>
          Choose folder…
        </button>
      </div>
      {l.folder && l.inFolder.length > 0 && (
        <div className="row">
          <span className="row-label">Start file</span>
          <select value={l.inFolder.some((f) => f.path === l.using) ? l.using : ''} onChange={(e) => useFound(e.target.value)}>
            {!l.inFolder.some((f) => f.path === l.using) && <option value="">(another launcher, below)</option>}
            {l.inFolder.map((f) => (
              <option key={f.path} value={f.path}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="row">
        <span className="row-label">Start it with</span>
        <span className="launcher-path small" title={l.using || ''}>{l.using || 'No launcher found'}</span>
        <button className="btn btn-small" onClick={choose}>
          Choose…
        </button>
        {!comfyUp && <StartComfy notify={notify} recheck={recheck} />}
      </div>
      {!l.chosen && !l.folder && l.found.length > 1 && (
        <p className="small dim">
          Found on this PC:{' '}
          {l.found.slice(1, 5).map((f, i) => (
            <span key={f.path}>
              {i > 0 && ' · '}
              <button className="link-btn mono" title={f.path} onClick={() => useFound(f.path)}>
                {f.path}
              </button>
            </span>
          ))}
        </p>
      )}
      <label className="consent">
        <input type="checkbox" checked={settings.comfyAutoStart !== false} onChange={(e) => autoStart(e.target.checked)} />
        Start ComfyUI when IV Studio opens, if it isn’t running already
      </label>
      <p className="small dim">
        {comfyLauncherHelp(platform)}
      </p>
    </div>
  )
}

export default function Settings({ info, recheck, notify, go, setup }) {
  const [settings, setSettings] = useState(null)
  const [url, setUrl] = useState('')

  useEffect(() => {
    window.ivstudio.settings.get().then((s) => {
      setSettings(s)
      setUrl(s.comfyUrl)
    })
  }, [])

  async function saveUrl() {
    try {
      setSettings(await window.ivstudio.settings.set({ comfyUrl: url.trim() }))
      recheck()
    } catch (err) {
      notify(err.message)
    }
  }

  if (!settings) return null
  return (
    <div className="settings">
      <Hero art="settings" title="Settings" kicker="Infinite Variance" />
      <SettingsTabs tab="settings" go={go} setup={setup} />

      <section className="group">
        <div className="group-head">
          <h2>ComfyUI</h2>
          <p className="dim small">The ComfyUI IV Studio renders on.</p>
        </div>
        <div className="group-body">
          <div className="key-form">
            <input value={url} onChange={(e) => setUrl(e.target.value)} />
            <button className="btn btn-small" disabled={url.trim() === settings.comfyUrl} onClick={saveUrl}>
              Save
            </button>
          </div>
          <ComfyLauncher settings={settings} setSettings={setSettings} notify={notify} recheck={recheck} comfyUp={setup?.items?.some((i) => i.id === 'comfyui' && i.status === 'ok')} />
        </div>
      </section>

      <FolderSettings settings={settings} setSettings={setSettings} notify={notify} incognito={!!info?.incognito} />

      <ModelSettings settings={settings} setSettings={setSettings} notify={notify} />

      <WriterSettings settings={settings} setSettings={setSettings} notify={notify} />

      <CivitaiSettings settings={settings} setSettings={setSettings} notify={notify} />

      <section className="group">
        <div className="group-head">
          <h2>Characters</h2>
          <p className="dim small">Your characters, ready-made ones and training now live on their own page.</p>
        </div>
        <div className="group-body">
          <button className="btn btn-small" onClick={() => go('characters')}>
            Open Characters
          </button>
        </div>
      </section>

      <AgentSettings mcp={info?.mcp} notify={notify} />

      <UpdateSettings notify={notify} />

      <section className="group">
        <div className="group-head">
          <h2>About</h2>
        </div>
        <div className="group-body">
          <p className="small dim">IV Studio {info?.version}. Data: {info?.dataDir}</p>
        </div>
      </section>
    </div>
  )
}
