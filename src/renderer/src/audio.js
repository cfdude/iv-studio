// The audio side's tools: one card each on the Audio page (AudioHome.jsx), in this order, each its own page. needs:
// what a tool requires beyond IV Studio itself; credit: the models it runs on (credits.js has the full list).
export const AUDIO_TOOLS = [
  {
    page: 'voices',
    name: 'Voices',
    tag: 'A voice for every character',
    about: 'Describe a voice that doesn’t exist yet, or save your own from a recording, and give it to a character so their shots speak in it.',
    needs: ['The voice engine, set up once (about 12 GB) on this computer or your cloud']
  },
  {
    page: 'lines',
    name: 'Lines',
    tag: 'Say it in their voice',
    about: 'Type a line, pick a voice, and use it as a shot’s voice line: H3 lip-syncs the character to it.',
    needs: ['A voice from Voices']
  },
  {
    page: 'music',
    name: 'Music',
    tag: 'Songs and scores',
    about: 'Describe the music, add lyrics or keep it instrumental, or remix a song you already have, for an edit or a song a character sings.',
    needs: ['A music model on this computer (Setup)']
  },
  {
    page: 'sounds',
    name: 'Sounds',
    tag: 'Effects, ambiences and loops',
    about: 'Describe a sound and make up to four takes at once, then put the one you like under an edit, on A2 beneath the music.',
    needs: ['The sound model on this computer (Setup)']
  }
]
