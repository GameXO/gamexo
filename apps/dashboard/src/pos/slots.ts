export type PlayState = 'live' | 'upcoming' | 'done'

export function playState(startMs: number, endMs: number, cancelled: boolean, nowMs: number): PlayState {
  if (cancelled) return 'done'
  if (nowMs < startMs) return 'upcoming'
  if (nowMs < endMs) return 'live'
  return 'done'
}

export const minutesBetween = (fromMs: number, toMs: number) => Math.max(0, Math.round((toMs - fromMs) / 60000))

export function countdown(mins: number) {
  if (mins <= 0) return 'Ending now'
  if (mins < 60) return `${mins}m left`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m === 0 ? `${h}h left` : `${h}h ${m}m left`
}

export const formatClock = (ms: number) =>
  new Date(ms).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true })
