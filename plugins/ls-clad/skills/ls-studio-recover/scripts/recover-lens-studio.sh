#!/usr/bin/env bash
# Copyright 2026 Specs Inc.
# SPDX-License-Identifier: Apache-2.0
#
# Relaunch Lens Studio after it died, on the MCP port the running agent session already uses,
# and verify it came back. Takes no arguments: the port comes from .mcp.json and the project
# and executable come from ls-live-instance.json, both beside the project.
#
# First line of output / exit code:
#   RECOVERY: SUCCESS   0    answering on the expected port with the requested project
#   RECOVERY: REFUSED  10    nothing was launched
#   RECOVERY: FAILED   20    launched, but did not come back usable on that port
#
# The bearer token in .mcp.json is never printed. It is pinned for the relaunch (McpAuthToken, in a private
# 0700 temp file that is deleted once Lens Studio is up) and used for the tools/list readiness probe.
#
# Test-only environment overrides:
#   LS_RECOVER_DIR       directory holding .mcp.json + ls-live-instance.json
#   LS_RECOVER_TIMEOUT   readiness timeout in seconds (default 120)
#
# Targets bash 3.2 (/bin/bash on macOS), ASCII only.

READY_TIMEOUT="${LS_RECOVER_TIMEOUT:-120}"
POLL_INTERVAL=1
SETTLE_INTERVAL=2
# Unauthenticated, and the MCP server answers it with a plain 404. Probing /mcp instead makes
# Lens Studio log a warning on every poll.
PROBE_PATH="/.well-known/oauth-authorization-server"
RECORD_NAME="ls-live-instance.json"

say() { printf '%s\n' "$1"; }
manual_command=""   # set once the record yields both paths

refuse() {
  say "RECOVERY: REFUSED"
  say "Reason: $1"
  [ -n "$manual_command" ] && say "Command for the user to run by hand: $manual_command"
  exit 10
}

spawn_pid=""
fail() {
  # A launched-but-unusable Lens Studio must not keep the port: the caller's own relaunch would find the port
  # answering and bind its session to this broken instance (seen on CI: 0 tools, every tools/call HTTP 501).
  if [ -n "$spawn_pid" ] && kill -0 "$spawn_pid" 2>/dev/null; then
    kill -TERM -- "-$spawn_pid" 2>/dev/null || kill -TERM "$spawn_pid" 2>/dev/null
    for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$spawn_pid" 2>/dev/null || break; sleep 1; done
    kill -KILL -- "-$spawn_pid" 2>/dev/null || kill -KILL "$spawn_pid" 2>/dev/null
    say "RECOVERY: FAILED"
    say "Reason: $1"
    say "  (the Lens Studio this script launched, pid $spawn_pid, was stopped so it does not hold port $port)"
  else
    say "RECOVERY: FAILED"
    say "Reason: $1"
  fi
  say "  project:    $project"
  say "  endpoint:   $endpoint"
  [ -n "$manual_command" ] && say "Command for the user to run by hand: $manual_command"
  exit 20
}

# Windows-flavored bash and WSL have no working /dev/tcp route to the Lens Studio port, so this
# script cannot verify a relaunch there. recover-lens-studio.ps1 does the same job over .NET
# sockets - refuse and name it rather than launching something we could not check.
case "$(uname -s 2>/dev/null)$(uname -r 2>/dev/null)$WSL_DISTRO_NAME" in
  MINGW*|MSYS*|CYGWIN*|*icrosoft*|*WSL*)
    refuse "this script cannot verify a relaunch on Windows or WSL - its readiness probe cannot reach the Lens Studio port. Run scripts/recover-lens-studio.ps1 instead; see the skill's Run it section." ;;
esac

# --- the expected port, read first: .mcp.json is rewritten on project open, so this value is
# --- gone once the relaunch lands.
url=""; token=""; mcp_dir=""
for dir in "$LS_RECOVER_DIR" "$CLAUDE_PROJECT_DIR" "$PWD"; do
  [ -n "$dir" ] && [ -f "$dir/.mcp.json" ] || continue
  url="$(tr -d '\n\r' < "$dir/.mcp.json" | sed -n 's/.*"lens-studio"[[:space:]]*:[[:space:]]*{[^}]*"url"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
  [ -n "$url" ] || continue
  mcp_dir="$dir"
  token="$(tr -d '\n\r' < "$dir/.mcp.json" | sed -n 's/.*"lens-studio"[[:space:]]*:[[:space:]]*{[^}]*"Authorization"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
  break
done
[ -n "$mcp_dir" ] || refuse "no lens-studio url could be read from a .mcp.json in \$CLAUDE_PROJECT_DIR or the working directory, so the port this session expects is unknown."

hostport="${url#*://}"
mcp_path="/mcp"
case "$hostport" in */*) mcp_path="/${hostport#*/}" ;; esac
hostport="${hostport%%/*}"
host="${hostport%%:*}"
port="${hostport##*:}"
case "$port" in ''|*[!0-9]*) refuse "the lens-studio url in $mcp_dir/.mcp.json has no usable port." ;; esac
[ "$port" != "$hostport" ] || refuse "the lens-studio url in $mcp_dir/.mcp.json has no port."
[ "$host" = "localhost" ] && host="127.0.0.1"   # Lens Studio binds IPv4 loopback
endpoint="${host}:${port}"

# --- the record: what to launch, and with what.
record="$mcp_dir/$RECORD_NAME"

# The record is flat, one key per line, every value a quoted string - a contract with its
# writer, so no JSON parser is needed.
rec_field() {
  sed -n "/^[[:space:]]*\"$1\"[[:space:]]*:/{s/^[[:space:]]*\"$1\"[[:space:]]*:[[:space:]]*\"\(.*\)\"[[:space:]]*,\{0,1\}[[:space:]]*\$/\1/p;q;}" "$2" 2>/dev/null
}

# Inverse of the writer's JSON escaping, since these values become filesystem paths.
# \\ is parked on a control byte first so \\" is not misread as \ followed by \".
# The \/ case replaces with a bare / : inside "${...}" a backslash before / is not
# removed, so a \/ replacement would substitute \/ for itself and leave every path
# separator escaped.
json_unescape() {
  local s="$1"
  s="${s//\\\\/$'\001'}"; s="${s//\\\"/\"}"; s="${s//\\\///}"; s="${s//$'\001'/\\}"
  printf '%s' "$s"
}

[ -r "$record" ] || refuse "there is no readable $RECORD_NAME in $mcp_dir, so the project and the executable to relaunch are unknown."
project="$(json_unescape "$(rec_field projectPath "$record")")"
exe="$(json_unescape "$(rec_field executablePath "$record")")"
[ -n "$project" ] || refuse "$record names no project path."
[ -n "$exe" ] || refuse "$record names no executable path - this Lens Studio build predates recording it, so it cannot be relaunched automatically."
manual_command="\"$exe\" \"$project\""

# The project is a POSITIONAL argument, and Lens Studio silently reinterprets a positional that
# is not an existing file as a plugin command name - it would come up with no project at all.
[ -f "$project" ] || refuse "the recorded project $project is not there any more."
[ -x "$exe" ] || refuse "the recorded Lens Studio $exe is not there, or is not executable."

# No token means no recovery is possible, so refuse before launching anything. Lens Studio
# rejects every POST /mcp whose Authorization header is not an exact "Bearer <token>" match,
# and this session cannot re-read .mcp.json to pick up a token it did not start with - so a
# relaunch would come back healthy and every retried call would still get a 401.
[ -n "$token" ] || refuse "the lens-studio entry in $mcp_dir/.mcp.json carries no bearer token, so this session could not authenticate to Lens Studio even after a successful relaunch. The user has to restart the session against a .mcp.json that has one."

# Nothing may already answer on the port. Lens Studio refuses to start MCP when its configured
# port is taken, so a probe that succeeded after the launch would be answering from whatever
# else holds it - a false success, the one outcome this must never produce.
if (exec 3<>"/dev/tcp/$host/$port") 2>/dev/null; then
  say "RECOVERY: REFUSED"
  say "Reason: something is already answering on $endpoint, so a relaunch could not be verified."
  say "If Lens Studio's MCP server came back by itself, retrying the denied call settles it. Otherwise another process holds port $port and only the user can free it."
  exit 10
fi

# --- pin the port AND the token. Lens Studio reads them from the McpPort / McpAuthToken config
# --- values, and --config chooses which file those come from, so the pin is a throwaway config. It
# --- is parsed once at startup and never written by Lens Studio. The user's own config file, which
# --- normally does not exist, is left alone. The token must be pinned too: when the dead instance
# --- was started with a --config carrying McpAuthToken (the CI harness does this), a relaunch with
# --- a port-only config mints a NEW token, and every call from this session - which cannot re-read
# --- .mcp.json - then gets a 401. Pinning the token the session already holds keeps it valid.
# --- If Lens Studio ever keeps the token across a port-only relaunch, the McpAuthToken pin can be dropped.
#
# Write it inside a fresh 0700 directory rather than at a predictable name. TMPDIR is unset on
# most Linux hosts, so the fallback is world-writable /tmp, where anything could pre-place a
# symlink at a name we are about to redirect into - the sticky bit stops deletions, not new
# symlinks. The .json suffix has to go on the file inside the directory: BSD mktemp leaves X's
# that are not at the end of the template unsubstituted.
pin_dir="$(mktemp -d "${TMPDIR:-/tmp}/ls-clad-recover.XXXXXX" 2>/dev/null)"
[ -d "$pin_dir" ] || refuse "a private temporary directory for the port pin could not be created under ${TMPDIR:-/tmp}."
# Arm the cleanup before the token touches disk, so no interruption can leave it behind.
trap 'rm -rf "$pin_dir"' EXIT
trap 'exit 130' INT; trap 'exit 143' TERM; trap 'exit 129' HUP  # signals exit through the EXIT trap, so the token pin is removed
pin_config="$pin_dir/mcp-port-$port.json"
raw_token="${token#Bearer }"; raw_token="${raw_token#bearer }"
esc_token="${raw_token//\\/\\\\}"; esc_token="${esc_token//\"/\\\"}"
( umask 077; printf '{"McpPort": "%s", "McpAuthToken": "%s"}\n' "$port" "$esc_token" > "$pin_config" ) 2>/dev/null
[ -s "$pin_config" ] || refuse "the port pin could not be written to $pin_config."

# --- launch. Run the binary DIRECTLY: a platform launcher like `open -a` can redirect into an
# --- already-running instance and switch that instance's project. A new session keeps Lens
# --- Studio alive if this script's process group is killed later, e.g. by a tool timeout.
start="$(date +%s)"
if command -v python3 >/dev/null 2>&1; then
  spawn_pid="$(python3 -c 'import subprocess,sys
p = subprocess.Popen(sys.argv[1:], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                     stderr=subprocess.DEVNULL, start_new_session=True)
print(p.pid)' "$exe" --config "$pin_config" "$project" 2>/dev/null)"
fi
case "$spawn_pid" in ''|*[!0-9]*)
  nohup "$exe" --config "$pin_config" "$project" >/dev/null 2>&1 </dev/null &
  spawn_pid="$!" ;;
esac
[ -n "$spawn_pid" ] || fail "Lens Studio could not be launched from $exe at all."

# --- wait for the port to answer. The redirection on the closing brace silences every call: a
# --- failed exec on /dev/tcp is reported by the shell itself, which an inner 2>/dev/null cannot
# --- suppress, and this script's stdout is a report a human reads.
http_ok() {
  local line=""
  exec 3<>"/dev/tcp/$host/$port" || return 1
  printf 'GET %s HTTP/1.0\r\nHost: %s\r\nConnection: close\r\n\r\n' "$PROBE_PATH" "$host" >&3 || { exec 3>&- 3<&-; return 1; }
  IFS= read -r -t 3 line <&3
  exec 3>&- 3<&-
  case "$line" in HTTP/*) return 0 ;; esac
  return 1
} 2>/dev/null

deadline=$(( start + READY_TIMEOUT ))
ready=0
while :; do
  http_ok && { ready=1; break; }
  kill -0 "$spawn_pid" 2>/dev/null || fail "Lens Studio was launched but the process (pid $spawn_pid) exited after about $(( $(date +%s) - start ))s, before MCP came up. Run the command by hand to see why."
  [ "$(date +%s)" -lt "$deadline" ] || break
  sleep "$POLL_INTERVAL"
done
[ "$ready" = 1 ] || fail "nothing answered on $endpoint within ${READY_TIMEOUT}s. Lens Studio is running (pid $spawn_pid), but it may have come back on a different auto-scanned port in 50040-50049 - which this session cannot use. A restarted session would pick that up."

# --- wait for the tool registry to settle. An answering port only means the HTTP server is up;
# --- MCP tools are JS chat tools that register as their plugins load, so a call made now can be
# --- told a tool does not exist when it is merely late. Poll until two samples agree.
#
# Counts "inputSchema", which appears once per tool - unlike "name", which also appears inside
# each tool's schema. The number does not matter, only that it stopped changing. tools/list needs
# no initialize handshake, just the token.
tool_count() {
  local body='{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
  local resp="" line="" n=0
  exec 3<>"/dev/tcp/$host/$port" || { printf '%s' -1; return; }
  printf 'POST %s HTTP/1.0\r\nHost: %s\r\nAuthorization: %s\r\nContent-Type: application/json\r\nAccept: application/json, text/event-stream\r\nContent-Length: %s\r\nConnection: close\r\n\r\n%s' \
    "$mcp_path" "$host" "$token" "${#body}" "$body" >&3 || { exec 3>&- 3<&-; printf '%s' -1; return; }
  # read returns non-zero on an unterminated final line, so the loop body never runs for it -
  # append $line afterwards or a body with no trailing newline is dropped whole. Appending is a
  # no-op when the body did end in a newline, because read clears $line at a clean EOF.
  while IFS= read -r -t 5 line <&3; do resp="$resp$line"; done
  resp="$resp$line"
  exec 3>&- 3<&-
  case "$resp" in *'"result"'*) ;; *) printf '%s' -1; return ;; esac
  while :; do
    case "$resp" in
      *'"inputSchema"'*) n=$(( n + 1 )); resp="${resp#*\"inputSchema\"}" ;;
      *) break ;;
    esac
  done
  printf '%s' "$n"
} 2>/dev/null

tool_n=-1
prev_n=-1
settled=0
while :; do
  tool_n="$(tool_count)"
  [ "$tool_n" -gt 0 ] && [ "$tool_n" = "$prev_n" ] && { settled=1; break; }
  prev_n="$tool_n"
  [ "$(date +%s)" -lt "$deadline" ] || break
  sleep "$SETTLE_INTERVAL"
done
[ "$settled" = 1 ] || fail "Lens Studio answered on $endpoint but its MCP tool list never settled within ${READY_TIMEOUT}s (last count: $tool_n). It is running, but a tool call now could fail for a tool that appears later; the Logger panel may show a plugin that failed to load."

# --- verify the right project came back. The record is rewritten on project open, so it now
# --- describes the new instance. The writer skips the write when content is unchanged, so an
# --- unchanged record is the normal success case.
now_project="$(json_unescape "$(rec_field projectPath "$record")")"
[ "$now_project" = "$project" ] || fail "$endpoint is answering, but $RECORD_NAME now names ${now_project:-nothing} rather than the requested project, so a tool call would act on the wrong project."

say "RECOVERY: SUCCESS"
say "Lens Studio is back and answering MCP on the port this session uses."
say "  project:   $project"
say "  version:   $(rec_field studioVersion "$record")"
say "  endpoint:  $endpoint"
say "  pid:       $spawn_pid"
say "  ready in:  $(( $(date +%s) - start ))s"
say "  mcp tools: $tool_n registered, steady across two polls"
say "Retry the Lens Studio MCP call that was denied. If the client already dropped the server, the user has to restart the session."
exit 0
