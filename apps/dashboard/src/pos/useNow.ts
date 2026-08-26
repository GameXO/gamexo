import { useEffect, useState } from 'react'

/** Ticks every `intervalMs` so derived-state screens re-evaluate against the clock without a refresh. */
export function useNow(intervalMs = 15000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
