import path from "path"
import os from "os"
import fs from "fs"
import { Log } from "@/util"

const log = Log.create({ service: "compaction.metrics" })

export interface SecurityEvent {
  type: "permission_grant" | "compound_classification" | "symlink_correction" | "advisory_refusal" | "block"
  timestamp: number
  sessionID: string
  pattern?: string
  riskLevel?: "safe" | "low" | "medium" | "high"
  commandSample?: string
  findings?: string[]
}

export class SecurityAuditTracker {
  private events: SecurityEvent[] = []
  private readonly maxEvents = 1000

  recordEvent(event: Omit<SecurityEvent, "timestamp">): void {
    const fullEvent: SecurityEvent = {
      ...event,
      timestamp: Date.now(),
    }
    this.events.push(fullEvent)
    if (this.events.length > this.maxEvents) {
      this.events.shift()
    }

    // C-2: Emit to unified security event stream
    const logEntry = {
      type: fullEvent.type,
      timestamp: fullEvent.timestamp,
      sessionID: fullEvent.sessionID,
      pattern: fullEvent.pattern,
      riskLevel: fullEvent.riskLevel,
      commandSample: fullEvent.commandSample ? this.truncateCommand(fullEvent.commandSample) : undefined,
      findings: fullEvent.findings,
    }
    log.info("security_audit_event", logEntry)

    // Write to persistent audit file (async, non-blocking)
    void this.writeToAuditFile(logEntry)
  }

  private async writeToAuditFile(entry: Record<string, unknown>): Promise<void> {
    try {
      const stateHome = process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state")
      const auditDir = path.join(stateHome, "opencode")
      const auditFile = path.join(auditDir, "security.audit.jsonl")

      // Ensure directory exists
      await fs.promises.mkdir(auditDir, { recursive: true })

      // Redact command strings >256 bytes
      if (entry.commandSample && typeof entry.commandSample === "string" && entry.commandSample.length > 256) {
        entry.commandSample = entry.commandSample.slice(0, 256) + "...[redacted]"
      }

      const line = JSON.stringify(entry) + "\n"
      await fs.promises.appendFile(auditFile, line, "utf-8")
    } catch (error) {
      // Non-blocking - don't fail on audit errors
      log.warn("failed to write security audit log", { error })
    }
  }

  private truncateCommand(cmd: string, maxLength = 256): string {
    if (cmd.length <= maxLength) return cmd
    return cmd.slice(0, maxLength) + "...[truncated]"
  }

  recordPermissionGrant(sessionID: string, pattern: string): void {
    this.recordEvent({ type: "permission_grant", sessionID, pattern })
  }

  recordCompoundClassification(
    sessionID: string,
    pattern: string,
    riskLevel: "safe" | "low" | "medium" | "high",
    findings: string[],
  ): void {
    this.recordEvent({
      type: "compound_classification",
      sessionID,
      pattern,
      riskLevel,
      findings,
    })
  }

  recordSymlinkCorrection(sessionID: string, commandSample: string): void {
    this.recordEvent({ type: "symlink_correction", sessionID, commandSample })
  }

  recordAdvisoryRefusal(sessionID: string, commandSample: string, riskLevel: "medium" | "high"): void {
    this.recordEvent({
      type: "advisory_refusal",
      sessionID,
      commandSample,
      riskLevel,
    })
  }

  recordBlock(sessionID: string, commandSample: string, riskLevel: "medium" | "high", findings: string[]): void {
    this.recordEvent({
      type: "block",
      sessionID,
      commandSample,
      riskLevel,
      findings,
    })
  }

  getRecentEvents(count = 100): SecurityEvent[] {
    return this.events.slice(-count)
  }
}

export const securityAudit = new SecurityAuditTracker()
