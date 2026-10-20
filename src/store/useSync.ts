import { create } from 'zustand'

/**
 * Status of the connection to the local server.
 *  connecting – first handshake in progress
 *  online     – server is the source of truth, changes are sent as they happen
 *  offline    – server was reachable before and is not now; changes queue up
 *  local      – server never reached this session; data lives in this browser only
 */
export type SyncStatus = 'connecting' | 'online' | 'offline' | 'local'

interface SyncState {
  status: SyncStatus
  lastSync?: string
  pending: number
  message?: string
  set: (patch: Partial<Omit<SyncState, 'set'>>) => void
}

export const useSync = create<SyncState>()((set) => ({
  status: 'connecting',
  pending: 0,
  set: (patch) => set(patch),
}))
