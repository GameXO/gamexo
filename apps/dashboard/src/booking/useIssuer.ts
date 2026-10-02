import { useMemo } from 'react'
import { useAllCourts, useBranches, useBusinessSettings } from '../api/hooks'
import { issuerFrom, type Issuer } from './invoice'

/**
 * Who a booking's invoice is from, for the court the draft is on.
 *
 * Joined from the court's branch and the academy's own settings, both of which the
 * dashboard already holds in cache. Null until they have loaded — callers pass it
 * straight to `buildInvoice`, which prints a blank header for a moment rather than a
 * wrong one.
 */
export function useIssuer(courtId: string | null | undefined): Issuer | null {
  const { data: settings } = useBusinessSettings()
  const { data: branches } = useBranches(true)
  const { data: courts } = useAllCourts()

  return useMemo(() => {
    if (!settings) return null
    const branchId = courts?.find((c) => c.id === courtId)?.branchId
    const branch =
      branches?.find((b) => b.id === branchId) ?? branches?.find((b) => b.is_default) ?? null
    return issuerFrom(
      {
        name: settings.business_name,
        phone: settings.phone,
        address: settings.address,
        city: settings.city,
        gstin: settings.gst_number,
      },
      branch,
    )
  }, [settings, branches, courts, courtId])
}
