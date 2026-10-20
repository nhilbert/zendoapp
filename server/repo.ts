import type { DatabaseSync } from 'node:sqlite'
import { COLLECTIONS, TABLE, type Collection, getMeta, setMeta, transaction } from './db.ts'
import { STORE_VERSION, migratePersisted } from '../src/domain/migrations.ts'
import type { CalendarEvent, Settings } from '../src/domain/types.ts'

export interface Record_ {
  id: string
  [key: string]: unknown
}

export interface Snapshot {
  version: number
  inbox: Record_[]
  projects: Record_[]
  tasks: Record_[]
  events: Record_[]
  blocks: Record_[]
  reviews: Record_[]
  settings: Settings | null
}

export interface Changes {
  upserts?: Partial<Record<Collection, Record_[]>>
  deletes?: Partial<Record<Collection, string[]>>
  settings?: Settings
}

export class BadRequest extends Error {}

function isRecordArray(x: unknown): x is Record_[] {
  return Array.isArray(x) && x.every((r) => r && typeof r === 'object' && typeof (r as Record_).id === 'string' && (r as Record_).id.length > 0)
}

export function validateChanges(body: unknown): Changes {
  if (!body || typeof body !== 'object') throw new BadRequest('body must be an object')
  const b = body as Changes
  for (const key of ['upserts', 'deletes'] as const) {
    const part = b[key]
    if (part === undefined) continue
    if (!part || typeof part !== 'object') throw new BadRequest(`${key} must be an object`)
    for (const [col, value] of Object.entries(part)) {
      if (!(COLLECTIONS as readonly string[]).includes(col)) throw new BadRequest(`unknown collection ${col}`)
      if (key === 'upserts' && !isRecordArray(value)) throw new BadRequest(`upserts.${col} must be records with ids`)
      if (key === 'deletes' && !(Array.isArray(value) && value.every((v) => typeof v === 'string'))) throw new BadRequest(`deletes.${col} must be ids`)
    }
  }
  if (b.settings !== undefined && (!b.settings || typeof b.settings !== 'object')) throw new BadRequest('settings must be an object')
  return b
}

export function validateSnapshot(body: unknown): Snapshot {
  if (!body || typeof body !== 'object') throw new BadRequest('body must be an object')
  const b = body as Partial<Snapshot>
  for (const col of COLLECTIONS) {
    if (!isRecordArray(b[col] ?? [])) throw new BadRequest(`${col} must be records with ids`)
  }
  if (b.version !== undefined && typeof b.version !== 'number') throw new BadRequest('version must be a number')
  return {
    version: b.version ?? 1,
    inbox: b.inbox ?? [],
    projects: b.projects ?? [],
    tasks: b.tasks ?? [],
    events: b.events ?? [],
    blocks: b.blocks ?? [],
    reviews: b.reviews ?? [],
    settings: (b.settings as Settings | undefined) ?? null,
  }
}

/** Data access for the Zendo database. Rows store JSON; see db/migrations. */
export class Repo {
  private db: DatabaseSync
  constructor(db: DatabaseSync) {
    this.db = db
  }

  isInitialized(): boolean {
    return getMeta(this.db, 'initialized') === '1'
  }

  /** ISO timestamp of the last write – lets clients skip refreshes when nothing changed. */
  changedAt(): string | null {
    return getMeta(this.db, 'changed_at') ?? null
  }

  loadState(): Snapshot {
    const read = (col: Collection): Record_[] =>
      (this.db.prepare(`SELECT data FROM ${TABLE[col]}`).all() as { data: string }[]).map((r) => JSON.parse(r.data) as Record_)
    const settingsRow = this.db.prepare(`SELECT value FROM settings WHERE key = 'settings'`).get() as { value: string } | undefined
    return {
      version: STORE_VERSION,
      inbox: read('inbox'),
      projects: read('projects'),
      tasks: read('tasks'),
      events: read('events'),
      blocks: read('blocks'),
      reviews: read('reviews'),
      settings: settingsRow ? (JSON.parse(settingsRow.value) as Settings) : null,
    }
  }

  applyChanges(changes: Changes): { upserted: number; deleted: number } {
    const now = new Date().toISOString()
    let upserted = 0
    let deleted = 0
    transaction(this.db, () => {
      for (const col of COLLECTIONS) {
        const ups = changes.upserts?.[col] ?? []
        if (ups.length) {
          const stmt = this.db.prepare(
            `INSERT INTO ${TABLE[col]}(id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
          )
          for (const r of ups) {
            stmt.run(r.id, JSON.stringify(r), now)
            upserted += 1
          }
        }
        const dels = changes.deletes?.[col] ?? []
        if (dels.length) {
          const stmt = this.db.prepare(`DELETE FROM ${TABLE[col]} WHERE id = ?`)
          for (const id of dels) deleted += Number(stmt.run(id).changes)
        }
      }
      if (changes.settings) this.saveSettings(changes.settings)
      setMeta(this.db, 'initialized', '1')
      setMeta(this.db, 'changed_at', now)
    })
    return { upserted, deleted }
  }

  /** Replaces everything with the snapshot (migrated to the current schema first). */
  replaceAll(raw: Snapshot): void {
    const snap = migratePersisted({ ...raw, settings: raw.settings ?? undefined }, raw.version ?? 1)
    const now = new Date().toISOString()
    transaction(this.db, () => {
      for (const col of COLLECTIONS) {
        this.db.exec(`DELETE FROM ${TABLE[col]}`)
        const stmt = this.db.prepare(`INSERT INTO ${TABLE[col]}(id, data, updated_at) VALUES (?, ?, ?)`)
        for (const r of (snap[col] ?? []) as Record_[]) stmt.run(r.id, JSON.stringify(r), now)
      }
      if (snap.settings) this.saveSettings(snap.settings as Settings)
      setMeta(this.db, 'initialized', '1')
      setMeta(this.db, 'changed_at', now)
    })
  }

  /**
   * Replace all events of one source (m365 or ics) with a fresh import. Events already known by
   * externalId keep their id and the user's overrides (kind, project, private flag); the rest are
   * removed. Manual events are untouched.
   */
  replaceEvents(source: 'm365' | 'ics', incoming: Omit<CalendarEvent, 'id'>[]): { total: number; kept: number; removed: number } {
    const now = new Date().toISOString()
    let kept = 0
    let removed = 0
    transaction(this.db, () => {
      const previous = (this.db.prepare(`SELECT data FROM events WHERE source = ?`).all(source) as { data: string }[]).map((r) => JSON.parse(r.data) as CalendarEvent)
      const byKey = new Map(previous.filter((e) => e.externalId).map((e) => [e.externalId!, e]))
      const upsert = this.db.prepare(`INSERT INTO events(id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`)
      const keptIds = new Set<string>()
      for (const ev of incoming) {
        const prev = ev.externalId ? byKey.get(ev.externalId) : undefined
        const record: CalendarEvent = prev
          ? { ...ev, id: prev.id, kind: prev.kind, projectId: prev.projectId, private: prev.private ?? ev.private, source }
          : { ...ev, id: crypto.randomUUID(), source }
        if (prev) {
          kept += 1
          keptIds.add(prev.id)
        }
        upsert.run(record.id, JSON.stringify(record), now)
      }
      const del = this.db.prepare(`DELETE FROM events WHERE id = ?`)
      for (const e of previous) {
        if (!keptIds.has(e.id)) {
          del.run(e.id)
          removed += 1
        }
      }
      setMeta(this.db, 'initialized', '1')
      setMeta(this.db, 'changed_at', now)
    })
    return { total: incoming.length, kept, removed }
  }

  getMeta(key: string): string | undefined {
    return getMeta(this.db, key)
  }

  setMeta(key: string, value: string): void {
    setMeta(this.db, key, value)
  }

  /** Quick capture from outside the app (CLI, bookmarklet). */
  addInboxItem(text: string): Record_ {
    const item = { id: crypto.randomUUID(), text: text.trim(), createdAt: new Date().toISOString() }
    this.applyChanges({ upserts: { inbox: [item] } })
    return item
  }

  private saveSettings(settings: Settings): void {
    this.db
      .prepare(`INSERT INTO settings(key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .run(JSON.stringify(settings))
  }
}
