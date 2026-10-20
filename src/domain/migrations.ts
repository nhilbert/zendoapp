import type { Project, Settings } from './types.ts'
import { DEFAULT_SETTINGS } from './types.ts'

/** Schema version of persisted state, JSON exports and the server database. Bump together with migratePersisted. */
export const STORE_VERSION = 4

/** Loosely typed on purpose: old snapshots predate the current types. */
export interface PersistedShape {
  version?: number
  inbox?: unknown[]
  projects?: unknown[]
  tasks?: unknown[]
  events?: unknown[]
  blocks?: unknown[]
  reviews?: unknown[]
  settings?: Partial<Settings>
}

type OldProject = Project & { outcome?: string; status: Project['status'] | 'on_hold' | 'done' }

/** Upgrades older snapshots (browser cache, JSON export, server rows) to the current shape. Pure; shared by client and server. */
export function migratePersisted<T extends PersistedShape>(persisted: T, version: number): T {
  const state = persisted
  if (version < 2 && state.projects) {
    // v1 statuses on_hold/done became planned/archived
    const map: Record<string, Project['status']> = { on_hold: 'planned', done: 'archived' }
    state.projects = (state.projects as OldProject[]).map((p) => ({ ...p, status: map[p.status as string] ?? p.status }))
  }
  if (version < 3 && state.projects) {
    // v2 "desired outcome" became the first goal
    state.projects = (state.projects as OldProject[]).map((p) => {
      const { outcome, ...rest } = p
      const goals = rest.goals?.length ? rest.goals : outcome?.trim() ? [{ id: crypto.randomUUID(), text: outcome.trim() }] : rest.goals
      return { ...rest, goals }
    })
  }
  if (version < 4 && state.settings) {
    state.settings = { ...DEFAULT_SETTINGS, ...state.settings } as Settings
  }
  state.version = STORE_VERSION
  return state
}
