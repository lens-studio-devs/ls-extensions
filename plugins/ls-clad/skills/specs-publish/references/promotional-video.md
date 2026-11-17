<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Promotional video (automatic, after submit)

Build a shareable promotional clip automatically whenever the confirmed publish plan has a usable
local preview video: a **title cover frame** (a `SPECS` wordmark top-left, plus Lens name + description, and the Lens icon when
available) held for **2 seconds**, then the **preview video appended**, with an optional
user-supplied music track.

This is a **local deliverable, not store preview media.** It is not uploaded and is not subject to
the store's 3:4 / 15–30 s / ≤100 MB preview rules—the cover extends the preview video's duration by
design. It matches the preview video's dimensions and fps, and its path is reported only after the
release has been successfully submitted.

## Build it after submission through the session

Do not ask whether to generate the promotional video, and do not spawn a subagent for it. The healthy
publish path invokes `publish-session.py complete` immediately after Submit returns `submitted`.
That terminal operation builds or skips the artifact and cleans the publish session in one call. It
calls the deterministic driver below; the model does not resolve music, stage an output directory,
reconstruct inputs, invoke component scripts, or issue a separate cleanup call.

**This replaces an earlier parallel-subagent design, on measurement.** On a real 559 s publish the
whole promotional step cost **13 s — 2.3% of the run** — and only ~1.5 s of that was work: the build
script measures 1.2–1.6 s across three runs and the music finder 0.3 s. The rest was the single round
trip that issued the call. A spawn and a join each cost a model turn (~21 s measured), so wrapping
1.5 s of work in them lengthens the critical path instead of shortening it: the parent cannot emit
its final response until the join returns. The parallel design assumed an expensive build. It is not
expensive.

Both properties that design existed for still hold without it:

- **It cannot block submission**, because it runs strictly after `submitted`.
- **It cannot crowd the parent's context**, because the script returns one JSON line.

Rules:

1. Require a usable local preview video from this run — the staged `generatedPreviewMediaPath` or a
   user-supplied preview video. Never ask the user to capture one solely for this deliverable. With
   no local video, set `promotionalVideoStatus = "not_created_no_local_video"` and report only that,
   in the final response.
2. **Never build before Submit returns `submitted`** — not before Package, not between phases. If
   submission does not succeed, do not build it, clean up any output, and do not announce a
   deliverable. This is the one ordering rule that matters, and it is what makes the build
   structurally incapable of delaying a publish.
3. Build it in one session call. The driver resolves music per Music sourcing, then runs the pinned
   renderer once with `COVER_SECONDS=2`.
4. Add no progress task and no generation label. The artifact is reported only in the final response,
   per Output handling.

## Preconditions

- **A local preview video must exist.** A cover plus a still image is out of scope.
- **macOS only** + **ffmpeg + swift** (the title cover renders via CoreText). On a non-macOS host,
  do not build it; set `promotionalVideoStatus = "not_created_unsupported_os"` and report that
  concise reason only in the successful final response.

## Music sourcing

This flow never generates music and never asks for it. Resolve `promotionalVideoMusicPath` in this order:

1. If the original publish request supplied a promotional-video music file, pass it as `MUSIC_PATH`
   and set `promotionalVideoMusicSource = "request"`.
2. Otherwise run `scripts/promotional/find-promotional-music.py --project "<projectPath>"`. On `MUSIC_FOUND`,
   pass its `path` as `MUSIC_PATH` and set `promotionalVideoMusicSource = "project_asset"` — this is
   the Lens's own music bed, so the promotional video sounds like the Lens does in Preview.
3. On `NO_MUSIC`, omit `MUSIC_PATH`, set `promotionalVideoMusicSource = "none"`, and accept a silent
   video. Report that only in the final response, per Output handling.

`NO_MUSIC` is a normal outcome, never an error: the promotional video is a local convenience
artifact that is never uploaded, so a silent one is acceptable and no question is asked either way.
The finder exits 0 on every unsuitable outcome, including a missing ffprobe.

**Never run `/build-music` during a publish.** It is a good source — offline algorithmic synthesis,
nothing sampled, 44.1 kHz stereo, and its own acoustic gate rejects anything below −30 dB, so a
generated bed always clears this finder's threshold. But it writes into
`<PROJECT_ROOT>/Assets/GeneratedSFX/` and `<PROJECT_ROOT>/tempAssetGen/`, and the promotional build
must not mutate the project. Publishing a Lens must not deposit a multi-megabyte asset that then
becomes the permanent default bed for every later promotional video. Generating it is the user's
explicit action, taken once, outside a publish.

**The preview video cannot supply the audio.** Lens Studio's native "Record Video" wires its audio
track to the microphone input, not to the Lens's audio output, so a Lens's own music never reaches
the recording — measured at the 16-bit noise floor on a Lens whose bed was playing. A project audio
asset is therefore the only route to a promotional video that sounds like the Lens. See the silent-capture
section of `references/preview-video-capture.md` for the mechanism and why `-an` must stay.

## Deterministic driver contract

The session normally derives all of these arguments from retained publish state and invokes:

```bash
python3 "<skill-dir>/scripts/promotional/build-promotional-video.py" \
  --preview-video "<preview video from this run>" \
  --project "<projectPath>" \
  --lens-name "<lensName>" \
  --lens-description "<releaseDescription>" \
  --icon "<selected Lens icon PNG>" \
  --cleanup-generated-preview
```

`--music <supplied audio>` is included only when the original publish request supplied it. Optional
arguments are omitted when unavailable. The driver validates inputs, resolves project music with
`find-promotional-music.py`, stages the output in a fresh temp directory, and invokes the renderer
with the equivalent environment:

```bash
PREVIEW_VIDEO_PATH="<preview video from this run>" \
LENS_NAME="<lensName>" \
LENS_DESCRIPTION="<releaseDescription>" \
OUTPUT_PATH="<tempDir>/promotional-video.mp4" \
COVER_SECONDS=2 \
MUSIC_PATH="<supplied audio, else the finder's path — omit when neither>" \
ICON_PATH="<selected Lens icon PNG — omit if unavailable>" \
bash "<skill-dir>/scripts/promotional/build-promotional-video.sh"
```

That lower-level command documents implementation behavior; it is not a second orchestration step.
`ICON_PATH` is the same icon used for the release when locally available. The renderer produces a
text-only cover otherwise. It uses `scripts/promotional/render-cover.swift` (CoreText—no ffmpeg
`drawtext` dependency), concatenates cover + preview at a common size/fps, and muxes music when
supplied.

Branch on the returned JSON:

- **`PROMOTIONAL_VIDEO_READY`** → retain the `path`, `durationSeconds`, and whether it has music.
  After successful submission, report the absolute path and render the video inline when supported.
  Do not upload it anywhere.
- **`ACTION_REQUIRED`** (`ffmpeg_missing`, `unsupported_os`) → do not ask the user or install
  anything. Return the reason to the parent as a non-fatal promotional-video outcome.
- **`FAILED`** (including `music_mux_failed`) → record `reason` + `message`; this is non-fatal and,
  because the build runs after submit, cannot interrupt publishing.

## Output handling

The artifact remains in the build's temp directory so the user can move or share it. State
declaratively in the final success response that it sits in a temporary directory and can be moved
somewhere permanent, such as `~/Downloads` — the temp location is the reason to mention moving it at
all, so say that rather than just naming a destination.

A POSIX home path is always correct here: the promotional video only ever exists on macOS, per the
macOS-only gate above, and the final response mentions a destination only when a video was actually
produced. A Windows run takes the `not_created_unsupported_os` branch and never sees it.

**Do not ask where to put it.** The absolute path is already in the message, moving a file is one
command the user can run better than this flow can, nothing downstream depends on the answer, and it
would arrive after an irreversible submission has already succeeded. This flow stops for exactly one
question — the consolidated confirmation — and a convenience artifact does not get to add a second.

The deterministic driver cleans recorder/config/frame intermediates when the session marks the
preview as generated. It never deletes the exact generated preview video already rendered to the
user: that file belongs to `retainedPreviewMediaPaths` and must stay at the same absolute path so
the task's earlier attachment remains viewable. It never recursively removes a directory containing
a retained path and never deletes a user-supplied preview video.

**When the video came out silent** (`hasMusic: false`, i.e. `promotionalVideoMusicSource = "none"`),
add at most one sentence to that same final message: `/build-music` can generate a license-clean bed
into `Assets/GeneratedSFX/`, and later publishes pick it up with no further setup. This is the
final-response line, not build output, and it is a statement rather than a question — the user is not asked
whether to generate anything, then or ever. Say nothing about music when the video has some.

## State this reference owns

- `promotionalVideoMusicPath`: the music file for the promotional video — the one the publish request supplied, or the project's own bed as resolved by `find-promotional-music.py`. This flow never asks for music and never generates it; see Music sourcing for why `/build-music` is the user's own action rather than a publish step.
- `promotionalVideoMusicSource`: `request`, `project_asset`, or `none`, per the resolution order in Music sourcing. Reported with the artifact in the final response so the user can see which audio was used.
- `promotionalVideoStatus`, `promotionalVideoResult`: the outcome and the build's own result. `promotionalVideoStatus` is `created`, `not_created_no_local_video`, `not_created_unsupported_os`, or `not_created_build_failed`. Both are user-visible only in the final response, after Submit returns `submitted`. There is no launch state and no agent id: nothing is spawned, and Package is never gated on a promotional decision.
