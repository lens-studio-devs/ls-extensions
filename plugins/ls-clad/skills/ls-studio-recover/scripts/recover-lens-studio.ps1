# Copyright 2026 Specs Inc.
# SPDX-License-Identifier: Apache-2.0
#
# Relaunch Lens Studio after it died, on the MCP port the running session already uses.
# First line / exit: SUCCESS 0, REFUSED 10 (nothing launched), FAILED 20 (launch unusable).
# The bearer token is never printed. It is pinned for the relaunch (McpAuthToken, in a per-user temp file
# that is deleted before the script exits) and used for the tools/list readiness probe.
# Test overrides: LS_RECOVER_DIR and LS_RECOVER_TIMEOUT (seconds).
# Targets Windows PowerShell 5.1 and PowerShell 7, ASCII only.
$ErrorActionPreference = 'Stop'

$readyTimeout = 120; $parsedTimeout = 0
if ($env:LS_RECOVER_TIMEOUT -and [int]::TryParse($env:LS_RECOVER_TIMEOUT, [ref]$parsedTimeout) -and $parsedTimeout -gt 0) { $readyTimeout = $parsedTimeout }
$probePath = '/.well-known/oauth-authorization-server'; $recordName = 'ls-live-instance.json'
$manualCommand = ''; $project = ''; $endpoint = ''

function Say($message) { [Console]::Out.WriteLine([string]$message) }
$pinConfig = ''
function Remove-Pin { if ($script:pinConfig) { Remove-Item -LiteralPath $script:pinConfig -Force -ErrorAction SilentlyContinue } }
function Refuse($reason) {
  Remove-Pin
  Say 'RECOVERY: REFUSED'; Say "Reason: $reason"
  if ($manualCommand) { Say "Command for the user to run by hand: $manualCommand" }
  exit 10
}
$spawnPid = $null
function Fail($reason) {
  Remove-Pin
  Say 'RECOVERY: FAILED'; Say "Reason: $reason"
  # A launched-but-unusable Lens Studio must not keep the port: the caller's own relaunch would bind its
  # session to this broken instance.
  if ($script:spawnPid) {
    try { Stop-Process -Id $script:spawnPid -Force -ErrorAction Stop; Say "  (the Lens Studio this script launched, pid $($script:spawnPid), was stopped so it does not hold port $port)" } catch {}
  }; Say "  project:    $project"; Say "  endpoint:   $endpoint"
  if ($manualCommand) { Say "Command for the user to run by hand: $manualCommand" }
  exit 20
}
function Test-TcpPort($server, $serverPort) {
  $client = $null; $waitHandle = $null
  try {
    $client = New-Object Net.Sockets.TcpClient
    $async = $client.BeginConnect($server, $serverPort, $null, $null); $waitHandle = $async.AsyncWaitHandle
    if (-not $waitHandle.WaitOne(1000)) { return $false }
    $client.EndConnect($async); return $true
  } catch { return $false } finally { if ($waitHandle) { $waitHandle.Close() }; if ($client) { $client.Close() } }
}
function Send-RawHttp($server, $serverPort, $requestText, $readTimeoutMs) {
  $client = $null; $stream = $null; $memory = $null
  try {
    $client = New-Object Net.Sockets.TcpClient
    $async = $client.BeginConnect($server, $serverPort, $null, $null); $waitHandle = $async.AsyncWaitHandle
    try { if (-not $waitHandle.WaitOne(1000)) { return $null }; $client.EndConnect($async) } finally { $waitHandle.Close() }
    $stream = $client.GetStream(); $stream.ReadTimeout = $readTimeoutMs; $stream.WriteTimeout = $readTimeoutMs
    $requestBytes = [Text.Encoding]::UTF8.GetBytes($requestText); $stream.Write($requestBytes, 0, $requestBytes.Length); $stream.Flush()
    $buffer = New-Object byte[] 8192; $memory = New-Object IO.MemoryStream
    try { while ($true) { $read = $stream.Read($buffer, 0, $buffer.Length); if ($read -le 0) { break }; $memory.Write($buffer, 0, $read) } }
    catch [IO.IOException] { if ($memory.Length -eq 0) { return $null } }
    return [Text.Encoding]::UTF8.GetString($memory.ToArray())
  } catch { return $null } finally { if ($memory) { $memory.Close() }; if ($stream) { $stream.Close() }; if ($client) { $client.Close() } }
}
function Test-HttpReady($server, $serverPort) {
  $request = "GET $probePath HTTP/1.0`r`nHost: $server`r`nConnection: close`r`n`r`n"
  $response = Send-RawHttp $server $serverPort $request 3000
  return ($response -and $response -match '^HTTP/')
}
function Get-ToolCount($server, $serverPort, $path, $authorization) {
  $body = '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'; $length = [Text.Encoding]::UTF8.GetByteCount($body)
  $request = "POST $path HTTP/1.0`r`nHost: $server`r`nAuthorization: $authorization`r`nContent-Type: application/json`r`nAccept: application/json, text/event-stream`r`nContent-Length: $length`r`nConnection: close`r`n`r`n$body"
  $response = Send-RawHttp $server $serverPort $request 5000
  if (-not $response -or $response -notmatch '"result"') { return -1 }
  return [regex]::Matches($response, '"inputSchema"').Count
}
function Quote-WindowsArgument($value) {
  if ($null -eq $value -or $value.Length -eq 0) { return '""' }
  if ($value -notmatch '[\s"]') { return $value }
  $builder = New-Object Text.StringBuilder; $null = $builder.Append('"'); $slashes = 0
  foreach ($character in $value.ToCharArray()) {
    if ($character -eq '\') { $slashes++; continue }
    if ($character -eq '"') { $null = $builder.Append(('\' * ($slashes * 2 + 1))); $null = $builder.Append('"'); $slashes = 0; continue }
    if ($slashes -gt 0) { $null = $builder.Append(('\' * $slashes)); $slashes = 0 }
    $null = $builder.Append($character)
  }
  if ($slashes -gt 0) { $null = $builder.Append(('\' * ($slashes * 2))) }; $null = $builder.Append('"')
  return $builder.ToString()
}
function Read-RecordProject($path) {
  try { $recordObject = Get-Content -Raw -LiteralPath $path -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop; if ($recordObject.projectPath -is [string]) { return [string]$recordObject.projectPath } } catch {}
  return ''
}
function Test-SameWindowsPath($left, $right) {
  try { return ([IO.Path]::GetFullPath($left)).Equals([IO.Path]::GetFullPath($right), [StringComparison]::OrdinalIgnoreCase) } catch { return $false }
}

# Read the expected port first. Opening the project rewrites .mcp.json.
$url = ''; $token = ''; $mcpDir = ''
foreach ($dir in @($env:LS_RECOVER_DIR, $env:CLAUDE_PROJECT_DIR, (Get-Location).Path)) {
  if (-not $dir) { continue }; $configFile = Join-Path $dir '.mcp.json'
  if (-not (Test-Path -LiteralPath $configFile -PathType Leaf)) { continue }
  try {
    $config = Get-Content -Raw -LiteralPath $configFile -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop
    $serverConfig = $config.mcpServers.'lens-studio'; if (-not $serverConfig.url) { continue }
    $url = [string]$serverConfig.url; $mcpDir = [string]$dir
    if ($serverConfig.headers.Authorization -is [string]) { $token = [string]$serverConfig.headers.Authorization }; break
  } catch {}
}
if (-not $mcpDir) { Refuse 'no lens-studio url could be read from a .mcp.json in $CLAUDE_PROJECT_DIR or the working directory, so the port this session expects is unknown.' }
try {
  $uri = [Uri]$url; $serverHost = $uri.Host
  if ($uri.Authority -notmatch ':(\d+)$') { Refuse "the lens-studio url in $mcpDir/.mcp.json has no port." }
  $port = [int]$Matches[1]; $mcpPath = $uri.AbsolutePath; if (-not $mcpPath) { $mcpPath = '/mcp' }
} catch { Refuse "the lens-studio url in $mcpDir/.mcp.json has no usable port." }
if ($port -le 0 -or $port -gt 65535) { Refuse "the lens-studio url in $mcpDir/.mcp.json has no usable port." }
if ($serverHost -eq 'localhost') { $serverHost = '127.0.0.1' }; $endpoint = "${serverHost}:${port}"

# Read the record after preserving the expected port.
$record = Join-Path $mcpDir $recordName
if (-not (Test-Path -LiteralPath $record -PathType Leaf)) { Refuse "there is no readable $recordName in $mcpDir, so the project and the executable to relaunch are unknown." }
try { $recordObject = Get-Content -Raw -LiteralPath $record -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop }
catch { Refuse "there is no readable $recordName in $mcpDir, so the project and the executable to relaunch are unknown." }
$project = if ($recordObject.projectPath -is [string]) { [string]$recordObject.projectPath } else { '' }
$exe = if ($recordObject.executablePath -is [string]) { [string]$recordObject.executablePath } else { '' }
if (-not $project) { Refuse "$record names no project path." }
if (-not $exe) { Refuse "$record names no executable path - this Lens Studio build predates recording it, so it cannot be relaunched automatically." }
$manualCommand = "`"$exe`" `"$project`""
if (-not (Test-Path -LiteralPath $project -PathType Leaf)) { Refuse "the recorded project $project is not there any more." }
if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { Refuse "the recorded Lens Studio $exe is not there, or is not executable." }
# No token means no recovery is possible. Lens Studio rejects every POST /mcp whose Authorization
# header is not an exact "Bearer <token>" match, and this session cannot re-read .mcp.json to pick
# up a token it did not start with - a relaunch would come back healthy and still 401 every call.
if (-not $token -or $token -match "[`r`n]") { Refuse "the lens-studio entry in $mcpDir/.mcp.json carries no usable bearer token, so this session could not authenticate to Lens Studio even after a successful relaunch. The user has to restart the session against a .mcp.json that has one." }

# Refuse if anything already answers: a post-launch probe could otherwise be a false success.
if (Test-TcpPort $serverHost $port) {
  Say 'RECOVERY: REFUSED'; Say "Reason: something is already answering on $endpoint, so a relaunch could not be verified."
  Say "If Lens Studio's MCP server came back by itself, retrying the denied call settles it. Otherwise another process holds port $port and only the user can free it."
  exit 10
}

# Pin the port AND the token with a throwaway config. When the dead instance was started with a --config
# carrying McpAuthToken (the CI harness does this), a port-only relaunch mints a NEW token and every call
# from this session - which cannot re-read .mcp.json - then gets a 401. Pinning the session's token keeps it.
# If Lens Studio ever keeps the token across a port-only relaunch, the McpAuthToken pin can be dropped.
$rawToken = $token -replace '^[Bb]earer ', ''
$pinConfig = Join-Path ([IO.Path]::GetTempPath()) ("ls-clad-mcp-pin-" + [Guid]::NewGuid().ToString('N') + ".json")
# From here on a pin (holding the session token) may exist: remove it on every exit path, including Ctrl+C
# and unhandled errors - PowerShell runs finally on exit and on a stopped pipeline.
try {
$pinJson = (@{ McpPort = [string]$port; McpAuthToken = $rawToken } | ConvertTo-Json -Compress)
try { [IO.File]::WriteAllText($pinConfig, "$pinJson`n", (New-Object Text.UTF8Encoding($false))) }
catch { Refuse "the port pin could not be written to $pinConfig." }
if (-not (Test-Path -LiteralPath $pinConfig -PathType Leaf) -or (Get-Item -LiteralPath $pinConfig).Length -le 0) { Refuse "the port pin could not be written to $pinConfig." }

# Launch the recorded executable directly and detached from any shell or launcher.
$startTime = [DateTime]::UtcNow
try {
  $startInfo = New-Object Diagnostics.ProcessStartInfo; $startInfo.FileName = $exe
  $startInfo.Arguments = (Quote-WindowsArgument '--config') + ' ' + (Quote-WindowsArgument $pinConfig) + ' ' + (Quote-WindowsArgument $project)
  $startInfo.UseShellExecute = $false; $startInfo.CreateNoWindow = $true
  $process = New-Object Diagnostics.Process; $process.StartInfo = $startInfo
  if (-not $process.Start()) { Fail "Lens Studio could not be launched from $exe at all." }; $spawnPid = $process.Id
} catch { Fail "Lens Studio could not be launched from $exe at all." }

# Wait for the HTTP endpoint while proving the launched process remains alive.
$deadline = $startTime.AddSeconds($readyTimeout); $ready = $false
while ([DateTime]::UtcNow -lt $deadline) {
  if (Test-HttpReady $serverHost $port) { $ready = $true; break }
  try { if ($process.HasExited) { $elapsed = [int]([DateTime]::UtcNow - $startTime).TotalSeconds; Fail "Lens Studio was launched but the process (pid $spawnPid) exited after about ${elapsed}s, before MCP came up. Run the command by hand to see why." } }
  catch { Fail "Lens Studio was launched, but its process (pid $spawnPid) could no longer be inspected before MCP came up." }
  Start-Sleep -Milliseconds 1000
}
if (-not $ready) { Fail "nothing answered on $endpoint within ${readyTimeout}s. Lens Studio is running (pid $spawnPid), but it may have come back on a different auto-scanned port in 50040-50049 - which this session cannot use. A restarted session would pick that up." }

# Success requires a positive tools/list count that is steady across two polls.
$previousCount = -1; $toolCount = -1; $settled = $false
while ([DateTime]::UtcNow -lt $deadline) {
  $toolCount = Get-ToolCount $serverHost $port $mcpPath $token
  if ($toolCount -gt 0 -and $toolCount -eq $previousCount) { $settled = $true; break }
  $previousCount = $toolCount; Start-Sleep -Milliseconds 2000
}
if (-not $settled) { Fail "Lens Studio answered on $endpoint but its MCP tool list never settled within ${readyTimeout}s (last count: $toolCount). It is running, but a tool call now could fail for a tool that appears later; the Logger panel may show a plugin that failed to load." }

# The refreshed record must still name the requested project.
$nowProject = Read-RecordProject $record
if (-not (Test-SameWindowsPath $nowProject $project)) {
  $projectDescription = if ($nowProject) { $nowProject } else { 'nothing' }
  Fail "$endpoint is answering, but $recordName now names $projectDescription rather than the requested project, so a tool call would act on the wrong project."
}
$version = ''
try { $latestRecord = Get-Content -Raw -LiteralPath $record -ErrorAction Stop | ConvertFrom-Json -ErrorAction Stop; if ($latestRecord.studioVersion -is [string]) { $version = [string]$latestRecord.studioVersion } } catch {}
$elapsedSeconds = [int]([DateTime]::UtcNow - $startTime).TotalSeconds
Remove-Pin
Say 'RECOVERY: SUCCESS'; Say 'Lens Studio is back and answering MCP on the port this session uses.'
Say "  project:   $project"; Say "  version:   $version"; Say "  endpoint:  $endpoint"; Say "  pid:       $spawnPid"; Say "  ready in:  ${elapsedSeconds}s"
Say "  mcp tools: $toolCount registered, steady across two polls"
Say 'Retry the Lens Studio MCP call that was denied. If the client already dropped the server, the user has to restart the session.'
exit 0
} finally { Remove-Pin }
