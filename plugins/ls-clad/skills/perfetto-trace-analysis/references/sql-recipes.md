<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Perfetto SQL recipes (hierarchical)

Use with **`trace_server.py`**. Replace placeholders (`<main_thread_track_id>`, process name filters, etc.) with values from prior queries.

## Process list

```sql
SELECT pid, name FROM process ORDER BY name
```

## Thread slice density (main-thread heuristic)

```sql
SELECT thread.utid, thread.tid, thread.name AS thread_name,
       process.name AS process_name, COUNT(slice.id) AS slice_count
FROM slice
JOIN thread_track ON slice.track_id = thread_track.id
JOIN thread USING (utid)
JOIN process USING (upid)
WHERE process.name LIKE '%your_process%'
GROUP BY thread.utid
ORDER BY slice_count DESC
LIMIT 10
```

Top row is often the busiest thread; confirm with depth-0 slices (framework entry points) when possible.

## Map utid to track_id

`utid` from the density query above is not directly usable in slice queries — those require `track_id` from `thread_track`:

```sql
SELECT id AS track_id FROM thread_track WHERE utid = <utid>
```

Use the returned `track_id` in the depth queries below.

## Depth 0 — top-level bottlenecks

```sql
SELECT name, SUM(dur)/1e6 AS total_ms, COUNT(*) AS count, AVG(dur)/1e6 AS avg_ms
FROM slice
WHERE depth = 0 AND track_id = <main_thread_track_id>
GROUP BY name
ORDER BY total_ms DESC
LIMIT 20
```

## Depth 1 — under worst depth-0 name

```sql
SELECT name, SUM(dur)/1e6 AS total_ms, COUNT(*) AS count, AVG(dur)/1e6 AS avg_ms
FROM slice
WHERE depth = 1 AND track_id = <main_thread_track_id>
  AND parent_id IN (
    SELECT id FROM slice WHERE name = '<worst_offender>' AND depth = 0
      AND track_id = <main_thread_track_id>
  )
GROUP BY name
ORDER BY total_ms DESC
LIMIT 20
```

Repeat for depth 2, 3, … with updated parent filters until leaves or negligible duration.

Note: if `<worst_offender>` appears multiple times at depth 0 (e.g. once per frame), `parent_id IN (…)` aggregates children across all of those invocations. That is usually what you want for a cumulative breakdown, but if one invocation is anomalously slow you may want to pin a specific parent by `id` instead:

```sql
-- Find the single slowest invocation first:
SELECT id, dur/1e6 AS dur_ms FROM slice
WHERE name = '<worst_offender>' AND depth = 0 AND track_id = <main_thread_track_id>
ORDER BY dur DESC LIMIT 1
```

Then replace `parent_id IN (…)` with `parent_id = <id>` in the depth-1 query.

## Scheduling (optional)

The `sched` table can be very large (one row per scheduling event). Always add a time bound and a `LIMIT`:

```sql
SELECT ts, dur, cpu, end_state FROM sched
WHERE utid = <utid>
  AND ts BETWEEN <ts_start_ns> AND <ts_end_ns>
ORDER BY ts
LIMIT 200
```

To find the time window, use the `ts` and `dur` of the slow depth-0 slice you are investigating.

## Key tables

| Table | Use |
|-------|-----|
| `slice` | Events; filter `track_id`, `depth`, `name`, `parent_id` |
| `thread_track` | `track_id` → `utid` |
| `thread` | `utid`, `tid`, `name` |
| `process` | `upid`, `pid`, `name` |
| `sched` | CPU scheduling, preemption |
| `counter` | Freq, memory, battery counters |
