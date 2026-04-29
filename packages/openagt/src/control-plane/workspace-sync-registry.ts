import { GlobalBus } from "@/bus/global"
import type { WorkspaceID } from "./schema"
import { ConnectionStatus, Event } from "./workspace-contracts"

export class WorkspaceSyncRegistry {
  private readonly connections = new Map<WorkspaceID, ConnectionStatus>()
  private readonly aborts = new Map<WorkspaceID, AbortController>()

  setStatus(id: WorkspaceID, status: ConnectionStatus["status"]): void {
    const prev = this.connections.get(id)
    if (prev?.status === status) return
    const next = { workspaceID: id, status }
    this.connections.set(id, next)

    if (status === "error") {
      this.aborts.delete(id)
    }

    GlobalBus.emit("event", {
      directory: "global",
      workspace: id,
      payload: {
        type: Event.Status.type,
        properties: next,
      },
    })
  }

  status(): ConnectionStatus[] {
    return [...this.connections.values()]
  }

  isSyncing(workspaceID: WorkspaceID): boolean {
    return this.aborts.has(workspaceID)
  }

  hasAbort(workspaceID: WorkspaceID): boolean {
    return this.aborts.has(workspaceID)
  }

  setAbort(workspaceID: WorkspaceID, abort: AbortController): void {
    this.aborts.set(workspaceID, abort)
  }

  deleteAbort(workspaceID: WorkspaceID): void {
    this.aborts.delete(workspaceID)
  }

  stop(workspaceID: WorkspaceID): void {
    this.aborts.get(workspaceID)?.abort()
    this.aborts.delete(workspaceID)
    this.connections.delete(workspaceID)
  }
}
