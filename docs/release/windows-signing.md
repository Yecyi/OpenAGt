# Windows Signing

## Summary

Windows release signing is documented separately from the main architecture because it is a release-engineering concern, not a runtime design concern.

The current release workflow supports Azure Trusted Signing, but successful signing depends on repository secrets and Azure configuration being present.

## Why Signing Matters

Unsigned Windows assets may trigger:

- `Unknown publisher`
- Microsoft Defender SmartScreen warnings

Signing does not change runtime behavior. It changes trust and distribution behavior for:

- `OpenAGt-Setup-x64.msi`
- `openagt.exe`
- `openagt-windows-x64.zip` contents

## Current Workflow

Relevant files:

- `script/sign-windows.ps1`
- `.github/workflows/release-stable.yml`

The workflow is designed to:

1. build Windows assets
2. build the MSI
3. authenticate to Azure through GitHub Actions OIDC
4. sign the Windows executable and MSI
5. repack the Windows zip after signing
6. publish the assets to the release

## Required Secrets

The release workflow expects these repository secrets:

- `AZURE_TRUSTED_SIGNING_CLIENT_ID`
- `AZURE_TRUSTED_SIGNING_TENANT_ID`
- `AZURE_TRUSTED_SIGNING_SUBSCRIPTION_ID`
- `AZURE_TRUSTED_SIGNING_ENDPOINT`
- `AZURE_TRUSTED_SIGNING_ACCOUNT_NAME`
- `AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE_NAME`

Without them, Windows assets can still be published, but they remain unsigned.

## Operational Note

If signed Windows assets are required for a release, Azure Trusted Signing must be configured before running the GA release workflow.
