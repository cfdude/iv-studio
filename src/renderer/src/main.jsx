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
import { tempPlatform } from './components/edit/Editor'

// TEMPORARY (task 3.3 replaces the source): lets the CSS tell the platforms apart, e.g. the Mac title bar.
document.documentElement.dataset.platform = tempPlatform()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
)
