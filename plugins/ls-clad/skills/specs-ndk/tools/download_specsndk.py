#!/usr/bin/env python3
# Copyright 2026 Specs Inc.
# SPDX-License-Identifier: Apache-2.0

"""Probe and download SpecsNDK archives (specs.s.gy) using stdlib urllib.

Agents and setup docs should call this instead of curl. Optional httpx works
similarly if you already depend on it; this script stays dependency-free.
"""

from __future__ import annotations

import argparse
import os
import sys
import urllib.error
import urllib.request

DEFAULT_TIMEOUT_PROBE = 60
DEFAULT_TIMEOUT_DOWNLOAD = 3600
CHUNK_BYTES = 1024 * 1024


def _request(
    url: str,
    *,
    method: str = "GET",
    bearer: str | None = None,
    timeout: float,
) -> urllib.request.Request:
    headers: dict[str, str] = {}
    if bearer:
        headers["Authorization"] = f"Bearer {bearer}"
    return urllib.request.Request(url, headers=headers, method=method)


def probe_url(url: str, *, timeout: float = DEFAULT_TIMEOUT_PROBE) -> int:
    """Return HTTP status for url (follows redirects). Tries HEAD, then GET."""
    for method in ("HEAD", "GET"):
        req = _request(url, method=method, timeout=timeout)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return int(resp.status)
        except urllib.error.HTTPError as exc:
            if method == "HEAD" and exc.code in (405, 501):
                continue
            return int(exc.code)
        except urllib.error.URLError as exc:
            print(f"probe failed: {exc}", file=sys.stderr)
            return 0
    return 0


def download_url(
    url: str,
    dest: str,
    *,
    bearer: str | None = None,
    timeout: float = DEFAULT_TIMEOUT_DOWNLOAD,
) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(dest)) or ".", exist_ok=True)
    req = _request(url, method="GET", bearer=bearer, timeout=timeout)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            status = int(resp.status)
            if status >= 400:
                raise urllib.error.HTTPError(url, status, resp.reason, resp.headers, None)
            with open(dest, "wb") as out:
                while True:
                    chunk = resp.read(CHUNK_BYTES)
                    if not chunk:
                        break
                    out.write(chunk)
    except urllib.error.HTTPError as exc:
        print(f"download failed: HTTP {exc.code} {exc.reason}", file=sys.stderr)
        raise SystemExit(1) from exc
    except urllib.error.URLError as exc:
        print(f"download failed: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc


def main() -> None:
    parser = argparse.ArgumentParser(description="Probe or download SpecsNDK from specs.s.gy")
    sub = parser.add_subparsers(dest="command", required=True)

    p_probe = sub.add_parser("probe", help="Print HTTP status (for 3a)")
    p_probe.add_argument("--url", required=True)

    p_dl = sub.add_parser("download", help="Download archive to --out (3b / 3d)")
    p_dl.add_argument("--url", required=True)
    p_dl.add_argument("--out", required=True)
    p_dl.add_argument(
        "--bearer",
        default=None,
        help="Bearer token (or set SPECSNDK_BEARER_TOKEN)",
    )

    args = parser.parse_args()
    if args.command == "probe":
        code = probe_url(args.url)
        if code == 0:
            raise SystemExit(1)
        print(f"HTTP {code}")
        return

    bearer = args.bearer or os.environ.get("SPECSNDK_BEARER_TOKEN")
    download_url(args.url, args.out, bearer=bearer)


if __name__ == "__main__":
    main()
