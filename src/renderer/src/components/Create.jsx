import { useEffect, useMemo, useRef, useState } from 'react'
import { useSelection } from '../selection'
import Stage from './Stage'
import QuickBar, { showBelow } from './AudioQuick'
import { sendIdea } from './PromptWriter'
import { MediaEditor, MediaTile } from './MediaEditor'
import PromptWriter from './PromptWriter'
import { LoraPicker, LoraThumb, loraTitle, useYours } from './Loras'
import Findings from './Findings'
import { MentionBox, MentionNotes, PlaceDialog } from './Mentions'
import { blocking, lintPrompt } from '../../../service/lint'
import { fileUrl } from './edit/model'
import { AspectGlyph, DropIcon, StepHead } from './CreateKit'
import { pretty as refmodTitle, RefModIcon, RefModPicker } from './CharacterSources'
import { lintSeedance } from '../../../service/seedlint'
import { confirmSpend, dollars } from './ComfyAccount'
import { SpeedRow } from './Speed'
import { finishFor, previewFor, savedSpeed, speedOf } from '../../../service/speed'
import Starters from './Starters'
import { CinemaChips, CinemaPicker, PromptTools, useSlate } from './CraftKit'
import { withSetups, withoutSetups } from '../../../service/setuptext'
import { starterById, starterForm } from '../starters'

// the preview pass's tested sampler and scheduler (plan.js DEFAULTS)
const SAMPLER_DEFAULT = 'er_sde'
const SCHEDULER_DEFAULT = 'beta'
// the speed preset the form's preview size, steps and takes match (service/speed.js), or null (Custom)
const finishLabel = (f) => `${f.megapixels} MP${f.upscale2x ? ' + 2x' : ''}`
const speedOfForm = (f) => speedOf({ megapixels: f.megapixels, steps: f.steps, previews: f.previews })

// [id, label, hint, the hint in plain words (Simple words)]
const MODES = [
  ['text', 'Text', 'Just the prompt.', 'Describe it in words; nothing else needed.'],
  ['reference', 'References', 'Pictures, videos or audio guide the shot. Name them <Picture 1>, <Video 1>, <Audio 1>.', 'Your own pictures, clips or sounds steer the shot. Call them <Picture 1>, <Video 1>, <Audio 1> in your words.'],
  ['frames', 'First / last frame', 'The clip opens on picture 1 and, optionally, ends on picture 2.', 'The video starts on your picture, and can end on a second one.'],
  ['continue', 'Continue a video', 'Carries a clip on from its last frames. Hunt takes, then finish the whole video at full size.', 'Picks up where a video ends and keeps it going.']
]
const ASPECTS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9']
const PREVIEW_MP = [0.3, 0.4, 0.6, 0.8]
// Preview quality: the turbo add-on IV Studio uses (DMAD) was trained for 4 steps; Standard gives it 8. A finish
// re-uses the picked preview's latent, so the 2 MP pass is the same either way.
const QUALITY = [
  [4, 'Draft', '4 steps: about 40% quicker previews, a touch softer. Good for hunting.'],
  [8, 'Standard', '8 steps: the default.']
]

const TEMPLATE = `integrated_multimodal_description: [Shot 1] Live-action, filmed on a smartphone. There is no writing anywhere in the picture: no signs, no labels, no captions. A medium close-up of {char}, a woman wearing ___, ___. The camera is handheld, a gentle sway. {char} (S1) ___, then says: <d>[English] ___</d>

overall_soundscape: ___. Her voice is close and natural.

non_diegetic_music: N/A`

const REF_TEMPLATE = `subject_definitions: <Subject 1> is {char}, a woman. <Subject 2> is the ___ from <Picture 1>.

retention_analysis: <Picture 1>: reference - the location keeps ___; the camera position follows the description.

detailed_description: [Shot 1] Live-action, filmed on a smartphone. There is no writing anywhere in the picture: no signs, no labels, no captions. In the ___ from <Picture 1>. {char} is wearing ___. {char} (S1) ___ and says: <d>[English] ___</d>

overall_soundscape: ___. Her voice is close and natural.

non_diegetic_music: N/A`

// Seedance 2.5 (Comfy credits): references are @image1, @video1, @audio1 in attach order; plain sentences.
const SEEDANCE_TEMPLATE = `{char}, a woman in her late twenties wearing ___, ___ in ___. Cinematic and realistic, ___ light.

One continuous medium shot, ___ camera.
0-2 seconds: ___. End state: ___.
2-5 seconds: ___. Dialogue language: American English. {char} says quietly: "___" End state: ___.

Audio: ___.

Pure video, no subtitles, no on-screen text, no background music.`
const TIERS = [
  ['draft', 'Draft · 480p', 'Quick and cheap to hunt with. Finish the one you pick at 1080p with Seedance, or free on this PC.'],
  ['720p', '720p', 'Final quality straight away.'],
  ['1080p', '1080p', 'Final quality, full HD.']
]
// Seedance's own words for the mode cards
const SD_HINTS = {
  text: 'Just the prompt. A character comes along as their face picture.',
  reference: 'Up to 30 pictures, 10 clips and 10 sounds. Name them @image1, @video1, @audio1.',
  frames: 'Opens on picture 1 and, optionally, lands on picture 2.',
  continue: 'Carries a clip on for the length you set. One take.'
}
const ENGINES = [
  ['h3', 'MiniMax H3', 'On this PC · free'],
  ['seedance', 'Seedance 2.5', 'Comfy credits · priced first']
]

const base = (p) => p.split(/[\\/]/).pop()
// The first <d>[Language] …</d> in a prompt takes the spoken words; a prompt without one is left alone.
const DIALOGUE = /<d>\[([^\]]+)\][^<]*<\/d>/
const withLine = (prompt, text) => {
  const m = DIALOGUE.exec(prompt)
  return m ? prompt.replace(m[0], `<d>[${m[1]}] ${text}</d>`) : prompt
}

export default function Create({ setup, characters, notify, openShot, go, incomingLine, clearIncomingLine, incomingLora, clearIncomingLora, incomingPicture, clearIncomingPicture, incomingCharacter, clearIncomingCharacter, incomingRun, clearIncomingRun, kindSwitch }) {
  // the speed preset saved in Settings → Your PC (service/speed.js)
  const [savedId, setSavedId] = useState('quality')
  const [form, setForm] = useState({
    projectId: null, // set when editing a shot's run: the new run joins that shot
    projectName: '',
    engine: 'h3', // 'h3' (this PC) or 'seedance' (Comfy credits)
    tier: 'draft',
    audio: true,
    mode: 'text',
    character: 'none',
    prompt: '',
    aspect: '16:9',
    megapixels: 0.4,
    seconds: 5,
    previews: 3,
    seed: 4242,
    steps: 8,
    sampler: SAMPLER_DEFAULT,
    scheduler: SCHEDULER_DEFAULT,
    media: [],
    overlapFrames: 22,
    voiceLine: null,
    refmods: [],
    retention: 1,
    extraLoras: []
  })
  const [advanced, setAdvanced] = useState(false)
  const [pickingRefmod, setPickingRefmod] = useState(false)
  // the samplers and schedulers this ComfyUI offers, read when Advanced first opens
  const [samplers, setSamplers] = useState(null)
  useEffect(() => {
    if (advanced && !samplers) window.ivstudio.samplers().then(setSamplers, () => setSamplers({ samplers: [], schedulers: [] }))
  }, [advanced])
  // the defaults Check my PC chose for this computer (Settings → Your PC); a fresh form only
  useEffect(() => {
    window.ivstudio.settings.get().then((s) => {
      // the saved speed preset (Settings → Your PC, picked by Check my PC) sets a fresh form's size, steps and takes
      const id = savedSpeed(s)
      setSavedId(id)
      setForm((f) => (f.projectId || f.megapixels !== 0.4 || f.steps !== 8 || f.previews !== 3 ? f : { ...f, ...previewFor(id) }))
    }, () => {})
  }, [])
  // faces: a character's own picture, else its ready-made picture from the catalog (as on Characters)
  const [catalog, setCatalog] = useState([])
  useEffect(() => {
    window.ivstudio.characters.catalog?.().then(setCatalog, () => {})
  }, [])
  const faceOf = (c) => c?.picture || catalog.find((x) => x.id === c?.id)?.picture || null
  // @ mentions: the cast and places a prompt can name (cast.js), and the new-place dialog with what to do after it
  const [members, setMembers] = useState([])
  const [newPlace, setNewPlace] = useState(null)
  // the Cinematography picker (CraftKit): the setups whose phrases are in the prompt
  const [cinema, setCinema] = useState([])
  const [cinemaOpen, setCinemaOpen] = useState(false)
  const slate = useSlate()
  useEffect(() => {
    window.ivstudio.cast.list().then(setMembers, () => setMembers([]))
  }, [characters])
  const [plan, setPlan] = useState(null)
  const [planError, setPlanError] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))
  // an iv:go with a mode (App.jsx) can open Create on that mode
  useEffect(() => {
    const go = (e) => e.detail?.create === 'video' && e.detail.mode && set({ mode: e.detail.mode, media: [] })
    window.addEventListener('iv:learn', go)
    return () => window.removeEventListener('iv:learn', go)
  }, [])

  useEffect(() => {
    // a picked character that was deleted falls back to None (the default)
    if (form.character !== 'none' && !characters.some((c) => c.id === form.character)) set({ character: 'none' })
  }, [characters])

  const request = useMemo(() => {
    const { projectId, projectName, voiceItem, ...r } = form
    // a Continue shot made here hunts takes and gets the full finish (plan.js continueFull)
    return { ...r, ...(r.mode === 'continue' && r.engine !== 'seedance' ? { continueFull: true } : {}), speed: speedOfForm(form) || undefined, character: r.character ?? 'none', media: r.media.map((m) => ({ kind: m.kind, file: m.path, ...(m.softMouth ? { softMouth: true } : {}) })) }
  }, [form])
  const speed = request.speed || null
  // a Custom shot finishes like the saved preset (the Finish panel's default too)
  const finishSpeed = speed || savedId

  const sd = form.engine === 'seedance'
  // for the chat: how this shot is set up so far (selection.js); the prompt's own words stay here
  const charName = characters?.find?.((c) => c.id === form.character)?.name
  useSelection(
    'create',
    { setup: `${sd ? 'Seedance 2.5' : 'MiniMax H3'}, ${form.mode} mode, ${charName || 'no character'}, ${form.aspect}, ${form.seconds} s, ${form.media.length} reference${form.media.length === 1 ? '' : 's'}${form.extraLoras.length ? `, ${form.extraLoras.length} LoRA${form.extraLoras.length === 1 ? '' : 's'}` : ''}, prompt ${form.prompt.trim() ? `${form.prompt.trim().split(/\s+/).length} words` : 'empty'}` },
    [form.engine, form.mode, form.character, form.aspect, form.seconds, form.media.length, form.extraLoras.length, form.prompt.length > 0, Math.round(form.prompt.length / 40)]
  )
  // the shot has a spoken line (or a voice line): a reference video's mouth can't be softened then (softmouth.js)
  const talks = !!form.voiceLine || /<d>[\s\S]*?\S[\s\S]*?<\/d>/.test(form.prompt || '')
  // Seedance: what the hunt would cost, from ComfyUI's own price for each take (pricing.js)
  const [price, setPrice] = useState(null)
  // the banner bar's idea, handed to the prompt writer below when Write it for me is pressed
  const [quickIdea, setQuickIdea] = useState('')
  // how long this hunt will take here, from this machine's own renders (src/service/timing.js)
  const [eta, setEta] = useState(null)
  useEffect(() => {
    if (!sd) return setPrice(null)
    let live = true
    const t = setTimeout(() => {
      window.ivstudio.render
        .price({ ...request, prompt: request.prompt || 'x' })
        .then((p) => live && setPrice(p))
        .catch(() => live && setPrice(null))
    }, 250)
    return () => ((live = false), clearTimeout(t))
  }, [request, sd])

  useEffect(() => {
    let live = true
    const probe = { ...request, prompt: request.prompt || 'x' }
    window.ivstudio.render
      .plan(probe, finishFor(request.speed || savedId, { upscale2x: setup?.caps?.upscale2x !== false }))
      .then((p) => live && (setPlan(p), setPlanError(null)))
      .catch((err) => live && (setPlan(null), setPlanError(err.message)))
    return () => {
      live = false
    }
  }, [request, savedId])

  async function addMedia(kind) {
    addFiles((await window.ivstudio.files.pick(kind)).map((path) => ({ kind, path })))
  }
  // Adds [{kind, path}] in one update (so several kinds dropped at once all land), each probed for the tile.
  async function addFiles(list) {
    if (!list.length) return
    const added = await Promise.all(list.map(async (m) => ({ ...m, info: await window.ivstudio.media.probe(m.path).catch(() => null) })))
    setForm((f) => {
      const limit = f.mode === 'frames' ? 2 : f.mode === 'continue' ? 1 : 12
      return { ...f, media: [...(f.mode === 'continue' ? [] : f.media), ...added].slice(0, limit) }
    })
  }

  // A line spoken in the character's voice (here, or from Audio > Lines) becomes the voice line, and its
  // words go into the prompt's dialogue so H3 says what it lip-syncs. A song from Audio > Music becomes the
  // voice line as it is.
  const [say, setSay] = useState('')
  const [speaking, setSpeaking] = useState(false)
  async function takeLine(line) {
    const info = await window.ivstudio.media.probe(line.file).catch(() => null)
    // a song (Music): it becomes what the character sings to; the prompt is the person's to write
    if (line.kind === 'music') {
      set({ voiceLine: line.file, voiceItem: { kind: 'audio', path: line.file, info } })
      notify(`"${line.name}" is the voice line now. Click its tile to trim it to the shot, and say in the prompt that they sing.`, 'info')
      return
    }
    const prompt = withLine(form.prompt.trim() ? form.prompt : form.mode === 'reference' ? REF_TEMPLATE : TEMPLATE, line.text)
    set({ voiceLine: line.file, voiceItem: { kind: 'audio', path: line.file, info }, prompt })
    if (!DIALOGUE.test(prompt)) notify('The line is the voice line now. Put the same words in the prompt, inside <d>[English] …</d>.', 'info')
  }
  async function speakLine() {
    setSpeaking(true)
    try {
      await takeLine(await window.ivstudio.voices.speak({ voiceId: char.voiceId, text: say }))
      setSay('')
    } catch (err) {
      notify(err.message)
    } finally {
      setSpeaking(false)
    }
  }
  useEffect(() => {
    if (!incomingLine) return
    takeLine(incomingLine)
    clearIncomingLine?.()
  }, [incomingLine])
  // "Edit and run again" from a shot: its run as written (mentions and local files), to change and render into that shot
  useEffect(() => {
    if (!incomingRun) return
    const { request: q, asked, projectId, projectName } = incomingRun
    const media = (asked?.media || q.media || []).map((m) => ({ kind: m.kind, path: m.file || m.path, ...(m.softMouth ? { softMouth: true } : {}) }))
    setForm((f) => ({
      ...f,
      projectId,
      projectName,
      mode: asked?.mode || q.mode,
      engine: asked?.engine || q.engine || 'h3',
      tier: asked?.tier || q.tier || f.tier,
      audio: asked?.audio ?? q.audio ?? true,
      character: q.character ?? 'none',
      prompt: asked?.prompt ?? q.prompt,
      aspect: q.aspect || f.aspect,
      megapixels: q.megapixels || f.megapixels,
      seconds: q.seconds || f.seconds,
      previews: q.previews || f.previews,
      seed: q.seed ?? f.seed,
      steps: q.steps || f.steps,
      sampler: q.sampler || SAMPLER_DEFAULT,
      scheduler: q.scheduler || SCHEDULER_DEFAULT,
      overlapFrames: q.overlapFrames || f.overlapFrames,
      refmods: q.refmods || [],
      retention: q.retention ?? 1,
      extraLoras: q.extraLoras || [],
      voiceLine: asked?.voiceLine || null,
      voiceItem: asked?.voiceLine ? { kind: 'audio', path: asked.voiceLine } : null,
      media
    }))
    media.forEach((m, i) => window.ivstudio.media.probe(m.path).then((info) => setForm((f) => ({ ...f, media: f.media.map((x, j) => (j === i && x.path === m.path ? { ...x, info } : x)) })), () => {}))
    // from a finished version (Continue from this, or its last frame): a new shot that starts where it ended
    if (incomingRun.from === 'continue') notify('A new shot that carries the finished version on. Say what happens next, or let Write it for me look at its last frame.', 'info')
    else if (incomingRun.from === 'frames') notify('A new shot that opens on the last frame. Say what happens next, or let Write it for me look at it.', 'info')
    clearIncomingRun?.()
  }, [incomingRun])
  // Start from an example (starters.js): the row on this page, or the welcome wizard's "Make your first shot"
  const [starter, setStarter] = useState(null)
  const applyStarter = (s) => {
    setForm((f) => ({ ...f, ...starterForm(s) }))
    setStarter(s.id)
  }
  const promptNow = useRef('')
  promptNow.current = form.prompt
  useEffect(() => {
    const pick = (e) => {
      const s = starterById(e.detail?.id)
      // never over words someone has already written
      if (s && !promptNow.current.trim()) applyStarter(s)
    }
    window.addEventListener('iv:starter', pick)
    return () => window.removeEventListener('iv:starter', pick)
  }, [])
  // "New shot" with a character from the dashboard
  useEffect(() => {
    if (!incomingCharacter) return
    set({ character: incomingCharacter })
    clearIncomingCharacter?.()
  }, [incomingCharacter])

  // The LoRA tray: each LoRA as its picture with a strength slider. A LoRA's trigger words go into the
  // prompt when it's added (the shot's first description), unless the person turned that off for it.
  const [picking, setPicking] = useState(false)
  const [yours, , reloadYours] = useYours()
  const loraInfo = (name) => yours?.find((x) => x.name === name)
  function addLora({ name, words = [], title, strength: suggested }) {
    if (form.extraLoras.some((l) => l.name === name)) return notify(`${title || loraTitle(name)} is already in the shot.`, 'info')
    const info = loraInfo(name)
    // the person's own setting, else the strength a Recommended LoRA suggests, else 1
    const strength = info?.prefs?.strength ?? suggested ?? 1
    const auto = info?.prefs?.autoTrigger !== false
    const add = auto ? words.filter((w) => w && !form.prompt.includes(w)) : []
    const prompt = add.length ? (/\[Shot 1\] /.test(form.prompt) ? form.prompt.replace('[Shot 1] ', `[Shot 1] ${add.join(', ')}. `) : `${add.join(', ')}. ${form.prompt}`) : form.prompt
    set({ extraLoras: [...form.extraLoras, { name, strength }], prompt })
    if (add.length) notify(`Added ${title || loraTitle(name)} and its trigger words (${add.join(', ')}) to the prompt.`, 'info')
    setPicking(false)
    reloadYours()
  }
  useEffect(() => {
    if (!incomingLora) return
    addLora(incomingLora)
    clearIncomingLora?.()
  }, [incomingLora])
  // a picture from Create -> Image (Use in a shot): the shot opens on it, as its first frame
  useEffect(() => {
    if (!incomingPicture) return
    set({ mode: 'frames', media: [] })
    addFiles([{ kind: 'picture', path: incomingPicture }])
    clearIncomingPicture?.()
  }, [incomingPicture])

  async function pickVoice() {
    const [file] = await window.ivstudio.files.pick('audio')
    if (file) set({ voiceLine: file, voiceItem: { kind: 'audio', path: file, info: await window.ivstudio.media.probe(file).catch(() => null) } })
  }

  // Files dropped on the references area, sorted by kind; the mode decides which kinds it takes.
  const [dragOver, setDragOver] = useState(false)
  function dropMedia(e) {
    e.preventDefault()
    setDragOver(false)
    const kindOf = (p) => (/\.(png|jpe?g|webp|bmp)$/i.test(p) ? 'picture' : /\.(mp4|mov|webm|mkv|m4v)$/i.test(p) ? 'video' : /\.(wav|mp3|flac|m4a|ogg|aac)$/i.test(p) ? 'audio' : null)
    const allowed = form.mode === 'frames' ? ['picture'] : form.mode === 'continue' ? ['video'] : ['picture', 'video', 'audio']
    const paths = [...e.dataTransfer.files].map((f) => window.ivstudio.media.pathFor(f)).filter(Boolean)
    const fit = paths.filter((p) => allowed.includes(kindOf(p)))
    if (fit.length < paths.length) notify(`This mode takes ${allowed.map((k) => `${k}s`).join(', ')}; the other files were left out.`)
    addFiles(fit.map((path) => ({ kind: kindOf(path), path })))
  }

  // The media editor: which reference is open (an index into media, or 'voice').
  const [editing, setEditing] = useState(null)
  const editItem = editing === 'voice' ? form.voiceItem || { kind: 'audio', path: form.voiceLine } : form.media[editing]
  const editHint = {
    frames: `Frames are stretched to the shot's size (${form.aspect}). Crop to "Shot" so nothing gets squashed.`,
    continue: 'The shot carries on from the last frames you keep: trim where the clip should hand over.',
    reference: 'Keep only what the shot should use. Shorter references are quicker.'
  }
  function applyEdit(next) {
    if (editing === 'voice') set({ voiceLine: next.path, voiceItem: next })
    else set({ media: form.media.map((m, j) => (j === editing ? next : m)) })
    setEditing(null)
  }
  const mediaLabel = (m, i) => (form.mode === 'frames' ? (i === 0 ? 'First frame' : 'Last frame') : form.mode === 'continue' ? 'Source video' : `<${m.kind[0].toUpperCase() + m.kind.slice(1)} ${form.media.filter((x, j) => x.kind === m.kind && j <= i).length}>`)

  // Seedance makes 4 to 30 seconds, H3 1 to 15: the length is kept inside the new engine's range
  function switchEngine(engine) {
    setForm((f) => ({ ...f, engine, seconds: engine === 'seedance' ? Math.min(30, Math.max(4, Math.round(f.seconds))) : Math.min(15, f.seconds) }))
  }

  async function hunt() {
    setBusy(true)
    try {
      let spend
      if (sd) {
        const p = await window.ivstudio.render.price(request)
        spend = await confirmSpend(p, { what: `${r?.previews || 1} Seedance take${r?.previews > 1 ? 's' : ''}` })
        if (!spend) return
      }
      const job = await window.ivstudio.render.previews({ ...request, projectId: form.projectId || undefined, projectName: form.projectName || undefined, ...(spend ? { spend } : {}) })
      notify('Previews started. You can keep working; they appear here as they finish.', 'info')
      openShot(job.projectId)
    } catch (err) {
      notify(err.message)
    } finally {
      setBusy(false)
    }
  }

  const char = characters.find((c) => c.id === form.character)
  // The prompt checker (src/service/lint.js) on every edit; its errors hold back the hunt unless rendered anyway.
  // Seedance's references, in the order the graph attaches them (seedance.js): the person's own, then the
  // character's face, then the voice line
  const sdRefs = useMemo(() => {
    const face = form.mode !== 'frames' && char && faceOf(char) ? 1 : 0
    const n = (k) => form.media.filter((m) => m.kind === k).length
    const voice = form.voiceLine && form.mode !== 'frames' ? 1 : 0
    // the face and the voice line get their role lines from IV Studio when the prompt leaves them out
    const auto = [face && `@image${n('picture') + 1}`, voice && `@audio${n('audio') + 1}`].filter(Boolean)
    return { pictures: Array(n('picture') + face).fill(0), videos: Array(n('video')).fill(0), audios: Array(n('audio') + voice).fill(0), auto }
  }, [form.media, form.mode, form.voiceLine, char, catalog])
  const findings = useMemo(
    () => (!form.prompt.trim() ? [] : sd ? lintSeedance(form.prompt, { mode: form.mode, seconds: form.seconds, refs: sdRefs, auto: sdRefs.auto }) : lintPrompt(form.prompt, { mode: form.mode, seconds: form.seconds, media: form.media, character: char ? { name: char.name, trigger: char.trigger } : null, voiceLine: form.voiceLine, mentions: members.map((m) => m.handle) })),
    [form.prompt, form.mode, form.seconds, form.media, form.voiceLine, char, members, sd, sdRefs]
  )
  const errors = blocking(findings)
  const [anyway, setAnyway] = useState(false)
  useEffect(() => setAnyway(false), [form.prompt])
  const r = plan?.resolved
  useEffect(() => {
    if (sd || !r?.width || !r?.frames) return setEta(null)
    let alive = true
    const fps = r.fps || 24
    window.ivstudio.timing
      .estimate({ kind: 'previews', megapixels: (r.width * r.height) / 1e6, seconds: r.frames / fps, fps, previews: r.previews, steps: form.steps })
      .then((e) => alive && setEta(e), () => alive && setEta(null))
    return () => (alive = false)
  }, [sd, r?.width, r?.height, r?.frames, r?.previews, form.steps])
  const comfyOk = setup?.items?.some((i) => i.id === 'comfyui' && i.status === 'ok')
  const blocked = setup && (sd ? !comfyOk : !setup.ready)

  // the step numbers: "What it builds on" only shows for modes that take media
  const steps = form.mode === 'text' ? { who: 2, what: 3, shape: 4 } : { who: 2, media: 3, what: 4, shape: 5 }
  const modeLabel = MODES.find(([id]) => id === form.mode)?.[1]
  const counts = ['picture', 'video', 'audio'].map((k) => [k, form.media.filter((m) => m.kind === k).length]).filter(([, n]) => n)
  const priceText = sd && price?.paid ? (price.max - price.min > 0.005 ? `up to ${dollars(price.max)}` : `about ${dollars(price.max)}`) : ''
  const huntLabel = busy ? 'Starting…' : errors.length && !anyway ? `Fix ${errors.length} error${errors.length > 1 ? 's' : ''} first` : sd ? `Hunt ${r?.previews || ''} take${r?.previews > 1 ? 's' : ''}${priceText ? ` · ${priceText}` : ''}` : `Hunt ${r?.previews || ''} preview${r?.previews > 1 ? 's' : ''}`
  const canHunt = !(busy || !form.prompt.trim() || !r || blocked || (errors.length > 0 && !anyway))

  return (
    <div className="create create-v2">
      <Stage effect="sparks" art="create" title="Create" kicker="New shot">
        {/* the idea goes to the prompt writer under What happens, which writes the shot's prompt */}
        <QuickBar
          label="Your idea"
          placeholder="Your idea in plain words: who, where, what happens…"
          value={quickIdea}
          onChange={setQuickIdea}
          goLabel="Write it for me"
          disabled={!quickIdea.trim()}
          onGo={() => (sendIdea(quickIdea, true), setQuickIdea(''), showBelow('.create .writer'))}
        />
      </Stage>
      {kindSwitch}

      {form.projectId && (
        <p className="notice editing-run">
          Editing a run of <b>{form.projectName}</b>: the new run joins that shot, next to the others.{' '}
          <button className="link-btn" onClick={() => set({ projectId: null, projectName: '' })}>
            Make it a new shot instead
          </button>
        </p>
      )}

      {blocked && (
        <p className="notice">
          ComfyUI isn't ready yet.{' '}
          <button className="link-btn" onClick={() => go('setup')}>
            Open Setup
          </button>
        </p>
      )}

      <div className="create-layout">
        <div className="create-steps">
          <section className="create-step">
            <StepHead n={1} title="What kind of shot" sub={sd ? 'Seedance 2.5 renders on your Comfy.org credits, through ComfyUI. It starts from words, your references, a first frame, or a clip to carry on.' : 'How H3 starts: from words, from your pictures and clips, from a first frame, or carrying a video on.'} subPlain={sd ? 'Seedance makes the video online and uses your Comfy credits. Start from words, your own pictures or clips, a first picture, or a video to carry on.' : 'Pick how the video starts: from words, from your own pictures and clips, from a first picture, or carrying on a video.'} />
            <div className="engine-switch" role="radiogroup" aria-label="Model">
              {ENGINES.map(([id, label, note]) => (
                <button key={id} role="radio" aria-checked={form.engine === id} className={`engine-card ${form.engine === id ? 'on' : ''}`} onClick={() => switchEngine(id)}>
                  <span className="engine-name">{label}</span>
                  <span className="dim small mono">{note}</span>
                </button>
              ))}
            </div>
            <div className="mode-cards create-modes">
              {MODES.map(([id, label, hint, plain]) => (
                <button key={id} className={`mode-card ${form.mode === id ? 'on' : ''}`} onClick={() => set({ mode: id, media: [] })}>
                  <ModeIcon id={id} />
                  <span className="mode-name">{label}</span>
                  <span className="dim small" data-plain={sd ? undefined : plain}>
                    {sd ? SD_HINTS[id] : hint}
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="create-step">
            <StepHead n={steps.who} title="Who's in it" sub={sd ? 'A character comes along as their face picture, so Seedance keeps their look.' : 'A character keeps the same face and voice in every shot. LoRAs add a look, a style or a move; RefMods bring a saved look, voice or place.'} subPlain={sd ? 'Pick a character and their face comes along, so they look the same.' : 'Pick a character and they keep the same face and voice in every shot. Looks add a style or a kind of movement; reference packs bring a saved face, voice or place.'} />
            <div className="cast-picker" role="radiogroup" aria-label="Character">
              {characters.map((c) => (
                <button key={c.id} role="radio" aria-checked={form.character === c.id} className={`cast-chip ${form.character === c.id ? 'on' : ''}`} onClick={() => set({ character: c.id })}>
                  <span className="cast-chip-face">{faceOf(c) ? <img src={fileUrl(faceOf(c))} alt="" /> : c.name.slice(0, 1)}</span>
                  <span className="cast-chip-name">{c.name.split(' ')[0]}</span>
                </button>
              ))}
              <button role="radio" aria-checked={form.character === 'none'} className={`cast-chip none ${form.character === 'none' ? 'on' : ''}`} onClick={() => set({ character: 'none' })}>
                <span className="cast-chip-face">∅</span>
                <span className="cast-chip-name">Nobody</span>
              </button>
            </div>
            {sd && <p className="dim small engine-note">Seedance takes a character as their face picture, named in the prompt. LoRAs and RefMods are for H3 only.</p>}
            {!sd && (
            <>
            <div className="create-field">
              <span className="create-label mono">LoRAs</span>
              <div className="lora-tray">
                {form.extraLoras.map((l, i) => {
                  const info = loraInfo(l.name)
                  return (
                    <div key={l.name} className="lora-chip">
                      <LoraThumb className="small" preview={info?.prefs?.picture ? { file: info.prefs.picture, type: 'image' } : info?.civitai?.preview} label={loraTitle(l.name)} mature={info?.civitai?.mature} />
                      <div className="lora-chip-body">
                        <span className="lora-chip-name" title={l.name}>
                          {info?.civitai?.name || loraTitle(l.name)}
                        </span>
                        <div className="lora-chip-strength">
                          <input type="range" min={0} max={1.5} step={0.05} value={l.strength} onChange={(e) => set({ extraLoras: form.extraLoras.map((x, j) => (j === i ? { ...x, strength: Number(e.target.value) } : x)) })} />
                          <span className="mono small">{Number(l.strength).toFixed(2)}</span>
                        </div>
                      </div>
                      <button className="lora-chip-x" title="Take it out of the shot" onClick={() => set({ extraLoras: form.extraLoras.filter((_, j) => j !== i) })}>
                        ×
                      </button>
                    </div>
                  )
                })}
                <button className="lora-add" onClick={() => setPicking(true)}>
                  + Add LoRA
                </button>
              </div>
            </div>
            {picking && <LoraPicker notify={notify} go={go} onClose={() => setPicking(false)} onPick={addLora} />}
            <div className="create-field">
              <span className="create-label mono">RefMods</span>
              <div className="lora-tray refmod-tray">
                {form.refmods.map((m, i) => (
                  <div key={m.name} className="lora-chip refmod-chip">
                    <span className="refmod-chip-icon" aria-hidden="true">
                      <RefModIcon />
                    </span>
                    <div className="lora-chip-body">
                      <span className="lora-chip-name" title={m.name}>
                        {refmodTitle(m.name)}
                      </span>
                      <div className="lora-chip-strength">
                        <input type="range" min={0} max={1} step={0.05} value={m.strength} aria-label={`${refmodTitle(m.name)} strength`} onChange={(e) => set({ refmods: form.refmods.map((x, j) => (j === i ? { ...x, strength: Number(e.target.value) } : x)) })} />
                        <span className="mono small">{Number(m.strength).toFixed(2)}</span>
                      </div>
                    </div>
                    <button className="lora-chip-x" title="Take it out of the shot" onClick={() => set({ refmods: form.refmods.filter((_, j) => j !== i) })}>
                      ×
                    </button>
                  </div>
                ))}
                {form.refmods.length < 8 && (
                  <button className="lora-add" onClick={() => setPickingRefmod(true)}>
                    + Add RefMod
                  </button>
                )}
              </div>
              {form.refmods.length > 0 && (
                <div className="create-field inline refmod-retention">
                  <span className="create-label mono">Retention</span>
                  <div className="segmented">
                    {[
                      [1, 'Full'],
                      [0.7, 'Partial'],
                      [0.4, 'Style']
                    ].map(([v, l]) => (
                      <button key={v} className={form.retention === v ? 'on' : ''} onClick={() => set({ retention: v })}>
                        {l}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <span className="dim small">Saved references: a character's look or voice, a place, a style. Best with References mode.</span>
            </div>
            </>
            )}
            {pickingRefmod && (
              <RefModPicker
                onClose={() => setPickingRefmod(false)}
                onPick={({ name }) => {
                  if (!form.refmods.some((m) => m.name === name)) set({ refmods: [...form.refmods, { name, strength: 1, copies: 1 }].slice(0, 8) })
                  setPickingRefmod(false)
                }}
              />
            )}
          </section>

          {form.mode !== 'text' && (
            <section className="create-step">
              <StepHead
                n={steps.media}
                title={form.mode === 'frames' ? 'The frames' : form.mode === 'continue' ? 'The video to carry on' : 'What it builds on'}
                sub={form.mode === 'frames' ? 'The first frame, and a last frame if the clip should land on one.' : form.mode === 'continue' ? 'The clip to continue. 24 fps works best.' : sd ? 'A place, an outfit, a voice, a camera move: name each one in the prompt as @image1, @video1, @audio1 and say what to take from it.' : 'A place, an outfit, a voice: name them in the prompt as <Picture 1>, <Video 1>, <Audio 1>.'}
              />
              <div className={`media create-drop ${dragOver ? 'drag-over' : ''} ${form.media.length ? 'filled' : ''}`} onDragOver={(e) => (e.preventDefault(), setDragOver(true))} onDragLeave={() => setDragOver(false)} onDrop={dropMedia}>
                {form.media.length > 0 ? (
                  <div className="media-tiles">
                    {form.media.map((m, i) => (
                      <MediaTile
                        key={`${i}:${m.path}`}
                        item={m}
                        label={mediaLabel(m, i)}
                        onEdit={() => setEditing(i)}
                        onRemove={() => set({ media: form.media.filter((_, j) => j !== i) })}
                        extra={
                          form.mode === 'reference' && m.kind === 'video' && !sd ? (
                            <label className="soft-mouth small" title={talks ? 'This shot has a spoken line, so the mouth has to move: soft mouth is off.' : 'Blurs the mouths in this video before H3 sees it, so the new face doesn’t mouth the words spoken in it. H3 can copy the blur into the first second; trim it in Edit. Needs the face models (Characters).'}>
                              <input type="checkbox" disabled={talks} checked={!!m.softMouth && !talks} onChange={(e) => set({ media: form.media.map((x, j) => (j === i ? { ...x, softMouth: e.target.checked } : x)) })} />
                              Soft mouth{talks ? ' (off: the shot speaks)' : ''}
                            </label>
                          ) : null
                        }
                      />
                    ))}
                  </div>
                ) : (
                  <div className="create-drop-empty">
                    <DropIcon />
                    <span>Drop {form.mode === 'frames' ? 'pictures' : form.mode === 'continue' ? 'a clip' : 'pictures, clips or sound'} here</span>
                  </div>
                )}
                <div className="media-actions">
                  {(form.mode === 'frames' || form.mode === 'reference') && (
                    <button className="btn btn-small" onClick={() => addMedia('picture')}>
                      + Picture
                    </button>
                  )}
                  {(form.mode === 'continue' || form.mode === 'reference') && (
                    <button className="btn btn-small" onClick={() => addMedia('video')}>
                      + Video
                    </button>
                  )}
                  {form.mode === 'reference' && (
                    <button className="btn btn-small" onClick={() => addMedia('audio')}>
                      + Audio
                    </button>
                  )}
                  {form.media.length > 0 && <span className="dim small">Click one to crop or trim it; the original isn't changed.</span>}
                </div>
              </div>
              {form.mode === 'continue' && !sd && (
                <div className="create-field inline">
                  <span className="create-label mono">Overlap frames</span>
                  <div className="segmented">
                    {[5, 22, 39, 56].map((n) => (
                      <button key={n} className={form.overlapFrames === n ? 'on' : ''} onClick={() => set({ overlapFrames: n })}>
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <p className="dim small mode-writer-hint">
                ✦ Add them first: <b>Write it for me</b> looks at {form.mode === 'continue' ? 'the last frame' : 'them'} and writes what it sees into the prompt.
              </p>
            </section>
          )}

          {!sd && !form.projectId && (!form.prompt.trim() || starter) && <Starters onPick={applyStarter} current={starter} />}
          <section className="create-step">
            <StepHead n={steps.what} title="What happens" sub={sd ? 'Who, what happens, where, the camera and the sound, in plain sentences. Give every reference a job.' : 'Clothes, place, camera, action and the lines. Never the face or voice: the character carries those.'} subPlain={sd ? 'Say who is there, what happens, where, how the camera moves and what we hear. Say what each of your pictures is for.' : 'Describe the clothes, the place, the camera, what happens and what is said. Skip the face and voice: the character already has those.'} />
            <PromptWriter
              listen
              context={{ engine: form.engine, mode: form.mode, seconds: form.seconds, aspect: form.aspect, character: form.character ?? 'none', media: form.media.map((m) => ({ kind: m.kind, file: m.path })), voiceLine: form.voiceLine || null }}
              current={form.prompt}
              names={char ? [char.name, ...characters.filter((c) => c.id !== char.id).map((c) => c.name), 'Someone'] : ['Someone', ...characters.map((c) => c.name)]}
              onPrevis={(clip) => {
                // a previs is a video reference: References mode keeps the pictures (Text has none)
                if (form.mode !== 'reference') set({ mode: 'reference', media: form.media.filter((m) => m.kind === 'picture') })
                addFiles([{ kind: 'video', path: clip.file }])
              }}
              onWritten={(prompt) => set({ prompt: sd ? prompt : withSetups(prompt, cinema) })}
              notify={notify}
              go={go}
            />
            <div className="prompt-head">
              <span className="create-label mono">
                Prompt {char && <span className="dim">· write <code>{'{char}'}</code> for {char.name.split(' ')[0]}</span>}
              </span>
              <button className="link-btn mono" onClick={() => set({ prompt: sd ? SEEDANCE_TEMPLATE : form.mode === 'reference' ? REF_TEMPLATE : TEMPLATE })}>
                Insert template
              </button>
            </div>
            <MentionBox
              className="prompt"
              rows={9}
              value={form.prompt}
              members={members}
              onNewPlace={(then) => setNewPlace(() => then)}
              placeholder="Describe the shot: clothes, place, camera, action and the lines. Type @ for your cast and places."
              onChange={(prompt) => set({ prompt })}
            />
            <MentionNotes notes={plan?.notes} />
            {form.prompt.trim() && <Findings findings={findings} onFix={(prompt) => set({ prompt })} />}
            {!sd && (
              <div className="create-craft" data-tour="create-craft">
                <CinemaChips
                  value={cinema}
                  onChange={(next) => (set({ prompt: withSetups(withoutSetups(form.prompt, cinema.filter((c) => !next.some((n) => n.id === c.id))), next) }), setCinema(next))}
                  onOpen={() => setCinemaOpen(true)}
                />
                <PromptTools
                  prompt={form.prompt}
                  writer={slate?.writer}
                  run={async ({ tool, note }) => {
                    const r = await window.ivstudio.craft.rewrite({ prompt: form.prompt, tool, note, context: { spec: `${form.seconds} s, ${form.mode} mode, ${form.aspect}` } })
                    set({ prompt: r.prompt })
                    return r
                  }}
                  variants={() => window.ivstudio.craft.variants({ prompt: form.prompt, context: { spec: `${form.seconds} s, ${form.mode} mode, ${form.aspect}` } })}
                  onUse={(prompt) => set({ prompt })}
                />
              </div>
            )}
            {cinemaOpen && (
              <CinemaPicker
                value={cinema}
                onChange={(next) => (set({ prompt: withSetups(withoutSetups(form.prompt, cinema.filter((c) => !next.some((n) => n.id === c.id))), next) }), setCinema(next))}
                onClose={() => setCinemaOpen(false)}
              />
            )}
            {newPlace && (
              <PlaceDialog
                notify={notify}
                onClose={() => setNewPlace(null)}
                onSaved={(place, list) => {
                  setMembers(list)
                  setNewPlace(null)
                  if (place) newPlace(place)
                }}
              />
            )}

            <div className="create-voice">
              <div className="create-voice-head">
                <span className="create-label mono">Voice line</span>
                <span className="dim small">
                  {sd ? 'Optional. A recording Seedance uses as the voice and the words (it goes along as an @audio reference).' : char?.voiceId ? `Optional. Speak a line in ${char.name.split(' ')[0]}'s voice, or add a recording; the words go into the prompt.` : char ? `Optional. Give ${char.name.split(' ')[0]} a voice under Audio › Voices to speak lines here.` : 'Optional. A recording H3 lip-syncs to; write the same words in the prompt.'}
                </span>
              </div>
              <div className="voice-control">
                {form.voiceLine ? (
                  <MediaTile item={form.voiceItem || { kind: 'audio', path: form.voiceLine }} label="Lip-sync" onEdit={() => setEditing('voice')} onRemove={() => set({ voiceLine: null, voiceItem: null })} />
                ) : (
                  <>
                    {char?.voiceId && (
                      <div className="speak-line">
                        <input value={say} placeholder={`What ${char.name.split(' ')[0]} says`} onChange={(e) => setSay(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && say.trim() && !speaking && speakLine()} />
                        <button className="btn btn-small btn-primary" disabled={!say.trim() || speaking} onClick={speakLine}>
                          {speaking ? 'Speaking… (up to a minute the first time)' : 'Speak it'}
                        </button>
                      </div>
                    )}
                    <button className="btn btn-small" onClick={pickVoice}>
                      {sd ? '+ Voice recording' : '+ Recording to lip-sync'}
                    </button>
                  </>
                )}
              </div>
            </div>
          </section>

          <section className="create-step">
            <StepHead n={steps.shape} title="Shape and size" sub={sd ? 'Hunt with cheap Draft takes, then finish the one you pick. Or render 720p or 1080p takes straight away.' : 'The previews are small and quick; the one you pick is finished at full size.'} subPlain={sd ? 'Try a few cheap rough takes first, then finish the one you like. Or make sharp 720p or 1080p takes straight away.' : 'You get a few small, quick versions first. The one you like is then made again at full size.'} />
            <div className="aspect-tiles" role="radiogroup" aria-label="Aspect ratio">
              {ASPECTS.map((a) => (
                <button key={a} role="radio" aria-checked={form.aspect === a} className={`aspect-tile ${form.aspect === a ? 'on' : ''}`} onClick={() => set({ aspect: a })}>
                  <AspectGlyph a={a} />
                  <span className="mono">{a}</span>
                </button>
              ))}
            </div>
            <div className="create-field">
              <span className="create-label mono">
                Length <span className="create-value">{form.seconds} s</span>
              </span>
              <div className="length-slider">
                <input type="range" min={sd ? 4 : 1} max={sd ? 30 : 15} step={sd ? 1 : 0.5} value={form.seconds} onChange={(e) => set({ seconds: Number(e.target.value) })} aria-label="Length in seconds" />
                <div className="length-marks mono" aria-hidden="true">
                  {(sd ? [4, 10, 20, 30] : [1, 5, 10, 15]).map((s) => (
                    <span key={s} style={{ left: `${((s - (sd ? 4 : 1)) / (sd ? 26 : 14)) * 100}%` }}>
                      {s}s
                    </span>
                  ))}
                </div>
              </div>
            </div>
            {sd && (
              <div className="create-grid">
                <div className="create-field">
                  <span className="create-label mono">Quality</span>
                  <div className="segmented">
                    {TIERS.map(([id, label, hint]) => (
                      <button key={id} className={form.tier === id ? 'on' : ''} onClick={() => set({ tier: id })} title={hint}>
                        {label}
                      </button>
                    ))}
                  </div>
                  <span className="dim small">{TIERS.find(([id]) => id === form.tier)?.[2]}</span>
                </div>
                {form.mode !== 'continue' && (
                  <div className="create-field">
                    <span className="create-label mono">Takes</span>
                    <div className="segmented">
                      {[1, 2, 3].map((n) => (
                        <button key={n} className={form.previews === n ? 'on' : ''} onClick={() => set({ previews: n })}>
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="create-field">
                  <span className="create-label mono">Sound</span>
                  <div className="segmented">
                    {[
                      [true, 'With sound'],
                      [false, 'Silent']
                    ].map(([v, l]) => (
                      <button key={l} className={form.audio === v ? 'on' : ''} onClick={() => set({ audio: v })}>
                        {l}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="create-field">
                  <span className="create-label mono">Price</span>
                  <span className="sd-price">{price ? price.label : 'Working it out…'}</span>
                  <span className="dim small">ComfyUI’s own price, on your Comfy.org credits. You confirm before anything runs.</span>
                </div>
              </div>
            )}
            {!sd && <SpeedRow value={speed} onPick={(id) => set(previewFor(id))} />}
            {!sd && (
            <div className="create-grid">
              <div className="create-field">
                <span className="create-label mono">Preview size</span>
                <div className="segmented">
                  {PREVIEW_MP.map((mp) => (
                    <button key={mp} className={form.megapixels === mp ? 'on' : ''} onClick={() => set({ megapixels: mp })}>
                      {mp} MP
                    </button>
                  ))}
                </div>
              </div>
              <div className="create-field">
                <span className="create-label mono">Previews</span>
                <div className="segmented">
                  {[1, 2, 3].map((n) => (
                    <button key={n} className={form.previews === n ? 'on' : ''} onClick={() => set({ previews: n })}>
                      {n}
                    </button>
                  ))}
                </div>
              </div>
              <div className="create-field">
                <span className="create-label mono">Quality</span>
                <div className="segmented">
                  {QUALITY.map(([steps, label]) => (
                    <button key={steps} className={form.steps === steps ? 'on' : ''} onClick={() => set({ steps })} title={QUALITY.find(([s]) => s === steps)?.[2]}>
                      {label}
                    </button>
                  ))}
                </div>
                <span className="dim small">{QUALITY.find(([s]) => s === form.steps)?.[2] || `${form.steps} steps (set under Advanced)`}</span>
              </div>
              <div className="create-field">
                <span className="create-label mono">Seed</span>
                <div className="seed">
                  <input type="number" value={form.seed} onChange={(e) => set({ seed: Math.max(0, Number(e.target.value) || 0) })} aria-label="Seed" />
                  <button className="seed-roll" onClick={() => set({ seed: Math.floor(Math.random() * 1e9) })} title="A new seed" aria-label="A new seed">
                    ⟳
                  </button>
                </div>
              </div>
            </div>
            )}
            <div className="create-field">
              <span className="create-label mono">
                Shot name <span className="dim">· optional</span>
              </span>
              <input className="shot-name-input" value={form.projectName} placeholder="e.g. Tess car rant" onChange={(e) => set({ projectName: e.target.value })} />
            </div>

            {!sd && (
            <div className={`more-settings ${advanced ? 'open' : ''}`}>
              <button type="button" className="more-settings-toggle mono" onClick={() => setAdvanced(!advanced)} aria-expanded={advanced}>
                {advanced ? '−' : '+'} Advanced: steps, sampler, scheduler
                <span className="dim">{[form.steps !== 8 && form.steps !== 4 && `${form.steps} steps`, form.sampler !== SAMPLER_DEFAULT && form.sampler, form.scheduler !== SCHEDULER_DEFAULT && form.scheduler].filter(Boolean).join(' · ')}</span>
              </button>
              {advanced && (
                <div className="more-settings-body adv-grid">
                  <div className="create-field inline">
                    <span className="create-label mono">Steps</span>
                    <input className="mini" type="number" min={4} max={20} value={form.steps} onChange={(e) => set({ steps: Number(e.target.value) || 8 })} />
                  </div>
                  <div className="create-field inline">
                    <span className="create-label mono">Sampler</span>
                    <select value={form.sampler} onChange={(e) => set({ sampler: e.target.value })} aria-label="Sampler">
                      {[...new Set([form.sampler, ...(samplers?.samplers || [])])].map((n) => (
                        <option key={n} value={n}>
                          {n}
                          {n === SAMPLER_DEFAULT ? ' (default)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="create-field inline">
                    <span className="create-label mono">Scheduler</span>
                    <select value={form.scheduler} onChange={(e) => set({ scheduler: e.target.value })} aria-label="Scheduler">
                      {[...new Set([form.scheduler, ...(samplers?.schedulers || [])])].map((n) => (
                        <option key={n} value={n}>
                          {n}
                          {n === SCHEDULER_DEFAULT ? ' (default)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <p className="dim small adv-note">
                    For the previews. {samplers && !samplers.samplers.length ? 'Start ComfyUI to see every choice. ' : ''}er_sde with beta is what IV Studio is tuned on; the full-size finish keeps its own refine settings.
                    {(form.sampler !== SAMPLER_DEFAULT || form.scheduler !== SCHEDULER_DEFAULT) && (
                      <>
                        {' '}
                        <button className="link-btn" onClick={() => set({ sampler: SAMPLER_DEFAULT, scheduler: SCHEDULER_DEFAULT })}>
                          Back to the defaults
                        </button>
                      </>
                    )}
                  </p>
                </div>
              )}
            </div>
            )}
          </section>
        </div>

        {/* Your shot: the frame in its shape, what will render, and the button. Pinned while the steps scroll. */}
        <aside className="shot-card" aria-label="Your shot">
          <div className="shot-card-head mono">
            <span>Your shot</span>
            <span className="dim">{sd ? `Seedance · ${modeLabel}` : modeLabel}</span>
          </div>
          <ShotFrame aspect={form.aspect} media={form.media} mode={form.mode} char={char} face={faceOf(char)} seconds={form.seconds} />
          <div className="shot-time" aria-hidden="true">
            {Array.from({ length: 15 }, (_, i) => (
              <span key={i} className={i < Math.ceil((form.seconds * 15) / (sd ? 30 : 15)) ? 'on' : ''} />
            ))}
          </div>
          <dl className="shot-facts">
            <div>
              <dt>Who</dt>
              <dd>{char ? char.name : 'Nobody in particular'}</dd>
            </div>
            {!sd && form.extraLoras.length > 0 && (
              <div>
                <dt>LoRAs</dt>
                <dd>{form.extraLoras.map((l) => loraInfo(l.name)?.civitai?.name || loraTitle(l.name)).join(', ')}</dd>
              </div>
            )}
            {form.mode !== 'text' && (
              <div>
                <dt>{form.mode === 'frames' ? 'Frames' : form.mode === 'continue' ? 'Source' : 'References'}</dt>
                <dd>{counts.length || form.refmods.length ? [...counts, ...(form.refmods.length ? [['RefMod', form.refmods.length]] : [])].map(([k, n]) => `${n} ${k}${n > 1 ? 's' : ''}`).join(', ') : <span className="pink">none yet</span>}</dd>
              </div>
            )}
            <div>
              <dt>Voice line</dt>
              <dd>{form.voiceLine ? base(form.voiceLine) : 'None'}</dd>
            </div>
            {r ? (
              <>
                <div>
                  <dt>{sd ? 'Takes' : 'Previews'}</dt>
                  <dd>
                    {r.previews} × {r.width}×{r.height} · {r.seconds} s
                  </dd>
                </div>
                <div>
                  <dt>Finish</dt>
                  <dd>
                    {sd ? (r.draft ? `1080p with Seedance, or on this PC` : 'the take you pick, as it is') : `${finishLabel(finishFor(finishSpeed, { upscale2x: setup?.caps?.upscale2x !== false }))} → ${plan.finish.width}×${plan.finish.height}`}
                  </dd>
                </div>
                {sd && (
                  <div>
                    <dt>Price</dt>
                    <dd>{price ? price.label : '…'}</dd>
                  </div>
                )}
              </>
            ) : null}
            <div>
              <dt>Quality</dt>
              <dd>{sd ? `${TIERS.find(([id]) => id === form.tier)?.[1]} · ${form.audio ? 'with sound' : 'silent'}` : `${QUALITY.find(([s]) => s === form.steps)?.[1] || `${form.steps} steps`} · seed ${form.seed}`}</dd>
            </div>
          </dl>
          {!r && planError && <p className="shot-card-error small">{planError}</p>}
          {!sd && plan?.mode && plan.mode !== form.mode && <p className="dim small">Renders in References mode, for the @ pictures.</p>}
          {errors.length > 0 && !anyway && (
            <button className="link-btn mono small go-anyway" onClick={() => setAnyway(true)}>
              Render anyway
            </button>
          )}
          {eta?.line && <p className="eta-line small dim">{eta.line}</p>}
          <button className="btn btn-primary shot-card-go" disabled={!canHunt} onClick={hunt}>
            {huntLabel}
          </button>
        </aside>
      </div>

      {/* Narrow windows: the same, as a bar at the bottom of the window. */}
      <section className="go-dock create-dock">
        <div className="go-info">
          {r ? (
            <>
              <span className="mono">
                {r.previews} {sd ? 'take' : 'preview'}{r.previews > 1 ? 's' : ''} · {r.width} × {r.height} · {r.seconds} s · {sd ? 'Seedance 2.5' : r.model}
                {!sd && plan.mode && plan.mode !== form.mode ? ' · References (for the @ pictures)' : ''}
              </span>
              <span className="mono dim">{sd ? (price ? price.label : 'Working out the price…') : `${r.frames} frames · finish at ${finishLabel(finishFor(finishSpeed, { upscale2x: setup?.caps?.upscale2x !== false }))} → ${plan.finish.width} × ${plan.finish.height}`}</span>
            </>
          ) : (
            <span className="mono pink">{planError}</span>
          )}
        </div>
        {errors.length > 0 && !anyway && (
          <button className="link-btn mono small go-anyway" onClick={() => setAnyway(true)}>
            Render anyway
          </button>
        )}
        <button className="btn btn-primary" disabled={!canHunt} onClick={hunt}>
          {huntLabel}
        </button>
      </section>
      {editItem && <MediaEditor item={editItem} shotAspect={form.aspect} hint={editing === 'voice' ? 'Keep just the line to lip-sync. Write the same words in the prompt.' : editHint[form.mode]} onApply={applyEdit} onClose={() => setEditing(null)} notify={notify} />}
    </div>
  )
}

// Line icons for the four modes.
function ModeIcon({ id }) {
  const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }
  return (
    <svg className="mode-icon" viewBox="0 0 32 32" width="30" height="30" aria-hidden="true">
      {id === 'text' && (
        <g {...p}>
          <path d="M7 9h18M16 9v15M11 24h10" />
        </g>
      )}
      {id === 'reference' && (
        <g {...p}>
          <rect x="5" y="8" width="15" height="12" rx="1.5" />
          <rect x="12" y="13" width="15" height="12" rx="1.5" />
          <circle cx="17" cy="18" r="1.6" />
          <path d="M13 24l4-3.5 3 2.5 3-2 3 3" />
        </g>
      )}
      {id === 'frames' && (
        <g {...p}>
          <rect x="4" y="10" width="9" height="12" rx="1" />
          <rect x="19" y="10" width="9" height="12" rx="1" />
          <path d="M14.5 16h3M16 14.5l1.5 1.5-1.5 1.5" />
        </g>
      )}
      {id === 'continue' && (
        <g {...p}>
          <rect x="4" y="9" width="14" height="14" rx="1.5" />
          <path d="M7 9v14M15 9v14" />
          <path d="M21 16h7M25 13l3 3-3 3" />
        </g>
      )}
    </svg>
  )
}

// The shot in its shape, with what it starts from inside: the first frame or picture, the source clip, or the
// character's face; the shape changes as the aspect does.
function ShotFrame({ aspect, media, mode, char, face, seconds }) {
  const [w, h] = aspect.split(':').map(Number)
  const pic = media.find((m) => m.kind === 'picture')
  const vid = media.find((m) => m.kind === 'video')
  const src = pic ? fileUrl(pic.path) : null
  return (
    <div className="shot-frame-wrap">
      <div className="shot-frame" style={{ aspectRatio: `${w} / ${h}`, '--ar': w / h }}>
        {src ? (
          <img src={src} alt="" />
        ) : vid ? (
          <video src={`${fileUrl(vid.path)}#t=1`} muted preload="metadata" />
        ) : face ? (
          <img className="face" src={fileUrl(face)} alt="" />
        ) : (
          <span className="shot-frame-empty mono">{aspect}</span>
        )}
        {(() => {
          const tag = mode === 'frames' && pic ? 'First frame' : mode === 'continue' && vid ? 'Carries on' : char ? char.name.split(' ')[0] : null
          return tag && <span className="shot-frame-tag mono">{tag}</span>
        })()}
        <span className="shot-frame-len mono">{seconds} s</span>
      </div>
    </div>
  )
}
