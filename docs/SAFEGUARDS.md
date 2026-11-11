# IV Studio safeguards

What IV Studio does to prevent and limit misuse of MiniMax H3 and the other models it runs, how reports are handled,
and when this is reviewed. Every safeguard listed under "In place" was checked against the code on the date of the last
review; the file and function are named so the next review can check it again.

Last reviewed: 2026-11-10 (IV Studio 1.1 line, branch `claude/comfy-premium`).

## How IV Studio is used

IV Studio is a free, open-source desktop app. It drives the person's own ComfyUI, on their own PC or on their own
RunPod, Modal or Comfy Cloud account. Infinite Variance runs no render servers and keeps no accounts, so it can't see
prompts or outputs. That shapes what a safeguard can be: most have to live in the app, and enforcement after the fact
works through reports, the catalogs and downloads IV Studio controls, and the platforms where outputs are shared.

## In place

### Terms every H3 user accepts

- **[TERMS.md](../TERMS.md)** binds users to terms at least as protective as the MiniMax H3 Community License's use
  restrictions (section V) and Acceptable Use Policy (Exhibit A), plus IV Studio's own consent rules. Where the two
  differ, the stricter applies.
- **Asked before the first H3 render or training.** `src/service/terms.js` `checkH3Terms` runs in `Comfy.submit`
  (`src/service/comfy.js`) for every graph that loads H3 or a model built on it (`usesH3`: H3 nodes, H3 model and LoRA
  files, Viggle Remake), and in `Trainings.startTraining` (`src/service/training.js`). In the app
  (`src/main/index.js`, "terms for MiniMax H3") the render waits while the window shows the notice
  (`src/renderer/src/components/H3Terms.jsx`); nothing is queued unless the person ticks the box and agrees. The MCP
  server (`src/mcp/server.js`) refuses H3 work until the person has agreed in the app: an agent can't agree for them.
- **The notice** lists the rules in plain words, says they apply to everything made with H3, keeps the "Powered by
  MiniMax H3" credit, and links the full terms, MiniMax's licence and the abuse address. Agreeing is saved once per terms
  version (`h3Terms` in settings, `H3_TERMS_VERSION`); a new version asks again.
- **Also offered** on Check my PC's last step and in Settings › About › Terms of use, where the agreed date shows.
- **Incognito doesn't skip it**: the agreement lives in the base settings, shared by both modes.
- Tested by `test/terms.mjs`.

### Consent for real people

- **Character training** (`src/service/training.js`): pictures and clips can't be added until the person confirms they
  show an invented person or someone who agreed (`addStills`, `addClips` refuse without `consent`). Characters page
  checkbox (`Characters.jsx`); MCP `update_character_training` / `add_training_files`.
- **RefMod characters** (`src/service/refmods.js` `make`): refused without consent. Checkbox in `CharacterSources.jsx`;
  MCP `make_refmod_character` requires `consent`.
- **Cloned voices** (`src/service/voices.js` `create`): a voice from a recording is refused without consent (own voice,
  an invented one, or someone who agreed). Checkbox in `Voices.jsx`; MCP `create_voice`. Designed voices need none.
- **Reminders** in Replace ("Only replace people with characters you made, or with someone's consent"), the Voices tour
  and the training voice step.
- **Ready-made characters** (Tess Marlow, Theo Lindqvist) are invented.

### Civitai LoRAs

- **Real people and minors never show** (`src/service/civitai.js`): models, versions and previews Civitai flags `poi`
  (a real person) or `minor` are dropped from search (`allowed`, `previews`), refused on open and download (`model`
  throws "That LoRA isn't available here", and `download` goes through `model`), and not matched when identifying files
  on disk (`identify`). Tested by `test/civitai-download.mjs` (real-person refusal).
- **Mature content is off by default.** Turning on "Show mature LoRAs" (Settings › Civitai) asks the person to confirm
  they're 18 or over first; only then does IV Studio use Civitai's unrestricted address. Mature previews stay blurred
  until clicked; showing them unblurred is a second, separate switch that only appears once mature is on, and turning
  mature off turns it off too (`Settings.jsx` `CivitaiCard`, `Loras.jsx` `LoraThumb`). The MCP server follows the same
  setting.
- **Downloads need the person's own Civitai key**, so Civitai's own account rules and filters apply to them.

### Credits and licence notices

- "MiniMax H3" is shown where it's chosen (Create's model switch) and in Settings › About › Terms of use, with the
  "Powered by MiniMax H3" credit.
- MiniMax's licence and notice ship with the app (`resources/licenses/MiniMax-H3-LICENSE.txt`,
  `MiniMax-H3-NOTICE.txt`) and are summarised in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).
- Settings › About › Credits lists every model, tool, node pack and library with its maker, use and licence
  (`src/renderer/src/credits.js`); `test/credits.mjs` fails when something in `resources/models.json`, a node pack or
  a picture family isn't credited.
- Viggle Remake carries "Powered by Viggle Remake" (`src/service/remake.js` `CREDIT`).
- The editor can add a "Made with IV Studio" end card to exports (off unless turned on).

### Paid and hosted models

- Seedance and other Comfy.org partner models run on the providers' own services under their moderation; IV Studio
  explains a provider's content-policy refusal in plain words (`src/service/failures.js`).

### Reporting

- **Report misuse** in Settings › About opens an email to **abuse@infinitevariance.ai**; the address is also in the
  H3 notice, [TERMS.md](../TERMS.md) and the README.

## Handling reports and takedowns

1. **Receive.** Reports arrive at abuse@infinitevariance.ai. Acknowledge each within 2 working days.
2. **Assess.** Within 5 working days, check the report against TERMS.md and MiniMax's Acceptable Use Policy. Anything
   involving a minor, a threat to someone's safety, or non-consensual intimate imagery is handled the same day.
3. **Act on what IV Studio controls.**
   - Remove or disable anything Infinite Variance hosts or distributes: the ready-made character catalog
     (`characters-v1` release), Recommended LoRAs, release files, the website and any hosted service.
   - Block a Civitai model or a model download from IV Studio's lists in the next update when it's being used to break
     the terms.
   - Refuse support, and access to any service Infinite Variance runs, to someone who breaks the terms; suspend repeat
     violators once accounts exist (hosted services).
4. **Act through others.** IV Studio can't delete files from someone's own PC. For content posted elsewhere, report it
   to the platform that hosts it with the evidence, and help the person affected do the same. Report child sexual abuse
   material to NCMEC (CyberTipline) or the local equivalent, and credible threats to the police. Preserve the evidence;
   never redistribute it.
5. **Fix the cause.** If a report shows a safeguard can be bypassed or is missing, open an issue (privately for
   security problems) and fix it in the next release.
6. **Record.** Keep a private log of each report: date, what was reported, the decision, the action and when it was
   closed. Don't keep the content itself beyond what the law requires.

## Reviews

- **Every release:** run `test/terms.mjs`, `test/civitai-download.mjs` and `test/credits.mjs` (all in CI), and check
  any new feature that runs H3 or handles real people against this page. End the release notes with the terms paragraph
  in [release-notes-terms.md](release-notes-terms.md), and keep it beside IV Studio on infinitevariance.ai/downloads.
- **Every three months**, and whenever MiniMax updates its licence or Acceptable Use Policy: re-read both, update
  TERMS.md (and `H3_TERMS_VERSION`, so everyone agrees again), re-check every "In place" item against the code, and
  update the gaps below.
- **After any report** that shows a weakness.

| Date | Version | Reviewed | Notes |
| --- | --- | --- | --- |
| 2026-11-10 | 1.1 line | Terms, notice and gate added; existing safeguards checked against the code | Gaps listed below |

## Known gaps

These are open. Each is a decision or a piece of work, not something IV Studio does today.

1. **No automated screening of prompts or outputs** for local and own-cloud H3 renders. The default local prompt writer
   is an uncensored model (`huihui_ai/qwen3-vl-abliterated`), and nothing checks prompts or finished videos for minors,
   sexual content or real people. Possible steps: a local prompt check for sexual content involving minors and named
   real people before H3 runs, and a safer default writer model.
2. **No consent check for real people outside characters and voices.** Replace and Remake (Swap people), References
   mode and @ mentions with any photo, Projects' "Use a picture" for faces, the turnaround sheet and Soft mouth accept any
   picture or video without asking. Possible step: the same consent tick before a real person's picture or video is
   used as a subject.
3. **No AI-generation marker on outputs.** MiniMax encourages tagging files made with AI; IV Studio adds no metadata
   tag or watermark (the end card is off by default). Possible step: write an "AI-generated" tag into every file
   IV Studio saves or exports.
4. **The territory isn't checked.** IV Studio has no way to know where it's used; the terms and the README tell people
   where MiniMax's community licence applies.
5. **Agreement is a local setting.** Someone who edits their own settings file, or drives IV Studio's service code from
   their own scripts instead of the app or MCP server, skips the notice. They have still been told the terms apply, and
   doing so breaks rule 18.
6. **Versions before 1.1 have no notice.** People on 1.0.x see the terms only after updating; the release notes for
   1.1 should say so.
7. **The 18+ confirmation is self-declared**, as on Civitai itself.
8. **MiniMax H3 Image and MiniMax Music 3** are separate models under their own licences and aren't covered by the H3
   notice. Their licences haven't been checked for a matching obligation.
9. **No accounts**, so "suspending repeat violators" can only apply to services Infinite Variance runs, not to the app on
   someone's own PC.
