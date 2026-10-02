/**
 * Query hooks + the mapping layer between API shapes and the shapes the existing
 * screens already render.
 *
 * The mapping lives here on purpose. Screens keep consuming `Sport`/`Court` as
 * they always have, so wiring one up is a swap of the data source rather than a
 * rewrite of its JSX — and this file is the only place that knows the API uses
 * UUIDs, decimal strings and no sport imagery.
 */
import { useCallback } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  api,
  type AssessmentBody,
  type CourtBody,
  type CourtPatch,
  type MembershipPlanBody,
  type RosterQuery,
  type SportBody,
  type SportPatch,
} from './client'
import type { components } from './schema'
import { asset } from '../lib/asset'
import { useActiveBranchId } from '../branch/activeBranch'
import {
  addOnKey,
  parseAddOnKey,
  toISO,
  type Booking,
  type Court,
  type Draft,
  type Sport,
} from '../data/booking'

type SportOut = components['schemas']['SportOut']
type CourtWithStatus = components['schemas']['CourtWithStatus']
export type SportRecord = SportOut
export type CourtRecord = CourtWithStatus
export type CatalogueSport = Awaited<ReturnType<typeof api.sportCatalogue>>[number]
/** Exported for the dashboard's aggregates — see `useBookingsInRange` below,
 *  which hands out this raw shape rather than the counter UI's `Booking`. */
export type BookingOut = components['schemas']['BookingOut']
export type BranchOut = components['schemas']['BranchOut']
export type BranchInfo = components['schemas']['BranchInfo']
export type BookingSource = NonNullable<BookingOut['booked_via']>
type EquipmentOut = components['schemas']['EquipmentOut']
/** What `POST /bookings/quote` returns — the server's price for a draft. */
export type BookingQuote = components['schemas']['QuoteOut']
export type MovementOut = components['schemas']['MovementOut']
export type MovementKind = MovementOut['kind']
export type Kpis = components['schemas']['Kpis']
export type RevenuePoint = components['schemas']['RevenuePoint']

/**
 * The API has no sport imagery — it carries `icon`/`color`, while the UI is built
 * around photographs. Each sport's photo lives on the asset CDN at
 * `sports/<slug>.jpg` (see /assets/README.md), so adding one is an upload, not a
 * deploy. A sport with no photo — one a venue created itself, say — 404s there,
 * and the sport card shows the sport's own icon instead.
 */
const sportImage = (slug: string) => asset(`sports/${slug}.jpg`)

/** Money crosses the wire as a decimal string; JS renders a number. */
const money = (v: string | number | null | undefined) => Number(v ?? 0)

export function toSport(s: SportOut, courtCount?: number): Sport {
  return {
    id: s.id,
    name: s.name,
    fieldsLabel: courtCount === undefined ? '' : `${courtCount} ${courtCount === 1 ? 'Court' : 'Courts'}`,
    from: money(s.price_base),
    // The venue's own upload wins; the CDN photo is the fallback for stock sports.
    image: s.image_url || sportImage(s.slug),
    icon: s.icon ?? '',
    bgColor: s.bg_color ?? '',
    isActive: s.is_active ?? true,
  }
}

export function toCourt(c: CourtWithStatus): Court {
  const hours = c.operating_hours ?? { open: '06:00', close: '22:00' }
  return {
    id: c.id,
    sportId: c.sport_id,
    branchId: c.branch_id,
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
    branchId: b.branch_id,
    bookedVia: b.booked_via ?? null,
    // `sold_on_platform`, not `source_platform`: the venue's own website sets the
    // latter too, and those bookings are the venue's to cancel.
    platform: b.sold_on_platform && b.source_platform
      ? {
          slug: b.source_platform,
          orderRef: b.external_ref ?? null,
          bookingRef: b.partner_booking_ref ?? null,
          cancelRequestedAt: b.partner_cancel_requested_at ?? null,
        }
      : null,
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
  branches: (includeInactive: boolean) => ['branches', includeInactive] as const,
  businessSettings: ['settings', 'business'] as const,
  bookings: (page: number) => ['bookings', page] as const,
  bookingsForDay: (dayISO: string) => ['bookings', 'day', dayISO] as const,
  bookingsRange: (fromISO: string, toISO: string) => ['bookings', 'range', fromISO, toISO] as const,
  bookingsAwaitingPartnerCancel: ['bookings', 'awaiting-partner-cancel'] as const,
  invoices: (status?: string) => ['invoices', status ?? 'all'] as const,
  inventory: ['inventory'] as const,
  movements: (equipmentId: string) => ['movements', equipmentId] as const,
  reports: {
    kpis: (fromISO?: string, toISO?: string) => ['reports', 'kpis', fromISO ?? '', toISO ?? ''] as const,
    revenue: (fromISO?: string) => ['reports', 'revenue', fromISO ?? ''] as const,
  },
  membershipPlans: (includeInactive: boolean) => ['membership-plans', includeInactive] as const,
  memberships: (status?: string, search?: string) =>
    ['memberships', status ?? 'all', search ?? ''] as const,
  programs: (includeInactive: boolean) => ['programs', includeInactive] as const,
  batches: (programId?: string) => ['batches', programId ?? 'all'] as const,
  students: (search?: string) => ['students', search ?? ''] as const,
  coaches: ['coaches'] as const,
  studentLevels: (studentId: string) => ['student-levels', studentId] as const,
  studentPromotions: (studentId: string) => ['student-promotions', studentId] as const,
  roster: (query: RosterQuery) => ['roster', query] as const,
  attention: ['attention'] as const,
  studentProfile: (studentId: string) => ['student-profile', studentId] as const,
  academyOverview: ['academy-overview'] as const,
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
export function useSports(includeInactive = false) {
  const courts = useAllCourts()

  const sports = useQuery({
    // Distinct key when including inactive sports — same endpoint, different
    // result set, and both are legitimately cached at once: pickers want only
    // what's bookable today, while a report labelling a six-month-old booking
    // needs the sport even after it was retired.
    queryKey: includeInactive ? [...queryKeys.sports, 'all'] : queryKeys.sports,
    queryFn: () => api.listSports(includeInactive ? { include_inactive: true } : undefined),
  })

  const counts = new Map<string, number>()
  for (const c of courts.data ?? []) counts.set(c.sportId, (counts.get(c.sportId) ?? 0) + 1)

  return {
    ...sports,
    data: sports.data?.map((s) => toSport(s, counts.get(s.id) ?? 0)),
  }
}

/**
 * A `select` that narrows a list to the branch the dashboard is looking at.
 *
 * Filtering here rather than in each `queryFn` keeps one cached copy of the
 * unfiltered data, so switching branch is instant and needs no refetch. `pick` must
 * be a stable (module-level) function: it is a dependency of the memoised selector,
 * and an unstable one would make React Query re-run `select` on every render.
 */
function useBranchSelect<T>(pick: (item: T) => string | null | undefined) {
  const branchId = useActiveBranchId()
  return useCallback(
    (items: T[]): T[] => (branchId ? items.filter((item) => pick(item) === branchId) : items),
    [branchId, pick],
  )
}

const courtBranch = (c: Court) => c.branchId
const courtRecordBranch = (c: CourtWithStatus) => c.branch_id
const bookingBranch = (b: Booking) => b.branchId
const bookingOutBranch = (b: BookingOut) => b.branch_id

/** Every court — the one query the whole app shares, narrowed to the active branch. */
export function useAllCourts() {
  return useQuery({
    queryKey: queryKeys.courts(),
    queryFn: async () => (await api.listCourts()).map(toCourt),
    select: useBranchSelect(courtBranch),
  })
}

/* ── Sports & Courts management ─────────────────────────────────────────────
 * The management screens work on the API's own records rather than the counter's
 * lossy `Sport`/`Court` view (no per-day hours, no images, no active flag), so they
 * get their own hooks. The sports query shares its cache entry with
 * `useSports(true)`; courts live under a sibling key so both are refreshed by the
 * same `['courts']` invalidation. */

/** Every sport, retired ones included, as the API sends them. */
export function useManagedSports() {
  return useQuery({
    queryKey: [...queryKeys.sports, 'all'],
    queryFn: () => api.listSports({ include_inactive: true }),
  })
}

/**
 * Every court as the API sends it — rates, hours, images, bookable flag. Narrowed to
 * the active branch unless `scoped` is false, which the code generator needs: a court
 * code is unique across the whole academy, not just the branch on screen.
 */
export function useManagedCourts(scoped = true) {
  const inBranch = useBranchSelect(courtRecordBranch)
  return useQuery({
    queryKey: ['courts', 'raw'] as const,
    queryFn: () => api.listCourts(),
    select: scoped ? inBranch : undefined,
  })
}

/** The fixed menu offered when adding a sport. Rarely changes. */
export function useSportCatalogue() {
  return useQuery({
    queryKey: [...queryKeys.sports, 'catalogue'] as const,
    queryFn: () => api.sportCatalogue(),
    staleTime: 10 * 60_000,
  })
}

/**
 * Refresh the lists in the background.
 *
 * Not returned from the mutation callbacks on purpose: a mutation waits for whatever
 * its `onSuccess`/`onSettled` hands back, and this used to return the refetches. Every
 * save then cost the PATCH *plus* a full re-fetch of sports and courts before the
 * screen reacted — two sequential round trips to a remote database for flipping a
 * switch. Now the change is shown at once and the lists catch up behind it.
 */
function useRefreshFacility() {
  const qc = useQueryClient()
  return (which: { sports?: boolean; courts?: boolean }) => {
    if (which.sports) void qc.invalidateQueries({ queryKey: ['sports'] })
    if (which.courts) void qc.invalidateQueries({ queryKey: ['courts'] })
  }
}

const RAW_COURTS_KEY = ['courts', 'raw'] as const

/**
 * Create or update a sport. An update is applied to the cached lists immediately and
 * rolled back if the server refuses it, so switching a sport on or off feels instant.
 * A create has nothing to show until the server has issued its id, so it waits.
 */
export function useSaveSport() {
  const qc = useQueryClient()
  const refresh = useRefreshFacility()
  return useMutation({
    mutationFn: (vars: { sportId?: string; body: SportBody } | { sportId: string; body: SportPatch }) =>
      vars.sportId ? api.updateSport(vars.sportId, vars.body as SportPatch) : api.createSport(vars.body as SportBody),
    onMutate: async (vars) => {
      if (!vars.sportId) return undefined
      await qc.cancelQueries({ queryKey: queryKeys.sports })
      const previous = qc.getQueriesData<SportOut[]>({ queryKey: queryKeys.sports })
      // `['sports', 'catalogue']` shares the prefix but its rows have no `id`, so the
      // match below leaves it alone.
      qc.setQueriesData<SportOut[]>({ queryKey: queryKeys.sports }, (old) =>
        Array.isArray(old)
          ? old.map((s) => (s.id === vars.sportId ? ({ ...s, ...vars.body } as SportOut) : s))
          : old,
      )
      return { previous }
    },
    onError: (_err, _vars, ctx) => {
      for (const [key, data] of ctx?.previous ?? []) qc.setQueryData(key, data)
    },
    // A rename also changes `sport_name` on every court of the sport.
    onSettled: (_data, _err, vars) =>
      refresh({ sports: true, courts: !vars.sportId || 'name' in vars.body }),
  })
}

export function useDeleteSport() {
  const refresh = useRefreshFacility()
  return useMutation({
    mutationFn: (sportId: string) => api.deleteSport(sportId),
    onSuccess: () => refresh({ sports: true }),
  })
}

/** Same shape as `useSaveSport`: an update shows at once, a create waits for its id. */
export function useSaveCourt() {
  const qc = useQueryClient()
  const refresh = useRefreshFacility()
  return useMutation({
    mutationFn: (vars: { courtId?: string; body: CourtBody } | { courtId: string; body: CourtPatch }) =>
      vars.courtId ? api.updateCourt(vars.courtId, vars.body as CourtPatch) : api.createCourt(vars.body as CourtBody),
    onMutate: async (vars) => {
      if (!vars.courtId) return undefined
      await qc.cancelQueries({ queryKey: ['courts'] })
      const previous = qc.getQueryData<CourtWithStatus[]>(RAW_COURTS_KEY)
      qc.setQueryData<CourtWithStatus[]>(RAW_COURTS_KEY, (old) =>
        old?.map((c) => (c.id === vars.courtId ? ({ ...c, ...vars.body } as CourtWithStatus) : c)),
      )
      return { previous }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(RAW_COURTS_KEY, ctx.previous)
    },
    onSettled: () => refresh({ courts: true }),
  })
}

export function useDeleteCourt() {
  const refresh = useRefreshFacility()
  return useMutation({
    mutationFn: (courtId: string) => api.deleteCourt(courtId),
    onSuccess: () => refresh({ courts: true }),
  })
}

/** Uploads one image and resolves to its URL — it is not attached to anything yet. */
export function useUploadImage() {
  return useMutation({ mutationFn: (file: File) => api.uploadImage(file) })
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

/**
 * Branches, default first. Closed ones are fetched under their own key, same as
 * `useSports`: pickers want what is open today, while Settings needs to show — and
 * let an owner reopen — the ones that are not.
 */
export function useBranches(includeInactive = false) {
  return useQuery({
    queryKey: queryKeys.branches(includeInactive),
    queryFn: () => api.listBranches(includeInactive ? { include_inactive: true } : undefined),
  })
}

/**
 * Create or update a branch, then move any courts the form picked onto it.
 *
 * One mutation rather than three calls in the component, so a half-finished save
 * (branch created, courts not moved) is reported as one failure and the form can
 * stay open on the branch that now exists instead of creating it twice on retry.
 */
export function useSaveBranch() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: {
      branchId?: string
      body: Parameters<typeof api.createBranch>[0] & { is_active?: boolean }
      bringCourtIds: string[]
    }) => {
      const { is_active, ...fields } = vars.body
      const saved = vars.branchId
        ? await api.updateBranch(vars.branchId, vars.body)
        : await api.createBranch(fields)
      for (const courtId of vars.bringCourtIds) await api.moveCourt(courtId, saved.id)
      // A new branch is always created open; honour a "closed" pick afterwards.
      if (!vars.branchId && is_active === false) await api.updateBranch(saved.id, { is_active })
      return saved
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['branches'] })
      qc.invalidateQueries({ queryKey: ['courts'] })
    },
  })
}

/** Promote a branch to default. */
export function useMakeDefaultBranch() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (branchId: string) => api.updateBranch(branchId, { is_default: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['branches'] }),
  })
}

/** The academy's own details — the legal entity above its branches. */
export function useBusinessSettings() {
  return useQuery({
    queryKey: queryKeys.businessSettings,
    queryFn: () => api.getSettings(),
  })
}

export function useSaveBusinessSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Parameters<typeof api.updateSettings>[0]) => api.updateSettings(body),
    onSuccess: (saved) => {
      qc.setQueryData(queryKeys.businessSettings, saved)
      // Branches without a GSTIN of their own print this one on invoices.
      qc.invalidateQueries({ queryKey: ['invoices'] })
    },
  })
}

/** Returns the page envelope with `items` already mapped to the UI's Booking shape. */
export function useBookings(page = 1, size = 50) {
  const branchId = useActiveBranchId()
  const select = useCallback(
    <T extends { items: Booking[] }>(res: T): T =>
      branchId ? { ...res, items: res.items.filter((b) => bookingBranch(b) === branchId) } : res,
    [branchId],
  )
  return useQuery({
    queryKey: queryKeys.bookings(page),
    queryFn: async () => {
      const res = await api.listBookings({ page, size })
      return { ...res, items: (res.items ?? []).map(toBooking) }
    },
    select,
  })
}

/**
 * Platform bookings staff asked the platform to cancel, which it has not yet.
 * The follow-up list: each one is a court held for a customer the venue has
 * already let go of, until someone chases Playo (or Hudle, or District).
 */
export function useBookingsAwaitingPartnerCancel() {
  return useQuery({
    queryKey: queryKeys.bookingsAwaitingPartnerCancel,
    queryFn: async () => {
      const res = await api.listBookings({ awaiting_partner_cancel: true, size: 100 })
      return (res.items ?? []).map(toBooking)
    },
    select: useBranchSelect(bookingBranch),
    staleTime: 60_000,
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
    select: useBranchSelect(bookingBranch),
    // The board shows who is on court right now, so it should not go stale the way
    // the reference data does.
    staleTime: 15_000,
    refetchInterval: 60_000,
  })
}

/**
 * Every booking in a window, unmapped.
 *
 * The dashboard's aggregates (revenue by sport, revenue by channel, prime hours)
 * need `booking_type`/`source_platform`/`sport_id` as the API sends them —
 * `toBooking` collapses those into the counter UI's own vocabulary and drops
 * `source_platform` entirely, so this reads the raw page instead of going
 * through it.
 *
 * Paginates to collect the whole window, capped at 5 pages (1000 bookings) so a
 * venue's busiest month can't turn a dashboard load into an unbounded fetch loop
 * — the aggregates below read as "top slice of the window", not the exact total,
 * once a window is that busy.
 */
async function fetchAllBookings(dateFromISO: string, dateToISO: string): Promise<BookingOut[]> {
  const size = 200
  const maxPages = 5
  const first = await api.listBookings({ date_from: dateFromISO, date_to: dateToISO, page: 1, size })
  const items = [...(first.items ?? [])]
  const pages = Math.min(first.pages ?? 1, maxPages)
  for (let page = 2; page <= pages; page++) {
    const next = await api.listBookings({ date_from: dateFromISO, date_to: dateToISO, page, size })
    items.push(...(next.items ?? []))
  }
  // Held slots are excluded server-side already; cancelled bookings carry no
  // revenue and would otherwise inflate booking counts for a slot nobody kept.
  return items.filter((b) => b.status !== 'cancelled')
}

export function useBookingsInRange(dateFromISO: string, dateToISO: string) {
  return useQuery({
    queryKey: queryKeys.bookingsRange(dateFromISO, dateToISO),
    queryFn: () => fetchAllBookings(dateFromISO, dateToISO),
    select: useBranchSelect(bookingOutBranch),
    staleTime: 60_000,
  })
}

/** The live status of every court, folded into counts — powers the dashboard's
 *  "Available Courts" stat. Kept separate from `useAllCourts`: that hook feeds
 *  screens built around `Court`, whose mapping has no `status` field. */
export function useCourtStatusSummary() {
  const branchId = useActiveBranchId()
  return useQuery({
    queryKey: ['courts', 'status-summary', branchId ?? 'all'],
    queryFn: async () => {
      const courts = await api.listCourts(branchId ? { branch_id: branchId } : undefined)
      const available = courts.filter((c) => c.status === 'available').length
      const occupied = courts.filter((c) => c.status === 'occupied').length
      const maintenance = courts.filter((c) => c.status === 'maintenance').length
      return { total: courts.length, available, occupied, maintenance }
    },
    staleTime: 15_000,
    refetchInterval: 60_000,
  })
}

/** Headline numbers for a window — total revenue, bookings, average booking
 *  value, court utilisation, active members, outstanding dues. Omit both dates
 *  for the server's own default window. */
export function useKpis(dateFromISO?: string, dateToISO?: string) {
  return useQuery({
    queryKey: queryKeys.reports.kpis(dateFromISO, dateToISO),
    queryFn: () => api.reportKpis({ date_from: dateFromISO, date_to: dateToISO }),
    staleTime: 30_000,
  })
}

/** Revenue collected and bookings taken, by month — powers the Revenue Trends
 *  chart. `dateFromISO` bounds how far back it goes; leave it off for the
 *  server's own 180-day default. */
export function useRevenueTrend(dateFromISO?: string) {
  return useQuery({
    queryKey: queryKeys.reports.revenue(dateFromISO),
    queryFn: () => api.reportRevenue({ date_from: dateFromISO }),
    staleTime: 60_000,
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

/** Ask the platform that sold a booking to cancel it. The booking stays live —
 *  its court blocked — until the platform's own cancel call arrives. */
export function useRequestPartnerCancel() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { bookingId: string; reason?: string }) =>
      api.requestPartnerCancel(vars.bookingId, vars.reason),
    onSuccess: () => invalidatePos(qc),
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

/* ── Memberships ───────────────────────────────────────────────────────────
 *
 * Selling or renewing raises an invoice, so every mutation here invalidates
 * `invoices` alongside its own list — otherwise the money appears on the
 * Finance screen only after a manual refresh, and staff reasonably conclude
 * the payment did not register.
 */

export type MembershipPlanOut = components['schemas']['MembershipPlanOut']
export type SubscriptionOut = components['schemas']['SubscriptionOut']

/** The four term lengths, in the order an academy sells them. `6m` is included
 *  because the schema has it; a plan that leaves it at 0 simply does not offer
 *  it, and `sellableDurations` below is what the UI should actually render. */
export const PLAN_DURATIONS = ['1m', '3m', '6m', '12m'] as const
export type PlanDuration = (typeof PLAN_DURATIONS)[number]

export const DURATION_LABEL: Record<PlanDuration, string> = {
  '1m': 'Monthly',
  '3m': 'Quarterly',
  '6m': 'Half-yearly',
  '12m': 'Yearly',
}

const PRICE_FIELD: Record<PlanDuration, keyof MembershipPlanOut> = {
  '1m': 'price_1m',
  '3m': 'price_3m',
  '6m': 'price_6m',
  '12m': 'price_12m',
}

export function planPrice(plan: MembershipPlanOut, duration: PlanDuration): number {
  return Number(plan[PRICE_FIELD[duration]] ?? 0)
}

/**
 * The terms this plan is actually sold by.
 *
 * Zero is the API's way of saying "not offered" — `POST /memberships` refuses a
 * duration priced at 0 rather than issuing a free membership. Filtering here
 * means the picker never shows a term that would be rejected on submit, which
 * is the difference between a plan that sells yearly only and one that looks
 * broken.
 */
export function sellableDurations(plan: MembershipPlanOut): PlanDuration[] {
  return PLAN_DURATIONS.filter((d) => planPrice(plan, d) > 0)
}

export function useMembershipPlans(includeInactive = false) {
  return useQuery({
    queryKey: queryKeys.membershipPlans(includeInactive),
    queryFn: () => api.membershipPlans({ include_inactive: includeInactive }),
  })
}

/**
 * Create or update, as one mutation.
 *
 * A union rather than one optional-everything body: creating needs a name,
 * updating must be able to send `{is_active: false}` alone. Collapsing the two
 * into `Partial<...>` would make a create with no name a type-check away from
 * shipping, and the server's 422 is a worse place to find out.
 */
export function useSaveMembershipPlan() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (
      vars:
        | { planId: string; body: Partial<MembershipPlanBody> }
        | { planId?: undefined; body: MembershipPlanBody },
    ) =>
      vars.planId !== undefined
        ? api.updateMembershipPlan(vars.planId, vars.body)
        : api.createMembershipPlan(vars.body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['membership-plans'] })
      // A renamed or repriced plan changes how the member list reads.
      qc.invalidateQueries({ queryKey: ['memberships'] })
    },
  })
}

export function useMemberships(status?: string, search?: string) {
  return useQuery({
    queryKey: queryKeys.memberships(status, search),
    queryFn: () =>
      api.memberships({
        size: 100,
        ...(status && status !== 'all' ? { status: status as 'active' } : {}),
        ...(search ? { search } : {}),
      }),
  })
}

function invalidateMemberships(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['memberships'] })
  qc.invalidateQueries({ queryKey: ['invoices'] })
  // `active_count` on every plan is derived from live subscriptions.
  qc.invalidateQueries({ queryKey: ['membership-plans'] })
}

export function useCreateMembership() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Parameters<typeof api.createMembership>[0]) => api.createMembership(body),
    onSuccess: () => invalidateMemberships(qc),
  })
}

export function useRenewMembership() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { id: string; duration: PlanDuration }) =>
      api.renewMembership(vars.id, vars.duration),
    onSuccess: () => invalidateMemberships(qc),
  })
}

/** Pause, resume and cancel share a hook because the screen treats them as one
 *  control with three positions, and all three invalidate identically. */
export function useMembershipLifecycle() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { id: string; action: 'pause' | 'resume' | 'cancel' }) =>
      vars.action === 'pause'
        ? api.pauseMembership(vars.id)
        : vars.action === 'resume'
          ? api.resumeMembership(vars.id)
          : api.cancelMembership(vars.id),
    onSuccess: () => invalidateMemberships(qc),
  })
}

/* ── Academy ───────────────────────────────────────────────────────────────── */

export type ProgramOut = components['schemas']['ProgramOut']
export type BatchOut = components['schemas']['BatchOut']
export type StudentOut = components['schemas']['StudentOut']
export type CoachOut = components['schemas']['CoachOut']
export type StudentLevelOut = components['schemas']['StudentLevelOut']
export type PromotionOut = components['schemas']['PromotionOut']
export type StudentRow = components['schemas']['StudentRow']
export type StudentProfile = components['schemas']['StudentProfile']
export type AssessmentOut = components['schemas']['AssessmentOut']
export type AttentionOut = components['schemas']['AttentionOut']
export type AttentionItem = components['schemas']['AttentionItem']
export type AttentionFlag = StudentRow['flags'][number]
export type AcademyOverview = components['schemas']['AcademyOverview']
export type SkillLevel = 'beginner' | 'intermediate' | 'advanced' | 'competitive'
export type AgeBand = 'kids' | 'adults'

export const SKILL_LEVELS: SkillLevel[] = ['beginner', 'intermediate', 'advanced', 'competitive']
export const AGE_BANDS: AgeBand[] = ['kids', 'adults']

/** Mirrors `DEFAULT_AGE_BOUNDS` in app/modules/academy/models.py. Shown as
 *  placeholder text in the programme editor so an admin can see what a band
 *  means before deciding whether to override it. */
export const DEFAULT_AGE_BOUNDS: Record<AgeBand, [number, number]> = {
  kids: [5, 16],
  adults: [17, 99],
}

export function ageBoundsFor(program: Pick<ProgramOut, 'age_band' | 'age_min' | 'age_max'>) {
  if (!program.age_band && program.age_min == null && program.age_max == null) return null
  const [lo, hi] = program.age_band ? DEFAULT_AGE_BOUNDS[program.age_band as AgeBand] : [0, 200]
  return [program.age_min ?? lo, program.age_max ?? hi] as const
}

export function useProgramsList(includeInactive = false) {
  return useQuery({
    queryKey: queryKeys.programs(includeInactive),
    queryFn: () => api.programs({ include_inactive: includeInactive }),
  })
}

export function useSaveProgram() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { programId?: string; body: Parameters<typeof api.createProgram>[0] }) =>
      vars.programId ? api.updateProgram(vars.programId, vars.body) : api.createProgram(vars.body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['programs'] })
      // A batch reads its programme's band and fees, so both lists move together.
      qc.invalidateQueries({ queryKey: ['batches'] })
    },
  })
}

export function useBatches(programId?: string) {
  return useQuery({
    queryKey: queryKeys.batches(programId),
    queryFn: () => api.batches(programId ? { program_id: programId } : undefined),
  })
}

export function useCreateBatch() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Parameters<typeof api.createBatch>[0]) => api.createBatch(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['batches'] }),
  })
}

export function useStudents(search?: string) {
  return useQuery({
    queryKey: queryKeys.students(search),
    queryFn: () => api.students({ size: 100, ...(search ? { search } : {}) }),
  })
}

export function useCoaches() {
  return useQuery({ queryKey: queryKeys.coaches, queryFn: () => api.coaches({ size: 100 }) })
}

/* ── Academy: coaches ──────────────────────────────────────────────────────── */

export type CoachProfile = components['schemas']['CoachProfile']
export type CoachBatchRow = components['schemas']['CoachBatchRow']
export type CoachReviewOut = components['schemas']['CoachReviewOut']
export type CoachPayoutOut = components['schemas']['CoachPayoutOut']
export type CoachEarnings = components['schemas']['CoachEarnings']
export type Payroll = components['schemas']['Payroll']
export type PayrollRow = components['schemas']['PayrollRow']
export type CoachRemoval = components['schemas']['CoachRemoval']

/** Everything that shows a coach: the list, a profile, the payroll, and the batches
 *  and students that carry a coach's name. A change to a coach, a batch assignment or a
 *  payout can move several at once, so they travel as a set. */
function invalidateCoaches(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: queryKeys.coaches })
  qc.invalidateQueries({ queryKey: ['coach-profile'] })
  qc.invalidateQueries({ queryKey: ['payroll'] })
  qc.invalidateQueries({ queryKey: ['batches'] })
  qc.invalidateQueries({ queryKey: ['programs'] })
  invalidateAcademy(qc)
}

export function useCoachProfile(coachId: string | null) {
  return useQuery({
    queryKey: ['coach-profile', coachId ?? ''] as const,
    queryFn: () => api.coachProfile(coachId!),
    enabled: Boolean(coachId),
  })
}

export function useSaveCoach() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { coachId?: string; body: Parameters<typeof api.createCoach>[0] }) =>
      vars.coachId ? api.updateCoach(vars.coachId, vars.body) : api.createCoach(vars.body),
    onSuccess: () => invalidateCoaches(qc),
  })
}

/** Reactivate (or deactivate) a coach without re-sending the rest of the form. */
export function useSetCoachStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { coachId: string; status: 'active' | 'inactive' | 'on-leave' }) =>
      api.updateCoach(vars.coachId, { status: vars.status }),
    onSuccess: () => invalidateCoaches(qc),
  })
}

export function useRemoveCoach() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { coachId: string; reassignTo?: string }) =>
      api.removeCoach(vars.coachId, vars.reassignTo),
    onSuccess: () => invalidateCoaches(qc),
  })
}

export function useAssignBatches() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { coachId: string; batchIds: string[]; unassign?: boolean }) =>
      vars.unassign
        ? api.unassignBatches(vars.coachId, vars.batchIds)
        : api.assignBatches(vars.coachId, vars.batchIds),
    onSuccess: () => invalidateCoaches(qc),
  })
}

export function useAddCoachReview() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { coachId: string; body: Parameters<typeof api.addCoachReview>[1] }) =>
      api.addCoachReview(vars.coachId, vars.body),
    onSuccess: () => invalidateCoaches(qc),
  })
}

export function useDeleteCoachReview() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (reviewId: string) => api.deleteCoachReview(reviewId),
    onSuccess: () => invalidateCoaches(qc),
  })
}

/** One month's earnings for every coach. Manager and above — pass `enabled: false`
 *  for anyone else so the request is never made. Leave `month` undefined for the
 *  academy's current month: the server knows which that is in the academy's own
 *  timezone, and the browser's clock may not agree. */
export function usePayroll(month: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['payroll', month ?? 'current'] as const,
    queryFn: () => api.payroll(month),
    enabled,
    placeholderData: keepPreviousData,
  })
}

/** What one coach would be paid for a month, itemised — read by the payout form so
 *  the amount on screen is the one the server will record. */
export function useCoachEarnings(coachId: string | null, month: string) {
  return useQuery({
    queryKey: ['payroll', 'coach', coachId ?? '', month] as const,
    queryFn: () => api.coachEarnings(coachId!, month),
    enabled: Boolean(coachId),
  })
}

export function useRecordPayout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { coachId: string; body: Parameters<typeof api.recordPayout>[1] }) =>
      api.recordPayout(vars.coachId, vars.body),
    onSuccess: () => invalidateCoaches(qc),
  })
}

export function useDeletePayout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payoutId: string) => api.deletePayout(payoutId),
    onSuccess: () => invalidateCoaches(qc),
  })
}

/** Everything on the Academy screen that is derived from students, enrolments,
 *  registers or payments. A change to any one of them can move the table, the
 *  attention lists, a profile and the summary at once, so they travel as a set. */
function invalidateAcademy(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['students'] })
  qc.invalidateQueries({ queryKey: ['roster'] })
  qc.invalidateQueries({ queryKey: ['attention'] })
  qc.invalidateQueries({ queryKey: ['student-profile'] })
  qc.invalidateQueries({ queryKey: queryKeys.academyOverview })
}

export function useCreateStudent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Parameters<typeof api.createStudent>[0]) => api.createStudent(body),
    onSuccess: () => invalidateAcademy(qc),
  })
}

/**
 * Enrol a student, which also raises the term's fee invoice.
 *
 * Two refusals worth handling distinctly at the call site, both 400s carrying
 * `details`: an age outside the programme's band (`student_age`, `age_min`,
 * `age_max`) and a banded programme meeting a student with no date of birth
 * (`field: "date_of_birth"`). Neither is retryable — they need a different
 * batch or a corrected record — so a generic "try again" toast is the wrong
 * response to both.
 */
export function useEnrolStudent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Parameters<typeof api.enrolStudent>[0]) => api.enrolStudent(body),
    onSuccess: () => {
      invalidateAcademy(qc)
      qc.invalidateQueries({ queryKey: ['batches'] })
      qc.invalidateQueries({ queryKey: ['invoices'] })
    },
  })
}

export function useStudentLevels(studentId: string | null) {
  return useQuery({
    queryKey: queryKeys.studentLevels(studentId ?? ''),
    queryFn: () => api.studentLevels(studentId!),
    enabled: Boolean(studentId),
  })
}

export function useStudentPromotions(studentId: string | null) {
  return useQuery({
    queryKey: queryKeys.studentPromotions(studentId ?? ''),
    queryFn: () => api.studentPromotions(studentId!),
    enabled: Boolean(studentId),
  })
}

export function usePromoteStudent() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { studentId: string; body: Parameters<typeof api.promoteStudent>[1] }) =>
      api.promoteStudent(vars.studentId, vars.body),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.studentLevels(vars.studentId) })
      qc.invalidateQueries({ queryKey: queryKeys.studentPromotions(vars.studentId) })
      // A promotion moves the level shown in the table and resets the clock on
      // "ready for promotion".
      invalidateAcademy(qc)
    },
  })
}

/** The students table. The previous page stays on screen while the next loads, so
 *  changing a filter does not blank the table and jolt the layout. */
export function useRoster(query: RosterQuery) {
  return useQuery({
    queryKey: queryKeys.roster(query),
    queryFn: () => api.roster(query),
    placeholderData: keepPreviousData,
  })
}

export function useAttention() {
  return useQuery({ queryKey: queryKeys.attention, queryFn: () => api.attention() })
}

export function useAcademyOverview() {
  return useQuery({ queryKey: queryKeys.academyOverview, queryFn: () => api.academyOverview() })
}

export function useStudentProfile(studentId: string | null) {
  return useQuery({
    queryKey: queryKeys.studentProfile(studentId ?? ''),
    queryFn: () => api.studentProfile(studentId!),
    enabled: Boolean(studentId),
  })
}

export function useAddAssessment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { studentId: string; body: AssessmentBody }) =>
      api.addAssessment(vars.studentId, vars.body),
    onSuccess: () => invalidateAcademy(qc),
  })
}

/** Upload, then attach: the upload endpoint only returns a URL. Two calls in one
 *  mutation so a failure at either step is one error on the screen. */
export function useUploadStudentPhoto() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (vars: { studentId: string; file: File }) => {
      const uploaded = await api.uploadImage(vars.file)
      return api.updateStudent(vars.studentId, { photo_url: uploaded.url })
    },
    onSuccess: () => invalidateAcademy(qc),
  })
}

/* ── Customers ─────────────────────────────────────────────────────────────
 *
 * The payer behind a membership, and behind a student's fees. Enrolment and
 * membership sales both need to find one or make one, so it lives alongside
 * both rather than inside either.
 */

export type CustomerOut = components['schemas']['CustomerOut']

export function useCustomers(search?: string) {
  return useQuery({
    queryKey: ['customers', search ?? ''],
    queryFn: () => api.customers({ size: 100, ...(search ? { search } : {}) }),
  })
}

export function useCreateCustomer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Parameters<typeof api.createCustomer>[0]) => api.createCustomer(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['customers'] }),
  })
}


/* ── Staff ─────────────────────────────────────────────────────────────────── */

export type StaffOut = components['schemas']['UserOut']

export function useStaff(search?: string) {
  return useQuery({
    queryKey: ['staff', search ?? ''] as const,
    queryFn: () => api.staff({ size: 100, ...(search ? { search } : {}) }),
    placeholderData: keepPreviousData,
  })
}

export function useCreateStaff() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Parameters<typeof api.createStaff>[0]) => api.createStaff(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['staff'] }),
  })
}

export function useUpdateStaff() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { userId: string; body: Parameters<typeof api.updateStaff>[1] }) =>
      api.updateStaff(vars.userId, vars.body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['staff'] }),
  })
}
