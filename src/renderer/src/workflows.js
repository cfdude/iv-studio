// The Workflows tools: one card each on the Workflows page, in this order, each its own page. needs: what a tool
// requires beyond IV Studio itself, shown on its card and on its page (FlowKit's WorkflowNeeds), so nobody starts
// one without it. New tools are added here.
export const WORKFLOWS = [
  {
    page: 'sequences',
    name: 'Sequences',
    tag: 'Several shots, one continuous take',
    about: 'Write a scene as a list of 10 or 15 second shots and render them as one unbroken video, in one take or shot by shot, then retake any stretch and render it out.',
    credit: 'H3 Multishot',
    needs: ['H3 on this computer']
  },
  {
    page: 'sizzle',
    name: 'Sizzle',
    tag: 'A website, made into a film',
    about: 'Put in a web address. Your agent storyboards a promo film from the real site, then H3 shots, pictures, music and the site’s own screens are cut together with motion and typography.',
    credit: 'Capture, H3, Z-Image, MiniMax Music, Shinobi',
    needs: ['Claude Code or Codex', 'Shinobi', 'H3, Z-Image and a music model on this computer']
  },
  {
    page: 'effects',
    name: 'Effects',
    tag: 'A photo, made into a moment',
    about: 'Pick a photo and an effect: cakeify, explode, money rain, a 360° orbit and 20 more; a transformation that keeps the face; or a transition from one picture into another. Each becomes a short clip.',
    credit: 'Freefield (neuregex): Wan 2.1, Flux 3 Klein, LTX-2.5',
    needs: ['Wan 2.1 or LTX-2.5 on this PC (Setup)']
  },
  {
    page: 'reel',
    name: 'Reel',
    tag: 'Pictures and a song, cut to the beat',
    about: 'Add pictures in order and pick a song. IV Studio finds its beat and cuts them on its bars, with a slow move on each picture, as an edit you can finish in Edit.',
    credit: 'Beat finding and motion: IV Studio',
    needs: ['Nothing extra: your pictures and a song']
  },
  {
    page: 'shinobi',
    name: 'Shinobi',
    tag: 'Edits your agent cuts',
    about: 'Hand footage to an agent (or a one-click style) and get a finished edit: cuts on the beat, speed ramps, typography, effects and sound.',
    credit: 'Your agent, rendered on this computer',
    needs: ['Shinobi’s engine (one click, about 440 MB)', 'Claude Code or Codex, or a one-click style']
  },
  {
    page: 'replace',
    name: 'Replace',
    tag: 'Swap who is in the shot, or change the scene',
    about: 'Put your characters in place of people in a video, or change the scene in plain words: snow, night, a new setting, something removed. IV Studio paints the frames, you check them, and the camera, motion and soundtrack stay.',
    credit: 'Viggle Remake on MiniMax H3, Qwen Image, your characters',
    needs: ['H3 on this computer', 'Its node packs and models (the page lists them)']
  },
  {
    page: 'rebuild',
    name: 'Rebuild',
    tag: 'A video, taken apart and rebuilt',
    about: 'Bring a video you made. IV Studio reads it shot by shot, your agent plans how each shot is remade, you approve the plan and the frames, H3 renders the new shots and a first cut lands in Edit beside the original.',
    credit: 'Your agent, H3, Qwen Image, IV Studio’s reader',
    needs: ['Claude Code or Codex', 'H3 on this computer']
  }
]

export const NEEDS = Object.fromEntries(WORKFLOWS.map((w) => [w.page, w.needs]))
