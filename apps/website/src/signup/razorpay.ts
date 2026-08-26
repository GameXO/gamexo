/**
 * Razorpay Checkout, loaded on demand.
 *
 * The script is fetched when the owner reaches the plan screen rather than in
 * `index.html`, so a visitor who only reads the landing page never downloads a
 * payment SDK — and so a Razorpay outage cannot stop the marketing site rendering.
 *
 * Nothing here decides an amount. The order is created and priced server-side and
 * this only opens the sheet for an order id that already exists; a checkout that
 * could name its own price would be the whole vulnerability.
 */

const SCRIPT_SRC = 'https://checkout.razorpay.com/v1/checkout.js'

export type CheckoutResult = {
  razorpay_order_id: string
  razorpay_payment_id: string
  razorpay_signature: string
}

type RazorpayInstance = {
  open: () => void
  on: (event: string, handler: (payload: unknown) => void) => void
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance
  }
}

let loading: Promise<void> | null = null

export function loadCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve()

  // One shared promise: the plan screen and the pay button can both ask, and two
  // <script> tags for the same SDK is a race over one global.
  loading ??= new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`)
    const script = existing ?? document.createElement('script')
    script.src = SCRIPT_SRC
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => {
      loading = null
      reject(new Error('Could not load Razorpay Checkout.'))
    }
    if (!existing) document.head.appendChild(script)
  })

  return loading
}

/**
 * Open the sheet and resolve with what Razorpay hands back on success.
 *
 * Rejects when the sheet is dismissed, which is a normal thing for someone to do
 * and not an error worth a red banner — the caller distinguishes it by
 * `DismissedError` rather than by matching on a message string.
 */
export class DismissedError extends Error {
  constructor() {
    super('Payment was cancelled.')
    this.name = 'DismissedError'
  }
}

export async function openCheckout(opts: {
  keyId: string
  orderId: string
  amountPaise: number
  currency: string
  businessName: string
  description: string
  prefill: { name: string; email: string; contact?: string | null }
}): Promise<CheckoutResult> {
  await loadCheckout()
  const Razorpay = window.Razorpay
  if (!Razorpay) throw new Error('Razorpay Checkout is unavailable.')

  return new Promise<CheckoutResult>((resolve, reject) => {
    // `settled` guards the one case the SDK gets wrong: on some failure paths it
    // fires payment.failed *and* the dismiss handler, and without this the promise
    // would already be settled and the second call silently ignored — or worse,
    // a success would be followed by a spurious cancellation.
    let settled = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      fn()
    }

    const checkout = new Razorpay({
      key: opts.keyId,
      order_id: opts.orderId,
      amount: opts.amountPaise,
      currency: opts.currency,
      name: 'XCSports',
      description: opts.description,
      prefill: {
        name: opts.prefill.name,
        email: opts.prefill.email,
        contact: opts.prefill.contact ?? '',
      },
      notes: { business_name: opts.businessName },
      theme: { color: '#b5e770' },
      handler: (response: CheckoutResult) => finish(() => resolve(response)),
      modal: {
        ondismiss: () => finish(() => reject(new DismissedError())),
        // Without this, tapping the backdrop on mobile closes a sheet mid-payment.
        escape: false,
        backdropclose: false,
      },
    })

    checkout.on('payment.failed', (payload: unknown) => {
      const described = payload as { error?: { description?: string } } | undefined
      finish(() =>
        reject(
          new Error(
            described?.error?.description ??
              'The payment did not go through. No money has been taken — please try again.',
          ),
        ),
      )
    })

    checkout.open()
  })
}
