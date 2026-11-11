import { useEffect, useRef, useState } from 'react'
import { AgentRows, useAgentSetup } from './AgentSetup'
import ActivityLog from './ActivityLog'
import { selectionFor } from '../selection'
import { chatLines } from '../chatText'

const fileUrl = (p) => `ivfile://local/?p=${encodeURIComponent(p)}`
const tokens = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n || 0))
const timeOf = (at) => (at ? new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '')

// The chat with the person's own Claude Code or Codex (src/service/agentchat.js): a panel down the right side, over
// whatever page is open. Every IV Studio tool; anything that deletes, costs money, installs or changes Settings shows
// an Allow card first.
const NAMES = { claude: 'Claude Code', codex: 'Codex' }
const RENDER = { queued: 'waiting', running: 'rendering', success: 'done', error: 'failed', cancelled: 'cancelled', unknown: '' }
const KIND = { previews: 'Previews', finish: 'Finish', enhance: 'Enhance' }
const IDEAS = ['What can you do in IV Studio?', 'Make a 5 second shot of a fox crossing a frozen lake at dawn', 'Which of my shots aren’t finished yet?']
// what to suggest on a page that's about one thing
const PAGE_IDEAS = {
  edit: ['Tighten the middle', 'Add a calm song under it', 'Put captions on'],
  projects: ['Let’s make a short film together, one step at a time', 'Which of my films aren’t finished?', 'What can you do in IV Studio?'],
  project: ['Take this film to a rough cut, one step at a time', 'Write the script for this film', 'What’s left to do on this film?'],
  home: ['Make 10 variations of my last idea overnight, three takes each', 'What can you do in IV Studio?', 'Which of my shots aren’t finished yet?']
}
export const ideasFor = (page) => PAGE_IDEAS[page] || IDEAS

// Anywhere in the app can hand the chat a question (App.jsx listens for iv:ask and opens the panel): about is what
// it's about (a run, a failed render, a picture), shown above the message box and sent with the message; send: send
// it at once (a button that says what it asks, like "Ask Claude Code to fix it"), or leave it typed for the person.
export const askAgent = ({ text = '', about = null, send = false } = {}) => window.dispatchEvent(new CustomEvent('iv:ask', { detail: { text, about, send } }))

// The agent a button can name ("Ask Claude Code ..."), or null when neither is installed (the button then doesn't
// show). One look per window, shared by every button on the page.
let agentLook = null
export function useAgentName() {
  const [name, setName] = useState(null)
  useEffect(() => {
    let live = true
    if (!agentLook) agentLook = window.ivstudio.chat.status().then((s) => NAMES[s.chat?.engine || s.preferred] || null, () => null)
    agentLook.then((n) => live && setName(n))
    // look again after a while: one may have been installed since
    const t = setTimeout(() => (agentLook = null), 15000)
    return () => ((live = false), clearTimeout(t))
  }, [])
  return name
}

export function useChat() {
  const [status, setStatus] = useState(null)
  useEffect(() => {
    let live = true
    const load = () => window.ivstudio.chat.status().then((s) => live && setStatus(s), () => {})
    load()
    const off = window.ivstudio.chat.onChange((chat) => live && setStatus((s) => (s ? { ...s, chat } : s)))
    return () => ((live = false), off())
  }, [])
  const reload = () => window.ivstudio.chat.status().then(setStatus, () => {})
  return [status, reload]
}

export function ChatButton({ open, popped = false, busy, onClick }) {
  return (
    <button className={`chat-open mono ${open ? 'on' : ''}`} onClick={onClick} aria-expanded={open} title={popped ? 'The chat is in its own window: bring it forward' : open ? 'Close the chat' : 'Chat with your Claude Code or Codex'}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 5h16v11H9l-5 4z" />
      </svg>
      <span className="chat-open-label">Chat</span>
      {busy && <span className="chat-open-dot" aria-label="working" />}
    </button>
  )
}

// a dropped or picked file, by its kind (agentchat.js attachmentOf decides for the agent; this is for the chips)
const FILE_KIND = [
  ['picture', /\.(png|jpe?g|webp|bmp|gif)$/i, '▣'],
  ['video', /\.(mp4|mov|webm|mkv|avi|m4v)$/i, '▶'],
  ['sound', /\.(wav|mp3|flac|m4a|ogg|aac)$/i, '♪'],
  ['text', /\.(txt|md|fountain|srt|vtt|json|csv)$/i, '¶']
]
const fileOf = (p) => {
  const k = FILE_KIND.find(([, re]) => re.test(p))
  return k ? { path: p, name: p.split(/[\\/]/).pop(), kind: k[0], icon: k[2] } : null
}
const FileChip = ({ f, onRemove }) => (
  <span className={`chat-file ${f.kind}`} title={f.path}>
    <span aria-hidden="true">{f.icon || FILE_KIND.find(([k]) => k === f.kind)?.[2]}</span>
    <span className="chat-file-name">{f.name}</span>
    {onRemove && (
      <button className="lora-chip-x" aria-label={`Take ${f.name} off`} onClick={onRemove}>
        ×
      </button>
    )}
  </span>
)

// the agent's markdown shown as formatting (chatText.js), built from React elements, never HTML
const Parts = ({ parts }) =>
  parts.map((p, i) => (p.b ? <strong key={i}>{p.t}</strong> : p.i ? <em key={i}>{p.t}</em> : p.code ? <code key={i} className="ct-code">{p.t}</code> : <span key={i}>{p.t}</span>))

function ChatText({ text }) {
  return (
    <div className="chat-text md">
      {chatLines(text).map((l, i) =>
        l.kind === 'rule' ? (
          <hr key={i} className="ct-rule" />
        ) : l.kind === 'head' ? (
          <div key={i} className="ct-head">
            <Parts parts={l.parts} />
          </div>
        ) : l.kind === 'bullet' ? (
          <div key={i} className="ct-bullet" style={l.indent ? { marginLeft: Math.min(l.indent, 8) * 6 } : undefined}>
            <span className="ct-mark">{l.mark}</span>
            <span>
              <Parts parts={l.parts} />
            </span>
          </div>
        ) : l.parts.length ? (
          <div key={i}>
            <Parts parts={l.parts} />
          </div>
        ) : (
          <div key={i} className="ct-gap" />
        )
      )}
    </div>
  )
}

function Entry({ e, onAnswer, onUndo, onOpenShot, agentName, first }) {
  if (e.kind === 'you')
    return (
      <div className="chat-row you">
        <div className="chat-bubble you">
          {e.files?.length > 0 && (
            <div className="chat-files">
              {e.files.map((f) => (
                <FileChip key={f.path} f={f} />
              ))}
            </div>
          )}
          <span className="chat-text">{e.text}</span>
          {e.at && <span className="chat-time mono">{timeOf(e.at)}</span>}
        </div>
      </div>
    )
  if (e.kind === 'agent')
    return (
      <div className={`chat-row agent ${first ? 'first' : ''}`}>
        <div className="chat-bubble agent">
          {first && <span className="chat-name mono">{agentName}</span>}
          <ChatText text={e.text} />
          {e.at && <span className="chat-time mono">{timeOf(e.at)}</span>}
        </div>
      </div>
    )
  // the agent summarised the conversation to make room in its context window (agentrun.js parseLine 'compact')
  if (e.kind === 'compact')
    return (
      <div className="chat-divider mono small" role="note">
        <span>
          Earlier messages were summarized to make room{e.before ? ` (${tokens(e.before)} tokens before)` : ''}
        </span>
      </div>
    )
  if (e.kind === 'problem') return <div className="chat-problem small" role="alert">{e.text}</div>
  // an overnight batch's morning report (batches.js): what rendered, and the best takes to open
  if (e.kind === 'report')
    return (
      <div className="chat-report" role="group" aria-label={`Overnight batch ${e.title}`}>
        <div className="chat-report-title mono small">Overnight batch · {e.title}</div>
        <p className="small">{e.text}</p>
        {e.picks?.length > 0 && (
          <div className="chat-report-picks">
            {e.picks.map((p) => (
              <button key={`${p.jobId}-${p.candidate}`} className="btn btn-small" disabled={!p.projectId} onClick={() => onOpenShot?.(p.projectId)}>
                {p.label}
              </button>
            ))}
          </div>
        )}
        <Dailies entry={e} />
      </div>
    )
  // an edit the agent changed: put it back as it was
  if (e.kind === 'undo')
    return (
      <div className="chat-undo mono small">
        <span>Changed “{e.name}”</span>
        {e.done ? (
          <span className="dim">· undone</span>
        ) : (
          <button className="link-btn mono small" onClick={() => onUndo?.(e.id)}>
            Undo this change
          </button>
        )}
      </div>
    )
  // a paid step that started (spending.js): under the limit, or Allowed on its card
  if (e.kind === 'spent')
    return (
      <div className="chat-spent mono small">
        Spent {Number(e.credits).toLocaleString('en-US')} credits (${Number(e.usd).toFixed(2)}){e.auto ? ', under your limit' : ', Allowed'}
        {e.today && <span className="dim"> · {e.today}</span>}
      </div>
    )
  if (e.kind === 'step')
    return (
      <div className={`chat-step mono small ${e.error ? 'err' : ''}`} title={e.error || undefined}>
        <span aria-hidden="true">{e.error ? '!' : '✓'}</span> {e.label}
        {e.count > 1 && <span className="dim"> ×{e.count}</span>}
        {e.error && <span className="chat-step-why">{e.error}</span>}
      </div>
    )
  if (e.kind === 'ask') {
    const args = Object.entries(e.args || {}).filter(([, v]) => v !== undefined && v !== null && v !== '')
    return (
      <div className={`chat-ask ${e.answer ? 'answered' : ''}`} role={e.answer ? undefined : 'group'} aria-label={`Allow ${e.label}?`}>
        <div className="chat-ask-title">Allow “{e.label}”?</div>
        <p className="small">{e.why}</p>
        {args.length > 0 && (
          <dl className="chat-ask-args mono small">
            {args.slice(0, 6).map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd>
              </div>
            ))}
          </dl>
        )}
        {e.answer ? (
          <p className="mono small chat-ask-answer">{e.answer === 'allow' ? 'Allowed' : e.answer === 'deny' ? 'Not allowed' : 'Not answered'}</p>
        ) : (
          <div className="chat-ask-btns">
            <button className="btn btn-small btn-primary" onClick={() => onAnswer(e.id, true)}>
              Allow
            </button>
            <button className="btn btn-small" onClick={() => onAnswer(e.id, false)}>
              Don’t allow
            </button>
          </div>
        )}
      </div>
    )
  }
  return null
}

// How full the agent's context window is (agentchat.js applyUsage), and the chat's usage when clicked. Claude Code's
// figure is exact; Codex's is estimated from its per-turn totals. A plan's own 5-hour and weekly limits aren't given to
// apps, so they aren't here.
function ContextMeter({ usage, engine }) {
  const [open, setOpen] = useState(false)
  if (!usage || (!usage.context && !usage.turns)) return null
  const pct = usage.context && usage.window ? Math.min(100, Math.round((100 * usage.context) / usage.window)) : null
  const tone = pct == null ? '' : pct >= 90 ? 'full' : pct >= 70 ? 'warn' : ''
  const plan = engine === 'claude' ? 'Claude' : 'ChatGPT'
  const said = usage.context
    ? `${usage.approx ? 'About ' : ''}${tokens(usage.context)}${usage.window ? ` of ${tokens(usage.window)}` : ''} tokens in ${engine === 'claude' ? 'Claude Code' : 'Codex'}’s working memory${usage.approx ? ' (estimated)' : ''}.`
    : 'Not measured yet.'
  return (
    <>
      <button className={`chat-context ${tone}`} onClick={() => setOpen(!open)} aria-expanded={open} title={`${said} When it fills, the agent summarizes earlier messages to make room. Click for this chat’s usage.`}>
        <span className="chat-context-bar" aria-hidden="true">
          <span style={{ width: `${pct ?? 0}%` }} />
        </span>
        <span className="mono">{pct != null ? `${usage.approx ? '~' : ''}${pct}%` : tokens(usage.context || 0)}</span>
      </button>
      {open && (
        <div className="chat-usage small" role="note">
          <p>
            {said}
            {pct != null && pct >= 85 ? ' It will summarize soon; a New chat starts fresh.' : ''}
          </p>
          <p>
            This chat: {tokens(usage.input)} tokens read ({tokens(usage.cached)} from cache), {tokens(usage.output)} written, over {usage.turns} {usage.turns === 1 ? 'turn' : 'turns'}.
            {usage.apiUsd > 0 ? ` At API prices about $${usage.apiUsd.toFixed(2)}; on your ${plan} plan you aren’t charged per token.` : ` It runs on your ${plan} plan.`}
          </p>
          <p className="dim">Your plan’s 5-hour and weekly limits aren’t shared with other apps; see them in {engine === 'claude' ? 'Claude (Settings → Usage)' : 'ChatGPT or Codex'}.</p>
        </div>
      )}
    </>
  )
}

// Read aloud: on or off and which voice, kept on this PC (the chat's own choice, not the app's settings)
const SPEAK_KEY = 'iv.chatSpeak'
const readSpeak = () => {
  try {
    return { on: false, voiceId: null, ...JSON.parse(localStorage.getItem(SPEAK_KEY) || '{}') }
  } catch {
    return { on: false, voiceId: null }
  }
}

// The mic: press to talk, press send when done (or Esc to drop it). IV Studio's own Whisper writes it down
// (chat:hear); talking while the agent works stops its turn and sends the new words.
function useTalk({ onWords, notify, onStart }) {
  const [state, setState] = useState('idle') // idle | listening | hearing
  const [secs, setSecs] = useState(0)
  const rec = useRef(null)
  const dropped = useRef(false)
  const release = () => {
    const r = rec.current
    rec.current = null
    if (r) {
      clearInterval(r.tick)
      r.stream.getTracks().forEach((t) => t.stop())
    }
    return r
  }
  useEffect(() => () => release(), [])
  const finish = () => {
    const r = rec.current
    if (r?.recorder.state === 'recording') r.recorder.stop()
  }
  const cancel = () => {
    if (!rec.current) return
    dropped.current = true
    finish()
  }
  const start = async () => {
    if (state !== 'idle') return
    onStart?.()
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      const type = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm'
      const recorder = new MediaRecorder(stream, { mimeType: type })
      const chunks = []
      recorder.ondataavailable = (ev) => ev.data.size && chunks.push(ev.data)
      const t0 = Date.now()
      const tick = setInterval(() => {
        const s = Math.floor((Date.now() - t0) / 1000)
        setSecs(s)
        if (s >= 120) finish()
      }, 250)
      rec.current = { stream, recorder, tick }
      recorder.onstop = async () => {
        release()
        if (dropped.current) {
          dropped.current = false
          setState('idle')
          return
        }
        setState('hearing')
        try {
          const buf = new Uint8Array(await new Blob(chunks, { type }).arrayBuffer())
          const { text } = await window.ivstudio.chat.hear(buf)
          if (text) await onWords(text)
          else notify?.('Nothing was heard. Check your microphone, then try again.')
        } catch (err) {
          notify?.(err.message)
        } finally {
          setState('idle')
        }
      }
      recorder.start(250)
      setSecs(0)
      setState('listening')
    } catch (err) {
      release()
      const m = String(err?.message || err)
      notify?.(/denied|NotAllowed|Permission/i.test(m) ? 'IV Studio isn’t allowed to use the microphone. Allow it in Windows Settings → Privacy → Microphone, then try again.' : /NotFound|device/i.test(m) ? 'No microphone was found.' : m)
      setState('idle')
    }
  }
  return { state, secs, start, finish, cancel }
}

export default function ChatPanel({ status, reload, onClose, context, go, notify, ask, clearAsk, openShot, openRef, popped = false }) {
  const setup = useAgentSetup()
  const [tab, setTab] = useState('chat')
  const [text, setText] = useState('')
  const [about, setAbout] = useState(null)
  const [files, setFiles] = useState([])
  const [dropping, setDropping] = useState(false)
  const [engine, setEngine] = useState(null)
  const [speak, setSpeakState] = useState(readSpeak)
  const [voices, setVoices] = useState(null)
  const [pinned, setPinned] = useState(false)
  const setSpeak = (patch) =>
    setSpeakState((s) => {
      const next = { ...s, ...patch }
      try {
        localStorage.setItem(SPEAK_KEY, JSON.stringify(next))
      } catch {}
      return next
    })
  // files dropped on the panel or picked with the paperclip: up to 10, of the kinds the agent can use
  const addFiles = (paths) => {
    const add = (paths || []).map(fileOf)
    const skipped = add.filter((f) => !f).length
    if (skipped) notify?.('Only pictures, videos, sound and text files (scripts, notes) can go in the chat.')
    setFiles((now) => [...now, ...add.filter((f) => f && !now.some((x) => x.path === f.path))].slice(0, 10))
  }
  const bodyRef = useRef(null)
  const inputRef = useRef(null)
  const audioRef = useRef(null)
  const chat = status?.chat
  const installed = status?.installed || {}
  const ready = ['claude', 'codex'].filter((e) => installed[e])
  const pick = chat?.engine || (engine && installed[engine] ? engine : status?.preferred)
  const busy = !!chat?.busy
  const act = (fn) => async (...a) => {
    try {
      await fn(...a)
    } catch (err) {
      notify?.(err.message)
    }
  }
  // follow the conversation as it grows
  const count = chat?.entries?.length || 0
  const lastText = chat?.entries?.[count - 1]?.text
  useEffect(() => {
    const b = bodyRef.current
    if (b) b.scrollTop = b.scrollHeight
  }, [count, lastText, busy, chat?.id, tab])
  useEffect(() => {
    inputRef.current?.focus()
  }, [chat?.id])
  // the message box grows with what's typed, up to about six lines
  useEffect(() => {
    const t = inputRef.current
    if (!t) return
    t.style.height = 'auto'
    t.style.height = `${Math.min(t.scrollHeight, 160)}px`
  }, [text])
  // newly installed from the rows here: look again
  const agentsReady = `${!!setup?.claude?.installed}${!!setup?.codex?.installed}`
  useEffect(() => {
    reload?.()
  }, [agentsReady])
  // the voices to read replies in (Audio → Voices), once Read aloud is on
  useEffect(() => {
    if (speak.on && !voices) window.ivstudio.voices.list().then(setVoices, () => setVoices([]))
  }, [speak.on])

  // reading: 'making' while the voice is made (the first one loads the voice model, up to a few minutes on a busy
  // PC), 'playing' while it plays. readTurn drops a read that's finished after a newer message was sent.
  const [reading, setReading] = useState(null)
  const readTurn = useRef(0)
  const stopSpeaking = () => {
    readTurn.current += 1
    const a = audioRef.current
    audioRef.current = null
    if (a) a.pause()
    setReading(null)
  }
  // with the chat in its own window, the main window's page and selection come from there (App.jsx chat:setContext)
  const contextNow = () => (popped ? null : { ...(context || {}), selection: selectionFor(context?.page) })
  const sendWords = async (t, aboutNow = about, withFiles = files) => {
    stopSpeaking()
    setText('')
    setAbout(null)
    setFiles([])
    await window.ivstudio.chat.send({ text: aboutNow ? `About ${aboutNow}:\n${t}` : t, context: contextNow(), engine: pick, files: withFiles.map((f) => f.path) })
  }
  const send = act(async (words, aboutNow = about) => {
    const t = (words ?? text).trim()
    if ((!t && !files.length) || busy) return
    await sendWords(t, aboutNow)
  })
  // spoken words: sent at once; if the agent is mid-answer, its turn stops first (renders it started keep going)
  const busyRef = useRef(busy)
  busyRef.current = busy
  const textRef = useRef(text)
  textRef.current = text
  const talk = useTalk({
    notify,
    onStart: () => stopSpeaking(),
    onWords: async (words) => {
      const typed = textRef.current.trim()
      if (busyRef.current) await window.ivstudio.chat.stop({ keepRenders: true })
      await sendWords(typed ? `${typed} ${words}` : words)
    }
  })
  // Read aloud: when a turn ends, its words are read in the chosen voice (chat:say); a render on the graphics card
  // skips it, with a note
  const wasBusy = useRef(busy)
  useEffect(() => {
    const ended = wasBusy.current && !busy
    wasBusy.current = busy
    if (!ended || !speak.on || !chat?.entries?.length) return
    const lastYou = chat.entries.map((e) => e.kind).lastIndexOf('you')
    const said = chat.entries
      .slice(lastYou + 1)
      .filter((e) => e.kind === 'agent')
      .map((e) => e.text)
      .join(' ')
    if (!said.trim()) return
    const mine = (readTurn.current += 1)
    setReading('making')
    window.ivstudio.chat
      .say({ text: said, voiceId: speak.voiceId })
      .then((r) => {
        if (readTurn.current !== mine) return
        if (r?.skipped) {
          setReading(null)
          return notify?.(r.skipped, 'info')
        }
        const a = new Audio(fileUrl(r.file))
        audioRef.current = a
        a.onended = () => audioRef.current === a && setReading(null)
        setReading('playing')
        a.play().catch(() => setReading(null))
      })
      .catch((err) => {
        if (readTurn.current === mine) setReading(null)
        notify?.(err.message)
      })
  }, [busy])
  useEffect(() => () => stopSpeaking(), [])

  // a question handed over from elsewhere in the app (askAgent): sent at once when it says so and the agent is free,
  // otherwise left in the box with what it's about
  useEffect(() => {
    if (!ask || !status) return
    clearAsk?.()
    setTab('chat')
    if (ask.send && pick && !busy && ask.text) send(ask.text, ask.about)
    else {
      setAbout(ask.about || null)
      if (ask.text) setText(ask.text)
      if (ask.send && busy) notify?.(`${NAMES[pick]} is still answering. Your question is ready in the box; send it when it's done.`)
      inputRef.current?.focus()
    }
  }, [ask, !!status])
  const fresh = act(async (e) => {
    await window.ivstudio.chat.new(e || pick)
    reload?.()
  })
  const openChat = act(async (id) => {
    await window.ivstudio.chat.open(id)
    reload?.()
  })
  const answer = act((id, allow) => window.ivstudio.chat.answer({ id, allow }))
  const undo = act((id) => window.ivstudio.chat.undo(id))
  const stop = act(async () => {
    stopSpeaking()
    await window.ivstudio.chat.stop()
  })
  const popOut = act(() => window.ivstudio.chat.popout())
  const dock = act(() => window.ivstudio.chat.dock())
  const pin = act(async () => setPinned(await window.ivstudio.chat.pin(!pinned)))
  const others = (status?.chats || []).filter((c) => c.id !== chat?.id)
  const mmss = `${Math.floor(talk.secs / 60)}:${String(talk.secs % 60).padStart(2, '0')}`
  const sendIcon = (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12l14-7-5 14-2-6z" />
    </svg>
  )

  return (
    <aside
      className={`chat-panel ${dropping ? 'dropping' : ''} ${popped ? 'popped' : ''} agent-${pick || 'none'}`}
      aria-label="Chat"
      onKeyDown={(ev) => {
        if (talk.state === 'listening' && ev.key === 'Escape') {
          ev.preventDefault()
          talk.cancel()
        }
      }}
      onDragOver={(ev) => {
        if (!pick || ![...(ev.dataTransfer?.types || [])].includes('Files')) return
        ev.preventDefault()
        setDropping(true)
      }}
      onDragLeave={(ev) => !ev.currentTarget.contains(ev.relatedTarget) && setDropping(false)}
      onDrop={(ev) => {
        if (!pick) return
        ev.preventDefault()
        setDropping(false)
        addFiles([...(ev.dataTransfer?.files || [])].map((f) => window.ivstudio.media.pathFor(f)).filter(Boolean))
      }}
    >
      <header className="chat-head">
        <h2>Chat</h2>
        <div className="chat-tabs" role="tablist" aria-label="Chat or activity">
          <button role="tab" aria-selected={tab === 'chat'} className={tab === 'chat' ? 'on' : ''} onClick={() => setTab('chat')}>
            Chat
          </button>
          <button role="tab" aria-selected={tab === 'activity'} className={`chat-tab-activity ${tab === 'activity' ? 'on' : ''}`} onClick={() => setTab('activity')} title="Everything agents did in IV Studio">
            Activity
          </button>
        </div>
        <span className="spacer" />
        {pick && tab === 'chat' && (
          <button
            className={`chat-icon chat-speak ${speak.on ? 'on' : ''}`}
            onClick={() => {
              if (speak.on) stopSpeaking()
              setSpeak({ on: !speak.on })
            }}
            aria-pressed={speak.on}
            title={speak.on ? 'Reading replies aloud: click to stop' : 'Read replies aloud'}
            aria-label="Read replies aloud"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 9h4l5-4v14l-5-4H4z" />
              {speak.on ? <path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" /> : <path d="M17 9l5 6M22 9l-5 6" />}
            </svg>
          </button>
        )}
        {popped ? (
          <>
            <button className={`chat-icon ${pinned ? 'on' : ''}`} onClick={pin} aria-pressed={pinned} title={pinned ? 'Stop keeping the chat on top' : 'Keep the chat on top of other windows'} aria-label="Keep on top">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M9 3h6l-1 6 4 4H6l4-4zM12 13v8" />
              </svg>
            </button>
            <button className="chat-icon chat-dock" onClick={dock} title="Put the chat back in the app" aria-label="Put the chat back in the app">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M3 4h18v16H3zM15 4v16M11 9l-3 3 3 3" />
              </svg>
            </button>
          </>
        ) : (
          <>
            <button className="chat-icon chat-popout" onClick={popOut} title="Open the chat in its own window" aria-label="Open the chat in its own window">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6" />
              </svg>
            </button>
            <button className="chat-icon" aria-label="Close the chat" title="Close the chat" onClick={onClose}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </>
        )}
      </header>

      {tab === 'activity' ? (
        <ActivityLog notify={notify} openRef={openRef} />
      ) : (
        <>
          <div className="chat-subhead">
            {ready.length > 1 && !chat?.entries?.length ? (
              <div className="segmented chat-engine" role="radiogroup" aria-label="Agent">
                {ready.map((e) => (
                  <button key={e} role="radio" aria-checked={pick === e} className={pick === e ? 'on' : ''} onClick={() => (chat ? fresh(e) : setEngine(e))}>
                    {NAMES[e]}
                  </button>
                ))}
              </div>
            ) : (
              pick && (
                <span className="chat-who mono small">
                  <span className="chat-who-dot" aria-hidden="true" /> {NAMES[pick]}
                </span>
              )
            )}
            <ContextMeter usage={chat?.usage} engine={chat?.engine || pick} />
            {reading && (
              <button className="chat-reading mono small" onClick={stopSpeaking} title="Stop reading aloud">
                <span className="agent-dot live" aria-hidden="true" /> {reading === 'making' ? 'Getting the voice ready…' : 'Reading aloud'} ×
              </button>
            )}
            {speak.on && voices?.length > 0 && (
              <select className="chat-voice-pick small" value={speak.voiceId || voices[0].id} onChange={(ev) => setSpeak({ voiceId: ev.target.value })} aria-label="Voice that reads replies" title="The voice that reads replies">
                {voices.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            )}
            <span className="spacer" />
            {others.length > 0 && (
              <select className="chat-history small" value="" disabled={busy} onChange={(ev) => ev.target.value && openChat(ev.target.value)} aria-label="Earlier chats">
                <option value="">Earlier chats…</option>
                {others.map((c) => (
                  <option key={c.id} value={c.id}>
                    {(c.title || 'Untitled').slice(0, 60)} · {NAMES[c.engine]}
                  </option>
                ))}
              </select>
            )}
            {chat?.entries?.length > 0 && (
              <button className="btn btn-small chat-new" disabled={busy} onClick={() => fresh()} title="Start a new conversation">
                New
              </button>
            )}
          </div>
          {chat?.spending?.label && (
            <div className="chat-today mono small" title="The chat's spending limit (Settings → Agents)">
              {chat.spending.label}
            </div>
          )}

          {!pick ? (
            <div className="chat-body chat-setup">
              <p className="small">The chat uses your own Claude Code or Codex, on your own plan. Install one here, or sign in if you already have it.</p>
              <AgentRows setup={setup} notify={notify} />
            </div>
          ) : (
            <>
              <div className="chat-body" ref={bodyRef} aria-live="polite">
                {!chat?.entries?.length ? (
                  <div className="chat-empty">
                    <p className="small">Ask {NAMES[pick]} about IV Studio or your projects, or tell it what to make. Type, or press the mic and talk. It can use everything IV Studio does, and it knows what you’re looking at.</p>
                    <div className="chat-ideas">
                      {ideasFor(context?.page).map((i) => (
                        <button key={i} className="chat-idea small" onClick={() => (setText(i), inputRef.current?.focus())}>
                          {i}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  chat.entries.map((e, i) => <Entry key={i} e={e} onAnswer={answer} onUndo={undo} onOpenShot={openShot} agentName={NAMES[chat.engine] || 'Agent'} first={e.kind === 'agent' && chat.entries[i - 1]?.kind !== 'agent'} />)
                )}
                {busy && (
                  <div className="chat-row agent">
                    <div className="chat-bubble agent chat-typing" aria-label={`${chat.name} is working`}>
                      <span />
                      <span />
                      <span />
                    </div>
                  </div>
                )}
              </div>
              {chat?.renders?.length > 0 && (
                <div className="chat-renders">
                  {chat.renders.map((r) => (
                    <div key={r.id} className="chat-render small">
                      <span className="mono">{KIND[r.kind] || r.kind || 'Render'}</span>
                      <span className="dim">{RENDER[r.status] || r.status}</span>
                      {r.status === 'running' && r.progress != null && (
                        <span className="agent-bar" aria-label={`${r.progress}%`}>
                          <span style={{ width: `${r.progress}%` }} />
                        </span>
                      )}
                    </div>
                  ))}
                  <button className="link-btn small" onClick={() => (popped ? openRef?.('shots') : go?.('library'))}>
                    Open Shots →
                  </button>
                </div>
              )}
              <div className="chat-dock-area">
                {about && (
                  <div className="chat-about small">
                    <span className="dim">About</span> <span className="chat-about-what">{about}</span>
                    <button className="lora-chip-x" aria-label="Not about this any more" onClick={() => setAbout(null)}>
                      ×
                    </button>
                  </div>
                )}
                {files.length > 0 && (
                  <div className="chat-files chat-files-ready">
                    {files.map((f) => (
                      <FileChip key={f.path} f={f} onRemove={() => setFiles((now) => now.filter((x) => x.path !== f.path))} />
                    ))}
                  </div>
                )}
                <div className={`chat-composer ${talk.state !== 'idle' ? 'talking' : ''}`}>
                  {talk.state === 'listening' ? (
                    <div className="chat-listening" role="status">
                      <span className="chat-rec-dot" aria-hidden="true" />
                      <span className="mono small">Listening · {mmss}</span>
                      <span className="dim small chat-listening-hint">{busy ? 'Sending stops the current answer' : 'Press send when you’re done'}</span>
                      <button className="chat-icon" onClick={talk.cancel} title="Don’t send this (Esc)" aria-label="Don’t send this">
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M6 6l12 12M18 6L6 18" />
                        </svg>
                      </button>
                    </div>
                  ) : talk.state === 'hearing' ? (
                    <div className="chat-listening" role="status">
                      <span className="agent-dot live" aria-hidden="true" />
                      <span className="small">Writing down what you said…</span>
                    </div>
                  ) : (
                    <>
                      <button className="chat-icon chat-attach" disabled={busy || files.length >= 10} onClick={act(async () => addFiles(await window.ivstudio.files.pick('chat')))} title="Add pictures, videos, sound or a script (or drop them on the chat)" aria-label="Add files">
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M20 11.5l-7.8 7.8a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8" />
                        </svg>
                      </button>
                      <textarea
                        ref={inputRef}
                        rows={1}
                        value={text}
                        placeholder={`Message ${NAMES[pick]}…`}
                        aria-label={`Message ${NAMES[pick]}`}
                        onChange={(ev) => setText(ev.target.value)}
                        onKeyDown={(ev) => {
                          if (ev.key === 'Enter' && !ev.shiftKey && !ev.nativeEvent.isComposing) {
                            ev.preventDefault()
                            send()
                          }
                        }}
                      />
                      <button className="chat-icon chat-mic" onClick={talk.start} title={busy ? 'Talk: what you say stops the current answer and goes in next' : 'Press and talk'} aria-label="Talk">
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5 11a7 7 0 0 0 14 0M12 18v3" />
                        </svg>
                      </button>
                    </>
                  )}
                  {talk.state === 'listening' ? (
                    <button className="chat-send-round" onClick={talk.finish} title="Send what you said" aria-label="Send what you said">
                      {sendIcon}
                    </button>
                  ) : talk.state === 'hearing' ? null : busy ? (
                    <button className="chat-send-round stop" onClick={stop} title="Stop the answer (and the renders it started)" aria-label="Stop">
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <rect x="7" y="7" width="10" height="10" rx="1.5" />
                      </svg>
                    </button>
                  ) : (
                    <button className="chat-send-round" disabled={!text.trim() && !files.length} onClick={() => send()} title="Send (Enter)" aria-label="Send">
                      {sendIcon}
                    </button>
                  )}
                </div>
                <p className="chat-foot small dim">
                  Your own {NAMES[pick]}, on your {pick === 'claude' ? 'Claude' : 'ChatGPT'} plan. It asks before it deletes, spends money or changes a setting.
                </p>
              </div>
            </>
          )}
        </>
      )}
    </aside>
  )
}

// A batch's dailies (dailies.js): the reel of every take with its title card, and notes on what to look at first.
// Reports from before dailies existed can make them here.
function Dailies({ entry }) {
  const [d, setD] = useState(entry.dailies || null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const make = async () => {
    setBusy(true)
    setErr(null)
    try {
      setD(await window.ivstudio.batches.dailies(entry.batchId))
    } catch (x) {
      setErr(x.message)
    } finally {
      setBusy(false)
    }
  }
  const open = (f) => window.ivstudio.files.open(f).catch((x) => setErr(x.message))
  return (
    <div className="chat-report-dailies">
      {d?.reel && (
        <button className="btn btn-small btn-primary" onClick={() => open(d.reel)} title="Every take, the best of each shot first, each after a card with its seed and checks">
          ▶ Watch the dailies
        </button>
      )}
      {d?.notes && (
        <button className="btn btn-small" onClick={() => open(d.notes)} title="What to look at first, and every take with its checks">
          Read the notes
        </button>
      )}
      {!d && entry.batchId && (
        <button className="btn btn-small" disabled={busy} onClick={make}>
          {busy ? 'Making the dailies…' : 'Make the dailies'}
        </button>
      )}
      {err && <span className="small pink">{err}</span>}
    </div>
  )
}
