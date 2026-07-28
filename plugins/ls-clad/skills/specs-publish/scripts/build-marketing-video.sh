#!/bin/bash
# Copyright 2026 Specs Inc.
# SPDX-License-Identifier: Apache-2.0

# publish · BUILD MARKETING VIDEO — compose a shareable marketing clip:
# a title cover frame (Lens name + description, optional Lens icon) held for a
# few seconds, then the existing preview video appended, with an optional music
# track. Output matches the preview video's dimensions and fps.
#
# This is a post-submit convenience deliverable — NOT store preview media (which
# has its own 3:4 / ≤30 s / ≤100 MB rules). It is written to a temp file and its
# path returned; nothing is uploaded.
#
# Inputs (env):
#   PREVIEW_VIDEO_PATH  absolute path to the preview video to append (required)
#   LENS_NAME           Lens name for the cover (required)
#   LENS_DESCRIPTION    description for the cover (optional; omitted → name only)
#   OUTPUT_PATH         absolute path for the output .mp4 (required; parent must exist)
#   MUSIC_PATH          optional audio track; looped/trimmed to total duration, faded out
#   ICON_PATH           optional Lens icon PNG; overlaid above the name on the cover
#   COVER_SECONDS       cover hold time in seconds (fractional ok), clamped 1–6 (default 1.5)
#
# Prints one JSON object with a `status`:
#   MARKETING_VIDEO_READY → path, width, height, durationSeconds, coverSeconds, bytes, hasMusic, hasIcon
#   ACTION_REQUIRED       → reason: ffmpeg_missing | no_font
#   FAILED                → reason, message

set -euo pipefail

emit() { python3 -c 'import json,sys; print(json.dumps({"status":sys.argv[1],"reason":sys.argv[2],"message":sys.argv[3]}))' "$1" "$2" "$3"; }

command -v python3 >/dev/null 2>&1 || { emit FAILED missing_tool "python3 is required"; exit 1; }
# Cover rendering uses swift/CoreText, so the marketing build is macOS-only. Fail
# clearly on other OSes rather than through a missing-swift error.
if [ "$(uname 2>/dev/null)" != "Darwin" ]; then
  emit ACTION_REQUIRED unsupported_os "Marketing-video generation is macOS-only (the title cover renders via CoreText). Skip it on this OS. Do not retry this script."
  exit 1
fi
command -v swift >/dev/null 2>&1 || { emit FAILED swift_missing "swift is required to render the cover title (Xcode Command Line Tools)"; exit 1; }
{ command -v ffmpeg >/dev/null 2>&1 && command -v ffprobe >/dev/null 2>&1; } || { emit ACTION_REQUIRED ffmpeg_missing "ffmpeg/ffprobe are required — install with: brew install ffmpeg"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

PREVIEW_VIDEO_PATH="${PREVIEW_VIDEO_PATH:-}"
LENS_NAME="${LENS_NAME:-}"
LENS_DESCRIPTION="${LENS_DESCRIPTION:-}"
OUTPUT_PATH="${OUTPUT_PATH:-}"
MUSIC_PATH="${MUSIC_PATH:-}"
ICON_PATH="${ICON_PATH:-}"
COVER_SECONDS="$(python3 -c 'import sys; print(max(1.0,min(6.0,float(sys.argv[1] or 1.5))))' "${COVER_SECONDS:-1.5}")"

[ -n "$PREVIEW_VIDEO_PATH" ] && [ -f "$PREVIEW_VIDEO_PATH" ] || { emit FAILED missing_input "PREVIEW_VIDEO_PATH is required and must exist"; exit 1; }
[ -n "$LENS_NAME" ] || { emit FAILED missing_input "LENS_NAME is required"; exit 1; }
[ -n "$OUTPUT_PATH" ] || { emit FAILED missing_input "OUTPUT_PATH is required"; exit 1; }
[ -d "$(dirname "$OUTPUT_PATH")" ] || { emit FAILED missing_input "OUTPUT_PATH parent directory does not exist"; exit 1; }
[ -n "$MUSIC_PATH" ] && [ ! -f "$MUSIC_PATH" ] && { emit FAILED missing_input "MUSIC_PATH given but not found: $MUSIC_PATH"; exit 1; }
[ -n "$ICON_PATH" ] && [ ! -f "$ICON_PATH" ] && { emit FAILED missing_input "ICON_PATH given but not found: $ICON_PATH"; exit 1; }

read -r W H FPS < <(ffprobe -v quiet -select_streams v:0 -show_entries stream=width,height,r_frame_rate -of csv=p=0 "$PREVIEW_VIDEO_PATH" | head -1 | tr ',' ' ')
FPS="$(python3 -c 'import sys; n,d=(sys.argv[1].split("/")+["1"])[:2]; print(round(float(n)/float(d)) or 30)' "$FPS")"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/marketing-video.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

# Render the title cover PNG via CoreText (no ffmpeg drawtext dependency — that
# filter is absent from many ffmpeg builds). Text is passed via files to avoid
# shell-escaping arbitrary Lens names/descriptions.
printf '%s' "$LENS_NAME" > "$WORK/name.txt"
printf '%s' "$LENS_DESCRIPTION" > "$WORK/desc.txt"
COVER="$WORK/cover.png"
swift "$SCRIPT_DIR/render-cover.swift" "$W" "$H" "$COVER" "$WORK/name.txt" "$WORK/desc.txt" ${ICON_PATH:+"$ICON_PATH"} >/dev/null
[ -s "$COVER" ] || { emit FAILED cover_failed "Cover frame render produced no output"; exit 1; }

# Video-only concat: cover (held COVER_SECONDS) + preview, both normalized to WxH/FPS/yuv420p.
CONCAT="$WORK/concat.mp4"
ffmpeg -y -v error \
  -loop 1 -t "$COVER_SECONDS" -i "$COVER" \
  -i "$PREVIEW_VIDEO_PATH" \
  -filter_complex "[0:v]scale=${W}:${H},setsar=1,fps=${FPS},format=yuv420p[c];[1:v]scale=${W}:${H},setsar=1,fps=${FPS},format=yuv420p[p];[c][p]concat=n=2:v=1:a=0[v]" \
  -map "[v]" -c:v libx264 -pix_fmt yuv420p "$CONCAT"

TOTAL="$(ffprobe -v quiet -show_entries format=duration -of csv=p=0 "$CONCAT")"
HAS_MUSIC=false
if [ -n "$MUSIC_PATH" ]; then
  HAS_MUSIC=true
  FADE_ST="$(python3 -c 'import sys; print(max(0, float(sys.argv[1])-1.0))' "$TOTAL")"
  if ! ffmpeg -y -v error \
      -i "$CONCAT" -stream_loop -1 -i "$MUSIC_PATH" \
      -map 0:v -map 1:a -t "$TOTAL" \
      -af "afade=t=out:st=${FADE_ST}:d=1" \
      -c:v copy -c:a aac -b:a 192k -shortest "$OUTPUT_PATH" 2>/dev/null; then
    emit FAILED music_mux_failed "MUSIC_PATH is not a readable, decodable audio file: $MUSIC_PATH"
    exit 1
  fi
else
  cp "$CONCAT" "$OUTPUT_PATH"
fi

read -r OW OH ODUR < <(ffprobe -v quiet -select_streams v:0 -show_entries stream=width,height -show_entries format=duration -of default=nw=1:nk=1 "$OUTPUT_PATH" | paste -sd' ' -)
BYTES="$(stat -f%z "$OUTPUT_PATH")"
python3 -c 'import json,sys
print(json.dumps({
 "status":"MARKETING_VIDEO_READY","path":sys.argv[1],
 "width":int(sys.argv[2]),"height":int(sys.argv[3]),
 "durationSeconds":round(float(sys.argv[4]),2),"coverSeconds":round(float(sys.argv[5]),2),
 "bytes":int(sys.argv[6]),"hasMusic":sys.argv[7]=="true","hasIcon":sys.argv[8]=="true"}))' \
 "$OUTPUT_PATH" "$OW" "$OH" "$ODUR" "$COVER_SECONDS" "$BYTES" "$HAS_MUSIC" "$([ -n "$ICON_PATH" ] && echo true || echo false)"
