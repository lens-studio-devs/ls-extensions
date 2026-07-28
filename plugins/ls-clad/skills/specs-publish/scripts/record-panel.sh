#!/bin/bash
# Copyright 2026 Specs Inc.
# SPDX-License-Identifier: Apache-2.0

# publish · RECORD PANEL — record the Lens Studio Preview panel region
# via macOS screen recording and encode a store-shaped preview video
# (portrait 3:4, 720x960, 30 fps, silent).
#
# The script blocks for the full recording duration. Run it in the BACKGROUND and
# drive the lens choreography (LEAF demo scenario or MovePreviewCamera beats) while
# it records — see references/preview-video-capture.md.
#
# Inputs (env):
#   PANEL_RECT_JSON   {"x":..,"y":..,"width":..,"height":..} — Preview panel rect in
#                     global screen points, from scripts/get-preview-rect.ts (required)
#   OUTPUT_PATH       absolute path for the encoded .mp4 (required; parent must exist)
#   DURATION_SECONDS  recording length in seconds, clamped to 5–28 (default 20)
#   ACTIVATE_APP      app to bring frontmost before recording (default "Lens Studio")
#
# Prints one JSON object with a `status`:
#   VIDEO_READY      → path, width, height, durationSeconds, bytes,
#                      nativeCropWidth, nativeCropHeight, upscaled, displayIndex
#   ACTION_REQUIRED  → reason: no_screen_recording_permission | panel_offscreen | ffmpeg_missing
#   FAILED           → reason, message

set -euo pipefail

emit() { # status reason message
  python3 -c 'import json,sys; print(json.dumps({"status": sys.argv[1], "reason": sys.argv[2], "message": sys.argv[3]}))' "$1" "$2" "$3"
}

# Automated screen capture is macOS-only (screencapture / swift CoreGraphics / osascript).
# Fail early and clearly on other OSes so the caller routes to a fallback rather than
# hitting a confusing tool-not-found error.
if [ "$(uname 2>/dev/null)" != "Darwin" ]; then
  emit ACTION_REQUIRED unsupported_os "Automated preview-video screen capture is macOS-only. On this OS, record the preview manually via Lens Studio (Preview → Record) or use an auto-generated preview image instead. Do not retry this script."
  exit 1
fi

for TOOL in python3 osascript screencapture; do
  command -v "$TOOL" >/dev/null 2>&1 || { emit FAILED missing_tool "Required tool not found: $TOOL (macOS only)"; exit 1; }
done
command -v swift >/dev/null 2>&1 || { emit FAILED swift_missing "swift is required for display/permission checks — install Xcode Command Line Tools (xcode-select --install)"; exit 1; }
{ command -v ffmpeg >/dev/null 2>&1 && command -v ffprobe >/dev/null 2>&1; } || { emit ACTION_REQUIRED ffmpeg_missing "ffmpeg/ffprobe are required to encode the preview video — install with: brew install ffmpeg"; exit 1; }

PANEL_RECT_JSON="${PANEL_RECT_JSON:-}"
OUTPUT_PATH="${OUTPUT_PATH:-}"
ACTIVATE_APP="${ACTIVATE_APP:-Lens Studio}"
[ -n "$PANEL_RECT_JSON" ] || { emit FAILED missing_input "PANEL_RECT_JSON is required (run scripts/get-preview-rect.ts first)"; exit 1; }
[ -n "$OUTPUT_PATH" ] || { emit FAILED missing_input "OUTPUT_PATH is required"; exit 1; }
[ -d "$(dirname "$OUTPUT_PATH")" ] || { emit FAILED missing_input "OUTPUT_PATH parent directory does not exist: $(dirname "$OUTPUT_PATH")"; exit 1; }
DURATION="$(python3 -c 'import sys; d = int(float(sys.argv[1] or 20)); print(max(5, min(28, d)))' "${DURATION_SECONDS:-20}")"

# Screen Recording permission (TCC) — preflight before recording a black screen.
GRANTED="$(swift -e 'import CoreGraphics
print(CGPreflightScreenCaptureAccess() ? "granted" : "denied")' 2>/dev/null || echo unknown)"
if [ "$GRANTED" = "denied" ]; then
  emit ACTION_REQUIRED no_screen_recording_permission "Grant Screen Recording to this terminal app in System Settings → Privacy & Security → Screen Recording, then fully restart the terminal app and retry."
  exit 1
fi

# Enumerate displays (index, origin, size — in points, global coordinate space).
DISPLAYS="$(swift -e 'import CoreGraphics
var ids = [CGDirectDisplayID](repeating: 0, count: 16); var cnt: UInt32 = 0
CGGetActiveDisplayList(16, &ids, &cnt)
for i in 0..<Int(cnt) {
  let b = CGDisplayBounds(ids[i])
  print(i + 1, b.origin.x, b.origin.y, b.size.width, b.size.height)
}')"

# Find the display containing the entire panel; compute the display-local crop (points).
# A single-display recording cannot faithfully capture a panel that is partly off-screen or
# straddles displays, so reject those geometries before any desktop pixels are recorded.
GEOM="$(python3 - "$PANEL_RECT_JSON" "$DISPLAYS" <<'PY'
import json, sys
rect = json.loads(sys.argv[1])
x, y = float(rect["x"]), float(rect["y"])
rw, rh = float(rect["width"]), float(rect["height"])
x2, y2 = x + rw, y + rh
for line in sys.argv[2].splitlines():
    n, ox, oy, w, h = line.split()
    ox, oy, w, h = map(float, (ox, oy, w, h))
    if rw > 0 and rh > 0 and ox <= x and oy <= y and x2 <= ox + w and y2 <= oy + h:
        print(n, int(x - ox), int(y - oy), int(rw), int(rh), int(w))
        break
else:
    print("OFFSCREEN")
PY
)"
if [ "$GEOM" = "OFFSCREEN" ]; then
  emit ACTION_REQUIRED panel_offscreen "The Preview panel is not fully contained within one connected display — move the Lens Studio window fully onto a single display and retry. (Known causes: a disconnected external display or a window straddling displays; see references/preview-video-capture.md recovery.)"
  exit 1
fi
read -r DISPNUM CROPX CROPY CROPW CROPH DISPW <<< "$GEOM"

CAPTURE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/preview-capture.XXXXXX")"
trap 'rm -rf "$CAPTURE_DIR"' EXIT
RAW="$CAPTURE_DIR/raw.mov"

osascript -e "tell application \"$ACTIVATE_APP\" to activate" >/dev/null 2>&1 || true
sleep 1

screencapture -v -x -V "$DURATION" -D "$DISPNUM" "$RAW"
[ -s "$RAW" ] || { emit FAILED capture_failed "screencapture produced no output — check Screen Recording permission and that display $DISPNUM is awake"; exit 1; }

# Convert the point-space crop to capture pixels (Retina scale = capture px / display points),
# center-crop to 3:4, and encode.
PIXW="$(ffprobe -v quiet -show_entries stream=width -of csv=p=0 "$RAW" | head -1)"
read -r VF NATIVE_W NATIVE_H <<< "$(python3 - "$PIXW" "$DISPW" "$CROPX" "$CROPY" "$CROPW" "$CROPH" <<'PY'
import sys
pixw, dispw, x, y, w, h = map(float, sys.argv[1:7])
scale = pixw / dispw
x, y, w, h = (int(v * scale) for v in (x, y, w, h))
if w / h > 3 / 4:
    ch, cw = h, int(h * 3 / 4)
    cx, cy = x + (w - cw) // 2, y
else:
    cw, ch = w, int(w * 4 / 3)
    cx, cy = x, y + (h - ch) // 2
print(f"crop={cw}:{ch}:{cx}:{cy},scale=720:960,fps=30,format=yuv420p {cw} {ch}")
PY
)"

ffmpeg -y -v error -i "$RAW" -vf "$VF" -t 30 -an "$OUTPUT_PATH"

read -r OUT_W OUT_H OUT_DUR <<< "$(ffprobe -v quiet -select_streams v:0 -show_entries stream=width,height,duration -of csv=p=0 "$OUTPUT_PATH" | head -1 | tr ',' ' ')"
BYTES="$(stat -f%z "$OUTPUT_PATH")"
[ "$OUT_W" = "720" ] && [ "$OUT_H" = "960" ] || { emit FAILED encode_failed "Encoded video is ${OUT_W}x${OUT_H}, expected 720x960"; exit 1; }
[ "$BYTES" -le 104857600 ] || { emit FAILED too_large "Encoded video is ${BYTES} bytes, store limit is 100 MB"; exit 1; }

python3 -c 'import json, sys
print(json.dumps({
    "status": "VIDEO_READY",
    "path": sys.argv[1],
    "width": int(sys.argv[2]),
    "height": int(sys.argv[3]),
    "durationSeconds": round(float(sys.argv[4]), 2),
    "bytes": int(sys.argv[5]),
    "nativeCropWidth": int(sys.argv[6]),
    "nativeCropHeight": int(sys.argv[7]),
    "upscaled": int(sys.argv[6]) < 720 or int(sys.argv[7]) < 960,
    "displayIndex": int(sys.argv[8]),
}))' "$OUTPUT_PATH" "$OUT_W" "$OUT_H" "$OUT_DUR" "$BYTES" "$NATIVE_W" "$NATIVE_H" "$DISPNUM"
