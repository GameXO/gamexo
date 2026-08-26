import { useEffect } from 'react'
import { useCourts, useSports } from '../api/hooks'
import { setCourtCatalog, setSportCatalog } from '../data/booking'
import { notifyChanged } from '../lib/db'

/** Renders nothing — the sports/courts counterpart of `PublishedEquipmentBridge`.
 *  Points the shared catalogue in `data/booking.ts` at what the API actually has,
 *  in place, so every existing reader (`courtById`, `sportById`, `courtsForSport`,
 *  `priceDraft`, the invoice builder) resolves the UUIDs the wizard now works in
 *  without a single call site changing. Mount once near the root. */
export default function SportCourtBridge() {
  const sportsQuery = useSports()
  const courtsQuery = useCourts()

  useEffect(() => {
    if (!sportsQuery.data) return
    setSportCatalog(sportsQuery.data)
    notifyChanged()
  }, [sportsQuery.data])

  useEffect(() => {
    if (!courtsQuery.data) return
    setCourtCatalog(courtsQuery.data)
    notifyChanged()
  }, [courtsQuery.data])

  return null
}
