#!/usr/bin/env python3
"""Minimal direct client for the Lens Studio MCP HTTP endpoint (no agent in the loop).

Reads the project's .mcp.json for url + bearer, does the MCP initialize handshake if the server
requires it, then exposes list_tools() / call(tool, args) with per-call wall-clock timing.

  python3 mcp_client.py <project_dir> --list                 # dump tool names
  python3 mcp_client.py <project_dir> --schema MovePreviewCamera CapturePanelScreenshotTool
"""

from __future__ import annotations

import json
import sys
import time
import urllib.request
from pathlib import Path


def parse_response(raw: str, req_id=None) -> dict:
    """The JSON-RPC reply in a JSON or SSE (text/event-stream) body.

    An SSE stream can carry notifications before the reply, so pick the message that has ``result`` or
    ``error`` (preferring a matching ``id``), not simply the last ``data:`` line. A body that holds no JSON-RPC
    reply (an HTML error page, a proxy login redirect, truncated output) becomes an explicit error, so
    callers never mistake it for a successful call."""
    messages = []
    text = raw.strip()
    if text.startswith("{"):
        try:
            messages.append(json.loads(text))
        except ValueError:
            pass
    else:
        for line in raw.splitlines():
            if line.startswith("data:"):
                try:
                    messages.append(json.loads(line[5:].strip()))
                except ValueError:
                    continue
    replies = [m for m in messages if isinstance(m, dict) and ("result" in m or "error" in m)]
    matching = [m for m in replies if req_id is not None and m.get("id") == req_id]
    if matching or replies:
        return (matching or replies)[-1]
    return {"error": {"code": -32700, "message": "no JSON-RPC reply in the MCP response", "data": raw[:400]}}


# Tools that observe or drive one preview through `previewName`.
PREVIEW_TOOLS = frozenset(
    {
        "InjectPreviewGesture",
        "PreviewInteractTool",
        "MovePreviewCamera",
        "QueryRuntimeSceneTool",
        "CaptureRuntimeViewTool",
        "CapturePanelScreenshotTool",
        "RunAndCollectLogsTool",
    }
)


class MCP:
    def __init__(self, project_dir: str):
        cfg = json.load(open(Path(project_dir) / ".mcp.json"))
        s = cfg["mcpServers"]["lens-studio"]
        self.url = s["url"]
        self.headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            **(s.get("headers") or {}),
        }
        self._id = 0
        self.session = None
        self.log: list[dict] = []
        # When set, preview-tool calls without their own previewName target this preview.
        self.preview_name: str | None = None

    def _post(self, payload: dict, timeout: float = 120.0):
        body = json.dumps(payload).encode()
        h = dict(self.headers)
        if self.session:
            h["Mcp-Session-Id"] = self.session
        req = urllib.request.Request(self.url, data=body, headers=h)
        with urllib.request.urlopen(req, timeout=timeout) as r:
            sid = r.headers.get("Mcp-Session-Id")
            if sid:
                self.session = sid
            raw = r.read().decode(errors="replace")
        return parse_response(raw, payload.get("id"))

    def _rpc(self, method: str, params: dict | None = None, timeout: float = 120.0):
        self._id += 1
        return self._post({"jsonrpc": "2.0", "id": self._id, "method": method, "params": params or {}}, timeout=timeout)

    def initialize(self):
        r = self._rpc(
            "initialize",
            {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "capture-driver", "version": "1.0"},
            },
        )
        try:
            self._post({"jsonrpc": "2.0", "method": "notifications/initialized", "params": {}})
        except Exception:
            pass
        return r

    def list_tools(self):
        return (self._rpc("tools/list").get("result") or {}).get("tools", [])

    def call(self, tool: str, args: dict, timeout: float = 180.0):
        """Call a tool; record start/end/duration in self.log.

        NEVER raises: a transport failure (e.g. the LS MCP server dropping the connection during a
        long recordVideo) is recorded as an error and returned as None, so one bad phase cannot
        destroy the rest of the run or its timeline."""
        if self.preview_name and tool in PREVIEW_TOOLS and "previewName" not in args:
            args = {**args, "previewName": self.preview_name}
        t0 = time.time()
        resp = None
        err = None
        try:
            resp = self._rpc("tools/call", {"name": tool, "arguments": args}, timeout=timeout)
        except Exception as e:
            err = f"{type(e).__name__}: {e}"[:300]
        t1 = time.time()
        if err is None and isinstance(resp, dict):
            if resp.get("error"):
                err = json.dumps(resp["error"])[:300]
            elif (resp.get("result") or {}).get("isError"):
                err = json.dumps((resp["result"].get("content") or [])[:1])[:300]
        self.log.append(
            {
                "tool": tool,
                "start": t0,
                "end": t1,
                "dur": round(t1 - t0, 3),
                "args": json.dumps(args)[:200],
                "error": err,
            }
        )
        print(f"  [{t1 - t0:6.2f}s] {tool}{' ERROR: ' + err if err else ''}", flush=True)
        return resp

    def text(self, resp) -> str:
        """Flatten a tool result's content blocks to text."""
        out = []
        for b in ((resp or {}).get("result") or {}).get("content", []) or []:
            if isinstance(b, dict) and b.get("type") == "text":
                out.append(b.get("text") or "")
        return "\n".join(out)


def main() -> None:
    proj = sys.argv[1]
    m = MCP(proj)
    m.initialize()
    tools = m.list_tools()
    if "--list" in sys.argv:
        for t in sorted(tools, key=lambda x: x.get("name", "")):
            print(t.get("name"))
        print(f"\n{len(tools)} tools")
        return
    if "--schema" in sys.argv:
        want = sys.argv[sys.argv.index("--schema") + 1 :]
        for t in tools:
            if t.get("name") in want:
                print(f"\n=== {t['name']} ===")
                print((t.get("description") or "")[:300])
                print(json.dumps(t.get("inputSchema") or {}, indent=1)[:2000])


if __name__ == "__main__":
    main()
