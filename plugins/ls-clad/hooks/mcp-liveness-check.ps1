# Lens Studio MCP liveness gate (Windows). PreToolUse hook for mcp__lens-studio__* calls.
# Probes the lens-studio endpoint from .mcp.json via .NET TcpClient - no external deps.
#   alive -> allow (emit a note, exit 0)
#   dead  -> deny the call (JSON on stdout), halting the turn unless recovery is safe
# Never exits silently: every path emits either a note or a deny. The token is never read
# or logged. The macOS/Linux counterpart is mcp-liveness-check.sh.
#
# After a failed probe, the live-instance record and project lock distinguish Studio running
# but mute, Studio gone, nothing open, and indeterminate ownership. Only the two cases where a
# relaunch could work leave the turn alive. Anything unreadable routes to indeterminate.
#
# ASCII ONLY: Windows PowerShell 5.1 decodes a BOM-less .ps1 as Windows-1252. Keep every
# character 7-bit ASCII so smart punctuation cannot break string or brace parsing.
$ErrorActionPreference = 'SilentlyContinue'

function Emit($msg) {
  @{ hookSpecificOutput = @{ hookEventName = 'PreToolUse'; additionalContext = "LS liveness gate (pwsh): $msg" } } | ConvertTo-Json -Depth 5 -Compress
}
function Deny($reason, $message) {
  @{ hookSpecificOutput = @{ hookEventName = 'PreToolUse'; permissionDecision = 'deny'; permissionDecisionReason = $reason }; continue = $false; systemMessage = $message } | ConvertTo-Json -Depth 5 -Compress
  exit 0
}
function Deny-Recoverable($reason, $message) {
  @{ hookSpecificOutput = @{ hookEventName = 'PreToolUse'; permissionDecision = 'deny'; permissionDecisionReason = $reason }; continue = $true; systemMessage = $message } | ConvertTo-Json -Depth 5 -Compress
  exit 0
}
function Indeterminate($detail) {
  Deny "Lens Studio MCP server is not reachable at $endpoint, and which process (if any) holds the project could not be determined: $detail. Make no assumption about whether Lens Studio is running.$known $retryNote" "Lens Studio is unreachable at $endpoint and project ownership could not be determined ($detail) - halting. Check Lens Studio yourself, then retry."
}
function Studio-Mute {
  Deny "Lens Studio MCP server is not answering at $endpoint, but Lens Studio IS running with this project: process $lockPid holds $lockFile. Something else may hold port $p, the MCP plugin may be disabled, or the server may still be starting up. There is no relaunch to offer - a second Lens Studio cannot take a project lock this one still holds.$known $retryNote" "Lens Studio is running with $projectLabel (pid $lockPid) but its MCP server is not answering at $endpoint - halting. Check that the MCP plugin is enabled and that nothing else holds port $p."
}
function Studio-Gone {
  $head = "Lens Studio MCP server is not reachable at $endpoint. Lens Studio was serving this project and is gone: process $lockPid, recorded in $lockFile, is no longer running. Both the record and the lock file persist until the project is next opened, so this says nothing about when it exited."
  if ($relaunch) { Deny-Recoverable "$head$relaunchRecover$known $recoverNote" "Lens Studio is gone - it was serving $projectLabel as pid $lockPid. Blocking this call; the agent should run the ls-studio-recover skill to relaunch Lens Studio and reopen the project, then retry." }
  Deny "$head$relaunch$known $retryNote" "Lens Studio is gone - it was serving $projectLabel as pid $lockPid - halting. Relaunch Lens Studio, open the project, ensure the MCP server is running, then retry."
}
function Nothing-Open {
  $head = "Lens Studio MCP server is not reachable at $endpoint. Lens Studio is not running with this project - no project lock exists beside $recordProject."
  if ($relaunch) { Deny-Recoverable "$head$relaunchRecover$known $recoverNote" "Lens Studio is not running with $projectLabel. Blocking this call; the agent should run the ls-studio-recover skill to open the project in Lens Studio, then retry." }
  Deny "$head$relaunch$known $retryNote" "Lens Studio is not running with $projectLabel - halting. Open the project in Lens Studio, ensure the MCP server is running, then retry."
}
function Test-TcpPort($server, $serverPort) {
  $client = $null; $waitHandle = $null
  try {
    $client = New-Object Net.Sockets.TcpClient
    $async = $client.BeginConnect($server, $serverPort, $null, $null)
    $waitHandle = $async.AsyncWaitHandle
    if (-not $waitHandle.WaitOne(1000)) { return $false }
    $client.EndConnect($async); return $true
  } catch { return $false } finally { if ($waitHandle) { $waitHandle.Close() }; if ($client) { $client.Close() } }
}
function Read-StringProperty($object, $name) {
  if (-not $object) { return '' }
  $property = $object.PSObject.Properties[$name]
  if (-not $property -or $property.Value -isnot [string]) { return '' }
  return [string]$property.Value
}
function Test-AbsoluteWindowsPath($path) {
  if (-not $path) { return $false }
  return ($path -match '^[A-Za-z]:[\\/]' -or $path -match '^\\\\[^\\/]+[\\/][^\\/]+')
}

$raw = [Console]::In.ReadToEnd(); $stdinCwd = $null
try { $stdinCwd = ($raw | ConvertFrom-Json).cwd } catch {}
$url = $null; $mcpDir = $null
foreach ($dir in @($env:CLAUDE_PROJECT_DIR, $stdinCwd, (Get-Location).Path)) {
  if (-not $dir) { continue }
  $configFile = Join-Path $dir '.mcp.json'
  if (-not (Test-Path -LiteralPath $configFile -PathType Leaf)) { continue }
  try {
    $url = (Get-Content -Raw -LiteralPath $configFile -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop).mcpServers.'lens-studio'.url
    if ($url) { $mcpDir = [string]$dir; break }
  } catch {}
}
if (-not $url) { Emit 'no lens-studio url in .mcp.json - allowing'; exit 0 }
try {
  $uri = [Uri][string]$url; $h = $uri.Host
  if ($uri.Authority -notmatch ':(\d+)$') { Emit 'no port in url - allowing'; exit 0 }
  $p = [int]$Matches[1]
} catch { Emit 'could not parse lens-studio url - allowing'; exit 0 }
if (-not $p -or $p -le 0 -or $p -gt 65535) { Emit 'no usable port in url - allowing'; exit 0 }
if ($h -eq 'localhost') { $h = '127.0.0.1' }
if (Test-TcpPort $h $p) { Emit "Lens Studio reachable at ${h}:${p} - allowing"; exit 0 }

$endpoint = "${h}:${p}"
$retryNote = 'Do NOT retry this or any other mcp__lens-studio__ tool.'
$recoverNote = 'Do NOT retry this or any other mcp__lens-studio__ tool yet. Invoke the ls-studio-recover skill first, and retry only once it reports Lens Studio is serving this project again.'
$recordFile = Join-Path $mcpDir 'ls-live-instance.json'
$haveRecord = $false; $recordProject = ''; $recordExe = ''; $recordVersion = ''
if (Test-Path -LiteralPath $recordFile -PathType Leaf) {
  try {
    $recordObject = Get-Content -Raw -LiteralPath $recordFile -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
    if ((Read-StringProperty $recordObject 'schemaVersion') -ceq '1') {
      $haveRecord = $true
      $recordProject = Read-StringProperty $recordObject 'projectPath'
      $recordExe = Read-StringProperty $recordObject 'executablePath'
      $recordVersion = Read-StringProperty $recordObject 'studioVersion'
    }
  } catch {}
}
$knownParts = @()
if ($recordProject) { $knownParts += "project=$recordProject" }; if ($recordVersion) { $knownParts += "version=$recordVersion" }; if ($recordExe) { $knownParts += "executable=$recordExe" }
$known = if ($knownParts.Count -gt 0) { ' From the live-instance record: ' + ($knownParts -join '; ') + '.' } else { '' }
$relaunch = ''; $relaunchRecover = ''
if ($recordExe -and $recordProject) {
  $relaunch = " Command for the user to run: `"$recordExe`" `"$recordProject`" - do not run it yourself."
  $relaunchRecover = " The command that restores it is `"$recordExe`" `"$recordProject`" - the ls-studio-recover skill runs it for you; do not spawn it yourself."
}
$projectLabel = if ($recordProject) { Split-Path -Leaf $recordProject } else { 'this project' }

$lockFiles = @()
if ($haveRecord) {
  if (-not $recordProject) { Indeterminate 'the live-instance record names no project path' }
  if (-not (Test-AbsoluteWindowsPath $recordProject)) { Indeterminate "the recorded project path '$recordProject' is not absolute" }
  $lockDir = Split-Path -Parent $recordProject; $projectBase = Split-Path -Leaf $recordProject
  if (-not (Test-Path -LiteralPath $lockDir -PathType Container)) { Indeterminate "the recorded project directory '$lockDir' is not there to inspect" }
  try {
    $prefix = $projectBase + '.'
    foreach ($item in Get-ChildItem -LiteralPath $lockDir -File -Filter '*.lock' -ErrorAction Stop) {
      if (-not $item.Name.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { continue }
      $suffix = $item.Name.Substring($prefix.Length)
      if ($suffix.Length -gt 5 -and $suffix.EndsWith('.lock', [StringComparison]::OrdinalIgnoreCase)) { $lockFiles += $item.FullName }
    }
  } catch { Indeterminate "the recorded project directory '$lockDir' could not be inspected" }
  if ($lockFiles.Count -eq 0) { Nothing-Open }
} else {
  try { foreach ($item in Get-ChildItem -LiteralPath $mcpDir -File -Filter '*.lock' -ErrorAction Stop) { if ($item.Name -like '*.esproj.*.lock') { $lockFiles += $item.FullName } } }
  catch { Indeterminate "the project directory '$mcpDir' could not be inspected" }
  if ($lockFiles.Count -eq 0) { Indeterminate "there is no usable live-instance record in $mcpDir and no project lock there either" }
}
if ($lockFiles.Count -ne 1) { Indeterminate "$($lockFiles.Count) project locks matched, so the owning process is ambiguous" }
$lockFile = [string]$lockFiles[0]
try { $lockLines = [IO.File]::ReadAllLines($lockFile) } catch { Indeterminate "the lock $lockFile could not be read" }
$lockPid = if ($lockLines.Count -ge 1) { [string]$lockLines[0] } else { '' }
$lockApp = if ($lockLines.Count -ge 2) { [string]$lockLines[1] } else { '' }
$lockHost = if ($lockLines.Count -ge 3) { [string]$lockLines[2] } else { '' }
if (-not $lockApp) { Indeterminate "the lock $lockFile has no application name on line 2 - it is empty or truncated" }
if ($lockApp.IndexOf('lens studio', [StringComparison]::OrdinalIgnoreCase) -lt 0) { Indeterminate "the lock $lockFile does not look like a Lens Studio lock (line 2 reads '$lockApp')" }
$badPidMessage = "the lock $lockFile carries '$lockPid' where a process id should be"
if (-not $lockPid -or $lockPid -notmatch '^[0-9]+$' -or $lockPid.Length -gt 10) { Indeterminate $badPidMessage }
$lockPidNumber = [long]0
if (-not [long]::TryParse($lockPid, [ref]$lockPidNumber)) { Indeterminate $badPidMessage }
if ($lockPidNumber -lt 1) { Indeterminate "the lock $lockFile carries process id $lockPid" }
if ($lockPidNumber -gt [int]::MaxValue) { Indeterminate $badPidMessage }
$thisHost = ''
try { $thisHost = [Net.Dns]::GetHostName() } catch {}
if (-not $thisHost) { $thisHost = $env:COMPUTERNAME }; if ($thisHost) { $thisHost = $thisHost.Split('.')[0] }
$shortLockHost = if ($lockHost) { $lockHost.Split('.')[0] } else { '' }
if (-not $thisHost -or -not $shortLockHost) { Indeterminate "the lock's host name could not be compared with this machine's" }
if (-not $thisHost.Equals($shortLockHost, [StringComparison]::OrdinalIgnoreCase)) { Indeterminate "the lock was taken by host '$lockHost', not by this machine" }
try { $null = [Diagnostics.Process]::GetProcessById([int]$lockPidNumber); Studio-Mute }
catch [ArgumentException] { Studio-Gone }
catch { Indeterminate "checking whether process $lockPid from $lockFile is still running failed: $($_.Exception.Message)" }
