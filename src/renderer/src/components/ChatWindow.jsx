import { useEffect, useState } from 'react'
import ChatPanel, { useChat } from './ChatPanel'
import { applyA11y } from '../a11y'

// The chat in its own window (main process openChatWindow, opened at #chat): the same conversation as the panel,
// filling the window. Links open in the main window (chat:openInApp), and questions from buttons there arrive here
// (chat:ask). The main window sends its page and selection to the main process, which adds them to each message.
export default function ChatWindow() {
  const [status, reload] = useChat()
  const [toast, setToast] = useState(null)
  const [ask, setAsk] = useState(null)
  const notify = (text, kind = 'error') => {
    setToast({ text, kind })
    clearTimeout(notify.t)
    notify.t = setTimeout(() => setToast(null), 7000)
  }
  useEffect(() => {
    document.title = 'IV Studio · Chat'
    document.documentElement.classList.add('chat-window')
    // Settings → Accessibility (text size, contrast, motion) here too
    window.ivstudio.settings.get().then(applyA11y, () => {})
    return window.ivstudio.chat.onAsk((detail) => setAsk({ ...detail, at: Date.now() }))
  }, [])
  const openRef = (kind, id = null) => window.ivstudio.chat.openInApp({ kind, id }).catch(() => {})
  return (
    <div className="chat-window-root">
      <ChatPanel
        status={status}
        reload={reload}
        popped
        notify={notify}
        ask={ask}
        clearAsk={() => setAsk(null)}
        openShot={(id) => openRef('shot', id)}
        openRef={openRef}
        go={(page) => openRef(page === 'library' ? 'shots' : page)}
        onClose={() => window.close()}
      />
      {toast && (
        <div className={`toast ${toast.kind}`} onClick={() => setToast(null)}>
          {toast.text}
        </div>
      )}
    </div>
  )
}
