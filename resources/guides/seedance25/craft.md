# Seedance 2.5 — craft: character, performance, camera, realism, language

---

## 1. Character appearance formulas

Use these when building a person from text (they work for animated characters too), or alongside an
`@Image` reference to reinforce it.

### Hair

`[length/cut] + [color] + [texture/styling] + [movement or detail]`

- "Black hair tied into a casual, elegant classical low bun, fixed only with a plain jade hairpin.
  A few strands of fine black hair fall at the edge of the cheeks, gently brushed by the breeze."
- "Caramel-brown, slightly curly long hair with a natural fluffy, just-woken-up messiness, a few
  strands draped over the collarbone."
- "Silver-white ear-length short hair with a strong mirror-like highlight texture, sharp edges,
  tight to the scalp."

### Clothing

`[pattern/cut] + [color] + [specific clothing noun] + [fabric material / new or worn state] + [wearing method / detail]`

- "A minimalist plain white cross-necked ancient costume in soft silk or light gauze with a sheen.
  The collar is slightly loose; no extra embroidery."
- "A loose, worn dark-brown motorcycle leather jacket with real wear creases and reflective metal
  zippers, over a washed-out gray T-shirt."
- "A deep black double-breasted suit, extremely slim tailoring, stiff high-end wool blend, with a
  dark red silk tie — meticulous."

### Build, framing, and bearing

`[skeleton/shoulder features] + [composition/shot requirement] + [character action/eyeline] + [overall atmosphere words]`

Drop the middle two terms if the story prompt already covers composition and action.

- "Slim figure, slender shoulders. Close-up composition from the chest up, direct gaze into the
  camera. Overall a gentle, graceful, affectionate classical-romantic temperament."
- "Broad skeleton, thick heavy shoulders. Full-body composition shot from a low camera position,
  standing sideways and glancing back at camera. A hardcore, tragic, epic feeling of survival
  against the odds."
- "Slender and upright. Face in close-up, half hidden in shadow. Mysterious and dangerous — a
  suffocating horror-film-protagonist temperament."

### Objects and props

`[quantifier] + [color] + [shape/design style] + [specific item noun] + [material detail/wear state] + [iconic feature]`

---

## 2. Multi-person scenes

2.5 specifically fixed "twins" (characters converging on one face) and face-swap dislocation, but
only if you bind each person separately.

- One line per character mapping them to their own reference, with `Use only the appearance,
  hairstyle, and clothing.`
- Add: `Do not interchange the characters' appearances, clothing, actions, positions, or dialogue.`
- Bind props to owners: `<Sample Case> corresponds to @Image 5 and belongs only to <Conservator>.`
- Describe interactions and spatial relationships explicitly: "Character A and Character B sit by
  the campfire talking; Character A hands Character B a glass of water."
- Anti-merge line: `Keep each subject as the same continuous instance throughout: do not duplicate
  or split it, and keep the person's appearance or the object's number of parts stable.`

---

## 3. Emotional direction — make it observable

Emotion words ("tense", "warm", "oppressive") set a direction but leave the performance open. For
stable acting, add directly visible or audible cues: eye movement, brow tension, mouth movement,
breathing, gaze direction, hand movement.

**Two to four clear cues is enough** for a single transition. Don't enumerate every facial detail.

### Single emotional transition

```
The overall emotion shifts from <starting emotion> to <ending emotion>.
After <triggering event>, <subject> first shows <immediate observable reaction>.
Then, <eyes, brows, mouth, breathing, gaze, or hand movement> gradually <changes>.
Finally, <subject> expresses <target emotion> through <restrained or explicit outward behavior>.
```

### Multi-stage emotion (progress via triggering events)

```
When <subject> hears or sees <first triggering event>, <first observable reaction>.
When <second triggering event> occurs, <change in expression, gaze, or breathing>.
After confirming <critical information>, the emotion that <subject> tries to restrain or conceal
gradually becomes visible through <observable behavior>.
Finally, <subject's final action, expression, or manner of speaking>.
```

Worked example:

> Applause marking the end of the performance comes from behind the stage. The young actor's fingers
> suddenly stop on the program, the gaze turns slowly toward the curtain, and the shoulders remain
> tense. After confirming that the curtain call is over, the actor exhales softly. The shoulders
> gradually relax, a restrained smile appears, and the eyes slowly well with tears, but the actor
> never turns to leave.

Pairing each physical instruction with a short **"Emotion Analysis"** line — *why* the gesture is
there — measurably tightens the performance. See the 3-module long-video structure in
`task-templates.md` §2.

---

## 4. Cinematography

### Basic camera language (write directly, no explanation needed)

| Type | Supported terms |
|---|---|
| Shot size | extreme wide shot, wide shot, medium shot, close-up, extreme close-up |
| Camera movement | push in, pull out, pan, lateral move, follow shot, orbit, dive, dolly out, tilt up, handheld shake |
| Position / viewpoint | low angle, overhead view, first-person view |

### Popular techniques — and what each one still needs from you

| Technique | Specify |
|---|---|
| One-take shot | The subjects, spaces, and events the continuous camera passes through, in order |
| Dolly zoom | The subject size to preserve; whether background appears to move closer or farther |
| Aerial view | Viewing height, movement direction, the environmental area to reveal |
| FPV | First-person flight/traversal path, speed, turns |
| Bullet time | The action to freeze or slow; the camera's orbit direction |
| Handheld camera | The subject being followed; the amount of shake |
| Bounce speed ramp | Where the action accelerates, decelerates, rebounds; its final resting state |

With several subjects in frame, always state **which** subject the camera follows or orbits, where
the movement starts, and where it ends.

### Uncommon or ambiguous terms

Keep the term, then translate it into an observable change:

`Cinematography term + target subject + visual change + foreground/background relationship + direction or speed`

> Rack focus: shift focus smoothly from the leaves in the foreground to the person in the background.
> The leaves gradually blur while the person's face changes from soft to sharp.

More worked examples:

- **Shallow depth of field:** "keep `<Pastry Chef>`'s eyes and face sharp while the glass jars and
  lights in the background become soft, circular bokeh."
- **Tracking shot:** "move horizontally at the same speed as `<Skateboarder>`, keeping the subject
  sharp while the roadside wall forms horizontal motion blur from right to left."
- **Golden hour:** "warm, low-angle sunlight enters from behind and to the left of `<Hiker>`, casting
  long shadows across the mountain ridge."
- **Natural vignette:** "darken the four corners gradually while keeping the brightness and skin tone
  of `<Pianist>` in the center natural, without a black border."
- **Whip-pan transition:** "at 5 seconds, move the camera rapidly to the left. Cut when the foreground
  bookshelf fully covers the frame, then continue moving left at a similar speed in the next scene."

Aperture, focal length, and shutter values are accepted — but the intended **visible result** reads
clearer than a number.

---

## 5. Realism and base quality

2.5's base generation was rebuilt specifically against plastic skin, matted animal fur, distorted
complex motion, and identity/background jumps at cuts. To actually get that:

- **Skin and hair:** use "native skin texture", "hair root distinct" (pores, real light response,
  fluffy natural fur).
- **Complex motion:** describe it in full — "a martial artist performs a complex backflip in the
  rain, quickly draws a long sword after landing, and the rain slides down the blade." 2.5 handles
  long-tail motion (unusual dance, martial arts, micro-expressions) that earlier models flattened.
- **Cut consistency:** keep the character's base feature description present across shots; that's
  what carries identity through multiple cuts and transitions.
- **Cleanliness:** `pure video, no subtitles, no background music` is genuinely honored in 2.5 (it
  wasn't reliable in 2.0). Use it for empty-shot libraries, commercial work where the sound design
  happens in post, and looping ambient backgrounds.
- **Audio stripping on an existing clip:** "remove background music", "delete BGM, only keep
  character dialogue" — preserves vocals and burned-in original subtitles.

---

## 6. Language and localization

- **Write the prompt in the target language.** 2.5 supports native prompting across languages;
  you don't need to route through English or Chinese.
- **Lock every on-screen text surface**, not just dialogue: main title, product names, per-product
  slogans, subtitles, ending copy, signage, menus, price tags, posters, entrance information.
  Explicitly prohibit other scripts appearing.
- **Dialogue:** write the target-language line inline and reinforce the language before it (§3 of
  SKILL.md). For dubbing conversions, demand lip-sync: "in the output video, the character's lip
  shape must perfectly match the pronunciation of this Indonesian line."
- **Tone reference:** upload clean, noise-free target voice audio and combine with an emotional
  instruction — "Reference @Audio 1, say 'I found you', and maintain a low and suspenseful tone."
  2.5 transfers emotional tension and flow rhythm, not just timbre.

---

## 7. Natural dialogue delivery

**Source:** practitioner field notes, not the official ByteDance guides. Monique Pryce
(@second_bassoon) found these by trial and error on the dialogue-heavy scenes of an AI feature film
about Beethoven (https://x.com/second_bassoon/status/2117307653320007954, 2 Nov 2026). Treat them as
tested-in-practice technique that sits on top of the §3 dialogue syntax in SKILL.md.

**Symptoms this fixes:** lines come out too theatrical, too monotone, or like a practice
read-through ("reading from a teleprompter"), even though the visuals are realistic. The fix is
almost always in how the dialogue is written and *directed* in the prompt, not in the model.

Ranked roughly by impact (3 was the biggest win by far in her tests):

1. **Punctuation is delivery direction.** The model performs the punctuation you write.
   - Comma: a short breath. Period: the thought lands and settles.
   - Ellipsis `...`: hesitation or trailing off. Dash `-`: a cut-off or self-interruption.
   - Question mark lifts the intonation; exclamation marks raise energy, so use them sparingly
     (a stack of them is the fastest route to "theatrical").
   - Avoid run-on sentences inside one `{}`; they flatten into a monotone read.
2. **Short lines with intentional pauses.** Break a long line into two or three short `{}` lines
   and write the pause between them ("a beat", "he pauses", "silence for a moment"). One long
   block reads like a script; short pieces read like thinking out loud.
3. **Bodily actions as punctuation (biggest improvement).** Put a small physical beat *between*
   line fragments: a sniffle, a swallow, a slow exhale through the nose, wetting the lips,
   glancing down, clearing the throat, rubbing the eyes. The beat breaks the cadence the way a
   real person's body does. In her Beethoven clip, sniffles between lines alone made the delivery
   feel natural.
4. **Anchor gestures.** Tie a gesture to the *intent* of the moment so the pause has a reason:
   "he lifts one finger as if to say 'one sec'", "she holds up a hand before he can interrupt",
   "he taps the letter twice before speaking". The gesture anchors the timing of the next line.
5. **Split the generation in two.** Fewer lines per generation means better delivery. If an
   exchange runs long, render it as two shorter clips instead of one, and carry continuity with
   the video-extension or first/last-frame templates in `task-templates.md`. Stupid simple, but it
   works.

**Fit with the rest of the playbook:**

- Physical beats and anchor gestures are micro-beats *inside* a stage, not new primary events, so
  they don't break the one-primary-change-per-stage rule.
- Keep the §3 order: language and accent, then a plain delivery note ("quiet, tired,
  conversational, not performed"), then the speaker and the broken-up lines.
- Pair with the emotion guidance in §3 of this file: observable cues beat abstract labels for
  voice as much as for faces.

**Example (structure only, adapt the language/accent and words):**

```
Dialogue language: American English. The old man speaks quietly and tiredly, conversational, not performed.
He looks down at the letter in his hands. {I read it.}
He sniffs and wipes his nose with the back of his hand. {Twice.}
A slow exhale through his nose. Without looking up, he lifts one finger as if to say "wait."
{I just... didn't think you'd mean it.}
He swallows, then finally meets her eyes.
```
