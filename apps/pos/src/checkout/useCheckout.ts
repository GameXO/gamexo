import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import QRCode from 'qrcode'
import { api, ApiError } from '../api/client'
import type { components } from '../api/schema'

export type CheckoutBooking = components['schemas']['BookingDetail']

/** Finds the session to settle by booking id. Unlike check-in's lookup, this has no
 *  upper time bound — a session running long is exactly the case checkout still has
 *  to find — which is why it's a separate backend endpoint from check-in's. */
export function useActiveSessionByCode(code: string | null) {
  return useQuery({
    queryKey: ['checkout-active-session', code],
    queryFn: async () => {
      try {
        return await api.checkoutLookup(code!.trim())
      } catch (err) {
        if (err instanceof ApiError && err.isNotFound) return null
        throw err
      }
    },
    enabled: !!code,
    retry: false,
    staleTime: 0,
  })
}

/** How far past the booked slot "now" is — 0 if the session hasn't run over yet. */
export function extraMinutes(booking: CheckoutBooking) {
  const expectedEnd = new Date(booking.starts_at).getTime() + booking.duration_min * 60_000
  const overMs = Date.now() - expectedEnd
  return overMs > 60_000 ? Math.round(overMs / 60_000) : 0
}

export function durationLabel(minutes: number) {
  const hrs = minutes / 60
  return Number.isInteger(hrs) ? `${hrs} hr` : `${Math.floor(hrs)}h ${minutes % 60}m`
}

/** Renders a `upi://pay` deep link as a scannable QR — generated client-side (no backend
 *  round trip, no third-party QR image service seeing the payment reference). */
export function useUpiQrCode(vpa: string, amount: number, payeeName: string, note: string) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!vpa) {
      setDataUrl(null)
      return
    }
    let cancelled = false
    const uri = `upi://pay?pa=${encodeURIComponent(vpa)}&pn=${encodeURIComponent(payeeName)}&am=${amount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(note)}`
    QRCode.toDataURL(uri, { margin: 1, width: 480, color: { dark: '#1a1a1a', light: '#ffffff' } }).then((url) => {
      if (!cancelled) setDataUrl(url)
    })
    return () => {
      cancelled = true
    }
  }, [vpa, amount, payeeName, note])

  return dataUrl
}
