<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Marketing video (post-submit, optional)

After a release is **successfully submitted**, optionally build a shareable marketing clip:
a **title cover frame** (Lens name + description, and the Lens icon when available) held briefly
(1.5 s default), then the **preview video appended**, with an optional **music track**. Read this file
only when the user opts in — it is never part of the publish critical path.

This is a **local deliverable, not store preview media.** It is not uploaded and not subject to the
store's 3:4 / ≤30 s / ≤100 MB preview rules — the cover pushes total length past the preview video's
own duration by design. It matches the preview video's dimensions and fps, and its path is reported
to the user.

The whole build runs under the single `Generating marketing video…` label. Cover render, concat,
and mux emit no additional labels.

## Offer (only after `submitted`)

Once Submit returns `submitted` and the success is reported, ask exactly one blocking question
(number the options per **Number every user choice**):

> Publish succeeded. Generate a marketing video (title cover + the preview video)? It has no music
> by default — you can supply your own track.
>
> 1. Yes — no music
> 2. Yes — with my own music file
> 3. No thanks

On **3** (or if no human can answer in a non-interactive run), skip silently — the submit already
succeeded; do not block. On **2**, ask once for the audio file path. **Do not generate music** — the
only ways to add audio are a user-supplied file (option 2) or none; never invoke `build-music` or
synthesize a track here.

## Preconditions

- **A preview video must exist.** Reuse the video from this run: the staged `generatedPreviewMediaPath`
  (the auto_video temp directory is deliberately retained through this decision) or a user-supplied preview video. If this run used only a preview *image* (no
  video), tell the user and offer to capture one now via `references/preview-video-capture.md`; if
  they decline, skip the marketing video (a cover + still image is out of scope for v1).
- **macOS only** + **ffmpeg + swift** (the title cover renders via CoreText). The script preflights these; on a non-macOS host it returns `ACTION_REQUIRED` / `unsupported_os` — skip the marketing video entirely and go straight to the Final response (the release is already submitted).

## Music sourcing

Music is **never generated** — the default is no music, with a user-supplied track as the only
audio option:

- **No music (option 1, default):** omit `MUSIC_PATH`; the output is silent. (v1 does not carry the
  preview video's own audio track through the cover concat.)
- **User file (option 2):** pass the supplied audio path as `MUSIC_PATH`. The script loops/trims it
  to the total duration and fades it out over the last second.

## Build

Stage the output in a fresh temp dir, then run the pinned script (emit `Generating marketing video…`
once, immediately before this call):

```bash
PREVIEW_VIDEO_PATH="<preview video from this run>" \
LENS_NAME="<lensName>" \
LENS_DESCRIPTION="<releaseDescription>" \
OUTPUT_PATH="<tempDir>/marketing-video.mp4" \
COVER_SECONDS=1.5 \
MUSIC_PATH="<music wav — omit for no music>" \
ICON_PATH="<selected/staged Lens icon PNG — omit if none>" \
bash "<skill-dir>/scripts/build-marketing-video.sh"
```

`ICON_PATH` should be the same icon used for the release when locally available (`lensIconDisplayPath`);
omit it for a text-only cover. The script renders the cover with `scripts/render-cover.swift`
(CoreText — no ffmpeg `drawtext` dependency, which is absent from many ffmpeg builds), concatenates
cover + preview normalized to a common size/fps, and muxes music when given.

Branch on the JSON `status`:

- **`MARKETING_VIDEO_READY`** → report the `path`, `durationSeconds`, and whether it has music. Render
  it inline for the user when the runtime supports local video. Do not upload it anywhere.
- **`ACTION_REQUIRED`** (`ffmpeg_missing`) → `brew install ffmpeg`, then retry once.
- **`FAILED`** (including `music_mux_failed` for an unreadable, corrupt, or unsupported user audio file) → surface `reason` + `message`; the successful submission still stands, so treat this
  as a non-fatal follow-up failure, not a publish failure.

## Output handling

The file lands in the temp dir; report its absolute path in the final message so the user can move
or share it. Do not write it into the user's project. Offer to move it (e.g. to `~/Downloads`) if
the user asks. After the offer/build is resolved, delete any retained `generatedPreviewMediaTempDir`
from an auto-video plan; the marketing output lives in its own temp directory. Never delete a
user-supplied preview video.
