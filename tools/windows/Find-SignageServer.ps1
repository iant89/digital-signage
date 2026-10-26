# ============================================================================
# tools/windows/Find-SignageServer.ps1
# Windows PowerShell front-end for the Digital Signage Studio LAN scanner.
#
# This is a thin, dependency-light wrapper around the tested Node scanner in
# tools/network-scanner. It gives Windows admins cmdlet-style parameters while
# keeping a single implementation of the discovery protocol.
#
# Requires: Windows PowerShell 5.1+ (or PowerShell 7+) and Node.js 18+.
# ============================================================================

[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string[]]$Subnet,

    [int]$Port = 4000,

    [ValidateSet('http', 'https')]
    [string]$Scheme = 'http',

    [switch]$Https,

    [int]$TimeoutMs = 400,

    [int]$HttpTimeoutMs = 2000,

    [int]$Concurrency = 96,

    [int]$MaxHosts = 4096,

    [string]$DiscoveryPath = '/api/v1/discovery',

    [string]$ServiceId = 'digital-signage-studio',

    [switch]$Json,

    [switch]$Quiet,

    [switch]$First,

    [switch]$Insecure,

    [switch]$NoTcpProbe,

    [switch]$IncludeNetworkAndBroadcast,

    [switch]$IncludeLinkLocal,

    [switch]$IncludeLoopback,

    [switch]$ShowRejections
)

$ErrorActionPreference = 'Stop'

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
    Write-Error 'Node.js 18 or newer is required. Install from https://nodejs.org/ or run from the project checkout.'
    exit 2
}

$scanner = Join-Path $PSScriptRoot '..\network-scanner\find-signage-server.mjs'
if (-not (Test-Path -LiteralPath $scanner)) {
    Write-Error "Scanner not found: $scanner"
    exit 2
}

$effectiveScheme = if ($Https) { 'https' } else { $Scheme }

$nodeArgs = @()
foreach ($entry in $Subnet) {
    if ($entry) {
        foreach ($piece in $entry.Split(',')) {
            if ($piece.Trim()) { $nodeArgs += @('--subnet', $piece.Trim()) }
        }
    }
}
$nodeArgs += @(
    '--port', $Port,
    '--scheme', $effectiveScheme,
    '--timeout-ms', $TimeoutMs,
    '--http-timeout-ms', $HttpTimeoutMs,
    '--concurrency', $Concurrency,
    '--max-hosts', $MaxHosts,
    '--discovery-path', $DiscoveryPath,
    '--service-id', $ServiceId
)
if ($Json) { $nodeArgs += '--json' }
if ($Quiet) { $nodeArgs += '--quiet' }
if ($First) { $nodeArgs += '--first' }
if ($Insecure) { $nodeArgs += '--insecure' }
if ($NoTcpProbe) { $nodeArgs += '--no-tcp-probe' }
if ($IncludeNetworkAndBroadcast) { $nodeArgs += '--include-network-and-broadcast' }
if ($IncludeLinkLocal) { $nodeArgs += '--include-link-local' }
if ($IncludeLoopback) { $nodeArgs += '--include-loopback' }
if ($ShowRejections) { $nodeArgs += '--verbose' }

& $nodeCommand.Source $scanner @nodeArgs
exit $LASTEXITCODE
