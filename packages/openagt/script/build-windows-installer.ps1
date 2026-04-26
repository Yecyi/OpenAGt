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

function Ensure-WixExtension {
  param(
    [string] $ExtensionId,
    [string] $Version
  )

  $extensionList = & $wix.Source extension list 2>$null
  if ($LASTEXITCODE -eq 0 -and ($extensionList -match [regex]::Escape("$ExtensionId $Version"))) {
    return
  }

  & $wix.Source extension add --global "$ExtensionId/$Version"
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to add WiX extension: $ExtensionId/$Version"
  }
}

function ConvertTo-RtfText {
  param([string] $Value)

  return $Value.Replace('\', '\\').Replace('{', '\{').Replace('}', '\}').Replace("`r`n", '\par ').Replace("`n", '\par ')
}

$wixUiExtension = "WixToolset.UI.wixext"
$wixUiExtensionVersion = "4.0.4"
Ensure-WixExtension $wixUiExtension $wixUiExtensionVersion

$versionParts = $Version.Split(".")
$msiVersion = if ($versionParts.Count -ge 3) { "$($versionParts[0]).$($versionParts[1]).$($versionParts[2])" } else { $Version }
$wxsPath = Join-Path $env:TEMP "openagt-installer-$Version.wxs"
$licenseRtfPath = Join-Path $env:TEMP "openagt-license-$Version.rtf"
$tutorialPath = Join-Path $packageRoot "GETTING_STARTED.txt"

Set-Content -Path $tutorialPath -Encoding UTF8 -Value @"
OpenAGt Getting Started

OpenAGt installs the `openagt` command and the `opencode` compatibility alias.

After setup finishes:
1. Open a new terminal so PATH changes are loaded.
2. Run: openagt
3. For command help, run: openagt --help

Useful commands:
- openagt
- openagt run
- openagt serve
- openagt debug doctor
- opencode

If Windows shows SmartScreen for an unsigned build, verify the asset and checksum
from the official GitHub Release before running it.
"@

Set-Content -Path $licenseRtfPath -Encoding ASCII -Value ("{\rtf1\ansi\deff0{\fonttbl{\f0 Consolas;}}\f0\fs18 " + (ConvertTo-RtfText (Get-Content -Path (Join-Path $packageRoot "LICENSE") -Raw)) + "}")

$content = @"
<Wix xmlns="http://wixtoolset.org/schemas/v4/wxs" xmlns:ui="http://wixtoolset.org/schemas/v4/wxs/ui">
  <Package Name="OpenAGt" Manufacturer="OpenAGt" Version="$msiVersion" UpgradeCode="16d54b50-66f9-4d5d-b546-1d7db0b2289a" Scope="perMachine">
    <MajorUpgrade DowngradeErrorMessage="A newer version of OpenAGt is already installed." />
    <MediaTemplate EmbedCab="yes" />
    <WixVariable Id="WixUILicenseRtf" Value="$($licenseRtfPath.Replace('\','\\'))" />
    <Property Id="ARPCONTACT" Value="OpenAGt" />
    <Property Id="ARPURLINFOABOUT" Value="https://github.com/Yecyi/OpenAGt" />
    <Property Id="WIXUI_EXITDIALOGOPTIONALTEXT" Value="Open a new terminal after setup and run: openagt. Getting Started is installed in the OpenAGt folder and Start Menu." />
    <ui:WixUI Id="WixUI_InstallDir" InstallDirectory="INSTALLFOLDER" />
    <StandardDirectory Id="ProgramFiles64Folder">
      <Directory Id="INSTALLFOLDER" Name="OpenAGt">
        <Directory Id="BIN" Name="bin" />
      </Directory>
    </StandardDirectory>
    <StandardDirectory Id="ProgramMenuFolder">
      <Directory Id="ApplicationProgramsFolder" Name="OpenAGt" />
    </StandardDirectory>
    <Feature Id="MainFeature" Title="OpenAGt" Level="1">
      <ComponentGroupRef Id="OpenAGtFiles" />
    </Feature>
  </Package>
  <Fragment>
    <ComponentGroup Id="OpenAGtFiles">
      <Component Directory="BIN" Guid="*">
        <File Source="$($exePath.Replace('\','\\'))" />
      </Component>
      <Component Directory="BIN" Guid="*">
        <File Source="$((Join-Path $binRoot 'openagt.cmd').Replace('\','\\'))" />
      </Component>
      <Component Directory="BIN" Guid="*">
        <File Source="$((Join-Path $binRoot 'opencode.cmd').Replace('\','\\'))" />
      </Component>
      <Component Directory="BIN" Guid="*">
        <RegistryValue Root="HKLM" Key="Software\OpenAGt" Name="InstallBin" Type="string" Value="[BIN]" KeyPath="yes" />
        <Environment Name="PATH" Value="[BIN]" Part="last" Action="set" System="yes" />
      </Component>
      <Component Directory="INSTALLFOLDER" Guid="*">
        <File Source="$($tutorialPath.Replace('\','\\'))" KeyPath="yes" />
        <Shortcut Id="OpenAGtGettingStartedShortcut" Directory="ApplicationProgramsFolder" Name="OpenAGt Getting Started" Target="[INSTALLFOLDER]GETTING_STARTED.txt" WorkingDirectory="INSTALLFOLDER" />
        <RemoveFolder Id="RemoveApplicationProgramsFolder" Directory="ApplicationProgramsFolder" On="uninstall" />
      </Component>
      <Component Directory="INSTALLFOLDER" Guid="*">
        <File Source="$((Join-Path $packageRoot 'README.txt').Replace('\','\\'))" />
      </Component>
      <Component Directory="INSTALLFOLDER" Guid="*">
        <File Source="$((Join-Path $packageRoot 'VERSION.txt').Replace('\','\\'))" />
      </Component>
      <Component Directory="INSTALLFOLDER" Guid="*">
        <File Source="$((Join-Path $packageRoot 'LICENSE').Replace('\','\\'))" />
      </Component>
    </ComponentGroup>
  </Fragment>
</Wix>
"@

Set-Content -Path $wxsPath -Value $content -Encoding UTF8

& $wix.Source build $wxsPath -arch x64 -ext "$wixUiExtension/$wixUiExtensionVersion" -o $OutputPath
if ($LASTEXITCODE -ne 0) {
  throw "WiX build failed with exit code $LASTEXITCODE"
}

$wixpdbPath = [System.IO.Path]::ChangeExtension($OutputPath, ".wixpdb")
if (Test-Path $wixpdbPath) {
  Remove-Item $wixpdbPath -Force
}

Write-Host "Built MSI: $OutputPath"
