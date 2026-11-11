// Website capture: screenshots, copy, colours, fonts, logo and pictures from a real page, with the computer's
// Edge or Chrome. Writes into a temporary folder (printed at the end).
//   node test/site-capture.mjs [https://infinitevariance.ai]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { captureSite } from '../src/service/sitecapture.js'
import { Shinobi } from '../src/service/shinobi.js'

let failures = 0
const expect = (label, cond, detail = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${detail ? ` - ${detail}` : ''}`)
  if (!cond) failures++
}
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ivs-capture-'))
const browser = new Shinobi({ dataDir: out, resourcesDir: 'resources' }).browser()
const t0 = Date.now()
const site = await captureSite({ url: process.argv[2] || 'https://infinitevariance.ai', browser, outDir: out, onLog: (l) => console.log('  ', l) })
const png = (f) => fs.existsSync(f) && fs.readFileSync(f).subarray(1, 4).toString() === 'PNG'
expect('captured in under 2 minutes', Date.now() - t0 < 120000, `${((Date.now() - t0) / 1000).toFixed(1)} s`)
expect('title and copy', !!site.title && site.headings.length > 0, `${site.title} · ${site.headings.length} headings, ${site.ctas.length} buttons, ${site.paragraphs.length} paragraphs`)
expect('colours and fonts', site.colors.length >= 2 && site.fonts.length >= 1, `${site.colors.join(' ')} · ${site.fonts.join(', ')}`)
expect('hero, screens and phone', ['hero', 'screen-2', 'mobile'].every((n) => site.captures.some((c) => c.name === n && png(c.file))), site.captures.map((c) => `${c.name} ${c.width}x${c.height}`).join(', '))
expect('logo found', site.captures.some((c) => c.name === 'logo'))
expect('pictures saved', site.images.length > 0, `${site.images.length}`)
console.log(failures ? `${failures} failed` : 'all passed', '| files in', out)
process.exit(failures ? 1 : 0)
