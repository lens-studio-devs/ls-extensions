# Lens Studio MCP liveness gate (Windows). PreToolUse hook for mcp__lens-studio__* calls.
# Probes the lens-studio endpoint from .mcp.json via .NET TcpClient - no external deps.
#   alive -> allow (emit a note, exit 0)
#   dead  -> deny the call and halt the turn (JSON on stdout)
# ALWAYS emits an additionalContext note so every run is visible - it never exits silently.
# Fails OPEN on anything uncertain so it never blocks unrelated work. The token is
# never read or logged. The macOS/Linux counterpart is mcp-liveness-check.sh.
#
# ASCII ONLY: this file is read by Windows PowerShell 5.1, which decodes .ps1 as
# Windows-1252 unless there is a BOM. Non-ASCII bytes (em-dashes, smart quotes) break
# string/brace parsing and silently kill the hook. Keep every character 7-bit ASCII.
$ErrorActionPreference = 'SilentlyContinue'

# Emit an allow-with-note object (additionalContext does not block the call).
function Emit($msg) {
  @{ hookSpecificOutput = @{ hookEventName = 'PreToolUse'; additionalContext = "LS liveness gate (pwsh): $msg" } } | ConvertTo-Json -Depth 5 -Compress
}

$raw = [Console]::In.ReadToEnd()
$cwd = $null
try { $cwd = ($raw | ConvertFrom-Json).cwd } catch {}

$url = $null
foreach ($dir in @($env:CLAUDE_PROJECT_DIR, $cwd, (Get-Location).Path)) {
  if (-not $dir) { continue }
  $f = Join-Path $dir '.mcp.json'
  if (-not (Test-Path $f)) { continue }
  try {
    $url = (Get-Content -Raw $f | ConvertFrom-Json).mcpServers.'lens-studio'.url
    if ($url) { break }
  } catch {}
}
if (-not $url) { Emit 'no lens-studio url in .mcp.json - allowing'; exit 0 }

try { $u = [Uri]$url; $h = $u.Host; $p = $u.Port } catch { Emit 'could not parse lens-studio url - allowing'; exit 0 }
if (-not $p -or $p -le 0) { Emit 'no port in url - allowing'; exit 0 }
if ($h -eq 'localhost') { $h = '127.0.0.1' }  # Lens Studio binds IPv4 loopback

$alive = $false
try {
  $c = New-Object Net.Sockets.TcpClient
  $iar = $c.BeginConnect($h, $p, $null, $null)
  $alive = $iar.AsyncWaitHandle.WaitOne(1000)  # 1s timeout
  if ($alive) { $c.EndConnect($iar) }
  $c.Close()
} catch { $alive = $false }
if ($alive) { Emit "Lens Studio reachable at ${h}:${p} - allowing"; exit 0 }  # alive -> allow

# dead -> deny the call and halt the turn
$reason = "Lens Studio MCP server is not reachable at ${h}:${p}. Lens Studio has crashed or been quit. Do NOT retry this or any other mcp__lens-studio__ tool."
@{
  hookSpecificOutput = @{ hookEventName = 'PreToolUse'; permissionDecision = 'deny'; permissionDecisionReason = $reason }
  continue = $false
  systemMessage = 'Lens Studio is not running - halting. Relaunch Lens Studio, ensure the MCP server is running, then retry.'
} | ConvertTo-Json -Depth 5 -Compress
exit 0
