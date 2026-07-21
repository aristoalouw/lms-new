[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidatePattern('^https://')]
    [string]$BaseUrl,

    [Parameter()]
    [switch]$RequireReady
)

$ErrorActionPreference = "Stop"
$base = $BaseUrl.TrimEnd('/')
$failures = [System.Collections.Generic.List[string]]::new()

function Invoke-Probe {
    param([string]$Path)
    try {
        return Invoke-WebRequest -Uri "$base$Path" -Method Get -MaximumRedirection 0 -TimeoutSec 20 -UseBasicParsing
    }
    catch {
        if ($_.Exception.Response) { return $_.Exception.Response }
        throw
    }
}

function Require-Header {
    param($Response, [string]$Name, [string]$Contains)
    $value = [string]$Response.Headers[$Name]
    if ([string]::IsNullOrWhiteSpace($value) -or ($Contains -and $value -notmatch [regex]::Escape($Contains))) {
        $script:failures.Add("Header $Name is missing or invalid.")
    }
}

$login = Invoke-Probe "/login"
if ([int]$login.StatusCode -ne 200) { $failures.Add("Login page returned HTTP $([int]$login.StatusCode).") }
Require-Header $login "Strict-Transport-Security" "max-age="
Require-Header $login "X-Content-Type-Options" "nosniff"
Require-Header $login "X-Frame-Options" "DENY"
Require-Header $login "Content-Security-Policy" "default-src"
Require-Header $login "Cache-Control" "no-store"
Require-Header $login "X-Request-ID" ""

$health = Invoke-Probe "/api/health"
if ([int]$health.StatusCode -ne 200) { $failures.Add("Liveness endpoint returned HTTP $([int]$health.StatusCode).") }
Require-Header $health "Cache-Control" "no-store"

$ready = Invoke-Probe "/api/ready"
Require-Header $ready "Cache-Control" "no-store"
if ($RequireReady -and [int]$ready.StatusCode -ne 200) {
    $failures.Add("Readiness endpoint returned HTTP $([int]$ready.StatusCode).")
}

if ($failures.Count -gt 0) {
    foreach ($failure in $failures) { Write-Error $failure -ErrorAction Continue }
    exit 1
}

Write-Host "Production smoke checks passed for $base."
Write-Host "Readiness status: $([int]$ready.StatusCode). Response bodies were not printed."
