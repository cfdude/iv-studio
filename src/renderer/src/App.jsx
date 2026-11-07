import { useCallback, useEffect, useRef, useState } from 'react'
import { CharacterList, CharacterTrainer } from './components/Characters'
import Create from './components/Create'
import ivMark from './assets/iv-mark.png'
import ivMarkClosed from './assets/iv-mark-closed.png'
import { ConfirmHost, ask } from './components/Confirm'
import Library from './components/Library'
import Cloud, { CloudMeter } from './components/Cloud'
import StartComfy from './components/StartComfy'
import SystemMeter from './components/SystemMeter'
import { EditEditor, EditList } from './components/Edit'
import { SequenceEditor, SequenceList } from './components/Sequences'
import Settings from './components/Settings'
import { ShinobiList, ShinobiProject } from './components/Shinobi'
import Replace from './components/Replace'
import Reel from './components/Reel'
import Workflows from './components/Workflows'
import { LinesPage, VoicesPage } from './components/Voices'
import { MusicPage } from './components/Music'
import MediaLibrary from './components/MediaLibrary'
import Dashboard from './components/Dashboard'
import Learn from './components/Learn'
import { unseenNews } from './learn'
import { sepText } from '../../shared/platform'
import { usePlatform } from './platform'
import { ProjectPage, ProjectsList } from './components/Projects'
import RenderQueue from './components/RenderQueue'
import { LorasPage } from './components/Loras'
import Setup from './components/Setup'
import Images, { CreateKind } from './components/Images'
import Shot from './components/Shot'
import { UpdateButton } from './components/Update'
import { SizzleList, SizzleProject } from './components/Sizzle'

// The sidebar's two halves, switched at its foot (Visual | Audio; the visual half's id is still 'video').
// Characters and Settings are in both; the Library (everything made, page 'media') sits above the switch and
// belongs to neither. Setup is a tab of Settings.
const SECTIONS = {
  video: [
    ['home', 'Dashboard'],
    ['learn', 'Learn'],
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
    ['voices', 'Voices'],
    ['lines', 'Lines'],
    ['music', 'Music'],
    ['characters', 'Characters'],
    ['settings', 'Settings']
  ]
}
const SUBPAGES = { settings: ['setup'], library: ['shot'], projects: ['project'], edits: ['edit'], characters: ['character'], workflows: ['sequences', 'sequence', 'shinobi', 'shinobi-film', 'replace', 'reel', 'sizzle', 'sizzle-project'] }
const savedSection = () => {
  try {
    return localStorage.getItem('iv.section') === 'audio' ? 'audio' : 'video'
  } catch {
    return 'video'
  }
}

export default function App() {
  const platform = usePlatform()
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
  const [page, setPage] = useState(() => (savedSection() === 'audio' ? 'voices' : 'home'))
  // a spoken line or a song on its way to Create's voice line (Lines or Music > Use in a shot)
  const [lineForCreate, setLineForCreate] = useState(null)
  // a LoRA on its way to Create's LoRA tray (LoRAs > Use in a shot)
  const [loraForCreate, setLoraForCreate] = useState(null)
  // a picture from Create -> Image on its way to a shot's first frame (Use in a shot)
  const [pictureForCreate, setPictureForCreate] = useState(null)
  // a character picked on the dashboard (New shot with them)
  const [characterForCreate, setCharacterForCreate] = useState(null)
  // a shot's run on its way back to Create to be edited and run again in the same shot
  const [runForCreate, setRunForCreate] = useState(null)
  const [projectId, setProjectId] = useState(null)
  const [sequenceId, setSequenceId] = useState(null)
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
  const openSequence = (id) => {
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
    if (item.kind === 'music') {
      switchSection('audio')
      return setPage('music')
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
  const addLoraToCreate = (lora) => {
    setLoraForCreate(lora)
    switchSection('video')
    setPage('create')
  }
  // prompt: a revised prompt (a take review's) to start from instead of the run's own
  const editRun = (run, project, prompt) => {
    setRunForCreate({ request: run.plan.request, asked: prompt ? { ...(run.plan.asked || {}), prompt } : run.plan.asked, projectId: project.id, projectName: project.name })
    pickCreateKind('video')
    switchSection('video')
    setPage('create')
  }
  // Learn's Try it: the page a card lives on (Create in the right switch and mode). The mode reaches Create and
  // Image through the iv:learn event, once they've opened.
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
  // The "?" panels' "More on the Learn page" (Help.jsx), which sits outside App's props
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
  const sendToCreate = (line) => {
    setLineForCreate(line)
    switchSection('video')
    setPage('create')
  }

  const ready = setup?.ready
  const ctx = { setup, caps: setup?.caps, remote: !!setup?.remote, recheck, checking, characters, setCharacters, notify, openShot, editRun, openSequence, openProject, openEdit, openCharacter, openShinobi, jobs, setJobs, info, go: setPage, sendToCreate, addLoraToCreate, pictureToShot, focus, setFocus, openSizzle }
  const missing = setup?.items?.filter((i) => i.status === 'missing').length || 0
  // ComfyUI on this PC isn't answering: the title bar offers to start it
  const comfyDown = !setup?.remote && setup?.items?.some((i) => i.id === 'comfyui' && i.status !== 'ok')

  // Incognito: a private set of everything made, switched by restarting (see main's BASE / DATA). The eye
  // art closes while it's on.
  const incognito = !!info?.incognito
  async function switchIncognito() {
    const ok = await ask(
      incognito
        ? { title: 'Leave Incognito?', message: 'IV Studio restarts into your normal shots, edits, songs and voices. Everything made in Incognito stays where it is, hidden, until you switch back. Its renders are also cleared from ComfyUI’s history.', confirm: 'Leave Incognito' }
        : { title: 'Go Incognito?', message: 'IV Studio restarts into a separate, private space. Shots, sequences, edits, songs, voices, characters and exports made there never show in the normal app, and nothing normal shows there. Your characters and voices come along; settings and models are shared. Renders save into the Incognito folder in Settings → Folders (output' + sepText(platform) + 'IV Private unless you change it).', confirm: 'Go Incognito' }
    )
    if (!ok) return
    try {
      await window.ivstudio.incognito.set(!incognito)
    } catch (err) {
      notify(err.message)
    }
  }

  return (
    <div className={`app ${incognito ? 'incognito' : ''} ${focus && page === 'edit' ? 'app-focus' : ''}`}>
      <header className="titlebar">
        <img className="brand-logo" src={incognito ? ivMarkClosed : ivMark} alt="Infinite Variance" />
        <span className="mono">Infinite Variance</span>
        <span className="mono dim">/ Studio</span>
        {info?.testCopy && <span className="mono test-copy">Test copy · separate data</span>}
        {info && (
          <button className={`incognito-switch mono ${incognito ? 'on' : ''}`} onClick={switchIncognito} title={incognito ? 'Leave Incognito (restarts IV Studio)' : 'Go Incognito: a private space (restarts IV Studio)'}>
            <span className="switch-track">
              <span className="switch-knob" />
            </span>
            Incognito
          </button>
        )}
        <div className={`engine-badge ${setup ? (ready ? 'ready' : 'error') : ''}`}>
          <span className="dot" />
          {setup?.remote && <span className="mono cloud-badge">Cloud</span>}
          <span className="mono">{!setup ? 'Checking ComfyUI' : ready ? 'ComfyUI ready' : `${missing} to fix`}</span>
          {comfyDown && <StartComfy notify={notify} recheck={recheck} className="btn btn-small engine-start" />}
          {setup?.items?.find((i) => i.id === 'gpu') && <span className="mono dim">{setup.items.find((i) => i.id === 'gpu').detail}</span>}
          {setup?.remote ? <CloudMeter onOpen={() => setPage('cloud')} /> : setup && <SystemMeter />}
        </div>
      </header>
      <nav className="nav">
        {SECTIONS[section].map(([id, label], i) => (
          <button key={id} className={`nav-item ${page === id || SUBPAGES[id]?.includes(page) ? 'on' : ''}`} onClick={() => setPage(id)}>
            <span className="mono dim">{String(i + 1).padStart(2, '0')}</span>
            {label}
            {id === 'settings' && missing > 0 && <span className="nav-dot" />}
            {id === 'learn' && unseenNews(info?.version, seenNews) && <span className="nav-dot" title="What's new" />}
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
      <main className={`page ${page === 'edit' ? 'page-editor' : ''}`}>
        {page === 'home' && <Dashboard {...ctx} start={startTool} startShotWith={startShotWith} />}
        {page === 'learn' && <Learn learnGo={learnGo} version={info?.version} seenNews={seenNews} markNewsSeen={markNewsSeen} notify={notify} />}
        {page === 'create' &&
          (createKind === 'image' ? (
            <Images {...ctx} kindSwitch={<CreateKind kind={createKind} onKind={pickCreateKind} />} />
          ) : (
            <Create {...ctx} kindSwitch={<CreateKind kind={createKind} onKind={pickCreateKind} />} incomingLine={lineForCreate} clearIncomingLine={() => setLineForCreate(null)} incomingLora={loraForCreate} clearIncomingLora={() => setLoraForCreate(null)} incomingPicture={pictureForCreate} clearIncomingPicture={() => setPictureForCreate(null)} incomingCharacter={characterForCreate} clearIncomingCharacter={() => setCharacterForCreate(null)} incomingRun={runForCreate} clearIncomingRun={() => setRunForCreate(null)} />
          ))}
        {page === 'loras' && <LorasPage {...ctx} />}
        {page === 'voices' && <VoicesPage {...ctx} />}
        {page === 'lines' && <LinesPage {...ctx} />}
        {page === 'music' && <MusicPage {...ctx} />}
        {page === 'media' && <MediaLibrary {...ctx} />}
        {page === 'library' && <Library {...ctx} />}
        {page === 'shot' && projectId && <Shot key={projectId} projectId={projectId} {...ctx} />}
        {page === 'projects' && <ProjectsList {...ctx} />}
        {page === 'project' && productionId && <ProjectPage key={productionId} productionId={productionId} {...ctx} />}
        {page === 'sequences' && <SequenceList {...ctx} />}
        {page === 'sequence' && sequenceId && <SequenceEditor key={sequenceId} sequenceId={sequenceId} {...ctx} />}
        {page === 'edits' && <EditList {...ctx} />}
        {page === 'edit' && editId && <EditEditor key={editId} editId={editId} {...ctx} />}
        {page === 'workflows' && <Workflows {...ctx} />}
        {page === 'replace' && <Replace {...ctx} />}
        {page === 'reel' && <Reel {...ctx} />}
        {page === 'shinobi' && <ShinobiList {...ctx} />}
        {page === 'sizzle' && <SizzleList {...ctx} />}
        {page === 'sizzle-project' && sizzleId && <SizzleProject key={sizzleId} sizzleId={sizzleId} {...ctx} />}
        {page === 'shinobi-film' && shinobiId && <ShinobiProject key={shinobiId} projectId={shinobiId} {...ctx} />}
        {page === 'characters' && <CharacterList {...ctx} />}
        {page === 'character' && trainingId && <CharacterTrainer key={trainingId} trainingId={trainingId} {...ctx} />}
        {page === 'setup' && <Setup {...ctx} />}
        {page === 'cloud' && <Cloud {...ctx} />}
        {page === 'settings' && <Settings {...ctx} />}
      </main>
      <ConfirmHost />
      {toast && (
        <div className={`toast ${toast.kind}`} onClick={() => setToast(null)}>
          {toast.text}
        </div>
      )}
    </div>
  )
}
