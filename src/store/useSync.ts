import { create } from 'zustand'

/**
 * Status of the connection to the local server.
 *  connecting – first handshake in progress
 *  online     – server is the source of truth, changes are sent as they happen
 *  offline    – server was reachable before and is not now; changes queue up
 *  local      – server never reached this session; data lives in this browser only
 *  conflict   – this browser holds data that differs from the server; the user decides which side to keep
 *  signin     – hosted: the login in front of the server has expired; changes queue up until a reload signs in again
 */
export type SyncStatus = 'connecting' | 'online' | 'offline' | 'local' | 'conflict' | 'signin'

export interface Counts {
  projects: number
  tasks: number
  inbox: number
}

/** A merge decision against one side (from the server, see server/repo.ts Replaced); the user may undo it. */
export interface Replaced {
  collection: 'inbox' | 'projects' | 'tasks' | 'events' | 'blocks' | 'reviews'
  id: string
  label: string
  /** field: the later edit replaced these values. kept: a record deleted on one side stayed because the other side changed it. */
  kind: 'field' | 'kept'
  /** whose value was replaced, or who deleted the record that was kept */
  from: 'browser' | 'server'
  fields?: string[]
  kept?: Record<string, unknown>
  replaced?: Record<string, unknown>
  replacedAt: string
}

interface SyncState {
  status: SyncStatus
  lastSync?: string
  pending: number
  message?: string
  conflict?: { local: Counts; server: Counts }
  replaced: Replaced[]
  set: (patch: Partial<Omit<SyncState, 'set'>>) => void
}

export const useSync = create<SyncState>()((set) => ({
  status: 'connecting',
  pending: 0,
  replaced: [],
  set: (patch) => set(patch),
}))
