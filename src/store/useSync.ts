import { create } from 'zustand'

/**
 * Status of the connection to the local server.
 *  connecting – first handshake in progress
 *  online     – server is the source of truth, changes are sent as they happen
 *  offline    – server was reachable before and is not now; changes queue up
 *  local      – server never reached this session; data lives in this browser only
 *  conflict   – this browser holds data that differs from the server; the user decides which side to keep
 */
export type SyncStatus = 'connecting' | 'online' | 'offline' | 'local' | 'conflict'

export interface Counts {
  projects: number
  tasks: number
  inbox: number
}

interface SyncState {
  status: SyncStatus
  lastSync?: string
  pending: number
  message?: string
  conflict?: { local: Counts; server: Counts }
  set: (patch: Partial<Omit<SyncState, 'set'>>) => void
}

export const useSync = create<SyncState>()((set) => ({
  status: 'connecting',
  pending: 0,
  set: (patch) => set(patch),
}))
