import { modChord } from '../../shared/platform.js'

// "How it works": a short guided tour of each page. Each step lights up a real part of the page (at: a CSS
// selector, or a list of them, the first one on screen wins) with a title and a line or two. A step whose part
// isn't on screen right now is skipped, so a tour fits whatever state the page is in. A step with no at shows
// in the middle of the window. Keep steps few and plain: they're read in passing.
//
// When a page changes, update its tour here in the same change (and FULL_TOUR if it visits that page), then run
// test/tours.mjs, which fails when a step points at a class or a step heading the code no longer has.

// A step's words with each {mod+Key} written as the platform's own shortcut: ⌘Enter on a Mac, Ctrl+Enter elsewhere.
// An unknown platform (null) reads as "not a Mac", like the other wording helpers.
export const tourText = (text, platform) => text.replace(/\{mod\+([^}]+)\}/g, (_, key) => modChord(platform, key))

export const TOURS = {
  // The full tour: offered at the end of the welcome wizard (and on Settings → About). It walks from page to page
  // (go: where the app goes first, as App.jsx's iv:go takes it) and ends on how to get each page's own tour.
  full: {
    title: 'The tour',
    steps: [
      { title: 'A quick look round', text: 'Two minutes, page by page. End it any time with Esc or the ×; you can take it again from Settings, About.' },
      { go: { page: 'home', section: 'video' }, at: '.quick-cards', title: 'The Dashboard', text: 'Where IV Studio opens. Start anything from these cards; your latest work and your cast sit below.' },
      { go: { page: 'create', section: 'video', create: 'video' }, at: 'step:What happens', title: 'Create', text: 'Say what happens in plain words and IV Studio writes the H3 prompt. Pick who is in it and the shape above and below.' },
      { go: { page: 'create', section: 'video', create: 'video' }, at: ['.shot-card', '.create-dock'], title: 'Hunt, pick, finish', text: 'Hunt renders a few quick previews. You pick the best one on its shot page and finish it at full size.' },
      { go: { page: 'library', section: 'video' }, at: '.shelf-grid', title: 'Shots', text: 'Every shot you have made, with its takes and finals.' },
      { go: { page: 'projects', section: 'video' }, at: '.shelf-bar', title: 'Projects', text: 'A short film from an idea, step by step: story, cast, storyboard, filming and the cut.' },
      { go: { page: 'edits', section: 'video' }, at: '.shelf-bar', title: 'Edit', text: 'A timeline editor for your shots, songs and titles, that can also make new footage right inside the edit.' },
      { go: { page: 'workflows', section: 'video' }, at: '.workflow-cards', title: 'Workflows', text: 'Tools for after a render: swapping people, one-take sequences, reels cut to a song, and agent-made edits.' },
      { go: { page: 'characters', section: 'video' }, at: ['.cast-section', '.train-paths'], title: 'Characters', text: 'Your recurring actors, the same in every shot. Add one you have, or train your own.' },
      { go: { page: 'audio', section: 'audio' }, at: '.section-switch', title: 'The sound side', text: 'Visual and Audio switch the sidebar. Audio has Voices, Lines, Music and Sounds.' },
      { go: { page: 'media', section: 'video' }, at: '.nav-library', title: 'Library', text: 'Everything you made, in one place: videos, pictures, songs and voice lines.' },
      { go: { page: 'cloud', section: 'video' }, at: '.cloud-guided', title: 'Cloud', text: 'No strong graphics card? Render on your own cloud GPU account instead.' },
      { go: { page: 'home', section: 'video' }, at: '.chat-open', title: 'Chat with your agent', text: 'Your own Claude Code, Codex or Hermes, inside IV Studio. Type or talk; it knows what you’re looking at. History keeps earlier conversations, Activity shows what agents did (with Undo), and it can pop out into its own window.' },
      { go: { page: 'settings', section: 'video' }, at: '.settings-tabs', title: 'Settings and Setup', text: 'How IV Studio works for you, and what ComfyUI has and needs.' },
      { go: { page: 'home', section: 'video' }, at: '.hero-help', title: 'Help on every page', text: 'Every page has this How it works button. Click it any time for a walk through that page, the same way as this tour.' }
    ]
  },
  home: {
    title: 'The Dashboard',
    steps: [
      { title: 'Welcome to IV Studio', text: 'Everything here runs on your own ComfyUI with MiniMax H3: shots with sound, pictures, voices, music and films. This tour takes a minute.' },
      { at: '.quick-cards', title: 'Start something', text: 'Each card opens the right page ready to go: a new shot, a picture, a short film, an edit, a song, a voice line and more.' },
      { at: '.dash-recent', title: 'Your latest work', text: 'The newest things you made. Click one to watch it and step through its versions.' },
      { at: '.cast-cards', title: 'Your cast', text: 'Your characters, with their faces and voices. New shot starts a shot with them already picked.' },
      { at: '.nav', title: 'Every page', text: 'The sidebar has every page. Visual and Audio at the bottom switch between the picture side and the sound side.' },
      { at: '.chat-open', title: 'Chat with your agent', text: 'Your own Claude Code, Codex or Hermes, inside IV Studio. Type or talk; it knows what you’re looking at. History keeps earlier conversations, Activity shows what agents did (with Undo), and it can pop out into its own window.' },
      { at: '.engine-badge', title: 'ComfyUI and your GPU', text: 'Whether ComfyUI is ready, and how much of your graphics card and memory is in use. Free memory unloads models when you need room.' },
      { at: '.hero-help', title: 'Help on every page', text: 'This button is on every page. Click it any time to walk through what that page does.' }
    ]
  },
  create: {
    title: 'Create a shot',
    steps: [
      { at: '.create-kind', title: 'Video or picture', text: 'Make a shot with sound (Video) or a still picture (Image).' },
      { at: '.engine-switch', title: 'The model', text: 'MiniMax H3 renders on this computer, free. Seedance 2.5 uses your Comfy.org credits: same modes and hunt, and you see the price and confirm first. Hunt in cheap 480p drafts, then finish your pick at 1080p.' },
      { at: 'step:What kind of shot', title: 'What kind of shot', text: 'Text starts from words alone. References, Frames and Continue start from your pictures or a video.' },
      { at: "step:Who's in it", title: 'Who is in it', text: 'Pick a character so they look and sound the same in every shot. Click more than one to put them in the shot together: the first leads, the others come along as their face pictures. LoRAs and RefMods add a look, a style or a move.' },
      { at: '.create-step:has(.create-drop)', title: 'What it builds on', text: 'Drop pictures or a video here. Add them before writing the prompt, so the writer can see them. A video in References mode can get Soft mouth, so the new face doesn’t mouth the words spoken in it.' },
      { at: '.starters-open', title: 'Start from an example', text: 'Not sure where to begin? This opens ready-made shots. Pick one and it fills in the prompt, length and shape; then press Hunt or change any word.' },
      { at: 'step:What happens', title: 'What happens', text: 'Say your idea in plain words and press Write my prompt. Type @ to bring in a character or a saved place. The checker below flags problems and its Fix button mends most of them. Stage it on a board opens a floor plan for placing people and the camera.' },
      { at: '.create-craft', title: 'Cinematography and prompt tools', text: 'The Cinematography button shows a picture of each film stock, lens, light, camera move and mood; pick any to add it. Then a director’s note, Tighten, Enrich or 3 variants reshape the prompt; earlier versions are kept.' },
      { at: 'step:Shape and size', title: 'Shape and size', text: 'The frame shape, the length, how many previews and their quality. Draft is about twice as fast for trying ideas. With Seedance: 4 to 30 seconds, Draft 480p or 720p/1080p, and the price.' },
      { at: '.speed-row', title: 'Speed', text: 'Presets that trade picture size and steps for time and memory. Fast and Low memory suit smaller graphics cards. Changing the size, steps or takes by hand shows Custom.' },
      { at: ['.shot-card', '.create-dock'], title: 'Your shot', text: 'A summary of what you set up. Hunt renders the previews; you then pick the best one and finish it at full size.' }
    ]
  },
  image: {
    title: 'Create a picture',
    steps: [
      { at: '.create-kind', title: 'Video or picture', text: 'Image makes still pictures. Switch back to Video for shots with sound.' },
      { at: 'step:What to make', title: 'Make, edit or fix', text: 'Generate makes new pictures from words. Edit changes a picture you give it. Tools are one-step fixes: inpaint, relight, remove the background, upscale, depth map.' },
      { at: 'step:The tool', title: 'The tool', text: 'Pick a fix. One that still needs its model says so and downloads it here.' },
      { at: 'step:The picture', title: 'The picture', text: 'Drop in a picture, or open one of yours below and press Fix this. For Inpaint, paint over the part to change.' },
      { at: 'step:The model', title: 'The model', text: 'Each family has its own look and speed. Makes means it creates pictures; edits means it can also change one. One that says not set up opens what it needs, with a button that downloads it.' },
      { at: 'step:The picture to edit', title: 'The picture to edit', text: 'Drop in the picture to change.' },
      { at: ['step:What it shows', 'step:What to change'], title: 'Describe it', text: 'Write what you want to see, or for Edit, what to change. LoRAs for the chosen model add a look or a style.' },
      { at: 'step:Shape and size', title: 'Shape and size', text: 'The picture shape, its size and how many to make at once.' },
      { at: '.shot-card', title: 'Make it', text: 'A summary and the button that makes the pictures.' },
      { at: '.image-gallery', title: 'Your pictures', text: 'Everything you made, fixes included. Open one to use it as a shot’s first frame, edit it, fix it, or make more like it.' }
    ]
  },
  projects: {
    title: 'Projects',
    steps: [
      { title: 'A short film, step by step', text: 'Projects turns an idea or a script into a finished short film: story, cast, storyboard, filming and the final cut.' },
      { at: '.stage-quick', title: 'Find a film, or start one', text: 'Search your films here, and + New film starts one.' },
      { at: '.shelf-bar', title: 'Where each film is', text: 'Writing, Planning, Filming and Watching, each with a count, and the sort order.' },
      { at: '.shelf-filters', title: 'Narrow it down', text: 'When you worked on it and its shape. Fold the panel away with Filters; Clear puts everything back.' },
      { at: '.shelf-group', title: 'By day', text: 'Films sit under the day you last worked on them. Click a day to fold it away; click a film to carry on where you left off.' }
    ]
  },

  project: {
    title: 'Making a film',
    steps: [
      { at: '.wiz-steps', title: 'Six steps', text: 'Idea, Story, Cast and places, Storyboard, Film it, Watch. You can go back to any step at any time.' },
      { at: '.wiz-page', title: 'This step', text: 'Answer what this step asks. Write it for me drafts the script or the shots if you want a head start.' },
      { at: '.wiz-craft', title: 'Cinematography and Lookbook', text: 'Choose a film stock, lenses, light and camera for the whole film, or name a film or cinematographer: the Lookbook turns it into look language with no names in it. Both go into every shot.' },
      { at: '.wiz-scene-tools', title: 'Coverage and continuity', text: 'Cover a scene the way a director would: dialogue coverage, an entrance, parallel action and more. Check continuity reads every shot like a script supervisor: wardrobe, props, light and screen sides.' },
      { at: '.wiz-panels', title: 'The storyboard', text: 'Every shot is a panel with a sketch. Click one to change what happens, the camera or the line, or to rework its prompt with a director’s note.' },
      { at: '.wiz-shotlist', title: 'Shot list', text: 'Save the shot list as a document, or as CSV for a spreadsheet, for a crew or a schedule.' },
      { at: '.wiz-foot', title: 'Next', text: 'When this step looks right, move on. Play the animatic before filming: it costs seconds, not GPU minutes.' }
    ]
  },
  shots: {
    title: 'Shots',
    steps: [
      { at: '.stage-quick', title: 'Find a shot', text: 'Search by name or by the words of a prompt, or start a New shot.' },
      { at: '.shelf-bar', title: 'Which shots', text: 'All, Finished, or still to pick, each with a count, and the sort order.' },
      { at: '.shelf-filters', title: 'Narrow it down', text: 'When it was made, the kind of shot, who is in it and its shape. Counts show what each choice leaves. Fold the panel away with Filters; it remembers, and Clear puts everything back.' },
      { at: '.shelf-group-head', title: 'One day at a time', text: 'Shots sit under the day you last worked on them; older ones by month. The day stays at the top as you scroll, and a click folds it away.' },
      { at: '.shelf-tile', title: 'Open one', text: 'Hover to play its latest take. Inside, you watch the takes, pick the best and finish it at full size.' }
    ]
  },

  shot: {
    title: 'A shot',
    steps: [
      { at: '.shot-actions', title: 'Try again', text: 'Edit the latest run’s settings and render again into this same shot.' },
      { at: '.run-head', title: 'A run', text: 'Each run shows how it was made: mode, size, length, seed, character and render time. Older runs have their own Edit and run again.' },
      { at: '.candidates', title: 'The takes', text: 'Watch each take. A score marks the strongest, and says when a take cuts away mid-shot or, in First / last frame mode, misses your pictures. Review suggests one fix. Mark up to four takes, then Compare them.' },
      { at: '.take-clean', title: 'Cut around a cut', text: 'A take that cuts away can still be used: keep the part before or after the cut in an edit, or carry on from it in a Continue shot. Slow dissolves aren’t caught, only hard cuts.' },
      { at: '.take-pick', title: 'Pick one', text: 'Pick the take you like: the Finish settings open over the page. Picking also teaches the scoring your taste.' },
      { at: '.finish-panel', title: 'Finish it', text: 'Render the picked take at full size. An H3 take starts from the shot’s speed preset (1 MP plus 2x is much quicker than 2 MP). A Seedance take finishes at 1080p, or free here with SeedVR2, DLSS 5 or H3, each with a strength slider.' },
      { at: '.versions-card', title: 'Finished versions', text: 'Every final and enhanced copy as a chip, one player for the one you choose. Enhance adds a sharper copy at the strength you set; Compare plays them in sync, in a grid or a wipe, zoomed in on the same spot.' },
      { at: '.version-carry', title: 'Keep it going', text: 'Continue from this opens a new Continue shot with this version as its source, keeping the character, LoRAs and shape. Say what happens next, hunt takes, and the finish is the whole continued video at full size.' },
      { at: '.version-lastframe', title: 'Its last frame', text: 'Use the last frame saves the version’s final frame as a picture in the Library. Start a new shot from it as its first frame, or change it in Create → Image first.' }
    ]
  },
  edits: {
    title: 'Edit',
    steps: [
      { at: '.stage-quick', title: 'Your edits', text: 'Search them, or start a new edit.' },
      { at: '.shelf-grid', title: 'Open an edit', text: 'Each edit is a timeline of your shots, pictures, songs and titles. Click one to open the editor.' }
    ]
  },
  editor: {
    title: 'The editor',
    steps: [
      { at: '.ed-bin', title: 'Your media', text: 'Everything in this edit, plus the whole Library. Add files or a title here.' },
      { at: '.ed-monitor', title: 'Source', text: 'Click something in the bin to see it here. Mark I and O, then press comma to insert or full stop to overwrite at the playhead.' },
      { at: '.ed-effects', title: 'Effect controls', text: 'The selected clip’s settings. With nothing selected, the edit’s own: format, frame rate and loudness.' },
      { at: '.ed-toolbar', title: 'Tools', text: 'Select (V), Razor (C), Ripple (B) and Roll (N), with snapping and zoom. The razor turns your pointer into a red katana: a dashed line shows where it will cut, and a click slices the clip in two.' },
      { at: '.ed-tl-wrap', title: 'The timeline', text: 'Drag clips to move and trim them. Right-click a clip to Extend, Retake, Cut out or Reframe it with new footage; right-click a gap to fill it.' },
      { at: '.ed-export', title: 'Export', text: 'Full screen gives you more room (F11, Esc to come back). Export makes the finished video.' },
      { at: '.ed-handoff', title: 'Finish in another editor', text: 'Premiere / Resolve writes the timeline for Premiere Pro, DaVinci Resolve and Final Cut (XML, FCPXML and an EDL), copies every clip beside it and zips it to send. Tracks, trims, volume and markers come over; fades and title styling don’t.' }
    ]
  },
  workflows: {
    title: 'Workflows',
    steps: [
      { title: 'Take a video further', text: 'Tools for what comes after a render. Each one works with your IV Studio renders and files.' },
      { at: '.workflow-cards', title: 'The tools', text: 'Replace swaps who is in a shot or changes the scene. Sequences, Sizzle, Effects, Reel, Shinobi and Rebuild follow: one-take scenes, films from websites, photo effects, reels and agent edits.' }
    ]
  },
  sequences: {
    title: 'Sequences',
    steps: [
      { title: 'Several shots, one take', text: 'A sequence is a run of shots that play as one continuous video, with the same people and place throughout.' },
      { at: '.stage-panel', title: 'Start one', text: 'Name it and press New sequence. You write its shots next.' },
      { at: '.tool-shelf', title: 'Your sequences', text: 'Each tile says how far it got. Open one to carry on.' }
    ]
  },
  sequence: {
    title: 'A sequence',
    steps: [
      { at: 'step:How it renders', title: 'How it renders', text: 'One take renders every shot together, seamless but all or nothing. Shot by shot lets you pick each shot in turn.' },
      { at: 'step:The shots', title: 'The shots', text: 'Write each shot, or let the writer draft them all from a story. Describe the place the same way in every shot so they join cleanly.' },
      { at: 'step:Look and size', title: 'Look and size', text: 'Who plays it, any LoRAs for every shot, the frame shape, the size and each shot’s length.' },
      { at: 'step:Render', title: 'Render', text: 'Shows the length and a rough time before you start.' },
      { at: 'step:Versions', title: 'Versions', text: 'Every take lands here. Retake redoes a stretch; Render out makes the final with clean-up and upscaling.' }
    ]
  },
  replace: {
    title: 'Replace',
    steps: [
      { at: '.replace-modes', title: 'What to change', text: 'Swap people puts your character in someone’s place. Change the scene changes things, weather, light or style. Finish fixes small faces or softens the look.' },
      { at: 'step:The video', title: 'The video', text: 'Drop in the video to change. It keeps its camera, motion and sound. Click it to trim.' },
      { at: ['step:Who goes in', 'step:What changes'], title: 'Who or what', text: 'Pick the character (or a picture) who goes in, or say in plain words what should change. Soft mouth keeps the new person from mouthing the source’s words.' },
      { at: 'step:The painted frames', title: 'Check the painted frames', text: 'IV Studio paints a frame per shot the way it should look. They decide how it turns out: paint one again, use your own, or leave one out.' },
      { at: 'step:Runs', title: 'Runs', text: 'Every result lands here, ready to send to Edit.' }
    ]
  },
  reel: {
    title: 'Reel',
    steps: [
      { at: '.stage-panel', title: 'Drop it all here', text: 'Drop pictures and a song on the bar, or add them with the buttons.' },
      { at: 'step:The pictures', title: 'The pictures', text: 'They play in this order. Hover one to move it or take it out.' },
      { at: 'step:The song', title: 'The song', text: 'Pick one of your songs or a sound file. Reel finds its beat by itself.' },
      { at: 'step:Pace and shape', title: 'Pace and shape', text: 'Calm, Normal and Fast hold each picture for about 3, 2 or 1 seconds, on the beat.' },
      { at: ['.shot-card', '.create-dock'], title: 'Make it', text: 'It lands in Edit as an ordinary edit, ready to trim and export.' }
    ]
  },
  shinobi: {
    title: 'Shinobi',
    steps: [
      { title: 'Edits your agent cuts', text: 'Hand footage, pictures and a song to Shinobi, and your agent (Claude Code or Codex, set up in Settings) cuts a styled edit with you.' },
      { at: '.stage-panel', title: 'Start a film', text: 'Name it and start. The first time, this bar sets Shinobi up instead (once, about 440 MB).' },
      { at: '.tool-shelf', title: 'Your films', text: 'Open one to add media, build a first cut and hand it to your agent.' }
    ]
  },
  'shinobi-film': {
    title: 'A Shinobi film',
    steps: [
      { at: 'step:Brief and media', title: 'Brief and media', text: 'Say what the film is, then add files or IV Studio renders. A clip’s sound can be the soundtrack.' },
      { at: 'step:A first cut', title: 'A first cut', text: 'Pick a style and Shinobi lays out a starting edit, no agent needed.' },
      { at: 'step:Hand it to your agent', title: 'Hand it to your agent', text: 'Copy this message into your agent. It says which film, what is in it and what you want.' },
      { at: 'step:Render and review', title: 'Render and review', text: 'Render the saved edit, then send it to Edit or show it in its folder.' },
      { at: ['.shot-card', '.create-dock'], title: 'Your film', text: 'Where the film is at, and the render button.' }
    ]
  },
  sizzle: {
    title: 'Sizzle',
    steps: [
      { title: 'A website, made into a film', text: 'Give it a web address. It captures the site’s screens, colours and logo, and builds a short promo film from them.' },
      { at: '.stage-panel', title: 'Start here', text: 'Paste the address, pick the shape and capture the site. An agent then writes the storyboard for you to approve.' },
      { at: '.tool-shelf', title: 'Your sizzles', text: 'Each tile shows how far it got. Open one to carry on.' }
    ]
  },
  rebuild: {
    title: 'Rebuild',
    steps: [
      { title: 'A video, taken apart and rebuilt', text: 'Bring a video you made, up to 2 minutes. IV Studio reads it shot by shot and makes it again: the same cuts, pacing and captions, the AI shots rendered fresh with H3, and anything you ask changed.' },
      { at: '.stage-panel', title: 'Start here', text: 'Choose the video, say what should change if anything, tick that it’s yours to rework, and read it. It takes seconds.' },
      { at: '.stage-needs', title: 'What it needs', text: 'Claude Code or Codex, connected to IV Studio in Settings → Agents. Your agent says what each shot is and writes the plan.' },
      { at: '.tool-shelf', title: 'Your rebuilds', text: 'Each tile shows how far it got. Open one to carry on.' }
    ]
  },
  'rebuild-project': {
    title: 'A rebuild',
    steps: [
      { at: '.flow-progress', title: 'Where it’s at', text: 'Read, plan, frames, shots, cut.' },
      { at: 'step:The shots', title: 'The shots', text: 'Every shot at its own length, with what it is and how it will be made.' },
      { at: 'step:The plan', title: 'The plan', text: 'Your agent writes it. Nothing renders until you approve it here.' },
      { at: 'step:Your agent', title: 'Your agent', text: 'Copy this into Claude Code or Codex. It changes as the rebuild moves on.' }
    ]
  },
  'sizzle-project': {
    title: 'A sizzle',
    steps: [
      { at: '.flow-progress', title: 'Where it’s at', text: 'Captured, storyboard, approved, pieces made, cut, refined.' },
      { at: 'step:The site, as captured', title: 'The capture', text: 'The site’s screens, colours, fonts, logo and pictures: what the film is built from.' },
      { at: 'step:Storyboard', title: 'Storyboard', text: 'Your agent writes it. Approve it, make the pieces, then Cut it for me.' },
      { at: ['step:Your agent', 'step:The film'], title: 'Your agent and the film', text: 'The message for your agent, and the film once it is cut.' }
    ]
  },
  characters: {
    title: 'Characters',
    steps: [
      { at: '.cast-section:not(.train-own)', title: 'Your characters', text: 'The people H3 plays, the same in every shot. Click a card for its settings: trigger word, strength and voice, and a turnaround sheet with five views of them turning around.' },
      { at: '.portrait-add', title: 'Add one', text: 'Already have a LoRA or a RefMod of someone? Add it here.' },
      { at: '.train-paths', title: 'Make your own', text: 'Train a LoRA for the best likeness: free on your own graphics card when it can (the green badge says so), or on a cloud GPU in about half an hour, with the cost shown first. Or make a RefMod from a few pictures in under a minute.' },
      { title: 'Give them a voice', text: 'Make a voice on Audio, Voices and give it to a character. Their shots then speak in it.' }
    ]
  },
  character: {
    title: 'Training a character',
    steps: [
      { at: '.wizard-steps', title: 'Four steps', text: 'Design their look, make talking clips, train, then pick the best checkpoint.' },
      { at: '.create-step, .block', title: 'This step', text: 'Do what this step asks, then move on. You can come back to any step later.' }
    ]
  },
  loras: {
    title: 'LoRAs',
    steps: [
      { at: '.lora-families', title: 'Pick a model', text: 'LoRAs only work with the model they were trained for. Pick one: MiniMax H3 for shots, or a picture model (Flux, Krea, Qwen, Z-Image, SDXL, Moss) for Create → Image. The number is how many you already have.' },
      { at: '.lora-tabs', title: 'Discover, yours, recommended', text: 'Discover finds that model’s LoRAs on Civitai. Yours shows the ones already in ComfyUI; open All to tell IV Studio which model an unknown LoRA is for. For MiniMax H3, Recommended holds a few we’ve tried, with how to use each.' },
      { at: '.lora-bar', title: 'Search', text: 'Search by name and sort by downloads, rating or newest.' },
      { at: '.lora-tags', title: 'Kinds', text: 'Narrow it down to styles, concepts, camera moves and more.' },
      { at: '.lora-card', title: 'A LoRA', text: 'Hover to play its clip. Click for its details, licence and trigger words, and download it or use it in a shot or a picture. Downloads need your Civitai key in Settings.' }
    ]
  },
  cloud: {
    title: 'Cloud',
    steps: [
      { title: 'Render on a cloud GPU', text: 'No strong graphics card, or want more? IV Studio can render on your own RunPod, Modal or Comfy Cloud account, billed by the second. On RunPod and Modal nearly everything works: shots, pictures, music, sounds, Replace, Effects and more.' },
      { at: '.cloud-guided', title: 'Guided setup', text: 'The easiest way in: pick a service, connect it, choose a GPU and set it up. Setup shows each step with a timer and how long is left; you can leave the page, and IV Studio tells you when it’s ready.' },
      { at: '.cloud-control', title: 'Where it renders', text: 'Switch between this computer and the cloud whenever you like.' },
      { at: '.cloud-models', title: 'Models on first use', text: 'Setup brings H3. Everything else brings its own models the first time you use it in the cloud: IV Studio says how big they are and asks before downloading. A Hugging Face token here unlocks the few behind a licence (Flux and the LTX effects).' },
      { at: '.engine-badge', title: 'The meter', text: 'While on the cloud, the title bar shows GPU time and cost. Shut down GPU stops it at once; it also stops by itself when idle.' }
    ]
  },
  settings: {
    title: 'Settings',
    steps: [
      { at: '.settings-tabs', title: 'Settings and Setup', text: 'Settings is how IV Studio works for you. Setup checks what ComfyUI has and downloads what it needs.' },
      { at: '.set-nav', title: 'Jump around', text: 'Every topic in one list. Click one to jump to it.' },
      { at: '#set-pc', title: 'Your computer', text: 'What your computer can do. Check again re-runs the scan and its recommended defaults.' },
      { at: '.speed-cards', title: 'Speed', text: 'How each new shot starts: Quality, Balanced, Fast or Low memory. The one that suits this computer is marked. Times are from an RTX 4090; smaller cards take longer.' },
      { at: '#set-you', title: 'You and your agent', text: 'Your name, your agent’s name, and whether it runs on Claude Code, Codex or Hermes. The chat and the Dashboard use the names.' },
      { at: '#set-access', title: 'Colour and accessibility', text: 'Pick the app’s colour (red, blue, purple, orange, or Dark for greys only), then bigger text, higher contrast, less motion, clear focus outlines and underlined links. Each applies at once.' },
      { at: '#set-words', title: 'Words', text: 'Simple words: the app talks in everyday words instead of AI terms, for people new to this. Only the words change.' },
      { at: '#set-comfy', title: 'ComfyUI', text: 'Where ComfyUI is (typing localhost:8000 is fine), and whether IV Studio starts it for you when it opens.' },
      { at: '#set-folders', title: 'Folders', text: 'Where finished videos go, on any drive, and where renders save inside ComfyUI.' },
      { at: '#set-writer', title: 'Prompt writer', text: 'Who writes your prompts: a free local model in Ollama, your own Claude Code, Codex or Hermes, any OpenAI-compatible server (llama.cpp, vLLM, LM Studio, OpenAI…), or MiniMax’s paid rewriter.' },
      { at: '#set-account', title: 'Comfy account', text: 'Your Comfy.org key and credits, for ComfyUI’s paid partner models such as Seedance, Kling and Veo. The balance also shows in the title bar, and IV Studio shows the price and asks before anything paid runs.' },
      { at: '#set-agents', title: 'Agents', text: 'Connect Claude Code, Codex or any MCP agent, so it can make shots and edits in IV Studio with you.' },
      { at: '.about-terms', title: 'Terms of use', text: 'IV Studio is Powered by MiniMax H3. Read the rules for H3 here and agree once, before your first H3 render. They apply to everything you make with it.' },
      { at: '.about-report', title: 'Report misuse', text: 'Seen something made with IV Studio that breaks the rules, or uses someone without consent? Report misuse emails us, and every report is acted on.' },
      { at: '.about-credits', title: 'Credits', text: 'Everything IV Studio is built on: the models, tools, node packs and libraries, who made each and its licence.' }
    ]
  },
  setup: {
    title: 'Setup',
    steps: [
      { at: '.setup-summary', title: 'Is this computer ready?', text: 'The answer first: whether shots can render, and the one or two buttons that fix it. Restart ComfyUI is here too, for after you install node packs or models.' },
      { at: '.setup-toolbar', title: 'Needs you, or everything', text: 'This bar stays at the top while you scroll. Needs you shows only what to fix. Everything lists every model, node pack and character, ready or not.' },
      { at: '.setup-section', title: 'One card per part', text: 'ComfyUI, the models shots need, node packs, optional tools and characters. A card opens by itself when something in it needs you; click a card’s title to open or fold it.' },
      { at: '[data-setup="extras"] .setup-section-head', title: 'Optional tools', text: 'Models for the extra tools, grouped by tool. Each group says what it does and where it is; What’s in it lists the files. Download only what you’ll use; each file is checked against its published hash. A few need a free Hugging Face login, saved here.' },
      { at: '.get-comfy', title: 'No ComfyUI yet?', text: 'Get ComfyUI for me downloads ComfyUI’s official portable build for your graphics card into a folder you choose, checks it, unpacks it and starts it. Already have one? Choose its folder instead.' },
      { at: '.comfy-updates', title: 'Updates', text: 'Keeps ComfyUI and its node packs up to date, with a snapshot first so you can undo.' }
    ]
  },
  audio: {
    title: 'Audio',
    steps: [
      { title: 'Everything you hear', text: 'Voices for your characters, the lines they say, songs and sound effects. Everything you make is kept for a shot or an edit.' },
      { at: '.workflow-cards', title: 'The tools', text: 'Voices to make a voice, Lines to say something in it, Music for songs and scores, Sounds for effects and ambiences. Each card says what it needs.' }
    ]
  },
  voices: {
    title: 'Voices',
    steps: [
      { at: '.stage-quick', title: 'Quick start', text: 'Describe a voice here and make three takes, or use the full form below for more.' },
      { at: '.engine-strip', title: 'The voice engine', text: 'Voices run on this computer, or on your cloud GPU while you render in the cloud. The first time, set them up once (about 12 GB, on this computer or in your cloud storage).' },
      { at: '.voice-grid', title: 'Your voices', text: 'Play each one, rename it, and give it to a character. That character’s shots then speak in it.' },
      { at: '.audio-card', title: 'A new voice', text: 'Describe a voice that doesn’t exist yet, or save one from a recording. Never a real person’s voice without their consent.' }
    ]
  },
  lines: {
    title: 'Lines',
    steps: [
      { at: '.stage-quick', title: 'Quick start', text: 'Pick a voice, type the line and press Speak. The form below has the same words, plus the seed.' },
      { at: '.composer', title: 'Say a line', text: 'Pick a voice, type the words and press Speak (or {mod+Enter}).' },
      { at: '.track-list', title: 'Spoken lines', text: 'Play them back. Use in a shot sends a line to Create, where the character lip-syncs it.' }
    ]
  },
  music: {
    title: 'Music',
    steps: [
      { at: '.stage-quick', title: 'Quick start', text: 'Describe the music and make it, or Remix a song you already have. Lyrics and length are in the form below.' },
      { at: '.engine-cards', title: 'The engine', text: 'MiniMax Music sings words clearly. ACE-Step is quick for background music.' },
      { at: '.composer label.field', title: 'Style', text: 'Genre, mood, instruments, the voice and how it feels.' },
      { at: '.composer div.field', title: 'Lyrics', text: 'Mark the parts like [Verse] and [Chorus], or switch on Instrumental. A MiniMax song’s length follows its lyrics.' },
      { at: '.composer-foot', title: 'Make it', text: 'Songs land below. Add one to an edit or use it in a shot.' }
    ]
  },
  effects: {
    title: 'Effects',
    steps: [
      { at: '.stage-drop', title: 'Start with a photo', text: 'Drop a photo on the banner, or pick one. One clear subject, well lit, works best.' },
      { at: 'step:What happens', title: 'What happens', text: 'An effect from the gallery, a transformation that keeps the face, or a transition from one picture into another.' },
      { at: '.effect-gallery', title: 'The effect', text: 'Pick one. Each is its own trained look, from Cakeify to a 360° orbit.' },
      { at: 'step:Fine-tune', title: 'Fine-tune', text: 'Who is in the photo, extra direction, strength, shape and length. The defaults are a good first try.' },
      { at: '.shot-card', title: 'Make it', text: 'It renders on this computer in a few minutes and lands below, and in the Library.' }
    ]
  },
  sounds: {
    title: 'Sounds',
    steps: [
      { at: '.stage-quick', title: 'Quick start', text: 'Describe a sound and make it. Its kind, length and number of takes are in the form below.' },
      { at: '.sound-kinds', title: 'What kind', text: 'A sound effect, an ambience, a one-shot for music, or a short loop. Each sets a likely length.' },
      { at: '.composer label.field', title: 'The sound', text: 'What makes it, what it is made of, where it happens. Or a few words and Write it for me: your prompt writer fills in the rest.' },
      { at: '.composer .field-grid', title: 'Length and takes', text: 'Up to four takes at once, so you can pick the best.' },
      { at: '.composer-foot', title: 'Make it', text: 'Sounds land below. Add to edit puts a take on A2, under the music.' }
    ]
  },
  library: {
    title: 'Library',
    steps: [
      { at: '.stage-quick', title: 'Search everything', text: 'Videos, pictures, songs and voice lines in one place. Search them all, even the words of a prompt, or what’s in them: while nothing renders, your prompt writer looks at each video and picture so “red car” finds one.' },
      { at: '.shelf-bar', title: 'Everything you made', text: 'Each kind with a count, and the sort order, longest first too.' },
      { at: '.shelf-filters', title: 'Narrow it down', text: 'When it was made, where it came from, and for shots their kind, who is in them, their shape and the model. Fold the panel away with Filters; it remembers.' },
      { at: '.shelf-group-head', title: 'One day at a time', text: 'Everything sits under the day it was made, older work by month. Click a day to fold it away.' },
      { at: '.lib-tile', title: 'One tile per thing', text: 'A shot’s previews and finals sit in one tile, with its size, length and model. Open it to step through every version with the arrow keys and see how each was made: settings, seed, finish, render time, cost and the prompt.' }
    ]
  }
}

// The page each page tour lives on (as App.jsx's iv:go takes it), for "Show me where" from the chat: an agent names a
// tour and one of its steps (show_in_app), and IV Studio goes there and lights that one part up. Pages about one item
// (a shot, a film, an edit) need its id, so they aren't places to show.
export const TOUR_PAGES = {
  home: { page: 'home', section: 'video' },
  create: { page: 'create', section: 'video', create: 'video' },
  image: { page: 'create', section: 'video', create: 'image' },
  projects: { page: 'projects', section: 'video' },
  shots: { page: 'library', section: 'video' },
  edits: { page: 'edits', section: 'video' },
  workflows: { page: 'workflows', section: 'video' },
  sequences: { page: 'sequences', section: 'video' },
  replace: { page: 'replace', section: 'video' },
  reel: { page: 'reel', section: 'video' },
  shinobi: { page: 'shinobi', section: 'video' },
  sizzle: { page: 'sizzle', section: 'video' },
  rebuild: { page: 'rebuild', section: 'video' },
  effects: { page: 'effects', section: 'video' },
  characters: { page: 'characters', section: 'video' },
  loras: { page: 'loras', section: 'video' },
  cloud: { page: 'cloud', section: 'video' },
  settings: { page: 'settings', section: 'video' },
  setup: { page: 'setup', section: 'video' },
  library: { page: 'media', section: 'video' },
  audio: { page: 'audio', section: 'audio' },
  voices: { page: 'voices', section: 'audio' },
  lines: { page: 'lines', section: 'audio' },
  music: { page: 'music', section: 'audio' },
  sounds: { page: 'sounds', section: 'audio' }
}
// Every place an agent can show: { where (a tour), page (its title), spot (a step's title), about (its words) }.
export const placesToShow = () =>
  Object.keys(TOUR_PAGES).flatMap((where) => (TOURS[where]?.steps || []).filter((s) => s.at).map((s) => ({ where, page: TOURS[where].title, spot: s.title, about: s.text })))
// The one-step tour that shows a place: go to its page, light up its part, say what to do there.
export function spotTour({ where, spot, say }) {
  const step = TOURS[where]?.steps.find((s) => s.title === spot && s.at)
  if (!TOUR_PAGES[where] || !step) return null
  return { id: `spot:${where}`, title: TOURS[where].title, steps: [{ go: TOUR_PAGES[where], at: step.at, title: step.title, text: say || step.text }] }
}

// the page each banner art belongs to, when the page doesn't name its own tour
export const TOUR_FOR_ART = { create: 'create', shots: 'shots', projects: 'projects', edit: 'edits', characters: 'characters', audio: 'audio', voices: 'voices', lines: 'lines', music: 'music', sounds: 'sounds', effects: 'effects', workflows: 'workflows', sequences: 'sequences', shinobi: 'shinobi', replace: 'replace', sizzle: 'sizzle', rebuild: 'rebuild', loras: 'loras', library: 'library', settings: 'settings', cloud: 'cloud' }

const SEEN = 'iv.toursSeen'
export function toursSeen() {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN) || '[]'))
  } catch {
    return new Set()
  }
}
export function markTourSeen(id) {
  const s = toursSeen()
  if (s.has(id)) return
  s.add(id)
  try {
    localStorage.setItem(SEEN, JSON.stringify([...s]))
  } catch {}
  window.dispatchEvent(new CustomEvent('iv:tour-seen', { detail: id }))
}
export const startTour = (id) => window.dispatchEvent(new CustomEvent('iv:tour', { detail: id }))
