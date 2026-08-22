/**
 * Typed fetch wrapper over the gamexo API.
 *
 * No runtime dependency by design — paths and payloads are typed from the
 * generated `schema.d.ts`, so a backend change that breaks a call site shows up
 * at `tsc` time rather than in the browser.
 *
 * Two things every request needs and none of the call sites should have to
 * remember: the bearer token, and the tenant. Both are attached here.
 */
import type { paths } from './schema'
import { getTokens, setTokens, clearTokens } from './auth'

const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000').replace(/\/$/, '')
const TENANT = import.meta.env.VITE_TENANT_SLUG ?? 'xcourt'

/** The shared error envelope from the API — see app/core/errors.py::_envelope. */
type ErrorEnvelope = {
  error: { code: string; message: string; details?: Record<string, unknown> }
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: Record<string, unknown>

  constructor(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }

  get isUnauthenticated() {
    return this.status === 401
  }
  get isForbidden() {
    return this.status === 403
  }
  get isNotFound() {
    return this.status === 404
  }
  get isConflict() {
    return this.status === 409
  }
}

async function toApiError(res: Response): Promise<ApiError> {
  let code = 'http_error'
  let message = `${res.status} ${res.statusText}`
  let details: Record<string, unknown> = {}
  try {
    const body = (await res.json()) as Partial<ErrorEnvelope>
    if (body?.error) {
      code = body.error.code ?? code
      message = body.error.message ?? message
      details = body.error.details ?? {}
    }
  } catch {
    /* non-JSON body (a proxy error page, say) — keep the status-line message */
  }
  return new ApiError(res.status, code, message, details)
}

type Query = Record<string, string | number | boolean | undefined | null>

function withQuery(path: string, query?: Query) {
  if (!query) return path
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null) params.set(k, String(v))
  }
  const qs = params.toString()
  return qs ? `${path}?${qs}` : path
}

/**
 * A single in-flight refresh, shared by every 401 that lands while it runs.
 * Without this, a screen firing five queries at once on an expired token would
 * start five refreshes and four of them would race to store a stale pair.
 */
let refreshing: Promise<boolean> | null = null

async function refreshOnce(): Promise<boolean> {
  const tokens = getTokens()
  if (!tokens?.refresh_token) return false

  refreshing ??= (async () => {
    try {
      const res = await fetch(`${BASE_URL}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': TENANT },
        body: JSON.stringify({ refresh_token: tokens.refresh_token }),
      })
      if (!res.ok) {
        clearTokens()
        return false
      }
      setTokens(await res.json())
      return true
    } catch {
      return false
    } finally {
      refreshing = null
    }
  })()

  return refreshing
}

type RequestOptions = {
  method?: string
  body?: unknown
  query?: Query
  /** Login/refresh send no bearer — they are how you get one. */
  anonymous?: boolean
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, anonymous = false } = opts

  const send = async (): Promise<Response> => {
    const headers: Record<string, string> = { 'X-Tenant-ID': TENANT }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (!anonymous) {
      const token = getTokens()?.access_token
      if (token) headers.Authorization = `Bearer ${token}`
    }
    return fetch(`${BASE_URL}${withQuery(path, query)}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  }

  let res = await send()

  // One transparent refresh, then retry. If the retry also 401s we surface it
  // rather than looping — the session is genuinely gone.
  if (res.status === 401 && !anonymous && (await refreshOnce())) {
    res = await send()
  }

  if (!res.ok) throw await toApiError(res)
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

/* ── typed helpers ──────────────────────────────────────────────────────────
 * `Ok<P, M, S>` pulls a response body for a path+method+status straight out of
 * the generated schema, so these return types track the backend automatically.
 */
type Ok<P extends keyof paths, M extends keyof paths[P], S extends number = 200> = paths[P][M] extends {
  responses: infer R
}
  ? S extends keyof R
    ? R[S] extends { content: { 'application/json': infer J } }
      ? J
      : never
    : never
  : never

export const api = {
  signup: (body: { email: string; password: string; full_name: string }) =>
    request<import('./auth').TokenPair>('/api/v1/auth/signup', {
      method: 'POST',
      body,
      anonymous: true,
    }),

  login: (email: string, password: string) =>
    request<Ok<'/api/v1/auth/login', 'post'>>('/api/v1/auth/login', {
      method: 'POST',
      body: { email, password },
      anonymous: true,
    }),

  me: () => request<Ok<'/api/v1/auth/me', 'get'>>('/api/v1/auth/me'),

  getSettings: () => request<Record<string, unknown>>('/api/v1/settings'),
  updateSettings: (body: Record<string, unknown>) =>
    request<Record<string, unknown>>('/api/v1/settings', { method: 'PATCH', body }),

  listSportCatalogue: () => request<Record<string, unknown>[]>('/api/v1/sports/catalogue'),
  createSport: (body: Record<string, unknown>) =>
    request<Record<string, unknown>>('/api/v1/sports', { method: 'POST', body }),
  updateSport: (id: string, body: Record<string, unknown>) =>
    request<Record<string, unknown>>(`/api/v1/sports/${id}`, { method: 'PATCH', body }),
  deleteSport: (id: string) => request<void>(`/api/v1/sports/${id}`, { method: 'DELETE' }),

  createCourt: (body: Record<string, unknown>) =>
    request<Record<string, unknown>>('/api/v1/courts', { method: 'POST', body }),
  updateCourt: (id: string, body: Record<string, unknown>) =>
    request<Record<string, unknown>>(`/api/v1/courts/${id}`, { method: 'PATCH', body }),
  deleteCourt: (id: string) => request<void>(`/api/v1/courts/${id}`, { method: 'DELETE' }),

  completeOnboarding: (body: Record<string, unknown>) =>
    request<Record<string, unknown>>('/api/v1/onboarding/complete', { method: 'POST', body }),

  uploadImage: async (file: File): Promise<{ url: string; content_type: string; size: number }> => {
    const headers: Record<string, string> = { 'X-Tenant-ID': TENANT }
    const token = getTokens()?.access_token
    if (token) headers.Authorization = `Bearer ${token}`
    const form = new FormData()
    form.append('file', file)
    const res = await fetch(`${BASE_URL}/api/v1/uploads`, { method: 'POST', headers, body: form })
    if (!res.ok) throw await toApiError(res)
    return (await res.json()) as { url: string; content_type: string; size: number }
  },

  /** Returns a plain array, not a page. */
  listSports: (query?: { include_inactive?: boolean }) =>
    request<Ok<'/api/v1/sports', 'get'>>('/api/v1/sports', { query }),

  /** Plain array too. `at` asks for occupancy as of an instant. */
  listCourts: (query?: { sport_id?: string; at?: string }) =>
    request<Ok<'/api/v1/courts', 'get'>>('/api/v1/courts', { query }),

  /** The one paged endpoint of the three — `{ items, total, page, size, pages }`. */
  listBookings: (query?: {
    status?: string
    court_id?: string
    date_from?: string
    date_to?: string
    search?: string
    page?: number
    size?: number
  }) => request<Ok<'/api/v1/bookings', 'get'>>('/api/v1/bookings', { query }),

  /** Prices a draft without creating it. Court hire is rated server-side (peak,
   *  weekend), so the wizard has to ask rather than compute the total it is about
   *  to charge — this is what keeps the quote and the booking in agreement. */
  quoteBooking: (body: {
    court_id: string
    starts_at: string
    duration_min: number
    equipment?: { equipment_id: string; qty: number; mode?: 'rent' | 'buy'; unit?: 'single' | 'pack' }[]
    discount?: number
  }) =>
    request<Ok<'/api/v1/bookings/quote', 'post'>>('/api/v1/bookings/quote', { method: 'POST', body }),

  /** 409 when any part of the slot is already taken — enforced by a Postgres
   *  exclusion constraint, so it is authoritative rather than a racy pre-check. */
  createBooking: (body: {
    court_id: string
    starts_at: string
    duration_min: number
    customer_id?: string
    customer_name?: string
    customer_phone?: string
    booking_type?: 'walkin' | 'online'
    equipment?: { equipment_id: string; qty: number; mode?: 'rent' | 'buy'; unit?: 'single' | 'pack' }[]
    discount?: number
    notes?: string
  }) => request<Ok<'/api/v1/bookings', 'post', 201>>('/api/v1/bookings', { method: 'POST', body }),

  /**
   * Edit a booking. Desk-admin only — the kiosk login is refused with a 403.
   *
   * Re-prices only if the court, time, duration, equipment or discount change; a
   * status- or notes-only patch does not.
   *
   * Two things worth knowing before calling:
   *
   * - OMIT `equipment` to keep the booking's existing kit. Sending `[]` clears it.
   *   The two are different intentions and the server distinguishes them, so never
   *   send `equipment: []` as a filler value when changing the time.
   * - `status: 'cancelled'` is rejected with a 409. Cancelling has to release the
   *   slot and settle the refund, which only `cancelBooking` does.
   */
  updateBooking: (
    bookingId: string,
    body: Partial<{
      status: 'upcoming' | 'active' | 'overdue' | 'completed'
      court_id: string
      starts_at: string
      duration_min: number
      equipment: { equipment_id: string; qty: number; mode?: 'rent' | 'buy'; unit?: 'single' | 'pack' }[]
      discount: number
      notes: string
      customer_name: string
      customer_phone: string
    }>,
  ) =>
    request<Ok<'/api/v1/bookings/{booking_id}', 'patch'>>(`/api/v1/bookings/${bookingId}`, {
      method: 'PATCH',
      body,
    }),

  /** 409 with the maximum possible extension if another booking already follows. */
  extendBooking: (bookingId: string, additionalMinutes: number) =>
    request<Ok<'/api/v1/bookings/{booking_id}/extend', 'post'>>(
      `/api/v1/bookings/${bookingId}/extend`,
      { method: 'POST', body: { additional_minutes: additionalMinutes } },
    ),

  cancelBooking: (bookingId: string, reason?: string) =>
    request<Ok<'/api/v1/bookings/{booking_id}/cancel', 'post'>>(
      `/api/v1/bookings/${bookingId}/cancel`,
      { method: 'POST', body: { reason } },
    ),

  listInvoices: (query?: { status?: string; customer_id?: string; search?: string; page?: number; size?: number }) =>
    request<Ok<'/api/v1/invoices', 'get'>>('/api/v1/invoices', { query }),

  /** An invoice with no booking behind it — the counter tab for a walk-in buying
   *  kit or drinks without hiring a court. */
  createInvoice: (body: {
    customer_name: string
    customer_id?: string
    items: { description: string; qty: number; rate: number; amount: number }[]
    discount?: number
    notes?: string
  }) => request<Ok<'/api/v1/invoices', 'post', 201>>('/api/v1/invoices', { method: 'POST', body }),

  recordPayment: (body: {
    amount: number
    method: 'cash' | 'upi' | 'card' | 'bank' | 'cheque'
    /** Settles a court booking; `invoice_id` settles a counter tab. */
    booking_id?: string
    invoice_id?: string
    customer_id?: string
    reference?: string
    notes?: string
  }) => request<unknown>('/api/v1/payments', { method: 'POST', body }),

  listEquipment: (query?: {
    category?: string
    low_stock_only?: boolean
    sport_id?: string
    published_to_pos?: boolean
    page?: number
    size?: number
  }) => request<Ok<'/api/v1/equipment', 'get'>>('/api/v1/equipment', { query }),

  createEquipment: (body: {
    name: string
    category: string
    barcode: string
    rental_price?: number
    sale_price?: number
    for_rent?: boolean
    for_sale?: boolean
    pack_size?: number
    pack_price?: number
    deposit?: number
    condition?: 'excellent' | 'good' | 'fair' | 'poor'
    low_stock_threshold?: number
    sport_id?: string | null
    published_to_pos?: boolean
    image_url?: string | null
    consumable?: boolean
    qty_stock?: number
  }) =>
    request<Ok<'/api/v1/equipment', 'post', 201>>('/api/v1/equipment', { method: 'POST', body }),

  updateEquipment: (
    equipmentId: string,
    body: Partial<{
      name: string
      category: string
      rental_price: number
      sale_price: number
      for_rent: boolean
      for_sale: boolean
      pack_size: number
      pack_price: number
      deposit: number
      condition: 'excellent' | 'good' | 'fair' | 'poor'
      low_stock_threshold: number
      sport_id: string | null
      published_to_pos: boolean
      image_url: string | null
      consumable: boolean
    }>,
  ) =>
    request<Ok<'/api/v1/equipment/{equipment_id}', 'patch'>>(`/api/v1/equipment/${equipmentId}`, {
      method: 'PATCH',
      body,
    }),

  deleteEquipment: (equipmentId: string) =>
    request<void>(`/api/v1/equipment/${equipmentId}`, { method: 'DELETE' }),

  createMovement: (
    equipmentId: string,
    body: {
      kind: 'issue' | 'return' | 'to_maintenance' | 'from_maintenance' | 'lost' | 'restock' | 'adjust' | 'write_off'
      qty: number
      booking_id?: string
      note?: string
    },
  ) =>
    request<Ok<'/api/v1/equipment/{equipment_id}/movements', 'post', 201>>(
      `/api/v1/equipment/${equipmentId}/movements`,
      { method: 'POST', body },
    ),

  listMovements: (equipmentId: string, query?: { page?: number; size?: number }) =>
    request<Ok<'/api/v1/equipment/{equipment_id}/movements', 'get'>>(
      `/api/v1/equipment/${equipmentId}/movements`,
      { query },
    ),

  /* ── Manage → Integrations ─────────────────────────────────────────────────
   * Two halves of one screen. Payment gateways are the academy's own Razorpay /
   * Cashfree / PhonePe accounts; booking platforms are the outbound API keys that
   * let Playo and Hudle sell our courts.
   *
   * Everything here is admin-only except `activeGateway`, which the counter needs.
   */

  /** Supported gateways, the fields each one wants, and what is saved — one call.
   *
   *  No secret is ever in this response. A saved secret comes back as
   *  `secret_hints`, the last four characters, which is enough to recognise a key
   *  and useless to anyone who intercepts it. */
  listPaymentProviders: () =>
    request<Ok<'/api/v1/payments/providers', 'get'>>('/api/v1/payments/providers'),

  /**
   * Connect a gateway, or replace its credentials. Same call for both.
   *
   * **Send a secret field only when it changed.** Blank means "keep the stored
   * value" — the browser never had the real secret, so an edit that only flips the
   * mode must not submit an empty Key Secret and wipe a working key.
   *
   * 400 with `details.problems` (an array of plain-language strings) when the
   * credentials do not look right — a test key saved as live, a missing field.
   */
  savePaymentProvider: (
    provider: string,
    body: { mode: 'test' | 'live'; values: Record<string, string>; verify?: boolean },
  ) =>
    request<Ok<'/api/v1/payments/providers/{provider}', 'put'>>(
      `/api/v1/payments/providers/${provider}`,
      { method: 'PUT', body },
    ),

  /** Re-check stored credentials against the provider.
   *
   *  `checked_live: false` means we could not actually ask — PhonePe and PayU have
   *  no read-only endpoint to test against, or the call did not complete. That is
   *  not the same as a wrong credential, and the UI must not show it as one. */
  verifyPaymentProvider: (provider: string) =>
    request<Ok<'/api/v1/payments/providers/{provider}/verify', 'post'>>(
      `/api/v1/payments/providers/${provider}/verify`,
      { method: 'POST' },
    ),

  /** Choose which surfaces this gateway collects for. Omit a field to leave it
   *  alone — so changing the dashboard cannot silently reset the counter.
   *
   *  Turning a surface on takes it from whichever gateway currently holds it: only
   *  one gateway can collect per surface, enforced by a unique index. */
  setPaymentRouting: (provider: string, body: { collect_on_web?: boolean; collect_on_pos?: boolean }) =>
    request<Ok<'/api/v1/payments/providers/{provider}/routing', 'patch'>>(
      `/api/v1/payments/providers/${provider}/routing`,
      { method: 'PATCH', body },
    ),

  /** Delete the stored credentials. Also the only way to remove a secret, since a
   *  blank field on save means "keep". */
  disconnectPaymentProvider: (provider: string) =>
    request<void>(`/api/v1/payments/providers/${provider}`, { method: 'DELETE' }),

  /** Which gateway collects on this surface. `null` — not an error — means none is
   *  configured and the counter takes cash/UPI as before. Public half only. */
  activeGateway: (surface: 'web' | 'pos') =>
    request<Ok<'/api/v1/payments/active', 'get'>>('/api/v1/payments/active', {
      query: { surface },
    }),

  listPartners: () => request<Ok<'/api/v1/partners', 'get'>>('/api/v1/partners'),

  /** The response carries `api_key` and it is **the only time it exists in a form
   *  anyone can copy** — only a hash is stored. Show it, do not log it. */
  createPartner: (body: { name: string; slug: string }) =>
    request<Ok<'/api/v1/partners', 'post', 201>>('/api/v1/partners', { method: 'POST', body }),

  /** `is_active: false` revokes immediately. Bookings the partner already made are
   *  untouched and keep their `source_platform`. */
  updatePartner: (partnerId: string, body: { name?: string; is_active?: boolean }) =>
    request<Ok<'/api/v1/partners/{partner_id}', 'patch'>>(`/api/v1/partners/${partnerId}`, {
      method: 'PATCH',
      body,
    }),

  /** Invalidates the old key the moment it returns — there is no overlap window. */
  rotatePartnerKey: (partnerId: string) =>
    request<Ok<'/api/v1/partners/{partner_id}/rotate-key', 'post'>>(
      `/api/v1/partners/${partnerId}/rotate-key`,
      { method: 'POST' },
    ),

  /** 409 while any booking still references the partner — revoke instead. */
  deletePartner: (partnerId: string) =>
    request<void>(`/api/v1/partners/${partnerId}`, { method: 'DELETE' }),
}

export function mediaUrl(url: string) {
  return url.startsWith('http://') || url.startsWith('https://') ? url : `${BASE_URL}${url}`
}

export { request, BASE_URL, TENANT }
