---
name: iv-studio
description: Make MiniMax H3 videos with IV Studio through its MCP server - render shots and continuous sequences with recurring characters, hunt and finish previews, retake stretches, and cut renders together on IV Studio's timeline (trims, titles, sound, export), and turn a website into a sizzle or promo film. Use whenever the person asks for IV Studio, an H3 shot or sequence, a character video, a sizzle or promo video for a website, or an edit of their IV Studio renders.
---

If the `iv-studio` MCP tools aren't available, IV Studio has to be installed and its server added: the exact command for an install is under Settings -> Agents (MCP) in the app. Download: https://github.com/hollisorg/iv-studio/releases

IV Studio is a desktop app for MiniMax H3 video on a local ComfyUI: it renders shots and continuous
sequences with recurring characters, and cuts them together on its own timeline. Its MCP server
(`iv-studio`) uses the same projects, renders and edits as the app window, so what you make shows up
there for the person, and the other way round.

## Start menu

When a chat starts with IV Studio and the person hasn't said what they want, offer the start menu: call
`get_menu` and give its choices as one multiple-choice question (your app's question or options tool if it
has one, otherwise a short numbered list), plus "something else". Each choice comes with what to do next.
Apps that show MCP prompts also list them as slash commands (in Claude Code, `/mcp__iv-studio__start` and
`/mcp__iv-studio__make_a_shot` and so on).

## First steps

1. `check_setup`: is ComfyUI up, which GPU, are the node packs and models there? If something is
   missing, tell the person what the result says to do rather than working around it. Missing node
   packs: offer `install_node_packs` (it adds them to this PC's ComfyUI; ComfyUI then needs a restart).
2. `list_characters`: the character presets (LoRA, trigger word). Prompts write `{char}` where the
   character goes; IV Studio swaps in the trigger word. `list_ready_characters` shows IV Studio's
   ready-made ones (Tess, Theo); `install_ready_character` downloads one.
3. `list_projects`, `list_sequences`, `list_edits`, `list_renders`: what already exists.

## Render a shot

1. Draft the prompt yourself or with `write_prompt` (a free local writer; `engine: "contextir"` is
   MiniMax's paid writer, so ask the person first).
2. `plan_render` checks the request and shows sizes, frames and the finished size without rendering.
3. `generate_previews` starts 1-3 low-resolution candidates (seed, +1000, +2000) and returns a job.
4. Poll `get_job` every 20-30 s until `done`. A 5 s preview takes about 1-3 minutes on a 4090.
5. Look at the candidates: `grab_frame` with `file` and a time shows you a frame of any output.
6. `finish_candidate` with the best one (2 MP pass + DLSS, optional RTX 2x and frame generation).
   It reuses the preview's saved latent, so the picked performance stays the same. Poll `get_job`.

Modes: `text` (prompt only), `reference` (pictures, videos or audio named `<Picture 1>`,
`<Video 1>`, `<Audio 1>` in the prompt), `frames` (first and optional last frame), `continue`
(extend a video from its last frames). `voiceLine` lip-syncs the previews to a recording.
`prepare_media` crops pictures and trims videos and sounds first (first/last frames should be
cropped to the shot's aspect, because they're stretched to fit).

## Directing a scene

IV Studio directs the way Matthew Hollis's directing method says (`get_guide` with topic `directing` returns it
whole). Follow it whenever you write, stage or revise a scene yourself:

- **Purpose first.** Start from the emotional change, the visible action that shows it, and the one or two
  details that must survive (a face, a product, a logo, a prop). Don't add lines, people, props, camera moves or
  places just to fill the time; a quiet reaction can carry a scene.
- **A reference map.** Give each reference a role (identity, wardrobe, logo, place, light, prop, movement,
  blocking sketch), say which wins where two disagree, and name the few details recognition depends on. A
  reference's pose doesn't fix the performance or the camera.
- **Staging before camera.** Where each person starts by screen side (the viewer's left, not the character's),
  which way they face, who they look at, how far apart, and where they move. With two people, keep the camera on
  one side of the line between them. Then frame the action so it reads.
- **Continuity across cuts.** Each shot opens where the last one left things: positions, hands and props, gaze,
  direction of travel. In Projects every shot has `staging` and `ends` (`edit_film_shot`), and the next shot's
  prompt starts from the previous one's `ends`.
- **The staging board.** A shot's `stage` is a top-down plan in metres (people with facing, who they look at and
  where they walk; the camera with lens, height and move). `edit_film_shot` with `stage` turns it into exact
  screen-side `staging` and `camera` words and returns `lineWarnings` when two people swap sides from the scene's
  last staged shot. Words alone handle simple paths well; the board's value is exact, consistent sides across shots.
- **Previs for a moving camera.** `make_previs` draws a board plan in motion as a grey clip (mannequins and boxes,
  about 3 s on this PC). Attach it as a video in References mode and put its `words` in the prompt. Use it for an
  arc round people, which H3 follows from a previs and barely does from words; for a push, pull, track, pan or
  walk the staging words did as well or better in tests, and render 1.6-3.5x faster. Projects films only arcing
  shots from their previs. Never let
  the prompt describe the mannequins or their greys; the checker stops a prompt that does (`previs-look`).
- **Review the take, not the hope.** `review_take` has the person's writer look at frames from a take and name
  each problem with its seconds, say what works, and pick one fix: none, revise the prompt (with the revised
  prompt, already through the checker), change a reference, split the action, use a clean stretch, or solve it
  in the edit. When the prompt already asked for what went wrong, it's an unmet instruction, not a missing
  phrase. The reviewer sees the shot's earlier reviews and how each run was made: a problem that came back after a
  revision or a new reference is marked `again`, and the fix moves on (to a reference, then a split, the clean
  stretch or the edit), because more words won't move an H3 habit such as talking to the camera. Show the person the review before rendering again.

`write_prompt` and the storyboard already follow these rules: Claude Code and Codex get the whole method, the
local writer a short version.

## Writing H3 prompts

MiniMax publishes its own guide to H3 prompts: `get_guide` with topic `h3-prompts` returns it. Read it before
writing a prompt yourself; `write_prompt` already follows it.

- **Check before rendering.** `check_prompt` (same arguments as `generate_previews`) lists what H3 is likely to
  misread, each with a level and sometimes a `fix` (the whole prompt mended). `generate_previews` refuses a prompt
  with errors unless you pass `force: true`; fix them instead unless the person says otherwise.
- **Ranked takes.** When a previews run finishes in the app, its takes are ranked: every spoken line heard back,
  looking like the picked character, no freezing, sharpness against the others. `get_job` shows `ranking` (each
  take's parts, score and reasons, the best marked when it stands out). `rank_takes` ranks a run now, and with
  `picked` records the person's choice, which shifts the weights towards what they keep picking.
- **Quality.** `steps: 4` is Draft (quicker previews); 8 is the default. The finish is the same either way.
- **Enhancer.** A finish's `enhancer` is `dlss` (the default: DLSS 5 in the finish, with the optional RTX 2x and
  frame generation), `upscale` (no DLSS 5: the finish's own Real-ESRGAN 2x with `upscale2x`, and RIFE frame
  interpolation with `fps` 48, 72 or 120; what a Mac uses, since DLSS 5 is Windows-only and SeedVR2 is refused on an
  Apple GPU; Real-ESRGAN x2 and the RIFE pack are optional installs in Setup, and a finish that needs one it lacks
  says so) or `seedvr2` (the finish skips DLSS, then SeedVR2 restores detail to a short side of
  `enhanceResolution`, 1080, 1440 or 2160, at 24 fps; slower). The SeedVR2 step is its own job, started by itself
  when the finish is done; `get_job` on the finish shows its id as `enhanceJob`. Ask the person which they want
  when it matters: DLSS 5 is quick, SeedVR2 adds more real detail to faces and textures.
- **Enhance afterwards.** `enhance_final` runs an already finished video through either engine as a new job in the
  same shot: `engine: "seedvr2"` with `resolution`, or `engine: "dlss"` with `scale` 1 (clean up) or 2. This PC only.
- **@ mentions.** `list_cast` gives what a prompt can name: `@Tess` (the picked character becomes `{char}`),
  another character with a face picture, or a place (`@BusStop`). A shot that mentions someone or somewhere with a
  picture renders in References mode with the pictures attached, each as `<Subject N>`. `save_place` adds a place
  (a name, a picture and a few words). The person sees the same mentions in Create.

- Text mode uses three fields: `integrated_multimodal_description:` (the shot: style, place,
  clothes, camera, action and lines), `overall_soundscape:` and `non_diegetic_music:` (N/A for none).
- Frames mode opens with MiniMax's alignment line: with only a first frame, `For the target video, at 0.00
  seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.`; with a last frame too,
  `How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the
  0.00-second mark of the target video; Picture 2 (from Shot 1) aligns with the S.SS-second mark of the target
  video.` (S.SS is the clip's real length on H3's frame grid), written as one continuous shot.
- Reference mode uses `subject_definitions:`, `summary:`, `retention_analysis:` (what each reference keeps),
  `detailed_description:`, `overall_soundscape:` and `non_diegetic_music:`.
- Dialogue: `{char} (S1) says: <d>[English] The line.</d>` One speaker label per person.
- Never describe the character's face or voice: the LoRA carries them. Describe clothes, place,
  camera and action.
- Say "There is no writing anywhere in the picture" unless text is wanted; H3 likes adding signs.

## Projects: a short film, step by step

The Projects page makes a whole film as a six-step wizard: Idea, Story, Cast and places, Storyboard, Film it,
Watch. A project holds the brief (idea, aspect, length), the cast (character presets with their voices),
places and props (descriptions and pictures), the look (notes and style LoRAs), the script, and its scenes and
shots. The person sees each step as you work (`get_film` returns `step`; `update_film` with `step` moves
them on). The tools say "film" because `list_projects` already means shots.

1. `create_film` with a name, the idea as its logline, an aspect and a length. Give it a script if the person
   has one. Screenplay format: `INT. PLACE - DAY` starts a scene, a NAME in capitals on its own line with the
   words under it is dialogue, and other paragraphs are action.
2. No script yet? `write_film_script` drafts one from the idea, the cast and the length (a minute or two on
   this PC). Show it to the person and change it with `set_film_script` until they're happy. Speakers who
   share a first name with a character preset join the cast, and so do presets named in the action of a first
   script; scene headings add places, described by the writer.
3. `update_film` to cast characters, describe each place (every shot there uses it) and set the look. Someone
   no character preset plays gets a face drawn for the film (`draw_film_face`, or when sketching), from the
   description on their cast entry, and keeps it in every sketch and shot. When the person has their own art
   for them (a reference sheet, concept art), `use_film_face` makes that picture the face instead; someone who
   never speaks (an animal, a passer-by) is added to the cast by name first. With the QMA camera angles LoRA set
   up, `draw_place_angles` draws a place from a quarter turn, the side and further back, so turned and wide
   shots keep the room (there is no true reverse view).
4. `break_down_film` (background, minutes): each scene becomes 3-10 s shots with one speaker at most, sized to
   the film's length, each shot gets its H3 prompt, then a storyboard sketch (a still on this PC's picture
   models). A place without a photo gets one drawn first (it shows on Cast and places), so every sketch there
   shares its room; the faces of the cast on screen are kept. Poll `get_film` until `breakdown.state` is done
   and `totals.sketching` is 0. `sketch_film_shots` redraws sketches.
5. Show the person the storyboard. Change shots with `edit_film_shot`, then `write_film_shot_prompt` and
   `sketch_film_shots` for that shot. `make_animatic` plays the sketches in order with the lines (seconds,
   free): show it, so pacing and length are settled before any GPU time. Get their OK before filming: every
   shot takes GPU minutes.
6. `render_film_scene` (without sceneId, the whole film) or `render_film_shot` hunt takes; each shot is an
   ordinary shot, also in Shots. A shot with a sketch opens exactly on it; with its place's picture it films
   in Reference mode, so the room stays the same however the camera moves and the other cast on screen keep
   their faces (room: false uses the sketch alone; fromSketch: false films from the prompt alone). Every line
   whose character has a voice is said first, for lip-sync, and read back with Whisper until every word is
   there (the shots show `speaking`, then `queued`, meanwhile); a shot with no line is told nobody speaks.
   `speak_film_line` with `again` makes a new take of a line; film new takes to use it. When a shot's status
   is pick, show the takes (`state.candidates`) and `finish_film_shot` the chosen one. A recording of a line
   (`use_film_recording`) replaces the voice: the shot lip-syncs to it. A shot with `continues` films on
   from the previous shot's take as one unbroken take, so film and pick that shot first. It renders one take
   (Continue mode makes one), and the rough cut starts it where the earlier take ends.
7. `build_rough_cut` lays every shot in script order on V1 of the film's edit (finished takes, else the
   picked or first preview); `export_edit` saves it as a video. Then use the Edit tools, and
   `generate_in_edit` to extend or bridge shots.

H3 follows one character LoRA per shot best: a shot's `character` is its main person; other cast on screen
come from their face pictures (Reference mode) and are named in the prompt.

## Sequences (one continuous video)

- `save_sequence` with shots (10 or 15 s each). `method: "take"` renders every shot in one seamless
  take (`render_take`); `method: "shots"` hunts and finishes shot by shot (`hunt_shot`, then
  `finish_shot`), each continuing from the last.
- Join rules for every shot after the first: open holding the previous shot's closing pose, stay
  quiet about 2 s before anyone speaks, and end settled with about 2 s to spare.
  `write_shots_from_story` writes shots that follow them.
- `retake` redoes a stretch (start..end seconds) of a version; `render_out` finishes a version
  (colour smoothing across joins, DLSS, frame generation). `get_sequence` lists versions and finals.

## Edit (the timeline)

- `create_edit`, then `add_media` with `renders` keys from `list_renders` (or file paths).
  `append: true` lays them end to end on V1 (pictures and video) or A1 (sound).
- `edit_timeline` takes a list of operations, applied in order and all checked first, so a bad one
  changes nothing: `add_clip`, `insert_clip` (everything after moves right) and `overwrite_clip`
  (replaces what's there), both with the media's `in`/`out` points, `add_title`, `update_clip` (move,
  trim with in/out, change track, fades, volume, mute, title text), `split_clip`, `remove_clip` (with
  `ripple` to close the gap), `remove_media`, `clear`, `add_track` / `update_track` / `remove_track`,
  and `add_marker` / `update_marker` / `remove_marker`. `get_edit` shows the clip ids and times, each
  track's state (`trackList`) and the markers.
- Tracks: a higher V track is drawn over a lower one (V2 over V1), T1 holds titles, A tracks are sound;
  add as many V and A tracks as the cut needs. Hidden tracks are left out of the picture, muted ones
  out of the sound, and when any track is soloed only soloed tracks are heard. Video clips play their
  own sound too unless muted.
- A track the person has locked refuses your changes: work on another track, or ask them. Markers
  are a good way to leave notes ("cut here", "music swells") for the person.
- Check the cut with `grab_frame` (edit + timeline time), then `export_edit` and poll
  `get_edit_export`. When it's done, `get_edit_export` gives the file's path; `export_edit` also
  says which folder exports go to on this computer.
- If the edit is open in the app, it reloads there and an activity strip tells the person what you
  changed, with a one-click Undo.

### New footage inside an edit

`generate_in_edit` makes footage with H3 right on the timeline, as the editor's right-click menu does:

- `extend` carries `clip` on for 5, 10 or 15 `seconds` from its last frames (Continue a video). It is
  finished by itself and inserted after the clip, pushing the rest of the track along.
- `bridge` with `clip` and `next` (two touching clips) makes a new shot from the first's last frame to the
  second's first frame, `seconds` long, inserted between them. With `gap: {track, from, to}` it fills a
  gap (up to 15 s) instead. Either way it makes 3 previews: show them to the person (the candidates' paths
  are in `list_generations`), then `pick_generation`; the pick is finished at 2 MP and placed.
- `retake` renders `from`..`to` (timeline seconds inside `clip`) again: `mode` both (picture and sound),
  video (keeps the performance) or audio (keeps the picture). It replaces that stretch.

Write the prompt as a normal H3 prompt (`write_prompt` with mode continue, frames or reference can write it).
Pass `character` when the clip shows one. Each takes GPU minutes; poll `list_generations` every 20-30 s.
The person sees a striped placeholder on the timeline while it works, and the result lands as an
ordinary clip they can undo. Retake needs ComfyUI on this PC.

`cut_out` keeps only who or what you name in a picture or clip (SAM 3.1, free, seconds): a PNG or a WebM
with a see-through background. Put it on a track above other footage (add_media, edit_timeline, muted when
the clip underneath has the same sound); export_edit keeps it see-through. The editor's right-click
"Cut out…" does the same over the clip it was made from.

`reframe` puts a video or picture in another frame shape (9:16, 1:1, 4:5, 16:9) by drawing what lies beyond its
edges: the original stays as it is in the middle and the bars are filled (video with H3's masked edit, a few
minutes for 5 s, up to 15 s; pictures with Qwen 2.1's outpaint LoRA, about 30 s). Give `about` a sentence on
what it shows. The editor's right-click "Reframe to …" fits a clip to the edit's format and swaps it in place.

## Models and characters

- `list_h3_models` and `set_workflow_model` choose the H3 model per workflow (some suit realism,
  others animation). `null` goes back to the default.
- `list_choices` lists the LoRAs and RefMods ComfyUI has; `save_character` adds a preset (with `voiceId`,
  its voice for spoken lines).

## Voices and spoken lines (Audio)

IV Studio keeps a voice per character and speaks lines in it with its own voice engine on this PC:
VoxCPM2 (OpenBMB, Apache-2.0) speaks, designs and clones, and Whisper large-v3 turbo (MIT) reads the words in
a recording. A spoken line is the shot's voice line: H3 lip-syncs to it.
1. `voice_status`; if installed is false, the engine needs a one-time setup (about 12 GB of free
   downloads): ask the person to press Set up voices on Audio > Voices, or run `setup_voices` with their OK.
2. `list_voices` shows the voices and which characters use them. Make one with `design_voice` (a
   description; up to four candidates) and `create_voice` kind designed with the chosen file, seed and
   description, or `create_voice` kind clone from a recording (only with the person's confirmation that it
   is their voice, an invented one, or someone who agreed: `consent` true). `save_character` voiceId gives
   a character the voice.
3. `speak_line` with character (or voiceId) and the words returns a WAV. Pass it as `voiceLine` to
   `generate_previews` and write the same words in the prompt's `<d>[English] …</d>`.
4. A different `seed` gives another read of the same words; `list_lines` shows what was said before. The
   first line after a pause takes about 25 s while the model loads, later ones about 5 s.

## LoRAs (Civitai and this PC)

LoRAs change how H3 looks and moves: styles, motion, camera, speed. IV Studio finds them on Civitai and keeps
track of the ones already in ComfyUI.
1. `list_my_loras` shows the installed H3 LoRAs with their Civitai names, trigger words and the person's
   favourites; `identify_lora` looks one up on Civitai by its file hash.
2. `search_loras` (query, tag, sort) finds more; `get_lora` shows a LoRA's versions, trigger words, preview
   clips and licence. Check the licence before commercial work.
3. `download_lora` installs one (ask the person first; needs `CIVITAI_API_KEY` in this server's
   environment). It returns the LoRA name.
4. Use a LoRA by passing `extraLoras: [{ name, strength }]` to `generate_previews` (strength about 0.6 to 1),
   and put its trigger words in the prompt.
Real-person LoRAs are never shown. Mature LoRAs appear only if the person turned them on in the app.

## Images (Create -> Image)

1. `list_image_models`: the image families on this PC (Flux.2 Klein 9B, Flux 3 Klein, Krea 2, Moss, Qwen Image
   2.1, Z-Image Turbo, SDXL and its fine-tunes, and MiniMax H3 stills), each with its checkpoints, whether it's
   ready, whether it can edit, and its licence. An H3 still is one frame of a very short H3 render: the look of
   the person's H3 shots, with their H3 character LoRAs (put the trigger word in the prompt).
2. `make_image` with a checkpoint as `model`. mode `generate` makes pictures from the prompt; mode `edit` changes
   `refs` (local picture paths) with the prompt as the instruction, only on families with `edit: true`. Add
   LoRAs of the same family (`loras`), `aspect`, `megapixels`, `count` (1-4) and `seed`. Steps and CFG default
   to each family's own settings.
3. Poll `get_image` until `success`; its `files` are the pictures. Use one as a shot's first frame with
   `generate_previews` mode `frames` and a picture in `media`.

## Music (Audio)

IV Studio makes songs and instrumentals on this PC's ComfyUI, free. Two engines:
- `minimax`, MiniMax Music 3: full songs up to 5 minutes with the clearest sung words; a minute or two per
  song. Its length follows the lyrics (`seconds` is only a limit), so write full verses and choruses for
  a full song. Its licence allows commercial use; a product that uses it must show "MiniMax-Music3".
- `ace`, ACE-Step 1.5 Turbo (Apache-2.0): seconds per song, for drafts and background music. It also takes
  bpm, key, time signature and language.
1. `music_status`; if an engine lacks models, ask the person to download them on Audio > Music.
2. `make_music` with a style caption and lyrics (section tags such as [Verse] and [Chorus] on their own
   lines), or instrumental true. It returns a song; poll `get_music` until status is success.
3. Use its `file`: `add_media` files (append true puts it on A1 of an edit), or trim it with
   `prepare_media` and pass it as `voiceLine` to `generate_previews` so a character sings it.
4. The same settings and seed give the same song; a new seed gives a new take.
5. A reel: `make_reel` with pictures (or clips) in order and a song's `file` cuts them to its beat, a whole
   number of beats each (pace calm, normal or fast) with slow moves on the pictures, as a new edit. It finds
   the beat itself and keeps the cuts on the song's bars; check the BPM it returns, then `export_edit`.

## Shinobi: edits you cut as an agent

Shinobi is IV Studio's agent-driven editor. Where Edit is a hand-made timeline,
Shinobi lets you author a whole edit in code: cuts on the beat, speed ramps, punch-ins and camera moves,
typography, masks and effects, captions from speech, sound cues, even 3D scenes, rendered on this PC.

1. `shinobi_status`; if it isn't set up, ask the person, then `shinobi_setup` (about 440 MB, once).
2. `shinobi_tools` lists every tool. Call one with `shinobi` {tool, arguments}. Read the engine's guides
   first: `shinobi` read_guide with topic agent, timeline and effects. Don't guess timeline fields.
3. `create_project` (or use one from the Shinobi page: `shinobi_project` shows its media, saved edit,
   renders and the person's brief), then `import_media` with IV Studio render paths (`list_renders`) or files.
4. Look before cutting: `preview_source` and `source_contact_sheet` return pictures. For music,
   `analyze_audio` and `plan_music_edit`; `build_recipe` gives a starting point in one of 12 styles.
5. `save_timeline` with the revision from `get_project`, then `preview_timeline` (pictures) at the opening,
   cuts and titles. `start_render` with a new request id, then poll `get_render`.
6. Tell the person; the render shows on the Shinobi page, where it can go into Edit.

## Website sizzle: a web address in, a promo film out

When the person gives you a website and wants a sizzle, promo or launch video for it:

1. `sizzle_capture` {url}. It returns the sizzle id and pictures of the real site: the hero, a contact
   sheet of every screen down the page, the phone layout and the logo, plus its copy, colours and fonts.
   `view_sizzle_capture` shows any one capture larger (screen-3, mobile, image-2…).
2. Write the storyboard with `save_sizzle_plan`. About 20-40 s; scenes play in order:
   - `screen`: one of the site's captures with camera motion. These carry the real product: use them.
   - `h3`: an H3 shot (3-8 or 10 s, `character` "none" or a preset), written as an H3 prompt that fits
     the site's look and audience. People using the product, the world it promises, mood b-roll.
   - `image`: a Z-Image picture from a prompt (backgrounds, product-style stills, abstract brand art).
   - `title`: words on screen. Take them from the site's own headings, buttons and copy.
   - `music`: MiniMax Music 3 (`minimax`, best) or ACE-Step (`ace`, seconds), an instrumental unless the
     person wants lyrics. `voiceover` is optional: a voice id (`list_voices`) and lines.
   Open on a hook, show what the site does, end on the logo, the main button's words and the web address.
3. Show the person the storyboard (each scene, its length, the music) and wait for their OK. Then
   `approve_sizzle_plan`. Nothing renders before that.
4. `make_sizzle_assets` makes everything on this PC: about 3-5 minutes per H3 shot, seconds per picture,
   a few minutes for MiniMax music. Poll `get_sizzle` (it also moves each H3 shot from preview to its 1 MP
   finish) until status is `ready`. Look at the pieces before cutting.
5. `sizzle_first_cut` {sizzleId} has IV Studio cut the film itself: it imports every piece into a Shinobi
   project (with a brief, `iv-brief.md`), cuts on the music's beat, gives screens slow push-ins and
   whip/push transitions, sets two-tone titles in the site's colours (Barlow Condensed, sized to fit), ends
   on the logo, the main button's words and the web address, and ends where the music does. It returns a
   frame from every scene; `render: true` renders it too (about 2-3 min; `get_sizzle` shows the film).
6. Make it better where it needs it, in the same Shinobi project (see Shinobi above): pans and
   screen-to-screen scrolls, the site's own fonts, `render_page` titles, effects. Cutting again replaces
   the timeline, so call `sizzle_first_cut` only to start over. (`sizzle_to_shinobi` imports the pieces
   without cutting, for an agent that wants to cut from scratch.) Render, look at the frames and listen,
   then tell the person where the film is.

Only use claims the site itself makes: no invented numbers, prices, reviews, guarantees or scarcity. The
site's screens are real captures; keep them sharp and unstretched.

## Replace: swap people or change the scene

Remake (Viggle Remake on MiniMax H3) re-renders up to 14 s of video so it matches painted frames, keeping the
camera, cuts, motion and soundtrack.
1. Trim the source first if it's longer (`prepare_media`).
2. `remake_paint` kind swap (people: one or two, each with picture = their face, name, and who = whom they
   replace, in words; or picture/name/who for one) or kind change (ask = the change in plain words: weather,
   light, setting, style, something removed or added). It paints a frame of each shot and returns them.
3. LOOK at the painted pictures: they decide the result. Repaint one (`remake_paint` with session and only),
   or set your own (`remake_use_picture`).
4. `remake_render` (takes 1-3): the person's writer writes the six-section prompt, then it renders. Poll
   `get_job`; `replace_history` gives the result trimmed back to the source.
`replace_video` is the old engine (OpenJutsu masks): use it for faces and colours.
Only put invented characters, or people who agreed, into a video.

## Train a new character

The Characters page (and these tools) turn an invented person into a character preset:
1. `create_character_training` (name, who), then `design_faces` with a face description (age, face
   shape, eyes, skin, hair). Look at the four candidates and `pick_face`.
2. `design_scenes` renders that face in eight places and outfits (four candidates each); `pick_still` the
   most alike in each (or leave one out), or let `rank_likeness` with pick do it by face score. Captions never
   describe the face, so the face binds to the trigger word.
3. Optionally set a voice sample (`update_character_training` voice; a voice's reference file from
   `list_voices` works), then `make_training_clips`:
   H3 talking clips from the face and the stills. `rank_likeness` scores them; render weak ones again
   (`make_training_clips` redo) or drop them (`set_training_item` keep false). Aim for 0.45+.
4. Where it trains (`options.where`): `local` is free on this PC's own NVIDIA card (16 GB or more; Fizgig
   installed; a Standard run takes a few hours and nothing should render meanwhile; `scan_hardware` says
   whether this PC can), `modal` or `runpod` rent a GPU on the person's own account. The recipe is in
   `options` too (preset quick/standard/thorough, learn, detail, mode, checkpoints, and a `budget` cap for the
   cloud). `estimate_training`, tell the person the minutes (and the dollars, in the cloud), and
   `start_training` only after they agree (a cloud run bills their account and needs `confirm_cost`; Theo took
   56 minutes and about $4.10 on an H200 on Modal; Modal's Starter plan has no B200). Training an MCP agent
   starts on RunPod is refused: the RunPod key is sealed by the window, so start that one from the Characters page.
5. When `train.state` is `done`: `test_checkpoints` with 2-4 epochs (late ones often win), `score_checkpoints`
   for likeness, compare the renders, and `adopt_checkpoint` the best. It's then a character like any other.
   `start_training` with `more` carries a finished run on from its last saved state.
6. No time to train? `make_refmod_character` makes a RefMod character from up to six pictures in seconds.

## Incognito

The person can switch IV Studio into Incognito (title bar), a separate private set of everything made; the
app restarts to switch. This server works in whichever set was on when it started, and refuses tools after
a switch until it's restarted (reconnect the iv-studio MCP). Don't mention or move work between the two.

## House rules

- Renders take real GPU minutes, and the person may be using ComfyUI for other work too. Only
  cancel IV Studio jobs you started (`cancel_job`); never touch anything else in the queue.
- Ask the person before deleting anything (`delete_edit`, `delete_sequence`, `delete_character`) and
  before anything that costs money (the Context IR writer).
- Voices too: only invented voices, the person's own, or someone who agreed. Never clone a real person's
  voice from a found recording.
- Music: write original lyrics and describe a style, not a named artist's voice. Don't feed in someone
  else's song lyrics.
- Characters must be invented, or real people who agreed to it. Don't make a real person say or do
  things without their consent.
- The MCP server renders on the local ComfyUI, even when the app window is set to the cloud.
- Report what you made with its file path, so the person can open it.
