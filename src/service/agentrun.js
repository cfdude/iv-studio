// The person's own Claude Code or Codex making something inside IV Studio (the Dashboard's "Let Claude Code make it";
// docs/superpowers/specs/2026-11-10-agent-run-design.md). The agent runs headless on the person's existing login, in an
// empty folder, with no tools but IV Studio's own MCP server, which in an agent run refuses anything that deletes,
// installs, trains or spends (agentGuard). One run at a time; its jobs are cancelled on Stop.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const AGENT_NAMES = { claude: 'Claude Code', codex: 'Codex', hermes: 'Hermes' }
export const RUN_LIMIT_MS = 45 * 60 * 1000
export const SERVER = 'iv-studio'

// Tools an agent run may never call: they delete, install, download, train, change Settings, or stop work it
// didn't start.
export const AGENT_BLOCKED = new Set([
  'set_workflow_model',
  'delete_character', 'delete_edit', 'delete_image', 'delete_line', 'delete_music', 'delete_project', 'delete_rebuild', 'delete_sequence', 'delete_sizzle', 'delete_sound', 'delete_voice',
  'install_node_packs', 'install_ready_character', 'download_lora',
  'add_training_files', 'create_character_training', 'make_training_clips', 'set_training_item', 'start_training', 'stop_training', 'update_character_training',
  'cancel_generation', 'cancel_image', 'cancel_music', 'cancel_edit_export'
])

// Why an agent run can't make this call, or null when it can. settings: IV Studio's settings now; started: the job
// ids this run has started.
export function agentGuard(name, args = {}, { settings = {}, started = new Set() } = {}) {
  if (settings.target === 'cloud') return 'IV Studio is set to render on the cloud. An agent run only renders on this computer (free), so it stops here: switch Cloud to This computer to use it.'
  if (AGENT_BLOCKED.has(name)) return `${name} isn't available in an agent run started from IV Studio's Dashboard: it deletes, installs, trains, changes Settings or stops other work. Leave it to the person.`
  if (args.engine === 'seedance' || args.way === 'seedance') return 'Seedance costs money, and an agent run from the Dashboard never spends: use engine h3 (free, on this computer).'
  if (Number(args.confirm_cost) > 0) return 'An agent run from the Dashboard never spends money: leave anything with a cost to the person.'
  if (name === 'cancel_job' && !started.has(args.jobId)) return 'An agent run can only cancel jobs it started itself.'
  return null
}

// The job a tool result started, if any: an IV Studio job record ({ id, status, kind }).
export function startedJobId(name, result) {
  if (!result || typeof result !== 'object' || name === 'get_job' || name.startsWith('list_') || name.startsWith('cancel_')) return null
  const job = result.job && typeof result.job === 'object' ? result.job : result
  return typeof job.id === 'string' && typeof job.status === 'string' && typeof job.kind === 'string' ? job.id : null
}

export const agentPrompt = () => `You are working inside IV Studio, the person's video app, on their behalf. They typed an idea on IV Studio's Dashboard and pressed "make it" for you; they are watching a progress panel and cannot answer questions, so make sensible choices yourself.

Your only tools are IV Studio's (the iv-studio MCP server). Make the idea as H3 preview takes on this computer:
1. check_setup. If ComfyUI or a model is missing, stop and say in one sentence what the person needs to do.
2. get_guide once, then list_characters. Use a character only if the idea names one that exists; otherwise character "none".
3. Write the H3 prompt (write_prompt helps), run check_prompt and fix what it reports.
4. generate_previews with engine "h3". Then call get_job until the takes are done or failed: it waits up to 25 seconds each time, so just call it again, without commentary in between.
5. Stop there: don't finish, upscale, delete or spend anything. End with one or two short, plain sentences for the person: what you made and that the takes are in Shots to pick from.

Nothing that costs money, deletes, installs or trains is allowed in this run; the server refuses it.`

export const shellQuote = (a) => `"${String(a).replace(/"/g, '\\"')}"`
// Ends the agent and everything it started (its MCP server, a .cmd's node): on Windows a plain kill stops only the
// top process, so the whole tree goes with taskkill; on Mac and Linux the agent starts in its own process group
// (spawnAgent), and the group goes.
export function killTree(child) {
  if (!child || child.exitCode !== null || !child.pid) return
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => child.kill())
  else {
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      child.kill()
    }
  }
}

// Start the agent's program: an npm install on Windows is a .cmd, which only runs through the shell (each argument
// quoted, an empty --tools too); on Mac and Linux it starts in its own process group so killTree ends everything.
export function spawnAgent(exe, args, { cwd, env, platform = process.platform } = {}) {
  const viaShell = platform === 'win32' && /\.cmd$/i.test(exe)
  return spawn(viaShell ? `"${exe}"` : exe, viaShell ? args.map(shellQuote) : args, { cwd, windowsHide: true, shell: viaShell, detached: platform !== 'win32', env })
}
const tomlString = (s) => JSON.stringify(String(s))
const tomlTable = (o) => `{${Object.entries(o).map(([k, v]) => `${k}=${tomlString(v)}`).join(',')}}`

// mcp: { command, args, env } of this install's server (env gets the agent-run flags added by the caller).
// persist: keep the session so a chat can --resume it (a Dashboard run keeps nothing).
export function claudeArgs({ mcpConfigFile, promptFile, model = '', persist = false, resume = null }) {
  return [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--tools', '',
    '--mcp-config', mcpConfigFile,
    '--strict-mcp-config',
    '--allowedTools', `mcp__${SERVER}`,
    '--permission-mode', 'dontAsk',
    ...(persist ? [] : ['--no-session-persistence']),
    ...(resume ? ['--resume', resume] : []),
    '--append-system-prompt-file', promptFile,
    ...(model ? ['--model', model] : [])
  ]
}

// A chat with Codex: `exec` for the first message, `exec resume <thread>` after. Resume takes no --sandbox, -C or
// --color, so the sandbox is a config value and the folder is the process's own working folder. tool_timeout_sec
// leaves room for the person to answer an Allow card.
export function codexChatArgs({ mcp, model = '', resume = null }) {
  const key = `mcp_servers.${SERVER}`
  return [
    'exec',
    ...(resume ? ['resume'] : []),
    '--json',
    '--skip-git-repo-check',
    '--ignore-user-config',
    ...(model ? ['-m', model] : []),
    '-c', 'model_reasoning_effort="medium"',
    '-c', 'approval_policy="never"',
    '-c', 'sandbox_mode="read-only"',
    '-c', `${key}.command=${tomlString(mcp.command)}`,
    '-c', `${key}.args=${JSON.stringify(mcp.args)}`,
    '-c', `${key}.env=${tomlTable(mcp.env)}`,
    '-c', `${key}.tool_timeout_sec=900`,
    ...(resume ? [resume] : []),
    '-'
  ]
}

// In a chat, the calls that wait for the person's Allow: why, in plain words, or null when it can go ahead.
// settings: IV Studio's settings now.
const CHAT_INSTALLS = new Set(['install_node_packs', 'update_comfy', 'undo_comfy_update', 'install_ready_character', 'download_lora', 'setup_voices', 'shinobi_setup'])
const CHAT_SETTINGS = new Set(['set_workflow_model', 'set_lora_family'])
const CHAT_TRAINING = new Set(['start_training', 'create_character_training', 'make_training_clips'])
// calls that only read, price or write words: fine even while Settings renders on the cloud
export const CHAT_READS = /^(get|list|check|price|estimate|search|identify|read)_|^(scan_hardware|plan_render|comfy_balance|music_status|voice_status|sound_status|picture_tools_status|shinobi_status|shinobi_tools|effects_list|grab_frame|write_prompt|write_shots_from_story|write_sound|write_film_script|write_film_shot_prompt|free_memory|release_voice_engine|show_in_app)$/
export function chatAsk(name, args = {}, { settings = {} } = {}) {
  if (name.startsWith('delete_')) return 'This deletes something and can’t be undone.'
  // reading, pricing and writing words never spend, even about Seedance (price_shot)
  if (CHAT_READS.test(name)) return null
  if (args.engine === 'seedance' || args.way === 'seedance') return 'Seedance renders on your Comfy.org credits: this costs money.'
  if (Number(args.confirm_cost) > 0) return `This costs money: about $${Number(args.confirm_cost).toFixed(2)}.`
  if (CHAT_INSTALLS.has(name)) return 'This installs, downloads or updates something on your computer.'
  if (CHAT_SETTINGS.has(name)) return 'This changes a setting.'
  if (CHAT_TRAINING.has(name)) return 'This starts character training, which takes hours and can cost money on a cloud GPU.'
  if (settings.target === 'cloud' && !CHAT_READS.test(name)) return 'IV Studio is set to render on the cloud, so this may cost money.'
  return null
}

export function codexArgs({ mcp, dir, model = '' }) {
  const key = `mcp_servers.${SERVER}`
  return [
    'exec',
    '--json',
    '--skip-git-repo-check',
    '--ephemeral',
    '--ignore-user-config',
    ...(model ? ['-m', model] : []),
    '-c', 'model_reasoning_effort="medium"',
    '-c', 'approval_policy="never"',
    '-c', `${key}.command=${tomlString(mcp.command)}`,
    '-c', `${key}.args=${JSON.stringify(mcp.args)}`,
    '-c', `${key}.env=${tomlTable(mcp.env)}`,
    '--sandbox', 'read-only',
    '--color', 'never',
    '-C', dir,
    '-'
  ]
}

const LABELS = {
  check_setup: 'Checked your setup',
  get_guide: "Read IV Studio's guide",
  get_menu: 'Looked at what IV Studio makes',
  list_characters: 'Looked at your characters',
  write_prompt: 'Wrote the prompt',
  check_prompt: 'Checked the prompt',
  get_speeds: 'Picked a speed',
  generate_previews: 'Started the previews',
  get_job: 'Watching the render',
  list_renders: 'Looked at your renders',
  list_projects: 'Looked at your projects',
  finish_candidate: 'Finished a take',
  enhance_final: 'Enhanced a final',
  rank_takes: 'Ranked the takes',
  review_take: 'Reviewed a take',
  edit_timeline: 'Changed an edit',
  add_media: 'Added to an edit',
  create_edit: 'Started an edit',
  caption_edit: 'Put captions on an edit',
  set_edit_settings: 'Changed an edit’s settings',
  export_edit: 'Exported an edit',
  make_music: 'Made a song',
  make_sound: 'Made a sound',
  speak_line: 'Said a line',
  design_voice: 'Designed a voice',
  make_image: 'Made pictures',
  picture_tool: 'Ran a picture tool',
  run_effect: 'Ran an effect',
  start_batch: 'Started an overnight batch',
  create_film: 'Started a film',
  write_film_script: 'Wrote the script',
  break_down_film: 'Planned the storyboard',
  render_film_scene: 'Filmed a scene',
  render_film_shot: 'Filmed a shot',
  build_rough_cut: 'Built the rough cut',
  save_recipe: 'Saved a recipe',
  save_character: 'Saved a character',
  cancel_job: 'Cancelled a render',
  last_frame: 'Saved a last frame',
  install_node_packs: 'Installed node packs',
  setup_voices: 'Set up voices',
  start_training: 'Started training'
}
export const stepLabel = (tool) => LABELS[tool] || `${tool.charAt(0).toUpperCase()}${tool.slice(1).replace(/_/g, ' ')}`
const toolOf = (name) => String(name || '').replace(new RegExp(`^mcp__${SERVER}__`), '')

// One line of the agent's output as events: { type: 'step', tool, label } (a tool call),
// { type: 'stepError', tool, text } (a call the server refused or that failed), { type: 'say', text } (its words),
// { type: 'end', ok, text } (the run finished).
export function parseLine(engine, line) {
  let m
  try {
    m = JSON.parse(line)
  } catch {
    return []
  }
  const out = []
  if (engine === 'claude') {
    // the session to --resume in a chat
    if (m.type === 'system' && m.subtype === 'init' && m.session_id) out.push({ type: 'session', id: m.session_id })
    // Claude Code summarised the conversation to make room (auto when the window fills, or /compact)
    if (m.type === 'system' && m.subtype === 'compact_boundary') out.push({ type: 'compact', trigger: m.compact_metadata?.trigger || 'auto', before: Number(m.compact_metadata?.pre_tokens) || null })
    // each reply's own usage: what's in the context window right now (fresh, cached and newly cached input)
    if (m.type === 'assistant' && m.message?.usage) {
      const u = m.message.usage
      out.push({ type: 'usage', context: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) })
    }
    if (m.type === 'assistant') {
      for (const c of m.message?.content || []) {
        if (c.type === 'text' && c.text?.trim()) out.push({ type: 'say', text: c.text.trim() })
        if (c.type === 'tool_use') out.push({ type: 'step', tool: toolOf(c.name), label: stepLabel(toolOf(c.name)), id: c.id })
      }
    } else if (m.type === 'user') {
      for (const c of m.message?.content || []) if (c.type === 'tool_result' && c.is_error) out.push({ type: 'stepError', id: c.tool_use_id, text: textOf(c.content) })
    } else if (m.type === 'result') {
      // the turn's totals, the model's window, and Claude Code's own price for it at API rates (a plan isn't charged
      // per token)
      const u = m.usage || {}
      const mu = Object.entries(m.modelUsage || {})[0]
      out.push({ type: 'usage', turn: { input: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0), cached: u.cache_read_input_tokens || 0, output: u.output_tokens || 0, apiUsd: Number(m.total_cost_usd) || 0 }, ...(mu ? { model: mu[0], window: mu[1]?.contextWindow || null } : {}) })
      out.push({ type: 'end', ok: !m.is_error && m.subtype === 'success', text: String(m.result || '').trim() })
    }
    return out
  }
  // codex exec --json
  const it = m.item
  if (m.type === 'thread.started' && m.thread_id) out.push({ type: 'session', id: m.thread_id })
  else if (m.type === 'item.started' && it?.type === 'mcp_tool_call') out.push({ type: 'step', tool: it.tool, label: stepLabel(it.tool), id: it.id })
  else if (m.type === 'item.completed' && it?.type === 'mcp_tool_call' && (it.status === 'failed' || it.error)) out.push({ type: 'stepError', id: it.id, text: textOf(it.error?.message || it.result?.content) })
  else if (m.type === 'item.completed' && it?.type === 'agent_message' && it.text?.trim()) out.push({ type: 'say', text: it.text.trim() })
  else if (m.type === 'turn.completed') {
    // Codex's usage is the turn's total over every request it made, not what's in the window now
    const u = m.usage || {}
    out.push({ type: 'usage', turn: { input: u.input_tokens || 0, cached: u.cached_input_tokens || 0, output: (u.output_tokens || 0) + (u.reasoning_output_tokens || 0) } })
    out.push({ type: 'end', ok: true, text: null })
  } else if (/compact/i.test(m.type || '') || /compact/i.test(it?.type || '')) out.push({ type: 'compact', trigger: 'auto', before: null })
  else if (m.type === 'turn.failed' || m.type === 'error') out.push({ type: 'end', ok: false, text: String(m.error?.message || m.message || 'The agent stopped with an error.') })
  return out
}
function textOf(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map((c) => c?.text || '').join(' ').trim()
  return ''
}

// The run's state from its events: steps in order (repeated get_job calls fold into one), the latest words, the end.
export function applyEvent(state, e) {
  if (e.type === 'step') {
    const last = state.steps[state.steps.length - 1]
    if (last && last.tool === e.tool && e.tool === 'get_job') last.count = (last.count || 1) + 1
    else state.steps.push({ tool: e.tool, label: e.label, id: e.id, error: null })
  } else if (e.type === 'stepError') {
    const s = state.steps.find((x) => x.id === e.id) || state.steps[state.steps.length - 1]
    if (s) s.error = (e.text || 'Refused').slice(0, 300)
  } else if (e.type === 'say') state.say = e.text.slice(0, 600)
  else if (e.type === 'end') {
    state.status = e.ok ? 'done' : 'failed'
    if (e.text) state.say = e.text.slice(0, 600)
  }
  return state
}

// exe: the agent's program (harness.js findHarnesses). mcp: this install's server { command, args, env }.
// onChange(state) after every change. Returns { state, stop() }.
export function startAgentRun({ engine, exe, idea, mcp, model = '', agentName = '', extraEnv = {}, onChange = () => {}, limitMs = RUN_LIMIT_MS }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-studio-agent-'))
  const jobsFile = path.join(dir, 'jobs.txt')
  fs.writeFileSync(jobsFile, '')
  const env = { ...mcp.env, ...extraEnv, IV_STUDIO_AGENT_RUN: '1', IV_STUDIO_AGENT_JOBS: jobsFile, IV_STUDIO_AGENT_NAME: `${agentName || AGENT_NAMES[engine] || 'An agent'} (Dashboard idea)` }
  const server = { command: mcp.command, args: mcp.args, env }
  let args
  if (engine === 'claude') {
    const mcpConfigFile = path.join(dir, 'mcp.json')
    const promptFile = path.join(dir, 'prompt.txt')
    fs.writeFileSync(mcpConfigFile, JSON.stringify({ mcpServers: { [SERVER]: { type: 'stdio', ...server } } }))
    fs.writeFileSync(promptFile, agentPrompt())
    args = claudeArgs({ mcpConfigFile, promptFile, model })
  } else if (engine === 'codex') args = codexArgs({ mcp: server, dir, model })
  else throw new Error(`Unknown agent "${engine}".`)

  const state = { engine, name: agentName || AGENT_NAMES[engine], idea, status: 'running', steps: [], say: null, startedAt: new Date().toISOString(), endedAt: null, jobs: [] }
  const changed = () => onChange(JSON.parse(JSON.stringify(state)))
  const readJobs = () => {
    try {
      state.jobs = [...new Set(fs.readFileSync(jobsFile, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean))]
    } catch {}
  }
  const child = spawnAgent(exe, args, { cwd: dir, env: { ...process.env, NO_COLOR: '1' } })
  const input = engine === 'codex' ? `${agentPrompt()}\n\nThe person's idea: ${idea}` : `The person's idea: ${idea}`
  child.stdin.end(input)
  let buf = ''
  let err = ''
  child.stdout.on('data', (d) => {
    buf += d
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (!line) continue
      const events = parseLine(engine, line)
      if (!events.length) continue
      for (const e of events) applyEvent(state, e)
      readJobs()
      changed()
    }
  })
  child.stderr.on('data', (d) => (err = (err + d).slice(-2000)))
  const finish = (status, say) => {
    if (state.endedAt) return
    clearTimeout(timer)
    readJobs()
    if (state.status === 'running' || status === 'stopped') state.status = status
    if (say && (status !== 'done' || !state.say)) state.say = say
    state.endedAt = new Date().toISOString()
    changed()
    // the run's folder goes once its processes have let go of it (a busy folder is left for the system's temp cleanup)
    setTimeout(() => {
      try {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 })
      } catch {}
    }, 3000)
  }
  const timer = setTimeout(() => {
    killTree(child)
    finish('failed', `${state.name} ran for ${Math.round(limitMs / 60000)} minutes, the limit for one run, and was stopped.`)
  }, limitMs)
  child.on('error', (e) => finish('failed', `${state.name} couldn't start: ${e.message}`))
  child.on('close', (code) => {
    if (state.status === 'running') finish(code === 0 ? 'done' : 'failed', code === 0 ? null : err.trim().split('\n').filter(Boolean).pop() || `${state.name} stopped (code ${code}).`)
    else finish(state.status)
  })
  changed()
  return {
    state: () => JSON.parse(JSON.stringify(state)),
    jobs: () => (readJobs(), [...state.jobs]),
    stop() {
      if (state.endedAt) return
      killTree(child)
      finish('stopped', 'Stopped.')
    }
  }
}
