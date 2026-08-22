/**
 * The services a turf can switch on, with the copy that explains each one.
 *
 * The keys are the contract with `tenant_settings.enabled_services` (see
 * `SERVICE_KEYS` in the API's models/tenant.py) and with the sidebar's visibility
 * gate. One list, used by the onboarding wizard, the Settings → Services tab and
 * the navigation filter, so a service cannot be offered in one and forgotten in
 * another.
 */
export type ServiceKey =
  | 'booking'
  | 'checkin'
  | 'membership'
  | 'shop'
  | 'inventory'
  | 'academy'
  | 'events'
  | 'advertising'

export type ServiceDef = {
  key: ServiceKey
  label: string
  blurb: string
  /** Cannot be switched off. Without bookings there is no product. */
  locked?: boolean
}

export const SERVICES: ServiceDef[] = [
  {
    key: 'booking',
    label: 'Court bookings',
    blurb: 'Take bookings at the counter and online, with slot-clash protection.',
    locked: true,
  },
  {
    key: 'checkin',
    label: 'Check-in counter',
    blurb: 'Players check themselves in on a tablet using their booking ID.',
  },
  {
    key: 'shop',
    label: 'Shop',
    blurb: 'Sell drinks, grips and gear over the counter.',
  },
  {
    key: 'inventory',
    label: 'Inventory',
    blurb: 'Track rackets, balls and bibs — what is issued, returned and lost.',
  },
  {
    key: 'membership',
    label: 'Memberships',
    blurb: 'Monthly and annual plans, renewals and member pricing.',
  },
  {
    key: 'academy',
    label: 'Academy',
    blurb: 'Coaches, batches, students and attendance for your coaching programmes.',
  },
  {
    key: 'events',
    label: 'Events',
    blurb: 'Tournaments and one-off bookings that take the whole venue.',
  },
  {
    key: 'advertising',
    label: 'Advertising',
    blurb: 'Sell hoarding and banner space around the ground.',
  },
]

export const DEFAULT_SERVICES: Record<string, boolean> = {
  booking: true,
  checkin: true,
  inventory: true,
  shop: true,
  membership: false,
  academy: false,
  events: false,
  advertising: false,
}
