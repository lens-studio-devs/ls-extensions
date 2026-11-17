#!/usr/bin/env python3

# Copyright 2026 Specs Inc.
# SPDX-License-Identifier: Apache-2.0

"""Upload the SnapOS Package and every preview asset concurrently, in one call.

Replaces one `upload-spk.sh` launch plus one `upload-file.sh` launch per preview, each of
which needed its own retained process handle and its own join.

The manifest arrives as one JSON line on **stdin**, never as a file or an argv string: every
entry carries a presigned URL, and those are credentials. Reading one line instead of waiting
for EOF lets Lens Studio's Subprocess API feed the manifest directly without closing its stdin.
Nothing here writes a URL to disk or prints one — results identify an upload by its `label` and,
at most, the URL's host.

Input (stdin), one JSON object:

    {"uploads": [
      {"label": "spk",       "filePath": "...", "url": "https://…", "headers": {...}, "checksum": "base64…"},
      {"label": "preview:0", "filePath": "...", "url": "https://…", "headers": {...}, "checksum": "base64…"}
    ]}

Output, one JSON object. `UPLOADS_DONE` only when **every** upload succeeded; the caller must
not attach preview metadata or submit on anything else.

    {"status": "UPLOADS_DONE" | "UPLOADS_FAILED" | "FAILED",
     "uploads": [{"label": ..., "ok": true, "httpStatus": 200, "downloadUrl": "/v1/apps/content/download?key=…"}]}
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import queue
import select
import shutil
import subprocess
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlparse

# The SPK dominates; a handful of previews alongside it saturates a home connection well
# before this matters. Bounded so a large preview set cannot open an unbounded fan-out.
MAX_CONCURRENT = 4
CONNECT_TIMEOUT_SECONDS = 600
CHUNK = 1024 * 1024


def read_stdin_json(stdin_wait_seconds: float) -> Any:
    """Read one line of piped JSON with a bounded wait on both POSIX and Windows."""
    if sys.platform != "win32":
        if select.select([sys.stdin], [], [], stdin_wait_seconds)[0] == []:
            raise ValueError(f"no input on stdin after {stdin_wait_seconds:g}s: pipe one JSON line on stdin")
        line = sys.stdin.readline()
        if not line:
            raise ValueError("stdin closed before a JSON object was received")
        return json.loads(line)

    results: queue.Queue[Any] = queue.Queue(maxsize=1)

    def load_in_background() -> None:
        try:
            line = sys.stdin.readline()
            if not line:
                raise ValueError("stdin closed before a JSON object was received")
            results.put(json.loads(line))
        except Exception as error:
            results.put(error)

    threading.Thread(target=load_in_background, daemon=True).start()
    try:
        result = results.get(timeout=stdin_wait_seconds)
    except queue.Empty as error:
        raise ValueError(f"no input on stdin after {stdin_wait_seconds:g}s: pipe one JSON line on stdin") from error
    if isinstance(result, Exception):
        raise result
    return result


def read_json_input(explicit_path: str | None, *, stdin_wait_seconds: float = 5.0) -> Any:
    """Read the input JSON from a path, or from stdin.

    Blocking forever on an unfed stdin is not an acceptable failure mode: a real run called this
    with `--json <file>` — the convention every sibling helper uses — against a stdin-only
    version, and the process hung for minutes with no output. A bounded wait turns that into a
    diagnosis.
    """
    if explicit_path and explicit_path != "-":
        with Path(explicit_path).open(encoding="utf-8") as source:
            return json.load(source)
    if sys.stdin.isatty():
        raise ValueError("no input: pipe one JSON line on stdin")
    return read_stdin_json(stdin_wait_seconds)


def fail(reason: str, message: str) -> int:
    print(json.dumps({"status": "FAILED", "stage": "upload", "reason": reason, "message": message}, sort_keys=True))
    return 2


def base64_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(CHUNK), b""):
            digest.update(chunk)
    return base64.b64encode(digest.digest()).decode("ascii")


def download_url_for(upload_url: str) -> str:
    """Dev Dash content URL for an uploaded object, derived from the signed URL's path."""
    key = urlparse(upload_url).path.lstrip("/")
    return f"/v1/apps/content/download?key={quote(key, safe='')}" if key else ""


def curl_config_quote(value: str) -> str:
    """Quote a curl config value without losing Windows path separators."""
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def upload_one(entry: dict[str, Any]) -> dict[str, Any]:
    label = str(entry.get("label") or "?")
    result: dict[str, Any] = {"label": label, "ok": False}
    try:
        file_path = Path(str(entry["filePath"]))
        upload_url = str(entry["url"])
        headers = {str(k): str(v) for k, v in (entry.get("headers") or {}).items()}
        expected = entry.get("checksum")
    except (KeyError, TypeError) as error:
        result["error"] = f"malformed manifest entry: {error}"
        return result

    if not file_path.is_file():
        result["error"] = f"file not found: {file_path.name}"
        return result

    # Identity check before the bytes go anywhere. A file that changed since its upload was
    # registered would upload cleanly and then fail the backend's checksum, after the
    # registration has already been consumed.
    try:
        actual = base64_sha256(file_path)
        size = file_path.stat().st_size
    except OSError as error:
        result["error"] = f"could not read upload file: {error}"
        return result
    if expected and actual != expected:
        result["error"] = "file changed since its upload was registered; re-register before uploading"
        result["checksumMismatch"] = True
        return result
    if expected and not any(key.lower() == "x-amz-checksum-sha256" for key in headers):
        headers["x-amz-checksum-sha256"] = expected

    config_values = [upload_url, str(file_path), *(f"{key}: {value}" for key, value in headers.items())]
    if any("\n" in value or "\r" in value for value in config_values):
        result["error"] = "curl config value contains a newline"
        return result
    for key, value in headers.items():
        if "\n" in key or "\r" in key or "\n" in value or "\r" in value:
            result["error"] = "upload header contains a newline"
            return result

    # curl, not urllib: it uses the system trust store. A stock macOS Python has no local
    # issuer certificates, so urllib fails every presigned PUT with CERTIFICATE_VERIFY_FAILED
    # while curl succeeds — found by a live run, not by a unit test.
    #
    # The URL and headers go in a curl config on **stdin** (`-K -`), never argv, so the
    # presigned credential never appears in the process table. The body is `--upload-file`,
    # which leaves stdin free for the config.
    config_lines = [
        f"url = {curl_config_quote(upload_url)}",
        "request = PUT",
        f"upload-file = {curl_config_quote(str(file_path))}",
        "silent",
        "show-error",
        "connect-timeout = 30",
        f"max-time = {CONNECT_TIMEOUT_SECONDS}",
        'write-out = "%{http_code}"',
    ] + [f"header = {curl_config_quote(f'{key}: {value}')}" for key, value in headers.items()]

    try:
        completed = subprocess.run(
            ["curl", "-K", "-", "--output", os.devnull],
            input="\n".join(config_lines),
            capture_output=True,
            text=True,
            timeout=CONNECT_TIMEOUT_SECONDS + 30,
        )
    except subprocess.TimeoutExpired:
        result["error"] = "upload timed out"
        result["host"] = urlparse(upload_url).hostname or ""
        return result

    http_status = 0
    if completed.stdout.strip().isdigit():
        http_status = int(completed.stdout.strip())
    result["httpStatus"] = http_status
    if completed.returncode != 0:
        result["error"] = f"curl exit {completed.returncode}: {completed.stderr.strip()[:300]}"
        result["host"] = urlparse(upload_url).hostname or ""
        return result
    result["ok"] = 200 <= http_status < 300
    if not result["ok"]:
        result["error"] = f"HTTP {http_status}"

    if result["ok"]:
        result["bytes"] = size
        download_url = download_url_for(upload_url)
        if download_url:
            result["downloadUrl"] = download_url
    return result


def main() -> int:
    try:
        # Deliberately stdin-only: every entry carries a presigned URL. But an unfed stdin must
        # fail fast rather than hang, so the wait is bounded.
        payload = read_json_input(None)
    except (ValueError, OSError) as error:
        return fail("manifest_unreadable", f"stdin must be one JSON line: {error}")
    if not isinstance(payload, dict):
        return fail("manifest_unreadable", "stdin must be a JSON object on one line")

    if shutil.which("curl") is None:
        return fail("curl_missing", "curl is required to upload to a presigned URL")

    uploads = payload.get("uploads")
    if not isinstance(uploads, list) or not uploads:
        return fail("no_uploads", "uploads must be a non-empty array")

    labels = [str(entry.get("label") or "") for entry in uploads if isinstance(entry, dict)]
    if len(set(labels)) != len(uploads) or "" in labels:
        return fail("duplicate_labels", "every upload needs a distinct non-empty label")

    with ThreadPoolExecutor(max_workers=min(MAX_CONCURRENT, len(uploads))) as pool:
        results = list(pool.map(upload_one, uploads))

    # Preserve the caller's order so results line up with previewIndex.
    by_label = {str(item["label"]): item for item in results}
    ordered = [by_label[label] for label in labels]
    every_ok = all(item.get("ok") for item in ordered)

    print(
        json.dumps(
            {
                "status": "UPLOADS_DONE" if every_ok else "UPLOADS_FAILED",
                "stage": "upload",
                "uploadCount": len(ordered),
                "okCount": sum(1 for item in ordered if item.get("ok")),
                "uploads": ordered,
            },
            sort_keys=True,
        )
    )
    return 0 if every_ok else 1


if __name__ == "__main__":
    sys.exit(main())
