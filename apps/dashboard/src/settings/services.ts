/**
 * The services the counter tablet offers, and the copy that explains each one.
 *
 * These four are the tiles on the POS home screen (apps/pos/src/home/Home.tsx).
 * Turning one off here removes it from the tablet — that is the whole purpose of
 * the switch, so the label here and the tile there must stay in step.
 *
 * The keys are the contract with `tenant_settings.enabled_services`, whose full
 * vocabulary is `SERVICE_KEYS` in the API's models/tenant.py. That list is longer
 * than this one: `booking`, `inventory`, `events` and `advertising` also exist and
 * are deliberately absent, because nothing on the counter is gated on them yet and
 * a switch that changes nothing is worse than no switch.
 *
 * The API merges rather than replaces on PATCH (see modules/admin/router.py), so
 * sending only these four cannot clear the others.
 */
export type PosServiceKey = 'checkin' | 'shop' | 'academy' | 'membership'

export type ServiceDef = {
  key: PosServiceKey
  label: string
  blurb: string
}

export const POS_SERVICES: ServiceDef[] = [
  {
    key: 'checkin',
    label: 'Check-in',
    blurb: 'Look a booking up by ID or phone and mark the players in.',
  },
  {
    key: 'shop',
    label: 'Shop',
    blurb: 'Kit rental and counter sales, billed to the booking or paid outright.',
  },
  {
    key: 'academy',
    label: 'Academy',
    blurb: 'Batches, coaches and student attendance taken at the desk.',
  },
  {
    key: 'membership',
    label: 'Membership',
    blurb: 'Sell and renew passes and packages from the counter.',
  },
]

/** Default to on for an academy whose settings predate a key being added. */
export function isEnabled(
  services: Record<string, unknown> | undefined,
  key: PosServiceKey,
): boolean {
  return services?.[key] !== false
}
