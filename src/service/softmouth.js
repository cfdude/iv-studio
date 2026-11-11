// Soft mouth: a copy of a reference video with each person's mouth and jaw blurred, so a new face made from it
// doesn't mouth the source person's words. For video references in shots with no spoken line (Create's References
// mode, Replace's source). mouth_track.py finds the faces (InsightFace's SCRFD through Shinobi's Python, with the face
// models the person downloads on Characters) and writes a mask; ffmpeg blurs the source under it, keeping the sound
// and everything else as it was. Idea from keys + Sam Wasserman's Imagination Studio (soft_mouth); our own code.
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

// The blur: strong enough that lip shapes don't read, scaled to the picture; the mask's edge is feathered.
export const blurFor = (width) => Math.max(8, Math.round(width / 45))
export function softMouthArgs({ src, mask, out, width }) {
  const s = blurFor(width)
  return ['-y', '-hide_banner', '-v', 'error', '-i', src, '-i', mask, '-filter_complex', `[0:v]split[a][b];[b]gblur=sigma=${s}:steps=2[bl];[1:v]format=gray,gblur=sigma=${Math.max(3, Math.round(s / 2))}[m];[bl][m]alphamerge[fg];[a][fg]overlay=format=auto,format=yuv420p[v]`, '-map', '[v]', '-map', '0:a?', '-c:v', 'libx264', '-crf', '14', '-preset', 'fast', '-c:a', 'copy', '-movflags', '+faststart', out]
}
// A shot speaks when its prompt has a spoken line or a voice line rides with it; then soft mouth is off.
export const speaks = ({ prompt = '', voiceLine = null } = {}) => !!voiceLine || /<d>[\s\S]*?\S[\s\S]*?<\/d>/.test(String(prompt))

export class SoftMouth {
  // shinobi(): the Shinobi service (its Python and face models); ffmpeg: the bundled ffmpeg
  constructor({ dataDir, ffmpeg, shinobi, resourcesDir }) {
    this.dir = path.join(dataDir, 'softmouth')
    Object.assign(this, { ffmpeg, shinobi, resourcesDir })
  }
  ready() {
    const sh = this.shinobi()
    if (!sh?.installed?.()) return { ready: false, why: 'Soft mouth uses Shinobi’s Python. Set up Shinobi once (Workflows → Shinobi).' }
    if (!sh.faceModelsReady()) return { ready: false, why: 'Soft mouth needs the face models (Characters → Rank by likeness downloads them).' }
    return { ready: true }
  }
  run(cmd, args) {
    return new Promise((resolve, reject) => {
      const p = spawn(cmd, args, { windowsHide: true, env: this.shinobi()?.env?.() })
      let out = ''
      let err = ''
      p.stdout.on('data', (d) => (out += d))
      p.stderr.on('data', (d) => (err += d))
      p.on('error', reject)
      p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(err.trim().split(/\r?\n/).pop() || out.trim() || 'Soft mouth failed.'))))
    })
  }
  // The softened copy (made once per file version, kept in the data folder): { path, frames, withFace }.
  async make(src) {
    if (!fs.existsSync(src)) throw new Error(`File not found: ${src}`)
    const r = this.ready()
    if (!r.ready) throw new Error(r.why)
    const key = createHash('sha1').update(JSON.stringify([path.resolve(src), fs.statSync(src).mtimeMs, 1])).digest('hex').slice(0, 10)
    const out = path.join(this.dir, `${path.basename(src).replace(/\.[^.]+$/, '').replace(/[^\w -]+/g, '_')}_softmouth_${key}.mp4`)
    const info = `${out}.json`
    if (fs.existsSync(out) && fs.existsSync(info)) return { path: out, ...JSON.parse(fs.readFileSync(info, 'utf8')) }
    fs.mkdirSync(this.dir, { recursive: true })
    const mask = path.join(this.dir, `${key}_mask.mkv`)
    const sh = this.shinobi()
    const track = JSON.parse(await this.run(sh.python, [path.join(this.resourcesDir, 'python', 'mouth_track.py'), sh.faceDir, src, this.ffmpeg, mask]))
    if (track.error) throw new Error(track.error)
    if (!track.withFace) {
      fs.rmSync(mask, { force: true })
      throw new Error('No face was found in that video, so there’s no mouth to soften.')
    }
    await this.run(this.ffmpeg, softMouthArgs({ src, mask, out, width: track.width }))
    fs.rmSync(mask, { force: true })
    const facts = { frames: track.frames, withFace: track.withFace, width: track.width, height: track.height }
    fs.writeFileSync(info, JSON.stringify(facts))
    return { path: out, ...facts }
  }
}
