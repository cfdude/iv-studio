# Seedance 2.5 — inputs, parameters, and limits

---

## 1. Reference material budget

Up to **50 reference materials** combined. Per type:

| Type | Hard limit | Recommended |
|---|---|---|
| Images | Up to 30, each ≤ 4K | 1-8 distinct subjects across subject-reference images |
| Videos | Up to 10, combined ≤ 30s | 1-5 distinct subjects; 5-10s per subject video |
| Audio | Up to 10, combined ≤ 30s | Only dialogue/voice/ambience/music directly relevant to the task |
| Video editing | One source video + reference images | Source < 20s; 1-5 reference images |

Above the recommended ranges the model still works, but stability drops and you'll be re-rolling:
9-12 subjects in subject images, 6-10 subjects in subject audio/video, 6-8 reference images for
video editing.

**Multi-view rule:** with more than five subjects, single-view references are more stable. When you
do need multiple views, put each view in its own image — *multiple images with one view each beats
one image containing several views.*

## 2. Per-file specs

**Images** — jpeg, png, webp, bmp, tiff, gif, heic, heif. Aspect ratio (w/h) in (0.4, 2.5).
Width and height 300-6000 px. Single file < 30 MB; request body ≤ 64 MB. Don't base64-encode large files.

**Video** — mp4, mov. Resolution 480p-4K. Aspect ratio [0.4, 2.5]. Width/height 300-6000 px.
Total pixel count in [640×640 = 409,600 , 3326×2494 = 8,295,044]. Single file ≤ 200 MB. FPS [24, 60].
Single clip duration [2, 30]s (actual tolerance [1.8, 30.2]s); all videos combined ≤ 30s (30.2s tolerance).

**Audio** — wav, mp3. Single file ≤ 15 MB; request body ≤ 64 MB.
Single clip [2, 30]s (tolerance [1.8, 30.2]s); all audio combined ≤ 30s.

## 3. Generation parameters

- **Duration:** `-1` or [4, 30] seconds — i.e. 97-721 frames.
- **Long Video mode:** a dedicated "Super Long Video" mode generates 30-180 seconds in a single
  pass, no stitching. Select the mode, then the duration (up to 180s), then write the script.
- **Resolution:** 480p, 720p.
- **Video extension:** a single generation extends up to 30s; repeated ("nesting doll") extensions
  accumulate to roughly 60s total. Each extension node accepts a new prompt, so you can direct
  stage by stage.

## 4. Auto-locked parameters

| Task | Aspect ratio | Duration |
|---|---|---|
| Video editing | Preserves the input video's — cannot be set | Preserves the input's, approximately — cannot be set. Frame handling can drift up to ~0.3s |
| First-frame / first-and-last-frame | Uses the **first** image's. First and last images should share an aspect ratio or the last frame stretches | Settable |
| Video extension | Preserves the input video's — cannot be set | Settable. The extended segment's volume may differ slightly from the source |

Locked parameters can't be overridden on the generation page or through the API.

## 5. 2.0 → 2.5 deltas worth knowing

| | 2.0 | 2.5 |
|---|---|---|
| Images per request | 0-9 | up to 30 |
| Videos | up to 3, ≤ 15s total, each [2,15]s | up to 10, ≤ 30s total, each [2,30]s |
| Audio | up to 3, ≤ 15s total | up to 10, ≤ 30s total |
| Audio-only input | Not supported — must pass at least one image or video | Supported |
| Duration | `-1` or [4, 15] (97-361 frames) | `-1` or [4, 30] (97-721 frames), plus 30-180s long-video mode |
| Timestamps | Convey event *order* only | Native second-level interval control |
| "No subtitles / no BGM" | Frequently ignored | Honored |

Other 2.5 additions: partial elimination and marked editing, spatial/perspective modification with
off-screen completion, BGM separation, idea/style transfer from reference video, upgraded tone
reference, multi-person disambiguation, green-screen editing, blockout (clay-render) control,
seamless transition between two clips, multi-grid storyboard input.

## 6. Documented limitations

- Timestamps allocate time budgets to events; they are **not** frame-accurate edit points.
- Editing prompts raise the probability that critical events align with the source; they cannot
  guarantee frame-by-frame overlap.
- Multi-reference creation selects and combines the correct materials — it does not put every
  material on screen simultaneously.
- Subtitles, formulas, signage, product specifications, and frame-level timing that must be
  completely accurate require prepared reference materials plus post-production.
- Seamless transitions target visual and audio continuity; they do not guarantee pixel-identical
  preservation of the two source clips.
- Extension boundary frames connect naturally at a visual level — not pixel-identically. Review both
  sides of the boundary and the full extended segment.
- For one-click video, if image order or character mapping matters, it must be stated explicitly.
