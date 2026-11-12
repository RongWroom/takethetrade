import { useEffect, useState } from 'react'
import type { ConfirmationMode } from '../domain/signalConfirmation'

const STORAGE_KEY = 'ttt.confirmation.v1'

function loadMode(): ConfirmationMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return '5m'
    const parsed = JSON.parse(raw) as { mode?: unknown } | null
    return parsed?.mode === '15m' ? '15m' : '5m'
  } catch {
    return '5m'
  }
}

export function useConfirmationPreference() {
  const [mode, setMode] = useState<ConfirmationMode>(loadMode)
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode }))
    } catch {
      return
    }
  }, [mode])
  return { mode, setMode }
}
