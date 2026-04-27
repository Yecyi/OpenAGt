import { type SQLiteBunDatabase } from "drizzle-orm/bun-sqlite"
import { migrate } from "drizzle-orm/bun-sqlite/migrator"
import { type SQLiteTransaction } from "drizzle-orm/sqlite-core"
export * from "drizzle-orm"
import { LocalContext } from "../util"
import { lazy } from "../util/lazy"
import { Global } from "../global"
import { Log } from "../util"
import { NamedError } from "@openagt/shared/util/error"
import z from "zod"
import path from "path"
import { createHash } from "crypto"
import { readFileSync, readdirSync, existsSync } from "fs"
import { Flag } from "../flag/flag"
import { InstallationChannel } from "../installation/version"
import { InstanceState } from "@/effect"
import { iife } from "@/util/iife"
import { init } from "#db"

declare const OPENCODE_MIGRATIONS: { sql: string; timestamp: number; name: string }[] | undefined

export const NotFoundError = NamedError.create(
  "NotFoundError",
  z.object({
    message: z.string(),
  }),
)

const log = Log.create({ service: "db" })

export function getChannelPath() {
  if (["latest", "beta", "prod"].includes(InstallationChannel) || Flag.OPENCODE_DISABLE_CHANNEL_DB)
    return path.join(Global.Path.data, "opencode.db")
  const safe = InstallationChannel.replace(/[^a-zA-Z0-9._-]/g, "-")
  return path.join(Global.Path.data, `opencode-${safe}.db`)
}

export const Path = iife(() => {
  if (Flag.OPENCODE_DB) {
    if (Flag.OPENCODE_DB === ":memory:" || path.isAbsolute(Flag.OPENCODE_DB)) return Flag.OPENCODE_DB
    return path.join(Global.Path.data, Flag.OPENCODE_DB)
  }
  return getChannelPath()
})

export type Transaction = SQLiteTransaction<"sync", void>

type Client = SQLiteBunDatabase

type Journal = { sql: string; timestamp: number; name: string }[]

function time(tag: string) {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(tag)
  if (!match) return 0
  return Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  )
}

function migrations(dir: string): Journal {
  const dirs = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)

  const sql = dirs
    .map((name) => {
      const file = path.join(dir, name, "migration.sql")
      if (!existsSync(file)) return
      return {
        sql: readFileSync(file, "utf-8"),
        timestamp: time(name),
        name,
      }
    })
    .filter(Boolean) as Journal

  return sql.sort((a, b) => a.timestamp - b.timestamp)
}

function migrationChecksum(sql: string) {
  return createHash("sha256").update(sql).digest("hex")
}

// Records each applied migration into the `_schema_version` table so we have an
// audit trail (B.1 of the v1.21 plan). Failures in this bookkeeping must NOT
// fail startup — the migration is the source of truth, the audit table is just
// a safety net.
function recordSchemaVersions(db: ReturnType<typeof init>, entries: Journal) {
  try {
    const sqlite = db.$client
    // Skip silently if the table does not exist yet (e.g. running migrations
    // older than 20260428120000_schema_version_table).
    const exists = sqlite
      .query<{ name: string }, []>(`SELECT name FROM sqlite_master WHERE type='table' AND name='_schema_version'`)
      .all()
    if (exists.length === 0) return

    const insert = sqlite.prepare(
      `INSERT OR IGNORE INTO _schema_version (migration_name, applied_at, checksum) VALUES (?, ?, ?)`,
    )
    const now = Date.now()
    for (const entry of entries) {
      insert.run(entry.name, now, migrationChecksum(entry.sql))
    }
  } catch (err) {
    log.warn("schema-version bookkeeping failed (non-fatal)", { err: String(err) })
  }
}

export const Client = lazy(() => {
  log.info("opening database", { path: Path })

  const db = init(Path)

  db.run("PRAGMA journal_mode = WAL")
  db.run("PRAGMA synchronous = NORMAL")
  db.run("PRAGMA busy_timeout = 5000")
  db.run("PRAGMA cache_size = -64000")
  db.run("PRAGMA foreign_keys = ON")
  db.run("PRAGMA wal_checkpoint(PASSIVE)")

  // Apply schema migrations
  const entries =
    typeof OPENCODE_MIGRATIONS !== "undefined"
      ? OPENCODE_MIGRATIONS
      : migrations(path.join(import.meta.dirname, "../../migration"))
  if (entries.length > 0) {
    log.info("applying migrations", {
      count: entries.length,
      mode: typeof OPENCODE_MIGRATIONS !== "undefined" ? "bundled" : "dev",
    })
    if (Flag.OPENCODE_SKIP_MIGRATIONS) {
      for (const item of entries) {
        item.sql = "select 1;"
      }
    }
    migrate(db, entries)
    if (!Flag.OPENCODE_SKIP_MIGRATIONS) recordSchemaVersions(db, entries)
  }

  return db
})

// Returns one row per migration that has ever been recorded by the audit table.
// Used by `openagt db status`. Returns an empty array if the table does not
// exist yet (i.e. running an older binary against a pre-v1.21 database).
export function listSchemaVersions(): { migration_name: string; applied_at: number; checksum: string }[] {
  const sqlite = Client().$client
  const exists = sqlite
    .query<{ name: string }, []>(`SELECT name FROM sqlite_master WHERE type='table' AND name='_schema_version'`)
    .all()
  if (exists.length === 0) return []
  return sqlite
    .query<{ migration_name: string; applied_at: number; checksum: string }, []>(
      `SELECT migration_name, applied_at, checksum FROM _schema_version ORDER BY migration_name ASC`,
    )
    .all()
}

// Returns "ok" or the integrity_check failure reason. Slow on large DBs; not
// run automatically on startup.
export function integrityCheck(): string {
  const sqlite = Client().$client
  const rows = sqlite.query<{ integrity_check: string }, []>(`PRAGMA integrity_check`).all()
  if (rows.length === 0) return "unknown"
  return rows[0]!.integrity_check
}

// B.3 — cross-process advisory locks for the consolidator. Pure SQL helpers
// because the lock semantics are simpler than a Drizzle wrapper would warrant.
// All three functions are best-effort: failures (table missing, permission
// errors) downgrade to "lock not acquired" rather than throwing.

function machineId(): string {
  // process.platform + a hash of the install dir is a stable-enough machine
  // identifier for advisory locking. We don't need MAC addresses.
  return `${process.platform}:${path.basename(Global.Path.data)}`
}

// Acquire `name` for `ttlMs` milliseconds. Returns true if we now hold the
// lock, false if another live process holds it. Expired locks are stolen.
export function tryAdvisoryLock(name: string, ttlMs: number): boolean {
  const sqlite = Client().$client
  try {
    const exists = sqlite
      .query<{ name: string }, []>(`SELECT name FROM sqlite_master WHERE type='table' AND name='_advisory_lock'`)
      .all()
    if (exists.length === 0) return false
    const now = Date.now()
    // Try to delete any expired lock first so the INSERT below can succeed.
    sqlite.prepare(`DELETE FROM _advisory_lock WHERE name = ? AND expires_at < ?`).run(name, now)
    const result = sqlite
      .prepare(
        `INSERT OR IGNORE INTO _advisory_lock (name, pid, machine_id, acquired_at, expires_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(name, process.pid, machineId(), now, now + ttlMs)
    return Number(result.changes ?? 0) > 0
  } catch (err) {
    log.warn("tryAdvisoryLock failed (treating as not-held)", { name, err: String(err) })
    return false
  }
}

// Release the lock if we still hold it (matched on pid + machine_id). Idempotent.
export function releaseAdvisoryLock(name: string): void {
  const sqlite = Client().$client
  try {
    sqlite
      .prepare(`DELETE FROM _advisory_lock WHERE name = ? AND pid = ? AND machine_id = ?`)
      .run(name, process.pid, machineId())
  } catch (err) {
    log.warn("releaseAdvisoryLock failed", { name, err: String(err) })
  }
}

// Force-release any locks that are past their TTL. Useful for housekeeping.
export function cleanExpiredAdvisoryLocks(now = Date.now()): number {
  const sqlite = Client().$client
  try {
    const result = sqlite.prepare(`DELETE FROM _advisory_lock WHERE expires_at < ?`).run(now)
    return Number(result.changes ?? 0)
  } catch (err) {
    log.warn("cleanExpiredAdvisoryLocks failed", { err: String(err) })
    return 0
  }
}

// Truncate the WAL after a heavy write batch. Called by the consolidator to
// keep WAL growth bounded between automatic checkpoints. Returns true on success.
export function walCheckpointTruncate(): boolean {
  const sqlite = Client().$client
  try {
    sqlite.run(`PRAGMA wal_checkpoint(TRUNCATE)`)
    return true
  } catch (err) {
    log.warn("wal_checkpoint(TRUNCATE) failed", { err: String(err) })
    return false
  }
}

export function close() {
  Client().$client.close()
  Client.reset()
}

export type TxOrDb = Transaction | Client

const ctx = LocalContext.create<{
  tx: TxOrDb
  effects: (() => void | Promise<void>)[]
}>("database")

export function use<T>(callback: (trx: TxOrDb) => T): T {
  try {
    return callback(ctx.use().tx)
  } catch (err) {
    if (err instanceof LocalContext.NotFound) {
      const effects: (() => void | Promise<void>)[] = []
      const result = ctx.provide({ effects, tx: Client() }, () => callback(Client()))
      for (const effect of effects) effect()
      return result
    }
    throw err
  }
}

export function effect(fn: () => any | Promise<any>) {
  const bound = InstanceState.bind(fn)
  try {
    ctx.use().effects.push(bound)
  } catch {
    bound()
  }
}

type NotPromise<T> = T extends Promise<any> ? never : T

export function transaction<T>(
  callback: (tx: TxOrDb) => NotPromise<T>,
  options?: {
    behavior?: "deferred" | "immediate" | "exclusive"
  },
): NotPromise<T> {
  try {
    return callback(ctx.use().tx)
  } catch (err) {
    if (err instanceof LocalContext.NotFound) {
      const effects: (() => void | Promise<void>)[] = []
      const txCallback = InstanceState.bind((tx: TxOrDb) => ctx.provide({ tx, effects }, () => callback(tx)))
      const result = Client().transaction(txCallback, { behavior: options?.behavior })
      for (const effect of effects) effect()
      return result as NotPromise<T>
    }
    throw err
  }
}
