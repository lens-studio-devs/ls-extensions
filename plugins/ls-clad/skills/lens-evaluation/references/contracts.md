# Evaluation contracts

[contracts.schema.json](../schemas/contracts.schema.json) is the versioned JSON Schema
(Draft 2020-12) source of truth. Select a boundary using `#/$defs/<kind>`.
Unknown fields are rejected. Use JSON files as invocation data; do not generate executable
source containing per-run values.

## Validation

From this skill's directory, run:

```sh
uv run --script scripts/validate-contract.py --kind evaluator-output --input /absolute/path/evaluation_result.json
```

Replace `--kind` and `--input` for the boundary below. The script declares its `jsonschema`
and Pillow dependencies for `uv`; retained MP4s additionally require `ffprobe`. It reads files
only and returns `{"ok":true,"kind":"evaluator-output","errors":[]}` on success (exit 0),
or the same shape with `ok:false` and errors (exit 1). A missing dependency is a validation
failure, not permission to accept unchecked data. Invalid CLI usage exits 2.

| Kind | Producer → consumer | Validation point |
|---|---|---|
| `skill-input` | User/caller → orchestrator | Before level selection; validate resolved evaluator inputs again after defaults. |
| `evaluator-input` | Orchestrator → evaluator | Before dispatch. Required original prompt and resolved level; project path may be omitted. |
| `capture-plan` | Evaluator → preview operations | Before executing B1/B2; tool arguments still pass the MCP tool's own schema. |
| `capture-manifest` | Captures → evaluator/judges | After copying/normalizing captures into the current run directory, before cleanup, and at final handoff. |
| `leaf-cleanup` | LEAF setup/cleanup → evaluator | Before project changes and after cleanup. Pending entries are allowed only in the working ledger. |
| `evaluator-output` | Evaluator → orchestrator | Before returning; includes the report text, capture manifest, and terminal cleanup record. |
| `judge-input` | Orchestrator → each judge | Before dispatch; forward the exact validated report and manifest. |
| `judge-output` | Each judge → orchestrator | Before scores/comments enter synthesis; null metrics require explanations. |
| `skill-output` | Orchestrator → caller/user | Validate the summary envelope before rendering its `summary` text; checks panel aggregation and saved output references. |

The orchestrator performs validation for read-only judges. If a returned object is malformed,
request one correction of its structure using existing evidence; do not rerun the Lens or
invent missing evidence. If still invalid, report that response as unavailable.

## Evaluator output

Write `<lens_folder>/evaluation_result.json` and return that **JSON object** inline. It has:

- `schema_version: 1`, `run_id`, `level`, and `status` (`complete`, `partial`, `blocked`).
- `report_path` and `internal_report`: the absolute Markdown path and identical full text.
  If saving is blocked, use a null path, retain text inline, and explain the limitation.
- `capture_plan`: structured B1 timeline, or null when planning could not run.
- `capture_manifest`: the full current-run capture index, not just a folder path.
- `leaf_cleanup`: the working ledger's final state, including retained LEAF capture IDs.
- `limitations`: concise explanations for partial/blocked work.

Save the manifest as `eval_frames/<run_id>/capture_manifest.json` and the cleanup ledger as
`eval_frames/<run_id>/leaf_cleanup.json`. If the output directory is unavailable, keep these
objects inline with explicit unavailable/blocked states. Never cite unwritten paths.
`discovery` uses the same envelope, but its Markdown contains only `## Capture Plan` and its
cleanup status is `not_needed`. No judge is dispatched.

Full-report Markdown has three level-two headings: `Lens description and current state`,
`Expectations vs. realizations`, and `Major Issues — Evaluator Must-Fix`. Use level-three
headings for the Capture Plan and other subsections. The validator checks this layout and
saved/inline text equality; it does not establish that the report's claims are true.

## Capture manifest and judge access

Each artifact has a stable ID, absolute retained path, media type, byte count, SHA-256 hash,
actual dimensions, capture time relative to the run start, viewpoint, visible state,
source/phase, role, scenario ID when applicable, derivation IDs, and timing limitations.
For ordinary stills, use an empty `derived_from` list and null sample interval/playback rate.
For a motion GIF, list the ordered motion-frame IDs and record both sampling interval and
playback rate. Optional recordings are MP4s; judges with image-only tools use their indexed
sampled frames instead. Store judge-readable images at ≤640px; preserve original captures
separately if normalization is needed.

Use `preview_panel` or `preview_recording` for original Phase B evidence, `leaf_preview` for
Phase C captures, and `synthetic_render` only for structural aids. A primary artifact must
come from Phase B's faithful preview. Captures from tests show the instrumented Lens and
must not replace or overwrite the pre-LEAF evidence.

`capture_origin` is `requested` for planned captures. Use `automatic` only for supplementary
captures emitted by LEAF without an extra evaluator request. Retain those even when the
high effort's requested-frame budget is exhausted (medium runs no LEAF); this is not permission to schedule extra
captures or scenarios. Record their scenario, time, and any test overlays in `limitations`.

The validator checks existing media, hashes, dimensions, confinement to `frames_dir`, IDs,
the medium one-overview-still and no-LEAF limits, report consistency, and retained LEAF evidence. It does not
validate semantic truth, tool-side effects, or device behaviour. Keep corrupt/missing capture
attempts in `limitations`, not in the list of available artifacts.

Each judge receives `internal_report`, `personality`, `evaluation_status`, `frames_dir`
(nullable), and the **inline `capture_manifest`**. Judges may read specific retained images
from either preview or LEAF capture sources to support a claim, using the manifest metadata
to understand context. They never need the LEAF runner, test scripts, or temporary workspace.

If an automatic LEAF capture lacks a reliable capture timestamp, use null `at_seconds` and
explain the missing timing in its limitations. Do not invent timestamps; planned captures
still require recorded times.

## Skill output

The orchestrator constructs a `skill-output` object containing `schema_version: 1`, `level`,
`status`, the user-facing `summary`, nullable `evaluation_result_path` and `improvements_path`,
`judge_results` (each has `persona` and the validated `result`), `unavailable_judges`,
`panel_score`, `panel_judge_count`, and `limitations`. The panel score is the mean of numeric
judge global scores rounded to two decimals, or null when none are assessed. Never count nulls
or missing responses as zero. The validator checks this arithmetic and the referenced files.

For full runs, write this envelope with `scripts/write-summary.py`, which builds it from the judges' outputs, computes the panel score, validates it and saves `<lens_folder>/evaluation_summary.json` only when valid. Never write the file by hand. For `fast` or
an output-write failure, use a temporary validation file and render the summary without
claiming a saved project artifact. Discovery has no judge results or improvements file.
The final chat reply remains human-readable; the validated envelope is for downstream use.

Run the boundary tests with `uv run --no-project --with jsonschema --with Pillow python -m
unittest discover -s tests -v` from this skill's directory.
