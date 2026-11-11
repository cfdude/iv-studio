# Plan: the audio side, themed like Workflows

Spec: `docs/superpowers/specs/2026-11-10-audio-side-theme-design.md` (approved by Matthew 2026-11-10).
Branch and worktree: `claude/comfy-premium` in `C:\Users\Matthew\iv-studio-premium`. Nothing is committed until
Matthew has seen the result. No publishing, pushing or spending.

## Verified facts this plan relies on

- The sidebar's halves are `SECTIONS.video` / `SECTIONS.audio` in `src/renderer/src/App.jsx` (audio: voices, lines,
  music, sounds, characters, settings). `savedSection()` opens the audio side on `'voices'`;
  `switchSection(next)` falls back to `SECTIONS[next][0][0]` when the current page isn't in the half. Pages render
  as `{page === 'voices' && <VoicesPage {...ctx} />}` etc.; `ctx` includes `go: setPage`, so every page can take a
  `go` prop.
- `Workflows.jsx` builds cards from `WORKFLOWS` (`src/renderer/src/workflows.js`: `page, name, tag, about, credit,
  needs`) and per-card art via `import.meta.glob('../assets/workflows/*.webp')`, with classes `.workflow-cards`,
  `.workflow-card`, `.workflow-art` (`--card-art`), `.workflow-name`, `.workflow-needs`.
- `Hero.jsx` exports `ART`, built from `assets/pages/*.webp`; a new `assets/pages/audio.webp` becomes `ART.audio`
  automatically.
- `Stage.jsx` exports `Stage({ effect, art, title, kicker, back, help, children })`; effects live in `EFFECTS`
  (`make(w, h) -> state`, `draw(ctx, state, w, h, t, dt)`), already paused off screen / when hidden and drawn as a
  settled still for Reduce motion (`html.rm` or `prefers-reduced-motion`). `children` render in `.stage-bar`.
- Audio pages: `VoicesPage` and `LinesPage` in `components/Voices.jsx` (Voices' design state is inside the child
  `DesignVoice`: `description`, `text`, `seed`, `busy`, `takes`, `design()`); `LinesPage` holds `voiceId`, `text`,
  `seed`, `busy`, `speak()`; `MusicPage` (`components/Music.jsx`) holds `form` (`form.caption` is the style), `mode`
  (`'new'|'remix'`), `make()`, `spec?.ready`; `SoundsPage` (`components/Sounds.jsx`) holds `form.description`,
  `status?.ready`, `make()`. Each uses `<Hero art="<page>" title kicker="Audio" />`.
- Tours: `src/renderer/src/tours.js` (`TOURS`, `TOUR_FOR_ART`); `test/tours.mjs` fails when a step's selector or
  step heading no longer exists. The full tour's audio step is `{ go: { page: 'voices', section: 'audio' },
  at: '.section-switch', ... 'Audio has Voices, Lines and Music.' }`.
- Codex images: `~/.claude/skills/chapter-flow-site/scripts/codex-images.ps1 -Dir <out> -Jobs <jobs.json>
  [-Style ...]`; jobs `{ f, p, r? }`; 1 to 4 minutes per image; ChatGPT plan, no per-image cost.

## Task 1: the five pictures (review gate)

Files: `docs/art/audio/jobs.json` (create), `docs/art/audio/review.png` (create), masters in `docs/art/audio/`
(create). Nothing goes into `src/` in this task.

- [ ] Write `docs/art/audio/jobs.json` with five jobs, each with `r` references:
  - `card-voices.png`: lips with two small sound arcs; refs `assets/workflows/reel.webp` (card layout and finish),
    `assets/pages/voices.webp` (subject).
  - `card-lines.png`: a ribbon microphone; refs `workflows/reel.webp`, `pages/lines.webp`.
  - `card-music.png`: a record player; refs `workflows/reel.webp`, `pages/music.webp`.
  - `card-sounds.png`: the wooden sound drum (wind machine); refs `workflows/reel.webp`, `pages/sounds.webp`.
  - `banner-audio.png`: a pair of studio headphones centred about a third of the height, the banners' swirls all
    round; refs `pages/music.webp` (background and placement), `pages/lines.webp` (subject finish).
  Card prompt (shared): "A wide 3:2 illustration in exactly the style of the first reference: deep near-black
  background, coral-red and pink hand-inked swirls, the subject drawn correctly and believably on the right half,
  the left 45% dark and nearly empty for text, fewer swirls than the second reference. No text, letters, numbers or
  logos anywhere." Style override: `-Style "Hand-inked illustration, coral red, pink and cream on near-black, no
  photographic look, no text, letters, numbers or logos."`
- [ ] Run `codex-images.ps1 -Dir docs\art\audio -Jobs docs\art\audio\jobs.json -Style ...` in the background;
  expected: five PNGs (about 1672 x 941 or 1536 x 1024).
- [ ] Inspect each at full size: subject drawn correctly (no extra parts, no stray letters or numbers), the left
  side dark on the cards. Redraw any failure once with a tightened prompt.
- [ ] Make `review.png` (the four cards as they'd sit in the card grid, plus the banner) and send it to Matthew.
  **Stop here until he approves the pictures.**

## Task 2: Audio front page

Files: `src/renderer/src/audio.js` (create), `src/renderer/src/components/AudioHome.jsx` (create),
`src/renderer/src/assets/audio/{voices,lines,music,sounds}.webp` and `src/renderer/src/assets/pages/audio.webp`
(create), `src/renderer/src/App.jsx`, `src/renderer/src/tours.js` (modify).

- [ ] Export the approved pictures: cards 800 x 533 WebP quality 86 (centre crop to 3:2), banner 1400 x 737 WebP
  quality 86 (centre crop), with Python PIL as `build/installer-art.py` does.
- [ ] `audio.js`: `export const AUDIO_TOOLS = [{ page, name, tag, about, needs, credit }]` for voices, lines, music,
  sounds, with the tags, needs and credits in the spec's table and `about` from each page's lede.
- [ ] `AudioHome.jsx`: `export default function AudioHome({ go })`: `<Hero art="audio" title="Audio" kicker="Voices,
  lines, songs and sounds" />`, a lede ("Everything you hear." / one line about using them in shots and edits), and
  the cards exactly as `Workflows.jsx` renders them (same classes), with art from
  `import.meta.glob('../assets/audio/*.webp')`.
- [ ] `App.jsx`: add `['audio', 'Audio']` first in `SECTIONS.audio`; render `{page === 'audio' && <AudioHome
  {...ctx} />}`; the initial page for a saved audio section becomes `'audio'`; the `iv:go` / `startTool` paths that
  open music or lines are unchanged.
- [ ] `tours.js`: add `audio: { title: 'Audio', steps: [ intro, { at: '.workflow-cards', ... } ] }`, add
  `audio: 'audio'` to `TOUR_FOR_ART`, and change the full tour's audio step to `go: { page: 'audio', section:
  'audio' }`, text "Visual and Audio switch the sidebar. Audio has Voices, Lines, Music and Sounds."
- [ ] Run `node test/tours.mjs`; expected pass.

## Task 3: four banner animations

Files: `src/renderer/src/components/Stage.jsx` (modify).

- [ ] Add `speech`, `scope`, `rings` and `ripple` to `EFFECTS`, each `make`/`draw` in the existing style
  (colours `RED`, `PINK`, `CREAM`; no per-frame allocation beyond small arrays):
  - `speech`: 5 to 7 horizontal sine bands centred on the banner's middle, amplitude swelling and settling every
    1.5 to 2.5 s like phrases, fading towards the edges.
  - `scope`: a waveform made of speech-like bursts scrolling right to left at about 120 px/s, drawn as a
    centre-mirrored filled shape, with a fixed cream playhead line at 62% of the width.
  - `rings`: rings born at the centre every 0.5 s (120 BPM), growing and fading, with faint concentric groove
    lines turning slowly.
  - `ripple`: an impact every 0.8 to 1.6 s at a random point, three expanding rings with a short cream flash.
- [ ] Reduce motion keeps working with no change: the existing `still` path runs 120 steps and draws once.

## Task 4: the banners and quick-start bars on the four pages

Files: `components/Voices.jsx`, `components/Music.jsx`, `components/Sounds.jsx`, `src/renderer/src/studio.css`,
`src/renderer/src/tours.js` (modify).

- [ ] Voices: move `description`, `text`, `seed`, `busy`, `takes` and `design()` from `DesignVoice` into a
  `useDesignVoice({ notify })` hook called in `VoicesPage`; `DesignVoice` takes them as props (same markup and
  behaviour). Replace `<Hero art="voices">` with `<Stage effect="speech" art="voices" title="Voices" kicker="A voice
  for every character" help="voices" back={{ label: 'Audio', onClick: () => go('audio') }}>` and a bar: an input
  bound to `description` (placeholder "Describe a voice: age, accent, pace, mood…") and a "Make three takes" button
  calling `design()` (switches `tab` to `'design'` first), disabled exactly as the form's button
  (`!status?.ready || busy || !description.trim()`); when `!status?.ready`, the bar shows "Set up Voices first" and a
  button that scrolls `.engine-strip` into view. `VoicesPage` gains the `go` prop from `ctx`.
- [ ] Lines: `<Stage effect="scope" art="lines" ...>` with a bar: the voice select (`voiceId` / `voices`), an input
  bound to `text`, and "Speak" calling `speak()`, disabled as the composer's Speak button; Enter in the input speaks.
  With no voices, the bar says "Make a voice first" with a button to `go('voices')`.
- [ ] Music: `<Stage effect="rings" art="music" ...>` with a bar: an input bound to `form.caption` ("Describe the
  music: genre, mood, instruments…"), "Make it" calling `make()` (disabled as the form's Make it button), and
  "Remix a song" setting `mode` to `'remix'` and scrolling the composer into view.
- [ ] Sounds: `<Stage effect="ripple" art="sounds" ...>` with a bar: an input bound to `form.description`, "Make it"
  calling `make()` (disabled as the form's button). When the model isn't ready, the bar says so with a button that
  scrolls to the download card already on the page.
- [ ] `studio.css`: a `.stage-quick` row inside `.stage-bar` (input grows, buttons fixed, wraps under 720 px, 44 px
  tall controls), and `.stage-quick-note` for the "first" messages. Use the existing input and `.btn` styles.
- [ ] `tours.js`: add a first step `{ at: '.stage-quick', title: 'Quick start', text: ... }` to `voices`, `lines`,
  `music` and `sounds`; leave the other steps. Run `node test/tours.mjs`; expected pass.

## Task 5: checks and record

Files: `docs/art/README.md` (modify), `C:\Users\Matthew\Documents\IVAI\AGENTS.md` (modify).

- [ ] `npm.cmd run build` (`electron-vite build`); expected clean.
- [ ] The test folder as run on the 1.1 line (same skips); expected the same 69 passes, with `tours` still passing.
- [ ] Test copy over DevTools (own data, ComfyUI pointed at a closed port): the audio side opens on Audio; four
  cards each open their page; each page's back link returns to Audio; each banner canvas changes between two
  frames 500 ms apart, and is identical between frames with `html.rm` set; each bar's input fills the form field
  below and each bar button's `disabled` equals the form button's; no console errors.
- [ ] Screenshots of Audio, Voices, Lines, Music and Sounds at 1440 x 900 and 1066 x 677; check overlap, wrapping
  and readability; send to Matthew.
- [ ] Add an "Audio side art (2026-11-10)" section to `docs/art/README.md` (tool, prompts file, picks, sizes) and a
  status entry to `AGENTS.md`. Leave everything uncommitted.

## Not covered

Generating real voices, lines, songs or sounds from the bars (needs the models and the GPU); the bars call the same
functions as the forms, which the test copy checks. Mac and Linux appearance.
