param(
  [switch] $RequireSigning,
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]] $Path
)

$ErrorActionPreference = "Stop"

if (-not $Path -or $Path.Count -eq 0) {
  throw "At least one path is required"
}

if (-not $RequireSigning -and $env:OPENAGT_REQUIRE_WINDOWS_SIGNING -eq "1") {
  $RequireSigning = $true
}

$vars = @{
  endpoint = $env:AZURE_TRUSTED_SIGNING_ENDPOINT
  account = $env:AZURE_TRUSTED_SIGNING_ACCOUNT_NAME
  profile = $env:AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE
}

function Complete-SigningSkip {
  param(
    [string] $Message
  )

  if ($RequireSigning) {
    throw $Message
  }

  Write-Host $Message
  exit 0
}

if ($vars.Values | Where-Object { -not $_ }) {
  Complete-SigningSkip "Skipping Windows signing because Azure Trusted Signing is not configured"
}

$moduleVersion = "0.5.8"
$module = Get-Module -ListAvailable -Name TrustedSigning | Where-Object { $_.Version -eq [version] $moduleVersion }

if (-not $module) {
  try {
    Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Force -Scope CurrentUser | Out-Null
  }
  catch {
    Write-Host "NuGet package provider install skipped: $($_.Exception.Message)"
  }

  Install-Module -Name TrustedSigning -RequiredVersion $moduleVersion -Force -Repository PSGallery -Scope CurrentUser
}

Import-Module TrustedSigning -RequiredVersion $moduleVersion -Force

$files = @($Path | ForEach-Object { Resolve-Path $_ -ErrorAction SilentlyContinue } | Select-Object -ExpandProperty Path -Unique)

if (-not $files -or $files.Count -eq 0) {
  throw "No files matched the requested paths"
}

Write-Host "Signing files:"
$files | ForEach-Object { Write-Host " - $_" }

$params = @{
  Endpoint                         = $vars.endpoint
  CodeSigningAccountName           = $vars.account
  CertificateProfileName           = $vars.profile
  Files                            = ($files -join ",")
  FileDigest                       = "SHA256"
  TimestampDigest                  = "SHA256"
  TimestampRfc3161                 = "http://timestamp.acs.microsoft.com"
  ExcludeEnvironmentCredential     = $true
  ExcludeWorkloadIdentityCredential = $true
  ExcludeManagedIdentityCredential = $true
  ExcludeSharedTokenCacheCredential = $true
  ExcludeVisualStudioCredential    = $true
  ExcludeVisualStudioCodeCredential = $true
  ExcludeAzureCliCredential        = $false
  ExcludeAzurePowerShellCredential = $true
  ExcludeAzureDeveloperCliCredential = $true
  ExcludeInteractiveBrowserCredential = $true
}

Invoke-TrustedSigning @params

$invalid = @($files | ForEach-Object { Get-AuthenticodeSignature $_ } | Where-Object { $_.Status -ne "Valid" })

if ($invalid.Count -gt 0) {
  $details = $invalid | ForEach-Object { "$($_.Path): $($_.Status) $($_.StatusMessage)" }
  throw "Windows signing verification failed:`n$($details -join "`n")"
}

Write-Host "Verified Authenticode signatures:"
$files | ForEach-Object {
  $signature = Get-AuthenticodeSignature $_
  $subject = if ($signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { "<no signer>" }
  Write-Host " - $_ => $subject"
}
