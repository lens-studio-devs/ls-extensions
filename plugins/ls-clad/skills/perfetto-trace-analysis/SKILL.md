---
name: perfetto-trace-analysis
description: Analyzes Perfetto (.pftrace) traces for Lens Studio—quick JSON summary first, then optional deep SQL via a persistent trace server. Use when the user mentions .pftrace, Perfetto, Mobile Lens Profiler, Spectacles Monitor traces, frame drops, jank, LAT, or trace performance analysis.
user-invocable: true
---
<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Perfetto trace analysis

Analyze **`.pftrace`** / **`.perfetto-trace`** captures for bottlenecks, jank, and scheduling. Use a **two-phase** workflow: fast structured JSON, then hierarchical SQL only if needed.

## Phase 1 — Quick analysis (always first)

**Goal:** One structured report without dumping raw trace tables into context.

| Step | Action |
|--------|--------|
| **Phase 1 — JSON summary** | Install deps: `pip install -r references/requirements-perfetto.txt` (from this skill directory). Run `python3 references/analyze_lens_trace.py /absolute/path/to/file.pftrace` and parse the printed JSON. |
| **Phase 1b — Scene name resolution** | Run after the JSON is parsed but before writing the report. To check if the `lens-studio` MCP is connected, resolve any Lens Studio MCP tool by its bare name (tool naming, deferred schemas, and ask/spawn semantics: see `lens-studio-field-notes` Hard Rule 2 / Cross-runtime orchestration) — if none resolve, skip to **LS MCP fallback** in the response structure. If connected: for every entry in `topSlices[*].name` that looks like a generic Lens Studio component name (prefixed with a type token like ` visual` or ` camera` followed by a default name such as `component_0`, `component_1`, or `Mesh Visual 1`), query the scene via MCP to find which scene object(s) contain a component with that name. Build a map `{ traceName → ["SceneObject ×N", ...] }` and use it inline in root-cause candidates and fixes. If a query returns no match, keep the raw trace name and note it as `[unresolved — may have been renamed or deleted since the trace was captured]`. Do not attempt to resolve `textureAttributions` names — those are draw-call labels, not component names. |
| **Phase 2 — deep SQL** | If Phase 1 is insufficient, use `references/trace_server.py` and `references/sql-recipes.md` (see below). |

**Interpret the JSON** in order: `captureProfile` / confidence → `lensActivationTimeMs` and, when present, `latLabel` / `latSeverity` — never attribute LAT to a single cause in Phase 1; list only the early-phase signals actually present in the JSON as *Possible* contributors (early-phase `slowFrames` entries, early `shaderSpikeTiming` spikes, large `textureAttributions` durations) — do not assert 'deserialization' as a cause unless a slice name in the JSON contains that term explicitly; flag Phase 2 to determine which contributor dominates → `timingInterpretation` + early/late hitch counts → **`topSlices`** (aggregated by name+track_id; rank by `totalDurationMs` for recurring bottlenecks; use `avgDurationMs` for per-call cost and `maxDurationMs` for worst spike; `minDepth` 0 = includes top-level work; if a `dominantChildHint` is present on an entry, that child is likely the real bottleneck — not the parent call count) → **`renderThreads`** (if present: candidate render threads detected from depth-0 Frame slices; if more than one, multiple render-like tracks were detected — note each track's `avgFrameMs` and `maxFrameMs` separately rather than treating them as one; treat the reason for multiple tracks (e.g. multiple activation cycles, separate render contexts) as inferred unless trace metadata confirms it; Phase 2 should drill each `trackId` individually) → **`threadActivity`** (all threads ranked by total time; each entry has a `trackId` for Phase 2 use) → **`frameTimingStats`** (p50/p90/p99/max of depth-0 slices on the busiest track; large p50→p90 gap means spike-based jank; consistently high p50 means the main path is too slow; healthy p50/p90 does not mean the user experience is acceptable — if `maxMs` is severe while p99 is also healthy, label it 'rare severe outliers' (one or two catastrophic frames, likely activation-phase) rather than 'spike-based jank'; check `slowFrames[].phase` to confirm; if p90 is already elevated, call it spike-based jank; scoped to one `trackId` — if `renderThreads` shows multiple render threads, these stats cover only the busiest) → **`shaderSpikeTiming`** (if present: `interpretation` is `startup-clustered` when >80% of shader compilation spikes occur in the first 2s — treat as warmup/first-use issue; `mostly-steady` means sustained runtime cost; `mixed` (30–80% in the first 2s) — both warmup and sustained cost are present, do not over-attribute to either without Phase 2) → **`slowFrames`** (depth-0 slices exceeding the frame budget, scoped to render/main thread(s) via `renderThreads[*].trackId` when available, otherwise the busiest thread; use `trackName` + `severity` + `label`; `phase` = `"early"` means within the first 500ms of the trace — points to activation-time issues such as shader compilation, ML model load, or asset decompression; `phase` = `"late"` means after 500ms — points to interaction-triggered work) → **`slowFrameCount`** (`overPrimaryBudget` = total slow-frame count — use this as the authoritative count; `over30fpsBudget` is non-zero only on Spectacles (primary budget ≈ 16.67ms) counting frames exceeding 33.3ms; `over60fpsBudget` is always 0 with current budgets — ignore it) → `textureAttributions` → `suggestedActions` (internal AI hints — do not copy-paste into the response; use them to guide your interpretation) / `captureContext` (device framing — cite relevant parts, do not reproduce wholesale).

If **`lensActivationTimeMs`** is missing, or present but **`latLabel`** / **`latSeverity`** are absent (fallback case — check `notes` for `"LAT approximated from first long slice."`), skip LAT-specific wording and do not treat the value as ground truth. Rely on `topSlices`, `slowFrames`, and `notes` instead.

**Conditional fields** (present only when applicable): `renderThreads` (when depth-0 Frame slices exist on any track — always prefer `trackId` from this list over track names for Phase 2 queries), `shaderSpikeTiming` (when shader-related slices exceed 5ms), `dominantChildHint` on a `topSlices` entry (when one child accounts for ≥50% of the parent's total cost — surfaces root cause one level deeper without Phase 2), `spectaclesDocLinks` (Spectacles profile only — cite only the link(s) relevant to specific findings; do not list all by default), `fpsEstimateUnreliable: true` (when FPS heuristic is suspect — do not cite the FPS number confidently), `captureProfileQueryErrors` (array of failed profile-detection queries — explains low-confidence profile detection), `frameTimingStats` (null when no qualifying depth-0 slices found — fall back to `slowFrames`; also null if the busiest track has no recognizable frame slices, which may indicate the wrong thread was selected — check `renderThreads` instead; if both `frameTimingStats` is null and `renderThreads` is absent, the trace does not use the `Frame` slice convention — rely on `threadActivity[0]` for timing guidance and flag `captureProfileConfidence` as uncertain).

**Do not** ask the user to open **ui.perfetto.dev** for mandatory analysis; keep interpretation in-chat / tool-based.

### Response structure

Structure your Phase 1 response as:

1. **Symptoms** — what the user observes: LAT, worst frame, hitch count, whether early or late
2. **Root cause candidates** — identify the most likely drivers with explicit confidence labels on each finding. Use "primary suspect", "likely driver", or "possible contributor" rather than asserting a definitive cause. Example: "shader compilation spikes under `visual component_0` are the likely driver of the worst-frame spike (*Likely* — max duration matches the frame spike, but call chain not confirmed without Phase 2); large texture attributions are a possible contributor to LAT (*Possible* — visible in the JSON but whether they dominate early-frame stalls is unconfirmed)." Use `dominantChildHint` when present to sharpen the candidate one level deeper. Confidence taxonomy for root cause candidates: *Confirmed* — directly evidenced in the JSON data; *Likely* — strongly consistent with Phase 1 data but not fully decomposed; *Possible* — plausible contributor, requires Phase 2 to confirm or rule out; *Needs Phase 2* — Phase 1 signals an issue but cannot determine cause or magnitude.
3. **Thread picture** — if `renderThreads` has multiple entries, name them separately with their avg/max; do not imply there is only one render thread
4. **Fixes** — ranked by expected impact, each with a confidence label: *high confidence* (directly evidenced in the trace), *medium confidence* (plausible but not directly measured), or *implementation idea* (workaround, not the canonical solution). Note: the root-cause confidence scale (*Confirmed / Likely / Possible / Needs Phase 2*) and the fix confidence scale (*high / medium / implementation idea*) are independent — a fix can be *high confidence* even when its root cause is only *Likely*.
5. **Phase 2 trigger** — say explicitly whether Phase 2 is needed and why, or confirm Phase 1 is sufficient
6. **LS MCP fallback** — if the `lens-studio` MCP was **not** connected and the report contains generic component names (i.e. names matching the patterns in the Phase 1b step above, such as ` visual component_0` or ` visual Mesh Visual 1`), append a single line at the end: *"Connect the Lens Studio MCP (`lens-studio`) and re-run the analysis to map these component names to their real scene objects."* Do not append this line when MCP is connected — unresolved names are already marked inline per Phase 1b.
7. **Fix execution offer** (when `lens-studio` MCP is connected): for each fix in the ranked list, assess at runtime — based on the MCP tools actually exposed by the connected server — whether the fix can be carried out; only offer operations that the available tools can actually perform (do not assume any specific tool exists without checking). For fixes that are actionable, offer to execute them, but always ask for explicit confirmation before making any change. When a reversible action (e.g. disabling a component) and a destructive action (e.g. deleting an object) would both achieve the goal, prefer the reversible one and say so. Be explicit about irreversibility when offering destructive operations.

   Let confidence drive the framing: offer *high confidence* fixes as ready to apply; flag *medium confidence* fixes and *implementation ideas* as better confirmed via Phase 2 first to avoid premature optimization.

   If Phase 2 is also recommended and actionable fixes exist, present the trade-off explicitly rather than defaulting to either path — implementing a high-confidence fix now may resolve the issue and make Phase 2 unnecessary; running Phase 2 first is safer when fix confidence is medium or lower, or when LAT has multiple possible contributors (do not recommend fix-now when LAT attribution is uncertain — Phase 2 is required to determine which contributor dominates). State which path you recommend and why, then let the user choose.

### When to escalate to Phase 2

Move to deep SQL when Phase 1 is **insufficient**, for example:

- `renderThreads` shows multiple render-like threads — you need per-thread depth-0 breakdowns to see which thread carries the spike.
- `dominantChildHint` names a child but you need to see its children (drill one more level).
- `shaderSpikeTiming` is `mixed` or `mostly-steady` — you need per-thread timing windows to confirm.
- Slice names are too generic or **call hierarchy** is needed (parent/child `depth`).
- You suspect **CPU scheduling** (preemption / starvation) — needs `sched` and thread identity.
- **`captureProfileConfidence`** is low and conclusions depend on thread semantics.

If Phase 1 is enough for concrete Lens changes, **stop after Phase 1**.

---

## Phase 2 — Deep debugging (SQL + trace server)

**Rules**

- **Avoid** unbounded wide reads on **`slice`** — in particular **never** `SELECT * FROM slice` without a tight `WHERE`; that table is huge and useless in an LLM context. On smaller tables (e.g. **`sched`** for one `utid`), `SELECT *` can be acceptable if row counts stay small—still prefer explicit columns when possible.
- **Scan hierarchically:** depth `0` first, find long poles, drill with narrower `WHERE` / `parent_id`.
- **Use `trackId` from Phase 1** — `renderThreads[*].trackId` and `threadActivity[*].trackId` give you the correct IDs to use in `WHERE s.track_id = ...`; never rely on thread name alone (unnamed tracks are common and collide by name).
- **Keep CSV out of the main agent:** run SQL in a **subprocess / subagent**; hand back short summaries (ranked bottlenecks, ms, counts, scheduling notes).
- **Express costs clearly:** use either total over the capture (e.g. "828ms total across the trace") or avg per frame (e.g. "1.8ms/frame average"), never both in the same sentence. Estimated per-frame savings from disabling a system should be stated as approximations, not exact projections.

### Environment

- Reuse Phase 1 venv or run `uv venv .venv-perfetto && uv pip install -r references/requirements-perfetto.txt` (from this skill directory). Requires Python 3.9+.
- **Deploy** `references/trace_server.py` from this skill (copy beside your venv or project).
- **Launch:** `python -u references/trace_server.py /path/to/capture.pftrace [--row-limit N]`
  **`python -u` is mandatory** — unbuffered stdout avoids pipe deadlocks. Wait until stderr prints **`Ready.`** If instead stderr prints `Fatal error loading trace:` or any other error before `Ready.`, the server has exited — surface the error to the user and do not attempt queries.

**Perfetto import:** `from perfetto.trace_processor import TraceProcessor` (public API entry point).

### Harness protocol

- Write **one SQL query per line** to the server process **stdin**. Multi-line queries (as shown in `sql-recipes.md`) must be flattened to a single line — replace newlines with spaces before sending, or a newline will terminate the query prematurely.
- Read **stdout line-by-line** until a line is exactly **`END_OF_QUERY`**. Everything before that is the result: CSV header row (success), **`NO_RESULTS`**, or **`SQL Error:` …**.
- Send **`EXIT`** (and newline) to shut down cleanly.

### SQL workflow (recipe)

1. **Processes + main thread:** query process list, then thread slice density — see `references/sql-recipes.md`.
2. **Depth 0** on the chosen **thread track:** `SUM(dur)`, `COUNT`, group by `name`, `ORDER BY total_ms DESC`, `LIMIT 20`. Skip if `topSlices` filtered to this `trackId` already answers your question — run only to go beyond the top-40 limit or to reach slices the Phase 1 aggregation missed.
3. **Drill:** depth 1+ with `parent_id` tied to the worst depth-0 slice name.
4. **Optional:** `sched` for that **utid** during bottleneck windows.

**Anti-patterns to avoid:** all are inversions of the Rules above.

---

## Handoff to the main agent

After Phase 2, return a **short** report with:

1. **What Phase 2 confirmed vs what changed from Phase 1** — explicitly note if Phase 2 unified multiple Phase 1 suspects into one root cause, or corrected a Phase 1 framing.
2. **Ranked bottlenecks:** slice name, depth, total ms (over the capture), avg ms/frame, call count, which thread (`trackId` + readable name).
3. **Confidence labels on each finding:** *confirmed* (directly shown in query results), *inferred* (consistent with data but not directly measured), or *hypothesis* (plausible but unverified).
4. **Scheduling notes** if `sched` was queried.

Do not return raw multi-page CSV. Do not state exact frame-time savings from removing a system without qualifying them as estimates.

## References

- `references/analyze_lens_trace.py` — Phase 1: trace → JSON summary (CLI).
- `references/requirements-perfetto.txt` — Python deps for Phase 1 (`perfetto`) and Phase 2 (`pandas` for `trace_server.py`).
- `references/trace_server.py` — Phase 2: persistent query server (stdin line → CSV → `END_OF_QUERY`).
- `references/sql-recipes.md` — copy-paste SQL templates for hierarchy and scheduling.
