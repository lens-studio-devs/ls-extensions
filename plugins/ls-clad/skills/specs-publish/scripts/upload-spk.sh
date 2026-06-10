#!/bin/bash
# Copyright 2026 Specs Inc.
# SPDX-License-Identifier: Apache-2.0

# publish · UPLOAD — PUT the SPK bytes to the signed URL returned by /lenses/publish.
#
# Inputs (env):
#   SPK_PATH             absolute path to the SPK to upload  (or pass as $1)
#   UPLOAD_URL           signed URL from publish: data.uploads.spk.url
#   UPLOAD_HEADERS_JSON  JSON object from publish: data.uploads.spk.headers   (default: {})
#   SPK_CHECKSUM         base64 SHA-256 from the package phase (added as x-amz-checksum-sha256
#                        when the signed headers don't already carry it)
#
# Prints {"status":"UPLOAD_DONE",...} on success; non-zero exit with an ERROR line otherwise.

set -euo pipefail

SPK_PATH="${SPK_PATH:-${1:-}}"
UPLOAD_URL="${UPLOAD_URL:-}"
if [ -z "${UPLOAD_HEADERS_JSON:-}" ]; then
  UPLOAD_HEADERS_JSON="{}"
fi
SPK_CHECKSUM="${SPK_CHECKSUM:-}"

[ -n "$SPK_PATH" ] || { echo "ERROR: SPK_PATH is required"; exit 1; }
[ -f "$SPK_PATH" ] || { echo "ERROR: SPK not found: $SPK_PATH"; exit 1; }
[ -n "$UPLOAD_URL" ] || { echo "ERROR: UPLOAD_URL is required"; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "ERROR: curl is required for SPK upload"; exit 1; }

HEADERS_FILE="$(mktemp "${TMPDIR:-/tmp}/publish-upload-headers.XXXXXX")"
BODY_FILE="$(mktemp "${TMPDIR:-/tmp}/publish-upload-body.XXXXXX")"
trap 'rm -f "$HEADERS_FILE" "$BODY_FILE"' EXIT

python3 - "$UPLOAD_HEADERS_JSON" "$SPK_CHECKSUM" > "$HEADERS_FILE" <<'HEADERS_PY'
import json
import sys

headers_json, checksum = sys.argv[1:3]
try:
    headers = json.loads(headers_json) if headers_json.strip() else {}
except json.JSONDecodeError as exc:
    print(f"ERROR: UPLOAD_HEADERS_JSON is not valid JSON: {exc}", file=sys.stderr)
    raise SystemExit(1)
if not isinstance(headers, dict):
    print("ERROR: UPLOAD_HEADERS_JSON must be a JSON object", file=sys.stderr)
    raise SystemExit(1)
headers = {str(key): str(value) for key, value in headers.items()}
if checksum and not any(key.lower() == "x-amz-checksum-sha256" for key in headers):
    headers["x-amz-checksum-sha256"] = checksum

for key, value in headers.items():
    header = f"{key}: {value}"
    if "\n" in header or "\r" in header:
        print("ERROR: upload headers must not contain newlines", file=sys.stderr)
        raise SystemExit(1)
    print(header)
HEADERS_PY

LOCAL_CHECKSUM="$(python3 - "$SPK_PATH" <<'CHECKSUM_PY'
import base64
import hashlib
import sys

digest = hashlib.sha256()
with open(sys.argv[1], "rb") as fh:
    for chunk in iter(lambda: fh.read(1024 * 1024), b""):
        digest.update(chunk)
print(base64.b64encode(digest.digest()).decode("ascii"))
CHECKSUM_PY
)"
if [ -n "$SPK_CHECKSUM" ] && [ "$LOCAL_CHECKSUM" != "$SPK_CHECKSUM" ]; then
  echo "ERROR: SnapOS Package checksum changed since publish registration. Re-run package and publish before uploading." >&2
  exit 1
fi

curl_args=(-sS -X PUT --connect-timeout 30 --max-time 600 -o "$BODY_FILE" -w '%{http_code}' --upload-file "$SPK_PATH")
while IFS= read -r header; do
  [ -z "$header" ] || curl_args+=(-H "$header")
done < "$HEADERS_FILE"

if ! HTTP_STATUS="$(curl "${curl_args[@]}" "$UPLOAD_URL")"; then
  echo "ERROR: upload failed" >&2
  if [ -s "$BODY_FILE" ]; then
    head -c 1000 "$BODY_FILE" >&2
    echo >&2
  fi
  exit 1
fi

case "$HTTP_STATUS" in
  200|201|204)
    printf '{"status":"UPLOAD_DONE","stage":"upload","httpStatus":%s}\n' "$HTTP_STATUS"
    ;;
  *)
    echo "ERROR: upload returned HTTP $HTTP_STATUS: $(head -c 1000 "$BODY_FILE")" >&2
    exit 1
    ;;
esac
