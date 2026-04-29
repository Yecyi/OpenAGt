// Permission audit entry formatting and in-memory ring-buffer logging.
// This file does not decide whether permission is granted or rejected.

import { Log } from "@/util"

const log = Log.create({ service: "permission" })

interface AuditLogEntry {
  timestamp: number
  sessionID: string
  agent?: string
  pattern: string
  riskLevel?: string
  commandSample?: string
}

const AUDIT_LOG_MAX_SIZE = 10_000
const auditLogCache: AuditLogEntry[] = []
let auditLogCursor = 0

export async function writeAuditLog(entry: AuditLogEntry): Promise<void> {
  if (auditLogCache.length < AUDIT_LOG_MAX_SIZE) {
    auditLogCache.push(entry)
  } else {
    auditLogCache[auditLogCursor] = entry
    auditLogCursor = (auditLogCursor + 1) % AUDIT_LOG_MAX_SIZE
  }
  log.info("permission_audit", { entry: JSON.stringify(entry) })
}

export function truncateForAudit(text: string | undefined, maxLength = 256): string | undefined {
  if (!text) return undefined
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength) + "...[truncated]"
}
