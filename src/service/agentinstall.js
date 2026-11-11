// Installing the person's own Claude Code or Codex from inside IV Studio, with the maker's own official installer
// (claude.ai/install.ps1 and chatgpt.com/codex/install.ps1, or the .sh ones on Mac and Linux). Neither needs admin
// rights and both keep themselves up to date. Signing in has to happen in the agent itself (a browser login), so
// IV Studio opens a terminal window running its login command.
//   Claude Code lands in ~/.local/bin/claude(.exe); Codex in %LOCALAPPDATA%\Programs\OpenAI\Codex\bin\codex.exe on
//   Windows and ~/.local/bin/codex elsewhere (harness.js findHarnesses looks in both).
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const AGENT_INFO = {
  claude: { name: 'Claude Code', maker: 'Anthropic', plan: 'Needs a paid Claude plan (Pro, Max, Team or Enterprise).', site: 'https://code.claude.com/docs/en/setup' },
  codex: { name: 'Codex', maker: 'OpenAI', plan: 'Needs a ChatGPT plan.', site: 'https://developers.openai.com/codex/cli' }
}

const SCRIPTS = {
  claude: { win: 'irm https://claude.ai/install.ps1 | iex', unix: 'curl -fsSL https://claude.ai/install.sh | bash' },
  codex: { win: 'irm https://chatgpt.com/codex/install.ps1 | iex', unix: 'curl -fsSL https://chatgpt.com/codex/install.sh | sh' }
}

const known = (engine) => {
  if (!SCRIPTS[engine]) throw new Error('IV Studio can install Claude Code or Codex.')
}

// The official one-liner for this computer, run without a window and without questions (Codex's installer asks
// "Start Codex now?" unless CODEX_NON_INTERACTIVE is set).
export function installCommand(engine, platform = process.platform) {
  known(engine)
  if (platform === 'win32') return { command: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', `$ProgressPreference = 'SilentlyContinue'; ${SCRIPTS[engine].win}`] }
  return { command: '/bin/sh', args: ['-c', SCRIPTS[engine].unix] }
}

export const stripAnsi = (s) => String(s).replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07]*\x07/g, '')

// the installer and everything it started (curl, the downloaded program): Windows by tree, Mac and Linux by the
// process group runInstall starts it in
function killTree(child) {
  if (!child || child.exitCode !== null) return
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
  else {
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      child.kill('SIGTERM')
    }
  }
}

// Run the installer. onLine gets each line it prints (colour codes removed). Resolves { ok, code, lines, error };
// stop() ends it. override: { command, args } in place of the real installer (tests).
export function runInstall(engine, { onLine = () => {}, env = {}, platform = process.platform, override = null, timeoutMs = 20 * 60000 } = {}) {
  known(engine)
  const { command, args } = override || installCommand(engine, platform)
  const lines = []
  const errors = []
  let child = null
  let stopped = false
  let timedOut = false
  const promise = new Promise((resolve) => {
    try {
      child = spawn(command, args, { windowsHide: true, shell: /\.cmd$/i.test(command), detached: process.platform !== 'win32', env: { ...process.env, CODEX_NON_INTERACTIVE: '1', NO_COLOR: '1', ...env } })
    } catch (e) {
      resolve({ ok: false, code: null, lines, error: e.message })
      return
    }
    const timer = setTimeout(() => ((timedOut = true), killTree(child)), timeoutMs)
    const reader = (into) => {
      let buf = ''
      return (d) => {
        buf += d
        const parts = buf.split(/\r?\n|\r/)
        buf = parts.pop()
        for (const raw of parts) {
          const line = stripAnsi(raw).trim()
          if (!line) continue
          lines.push(line)
          if (lines.length > 300) lines.shift()
          if (into) into.push(line)
          onLine(line)
        }
      }
    }
    child.stdout.on('data', reader(null))
    child.stderr.on('data', reader(errors))
    child.on('error', (e) => {
      clearTimeout(timer)
      resolve({ ok: false, code: null, lines, error: e.message })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      const ok = code === 0 && !stopped && !timedOut
      const error = ok ? null : stopped ? 'Stopped.' : timedOut ? 'The installer took too long.' : installError(errors, lines, code)
      resolve({ ok, code, lines, error })
    })
  })
  return {
    promise,
    stop: () => {
      stopped = true
      killTree(child)
    }
  }
}

// The installer's own last error line, without PowerShell's "At line:1 char:..." noise.
export function installError(errors, lines, code) {
  const noise = /^(At line:|\+ |CategoryInfo|FullyQualifiedErrorId|~)/
  const pick = (list) => [...list].reverse().find((l) => !noise.test(l))?.replace(/^Write-Error\s*:\s*/i, '')
  return pick(errors) || pick(lines) || `The installer stopped (code ${code}).`
}

const LOGIN = { claude: ['auth', 'login'], codex: ['login'] }
const STATUS = { claude: ['auth', 'status'], codex: ['login', 'status'] }
const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`
const shQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`

// The window that signs in: a terminal running the agent's login command (claude auth login, codex login), which
// opens the browser. Returns the candidates to try in order ({ command, args }).
export function signInCommands(engine, exe, platform = process.platform, home = os.homedir()) {
  known(engine)
  const name = AGENT_INFO[engine].name
  const login = LOGIN[engine]
  if (platform === 'win32') {
    const run = `$Host.UI.RawUI.WindowTitle = ${psQuote(`Sign in to ${name}`)}; & ${psQuote(exe)} ${login.join(' ')}; Write-Host ''; Write-Host 'Done. You can close this window and go back to IV Studio.'`
    return [{ command: 'powershell.exe', args: ['-NoExit', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', run] }]
  }
  const line = `${shQuote(exe)} ${login.join(' ')}`
  if (platform === 'darwin') {
    const apple = line.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    return [{ command: 'osascript', args: ['-e', `tell application "Terminal" to do script "${apple}"`, '-e', 'tell application "Terminal" to activate'] }]
  }
  const bins = ['/usr/bin', '/usr/local/bin', '/bin', path.join(home, '.local', 'bin')]
  const has = (n) => bins.some((d) => fs.existsSync(path.join(d, n)))
  return [
    ['x-terminal-emulator', ['-e', exe, ...login]],
    ['gnome-terminal', ['--', exe, ...login]],
    ['konsole', ['-e', exe, ...login]],
    ['xfce4-terminal', ['-x', exe, ...login]],
    ['xterm', ['-e', exe, ...login]]
  ]
    .filter(([n]) => has(n))
    .map(([command, args]) => ({ command, args }))
}

// Open that window. Throws when there's no terminal to open (Linux without one).
export function openSignIn(engine, exe, { platform = process.platform, env = {} } = {}) {
  const tries = signInCommands(engine, exe, platform)
  if (!tries.length) throw new Error(`No terminal found. Open one and run: ${exe} ${LOGIN[engine].join(' ')}`)
  const { command, args } = tries[0]
  const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: false, env: { ...process.env, ...env } })
  child.on('error', () => {})
  child.unref()
  return true
}

// Signed in? The agent's own status command answers with its exit code (0 signed in, 1 not); null when it can't
// be asked.
export function signedIn(engine, exe, { env = {}, timeoutMs = 15000 } = {}) {
  known(engine)
  if (!exe) return Promise.resolve(false)
  return new Promise((resolve) => {
    let child
    try {
      // an npm .cmd needs a shell, and the shell needs the path quoted
      const cmd = /\.cmd$/i.test(exe)
      child = spawn(cmd ? `"${exe}"` : exe, STATUS[engine], { windowsHide: true, stdio: 'ignore', shell: cmd, env: { ...process.env, NO_COLOR: '1', ...env } })
    } catch {
      resolve(null)
      return
    }
    const timer = setTimeout(() => (killTree(child), resolve(null)), timeoutMs)
    child.on('error', () => (clearTimeout(timer), resolve(null)))
    child.on('close', (code) => (clearTimeout(timer), resolve(code === 0 ? true : code === 1 ? false : null)))
  })
}
