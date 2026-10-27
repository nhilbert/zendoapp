import { create } from 'zustand'
import type { CalendarEvent } from '@/domain/types'

/** Transient UI state (never persisted). */
interface UiState {
  captureOpen: boolean
  taskId: string | null
  event: { id: string | null; draft?: Partial<CalendarEvent> } | null
  /** the list of changes a sync merge replaced (ReplacedDialog) */
  replacedOpen: boolean
  openCapture: () => void
  closeCapture: () => void
  openTask: (id: string) => void
  closeTask: () => void
  openEvent: (id: string | null, draft?: Partial<CalendarEvent>) => void
  closeEvent: () => void
  openReplaced: () => void
  closeReplaced: () => void
  closeAll: () => void
}

export const useUi = create<UiState>()((set) => ({
  captureOpen: false,
  taskId: null,
  event: null,
  replacedOpen: false,
  openCapture: () => set({ captureOpen: true }),
  closeCapture: () => set({ captureOpen: false }),
  openTask: (id) => set({ taskId: id }),
  closeTask: () => set({ taskId: null }),
  openEvent: (id, draft) => set({ event: { id, draft } }),
  closeEvent: () => set({ event: null }),
  openReplaced: () => set({ replacedOpen: true }),
  closeReplaced: () => set({ replacedOpen: false }),
  closeAll: () => set({ captureOpen: false, taskId: null, event: null, replacedOpen: false }),
}))
