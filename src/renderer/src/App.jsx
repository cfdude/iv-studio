import { useCallback, useEffect, useRef, useState } from 'react'
import { selectionFor } from './selection'
import { setSimpleWords } from './words'
import { applyA11y } from './a11y'
import { SetupPill } from './components/SetupProgress'
import { AgentPill, useAgentRun } from './components/AgentRun'
import ChatPanel, { ChatButton, useChat } from './components/ChatPanel'
import { spotTour } from './tours'
import { CharacterList, CharacterTrainer } from './components/Characters'
import Create from './components/Create'
import ivMark from './assets/iv-mark.png'
import ivMarkClosed from './assets/iv-mark-closed.png'
import { ConfirmHost, ask } from './components/Confirm'
import CloudModels from './components/CloudModels'
import { H3TermsHost } from './components/H3Terms'
import Library from './components/Library'
import Cloud, { CloudMeter } from './components/Cloud'
import StartComfy from './components/StartComfy'
import SystemMeter from './components/SystemMeter'
import { BalanceChip } from './components/ComfyAccount'
import { EditEditor, EditList } from './components/Edit'
import { SequenceEditor, SequenceList } from './components/Sequences'
import Settings from './components/Settings'
import { ShinobiList, ShinobiProject } from './components/Shinobi'
import Replace from './components/Replace'
import Reel from './components/Reel'
import Effects from './components/Effects'
import Workflows from './components/Workflows'
import { LinesPage, VoicesPage } from './components/Voices'
import { MusicPage } from './components/Music'
import { SoundsPage } from './components/Sounds'
import AudioHome from './components/AudioHome'
import MediaLibrary from './components/MediaLibrary'
import Dashboard from './components/Dashboard'
import TourHost from './components/Tour'
import { unseenNews } from './news'
import { ProjectPage, ProjectsList } from './components/Projects'
import RenderQueue from './components/RenderQueue'
import { LorasPage } from './components/Loras'
import Setup from './components/Setup'
import Images from './components/Images'
import { CreateKind } from './components/CreateKit'
import Shot from './components/Shot'
import Welcome from './components/Welcome'
import CloudWizard from './components/CloudWizard'
import { UpdateButton } from './components/Update'
import { SizzleList, SizzleProject } from './components/Sizzle'
import { RebuildList, RebuildProject } from './components/Rebuild'

// The sidebar's two halves, switched at its foot (Visual | Audio; the visual half's id is still 'video').
// Characters and Settings are in both; the Library (everything made, page 'media') sits above the switch and
// belongs to neither. Setup is a tab of Settings.
const SECTIONS = {
  video: [
    ['home', 'Dashboard'],
    ['create', 'Create'],
    ['projects', 'Projects'],
    ['library', 'Shots'],
    ['edits', 'Edit'],
    ['workflows', 'Workflows'],
    ['characters', 'Characters'],
    ['loras', 'LoRAs'],
    ['cloud', 'Cloud'],
    ['settings', 'Settings']
  ],
  audio: [
    ['audio', 'Audio'],
    ['voices', 'Voices'],
    ['lines', 'Lines'],
    ['music', 'Music'],
    ['sounds', 'Sounds'],
    ['characters', 'Characters'],
    ['settings', 'Settings']
  ]
}
const SUBPAGES = { settings: ['setup'], library: ['shot'], projects: ['project'], edits: ['edit'], characters: ['character'], workflows: ['sequences', 'sequence', 'shinobi', 'shinobi-film', 'replace', 'reel', 'effects', 'sizzle', 'sizzle-project', 'rebuild', 'rebuild-project'] }
const savedSection = () => {
  try {
    return localStorage.getItem('iv.section') === 'audio' ? 'audio' : 'video'
  } catch {
    return 'video'
  }
}

export default function App() {
  const [section, setSection] = useState(savedSection)
  // Create makes a video (a shot) or an image; the choice is remembered
  const [createKind, setCreateKind] = useState(() => {
    try {
      return localStorage.getItem('iv.createKind') === 'image' ? 'image' : 'video'
    } catch {
      return 'video'
    }
  })
  const pickCreateKind = (kind) => {
    setCreateKind(kind)
    try {
      localStorage.setItem('iv.createKind', kind)
    } catch {}
  }
  const [page, setPage] = useState(() => (savedSection() === 'audio' ? 'audio' : 'home'))
  // the Dashboard's agent run, for the title bar's pill while it works (AgentRun.jsx)
  const agentStatus = useAgentRun()
  // The page's own width without its scrollbar (--page-w), for the tall banners that run edge to edge: 100vw can't
  // know whether the page has a scrollbar, and was 15 px too wide when it did.
  const pageWatch = useRef(null)
  const watchPage = useCallback((el) => {
    pageWatch.current?.disconnect()
    pageWatch.current = null
    if (!el) return
    const set = () => document.documentElement.style.setProperty('--page-w', `${el.clientWidth}px`)
    set()
    pageWatch.current = new ResizeObserver(set)
    pageWatch.current.observe(el)
  }, [])
  // the chat panel with the person's own agent (ChatPanel.jsx); open or closed is remembered
  const [chatStatus, reloadChat] = useChat()
  const [chatOpen, setChatOpen] = useState(() => {
    try {
      return localStorage.getItem('iv.chatOpen') === '1'
    } catch {
      return false
    }
  })
  // the chat popped out into its own window (ChatWindow.jsx): the title-bar button brings that window forward
  const [chatPopped, setChatPopped] = useState(false)
  const poppedRef = useRef(false)
  poppedRef.current = chatPopped
  useEffect(() => {
    window.ivstudio.chat.popped().then(setChatPopped, () => {})
    const offPop = window.ivstudio.chat.onPopped((on) => setChatPopped(!!on))
    // put back in the app from its own window: the panel opens here
    const offDock = window.ivstudio.chat.onDocked(() => {
      poppedRef.current = false
      setChatPopped(false)
      toggleChat(true)
    })
    return () => (offPop(), offDock())
  }, [])
  const toggleChat = (on) => {
    if (on && poppedRef.current) {
      window.ivstudio.chat.popout().catch(() => {})
      return
    }
    setChatOpen(on)
    try {
      localStorage.setItem('iv.chatOpen', on ? '1' : '0')
    } catch {}
    if (on) reloadChat()
  }
  // a question from a button elsewhere ("Ask Claude Code to fix it", ChatPanel askAgent): open the chat and hand it over
  const [chatAsk, setChatAsk] = useState(null)
  useEffect(() => {
    const onAsk = (e) => {
      // with the chat in its own window, the question goes there
      if (poppedRef.current) return void window.ivstudio.chat.forwardAsk(e.detail).catch(() => {})
      setChatAsk({ ...e.detail, at: Date.now() })
      toggleChat(true)
    }
    window.addEventListener('iv:ask', onAsk)
    // "show me where" from the chat (show_in_app): a one-step tour that goes to the page and lights the part up
    const offShow = window.ivstudio.chat.onShow((show) => {
      const tour = spotTour(show || {})
      if (tour) window.dispatchEvent(new CustomEvent('iv:tour', { detail: tour }))
    })
    return () => (window.removeEventListener('iv:ask', onAsk), offShow())
  }, [])
  // a spoken line or a song on its way to Create's voice line (Lines or Music > Use in a shot)
  const [lineForCreate, setLineForCreate] = useState(null)
  // a LoRA on its way to Create's LoRA tray (LoRAs > Use in a shot)
  const [loraForCreate, setLoraForCreate] = useState(null)
  const [loraForImage, setLoraForImage] = useState(null)
  const [pictureForImage, setPictureForImage] = useState(null)
  // a picture from Create -> Image on its way to a shot's first frame (Use in a shot)
  const [pictureForCreate, setPictureForCreate] = useState(null)
  // a character picked on the dashboard (New shot with them)
  const [characterForCreate, setCharacterForCreate] = useState(null)
  // a shot's run on its way back to Create to be edited and run again in the same shot
  const [runForCreate, setRunForCreate] = useState(null)
  const [projectId, setProjectId] = useState(null)
  const [sequenceId, setSequenceId] = useState(null)
  const [sequenceFocus, setSequenceFocus] = useState(null)
  const [productionId, setProductionId] = useState(null) // the open Project
  const [editId, setEditId] = useState(null)
  const [trainingId, setTrainingId] = useState(null)
  const [shinobiId, setShinobiId] = useState(null)
  const [setup, setSetup] = useState(null)
  const [checking, setChecking] = useState(false)
  const [characters, setCharacters] = useState([])
  const [info, setInfo] = useState(null)
  const [toast, setToast] = useState(null)
  const [jobs, setJobs] = useState({})
  const toastTimer = useRef(null)
  // The editor's full-screen workspace hides the title bar and sidebar; leaving the editor ends it.
  const [focus, setFocus] = useState(false)
  useEffect(() => {
    if (page !== 'edit' && focus) {
      setFocus(false)
      window.ivstudio.edits.fullScreen(false).catch(() => {})
    }
  }, [page])

  const notify = useCallback((text, kind = 'error') => {
    setToast({ text, kind })
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 7000)
  }, [])

  // the cloud setup ending (on any page): a message, and the notification's click opens the Cloud page
  useEffect(() => {
    const offDone = window.ivstudio.cloud.onSetupDone?.((d) => notify(`${d.title}. ${d.body}`, d.ok ? 'ok' : 'error'))
    const offOpen = window.ivstudio.cloud.onOpen?.(() => setPage('cloud'))
    return () => (offDone?.(), offOpen?.())
  }, [notify])

  const recheck = useCallback(async () => {
    setChecking(true)
    try {
      setSetup(await window.ivstudio.setup.check())
    } catch (err) {
      setSetup({ ready: false, items: [{ id: 'comfyui', label: 'ComfyUI', status: 'missing', detail: err.message }] })
    } finally {
      setChecking(false)
    }
  }, [])

  // ComfyUI was running but too busy to answer (loading a model, rendering): look again shortly by itself
  const comfyBusy = setup?.items?.some((i) => i.id === 'comfyui' && i.busy)
  useEffect(() => {
    if (!comfyBusy) return
    const t = setTimeout(recheck, 10000)
    return () => clearTimeout(t)
  }, [comfyBusy, setup, recheck])

  useEffect(() => {
    recheck()
    window.ivstudio.characters.list().then(setCharacters)
    window.ivstudio.app.info().then(setInfo)
    return window.ivstudio.jobs.onUpdate((job) => setJobs((all) => ({ ...all, [job.id]: job })))
  }, [recheck])


  const openShinobi = (id) => {
    setShinobiId(id)
    setPage('shinobi-film')
  }
  const [sizzleId, setSizzleId] = useState(null)
  const openSizzle = (id) => {
    setSizzleId(id)
    switchSection('video')
    setPage('sizzle-project')
  }
  const [rebuildId, setRebuildId] = useState(null)
  const openRebuild = (id) => {
    setRebuildId(id)
    switchSection('video')
    setPage('rebuild-project')
  }

  const openCharacter = (id) => {
    setTrainingId(id)
    setPage('character')
  }

  const switchSection = (next) => {
    if (next === section) return
    setSection(next)
    try {
      localStorage.setItem('iv.section', next)
    } catch {}
    if (page !== 'media' && !SECTIONS[next].some(([id]) => id === page || SUBPAGES[id]?.includes(page))) setPage(SECTIONS[next][0][0])
  }
  // Shots, Sequences and Edit are on the Video side; the Library and Music open them from anywhere
  const openShot = (id) => {
    setProjectId(id)
    switchSection('video')
    setPage('shot')
  }
  const openProject = (id) => {
    setProductionId(id)
    switchSection('video')
    setPage('project')
  }
  // focus: { runId, prompt } — open on the shot a run belongs to, optionally with a revised prompt to edit
  const openSequence = (id, focus = null) => {
    setSequenceFocus(focus)
    setSequenceId(id)
    switchSection('video')
    setPage('sequence')
  }
  // The dashboard's quick-start cards, and "New shot" with one of the cast.
  const startTool = (id) => {
    const to = (sect, pg) => (switchSection(sect), setPage(pg))
    if (id === 'shot' || id === 'picture') return (pickCreateKind(id === 'shot' ? 'video' : 'image'), to('video', 'create'))
    if (id === 'music') return to('audio', 'music')
    if (id === 'line') return to('audio', 'lines')
    if (id === 'sequence') return to('video', 'sequences')
    if (id === 'film') return to('video', 'projects')
    if (id === 'edit') return to('video', 'edits')
    if (id === 'sizzle') return to('video', 'sizzle')
    if (id === 'character') return to('video', 'characters')
  }
  const startShotWith = (characterId) => {
    setCharacterForCreate(characterId)
    startTool('shot')
  }
  // A render-queue item opens the page it belongs to.
  const openQueued = (item) => {
    if (item.sequenceId) return openSequence(item.sequenceId)
    if (['previews', 'finish'].includes(item.kind) && item.projectId) return openShot(item.projectId)
    if (item.kind?.startsWith('picture')) {
      pickCreateKind('image')
      switchSection('video')
      return setPage('create')
    }
    if (item.kind === 'music' || item.kind === 'sound') {
      switchSection('audio')
      return setPage(item.kind === 'sound' ? 'sounds' : 'music')
    }
    if (item.kind === 'replace') {
      switchSection('video')
      return setPage('replace')
    }
  }
  const openEdit = (id) => {
    setEditId(id)
    switchSection('video')
    setPage('edit')
  }
  const pictureToShot = (file) => {
    setPictureForCreate(file)
    pickCreateKind('video')
    switchSection('video')
    setPage('create')
  }
  // a LoRA for a picture model goes to Create -> Image (that model's tray); H3's to the shot tray
  const addLoraToCreate = (lora) => {
    const picture = lora.family && lora.family !== 'h3'
    if (picture) setLoraForImage(lora)
    else setLoraForCreate(lora)
    pickCreateKind(picture ? 'image' : 'video')
    switchSection('video')
    setPage('create')
  }
  // prompt: a revised prompt (a take review's) to start from instead of the run's own
  // A run of a sequence's shot-by-shot project is edited in the sequence, so the new render stays that shot's.
  const editRun = (run, project, prompt) => {
    if (project.sequenceId) return openSequence(project.sequenceId, { runId: run.id, prompt: prompt || null })
    setRunForCreate({ request: run.plan.request, asked: prompt ? { ...(run.plan.asked || {}), prompt } : run.plan.asked, projectId: project.id, projectName: project.name })
    pickCreateKind('video')
    switchSection('video')
    setPage('create')
  }
  // A new shot that starts where a finished version ends: Continue mode with the version as its source video, or
  // Frames mode with its last frame as the first frame. The run's character, LoRAs, shape, size and length come
  // along; the prompt starts empty, because it says what happens next (Write it for me looks at the last frame).
  const shotFromVersion = (run, how, file) => {
    const q = run.plan?.request || {}
    const media = how === 'continue' ? [{ kind: 'video', path: file }] : [{ kind: 'picture', path: file }]
    setRunForCreate({ request: { ...q, mode: how === 'continue' ? 'continue' : 'frames', media, prompt: '' }, asked: null, projectId: null, projectName: '', from: how })
    pickCreateKind('video')
    switchSection('video')
    setPage('create')
  }
  // a picture (a version's last frame) to change in Create -> Image's Edit
  const pictureToEdit = (file) => {
    setPictureForImage(file)
    pickCreateKind('image')
    switchSection('video')
    setPage('create')
  }
  // Go to a page from outside App's props (an iv:go event): the page, its sidebar half, and Create's switch and
  // mode (which reach Create and Image through the iv:learn event, once they've opened).
  const learnGo = (to) => {
    switchSection(to.section || 'video')
    if (to.create) pickCreateKind(to.create)
    setPage(to.page)
    if (to.mode) setTimeout(() => window.dispatchEvent(new CustomEvent('iv:learn', { detail: to })), 250)
  }
  const [seenNews, setSeenNews] = useState(() => {
    try {
      return localStorage.getItem('iv.seenNews')
    } catch {
      return null
    }
  })
  useEffect(() => {
    const go = (e) => learnGo(e.detail)
    window.addEventListener('iv:go', go)
    return () => window.removeEventListener('iv:go', go)
  })
  const markNewsSeen = (version) => {
    setSeenNews(version)
    try {
      localStorage.setItem('iv.seenNews', version)
    } catch {}
  }
  // the editor's "Remake this clip": Replace opens with that stretch of the clip
  const [replaceSeed, setReplaceSeed] = useState(null)
  const remakeClip = (seed) => {
    setReplaceSeed({ ...seed, at: Date.now() })
    setPage('replace')
  }
  const sendToCreate = (line) => {
    setLineForCreate(line)
    switchSection('video')
    setPage('create')
  }

  const ready = setup?.ready
  // the welcome wizard: on first launch, and again from Settings → Check my PC (the iv:welcome event)
  const [welcome, setWelcome] = useState(null)
  const [cloudWiz, setCloudWiz] = useState(false)
  useEffect(() => {
    window.ivstudio.settings.get().then((s) => (setSimpleWords(s.plainWords), applyA11y(s), !s.onboarded && setWelcome('first')), () => {})
    // Simple words (words.js) and Settings → Accessibility (a11y.js), whenever the settings change (Settings, Check my PC)
    const words = () => window.ivstudio.settings.get().then((s) => (setSimpleWords(s.plainWords), applyA11y(s)), () => {})
    window.addEventListener('iv:settings', words)
    const open = () => setWelcome('again')
    window.addEventListener('iv:welcome', open)
    // the cloud setup wizard: from Check my PC and the Cloud page
    const cloud = () => setCloudWiz(true)
    window.addEventListener('iv:cloud-wizard', cloud)
    return () => (window.removeEventListener('iv:welcome', open), window.removeEventListener('iv:cloud-wizard', cloud), window.removeEventListener('iv:settings', words))
  }, [])
  const ctx = { setup, caps: setup?.caps, remote: !!setup?.remote, ownCloud: !!setup?.remote && !setup?.hosted, recheck, checking, characters, setCharacters, notify, openShot, editRun, openSequence, openProject, openEdit, openCharacter, openShinobi, jobs, setJobs, info, go: setPage, sendToCreate, addLoraToCreate, pictureToShot, shotFromVersion, pictureToEdit, focus, setFocus, openSizzle, openRebuild,remakeClip, replaceSeed }
  const missing = setup?.items?.filter((i) => i.status === 'missing').length || 0
  // ComfyUI on this PC isn't there: the title bar offers to start it (not when it's running but busy)
  const comfyDown = !setup?.remote && setup?.items?.some((i) => i.id === 'comfyui' && i.status !== 'ok' && !i.busy)

  // Incognito: a private set of everything made, switched by restarting (see main's BASE / DATA). The eye
  // art closes while it's on.
  const incognito = !!info?.incognito
  async function switchIncognito() {
    const ok = await ask(
      incognito
        ? { title: 'Leave Incognito?', message: 'IV Studio restarts into your normal shots, edits, songs and voices. Everything made in Incognito stays where it is, hidden, until you switch back. Its renders are also cleared from ComfyUI’s history.', confirm: 'Leave Incognito' }
        : { title: 'Go Incognito?', message: 'IV Studio restarts into a separate, private space. Shots, sequences, edits, songs, voices, characters and exports made there never show in the normal app, and nothing normal shows there. Your characters and voices come along; settings and models are shared. Renders save into the Incognito folder in Settings → Folders (output\\IV Private unless you change it).', confirm: 'Go Incognito' }
    )
    if (!ok) return
    try {
      await window.ivstudio.incognito.set(!incognito)
    } catch (err) {
      notify(err.message)
    }
  }

  // what the chat is told about the page (agentchat.js contextLine); with the chat in its own window, this page and
  // the selection on it (selection.js) go to the main process as they change, for messages sent from there
  const chatContext = { page, section, projectId: page === 'shot' ? projectId : null, productionId: page === 'project' ? productionId : null, sequenceId: page === 'sequence' ? sequenceId : null, editId: page === 'edit' ? editId : null, sizzleId: page === 'sizzle-project' ? sizzleId : null, rebuildId: page === 'rebuild-project' ? rebuildId : null, shinobiId: page === 'shinobi-film' ? shinobiId : null, trainingId: page === 'character' ? trainingId : null }
  const ctxKey = JSON.stringify(chatContext)
  useEffect(() => {
    if (!chatPopped) return
    const push = () => window.ivstudio.chat.setContext({ ...chatContext, selection: selectionFor(chatContext.page) }).catch(() => {})
    push()
    window.addEventListener('iv:selection', push)
    return () => window.removeEventListener('iv:selection', push)
  }, [ctxKey, chatPopped])
  // a link in the chat or its Activity tab (ActivityLog.jsx openOf), here or from the chat's own window
  const openRef = (kind, id) => {
    if (kind === 'shot') return openShot(id)
    if (kind === 'edit') return openEdit(id)
    if (kind === 'film') return openProject(id)
    if (kind === 'sequence') return openSequence(id)
    if (kind === 'shots') return (switchSection('video'), setPage('library'))
    if (kind === 'images') return (pickCreateKind('image'), switchSection('video'), setPage('create'))
    if (['music', 'lines', 'voices'].includes(kind)) return (switchSection('audio'), setPage(kind))
  }
  const openRefNow = useRef(openRef)
  openRefNow.current = openRef
  useEffect(() => window.ivstudio.chat.onOpenInApp((w) => w?.kind && openRefNow.current(w.kind, w.id)), [])
  return (
    <div className={`app ${incognito ? 'incognito' : ''} ${focus && page === 'edit' ? 'app-focus' : ''} ${info?.platform === 'darwin' ? 'mac' : ''} ${chatOpen && !chatPopped ? 'chat-on' : ''}`}>
      <header className="titlebar">
        <img className="brand-logo" src={incognito ? ivMarkClosed : ivMark} alt="Infinite Variance" />
        <span className="mono brand-text">Infinite Variance</span>
        <span className="mono dim brand-text">/ Studio</span>
        {info?.testCopy && (
          <span className="mono test-copy">
            Test copy<span className="test-copy-more"> · separate data</span>
          </span>
        )}
        {info && (
          <button className={`incognito-switch mono ${incognito ? 'on' : ''}`} onClick={switchIncognito} title={incognito ? 'Leave Incognito (restarts IV Studio)' : 'Go Incognito: a private space (restarts IV Studio)'}>
            <span className="switch-track">
              <span className="switch-knob" />
            </span>
            <span className="incognito-label">Incognito</span>
          </button>
        )}
        <AgentPill status={agentStatus} onOpen={() => window.dispatchEvent(new CustomEvent('iv:go', { detail: { page: 'home', section: 'video' } }))} />
        <ChatButton open={chatOpen && !chatPopped} popped={chatPopped} busy={!!chatStatus?.chat?.busy} onClick={() => toggleChat(!chatOpen)} />
        <div className={`engine-badge ${setup ? (ready ? 'ready' : 'error') : ''}`}>
          <span className="dot" />
          {setup?.remote && <span className="mono cloud-badge">Cloud</span>}
          <span className="mono">{!setup ? 'Checking ComfyUI' : ready ? 'ComfyUI ready' : `${missing} to fix`}</span>
          {comfyDown && info?.platform === 'darwin' && (
            <button className="btn btn-small engine-start" onClick={() => setPage('cloud')} title="Shots need an NVIDIA GPU: render them on your RunPod or Modal account, or on Comfy Cloud">
              Use the cloud
            </button>
          )}
          {/* on a Mac the cloud comes first; Start ComfyUI stays on Settings → Setup */}
          {comfyDown && info?.platform !== 'darwin' && <StartComfy notify={notify} recheck={recheck} className="btn btn-small engine-start" />}
          {setup?.items?.find((i) => i.id === 'gpu') && <span className="mono dim engine-gpu">{setup.items.find((i) => i.id === 'gpu').detail}</span>}
          <SetupPill onOpen={() => setPage('cloud')} />
          {setup?.remote ? <CloudMeter onOpen={() => setPage('cloud')} /> : setup && <SystemMeter notify={notify} />}
          <BalanceChip />
        </div>
      </header>
      <nav className="nav">
        {SECTIONS[section].map(([id, label], i) => (
          <button key={id} className={`nav-item ${page === id || SUBPAGES[id]?.includes(page) ? 'on' : ''}`} onClick={() => setPage(id)}>
            <span className="mono dim">{String(i + 1).padStart(2, '0')}</span>
            {label}
            {id === 'settings' && missing > 0 && <span className="nav-dot" />}
          </button>
        ))}
        <div className="nav-foot mono">
          <RenderQueue remote={!!setup?.remote} notify={notify} open={openQueued} />
          <button className={`nav-library ${page === 'media' ? 'on' : ''}`} onClick={() => setPage('media')}>
            Library
          </button>
          <div className="section-switch" role="tablist" aria-label="Visual or audio">
            {['video', 'audio'].map((id) => (
              <button key={id} role="tab" aria-selected={section === id} className={section === id ? 'on' : ''} onClick={() => switchSection(id)}>
                {id === 'video' ? 'Visual' : 'Audio'}
              </button>
            ))}
          </div>
          <UpdateButton notify={notify} />
          <button className="link-btn mono nav-site" onClick={() => window.ivstudio.links.open(info?.links?.website || 'https://infinitevariance.ai')}>
            infinitevariance.ai ↗
          </button>
        </div>
      </nav>
      {/* keyed by page: each page change remounts it, so the themed page-in animation plays (studio.css .page-anim) */}
      <main key={page} ref={watchPage} className={`page page-anim ${page === 'edit' ? 'page-editor' : ''}`}>
        {page === 'home' && <Dashboard {...ctx} start={startTool} startShotWith={startShotWith} news={unseenNews(info?.version, seenNews)} dismissNews={() => markNewsSeen(info?.version)} />}
        {page === 'create' &&
          (createKind === 'image' ? (
            <Images {...ctx} kindSwitch={<CreateKind kind={createKind} onKind={pickCreateKind} />} incomingLora={loraForImage} clearIncomingLora={() => setLoraForImage(null)} incomingPicture={pictureForImage} clearIncomingPicture={() => setPictureForImage(null)} />
          ) : (
            <Create {...ctx} kindSwitch={<CreateKind kind={createKind} onKind={pickCreateKind} />} incomingLine={lineForCreate} clearIncomingLine={() => setLineForCreate(null)} incomingLora={loraForCreate} clearIncomingLora={() => setLoraForCreate(null)} incomingPicture={pictureForCreate} clearIncomingPicture={() => setPictureForCreate(null)} incomingCharacter={characterForCreate} clearIncomingCharacter={() => setCharacterForCreate(null)} incomingRun={runForCreate} clearIncomingRun={() => setRunForCreate(null)} />
          ))}
        {page === 'loras' && <LorasPage {...ctx} />}
        {page === 'audio' && <AudioHome {...ctx} />}
        {page === 'voices' && <VoicesPage {...ctx} />}
        {page === 'lines' && <LinesPage {...ctx} />}
        {page === 'music' && <MusicPage {...ctx} />}
        {page === 'sounds' && <SoundsPage {...ctx} />}
        {page === 'media' && <MediaLibrary {...ctx} />}
        {page === 'library' && <Library {...ctx} />}
        {page === 'shot' && projectId && <Shot key={projectId} projectId={projectId} {...ctx} />}
        {page === 'projects' && <ProjectsList {...ctx} />}
        {page === 'project' && productionId && <ProjectPage key={productionId} productionId={productionId} {...ctx} />}
        {page === 'sequences' && <SequenceList {...ctx} />}
        {page === 'sequence' && sequenceId && <SequenceEditor key={sequenceId} sequenceId={sequenceId} {...ctx} shotFocus={sequenceFocus} clearShotFocus={() => setSequenceFocus(null)} />}
        {page === 'edits' && <EditList {...ctx} />}
        {page === 'edit' && editId && <EditEditor key={editId} editId={editId} {...ctx} />}
        {page === 'workflows' && <Workflows {...ctx} />}
        {page === 'replace' && <Replace {...ctx} />}
        {page === 'reel' && <Reel {...ctx} />}
        {page === 'effects' && <Effects {...ctx} />}
        {page === 'shinobi' && <ShinobiList {...ctx} />}
        {page === 'sizzle' && <SizzleList {...ctx} />}
        {page === 'sizzle-project' && sizzleId && <SizzleProject key={sizzleId} sizzleId={sizzleId} {...ctx} />}
        {page === 'rebuild' && <RebuildList {...ctx} />}
        {page === 'rebuild-project' && rebuildId && <RebuildProject key={rebuildId} rebuildId={rebuildId} {...ctx} />}
        {page === 'shinobi-film' && shinobiId && <ShinobiProject key={shinobiId} projectId={shinobiId} {...ctx} />}
        {page === 'characters' && <CharacterList {...ctx} startShotWith={startShotWith} />}
        {page === 'character' && trainingId && <CharacterTrainer key={trainingId} trainingId={trainingId} {...ctx} />}
        {page === 'setup' && <Setup {...ctx} />}
        {page === 'cloud' && <Cloud {...ctx} />}
        {page === 'settings' && <Settings {...ctx} />}
      </main>
      {chatOpen && !chatPopped && (
        <ChatPanel
          status={chatStatus}
          reload={reloadChat}
          onClose={() => toggleChat(false)}
          context={chatContext}
          go={setPage}
          notify={notify}
          ask={chatAsk}
          clearAsk={() => setChatAsk(null)}
          openShot={openShot}
          openRef={openRef}
        />
      )}
      <ConfirmHost />
      <CloudModels />
      <H3TermsHost />
      {cloudWiz && <CloudWizard onClose={() => (setCloudWiz(false), recheck?.(), window.dispatchEvent(new CustomEvent('iv:cloud-changed')))} notify={notify} recheck={recheck} info={info} />}
      <TourHost />
      {welcome && <Welcome first={welcome === 'first'} onClose={() => (setWelcome(null), recheck?.())} go={setPage} notify={notify} />}
      {toast && (
        <div className={`toast ${toast.kind}`} onClick={() => setToast(null)}>
          {toast.text}
        </div>
      )}
    </div>
  )
}
