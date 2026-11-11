# Seedance 2.5 — fill-in templates by task

Every template below is from the official guides. Replace `<angle brackets>`, keep the block
structure — the bracketed section headers (`[Edit Goal]`, `[Stage 1]`) are part of what makes
these work.

---

## 1. Multi-reference creation (many materials, one coherent piece)

Order: **Define roles → Map subjects → Group by type → Subject profiles → Select by scene.**

### Step 1 — name and map each subject individually

```
<Character A> corresponds to @Image 1. Use only the appearance, hairstyle, and clothing.
<Character B> corresponds to @Image 2. Use only the appearance, hairstyle, and clothing.
<Prop A> corresponds to @Image 3. Use only the structure, material, and color.
<Scene A> references @Image 4. Use only the spatial layout, architecture, and lighting. Do not use the people in the image.
```

Never write "@Images 1 through 4 define four characters respectively" — it maps nothing.

### Step 2 — group by type

```
[Characters]
<Conservator> corresponds to @Image 1. Use only the appearance, hairstyle, and clothing.
<Registrar> corresponds to @Image 2. Use only the appearance, hairstyle, and clothing.
Do not interchange the characters' appearances, clothing, actions, positions, or dialogue.

[Props]
<Sample Case> corresponds to @Image 5 and belongs only to <Conservator>.
<Record Board> corresponds to @Image 6 and belongs only to <Registrar>.

[Scenes]
<Conservation Lab> references @Image 7. Use only the space, materials, and lighting.
<Gallery> references @Image 8. Use only the space, materials, and lighting.

[Motion and Audio]
@Video 1 defines the motion of <Conservator> opening <Sample Case>. Do not use the person or scene from the video.
@Audio 1 defines <Guide>'s voice and specified dialogue.
```

### Step 3 — subject profile (a character spanning several scenes/refs)

```
[Subject Profile: Conservator]
Appearance and clothing: @Image 1.
Fixed prop: <Sample Case> from @Image 5.
Locations: <Conservation Lab> and <Gallery>.
Motion references: the case-opening motion from @Video 1 and the sample-placement motion from @Video 2.
Do not use: other characters' clothing. Do not give this character <Record Board> or guide equipment.
```

### Step 4 — select references per scene

```
Scene 1 | Inspection in the Conservation Lab
Use: <Conservator>, <Sample Case>, <Conservation Lab>, and the case-opening motion from @Video 1.
Event: <Conservator> opens <Sample Case> at the workbench and inspects the sample inside.
End state: <Conservator> remains on the inner side of the workbench. <Sample Case> stays beside the
conservator's right hand, on the left side of the frame.
```

### Multiple views of one object

```
@Image 1 defines the front view of the same folding desk lamp.
@Image 2 defines the left-side structure of the same folding desk lamp.
@Image 3 defines the right-side structure of the same folding desk lamp.
All three images define one folding desk lamp. The output must contain only one lamp throughout.
```

Separate images per view beat one collage image containing several views. Above ~5 subjects,
single-view references are more stable.

---

## 2. Long video (30s native, up to 180s in Super Long Video mode)

### Stage template

```
[Generation Goal]
Generate a <video type>. The central subject is <subject>, and the primary event is <story summary>.

[Stage 1]
Initial state: <initial state of characters, props, and scene>.
Primary event: <one primary action or event>.
End state: <character positions, prop ownership, or visible scene state>.

[Stage 2]
Continue from the previous stage: <state that must remain unchanged>.
Primary event: <one primary action or event>.
End state: <observable state>.

[Stage 3]
Primary event: <closing event>.
End state: <final visible state>.

[Maintain Consistency]
Keep <character identity, number of characters, clothing, prop ownership, spatial direction, and
audio relationships> consistent.
```

### The 3-module long-video structure (Dreamina house method)

Open with **one sentence describing the tone of the whole video** ("29 seconds, one shot,
ancient-costume woman bids farewell by the river"), then:

**Module 1 — Reference layer**

```
Based on the uploaded [reference material type], strictly keep [...] consistent, strictly lock [...].

e.g. Based on the uploaded images, strictly maintain the consistency of the character's face and
features in @Image 1, maintain the consistency of the composition and spatial relationships in
@Image 2, and strictly lock the character's position.
```

Skip if no references. You may @-mention the same material repeatedly through the prompt — it
increases accuracy.

**Module 2 — Global settings (worldview + anti-collapse)**

Formula: `[Base environment & texture] + [Visual style] + [Camera language] + [Character styling]
+ [Performance core] + [Prohibitions]`

```
[Global Scene Setting]
Base Environment: <time> + <place> + <atmosphere> + <emphasize ultimate real physical texture>.
Visual Style: <cinematic / realistic / 2D etc.> + <depth control> + <lighting method>.
Camera Language: <shot size / perspective> + <detailed description>.

[Character Styling]
<see references/craft.md for the appearance sub-formulas, or @-reference and describe the image>

[Core Performance]
<the 2-4 things the finished film must land — shifting gaze, breathing, lip tremble, throat swallow>

[Negative Prompts / Restrictions]
<sound> + <subtitles> + <behavior> + <the places this premise tends to collapse>
e.g. No exaggerated crying, no fast cuts, no large body movements, no extra dialogue or BGM,
no subtitles.
```

**Module 3 — Timestamp script storyboard**

```
[Emotion and Action Storyboard (0-29 Seconds Progression)]

Stage 1: 0-3s [Questioning] — Reluctant Waiting
Action/Expression: <scene> + <composition> + <character detail action>. …
Emotion Analysis: <why — what the physical instruction is expressing>

Stage 2: 3-10s [Resignation] — Swallowing the Bitterness
Action/Expression: …
Emotion Analysis: …
```

Per-slice formula: `[start-end seconds] + [core phase/theme]` then
`[action/expression + physical-level instruction]` then `[emotional analysis or camera scheduling]`.
The "emotion analysis" line is not decoration — it tells the model what the physical instruction is
*for*, and it measurably tightens performance.

For a cut long-video, add transition instructions at each cut point (`references/transitions.md`).

---

## 3. Video editing

Aspect ratio and (approximate) duration are auto-locked from the source. Up to ~0.3s drift.

### General edit

```
[Edit Goal]
Edit @Video 1. Within <the entire video or a specific time range>, <add / remove / replace / adjust>
<visual object, region, or audio category>.

[Source Video Role]
@Video 1 is the sole editing master. It defines <characters, scene, actions, composition, camera
movement, occlusion relationships, audio, and event order>.

[Target Material Role]
@Image 1 or @Audio 1 defines <specified attributes of the target object or sound>.

[Edit Scope]
Modify only <object, region, time range, or audio category>.

[Content to Preserve]
Keep <visual content, motion, audio, and timing relationships that must not change> from @Video 1.
```

### Subject replacement

```
[Edit Goal]
Edit @Video 1. Change only <original object> to <target object>.

[Source Video Role]
@Video 1 is the sole editing master. It defines the original scene, camera position, camera
movement, motion path, occlusion relationships, and event order.

[Target Reference Role]
@Image 1 defines <target object>'s <appearance, structure, or material>. Do not use <irrelevant
background, people, or composition>.

[Edit Scope]
Modify only <specific object and area>. The entire video contains <number> target object(s).
Do not modify <content to preserve>.

[Timeline Inheritance]
<Target object> inherits every appearance, motion, occlusion, and exit of <original object>,
including timing, duration, path, and speed changes.
Except for the object or area explicitly modified above, keep all other people, props, scene
content, camera movements, cuts, and event order from @Video 1 unchanged.
```

The target-count line ("the entire video contains exactly one white folding desk lamp") is what
stops duplicate objects appearing.

### Background replacement

```
[Edit Scope]
Modify only <background outside the subject's silhouette>. Do not modify <subject identity, facial
features, hairstyle, clothing, expression, position, size, or motion>.

[Target Reference Role]
@Image 1 defines only <target environment>'s spatial layout, materials, depth of field, ambient
color, and lighting direction. Do not use the people or foreground objects in the image.
```

### Audio editing

State the speaker or sound category, the change, and what must stay.

```
Edit @Video 1. Remove only the original background music. Keep the character dialogue, lip sync,
ambience, and action sound effects; preserve the visuals, camera treatment, and editing rhythm
from @Video 1.

Edit @Video 1. Change <Presenter>'s spoken language to natural American English while preserving
the dialogue content and speaking times. Keep all other character voices, background music,
ambience, and visuals from @Video 1.
```

### Smart Edit / Edit-with-marks / Edit Video (brush + box selection UI)

Plain edit formula:
`[Specific modification object / what] + [Action and change description] + [Effective time sequence]`

Marked edit formula adds a positioning term up front:
`[Annotation tool and orientation] + [Specific modification object] + [Action and change] + [Effective timing]`

- **Annotation tool and orientation** — name the tool and whether to act inside or outside it:
  "within the red box", "the area the red arrow points to", "left of the red line", "at the landmark
  point". Tools: boxes, lines, arrows, text, landmarks in different colors, plus an eraser.
- **Object** — "the boy's jeans", "the dead tree in the background", "the coffee cup in her hand".
- **Change** — "replace with dark black suit pants", "turn it into a blooming cherry tree",
  "eliminate and complete the background without leaving a trace".
- **Effective timing** — "the entire 15-second film, uniformly, for consistency", "only between
  0:05 and 0:08", "gradually appearing from second 3".

Required verbs: *Edit the xx in the video / Add / Delete / Remove / Modify / Replace / Change to.*
Write the A→B change and *how* it changes, with timestamps.

Worked examples:

```
Modify everything entirely from 0 to 8 seconds of the overall video. Change the whale in the video
to a white dragon. Remove the BGM.

Replace the sheep inside the red box with a brown horse. Keep the motion trajectory consistent with
the original. Only during seconds 7-15 of the video.
```

### Green screen editing

Upload a green-screen source and describe the replacement environment, or supply it as a reference.

```
Composite the weather of @Image 1 into @Video 1 with natural angle changes. When the camera tilts
down to the city road surface, composite the zombies of @Video 2 onto the road surface, just passing
by the camera. The weather is half cloudy and half sunny, with a little sunlight piercing the dark
clouds, forming a weird sense of unreality.
```

### Space / perspective modification

2.5 can re-derive the 3D layout and re-shoot it, filling in off-screen detail.

```
Replace the multi-camera switching shots in @Video 1 with a fixed frontal shot, and keep the
characters and background unchanged.

Change the head-up shot to a high-altitude shot, with the camera slowly pushing downward.

Change the third-person perspective of @Video 1 to first-person, with the character moving through
the forest.
```

---

## 4. Video extension

Locks the source aspect ratio; extension duration is settable. Single generation extends to 30s;
repeated "nesting doll" extensions accumulate up to ~60s.

### Forward (after the original)

```
@Video 1 is the source video to extend forward.

Extend @Video 1 forward. The first frame of the extended segment directly continues from the last
frame of @Video 1. Maintain continuity in <subject pose and orientation>, <prop position>,
<background and spatial relationships>, <camera position and composition>, <lighting>, and
<motion direction>.

Then, <describe the new action, event, camera treatment, or audio to add>.

Throughout the extension, maintain continuity in <character identity and clothing>, <key props>,
<background layout>, and <axis of action>.
Keep each subject as the same continuous instance throughout: do not duplicate or split it, and keep
the person's appearance or the object's number of parts stable.
```

Add `hard cuts are prohibited, objects appearing out of thin air are prohibited` when the join must
be invisible.

### Backward (before the original)

Describe the new content **first**, then define the source's first frame as the explicit end state.
Writing only "then connect to the source video" lets later characters appear too early, or lets the
image keep changing after it has reached the target.

```
@Video 1 is the source video to extend backward.

Extend @Video 1 backward. Before the source video begins, <describe the preceding action, event,
camera treatment, or audio>.

The last frame of the extended segment naturally connects to the first frame of @Video 1:
<subject pose and orientation>, <prop position>, and <background and spatial relationships>.
Match the <camera position and composition>, <lighting>, and <motion direction> of @Video 1's first frame.

Throughout the extension, maintain continuity in <character identity and clothing>, <key props>,
<background layout>, and <axis of action>.
<Materials that should appear only after the source video begins> must not appear early in the
backward extension.
```

### With extra references

Define every added material's role first, then state that the **source video controls the boundary**.
New materials may supplement characters, props, or audio but must not override the source's
last-frame (or first-frame) control of the join.

---

## 5. First/last frames and keyframes

No separate mode needed — declare it on line one in multimodal reference mode. Aspect ratio locks to
the **first** image; duration is settable. First and last images should share an aspect ratio or the
last frame stretches.

```
@Image 1 is the first frame. It defines the opening composition, subject position, pose, prop state,
scene, and camera direction.
@Image 2 is the last frame. It defines the ending composition, subject position, pose, prop state,
scene, and camera direction.
@Image 3 defines <Subject A>'s <appearance, clothing, structure, or material>. Do not change the
first-frame composition defined by @Image 1 or the last-frame composition defined by @Image 2.

<Describe one continuous action or event>.
The video begins naturally from the first frame defined by @Image 1 and reaches the last frame
defined by @Image 2 after the continuous action.
Between the first and last frames, maintain continuity in <character identity, prop structure and
ownership, scene layout, and camera direction>.
```

Describe each anchor image separately. Never "@Images 1 and 2 are the first and last frames."

### Multi-keyframe sequence

```
Use @Image 1 through @Image N as keyframes in this order.

@Image 1 is the first frame. It defines <opening composition, subject position, pose, prop state, camera direction>.
@Image 2 defines the second keyframe: <visible end state of Stage 1>.
@Image 3 defines the third keyframe: <visible end state of Stage 2>.
@Image N is the last frame. It defines <ending composition, subject position, pose, prop state, camera direction>.

The video passes through the states defined by @Image 1, @Image 2, @Image 3, and @Image N in order,
using continuous action to transition naturally between stages.
Maintain continuity in <subject identity, prop structure and ownership, scene layout, lighting, and
axis of action> throughout.
```

Keyframes control **stage order and key states** — they do not reproduce every frame exactly.
Independent images align better than several frames combined into one grid.

---

## 6. Storyboard grids

Communicates story, shot order, and approximate composition — not strict per-panel reproduction.
Prefer **≤15 panels**, clean line art or stick figures, minimal text labels.

```
@Image 1 provides an <N-panel storyboard grid> for shot order and approximate composition.
Read it <left to right, top to bottom>. Do not use the grid's <line-art style, text labels, or
placeholder characters>.
@Image 2 defines <Subject A>'s <appearance and clothing>.
@Image 3 defines <key prop or scene>'s <structure, material, or lighting>.

Shot 1: <shot size, subject action, and scene state>.
Shot 2: <shot size, subject action, camera movement, or transition>.
...
Shot N: <closing action and final visible state>.

The final video uses <visual style>. Audio includes <dialogue, ambience, action sound effects, or music>.
```

Write order: (a) what the storyboard *is* — shots, not characters/scenes; (b) the main setting and
each referenced character/animal/object in detail; (c) shot-by-shot description locking composition,
shot size, camera movement, action; (d) global style and prohibitions.

---

## 7. Blockout / white-model (clay render) references

Decide first whether the blockout controls a **motion skeleton** (coarse) or a **complete model**
(fine). Different structures.

| | Coarse | Fine |
|---|---|---|
| What it is | Simple geometry (spheres, cylinders, blocks) standing in for people/objects | Complete modeling with clear material and structure |
| Provides | Motion trajectory, camera movement, blocking, light/shadow changes, cut points, sound rhythm | Structure, action, spatial layout, camera — for re-rendering materials/style |
| Use when | Generating a new video from scratch; the blockout is only a dynamic skeleton | Scene is fully modeled and only needs materials/lighting/style |
| Prep | Clear shape relationships, complete action sequence | Clean model — strip path lines, coordinate axes, controllers, camera frustums |

**Coarse formula:** `[Reference statement] + [Correspondence mapping] + [Plot details] + [Scene handling] + [Overall convergence]`

```
@Video 1 is a coarse blockout reference. It provides only <motion paths, subject blocking, camera
position, camera movement, cuts, lighting changes, sound rhythm, or spatial relationships>. Do not
use its blockout appearance, materials, or scene.
The <tall cylinder> in @Video 1 corresponds to <Subject A>.
The <rectangular block> in @Video 1 corresponds to <key prop>.
@Image 1 defines <Subject A>'s <appearance, clothing, or structure>.

<Subject> completes <primary action or event> in <scene>.
Keep <motion path, blocking, camera movement, cuts, lighting, or sound rhythm> from @Video 1.
The final video uses <characters, scene, materials, and visual style>. Audio includes <dialogue,
ambience, or action sound effects>.
```

> If a coarse model has limbs or wings, you must write the **complete** limb action sequence or the
> motion goes stiff. Best practice: don't upload limbed/winged coarse models at all.

**Fine formula:** `[Render command] + [Segmented render description] + [Scene handling] + [Overall convergence]`

```
@Video 1 is a fine blockout reference. Preserve <subject structure, action, spatial layout, camera
position, camera movement, and cuts>. Do not use its original gray materials or empty background.
@Image 1 defines <subject>'s <character appearance, material, color, or surface details>.
@Image 2 defines <scene>'s <space, materials, lighting, or visual style>.

Render the white model animation of @Video 1 into the final film.
0-<N>s: <background environment, tone, character material, light and shadow effects>.
<N>s <transition trigger point and method>: <render description of the new scene after transition>.

[Scene Processing] <single scene, framing, physical continuity of the environment>
[Overall Convergence] <whether new scene environment and character rendering stay unchanged>;
character rendering <remains unchanged / changes with the scene>. <Audio processing>.
```

When passing a fine blockout, also state that the reference video's interference information
(trajectory lines, coordinate lines, camera cones) must not appear.

---

## 8. One-click video (images → finished cut)

Order: **Material roles → Image order → Motion amount → Editing style → Visual treatment → Audio.**
Never just "turn these materials into a video."

```
[Material Roles]
@Image 1 is used for <character, product, scene, or opening image>.
@Image 2 is used for <…process image>.
@Image 3 is used for <…ending image>.
@Video 1 is used only for <editing rhythm, transitions, subtitle treatment, or music style>.
Do not use its character identities or scene. (optional)

[Arrangement]
Show the images in <upload order / a specified order / a model-selected thematic order>.
<State the character, product, location, and event relationships that must remain consistent>.

[Image Motion]
Apply <subtle live motion, parallax, push-in/pull-out, lateral movement, or local action> to each image.
Keep <subject appearance, product structure, text, or background relationships> stable.

[Final Style]
Use <editing rhythm, transition style, subtitle or graphic treatment, and color style>.

[Audio]
Include <dialogue, ambience, sound effects, or music>.
```

If order matters, state the exact sequence. If it doesn't, say the model may organize by theme.
Multiple characters/products still need individual naming and binding.

---

## 9. Seamless transition between two videos

Order: **Before video → After video → Trigger action → Camera movement → Visual transformation →
Arrival state → Audio.**

```
@Video 1 is the before-transition clip. Use its <ending subject, action, composition, camera
direction, and audio>.
@Video 2 is the after-transition clip. Use its <opening subject, composition, camera direction, and audio>.
Keep <character identity, product structure, scene, and primary action> stable in the original
portions of @Video 1 and @Video 2. Do not modify @Video 1 or @Video 2.

At the end of @Video 1, <subject or foreground object> triggers the transition through <action>.
The camera <movement direction and speed change>, while <shape, material, light, or space> gradually
transforms into <corresponding element> at the start of @Video 2.
The transition ends naturally at @Video 2's opening composition, preserving continuity in <subject
position, camera direction, and motion trend>.
Audio transitions smoothly from <before audio> to <after audio>.
```

What to specify per method:

| Method | Specify |
|---|---|
| Dive / reverse movement | Camera direction, speed change, when the next scene begins |
| Character rotation | Pose, rotation direction, how clothing/background changes continuously |
| Foreground occlusion | When the foreground fills the frame, and the composition that follows |
| Object morph | Corresponding shapes, materials, and the transformation process |
| Push/pull or focus change | Camera movement, focus target, continuous spatial relationship |
