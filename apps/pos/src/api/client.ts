/**
 * Typed fetch wrapper over the gamexo API — same shape as the dashboard's
 * (apps/web/src/api/client.ts). This app is a separate deployable that talks
 * to the same backend/database, so it carries its own copy rather than a
 * cross-app import.
 *
 * No runtime dependency by design — paths and payloads are typed from the
 * generated `schema.d.ts`, so a backend change that breaks a call site shows up
 * at `tsc` time rather than in the browser.
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
        // No tenant header: the refresh token names its own academy, and a header
        // naming a different one is refused rather than ignored. See `request`.
        headers: { 'Content-Type': 'application/json' },
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
    // No `X-Tenant-ID`, deliberately — the counter tablet must not name its own
    // academy. `VITE_TENANT_SLUG` bakes one fixed slug into the bundle, and that
    // header outranks everything else in tenant resolution (see
    // `app/tenancy/resolver.py::_plan_resolution`), so on a build shared by more
    // than one turf it would point every request at the wrong one.
    //
    // The kiosk login breaks first and most confusingly: login carries no token, so
    // the academy is found from the email in `account_directory`, and a header
    // sends that lookup somewhere the user does not exist — turning a correct
    // password into "Incorrect email or password". Resolution is left to the host
    // subdomain, or to the signed `tid` claim once signed in.
    const headers: Record<string, string> = {}
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
  /** The counter's shared credential — `kiosk@navigo-sports`, from the welcome
   *  email. An admin's username works too; the role hierarchy admits it. */
  login: (username: string, password: string) =>
    request<Ok<'/api/v1/auth/login', 'post'>>('/api/v1/auth/login', {
      method: 'POST',
      body: { username, password },
      anonymous: true,
    }),

  me: () => request<Ok<'/api/v1/auth/me', 'get'>>('/api/v1/auth/me'),

  /** Returns a plain array, not a page. */
  listSports: (query?: { include_inactive?: boolean }) =>
    request<Ok<'/api/v1/sports', 'get'>>('/api/v1/sports', { query }),

  /** Plain array too. `at` asks for occupancy as of an instant. */
  listCourts: (query?: { sport_id?: string; at?: string }) =>
    request<Ok<'/api/v1/courts', 'get'>>('/api/v1/courts', { query }),

  /** Real per-slot availability for a day — powers the walk-in wizard's time grid. */
  courtAvailability: (query: {
    date: string
    duration_min?: number
    sport_id?: string
    court_id?: string
    slot_minutes?: number
  }) => request<Ok<'/api/v1/courts/availability', 'get'>>('/api/v1/courts/availability', { query }),

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

  getBooking: (bookingId: string) =>
    request<Ok<'/api/v1/bookings/{booking_id}', 'get'>>(`/api/v1/bookings/${bookingId}`),

  /** Check-in by booking id — 404s if there's no match, or the match is outside its
   *  ±30 minute window. `code` can be our own booking id or a partner's reference. */
  checkinLookup: (code: string) =>
    request<Ok<'/api/v1/bookings/checkin-lookup', 'get'>>('/api/v1/bookings/checkin-lookup', {
      query: { code },
    }),

  /** Same id matching as checkinLookup, but for settling a bill — any started,
   *  not-cancelled booking from the last 12 hours, no upper time bound. */
  checkoutLookup: (code: string) =>
    request<Ok<'/api/v1/bookings/checkout-lookup', 'get'>>('/api/v1/bookings/checkout-lookup', {
      query: { code },
    }),

  /** Prices a booking without creating it — used for the live invoice preview. */
  quoteBooking: (body: {
    court_id: string
    starts_at: string
    duration_min: number
    equipment?: { equipment_id: string; qty: number; mode?: 'rent' | 'buy'; unit?: 'single' | 'pack' }[]
    discount?: number
  }) => request<Ok<'/api/v1/bookings/quote', 'post'>>('/api/v1/bookings/quote', { method: 'POST', body }),

  createBooking: (body: {
    court_id: string
    starts_at: string
    duration_min: number
    customer_name?: string
    customer_phone?: string
    customer_id?: string
    notes?: string
    equipment?: { equipment_id: string; qty: number; mode?: 'rent' | 'buy'; unit?: 'single' | 'pack' }[]
    booking_type?: 'walkin' | 'online'
  }) =>
    request<Ok<'/api/v1/bookings', 'post', 201>>('/api/v1/bookings', { method: 'POST', body }),

  /**
   * Replace a booking's kit and re-price.
   *
   * The counter is deliberately NOT allowed to reach `PATCH /bookings/{id}` — that
   * endpoint also moves bookings between courts and times, which is desk-admin work.
   * The kiosk login is refused there with a 403, so adding a racket mid-game goes
   * through this narrower endpoint instead.
   *
   * Send the COMPLETE list, not just the new items: this replaces rather than adds,
   * and callers already merge against the booking's existing lines before calling.
   */
  setBookingEquipment: (
    bookingId: string,
    equipment: { equipment_id: string; qty: number; mode?: 'rent' | 'buy'; unit?: 'single' | 'pack' }[],
  ) =>
    request<Ok<'/api/v1/bookings/{booking_id}/equipment', 'put'>>(
      `/api/v1/bookings/${bookingId}/equipment`,
      { method: 'PUT', body: { equipment } },
    ),

  /** Idempotent — a booking that already has one returns the existing invoice. */
  invoiceBooking: (bookingId: string) =>
    request<Ok<'/api/v1/bookings/{booking_id}/invoice', 'post', 201>>(`/api/v1/bookings/${bookingId}/invoice`, {
      method: 'POST',
    }),

  /** Sends the invoice from the server, synchronously — a 502 means it did not go.
   *  `to` overrides the address on file, for one message only. */
  emailBookingInvoice: (bookingId: string, to?: string) =>
    request<Ok<'/api/v1/bookings/{booking_id}/invoice/email', 'post'>>(
      `/api/v1/bookings/${bookingId}/invoice/email`,
      { method: 'POST', body: { to: to || null } },
    ),

  listEquipment: (query?: {
    category?: string
    sport_id?: string
    published_to_pos?: boolean
    page?: number
    size?: number
  }) =>
    request<Ok<'/api/v1/equipment', 'get'>>('/api/v1/equipment', { query }),

  recordPayment: (body: {
    amount: number
    method: 'cash' | 'upi' | 'card' | 'bank' | 'cheque'
    booking_id?: string
    customer_id?: string
    notes?: string
  }) => request<unknown>('/api/v1/payments', { method: 'POST', body }),
}

export { request, BASE_URL, TENANT }
