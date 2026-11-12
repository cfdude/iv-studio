// How IV Studio starts Ollama (prompter.js ollamaStartCommand). On Windows a detached `ollama serve` has no console, so
// each model it loads opened a new terminal window: Windows must use Ollama's tray app, or a hidden PowerShell start.
//   node test/ollama-start.mjs
import assert from 'node:assert/strict'
import { ollamaStartCommand } from '../src/service/prompter.js'

let n = 0
let failed = 0
const ok = (name, fn) => {
  n++
  try {
    fn()
    console.log('ok', name)
  } catch (err) {
    failed++
    console.log('FAIL', name, '-', err.message)
  }
}
const exe = 'C:\\Users\\me\\AppData\\Local\\Programs\\Ollama\\ollama.exe'

ok('Windows starts Ollama through its tray app when it is installed', () => {
  const c = ollamaStartCommand(exe, 'win32', (f) => f.endsWith('ollama app.exe'))
  assert.equal(c.command, 'C:\\Users\\me\\AppData\\Local\\Programs\\Ollama\\ollama app.exe')
  assert.deepEqual(c.args, [])
})

ok('without the tray app, Windows starts `ollama serve` hidden through PowerShell', () => {
  const c = ollamaStartCommand("C:\\Users\\o'neil\\Ollama\\ollama.exe", 'win32', () => false)
  assert.equal(c.command, 'powershell.exe')
  assert.ok(c.args.includes('Hidden'))
  const cmd = c.args[c.args.length - 1]
  assert.match(cmd, /^Start-Process -FilePath 'C:\\Users\\o''neil\\Ollama\\ollama\.exe' -ArgumentList 'serve' -WindowStyle Hidden$/)
})

ok('Mac and Linux run `ollama serve` as before', () => {
  assert.deepEqual(ollamaStartCommand('/usr/local/bin/ollama', 'linux'), { command: '/usr/local/bin/ollama', args: ['serve'] })
  assert.deepEqual(ollamaStartCommand('/Applications/Ollama.app/Contents/Resources/ollama', 'darwin'), { command: '/Applications/Ollama.app/Contents/Resources/ollama', args: ['serve'] })
})

console.log(`${n - failed}/${n} passed`)
process.exit(failed ? 1 : 0)
