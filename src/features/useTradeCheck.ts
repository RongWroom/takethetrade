import { useEffect, useMemo, useState } from 'react'
import { evaluateTradeCheck, type MarketSnapshot, type TradeIntent, type TradeSide } from '../domain/tradeCheck'

const STORAGE_KEY = 'ttt.myTrade.v1'

export type DraftIntent = { side: TradeSide | null; entry: string; stop: string; leverage: string }

export const emptyDraft: DraftIntent = { side: null, entry: '', stop: '', leverage: '' }

function loadDraft(): DraftIntent {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyDraft
    const parsed = JSON.parse(raw) as Partial<DraftIntent>
    return {
      side: parsed.side === 'long' || parsed.side === 'short' ? parsed.side : null,
      entry: typeof parsed.entry === 'string' ? parsed.entry : '',
      stop: typeof parsed.stop === 'string' ? parsed.stop : '',
      leverage: typeof parsed.leverage === 'string' ? parsed.leverage : '',
    }
  } catch {
    return emptyDraft
  }
}

/** Parses user input such as "71,250.5" or "10x"; blank → undefined, garbage → NaN (flagged by validation). */
function parseNumber(value: string): number | undefined {
  const cleaned = value.replace(/[,\s$x×]/gi, '')
  if (cleaned === '') return undefined
  return Number(cleaned)
}

export function toIntent(draft: DraftIntent): TradeIntent | null {
  if (!draft.side) return null
  return {
    side: draft.side,
    entry: parseNumber(draft.entry),
    stop: parseNumber(draft.stop),
    leverage: parseNumber(draft.leverage),
  }
}

/** Holds the user's described trade (kept only in this browser) and evaluates it against the live snapshot. */
export function useTradeCheck(snapshot: MarketSnapshot) {
  const [draft, setDraft] = useState<DraftIntent>(loadDraft)
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(draft))
    } catch {
      // Storage unavailable (private mode); the check still works for this session.
    }
  }, [draft])
  const intent = useMemo(() => toIntent(draft), [draft])
  const result = useMemo(() => (intent ? evaluateTradeCheck(intent, snapshot) : null), [intent, snapshot])
  return { draft, setDraft, result }
}
