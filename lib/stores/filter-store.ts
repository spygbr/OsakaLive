import { create } from 'zustand'

export type FilterValues = {
  area: string
  genre: string
  price: string
  dateFrom: string
  dateTo: string
}

type FilterStore = {
  pending: FilterValues
  setPending: (updates: Partial<FilterValues>) => void
  syncPending: (values: FilterValues) => void
  resetPending: () => void
}

const empty: FilterValues = {
  area: '',
  genre: '',
  price: '',
  dateFrom: '',
  dateTo: '',
}

export const useFilterStore = create<FilterStore>((set) => ({
  pending: empty,
  setPending: (updates) =>
    set((s) => ({ pending: { ...s.pending, ...updates } })),
  syncPending: (values) => set({ pending: values }),
  resetPending: () => set({ pending: empty }),
}))
