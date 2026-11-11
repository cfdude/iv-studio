# IV Studio artwork: the closed eye (Incognito)

While Incognito is on, IV Studio's eye art is shut: the page banners and the foot of the sidebar show
`src/renderer/src/assets/eye-closed.webp`, and the title bar shows `iv-mark-closed.png`.

## The banner art (2026-10-29)

- Local ComfyUI on Matthew's RTX 4090, free, the same pipeline as IV Chat's and IV Downloader's art: Flux.2 Klein 9B,
  `qwen_3_8b` text encoder, `flux2-vae`, 4 steps, euler, 1536 × 800.
- Reference: IV Studio's own `eye.webp`, passed in as a reference latent, so everything around the eye stays the same.
- Prompt: `closed-eye-prompt.txt`. The exact graph: `closed-eye-workflow-seed-101.json`.
- Seeds 101, 202 and 303 were rendered; 101 was picked because its eye sits exactly where the open one does and its
  lashes read at banner size. Master: `closed-eye-master.png`; the app copy is resized to the original's 1400 × 737
  (WebP, quality 88). Raw outputs are in `F:\ComfyUI\ComfyUI\output\IV-Studio\`.

## The title-bar mark

`make_closed_mark.py` builds it from `iv-mark.png`'s own pixels: the logo's real outer outline below its middle (the
shut lid), lifted to sit across the eye's middle, with five lashes at the outline's own stroke width. The iris is
left out.

    python docs/art/make_closed_mark.py src/renderer/src/assets/iv-mark.png src/renderer/src/assets/iv-mark-closed.png

## Each page's own banner (2026-10-29)

Matthew asked for every page to have its own version of the eye art. The dashboard (home) keeps the eye; every other page swaps
the eye for its own subject in the same style (`src/renderer/src/assets/pages/<page>.webp`, chosen by `<Hero art>`).
Incognito still shows the closed eye on every page.

- Same recipe as the closed eye: Flux.2 Klein 9B with `eye.webp` as the reference latent, 4 steps, 1536 × 800, local
  and free. `page-art.mjs` holds each page's subject and the prompt, and renders seeds 101, 202 and 303.
- Picks (seed): shots 101 (clapperboard), sequences 202 (curling filmstrip), edit 101 (scissors through film),
  workflows 202 (cogs), shinobi 303 (katana), replace 202 (two masks), sizzle 202 (lit match), characters 101 (cameo
  profile), loras 101 (lens), cloud 202 (storm cloud), settings 202 (crossed wrenches), library 202 (fanned
  photographs), voices 101 (lips), lines 202 (ribbon microphone), music 101 (record player).
- Settings and Library were rendered a second time with new subjects; a dial knob and a stack of film cans didn't
  read at banner size.
- Create (2026-10-30, when the dashboard took the eye): create 303, an open hand releasing a burst of sparks. A film
  camera was also tried and dropped: Flux drew fake lettering on it.
- Projects (2026-10-30, when Projects joined the sidebar): projects 303, a director's chair and a megaphone.
- The app copies are 1400 × 737 WebP (quality 86), the eye's own size. Raw outputs are in ComfyUI's
  `output\IV-Studio\page-art\`. `page-art-banners.jpg` shows every page's banner in the app.

## Every page banner redrawn with Codex (2026-11-06)

Matthew found the Edit scissors (both finger loops on one side, no single pivot) and the Projects director's chair
(broken legs, floating megaphone) badly drawn, then asked for every page banner to be redrawn the same way, because
the Codex versions looked much better. The Flux banners above are replaced; the dashboard eye and the closed eye are
unchanged.

- ChatGPT image generation through the Codex CLI (`~/.claude/skills/chapter-flow-site/scripts/codex-images.ps1`),
  one job per page, no text in the pictures.
- References: each page's own Flux banner (for its background and placement) plus the approved new Edit scissors
  (for the subject's finish). The prompt keeps the background swirls and asks for the subject "drawn correctly and
  believably, every part in the right place", centred at about a third of the height.
- Edit and Projects had three variants each; A was picked for both. The other 15 pages were drawn once and all
  passed a close-up check. Known nits: the record player's cartridge carries a tiny "89" and its feet, like the tip
  of the Cloud lightning bolt, sit slightly below the banner's visible band.
- The app copies are 1400 x 737 WebP (quality 86), resized from the 1672 x 941 masters and cropped to the middle.
  The masters, the prompts (`jobs.json`, `jobs-15-pages.json`), the old Flux banners and the review sheets are in
  `D:\H3Characters\_art\page-banners-20261106\`, outside the repo.

## The Workflows cards (2026-11-06)

Matthew asked for each card on the Workflows page to have its own picture behind its text, faded, in the banners' style.

- ChatGPT image generation through the Codex CLI (`~/.claude/skills/chapter-flow-site/scripts/codex-images.ps1`),
  Matthew's default for stills. No text in the pictures; the card sets its own type in code.
- References: Shinobi was drawn first from the Shinobi and Workflows banners and approved as the concept; the
  other four used the Shinobi picture plus their own page's banner (Reel uses the music banner, as its page does).
- Subjects: sequences (one unbroken looping filmstrip), sizzle (a lit match whose flame becomes film), reel (a
  record with photographs fanned around it), shinobi (a katana cutting a filmstrip), replace (two masks swapping).
  The prompts are in `workflow-cards.json`.
- The app copies are `src/renderer/src/assets/workflows/<page>.webp`, 800 x 533, WebP quality 80 (49 to 77 KB).
  The 1536 x 1024 masters are kept outside the repo.
- On the card (`.workflow-art` in `studio.css`): right-aligned, 30% strength, faded out toward the left and the
  bottom; 36% and a 3% zoom on hover or keyboard focus (no zoom or transition with reduced motion). A soft halo in
  the card's own colour behind the text keeps the letters on dark: measured under the glyphs, the body text stays
  within about 0.2 of its plain-card contrast (5.9:1) at the 5th percentile, and at least 5.0:1 at its worst pixel.

## The welcome wizard (2026-11-06)

Matthew asked for an onboarding wizard that checks the PC, themed like the other pages, with new art where it needs it.

- ChatGPT image generation through the Codex CLI, the same recipe as the page banners: the Settings banner as the
  first reference (background and placement), the approved Edit scissors as the second (finish), no text.
- Three subjects, one per stage: `pc-scan` (a magnifying glass over a microchip) while it scans, `pc-card` (a graphics
  card with two fans) for Your PC, `pc-path` (a ship's compass on a chip) for Your way and Downloads. Welcome and
  Ready keep the eye. All three were drawn once and passed a close-up check.
- The app copies are 1400 x 737 WebP (quality 86), cropped to the middle of the 1672 x 941 masters. Masters, the
  prompts (`jobs.json`) and the sheet are in `D:\H3Characters\_art\welcome-20261106\`, outside the repo.

## Rebuild's banner and card (2026-11-08)

Rebuild joined the Workflows page as its sixth card, with its own page banner, as its design asked
(`docs/superpowers/specs/2026-11-08-rebuild-workflow-design.md`).

- ChatGPT image generation through the Codex CLI (`codex-images.ps1`), no text in the pictures.
- Subject: a strip of film whose frames have come apart and float in a loose arc, the last ones snapping back into
  the strip. Banner references: the Workflows and Sequences banners. Card references: the Shinobi card and the
  Sequences banner, with the card prompt the other five used.
- Two of each were drawn; banner A and card A were picked (banner B read as a plain wavy strip). Both passed a
  close-up check.
- The app copies: `assets/pages/rebuild.webp` (1400 x 737, WebP quality 86, from the 1672 x 941 master) and
  `assets/workflows/rebuild.webp` (800 x 533, quality 80). Masters, prompts (`jobs.json`) and the review sheet
  are in `D:\H3Characters\_art\rebuild-20261108\`, outside the repo.
## The audio side and the tall banners (2026-11-10)

Matthew asked for the audio side to be themed like Workflows, then for the visual side to match, with the top bar and
more animation; then that nothing flashes (photosensitive safety) and that Cloud be dreamy, not stormy.

- ChatGPT image generation through the Codex CLI (`codex-images.ps1`), no text in the pictures, each one checked
  for stray letters before use.
- Audio front page banner `assets/pages/audio.webp` (1400 x 737, from banner-audio-v2) and four cards in
  `assets/audio/` (voices, lines, music, sounds; 800 x 533). Prompts (`jobs.json`, `jobs-banner-v2.json`) are in
  `docs/art/audio/`; the masters and review sheet are in `D:\H3Characters\_art\audio-20261110\`, outside the repo.
- Cloud's banner was redrawn as soft drifting clouds instead of lightning: `assets/pages/cloud.webp`. The storm
  original is kept at `docs/art/cloud-dreamy/cloud-storm-before.webp`; prompt in `docs/art/cloud-dreamy/`, master in `D:\H3Characters\_art\cloud-dreamy-20261110\`.
- Motion is drawn on a canvas (`components/MotionCanvas.jsx`, effects in `components/heroMotion.js` and
  `Stage.jsx`): it pauses off screen and in a hidden window and holds still under Reduce motion. Every banner was
  measured against the WCAG 2.3.1 flash threshold (a 0.10 relative-luminance swing within half a second, in
  341 x 256 px patches): all 23 stay under 0.07.
