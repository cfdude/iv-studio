import Stage from './Stage'
import { AUDIO_TOOLS } from '../audio'

// The audio side's front page, in the Workflows page's style: a tall banner, a line, and a card per tool with its own
// art (assets/audio/<page>.webp, docs/art/audio). A tool without a picture shows the plain card.
const CARD_ART = Object.fromEntries(
  Object.entries(import.meta.glob('../assets/audio/*.webp', { eager: true, import: 'default' })).map(([file, url]) => [file.split('/').pop().replace('.webp', ''), url])
)

export default function AudioHome({ go }) {
  return (
    <div className="workflows audio-home">
      <Stage effect="pulse" art="audio" title="Audio" kicker="Voices, lines, songs and sounds" />
      <p className="lede">
        Everything you hear.
        <span className="lede-small dim">Voices for your characters, the lines they say, songs and sound effects. Everything you make is kept, ready for a shot or an edit.</span>
      </p>
      <div className="workflow-cards">
        {AUDIO_TOOLS.map((t) => (
          <button key={t.page} className="workflow-card" onClick={() => go(t.page)}>
            {CARD_ART[t.page] && <span className="workflow-art" aria-hidden="true" style={{ '--card-art': `url("${CARD_ART[t.page]}")` }} />}
            <span className="mono pink">{t.tag}</span>
            <span className="workflow-name">{t.name}</span>
            <span className="small dim">{t.about}</span>
            <span className="workflow-needs small">
              <span className="mono pink">Needs</span> {t.needs.join(' · ')}
            </span>
            <span className="mono small dim">{t.credit}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
