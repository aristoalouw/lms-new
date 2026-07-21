[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidatePattern('^[a-z][a-z0-9-]{4,28}[a-z0-9]$')]
    [string]$ProjectId,

    [Parameter(Mandatory)]
    [ValidatePattern('^gs://[a-z0-9][a-z0-9._-]+(?:/.*)?$')]
    [string]$BackupBucket,

    [Parameter()]
    [string]$DatabaseId = "(default)",

    [Parameter()]
    [ValidatePattern('^[a-z0-9._-]+$')]
    [string]$StorageBucket,

    [Parameter()]
    [string]$Label = "scheduled"
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
    throw "gcloud CLI is required. Install it and authenticate with a backup-only service account."
}
$backupBucketName = (($BackupBucket -replace '^gs://', '') -split '/')[0]
if ($StorageBucket -and $backupBucketName -eq $StorageBucket) {
    throw "The backup bucket must be different from the production Storage bucket."
}

$startedAt = [DateTime]::UtcNow
$timestamp = $startedAt.ToString("yyyyMMddTHHmmssZ")
$safeLabel = ($Label.ToLowerInvariant() -replace '[^a-z0-9._-]', '-')
$runId = [Guid]::NewGuid().ToString("N").Substring(0, 8)
$prefix = "$($BackupBucket.TrimEnd('/'))/$ProjectId/$timestamp-$safeLabel-$runId"
$firestoreUri = "$prefix/firestore"
$storageUri = if ($StorageBucket) { "$prefix/storage" } else { $null }

Write-Host "Starting managed Firestore export to $firestoreUri"
& gcloud firestore export $firestoreUri --project=$ProjectId --database=$DatabaseId --quiet
if ($LASTEXITCODE -ne 0) { throw "Firestore export failed with exit code $LASTEXITCODE." }

if ($StorageBucket) {
    Write-Host "Copying Firebase Storage objects into a unique snapshot prefix."
    & gcloud storage rsync "gs://$StorageBucket" $storageUri --recursive
    if ($LASTEXITCODE -ne 0) { throw "Storage snapshot failed with exit code $LASTEXITCODE." }
}

$completedAt = [DateTime]::UtcNow
$manifest = [ordered]@{
    schemaVersion = 1
    sourceProjectId = $ProjectId
    databaseId = $DatabaseId
    sourceStorageBucket = $StorageBucket
    backupPrefix = $prefix
    firestoreUri = $firestoreUri
    storageUri = $storageUri
    label = $safeLabel
    startedAtUtc = $startedAt.ToString("o")
    completedAtUtc = $completedAt.ToString("o")
    operator = [Environment]::UserName
}

$manifestFile = [System.IO.Path]::GetTempFileName()
try {
    $manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $manifestFile -Encoding utf8
    & gcloud storage cp $manifestFile "$prefix/manifest.json"
    if ($LASTEXITCODE -ne 0) { throw "Uploading the backup manifest failed with exit code $LASTEXITCODE." }
}
finally {
    Remove-Item -LiteralPath $manifestFile -Force -ErrorAction SilentlyContinue
}

Write-Host "Backup completed: $prefix"
Write-Host "Schedule an isolated recovery test; an export is not considered usable until restored successfully."
