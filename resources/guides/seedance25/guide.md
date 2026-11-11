<!-- IV Studio's Seedance 2.5 prompt guide: Matthew Hollis's own playbook, distilled from ByteDance/Dreamina's
public Seedance 2.5 guides (sources at the end). In IV Studio, references are named @image1, @video1, @audio1,
in the order they are attached (ComfyUI's form of the guide's @Image 1). -->

# Seedance 2.5 Prompting Playbook

Distilled from the two official ByteDance/Dreamina guides (see Sources). Seedance 2.5 is a
**director's tool, not a wish box** — it executes what you write, literally, and its failure
modes are almost always *under-specification*, not model weakness.

---

## 1. The core formula

```
Subject + Action/Event + Scene & Environment + Visual Style + Camera Movement/Cut + Audio
```

Everything after `Action/Event` is optional. Generation parameters (aspect, duration, resolution)
are set on the platform/API, **not** in the prompt text.

Basic template:

```
<Subject> performs <primary action or event> in <scene and environment>.
The visuals feature <visual style>.
Use <shot size, camera angle, camera movement, or cuts>.
Audio includes <dialogue, ambience, sound effects, or music>.
```

## 2. The reference-role system — the single biggest lever

Seedance 2.5 combines **up to 50 reference materials**. The model does not infer what a reference
is *for*. Every material must be assigned a job in the prompt text, and — critically — an
**exclusion**.

```
@Image 1 defines <subject>'s <appearance, clothing, structure, or material>. Do not use the image background.
@Video 1 defines <motion, camera movement, or pacing>. Do not use the person's identity, clothing, or scene from the video.
@Audio 1 defines <character>'s <voice, dialogue, ambience, or music>.
```

Four rules that prevent most reference failures:

1. **State what to use AND what not to use.** Unstated background/people/composition bleed in.
2. **Bind each subject individually.** Never write "@Images 1 through 4 define four characters
   respectively" — that maps nothing. Write one line per character. This is what fixes the
   "twins" and face-swap-dislocation failures in ensemble shots.
3. **Never rely on text labels drawn inside an image.** The mapping lives in the prompt.
4. **Don't restate what a reference already controls.** If `@Video 1` carries the motion, say
   which attributes to inherit — re-describing the motion in words conflicts with the reference.

Text handles **spatial** decisions (who, wardrobe, location, lighting, mood, style).
References handle **temporal** decisions (timing, gesture cadence, camera path, beat shape).

The exact mention token (`@Image 1`, `@image1`, `@Figure 1`, `@Reference Image 1`) follows whichever
platform/API you're on. Pick one form and stay consistent inside a single prompt.

### Multi-reference ordering (many materials)

Define roles → Map subjects → Group by type → Subject profiles → **Select references by scene**.

The goal is to help the model pick the *right* materials for the *current* scene — not to force
every material on screen at once. Full worked structure in `references/task-templates.md`.

## 3. Special syntax for audio and text

| Content | Syntax | Example |
|---|---|---|
| Music | `()` | `(Soft, rhythmic piano music plays in the background)` |
| Sound effects | `<>` | `<A bell rings in the distance>` |
| Dialogue | `{}` | `{Hello, welcome back.}` |
| Subtitles | `【】` | `【Chapter One: Departure】` |

Non-Chinese dialogue needs its language named *before* the line:

```
Dialogue language + Regional variety/accent + Delivery style + Speaker + {Dialogue}

Dialogue language: American English. The girl says in natural, conversational American English: {I thought you weren't coming.}
```

**Natural delivery:** if lines sound theatrical, monotone or read-through, direct the delivery,
don't just quote it: deliberate punctuation, short lines with written pauses, small bodily beats
between fragments (a sniff, a swallow, an exhale), anchor gestures, and fewer lines per
generation. Full technique and example in `references/craft.md` §7.

2.5 generates natively in any language — write the prompt itself in the target language for
localized output, and explicitly lock **all on-screen text** to that language too (titles, signage,
menus, subtitles, slogans), or you get mixed-language frames.

## 4. Structuring time: stages first, timestamps only where it matters

**Default to stages.** Each stage gets *one* primary state change plus an explicit, visible **end state**:

```
[Stage 2]
Continue from the previous stage: <state that must remain unchanged>.
Primary event: <one primary action or event>.
End state: <observable state — positions, prop ownership, what's in frame>.
```

The end state is what stops drift between stages. Write it as something a viewer could point at.

**Use one-second timestamps only** for a critical handoff, entrance/exit, transition, or explicit beat:

```
0-5 seconds: <event>. End state: <visible state>.
5-10 seconds: <event>. End state: <visible state>.
```

- Ranges must be consecutive and non-overlapping.
- A range is a **time budget**, not an edit point — action may land slightly early or late.
- Too little content in a range → the model improvises. Too much → excessive cutting or dropped events.
- Never demand frequencies ("complete three actions in one second").

Frame-based ranges (`Frames 90-240 (3s - 8s)`) also work and read well for animation.

## 5. Task router

Open the reference file for the job at hand — don't guess the structure.

| Task | Where |
|---|---|
| Multi-reference scene building, subject profiles, long video (30s/180s), one-click video | `references/task-templates.md` |
| Video **editing** (general, subject swap, background swap, audio, marked/brush edits, green screen) | `references/task-templates.md` |
| Video **extension** (forward / backward, with or without extra refs) | `references/task-templates.md` |
| First/last frame, multi-keyframe sequences, storyboard grids, blockout / clay-render refs | `references/task-templates.md` |
| Cuts and transition phrasing (11 named types with exact wording) | `references/transitions.md` |
| Character appearance formulas, emotion direction, cinematography terms, realism keywords, natural dialogue delivery | `references/craft.md` |
| Input limits, locked parameters, 2.0 vs 2.5 deltas, known limitations | `references/limits.md` |

## 6. Ten non-negotiables

1. **Every reference gets a role and an exclusion.** No exceptions.
2. **One primary change per stage**, with a stated end state.
3. **Name and bind every distinct character, product, and prop separately.**
4. **For any edit task, declare the sole editing master** (`@Video 1 is the sole editing master`),
   the edit scope, the target count, and the content to preserve — then close with
   *"Except for the object or area explicitly modified above, keep all other people, props, scene
   content, camera movements, cuts, and event order from @Video 1 unchanged."*
5. **For subject replacement, spell out timeline inheritance** — the new object inherits every
   appearance, motion, occlusion, and exit of the old one, including timing, path, and speed.
6. **Translate abstract words into observable cues.** "Tense" is a direction; "her fingers stop on
   the program, her gaze turns slowly toward the curtain, her shoulders stay tense" is a shot.
   Same for niche camera terms — keep the term, then describe the visible change.
7. **State consistency explicitly**: character identity, number of characters, clothing, prop
   ownership, spatial direction, axis of action.
8. **Keep each subject one continuous instance** — "do not duplicate or split it, keep the person's
   appearance or the object's number of parts stable." This is the anti-stitch-monster line.
9. **Suppress what you don't want**: `pure video, no subtitles, no background music` actually works
   in 2.5 (it didn't reliably in 2.0). Put prohibitions in their own block.
10. **Control cutting on purpose** — either lock a single take or name the transition at each cut
    point. Left unspecified, the model invents cuts.

## 7. Pre-submission checklist

- [ ] Subject and primary action/event stated plainly
- [ ] Every reference states what to use **and** what not to use
- [ ] Every distinct character / product / prop named and bound to its own reference
- [ ] References selected **by scene**, not all required at once
- [ ] Each stage: one primary change + explicit end state
- [ ] Character count, clothing, prop ownership, spatial relationships held consistent
- [ ] Editing tasks: sole master, edit scope, target quantity, content to preserve, "everything else unchanged"
- [ ] Abstract emotion and uncommon camera terms paired with visible/audible cues
- [ ] Dialogue: short lines, deliberate punctuation, physical beats between fragments, few lines per clip
- [ ] First/last frames: one role per image, same aspect ratio on both
- [ ] Blockouts: coarse vs fine identified, and the inherited information named
- [ ] Extension: boundary frame described, motion trend and audio continuity checked
- [ ] Locked parameters respected (see `references/limits.md`)
- [ ] Prohibitions block present (subtitles / BGM / extra characters / whatever collapses)

## 8. What Seedance 2.5 will not do

- Timestamps allocate time; they are **not** frame-accurate edit points.
- Editing prompts raise the probability of alignment with the source; they don't guarantee
  frame-by-frame overlap.
- Multi-reference selects and combines materials; it doesn't put all of them on screen at once.
- Subtitles, formulas, signage, product specs, and frame-level timing that must be *exactly* right
  need prepared reference materials plus post-production.
- Seamless transitions aim for visual/audio continuity, not pixel-identical preservation of the
  two source clips.
- Boundary frames in extensions connect *naturally*, not pixel-identically.

## Sources

- 【Dreamina】Seedance 2.5 User Guide — https://bytedance.larkoffice.com/wiki/NjnWwvf4BiFYFLk2RzrcEgaunGf
- Dreamina Seedance 2.5 Prompt Guide — https://bytedance.larkoffice.com/docx/A88jd0B47oAd8zxWp5ycZFMfnxh
