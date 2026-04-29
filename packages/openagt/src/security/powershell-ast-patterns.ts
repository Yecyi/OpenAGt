// PowerShell alias and dangerous pattern tables for the heuristic AST scanner.
// This file does not tokenize input or evaluate parsed command structure.

import type { AstNodeType } from "./powershell-ast-contracts"

export const STRUCTURED_DANGEROUS_CMDLETS: Record<string, { severity: "high" | "medium"; reason: string }> = {
  "invoke-expression": { severity: "high", reason: "Dynamic code execution" },
  iex: { severity: "high", reason: "Invoke-Expression alias - dynamic code execution" },
  "invoke-command": { severity: "high", reason: "Remote command execution" },
  "invoke-webrequest": { severity: "medium", reason: "Network request - potential C2" },
  iwr: { severity: "medium", reason: "Invoke-WebRequest alias - potential C2" },
  "invoke-restmethod": { severity: "medium", reason: "REST API call" },
  "start-process": { severity: "medium", reason: "Process creation" },
  "new-service": { severity: "high", reason: "Service creation - persistence" },
  "set-service": { severity: "medium", reason: "Service modification" },
  "register-scheduledtask": { severity: "high", reason: "Scheduled task - persistence" },
  "schtasks.exe": { severity: "high", reason: "Scheduled task creation - persistence" },
  "set-executionpolicy": { severity: "medium", reason: "Execution policy change" },
  "new-item": { severity: "medium", reason: "New item creation" },
  "remove-item": { severity: "medium", reason: "Item deletion" },
  "convertto-securestring": { severity: "medium", reason: "Credential conversion" },
  "convertfrom-securestring": { severity: "high", reason: "Credential extraction" },
  "get-content": { severity: "medium", reason: "File content reading" },
  "set-content": { severity: "medium", reason: "File content writing" },
  "out-file": { severity: "medium", reason: "File output" },
  "add-type": { severity: "high", reason: "Dynamic type loading" },
}

export const PATTERN_DANGERS: Array<{
  pattern: RegExp
  reason: string
  severity: "high" | "medium"
  nodeType: AstNodeType
}> = [
  {
    pattern: /-enc(?:odedCommand)?\s+\S+/i,
    reason: "Encoded command detected",
    severity: "high",
    nodeType: "expression",
  },
  { pattern: /FromBase64String/i, reason: "Encoded command detected", severity: "high", nodeType: "expression" },
  { pattern: /\[Ref\]\.Assembly\.GetType/i, reason: "AMSI bypass attempt", severity: "high", nodeType: "expression" },
  { pattern: /AmsiUtils/i, reason: "AMSI bypass attempt", severity: "high", nodeType: "expression" },
  {
    pattern: /rundll32(?:\.exe)?/i,
    reason: "rundll32 Living-off-the-land binary usage",
    severity: "high",
    nodeType: "expression",
  },
  {
    pattern: /regsvr32(?:\.exe)?/i,
    reason: "regsvr32 Living-off-the-land binary usage",
    severity: "high",
    nodeType: "expression",
  },
  {
    pattern: /mshta(?:\.exe)?/i,
    reason: "mshta Living-off-the-land binary usage",
    severity: "high",
    nodeType: "expression",
  },
  {
    pattern: /cscript(?:\.exe)?/i,
    reason: "cscript Living-off-the-land binary usage",
    severity: "high",
    nodeType: "expression",
  },
  {
    pattern: /wscript(?:\.exe)?/i,
    reason: "wscript Living-off-the-land binary usage",
    severity: "high",
    nodeType: "expression",
  },
]

const POWERSHELL_ALIASES: Record<string, string> = {
  "%": "ForEach-Object",
  "?": "Where-Object",
  iex: "Invoke-Expression",
  irm: "Invoke-RestMethod",
  iwr: "Invoke-WebRequest",
  ipmo: "Import-Module",
  gp: "Get-ItemProperty",
  curl: "Invoke-WebRequest",
  wget: "Invoke-WebRequest",
  curliex: "Invoke-WebRequest",
  hk: "Get-Help",
  gci: "Get-ChildItem",
  ls: "Get-ChildItem",
  dir: "Get-ChildItem",
  gc: "Get-Content",
  cat: "Get-Content",
  type: "Get-Content",
  ni: "New-Item",
  md: "New-Item",
  rm: "Remove-Item",
  rd: "Remove-Item",
  cp: "Copy-Item",
  copy: "Copy-Item",
  mv: "Move-Item",
  move: "Move-Item",
  ac: "Add-Content",
  sl: "Set-Location",
  cd: "Set-Location",
  pwd: "Get-Location",
  gl: "Get-Location",
  echo: "Write-Output",
  write: "Write-Output",
  diff: "Compare-Object",
  select: "Select-Object",
  sort: "Sort-Object",
  wv: "Where-Object",
  fl: "Format-List",
  ft: "Format-Table",
  gm: "Get-Member",
  gdr: "Get-PSDrive",
  gwmi: "Get-WmiObject",
  icm: "Invoke-Command",
  clc: "Clear-Content",
  del: "Remove-Item",
  ri: "Remove-Item",
  sc: "Set-Content",
  sp: "Set-Item",
  sv: "Set-Variable",
  si: "Set-Item",
  gi: "Get-Item",
}

export function expandAliases(cmdName: string): string {
  const lower = cmdName.toLowerCase()
  return POWERSHELL_ALIASES[lower] ?? cmdName
}
