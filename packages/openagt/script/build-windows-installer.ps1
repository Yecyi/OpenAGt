param(
  [string] $Version = $env:OPENAGT_VERSION,
  [string] $DistRoot = (Join-Path $PSScriptRoot "..\dist"),
  [string] $OutputPath = (Join-Path $PSScriptRoot "..\dist\OpenAGt-Setup-x64.msi")
)

$ErrorActionPreference = "Stop"

if (-not $Version) {
  throw "OPENAGT_VERSION or -Version is required"
}

$packageRoot = Join-Path $DistRoot "openagt-windows-x64\release"
$binRoot = Join-Path $packageRoot "bin"
$exePath = Join-Path $binRoot "openagt.exe"

if (-not (Test-Path $exePath)) {
  throw "Expected Windows release package at $exePath"
}

$wix = Get-Command wix -ErrorAction SilentlyContinue
if (-not $wix) {
  throw "WiX v4 CLI (wix) is required to build the MSI"
}

$versionParts = $Version.Split(".")
$msiVersion = if ($versionParts.Count -ge 3) { "$($versionParts[0]).$($versionParts[1]).$($versionParts[2])" } else { $Version }
$wxsPath = Join-Path $env:TEMP "openagt-installer-$Version.wxs"

$content = @"
<Wix xmlns="http://wixtoolset.org/schemas/v4/wxs">
  <Package Name="OpenAGt" Manufacturer="OpenAGt" Version="$msiVersion" UpgradeCode="16d54b50-66f9-4d5d-b546-1d7db0b2289a" Scope="perMachine">
    <MediaTemplate EmbedCab="yes" />
    <StandardDirectory Id="ProgramFiles64Folder">
      <Directory Id="INSTALLFOLDER" Name="OpenAGt">
        <Directory Id="BIN" Name="bin" />
      </Directory>
    </StandardDirectory>
    <Feature Id="MainFeature" Title="OpenAGt" Level="1">
      <ComponentGroupRef Id="OpenAGtFiles" />
    </Feature>
  </Package>
  <Fragment>
    <ComponentGroup Id="OpenAGtFiles" Directory="BIN">
      <Component Guid="*">
        <File Source="$($exePath.Replace('\','\\'))" />
      </Component>
      <Component Guid="*">
        <File Source="$((Join-Path $binRoot 'openagt.cmd').Replace('\','\\'))" />
      </Component>
      <Component Guid="*">
        <File Source="$((Join-Path $binRoot 'opencode.cmd').Replace('\','\\'))" />
      </Component>
      <Component Guid="*">
        <RegistryValue Root="HKLM" Key="Software\OpenAGt" Name="InstallBin" Type="string" Value="[BIN]" KeyPath="yes" />
        <Environment Name="PATH" Value="[BIN]" Part="last" Action="set" System="yes" />
      </Component>
    </ComponentGroup>
  </Fragment>
</Wix>
"@

Set-Content -Path $wxsPath -Value $content -Encoding UTF8

& $wix.Source build $wxsPath -arch x64 -o $OutputPath

$wixpdbPath = [System.IO.Path]::ChangeExtension($OutputPath, ".wixpdb")
if (Test-Path $wixpdbPath) {
  Remove-Item $wixpdbPath -Force
}

Write-Host "Built MSI: $OutputPath"
