import type { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs'
import path from 'node:path'

/** One consistent copy of the database per day in <dir>/zendo-YYYY-MM-DD.db; keeps the newest `keep`. */
export function backupDaily(db: DatabaseSync, dbFile: string, dir: string, keep = 14): string | null {
  if (dbFile === ':memory:' || !existsSync(dbFile)) return null
  mkdirSync(dir, { recursive: true })
  const today = new Date().toISOString().slice(0, 10)
  const target = path.join(dir, `zendo-${today}.db`)
  if (existsSync(target)) return null
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`)
  const old = readdirSync(dir)
    .filter((f) => /^zendo-\d{4}-\d{2}-\d{2}\.db$/.test(f))
    .sort()
    .slice(0, -keep)
  for (const f of old) unlinkSync(path.join(dir, f))
  return target
}
