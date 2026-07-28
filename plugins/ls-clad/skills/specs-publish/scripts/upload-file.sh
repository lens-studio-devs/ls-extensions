#!/bin/bash
# Copyright 2026 Specs Inc.
# SPDX-License-Identifier: Apache-2.0

# publish · UPLOAD FILE — PUT a local preview image/video to a signed upload URL.
#
# Inputs (env):
#   FILE_PATH            absolute path to the preview file to upload (or pass as $1)
#   UPLOAD_URL           signed URL returned by /apps/upload
#   UPLOAD_HEADERS_JSON  JSON object returned by /apps/upload: data.requiredHeaders or data.headers (default: {})
#   FILE_CHECKSUM        expected base64 SHA-256 for the file (also added as x-amz-checksum-sha256
#                        when the signed headers don't already carry it)
#
# Prints {"status":"UPLOAD_DONE",...,"downloadUrl":...} on success; non-zero exit with an ERROR line otherwise.

set -euo pipefail

FILE_PATH="${FILE_PATH:-${1:-}}"
UPLOAD_URL="${UPLOAD_URL:-}"
if [ -z "${UPLOAD_HEADERS_JSON:-}" ]; then
  UPLOAD_HEADERS_JSON="{}"
fi
FILE_CHECKSUM="${FILE_CHECKSUM:-${EXPECTED_CHECKSUM:-}}"

[ -n "$FILE_PATH" ] || { echo "ERROR: Preview media path is missing"; exit 1; }
[ -f "$FILE_PATH" ] || { echo "ERROR: Preview media file not found: $FILE_PATH"; exit 1; }
[ -n "$UPLOAD_URL" ] || { echo "ERROR: Preview media upload destination is missing"; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "ERROR: curl is required to upload preview media"; exit 1; }

HEADERS_FILE="$(mktemp "${TMPDIR:-/tmp}/publish-file-upload-headers.XXXXXX")"
BODY_FILE="$(mktemp "${TMPDIR:-/tmp}/publish-file-upload-body.XXXXXX")"
trap 'rm -f "$HEADERS_FILE" "$BODY_FILE"' EXIT

python3 - "$UPLOAD_HEADERS_JSON" "$FILE_CHECKSUM" > "$HEADERS_FILE" <<'HEADERS_PY'
import json
import sys

headers_json, checksum = sys.argv[1:3]
try:
    headers = json.loads(headers_json) if headers_json.strip() else {}
except json.JSONDecodeError as exc:
    print(f"ERROR: Preview media upload configuration is not valid JSON: {exc}", file=sys.stderr)
    raise SystemExit(1)
if not isinstance(headers, dict):
    print("ERROR: Preview media upload configuration must be a JSON object", file=sys.stderr)
    raise SystemExit(1)
headers = {str(key): str(value) for key, value in headers.items()}
if checksum and not any(key.lower() == "x-amz-checksum-sha256" for key in headers):
    headers["x-amz-checksum-sha256"] = checksum

for key, value in headers.items():
    header = f"{key}: {value}"
    if "\n" in header or "\r" in header:
        print("ERROR: Preview media upload configuration must not contain newlines", file=sys.stderr)
        raise SystemExit(1)
    print(header)
HEADERS_PY

LOCAL_CHECKSUM="$(python3 - "$FILE_PATH" <<'CHECKSUM_PY'
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
if [ -n "$FILE_CHECKSUM" ] && [ "$LOCAL_CHECKSUM" != "$FILE_CHECKSUM" ]; then
  echo "ERROR: Preview media changed since upload registration. Re-register the upload before uploading." >&2
  exit 1
fi

DOWNLOAD_URL="$(python3 - "$UPLOAD_URL" <<'DOWNLOAD_URL_PY'
from urllib.parse import quote, urlparse
import sys

upload_url = sys.argv[1]
key = urlparse(upload_url).path.lstrip("/")
print(f"/v1/apps/content/download?key={quote(key, safe='')}" if key else "")
DOWNLOAD_URL_PY
)"

curl_args=(-sS -X PUT --connect-timeout 30 --max-time 600 -o "$BODY_FILE" -w '%{http_code}' --upload-file "$FILE_PATH")
while IFS= read -r header; do
  [ -z "$header" ] || curl_args+=(-H "$header")
done < "$HEADERS_FILE"

if ! HTTP_STATUS="$(curl "${curl_args[@]}" "$UPLOAD_URL")"; then
  echo "ERROR: Preview media upload failed" >&2
  if [ -s "$BODY_FILE" ]; then
    head -c 1000 "$BODY_FILE" >&2
    echo >&2
  fi
  exit 1
fi

case "$HTTP_STATUS" in
  200|201|204)
    python3 - "$HTTP_STATUS" "$DOWNLOAD_URL" <<'RESULT_PY'
import json
import sys

result = {
    "status": "UPLOAD_DONE",
    "stage": "upload",
    "httpStatus": int(sys.argv[1]),
}
if sys.argv[2]:
    result["downloadUrl"] = sys.argv[2]
print(json.dumps(result, separators=(",", ":")))
RESULT_PY
    ;;
  *)
    echo "ERROR: Preview media upload returned HTTP $HTTP_STATUS: $(head -c 1000 "$BODY_FILE")" >&2
    exit 1
    ;;
esac
