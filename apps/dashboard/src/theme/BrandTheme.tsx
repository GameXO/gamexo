import { useEffect } from 'react'
import { useBusinessSettings } from '../api/hooks'
import { applyBrand } from './brand'

/**
 * Applies the academy's saved brand colours to the dashboard. Renders nothing.
 *
 * Mounted once, inside the signed-in shell. It reads the same cached settings the
 * Settings page edits, so saving a new colour there recolours the app immediately
 * with no reload. A failed read (a role that cannot see settings) is simply the
 * stock look.
 */
export default function BrandTheme() {
  const { data } = useBusinessSettings()
  const primary = data?.brand_primary
  const accent = data?.brand_accent
  const background = data?.brand_background

  useEffect(() => {
    if (!primary || !accent || !background) return
    applyBrand({ primary, accent, background })
    return () => applyBrand(null)
  }, [primary, accent, background])

  return null
}
