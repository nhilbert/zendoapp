import type { DatabaseSync } from 'node:sqlite'
import { COLLECTIONS, TABLE, type Collection, getMeta, setMeta, transaction } from './db.ts'
import { STORE_VERSION, migratePersisted } from '../src/domain/migrations.ts'
import { mergeImportedEvents, type MergeOptions } from '../src/domain/eventMerge.ts'
import { mergeRecord, recordLabel, sameValue } from '../src/domain/merge.ts'
import type { CalendarEvent, Project, Settings } from '../src/domain/types.ts'

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

/** What a browser's change started from: the record as it knew it (null = created there) and when it was edited. */
export interface Base {
  record: Record_ | null
  editedAt: string
}

export interface Changes {
  upserts?: Partial<Record<Collection, Record_[]>>
  deletes?: Partial<Record<Collection, string[]>>
  settings?: Settings
  /** Per collection and id. With a base, a write is merged with what changed on the server since (src/domain/merge.ts); without, it replaces. */
  bases?: Partial<Record<Collection, Record<string, Base>>>
}

/** Something a merge decided that the user may want to undo (shown by the browser that sent the change). */
export interface Replaced {
  collection: Collection
  id: string
  label: string
  /** field: the later edit replaced these values. kept: a record deleted on one side stayed because the other side changed it. */
  kind: 'field' | 'kept'
  /** whose value was replaced, or who deleted the record that was kept */
  from: 'browser' | 'server'
  fields?: string[]
  kept?: Record<string, unknown>
  replaced?: Record<string, unknown>
  /** when the replaced value (or the deletion) was made */
  replacedAt: string
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
  if (b.bases !== undefined) {
    if (!b.bases || typeof b.bases !== 'object') throw new BadRequest('bases must be an object')
    for (const [col, byId] of Object.entries(b.bases)) {
      if (!(COLLECTIONS as readonly string[]).includes(col)) throw new BadRequest(`unknown collection ${col}`)
      if (!byId || typeof byId !== 'object') throw new BadRequest(`bases.${col} must be an object`)
      for (const base of Object.values(byId as Record<string, Base>)) {
        const ok =
          !!base &&
          typeof base === 'object' &&
          (base.record === null || isRecordArray([base.record])) &&
          typeof base.editedAt === 'string' &&
          !Number.isNaN(Date.parse(base.editedAt))
        if (!ok) throw new BadRequest(`bases.${col} must hold { record, editedAt }`)
      }
    }
  }
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

  /**
   * Marks a write (inside its transaction). The stamp always moves forward, even within the same
   * millisecond, so a client can tell from the previous one whether anybody else wrote in between.
   */
  private touch(now: string): string | null {
    const previous = getMeta(this.db, 'changed_at') ?? null
    const stamp = previous && now <= previous ? new Date(Date.parse(previous) + 1).toISOString() : now
    setMeta(this.db, 'initialized', '1')
    setMeta(this.db, 'changed_at', stamp)
    return previous
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

  /**
   * previousChangedAt: the stamp this write replaced (see touch). A record with a base is merged with what
   * changed on the server since; adjusted counts the records now stored differently from what was sent
   * (the sender should pull), replaced lists what the merge decided against one side.
   */
  applyChanges(changes: Changes): { upserted: number; deleted: number; previousChangedAt: string | null; adjusted: number; replaced: Replaced[] } {
    const now = new Date().toISOString()
    let upserted = 0
    let deleted = 0
    let adjusted = 0
    const replaced: Replaced[] = []
    let previousChangedAt: string | null = null
    // An edit time from the future (a clock running ahead) counts as now.
    const editTime = (b: Base) => {
      const at = new Date(b.editedAt).toISOString()
      return at < now ? at : now
    }
    transaction(this.db, () => {
      const nextTasks = new Set<string>() // tasks this browser sent as "next": their project keeps one next action
      for (const col of COLLECTIONS) {
        const bases = changes.bases?.[col] ?? {}
        const select = this.db.prepare(`SELECT data, updated_at FROM ${TABLE[col]} WHERE id = ?`)
        const current = (id: string) => {
          const row = select.get(id) as { data: string; updated_at: string } | undefined
          return row ? { record: JSON.parse(row.data) as Record_, at: row.updated_at } : null
        }
        const ups = changes.upserts?.[col] ?? []
        if (ups.length) {
          const stmt = this.db.prepare(
            `INSERT INTO ${TABLE[col]}(id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
          )
          for (const r of ups) {
            const base = bases[r.id]
            let record = r
            let at = now
            if (base) {
              at = editTime(base)
              const cur = current(r.id)
              if (!cur && base.record) {
                // Deleted on the server meanwhile. A calendar import removed the meeting: it stays gone.
                if (col === 'events' && r.source !== 'manual') {
                  adjusted += 1
                  continue
                }
                replaced.push({ collection: col, id: r.id, label: recordLabel(r), kind: 'kept', from: 'server', replacedAt: now })
              } else if (cur && base.record && !sameValue(cur.record, base.record)) {
                const merged = mergeRecord(col, base.record, r, cur.record, at >= cur.at)
                record = merged.record
                if (cur.at > at) at = cur.at
                if (!sameValue(record, r)) adjusted += 1
                for (const c of merged.conflicts) {
                  replaced.push({ collection: col, id: r.id, label: recordLabel(record), kind: 'field', ...c, replacedAt: c.from === 'server' ? cur.at : editTime(base) })
                }
              }
              if (col === 'tasks' && record.status === 'next' && typeof record.projectId === 'string') nextTasks.add(r.id)
            }
            stmt.run(r.id, JSON.stringify(record), at)
            upserted += 1
          }
        }
        const dels = changes.deletes?.[col] ?? []
        if (dels.length) {
          const stmt = this.db.prepare(`DELETE FROM ${TABLE[col]} WHERE id = ?`)
          for (const id of dels) {
            const base = bases[id]
            const cur = base?.record ? current(id) : null
            if (base?.record && cur && !sameValue(cur.record, base.record)) {
              // Changed on the server since this browser deleted it: it stays.
              adjusted += 1
              replaced.push({ collection: col, id, label: recordLabel(cur.record), kind: 'kept', from: 'browser', replacedAt: editTime(base) })
              continue
            }
            deleted += Number(stmt.run(id).changes)
          }
        }
      }
      for (const r of this.singleNext(nextTasks, now)) {
        adjusted += 1
        replaced.push(r)
      }
      if (changes.settings) this.saveSettings(changes.settings)
      previousChangedAt = this.touch(now)
    })
    return { upserted, deleted, previousChangedAt, adjusted, replaced }
  }

  /**
   * Two devices can each pick a different next action for the same project; merged, the project would
   * have two. The one edited last stays next, the others become to-dos (reported, so they can be restored).
   */
  private singleNext(sent: Set<string>, now: string): Replaced[] {
    if (!sent.size) return []
    const out: Replaced[] = []
    const byProject = this.db.prepare(`SELECT data, updated_at FROM tasks WHERE json_extract(data, '$.projectId') = ? AND json_extract(data, '$.status') = 'next'`)
    const write = this.db.prepare(`UPDATE tasks SET data = ?, updated_at = ? WHERE id = ?`)
    const projects = new Set(
      [...sent].map((id) => (this.db.prepare(`SELECT json_extract(data, '$.projectId') AS p FROM tasks WHERE id = ?`).get(id) as { p: string | null } | undefined)?.p),
    )
    for (const projectId of projects) {
      if (!projectId) continue
      const next = (byProject.all(projectId) as { data: string; updated_at: string }[]).map((row) => ({ task: JSON.parse(row.data) as Record_, at: row.updated_at }))
      if (next.length < 2) continue
      const edited = (x: (typeof next)[number]) => String(x.task.updatedAt ?? x.at)
      next.sort((a, b) => (edited(b) > edited(a) ? 1 : edited(b) < edited(a) ? -1 : 0))
      for (const { task, at } of next.slice(1)) {
        write.run(JSON.stringify({ ...task, status: 'todo', updatedAt: now }), now, task.id)
        out.push({
          collection: 'tasks',
          id: task.id,
          label: recordLabel(task),
          kind: 'field',
          from: sent.has(task.id) ? 'browser' : 'server',
          fields: ['status'],
          kept: { status: 'todo' },
          replaced: { status: 'next' },
          replacedAt: at,
        })
      }
    }
    return out
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
      this.touch(now)
    })
  }

  /**
   * Replace all events of one source (m365 or ics) with a fresh import, merged by mergeImportedEvents:
   * known events keep their id and the user's overrides (kind, project, private flag), new occurrences of
   * linked series get their project, and with a window linked history is kept. Manual events are untouched.
   */
  replaceEvents(
    source: 'm365' | 'ics',
    incoming: Omit<CalendarEvent, 'id'>[],
    window: Pick<MergeOptions, 'windowFrom' | 'keepLinkedSince'> = {},
  ): { total: number; kept: number; removed: number } {
    const now = new Date().toISOString()
    let result: { total: number; kept: number; removed: number } = { total: 0, kept: 0, removed: 0 }
    transaction(this.db, () => {
      const parse = (rows: unknown[]) => (rows as { data: string }[]).map((r) => JSON.parse(r.data))
      const previous: CalendarEvent[] = parse(this.db.prepare(`SELECT data FROM events WHERE source = ?`).all(source))
      const projects: Project[] = parse(this.db.prepare(`SELECT data FROM projects`).all())
      const { events, ...counts } = mergeImportedEvents(previous, incoming.map((ev) => ({ ...ev, source })), { ...window, projects })
      result = counts
      const upsert = this.db.prepare(`INSERT INTO events(id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`)
      for (const ev of events) upsert.run(ev.id, JSON.stringify(ev), now)
      const keep = new Set(events.map((e) => e.id))
      const del = this.db.prepare(`DELETE FROM events WHERE id = ?`)
      for (const e of previous) if (!keep.has(e.id)) del.run(e.id)
      this.touch(now)
    })
    return result
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
