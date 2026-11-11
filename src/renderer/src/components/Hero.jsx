import Help from './Help'
import eyeArt from '../assets/eye.webp'
import MotionCanvas from './MotionCanvas'
import { HERO_EFFECTS, HERO_MOTION } from './heroMotion'

// Each page's own banner art (assets/pages/<name>.webp): the eye's artwork with the eye swapped for the page's
// subject, made the same way as the closed eye (docs/art/README.md). The dashboard keeps the eye itself.
export const ART = {
  ...Object.fromEntries(Object.entries(import.meta.glob('../assets/pages/*.webp', { eager: true, import: 'default' })).map(([file, url]) => [file.split('/').pop().replace('.webp', ''), url])),
  eye: eyeArt // the dashboard's own, for its tall banner
}

// The page header from the "What If?" artwork: a heavy condensed title and a spaced kicker on the dark
// left, the page's art fading in on the right (art names one from assets/pages; none is the eye; Incognito
// shows the closed eye everywhere). children go in place of the title (editable names); back is a link
// pinned to the top left. help: which page's tour its "How it works" starts (tours.js); by default the art's, false
// for none.
// Where the banner's subject sits: the middle of its picture (.hero-eye), and about how big it is.
const subjectOf = (canvas) => {
  const eye = canvas.parentElement?.querySelector('.hero-eye')?.getBoundingClientRect()
  const box = canvas.getBoundingClientRect()
  return eye ? { x: eye.left - box.left + eye.width / 2, y: eye.top - box.top + eye.height / 2, r: eye.height * 0.3 } : null
}

export default function Hero({ art, title, kicker, back, children, help }) {
  // the banner's motion (heroMotion.js), chosen by its picture; none for pictures without one
  const fx = HERO_EFFECTS[HERO_MOTION[ART[art] ? art : art ? null : 'eye']]
  return (
    <header className="hero">
      <div className="hero-eye" aria-hidden="true" style={ART[art] ? { '--hero-art': `url("${ART[art]}")` } : undefined} />
      {fx && <MotionCanvas fx={fx} className="hero-motion" anchorOf={subjectOf} />}
      {back && (
        <button className="link-btn mono hero-back" onClick={back.onClick}>
          ← {back.label}
        </button>
      )}
      {help !== false && (
        <div className="hero-help">
          <Help art={art} page={help} />
        </div>
      )}
      <div className="hero-text">
        {title && <h1 className="hero-title">{title}</h1>}
        {children}
        {kicker && <p className="hero-kicker">{kicker}</p>}
      </div>
    </header>
  )
}
