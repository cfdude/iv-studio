// Installing Claude Code or Codex from IV Studio (src/service/agentinstall.js): the official commands, a run with a
// stand-in installer (finish, failure, Stop), the sign-in window's command, the sign-in check, and that IV Studio
// finds what the installers put in place (harness.js).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { AGENT_INFO, installCommand, installError, runInstall, signedIn, signInCommands, stripAnsi } from '../src/service/agentinstall.js'
import { findHarnesses, harnessStatus } from '../src/service/harness.js'

let failed = 0
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && extra ? ` -> ${extra}` : ''}`)
  if (!ok) failed++
}
const here = path.dirname(fileURLToPath(import.meta.url))
const stub = path.join(here, 'fixtures', 'install-stub.mjs')

// the official commands
const cw = installCommand('claude', 'win32')
check('claude on Windows: PowerShell runs claude.ai/install.ps1', cw.command === 'powershell.exe' && cw.args.at(-1).endsWith('irm https://claude.ai/install.ps1 | iex'))
check('claude on Windows: no profile, no questions', cw.args.includes('-NoProfile') && cw.args.includes('-NonInteractive'))
check('codex on Windows: chatgpt.com/codex/install.ps1', installCommand('codex', 'win32').args.at(-1).endsWith('irm https://chatgpt.com/codex/install.ps1 | iex'))
check('claude on Mac: install.sh through bash', installCommand('claude', 'darwin').args.join(' ') === '-c curl -fsSL https://claude.ai/install.sh | bash')
check('codex on Linux: install.sh through sh', installCommand('codex', 'linux').args.join(' ') === '-c curl -fsSL https://chatgpt.com/codex/install.sh | sh')
let threw = false
try {
  installCommand('cursor')
} catch {
  threw = true
}
check('anything else is refused', threw)
check('both have a plan line and a website', ['claude', 'codex'].every((e) => AGENT_INFO[e].plan && /^https:\/\//.test(AGENT_INFO[e].site)))
check('colour codes are removed', stripAnsi('\x1b[1m==> Installing\x1b[0m') === '==> Installing')
check('the error skips PowerShell noise and its Write-Error prefix', installError(['Write-Error : Failed to download', 'At line:1 char:1', '+ irm x | iex'], [], 1) === 'Failed to download')
check('the error falls back to the exit code', installError([], [], 7) === 'The installer stopped (code 7).')

// a run with the stand-in installer, into a throwaway home
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ivs-install-'))
const env = { USERPROFILE: home, HOME: home, LOCALAPPDATA: path.join(home, 'AppData', 'Local'), APPDATA: path.join(home, 'AppData', 'Roaming'), PATH: '' }
const override = (engine) => ({ command: process.execPath, args: [stub, engine] })
check('before: neither is found in the throwaway home', !findHarnesses(env, home).claude && !findHarnesses(env, home).codex)

const seen = []
let r = await runInstall('claude', { env, override: override('claude'), onLine: (l) => seen.push(l) }).promise
check('claude: finishes ok', r.ok, JSON.stringify(r))
check('claude: lines arrive without colour codes', seen[0] === '==> Installing Claude Code', seen[0])
check('claude: carriage-return progress is split into lines', seen.includes('Downloading 40%') && seen.includes('Downloading 100%'), seen.join('|'))
check('claude: found where the installer puts it', !!findHarnesses(env, home).claude)
check('claude: Settings sees it installed', harnessStatus(env, home).claude.installed && !harnessStatus(env, home).codex.installed)

r = await runInstall('codex', { env, override: override('codex') }).promise
const codex = findHarnesses(env, home).codex
check('codex: finishes ok', r.ok)
check('codex: found in the command-line installer folder', !!codex && (process.platform !== 'win32' || codex.includes(path.join('Programs', 'OpenAI', 'Codex', 'bin'))), codex)

r = await runInstall('claude', { env: { ...env, INSTALL_STUB_MODE: 'fail' }, override: override('claude') }).promise
check('failure: not ok, with the installer’s own error', !r.ok && /Failed to download binary/.test(r.error), JSON.stringify(r))

const slow = runInstall('codex', { env: { ...env, INSTALL_STUB_MODE: 'slow' }, override: override('codex') })
await new Promise((res) => setTimeout(res, 1500))
const t0 = Date.now()
slow.stop()
r = await slow.promise
check('Stop: ends it quickly and says so', !r.ok && r.error === 'Stopped.' && Date.now() - t0 < 10000, JSON.stringify(r))

r = await runInstall('codex', { env: { ...env, INSTALL_STUB_MODE: 'ok' }, override: { command: path.join(home, 'no-such-installer.exe'), args: [] } }).promise
check('a missing installer program is an error, not a crash', !r.ok && !!r.error)

r = await runInstall('claude', { env, override: override('claude'), timeoutMs: 300 }).promise
check('too long: stopped with a plain message', !r.ok && r.error === 'The installer took too long.', JSON.stringify(r))

// the sign-in window
const exe = 'C:\\Users\\Pat O\'Neil\\.local\\bin\\claude.exe'
const [win] = signInCommands('claude', exe, 'win32')
check('sign in on Windows: a PowerShell window that stays open', win.command === 'powershell.exe' && win.args.includes('-NoExit'))
check('sign in on Windows: runs claude auth login, quoting the path', win.args.at(-1).includes(`& 'C:\\Users\\Pat O''Neil\\.local\\bin\\claude.exe' auth login`), win.args.at(-1))
check('sign in on Windows: Codex runs codex login', signInCommands('codex', 'C:\\x\\codex.exe', 'win32')[0].args.at(-1).includes(`& 'C:\\x\\codex.exe' login;`))
const [mac] = signInCommands('codex', '/Users/pat/.local/bin/codex', 'darwin')
check('sign in on Mac: Terminal runs codex login', mac.command === 'osascript' && mac.args[1].includes(`do script "'/Users/pat/.local/bin/codex' login"`), mac.args[1])
check('sign in on Linux: only terminals that exist are tried', signInCommands('claude', '/x/claude', 'linux', home).every((c) => typeof c.command === 'string'))

// the sign-in check: the agent's own status command, by exit code
const fake = path.join(home, 'fake-agent.cmd')
fs.writeFileSync(fake, '@exit /b %FAKE_CODE%\r\n')
if (process.platform === 'win32') {
  check('signed in: exit 0 means yes', (await signedIn('claude', fake, { env: { FAKE_CODE: '0' } })) === true)
  check('signed in: exit 1 means no', (await signedIn('codex', fake, { env: { FAKE_CODE: '1' } })) === false)
  check('signed in: anything else is unknown', (await signedIn('codex', fake, { env: { FAKE_CODE: '5' } })) === null)
}
check('signed in: no program means no', (await signedIn('claude', null)) === false)
check('signed in: a missing program is unknown', (await signedIn('claude', path.join(home, 'nope.exe'))) === null)

fs.rmSync(home, { recursive: true, force: true })
console.log(failed ? `${failed} failed` : 'all passed')
process.exit(failed ? 1 : 0)
