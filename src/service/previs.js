// A staging board in motion: a grey previs clip of the camera move and the walks (staging.js previsFrames), drawn
// with three.js (resources/previs) in the Edge or Chrome already on the PC, headless, and joined with ffmpeg.
// Used as <Video n> in References mode it steers H3's camera path and framing: on test data a 90-degree arc
// was followed where the same arc in words wasn't (2026-10-31).
import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { resolveFrames, resolveSize } from './plan.js'
import { devtools, waitFor } from './sitecapture.js'
import { LENSES, previsFrames, previsWords } from './staging.js'

const run = promisify(execFile)
const TYPES = { '.html': 'text/html', '.js': 'text/javascript' }

// The page's files on a private port (module scripts don't load from file://).
function serve(dir) {
  return new Promise((resolve) => {
    const srv = http.createServer((q, s) => {
      const name = path.basename(decodeURIComponent(q.url.split('?')[0])) || 'index.html'
      const f = path.join(dir, name)
      if (!fs.existsSync(f)) return s.writeHead(404).end()
      s.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }).end(fs.readFileSync(f))
    })
    srv.listen(0, '127.0.0.1', () => resolve(srv))
  })
}

export class Previs {
  // resourcesDir: the app's resources; dataDir: where clips are kept (previs\); browser: () => Edge or Chrome;
  // ffmpeg: the bundled ffmpeg
  constructor({ resourcesDir, dataDir, browser, ffmpeg }) {
    this.page = path.join(resourcesDir, 'previs')
    this.dir = path.join(dataDir, 'previs')
    this.browser = browser
    this.ffmpeg = ffmpeg
  }

  // stage: a staging board plan; seconds and aspect: the shot's. Returns { file, duration, width, height, words }.
  async make({ stage, seconds = 5, aspect = '16:9', name = 'previs' }) {
    if (!stage?.camera) throw new Error('A previs needs a staging board plan.')
    const browser = this.browser()
    if (!browser) throw new Error('A previs is drawn in Microsoft Edge, Google Chrome or Chromium; none is on this computer.')
    const frames = resolveFrames(seconds)
    const { width, height } = resolveSize(aspect, 0.4)
    const poses = previsFrames(stage, { frames })
    const half = LENSES[stage.camera.lens] || LENSES.normal
    const fov = (2 * Math.atan(Math.tan((half * Math.PI) / 180) / (width / height)) * 180) / Math.PI
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-previs-'))
    const srv = await serve(this.page)
    const proc = spawn(browser, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${path.join(work, 'profile')}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--ignore-gpu-blocklist', '--enable-webgl', `--window-size=${width},${height}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' })
    let cdp
    try {
      const port = await waitFor(async () => fs.readFileSync(path.join(work, 'profile', 'DevToolsActivePort'), 'utf8').split('\n')[0].trim(), 20000, 'start')
      const page = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page'), 10000, 'open a page')
      cdp = await devtools(page.webSocketDebuggerUrl)
      const evaluate = async (expression) => {
        const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'The previs page failed.')
        return r.result?.value
      }
      await cdp.send('Page.navigate', { url: `http://127.0.0.1:${srv.address().port}/index.html` })
      await waitFor(() => evaluate('window.ready === true'), 15000, 'load the previs page')
      await evaluate(`window.setup(${JSON.stringify({ width, height, count: stage.people?.length || 0 })})`)
      for (const [i, pose] of poses.entries()) {
        const data = await evaluate(`window.draw(${JSON.stringify(pose)}, ${fov})`)
        fs.writeFileSync(path.join(work, `f${String(i).padStart(4, '0')}.png`), Buffer.from(data.split(',')[1], 'base64'))
      }
    } finally {
      cdp?.close()
      proc.kill()
      srv.close()
    }
    fs.mkdirSync(this.dir, { recursive: true })
    const safe = String(name).replace(/[^\w-]+/g, '_').slice(0, 40) || 'previs'
    const file = path.join(this.dir, `${safe}_${Date.now().toString(36)}.mp4`)
    await run(this.ffmpeg, ['-v', 'error', '-y', '-framerate', '24', '-i', path.join(work, 'f%04d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', file])
    fs.rmSync(work, { recursive: true, force: true })
    return { file, duration: +(frames / 24).toFixed(3), width, height, frames, words: previsWords(stage, 1) }
  }
}
