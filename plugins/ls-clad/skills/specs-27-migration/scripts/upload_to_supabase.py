#!/usr/bin/env python3
# Copyright 2026 Specs Inc.
# SPDX-License-Identifier: Apache-2.0

"""Upload a single file to a Supabase storage bucket and print the public URL.

Cross-platform (macOS / Linux / Windows) — uses only the Python standard library.

Usage:
    upload_to_supabase.py <localFilePath> <bucket> <objectKey> [contentType]

Discovery:
    - SUPABASE_URL: defaults to http://127.0.0.1:54321; override via env.
    - SERVICE_KEY:  if not set, pulled from `docker exec supabase_storage_<user> env`.

Behavior:
    - Creates the bucket if missing (public, 50 MiB limit).
    - Uploads with `x-upsert: true` so re-runs overwrite cleanly.
    - Verifies the public URL returns 200 and the byte count matches.

Exit codes: 64 = usage error, 1 = runtime failure, 0 = success.
"""

import getpass
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request


def usage(stream=sys.stdout):
    print(
        "usage: upload_to_supabase.py <localFilePath> <bucket> <objectKey> [contentType]\n\n"
        "Uploads a file to a public Supabase Storage bucket and prints the public URL.\n"
        "Set SUPABASE_URL and SERVICE_KEY for hosted/Souffle projects.",
        file=stream,
    )


def die(msg, code=1):
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(code)


def request(method, url, service_key, *, data=None, content_type=None, expect_body=True):
    """Perform an HTTP request. Returns (status_code, body_bytes). Never raises on HTTP error."""
    headers = {"Authorization": f"Bearer {service_key}"}
    if content_type:
        headers["Content-Type"] = content_type
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, (resp.read() if expect_body else b"")
    except urllib.error.HTTPError as e:
        return e.code, (e.read() if expect_body else b"")
    except urllib.error.URLError as e:
        die(f"could not reach {url}: {e.reason}")


def discover_service_key():
    key = os.environ.get("SERVICE_KEY")
    if key:
        return key
    container = f"supabase_storage_{getpass.getuser()}"
    try:
        out = subprocess.run(
            ["docker", "exec", container, "env"],
            capture_output=True,
            text=True,
            check=True,
        ).stdout
    except FileNotFoundError:
        die("SERVICE_KEY not set and `docker` not found. Set SERVICE_KEY env var explicitly.")
    except subprocess.CalledProcessError:
        die(f"SERVICE_KEY not set and container {container} not running. Set SERVICE_KEY env var explicitly.")
    for line in out.splitlines():
        if line.startswith("SERVICE_KEY="):
            return line[len("SERVICE_KEY=") :]
    die(f"could not read SERVICE_KEY from {container}")


def main(argv):
    if argv and argv[0] in ("-h", "--help"):
        usage()
        return 0
    if len(argv) < 3:
        usage(sys.stderr)
        return 64

    file_path, bucket, key = argv[0], argv[1], argv[2]
    ctype = argv[3] if len(argv) > 3 else "application/octet-stream"

    supabase_url = os.environ.get("SUPABASE_URL", "http://127.0.0.1:54321").rstrip("/")

    if not re.fullmatch(r"[A-Za-z0-9._-]+", bucket):
        die(f"bucket must contain only letters, digits, dot, underscore, and hyphen: {bucket}", 64)
    if not re.fullmatch(r"[A-Za-z0-9._~/-]+", key) or key.startswith("/") or key.endswith("/"):
        die(f"objectKey must be a relative path using URL-safe characters: {key}", 64)
    if "\n" in ctype or "\r" in ctype:
        die("contentType cannot contain newlines", 64)
    if not os.path.isfile(file_path):
        die(f"file not found: {file_path}")

    service_key = discover_service_key()

    # Idempotent bucket creation. A 409 (already exists) is fine — we don't care.
    bucket_body = json.dumps({"id": bucket, "name": bucket, "public": True, "file_size_limit": 52428800}).encode()
    request("POST", f"{supabase_url}/storage/v1/bucket", service_key, data=bucket_body, content_type="application/json")

    # Upload.
    with open(file_path, "rb") as fh:
        payload = fh.read()
    # x-upsert lets re-runs overwrite cleanly.
    upload_headers = {
        "Authorization": f"Bearer {service_key}",
        "Content-Type": ctype,
        "x-upsert": "true",
    }
    upload_req = urllib.request.Request(
        f"{supabase_url}/storage/v1/object/{bucket}/{key}",
        data=payload,
        method="POST",
        headers=upload_headers,
    )
    try:
        with urllib.request.urlopen(upload_req) as resp:
            upload_resp = resp.read().decode(errors="replace")
    except urllib.error.HTTPError as e:
        die(f"upload failed: HTTP {e.code} {e.read().decode(errors='replace')}")
    except urllib.error.URLError as e:
        die(f"upload failed: {e.reason}")

    if '"Key"' not in upload_resp:
        die(f"upload failed: {upload_resp}")

    public_url = f"{supabase_url}/storage/v1/object/public/{bucket}/{key}"

    # Verify byte count.
    local_size = os.path.getsize(file_path)
    status, body = request("GET", public_url, service_key)
    if status != 200 or len(body) != local_size:
        die(f"verify failed: HTTP {status}, {len(body)} bytes (local was {local_size})")

    print(public_url)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
