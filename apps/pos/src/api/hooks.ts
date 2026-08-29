/**
 * Query hooks + the mapping layer between API shapes and the shapes the POS
 * screens render. Mirrors apps/web/src/api/hooks.ts — same backend, same
 * mapping conventions — trimmed to what a walk-in counter actually needs
 * (no reports, staff, academy, etc).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type { components } from './schema'

import football from '../assets/figma/sports/football.png'
import cricket from '../assets/figma/sports/cricket.png'
import tennis from '../assets/figma/sports/tennis.png'
import badminton from '../assets/figma/sports/badminton.png'
import pickleball from '../assets/figma/sports/pickleball.png'
import tableTennis from '../assets/figma/sports/table-tennis.png'

type SportOut = components['schemas']['SportOut']
type CourtWithStatus = components['schemas']['CourtWithStatus']
type EquipmentOut = components['schemas']['EquipmentOut']
type BookingOut = components['schemas']['BookingOut']
export type BookingDetail = components['schemas']['BookingDetail']
export type QuoteOut = components['schemas']['QuoteOut']
export type InvoiceOut = components['schemas']['InvoiceOut']
export type Slot = components['schemas']['Slot']

/** The API has no sport imagery — it carries `icon`/`color`, while the UI is built
 *  around these photographs. Matched on slug, so a sport the backend adds that we
 *  have no art for still renders (without a photo) rather than breaking the grid. */
const SPORT_IMAGES: Record<string, string> = {
  football,
  cricket,
  tennis,
  badminton,
  pickleball,
  'table-tennis': tableTennis,
  tabletennis: tableTennis,
}

/** Money crosses the wire as a decimal string; JS renders a number. */
export const num = (v: string | number | null | undefined) => Number(v ?? 0)

export type Sport = {
  id: string
  name: string
  slug: string
  fieldsLabel: string
  from: number
  image: string
}

export type Court = {
  id: string
  sportId: string
  sportName: string
  name: string
  code: string
  price: number
  peakPrice: number
  amenities: string[]
  hours: string
  bookable: boolean
  status: string
}

export type EquipmentItem = {
  id: string
  name: string
  category: string
  /** The rental rate, charged per hour of play. */
  price: number
  salePrice: number
  forRent: boolean
  forSale: boolean
  /** Base units in one pack; 1 means this is not sold in packs. */
  packSize: number
  packPrice: number
  deposit: number
  stock: number
  sportId: string | null
  imageUrl: string | null
  consumable: boolean
}

export function toSport(s: SportOut, courtCount?: number): Sport {
  return {
    id: s.id,
    name: s.name,
    slug: s.slug,
    fieldsLabel: courtCount === undefined ? '' : `${courtCount} ${courtCount === 1 ? 'Court' : 'Courts'}`,
    from: num(s.price_base),
    image: SPORT_IMAGES[s.slug] ?? '',
  }
}

export function toCourt(c: CourtWithStatus): Court {
  const hours = c.operating_hours ?? { open: '06:00', close: '22:00' }
  return {
    id: c.id,
    sportId: c.sport_id,
    sportName: c.sport_name ?? '',
    name: c.name,
    code: c.code,
    price: num(c.hourly_rate),
    peakPrice: num(c.peak_rate),
    amenities: c.amenities ?? [],
    hours: `${hours.open} – ${hours.close}`,
    bookable: c.is_bookable ?? true,
    status: c.status,
  }
}

export function toEquipmentItem(e: EquipmentOut): EquipmentItem {
  return {
    id: e.id,
    name: e.name,
    category: e.category,
    price: num(e.rental_price),
    salePrice: num(e.sale_price),
    forRent: e.for_rent ?? true,
    forSale: e.for_sale ?? false,
    packSize: e.pack_size ?? 1,
    packPrice: num(e.pack_price),
    deposit: num(e.deposit),
    stock: e.qty_available,
    sportId: e.sport_id ?? null,
    imageUrl: e.image_url ?? null,
    consumable: e.consumable ?? true,
  }
}

export const queryKeys = {
  sports: ['sports'] as const,
  courts: (sportId?: string) => ['courts', sportId ?? 'all'] as const,
  availability: (courtId: string, date: string, durationMin: number) =>
    ['availability', courtId, date, durationMin] as const,
  equipment: ['equipment'] as const,
  bookingSearch: (query: string) => ['bookingSearch', query] as const,
  publicSettings: ['publicSettings'] as const,
}

/**
 * Which services this academy offers at the counter.
 *
 * Read from `/settings/public` rather than `/settings`, which the kiosk role cannot
 * reach. An academy that has never touched the switches has every key defaulted to
 * true server-side, and an unknown key reads as enabled — a tile should never vanish
 * because a setting has not been written yet.
 *
 * `staleTime` is deliberately short: a tablet is left running for a whole shift, and
 * an admin who switches a service off expects the counter to follow within minutes
 * rather than at the next reboot.
 */
export function usePosServices() {
  const query = useQuery({
    queryKey: queryKeys.publicSettings,
    queryFn: () => api.publicSettings(),
    staleTime: 60_000,
  })
  const services = query.data?.enabled_services as Record<string, unknown> | undefined
  return {
    /** Defaults to true, including while the request is still in flight — the
     *  counter shows its full set and removes a tile if the answer says so, rather
     *  than flashing an empty home screen on every load. */
    isEnabled: (key: string) => services?.[key] !== false,
    isLoading: query.isLoading,
  }
}

/** Sports, with each one's court count folded in for the "N Courts" label. */
export function useSports() {
  const courts = useQuery({ queryKey: queryKeys.courts(), queryFn: () => api.listCourts() })

  return useQuery({
    queryKey: [...queryKeys.sports, courts.data?.length ?? 0],
    queryFn: async () => {
      const sports = await api.listSports()
      const counts = new Map<string, number>()
      for (const c of courts.data ?? []) counts.set(c.sport_id, (counts.get(c.sport_id) ?? 0) + 1)
      return sports.map((s) => toSport(s, counts.get(s.id) ?? 0))
    },
    enabled: !courts.isLoading,
  })
}

export function useCourts(sportId?: string) {
  return useQuery({
    queryKey: queryKeys.courts(sportId),
    queryFn: async () => (await api.listCourts(sportId ? { sport_id: sportId } : undefined)).map(toCourt),
  })
}

/** Real per-hour availability for one court on one day — replaces guesswork with the
 *  same exclusion-constraint-backed data the backend uses to accept or reject a booking. */
export function useCourtAvailability(courtId: string | undefined, date: string, durationMin = 60) {
  return useQuery({
    queryKey: queryKeys.availability(courtId ?? '', date, durationMin),
    queryFn: async () => {
      const rows = await api.courtAvailability({ date, court_id: courtId, duration_min: durationMin, slot_minutes: 60 })
      return rows[0]?.slots ?? []
    },
    enabled: !!courtId,
  })
}

/** Only what the back office has explicitly published — an item can exist and be
 *  tracked in Inventory for a while before anyone decides to sell it at the counter. */
export function useEquipment() {
  return useQuery({
    queryKey: queryKeys.equipment,
    queryFn: async () =>
      (await api.listEquipment({ size: 200, published_to_pos: true })).items.map(toEquipmentItem),
  })
}

/** Today's open bookings matching a name/phone/court search — backs "attach kit to a game in play". */
export function useBookingSearch(query: string) {
  return useQuery({
    queryKey: queryKeys.bookingSearch(query),
    queryFn: async () => {
      const res = await api.listBookings({ search: query || undefined, size: 8 })
      return (res.items ?? []).filter((b) => b.status !== 'completed' && b.status !== 'cancelled')
    },
  })
}

export type QuoteVars = {
  courtId: string
  startsAt: string
  durationMin: number
  equipment: { equipment_id: string; qty: number; mode?: 'rent' | 'buy'; unit?: 'single' | 'pack' }[]
}

/** Server-priced total for the current draft — peak/weekend rates and GST live where the
 *  booking-creation call will apply them, so the summary the counter sees never drifts
 *  from the amount actually charged. */
export function useQuote(vars: QuoteVars | null) {
  return useQuery({
    queryKey: [
      'quote',
      vars?.courtId,
      vars?.startsAt,
      vars?.durationMin,
      JSON.stringify(vars?.equipment ?? []),
    ],
    queryFn: () =>
      api.quoteBooking({
        court_id: vars!.courtId,
        starts_at: vars!.startsAt,
        duration_min: vars!.durationMin,
        equipment: vars!.equipment,
      }),
    enabled: !!vars,
  })
}

export function useCreateBooking() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: {
      courtId: string
      startsAt: string
      durationMin: number
      customerName: string
      customerPhone: string
      notes?: string
      equipment: { equipment_id: string; qty: number; mode?: 'rent' | 'buy'; unit?: 'single' | 'pack' }[]
    }) =>
      api.createBooking({
        court_id: vars.courtId,
        starts_at: vars.startsAt,
        duration_min: vars.durationMin,
        customer_name: vars.customerName,
        customer_phone: vars.customerPhone,
        notes: vars.notes,
        equipment: vars.equipment,
        booking_type: 'walkin',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bookings'] })
      qc.invalidateQueries({ queryKey: queryKeys.equipment })
    },
  })
}

/** Adds kit to a booking already on the floor — re-prices server-side. */
export function useAddEquipmentToBooking() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { bookingId: string; equipment: { equipment_id: string; qty: number; mode?: 'rent' | 'buy'; unit?: 'single' | 'pack' }[] }) =>
      api.setBookingEquipment(vars.bookingId, vars.equipment),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bookings'] })
      qc.invalidateQueries({ queryKey: queryKeys.equipment })
    },
  })
}

export function useRecordPayment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { bookingId: string; amount: number; method: 'cash' | 'upi' | 'card' | 'bank' | 'cheque' }) =>
      api.recordPayment({ booking_id: vars.bookingId, amount: vars.amount, method: vars.method }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bookings'] }),
  })
}

export function useInvoiceBooking() {
  return useMutation({ mutationFn: (bookingId: string) => api.invoiceBooking(bookingId) })
}

/** Email the invoice from the server. Resolves only once it has actually gone. */
export function useEmailInvoice() {
  return useMutation({
    mutationFn: (vars: { bookingId: string; to?: string }) =>
      api.emailBookingInvoice(vars.bookingId, vars.to),
  })
}

export type { BookingOut }
