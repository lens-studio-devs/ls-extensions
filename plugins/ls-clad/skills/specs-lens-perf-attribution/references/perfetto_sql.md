<!--
Copyright 2026 Specs Inc.
SPDX-License-Identifier: Apache-2.0
-->

# Perfetto SQL notes for Lens Studio Preview traces

Lens Studio Preview performance trace exports often contain intrinsic tables such as `__intrinsic_slice`, `__intrinsic_counter`, and `__intrinsic_track`. Some exports expose standard views named `slice`, `counter`, and `track`. Use whichever exists.

## Trace bounds

```sql
SELECT min(ts), max(ts_end) FROM (
  SELECT ts, ts + CASE WHEN dur >= 0 THEN dur ELSE 0 END AS ts_end FROM __intrinsic_slice
  UNION ALL
  SELECT ts, ts AS ts_end FROM __intrinsic_counter
);
```

## Scene frames

```sql
SELECT dur / 1e6 AS ms
FROM __intrinsic_slice
WHERE name = 'Scene Update' AND dur >= 0
ORDER BY ts;
```

If `Scene Update` is absent, use camera-root slices or a target FPS assumption for normalization.

## Attributed Lens categories

Useful Preview categories include:

- `ShapeTrack` — often Preview/host tracking/camera feed work; verify by all-off baseline.
- `ScnCamera` — camera/update/render-camera work.
- `ScnRenderTarget` — render-target passes.
- `ScnRenderDrawCall` — draw submission/render draw calls.
- `ScnComponent` — script/package/component work.
- `ScnVisual` — visual/render mesh/text/image work.
- `ScnOther` — engine scene work not otherwise categorized.

```sql
SELECT coalesce(category, '') AS category,
       coalesce(name, '') AS name,
       sum(dur) / 1e6 AS total_ms,
       count(*) AS count,
       avg(dur) / 1e6 AS avg_ms,
       max(dur) / 1e6 AS max_ms
FROM __intrinsic_slice
WHERE dur >= 0
  AND category IN ('ShapeTrack','ScnCamera','ScnRenderTarget','ScnRenderDrawCall','ScnComponent','ScnVisual','ScnOther')
GROUP BY category, name
ORDER BY total_ms DESC;
```

## Counters

```sql
SELECT t.name, c.ts, c.value
FROM __intrinsic_counter c
JOIN __intrinsic_track t ON t.id = c.track_id
WHERE t.name IN ('DrawCalls', 'RenderedVertices', 'MangledVisual')
ORDER BY t.name, c.ts;
```

## CPU core-time

Lens Studio Preview performance traces do not expose scheduler/CPU tables (`sched_slice`/`__intrinsic_sched_slice`), so total scheduled CPU core-time is not available.

Report attributed slice time only. Do not describe it as CPU time — a frame can have 7 ms of attributed frame-time while consuming more than 7 ms of CPU core-time across multiple threads/cores.
