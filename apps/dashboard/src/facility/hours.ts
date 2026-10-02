/**
 * Court opening hours as the API stores them: `{ open: "06:00", close: "22:00" }`.
 *
 * The API reads these with a plain `HH:MM` parse, so the choices offered here are
 * exactly the ones it understands. There is no "24:00" — it would fail to parse and
 * quietly fall back to the default — midnight is `00:00`, and a closing time at or
 * before the opening time means the court closes after midnight.
 */

export const DEFAULT_HOURS = { open: '06:00', close: '22:00' }

/** Every half hour of the day, in the API's own format. */
export const HOUR_OPTIONS: string[] = Array.from({ length: 48 }, (_, i) => {
  const h = String(Math.floor(i / 2)).padStart(2, '0')
  return `${h}:${i % 2 ? '30' : '00'}`
})

/** "06:00" -> "6:00 AM", "00:00" -> "12:00 AM". */
export function timeLabel(value: string): string {
  const [h, m = '00'] = value.split(':')
  const hour = Number(h)
  if (Number.isNaN(hour)) return value
  const suffix = hour % 24 < 12 ? 'AM' : 'PM'
  const display = hour % 12 === 0 ? 12 : hour % 12
  return `${display}:${m.padStart(2, '0')} ${suffix}`
}

export function hoursLabel(hours: { open?: string; close?: string } | null | undefined): string {
  const h = { ...DEFAULT_HOURS, ...(hours ?? {}) }
  return `${timeLabel(h.open)} – ${timeLabel(h.close)}`
}

/** Closing at or before opening means it runs past midnight. */
export const closesNextDay = (open: string, close: string) => close <= open
