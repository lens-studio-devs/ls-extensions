# LEAF cleanup and evidence retention

Cleanup removes evaluation instrumentation while preserving the user's work and the evidence
needed by judges. It occurs after Phase D has collected relevant code/log findings and before
Phase E finalizes the report. Attempt it after failed or aborted LEAF setup/runs as well.

## Before changing the project

Start a `leaf-cleanup` ledger using [the contract](contracts.md). Use a unique evaluation-owned
scenario/index name rather than overwriting a pre-existing `LeafIndex`. Record every intended
file, scene object/component, package, and preview-setting change before applying it:

- Stable target path or object/component ID; names alone are not ownership evidence.
- Whether it existed before, its original state, and the exact evaluation-created state.
- For a modified existing file, an original backup outside the imported Assets tree and its
  SHA-256 hash. Record the evaluation-written hash after editing. Keep backups until cleanup
  is confirmed; retain them when a conflict prevents restoration.
- Initial disposition `pending` and the planned restoration/removal reason.

Validate the ledger before mutations. The recorded evaluation state/hash is the proposed
post-write value at that boundary; verify it against the actual result afterward. If the
original state cannot be captured, leave that existing resource unchanged and report the
setup limitation. Never use an entire project snapshot or Git reset to roll back unrelated work.

## Preserve evidence before cleanup

Stop/await the current scenario before touching its instrumentation. Identify its captures
from the run response, logs, or explicit output paths, not by sweeping unrelated directories.
Copy any LEAF screenshots, image sequences, GIFs, or recordings into
`eval_frames/<run_id>/leaf/` before removing their source files or temporary workspace.
Preserve originals; put ≤640px judge-readable derivatives beside them when needed. Keep
scenario results and relevant log excerpts with the report.

Index usable captures in `capture_manifest` with `source: leaf_preview`, `phase: C`, their
scenario ID, capture time, viewpoint/state, and instrumentation limitations. List every such
artifact ID in the ledger's `retained_artifact_ids`. Validate the manifest and verify copied
files before proceeding. If evidence cannot be safely preserved, leave its source and any
containing workspace intact, mark cleanup partial/blocked, and report the location and error.
Corrupt captures stay retained for diagnosis but are not advertised as judge-readable artifacts.

## Restore only recorded evaluation changes

Use the existing Lens Studio scene/asset/package operations for their respective resources;
do not delete imported assets behind the editor's back. Supply explicit recorded IDs/paths
and structured tool arguments. Compare current state with the recorded evaluation state
before restoration. Apply these decisions per ledger entry:

| Resource | Cleanup decision |
|---|---|
| New evaluation scene object/component | Remove only the exact recorded object/component if its contents still match evaluation ownership. Remove its wiring before its assets. |
| Existing object/component or preview setting | Restore the recorded original properties only if current values still match the evaluation-written values. |
| New evaluation script/asset | Remove only the recorded resource after detaching evaluation references and preserving captures. Do not remove a file that another component now uses. |
| Modified existing file | Restore its verified backup only when the current hash matches the recorded evaluation hash. Otherwise leave it intact as a conflict. |
| Pre-existing package/tests | Keep them. Restore only explicitly recorded changes; never uninstall a pre-existing package. |
| Package installed during evaluation | Remove through supported package operations only if ownership is established and no remaining user assets depend on it; otherwise retain it as shared. |
| Captures, manifests, report, results, diagnostic logs | Keep them outside runtime instrumentation. Cleanup never removes evidence indexed for judges. |

A changed hash, newly added dependency, missing ownership record, or unavailable MCP is a
reason to **retain and report**, not to guess or force deletion. Do not run broad directory
removals, project-wide rollback, or extra gameplay tests as part of cleanup.

## Finish and hand off

Record each entry as `restored`, `removed`, `retained_shared`, `retained_conflict`, or
`retained_unavailable`, with the outcome/reason. Do not claim `complete` while any project
change is pending or retained. Use `partial`/`blocked` plus limitations and concrete remaining
actions; `not_needed` applies when LEAF made no project changes. Retaining evidence alone
never makes cleanup incomplete.

Save the restored scene/project using the supported editor workflow. Check that the recorded
evaluation-only wiring is gone and capture any cleanup-induced compile error once, without
restarting scenarios. Cleanup verification is limited to owned resources; it is not another
scene exploration or an expansion of capture budgets. Revalidate `evaluator-output` after
cleanup so every indexed preview and LEAF capture still exists and matches its hash.

Report cleanup status and retained resources in `Lens description and current state`.
Distinguish a cleanup limitation from an original Lens defect. Judges may optionally inspect
retained LEAF captures after the harness has been removed; they must retain the test-context
qualification and prefer the pre-LEAF preview for claims about the original experience.
