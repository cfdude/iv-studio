import Stage from './Stage'
import { WORKFLOWS } from '../workflows'

// Each tool card's own art (assets/workflows/<page>.webp), drawn in the page banners' style and faded behind the
// card's text (docs/art/README.md). A tool without a picture just shows the plain card.
const CARD_ART = Object.fromEntries(
  Object.entries(import.meta.glob('../assets/workflows/*.webp', { eager: true, import: 'default' })).map(([file, url]) => [file.split('/').pop().replace('.webp', ''), url])
)

// Tools that take a video further. Each is its own page; they and what each needs are in workflows.js.
const TOOLS = WORKFLOWS

export default function Workflows({ go }) {
  return (
    <div className="workflows">
      <Stage effect="cogs" art="workflows" title="Workflows" kicker="Take a video further" />
      <p className="lede">
        Tools for what comes after a render.
        <span className="lede-small dim">Each one works with your IV Studio renders and characters, and agents can use them through IV Studio's MCP.</span>
      </p>
      <div className="workflow-cards">
        {TOOLS.map((t) => (
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
