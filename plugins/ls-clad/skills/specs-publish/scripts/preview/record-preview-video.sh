#!/bin/bash
# Copyright 2026 Specs Inc.
# SPDX-License-Identifier: Apache-2.0

# publish · RECORD PREVIEW VIDEO (TOOLBAR FALLBACK) — compatibility path for
# Lens Studio builds that do not expose Preview.recordVideo. Press Preview's
# native Record Video control, save its renderer-native mp4, and encode
# store-shaped output (portrait 3:4, 1080x1440, 30 fps, silent; values match
# schemas/preview-images.schema.json).
#
# Run this script as the foreground command of a retained execution session and
# retain and join the recording session while it remains alive. Do not detach it
# with &, nohup, disown, or $!. READY_PATH is created only after Lens Studio
# reports that recording is active.
#
# Inputs (env):
#   OUTPUT_PATH       absolute path for the encoded .mp4 (required; parent must exist)
#   DURATION_SECONDS  recording length in seconds, clamped to 16–29 (default 20)
#   ACTIVATE_APP      Accessibility process name (default "Lens Studio")
#   READY_PATH        optional sentinel created after native recording starts
#   LOG_PATH          optional terminal-result JSON path for timeout recovery
#
# Prints one JSON object with a `status`:
#   VIDEO_READY      → path, width, height, durationSeconds, bytes,
#                      nativeSourceWidth, nativeSourceHeight,
#                      nativeCropWidth, nativeCropHeight, upscaled, recorder
#   ACTION_REQUIRED  → reason: accessibility_permission |
#                      preview_recording_active | ffmpeg_missing
#   FAILED           → reason, message

set -euo pipefail

LOG_PATH="${LOG_PATH:-}"

emit_json() {
  if [ -n "$LOG_PATH" ] && [ -d "$(dirname "$LOG_PATH")" ]; then
    printf '%s\n' "$1" | tee "$LOG_PATH"
  else
    printf '%s\n' "$1"
  fi
}

emit() { # status reason message
  emit_json "$(python3 -c 'import json,sys; print(json.dumps({"status": sys.argv[1], "reason": sys.argv[2], "message": sys.argv[3]}))' "$1" "$2" "$3")"
}

if [ "$(uname 2>/dev/null)" != "Darwin" ]; then
  emit ACTION_REQUIRED unsupported_os "Automated native Preview recording is macOS-only because it uses Accessibility UI automation. Fall back to a fresh Lens Studio Preview screenshot. Do not retry this script."
  exit 1
fi

for TOOL in python3 osascript; do
  command -v "$TOOL" >/dev/null 2>&1 || { emit FAILED missing_tool "Required tool not found: $TOOL (macOS only)"; exit 1; }
done
{ command -v ffmpeg >/dev/null 2>&1 && command -v ffprobe >/dev/null 2>&1; } || { emit ACTION_REQUIRED ffmpeg_missing "ffmpeg/ffprobe are required to normalize the preview video — install with: brew install ffmpeg"; exit 1; }

OUTPUT_PATH="${OUTPUT_PATH:-}"
ACTIVATE_APP="${ACTIVATE_APP:-Lens Studio}"
READY_PATH="${READY_PATH:-}"
[ -n "$OUTPUT_PATH" ] || { emit FAILED missing_input "OUTPUT_PATH is required"; exit 1; }
[ -d "$(dirname "$OUTPUT_PATH")" ] || { emit FAILED missing_input "OUTPUT_PATH parent directory does not exist: $(dirname "$OUTPUT_PATH")"; exit 1; }
[ -z "$READY_PATH" ] || [ -d "$(dirname "$READY_PATH")" ] || { emit FAILED missing_input "READY_PATH parent directory does not exist: $(dirname "$READY_PATH")"; exit 1; }
[ -z "$LOG_PATH" ] || [ -d "$(dirname "$LOG_PATH")" ] || { emit FAILED missing_input "LOG_PATH parent directory does not exist: $(dirname "$LOG_PATH")"; exit 1; }
DURATION="$(python3 -c 'import sys; d = int(float(sys.argv[1] or 20)); print(max(16, min(29, d)))' "${DURATION_SECONDS:-20}")"

CAPTURE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/preview-capture.XXXXXX")"
RAW_NAME="lens-studio-preview.mp4"
RAW="$CAPTURE_DIR/$RAW_NAME"
AUTOMATION_SCRIPT="$CAPTURE_DIR/record-preview.applescript"
STOP_SCRIPT="$CAPTURE_DIR/stop-preview-recording.applescript"
AUTOMATION_RESULT="$CAPTURE_DIR/automation-result.txt"
AUTOMATION_ERROR="$CAPTURE_DIR/automation-error.txt"
ACTIVE_SENTINEL="$CAPTURE_DIR/recording.active"
CAPTURE_PID=""

cat > "$AUTOMATION_SCRIPT" <<'APPLESCRIPT'
on findRecordButton(windowToInspect)
	tell application "System Events" to set allElements to entire contents of windowToInspect
	repeat with candidate in allElements
		try
			tell application "System Events"
				if role of candidate is "AXCheckBox" and description of candidate is "Record Video" then
					return candidate
				end if
			end tell
		end try
	end repeat
	return missing value
end findRecordButton

on findNamedElement(windowToInspect, targetRole, targetName)
	tell application "System Events" to set allElements to entire contents of windowToInspect
	repeat with candidate in allElements
		try
			tell application "System Events"
				if role of candidate is targetRole and name of candidate is targetName then
					return candidate
				end if
			end tell
		end try
	end repeat
	return missing value
end findNamedElement

on findUnnamedTextField(windowToInspect)
	tell application "System Events" to set allElements to entire contents of windowToInspect
	repeat with candidate in allElements
		try
			tell application "System Events"
				if role of candidate is "AXTextField" then
					set candidateName to missing value
					try
						set candidateName to name of candidate
					end try
					if candidateName is missing value then
						return candidate
					end if
					if (candidateName as text) is "" then
						return candidate
					end if
				end if
			end tell
		end try
	end repeat
	return missing value
end findUnnamedTextField

on waitForWindow(processName, windowName, attemptCount)
	repeat attemptCount times
		tell application "System Events"
			tell process processName
				if exists window windowName then
					return window windowName
				end if
			end tell
		end tell
		delay 0.1
	end repeat
	return missing value
end waitForWindow

on run argv
	set processName to item 1 of argv
	set durationSeconds to item 2 of argv as integer
	set rawDirectory to item 3 of argv
	set rawName to item 4 of argv
	set activeSentinel to item 5 of argv

	try
		tell application "System Events"
			if not UI elements enabled then
				return "ACTION_REQUIRED_ACCESSIBILITY"
			end if
			if not (exists process processName) then
				return "FAILED_LENS_STUDIO_NOT_RUNNING"
			end if
			tell process processName
				set frontmost to true
				if not (exists window 1) then
					return "FAILED_NO_WINDOW"
				end if
				set recordButton to my findRecordButton(window 1)
				if recordButton is missing value then
					return "FAILED_RECORD_BUTTON_NOT_FOUND"
				end if
				if (value of recordButton as integer) is 1 then
					return "ACTION_REQUIRED_RECORDING_ACTIVE"
				end if

				perform action "AXPress" of recordButton
				set recordingStarted to false
				repeat 30 times
					if (value of recordButton as integer) is 1 then
						set recordingStarted to true
						exit repeat
					end if
					delay 0.1
				end repeat
				if not recordingStarted then
					return "FAILED_RECORDING_DID_NOT_START"
				end if
			end tell
		end tell

		-- Signal readiness from inside this automation. A second osascript
		-- process re-scanning the Accessibility tree would contend with this
		-- one over System Events, making the readiness bound cost unbounded
		-- wall-clock time instead of the documented 5 seconds.
		tell application "System Events"
			make new file at end of files of folder rawDirectory with properties {name:"recording.active"}
		end tell

		delay durationSeconds

		tell application "System Events"
			tell process processName
				perform action "AXPress" of recordButton
				set recordingStopped to false
				repeat 30 times
					if (value of recordButton as integer) is 0 then
						set recordingStopped to true
						exit repeat
					end if
					delay 0.1
				end repeat
				if not recordingStopped then
					return "FAILED_RECORDING_DID_NOT_STOP"
				end if
			end tell
		end tell

		set saveWindow to my waitForWindow(processName, "Save recording", 50)
		if saveWindow is missing value then
			return "FAILED_SAVE_DIALOG"
		end if

		tell application "System Events"
			tell process processName
				set frontmost to true
				keystroke "g" using {command down, shift down}
				set goToFolderField to missing value
				repeat 30 times
					set goToFolderField to my findUnnamedTextField(saveWindow)
					if goToFolderField is not missing value then
						exit repeat
					end if
					delay 0.1
				end repeat
				if goToFolderField is missing value then
					return "FAILED_SAVE_FOLDER_CONTROL"
				end if
				set value of goToFolderField to rawDirectory
				key code 36
				delay 0.5

				set saveWindow to window "Save recording"
				set saveNameField to my findNamedElement(saveWindow, "AXTextField", "Save As:")
				set saveButton to my findNamedElement(saveWindow, "AXButton", "Save")
				if saveNameField is missing value or saveButton is missing value then
					return "FAILED_SAVE_CONTROLS"
				end if
				set value of saveNameField to rawName
				perform action "AXPress" of saveButton
			end tell
		end tell
		return "SAVE_REQUESTED"
	on error errorMessage number errorNumber
		if errorNumber is -1719 then
			return "ACTION_REQUIRED_ACCESSIBILITY"
		end if
		return "FAILED_AUTOMATION:" & errorNumber & ":" & errorMessage
	end try
end run
APPLESCRIPT

cat > "$STOP_SCRIPT" <<'APPLESCRIPT'
on findRecordButton(windowToInspect)
	tell application "System Events" to set allElements to entire contents of windowToInspect
	repeat with candidate in allElements
		try
			tell application "System Events"
				if role of candidate is "AXCheckBox" and description of candidate is "Record Video" then
					return candidate
				end if
			end tell
		end try
	end repeat
	return missing value
end findRecordButton

on findNamedButton(windowToInspect, targetName)
	tell application "System Events" to set allElements to entire contents of windowToInspect
	repeat with candidate in allElements
		try
			tell application "System Events"
				if role of candidate is "AXButton" and name of candidate is targetName then
					return candidate
				end if
			end tell
		end try
	end repeat
	return missing value
end findNamedButton

on run argv
	set processName to item 1 of argv
	tell application "System Events"
		if not UI elements enabled or not (exists process processName) then
			return
		end if
		tell process processName
			if exists window 1 then
				set recordButton to my findRecordButton(window 1)
				if recordButton is not missing value and (value of recordButton as integer) is 1 then
					perform action "AXPress" of recordButton
				end if
			end if
			repeat 30 times
				if exists window "Save recording" then
					set cancelButton to my findNamedButton(window "Save recording", "Cancel")
					if cancelButton is not missing value then
						perform action "AXPress" of cancelButton
					end if
					exit repeat
				end if
				delay 0.1
			end repeat
		end tell
	end tell
end run
APPLESCRIPT

cleanup() {
  if [ -n "$CAPTURE_PID" ] && kill -0 "$CAPTURE_PID" 2>/dev/null; then
    kill "$CAPTURE_PID" 2>/dev/null || true
    wait "$CAPTURE_PID" 2>/dev/null || true
  fi
  rm -rf "$CAPTURE_DIR"
}

abort_capture() {
  local exit_code="$1"
  if [ -n "$CAPTURE_PID" ] && kill -0 "$CAPTURE_PID" 2>/dev/null; then
    kill "$CAPTURE_PID" 2>/dev/null || true
    wait "$CAPTURE_PID" 2>/dev/null || true
    CAPTURE_PID=""
  fi
  osascript "$STOP_SCRIPT" "$ACTIVATE_APP" >/dev/null 2>&1 || true
  [ -z "$READY_PATH" ] || rm -f "$READY_PATH"
  # Record a terminal result so the caller's recovery check reports why nothing
  # is recoverable instead of the ambiguous `terminal_result_missing`.
  emit FAILED capture_aborted "The recorder was signalled before it finished. The in-progress native recording was stopped and discarded; nothing is recoverable from this attempt."
  exit "$exit_code"
}

trap cleanup EXIT
trap 'abort_capture 130' INT
trap 'abort_capture 143' TERM

osascript "$AUTOMATION_SCRIPT" "$ACTIVATE_APP" "$DURATION" "$CAPTURE_DIR" "$RAW_NAME" "$ACTIVE_SENTINEL" >"$AUTOMATION_RESULT" 2>"$AUTOMATION_ERROR" &
CAPTURE_PID=$!

# The automation creates ACTIVE_SENTINEL itself once Lens Studio reports the
# native Record Video control active, so this is a pure local file poll bounded
# by real wall-clock seconds. Never re-scan the Accessibility tree here: that
# contends with the running automation over System Events and turns a "5 second"
# iteration count into tens of seconds, which is what makes the caller's capture
# budget unsatisfiable.
READY_DEADLINE=$((SECONDS + 5))
RECORDING_READY=false
while [ "$SECONDS" -lt "$READY_DEADLINE" ]; do
  if [ -e "$ACTIVE_SENTINEL" ]; then
    RECORDING_READY=true
    if [ -n "$READY_PATH" ]; then
      : > "$READY_PATH"
    fi
    break
  fi
  if ! kill -0 "$CAPTURE_PID" 2>/dev/null; then
    break
  fi
  sleep 0.05
done

if [ "$RECORDING_READY" = false ] && kill -0 "$CAPTURE_PID" 2>/dev/null; then
  kill "$CAPTURE_PID" 2>/dev/null || true
  wait "$CAPTURE_PID" 2>/dev/null || true
  CAPTURE_PID=""
  osascript "$STOP_SCRIPT" "$ACTIVATE_APP" >/dev/null 2>&1 || true
  emit FAILED recording_did_not_start "Lens Studio did not enter its native recording state within 5 seconds."
  exit 1
fi

set +e
wait "$CAPTURE_PID"
AUTOMATION_EXIT=$?
set -e
CAPTURE_PID=""

AUTOMATION_STATUS="$(tr -d '\r\n' < "$AUTOMATION_RESULT")"
if [ "$AUTOMATION_EXIT" -ne 0 ] && [ -z "$AUTOMATION_STATUS" ]; then
  AUTOMATION_STATUS="FAILED_AUTOMATION:osascript exited $AUTOMATION_EXIT:$(tr '\r\n' '  ' < "$AUTOMATION_ERROR")"
fi

case "$AUTOMATION_STATUS" in
  SAVE_REQUESTED) ;;
  ACTION_REQUIRED_ACCESSIBILITY)
    emit ACTION_REQUIRED accessibility_permission "Grant Accessibility control to this terminal app in System Settings → Privacy & Security → Accessibility, then fully restart the terminal app and retry."
    exit 1
    ;;
  ACTION_REQUIRED_RECORDING_ACTIVE)
    emit ACTION_REQUIRED preview_recording_active "Lens Studio Preview is already recording. Stop or discard that recording, then retry."
    exit 1
    ;;
  FAILED_LENS_STUDIO_NOT_RUNNING)
    emit FAILED lens_studio_not_running "Lens Studio is not running."
    exit 1
    ;;
  FAILED_NO_WINDOW)
    emit FAILED no_lens_studio_window "Lens Studio has no open project window."
    exit 1
    ;;
  FAILED_RECORD_BUTTON_NOT_FOUND)
    emit FAILED preview_record_button_unavailable "The native Record Video control was not found. Open the Preview panel and retry."
    exit 1
    ;;
  FAILED_RECORDING_DID_NOT_START)
    emit FAILED recording_did_not_start "Lens Studio did not enter its native recording state."
    exit 1
    ;;
  FAILED_RECORDING_DID_NOT_STOP)
    emit FAILED recording_did_not_stop "Lens Studio did not leave its native recording state."
    exit 1
    ;;
  FAILED_SAVE_DIALOG)
    emit FAILED save_dialog_unavailable "Lens Studio did not open the Save recording dialog."
    exit 1
    ;;
  FAILED_SAVE_CONTROLS)
    emit FAILED save_controls_unavailable "The Save recording dialog controls were not available to Accessibility automation."
    exit 1
    ;;
  FAILED_SAVE_FOLDER_CONTROL)
    emit FAILED save_folder_control_unavailable "The Save recording dialog's folder control was not available to Accessibility automation."
    exit 1
    ;;
  FAILED_AUTOMATION:-10827:*)
    emit FAILED gui_sandbox_blocked "macOS Accessibility automation cannot run in the current sandbox. Rerun this exact recorder command with GUI/unsandboxed authority through the runtime's approval mechanism; do not ask the user and do not count this as a capture retry."
    exit 1
    ;;
  FAILED_AUTOMATION:*)
    emit FAILED automation_failed "${AUTOMATION_STATUS#FAILED_AUTOMATION:}"
    exit 1
    ;;
  *)
    emit FAILED automation_failed "Unexpected native Preview recorder result: ${AUTOMATION_STATUS:-empty}"
    exit 1
    ;;
esac

RAW_READY=false
for _ in $(seq 1 150); do
  if [ -s "$RAW" ]; then
    RAW_READY=true
    break
  fi
  sleep 0.1
done
[ "$RAW_READY" = true ] || { emit FAILED save_failed "Lens Studio did not save the native Preview recording within 15 seconds."; exit 1; }

# Exit as soon as two consecutive size reads match rather than always paying a
# fixed 0.5 s settle. Lens Studio has normally finished writing by the time the
# file is non-empty, so the common case now costs one 0.1 s tick.
RAW_STABLE=false
RAW_SIZE_BEFORE="$(stat -f%z "$RAW")"
for _ in $(seq 1 20); do
  sleep 0.1
  RAW_SIZE_AFTER="$(stat -f%z "$RAW")"
  if [ "$RAW_SIZE_BEFORE" = "$RAW_SIZE_AFTER" ]; then
    RAW_STABLE=true
    break
  fi
  RAW_SIZE_BEFORE="$RAW_SIZE_AFTER"
done
[ "$RAW_STABLE" = true ] || { emit FAILED save_failed "Lens Studio's native Preview recording did not finish writing."; exit 1; }

read -r SOURCE_W SOURCE_H <<< "$(ffprobe -v quiet -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "$RAW" | head -1 | tr ',' ' ')"
[ -n "$SOURCE_W" ] && [ -n "$SOURCE_H" ] || { emit FAILED probe_failed "Unable to read dimensions from the native Preview recording."; exit 1; }

read -r NATIVE_W NATIVE_H <<< "$(python3 - "$SOURCE_W" "$SOURCE_H" <<'PY'
import sys
w, h = map(int, sys.argv[1:3])
if w / h > 3 / 4:
    print(int(h * 3 / 4), h)
else:
    print(w, int(w * 4 / 3))
PY
)"

ffmpeg -y -v error -i "$RAW" \
  -vf "crop='min(iw,ih*3/4)':'min(ih,iw*4/3)',scale=1080:1440:flags=lanczos,fps=30,format=yuv420p" \
  -t 30 -an -c:v libx264 -preset veryfast -crf 23 -movflags +faststart "$OUTPUT_PATH"

read -r OUT_W OUT_H <<< "$(ffprobe -v quiet -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "$OUTPUT_PATH" | head -1 | tr ',' ' ')"
OUT_DUR="$(ffprobe -v quiet -show_entries format=duration -of csv=p=0 "$OUTPUT_PATH" | head -1)"
BYTES="$(stat -f%z "$OUTPUT_PATH")"
[ "$OUT_W" = "1080" ] && [ "$OUT_H" = "1440" ] || { emit FAILED encode_failed "Encoded video is ${OUT_W}x${OUT_H}, expected 1080x1440"; exit 1; }
python3 -c 'import sys; actual=float(sys.argv[1]); requested=float(sys.argv[2]); raise SystemExit(0 if max(15, requested - 1) <= actual <= min(30, requested + 1) else 1)' "$OUT_DUR" "$DURATION" || {
  emit FAILED duration_out_of_range "Encoded video duration is ${OUT_DUR}s, expected approximately ${DURATION}s"
  exit 1
}
[ "$BYTES" -le 104857600 ] || { emit FAILED too_large "Encoded video is ${BYTES} bytes, store limit is 100 MB"; exit 1; }

SUCCESS_JSON="$(python3 -c 'import json, sys
print(json.dumps({
    "status": "VIDEO_READY",
    "path": sys.argv[1],
    "width": int(sys.argv[2]),
    "height": int(sys.argv[3]),
    "durationSeconds": round(float(sys.argv[4]), 2),
    "bytes": int(sys.argv[5]),
    "nativeSourceWidth": int(sys.argv[6]),
    "nativeSourceHeight": int(sys.argv[7]),
    "nativeCropWidth": int(sys.argv[8]),
    "nativeCropHeight": int(sys.argv[9]),
    "upscaled": int(sys.argv[8]) < 1080 or int(sys.argv[9]) < 1440,
    "recorder": "lens_studio_native",
}))' "$OUTPUT_PATH" "$OUT_W" "$OUT_H" "$OUT_DUR" "$BYTES" "$SOURCE_W" "$SOURCE_H" "$NATIVE_W" "$NATIVE_H")"
emit_json "$SUCCESS_JSON"
