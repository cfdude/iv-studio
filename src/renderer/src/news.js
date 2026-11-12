// What's new: the highlights of each version, newest first. After an update the Dashboard shows the current
// version's once, until it's dismissed; Settings → Updates lists the last few versions'.
export const NEWS = [
  {
    version: '1.1.9',
    items: [
      { text: 'Fixed: the LTX-2.5 models for Dub, Clean plate, Day to night, Add water and SDR to HDR failed their checksum and were deleted after downloading. They download and verify now.' },
      { text: 'The storyboard keeps every line of your script: a line the writer left out gets a shot of its own, and the board says so.' },
      { text: 'Setup can download the three files for training a character on your own graphics card (Characters → Train your own → This computer).' },
      { text: 'More reliable model downloads: every model is pinned to an exact version and checked, and on a Linux or Mac ComfyUI every kind of job finds models kept in folders, not only shots.' }
    ]
  },
  {
    version: '1.1.8',
    items: [
      { text: 'More than one character in a shot: in Create’s “Who’s in it”, click several. The first leads with their trained look; the others come along as their face pictures, and Write it for me names them.' },
      { text: 'Fixed: the storyboard of a long film stopped with “The writer returned something unreadable”. Long scenes are planned in parts, and if a writer’s answer is cut short anyway the board keeps what it finished and says so.' },
      { text: 'Fixed: H3 files kept straight in diffusion_models (not in a “Minimax H3” folder) showed as installed but failed to render. IV Studio now uses each model’s name as your ComfyUI lists it.' },
      { text: 'Hermes errors in the chat show Hermes’s own details, not just “Internal error”.' }
    ]
  },
  {
    version: '1.1.7',
    items: [
      { text: 'A simpler welcome: it starts by asking how much you know about AI video. New to it? Everyday words, fewer choices, and IV Studio picks the settings for you. Then name yourself, your helper and your colour, and it checks your computer.' },
      { text: 'The Cinematography menu shows a picture for every setup: the same scene with each film stock, lens, light, camera move and mood, so you can see the difference before you pick. It opens from a new Cinematography button.' },
      { text: 'Hermes can write your prompts: pick it in Settings → Prompt writer, beside Claude Code and Codex.' },
      { text: 'Start from an example and Stage it on a board open as pop-ups on Create.' }
    ]
  },
  {
    version: '1.1.6',
    items: [
      { text: 'Fixed: Write it for me said Unknown writer "h3" when H3 was the shot’s model (for example after Use in a shot). It uses the writer from Settings again.' },
      { text: 'The editor’s razor (C) is a red katana now: a dashed line shows where it will cut, and each cut slashes the clip in two.' },
      { text: 'Pick a colour: red (the default), blue, purple, orange or Dark (greys only), in Settings → Accessibility or when IV Studio first opens. Buttons, highlights and the artwork all follow it.' },
      { text: 'Name your agent, and tell it your name: when IV Studio first opens or in Settings → You and your agent. It answers to its name in the chat and on the Dashboard, and runs on Claude Code, Codex or Hermes, your pick.' },
      { text: 'Select, Ripple and Roll have their own red cursors too, in the katana’s style.' },
      { text: 'Replace leads the Workflows page.' },
      { text: 'Scroll bars in the app’s colours, the sidebar fits short windows, and Setup no longer scrolls sideways.' },
      { text: 'Fixed: on a narrow window the chat’s close button was cut off at the edge, and the live preview sat over the chat’s message box. The chat’s header now fits, and the live preview keeps to the left of the chat.' }
    ]
  },
  {
    version: '1.1.5',
    items: [
      { text: 'Fixed on Windows: when IV Studio had to start Ollama itself, a terminal window opened every time Ollama loaded a model (with Library search on, after each new render). IV Studio now starts Ollama through its own tray app, or hidden.' }
    ]
  },
  {
    version: '1.1.4',
    items: [
      { text: 'Hermes in the chat: pick Hermes beside Claude Code and Codex, and your own Hermes Agent works in IV Studio with every IV Studio tool, on the model you chose in Hermes. Anything Hermes would run outside IV Studio is declined.' },
      { text: 'History: a tab in the chat lists your earlier conversations, newest first, with which agent and when. Open one to carry on where you left off.' },
      { text: 'And the other way round: the IV Studio plugin for Hermes (github.com/hollisorg/hermes-iv-studio) makes Hermes’s own video and picture tools render here, on your GPU, for free.' }
    ]
  },
  {
    version: '1.1.3',
    items: [
      { text: 'Talk to the chat: press the mic, say what you want, and press send. IV Studio’s own speech recognition writes it down on your computer. Talking while the agent works stops its answer and sends your new words.' },
      { text: 'Read aloud: the speaker in the chat’s header reads each reply in one of your voices (Audio → Voices).' },
      { text: 'A cleaner chat: your messages and the agent’s in bubbles with times, each agent in its own colour, and one rounded box to write in.' },
      { text: 'Pop the chat out into its own window (the arrow in its header), keep it on top, and put it back in the app when you’re done. It still knows what’s open in IV Studio.' },
      { text: 'Activity: a tab in the chat that lists everything agents did in IV Studio (the chat, Dashboard ideas, and Claude Desktop, Codex or any agent using IV Studio from outside), with links to what they made and Undo for changes to an edit.' },
      { text: 'The chat knows more about what you’re looking at: the version you picked on a shot, the clip and playhead in the editor, the item open in the Library, how Create is set up, what’s rendering, and the last render that failed.' },
      { text: 'See how full the agent’s working memory is, and this chat’s usage, in the chat’s header. You’ll see a note when it summarizes earlier messages to make room.' },
      { text: 'Create → Image: a model that isn’t set up opens what it needs, with one button that downloads it. Flux.2 Klein, Flux 3 Klein, Krea 2, Moss and Qwen Image 2.1 can now be downloaded from IV Studio.' },
      { text: 'Setup: each optional tool says what it does and where to find it, and lists its files. The Needs you / Everything bar stays at the top as you scroll. A Hugging Face login for gated models (Flux, the LTX effects) can be saved right there, for this computer and the cloud.' },
      { text: 'Fixed: Z-Image Turbo installed from Setup now works in Create → Image and Projects (they were looking for a different text encoder file).' }
    ]
  },
  {
    version: '1.1.2',
    items: [
      { text: 'The portable Windows copy now updates itself like the installed one: a new version downloads in the background and Update to … restarts into it, keeping your data folder. (From 1.1.1 or older, unzip 1.1.2 over the folder once.)' },
      { text: 'Fixed: an update download could stop just short of the end and never finish.' }
    ]
  },
  {
    version: '1.1.1',
    items: [
      { text: 'Continue from this: every finished version can start a new Continue shot that carries it on, with the same character, LoRAs and shape.' },
      { text: 'Continue shots made in Create now hunt 1 to 3 takes and finish like any shot: the picked take is refined at full size and joined to the source, so the final is the whole continued video.' },
      { text: 'Use the last frame: save a finished version’s final frame as a picture in the Library, then start a new shot from it or change it in Create → Image.' },
      { text: 'Sequences’ character list shows only characters with a LoRA, and says which reference-pack characters it can’t use.' }
    ]
  },
  {
    version: '1.1.0',
    items: [
      { text: 'The rules for MiniMax H3: before your first H3 render, IV Studio shows them in plain words and asks you to agree to its terms once. Read them again, or report misuse, in Settings › About.' },
      { text: 'Chat with your own Claude Code or Codex: the Chat button in the title bar. It can use everything IV Studio does and knows which page you’re on. Before anything that deletes, costs money, installs or changes a setting, it asks you first.' },
      { text: 'Ask it from anywhere: Ask … to fix it on a failed render, to pick the best take on a shot, or about a picture in the Library. Drop pictures, videos, sound or a script into the chat.' },
      { text: 'Show me where: ask where something is, and IV Studio goes there and lights it up.' },
      { text: 'Edit by talking: on an edit, press Ask … and say “tighten the middle” or “put captions on” (captions are new). Every change can be undone from the chat.' },
      { text: 'Recipes: say “save this as a recipe” and it becomes a button on the Dashboard that does it again.' },
      { text: 'Overnight batches: up to 12 variations of an idea render while you’re away, and a report with the best takes is waiting in the chat.' },
      { text: 'A short film in one conversation: Make one with … on Projects takes an idea to a rough cut, stopping for your OK at each step.' },
      { text: 'A spending limit for the chat in Settings → Agents, off unless you turn it on. Seedance works from the chat too.' },
      { text: 'Let Claude Code or Codex make a Dashboard idea for you, and install either one from Check my computer or Settings → Agents.' },
      { text: 'MiniMax H3 Image in Create → Image: big 4, 8 or 16 MP pictures that follow long descriptions. It needs ComfyUI 0.45 or newer and a 22 GB download.' },
      { text: 'Nearly everything now runs on your own RunPod or Modal: pictures, effects, music, sounds, voices, Replace and more. The models it needs download the first time, after you agree.' },
      { text: 'Want IV Studio to run the cloud for you? Join the cloud beta on the Cloud page or in Settings → Privacy.' },
      { text: 'A new look: tall animated banners on every page and an Audio front page. Nothing flashes, and every page fits smaller windows. Banner searches have a Search button.' },
      { text: 'Settings → Setup is tidier, with Restart ComfyUI in one click.' },
      { text: 'Start from an example: Create now offers six ready-made shots that fill in a working prompt, and the welcome wizard’s “Make your first shot” opens the first one ready to hunt.' },
      { text: 'A failed render now says what went wrong in plain words (out of memory, a missing model or node pack, a full drive, credits) with a button for the fix. ComfyUI’s own message is still there under Details.' },
      { text: 'Hunt and Finish say how long they will take on your machine, worked out from your own earlier renders, and what a cloud render will cost.' },
      { text: 'The editor can add a “Made with IV Studio” end card to an export (Edit settings → End card). It is off unless you turn it on.' },
      { text: 'Settings → Privacy: IV Studio sends nothing about how you use it unless you turn on “Help improve IV Studio”, which counts only opens and renders, never prompts, pictures or files.' },
      { text: 'Effects on any clip in the editor (right-click → Effects…): dubbing into any language with new lip movement, clean plates, day to night, water, SDR to HDR, background removal and smooth or slow motion.' },
      { text: 'Workflows → Effects turns a photo into an effect clip, a transformation or a transition. Audio → Sounds makes sound effects, ambiences and loops, ready for A2.' },
      { text: 'Picture tools in Create → Image: inpaint by painting over a part, relight, remove the background, upscale 2× or 4×, and depth or normal maps.' },
      { text: 'LoRAs for every model, not just H3: pick MiniMax H3, LTX-2.5, Wan 2.1, Flux 3 Klein, Flux.2 Klein, Krea 2, Qwen Image 2.1, Z-Image, SDXL or Moss, find its LoRAs on Civitai and use them in that model’s tray.' },
      { text: 'Closing and reopening IV Studio while ComfyUI starts no longer starts a second ComfyUI.' },
      { text: 'Film craft in Projects: coverage plans for a scene (dialogue, entrance, parallel action and more), a continuity check like a script supervisor’s, a Lookbook from any film or cinematographer, and a shot list as a document or CSV.' },
      { text: 'Cinematography and prompt tools in Create and on every film shot: 165 setups (film stocks, lenses, light, camera rigs, moods), a director’s note, Tighten, Enrich, a new angle and 3 variants, with earlier versions kept.' },
      { text: 'Projects writes the script and plans the storyboard with your chosen prompt writer, Claude Code and Codex included.' },
      { text: 'A new prompt writer: OpenAI-compatible. Point it at llama.cpp, llama-swap, vLLM, LM Studio, LiteLLM, OpenAI or any server with the OpenAI API, with an optional key and extra headers (Settings → Prompt writer).' },
      { text: 'Fixed: a switch (like Music’s Instrumental) could scroll the whole window, pushing the title bar off screen. Sequences with a voice no longer send the prompt’s section names twice.' },
      { text: 'Seedance 2.5 in Create: a model switch beside MiniMax H3, on your Comfy.org credits. Cheap 480p drafts or 720p and 1080p takes, 4 to 30 seconds; the price shows first and you confirm before anything is charged.' },
      { text: 'Your Comfy account in Settings and the title bar, with every paid partner model priced before it runs.' },
      { text: 'Free finishes for Seedance takes on your own graphics card (SeedVR2, DLSS 5, or an H3 redraw), and a strength for each upscaler.' },
      { text: 'Speed presets (Quality, Balanced, Fast, Low memory) so smaller cards render too. Check my computer picks one for you.' },
      { text: 'Compare up to four versions in sync: side by side, as a wipe or in a grid, zoomed on the same spot.' },
      { text: 'The Library shows how each render was made: model, size, seed, finish, render time, cost and the prompt.' },
      { text: 'Simple words for people new to AI video, and Get ComfyUI for me when there isn’t one yet.' },
      { text: 'Mac copies now install their own updates, like Windows and Linux.' },
      { text: 'Character training moves to the newest trainer, and RunPod training starts from its own template. Settings → About → Credits lists everything IV Studio is built on.' },
      { text: 'Takes that cut away: when a one-shot take cuts to a close-up nobody asked for, the take card says when, it scores lower, and you can keep the part before or after the cut. In First / last frame mode, each take says whether it really opens and ends on your pictures.' },
      { text: 'The prompt checker warns about “no …” wording: H3 has no negative prompt, so “no photographs” can put photographs on the wall. It suggests what to write instead.' },
      { text: 'Premiere / Resolve in the editor: the timeline as files Premiere Pro, DaVinci Resolve and Final Cut open, with every clip copied beside them and zipped to send.' },
      { text: 'LoRAs → Recommended: a shelf of H3 LoRAs we’ve tried (camera moves, natural speech, motion repair, physics, first-person, 360° orbit, transformations), each with how to use it.' },
      { text: 'Turnaround sheets on Characters: five views of a character turning around, from their face picture.' },
      { text: 'Search the Library by what’s in a file: while nothing renders, your prompt writer looks at each video and picture, so “red car” finds one (Settings → Prompt writer turns it off).' },
      { text: 'Soft mouth: a reference video’s mouths are blurred first, so the new face doesn’t mouth its words (Create’s References mode and Replace).' },
      { text: 'Dailies after an overnight batch: a reel of every take with a card for each (seed and checks), and notes on what to look at first.' }
    ]
  },
  {
    version: '1.0.9',
    items: [
      { text: 'Shut down GPU on Modal works again: newer Modal tools asked “Are you sure?” with nobody there to answer, and the stop failed. Guided tours show their cards on every step.' }
    ]
  },
  {
    version: '1.0.8',
    items: [
      { text: 'Settings → Accessibility: bigger text, higher contrast text, reduce motion, clear focus outlines and underlined links. Secondary text is easier to read for everyone, too.' },
      { text: 'A ComfyUI address typed the way a browser takes it (localhost:8000) works now. Check my computer finds a ComfyUI running on another port, like the Desktop app’s 8000, and offers Use it, an address box and Check again.' },
      { text: 'Check my computer measures free space on the drive your ComfyUI keeps its models on, not always C:.' },
      { text: 'Choose where finished videos go, on any drive: Settings → Folders → Finished videos, or in Check my computer.' },
      { text: 'Live step pictures need H3’s small preview model, now a one-click download in Settings → Setup. Without it, the live panel says so instead of promising a picture.' }
    ]
  },
  {
    version: '1.0.7',
    items: [
      { text: 'Show details during a cloud setup no longer turns the window blank. The setup itself always kept going; now the window does too.' },
      { text: 'If a page ever hits an error, IV Studio says so with a Reload button instead of showing an empty window. Renders, downloads and setups carry on either way.' }
    ]
  },
  {
    version: '1.0.6',
    items: [
      { text: 'Cloud setup shows how it’s going: each step with a check or its own progress bar, the time so far and about how long is left, instead of a scrolling log (that’s under Show details).' },
      { text: 'You don’t have to watch it: leave the page or use the rest of IV Studio. A pill in the top bar shows the progress, and IV Studio tells you when the cloud is ready (with a notification if it’s in the background).' },
      { text: 'Setting up Modal on a computer without ComfyUI no longer stops at the last step.' }
    ]
  },
  {
    version: '1.0.5',
    items: [
      { text: 'IV Studio keeps its copy of Modal’s client up to date: when a release needs a newer one, it updates itself before your next cloud setup, render or training on Modal (about a minute, sign-in kept). The Cloud page says when one is due, with Update now.' }
    ]
  },
  {
    version: '1.0.4',
    items: [
      { text: 'Cloud setup on a new Modal account works: Modal gives new accounts a newer image builder that IV Studio’s Modal client can’t use yet, so IV Studio now asks for the one its cloud is built and tested with (2025.06).' }
    ]
  },
  {
    version: '1.0.3',
    items: [
      { text: 'Modal sign-in fixed: IV Studio only says you’re signed in when Modal accepts the login (before, it could show a workspace called “default” with no login, and setup then stalled). While Modal’s page is open there’s a link to it, for when no browser opened, and Cancel.' },
      { text: 'Sign out of Modal on the Cloud page or in the cloud setup, to sign in again or with another account.' },
      { text: 'If the window’s page or graphics stop working, IV Studio reloads the window instead of leaving it blank.' }
    ]
  },
  {
    version: '1.0.2',
    items: [
      { text: 'Remix a song: on Music, pick a song or one of yours, describe a new style and choose how far to take it (Subtle, Remix or Reimagine, or the slider). ACE-Step redraws it in seconds, reading its tempo and key for you. Works best on instrumentals.' },
      { text: 'Sequences take LoRAs: add up to four in Look and size and every shot uses them, in one take, retakes and shot by shot.' },
      { text: 'Edit and run again on a sequence’s shot now opens that shot in its sequence, so the new render stays part of it. Renders that came loose before can be put back with Use as shot N.' },
      { text: 'Move IV Studio’s data folder to another drive in Settings → Data folder. There’s also a portable Windows zip that keeps everything in a folder beside IV Studio.exe.' },
      { text: 'Rebuild, a new workflow: bring a video you made and IV Studio reads it shot by shot. Your agent (Claude Code or Codex) plans how each shot is remade, you approve the plan and the frames, H3 renders the new shots, and a first cut lands in Edit.' },
      { text: 'Every workflow now says what it needs, on its card and on its page.' }
    ]
  },
  {
    version: '1.0.1',
    items: [
      { text: 'A ComfyUI that is busy loading a model or rendering is no longer taken for one that isn’t running: Setup says it’s busy, checks again by itself, and never offers to start a second ComfyUI.' },
      { text: 'Install missing node packs only asks you to start ComfyUI when it really isn’t running. If ComfyUI answers on another port (the ComfyUI Desktop app uses 8000), Setup offers a button to use that address.' }
    ]
  },
  {
    version: '1.0.0',
    items: [
      { text: 'IV Studio 1.0. Every page has a How it works button that walks you through its real controls, and a full tour shows the whole app in two minutes (Settings, About takes it again).' },
      { text: 'Check my computer reads your graphics card, memory and drives and sets IV Studio up to suit them, and a guided cloud setup connects RunPod, Modal or Comfy Cloud.' },
      { text: 'Create, Settings, Characters and the Workflows tools are redesigned as clear numbered steps; Sizzle, Reel, Sequences, Shinobi and Replace open on animated stages.' },
      { text: 'Shots, Projects and the Library group your work by day, filter by when, kind, who and shape, and open quickly however much you have.' },
      { text: 'Train a character free on your own graphics card, or on RunPod or Modal, with presets, a spending cap, Train more and likeness scoring. Or make a RefMod character from a few pictures in seconds.' },
      { text: 'Pick the sampler and scheduler for a shot, and keep a resizable live preview of any render over every page, including the ones your AI agent starts.' }
    ]
  },
  {
    version: '0.3.4',
    items: [
      { text: 'Each Workflows tool (Sequences, Sizzle, Reel, Shinobi and Replace) has its own picture on its card, drawn in the style of IV Studio’s page banners.' }
    ]
  },
  {
    version: '0.3.3',
    items: [
      { text: 'Settings → Setup → Updates keeps ComfyUI up to date: Check for updates, then Update everything updates ComfyUI, every custom node pack and ComfyUI-Manager, saving a snapshot first and restarting ComfyUI after. Undo last update puts it all back.' },
      { text: 'On ComfyUI 0.44 or newer, finishes use ComfyUI’s own H3 latent upscaler: the same model and size, faster, without the memory spikes.' }
    ]
  },
  {
    version: '0.3.2',
    items: [
      { text: 'IV Studio runs on a Mac (Apple Silicon and Intel). A Mac has no NVIDIA card for MiniMax H3, so shots render on your RunPod or Modal account, or on Comfy Cloud: the Dashboard points you to the Cloud page.' }
    ]
  },
  {
    version: '0.3.1',
    items: [
      { text: 'Create → Image makes pictures with SDXL (and any SDXL fine-tune) and with MiniMax H3: a still in the look of your shots, starring your H3 characters.' },
      { text: 'Comfy Cloud is a third cloud choice: paste a Comfy API key, and the Cloud page checks what IV Studio can do there.' },
      { text: 'Free in the title bar clears the GPU and RAM now: ComfyUI’s models, the voice engine and the writer’s model.' }
    ]
  },
  {
    version: '0.3.0',
    items: [
      { text: 'Replace has a new engine: swap people into any video, or change the scene in plain words (snow, night, something removed). IV Studio paints a frame of each shot for you to check, writes the prompt and keeps the motion and sound.' },
      { text: 'In the editor, right-click a clip → Remake this clip.' }
    ]
  },
  {
    version: '0.2.11',
    items: [
      { text: 'Settings → Setup installs every node pack IV Studio uses into your ComfyUI with one click, at the versions it’s tested with. Restart ComfyUI afterwards.' },
      { text: 'Setup and renders accept other versions of the H3 models, like the ones ComfyUI’s own H3 templates download, so you don’t download them twice.' }
    ]
  },
  {
    version: '0.2.10',
    items: [{ text: 'Use Ollama from another container or computer: Settings → Prompt writer → Ollama address (or OLLAMA_HOST).' }]
  },
  {
    version: '0.2.9',
    items: [{ text: 'Learn opens the IV Studio guide, a step-by-step PDF with every button pointed out. Each page’s ? has it too. Videos are coming soon.' }]
  },
  {
    version: '0.2.8',
    items: [
      { text: 'IV Studio runs on Linux too: an AppImage that updates itself, and it starts your ComfyUI from its .sh script or main.py.' },
      { text: 'On Linux, Settings → Agents gives Claude Code or Codex a command that works from the AppImage.' }
    ]
  },
  {
    version: '0.2.7',
    items: [
      { text: 'References mode keeps the place from your idea from the very first shot: Write it for me no longer opens on the background of your picture.' },
      { text: 'Short films: the people and places in a script you type show up on Cast and places straight away.' },
      { text: 'The Library names every version of a shot apart: each run, each final and each enhanced copy.' },
      { text: 'The writer on this computer no longer stalls on a runaway answer, and the prompt checker raises fewer false alarms.' }
    ]
  },
  {
    version: '0.2.6',
    items: [
      { text: 'References mode makes a new scene: the person from your picture, the place from your idea, instead of the picture’s own background.' },
      { text: 'The Cloud page lists RunPod first.' }
    ]
  },
  {
    version: '0.2.5',
    items: [{ text: 'IV Studio starts your ComfyUI: when it opens, or with Start ComfyUI in the title bar. Pick your ComfyUI folder and start file in Settings.' }]
  },
  {
    version: '0.2.4',
    items: [{ text: 'Render in the cloud on your own RunPod account too: pick a GPU at RunPod’s live price, and it shuts itself off when idle.' }]
  },
  {
    version: '0.2.3',
    items: [
      { text: 'Projects: a short film from an idea in six steps, with a storyboard, an animatic and every shot filmed for you.' },
      { text: 'Made-up people in a film keep one face: drawn, or your own picture (Use a picture). Someone who never speaks, like a dog, can be added too.' },
      { text: 'More angles of a place keep every shot in the same room.' },
      { text: 'One-take shots carry straight on from the shot before.' },
      { text: 'Write it for me can use Claude Code or Codex, follows MiniMax’s own guide, and looks at your references.' },
      { text: 'Stage a shot on a board; arcs film from a previs.' },
      { text: 'Takes are ranked, compared side by side and reviewed with one suggested fix.' },
      { text: 'Finish with DLSS 5 or SeedVR2; live previews while takes render.' },
      { text: 'Cut someone out of a shot, see-through everywhere else.' },
      { text: 'Reframe any shot or picture to 9:16, 1:1 or 16:9 without cropping.' },
      { text: 'Reel: pictures and a song, cut to the beat.' },
      { text: 'Exports come out at the loudness phones expect.' }
    ]
  }
]
// The version whose news hasn't been seen yet, or null.
export function unseenNews(version, seen) {
  const entry = NEWS.find((n) => n.version === version)
  return entry && seen !== version ? entry : null
}
