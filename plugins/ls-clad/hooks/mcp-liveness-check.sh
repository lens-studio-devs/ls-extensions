#!/usr/bin/env bash
# Lens Studio MCP liveness gate (macOS/Linux). PreToolUse hook for mcp__lens-studio__* calls.
# Probes the lens-studio endpoint from .mcp.json via bash /dev/tcp - no external deps.
#   alive -> allow (emit a note, exit 0)
#   dead  -> deny the call (JSON on stdout), halting the turn unless the denial is recoverable
# Never exits silently: every path emits either a note or a deny. The token is never read
# or logged. The Windows counterpart is mcp-liveness-check.ps1.
#
# Fails OPEN on anything uncertain BEFORE the probe - no .mcp.json, no url, no usable port,
# a shell where /dev/tcp cannot reach the endpoint - so it never blocks unrelated work.
# Once the probe has failed the call is denied either way, and uncertainty then changes only
# the wording. Note that a deny carries no additionalContext, so those runs emit no note.
#
# When the probe fails the call is denied either way; the live-instance record written by
# Lens Studio and the project lock file only decide WHICH of four things the message says:
# Studio is running but mute, Studio died holding the project, nothing holds the project,
# or ownership is indeterminate. Anything this hook cannot read routes to indeterminate,
# which claims nothing - it never guesses, never launches, never repairs, never writes.
#
# Two of those four are recoverable: Studio died holding the project, and nothing holds the
# project - but only when the record supplied an executable path, so there is something for
# the ls-studio-recover skill to launch. Those two deny the call and leave the turn alive
# (continue:true) so the agent can recover and then retry. The other two halt the turn:
# Studio-is-mute has nothing to relaunch, because a second Studio cannot take a lock the
# first still holds, and indeterminate has established nothing to act on.
#
# Targets bash 3.2 (/bin/bash on macOS): no ${var,,}, no associative arrays.
#
# ASCII ONLY, to match the PowerShell counterpart's constraint and avoid any locale/encoding
# surprises in JSON output. Keep every character 7-bit ASCII.

# Escape a value for use inside a JSON string. Backslash first (or it would double-escape
# the backslashes the quote rule adds), then quotes, then the control characters a path
# can legally carry - one unescaped byte makes the whole hook payload invalid JSON.
# The last rule replaces every REMAINING C0 byte with a space rather than escaping it: a
# path with a form feed in it is already unusable, and spelling that byte out as an escape
# would only make an unusable path harder for a human to read.
# Locale note: that last rule is a bracket expression, whose endpoints bash 3.2 compares with
# strcoll, so under a UTF-8 locale the range matches nothing at all. The local LC_ALL=C
# assignment fixes the ordering for the duration of the function - bash re-runs setlocale on
# the assignment and again when the local is unwound - and multibyte bytes elsewhere in the
# value pass through untouched either way.
json_escape() {
  local s="$1"
  local LC_ALL=C
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/ }"
  s="${s//$'\r'/ }"
  s="${s//$'\t'/ }"
  s="${s//[$'\001'-$'\037']/ }"
  printf '%s' "$s"
}

# Lowercase a value. bash 3.2 has no ${var,,}, so this is the only way to say it once.
lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

# Inverse of json_escape, for record values that are then used as filesystem paths.
# \\ is parked on a control byte first so that \\" is not misread as \ followed by \".
# The \/ replacement is a bare / on purpose: inside "${...}" a backslash before /
# is NOT removed, so writing \/ there would replace \/ with itself and every path
# separator would stay escaped.
json_unescape() {
  local s="$1"
  s="${s//\\\\/$'\001'}"
  s="${s//\\\"/\"}"
  s="${s//\\\///}"
  s="${s//$'\001'/\\}"
  printf '%s' "$s"
}

# Emit an allow-with-note JSON object (additionalContext does not block the call).
emit() {
  printf '%s' "{\"hookSpecificOutput\":{\"hookEventName\":\"PreToolUse\",\"additionalContext\":\"LS liveness gate (bash): $(json_escape "$1")\"}}"
}

# Deny the call and halt the turn. $1 = reason for the model, $2 = message for the human.
# Both are escaped here, once, so no caller can forget to.
# NEVER RETURNS - it exits the script. That is what makes the "[ test ] || indeterminate ..."
# guards further down correct: the guard is the whole branch, there is no else.
deny() {
  printf '%s' "{\"hookSpecificOutput\":{\"hookEventName\":\"PreToolUse\",\"permissionDecision\":\"deny\",\"permissionDecisionReason\":\"$(json_escape "$1")\"},\"continue\":false,\"systemMessage\":\"$(json_escape "$2")\"}"
  exit 0
}

# Deny the call but leave the turn alive, so the agent can run the recovery skill and retry.
# $1 = reason for the model, which must name ls-studio-recover; $2 = message for the human.
# A sibling of deny() rather than a flag on it, so the halting paths cannot drift into
# continuing. NEVER RETURNS.
deny_recoverable() {
  printf '%s' "{\"hookSpecificOutput\":{\"hookEventName\":\"PreToolUse\",\"permissionDecision\":\"deny\",\"permissionDecisionReason\":\"$(json_escape "$1")\"},\"continue\":true,\"systemMessage\":\"$(json_escape "$2")\"}"
  exit 0
}

# Defer to the PowerShell counterpart on Windows-flavored bash (Git Bash/MSYS2, Cygwin)
# and WSL: there, /dev/tcp is unsupported or cannot reach the Windows-host loopback port,
# so a failed probe would be a FALSE "dead" verdict that wrongly halts the turn (the
# deny's continue:false would also stop the PowerShell hook from running). Fail open.
case "$(uname -s 2>/dev/null)" in MINGW*|MSYS*|CYGWIN*) emit "Windows-flavored bash - deferring to PowerShell counterpart"; exit 0 ;; esac
case "$(uname -r 2>/dev/null)" in *icrosoft*|*WSL*) emit "WSL - deferring to PowerShell counterpart"; exit 0 ;; esac  # WSL reports uname -s as Linux
[ -n "$WSL_DISTRO_NAME" ] && { emit "WSL - deferring to PowerShell counterpart"; exit 0; }

payload="$(cat 2>/dev/null)"
stdin_cwd="$(printf '%s' "$payload" | sed -n 's/.*"cwd"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"

url=""
mcp_dir=""
for dir in "$CLAUDE_PROJECT_DIR" "$stdin_cwd" "$PWD"; do
  [ -n "$dir" ] && [ -f "$dir/.mcp.json" ] || continue
  url="$(tr -d '\n\r' < "$dir/.mcp.json" | sed -n 's/.*"lens-studio"[[:space:]]*:[[:space:]]*{[^}]*"url"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
  [ -n "$url" ] && { mcp_dir="$dir"; break; }  # remember the resolved dir - the record lives beside .mcp.json
done
[ -n "$url" ] || { emit "no lens-studio url in .mcp.json - allowing"; exit 0; }

hostport="${url#*://}"     # strip scheme
hostport="${hostport%%/*}" # strip path
host="${hostport%%:*}"
port="${hostport##*:}"
{ [ -n "$port" ] && [ "$port" != "$hostport" ]; } || { emit "no port in url - allowing"; exit 0; }  # no port -> fail open
case "$port" in *[!0-9]*) emit "non-numeric port ($port) - allowing"; exit 0 ;; esac                # non-numeric -> fail open
[ "$host" = "localhost" ] && host="127.0.0.1"                                                       # Lens Studio binds IPv4 loopback

if (exec 3<>"/dev/tcp/$host/$port") 2>/dev/null; then
  emit "Lens Studio reachable at ${host}:${port} - allowing"  # alive -> allow (subshell already closed fd 3)
  exit 0
fi

# ======================================================================================
# Probe failed: the endpoint is not answering, so the call cannot succeed and is denied
# no matter what follows. Everything below only chooses the message.
# ======================================================================================
endpoint="${host}:${port}"
# The turn is over, so nothing is going to make the endpoint answer.
retry_note="Do NOT retry this or any other mcp__lens-studio__ tool."
# The turn continues, so a retry can eventually work - but only after the recovery, never
# straight away. Deliberately not an invitation to retry now.
recover_note="Do NOT retry this or any other mcp__lens-studio__ tool yet. Invoke the ls-studio-recover skill first, and retry only once it reports Lens Studio is serving this project again."

# --- the live-instance record Lens Studio writes beside .mcp.json ----------------------
record="$mcp_dir/ls-live-instance.json"

# Pull one string value out of the record. Its layout is a contract with the writer - flat,
# one key per line, no nesting, and every value a QUOTED STRING including schemaVersion - so
# a line-oriented match suffices and no JSON parser is needed. An unquoted numeric value
# reads as empty here, which makes the record unusable and silently costs three of the four
# verdicts; the writer side carries a layout test for exactly that reason.
rec_field() {
  sed -n "/^[[:space:]]*\"$1\"[[:space:]]*:/{s/^[[:space:]]*\"$1\"[[:space:]]*:[[:space:]]*\"\(.*\)\"[[:space:]]*,\{0,1\}[[:space:]]*\$/\1/p;q;}" "$record" 2>/dev/null
}

# A record is usable only when it exists, is readable, and carries a schema version this
# hook recognises. Absent, unreadable and unrecognised-version records are equally
# unusable and all take the same record-free fallback below.
have_record=0
rec_project=""
rec_exe=""
rec_version=""
if [ -f "$record" ] && [ "$(rec_field schemaVersion)" = "1" ]; then
  have_record=1
  rec_project="$(json_unescape "$(rec_field projectPath)")"
  rec_exe="$(json_unescape "$(rec_field executablePath)")"  # absent on older Studio builds
  rec_version="$(rec_field studioVersion)"
fi

known=""  # whatever the record made available, appended to every verdict
add_known() { [ -n "$2" ] || return 0; [ -n "$known" ] && known="$known; "; known="$known$1=$2"; }
add_known project "$rec_project"
add_known version "$rec_version"
add_known executable "$rec_exe"
[ -n "$known" ] && known=" From the live-instance record: $known."

# Never synthesise a command without a recorded executable path.
relaunch=""
[ -n "$rec_exe" ] && [ -n "$rec_project" ] && relaunch=" Command for the user to run: \"$rec_exe\" \"$rec_project\" - do not run it yourself."
# The same command, worded for the recoverable path. Reusing the line above there would say
# "do not run it yourself" while naming a skill whose job is to run it, and an agent resolving
# that contradiction by spawning the binary directly would skip the verification that makes
# recovery safe.
relaunch_recover=""
[ -n "$rec_exe" ] && [ -n "$rec_project" ] && relaunch_recover=" The command that restores it is \"$rec_exe\" \"$rec_project\" - the ls-studio-recover skill runs it for you; do not spawn it yourself."

proj_label="this project"
[ -n "$rec_project" ] && proj_label="${rec_project##*/}"

# --- the four verdicts ----------------------------------------------------------------
# Each ends in deny() or deny_recoverable() and so never returns. studio_mute and studio_gone
# read $lock_pid and $lock_file, which are set further down - they are only ever called after
# the lock is read.
#
# studio_gone and nothing_open pick their emitter from $relaunch, non-empty only when the
# record supplied an executable path: without one there is nothing to launch, so the turn
# halts. The branch changes how a verdict is emitted, never which verdict is reached.
#
# Lock present, host local, process alive: Studio has the project open and is not talking.
# No command - a second Studio cannot take a project lock the first still holds.
studio_mute() {
  deny "Lens Studio MCP server is not answering at ${endpoint}, but Lens Studio IS running with this project: process ${lock_pid} holds ${lock_file}. Something else may hold port ${port}, the MCP plugin may be disabled, or the server may still be starting up. There is no relaunch to offer - a second Lens Studio cannot take a project lock this one still holds.${known} ${retry_note}" \
       "Lens Studio is running with ${proj_label} (pid ${lock_pid}) but its MCP server is not answering at ${endpoint} - halting. Check that the MCP plugin is enabled and that nothing else holds port ${port}."
}

# Lock present, host local, process gone: Studio was serving this project and exited.
# Says nothing about when, and nothing about what the leftover lock does to a reopen.
# Recoverable when a command can be offered.
studio_gone() {
  local head="Lens Studio MCP server is not reachable at ${endpoint}. Lens Studio was serving this project and is gone: process ${lock_pid}, recorded in ${lock_file}, is no longer running. Both the record and the lock file persist until the project is next opened, so this says nothing about when it exited."
  local facts="${head}${relaunch}${known}"
  [ -n "$relaunch" ] && deny_recoverable "${head}${relaunch_recover}${known} $recover_note" \
       "Lens Studio is gone - it was serving ${proj_label} as pid ${lock_pid}. Blocking this call; the agent should run the ls-studio-recover skill to relaunch Lens Studio and reopen the project, then retry."
  deny "$facts $retry_note" \
       "Lens Studio is gone - it was serving ${proj_label} as pid ${lock_pid} - halting. Relaunch Lens Studio, open the project, ensure the MCP server is running, then retry."
}

# Usable record, no lock beside the project it names. Deliberately silent on why: an
# orderly quit, a project never opened, and an already-cleaned-up lock are
# indistinguishable from here and all lead to the same action.
# Recoverable when a command can be offered.
nothing_open() {
  local head="Lens Studio MCP server is not reachable at ${endpoint}. Lens Studio is not running with this project - no project lock exists beside ${rec_project}."
  local facts="${head}${relaunch}${known}"
  [ -n "$relaunch" ] && deny_recoverable "${head}${relaunch_recover}${known} $recover_note" \
       "Lens Studio is not running with ${proj_label}. Blocking this call; the agent should run the ls-studio-recover skill to open the project in Lens Studio, then retry."
  deny "$facts $retry_note" \
       "Lens Studio is not running with ${proj_label} - halting. Open the project in Lens Studio, ensure the MCP server is running, then retry."
}

# Anything this hook could not establish. Makes no claim about whether Studio is running
# and offers no command; it still denies, because the endpoint is not answering.
indeterminate() {
  deny "Lens Studio MCP server is not reachable at ${endpoint}, and which process (if any) holds the project could not be determined: $1. Make no assumption about whether Lens Studio is running.${known} ${retry_note}" \
       "Lens Studio is unreachable at ${endpoint} and project ownership could not be determined ($1) - halting. Check Lens Studio yourself, then retry."
}

# --- locate the project lock ----------------------------------------------------------
# Lens Studio writes <projectfile>.<path-hash>.lock beside every open .esproj. The hash is
# not reproducible outside Studio, so match on it rather than compute it.
lock_count=0
lock_file=""
if [ "$have_record" = 1 ]; then
  # Anchor on the recorded project path, NOT on the resolved directory: Studio exposes the
  # project directory and the project file as independent values that need not coincide.
  [ -n "$rec_project" ] || indeterminate "the live-instance record names no project path"
  case "$rec_project" in
    /*) ;;
    *) indeterminate "the recorded project path '$rec_project' is not absolute" ;;
  esac
  lock_dir="${rec_project%/*}"
  [ -n "$lock_dir" ] || lock_dir="/"  # a project file at the root: /P.esproj -> "" -> /
  proj_base="${rec_project##*/}"
  # An absent project directory is something we could not inspect, not evidence of absence.
  [ -d "$lock_dir" ] || indeterminate "the recorded project directory '$lock_dir' is not there to inspect"
  for f in "$lock_dir"/*.lock; do
    [ -f "$f" ] || continue             # an unmatched glob expands to the literal pattern under bash
    lock_name="${f##*/}"
    # The prefix is quoted, making the strip literal, so a '[' or '*' in the project name
    # cannot turn into a pattern and alter what matches.
    suffix="${lock_name#"$proj_base".}"
    [ "$suffix" != "$lock_name" ] || continue   # nothing stripped -> not this project's lock
    # Require a non-empty path-hash component between the project name and the extension, so
    # that a stray "<project>.lock" with no hash is not mistaken for a lock Studio wrote.
    case "$suffix" in ?*.lock) ;; *) continue ;; esac
    lock_count=$((lock_count + 1))
    lock_file="$f"
  done
  [ "$lock_count" -gt 0 ] || nothing_open
else
  # No usable record, so there is no project path to anchor on. Best effort: glob the
  # resolved directory, knowingly assuming the .esproj lives there. This path never
  # produces a command, and finding no lock here proves nothing about the project.
  for f in "$mcp_dir"/*.esproj.*.lock; do
    [ -f "$f" ] || continue
    lock_count=$((lock_count + 1))
    lock_file="$f"
  done
  [ "$lock_count" -gt 0 ] || indeterminate "there is no usable live-instance record in ${mcp_dir} and no project lock there either"
fi
[ "$lock_count" -eq 1 ] || indeterminate "${lock_count} project locks matched, so the owning process is ambiguous"

# --- read the lock --------------------------------------------------------------------
# pid on line 1, application name on line 2, originating host on line 3. Read positionally
# with the builtin - a real lock carries further identifier lines after those three.
# stderr is silenced BEFORE the input redirect so an unreadable lock stays quiet.
[ -r "$lock_file" ] || indeterminate "the lock ${lock_file} could not be read"
lock_pid=""
lock_app=""
lock_host=""
{ IFS= read -r lock_pid; IFS= read -r lock_app; IFS= read -r lock_host; } 2>/dev/null < "$lock_file"
lock_pid="${lock_pid%$'\r'}"
lock_app="${lock_app%$'\r'}"
lock_host="${lock_host%$'\r'}"

app_lc="$(lower "$lock_app")"
case "$app_lc" in
  *"lens studio"*) ;;  # cheap sanity check that this really is a Lens Studio lock
  "") indeterminate "the lock ${lock_file} has no application name on line 2 - it is empty or truncated" ;;
  *) indeterminate "the lock ${lock_file} does not look like a Lens Studio lock (line 2 reads '${lock_app}')" ;;
esac

bad_pid_msg="the lock ${lock_file} carries '${lock_pid}' where a process id should be"
case "$lock_pid" in
  ''|*[!0-9]*) indeterminate "$bad_pid_msg" ;;
esac
# Bound the width BEFORE any arithmetic: a digit string wide enough to overflow bash's
# integers makes [ -ge ] write "integer expected" to stderr, and this hook writes nothing but
# its JSON payload. No platform's pid needs ten digits, so anything longer is not one.
[ "${#lock_pid}" -le 10 ] || indeterminate "$bad_pid_msg"
# Reject 0: kill -0 0 would signal the whole process group and answer a different question.
[ "$lock_pid" -ge 1 ] || indeterminate "the lock ${lock_file} carries process id ${lock_pid}"

# A project on a network share can be locked by another machine's Studio, and that must
# never read as "alive here". Qt writes the SHORT host name into the lock, whereas the
# local name can come back fully qualified once a search domain is configured - so strip
# the domain from BOTH sides and compare case-insensitively. uname -n reports the same
# nodename Qt asks for, and uname is already a dependency of this hook (hostname is not).
this_host="$(uname -n 2>/dev/null || printf '%s' "$HOSTNAME")"
this_host="$(lower "${this_host%%.*}")"
lock_host_lc="$(lower "${lock_host%%.*}")"
{ [ -n "$this_host" ] && [ -n "$lock_host_lc" ]; } || indeterminate "the lock's host name could not be compared with this machine's"
[ "$lock_host_lc" = "$this_host" ] || indeterminate "the lock was taken by host '${lock_host}', not by this machine"

# --- liveness -------------------------------------------------------------------------
# kill -0 succeeding means the process is there. A failure carries no errno this shell can
# read, only a message, so the two failures that mean something have to be recognised by
# text: ESRCH (gone) and EPERM (alive, owned by another user - pid 1 is the everyday case).
# The C locale is forced as a plain assignment inside the substitution's subshell, not as a
# command prefix: a prefix on a BUILTIN does not re-run setlocale, so it would leave a
# localized glibc strerror localized and neither pattern would match.
#
# Message matching is not something to lean on, so it is arranged not to be load-bearing:
# an unrecognised message - a locale that slipped past the assignment, a future wording, a
# shell whose kill reports something else entirely - is a step of the information path that
# could not complete, and routes to indeterminate. It must never fall through to a verdict
# claiming Lens Studio IS running, which is a fact this hook would not have established.
# The message is quoted back so a human can see what went unrecognised.
if kill_err="$(LC_ALL=C; kill -0 "$lock_pid" 2>&1)"; then
  studio_mute
fi
case "$kill_err" in
  *"o such process"*) studio_gone ;;  # ESRCH
  *"ot permitted"*) studio_mute ;;    # EPERM: alive, just not ours to signal
  *) indeterminate "checking whether process ${lock_pid} from ${lock_file} is still running gave a result this hook cannot interpret: '${kill_err}'" ;;
esac
