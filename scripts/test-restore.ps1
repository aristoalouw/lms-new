[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidatePattern('^gs://[a-z0-9][a-z0-9._-]+/.+')]
    [string]$BackupUri,

    [Parameter(Mandatory)]
    [ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')]
    [string]$RecoveryProjectId,

    [Parameter(Mandatory)]
    [switch]$ConfirmRecoveryTarget,

    [Parameter()]
    [ValidatePattern('^[a-z0-9][a-z0-9._-]+$')]
    [string]$RecoveryStorageBucket,

    [Parameter()]
    [string]$SmokeTestUrl,

    [Parameter()]
    [string]$RecoveryReportPath = ".\recovery-report-$([DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')).json"
)

$ErrorActionPreference = "Stop"

if (-not $ConfirmRecoveryTarget) {
    throw "Pass -ConfirmRecoveryTarget only after verifying that the target is isolated and disposable."
}
if ($RecoveryProjectId -notmatch '(?i)(-recovery|-restore|-dr|-sandbox)$') {
    throw "RecoveryProjectId must end in -recovery, -restore, -dr, or -sandbox. Production-like project names are rejected."
}
if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
    throw "gcloud CLI is required."
}

$normalizedBackup = $BackupUri.TrimEnd('/')
$manifestFile = [System.IO.Path]::GetTempFileName()
$startedAt = [DateTime]::UtcNow
$storageSourceCount = $null
$storageDestinationCount = $null
$smokeStatus = "not-requested"

try {
    & gcloud storage cp "$normalizedBackup/manifest.json" $manifestFile
    if ($LASTEXITCODE -ne 0) { throw "Backup manifest could not be downloaded." }
    $manifest = Get-Content -Raw -LiteralPath $manifestFile | ConvertFrom-Json

    if ($manifest.sourceProjectId -eq $RecoveryProjectId) {
        throw "The recovery target is the source project. Restore is refused."
    }
    if ($manifest.backupPrefix.TrimEnd('/') -ne $normalizedBackup) {
        throw "Manifest prefix does not match the requested backup URI."
    }
    if ($manifest.schemaVersion -ne 1 -or
        $manifest.sourceProjectId -notmatch '^[a-z][a-z0-9-]{4,28}[a-z0-9]$' -or
        $manifest.databaseId -notmatch '^(\(default\)|[a-z][a-z0-9-]{2,62})$' -or
        $manifest.firestoreUri -ne "$normalizedBackup/firestore" -or
        ($manifest.storageUri -and $manifest.storageUri -ne "$normalizedBackup/storage")) {
        throw "Backup manifest schema or resource paths are invalid."
    }
    if ($manifest.storageUri -and -not $RecoveryStorageBucket) {
        throw "RecoveryStorageBucket is required because this backup includes Storage objects."
    }
    if ($RecoveryStorageBucket -and $manifest.sourceStorageBucket -eq $RecoveryStorageBucket) {
        throw "The recovery Storage bucket must differ from the production source bucket."
    }

    Write-Host "Importing Firestore into isolated project $RecoveryProjectId"
    & gcloud firestore import $manifest.firestoreUri --project=$RecoveryProjectId --database=$manifest.databaseId --quiet
    if ($LASTEXITCODE -ne 0) { throw "Firestore recovery import failed with exit code $LASTEXITCODE." }

    if ($manifest.storageUri -and $RecoveryStorageBucket) {
        $recoveryPrefix = "gs://$RecoveryStorageBucket/recovery-tests/$([DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ'))"
        & gcloud storage rsync $manifest.storageUri $recoveryPrefix --recursive
        if ($LASTEXITCODE -ne 0) { throw "Storage recovery copy failed with exit code $LASTEXITCODE." }

        $sourceObjects = @(& gcloud storage ls $manifest.storageUri --recursive 2>$null)
        if ($LASTEXITCODE -ne 0) { throw "Could not list the source Storage snapshot." }
        $destinationObjects = @(& gcloud storage ls $recoveryPrefix --recursive 2>$null)
        if ($LASTEXITCODE -ne 0) { throw "Could not list the restored Storage snapshot." }
        $storageSourceCount = $sourceObjects.Count
        $storageDestinationCount = $destinationObjects.Count
        if ($storageSourceCount -ne $storageDestinationCount) {
            throw "Storage object count mismatch: source=$storageSourceCount destination=$storageDestinationCount."
        }
    }

    if ($SmokeTestUrl) {
        $response = Invoke-WebRequest -Uri $SmokeTestUrl -Method Get -TimeoutSec 30 -UseBasicParsing
        if ($response.StatusCode -ne 200) { throw "Recovery smoke test returned HTTP $($response.StatusCode)." }
        $smokeStatus = "passed"
    }

    $report = [ordered]@{
        schemaVersion = 1
        result = "passed"
        backupPrefix = $normalizedBackup
        sourceProjectId = $manifest.sourceProjectId
        recoveryProjectId = $RecoveryProjectId
        firestoreImport = "passed"
        storageSourceObjectCount = $storageSourceCount
        storageDestinationObjectCount = $storageDestinationCount
        smokeTest = $smokeStatus
        startedAtUtc = $startedAt.ToString("o")
        completedAtUtc = [DateTime]::UtcNow.ToString("o")
        testedBy = [Environment]::UserName
    }
    $report | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $RecoveryReportPath -Encoding utf8
    Write-Host "Recovery test passed. Report: $RecoveryReportPath"
}
catch {
    $failureReport = [ordered]@{
        schemaVersion = 1
        result = "failed"
        backupPrefix = $normalizedBackup
        recoveryProjectId = $RecoveryProjectId
        failureType = $_.Exception.GetType().Name
        startedAtUtc = $startedAt.ToString("o")
        completedAtUtc = [DateTime]::UtcNow.ToString("o")
        testedBy = [Environment]::UserName
    }
    $failureReport | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $RecoveryReportPath -Encoding utf8
    Write-Warning "Recovery test failed. A metadata-only report was written to $RecoveryReportPath."
    throw
}
finally {
    Remove-Item -LiteralPath $manifestFile -Force -ErrorAction SilentlyContinue
}
