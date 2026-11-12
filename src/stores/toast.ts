import { create } from 'zustand'

export type ToastKind = 'success' | 'error' | 'info' | 'warn'

export interface ToastItem {
  id: number
  kind: ToastKind
  title: string
  description?: string
}

interface ToastState {
  items: ToastItem[]
  push: (toast: Omit<ToastItem, 'id'>) => void
  dismiss: (id: number) => void
}

let seq = 0

export const useToastStore = create<ToastState>((set, get) => ({
  items: [],
  push: (toast) => {
    const id = ++seq
    set({ items: [...get().items, { ...toast, id }].slice(-4) })
    window.setTimeout(() => {
      set({ items: get().items.filter((item) => item.id !== id) })
    }, 4200)
  },
  dismiss: (id) => set({ items: get().items.filter((item) => item.id !== id) }),
}))

export const toast = {
  success: (title: string, description?: string) =>
    useToastStore.getState().push({ kind: 'success', title, description }),
  error: (title: string, description?: string) =>
    useToastStore.getState().push({ kind: 'error', title, description }),
  info: (title: string, description?: string) =>
    useToastStore.getState().push({ kind: 'info', title, description }),
  warn: (title: string, description?: string) =>
    useToastStore.getState().push({ kind: 'warn', title, description }),
}
