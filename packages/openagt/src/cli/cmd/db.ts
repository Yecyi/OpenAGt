import type { Argv } from "yargs"
import { spawn } from "child_process"
import { Database } from "../../storage"
import { drizzle } from "drizzle-orm/bun-sqlite"
import { Database as BunDatabase } from "bun:sqlite"
import { UI } from "../ui"
import { cmd } from "./cmd"
import { JsonMigration } from "../../storage"
import { integrityCheck, listSchemaVersions } from "../../storage/db"
import { EOL } from "os"
import { errorMessage } from "../../util/error"
import { existsSync, statSync } from "fs"

const QueryCommand = cmd({
  command: "$0 [query]",
  describe: "open an interactive sqlite3 shell or run a query",
  builder: (yargs: Argv) => {
    return yargs
      .positional("query", {
        type: "string",
        describe: "SQL query to execute",
      })
      .option("format", {
        type: "string",
        choices: ["json", "tsv"],
        default: "tsv",
        describe: "Output format",
      })
  },
  handler: async (args: { query?: string; format: string }) => {
    const query = args.query as string | undefined
    if (query) {
      const db = new BunDatabase(Database.Path, { readonly: true })
      try {
        const result = db.query(query).all() as Record<string, unknown>[]
        if (args.format === "json") {
          console.log(JSON.stringify(result, null, 2))
        } else if (result.length > 0) {
          const keys = Object.keys(result[0])
          console.log(keys.join("\t"))
          for (const row of result) {
            console.log(keys.map((k) => row[k]).join("\t"))
          }
        }
      } catch (err) {
        UI.error(errorMessage(err))
        process.exit(1)
      }
      db.close()
      return
    }
    const child = spawn("sqlite3", [Database.Path], {
      stdio: "inherit",
    })
    await new Promise((resolve) => child.on("close", resolve))
  },
})

const PathCommand = cmd({
  command: "path",
  describe: "print the database path",
  handler: () => {
    console.log(Database.Path)
  },
})

const MigrateCommand = cmd({
  command: "migrate",
  describe: "migrate JSON data to SQLite (merges with existing data)",
  handler: async () => {
    const sqlite = new BunDatabase(Database.Path)
    const tty = process.stderr.isTTY
    const width = 36
    const orange = "\x1b[38;5;214m"
    const muted = "\x1b[0;2m"
    const reset = "\x1b[0m"
    let last = -1
    if (tty) process.stderr.write("\x1b[?25l")
    try {
      const stats = await JsonMigration.run(drizzle({ client: sqlite }), {
        progress: (event) => {
          const percent = Math.floor((event.current / event.total) * 100)
          if (percent === last) return
          last = percent
          if (tty) {
            const fill = Math.round((percent / 100) * width)
            const bar = `${"■".repeat(fill)}${"･".repeat(width - fill)}`
            process.stderr.write(
              `\r${orange}${bar} ${percent.toString().padStart(3)}%${reset} ${muted}${event.current}/${event.total}${reset} `,
            )
          } else {
            process.stderr.write(`sqlite-migration:${percent}${EOL}`)
          }
        },
      })
      if (tty) process.stderr.write("\n")
      if (tty) process.stderr.write("\x1b[?25h")
      else process.stderr.write(`sqlite-migration:done${EOL}`)
      UI.println(
        `Migration complete: ${stats.projects} projects, ${stats.sessions} sessions, ${stats.messages} messages`,
      )
      if (stats.errors.length > 0) {
        UI.println(`${stats.errors.length} errors occurred during migration`)
      }
    } catch (err) {
      if (tty) process.stderr.write("\x1b[?25h")
      UI.error(`Migration failed: ${errorMessage(err)}`)
      process.exit(1)
    } finally {
      sqlite.close()
    }
  },
})

// `openagt db status` — surfaces the v1.21 _schema_version audit table and an
// on-demand integrity_check. Used by ops to confirm migrations applied cleanly
// and the SQLite file isn't corrupted.
function optionalCount(sqlite: ReturnType<typeof Database.Client>["$client"], table: string) {
  const exists = sqlite
    .query<{ name: string }, [string]>(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
    .get(table)
  if (!exists) return 0
  return sqlite.query<{ count: number }, []>(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count ?? 0
}

function indexExists(sqlite: ReturnType<typeof Database.Client>["$client"], name: string) {
  return (
    sqlite
      .query<{ name: string }, [string]>(`SELECT name FROM sqlite_master WHERE type='index' AND name=?`)
      .get(name) !== null
  )
}

function storageDiagnostics() {
  const sqlite = Database.Client().$client
  const wal = `${Database.Path}-wal`
  return {
    event_rows: optionalCount(sqlite, "event"),
    event_snapshot_rows: optionalCount(sqlite, "event_snapshot"),
    personal_memory_rows: optionalCount(sqlite, "personal_memory_note"),
    inbox_rows: optionalCount(sqlite, "inbox_item"),
    wakeup_rows: optionalCount(sqlite, "scheduled_wakeup"),
    wal_bytes: existsSync(wal) ? statSync(wal).size : 0,
    indexes: {
      event_aggregate_seq_idx: indexExists(sqlite, "event_aggregate_seq_idx"),
      event_snapshot_aggregate_seq_idx: indexExists(sqlite, "event_snapshot_aggregate_seq_idx"),
      personal_memory_query_idx: indexExists(sqlite, "personal_memory_query_idx"),
      inbox_project_state_time_idx: indexExists(sqlite, "inbox_project_state_time_idx"),
      wakeup_project_state_due_idx: indexExists(sqlite, "wakeup_project_state_due_idx"),
    },
  }
}

const StatusCommand = cmd({
  command: "status",
  describe: "show migration history and run an integrity check",
  builder: (yargs: Argv) =>
    yargs
      .option("integrity", {
        type: "boolean",
        default: true,
        describe: "Run PRAGMA integrity_check (slow on large DBs)",
      })
      .option("format", {
        type: "string",
        choices: ["text", "json"],
        default: "text",
        describe: "Output format",
      }),
  handler: (args: { integrity: boolean; format: string }) => {
    try {
      const versions = listSchemaVersions()
      const integrity = args.integrity ? integrityCheck() : "skipped"
      const storage = storageDiagnostics()
      if (args.format === "json") {
        console.log(JSON.stringify({ path: Database.Path, integrity, migrations: versions, storage }, null, 2))
        return
      }
      UI.println(`Database: ${Database.Path}`)
      UI.println(`Integrity: ${integrity}`)
      UI.println(
        `Storage: events=${storage.event_rows}, snapshots=${storage.event_snapshot_rows}, wal=${storage.wal_bytes} bytes`,
      )
      UI.println(`Migrations applied: ${versions.length}`)
      if (versions.length > 0) {
        UI.println("")
        for (const v of versions) {
          const when = new Date(v.applied_at).toISOString()
          const checksum = v.checksum === "legacy" ? "legacy" : v.checksum.slice(0, 8)
          UI.println(`  ${v.migration_name}  applied=${when}  checksum=${checksum}`)
        }
      } else {
        UI.println("(no _schema_version table — pre-v1.21 database)")
      }
    } catch (err) {
      UI.error(errorMessage(err))
      process.exit(1)
    }
  },
})

export const DbCommand = cmd({
  command: "db",
  describe: "database tools",
  builder: (yargs: Argv) => {
    return yargs
      .command(QueryCommand)
      .command(PathCommand)
      .command(MigrateCommand)
      .command(StatusCommand)
      .demandCommand()
  },
  handler: () => {},
})
