// Reads coordinator run rows from storage and maps them to runtime contracts.
// It does not mutate run state, dispatch tasks, or publish coordinator events.
import { SessionID } from "@/session/schema"
import { Database, desc, eq } from "@/storage"
import { Effect, Option } from "effect"
import { CoordinatorRunTable } from "./coordinator.sql"
import { runFromRow } from "./run-row"
import type { CoordinatorRun as CoordinatorRunType, CoordinatorRunID as CoordinatorRunIDType } from "./schema"

export class CoordinatorRunStore {
  get(id: CoordinatorRunIDType): Effect.Effect<Option.Option<CoordinatorRunType>, Error> {
    return Effect.sync(() =>
      Database.use((db) => db.select().from(CoordinatorRunTable).where(eq(CoordinatorRunTable.id, id)).get()),
    ).pipe(Effect.map((row) => (row ? Option.some(runFromRow(row)) : Option.none())))
  }

  list(sessionID: SessionID): Effect.Effect<CoordinatorRunType[], Error> {
    return Effect.sync(() =>
      Database.use((db) =>
        db
          .select()
          .from(CoordinatorRunTable)
          .where(eq(CoordinatorRunTable.session_id, sessionID))
          .orderBy(desc(CoordinatorRunTable.time_created))
          .all(),
      ),
    ).pipe(Effect.map((rows) => rows.map(runFromRow)))
  }

  readAfterUpdate(id: CoordinatorRunIDType): Effect.Effect<CoordinatorRunType, Error> {
    return Effect.sync(() =>
      Database.use((db) => db.select().from(CoordinatorRunTable).where(eq(CoordinatorRunTable.id, id)).get()),
    ).pipe(Effect.map((row) => runFromRow(row!)))
  }
}
