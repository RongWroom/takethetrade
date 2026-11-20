import { useCallback, useEffect, useState } from 'react'
import {
  createJournalEntry,
  type JournalEntry,
  type PageDataSnapshot,
  type TradeOutcome,
} from '../domain/tradeJournal'

export const JOURNAL_STORAGE_KEY = 'ttt.journal.v1'
const MAX_JOURNAL_ENTRIES = 100

function isValidOutcome(val: unknown): val is TradeOutcome {
  return val === 'open' || val === 'win' || val === 'loss' || val === 'breakeven' || val === 'no-trade'
}

function loadEntries(): JournalEntry[] {
  try {
    const raw = localStorage.getItem(JOURNAL_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is JournalEntry => {
      if (!item || typeof item !== 'object') return false
      const r = item as Record<string, unknown>
      return (
        typeof r.id === 'string' &&
        typeof r.createdAtMs === 'number' &&
        typeof r.createdAtIso === 'string' &&
        isValidOutcome(r.outcome) &&
        typeof r.exitPrice === 'string' &&
        typeof r.notes === 'string' &&
        typeof r.snapshot === 'object' &&
        r.snapshot !== null
      )
    })
  } catch {
    return []
  }
}

export type UseTradeJournalReturn = {
  entries: JournalEntry[]
  logSnapshot: (
    snapshot: PageDataSnapshot,
    options?: { outcome?: TradeOutcome; exitPrice?: string; notes?: string },
  ) => JournalEntry
  updateEntry: (
    id: string,
    patch: Partial<Pick<JournalEntry, 'outcome' | 'exitPrice' | 'notes' | 'processGrade'>>,
  ) => void
  deleteEntry: (id: string) => void
  clearJournal: () => void
}

export function useTradeJournal(): UseTradeJournalReturn {
  const [entries, setEntries] = useState<JournalEntry[]>(loadEntries)

  useEffect(() => {
    try {
      localStorage.setItem(JOURNAL_STORAGE_KEY, JSON.stringify(entries))
    } catch {
      // Storage unavailable or quota exceeded; journal still works for this session.
    }
  }, [entries])

  const logSnapshot = useCallback(
    (
      snapshot: PageDataSnapshot,
      options?: { outcome?: TradeOutcome; exitPrice?: string; notes?: string },
    ): JournalEntry => {
      const entry = createJournalEntry(snapshot, options)
      setEntries(prev => [entry, ...prev].slice(0, MAX_JOURNAL_ENTRIES))
      return entry
    },
    [],
  )

  const updateEntry = useCallback(
    (id: string, patch: Partial<Pick<JournalEntry, 'outcome' | 'exitPrice' | 'notes' | 'processGrade'>>) => {
      setEntries(prev => prev.map(item => (item.id === id ? { ...item, ...patch } : item)))
    },
    [],
  )

  const deleteEntry = useCallback((id: string) => {
    setEntries(prev => prev.filter(item => item.id !== id))
  }, [])

  const clearJournal = useCallback(() => {
    setEntries([])
  }, [])

  return {
    entries,
    logSnapshot,
    updateEntry,
    deleteEntry,
    clearJournal,
  }
}
