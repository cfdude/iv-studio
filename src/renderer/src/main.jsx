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
import { loadPlatform } from './platform'

// The platform comes from the main process (app:info) before the first render, and loadPlatform sets
// data-platform on the document root, so the Mac title bar is padded from the first paint (no jump). It
// never rejects: if app:info fails the platform is unknown and the window still opens.
loadPlatform().then(() =>
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
)
