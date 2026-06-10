#!/usr/bin/env python3
# Copyright 2026 Specs Inc.
# SPDX-License-Identifier: Apache-2.0

"""Feasibility probe: can one WebSocket to Lens Studio's CDP server hold two
concurrent `Target.attachToTarget` sessions and drive them independently?

This is a one-time gate for the multiplexing-proxy refactor (plan
plan-it-misty-hennessy.md). If LS rejects the second attach or starves the
WebSocket, the planned architecture (one daemon, N targets, sessionId-routed)
does not work and we must reshape toward N WebSockets.

Usage:
    python3 probe-multi-attach.py [--host localhost] [--port 9222]

Pre-req: Lens Studio running with at least TWO debuggable preview targets
open. The probe walks /json/list, picks two distinct non-browser targets,
attaches to both, and runs `Runtime.evaluate("globalThis.__probe_<n>=<n>")`
on each, then reads back each global to confirm independent contexts.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import urllib.request
from typing import Any

try:
    import websockets
except ImportError:
    sys.stderr.write("websockets package missing. Install via:\n  pip install -r tools/requirements-lsdbg.txt\n")
    sys.exit(2)


BROWSER_TARGET_ID = "lensstudio-target"


def list_targets(host: str, port: int) -> list[dict[str, Any]]:
    url = f"http://{host}:{port}/json/list"
    with urllib.request.urlopen(url, timeout=2) as resp:
        return json.loads(resp.read())


async def send_cmd(
    ws,
    next_id: list[int],
    method: str,
    params: dict | None = None,
    session_id: str | None = None,
    timeout: float = 30.0,
) -> dict:
    next_id[0] += 1
    msg: dict[str, Any] = {"id": next_id[0], "method": method}
    if params:
        msg["params"] = params
    if session_id:
        msg["sessionId"] = session_id
    await ws.send(json.dumps(msg))
    expected_id = next_id[0]
    while True:
        raw = await asyncio.wait_for(ws.recv(), timeout=timeout)
        env = json.loads(raw)
        if env.get("id") == expected_id:
            return env


async def enable_runtime_with_retry(ws, next_id: list[int], sid: str, label: str) -> bool:
    """Match production handshake.py: Runtime.enable + Debugger.enable, retry once after 500ms."""
    for attempt in (1, 2):
        try:
            resp = await send_cmd(ws, next_id, "Runtime.enable", session_id=sid, timeout=10.0)
            if "error" in resp:
                if attempt == 1:
                    print(f"  {label} Runtime.enable attempt 1 errored, retrying: {resp['error']}")
                    await asyncio.sleep(0.5)
                    continue
                print(f"FAIL {label} Runtime.enable: {resp['error']}")
                return False
            resp = await send_cmd(ws, next_id, "Debugger.enable", session_id=sid, timeout=10.0)
            if "error" in resp:
                if attempt == 1:
                    print(f"  {label} Debugger.enable attempt 1 errored, retrying: {resp['error']}")
                    await asyncio.sleep(0.5)
                    continue
                print(f"FAIL {label} Debugger.enable: {resp['error']}")
                return False
            return True
        except asyncio.TimeoutError:
            if attempt == 1:
                print(f"  {label} enable attempt 1 timed out, retrying after 500ms")
                await asyncio.sleep(0.5)
                continue
            print(f"FAIL {label} enable timed out after retry")
            return False
    return False


async def probe(host: str, port: int) -> int:
    targets = list_targets(host, port)
    page_targets = [t for t in targets if t.get("id") != BROWSER_TARGET_ID and t.get("type") == "page"]
    if len(page_targets) < 2:
        sys.stderr.write(
            f"FAIL: need ≥2 page targets in /json/list, found {len(page_targets)}.\n"
            f"Open a second preview in Lens Studio and re-run.\n"
        )
        return 1

    t1, t2 = page_targets[0], page_targets[1]
    print(f"target #1: id={t1['id']!r} title={t1.get('title', '')!r}")
    print(f"target #2: id={t2['id']!r} title={t2.get('title', '')!r}")

    url = f"ws://{host}:{port}/devtools/page/{BROWSER_TARGET_ID}"
    next_id = [0]

    async with websockets.connect(url, max_size=None) as ws:
        # Step 1: browser-level session (same as production handshake).
        resp = await send_cmd(ws, next_id, "Target.attachToBrowserTarget")
        if "error" in resp:
            print(f"FAIL attachToBrowserTarget: {resp['error']}")
            return 1
        browser_sid = resp["result"]["sessionId"]
        print(f"browser sessionId: {browser_sid}")

        # Step 1b: enable target discovery on the browser session — the
        # "flat session" prerequisite. Without this, the second
        # attachToTarget fails with "Target is already attached".
        # Verified against VS Code js-debug wire log.
        resp = await send_cmd(
            ws,
            next_id,
            "Target.setDiscoverTargets",
            params={"discover": True},
            session_id=browser_sid,
        )
        if "error" in resp:
            print(f"FAIL setDiscoverTargets: {resp['error']}")
            return 1
        print("setDiscoverTargets ok (flat-session mode enabled)")

        # Per-target setup. Attach + enable + evaluate-set sequentially so
        # each page session is fully ready before the next attach. Matches
        # the VS Code js-debug flow (attach, then setAutoAttach/Page.enable
        # on that session, before attaching the next).
        sids = []
        for label, t, mark in [("#1", t1, 1), ("#2", t2, 2)]:
            resp = await send_cmd(
                ws,
                next_id,
                "Target.attachToTarget",
                params={"targetId": t["id"], "flatten": True},
                session_id=browser_sid,
            )
            if "error" in resp:
                print(f"FAIL attachToTarget {label}: {resp['error']}")
                return 1
            sid = resp["result"]["sessionId"]
            print(f"target {label} sessionId: {sid}")
            sids.append(sid)

            if not await enable_runtime_with_retry(ws, next_id, sid, label):
                return 1
            print(f"  {label} Runtime/Debugger enabled")

            resp = await send_cmd(
                ws,
                next_id,
                "Runtime.evaluate",
                params={"expression": f"globalThis.__probe_mark = {mark}; globalThis.__probe_mark"},
                session_id=sid,
                timeout=10.0,
            )
            if "error" in resp:
                print(f"FAIL evaluate set on {label}: {resp['error']}")
                return 1
            value = resp.get("result", {}).get("result", {}).get("value")
            if value != mark:
                print(f"FAIL evaluate set on {label}: expected {mark}, got {value!r}")
                return 1
            print(f"  {label} evaluate-set ok ({mark})")

        if sids[0] == sids[1]:
            print(f"FAIL: both targets returned same sessionId ({sids[0]}) — LS may be merging sessions")
            return 1

        # Cross-read: prove the two sessions have independent globalThis.
        # Read #1's mark after #2 was set — if they share globals, #1 would show 2.
        for label, sid, expected in [("#1", sids[0], 1), ("#2", sids[1], 2)]:
            resp = await send_cmd(
                ws,
                next_id,
                "Runtime.evaluate",
                params={"expression": "globalThis.__probe_mark"},
                session_id=sid,
                timeout=10.0,
            )
            value = resp.get("result", {}).get("result", {}).get("value")
            if value != expected:
                print(
                    f"FAIL crosstalk on {label}: read back {value!r}, expected {expected}. "
                    "Two CDP sessions share globalThis — multiplexing model breaks."
                )
                return 1
            print(f"  {label} cross-read ok ({value})")

        sid1, sid2 = sids[0], sids[1]

        # Detach cleanly so we don't leave LS in a half-attached state.
        for sid in [sid1, sid2]:
            await send_cmd(
                ws,
                next_id,
                "Target.detachFromTarget",
                params={"sessionId": sid},
                session_id=browser_sid,
            )

    print("\nPASS: LS accepts two concurrent Target.attachToTarget on one WebSocket")
    print("and each page session has independent globalThis. Multiplexing model is viable.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="localhost")
    ap.add_argument("--port", type=int, default=9222)
    args = ap.parse_args()
    try:
        return asyncio.run(probe(args.host, args.port))
    except urllib.error.URLError as e:
        sys.stderr.write(f"FAIL: cannot reach http://{args.host}:{args.port}/json/list — {e}\n")
        sys.stderr.write("Is Lens Studio running with CDP enabled?\n")
        return 2


if __name__ == "__main__":
    sys.exit(main())
