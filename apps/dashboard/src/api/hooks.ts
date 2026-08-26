/**
 * Query hooks + the mapping layer between API shapes and the shapes the existing
 * screens already render.
 *
 * The mapping lives here on purpose. Screens keep consuming `Sport`/`Court` as
 * they always have, so wiring one up is a swap of the data source rather than a
 * rewrite of its JSX — and this file is the only place that knows the API uses
 * UUIDs, decimal strings and no sport imagery.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type { components } from './schema'
import {
  addOnKey,
  parseAddOnKey,
  toISO,
  type Booking,
  type Court,
  type Draft,
  type Sport,
} from '../data/booking'

import football from '../assets/figma/sports/football.png'
import cricket from '../assets/figma/sports/cricket.png'
import tennis from '../assets/figma/sports/tennis.png'
import badminton from '../assets/figma/sports/badminton.png'
import pickleball from '../assets/figma/sports/pickleball.png'
import tableTennis from '../assets/figma/sports/table-tennis.png'

type SportOut = components['schemas']['SportOut']
type CourtWithStatus = components['schemas']['CourtWithStatus']
type BookingOut = components['schemas']['BookingOut']
type EquipmentOut = components['schemas']['EquipmentOut']
/** What `POST /bookings/quote` returns — the server's price for a draft. */
export type BookingQuote = components['schemas']['QuoteOut']
export type MovementOut = components['schemas']['MovementOut']
export type MovementKind = MovementOut['kind']

/**
 * The API has no sport imagery — it carries `icon`/`color`, while the UI is built
 * around these photographs. Matched on slug, so a sport the backend adds that we
 * have no art for still renders (without a photo) rather than breaking the grid.
 */
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
const money = (v: string | number | null | undefined) => Number(v ?? 0)

export function toSport(s: SportOut, courtCount?: number): Sport {
  return {
    id: s.id,
    name: s.name,
    fieldsLabel: courtCount === undefined ? '' : `${courtCount} ${courtCount === 1 ? 'Court' : 'Courts'}`,
    from: money(s.price_base),
    image: SPORT_IMAGES[s.slug] ?? '',
  }
}

export function toCourt(c: CourtWithStatus): Court {
  const hours = c.operating_hours ?? { open: '06:00', close: '22:00' }
  return {
    id: c.id,
    sportId: c.sport_id,
    name: c.name,
    price: money(c.hourly_rate),
    surface: c.sport_name ?? '',
    // Ratings are presentational in the mock data and have no API equivalent yet.
    rating: 0,
    reviews: 0,
    capacity: 0,
    amenities: c.amenities ?? [],
    hours: `${hours.open} – ${hours.close}`,
  }
}

/**
 * The two status vocabularies do not line up: the API tracks a booking's lifecycle
 * (`upcoming`/`active`/`overdue`), the UI tracks what the counter staff see
 * (`confirmed`/`checked-in`). `overdue` has no UI equivalent and reads as still
 * playing, so it maps to checked-in rather than being dropped.
 */
const BOOKING_STATUS: Record<string, Booking['status']> = {
  upcoming: 'confirmed',
  active: 'checked-in',
  overdue: 'checked-in',
  completed: 'completed',
  cancelled: 'completed',
}

/**
 * The write direction, kept next to its inverse above so the pair stays visibly
 * paired. Not derivable from `BOOKING_STATUS`: that map is lossy on purpose —
 * three API states collapse into `checked-in`/`completed`, and checking someone in
 * must produce `active`, never `overdue`.
 */
export const API_BOOKING_STATUS = {
  'checked-in': 'active',
  completed: 'completed',
  confirmed: 'upcoming',
} as const satisfies Record<Booking['status'], string>

export function toBooking(b: BookingOut): Booking {
  const starts = new Date(b.starts_at)
  // Local date parts, not toISOString() — that would shift an evening booking in
  // IST back to the previous day and file it under the wrong date.
  const date = `${starts.getFullYear()}-${String(starts.getMonth() + 1).padStart(2, '0')}-${String(
    starts.getDate(),
  ).padStart(2, '0')}`

  // Keyed by the offer that was taken — id plus rent/buy plus single/pack — so a
  // rented racket and a bought one stay two lines when this booking is edited.
  // Bookings written before `equipment_id` was recorded fall back to the name,
  // which still renders; it just cannot be resolved back to a catalogue row.
  const equipment: Record<string, number> = {}
  for (const line of b.equipment ?? []) {
    const key = line.equipment_id
      ? addOnKey(line.equipment_id, line.mode ?? 'rent', line.unit ?? 'single')
      : line.name
    equipment[key] = (equipment[key] ?? 0) + line.qty
  }

  return {
    id: b.id,
    reference: b.reference,
    sportId: b.sport_id,
    courtId: b.court_id,
    date,
    startHour: starts.getHours(),
    hours: (b.duration_min ?? 60) / 60,
    customer: {
      name: b.customer_name ?? '',
      phone: b.customer_phone ?? '',
      email: '',
      players: '',
      notes: b.notes ?? '',
    },
    equipment,
    slotTotal: money(b.court_charge),
    equipmentTotal: money(b.equipment_charge),
    subtotal: money(b.court_charge) + money(b.equipment_charge) - money(b.discount),
    gst: money(b.taxes),
    total: money(b.total),
    paidTotal: money(b.amount_paid),
    payment: b.payment_method ? { method: b.payment_method, status: b.payment_status ?? 'due' } : null,
    status: BOOKING_STATUS[b.status ?? 'upcoming'] ?? 'confirmed',
    source: b.booking_type === 'online' ? 'app' : 'counter',
    createdAt: b.created_at,
  }
}

/** Back-office Inventory — distinct from `Equipment` in data/booking.ts, which is
 *  the static mock catalogue the (still localStorage-backed) booking flow and its
 *  own Add-ons screen read from. This is the real, API-backed model that the
 *  Inventory page and the standalone POS app both read and write. */
export type InventoryItem = {
  id: string
  name: string
  category: string
  barcode: string
  /** The rental rate. Kept as `price` because every existing screen reads it. */
  price: number
  salePrice: number
  forRent: boolean
  forSale: boolean
  /** Base units in one pack. 1 means the item is not sold in packs. */
  packSize: number
  packPrice: number
  deposit: number
  condition: 'excellent' | 'good' | 'fair' | 'poor'
  lowStockThreshold: number
  sportId: string | null
  publishedToPos: boolean
  imageUrl: string | null
  consumable: boolean
  qtyStock: number
  qtyAvailable: number
  qtyIssued: number
  qtyMaintenance: number
  qtyLost: number
  isLowStock: boolean
}

export function toInventoryItem(e: EquipmentOut): InventoryItem {
  return {
    id: e.id,
    name: e.name,
    category: e.category,
    barcode: e.barcode,
    price: money(e.rental_price),
    salePrice: money(e.sale_price),
    forRent: e.for_rent ?? true,
    forSale: e.for_sale ?? false,
    packSize: e.pack_size ?? 1,
    packPrice: money(e.pack_price),
    deposit: money(e.deposit),
    condition: e.condition ?? 'good',
    lowStockThreshold: e.low_stock_threshold ?? 3,
    sportId: e.sport_id ?? null,
    publishedToPos: e.published_to_pos ?? false,
    imageUrl: e.image_url ?? null,
    consumable: e.consumable ?? true,
    qtyStock: e.qty_stock,
    qtyAvailable: e.qty_available,
    qtyIssued: e.qty_issued,
    qtyMaintenance: e.qty_maintenance,
    qtyLost: e.qty_lost,
    isLowStock: e.is_low_stock ?? false,
  }
}

export type StockStatus = 'in-stock' | 'low-stock' | 'out-of-stock'

export function stockStatus(item: Pick<InventoryItem, 'qtyAvailable' | 'isLowStock'>): StockStatus {
  if (item.qtyAvailable <= 0) return 'out-of-stock'
  if (item.isLowStock) return 'low-stock'
  return 'in-stock'
}

export const queryKeys = {
  sports: ['sports'] as const,
  courts: (sportId?: string) => ['courts', sportId ?? 'all'] as const,
  bookings: (page: number) => ['bookings', page] as const,
  bookingsForDay: (dayISO: string) => ['bookings', 'day', dayISO] as const,
  invoices: (status?: string) => ['invoices', status ?? 'all'] as const,
  inventory: ['inventory'] as const,
  movements: (equipmentId: string) => ['movements', equipmentId] as const,
}

/** Everything POS touches, invalidated together. Issuing kit against a booking
 *  moves stock and changes what the court shows, so these three travel as a set. */
function invalidatePos(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['bookings'] })
  qc.invalidateQueries({ queryKey: ['invoices'] })
  qc.invalidateQueries({ queryKey: queryKeys.inventory })
  qc.invalidateQueries({ queryKey: ['courts'] })
}

/**
 * Sports, with each one's court count folded in for the "N Courts" label.
 *
 * The count is applied with `select` rather than inside `queryFn`, and the query
 * key is a constant. Deriving the key from `courts.data?.length` — as this used to
 * — meant it changed from `['sports', 0]` to `['sports', 8]` the moment courts
 * arrived, which React Query correctly treats as a different query and fetches
 * again. Every screen mounting this paid for two `/sports` round trips.
 */
export function useSports() {
  const courts = useAllCourts()

  const sports = useQuery({
    queryKey: queryKeys.sports,
    queryFn: () => api.listSports(),
  })

  const counts = new Map<string, number>()
  for (const c of courts.data ?? []) counts.set(c.sportId, (counts.get(c.sportId) ?? 0) + 1)

  return {
    ...sports,
    data: sports.data?.map((s) => toSport(s, counts.get(s.id) ?? 0)),
  }
}

/** Every court, unfiltered — the one query the whole app shares. */
export function useAllCourts() {
  return useQuery({
    queryKey: queryKeys.courts(),
    queryFn: async () => (await api.listCourts()).map(toCourt),
  })
}

/**
 * Courts for one sport. Filtered from the shared unfiltered query rather than
 * refetched per sport: a venue has tens of courts, so slicing them client-side
 * costs nothing and saves a round trip every time the sport selection changes.
 */
export function useCourts(sportId?: string) {
  const all = useAllCourts()
  return {
    ...all,
    data: sportId ? all.data?.filter((c) => c.sportId === sportId) : all.data,
  }
}

/** Returns the page envelope with `items` already mapped to the UI's Booking shape. */
export function useBookings(page = 1, size = 50) {
  return useQuery({
    queryKey: queryKeys.bookings(page),
    queryFn: async () => {
      const res = await api.listBookings({ page, size })
      return { ...res, items: (res.items ?? []).map(toBooking) }
    },
  })
}

/**
 * Today's bookings, for the Active Courts board.
 *
 * Bounded by *local* midnight converted to an instant, not by a date string: the
 * API stores absolute times, and an evening slot in IST belongs to today here
 * while already being tomorrow in UTC.
 */
export function useTodaysBookings() {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  const dayISO = toISO(start)

  return useQuery({
    queryKey: queryKeys.bookingsForDay(dayISO),
    queryFn: async () => {
      const res = await api.listBookings({
        date_from: start.toISOString(),
        date_to: end.toISOString(),
        size: 200,
      })
      // Cancelled bookings are dropped here, not in the UI, because `balance_due`
      // is `total - amount_paid` on every row regardless of status — so a cancelled
      // unpaid booking still reports money owed. It is not on the board and nobody
      // is going to collect it. Filtered before `toBooking` because that mapping
      // folds `cancelled` into `completed` and the distinction is gone after it.
      return (res.items ?? []).filter((b) => b.status !== 'cancelled').map(toBooking)
    },
    // The board shows who is on court right now, so it should not go stale the way
    // the reference data does.
    staleTime: 15_000,
    refetchInterval: 60_000,
  })
}

export type OutstandingTab = {
  id: string
  invoiceNo: string
  customerName: string
  subtotal: number
  gst: number
  total: number
  amountPaid: number
  balance: number
  /** Invoice lines are free text, not equipment ids — an ad-hoc sale can bill
   *  something that was never in the catalogue. */
  items: { description: string; qty: number; amount: number }[]
}

/**
 * Counter tabs — invoices with money still on them and **no booking behind them**.
 *
 * That filter is load-bearing, not tidiness. Invoicing a booking produces an
 * invoice carrying the same balance as the booking itself, so counting both would
 * report every unpaid game twice: three unpaid bookings totalling ₹2,808 rendered
 * as ₹5,616. A tab is by definition the sale that had no court attached.
 */
export function useOutstandingInvoices() {
  return useQuery({
    queryKey: queryKeys.invoices('outstanding'),
    queryFn: async (): Promise<OutstandingTab[]> => {
      const res = await api.listInvoices({ size: 200 })
      return (res.items ?? [])
        .filter((i) => !i.booking_id)
        .map((i) => ({
          id: i.id,
          invoiceNo: i.invoice_no,
          customerName: i.customer_name,
          subtotal: money(i.subtotal),
          gst: money(i.gst),
          total: money(i.total),
          amountPaid: money(i.amount_paid),
          balance: money(i.balance_due),
          items: ((i.items ?? []) as Record<string, unknown>[]).map((line) => ({
            description: String(line.description ?? ''),
            qty: Number(line.qty ?? 1),
            amount: money(line.amount as string | number),
          })),
        }))
        .filter((i) => i.balance > 0)
    },
    staleTime: 15_000,
  })
}

/** Check in, or finish early. The UI's vocabulary in, the API's out. */
export function useSetBookingStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { bookingId: string; status: Booking['status'] }) =>
      api.updateBooking(vars.bookingId, { status: API_BOOKING_STATUS[vars.status] }),
    onSuccess: () => invalidatePos(qc),
  })
}

/**
 * Edit a booking from the dashboard — reschedule it, move it to another court, or
 * correct who was playing.
 *
 * Only the fields actually passed are sent. That is load-bearing rather than tidy:
 * the server treats an omitted `equipment` as "leave the kit alone" and a sent
 * `equipment: []` as "clear the kit", so spreading a full booking object in here
 * would wipe the customer's rackets every time someone nudged a start time.
 *
 * Conflicts surface as a 409 from the exclusion constraint — the server decides
 * whether a slot is free, never this client.
 */
export function useUpdateBooking() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: {
      bookingId: string
      courtId?: string
      startsAt?: string
      durationMin?: number
      customerName?: string
      customerPhone?: string
      notes?: string
    }) => {
      const body: Parameters<typeof api.updateBooking>[1] = {}
      if (vars.courtId !== undefined) body.court_id = vars.courtId
      if (vars.startsAt !== undefined) body.starts_at = vars.startsAt
      if (vars.durationMin !== undefined) body.duration_min = vars.durationMin
      if (vars.customerName !== undefined) body.customer_name = vars.customerName
      if (vars.customerPhone !== undefined) body.customer_phone = vars.customerPhone
      if (vars.notes !== undefined) body.notes = vars.notes
      return api.updateBooking(vars.bookingId, body)
    },
    onSuccess: () => {
      invalidatePos(qc)
      // The player's name and phone are corrected on the customer record too, so
      // anything showing the customer list is stale after this.
      qc.invalidateQueries({ queryKey: ['customers'] })
    },
  })
}

/** 409 when another booking already follows — the server decides, not the client. */
export function useExtendBooking() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { bookingId: string; minutes?: number }) =>
      api.extendBooking(vars.bookingId, vars.minutes ?? 60),
    onSuccess: () => invalidatePos(qc),
  })
}

/** Hand one item to a booking. Goes through the movement ledger, which is what
 *  keeps `qty_available` honest rather than a counter someone has to remember. */
export function useIssueKit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { equipmentId: string; bookingId?: string; qty?: number }) =>
      api.createMovement(vars.equipmentId, {
        kind: 'issue',
        qty: vars.qty ?? 1,
        booking_id: vars.bookingId,
      }),
    onSuccess: () => invalidatePos(qc),
  })
}

/**
 * A counter sale: an invoice with no booking attached, plus the stock movements
 * for what left the shelf, plus payment if it was settled on the spot.
 *
 * Sequential rather than parallel because the invoice id is needed to record the
 * payment against it. Movements are issued after the invoice exists so a failed
 * invoice does not silently decrement stock.
 */
export function useOpenCounterTab() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: {
      customerName: string
      tray: Record<string, number>
      lines: { description: string; qty: number; rate: number; amount: number }[]
      payNow: boolean
      method?: 'cash' | 'upi' | 'card'
      notes?: string
    }) => {
      const invoice = await api.createInvoice({
        customer_name: vars.customerName,
        items: vars.lines,
        notes: vars.notes,
      })

      for (const [equipmentId, qty] of Object.entries(vars.tray)) {
        if (qty > 0) await api.createMovement(equipmentId, { kind: 'issue', qty })
      }

      if (vars.payNow) {
        await api.recordPayment({
          invoice_id: invoice.id,
          amount: Number(invoice.total ?? 0),
          method: vars.method ?? 'upi',
        })
      }
      return invoice
    },
    onSuccess: () => invalidatePos(qc),
  })
}

/**
 * Add kit to a game already in progress.
 *
 * Two calls, both needed: PATCH re-prices the booking so the customer is billed,
 * but it does not touch stock — the movement ledger is a separate concern and the
 * endpoint deliberately does not guess. Issuing the movements is what makes
 * `qty_available` correct.
 */
export function useAttachKitToBooking() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { bookingId: string; existing: Record<string, number>; add: Record<string, number> }) => {
      const merged: Record<string, number> = { ...vars.existing }
      for (const [id, qty] of Object.entries(vars.add)) merged[id] = (merged[id] ?? 0) + qty

      await api.updateBooking(vars.bookingId, {
        equipment: Object.entries(merged)
          .filter(([, qty]) => qty > 0)
          .map(([equipment_id, qty]) => ({ equipment_id, qty })),
      })

      for (const [equipmentId, qty] of Object.entries(vars.add)) {
        if (qty > 0)
          await api.createMovement(equipmentId, {
            kind: 'issue',
            qty,
            booking_id: vars.bookingId,
          })
      }
    },
    onSuccess: () => invalidatePos(qc),
  })
}

/**
 * Draft → API payload, shared by the quote and the create call so the two can
 * never describe different bookings.
 *
 * The wizard tracks a local calendar date plus an integer start hour; the API
 * wants one absolute instant with an offset. Feeding the parts to the `Date`
 * constructor interprets them in the browser's zone, so `toISOString()` converts
 * an 8 PM IST slot to the instant that actually is — a naive `${date}T${hour}:00`
 * would be read as UTC and land the booking 5h30m early.
 */
export function draftToBookingPayload(draft: Draft) {
  const [y, m, d] = (draft.date || toISO(new Date())).split('-').map(Number)
  const startsAt = new Date(y, m - 1, d, draft.startHour ?? 0, 0, 0, 0)
  return {
    court_id: draft.courtId!,
    starts_at: startsAt.toISOString(),
    duration_min: draft.hours * 60,
    equipment: Object.entries(draft.equipment)
      .filter(([, qty]) => qty > 0)
      .map(([key, qty]) => {
        const { id, mode, unit } = parseAddOnKey(key)
        return { equipment_id: id, qty, mode, unit }
      }),
  }
}

/**
 * The server's price for the draft as it stands. `enabled` lets the wizard hold
 * off until the step that shows money — there is no reason to price a draft the
 * user is still assembling.
 */
export function useBookingQuote(draft: Draft, enabled = true) {
  const ready = Boolean(draft.courtId) && draft.startHour != null
  const payload = ready ? draftToBookingPayload(draft) : null

  return useQuery({
    queryKey: ['booking-quote', payload],
    queryFn: () => api.quoteBooking(payload!),
    enabled: enabled && payload !== null,
  })
}

/**
 * Create the booking. Returns the server's row — its id is the booking's real
 * identity, so callers should use that rather than minting one locally.
 */
export function useCreateBooking() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (draft: Draft) =>
      api.createBooking({
        ...draftToBookingPayload(draft),
        customer_name: draft.customer.name.trim(),
        customer_phone: draft.customer.phone.trim() || undefined,
        booking_type: 'walkin',
        notes: draft.customer.notes.trim() || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bookings'] })
      // Creating a booking issues its kit through the movement ledger and takes
      // the slot, so both stock levels and court occupancy are now stale.
      qc.invalidateQueries({ queryKey: queryKeys.inventory })
      qc.invalidateQueries({ queryKey: ['courts'] })
    },
  })
}

/**
 * Settle a booking's outstanding balance. Invalidates the booking list so the row
 * reflects the payment — the old localStorage write updated the same array the list
 * rendered from, which a server-backed list does not get for free.
 */
export function useRecordPayment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: {
      amount: number
      method: 'cash' | 'upi' | 'card' | 'bank' | 'cheque'
      bookingId?: string
      invoiceId?: string
    }) =>
      api.recordPayment({
        booking_id: vars.bookingId,
        invoice_id: vars.invoiceId,
        amount: vars.amount,
        method: vars.method,
      }),
    onSuccess: () => invalidatePos(qc),
  })
}

/** The whole catalogue in one page — inventories for a single venue run to the tens
 *  or low hundreds, so search/price-range filtering happens client-side on this. */
export function useInventory() {
  return useQuery({
    queryKey: queryKeys.inventory,
    // 200 is the API's hard ceiling on page size (see Params in api_utils.py).
    queryFn: async () => (await api.listEquipment({ size: 200 })).items.map(toInventoryItem),
  })
}

function invalidateInventory(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: queryKeys.inventory })
}

export function useCreateInventoryItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: {
      name: string
      category: string
      barcode: string
      price: number
      deposit: number
      salePrice: number
      forRent: boolean
      forSale: boolean
      packSize: number
      packPrice: number
      condition: InventoryItem['condition']
      lowStockThreshold: number
      sportId: string | null
      publishedToPos: boolean
      imageUrl: string | null
      consumable: boolean
      qtyStock: number
    }) =>
      api.createEquipment({
        name: vars.name,
        category: vars.category,
        barcode: vars.barcode,
        rental_price: vars.price,
        deposit: vars.deposit,
        sale_price: vars.salePrice,
        for_rent: vars.forRent,
        for_sale: vars.forSale,
        pack_size: vars.packSize,
        pack_price: vars.packPrice,
        condition: vars.condition,
        low_stock_threshold: vars.lowStockThreshold,
        sport_id: vars.sportId,
        published_to_pos: vars.publishedToPos,
        image_url: vars.imageUrl,
        consumable: vars.consumable,
        qty_stock: vars.qtyStock,
      }),
    onSuccess: () => invalidateInventory(qc),
  })
}

export function useUpdateInventoryItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: {
      id: string
      patch: Partial<{
        name: string
        category: string
        price: number
        deposit: number
        salePrice: number
        forRent: boolean
        forSale: boolean
        packSize: number
        packPrice: number
        condition: InventoryItem['condition']
        lowStockThreshold: number
        sportId: string | null
        publishedToPos: boolean
        imageUrl: string | null
        consumable: boolean
      }>
    }) =>
      api.updateEquipment(vars.id, {
        name: vars.patch.name,
        category: vars.patch.category,
        rental_price: vars.patch.price,
        deposit: vars.patch.deposit,
        sale_price: vars.patch.salePrice,
        for_rent: vars.patch.forRent,
        for_sale: vars.patch.forSale,
        pack_size: vars.patch.packSize,
        pack_price: vars.patch.packPrice,
        condition: vars.patch.condition,
        low_stock_threshold: vars.patch.lowStockThreshold,
        sport_id: vars.patch.sportId,
        published_to_pos: vars.patch.publishedToPos,
        image_url: vars.patch.imageUrl,
        consumable: vars.patch.consumable,
      }),
    // Flip the row in the cache immediately — the toggle shouldn't wait on a
    // network round trip (or the 200-item refetch below) to visibly respond.
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: queryKeys.inventory })
      const previous = qc.getQueryData<InventoryItem[]>(queryKeys.inventory)
      qc.setQueryData<InventoryItem[]>(queryKeys.inventory, (items) =>
        items?.map((item) => (item.id === vars.id ? { ...item, ...vars.patch } : item)),
      )
      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) qc.setQueryData(queryKeys.inventory, context.previous)
    },
    onSettled: () => invalidateInventory(qc),
  })
}

export function useDeleteInventoryItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteEquipment(id),
    onSuccess: () => invalidateInventory(qc),
  })
}

/** Restock/write-off/correction — one ledger entry that also moves the counters,
 *  in the same transaction, server-side. */
export function useCreateMovement() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { equipmentId: string; kind: MovementKind; qty: number; note?: string }) =>
      api.createMovement(vars.equipmentId, { kind: vars.kind, qty: vars.qty, note: vars.note }),
    onSuccess: (_data, vars) => {
      invalidateInventory(qc)
      qc.invalidateQueries({ queryKey: queryKeys.movements(vars.equipmentId) })
    },
  })
}

export function useMovementHistory(equipmentId: string | null) {
  return useQuery({
    queryKey: queryKeys.movements(equipmentId ?? ''),
    queryFn: async () => (await api.listMovements(equipmentId!, { size: 20 })).items,
    enabled: !!equipmentId,
  })
}
