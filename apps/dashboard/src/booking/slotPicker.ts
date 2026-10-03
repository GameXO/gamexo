/**
 * How hours are picked, shared by both booking views.
 *
 * A person may book at most six hours in all. They choose a *slot length* — 1, 2 or 3
 * hours — and then pick that many slots back to back, so the length decides how many
 * clicks it takes to reach the limit:
 *
 *   1 hr slots → up to 6 in a row     2 hr slots → up to 3     3 hr slots → up to 2
 *
 * The result is always one unbroken stretch of hours, which is what a booking is. The
 * server enforces the same six-hour ceiling (`MAX_BOOKING_MINUTES`), so this is the
 * friendly version of a rule that holds regardless.
 */
import { MAX_BOOKING_HOURS, type Draft } from '../data/booking'
import type { HourSlot } from '../api/hooks'

export const SLOT_UNITS = [1, 2, 3] as const

/** How many slots of this length fit inside the six-hour limit. */
export const maxUnitsFor = (unit: number) => Math.max(1, Math.floor(MAX_BOOKING_HOURS / unit))

const stateAt = (slots: HourSlot[], hour: number) => slots.find((s) => s.hour === hour)?.state

/** Is every hour of a slot of this length, starting here, free? */
export function blockOpen(slots: HourSlot[], start: number, unit: number) {
  for (let h = start; h < start + unit; h++) if (stateAt(slots, h) !== 'open') return false
  return true
}

export type Selection = { start: number | null; hours: number }

/**
 * What the selection becomes when a slot is clicked.
 *
 *  - the slot just after the selection, or just before it, extends it (up to the limit);
 *  - an end slot of the selection, clicked again, is dropped from it;
 *  - anything else starts a fresh selection there — if it is free for the full length.
 */
export function pickBlock(slots: HourSlot[], sel: Selection, clicked: number, unit: number): Selection {
  const max = maxUnitsFor(unit)
  const units = sel.start != null && sel.hours % unit === 0 ? sel.hours / unit : 0

  if (sel.start != null && units > 0) {
    const start = sel.start
    const end = start + sel.hours
    if (clicked === end && units < max && blockOpen(slots, clicked, unit)) {
      return { start, hours: sel.hours + unit }
    }
    if (clicked === start - unit && units < max && blockOpen(slots, clicked, unit)) {
      return { start: clicked, hours: sel.hours + unit }
    }
    if (clicked === start) {
      return units === 1 ? { start: null, hours: unit } : { start: start + unit, hours: sel.hours - unit }
    }
    if (clicked === end - unit) return { start, hours: sel.hours - unit }
  }

  return blockOpen(slots, clicked, unit) ? { start: clicked, hours: unit } : { start: null, hours: unit }
}

/** Everything a slot grid needs to draw and drive the selection. */
export function useSlotPicker(draft: Draft, setDraft: (patch: Partial<Draft>) => void, slots: HourSlot[]) {
  const unit = draft.slotUnit || 1

  // Changing the length keeps the start only if a slot of the new length is free there.
  const setUnit = (next: number) => {
    const keep = draft.startHour != null && blockOpen(slots, draft.startHour, next)
    setDraft({ slotUnit: next, startHour: keep ? draft.startHour : null, hours: next })
  }

  const pick = (hour: number) => {
    const next = pickBlock(slots, { start: draft.startHour, hours: draft.hours }, hour, unit)
    setDraft({ startHour: next.start, hours: next.hours })
  }

  const isCovered = (hour: number) =>
    draft.startHour != null && hour >= draft.startHour && hour < draft.startHour + draft.hours
  /** The first hour of one of the chosen slots (as opposed to an hour inside a longer one). */
  const isStart = (hour: number) => isCovered(hour) && (hour - draft.startHour!) % unit === 0
  const fits = (hour: number) => blockOpen(slots, hour, unit)

  return {
    unit,
    setUnit,
    pick,
    isCovered,
    isStart,
    fits,
    maxUnits: maxUnitsFor(unit),
    chosen: draft.startHour != null ? Math.round(draft.hours / unit) : 0,
  }
}
