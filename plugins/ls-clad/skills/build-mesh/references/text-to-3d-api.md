<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Text-to-3D API Reference

Request/response reference for the SPECS text-to-3D API — the static-default backend of `/build-mesh` (selection semantics live in SKILL.md's **Backend menu**). Base URL: `https://api.specs.com/v1/inference/text-to-3d` (set as `API_BASE` in `tools/text-to-3d-request.ts`); full create endpoint `https://api.specs.com/v1/inference/text-to-3d/v1/generations`. See `SKILL.md`'s **SPECS text-to-3D pipeline** for the workflow.

## Endpoints

| Method | Path | Returns |
|---|---|---|
| `POST` | `/v1/generations` | `202 Accepted` + the job object |
| `GET` | `/v1/generations/{job_id}` | `200` + the job object (current state) |

The API is request/response only — **there is no streaming/SSE endpoint**; track a job by polling the `GET`. Auth: each call carries the signed-in Lens Studio session credential (attached via `request.authorization` by `tools/text-to-3d-request.ts`); no key is handled in this skill.

## Request body (`POST /v1/generations`)

**Provide `prompt` (text→3D) or `input_image_data_url` (image→3D)** — at least one is required. `prompt` / `style` / `negative_prompt` are whitespace-normalized.

| Field | Type | Constraints | Notes |
|---|---|---|---|
| `prompt` | string | 1–1500 chars | The text→3D input — this skill's path. |
| `seed` | integer | ≥ 0 | Reproducible output. |
| `output_quality` | enum | `compact` \| `balanced` \| `standard` | GLB output budget. Default `balanced`. |
| `preview_quality` | enum | `fast` \| `balanced` \| `high` | Image (preview) stage. Default `balanced`. |
| `reconstruction_quality` | enum | `fast` \| `balanced` \| `high` | 3D reconstruction stage. Default `balanced`. |
| `style` | string | ≤ 500 chars | Style hint (e.g. "low-poly", "claymation"). |
| `negative_prompt` | string | ≤ 1000 chars | What to avoid. |
| `input_image_data_url` | string | ≤ ~15 MB | `data:` URL for image→3D (alternative to `prompt`). |
| `callback_url` | string | ≤ 2048 chars | Accepted but not currently delivered (no webhook) — don't rely on it; poll instead. |

### Enum meaning

A two-stage pipeline — a text→image (preview) stage driven by `preview_quality`, then an image→3D reconstruction stage driven by `reconstruction_quality`. `output_quality` is independent: it sets the **GLB output budget** (mesh density + texture size) and does **not** change how much detail the model generates. All three default to `balanced`.

- **`output_quality`** — output GLB budget, ordered `compact` < `balanced` < `standard` by triangle count and texture resolution. `compact` is the lightest (tight on-device budgets, or many assets in one scene); `standard` is the heaviest. Trades file size and render cost, not generation fidelity.
- **`preview_quality`** — the image stage's resolution and step count, ordered `fast` < `balanced` < `high`. Higher = a crisper reference image, at more time.
- **`reconstruction_quality`** — the 3D stage's resolution and sampler steps, ordered `fast` < `balanced` < `high`. Higher = more geometric fidelity, at more time.

For fast iteration pair a higher `preview_quality` with a `fast` `reconstruction_quality`, then raise `reconstruction_quality` for the final asset. Higher settings cost more generation time. Exact per-tier budgets are server-defined and change across model revisions, so they're not pinned here — read the succeeded job's `validation` for the numbers a run actually produced.

**Picking tiers:**

| Goal | `output_quality` | `preview_quality` | `reconstruction_quality` |
|---|---|---|---|
| Draft / fast iteration | `compact` | `fast` | `fast` |
| Final (SPECS Lens) | `balanced` | `balanced` | `balanced` |
| Max fidelity (slowest) | `standard` | `high` | `high` |

Preview at the low tiers with a fixed `seed`, then re-run higher for the final.

## Job object (create + poll response)

| Field | Type | Notes |
|---|---|---|
| `job_id` | string | Identifier; poll path `/v1/generations/{job_id}`. |
| `status` | enum | See Status lifecycle. |
| `asset_url` | string \| null | **The generated GLB URL** — a signed download URL (expires after ~1 h). Non-null only when `succeeded`. |
| `preview_image_url` | string \| null | Signed preview/thumbnail URL. |
| `progress` | object | Always present — see below. |
| `validation` | object \| null | GLB stats — see below. |
| `output_quality` / `preview_quality` / `reconstruction_quality` | enum | Resolved tiers (echo). |
| `prompt` / `seed` / `negative_prompt` | — | Echoes of the request. |
| `error_code` / `error_message` | string \| null | Set on `failed` / `canceled`. |
| `created_at` / `updated_at` | string | ISO-8601. |

> The model URL is **`asset_url`** (not `glb_url`). The response has no `timing` or `metrics` field. The model is always **GLB**.

### `progress`
```
stage, stage_label:             string
detail:                         string | null
overall_percent, stage_percent: int (0–100)
updated_at:                     string (ISO-8601)
```
Terminal states report `ready` / `failed` / `canceled` at 100%.

### `validation`
```
file_size_bytes:                          int
mesh_count, material_count, texture_count: int
triangle_count, max_texture_size:         int | null
extensions_used, warnings:                string[]
```
Use `validation` for size/triangle budgeting.

## Status lifecycle

```
queued → running → image_generated → succeeded   (asset_url present)
                                  ↘  failed | canceled   (error_code / error_message present)
```

Terminal: **`succeeded`**, **`failed`**, **`canceled`**. Poll `GET /v1/generations/{job_id}` until terminal; each GET is an independent read, so polling is safe to resume.

## Errors

Errors return a `{ "detail": ... }` JSON envelope (`detail` is a string, or a validation-error array on 422). `text-to-3d-request.ts` surfaces it as `message`.

| HTTP | Meaning | Retryable? |
|---|---|---|
| 422 | Request validation — bad enum, prompt length, or neither `prompt` nor `input_image_data_url` | no — fix the body |
| 413 | `input_image_data_url` exceeds the size cap | no |
| 404 | Unknown `job_id` | no |
| 401 | Auth rejected → sign in to Lens Studio | no |
| 403 | Forbidden → account is signed in but lacks inference-API access | no |
| 400 | Malformed JSON body | no |
| 500 | Internal error | retry once |

**Server-side job failures (HTTP 200, but `jobStatus: failed`/`canceled`).** A create/poll can succeed at the HTTP layer yet the *job* fail — surfaced in `error_message`. Most are **transient infra**, not terminal, so re-create on SPECS before switching backends:

| `error_message` | Cause | Recovery |
|---|---|---|
| `PEFT backend is required for this method` | The `high` `preview_quality`/`reconstruction_quality` tier isn't available server-side | Re-create at `balanced` — don't request `high` |
| `Canceled while clearing the dev job queue` | Dev-queue flush canceled a queued job | Re-create once on SPECS |
| other 5xx / infra message | Transient | Re-create once on SPECS |

Only after a single SPECS re-create still fails should `/build-mesh` switch that mesh to another backend — announced, never silent (SKILL.md → "On failure").

## Timing & limits

- **Polling cadence:** ~5–10 s between authorized GETs — use short `sleep`s only (long foreground sleeps are blocked by the harness), and never a background poll-loop inside `ExecuteEditorCode` (it fails strict-TS compile). The job persists server-side, so each GET is an independent read. To poll several jobs in one `ExecuteEditorCode` call, type the response as `any` (as `text-to-3d-request.ts` does) — a bare `response.statusCode` on the editor's `unknown` type fails `TS2339`.
- **Bounded wait:** `/build-mesh` does NOT poll indefinitely — it caps the wait (~10 polls / ~3 min per job once `overall_percent` stops advancing) and returns `status: SPECS_TIMEOUT`; any backend switch after a timeout is announced, never silent. A job stuck `queued`/0% or pinned at a fixed percent is server backlog, not progress. See the SKILL.md SPECS pipeline's poll-stall rule.
- **Generation time:** tens of seconds, longer at higher quality; no published SLA.
- **No streaming:** the API is request/response only — there is no event stream to subscribe to; poll the GET.
