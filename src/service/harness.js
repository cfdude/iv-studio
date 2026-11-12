// The person's own Claude Code, Codex or Hermes as the prompt writer, run headless on their existing login (after
// IV Chat's Draft button). Hermes answers over its ACP server (hermesacp.js) with no tools and no MCP server. Each run gets an empty folder of its own, no tools but reading the reference pictures put in it,
// no MCP servers and nothing saved, and answers in IV Studio's JSON shape (the CLI's own structured output).
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { findHermes, hermesTurn } from './hermesacp.js'

export const HARNESSES = { claude: 'Claude Code', codex: 'Codex', hermes: 'Hermes' }
// a writer that's one of the person's agent apps (not the local model or Context IR)
export const isHarness = (engine) => engine === 'claude' || engine === 'codex' || engine === 'hermes'

// Claude Code takes these names; '' leaves the choice to the person's Claude Code settings.
export const CLAUDE_MODELS = [
  { id: '', name: 'Your Claude Code default' },
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5' },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5' },
  { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5' },
  { id: 'claude-fable-5-1', name: 'Claude Fable 5.1' }
]

const firstExisting = (paths) => paths.find((p) => p && fs.existsSync(p)) || null

// The Codex app keeps its command-line tool in OpenAI\Codex\bin, newer builds in hash-named subfolders next to an
// older one; the most recently updated copy is the one the app itself uses.
function newestCodex(local) {
  const bin = path.join(local, 'OpenAI', 'Codex', 'bin')
  const found = []
  try {
    for (const name of ['', ...fs.readdirSync(bin)]) {
      const exe = path.join(bin, name, 'codex.exe')
      if (fs.existsSync(exe)) found.push({ exe, at: fs.statSync(exe).mtimeMs })
    }
  } catch {
    /* no Codex app */
  }
  return found.sort((a, b) => b.at - a.at)[0]?.exe || null
}

// A program on PATH or in the places Linux and Mac installers put it (an app started from the desktop or Finder
// gets a short PATH; Homebrew lives in /opt/homebrew on Apple Silicon and /usr/local on Intel Macs).
export const EXTRA_BIN = (home = os.homedir()) => [path.join(home, '.local', 'bin'), path.join(home, '.npm-global', 'bin'), path.join(home, '.bun', 'bin'), path.join(home, '.volta', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']
export function onPath(name, env = process.env, home = os.homedir()) {
  const dirs = [...String(env.PATH || '').split(':'), ...EXTRA_BIN(home)]
  return firstExisting(dirs.filter(Boolean).map((d) => path.join(d, name)))
}

export function findHarnesses(env = process.env, home = os.homedir(), platform = process.platform) {
  if (platform !== 'win32') return { claude: firstExisting([path.join(home, '.claude', 'local', 'claude')]) || onPath('claude', env, home), codex: onPath('codex', env, home) }
  const local = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local')
  const roaming = env.APPDATA || path.join(home, 'AppData', 'Roaming')
  return {
    claude: firstExisting([path.join(home, '.local', 'bin', 'claude.exe'), path.join(roaming, 'npm', 'claude.cmd')]),
    // the Codex app's copy, then OpenAI's command-line installer (install.ps1), then npm
    codex: newestCodex(local) || firstExisting([path.join(local, 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe'), path.join(roaming, 'npm', 'codex.cmd')])
  }
}

const codexHome = (env, home) => env.CODEX_HOME || path.join(home, '.codex')

// The model in the person's Codex settings: their config is skipped when IV Studio runs Codex, so it's passed on.
export function codexConfigured(env = process.env, home = os.homedir()) {
  try {
    return /^\s*model\s*=\s*["']([^"']+)["']/m.exec(fs.readFileSync(path.join(codexHome(env, home), 'config.toml'), 'utf8'))?.[1] || null
  } catch {
    return null
  }
}

// The models the person's Codex shows in its own picker (its models cache), its configured model first as the default.
export function codexModels(env = process.env, home = os.homedir()) {
  const configured = codexConfigured(env, home)
  let listed = []
  try {
    const cache = JSON.parse(fs.readFileSync(path.join(codexHome(env, home), 'models_cache.json'), 'utf8'))
    listed = (cache.models || []).filter((m) => m.visibility !== 'hide').map((m) => ({ id: m.slug, name: m.display_name || m.slug }))
  } catch {
    /* no cache yet */
  }
  return [
    {
      id: '',
      name: configured ? `Your Codex default (${configured})` : 'Your Codex default'
    },
    ...listed
  ]
}

// A Codex model's usable context window (its models cache: context_window times effective_context_window_percent),
// for the chat's context meter. model: the slug the chat runs, or '' for the person's Codex default. null when the
// cache doesn't say.
export function codexWindow(model = '', env = process.env, home = os.homedir()) {
  const slug = model || codexConfigured(env, home)
  try {
    const cache = JSON.parse(fs.readFileSync(path.join(codexHome(env, home), 'models_cache.json'), 'utf8'))
    const list = cache.models || (Array.isArray(cache) ? cache : [])
    const m = list.find((x) => x.slug === slug) || (!slug && list[0]) || null
    if (!m?.context_window) return null
    return { model: m.slug, window: Math.round((m.context_window * (m.effective_context_window_percent || 100)) / 100) }
  } catch {
    return null
  }
}

// What Settings shows: which harnesses are installed, and their models.
export function harnessStatus(env = process.env, home = os.homedir()) {
  const found = findHarnesses(env, home)
  return {
    claude: { installed: !!found.claude, models: CLAUDE_MODELS },
    codex: { installed: !!found.codex, models: codexModels(env, home) },
    // Hermes writes on the model chosen in Hermes itself (hermes model)
    hermes: { installed: !!findHermes(env, home), models: [{ id: '', name: 'Your Hermes model' }] }
  }
}

// OpenAI's structured outputs want every object closed and every property required.
export function strictSchema(s) {
  if (!s || typeof s !== 'object') return s
  if (s.type === 'object') {
    const properties = Object.fromEntries(Object.entries(s.properties || {}).map(([k, v]) => [k, strictSchema(v)]))
    return {
      ...s,
      properties,
      required: Object.keys(properties),
      additionalProperties: false
    }
  }
  if (s.type === 'array') return { ...s, items: strictSchema(s.items) }
  return s
}

function run(command, args, { input, cwd, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
      shell: command.endsWith('.cmd'),
      env: { ...process.env, NO_COLOR: '1' }
    })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('The writer took too long. Try again.'))
    }, timeoutMs)
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(out)
      else reject(new Error(err.trim().split('\n').filter(Boolean).pop() || out.trim().split('\n').pop() || `The writer stopped (code ${code})`))
    })
    child.stdin.end(input)
  })
}

// The arguments for one structured answer from Claude Code. The person's own hooks are switched off for it
// (--settings with disableAllHooks, checked against `claude --help` and a run in a folder whose settings carry a
// hook): a notification hook that runs osascript would otherwise make macOS ask whether IV Studio may control System
// Events. Their login, model and other settings still apply, which --bare and --setting-sources would drop.
export function claudeWriterArgs({ schema, sysFile, model = '', reads = false }) {
  return [
    '-p',
    '--output-format',
    'json',
    '--json-schema',
    JSON.stringify(schema),
    '--tools',
    reads ? 'Read' : '',
    '--strict-mcp-config',
    '--settings',
    JSON.stringify({ disableAllHooks: true }),
    '--no-session-persistence',
    '--system-prompt-file',
    sysFile,
    ...(model ? ['--model', model] : [])
  ]
}

// One structured answer from Claude Code or Codex. images: [{ name, data }] (base64 JPEGs), saved into the run's
// folder; the user text names them. Returns the parsed object.
export async function harnessJson({ engine, model, system, user, schema, images = [], timeoutMs = 300000 }) {
  if (engine === 'hermes') return hermesJson({ model, system, user, schema, images, timeoutMs })
  const exe = findHarnesses()[engine]
  if (!exe) throw new Error(`${HARNESSES[engine] || engine} isn't installed on this computer. Choose another writer in Settings → Prompt writer.`)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-studio-writer-'))
  try {
    for (const im of images) fs.writeFileSync(path.join(dir, im.name), Buffer.from(im.data, 'base64'))
    if (engine === 'claude') {
      const sysFile = path.join(dir, 'system.txt')
      fs.writeFileSync(sysFile, system)
      const out = await run(exe, claudeWriterArgs({ schema, sysFile, model, reads: images.length > 0 }), { input: user, cwd: dir, timeoutMs })
      const res = JSON.parse(out)
      if (res.is_error) throw new Error(`Claude Code: ${String(res.result || res.subtype || 'error').slice(0, 300)}`)
      if (res.structured_output) return res.structured_output
      return JSON.parse(String(res.result || '').replace(/^```(?:json)?\s*|\s*```$/g, ''))
    }
    if (engine === 'codex') {
      const schemaFile = path.join(dir, 'schema.json')
      const outFile = path.join(dir, 'answer.json')
      fs.writeFileSync(schemaFile, JSON.stringify(strictSchema(schema)))
      // The person's config is skipped (no MCP servers, and newer apps can write values an older CLI rejects), but
      // their model is kept. The prompt ("-", from stdin) comes before -i, which takes every path after it.
      const m = model || codexConfigured()
      await run(
        exe,
        [
          'exec',
          '--skip-git-repo-check',
          '--ephemeral',
          '--ignore-user-config',
          ...(m ? ['-m', m] : []),
          '-c',
          'model_reasoning_effort="medium"',
          '--sandbox',
          'read-only',
          '--color',
          'never',
          '-C',
          dir,
          '--output-schema',
          schemaFile,
          '-o',
          outFile,
          '-',
          ...images.flatMap((im) => ['-i', path.join(dir, im.name)])
        ],
        { input: `${system}\n\n${user}`, cwd: dir, timeoutMs }
      )
      return JSON.parse(fs.readFileSync(outFile, 'utf8'))
    }
    throw new Error(`Unknown writer "${engine}".`)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

// One structured answer from Hermes: a fresh ACP session with no MCP servers, the instructions and the JSON shape in
// the message, and the reply read back as JSON. Pictures go along when its model takes them.
export async function hermesJson({ model, system, user, schema, images = [], timeoutMs = 300000 }) {
  const exe = findHermes()
  if (!exe) throw new Error('Hermes isn’t installed on this computer. Choose another writer in Settings → Prompt writer.')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-studio-writer-'))
  let said = ''
  let turn = null
  try {
    const text = `${system}\n\n${user}\n\nAnswer with one JSON object only (no other words, no code fences), shaped like this JSON Schema:\n${JSON.stringify(schema)}\nDon't use any tools.`
    turn = hermesTurn({ exe, cwd: dir, server: null, text, model, images: images.map((im) => ({ data: im.data, mimeType: 'image/jpeg' })), emit: (e) => e.type === 'say' && (said += `${e.text}\n`) })
    let timer
    const r = await Promise.race([turn.done, new Promise((_, no) => (timer = setTimeout(() => (turn.cancel(), turn.child.kill(), no(new Error('The writer took too long. Try again.'))), timeoutMs)))])
    clearTimeout(timer)
    if (!r.ok && !said.trim()) throw new Error(`Hermes: ${r.error || 'no answer'}`)
    return parseJsonAnswer(said)
  } finally {
    // Hermes keeps running in its folder after the answer: stop it, then clear the folder (Windows holds it briefly)
    try {
      turn?.child.kill()
    } catch {}
    await new Promise((r) => setTimeout(r, 300))
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    } catch {}
  }
}

// The JSON object in a writer's reply: the whole text, or the outermost {...} if it said anything around it.
export function parseJsonAnswer(text) {
  const t = String(text || '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '')
  try {
    return JSON.parse(t)
  } catch {
    const a = t.indexOf('{')
    const b = t.lastIndexOf('}')
    if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1))
    throw new Error('Hermes didn’t answer in the expected shape. Try again, or pick another writer.')
  }
}
