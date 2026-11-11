// RAM in use, the way the OS's own monitor counts it. os.freemem() on macOS counts only the free pages, so memory
// the Mac holds as cache (inactive, purgeable, speculative) reads as "used" and a mostly idle 128 GB Mac showed
// 121 GB. Activity Monitor's Memory Used is App Memory + Wired + Compressed:
//   (anonymous pages - purgeable pages + wired pages + pages occupied by the compressor) x page size
// from vm_stat's counters (XNU: internal_page_count, purgeable_count, wire_count, compressor_page_count). Apple
// documents the three categories, not this arithmetic, so it is a reconstruction (the one mactop uses), checked
// against Activity Monitor and top on a real Mac. Windows and Linux keep os.freemem() (libuv reports MemAvailable
// on Linux, which already leaves out reclaimable cache).
import { execFile } from 'node:child_process'
import os from 'node:os'

// vm_stat output -> { pageSize, used (bytes) }, or null when it is not vm_stat output or a counter is missing.
export function parseVmStat(text) {
  if (!text) return null
  const size = /page size of (\d+) bytes/.exec(text)
  const pageSize = size ? Number(size[1]) : 0
  if (!(pageSize > 0)) return null
  const pages = {}
  for (const m of String(text).matchAll(/^"?([^":\n]+?)"?:\s+(\d+)\.?\s*$/gm)) pages[m[1].trim()] = Number(m[2])
  const need = ['Anonymous pages', 'Pages purgeable', 'Pages wired down', 'Pages occupied by compressor']
  if (need.some((k) => !Number.isFinite(pages[k]))) return null
  const used = Math.max(0, pages['Anonymous pages'] - pages['Pages purgeable']) + pages['Pages wired down'] + pages['Pages occupied by compressor']
  return { pageSize, used: used * pageSize }
}

function vmStat() {
  return new Promise((resolve) => {
    execFile('/usr/bin/vm_stat', [], { timeout: 2000 }, (err, stdout) => resolve(err ? null : String(stdout)))
  })
}

// { total, free } in bytes, free = total - used, so callers keep subtracting as before. `read` returns vm_stat's text.
export async function ramReadout({ platform = process.platform, total = os.totalmem(), free = os.freemem(), read = vmStat } = {}) {
  if (platform === 'darwin') {
    const v = parseVmStat(await read().catch(() => null))
    if (v) {
      const used = Math.min(v.used, total)
      return { total, free: total - used }
    }
  }
  return { total, free }
}
