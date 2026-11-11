# The audio side, themed like Workflows

Agreed with Matthew on 2026-11-10 ("Make the audio side more themed. I like what we did with the workflows").
Decisions he made: both a front page and animated banners; new Codex art for the cards; a quick-start bar on each
banner; drawn motion, not motion that reacts to real sound.

## What changes

### 1. An Audio front page

- A new page `audio`, the first item of the audio sidebar, labelled **Audio**. The audio side opens on it
  (`switchSection('audio')` and a saved audio section both land there) instead of on Voices.
- It mirrors `Workflows.jsx`: a banner (`<Hero art="audio">`), one lede line, then four cards in the existing
  `.workflow-cards` / `.workflow-card` style, each opening its page.
- The cards' words live in a new `src/renderer/src/audio.js`, in the same shape as `workflows.js`
  (`page`, `name`, `tag`, `about`, `needs`, `credit`):

| Page | Tag | Needs | Credit |
|---|---|---|---|
| Voices | A voice for every character | VoxCPM2 and Whisper on this PC (one-time setup, about 12 GB) | VoxCPM2 (OpenBMB), Whisper large-v3 turbo (OpenAI) |
| Lines | Say it in their voice | A voice from Voices | VoxCPM2 |
| Music | Songs and scores | MiniMax Music 3 or ACE-Step 1.5 on this PC (Setup) | MiniMax Music 3, ACE-Step 1.5 Turbo |
| Sounds | Effects, ambiences and loops | Stable Audio 3 on this PC (Setup) | Stable Audio 3 (Stability AI) |

  The `about` line for each is the page's existing lede, shortened to one sentence.
- Characters and Settings stay in the audio sidebar as now; the Library stays above the switch.

### 2. Animated banners on Voices, Lines, Music and Sounds

- Each page's `<Hero>` is replaced by `<Stage>` (the Workflows tools' banner), keeping the page's own banner art
  (`art="voices"` etc.), a back link to Audio, and its How it works button (`help`).
- Four new effects in `Stage.jsx`'s `EFFECTS`, drawn in the same colours (red, pink, cream) and the same way as the
  existing five:
  - `speech` (Voices): soft sine bands breathing outward from the middle, as if from the lips.
  - `scope` (Lines): a waveform scrolling right to left past a fixed cream playhead.
  - `rings` (Music): rings rolling outward from the centre at a steady tempo, like grooves leaving a record.
    (Reel already uses `beat`'s equaliser bars, so Music gets its own.)
  - `ripple` (Sounds): ripples spreading from a random point every second or so, as from an impact.
- They behave exactly as the existing effects: paused when the window is hidden or the banner is off screen, and one
  still frame when Reduce motion is on (the app setting or the system's).

### 3. A quick-start bar on each banner

The bar sits in `Stage`'s `children` slot, like Reel's drop bar. It edits the same state as the page's form below,
so nothing is typed twice and the form stays exactly as it is.

- **Voices:** a "Describe a voice" field and **Design**: the design tab's description and its design action.
- **Lines:** a line field, the voice choice (the same voice chips the New line form shows) and **Speak**: the New
  line form's text, voice and speak action.
- **Music:** a "Describe the music" field (the style), **Make it** (the existing make, using the rest of the form as
  it is), and **Remix a song** (switches the form to remix mode and scrolls to it).
- **Sounds:** a "Describe a sound" field and **Make it**: the form's description and make action.

Each button is enabled exactly when the form's own button is (engine ready, words present), and when it isn't, the
bar says why in one short line (for example "Set up Voices first" with a button that scrolls to the setup card).

### 4. Art (Codex, reviewed before use)

Five pictures made with ChatGPT image generation through the Codex CLI
(`~/.claude/skills/chapter-flow-site/scripts/codex-images.ps1`, Matthew's ChatGPT plan, no per-image cost):

- Four card pictures, `src/renderer/src/assets/workflows/`-style but in a new `assets/audio/` folder
  (`voices.webp`, `lines.webp`, `music.webp`, `sounds.webp`, 800 x 533): the page's subject (lips, ribbon
  microphone, record player, sound drum) on the right, a dark open left side for the card's words, fewer swirls.
  References: an existing card (`assets/workflows/reel.webp`) for the layout and finish, and the page's own banner for
  the subject.
- One banner for the Audio front page, `assets/pages/audio.webp` (1400 x 737), in the page banners' style, its
  subject a pair of studio headphones. References: an existing page banner for the background.
- No text, letters or numbers in any picture. Each is checked close up; anything garbled is redrawn. Matthew sees all
  five before they go into the app. Masters, prompts and the review sheet go in `docs/art/audio/`, and
  `docs/art/README.md` gets a section like the earlier ones.

## What doesn't change

The audio pages' forms, settings, lists and actions; the Visual side; Characters and Settings; the Library; the MCP
server. No new dependency.

## Checks

- `npm run build`, and the existing test folder (as run on the 1.1 line: everything that needs no live ComfyUI, GPU
  or input files).
- A test copy of the app (own data, no ComfyUI), driven over DevTools:
  - the audio side opens on Audio; each card opens its page; each page's back link returns to Audio;
  - each banner's canvas is drawing (frames change) and stops when Reduce motion is on;
  - each quick-start field fills the form below, and each button's enabled state matches the form's own button;
  - no console errors.
- Screenshots of all five pages at 1440 x 900 and at 1066 x 677, reviewed for overlap and readability.
- Not checked: generating a real voice, line, song or sound from the bars (that needs the models and the GPU); the
  bars call the same actions as the form, which is what the test copy checks.

## Where

On the 1.1 line (`claude/comfy-premium`, `C:\Users\Matthew\iv-studio-premium`), uncommitted until Matthew has seen it.
