# Copyright 2026 Specs Inc.
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Optional

_B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
_B64_INDEX = {ch: i for i, ch in enumerate(_B64)}


def decode_vlq(s: str) -> list[int]:
    result: list[int] = []
    value = 0
    shift = 0
    for ch in s:
        digit = _B64_INDEX.get(ch)
        if digit is None:
            raise ValueError(f"invalid VLQ character: {ch!r}")
        cont = digit & 32
        digit &= 31
        value |= digit << shift
        shift += 5
        if not cont:
            negative = value & 1
            value >>= 1
            result.append(-value if negative else value)
            value = 0
            shift = 0
    return result


@dataclass
class SourceMap:
    version: int
    sources: list[str]
    by_source: dict[int, dict[int, list[int]]]
    by_generated: dict[int, list[tuple[int, int, int, int]]]


def parse_source_map(json_str: str) -> SourceMap:
    data = json.loads(json_str)
    if not isinstance(data, dict):
        raise ValueError("source map root must be an object")
    if "sections" in data:
        raise ValueError("indexed source maps (with `sections`) are not supported")

    raw_sources = data.get("sources")
    if not isinstance(raw_sources, list):
        raise ValueError("source map missing `sources` array")
    source_root = data.get("sourceRoot") or ""
    if not isinstance(source_root, str):
        source_root = ""
    sources = [_join_source_root(source_root, s if isinstance(s, str) else "") for s in raw_sources]

    mappings = data.get("mappings")
    if not isinstance(mappings, str):
        raise ValueError("source map missing `mappings` string")

    by_source, by_generated = _index_mappings(mappings)
    return SourceMap(
        version=int(data.get("version", 3)),
        sources=sources,
        by_source=by_source,
        by_generated=by_generated,
    )


def _join_source_root(root: str, source: str) -> str:
    if not root:
        return source
    if not source:
        return root
    if root.endswith("/") or source.startswith("/"):
        return root + source
    return root + "/" + source


def _index_mappings(
    mappings: str,
) -> tuple[
    dict[int, dict[int, list[int]]],
    dict[int, list[tuple[int, int, int, int]]],
]:
    by_source: dict[int, dict[int, list[int]]] = {}
    by_generated: dict[int, list[tuple[int, int, int, int]]] = {}

    source_idx = 0
    source_line = 0
    source_col = 0
    name_idx = 0  # carried but unused

    for gen_line, group in enumerate(mappings.split(";")):
        if not group:
            continue
        gen_col = 0
        for segment in group.split(","):
            if not segment:
                continue
            try:
                fields = decode_vlq(segment)
            except ValueError:
                # Malformed segment — skip it rather than poisoning the map.
                continue
            if len(fields) == 1:
                # "No source info" marker — advances gen_col only.
                gen_col += fields[0]
                continue
            if len(fields) < 4:
                continue  # spec violation; ignore
            gen_col += fields[0]
            source_idx += fields[1]
            source_line += fields[2]
            source_col += fields[3]
            if len(fields) >= 5:
                name_idx += fields[4]
            by_source.setdefault(source_idx, {}).setdefault(source_line, []).append(gen_line)
            by_generated.setdefault(gen_line, []).append((gen_col, source_idx, source_line, source_col))

    # Sort by_source per-line lists so callers can take the smallest cheaply.
    for per_source in by_source.values():
        for gens in per_source.values():
            gens.sort()

    return by_source, by_generated


# Forward-snap range when the queried source line has no mapping.
_FORWARD_SNAP_WINDOW = 10


def find_generated_line(
    sm: SourceMap,
    source_idx: int,
    source_line: int,
) -> Optional[int]:
    per_source = sm.by_source.get(source_idx)
    if per_source is None:
        return None
    if source_line in per_source:
        return per_source[source_line][0]
    for offset in range(1, _FORWARD_SNAP_WINDOW + 1):
        hit = per_source.get(source_line + offset)
        if hit is not None:
            return hit[0]
    return None


def find_source_location(
    sm: SourceMap,
    gen_line: int,
    gen_col: int = 0,
) -> Optional[tuple[int, int, int]]:
    segments = sm.by_generated.get(gen_line)
    if not segments:
        return None
    best: Optional[tuple[int, int, int, int]] = None
    for seg in segments:
        if seg[0] <= gen_col:
            best = seg
        else:
            break
    if best is None:
        best = segments[0]
    return (best[1], best[2], best[3])


def find_source_index(sm: SourceMap, query: str) -> Optional[int]:
    matches: list[int] = []
    for i, src in enumerate(sm.sources):
        if src == query:
            return i
        if len(src) >= len(query):
            pos = len(src) - len(query)
            if src.endswith(query) and (pos == 0 or src[pos - 1] in "/\\"):
                matches.append(i)
    if not matches:
        return None
    return matches[0]
