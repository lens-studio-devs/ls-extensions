#!/usr/bin/env bash
# Lens Studio MCP liveness gate (macOS/Linux). PreToolUse hook for mcp__lens-studio__* calls.
# Probes the lens-studio endpoint from .mcp.json via bash /dev/tcp - no external deps.
#   alive -> allow (emit a note, exit 0)
#   dead  -> deny the call and halt the turn (JSON on stdout)
# ALWAYS emits an additionalContext note so every run is visible - it never exits silently.
# Fails OPEN on anything uncertain so it never blocks unrelated work. The token is
# never read or logged. The Windows counterpart is mcp-liveness-check.ps1.
#
# ASCII ONLY, to match the PowerShell counterpart's constraint and avoid any locale/encoding
# surprises in JSON output. Keep every character 7-bit ASCII.

# Emit an allow-with-note JSON object (additionalContext does not block the call).
emit() {
  printf '%s' "{\"hookSpecificOutput\":{\"hookEventName\":\"PreToolUse\",\"additionalContext\":\"LS liveness gate (bash): $1\"}}"
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
for dir in "$CLAUDE_PROJECT_DIR" "$stdin_cwd" "$PWD"; do
  [ -n "$dir" ] && [ -f "$dir/.mcp.json" ] || continue
  url="$(tr -d '\n\r' < "$dir/.mcp.json" | sed -n 's/.*"lens-studio"[[:space:]]*:[[:space:]]*{[^}]*"url"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
  [ -n "$url" ] && break
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

# dead -> deny the call and halt the turn
printf '%s' "{\"hookSpecificOutput\":{\"hookEventName\":\"PreToolUse\",\"permissionDecision\":\"deny\",\"permissionDecisionReason\":\"Lens Studio MCP server is not reachable at ${host}:${port}. Lens Studio has crashed or been quit. Do NOT retry this or any other mcp__lens-studio__ tool.\"},\"continue\":false,\"systemMessage\":\"Lens Studio is not running - halting. Relaunch Lens Studio, ensure the MCP server is running, then retry.\"}"
exit 0
