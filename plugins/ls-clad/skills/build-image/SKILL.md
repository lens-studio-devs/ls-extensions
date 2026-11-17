---
name: build-image
description: >
  Generate a 2D image from a text prompt via SPECS text-to-image, to
  Assets/GeneratedImages/<Name>.png (build-mesh reference, texture, or
  screen-space). Transparent RGBA cutout, cropped tight, by default; opt
  out for an opaque image.
---

# Build an Image

`/build-image` produces a 2D image from a text prompt and writes
`Assets/GeneratedImages/<Name>.png`.

## Transport

Same authorized HTTP channel as `build-mesh`'s SPECS backend, through
`ExecuteEditorCode` and `Network.performAuthorizedHttpRequest`. The credential is
the signed-in Lens Studio session; there is no API key. Base and path:
`https://api.specs.com/v1/inference/text-to-3d` + `/v1/generations`, with
`output_type: "image"` in the request body. Async: create, poll, download.

## Create

Execute the pinned tool by absolute path, passing the request as structured `args`
(never templated into the source). `args` requires `method`, `requestPath`, and an
explicit `body`:

```text
ExecuteEditorCode({
  path: "<absolute skill-dir>/tools/text-to-image-request.ts",
  args: {
    method: "POST",
    requestPath: "/v1/generations",
    body: { prompt: "<image_description>", output_type: "image", include_cutout: true }
  }
})
```

`body` carries `prompt` and `output_type: "image"`, plus `style` / `negative_prompt` /
`seed` / `preview_quality` when set. **Default to the transparent cutout:** send
`include_cutout: true`. On an image-only job that flag is the switch that turns segmentation
on and uploads the background-removed subject as `processed_preview_image_url` (a straight-alpha
RGBA PNG, square-cropped tight to the subject). For the cutout at the full segmentation frame
instead (the source scaled to fit 1024px on its long edge), send `include_uncropped_cutout: true`
and download `uncropped_cutout_image_url`. For a full-frame opaque render, send neither cutout
flag and download `preview_image_url`. Do not hand-roll or shorten the request: the pinned tool
carries the auth classification and `unknown`-typed response handling the Editor API needs.

- Result `OK` -> keep `data.job_id`. `ACTION_REQUIRED` -> branch on `reason`:
  `not_signed_in` / `no_auth_interface` / 401 -> `status: NOT_SIGNED_IN`;
  `forbidden` / 403 -> `status: NO_API_ACCESS`. Either way, return that status without
  retrying. The caller continues without the image (a solid-colour or vertex-colour
  material instead) and tells the user which case it was.
- A safety block comes back as `FAILED` with `httpStatus: 422` and a `bodyPrefix`
  whose detail `type` is `value_error.safety_policy`. Report `status: PROMPT_BLOCKED`
  with a plain "prompt blocked by safety policy" message. Do not retry.
- Other `FAILED`: retry once if `retryable`, else surface the error.

Generating several images at once? Fire every create first and keep all the `job_id`s,
then poll and download them together — the jobs run concurrently server-side.

## Poll

Re-run the pinned tool with a fresh invocation object; a GET still supplies the
required empty `body`:

```text
ExecuteEditorCode({
  path: "<absolute skill-dir>/tools/text-to-image-request.ts",
  args: { method: "GET", requestPath: "/v1/generations/<job_id>", body: {} }
})
```

Image-only jobs are quick. Poll a few seconds after create, then every few seconds; a job
usually reaches a terminal state within seconds to about a minute, and the cutout
segmentation step can add to that. Treat these as rough guidance, not a deadline.

- `data.status == "succeeded"` -> download. The cutout URLs (`processed_preview_image_url` for
  the default, `uncropped_cutout_image_url` for the uncropped variant) fill in from the
  `image_generated` status onward and can land a beat after `preview_image_url`, so wait for the
  one you need. If a succeeded job returns it null, segmentation found no subject: fall back to
  `data.preview_image_url` or resurface. (Opaque opt-out downloads `data.preview_image_url`.)
- `failed` / `canceled` -> classify `data.error_message`; retry the create once for
  transient server errors, else surface.

## Download

Pass the URL on the command line, or via `--url-file` to keep the ~1.5 KB signed URL off it
(write the URL to a scratch file first):

```bash
node <skill-tools-dir>/download-image.js --url "<data.processed_preview_image_url>" --out Assets/GeneratedImages/<Name>.png
node <skill-tools-dir>/download-image.js --url-file <scratch>/<Name>.url  --out Assets/GeneratedImages/<Name>.png
```

Download `processed_preview_image_url` for the cropped RGBA cutout (the default; the written
file is RGBA), `uncropped_cutout_image_url` for the uncropped one, or `preview_image_url` for
the opaque opt-out. The cutouts are straight-alpha RGBA, so they composite correctly on an
Image component or as a material `baseTex`.

The tool retries a transient 403 itself (a fresh signed URL can 403 for a beat while S3
settles), so act on the exit code, not the first failure: `0` wrote the file (stdout JSON
carries `attempts`); `3` means the URL is expired or wrong — re-poll
`GET /v1/generations/<job_id>` for a fresh URL, then re-run; `1`/`2` are hard/usage errors.
Never open the URL in a browser or a Lens Studio file picker.

## Output contract

Verify before reporting success:

```bash
test -s Assets/GeneratedImages/<Name>.png && stat -f%z Assets/GeneratedImages/<Name>.png
```

Return `{ name, path, status, width, height }` where `status` is `ok`,
`PROMPT_BLOCKED`, `NOT_SIGNED_IN`, `NO_API_ACCESS`, `IMAGE_MISSING`, or `TIMEOUT`.
If the file is missing or 0 bytes, return `IMAGE_MISSING`. `width` and `height` come
from the downloaded PNG header when available, else `null`; on the default cutout path the
file is transparent RGBA and those dimensions reflect the tight crop, not the full render.

The deliverable is the PNG on disk. Lens Studio auto-imports a file dropped into `Assets/`
as a `FileTexture`; a caller that needs the asset handle can read it back with
`assetManager.getFileMeta` (or `importExternalFileAsync` if the watcher has not yet picked
it up).

## Request

$ARGUMENTS

Resolve `Name` if not provided (PascalCase from the description). Parse flags after
`|`: `style`, `negative_prompt`, `seed`, `preview_quality`. The transparent cropped cutout is
the default (`include_cutout: true` -> download `processed_preview_image_url`); pass
`uncropped=true` for the full-frame cutout (`include_uncropped_cutout: true` -> download
`uncropped_cutout_image_url`), or `opaque=true` for a full-frame opaque render (neither cutout
flag -> download `preview_image_url`). No `target_size_cm`, `ground_contact`, or GLB knobs
apply. To turn the image into a 3D asset, hand the written PNG to `build-mesh` as
`reference_image` (its image-to-3D path).
