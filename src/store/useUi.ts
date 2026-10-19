import { create } from 'zustand'
import type { CalendarEvent } from '@/domain/types'

/** Transient UI state (never persisted). */
interface UiState {
  captureOpen: boolean
  taskId: string | null
  event: { id: string | null; draft?: Partial<CalendarEvent> } | null
  openCapture: () => void
  closeCapture: () => void
  openTask: (id: string) => void
  closeTask: () => void
  openEvent: (id: string | null, draft?: Partial<CalendarEvent>) => void
  closeEvent: () => void
  closeAll: () => void
}

export const useUi = create<UiState>()((set) => ({
  captureOpen: false,
  taskId: null,
  event: null,
  openCapture: () => set({ captureOpen: true }),
  closeCapture: () => set({ captureOpen: false }),
  openTask: (id) => set({ taskId: id }),
  closeTask: () => set({ taskId: null }),
  openEvent: (id, draft) => set({ event: { id, draft } }),
  closeEvent: () => set({ event: null }),
  closeAll: () => set({ captureOpen: false, taskId: null, event: null }),
}))
