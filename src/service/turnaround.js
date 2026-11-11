// A turnaround sheet: five views of a character, turning around, from one picture of them. matlod's Turnaround LoRA
// for MiniMax H3 (Contact-Sheet diffusion: five still pictures packed where a short video would go, so H3's
// shot-to-shot consistency keeps one person across five angles) with matlowai's H3 Contact Sheet nodes, which pack
// and unpack the five pictures around a stock sampler. The graph follows the node pack's own example: ref2va H3,
// the LoRA through the stock loader, res_multistep / simple, 28 steps. Both downloads are the person's to make
// (Recommended shelf and Setup); the LoRA keeps MiniMax's H3 Community Licence, the nodes their own (GPL).
// Tried on Tess and Theo (2026-11-10, 512 px, a 4090, about a minute a sheet): at strength 1 the first views barely
// turn and hair swings over the face; at 1.3 the camera goes front, three-quarter, profile with the face held. Some
// seeds roll the camera sideways instead of turning, so each sheet gets a new seed. The studio-background wording
// also rolls the camera with this checkpoint (the model card says only its s400 checkpoint honours it), so it isn't
// offered.
export const DEFAULT_STRENGTH = 1.3
import fs from 'node:fs'
import path from 'node:path'
import { RECOMMENDED } from './recommended.js'

export const TURNAROUND_LORA = RECOMMENDED.find((r) => r.id === 'rec-turnaround')
export const CONTACT_SHEET_CLASSES = ['H3ContactSheet', 'H3ContactSheetDecode']
const MODEL = { unet: 'minimax_h3_ref2va_pruned_int8_convrot.safetensors', clip: 'qwen3vl_32b_minimax_h3_int4_convrot.safetensors', vae: 'minimax_h3_video_vae_int8_convrot.safetensors' }
export const SIZES = [512, 768, 1024]
// What the LoRA was trained on: the camera orbiting a subject that starts facing it.
export const turnaroundPrompt = ({ studio = false } = {}) => `the camera orbits the subject of <Picture 1> ninety degrees clockwise${studio ? ', neutral studio background, constant lighting' : ''}`

export function turnaroundGraph({ ref, lora, size = 512, seed = 42, strength = 1, studio = false, prefix }) {
  return {
    unet: { class_type: 'UNETLoader', inputs: { unet_name: MODEL.unet, weight_dtype: 'default' } },
    lora: { class_type: 'LoraLoaderModelOnly', inputs: { model: ['unet', 0], lora_name: lora, strength_model: strength } },
    clip: { class_type: 'CLIPLoader', inputs: { clip_name: MODEL.clip, type: 'minimax', device: 'default' } },
    vae: { class_type: 'VAELoader', inputs: { vae_name: MODEL.vae } },
    ref: { class_type: 'LoadImage', inputs: { image: ref } },
    sheet: { class_type: 'H3ContactSheet', inputs: { clip: ['clip', 0], vae: ['vae', 0], prompt: turnaroundPrompt({ studio }), ref_image: ['ref', 0], size } },
    guider: { class_type: 'BasicGuider', inputs: { model: ['lora', 0], conditioning: ['sheet', 0] } },
    sigmas: { class_type: 'BasicScheduler', inputs: { model: ['lora', 0], scheduler: 'simple', steps: 28, denoise: 1 } },
    sampler: { class_type: 'KSamplerSelect', inputs: { sampler_name: 'res_multistep' } },
    noise: { class_type: 'RandomNoise', inputs: { noise_seed: seed } },
    run: { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['noise', 0], guider: ['guider', 0], sampler: ['sampler', 0], sigmas: ['sigmas', 0], latent_image: ['sheet', 1] } },
    decode: { class_type: 'H3ContactSheetDecode', inputs: { vae: ['vae', 0], samples: ['run', 0] } },
    // node ids sort as views, then strip: the job's outputs keep that order
    s1views: { class_type: 'SaveImage', inputs: { images: ['decode', 0], filename_prefix: `${prefix}_view` } },
    s2strip: { class_type: 'SaveImage', inputs: { images: ['decode', 1], filename_prefix: `${prefix}_strip` } }
  }
}

// What's missing before a sheet can be made: the nodes, the LoRA (its path as ComfyUI lists it, when found).
export function turnaroundReady(info = {}) {
  const loras = info.LoraLoaderModelOnly?.input?.required?.lora_name?.[0] || info.LoraLoaderModelOnly?.input?.required?.lora_name?.[1]?.options || []
  const lora = loras.find((n) => n.split(/[\\/]/).pop() === TURNAROUND_LORA.match) || null
  const nodes = CONTACT_SHEET_CLASSES.every((c) => info[c])
  return { nodes, lora, ready: nodes && !!lora }
}

export class Turnarounds {
  constructor({ dataDir, studio }) {
    this.dir = path.join(dataDir, 'turnarounds')
    this.studio = studio
  }
  file = (id) => path.join(this.dir, id, 'sheet.json')
  // every sheet, newest first (characterId: only that character's)
  list(characterId = null) {
    if (!fs.existsSync(this.dir)) return []
    return fs
      .readdirSync(this.dir)
      .map((id) => {
        try {
          return JSON.parse(fs.readFileSync(this.file(id), 'utf8'))
        } catch {
          return null
        }
      })
      .filter((s) => s && (!characterId || s.characterId === characterId))
      .sort((a, b) => String(b.at).localeCompare(String(a.at)))
  }
  async status() {
    const st = this.studio()
    const info = await st.comfy.objectInfo().catch(() => ({}))
    return { ...turnaroundReady(info), lora_id: TURNAROUND_LORA.id, size: TURNAROUND_LORA.size }
  }
  remove(id) {
    if (!/^[\w-]+$/.test(id)) throw new Error('No such sheet.')
    fs.rmSync(path.join(this.dir, id), { recursive: true, force: true })
    return true
  }
  // characterId (its face picture) or picture; size per view (512 takes about a minute on a 4090)
  async make({ characterId = null, picture = null, size = 512, seed = Math.floor(Math.random() * 1e9), strength = DEFAULT_STRENGTH, studioBackground = false }) {
    const st = this.studio()
    if (st.comfy.hosted) throw new Error('Turnaround sheets run on this computer’s ComfyUI or your own cloud (RunPod, Modal).')
    const ch = characterId ? st.characters().find((c) => c.id === characterId) : null
    if (characterId && !ch) throw new Error('No such character.')
    const ref = picture || (ch && st.facePicture(ch, st.resourcesDir))
    if (!ref || !fs.existsSync(ref)) throw new Error(ch ? `${ch.name} has no face picture yet. Add one first.` : 'Pick a picture of the character.')
    if (!SIZES.includes(size)) throw new Error(`Size is ${SIZES.join(', ')} pixels a view.`)
    const ready = turnaroundReady(await st.comfy.objectInfo().catch(() => ({})))
    if (!ready.nodes) throw new Error('Turnaround sheets need the H3 Contact Sheet node pack. Install it from Settings → Setup, then restart ComfyUI.')
    if (!ready.lora) throw new Error(`Turnaround sheets need the Turnaround LoRA (${Math.round(TURNAROUND_LORA.size / 1e6)} MB). Download it from LoRAs → Recommended.`)
    const id = `ta${Date.now().toString(36)}`
    const graph = turnaroundGraph({ ref: await st.comfy.upload(ref, 'iv_studio/turnaround'), lora: ready.lora, size, seed, strength, studio: studioBackground, prefix: `iv_studio/turnaround/${id}` })
    const job = await st.submitGraph({ kind: 'turnaround', graph, name: `Turnaround${ch ? ` of ${ch.name}` : ''}`, plan: { images: true, turnaround: { characterId, size, seed, strength } } })
    let j = job
    for (const end = Date.now() + 20 * 60e3; Date.now() < end; await new Promise((r) => setTimeout(r, 3000))) {
      j = await st.refreshJob(job.id)
      if (['success', 'error', 'cancelled'].includes(j.status)) break
    }
    if (j.status !== 'success') throw new Error(j.error || `The sheet ${j.status || 'took too long'}.`)
    const dir = path.join(this.dir, id)
    fs.mkdirSync(dir, { recursive: true })
    const imgs = (j.outputs || []).filter((o) => o.kind === 'image')
    const copies = []
    for (const o of imgs) {
      // kept in IV Studio's data folder: a local render is copied out of ComfyUI's output, a cloud one downloaded
      const got = await st.localCopy(o, dir)
      const to = path.join(dir, path.basename(got))
      if (path.resolve(got) !== path.resolve(to)) fs.copyFileSync(got, to)
      copies.push(to)
    }
    const strip = copies.find((f) => /_strip/.test(path.basename(f))) || null
    const views = copies.filter((f) => f !== strip)
    if (views.length < 5) throw new Error(`The sheet came back with ${views.length} views instead of 5.`)
    const sheet = { id, characterId, name: ch?.name || path.basename(ref), ref, size, seed, strength, studioBackground, views, strip, jobId: j.id, at: new Date().toISOString() }
    fs.writeFileSync(this.file(id), JSON.stringify(sheet, null, 2))
    return sheet
  }
}
