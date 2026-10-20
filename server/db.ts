import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const COLLECTIONS = ['inbox', 'projects', 'tasks', 'events', 'blocks', 'reviews'] as const
export type Collection = (typeof COLLECTIONS)[number]
export const TABLE: Record<Collection, string> = {
  inbox: 'inbox_items',
  projects: 'projects',
  tasks: 'tasks',
  events: 'events',
  blocks: 'plan_blocks',
  reviews: 'reviews',
}

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'db', 'migrations')

/** Opens (and creates) the SQLite database and applies pending migrations. Use ':memory:' in tests. */
export function openDb(file: string): DatabaseSync {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = OFF')
  runMigrations(db)
  return db
}

function runMigrations(db: DatabaseSync): void {
  db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
  const applied = Number(getMeta(db, 'schema') ?? '0')
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort()
  for (const f of files) {
    const n = Number(f.slice(0, 4))
    if (n <= applied) continue
    const sql = readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8')
    db.exec('BEGIN')
    try {
      db.exec(sql)
      setMeta(db, 'schema', String(n))
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }
}

export function getMeta(db: DatabaseSync, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value
}

export function setMeta(db: DatabaseSync, key: string, value: string): void {
  db.prepare('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
}

/** Runs fn inside a transaction; rolls back on throw. */
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const out = fn()
    db.exec('COMMIT')
    return out
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}
