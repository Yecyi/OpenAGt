import type { ProjectID } from "@/project/schema"
import { Database, desc } from "@/storage"
import { PersonalMemoryNoteTable } from "@/personal/personal.sql"
import type { CoordinatorNode as CoordinatorNodeType } from "./schema"

function hasTag(tags: readonly string[], tag: string | undefined) {
  return !tag || tags.includes(tag)
}

export function reviewMemoryPatternsForNode(input: {
  projectID?: ProjectID
  node: CoordinatorNodeType
  workflow: string
  limit?: number
}) {
  const role = input.node.expert_role ?? input.node.role
  const rows = Database.use((db) =>
    db.select().from(PersonalMemoryNoteTable).orderBy(desc(PersonalMemoryNoteTable.time_updated)).limit(200).all(),
  )
  return rows
    .filter(
      (row) =>
        row.tags.includes("failure-pattern") &&
        (!input.projectID || !row.project_id || row.project_id === input.projectID) &&
        hasTag(row.tags, `workflow:${input.workflow}`) &&
        hasTag(row.tags, input.node.expert_id ? `expert:${input.node.expert_id}` : undefined) &&
        hasTag(row.tags, role ? `role:${role}` : undefined),
    )
    .slice(0, input.limit ?? 3)
    .map((row) => ({
      title: row.title,
      content: row.content,
      tags: row.tags,
    }))
}
