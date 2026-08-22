/**
 * This turf's identity, in the shape an invoice wants.
 *
 * A hook rather than a constant because it is per-tenant now: the same build
 * serves every turf, and each one's invoices must carry its own name and GSTIN.
 */
import { useSettings } from '../api/hooks'
import { facilityFromSettings, type FacilityProfile } from './facilityData'

export function useFacilityProfile(): FacilityProfile {
  const { data } = useSettings()
  return facilityFromSettings(data ?? undefined)
}
