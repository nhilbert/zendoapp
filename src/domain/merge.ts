/**
 * Three-way merge of one record, used by the server when a browser's change arrives (server/repo.ts).
 * The browser sends the version it started from (base) with its edit (mine); the server holds theirs.
 *  - A field changed on one side only is taken from that side.
 *  - A field changed on both sides goes to the later edit; the other value is reported as replaced,
 *    so the browser can offer to restore it.
 *  - Fields that only make sense together (a status and its completion stamps, a date and its time)
 *    are merged as one unit.
 *  - Lists of records with ids (task notes, project goals) and lists of strings are merged per entry;
 *    an entry edited on both sides goes to the later edit without a report.
 *  - Bookkeeping (updatedAt, order) never counts as a conflict.
 * Pure: no clock, no storage.
 */

export interface Rec {
  id: string
  [key: string]: unknown
}

export interface FieldConflict {
  fields: string[]
  /** the values now in the record */
  kept: Record<string, unknown>
  /** the values that lost against the later edit */
  replaced: Record<string, unknown>
  /** whose value was replaced */
  from: 'browser' | 'server'
}

const GROUPS: Record<string, string[][]> = {
  tasks: [
    ['status', 'completedAt', 'statusBeforeDone', 'waitingFor'],
    ['plannedDate', 'plannedStart'],
    ['recurrence', 'recurrenceAnchor'],
  ],
  events: [['date', 'start', 'end', 'allDay']],
}
const QUIET = new Set(['updatedAt', 'order'])

/** JSON with sorted keys, so the same record compares equal however its keys were ordered. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    return `{${Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export const sameValue = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b)

const pick = (r: Rec, fields: string[]) => Object.fromEntries(fields.map((f) => [f, r[f]]))

/** The fields merged as one unit, for a record of this collection. */
function units(collection: string, keys: Set<string>): string[][] {
  const groups = GROUPS[collection] ?? []
  const grouped = new Set(groups.flat())
  return [...groups, ...[...keys].filter((k) => !grouped.has(k)).map((k) => [k])]
}

export function mergeRecord(collection: string, base: Rec, mine: Rec, theirs: Rec, mineLater: boolean): { record: Rec; conflicts: FieldConflict[] } {
  const keys = new Set([...Object.keys(base), ...Object.keys(mine), ...Object.keys(theirs)])
  keys.delete('id')
  const record: Rec = { ...theirs }
  const conflicts: FieldConflict[] = []
  const put = (values: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(values)) {
      if (v === undefined) delete record[k]
      else record[k] = v
    }
  }
  for (const fields of units(collection, keys)) {
    const b = pick(base, fields)
    const m = pick(mine, fields)
    const s = pick(theirs, fields)
    if (sameValue(m, b) || sameValue(m, s)) continue // theirs already in place
    if (sameValue(s, b)) {
      put(m)
      continue
    }
    const [field] = fields
    if (fields.length === 1 && QUIET.has(field)) {
      const later = field === 'updatedAt' ? (String(m[field] ?? '') > String(s[field] ?? '') ? m : s) : mineLater ? m : s
      put(later)
      continue
    }
    const list = fields.length === 1 ? mergeList(b[field], m[field], s[field], mineLater) : undefined
    if (list) {
      put({ [field]: list })
      continue
    }
    put(mineLater ? m : s)
    conflicts.push({ fields, kept: mineLater ? m : s, replaced: mineLater ? s : m, from: mineLater ? 'server' : 'browser' })
  }
  return { record, conflicts }
}

const isIdList = (x: unknown): x is Rec[] => Array.isArray(x) && x.every((e) => !!e && typeof e === 'object' && typeof (e as Rec).id === 'string')
const isStringList = (x: unknown): x is string[] => Array.isArray(x) && x.every((e) => typeof e === 'string')

/** Per-entry merge of two edited lists; undefined when the values are not lists of that kind. */
export function mergeList(base: unknown, mine: unknown, theirs: unknown, mineLater: boolean): unknown[] | undefined {
  const b = base ?? []
  const m = mine ?? []
  const s = theirs ?? []
  if (isStringList(b) && isStringList(m) && isStringList(s)) {
    const removed = new Set(b.filter((x) => !m.includes(x)))
    return [...s.filter((x) => !removed.has(x)), ...m.filter((x) => !b.includes(x) && !s.includes(x))]
  }
  if (!isIdList(b) || !isIdList(m) || !isIdList(s)) return undefined
  const byId = (xs: Rec[]) => new Map(xs.map((x) => [x.id, x]))
  const bm = byId(b)
  const mm = byId(m)
  const sm = byId(s)
  const out: Rec[] = []
  for (const sv of s) {
    const bv = bm.get(sv.id)
    const mv = mm.get(sv.id)
    if (!mv) {
      // removed here: gone, unless it was changed on the other side meanwhile
      if (!bv || !sameValue(sv, bv)) out.push(sv)
      continue
    }
    const mineChanged = !bv || !sameValue(mv, bv)
    const theirsChanged = !!bv && !sameValue(sv, bv)
    out.push(mineChanged && (!theirsChanged || mineLater) ? mv : sv)
  }
  for (const mv of m) {
    if (sm.has(mv.id)) continue
    const bv = bm.get(mv.id)
    // new here, or removed there although changed here
    if (!bv || !sameValue(mv, bv)) out.push(mv)
  }
  return out
}

/** A short name for a record in reports: title, name, text or date. */
export function recordLabel(r: Rec): string {
  for (const k of ['title', 'name', 'text', 'date']) if (typeof r[k] === 'string' && r[k]) return r[k] as string
  return r.id
}
