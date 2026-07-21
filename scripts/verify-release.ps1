[CmdletBinding()]
param(
    [Parameter()]
    [string]$EnvironmentFile = ".env.production",

    [Parameter()]
    [switch]$SkipApplicationChecks,

    [Parameter()]
    [string]$BaseUrl
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$failures = [System.Collections.Generic.List[string]]::new()

function Add-Failure {
    param([string]$Message)
    $script:failures.Add($Message)
}

function Invoke-Checked {
    param([string]$Label, [scriptblock]$Command)
    Write-Host "==> $Label"
    & $Command
    if ($LASTEXITCODE -ne 0) { throw "$Label failed with exit code $LASTEXITCODE." }
}

function Read-DotEnvValues {
    param([string]$Path)
    $result = @{}
    foreach ($line in Get-Content -LiteralPath $Path) {
        $trimmed = $line.Trim()
        if (-not $trimmed -or $trimmed.StartsWith("#")) { continue }
        $separator = $trimmed.IndexOf("=")
        if ($separator -lt 1) { continue }
        $name = $trimmed.Substring(0, $separator).Trim()
        $value = $trimmed.Substring($separator + 1).Trim()
        if (($value.StartsWith('"') -and $value.EndsWith('"')) -or
            ($value.StartsWith("'") -and $value.EndsWith("'"))) {
            $value = $value.Substring(1, $value.Length - 2)
        }
        $result[$name] = $value
    }
    return $result
}

Push-Location $repoRoot
try {
    if (-not (Test-Path -LiteralPath $EnvironmentFile -PathType Leaf)) {
        throw "Environment file not found: $EnvironmentFile"
    }

    # validate-env exits non-zero on failure. Running it in a child PowerShell
    # process preserves the orchestration script's finally block and location.
    $powerShellExecutable = (Get-Process -Id $PID).Path
    Invoke-Checked "Production environment validation" {
        & $powerShellExecutable -NoProfile -File "$PSScriptRoot\validate-env.ps1" -Path $EnvironmentFile
    }

    if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw "git is required." }
    $trackedFiles = @(& git ls-files)
    if ($LASTEXITCODE -ne 0) { throw "Could not enumerate tracked files." }
    if ($trackedFiles.Count -eq 0) { Add-Failure "Git has no tracked files; release provenance cannot be verified." }

    $forbiddenTrackedNames = $trackedFiles | Where-Object {
        $_ -match '(^|/)(\.env($|\.)|secrets?/|credentials?[^/]*\.json$)' -and $_ -ne '.env.example' -or
        $_ -match '(?i)(service-account|firebase-admin).*\.json$|\.(pem|key|p12|pfx)$'
    }
    foreach ($file in $forbiddenTrackedNames) { Add-Failure "Credential-like file is tracked: $file" }

    foreach ($file in $trackedFiles) {
        if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { continue }
        $item = Get-Item -LiteralPath $file
        if ($item.Length -gt 2MB -or $item.Extension -match '(?i)^\.(woff2?|ttf|eot|ico|png|jpe?g|gif|pdf|zip)$') { continue }
        $content = Get-Content -Raw -LiteralPath $file -ErrorAction SilentlyContinue
        if ($content -match '-----BEGIN [A-Z ]*PRIVATE KEY-----') {
            Add-Failure "A private-key marker is present in tracked file: $file"
        }
    }

    if (Test-Path -LiteralPath '.openai\hosting.json') {
        Add-Failure ".openai/hosting.json conflicts with the required Nginx production entry point."
    }
    $dockerfile = Get-Content -Raw -LiteralPath 'infra\Dockerfile'
    if ($dockerfile -match '(?m)^\s*COPY\s+\.\s+\.') {
        Add-Failure "Dockerfile uses COPY . ., which can place local secrets in an image layer."
    }

    $package = Get-Content -Raw -LiteralPath 'package.json' | ConvertFrom-Json
    $allPackages = @($package.dependencies.PSObject.Properties.Name) + @($package.devDependencies.PSObject.Properties.Name)
    $aiPackagePattern = '(?i)(^|[-_/@])(openai|anthropic|langchain|llamaindex|tensorflow|pytorch|transformers|ollama|huggingface|cohere)([-_/]|$)'
    foreach ($packageName in $allPackages) {
        if ($packageName -match $aiPackagePattern) { Add-Failure "AI/ML dependency is outside scope: $packageName" }
    }
    foreach ($property in @($package.dependencies.PSObject.Properties) + @($package.devDependencies.PSObject.Properties)) {
        if ([string]$property.Value -match '^[\^~*]|^(latest|next|git\+|https?://)') {
            Add-Failure "Dependency is not pinned to an exact registry version: $($property.Name)"
        }
    }

    if (-not $SkipApplicationChecks) {
        if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw "npm is required." }
        Invoke-Checked "TypeScript/Nuxt typecheck" { & npm run typecheck }
        Invoke-Checked "Automated tests" { & npm test }
        Invoke-Checked "Production build" { & npm run build }
    }

    $envValues = Read-DotEnvValues -Path $EnvironmentFile
    $documentedEnvironment = Read-DotEnvValues -Path '.env.example'
    $environmentReferences = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    $environmentSourceFiles = @(
        Get-ChildItem -LiteralPath 'server' -Recurse -File -Include '*.ts', '*.js', '*.mjs'
        Get-Item -LiteralPath 'nuxt.config.ts'
    )
    foreach ($sourceFile in $environmentSourceFiles) {
        $sourceText = Get-Content -Raw -LiteralPath $sourceFile.FullName
        foreach ($match in [regex]::Matches($sourceText, 'process\.env\.([A-Z][A-Z0-9_]*)')) {
            [void]$environmentReferences.Add($match.Groups[1].Value)
        }
    }
    foreach ($name in $environmentReferences) {
        if ($name -eq 'NODE_ENV') { continue }
        if (-not $documentedEnvironment.ContainsKey($name)) {
            Add-Failure "Runtime environment variable is not documented in .env.example: $name"
        }
    }

    $sensitiveNames = @(
        'NUXT_SESSION_SECRET', 'DEMO_SESSION_SECRET', 'NEO_FEEDER_BASE_URL',
        'NEO_FEEDER_USERNAME', 'NEO_FEEDER_PASSWORD', 'SENTRY_DSN',
        'PAYMENT_GATEWAY_WEBHOOK_SECRET', 'RATE_LIMIT_KEY_SECRET', 'FILE_CURSOR_SECRET',
        'PMB_PII_HASH_SECRET', 'EMAIL_DELIVERY_BEARER_TOKEN', 'EMAIL_WORKER_SECRET',
        'PDDIKTI_ADAPTER_BEARER_TOKEN', 'PDDIKTI_WORKER_SECRET',
        'FIREBASE_SERVICE_ACCOUNT_JSON', 'FIREBASE_SERVICE_ACCOUNT_BASE64',
        'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY'
    )
    $sensitiveValues = [System.Collections.Generic.List[object]]::new()
    foreach ($name in $sensitiveNames) {
        $value = [string]$envValues[$name]
        if ($value.Length -ge 8) { $sensitiveValues.Add([pscustomobject]@{ Name = $name; Value = $value }) }
    }

    $credentialPath = [string]$envValues['FIREBASE_ADMIN_CREDENTIALS_FILE']
    if ($credentialPath -and (Test-Path -LiteralPath $credentialPath -PathType Leaf)) {
        try {
            $credential = Get-Content -Raw -LiteralPath $credentialPath | ConvertFrom-Json
            foreach ($entry in @(
                @{ Name = 'firebase-admin.private_key'; Value = [string]$credential.private_key },
                @{ Name = 'firebase-admin.client_email'; Value = [string]$credential.client_email }
            )) {
                if ($entry.Value.Length -ge 8) { $sensitiveValues.Add([pscustomobject]$entry) }
            }
        }
        catch {
            Add-Failure "Firebase Admin credential file is not valid JSON."
        }
    }

    if (Test-Path -LiteralPath '.output' -PathType Container) {
        $textExtensions = @('.mjs', '.js', '.json', '.html', '.css', '.map', '.txt', '.xml', '.svg')
        Get-ChildItem -LiteralPath '.output' -Recurse -File | Where-Object {
            $textExtensions -contains $_.Extension.ToLowerInvariant() -and $_.Length -le 20MB
        } | ForEach-Object {
            $outputText = [System.IO.File]::ReadAllText($_.FullName)
            foreach ($secret in $sensitiveValues) {
                if ($outputText.IndexOf($secret.Value, [StringComparison]::Ordinal) -ge 0) {
                    Add-Failure "Server-only value $($secret.Name) was embedded in build output: $($_.FullName.Substring($repoRoot.Length + 1))"
                }
            }
        }
    }
    elseif (-not $SkipApplicationChecks) {
        Add-Failure "Production build output is missing after build."
    }

    if (Get-Command docker -ErrorAction SilentlyContinue) {
        Invoke-Checked "Docker Compose model validation" {
            & docker compose --env-file $EnvironmentFile -f infra/compose.prod.yml config --quiet
        }
    }
    else {
        Write-Warning "Docker is unavailable; Compose/container validation must run in CI or staging."
    }

    if ($BaseUrl) {
        Invoke-Checked "Production HTTPS smoke test" {
            & $powerShellExecutable -NoProfile -File "$PSScriptRoot\smoke-production.ps1" -BaseUrl $BaseUrl -RequireReady
        }
    }

    if ($failures.Count -gt 0) {
        foreach ($failure in $failures) { Write-Error $failure -ErrorAction Continue }
        exit 1
    }

    Write-Host "Release verification passed. No secret values were printed."
}
finally {
    Pop-Location
}
