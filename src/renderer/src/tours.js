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
      { go: { page: 'workflows', section: 'video' }, at: '.workflow-cards', title: 'Workflows', text: 'Tools for after a render: one-take sequences, swapping people, reels cut to a song, and agent-made edits.' },
      { go: { page: 'characters', section: 'video' }, at: ['.cast-section', '.train-paths'], title: 'Characters', text: 'Your recurring actors, the same in every shot. Add one you have, or train your own.' },
      { go: { page: 'voices', section: 'audio' }, at: '.section-switch', title: 'The sound side', text: 'Visual and Audio switch the sidebar. Audio has Voices, Lines and Music.' },
      { go: { page: 'media', section: 'video' }, at: '.nav-library', title: 'Library', text: 'Everything you made, in one place: videos, pictures, songs and voice lines.' },
      { go: { page: 'cloud', section: 'video' }, at: '.cloud-guided', title: 'Cloud', text: 'No strong graphics card? Render on your own cloud GPU account instead.' },
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
      { at: '.engine-badge', title: 'ComfyUI and your GPU', text: 'Whether ComfyUI is ready, and how much of your graphics card and memory is in use. Free memory unloads models when you need room.' },
      { at: '.hero-help', title: 'Help on every page', text: 'This button is on every page. Click it any time to walk through what that page does.' }
    ]
  },
  create: {
    title: 'Create a shot',
    steps: [
      { at: '.create-kind', title: 'Video or picture', text: 'Make a shot with sound (Video) or a still picture (Image).' },
      { at: 'step:What kind of shot', title: 'What kind of shot', text: 'Text starts from words alone. References, Frames and Continue start from your pictures or a video.' },
      { at: "step:Who's in it", title: 'Who is in it', text: 'Pick a character so they look and sound the same in every shot. LoRAs and RefMods add a look, a style or a move.' },
      { at: '.create-step:has(.create-drop)', title: 'What it builds on', text: 'Drop pictures or a video here. Add them before writing the prompt, so the writer can see them.' },
      { at: 'step:What happens', title: 'What happens', text: 'Say your idea in plain words and press Write my prompt. Type @ to bring in a character or a saved place. The checker below flags problems and its Fix button mends most of them.' },
      { at: 'step:Shape and size', title: 'Shape and size', text: 'The frame shape, the length, how many previews and their quality. Draft is about twice as fast for trying ideas.' },
      { at: ['.shot-card', '.create-dock'], title: 'Your shot', text: 'A summary of what you set up. Hunt renders the previews; you then pick the best one and finish it at full size.' }
    ]
  },
  image: {
    title: 'Create a picture',
    steps: [
      { at: '.create-kind', title: 'Video or picture', text: 'Image makes still pictures. Switch back to Video for shots with sound.' },
      { at: 'step:What to make', title: 'Make or edit', text: 'Generate makes new pictures from words. Edit changes a picture you give it.' },
      { at: 'step:The model', title: 'The model', text: 'Each family has its own look and speed. Makes means it creates pictures; edits means it can also change one.' },
      { at: 'step:The picture to edit', title: 'The picture to edit', text: 'Drop in the picture to change.' },
      { at: ['step:What it shows', 'step:What to change'], title: 'Describe it', text: 'Write what you want to see, or for Edit, what to change. LoRAs for the chosen model add a look or a style.' },
      { at: 'step:Shape and size', title: 'Shape and size', text: 'The picture shape, its size and how many to make at once.' },
      { at: '.shot-card', title: 'Make it', text: 'A summary and the button that makes the pictures.' },
      { at: '.image-gallery', title: 'Your pictures', text: 'Everything you made. Open one to use it as a shot’s first frame, edit it, or make more like it.' }
    ]
  },
  projects: {
    title: 'Projects',
    steps: [
      { title: 'A short film, step by step', text: 'Projects turns an idea or a script into a finished short film: story, cast, storyboard, filming and the final cut.' },
      { at: '.shelf-bar', title: 'Find a film, or start one', text: 'Writing, Planning, Filming and Watching show where each film is, with a count. Search, sort, and + New film starts one.' },
      { at: '.shelf-filters', title: 'Narrow it down', text: 'When you worked on it and its shape. Fold the panel away with Filters; Clear puts everything back.' },
      { at: '.shelf-group', title: 'By day', text: 'Films sit under the day you last worked on them. Click a day to fold it away; click a film to carry on where you left off.' }
    ]
  },

  project: {
    title: 'Making a film',
    steps: [
      { at: '.wiz-steps', title: 'Six steps', text: 'Idea, Story, Cast and places, Storyboard, Film it, Watch. You can go back to any step at any time.' },
      { at: '.wiz-page', title: 'This step', text: 'Answer what this step asks. Write it for me drafts the script or the shots if you want a head start.' },
      { at: '.wiz-panels', title: 'The storyboard', text: 'Every shot is a panel with a sketch. Click one to change what happens, the camera, the line or the length.' },
      { at: '.wiz-foot', title: 'Next', text: 'When this step looks right, move on. Play the animatic before filming: it costs seconds, not GPU minutes.' }
    ]
  },
  shots: {
    title: 'Shots',
    steps: [
      { at: '.shelf-bar', title: 'Find a shot', text: 'All, Finished, or still to pick, each with a count. Search by name, sort, or start a New shot.' },
      { at: '.shelf-filters', title: 'Narrow it down', text: 'When it was made, the kind of shot, who is in it and its shape. Counts show what each choice leaves. Fold the panel away with Filters; it remembers, and Clear puts everything back.' },
      { at: '.shelf-group-head', title: 'One day at a time', text: 'Shots sit under the day you last worked on them; older ones by month. The day stays at the top as you scroll, and a click folds it away.' },
      { at: '.shelf-tile', title: 'Open one', text: 'Hover to play its latest take. Inside, you watch the takes, pick the best and finish it at full size.' }
    ]
  },

  shot: {
    title: 'A shot',
    steps: [
      { at: '.shot-actions', title: 'Try again', text: 'Edit the latest run’s settings and render again into this same shot.' },
      { at: '.run-head', title: 'A run', text: 'Each run shows how it was made: mode, size, length, seed, character and render time. Its own Edit and run again starts from it.' },
      { at: '.candidates', title: 'The takes', text: 'Watch each take. A score marks the strongest. Review names what is off and suggests one fix; Compare plays two side by side.' },
      { at: '.take-pick', title: 'Pick one', text: 'Pick the take you like. Picking also teaches the scoring your taste.' },
      { at: '.finish-panel', title: 'Finish it', text: 'Render the picked take at full size, with the enhancer, frame rate and sound you want.' },
      { at: '.final-card, .final', title: 'The final', text: 'The finished shot. Enhance makes a sharper copy beside it, any time later.' }
    ]
  },
  edits: {
    title: 'Edit',
    steps: [
      { at: '.shelf-bar', title: 'Your edits', text: 'Search them, or start a new edit.' },
      { at: '.shelf-grid', title: 'Open an edit', text: 'Each edit is a timeline of your shots, pictures, songs and titles. Click one to open the editor.' }
    ]
  },
  editor: {
    title: 'The editor',
    steps: [
      { at: '.ed-bin', title: 'Your media', text: 'Everything in this edit, plus the whole Library. Add files or a title here.' },
      { at: '.ed-monitor', title: 'Source', text: 'Click something in the bin to see it here. Mark I and O, then press comma to insert or full stop to overwrite at the playhead.' },
      { at: '.ed-effects', title: 'Effect controls', text: 'The selected clip’s settings. With nothing selected, the edit’s own: format, frame rate and loudness.' },
      { at: '.ed-toolbar', title: 'Tools', text: 'Select (V), Razor (C), Ripple (B) and Roll (N), with snapping and zoom.' },
      { at: '.ed-tl-wrap', title: 'The timeline', text: 'Drag clips to move and trim them. Right-click a clip to Extend, Retake, Cut out or Reframe it with new footage; right-click a gap to fill it.' },
      { at: '.ed-export', title: 'Export', text: 'Full screen gives you more room (F11, Esc to come back). Export makes the finished video.' }
    ]
  },
  workflows: {
    title: 'Workflows',
    steps: [
      { title: 'Take a video further', text: 'Tools for what comes after a render. Each one works with your IV Studio renders and files.' },
      { at: '.workflow-cards', title: 'The tools', text: 'Sequences for several shots in one take, Replace to swap who is in a shot, Reel to cut pictures to a song, Shinobi and Sizzle for edits an agent helps make.' }
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
      { at: ['step:Who goes in', 'step:What changes'], title: 'Who or what', text: 'Pick the character (or a picture) who goes in, or say in plain words what should change.' },
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
      { at: '.cast-section:not(.train-own)', title: 'Your characters', text: 'The people H3 plays, the same in every shot. Click a card for its settings: trigger word, strength and voice.' },
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
      { at: '.lora-tabs', title: 'Discover or yours', text: 'Discover finds LoRAs on Civitai. Yours shows the LoRAs already in ComfyUI.' },
      { at: '.lora-bar', title: 'Search', text: 'Search by name and sort by downloads, rating or newest.' },
      { at: '.lora-tags', title: 'Kinds', text: 'Narrow it down to styles, concepts, camera moves and more.' },
      { at: '.lora-card', title: 'A LoRA', text: 'Hover to play its clip. Click for its details, licence and trigger words, and download it or use it in a shot. Downloads need your Civitai key in Settings.' }
    ]
  },
  cloud: {
    title: 'Cloud',
    steps: [
      { title: 'Render on a cloud GPU', text: 'No strong graphics card, or want more? Shots can render on your own RunPod, Modal or Comfy Cloud account, billed by the second.' },
      { at: '.cloud-guided', title: 'Guided setup', text: 'The easiest way in: pick a service, connect it, choose a GPU and set it up. Setup shows each step with a timer and how long is left; you can leave the page, and IV Studio tells you when it’s ready.' },
      { at: '.cloud-control', title: 'Where it renders', text: 'Switch between this computer and the cloud whenever you like.' },
      { at: '.engine-badge', title: 'The meter', text: 'While on the cloud, the title bar shows GPU time and cost. Shut down GPU stops it at once; it also stops by itself when idle.' }
    ]
  },
  settings: {
    title: 'Settings',
    steps: [
      { at: '.settings-tabs', title: 'Settings and Setup', text: 'Settings is how IV Studio works for you. Setup checks what ComfyUI has and downloads what it needs.' },
      { at: '.set-nav', title: 'Jump around', text: 'Every topic in one list. Click one to jump to it.' },
      { at: '#set-pc', title: 'Your computer', text: 'What your computer can do. Check again re-runs the scan and its recommended defaults.' },
      { at: '#set-access', title: 'Accessibility', text: 'Bigger text, higher contrast, less motion, clear focus outlines and underlined links. Each applies at once.' },
      { at: '#set-comfy', title: 'ComfyUI', text: 'Where ComfyUI is (typing localhost:8000 is fine), and whether IV Studio starts it for you when it opens.' },
      { at: '#set-folders', title: 'Folders', text: 'Where finished videos go, on any drive, and where renders save inside ComfyUI.' },
      { at: '#set-writer', title: 'Prompt writer', text: 'Who writes your prompts: a free local model, your own Claude Code or Codex, or MiniMax’s paid rewriter.' },
      { at: '#set-agents', title: 'Agents', text: 'Connect Claude Code, Codex or any MCP agent, so it can make shots and edits in IV Studio with you.' }
    ]
  },
  setup: {
    title: 'Setup',
    steps: [
      { at: '.setup-actions', title: 'Check again', text: 'Checks ComfyUI, its node packs and every model IV Studio uses.' },
      { at: '.setup .group', title: 'What’s ready', text: 'Each group lists what is ready and what is missing, with a button to download or install it. Downloads are checked against their published hashes.' },
      { at: '.comfy-updates', title: 'Updates', text: 'Keeps ComfyUI and its node packs up to date, with a snapshot first so you can undo.' }
    ]
  },
  voices: {
    title: 'Voices',
    steps: [
      { at: '.engine-strip', title: 'The voice engine', text: 'Voices run on this computer. The first time, set them up once (about 12 GB).' },
      { at: '.voice-grid', title: 'Your voices', text: 'Play each one, rename it, and give it to a character. That character’s shots then speak in it.' },
      { at: '.audio-card', title: 'A new voice', text: 'Describe a voice that doesn’t exist yet, or save one from a recording. Never a real person’s voice without their consent.' }
    ]
  },
  lines: {
    title: 'Lines',
    steps: [
      { at: '.composer', title: 'Say a line', text: 'Pick a voice, type the words and press Speak (or {mod+Enter}).' },
      { at: '.track-list', title: 'Spoken lines', text: 'Play them back. Use in a shot sends a line to Create, where the character lip-syncs it.' }
    ]
  },
  music: {
    title: 'Music',
    steps: [
      { at: '.engine-cards', title: 'The engine', text: 'MiniMax Music sings words clearly. ACE-Step is quick for background music.' },
      { at: '.composer label.field', title: 'Style', text: 'Genre, mood, instruments, the voice and how it feels.' },
      { at: '.composer div.field', title: 'Lyrics', text: 'Mark the parts like [Verse] and [Chorus], or switch on Instrumental. A MiniMax song’s length follows its lyrics.' },
      { at: '.composer-foot', title: 'Make it', text: 'Songs land below. Add one to an edit or use it in a shot.' }
    ]
  },
  library: {
    title: 'Library',
    steps: [
      { at: '.shelf-bar', title: 'Everything you made', text: 'Videos, pictures, songs and voice lines in one place, each with a count. Search everything and sort.' },
      { at: '.shelf-filters', title: 'Narrow it down', text: 'When it was made, where it came from, and for shots their kind, who is in them and their shape. Fold the panel away with Filters; it remembers.' },
      { at: '.shelf-group-head', title: 'One day at a time', text: 'Everything sits under the day it was made, older work by month. Click a day to fold it away.' },
      { at: '.lib-tile', title: 'One tile per thing', text: 'A shot’s previews and finals sit in one tile. Open it to step through every version with the arrow keys, add it to an edit or use it in a shot.' }
    ]
  }
}

// the page each banner art belongs to, when the page doesn't name its own tour
export const TOUR_FOR_ART = { create: 'create', shots: 'shots', projects: 'projects', edit: 'edits', characters: 'characters', voices: 'voices', lines: 'lines', music: 'music', workflows: 'workflows', sequences: 'sequences', shinobi: 'shinobi', replace: 'replace', sizzle: 'sizzle', rebuild: 'rebuild', loras: 'loras', library: 'library', settings: 'settings', cloud: 'cloud' }

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
