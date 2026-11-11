// Reviews one take against its brief, the last step of Matthew Hollis's directing method (directing.js): a writer
// looks at frames from the take (and what Whisper heard, when the take was ranked), names each problem with the
// stretch it happens in, says what worked, and picks the fix: revise the prompt, change a reference, split the
// action, use a clean stretch or solve it in the edit. A revised prompt goes through the prompt checker and back
// to Create as "Edit and run again". Saved on the job as job.reviews[candidate].
//   The reviewer sees the shot's earlier reviews: a problem that came back after the prompt was revised is an H3
//   habit that more words won't move, so it's marked "again" and the fix moves on from rewriting. The words are
//   heard with Whisper (the ranking's, or the voice engine's); without either they're left alone.
//   Claude Code / Codex see the frames as files (harness.js); the local writer sees them through Ollama when its
//   model has vision. Context IR can't review, so it falls back to the local writer.
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import { DIRECTING, DIRECTING_SOURCE } from './directing.js'
import { harnessJson } from './harness.js'
import { lintPrompt } from './lint.js'
import { cleanPrompt, localChat, localWriterModel, normalizeDialogue } from './prompter.js'
import { spokenLines } from './ranking.js'

export const ISSUE_KINDS = ['identity', 'wardrobe', 'logo', 'anatomy', 'contact', 'space', 'order', 'emotion', 'words', 'sound', 'other']
export const FIX_KINDS = ['none', 'revise_prompt', 'change_reference', 'split_action', 'clean_stretch', 'edit']
export const FIX_WORDS = {
  none: 'Use it as it is',
  revise_prompt: 'Revise the prompt',
  change_reference: 'Change a reference',
  split_action: 'Split the action into shots',
  clean_stretch: 'Use the clean stretch',
  edit: 'Solve it in the edit'
}
const FRAMES = 6

export function reviewSchema() {
  const text = { type: 'string' }
  return {
    type: 'object',
    properties: {
      verdict: { type: 'string', enum: ['usable', 'usable_with_fixes', 'redo'] },
      works: { type: 'array', items: text, maxItems: 5 },
      issues: {
        type: 'array',
        maxItems: 6,
        items: {
          type: 'object',
          properties: { from: { type: 'number' }, to: { type: 'number' }, kind: { type: 'string', enum: ISSUE_KINDS }, what: text, unmet: { type: 'boolean' } },
          required: ['from', 'to', 'kind', 'what', 'unmet']
        }
      },
      fix: {
        type: 'object',
        properties: { kind: { type: 'string', enum: FIX_KINDS }, why: text, clean_from: { type: 'number' }, clean_to: { type: 'number' } },
        required: ['kind', 'why', 'clean_from', 'clean_to']
      },
      revised_prompt: text
    },
    required: ['verdict', 'works', 'issues', 'fix', 'revised_prompt']
  }
}

const SHORT = `- Check what the brief asks for against what the frames show: identity, wardrobe and logos, anatomy (hands, faces), contact with objects, who stands where and faces which way, the order of the actions, whether the feeling reads, and the spoken words.
- Name each problem with the seconds it happens in (from, to). unmet is true when the brief already asked for the thing the take got wrong: that's an instruction the model didn't follow, not a missing phrase.
- Say what works, so a revision keeps it.
- Pick ONE fix: none (the take is good), revise_prompt, change_reference, split_action (too much for one shot), clean_stretch (a usable part: give clean_from and clean_to), or edit (solve it in the edit). Use 0 for clean_from and clean_to unless the fix is clean_stretch.
- revised_prompt: when the fix is revise_prompt, the whole prompt again in the same H3 format as the brief, keeping everything that works and changing only what fixes the problems; otherwise "". Don't add dialogue, people, props or camera moves to make it longer.
- Earlier reviews of this shot, when given, say how each run was made and what went wrong. A problem that came back after the prompt was revised is a habit of the model that more words won't move: don't pick revise_prompt for it again. Pick change_reference (start from a picture that already shows it, such as a first frame with the right eyeline or pose), split_action, clean_stretch or edit, and say which in why. If it also came back after the references changed, don't pick change_reference either.
- When you aren't told what was heard, you can't hear the take: leave the spoken words alone unless the frames show a problem, such as a closed mouth through the line.`

export function reviewSystem({ full = false } = {}) {
  return `You review one take from MiniMax H3 (a model that makes short videos with sound) against the prompt it was made from, as a practical director would. You see frames from the take at the times given. Answer with JSON only, in the shape you are given. Write in plain English, briefly.
${SHORT}${full ? `\n\nTHE DIRECTING METHOD\n${DIRECTING_SOURCE}. Review the take as its "Inspect, revise and assemble" part says.\n\n${DIRECTING}` : ''}`
}

// How a run was made, in words: its mode and references ("Text mode", "Frames mode from a first picture").
export function madeWith(r = {}) {
  const media = r.media || []
  const n = (kind) => media.filter((m) => m.kind === kind).length
  const count = (k, word) => (n(k) ? `${n(k)} ${word}${n(k) > 1 ? 's' : ''}` : '')
  if (r.mode === 'frames') return n('picture') > 1 ? 'in Frames mode from a first and last picture' : 'in Frames mode from a first picture'
  if (r.mode === 'continue') return 'in Continue mode from a video'
  if (r.mode === 'reference') return `in References mode with ${[count('picture', 'picture'), count('video', 'video'), count('audio', 'sound')].filter(Boolean).join(', ') || 'RefMods'}`
  return 'in Text mode'
}

const collect = (cmd, args) =>
  new Promise((resolve) => {
    const p = spawn(cmd, args, { windowsHide: true })
    const out = []
    let err = ''
    p.stdout.on('data', (d) => out.push(d))
    p.stderr.on('data', (d) => (err += d))
    p.on('error', () => resolve({ out: Buffer.alloc(0), err }))
    p.on('close', () => resolve({ out: Buffer.concat(out), err }))
  })

export class Reviewer {
  // studio: () => the Studio; voices: () => the voice service or null (its Whisper); ffmpeg: the bundled ffmpeg
  constructor({ studio, voices = () => null, ffmpeg }) {
    this.studio = studio
    this.voices = voices
    this.ffmpeg = ffmpeg
    this.busy = new Set()
  }

  // The take's file: a preview by its candidate number, or a finish job's final.
  take(job, candidate) {
    if (job.kind === 'finish') {
      const out = job.outputs.find((o) => o.kind === 'final') || job.outputs.find((o) => o.kind === 'master')
      return out?.path && fs.existsSync(out.path) ? { file: out.path, key: 'final', brief: this.studio().getJob(job.parent, { refresh: false }) } : null
    }
    const out = job.outputs.find((o) => o.kind === 'preview' && o.candidate === candidate)
    return out?.path && fs.existsSync(out.path) ? { file: out.path, key: String(candidate), brief: job } : null
  }

  // The shot's earlier reviewed runs (at most 3), oldest first: how each was made, whether it had another prompt
  // (revised) or other references (reref) than this one, and its takes' (and finals') unmet problems. brief is the
  // previews job this take came from (a final's parent).
  history(brief) {
    const studio = this.studio()
    const get = (id) => {
      try {
        return studio.getJob(id, { refresh: false })
      } catch {
        return null
      }
    }
    let ids = []
    try {
      ids = brief.projectId ? studio.getProject(brief.projectId).jobs : []
    } catch {
      return []
    }
    const jobs = ids.map(get).filter(Boolean)
    const prompt = (j) => String(j.plan?.asked?.prompt ?? j.plan?.request?.prompt ?? '').trim()
    const now = prompt(brief)
    const nowHow = madeWith(brief.plan?.request)
    const runs = []
    for (const j of jobs) {
      if (j.id === brief.id || j.kind !== 'previews' || (j.createdAt || '') > (brief.createdAt || '')) continue
      const reviewed = Object.entries(j.reviews || {}).filter(([, r]) => r?.issues)
      for (const f of jobs) if (f.kind === 'finish' && f.parent === j.id && f.reviews?.final) reviewed.push(['final', f.reviews.final])
      if (!reviewed.length) continue
      const how = madeWith(j.plan?.request)
      runs.push({ id: j.id, how, revised: prompt(j) !== now, reref: how !== nowHow, takes: reviewed.map(([key, r]) => ({ key, fix: r.fix?.kind, unmet: r.issues.filter((x) => x.unmet) })) })
    }
    return runs.slice(-3)
  }

  // What was said in the take: the ranking's Whisper, else the voice engine's, else null (not heard).
  async heard(t, job) {
    const lines = spokenLines(t.brief.plan?.asked?.prompt ?? t.brief.plan?.request?.prompt)
    if (!lines.length) return { lines, text: null }
    const ranked = t.brief.ranking?.takes?.find((x) => String(x.candidate) === (job.kind === 'finish' ? String(job.plan?.finish?.candidate) : t.key))?.raw?.heard
    if (ranked) return { lines, text: ranked }
    const v = this.voices()
    if (!v?.engine?.installed?.()) return { lines, text: null }
    return { lines, text: await v.transcribe(t.file).catch(() => null) }
  }

  async frames(file) {
    const { err } = await collect(this.ffmpeg, ['-hide_banner', '-i', file])
    const dur = Number(/Duration: (\d+):(\d+):([\d.]+)/.exec(err)?.slice(1).reduce((s, x, i) => s + Number(x) * [3600, 60, 1][i], 0)) || 5
    const shots = []
    for (let i = 0; i < FRAMES; i++) {
      const at = +(((i + 0.5) * dur) / FRAMES).toFixed(2)
      const { out } = await collect(this.ffmpeg, ['-v', 'error', '-ss', String(at), '-i', file, '-frames:v', '1', '-vf', 'scale=768:-2', '-f', 'image2pipe', '-c:v', 'mjpeg', '-q:v', '4', 'pipe:1'])
      if (out.length) shots.push({ at, data: out.toString('base64') })
    }
    return { duration: +dur.toFixed(2), shots }
  }

  // engine/model: the person's prompt writer (writerOf in paths.js).
  async review(jobId, candidate, { engine = 'local', model } = {}) {
    const key = `${jobId}:${candidate}`
    if (this.busy.has(key)) throw new Error('That take is already being reviewed.')
    this.busy.add(key)
    try {
      const job = this.studio().getJob(jobId, { refresh: false })
      const t = this.take(job, candidate)
      if (!t) throw new Error('That take has no video on this computer to review.')
      const req = t.brief.plan?.request || {}
      const prompt = t.brief.plan?.asked?.prompt ?? req.prompt ?? ''
      const character = req.character && req.character !== 'none' ? this.studio().characters().find((c) => c.id === req.character) : null
      const heard = await this.heard(t, job)
      const past = this.history(t.brief)
      const { duration, shots } = await this.frames(t.file)
      if (!shots.length) throw new Error("Couldn't read frames from that take.")
      const named = character ? `{char} in the prompt is ${character.name.split(/\s+/)[0]}, a trained character: judge their likeness only by consistency between frames.\n` : ''
      const refs = (req.media || []).length ? `The take was made in ${req.mode || 'text'} mode with ${req.media.length} reference file(s), which you don't see.\n` : ''
      const said = heard.text ? `Whisper heard in the take: "${heard.text}"\n` : heard.lines.length ? "You can't hear the take, and no transcript is available.\n" : ''
      const take = (x) => (x.key === 'final' ? 'the final' : `take ${x.key}`)
      const before = past.length
        ? `\nEarlier reviews of this shot (problems the brief asked to avoid):\n${past
            .map((r, i) => `Run ${i + 1}, made ${r.how}, ${r.revised ? 'with an earlier prompt' : 'with this same prompt'}:\n${r.takes.map((x) => `  ${take(x)}: ${x.unmet.map((u) => `${u.kind}: ${u.what}`).join('; ') || 'nothing unmet'}${x.fix ? ` (fix chosen: ${x.fix})` : ''}`).join('\n')}`)
            .join('\n')}\n`
        : ''
      const brief = `The take is ${duration} seconds long, made ${madeWith(req)}.\n${named}${refs}${said}${before}\nThe prompt (the brief):\n${prompt}`
      const images = shots.map((s, i) => ({ name: `frame-${i + 1}-at-${s.at}s.jpg`, data: s.data, label: `frame at ${s.at} s` }))
      const list = images.map((im) => `${im.name}: ${im.label}`).join('\n')
      let data
      const useHarness = engine === 'claude' || engine === 'codex'
      if (useHarness) {
        const user = `${brief}\n\nFrames from the take, in order:\n${list}${engine === 'claude' ? '\nOpen each frame with the Read tool before you answer.' : ''}\n\nAnswer with the JSON object only.`
        data = await harnessJson({ engine, model, system: reviewSystem({ full: true }), user, schema: reviewSchema(), images })
      } else data = await this.local({ brief, images, list, model })
      return this.save(jobId, t.key, this.tidy(data, { prompt, req, character, heard: heard.text, past }), useHarness ? engine : 'local')
    } finally {
      this.busy.delete(key)
    }
  }

  async local({ brief, images, list, model }) {
    const { name } = await localWriterModel(model, { needsEyes: 'review a take' })
    return localChat({
      model: name,
      system: reviewSystem(),
      schema: reviewSchema(),
      temperature: 0.3,
      ctx: 16384,
      cpu: await this.studio().gpuBusy().catch(() => false),
      timeoutMs: 900000,
      messages: [{ role: 'user', content: `${brief}\n\nThe images attached are frames from the take, in order:\n${list}`, images: images.map((im) => im.data) }]
    })
  }

  // Bounds and words tidied; a revised prompt goes through the checker's eyes ({char} kept, dialogue tags fixed).
  // heard: what Whisper heard (null: not heard, so guesses about the words are dropped). past: history().
  //   An unmet problem whose kind was also unmet in a run with another prompt or other references is marked again;
  //   when every unmet problem came back and the fix is one already tried (a rewrite, or a new reference), the
  //   review says so.
  tidy(data, { prompt, req, character, heard = null, past = [] }) {
    const fix = data.fix || {}
    const kind = FIX_KINDS.includes(fix.kind) ? fix.kind : 'revise_prompt'
    const kinds = (runs) => new Set(runs.flatMap((r) => r.takes.flatMap((x) => x.unmet.map((u) => u.kind))))
    const before = kinds(past.filter((r) => r.revised || r.reref))
    const tried = { revise_prompt: kinds(past.filter((r) => r.revised)), change_reference: kinds(past.filter((r) => r.reref)) }
    let revised = kind === 'revise_prompt' ? String(data.revised_prompt || '').trim() : ''
    if (revised) revised = normalizeDialogue(cleanPrompt(revised, character))
    if (revised === prompt.trim()) revised = ''
    const findings = revised ? lintPrompt(revised, { mode: req.mode || 'text', seconds: req.seconds || 5, media: req.media || [], character: character ? { name: character.name, trigger: character.trigger } : null }) : []
    const out = {
      verdict: ['usable', 'usable_with_fixes', 'redo'].includes(data.verdict) ? data.verdict : 'usable_with_fixes',
      works: (data.works || []).map(String).filter(Boolean).slice(0, 5),
      issues: (data.issues || [])
        .filter((x) => heard != null || x.kind !== 'words')
        .slice(0, 6)
        .map((x) => {
          const k = ISSUE_KINDS.includes(x.kind) ? x.kind : 'other'
          return { from: Math.max(0, +Number(x.from || 0).toFixed(1)), to: Math.max(0, +Number(x.to || 0).toFixed(1)), kind: k, what: String(x.what || '').trim(), unmet: !!x.unmet, ...(x.unmet && before.has(k) && { again: true }) }
        }),
      fix: { kind, label: FIX_WORDS[kind], why: String(fix.why || '').trim(), ...(kind === 'clean_stretch' && { from: +Number(fix.clean_from || 0).toFixed(1), to: +Number(fix.clean_to || 0).toFixed(1) }) },
      revisedPrompt: revised,
      revisedErrors: findings.filter((f) => f.level === 'error').map((f) => f.message)
    }
    const unmet = out.issues.filter((x) => x.unmet)
    if (tried[kind] && unmet.length && unmet.every((x) => x.again && tried[kind].has(x.kind)))
      out.repeat =
        kind === 'revise_prompt'
          ? 'These came back after the prompt was revised, so another rewrite may not move them. Try a first-frame picture that already shows it, splitting the action, or the clean stretch.'
          : 'These came back after the references changed too. Splitting the action into shots, the clean stretch, or the edit is more likely to work.'
    return out
  }

  save(jobId, key, review, engine) {
    const job = this.studio().getJob(jobId, { refresh: false })
    const reviews = { ...(job.reviews || {}), [key]: { ...review, engine, at: new Date().toISOString() } }
    this.studio().updateJob(jobId, { reviews })
    return reviews[key]
  }
}
