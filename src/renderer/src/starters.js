// Starters: ready-made shots to begin from. Each fills Create with a prompt that already passes the prompt checker
// (src/service/lint.js; test/starters.mjs runs it on every one), so a first hunt works without writing anything.
// They only set what a shot is about (mode, shape, length, words); size, steps and takes stay on the speed preset
// Check my PC chose. All are text shots with no character, so they need nothing but H3.
//
// `first` is the one the welcome wizard's "Make your first shot" opens: short, wide, hard to get wrong.
const shot = (description, sound, music = 'N/A') => `integrated_multimodal_description: [Shot 1] ${description}\noverall_soundscape: ${sound}\nnon_diegetic_music: ${music}`

export const STARTERS = [
  {
    id: 'first',
    name: 'Lighthouse at dusk',
    tag: 'A first shot',
    about: 'A wide, calm landscape with a slow camera move. A good first render: it shows what H3 does with light, water and sound.',
    aspect: '16:9',
    seconds: 5,
    prompt: shot(
      'A white stone lighthouse on a rocky headland at dusk, cinematic realism. Wide shot from a low cliff path. The lamp at the top turns slowly and its beam sweeps across darkening water. Long waves roll in and break white against the rocks below. Thin clouds glow orange and violet behind the tower, and tall grass in the foreground bends in the wind. The camera drifts forward very slowly along the path. Soft film grain, deep natural colour. There is no writing anywhere in the picture.',
      'Steady wind, waves breaking on rock, a far-off gull.'
    )
  },
  {
    id: 'product',
    name: 'Product on a table',
    tag: 'An ad shot',
    about: 'A clean studio close-up with a slow push-in. Swap the cup for your own product, in your own words.',
    aspect: '16:9',
    seconds: 5,
    prompt: shot(
      'A matte black ceramic coffee cup on a pale oak table, premium product photography. Close shot at table height. Soft morning window light comes from the left and steam curls up from the cup. A hand enters from the right, sets a small silver spoon beside the cup and leaves. The background is a softly blurred kitchen in warm neutral tones. The camera pushes in slowly toward the cup. Shallow depth of field, crisp detail on the glaze. There is no writing or logo anywhere in the picture.',
      'A quiet kitchen, the soft clink of a spoon on wood, a faint hiss of steam.'
    )
  },
  {
    id: 'trailer',
    name: 'Trailer opening',
    tag: 'A film opening',
    about: 'An aerial opening shot with music, the kind a trailer starts on. Ten seconds, so it takes about twice as long to render.',
    aspect: '16:9',
    seconds: 10,
    prompt: shot(
      'A lone rider on a dark horse crosses a vast frozen lake between snow-covered mountains at first light, epic cinematic realism. High aerial shot looking down and ahead. The rider is small in the frame and leaves a thin line of hoofprints across the white surface. Low sun breaks over the ridge and long blue shadows stretch across the ice. Fine snow blows in ribbons along the ground. The camera glides forward and slowly descends toward the rider. Anamorphic look, cool palette with a warm rim of sunlight. There is no writing anywhere in the picture.',
      'High wind over open ice, distant muffled hoofbeats.',
      'A low sustained string note that swells slowly, with one deep drum hit near the end.'
    )
  },
  {
    id: 'vertical',
    name: 'Street food close-up',
    tag: 'A vertical clip',
    about: 'A tall 9:16 shot for phones: bright, close and busy, made to stop a thumb.',
    aspect: '9:16',
    seconds: 5,
    prompt: shot(
      'A street food stall at night, vivid handheld realism. Close shot over a wide steel pan. A cook’s hands toss noodles with green onions and red chilli in a burst of flame, then slide them onto a paper plate. Sparks and steam rise past a string of warm bulbs, and blurred neon colours glow in the wet street behind. The camera stays close and tilts up slightly as the flame flares. Rich saturated colour, shallow depth of field. No faces are in frame, and there is no writing anywhere in the picture.',
      'Loud sizzling, a metal spatula scraping the pan, a busy night market murmur behind.'
    )
  },
  {
    id: 'storybook',
    name: 'Paper fox in the snow',
    tag: 'An animated look',
    about: 'A stylised paper-cut scene rather than a real one. Change the animal, the season or the style to make it yours.',
    aspect: '16:9',
    seconds: 5,
    prompt: shot(
      'A small orange fox made of layered cut paper walks through a paper forest in falling snow, handmade stop-motion storybook style. Side-on wide shot. The fox trots from left to right between tall white paper birch trees, stops, looks up at the falling flakes and flicks its tail. Each layer of the forest sits at a different depth and casts a soft shadow on the one behind. Paper snowflakes drift down on thin threads. The camera slides sideways with the fox. Soft warm light from the upper left, visible paper grain. There is no writing anywhere in the picture.',
      'Soft crunching footsteps in snow, a hush of wind, a tiny bell-like chime as the fox stops.'
    )
  },
  {
    id: 'backdrop',
    name: 'Ink in water',
    tag: 'A website backdrop',
    about: 'A slow abstract loop with no subject, for behind a headline on a website or a title card.',
    aspect: '16:9',
    seconds: 5,
    prompt: shot(
      'Clouds of deep crimson and pink ink bloom slowly through clear water against a black background, macro studio photography. Close shot, perfectly still camera. The ink unfolds in soft curling ribbons from the top of the frame, spreads, thins and folds back on itself. Fine threads of pigment catch a narrow white light from the side. The motion is slow and continuous with no sudden change. Very shallow depth of field, rich contrast. There is no writing anywhere in the picture.',
      'Near silence, a deep soft underwater hum.'
    )
  }
]

export const FIRST_STARTER = STARTERS[0]
export const starterById = (id) => STARTERS.find((s) => s.id === id) || null

// The form values a starter sets. Everything else on the form stays as it is.
export const starterForm = (s) => ({ engine: 'h3', mode: 'text', character: 'none', aspect: s.aspect, seconds: s.seconds, prompt: s.prompt, media: [], voiceLine: null, voiceItem: null, refmods: [] })
