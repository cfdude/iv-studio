// A website, captured for a sizzle video: real screenshots (the hero, a frame per screen down the page, the
// phone layout, the logo), the copy that's actually on it, its colours and fonts, and its
// biggest pictures. It drives the Edge or Chrome already on the PC, headless, over the DevTools protocol, so
// pages built by JavaScript capture as people see them. Nothing is clicked: cookie banners are hidden, not
// accepted.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const W = 1920
const H = 1080
// One screenshot per screen, not one tall picture: pages with scroll-driven sections only draw what's in view,
// so a whole-page capture comes out with blank stretches.
const MAX_SCREENS = 10

export async function waitFor(fn, ms, what) {
  const end = Date.now() + ms
  for (;;) {
    const v = await fn().catch(() => null)
    if (v) return v
    if (Date.now() > end) throw new Error(`The browser didn't ${what}.`)
    await sleep(150)
  }
}

// A minimal DevTools client: send(method, params) and once(event).
export function devtools(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    let n = 0
    const pending = new Map()
    const waiters = []
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data)
      if (m.id && pending.has(m.id)) {
        const { ok, fail } = pending.get(m.id)
        pending.delete(m.id)
        m.error ? fail(new Error(m.error.message)) : ok(m.result)
      } else if (m.method) for (const w of waiters.filter((x) => x.method === m.method)) (waiters.splice(waiters.indexOf(w), 1), w.ok(m.params))
    })
    ws.addEventListener('error', () => reject(new Error('Could not talk to the browser.')))
    ws.addEventListener('open', () =>
      resolve({
        send: (method, params = {}) => new Promise((ok, fail) => (pending.set(++n, { ok, fail }), ws.send(JSON.stringify({ id: n, method, params })))),
        once: (method, ms) => Promise.race([new Promise((ok) => waiters.push({ method, ok })), sleep(ms)]),
        close: () => ws.close()
      })
    )
  })
}

// Runs in the page: its copy, colours, fonts, pictures and logo.
const READ_PAGE = `(() => {
  const txt = (e) => (e.innerText || e.textContent || '').replace(/\\s+/g, ' ').trim()
  const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0 }
  const meta = (n) => document.querySelector('meta[name="' + n + '"],meta[property="' + n + '"]')?.content || ''
  const uniq = (a) => [...new Set(a.filter(Boolean))]
  const all = (sel) => [...document.querySelectorAll(sel)].filter(vis)
  const filled = (e) => { const b = getComputedStyle(e).backgroundColor; return b && b !== 'transparent' && !/rgba\\(\\d+, \\d+, \\d+, 0\\)/.test(b) }
  const hex = (c) => { const m = c.match(/rgba?\\((\\d+), (\\d+), (\\d+)(?:, ([\\d.]+))?\\)/); if (!m || (m[4] !== undefined && +m[4] < 0.5)) return null; return '#' + [m[1], m[2], m[3]].map((v) => (+v).toString(16).padStart(2, '0')).join('') }
  const tally = new Map()
  const add = (c, w) => { const h = c && hex(c); if (h) tally.set(h, (tally.get(h) || 0) + w) }
  for (const e of [document.body, ...all('header, nav, section, footer, main > div')].slice(0, 60)) { const r = e.getBoundingClientRect(); add(getComputedStyle(e).backgroundColor, Math.min(40, (r.width * r.height) / 50000)) }
  for (const e of all('h1, h2, h3').slice(0, 30)) add(getComputedStyle(e).color, 3)
  for (const e of all('a, button').filter(filled).slice(0, 30)) (add(getComputedStyle(e).backgroundColor, 6), add(getComputedStyle(e).color, 2))
  const colors = [...tally].sort((a, b) => b[1] - a[1]).map(([c]) => c).slice(0, 8)
  const font = (e) => e && getComputedStyle(e).fontFamily.split(',')[0].replace(/["']/g, '').trim()
  const fonts = uniq([font(document.querySelector('h1')), font(document.querySelector('h2')), font(document.body), font(document.querySelector('button'))]).slice(0, 4)
  const imgs = all('img').map((i) => ({ src: i.currentSrc || i.src, w: i.naturalWidth, h: i.naturalHeight, alt: i.alt || '' })).filter((i) => /^https?:/.test(i.src) && i.w >= 400 && i.h >= 250)
  const images = uniq(imgs.sort((a, b) => b.w * b.h - a.w * a.h).map((i) => JSON.stringify(i))).slice(0, 8).map((s) => JSON.parse(s))
  const isLogo = (e) => /logo|brand/i.test([e.id, e.className?.baseVal ?? e.className, e.getAttribute('alt'), e.getAttribute('aria-label'), e.getAttribute('src')].join(' '))
  // the logo sits near the top: a logo-named element, else the link home, else the first picture up there
  const nearTop = (e) => { const r = e.getBoundingClientRect(); return r.top < 220 && r.left < innerWidth * 0.6 && r.width < innerWidth * 0.5 && r.height < 200 }
  const cands = all('img, svg, picture, a, [class*=logo i], [class*=brand i]').filter(nearTop)
  const home = (e) => e.tagName === 'A' && ['/', './', location.origin, location.origin + '/'].includes(e.getAttribute('href'))
  const logoEl = cands.find(isLogo) || cands.find(home) || cands.find((e) => e.matches('img, svg'))
  const lr = logoEl?.getBoundingClientRect()
  return {
    url: location.href,
    title: document.title,
    description: meta('description') || meta('og:description'),
    siteName: meta('og:site_name'),
    ogImage: meta('og:image'),
    themeColor: meta('theme-color'),
    headings: uniq(all('h1, h2, h3').map(txt).filter((t) => t.length > 1 && t.length < 160)).slice(0, 24),
    ctas: uniq(all('a, button').filter((e) => filled(e) || /btn|button|cta/i.test(e.className)).map(txt).filter((t) => t.length > 1 && t.length < 40)).slice(0, 12),
    nav: uniq(all('nav a, header a').map(txt).filter((t) => t.length > 1 && t.length < 30)).slice(0, 12),
    paragraphs: uniq(all('p, li').map(txt).filter((t) => t.length > 40 && t.length < 320)).slice(0, 16),
    colors, fonts, images,
    logo: lr && lr.width > 8 && lr.height > 8 ? { x: lr.left + scrollX, y: lr.top + scrollY, width: lr.width, height: lr.height } : null,
    height: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)
  }
})()`

// Hides cookie banners (never accepts them) and turns off smooth scrolling, so each capture lands where it's sent.
const HIDE_BANNERS = `(() => { const s = document.createElement('style'); s.textContent = '[id*=cookie i],[class*=cookie i],[id*=consent i],[class*=consent i],[aria-label*=cookie i]{display:none !important} html,body{scroll-behavior:auto !important}'; document.head.appendChild(s) })()`
// Scrolls to y and waits until the page is really there (or stops moving): smooth-scroll scripts animate it.
const scrollJs = (y) => `(async () => { scrollTo({ top: ${y}, behavior: 'instant' }); let last = -1; for (let i = 0; i < 30; i++) { await new Promise((r) => setTimeout(r, 100)); if (Math.abs(scrollY - ${y}) < 2 || scrollY === last) break; last = scrollY } return scrollY })()`
const SCROLL_THROUGH = `(async () => { const w = (ms) => new Promise((r) => setTimeout(r, ms)); for (let y = 0; y < Math.min(document.body.scrollHeight, 14000); y += 700) { scrollTo({ top: y, behavior: 'instant' }); await w(180) } scrollTo({ top: 0, behavior: 'instant' }); await w(900) })()`

export async function captureSite({ url, browser, outDir, onLog = () => {} }) {
  let target
  try {
    target = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`)
  } catch {
    throw new Error('That is not a web address.')
  }
  if (!/^https?:$/.test(target.protocol)) throw new Error('Use an http or https address.')
  if (!browser) throw new Error('Capturing a website needs Microsoft Edge, Google Chrome or Chromium on this computer.')
  fs.mkdirSync(path.join(outDir, 'images'), { recursive: true })
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'iv-capture-'))
  const proc = spawn(browser, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars', '--mute-audio', 'about:blank'], { windowsHide: true, stdio: 'ignore' })
  let cdp
  try {
    const port = await waitFor(async () => fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0].trim(), 20000, 'start')
    const page = await waitFor(async () => (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page'), 10000, 'open a page')
    cdp = await devtools(page.webSocketDebuggerUrl)
    await cdp.send('Page.enable')
    const evaluate = async (expression) => (await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.value
    const shot = async (file, params = {}) => {
      const r = await cdp.send('Page.captureScreenshot', { format: 'png', ...params })
      fs.writeFileSync(file, Buffer.from(r.data, 'base64'))
      return file
    }
    const open = async (metrics) => {
      await cdp.send('Emulation.setDeviceMetricsOverride', metrics)
      const loaded = cdp.once('Page.loadEventFired', 30000)
      const nav = await cdp.send('Page.navigate', { url: target.href })
      if (nav.errorText) throw new Error(`Couldn't open ${target.href}: ${nav.errorText}`)
      await loaded
      await sleep(2500)
      await evaluate(HIDE_BANNERS)
      await evaluate(SCROLL_THROUGH)
      await evaluate(scrollJs(0))
    }

    onLog(`Opening ${target.href}…`)
    await open({ width: W, height: H, deviceScaleFactor: 1, mobile: false })
    const site = await evaluate(READ_PAGE)
    if (!site) throw new Error('The page did not load.')
    const captures = []
    const add = (name, file, width, height, what) => captures.push({ name, file, width, height, what })

    onLog('Capturing screens…')
    const screens = Math.max(1, Math.min(MAX_SCREENS, Math.ceil(site.height / H)))
    for (let k = 0; k < screens; k++) {
      await evaluate(scrollJs(k * H))
      await sleep(700)
      add(k ? `screen-${k + 1}` : 'hero', await shot(path.join(outDir, k ? `screen-${k + 1}.png` : 'hero.png')), W, H, k ? `What's ${k} screen${k > 1 ? 's' : ''} down the page` : 'The top of the page, as it opens')
    }
    await evaluate(scrollJs(0))
    await sleep(900)
    if (site.logo && site.logo.y + site.logo.height < H) {
      // inside the first screen, so no resizing (a capture beyond the viewport re-lays the page out)
      const pad = 12
      const c = { x: Math.max(0, site.logo.x - pad), y: Math.max(0, site.logo.y - pad), width: site.logo.width + pad * 2, height: site.logo.height + pad * 2, scale: 3 }
      add('logo', await shot(path.join(outDir, 'logo.png'), { clip: c }), Math.round(c.width * 3), Math.round(c.height * 3), 'The logo, as it sits on the page')
    }

    onLog('Capturing the phone layout…')
    await open({ width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
    add('mobile', await shot(path.join(outDir, 'mobile.png')), 780, 1688, 'The top of the page on a phone')

    onLog('Saving the pictures on the page…')
    const images = []
    const sources = [...(site.ogImage ? [{ src: new URL(site.ogImage, site.url).href, alt: 'Share image (og:image)' }] : []), ...site.images]
    for (const img of sources.slice(0, 8)) {
      try {
        const r = await fetch(img.src, { signal: AbortSignal.timeout(20000) })
        const type = r.headers.get('content-type') || ''
        const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[type.split(';')[0]]
        if (!r.ok || !ext) continue
        const buf = Buffer.from(await r.arrayBuffer())
        if (buf.length > 15e6) continue
        const file = path.join(outDir, 'images', `image-${images.length + 1}.${ext}`)
        fs.writeFileSync(file, buf)
        images.push({ file, src: img.src, alt: img.alt, width: img.w || null, height: img.h || null })
      } catch {
        /* a picture that won't download is skipped */
      }
    }
    const { logo, images: _found, height, ...copy } = site
    const result = { ...copy, requested: target.href, capturedAt: new Date().toISOString(), pageHeight: height, captures, images }
    fs.writeFileSync(path.join(outDir, 'site.json'), JSON.stringify(result, null, 2))
    return result
  } finally {
    try {
      cdp && (await cdp.send('Browser.close').catch(() => {}), cdp.close())
    } catch {}
    setTimeout(() => {
      try {
        proc.kill()
      } catch {}
      fs.rmSync(profile, { recursive: true, force: true })
    }, 1500)
  }
}
