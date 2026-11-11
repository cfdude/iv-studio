// What's new: the highlights of each version, newest first. After an update the Dashboard shows the current
// version's once, until it's dismissed; Settings → Updates lists the last few versions'.
export const NEWS = [
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
      { text: 'Replace runs on Viggle Remake: swap people into any video, or change the scene in plain words (snow, night, something removed). IV Studio paints a frame of each shot for you to check, writes the prompt and keeps the motion and sound.' },
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
