/**
 * The signup API, as this site uses it.
 *
 * Every call here is unauthenticated and tenant-less, which is what makes this
 * client so much thinner than the dashboard's: there is no bearer token to attach
 * and no `X-Tenant-ID` to resolve, because the caller has neither an account nor an
 * academy yet. What stands in for both is the intent token — see `lib/session.ts`.
 */

const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000').replace(/\/$/, '')

export const DASHBOARD_URL_FALLBACK =
  import.meta.env.VITE_DASHBOARD_URL ?? 'http://localhost:5173'

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

  /** The email is already registered, or the signup is past the point of editing. */
  get isConflict() {
    return this.status === 409
  }
  /** The intent token is unknown or expired — both answer the same, deliberately. */
  get isGone() {
    return this.status === 404
  }
  /** `details.field` names the input to mark, when the API knew which one. */
  get field() {
    return typeof this.details.field === 'string' ? this.details.field : null
  }
}

async function request<T>(
  path: string,
  opts: { method?: string; body?: unknown; form?: FormData } = {},
): Promise<T> {
  const { method = 'GET', body, form } = opts

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    // FormData sets its own multipart boundary — setting Content-Type by hand here
    // omits the boundary and the server cannot parse a single field.
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
  })

  if (!res.ok) {
    let code = 'http_error'
    let message = `${res.status} ${res.statusText}`
    let details: Record<string, unknown> = {}
    try {
      const parsed = (await res.json()) as Partial<ErrorEnvelope>
      if (parsed?.error) {
        code = parsed.error.code ?? code
        message = parsed.error.message ?? message
        details = parsed.error.details ?? {}
      }
    } catch {
      /* non-JSON body (a proxy error page, say) — keep the status-line message */
    }
    throw new ApiError(res.status, code, message, details)
  }

  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

/* ── Shapes ─────────────────────────────────────────────────────────────────
 * Hand-written rather than generated. The dashboard generates from the OpenAPI
 * schema because it calls sixty endpoints; this site calls seven, and a generated
 * client would mean this app could not build without a Python venv present.
 */

export type Plan = {
  code: string
  name: string
  tagline: string
  price_monthly_paise: number
  price_yearly_paise: number
  currency: string
  features: string[]
  max_courts: number | null
  max_staff: number | null
  popular: boolean
}

export type BillingPeriod = 'monthly' | 'yearly'

export type SportPick = { slug: string; name?: string | null }

export type Signup = {
  status: 'draft' | 'awaiting_payment' | 'provisioning' | 'completed' | 'failed'
  email: string
  full_name: string
  phone: string | null
  business_name: string | null
  logo_url: string | null
  city: string | null
  address: string | null
  sports: SportPick[]
  services: Record<string, boolean>
  accepted_terms: boolean
  plan_code: string | null
  billing_period: string | null
  amount_paise: number | null
  currency: string
  paid_at: string | null
  tenant_slug: string | null
  /** False when the welcome email — the one with the password — did not go out. */
  credentials_emailed: boolean
}

export type Order = {
  order_id: string
  amount_paise: number
  currency: string
  /** `mock` when no Razorpay keys are configured — see `signup/Checkout.tsx`. */
  provider: 'razorpay' | 'mock'
  key_id: string
  prefill_name: string
  prefill_email: string
  prefill_contact: string | null
  business_name: string | null
}

export type Verified = {
  signup: Signup
  /** Null once a handoff has already been redeemed — then send them to the login. */
  handoff_token: string | null
  dashboard_url: string
}

export type UpdateSignup = Partial<{
  business_name: string
  logo_url: string
  city: string
  address: string
  phone: string
  sports: SportPick[]
  services: Record<string, boolean>
  accepted_terms: boolean
}>

export type CatalogueSport = {
  slug: string
  name: string
  icon: string
  color: string
  bg_color: string
}

export const api = {
  plans: () => request<Plan[]>('/api/v1/signup/plans'),

  /** The sports picker's options. Fetched, not hardcoded, so a slug sent from the
   *  wizard always matches one the API stocks and arrives priced. */
  sports: () => request<CatalogueSport[]>('/api/v1/signup/sports'),

  /** 409 if the email already signs in somewhere on the platform. */
  startSignup: (body: { email: string; full_name: string; phone?: string }) =>
    request<{ token: string; signup: Signup }>('/api/v1/signup/intent', {
      method: 'POST',
      body,
    }),

  readSignup: (token: string) => request<Signup>(`/api/v1/signup/intent/${token}`),

  /** Omitted fields are left alone, so one step cannot blank another's answers. */
  saveSignup: (token: string, body: UpdateSignup) =>
    request<Signup>(`/api/v1/signup/intent/${token}`, { method: 'PATCH', body }),

  uploadLogo: (token: string, file: File) => {
    const form = new FormData()
    form.append('file', file)
    return request<{ url: string; content_type: string; size: number }>(
      `/api/v1/signup/intent/${token}/logo`,
      { method: 'POST', form },
    )
  },

  /** The amount is priced server-side from the plan code. Never sent from here. */
  createOrder: (token: string, body: { plan_code: string; billing_period: BillingPeriod }) =>
    request<Order>(`/api/v1/signup/intent/${token}/order`, { method: 'POST', body }),

  /** The three values Razorpay Checkout hands us on success. */
  verifyPayment: (
    token: string,
    body: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string },
  ) => request<Verified>(`/api/v1/signup/intent/${token}/verify`, { method: 'POST', body }),

  /** Development only — present only where the API has no Razorpay keys. */
  mockPay: (token: string) =>
    request<Verified>(`/api/v1/signup/intent/${token}/mock-pay`, { method: 'POST' }),
}

/** `249900` → `₹2,499`. Amounts cross the wire as integer paise; see plans.py. */
export function rupees(paise: number, opts: { decimals?: boolean } = {}) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: opts.decimals ? 2 : 0,
    maximumFractionDigits: opts.decimals ? 2 : 0,
  }).format(paise / 100)
}
