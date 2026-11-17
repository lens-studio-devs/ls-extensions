#!/usr/bin/env python3

# Copyright 2026 Specs Inc.
# SPDX-License-Identifier: Apache-2.0

"""Count round trips in an agent session transcript.

MAINTAINER TOOL — run by hand. Nothing in the publish flow calls this, and the skill never
references it; it lives here so it stays with the flow it measures.

The round trip — one model response — is the billable unit of an agent run, so it is
the unit the specs-publish redesign is measured in. This script exists because the
obvious way to count it is wrong.

A Claude Code transcript writes each `tool_use` block as its own `assistant` record
and each text block as another. **No record ever contains both.** Measured across 13
sessions of one project: 942 records with `tool_use`, 425 with text, 0 with both. So
classifying records by their content blocks reports every text block as a "text-only
round trip" and forces calls-per-message to exactly 1.00, regardless of how the model
actually behaved. Both numbers are artifacts of the format.

`requestId` is the field that identifies one model response. Grouping by it recovers
the real shape: in the same sessions, 30-50% of round trips carry text *and* calls.

Usage:
    count-round-trips.py <session.jsonl> [...]
    count-round-trips.py --project=<slugified-cwd>    # every session for one project

A round trip is the billable unit: one model response, however many tool calls it carried.
Measured over five publish runs it tracks wall clock closely — 18.7-23.5 s per round trip — so it
is a fair speed proxy. It is a poor *goal*: it scores a run that fixed the default preview-capture
path as worse than one that did not, because that path needs one extra call. Use the per-tool
breakdown to find waste; do not optimise the total.

Codex transcripts are a different format (`response_item` payloads) and are not
handled here; `audit-publish-transcript.py` in the skill covers those.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path

PROJECTS = Path.home() / ".claude" / "projects"


@dataclass
class Counts:
    trips: int = 0
    tool_only: int = 0
    text_only: int = 0
    both: int = 0
    calls: int = 0
    tools: Counter = field(default_factory=Counter)

    @property
    def calls_per_trip(self) -> float:
        return self.calls / self.trips if self.trips else 0.0

    @property
    def colocated_share(self) -> float:
        return self.both / self.trips if self.trips else 0.0


def count(path: Path) -> Counts:
    """Group assistant records by requestId, the identity of one model response."""
    grouped: dict[str, dict] = defaultdict(lambda: {"text": 0, "tool": 0, "names": []})
    orphans = 0

    for line_number, line in enumerate(path.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
        line = line.strip()
        if not line:
            continue
        try:
            record = json.loads(line)
        except ValueError:
            print(f"{path.name}:{line_number}: unparseable line, skipped", file=sys.stderr)
            continue
        if record.get("type") != "assistant":
            continue

        content = record.get("message", {}).get("content") or []
        if isinstance(content, str):
            content = [{"type": "text", "text": content}]

        # A record without a requestId cannot be attributed to a response; give it its
        # own bucket rather than merging unrelated records under a shared None key.
        request_id = record.get("requestId")
        if not request_id:
            orphans += 1
            request_id = f"__orphan_{orphans}__"

        bucket = grouped[request_id]
        for block in content:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "tool_use":
                bucket["tool"] += 1
                bucket["names"].append(block.get("name") or "?")
            elif block.get("type") == "text" and (block.get("text") or "").strip():
                bucket["text"] += 1

    result = Counts()
    for bucket in grouped.values():
        has_tool, has_text = bucket["tool"] > 0, bucket["text"] > 0
        if not (has_tool or has_text):
            continue
        result.trips += 1
        result.calls += bucket["tool"]
        result.tools.update(bucket["names"])
        if has_tool and has_text:
            result.both += 1
        elif has_tool:
            result.tool_only += 1
        else:
            result.text_only += 1
    return result


def report(label: str, counts: Counts, *, show_tools: bool) -> None:
    print(f"== {label}")
    print(f"   round trips        : {counts.trips}")
    print(f"     calls only       : {counts.tool_only}")
    print(f"     text only        : {counts.text_only}")
    print(f"     text + calls     : {counts.both}  ({counts.colocated_share:.0%} co-located)")
    print(f"   tool calls         : {counts.calls}")
    print(f"   calls / round trip : {counts.calls_per_trip:.2f}")
    if show_tools and counts.tools:
        print(f"   tools              : {dict(counts.tools.most_common())}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("transcripts", nargs="*", type=Path, help="session .jsonl paths")
    parser.add_argument("--project", help="slugified cwd under ~/.claude/projects")
    parser.add_argument("--tools", action="store_true", help="also break down calls by tool name")
    parser.add_argument("--json", action="store_true", help="emit machine-readable output")
    args = parser.parse_args()

    paths = list(args.transcripts)
    if args.project:
        directory = PROJECTS / args.project
        if not directory.is_dir():
            parser.error(f"no such project directory: {directory}")
        paths.extend(sorted(directory.glob("*.jsonl"), key=lambda p: p.stat().st_mtime))
    if not paths:
        parser.error("give at least one transcript path or --project")

    payload = {}
    for path in paths:
        if not path.is_file():
            print(f"skipping missing {path}", file=sys.stderr)
            continue
        counts = count(path)
        if not counts.trips:
            continue
        payload[path.name] = {
            "roundTrips": counts.trips,
            "callsOnly": counts.tool_only,
            "textOnly": counts.text_only,
            "textAndCalls": counts.both,
            "calls": counts.calls,
            "callsPerRoundTrip": round(counts.calls_per_trip, 2),
            "coLocatedShare": round(counts.colocated_share, 3),
        }
        if not args.json:
            report(path.name, counts, show_tools=args.tools)

    if args.json:
        print(json.dumps(payload, indent=2, sort_keys=True))
    return 0 if payload else 1


if __name__ == "__main__":
    sys.exit(main())
