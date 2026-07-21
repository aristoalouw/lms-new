[CmdletBinding()]
param(
    [Parameter()]
    [string]$Path = ".env.production"
)

$ErrorActionPreference = "Stop"

function Read-DotEnv {
    param([string]$FilePath)

    if (-not (Test-Path -LiteralPath $FilePath -PathType Leaf)) {
        throw "Environment file not found: $FilePath"
    }

    $values = @{}
    foreach ($line in Get-Content -LiteralPath $FilePath) {
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
        $values[$name] = $value
    }
    return $values
}

function Add-Failure {
    param([string]$Message)
    $script:failures.Add($Message)
}

$envValues = Read-DotEnv -FilePath $Path
$failures = [System.Collections.Generic.List[string]]::new()
$warnings = [System.Collections.Generic.List[string]]::new()

$required = @(
    "APP_VERSION",
    "APP_IMAGE",
    "NUXT_SESSION_SECRET",
    "RATE_LIMIT_KEY_SECRET",
    "PASSWORD_RESET_CONTINUE_URL",
    "EMAIL_DELIVERY_ENDPOINT",
    "EMAIL_DELIVERY_BEARER_TOKEN",
    "EMAIL_FROM",
    "EMAIL_WORKER_SECRET",
    "FIREBASE_PROJECT_ID",
    "NUXT_PUBLIC_FIREBASE_API_KEY",
    "NUXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
    "NUXT_PUBLIC_FIREBASE_PROJECT_ID",
    "NUXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
    "NUXT_PUBLIC_FIREBASE_APP_ID",
    "FIREBASE_ADMIN_CREDENTIALS_FILE",
    "FIREBASE_STORAGE_BUCKET",
    "FILE_CURSOR_SECRET",
    "PMB_PII_HASH_SECRET",
    "TRACER_STUDY_PUBLIC_URL",
    "CLAMAV_HOST",
    "CLAMAV_PORT",
    "PAYMENT_GATEWAY_PROVIDER_ID",
    "PAYMENT_GATEWAY_WEBHOOK_SECRET",
    "PDDIKTI_CONTRACT_VERSION",
    "PDDIKTI_OPERATION_MAP_JSON",
    "PDDIKTI_ADAPTER_BASE_URL",
    "PDDIKTI_ADAPTER_BEARER_TOKEN",
    "PDDIKTI_WORKER_SECRET",
    "SERVER_NAME",
    "TLS_FULLCHAIN_FILE",
    "TLS_PRIVATE_KEY_FILE"
)

foreach ($name in $required) {
    if (-not $envValues.ContainsKey($name) -or [string]::IsNullOrWhiteSpace($envValues[$name])) {
        Add-Failure "$name is required."
    }
}

if ($envValues["NODE_ENV"] -ne "production") {
    Add-Failure "NODE_ENV must be production."
}
if ($envValues["APP_VERSION"] -eq "development" -or $envValues["APP_VERSION"] -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$') {
    Add-Failure "APP_VERSION must identify the immutable production release."
}
$imageIsPinned = $envValues["APP_IMAGE"] -match '@sha256:[a-f0-9]{64}$' -or $envValues["APP_IMAGE"] -match ':[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'
if (-not $imageIsPinned -or $envValues["APP_IMAGE"] -match '(^|:)local$|:latest$') {
    Add-Failure "APP_IMAGE must use an immutable release tag or digest, not local/latest."
}
if ($envValues["NUXT_PUBLIC_APP_ENVIRONMENT"] -ne "production") {
    Add-Failure "NUXT_PUBLIC_APP_ENVIRONMENT must be production."
}
if ($envValues["NUXT_PUBLIC_API_BASE_URL"] -ne "/api") {
    Add-Failure "NUXT_PUBLIC_API_BASE_URL must remain same-origin at /api behind Nginx."
}
if ($envValues["NUXT_PUBLIC_DEMO_MODE"] -ne "false" -or $envValues["ENABLE_DEMO_AUTH"] -ne "false") {
    Add-Failure "Demo UI and demo authentication must both be disabled."
}
if ($envValues["CAMPUS_DATA_MODE"] -ne "firebase" -or $envValues["ALLOW_PRODUCTION_MOCK"] -ne "false") {
    Add-Failure "Production requires CAMPUS_DATA_MODE=firebase and ALLOW_PRODUCTION_MOCK=false."
}
if ($envValues["RATE_LIMIT_BACKEND"] -ne "firestore") {
    Add-Failure "Production requires RATE_LIMIT_BACKEND=firestore for a shared atomic limiter."
}
if ($envValues["FIREBASE_USE_APPLICATION_DEFAULT"] -ne "true") {
    Add-Failure "Production Compose expects FIREBASE_USE_APPLICATION_DEFAULT=true."
}
$sessionSecret = if ($envValues.ContainsKey("NUXT_SESSION_SECRET")) { $envValues["NUXT_SESSION_SECRET"] } else { "" }
if ($sessionSecret.Length -lt 43) {
    Add-Failure "NUXT_SESSION_SECRET must contain at least 32 random bytes (43 base64url characters)."
}
$distinctSecretCharacters = @($sessionSecret.ToCharArray() | Select-Object -Unique).Count
if ($sessionSecret -and $distinctSecretCharacters -lt 16) {
    Add-Failure "NUXT_SESSION_SECRET does not appear sufficiently random."
}
$rateLimitSecret = if ($envValues.ContainsKey("RATE_LIMIT_KEY_SECRET")) { $envValues["RATE_LIMIT_KEY_SECRET"] } else { "" }
if ($rateLimitSecret.Length -lt 43) {
    Add-Failure "RATE_LIMIT_KEY_SECRET must contain at least 32 random bytes (43 base64url characters)."
}
if ($rateLimitSecret -and @($rateLimitSecret.ToCharArray() | Select-Object -Unique).Count -lt 16) {
    Add-Failure "RATE_LIMIT_KEY_SECRET does not appear sufficiently random."
}
$gatewaySecret = if ($envValues.ContainsKey("PAYMENT_GATEWAY_WEBHOOK_SECRET")) { $envValues["PAYMENT_GATEWAY_WEBHOOK_SECRET"] } else { "" }
if ($gatewaySecret.Length -lt 43) {
    Add-Failure "PAYMENT_GATEWAY_WEBHOOK_SECRET must contain at least 32 random bytes (43 base64url characters)."
}
if ($gatewaySecret -and @($gatewaySecret.ToCharArray() | Select-Object -Unique).Count -lt 16) {
    Add-Failure "PAYMENT_GATEWAY_WEBHOOK_SECRET does not appear sufficiently random."
}
if ($envValues["PAYMENT_GATEWAY_PROVIDER_ID"] -notmatch '^[a-z][a-z0-9_-]{2,39}$') {
    Add-Failure "PAYMENT_GATEWAY_PROVIDER_ID must be a lowercase stable identifier."
}
if ($envValues["NUXT_PUBLIC_ANALYTICS_PRIVATE_ENABLED"] -ne "false") {
    Add-Failure "Private-area analytics must remain disabled."
}
if (-not [string]::IsNullOrWhiteSpace($envValues["FIRESTORE_EMULATOR_HOST"])) {
    Add-Failure "FIRESTORE_EMULATOR_HOST must be blank in production."
}
if ($envValues["NUXT_PUBLIC_FIREBASE_PROJECT_ID"] -ne $envValues["FIREBASE_PROJECT_ID"]) {
    Add-Failure "Public and server Firebase project IDs must target the same environment."
}
if ($envValues["NUXT_PUBLIC_FIREBASE_STORAGE_BUCKET"] -ne $envValues["FIREBASE_STORAGE_BUCKET"]) {
    Add-Failure "Public and server Firebase Storage bucket names must target the same environment."
}
$fileCursorSecret = if ($envValues.ContainsKey("FILE_CURSOR_SECRET")) { $envValues["FILE_CURSOR_SECRET"] } else { "" }
if ($fileCursorSecret.Length -lt 43) {
    Add-Failure "FILE_CURSOR_SECRET must contain at least 32 random bytes (43 base64url characters)."
}
if ($fileCursorSecret -and @($fileCursorSecret.ToCharArray() | Select-Object -Unique).Count -lt 16) {
    Add-Failure "FILE_CURSOR_SECRET does not appear sufficiently random."
}
$pmbHashSecret = if ($envValues.ContainsKey("PMB_PII_HASH_SECRET")) { $envValues["PMB_PII_HASH_SECRET"] } else { "" }
if ($pmbHashSecret.Length -lt 43) {
    Add-Failure "PMB_PII_HASH_SECRET must contain at least 32 random bytes (43 base64url characters)."
}
if ($pmbHashSecret -and @($pmbHashSecret.ToCharArray() | Select-Object -Unique).Count -lt 16) {
    Add-Failure "PMB_PII_HASH_SECRET does not appear sufficiently random."
}
foreach ($emailSecretName in @("EMAIL_DELIVERY_BEARER_TOKEN", "EMAIL_WORKER_SECRET")) {
    $emailSecret = if ($envValues.ContainsKey($emailSecretName)) { $envValues[$emailSecretName] } else { "" }
    if ($emailSecret.Length -lt 43) {
        Add-Failure "$emailSecretName must contain at least 32 random bytes (43 base64url characters)."
    }
    if ($emailSecret -and @($emailSecret.ToCharArray() | Select-Object -Unique).Count -lt 16) {
        Add-Failure "$emailSecretName does not appear sufficiently random."
    }
}
$independentSecretNames = @(
    "NUXT_SESSION_SECRET",
    "RATE_LIMIT_KEY_SECRET",
    "FILE_CURSOR_SECRET",
    "PMB_PII_HASH_SECRET",
    "PAYMENT_GATEWAY_WEBHOOK_SECRET",
    "EMAIL_DELIVERY_BEARER_TOKEN",
    "EMAIL_WORKER_SECRET",
    "PDDIKTI_ADAPTER_BEARER_TOKEN",
    "PDDIKTI_WORKER_SECRET"
)
for ($leftIndex = 0; $leftIndex -lt $independentSecretNames.Count; $leftIndex++) {
    for ($rightIndex = $leftIndex + 1; $rightIndex -lt $independentSecretNames.Count; $rightIndex++) {
        $leftName = $independentSecretNames[$leftIndex]
        $rightName = $independentSecretNames[$rightIndex]
        $leftValue = [string]$envValues[$leftName]
        $rightValue = [string]$envValues[$rightName]
        if ($leftValue -and $rightValue -and $leftValue -ceq $rightValue) {
            Add-Failure "$leftName and $rightName must use independent secret values."
        }
    }
}
if ($envValues["CLAMAV_HOST"] -notmatch '^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$') {
    Add-Failure "CLAMAV_HOST must be a DNS name or IP address without a scheme or port."
}
$clamAvPort = 0
if (-not [int]::TryParse($envValues["CLAMAV_PORT"], [ref]$clamAvPort) -or $clamAvPort -lt 1 -or $clamAvPort -gt 65535) {
    Add-Failure "CLAMAV_PORT must be an integer from 1 through 65535."
}
$fileQuotaBytes = 0L
if ($envValues.ContainsKey("FILE_QUOTA_BYTES") -and -not [string]::IsNullOrWhiteSpace($envValues["FILE_QUOTA_BYTES"])) {
    if (-not [long]::TryParse($envValues["FILE_QUOTA_BYTES"], [ref]$fileQuotaBytes) -or $fileQuotaBytes -lt 1048576 -or $fileQuotaBytes -gt 10995116277760) {
        Add-Failure "FILE_QUOTA_BYTES must be an integer between 1 MiB and 10 TiB."
    }
}
$passwordResetUrl = if ($envValues.ContainsKey("PASSWORD_RESET_CONTINUE_URL")) { $envValues["PASSWORD_RESET_CONTINUE_URL"] } else { "" }
if ($passwordResetUrl -and $passwordResetUrl -notmatch '^https://[^/?#@]+(?::\d+)?(?:/[^?#]*)?$') {
    Add-Failure "PASSWORD_RESET_CONTINUE_URL must be an HTTPS URL without credentials, query parameters, or fragments."
}
$emailDeliveryEndpoint = if ($envValues.ContainsKey("EMAIL_DELIVERY_ENDPOINT")) { $envValues["EMAIL_DELIVERY_ENDPOINT"] } else { "" }
if ($emailDeliveryEndpoint -and $emailDeliveryEndpoint -notmatch '^https://[^/?#@]+(?::\d+)?(?:/[^?#]*)?$') {
    Add-Failure "EMAIL_DELIVERY_ENDPOINT must be an HTTPS URL without credentials, query parameters, or fragments."
}
$tracerStudyPublicUrl = if ($envValues.ContainsKey("TRACER_STUDY_PUBLIC_URL")) { $envValues["TRACER_STUDY_PUBLIC_URL"] } else { "" }
if ($tracerStudyPublicUrl -and $tracerStudyPublicUrl -notmatch '^https://[^/?#@]+(?::\d+)?(?:/[^?#]*)?$') {
    Add-Failure "TRACER_STUDY_PUBLIC_URL must be an HTTPS URL without credentials, query parameters, or fragments."
}
if ($envValues["EMAIL_FROM"] -notmatch '^[^\s@]+@[^\s@]+\.[^\s@]+$' -or $envValues["EMAIL_FROM"].Length -gt 254) {
    Add-Failure "EMAIL_FROM must be a valid sender address."
}
if ($envValues["SERVER_NAME"] -notmatch '^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$') {
    Add-Failure "SERVER_NAME must be a DNS hostname without a scheme, port, path, or wildcard."
}
if ($envValues["SERVER_NAME"] -match '(^|\.)example\.(com|org|net|ac\.id)$') {
    Add-Failure "SERVER_NAME still uses a reserved documentation hostname."
}

foreach ($credentialName in @("FIREBASE_SERVICE_ACCOUNT_JSON", "FIREBASE_SERVICE_ACCOUNT_BASE64", "FIREBASE_CLIENT_EMAIL", "FIREBASE_PRIVATE_KEY")) {
    if (-not [string]::IsNullOrWhiteSpace($envValues[$credentialName])) {
        Add-Failure "$credentialName must be blank when production Compose uses the mounted ADC credential file."
    }
}

foreach ($pathName in @("FIREBASE_ADMIN_CREDENTIALS_FILE", "TLS_FULLCHAIN_FILE", "TLS_PRIVATE_KEY_FILE")) {
    $candidate = $envValues[$pathName]
    if ($candidate -and -not [System.IO.Path]::IsPathRooted($candidate)) {
        Add-Failure "$pathName must be an absolute host path."
    }
    if ($candidate -and -not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
        Add-Failure "$pathName does not point to a readable file."
    }
}

if ([string]::IsNullOrWhiteSpace($envValues["SENTRY_DSN"])) {
    $warnings.Add("SENTRY_DSN is blank; server error telemetry will be disabled.")
}
$pddiktiBaseUrl = [string]$envValues["PDDIKTI_ADAPTER_BASE_URL"]
if ($pddiktiBaseUrl -and $pddiktiBaseUrl -notmatch '^https://[^/?#@]+(?::\d+)?(?:/[^?#]*)?$') {
    Add-Failure "PDDIKTI_ADAPTER_BASE_URL must be an HTTPS URL without credentials, query parameters, or fragments."
}
if ([string]$envValues["PDDIKTI_CONTRACT_VERSION"] -notmatch '^[A-Za-z0-9][A-Za-z0-9._/-]{4,127}$') {
    Add-Failure "PDDIKTI_CONTRACT_VERSION must be an immutable, versioned contract identifier."
}
foreach ($pddiktiSecretName in @("PDDIKTI_ADAPTER_BEARER_TOKEN", "PDDIKTI_WORKER_SECRET")) {
    $pddiktiSecret = [string]$envValues[$pddiktiSecretName]
    if ($pddiktiSecret.Length -lt 43) {
        Add-Failure "$pddiktiSecretName must contain at least 32 random bytes (43 base64url characters)."
    }
    if ($pddiktiSecret -and @($pddiktiSecret.ToCharArray() | Select-Object -Unique).Count -lt 16) {
        Add-Failure "$pddiktiSecretName does not appear sufficiently random."
    }
}
try {
    $operationMap = [string]$envValues["PDDIKTI_OPERATION_MAP_JSON"] | ConvertFrom-Json
    foreach ($entityType in @("student", "lecturer", "course", "class", "grade", "student_activity", "graduation")) {
        $operation = [string]$operationMap.$entityType
        if ([string]::IsNullOrWhiteSpace($operation)) {
            Add-Failure "PDDIKTI_OPERATION_MAP_JSON must contain an operator-verified key for $entityType."
        }
    }
}
catch {
    Add-Failure "PDDIKTI_OPERATION_MAP_JSON must be a valid JSON object."
}
$legacyNeoValues = @("NEO_FEEDER_BASE_URL", "NEO_FEEDER_USERNAME", "NEO_FEEDER_PASSWORD") | ForEach-Object { -not [string]::IsNullOrWhiteSpace($envValues[$_]) }
if (($legacyNeoValues | Where-Object { $_ }).Count -notin @(0, 3)) {
    Add-Failure "Legacy Neo Feeder base URL, username, and password must be configured together or all left blank."
}
if (($legacyNeoValues | Where-Object { $_ }).Count -eq 3 -and $envValues["NEO_FEEDER_BASE_URL"] -notmatch '^https://[^/?#@]+(?::\d+)?(?:/[^?#]*)?$') {
    Add-Failure "NEO_FEEDER_BASE_URL must be an HTTPS URL without credentials, query parameters, or fragments."
}
foreach ($dsnName in @("SENTRY_DSN", "NUXT_PUBLIC_SENTRY_DSN")) {
    if (-not [string]::IsNullOrWhiteSpace($envValues[$dsnName]) -and $envValues[$dsnName] -notmatch '^https://') {
        Add-Failure "$dsnName must use HTTPS."
    }
}
if ($envValues["NUXT_PUBLIC_ANALYTICS_ENABLED"] -eq "true" -and
    [string]::IsNullOrWhiteSpace($envValues["NUXT_PUBLIC_GOOGLE_TAG_MANAGER_ID"]) -and
    [string]::IsNullOrWhiteSpace($envValues["NUXT_PUBLIC_GOOGLE_ANALYTICS_ID"]) -and
    [string]::IsNullOrWhiteSpace($envValues["NUXT_PUBLIC_MICROSOFT_CLARITY_ID"])) {
    Add-Failure "Analytics is enabled but no approved provider identifier is configured."
}

foreach ($warning in $warnings) { Write-Warning $warning }
if ($failures.Count -gt 0) {
    foreach ($failure in $failures) { Write-Error $failure -ErrorAction Continue }
    exit 1
}

Write-Host "Production environment contract is valid. Secret values were not printed."
