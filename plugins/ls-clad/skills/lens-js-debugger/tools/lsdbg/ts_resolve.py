# Copyright 2026 Specs Inc.
# SPDX-License-Identifier: Apache-2.0

from __future__ import annotations

import base64
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional
from urllib.parse import unquote, urlparse
from urllib.request import url2pathname

from .sourcemap import SourceMap, find_generated_line, find_source_index, parse_source_map


class TsResolveError(Exception):
    pass


@dataclass
class ResolvedLocation:
    url: str  # compiled .js URL — ready for Debugger.setBreakpointByUrl
    line: int  # 0-based generated line — ready for the same


@dataclass
class ScriptInfo:
    url: str
    sourceMapURL: str


def resolve_ts_breakpoint(
    query: str,
    line_1based: int,
    scripts: list[ScriptInfo],
    fetch_map: Any,  # Callable[[str, str], str]
    cache: Optional[dict[tuple[str, str], SourceMap]] = None,
) -> ResolvedLocation:
    if line_1based <= 0:
        raise TsResolveError(
            f"line {line_1based} is invalid for a .ts breakpoint — "
            "TypeScript line numbers are 1-based (matches your editor)"
        )
    source_line_0based = line_1based - 1

    if cache is None:
        cache = {}

    tried_with_map = 0
    failures: list[str] = []

    for script in scripts:
        if not script.sourceMapURL:
            continue
        tried_with_map += 1
        key = (script.url, script.sourceMapURL)
        sm = cache.get(key)
        if sm is None:
            try:
                raw = fetch_map(script.url, script.sourceMapURL)
                sm = parse_source_map(raw)
            except (OSError, ValueError, json.JSONDecodeError) as e:
                failures.append(f"  {script.url}: {e}")
                continue
            cache[key] = sm

        idx = find_source_index(sm, query)
        if idx is None:
            continue

        gen_line = find_generated_line(sm, idx, source_line_0based)
        if gen_line is None:
            raise TsResolveError(
                f"source map for '{script.url}' contains '{query}' but has no mapping "
                f"on or after line {line_1based} — try a line with executable code"
            )
        return ResolvedLocation(url=script.url, line=gen_line)

    if tried_with_map == 0:
        raise TsResolveError(
            f"no parsed script carries a sourceMapURL — cannot resolve '{query}'. "
            "If the lens hasn't booted yet, breakpoints set before scriptParsed "
            "won't auto-resolve. "
            "Workaround: set the breakpoint on the compiled .js path directly."
        )
    detail = "".join(f"\n{line}" for line in failures) if failures else ""
    raise TsResolveError(f"no source map listed '{query}' as a source (checked {tried_with_map} script(s)){detail}")


# ---------- default fetcher (file:// + data:) ----------


def default_fetch_map(script_url: str, source_map_url: str) -> str:
    if source_map_url.startswith("data:"):
        return _decode_data_uri(source_map_url)

    parsed = urlparse(source_map_url)
    if parsed.scheme == "file":
        return _read_file_url(source_map_url)
    if parsed.scheme in ("http", "https"):
        raise OSError(f"refusing to fetch source map over {parsed.scheme}: {source_map_url}")

    # Relative — resolve against the script URL.
    script_parsed = urlparse(script_url)
    if script_parsed.scheme != "file":
        raise OSError(f"can't resolve relative sourceMappingURL against non-file script: {script_url}")
    # url2pathname handles percent-decoding and the file-URL→path translation
    # cross-platform — on Windows it strips the spurious leading slash that
    # unquote() leaves on `/C:/...`, which Path() would mis-anchor.
    script_path = Path(url2pathname(script_parsed.path))
    map_path = (script_path.parent / source_map_url).resolve()
    return map_path.read_text(encoding="utf-8")


def _decode_data_uri(uri: str) -> str:
    body = uri[len("data:") :]
    head, _, payload = body.partition(",")
    if not _:
        raise ValueError("malformed data URI: missing comma separator")
    is_base64 = ";base64" in head
    if is_base64:
        try:
            decoded = base64.b64decode(payload, validate=False)
        except Exception as e:  # base64 raises a grab-bag of exceptions
            raise ValueError(f"base64 decode failed: {e}") from e
        return decoded.decode("utf-8", errors="replace")
    # Percent-decoded text. Some emitters URL-encode; some don't.
    return unquote(payload)


def _read_file_url(url: str) -> str:
    parsed = urlparse(url)
    # See default_fetch_map — url2pathname for correct cross-platform
    # (esp. Windows `/C:/...`) file-URL→path translation.
    path = Path(url2pathname(parsed.path))
    return path.read_text(encoding="utf-8")
