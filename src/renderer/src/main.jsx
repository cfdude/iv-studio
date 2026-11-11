import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/barlow/600.css'
import '@fontsource/barlow-condensed/700.css'
import '@fontsource/barlow-condensed/800.css'
import '@fontsource/dm-sans/400.css'
import '@fontsource/dm-sans/600.css'
import '@fontsource/jetbrains-mono/400.css'
import './styles.css'
import './studio.css'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import ChatWindow from './components/ChatWindow'
import { loadPlatform } from './platform'

// the chat popped out into its own window opens this page at #chat (main process openChatWindow)
const chatOnly = window.location.hash === '#chat'

// The platform comes from the main process (app:info) before the first render, so a Mac's shortcuts and hints
// are right from the first paint. It never rejects: if app:info fails the platform is unknown and the window
// still opens.
loadPlatform().then(() =>
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <ErrorBoundary>
        {chatOnly ? <ChatWindow /> : <App />}
      </ErrorBoundary>
    </StrictMode>
  )
)
