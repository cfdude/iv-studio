// Character training: invent a person, give them movement and a voice, train an H3 character LoRA, keep the best
// checkpoint as a character preset. The method is the one that made Tess (2026-10-24/25):
//   1 Design  Z-Image Turbo stills on this PC: face candidates, then the picked face's seed across scenes.
//   2 Clips   H3 reference-to-video talking clips from two stills (and a voice sample), or the user's own clips,
//             fitted to Fizgig's rules (24 fps, 17n+5 frames, sides multiple of 32, 32 kHz stereo).
//   3 Train   Fizgig on the user's own Modal account (resources/cloud/train_app.py), with a cost estimate first.
//   4 Pick    checkpoints rendered side by side on one seed; the chosen one becomes a character.
// Captions never describe the face or voice: whatever isn't described binds to the trigger word.
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { Cloud } from './cloud.js'
import { probe } from './media.js'
import { comboOptions } from './setup.js'
import { readSettings } from './paths.js'
import { GPUS as RENDER_GPUS, RunPod } from './runpod.js'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

// Modal list prices (modal.com/pricing, 2026-10-28), billed by the second. secPerStep is for an IV Studio
// dataset (stills plus talking clips): measured 1.09 s on an H200 (Theo, 2026-10-28); the B200 and H100
// figures are scaled from it. Tess's B200 run (0.47 s) had many cheap voice-only items.
export const TRAIN_GPUS = [
  { id: 'B200', label: 'B200 · 180 GB', perHour: 6.25, secPerStep: 0.7, note: "Fastest, but Modal's Starter plan doesn't offer it." },
  { id: 'H200', label: 'H200 · 141 GB', perHour: 4.54, secPerStep: 1.1, note: 'Theo trained in 56 minutes for about $4.10.' },
  { id: 'H100', label: 'H100 · 80 GB', perHour: 3.95, secPerStep: 1.5, note: 'Slower; a run peaks at about 26 GB, so it fits.' }
]
// Modal can accept a run and then never schedule it (a GPU the account's plan doesn't include). Its CLI
// says nothing; the app log does: "waiting to be scheduled on a GPU_B200 worker ... unavailable on starter plan".
const UNSCHEDULABLE = /waiting to be scheduled on a GPU_(\w+) worker.*?(unavailable on (\w+) plan|concurrency limits)/i
const GRID = Array.from({ length: 8 }, (_, n) => 17 * n + 5) // 5 .. 124 frames
const VOLUME = 'iv-studio-train'
// RunPod: the training volume (the H3 training files are about 42 GB; datasets and checkpoints take the rest) and
// Fizgig's own published image, which has its Python and CUDA ready.
const RP_VOLUME_GB = 80
const RP_IMAGE = 'ghcr.io/shootthesound/fizgig:latest'
const RP_PREFIX = 'iv-train'

// Where each design still is set. Clothes and light vary so neither welds to the trigger.
export const SCENES = [
  'standing by a kitchen window in soft morning light, wearing a grey knitted jumper, waist-up, looking at the camera',
  'on a city street on an overcast day, wearing a dark green rain jacket, chest-up, three-quarter view',
  'sitting by the window of a busy café, wearing a cream cable-knit cardigan, holding a cup, medium shot',
  "in the driver's seat of a parked car, daylight through the windscreen, wearing a navy hoodie, chest-up",
  'on a sofa in a living room in the evening under a warm lamp, wearing an oversized black t-shirt, medium shot',
  'in a park in autumn, wearing a camel wool coat and a scarf, waist-up, looking slightly off camera',
  'at a desk in a home office with a laptop open, wearing a white button-up shirt, chest-up, ceiling light',
  'in profile by a window, wearing a black turtleneck, soft side light, close-up'
]
// Talking clips: where they are, what they say, what the room sounds like.
export const TALKS = [
  { scene: 'in a kitchen in the morning, wearing a grey knitted jumper, waist-up', line: "Okay, so I finally tried that recipe, and honestly? Not bad at all.", sound: 'A kettle hums in the background' },
  { scene: 'walking on a city street on an overcast day, wearing a dark green rain jacket, chest-up', line: "I'm about five minutes away. Don't start without me, alright?", sound: 'Light traffic and footsteps' },
  { scene: 'sitting by the window of a busy café, wearing a cream cardigan, medium close-up', line: 'You will not believe who just walked in here.', sound: 'Quiet café chatter and cups' },
  { scene: "in the driver's seat of a parked car on a rainy day, wearing a navy hoodie, chest-up", line: "Right. Deep breath. I can do this. I've got this.", sound: 'Rain patters on the roof' },
  { scene: 'on a sofa in a living room in the evening under a warm lamp, wearing a black t-shirt, medium shot', line: 'Is it just me, or does Sunday go twice as fast as every other day?', sound: 'A quiet room' },
  { scene: 'in a park in autumn, wearing a camel wool coat and a scarf, waist-up', line: 'Look at this. Every single tree has gone orange overnight.', sound: 'Birdsong and a light wind' },
  { scene: 'at a desk in a home office, wearing a white shirt, chest-up, ceiling light', line: 'Can everyone hear me? No? Let me try that again.', sound: 'A soft room tone and a keyboard' },
  { scene: 'leaning on a kitchen counter in the evening, wearing a dark red sweatshirt, medium close-up', line: "Promise me you'll never tell anyone I said that.", sound: 'A fridge hums' }
]

const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}
const now = () => new Date().toISOString()
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24) || 'character'

// A made-up trigger H3 has no prior for, from the name: "Tess" -> "t3ss4" (the style Claire and Tess used).
export function suggestTrigger(name) {
  const base = slug(name).replace(/_/g, '').slice(0, 6) || 'char'
  return base.replace(/e/g, '3').replace(/i/g, '1').replace(/o/g, '0') + base.length
}

// Steps, minutes and dollars for a run. items: stills + clips; clips cost more per step, which the
// measured seconds-per-step already averages in for a Tess-like mix. Fine detail (about 0.5 MP) costs about twice
// as much per step as the normal 0.25 MP.
export function estimate({ items, epochs, gpu = 'B200', detail = 'normal', where = 'modal', precision = 'auto' }) {
  const list = trainGpus(where)
  const g = list.find((x) => x.id === gpu) || list[0]
  const steps = items * epochs
  const per = precision === 'int8' && g.secPerStepInt8 ? g.secPerStepInt8 : g.secPerStep
  const minutes = (steps * per * (detail === 'fine' ? 2 : 1)) / 60 + 7 // caching the dataset and starting up
  return { steps, minutes: Math.ceil(minutes), dollars: g.perHour ? +((minutes / 60) * g.perHour + 0.15).toFixed(2) : 0, gpu: g.id, perHour: g.perHour, where }
}

// Enough steps to learn a face from a small set without burning money on a big one (Claire: ~3,500).
export const defaultEpochs = (items) => Math.max(40, Math.min(120, Math.round(2800 / Math.max(1, items))))

// ---------- the recipe (what the Train step offers; every flag checked against Fizgig 4b3f07f) ----------
// Presets: Quick is Fizgig's own "MiniMax H3 Fast" (rank 8, a shorter run, tends to come out more flexible);
// Standard is what Tess and Theo trained with; Thorough runs half as long again, for big sets.
export const TRAIN_PRESETS = {
  quick: { label: 'Quick', rank: 8, steps: 1500, min: 30, max: 60, note: 'Fizgig’s Fast recipe: likeness in a few hundred steps, and rank 8 tends to stay flexible.' },
  standard: { label: 'Standard', rank: 16, steps: 2800, min: 40, max: 120, note: 'What Tess and Theo trained with.' },
  thorough: { label: 'Thorough', rank: 16, steps: 4200, min: 60, max: 160, note: 'Half as long again, for a big set or when Standard looks unfinished.' }
}
export const TRAIN_DEFAULTS = { where: 'modal', preset: 'standard', learn: 'look_voice', detail: 'normal', mode: 'likeness', checkpoints: 20, rank: null, seed: 42, captionDropout: 0.05, cleanEnd: 60, precision: 'auto', budget: null }
const pickOf = (v, list, d) => (list.includes(v) ? v : d)
// The options as given (partly, from the window or an agent) made whole and safe.
export function trainOptions(o = {}) {
  const d = TRAIN_DEFAULTS
  o = o || {}
  const num = (v, lo, hi, def) => (v !== null && v !== '' && Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : def)
  return {
    where: pickOf(o.where, ['modal', 'runpod', 'local'], 'modal'),
    preset: pickOf(o.preset, Object.keys(TRAIN_PRESETS), d.preset),
    learn: pickOf(o.learn, ['look', 'look_voice'], d.learn),
    detail: pickOf(o.detail, ['normal', 'fine'], d.detail),
    mode: pickOf(o.mode, ['likeness', 'whole'], d.mode),
    checkpoints: pickOf(Number(o.checkpoints), [10, 20, 40], d.checkpoints),
    rank: o.rank == null || o.rank === '' ? null : pickOf(Number(o.rank), [8, 16, 32], null),
    seed: Math.round(num(o.seed, 0, 2 ** 31 - 1, d.seed)),
    captionDropout: pickOf(Number(o.captionDropout ?? d.captionDropout), [0, 0.05, 0.1], d.captionDropout),
    cleanEnd: pickOf(Number(o.cleanEnd ?? d.cleanEnd), [60, 8], d.cleanEnd),
    // Fizgig's base precision: auto (its memory planner; it can drop to 4-bit on a 24 GB card) or int8 (the
    // checkpoint's own, the accurate base the cloud GPUs use)
    precision: pickOf(o.precision, ['auto', 'int8'], d.precision),
    budget: o.budget == null || o.budget === '' || !(Number(o.budget) > 0) ? null : +num(o.budget, 0.5, 500, 0.5).toFixed(2)
  }
}
export const rankOf = (opts) => opts.rank || TRAIN_PRESETS[opts.preset].rank
export function epochsFor(items, opts) {
  const p = TRAIN_PRESETS[opts.preset]
  return Math.max(p.min, Math.min(p.max, Math.round(p.steps / Math.max(1, items))))
}
// Seconds of GPU a budget buys (after the start-up share the estimate adds), for the script's own timer.
export function budgetSeconds(budget, perHour) {
  if (!budget) return null
  return Math.max(300, Math.floor(((budget - 0.15) / perHour) * 3600))
}

// ---------- where it trains ----------
// RunPod Secure Cloud GPUs with room for H3 training (a run peaks at about 26 GB with nothing streamed), by
// RunPod's list price (2026-11-07). secPerStep: the H100 is Modal's measured figure; the others are scaled by
// their speed relative to it and are estimates until a run measures them.
export const RUNPOD_TRAIN_GPUS = [
  { id: 'NVIDIA L40S', label: 'L40S · 48 GB', perHour: 1.09, secPerStep: 2.6, note: 'The best value: about half the H100’s speed at a quarter of its price.' },
  { id: 'NVIDIA A100 80GB PCIe', label: 'A100 · 80 GB', perHour: 1.79, secPerStep: 2.1, note: 'Faster than the L40S, more memory.' },
  { id: 'NVIDIA H100 80GB HBM3', label: 'H100 · 80 GB', perHour: 3.99, secPerStep: 1.5, note: 'The fastest here, about $4 an hour.' },
  { id: 'NVIDIA RTX 6000 Ada Generation', label: 'RTX 6000 Ada · 48 GB', perHour: 0.99, secPerStep: 2.8, note: 'Like the L40S, a little slower and cheaper.' }
]
// This PC: free. Measured on Matt's RTX 4090 (24 GB, 64 GB RAM) with Theo's set, 2026-11-07: Fizgig's auto plan
// (a 4-bit base, 40 blocks streamed) 3.17 s a step, peak 9.5 GB; the int8 base (40 blocks streamed) 6.73 s, peak 13.8 GB.
export const LOCAL_TRAIN = { id: 'local', label: 'This computer', perHour: 0, secPerStep: 3.2, secPerStepInt8: 6.7, note: 'Free. Your graphics card is busy while it trains.' }
export const TRAIN_WHERE = ['modal', 'runpod', 'local']
export const trainGpus = (where) => (where === 'runpod' ? RUNPOD_TRAIN_GPUS : where === 'local' ? [LOCAL_TRAIN] : TRAIN_GPUS)

// The five files Fizgig trains H3 with (the same files ComfyUI renders with).
export const MODEL_FILES = {
  dit: 'minimax_h3_fl2va_pruned_int8_convrot.safetensors',
  te: 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',
  vvae: 'minimax_h3_video_vae_fp16.safetensors',
  avae: 'minimax_h3_audio_vae_fp32.safetensors',
  adapter: 'minimax_h3_image_training_adapter.safetensors'
}
const inDir = (dir) => Object.fromEntries(Object.entries(MODEL_FILES).map(([k, f]) => [k, `${dir}/${f}`]))

// Fizgig's three commands for a run, as argument lists (script path first), so a bash script (Modal, RunPod) and
// this PC's own Python run exactly the same recipe. root: the run's folder (dataset.toml, loras/); files: the five
// model files; resume: a saved state's folder name inside loras/ (Train more).
export function trainArgs({ name, epochs, saveEvery, options, resume = null, root, files }) {
  const o = trainOptions(options)
  const rank = String(rankOf(o))
  const out = `${root}/loras`
  const blocks = o.mode === 'whole' ? ['--train_blocks', '6-49'] : ['--family_option', 'photo_blocks=20-49', '--family_option', 'clip_blocks=20-49', '--family_option', 'audio_blocks=20-49']
  return {
    latents: ['src/fizgig/families/cache.py', '--family', 'minimax', '--stage', 'latents', '--dataset_config', `${root}/dataset.toml`, '--model', files.vvae, '--aux', `audio_vae=${files.avae}`, '--aux', 'clip_still=1'],
    text: ['src/fizgig/families/cache.py', '--family', 'minimax', '--stage', 'text', '--dataset_config', `${root}/dataset.toml`, '--model', files.te],
    train: [
      'src/fizgig/families/train.py', '--family', 'minimax',
      '--dataset_config', `${root}/dataset.toml`,
      '--dit', files.dit, '--vae', files.vvae, '--text_encoder', files.te,
      '--output_dir', out, '--output_name', `${name}_mmh3`,
      '--network_dim', rank, '--network_alpha', rank,
      '--optimizer_type', 'automagic3', '--learning_rate', '1e-6',
      '--max_train_epochs', String(epochs), '--save_every_n_epochs', String(saveEvery), '--seed', String(o.seed),
      '--save_state', '--save_state_on_train_end', '--keep_last_n_states', '2',
      '--precision', o.precision, '--blocks_to_swap', '-1', '--ema_decay', '0.98',
      '--training_adapter', files.adapter,
      '--family_option', `lownoise_pct=${o.cleanEnd}`, '--family_option', 'highnoise_lr_pct=100',
      ...blocks,
      '--family_option', 'tread=0.5@2-47', '--family_option', 'clip_still_as_photo=1', '--family_option', `caption_dropout=${o.captionDropout}`,
      '--family_option', `audio_vae=${files.avae}`,
      ...(resume ? ['--resume', `${out}/${resume}`] : [])
    ]
  }
}
// absolute paths (and anything holding one) quoted, as Tess's script had them; plain words and src/ paths bare
const sh = (a) => (a.startsWith('/') || /=\//.test(a) || !/^[\w.,:=@/+-]+$/.test(a) ? `"${a.replace(/(["\\$`])/g, '\\$1')}"` : a)
const line = (args) => `python3 ${args.map(sh).join(' ')}`

// Fizgig's commands as a bash script (Modal: /vol, RunPod: /workspace), with the chosen recipe. maxSeconds: a
// budget cap the script keeps itself, so it holds even if IV Studio is closed: training stops there, and what was
// saved so far stays.
export function trainScript({ name, epochs, saveEvery, options, resume = null, maxSeconds = null, base = '/vol' }) {
  const root = `${base}/train/${name}`
  const a = trainArgs({ name, epochs, saveEvery, options, resume, root, files: inDir(`${base}/models`) })
  const timer = maxSeconds ? `END=$(( $(date +%s) + ${maxSeconds} ))\nleft() { local l=$(( END - $(date +%s) )); [ "$l" -gt 60 ] && echo "$l" || echo 60; }\n` : ''
  const lim = maxSeconds ? 'timeout --signal=INT --kill-after=120 "$(left)" ' : ''
  const train = lim + line(a.train)
  const capped = `set +e
${train}
code=$?
set -e
if [ "$code" = 124 ] || [ "$code" = 130 ] || [ "$code" = 137 ]; then echo "BUDGET REACHED: training stopped at the spending cap; the checkpoints saved so far are kept"; elif [ "$code" != 0 ]; then exit "$code"; fi`
  return `#!/usr/bin/env bash
set -euo pipefail
cd "/opt/Fizgig"
export PYTHONPATH="/opt/Fizgig/src\${PYTHONPATH:+:$PYTHONPATH}"
${timer}${line(a.latents)}
${line(a.text)}
${maxSeconds ? capped : train}
`
}

// 0.25 MP normally (Fizgig's tested default), about 0.5 MP for fine detail. images and cache: the dataset folder
// and its cache (Modal's by default; RunPod and this PC pass their own).
export const datasetToml = (name, { detail = 'normal', images = `/vol/datasets/${name}`, cache = `/vol/train/${name}/cache` } = {}) => `[general]
resolution = [${detail === 'fine' ? '704, 704' : '512, 512'}]
caption_extension = ".txt"
batch_size = 1
num_repeats = 1
enable_bucket = true
bucket_no_upscale = true

[[datasets]]
image_directory = "${images.replace(/\\/g, '/')}"
cache_directory = "${cache.replace(/\\/g, '/')}"
`

// Fizgig on this PC: the folder (Settings, else the usual places) with its venv and trainer.
export function findFizgig(folder, { home = process.env.USERPROFILE || process.env.HOME || '', platform = process.platform } = {}) {
  const py = (d) => (platform === 'win32' ? path.join(d, 'venv', 'Scripts', 'python.exe') : path.join(d, 'venv', 'bin', 'python'))
  const ok = (d) => d && fs.existsSync(path.join(d, 'src', 'fizgig', 'families', 'train.py')) && fs.existsSync(py(d))
  const tries = [folder, home && path.join(home, 'Fizgig'), platform === 'win32' && 'C:\\Fizgig', platform === 'win32' && 'D:\\Fizgig', home && path.join(home, 'fizgig')].filter(Boolean)
  const dir = tries.find(ok)
  return dir ? { dir, python: py(dir) } : null
}

// The H3 reference-to-video prompt for one talking clip.
export function talkPrompt({ who, talk, voice }) {
  return `subject_definitions: <Subject 1> is the person in <Picture 1> and <Picture 2>: ${who}.

retention_analysis: <Picture 1>: identity - keep this face and hair exactly. <Picture 2>: the same person in other clothes and light - identity only; the clothes and the place follow the description.${voice ? ' <Audio 1>: voice - keep this voice exactly.' : ''}

detailed_description: [Shot 1] Live-action, filmed on a smartphone held at arm's length, one continuous take. There is no writing anywhere in the picture. <Subject 1> is ${talk.scene}. <Subject 1> (S1) looks into the camera and says: <d>[English] ${talk.line}</d> Then <Subject 1> smiles and settles, lips closed.

overall_soundscape: ${talk.sound}. The voice is close and natural.

non_diegetic_music: N/A`
}

export class Trainings {
  // studio: the Studio service (renders, characters). onLog(line, trainingId) gets Modal's output.
  // shinobi (optional): Shinobi's engine, whose Python runs face likeness (rank).
  constructor({ dataDir, resourcesDir, studio, ffmpeg, ffprobe, onLog, onChange, shinobi = null, voices = null }) {
    this.shinobi = shinobi
    this.voices = voices
    this.dir = path.join(dataDir, 'trainings')
    this.dataDir = dataDir
    this.resourcesDir = resourcesDir
    this.studio = studio
    this.ffmpeg = ffmpeg
    this.ffprobe = ffprobe
    this.onChange = onChange || (() => {})
    this.active = null // the training whose Modal output is streaming
    this.runs = new Map() // training id -> running modal process promise
    this.localRuns = new Map() // training id -> the timer following a run on this PC
    this.onLog = onLog
    this.cloud = new Cloud({ dataDir, resourcesDir, onLog: (line) => this.line(line, onLog) })
  }

  // ---------- records ----------
  folder = (id) => path.join(this.dir, id)
  file = (id) => path.join(this.folder(id), 'training.json')
  list() {
    if (!fs.existsSync(this.dir)) return []
    return fs
      .readdirSync(this.dir)
      .map((d) => readJson(path.join(this.dir, d, 'training.json'), null))
      .filter(Boolean)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((t) => ({ id: t.id, name: t.name, trigger: t.trigger, step: this.stepOf(t), cover: t.face?.file || null, state: t.train?.state || null, characterId: t.characterId || null, updatedAt: t.updatedAt }))
  }
  get(id) {
    const t = readJson(this.file(id), null)
    if (!t) throw new Error(`No character training ${id}`)
    return t
  }
  write(t) {
    t.updatedAt = now()
    fs.mkdirSync(this.folder(t.id), { recursive: true })
    fs.writeFileSync(`${this.file(t.id)}.tmp`, JSON.stringify(t, null, 2))
    fs.renameSync(`${this.file(t.id)}.tmp`, this.file(t.id))
    this.onChange(t.id)
    return t
  }
  create({ name, who = 'a woman in her thirties' }) {
    if (!name?.trim()) throw new Error('Give the character a name.')
    const t = { id: randomUUID().slice(0, 8), name: name.trim(), trigger: suggestTrigger(name), who, face: null, consent: false, faceText: '', faceCandidates: [], stills: [], clips: [], voice: null, train: null, checkpoints: [], tests: [], characterId: null, createdAt: now() }
    t.projectId = this.studio.createProject(`Training · ${t.name}`, null, t.id).id
    return this.write(t)
  }
  // name, trigger, who, faceText, consent, voice ({path}), clips' lines: the fields a person edits directly.
  save(id, patch) {
    const t = this.get(id)
    for (const k of ['name', 'trigger', 'who', 'faceText', 'consent', 'voice']) if (patch[k] !== undefined) t[k] = patch[k]
    if (patch.trigger !== undefined && !/^[a-z0-9]{3,12}$/i.test(t.trigger)) throw new Error('The trigger word is 3-12 letters and numbers, made up so H3 has no idea what it means (like t3ss4).')
    return this.write(t)
  }
  remove(id) {
    fs.rmSync(this.folder(id), { recursive: true, force: true })
    return true
  }
  stepOf(t) {
    if (t.characterId) return 'done'
    if (t.train?.state === 'done') return 'pick'
    if (t.train) return 'train'
    if (t.stills.some((s) => s.pick != null || s.source === 'upload')) return 'clips'
    return 'design'
  }

  // Every unfinished render of a training, refreshed; then the record with each job's state and files.
  async refresh(id) {
    const t = this.get(id)
    const jobs = [...t.faceCandidates.map((c) => c.jobId), ...t.stills.flatMap((s) => s.candidates.map((c) => c.jobId)), ...t.clips.map((c) => c.jobId), ...t.tests.map((x) => x.jobId)].filter(Boolean)
    const state = {}
    for (const j of new Set(jobs)) {
      try {
        const r = await this.studio.refreshJob(j)
        state[j] = { status: r.status, outputs: r.outputs, error: r.error, progress: r.progress, queuePosition: r.queuePosition }
      } catch (err) {
        state[j] = { status: 'error', error: err.message, outputs: [] }
      }
    }
    // a finished clip render becomes the clip's file
    let filled = false
    for (const c of t.clips) {
      const out = !c.file && state[c.jobId]?.status === 'success' && state[c.jobId].outputs.find((o) => o.kind === 'preview')
      if (out) (c.file = { path: out.path, url: out.url, filename: out.filename }), (filled = true)
    }
    if (filled) this.write(t)
    return { ...t, jobs: state, estimate: this.estimateFor(t) }
  }

  // ---------- 1 design: Z-Image Turbo stills ----------
  async stillModels() {
    const [u, c, v, l] = await Promise.all(['UNETLoader', 'CLIPLoader', 'VAELoader', 'LoraLoaderModelOnly'].map((k) => this.studio.comfy.objectInfo(k)))
    const find = (opts, re) => (opts || []).find((o) => re.test(o.replace(/\\/g, '/').split('/').pop()))
    const m = {
      unet: find(comboOptions(u, 'UNETLoader', 'unet_name'), /^(z_image_turbo_(bf16|int8_convrot)|z image turbo_turbo)\.safetensors$/i),
      clip: find(comboOptions(c, 'CLIPLoader', 'clip_name'), /^qwen_3_4b(_fp8_mixed)?\.safetensors$/i),
      vae: find(comboOptions(v, 'VAELoader', 'vae_name'), /^ae\.safetensors$/i),
      lora: find(comboOptions(l, 'LoraLoaderModelOnly', 'lora_name'), /SmartphoneSnapshotPhotoReality_v8/i)
    }
    const missing = ['unet', 'clip', 'vae'].filter((k) => !m[k])
    if (missing.length) throw new Error('Designing a character needs Z-Image Turbo, its text encoder (qwen_3_4b) and VAE (ae). Download them on the Setup page, under "For designing characters".')
    return m
  }
  // Tess's still settings: euler / simple, 9 steps, cfg 1, AuraFlow shift 3, the Snapshot v8 LoRA at 1.0 when present.
  stillGraph(models, { prompt, seed, width = 832, height = 1216, prefix }) {
    const lora = !!models.lora
    const text = lora && !/amateur photo/i.test(prompt) ? `amateur photo, ${prompt}` : prompt
    const g = {
      1: { class_type: 'UNETLoader', inputs: { unet_name: models.unet, weight_dtype: 'default' } },
      2: { class_type: 'CLIPLoader', inputs: { clip_name: models.clip, type: 'lumina2', device: 'default' } },
      3: { class_type: 'VAELoader', inputs: { vae_name: models.vae } },
      5: { class_type: 'ModelSamplingAuraFlow', inputs: { model: lora ? ['4', 0] : ['1', 0], shift: 3 } },
      6: { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text } },
      7: { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['6', 0] } },
      8: { class_type: 'EmptySD3LatentImage', inputs: { width, height, batch_size: 1 } },
      9: { class_type: 'KSampler', inputs: { model: ['5', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['8', 0], seed, steps: 9, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: 1 } },
      10: { class_type: 'VAEDecode', inputs: { samples: ['9', 0], vae: ['3', 0] } },
      11: { class_type: 'SaveImage', inputs: { images: ['10', 0], filename_prefix: prefix } }
    }
    if (lora) g[4] = { class_type: 'LoraLoaderModelOnly', inputs: { model: ['1', 0], lora_name: models.lora, strength_model: 1 } }
    return g
  }
  async renderStill(t, models, { prompt, seed, tag }) {
    const graph = this.stillGraph(models, { prompt, seed, prefix: `IV Studio/characters/${slug(t.name)}_${t.id}/${tag}_${seed}` })
    const job = await this.studio.submitGraph({ kind: 'still', graph, projectId: t.projectId, plan: { images: true, request: { prompt, seed } }, name: `${slug(t.name)}_${tag}` })
    return job.id
  }

  // Four face candidates, each its own seed, from the face description.
  async designFaces(id, { faceText, who } = {}) {
    let t = this.save(id, { ...(faceText !== undefined && { faceText }), ...(who !== undefined && { who }) })
    if (!t.faceText.trim()) throw new Error('Describe the face first: age, face shape, hair, eyes, skin, anything distinctive.')
    const models = await this.stillModels()
    const base = Math.floor(Math.random() * 1e6) * 10
    const prompt = `${t.who}, ${t.faceText}, close-up portrait looking at the camera, soft natural window light, a plain wall behind, candid phone photo`
    const round = []
    for (let k = 0; k < 4; k++) round.push({ jobId: await this.renderStill(t, models, { prompt, seed: base + k, tag: 'face' }), seed: base + k })
    t = this.get(id)
    t.faceCandidates = [...round, ...t.faceCandidates].slice(0, 12)
    return this.write(t)
  }
  pickFace(id, { jobId, file }) {
    const t = this.get(id)
    const c = t.faceCandidates.find((x) => x.jobId === jobId)
    if (!c) throw new Error('That face candidate is gone.')
    t.face = { seed: c.seed, jobId, file }
    return this.write(t)
  }

  // The picked face's seed and description across every scene: four candidates each. Z-Image keeps only a
  // family resemblance from seed to seed (0.4-0.6 face similarity), so the person picks the closest; two
  // candidates left Theo's set with three scenes under 0.4.
  async designScenes(id, { scenes = SCENES } = {}) {
    const t = this.get(id)
    if (!t.face) throw new Error('Pick a face first.')
    const models = await this.stillModels()
    for (const [k, scene] of scenes.entries()) {
      const prompt = `${t.who}, ${t.faceText}, ${scene}, candid phone photo`
      const candidates = []
      for (const s of [0, 7, 14, 21].map((d) => t.face.seed + d)) candidates.push({ jobId: await this.renderStill(t, models, { prompt, seed: s, tag: `scene${k + 1}` }), seed: s })
      t.stills.push({ id: randomUUID().slice(0, 6), source: 'generated', scene, caption: `${t.trigger}, ${t.who}, ${scene}`, candidates, pick: null, file: null })
    }
    return this.write(t)
  }
  // Another two candidates for one scene (new seeds near the face's).
  async rerollStill(id, stillId) {
    const t = this.get(id)
    const s = t.stills.find((x) => x.id === stillId)
    if (!s || s.source !== 'generated') throw new Error('That still is gone.')
    const models = await this.stillModels()
    const prompt = `${t.who}, ${t.faceText}, ${s.scene}, candid phone photo`
    const n = s.candidates.length
    for (const k of [0, 1]) {
      const seed = t.face.seed + 13 * (n + k + 1)
      s.candidates.push({ jobId: await this.renderStill(t, models, { prompt, seed, tag: `scene_r${n + k}` }), seed })
    }
    return this.write(t)
  }
  // pick: a candidate index, or null to leave the scene out. file: that candidate's output (from refresh).
  pickStill(id, stillId, { pick, file = null }) {
    const t = this.get(id)
    const s = t.stills.find((x) => x.id === stillId)
    if (!s) throw new Error('That still is gone.')
    Object.assign(s, { pick, file: pick == null ? null : file })
    return this.write(t)
  }
  // The user's own pictures of the character (an invented person, or someone who agreed).
  addStills(id, paths, caption = '') {
    const t = this.get(id)
    if (!t.consent) throw new Error('Confirm the pictures are of an invented person, or of someone who agreed to this.')
    for (const p of paths) t.stills.push({ id: randomUUID().slice(0, 6), source: 'upload', scene: caption, caption: `${t.trigger}, ${t.who}${caption ? `, ${caption}` : ''}`, candidates: [], pick: 0, file: { path: p } })
    return this.write(t)
  }
  setCaption(id, kind, itemId, text) {
    const t = this.get(id)
    const item = (kind === 'still' ? t.stills : t.clips).find((x) => x.id === itemId)
    if (!item) throw new Error('That item is gone.')
    if (!text.startsWith(t.trigger)) text = `${t.trigger}, ${text}`
    item.caption = text
    return this.write(t)
  }
  removeItem(id, kind, itemId) {
    const t = this.get(id)
    if (kind === 'still') t.stills = t.stills.filter((x) => x.id !== itemId)
    else t.clips = t.clips.filter((x) => x.id !== itemId)
    return this.write(t)
  }

  // ---------- 2 clips: talking H3 clips, or the user's own ----------
  keptStills = (t) => t.stills.filter((s) => s.file && (s.pick != null || s.source === 'upload'))
  // The face references for clip k: the picked face close-up (or the first kept still) carries identity in
  // every clip; one kept still adds the person in other clothes and light. Rotating through scene stills alone
  // let a weak still make a weak clip (Theo, 2026-10-28: an office still at 0.29 likeness gave a clip at 0.12).
  async clipRefs(t) {
    const stills = this.keptStills(t)
    if (!t.face?.file && stills.length < 2) throw new Error('Pick a face, or keep at least two stills, first: the clips use them as the face.')
    if (!stills.length) throw new Error('Keep at least one still first.')
    const dir = path.join(this.folder(t.id), 'stills')
    const face = t.face?.file ? await this.studio.localCopy(t.face.file, dir) : await this.studio.localCopy(stills[0].file, dir)
    const others = await Promise.all(stills.map((s) => this.studio.localCopy(s.file, dir)))
    return (k) => [face, others[k % others.length]]
  }
  async renderClip(t, refs, talk, k, seed) {
    const [face, still] = refs(k)
    return this.studio.generatePreviews({
      projectId: t.projectId,
      mode: 'reference',
      character: 'none',
      prompt: talkPrompt({ who: t.who, talk, voice: !!t.voice?.path }),
      media: [{ kind: 'picture', file: face }, { kind: 'picture', file: still }, ...(t.voice?.path ? [{ kind: 'audio', file: t.voice.path }] : [])],
      aspect: k % 3 === 2 ? '9:16' : '16:9',
      megapixels: 0.3,
      seconds: 5,
      previews: 1,
      steps: 8,
      seed
    })
  }
  async makeClips(id, { talks = TALKS, seed = 7100 } = {}) {
    const t = this.get(id)
    const refs = await this.clipRefs(t)
    // The design stills leave Z-Image (about 20 GB) in ComfyUI's memory. With H3's 40 GB on top, a 64 GB PC
    // pages the offloaded part of H3 to disk and a 1-minute clip takes 20 (seen 2026-10-28), so drop it first.
    await this.studio.comfy.freeMemory().catch(() => {})
    for (const [k, talk] of talks.entries()) {
      const job = await this.renderClip(t, refs, talk, k, seed + k)
      t.clips.push({ id: randomUUID().slice(0, 6), source: 'generated', talk, index: k, seed: seed + k, caption: `${t.trigger}, ${t.who}, ${talk.scene}, talking to the camera, handheld phone video. (S1) says: <d>[English] ${talk.line}</d>`, jobId: job.id, keep: true, file: null })
    }
    return this.write(t)
  }
  // Renders a generated clip again (same scene and line, new seed, current references); the old take is dropped.
  async remakeClips(id, clipIds) {
    const t = this.get(id)
    const refs = await this.clipRefs(t)
    await this.studio.comfy.freeMemory().catch(() => {})
    for (const clipId of clipIds) {
      const c = t.clips.find((x) => x.id === clipId)
      if (!c || c.source !== 'generated') throw new Error('Only generated clips can be rendered again.')
      const k = c.index ?? TALKS.findIndex((x) => x.line === c.talk.line)
      c.seed = (c.seed ?? 7100 + k) + 1000
      c.jobId = (await this.renderClip(t, refs, c.talk, Math.max(0, k), c.seed)).id
      Object.assign(c, { file: null, keep: true })
    }
    return this.write(t)
  }
  keepClip(id, clipId, keep) {
    const t = this.get(id)
    const c = t.clips.find((x) => x.id === clipId)
    if (c) c.keep = !!keep
    return this.write(t)
  }
  addClips(id, paths, caption = '') {
    const t = this.get(id)
    if (!t.consent) throw new Error('Confirm the clips are of an invented person, or of someone who agreed to this.')
    for (const p of paths) t.clips.push({ id: randomUUID().slice(0, 6), source: 'upload', caption: `${t.trigger}, ${t.who}${caption ? `, ${caption}` : ''}`, keep: true, file: { path: p } })
    return this.write(t)
  }

  // ---------- likeness (InsightFace ArcFace through Shinobi's Python) ----------
  // Scores every rendered scene candidate and clip against the picked face; with pick, keeps the closest
  // candidate of each generated scene. Returns {stills: [{id, best, score}], clips: [{id, score}]}.
  async rank(id, { pick = false } = {}) {
    if (!this.shinobi) throw new Error('Likeness needs Shinobi’s engine.')
    const v = await this.refresh(id)
    if (!v.face?.file) throw new Error('Pick a face first: the stills and clips are compared with it.')
    const dir = path.join(this.folder(id), 'candidates')
    const ref = await this.studio.localCopy(v.face.file, dir)
    const items = [] // {file, set}
    for (const s of v.stills) {
      if (s.source === 'upload') items.push({ file: s.file.path, set: (score) => (s.score = score) })
      for (const c of s.candidates) {
        const out = v.jobs[c.jobId]?.outputs?.find((o) => o.kind === 'image')
        if (out) items.push({ file: await this.studio.localCopy(out, dir), set: (score) => (c.score = score) })
      }
    }
    for (const c of v.clips) if (c.file) items.push({ file: c.file.path ? c.file.path : await this.studio.localCopy(c.file, dir), set: (score) => (c.score = score) })
    const scores = await this.shinobi.likeness(ref, items.map((i) => i.file))
    scores.forEach((r, k) => items[k].set(r.score))
    const t = this.get(id)
    t.stills = v.stills.map((s) => {
      const keep = t.stills.find((x) => x.id === s.id) || s
      keep.score = s.score
      keep.candidates = s.candidates
      if (pick && s.source === 'generated') {
        const best = s.candidates.reduce((b, c, k) => (c.score != null && (b == null || c.score > s.candidates[b].score) ? k : b), null)
        if (best != null) Object.assign(keep, { pick: best, file: v.jobs[s.candidates[best].jobId].outputs.find((o) => o.kind === 'image') })
      }
      return keep
    })
    t.clips = t.clips.map((c) => ({ ...c, score: v.clips.find((x) => x.id === c.id)?.score ?? c.score }))
    t.rankedAt = new Date().toISOString()
    this.write(t)
    return {
      stills: t.stills.map((s) => ({ id: s.id, scene: s.scene, pick: s.pick, score: s.source === 'upload' ? s.score : s.candidates[s.pick]?.score ?? null, best: Math.max(...s.candidates.map((c) => c.score ?? -1), s.score ?? -1) })),
      clips: t.clips.map((c) => ({ id: c.id, score: c.score ?? null }))
    }
  }

  // ---------- the dataset (Fizgig's flat folder) ----------
  // One clip, or several back to back if it's long, on the frame grid at about 0.25 MP.
  async fitClip(src, outBase, maxParts = 3, pixels = 250000) {
    const info = await probe(this.ffprobe, src)
    if (info.kind !== 'video') throw new Error(`${path.basename(src)} isn't a video.`)
    const s = Math.sqrt(pixels / (info.width * info.height))
    const W = Math.max(256, Math.round((info.width * s) / 32) * 32)
    const H = Math.max(256, Math.round((info.height * s) / 32) * 32)
    let left = Math.floor(info.duration * 24 + 0.01)
    let at = 0
    const parts = []
    while (left >= 22 && parts.length < maxParts) {
      const frames = [...GRID].reverse().find((g) => g <= Math.min(124, left))
      const out = `${outBase}_${parts.length + 1}.mp4`
      const args = ['-y', '-hide_banner', '-loglevel', 'error', '-ss', (at / 24).toFixed(3), '-i', src, '-frames:v', String(frames), '-vf', `fps=24,scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setpts=N/(24*TB)`, '-c:v', 'libx264', '-preset', 'medium', '-crf', '14', '-pix_fmt', 'yuv420p']
      if (info.hasAudio) args.push('-af', 'aresample=32000,asetpts=PTS-STARTPTS', '-ac', '2', '-t', (frames / 24).toFixed(3), '-c:a', 'aac', '-b:a', '192k')
      else args.push('-an')
      await run(this.ffmpeg, [...args, out])
      parts.push({ file: out, frames, width: W, height: H })
      at += frames
      left -= frames
    }
    if (!parts.length) throw new Error(`${path.basename(src)} is under a second; clips need at least 22 frames.`)
    return parts
  }

  // Builds the dataset folder from the kept stills and clips; returns what's in it.
  async buildDataset(id, options) {
    const t = this.get(id)
    const o = trainOptions(options || t.train?.options)
    const dir = path.join(this.folder(id), 'dataset')
    fs.rmSync(dir, { recursive: true, force: true })
    fs.mkdirSync(dir, { recursive: true })
    const name = slug(t.name)
    let n = 0
    for (const s of this.keptStills(t)) {
      const src = await this.studio.localCopy(s.file, path.join(this.folder(id), 'stills'))
      const base = path.join(dir, `${name}_still_${String(++n).padStart(2, '0')}`)
      fs.copyFileSync(src, `${base}${path.extname(src).toLowerCase() || '.png'}`)
      fs.writeFileSync(`${base}.txt`, s.caption)
    }
    let c = 0
    for (const clip of o.learn === 'look' ? [] : t.clips.filter((x) => x.keep && x.file)) {
      const src = await this.studio.localCopy(clip.file, path.join(this.folder(id), 'clips'))
      for (const part of await this.fitClip(src, path.join(dir, `${name}_clip_${String(++c).padStart(2, '0')}`), 3, o.detail === 'fine' ? 500000 : 250000)) fs.writeFileSync(part.file.replace(/\.mp4$/, '.txt'), clip.caption)
    }
    const files = fs.readdirSync(dir)
    return { dir, stills: n, clips: files.filter((f) => f.endsWith('.mp4')).length, items: files.filter((f) => !f.endsWith('.txt')).length }
  }

  estimateFor(t, { gpu, epochs, options, more } = {}) {
    const o = trainOptions(options || t.train?.options)
    const list = trainGpus(o.where)
    const g = list.some((x) => x.id === gpu) ? gpu : list.some((x) => x.id === t.train?.gpu) ? t.train.gpu : o.where === 'modal' ? 'H200' : list[0].id
    // Fizgig trains each clip twice an epoch (Theo: 8 stills + 8 clips = 24 steps an epoch)
    const clips = o.learn === 'look' ? 0 : t.clips.filter((x) => x.keep && x.file).length
    const items = Math.round(this.keptStills(t).length + clips * 2)
    if (more) {
      const e = Math.max(1, Math.round(Number(more)))
      const est = estimate({ items, epochs: e, gpu: g, detail: o.detail, where: o.where, precision: o.precision })
      return { ...est, epochs: e, more: true, options: o, capped: !!(o.budget && est.dollars > o.budget) }
    }
    const e = Math.round(epochs || epochsFor(items, o))
    const est = estimate({ items, epochs: e, gpu: g, detail: o.detail, where: o.where, precision: o.precision })
    const presets = Object.fromEntries(
      Object.keys(TRAIN_PRESETS).map((k) => {
        const pe = epochsFor(items, { ...o, preset: k })
        const x = estimate({ items, epochs: pe, gpu: g, detail: o.detail, where: o.where, precision: o.precision })
        return [k, { epochs: pe, minutes: x.minutes, dollars: x.dollars }]
      })
    )
    return { ...est, epochs: e, items, options: o, rank: rankOf(o), checkpoints: Math.ceil(e / Math.max(1, Math.round(e / o.checkpoints))), presets, capped: !!(o.budget && est.dollars > o.budget) }
  }

  // ---------- 3 train on Modal ----------
  get trainDir() {
    return path.join(this.dataDir, 'cloud', 'train')
  }
  async modal(args, env = {}) {
    if (!this.cloud.toolkitReady()) throw new Error('Set up the cloud tools first (Cloud page, step 1).')
    await this.cloud.ensureCurrent()
    fs.mkdirSync(this.trainDir, { recursive: true })
    fs.copyFileSync(path.join(this.resourcesDir, 'cloud', 'train_app.py'), path.join(this.trainDir, 'train_app.py'))
    return this.cloud.exec(this.cloud.modalExe, args, { cwd: this.trainDir, env: { PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', MSYS_NO_PATHCONV: '1', ...env } })
  }
  setTrain(id, patch) {
    const t = this.get(id)
    t.train = { ...(t.train || {}), ...patch }
    return this.write(t)
  }
  // Runs every step from the dataset to the end of training; resolves when the run is over. The run keeps
  // going on Modal if IV Studio closes (--detach); checkTraining() picks it up again from the volume's log.
  // more: Train more, that many extra epochs on the last run, from its last saved state (same recipe and set).
  async startTraining(id, { gpu, epochs, options, more } = {}) {
    if (this.runs.size || this.localRunning()) throw new Error('A character is already training. One at a time.')
    const t = this.get(id)
    const where = trainOptions(more ? t.train?.options : options).where
    if (more && t.train?.where && t.train.where !== where) throw new Error('Train more runs where the run was trained.')
    if (where === 'modal' && !(await this.cloud.workspace())) throw new Error('Sign in to Modal on the Cloud page first (steps 1 and 2).')
    if (where === 'local') await this.localReady()
    if (where === 'runpod' && !this.runpod?.key?.()) throw new Error('Add your RunPod API key on the Cloud page first.')
    let resume = null
    if (more) {
      if (!t.train?.name || !['done', 'stopped', 'failed'].includes(t.train.state)) throw new Error('Train more carries on from a finished or stopped run; train once first.')
      resume = await this.lastState(id)
      if (!resume) throw new Error('That run has no saved state to carry on from. Train again instead.')
    }
    // Train more keeps the recipe (the rank has to match the saved state); only the budget can change
    const o = trainOptions(more ? { ...t.train.options, budget: options?.budget ?? t.train.options?.budget } : options)
    const est = this.estimateFor(t, { gpu, epochs, options: o, more })
    const total = more ? resume.epoch + est.epochs : est.epochs
    const runName = more ? t.train.name : `${slug(t.name)}_${t.id}_${(t.train?.run || 0) + 1}`
    const maxSeconds = budgetSeconds(o.budget, est.perHour)
    if (where === 'local') gpu = 'local'
    this.setTrain(id, { where, pid: null, unschedulable: null, appId: null, budgetHit: false, state: 'preparing', gpu: est.gpu, options: o, epochs: total, more: more ? { from: resume.epoch, extra: est.epochs } : null, run: more ? t.train.run : (t.train?.run || 0) + 1, name: runName, startedAt: now(), progress: null, error: null, estimate: est })
    if (where === 'local') return this.runLocal(id, { o, total, est, runName, resume, more })
    if (where === 'runpod') return this.runRunPod(id, { o, total, est, runName, resume, more, maxSeconds })
    const work = (async () => {
      this.active = id
      try {
        const root = path.join(this.folder(id), 'train')
        fs.mkdirSync(root, { recursive: true })
        const saveEvery = more ? t.train.saveEvery || Math.max(1, Math.round(total / o.checkpoints)) : Math.max(1, Math.round(est.epochs / o.checkpoints))
        fs.writeFileSync(path.join(root, 'train.sh'), trainScript({ name: runName, epochs: total, saveEvery, options: o, resume: resume?.dir, maxSeconds }).replace(/\r\n/g, '\n'))
        this.setTrain(id, { saveEvery })
        if (more) {
          // the set and its caches are already in storage
          this.setTrain(id, { state: 'uploading' })
          await this.modal(['volume', 'put', VOLUME, path.join(root, 'train.sh'), `/train/${runName}/train.sh`, '--force'])
        } else {
          const ds = await this.buildDataset(id, o)
          if (ds.stills < 4 || ds.items < 8) throw new Error(`The set is too small to learn a face (${ds.stills} stills, ${ds.clips} clips). Keep at least 4 stills and 8 items in all.`)
          fs.writeFileSync(path.join(root, 'dataset.toml'), datasetToml(runName, { detail: o.detail }))
          this.setTrain(id, { state: 'models', dataset: ds })
          await this.modal(['run', 'train_app.py::fetch_models'])
          this.setTrain(id, { state: 'uploading' })
          await this.modal(['volume', 'put', VOLUME, ds.dir, `/datasets/${runName}`, '--force'])
          for (const f of ['train.sh', 'dataset.toml']) await this.modal(['volume', 'put', VOLUME, path.join(root, f), `/train/${runName}/${f}`, '--force'])
        }
        this.setTrain(id, { state: 'training', trainingAt: now() })
        const watch = setInterval(() => this.checkScheduled(id).catch(() => {}), 3 * 60 * 1000)
        try {
          await this.modal(['run', '--detach', 'train_app.py::train', '--name', runName], { IV_TRAIN_GPU: gpu })
        } finally {
          clearInterval(watch)
        }
        this.setTrain(id, { state: 'done', finishedAt: now() })
        await this.listCheckpoints(id).catch(() => {})
      } catch (err) {
        const cur = this.get(id).train
        // the local client can drop (sleep, network) while Modal carries on: check the log before calling it failed
        if (cur?.state === 'training') await this.checkTraining(id).catch(() => {})
        const t = this.get(id).train
        if (t?.state !== 'done') this.setTrain(id, { state: 'failed', error: t?.unschedulable || err.message.split('\n').slice(-4).join(' ') })
      } finally {
        this.active = null
        this.runs.delete(id)
      }
    })()
    this.runs.set(id, work)
    return this.get(id)
  }
  // ---------- 3 train on this PC (Fizgig, free) ----------
  // Fizgig's own Python runs the same three commands as the cloud, from a small runner started on its own, so it
  // keeps going if IV Studio closes; IV Studio follows its log (train.log) and finds it again after a restart.
  fizgig() {
    return findFizgig(readSettings().fizgigFolder || '')
  }
  // The five model files, from this PC's ComfyUI model folders.
  async localFiles() {
    let folders = []
    try {
      folders = await fetch(`${this.studio.comfy.url}/experiment/models`, { headers: this.studio.comfy.headers() }).then((r) => r.json())
    } catch {
      throw new Error('Start ComfyUI first: IV Studio finds the H3 training files through its model folders.')
    }
    const dirs = [...new Set(folders.filter((x) => ['diffusion_models', 'unet', 'text_encoders', 'clip', 'vae', 'loras'].includes(x.name)).flatMap((x) => x.folders || []))].filter((d) => fs.existsSync(d))
    const want = new Map(Object.entries(MODEL_FILES).map(([k, n]) => [n, k]))
    const found = {}
    const walk = (dir, depth) => {
      if (depth > 3 || want.size === Object.keys(found).length) return
      let list = []
      try {
        list = fs.readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const e of list) {
        const p = path.join(dir, e.name)
        if (e.isFile() && want.has(e.name) && !found[want.get(e.name)]) found[want.get(e.name)] = p
        else if (e.isDirectory()) walk(p, depth + 1)
      }
    }
    for (const d of dirs) walk(d, 0)
    const missing = Object.entries(MODEL_FILES).filter(([k]) => !found[k]).map(([, n]) => n)
    return { files: found, missing }
  }
  async localReady() {
    if (!this.fizgig()) throw new Error('Fizgig isn’t on this computer. Install it (github.com/shootthesound/Fizgig), then pick its folder on the Train step, or train on Modal or RunPod.')
    const { missing } = await this.localFiles()
    if (missing.length) throw new Error(`These H3 training files aren’t in this computer’s ComfyUI: ${missing.join(', ')}. Get them on Setup, or train in the cloud.`)
  }
  localRunning() {
    return [...this.localRuns.values()].some(Boolean)
  }
  localRoot(t) {
    return path.join(this.folder(t.id), 'train', t.train.name)
  }
  async runLocal(id, { o, total, est, runName, resume, more }) {
    const fiz = this.fizgig()
    const { files } = await this.localFiles()
    const t = this.get(id)
    const root = path.join(this.folder(id), 'train', runName)
    fs.mkdirSync(path.join(root, 'loras'), { recursive: true })
    const fwd = (p) => p.replace(/\\/g, '/')
    const saveEvery = more ? t.train.saveEvery || Math.max(1, Math.round(total / o.checkpoints)) : Math.max(1, Math.round(est.epochs / o.checkpoints))
    this.setTrain(id, { saveEvery })
    if (!more) {
      const ds = await this.buildDataset(id, o)
      if (ds.stills < 4 || ds.items < 8) {
        this.setTrain(id, { state: 'failed', error: `The set is too small to learn a face (${ds.stills} stills, ${ds.clips} clips). Keep at least 4 stills and 8 items in all.` })
        return this.get(id)
      }
      fs.writeFileSync(path.join(root, 'dataset.toml'), datasetToml(runName, { detail: o.detail, images: ds.dir, cache: path.join(root, 'cache') }))
      this.setTrain(id, { dataset: ds })
    }
    const a = trainArgs({ name: runName, epochs: total, saveEvery, options: o, resume: resume?.dir, root: fwd(root), files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, fwd(v)])) })
    const cmds = more ? [a.train] : [a.latents, a.text, a.train]
    fs.writeFileSync(path.join(root, 'commands.json'), JSON.stringify(cmds, null, 1))
    fs.writeFileSync(path.join(root, 'runner.py'), LOCAL_RUNNER)
    const log = path.join(root, 'train.log')
    fs.appendFileSync(log, `\n[local] ${now()} ${more ? `train more: ${est.epochs} epochs from ${resume.epoch}` : 'start'}\n`)
    // room on the graphics card: ComfyUI's models and IV Studio's voice engine out first
    await this.studio.comfy.freeMemory?.().catch(() => {})
    await this.voices?.release?.().catch?.(() => {})
    const p = spawn(fiz.python, [path.join(root, 'runner.py'), path.join(root, 'commands.json'), log, fiz.dir], { cwd: fiz.dir, detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env, PYTHONPATH: path.join(fiz.dir, 'src'), PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' } })
    p.unref()
    this.setTrain(id, { state: 'training', trainingAt: now(), pid: p.pid, logAt: fs.statSync(log).size - Buffer.byteLength('x'.repeat(0)) })
    this.followLocal(id)
    return this.get(id)
  }
  pidAlive(pid) {
    if (!pid) return false
    try {
      process.kill(pid, 0)
      return true
    } catch (e) {
      return e.code === 'EPERM'
    }
  }
  // Reads new lines of a local run's log every two seconds: progress, the end, or the runner gone.
  followLocal(id) {
    if (this.localRuns.get(id)) return
    const t = this.get(id)
    const log = path.join(this.localRoot(t), 'train.log')
    let offset = 0
    let rest = ''
    const tick = () => {
      const cur = this.get(id).train
      let text = ''
      try {
        const size = fs.statSync(log).size
        if (size > offset) {
          const fd = fs.openSync(log, 'r')
          const buf = Buffer.alloc(size - offset)
          fs.readSync(fd, buf, 0, buf.length, offset)
          fs.closeSync(fd)
          offset = size
          text = buf.toString('utf8')
        }
      } catch {}
      if (text) {
        const parts = (rest + text).split(/\r\n|\r|\n/)
        rest = parts.pop()
        this.active = id
        for (const l of parts) if (l.trim()) this.line(l, this.onLog)
      }
      const done = /\[local\] TRAINING DONE/.test(text)
      const failed = /\[local\] command failed/.test(text)
      if (done || failed || !this.pidAlive(cur.pid)) {
        clearInterval(timer)
        this.localRuns.delete(id)
        this.active = null
        const all = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : ''
        const tail = all.slice(all.lastIndexOf('[local] ') - 1)
        if (/TRAINING DONE/.test(tail)) this.setTrain(id, { state: 'done', finishedAt: now(), error: null, pid: null })
        else if (this.get(id).train.state !== 'stopped') {
          const why = (all.match(/(Error|error|Traceback)[^\n]*\n?[^\n]*/g) || []).pop()
          this.setTrain(id, { state: 'failed', pid: null, error: `Training stopped${why ? `: ${why.trim().slice(0, 300)}` : ''}. The log is in the training folder.` })
        }
        this.listCheckpoints(id).catch(() => {})
      }
    }
    // from the start of this run's part of the log (the marker written at start)
    try {
      const all = fs.readFileSync(log, 'utf8')
      offset = Buffer.byteLength(all.slice(0, all.lastIndexOf('[local] ') - 1))
    } catch {}
    const timer = setInterval(tick, 2000)
    this.localRuns.set(id, timer)
    tick()
  }

  // ---------- 3 train on RunPod (the user's own account) ----------
  // A pod from Fizgig's image with the iv-studio-train volume runs resources/cloud/runpod_train.py: IV Studio
  // uploads the set and train.sh through it, starts the run and follows its log. The pod deletes itself half an
  // hour after the run ends; the checkpoints stay on the volume, and a later download starts a small pod to serve them.
  rp() {
    if (!this.runpod) throw new Error('RunPod isn’t available here.')
    return this.runpod
  }
  async trainVolume(gpu) {
    const rp = this.rp()
    const vols = RunPod.list(await rp.req('/network-volumes'), 'networkVolumes', 'items', 'data')
    const have = vols.find((v) => v.name === VOLUME)
    if (have) return have
    const dc = await rp.pickDataCenter(gpu)
    this.onLog?.(`Creating your ${RP_VOLUME_GB} GB training volume "${VOLUME}" in ${dc}…`)
    return rp.req('/network-volumes', { method: 'POST', json: { name: VOLUME, size: RP_VOLUME_GB, dataCenter: dc } })
  }
  // mode 'train' (the chosen GPU, else the next free one in the volume's data center) or 'serve' (the cheapest, to hand over files)
  async trainPod({ gpu, runName, mode = 'train' }) {
    const rp = this.rp()
    const vol = await this.trainVolume(gpu || RUNPOD_TRAIN_GPUS[0].id)
    const token = (randomUUID() + randomUUID()).replace(/-/g, '')
    const order = mode === 'serve' ? [...RENDER_GPUS].sort((a, b) => a.perHour - b.perHour).map((g) => g.id) : [gpu, ...RUNPOD_TRAIN_GPUS.map((g) => g.id).filter((x) => x !== gpu)]
    const bundle = rp.bundle(['runpod_train.py'])
    let last
    for (const g of order) {
      try {
        const pod = await rp.req('/pods', {
          method: 'POST',
          json: {
            name: `${RP_PREFIX}-${mode}-${Date.now().toString(36)}`,
            image: RP_IMAGE,
            cloud: 'SECURE',
            gpu: { id: g, count: 1, minCudaVersion: '12.8' },
            dataCenterIds: [vol.dataCenter],
            disk: 60,
            mounts: { network: [{ volumeId: vol.id, path: '/workspace' }] },
            ports: ['8189/http'],
            env: { IV_TOKEN: token, IV_RUN: runName, IV_MODE: mode, IV_IDLE_SECONDS: mode === 'serve' ? '300' : '1800', IV_BUNDLE: bundle },
            entrypoint: ['bash', '-c'],
            cmd: ['mkdir -p /opt/iv && echo "$IV_BUNDLE" | base64 -d | tar -xz -C /opt/iv && exec python3 /opt/iv/runpod_train.py']
          }
        })
        if (mode === 'train' && g !== gpu) this.onLog?.(`${gpu} was taken in ${vol.dataCenter}; started a ${g} instead.`)
        return { id: pod.id, url: RunPod.url(pod.id), token, gpu: g, perHour: pod.cost, dataCenter: vol.dataCenter, volumeId: vol.id, mode }
      } catch (err) {
        last = err
        if (!(err.status >= 400 && err.status < 500 && /capacity|available|no (gpu|machine|instance)|stock|resources/i.test(err.message))) throw err
      }
    }
    throw new Error(`No GPU for training is free in ${vol.dataCenter} right now. Try again in a few minutes. (${last?.message})`)
  }
  async podHealth(pod) {
    try {
      const r = await this.rp().fetch(`${pod.url}/iv/health`, { signal: AbortSignal.timeout(15000) })
      if (!r.ok) return null
      const h = await r.json()
      return h?.gate === 'ok' ? h : null
    } catch {
      return null
    }
  }
  async podCall(pod, route, { method = 'GET' } = {}) {
    const r = await this.rp().fetch(`${pod.url}${route}`, { method, headers: { Authorization: `Bearer ${pod.token}` } })
    if (!r.ok) throw new Error(`The training pod said ${r.status}: ${(await r.text()).slice(0, 200)}`)
    return r.json()
  }
  async waitPod(pod, minutes = 20) {
    const t0 = Date.now()
    for (;;) {
      const h = await this.podHealth(pod)
      if (h) return h
      if (Date.now() - t0 > minutes * 60000) throw new Error('The RunPod GPU took too long to start.')
      await new Promise((r) => setTimeout(r, 5000))
    }
  }
  async runRunPod(id, { o, total, est, runName, resume, more, maxSeconds }) {
    const t = this.get(id)
    const work = (async () => {
      this.active = id
      try {
        const saveEvery = more ? t.train.saveEvery || Math.max(1, Math.round(total / o.checkpoints)) : Math.max(1, Math.round(est.epochs / o.checkpoints))
        this.setTrain(id, { saveEvery })
        let ds = null
        if (!more) {
          ds = await this.buildDataset(id, o)
          if (ds.stills < 4 || ds.items < 8) throw new Error(`The set is too small to learn a face (${ds.stills} stills, ${ds.clips} clips). Keep at least 4 stills and 8 items in all.`)
        }
        const pod = await this.trainPod({ gpu: est.gpu, runName })
        this.setTrain(id, { pod, gpu: pod.gpu, dataset: ds || t.train.dataset })
        await this.waitPod(pod)
        this.setTrain(id, { state: 'uploading' })
        const local = path.join(this.folder(id), 'train', runName)
        fs.mkdirSync(local, { recursive: true })
        fs.writeFileSync(path.join(local, 'train.sh'), trainScript({ name: runName, epochs: total, saveEvery, options: o, resume: resume?.dir, maxSeconds, base: '/workspace' }).replace(/\r\n/g, '\n'))
        const up = (file, rel) => this.rp().uploadModel(pod.url, pod.token, file, rel)
        if (!more) {
          fs.writeFileSync(path.join(local, 'dataset.toml'), datasetToml(runName, { detail: o.detail, images: `/workspace/datasets/${runName}`, cache: `/workspace/train/${runName}/cache` }))
          for (const f of fs.readdirSync(ds.dir)) await up(path.join(ds.dir, f), `datasets/${runName}/${f}`)
          await up(path.join(local, 'dataset.toml'), `train/${runName}/dataset.toml`)
        }
        await up(path.join(local, 'train.sh'), `train/${runName}/train.sh`)
        await this.podCall(pod, '/iv/start', { method: 'POST' })
        this.setTrain(id, { state: 'training', trainingAt: now() })
        await this.followRunPod(id)
      } catch (err) {
        if (!['done', 'stopped'].includes(this.get(id).train?.state)) this.setTrain(id, { state: 'failed', error: err.message.split('\n').slice(-3).join(' ') })
      } finally {
        this.active = null
        this.runs.delete(id)
      }
    })()
    this.runs.set(id, work)
    return this.get(id)
  }
  // Follows the pod: its stage, and the log (progress) from where it got to.
  async followRunPod(id) {
    let offset = 0
    let rest = ''
    let lost = 0
    for (;;) {
      const t = this.get(id)
      const pod = t.train.pod
      if (!pod || t.train.state === 'stopped') return
      const h = await this.podHealth(pod)
      if (!h) {
        if (++lost > 36) throw new Error('Lost touch with the RunPod GPU. Open this character again to check on it.')
      } else {
        lost = 0
        try {
          const l = await this.podCall(pod, `/iv/log?offset=${offset}`)
          offset = l.offset
          const parts = (rest + l.text).split(/\r\n|\r|\n/)
          rest = parts.pop()
          this.active = id
          for (const x of parts) if (x.trim()) this.line(x, this.onLog)
        } catch {}
        if (h.stage === 'setup' || h.stage === 'models') this.get(id).train.state !== 'models' && this.setTrain(id, { state: 'models', podDetail: h.detail })
        else if (h.stage === 'training' && this.get(id).train.state !== 'training') this.setTrain(id, { state: 'training' })
        if (h.stage === 'done') {
          this.setTrain(id, { state: 'done', finishedAt: now(), error: null })
          await this.listCheckpoints(id).catch(() => {})
          return
        }
        if (h.stage === 'failed') throw new Error(h.detail || 'Training stopped with an error.')
        if (h.stage === 'stopped') return this.setTrain(id, { state: 'stopped' })
      }
      await new Promise((r) => setTimeout(r, 5000))
    }
  }
  async checkRunPod(id) {
    const t = this.get(id)
    if (this.runs.has(id) || !['preparing', 'models', 'uploading', 'training'].includes(t.train?.state) || !t.train.pod) return t
    if (await this.podHealth(t.train.pod)) {
      const work = this.followRunPod(id)
        .catch((err) => this.setTrain(id, { state: 'failed', error: err.message }))
        .finally(() => this.runs.delete(id))
      this.runs.set(id, work)
    }
    return this.get(id)
  }
  async stopRunPod(id) {
    const t = this.get(id)
    const pod = t.train?.pod
    this.setTrain(id, { state: 'stopped' })
    if (pod) {
      await this.podCall(pod, '/iv/stop', { method: 'POST' }).catch(() => {})
      await this.rp().req(`/pods/${pod.id}`, { method: 'DELETE' }).catch(() => {})
    }
    return this.get(id)
  }
  // The training pod while it's up, else a small pod started just to hand over files (it removes itself).
  async filePod(id) {
    const t = this.get(id)
    for (const p of [t.train?.pod, t.train?.filePod].filter(Boolean)) if (await this.podHealth(p)) return p
    this.onLog?.('Starting a small RunPod GPU to fetch the checkpoints (a few cents; it removes itself)…')
    const pod = await this.trainPod({ runName: t.train.name, mode: 'serve' })
    this.setTrain(id, { filePod: pod })
    await this.waitPod(pod)
    return pod
  }
  async runpodList(id) {
    const t = this.get(id)
    const pod = await this.filePod(id)
    return (await this.podCall(pod, `/iv/list?path=${encodeURIComponent(`train/${t.train.name}/loras`)}`)).names
  }
  async runpodDownload(id, rel, to) {
    const t = this.get(id)
    const pod = await this.filePod(id)
    const r = await this.rp().fetch(`${pod.url}/iv/file?path=${encodeURIComponent(`train/${t.train.name}/${rel}`)}`, { headers: { Authorization: `Bearer ${pod.token}` } })
    if (!r.ok || !r.body) throw new Error(`Downloading ${path.basename(rel)} failed (${r.status}).`)
    const part = `${to}.part`
    await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(part))
    fs.renameSync(part, to)
  }

  // While a run shows no progress, Modal's app log says whether it is still waiting for a GPU it can't get.
  async checkScheduled(id) {
    const t = this.get(id).train
    if (t?.state !== 'training' || t.progress?.stage || !t.appId) return
    const logs = await new Promise((resolve) => {
      const p = spawn(this.cloud.modalExe, ['app', 'logs', t.appId], { cwd: this.trainDir, env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }, windowsHide: true })
      let out = ''
      p.stdout.on('data', (d) => (out += d))
      p.stderr.on('data', (d) => (out += d))
      setTimeout(() => p.kill(), 20000)
      p.on('close', () => resolve(out))
    })
    const m = UNSCHEDULABLE.exec(logs.replace(/\s+/g, ' '))
    if (!m) return
    const why = m[3] ? `Modal doesn't offer a ${m[1]} on your ${m[3]} plan` : `Your Modal workspace can't get a ${m[1]} right now`
    this.setTrain(id, { unschedulable: `${why}, so the run never started and cost nothing. Choose another GPU (H200 or H100) and train again.` })
    await this.modal(['app', 'stop', t.appId, '--yes']).catch(() => {})
  }
  // Modal's output, line by line: progress for the running training, and the log for the window.
  line(text, onLog) {
    const id = this.active
    onLog?.(text, id)
    if (!id) return
    const app = /modal\.com\/apps\/[^/\s]+\/[^/\s]+\/(ap-\w+)/.exec(text)
    if (app && this.get(id).train?.state === 'training' && !this.get(id).train.appId) this.setTrain(id, { appId: app[1] })
    if (/BUDGET REACHED/.test(text)) this.setTrain(id, { budgetHit: true })
    const m = /epoch (\d+)\/(\d+).*?step=(\d+)/.exec(text)
    const steps = /\|\s*(\d+)\/(\d+) \[/.exec(text)
    const stage = /Encoding dataset|latent cache/i.test(text) ? 'caching' : /stage text/i.test(text) ? 'captions' : null
    if (m || stage) {
      const t = this.get(id)
      const p = { ...(t.train?.progress || {}), at: now() }
      if (m) Object.assign(p, { epoch: Number(m[1]), epochs: Number(m[2]), step: Number(m[3]), stage: 'training' })
      else if (stage && p.stage !== 'training') p.stage = stage
      if (steps) p.steps = Number(steps[2])
      if (!this.lastWrite || Date.now() - this.lastWrite > 4000 || m?.[1] === m?.[2]) {
        this.lastWrite = Date.now()
        this.setTrain(id, { progress: p })
      }
    }
  }
  // After a restart, or when the local client lost the stream: read the run's log from the volume.
  async checkTraining(id) {
    const t = this.get(id)
    if (t.train?.where === 'local') {
      if (t.train.state === 'training' && this.pidAlive(t.train.pid)) this.followLocal(id)
      else if (t.train.state === 'training') this.followLocal(id) // finds the end in the log
      return this.get(id)
    }
    if (t.train?.where === 'runpod') return this.checkRunPod(id)
    if (!t.train?.name || this.runs.has(id)) return t
    const tmp = path.join(this.folder(id), 'train', 'train.log')
    fs.rmSync(tmp, { force: true })
    try {
      await this.modal(['volume', 'get', VOLUME, `/train/${t.train.name}/train.log`, tmp, '--force'])
    } catch {
      return t
    }
    const log = fs.readFileSync(tmp, 'utf8')
    const last = [...log.matchAll(/epoch (\d+)\/(\d+).*?step=(\d+)/g)].pop()
    const patch = last ? { progress: { epoch: Number(last[1]), epochs: Number(last[2]), step: Number(last[3]), stage: 'training', at: now() } } : {}
    if (/TRAINING DONE/.test(log)) Object.assign(patch, { state: 'done', finishedAt: t.train.finishedAt || now(), error: null })
    if (/BUDGET REACHED/.test(log)) patch.budgetHit = true
    else if (/command failed|Traceback/.test(log) && /\[modal\] finished/.test(log)) Object.assign(patch, { state: 'failed', error: 'Training stopped with an error; the log is in the training folder.' })
    this.setTrain(id, patch)
    if (patch.state === 'done') await this.listCheckpoints(id).catch(() => {})
    return this.get(id)
  }
  // Stops the training app on Modal (the GPU stops billing at once). Saved epochs stay in storage.
  async stopTraining(id) {
    const tt = this.get(id).train
    if (tt?.where === 'local') {
      if (tt.pid) await new Promise((r) => spawn('taskkill', ['/PID', String(tt.pid), '/T', '/F'], { windowsHide: true }).on('close', r).on('error', r))
      this.setTrain(id, { state: 'stopped', pid: null })
      return this.get(id)
    }
    if (tt?.where === 'runpod') return this.stopRunPod(id)
    await this.modal(['app', 'stop', 'iv-studio-train', '--yes'])
    this.setTrain(id, { state: 'stopped' })
    return this.get(id)
  }

  // ---------- 4 pick ----------
  async lastState(id) {
    const t = this.get(id)
    if (t.train?.where === 'local' || t.train?.where === 'runpod') {
      const names = t.train.where === 'local' ? (fs.existsSync(path.join(this.localRoot(t), 'loras')) ? fs.readdirSync(path.join(this.localRoot(t), 'loras')) : []) : await this.runpodList(id)
      return names.map((n) => ({ dir: n, m: /-(\d{6})-state$/.exec(n) })).filter((x) => x.m).map((x) => ({ dir: x.dir, epoch: Number(x.m[1]) })).sort((a, b) => b.epoch - a.epoch)[0] || null
    }
    const out = await this.modal(['volume', 'ls', VOLUME, `/train/${t.train.name}/loras`, '--json'])
    const rows = JSON.parse(out.slice(out.indexOf('[')))
    const states = rows
      .map((r) => path.posix.basename(r.Filename || r.filename || r.path || ''))
      .map((n) => ({ dir: n, m: /-(\d{6})-state$/.exec(n) }))
      .filter((x) => x.m)
      .map((x) => ({ dir: x.dir, epoch: Number(x.m[1]) }))
      .sort((a, b) => b.epoch - a.epoch)
    return states[0] || null
  }
  // Likeness of each tested checkpoint (InsightFace, three frames of its test against the picked face): the
  // highest is marked best. A guide, not a verdict: watch them too.
  async scoreCheckpoints(id) {
    if (!this.shinobi) throw new Error('Likeness needs Shinobi’s engine.')
    const v = await this.refresh(id)
    if (!v.face?.file) throw new Error('This character has no picked face to compare with.')
    const dir = path.join(this.folder(id), 'candidates')
    const ref = await this.studio.localCopy(v.face.file, dir)
    const items = []
    for (const x of v.tests) {
      const out = v.jobs[x.jobId]?.status === 'success' && v.jobs[x.jobId].outputs.find((o) => o.kind === 'preview' || /\.(mp4|webm|mov)$/i.test(o.filename || o.path || ''))
      if (out) items.push({ epoch: x.epoch, file: await this.studio.localCopy(out, dir) })
    }
    if (!items.length) throw new Error('Render the tests first: the scores come from them.')
    const scores = await this.shinobi.likeness(ref, items.map((i) => i.file))
    const t = this.get(id)
    scores.forEach((r, k) => {
      const test = t.tests.find((x) => x.epoch === items[k].epoch)
      if (test) test.score = r.score ?? null
    })
    const best = t.tests.filter((x) => x.score != null).sort((a, b) => b.score - a.score)[0]
    t.bestEpoch = best ? best.epoch : null
    t.scoredAt = now()
    return this.write(t)
  }
  async listCheckpoints(id) {
    const t = this.get(id)
    if (t.train?.where === 'local' || t.train?.where === 'runpod') {
      const names = t.train.where === 'local' ? (fs.existsSync(path.join(this.localRoot(t), 'loras')) ? fs.readdirSync(path.join(this.localRoot(t), 'loras')) : []) : await this.runpodList(id)
      t.checkpoints = names.filter((f) => /-\d{6}\.safetensors$/.test(f)).map((f) => ({ file: f, epoch: Number(f.match(/-(\d{6})\.safetensors$/)[1]), lora: t.checkpoints?.find((c) => c.file === f)?.lora || null })).sort((a, b) => a.epoch - b.epoch)
      return this.write(t)
    }
    const out = await this.modal(['volume', 'ls', VOLUME, `/train/${t.train.name}/loras`, '--json'])
    const rows = JSON.parse(out.slice(out.indexOf('[')))
    const files = rows.map((r) => r.Filename || r.filename || r.path).filter((f) => /-\d{6}\.safetensors$/.test(f)).map((f) => path.posix.basename(f))
    const t2 = this.get(id)
    t2.checkpoints = files.map((f) => ({ file: f, epoch: Number(f.match(/-(\d{6})\.safetensors$/)[1]), lora: t2.checkpoints?.find((c) => c.file === f)?.lora || null })).sort((a, b) => a.epoch - b.epoch)
    return this.write(t2)
  }
  // The LoRA folder of the local ComfyUI, where checkpoints are saved under MiniMax H3\<name>\.
  async loraDir(t) {
    const root = await this.studio.loraRoot()
    return { dir: path.join(root, 'MiniMax H3', slug(t.name)), rel: `MiniMax H3\\${slug(t.name)}` }
  }
  // Downloads the chosen epochs (about 150 MB each) next to the other character LoRAs.
  async fetchCheckpoints(id, epochs) {
    const t = this.get(id)
    const { dir, rel } = await this.loraDir(t)
    fs.mkdirSync(dir, { recursive: true })
    if (t.train?.where === 'local' || t.train?.where === 'runpod') {
      for (const c of t.checkpoints.filter((x) => epochs.includes(x.epoch))) {
        const to = path.join(dir, c.file)
        if (!fs.existsSync(to)) {
          if (t.train.where === 'local') fs.copyFileSync(path.join(this.localRoot(t), 'loras', c.file), to)
          else await this.runpodDownload(id, `loras/${c.file}`, to)
        }
        c.lora = `${rel}\\${c.file}`
      }
      return this.write(t)
    }
    for (const c of t.checkpoints.filter((x) => epochs.includes(x.epoch))) {
      if (!fs.existsSync(path.join(dir, c.file))) await this.modal(['volume', 'get', VOLUME, `/train/${t.train.name}/loras/${c.file}`, path.join(dir, c.file), '--force'])
      c.lora = `${rel}\\${c.file}`
    }
    return this.write(t)
  }
  // The same talking close-up and seed for every downloaded checkpoint, at preview size.
  async testCheckpoints(id, { epochs, prompt, seed = 4242 } = {}) {
    const t = this.get(id)
    const ready = t.checkpoints.filter((c) => c.lora && (!epochs || epochs.includes(c.epoch)))
    if (!ready.length) throw new Error('Download some checkpoints first.')
    const text = prompt || `integrated_multimodal_description: [Shot 1] Live-action, filmed on a smartphone. There is no writing anywhere in the picture. A medium close-up of {char}, ${t.who}, wearing a blue denim jacket, standing on a quiet street at golden hour. The camera is handheld, a gentle sway. {char} (S1) smiles at the camera and says: <d>[English] So this is me. What do you think?</d>\n\noverall_soundscape: A quiet street, distant traffic. The voice is close and natural.\n\nnon_diegetic_music: N/A`
    for (const c of ready) {
      const job = await this.studio.generatePreviews({ projectId: t.projectId, mode: 'text', prompt: text, previews: 1, megapixels: 0.4, seconds: 5, steps: 8, seed, aspect: '16:9', characterOverride: { id: `trial_${t.id}_${c.epoch}`, name: t.name, lora: c.lora, strength: 0.8, trigger: t.trigger } })
      t.tests = [...t.tests.filter((x) => x.epoch !== c.epoch), { epoch: c.epoch, jobId: job.id, seed }]
    }
    return this.write(t)
  }
  // The chosen checkpoint becomes a character preset (Create, Sequences, MCP), with the picked face as its picture.
  async adopt(id, epoch) {
    const t = this.get(id)
    const c = t.checkpoints.find((x) => x.epoch === epoch && x.lora)
    if (!c) throw new Error('Download that checkpoint first.')
    const charId = slug(t.name).replace(/_/g, '-')
    const picture = t.face?.file ? await this.studio.localCopy(t.face.file, path.join(this.folder(id), 'stills')).catch(() => null) : null
    const old = this.studio.characters().find((x) => x.id === charId)
    // the voice the clips were made with becomes the character's voice (Audio > Voices), once
    let voiceId = old?.voiceId || null
    if (!voiceId && this.voices && t.voice?.path && fs.existsSync(t.voice.path)) voiceId = (await this.voices.create({ name: t.name, file: t.voice.path, kind: 'designed', description: `The voice ${t.name}'s LoRA was trained with.` }).catch(() => null))?.id || null
    const list = this.studio.characters().filter((x) => x.id !== charId)
    this.studio.saveCharacters([...list, { ...old, id: charId, name: t.name, lora: c.lora, strength: 0.8, trigger: t.trigger, ...(picture && { picture }), ...(voiceId && { voiceId }) }])
    t.characterId = charId
    t.chosenEpoch = epoch
    return this.write(t)
  }
}

// Runs Fizgig's commands one after another into the log; writes the end marker IV Studio looks for.
const LOCAL_RUNNER = `import json, os, subprocess, sys
cmds = json.load(open(sys.argv[1], encoding="utf-8"))
log = open(sys.argv[2], "a", encoding="utf-8", buffering=1)
for c in cmds:
    log.write("$ " + " ".join(c) + "\\n")
    code = subprocess.Popen([sys.executable] + c, cwd=sys.argv[3], stdout=log, stderr=subprocess.STDOUT).wait()
    if code:
        log.write(f"[local] command failed ({code})\\n")
        sys.exit(code)
log.write("[local] TRAINING DONE\\n")
`

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true })
    let err = ''
    p.stderr.on('data', (d) => (err += d))
    p.on('error', reject)
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.trim().split('\n').pop() || `${path.basename(cmd)} failed`))))
  })
}
