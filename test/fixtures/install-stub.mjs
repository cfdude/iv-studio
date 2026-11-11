// A stand-in for the official Claude Code / Codex installer (src/service/agentinstall.js tests and test copies).
//   node install-stub.mjs <claude|codex>
// INSTALL_STUB_MODE: ok (default) puts a placeholder program where the real installer would, fail prints an error
// and exits 1, nofile succeeds without installing anything, slow waits 60 s (for Stop). INSTALL_STUB_DELAY: extra
// milliseconds before it finishes.
import fs from 'node:fs'
import path from 'node:path'

const engine = process.argv[2]
const mode = process.env.INSTALL_STUB_MODE || 'ok'
const home = process.env.USERPROFILE || process.env.HOME
const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local')
const win = process.platform === 'win32'
const target =
  engine === 'claude'
    ? path.join(home, '.local', 'bin', win ? 'claude.exe' : 'claude')
    : win
      ? path.join(local, 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe')
      : path.join(home, '.local', 'bin', 'codex')

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
console.log(`\x1b[1m==> Installing ${engine === 'claude' ? 'Claude Code' : 'Codex CLI'}\x1b[0m`)
await wait(400)
process.stdout.write('Downloading 40%\rDownloading 100%\r\n')
await wait(400)
if (mode === 'slow') await wait(60000)
if (process.env.INSTALL_STUB_DELAY) await wait(Number(process.env.INSTALL_STUB_DELAY))
if (mode === 'fail') {
  console.error('Write-Error : Failed to download binary: The remote server returned an error: (404) Not Found.')
  console.error('At line:1 char:1')
  process.exit(1)
}
if (mode !== 'nofile') {
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, 'placeholder')
}
console.log('Installation complete!')
