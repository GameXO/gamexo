/**
 * What the Integrations screen lists, as one flat catalogue.
 *
 * The API serves two unrelated lists — payment gateways (`ProviderOut`) and the
 * contracts a booking platform can speak (`DialectOut`, with the keys issued
 * against each as `PartnerOut`). The screen shows them as one grid of cards, so
 * this folds both into a single shape. Nothing here is stored: it is derived on
 * every render from the two queries, which is why a rotated key or a toggled
 * gateway shows up without anything to invalidate.
 */
import type { DialectOut, PartnerOut, ProviderOut } from './hooks'

export type GatewayItem = {
  kind: 'gateway'
  key: string
  name: string
  summary: string
  provider: ProviderOut
  connected: boolean
  ready: true
}

export type PlatformItem = {
  kind: 'platform'
  key: string
  name: string
  summary: string
  dialect: DialectOut
  /** Keys issued against this contract. A platform is "connected" once it has one. */
  partners: PartnerOut[]
  connected: boolean
  /** False for a platform whose API spec has not arrived: listed, not connectable. */
  ready: boolean
}

export type IntegrationItem = GatewayItem | PlatformItem

/** The one dialect that is our own contract. Its card is named for who uses it
 *  (a venue's own website), not for our API — see the note in `PlatformDrawer`. */
export const platformName = (d: DialectOut) => (d.is_default ? 'Your own website or app' : d.label)

export const platformSummary = (d: DialectOut) =>
  d.is_default
    ? 'A venue website or custom app that books straight into your courts.'
    : d.summary

export function buildCatalog(
  providers: ProviderOut[],
  dialects: DialectOut[],
  partners: PartnerOut[],
): { gateways: GatewayItem[]; platforms: PlatformItem[] } {
  const gateways: GatewayItem[] = providers.map((provider) => ({
    kind: 'gateway',
    key: `gateway:${provider.id}`,
    name: provider.label,
    summary: provider.tagline,
    provider,
    connected: Boolean(provider.config),
    ready: true,
  }))

  // Named platforms first, the "none of the above" own-website contract last.
  const offered = [
    ...dialects.filter((d) => d.is_platform),
    ...dialects.filter((d) => !d.is_platform && d.is_default),
  ]
  const platforms: PlatformItem[] = offered.map((dialect) => {
    const keys = partners.filter((p) => p.dialect === dialect.slug)
    return {
      kind: 'platform',
      key: `platform:${dialect.slug}`,
      name: platformName(dialect),
      summary: platformSummary(dialect),
      dialect,
      partners: keys,
      connected: keys.length > 0,
      ready: dialect.is_ready,
    }
  })

  return { gateways, platforms }
}

/** Connected first, then catalogue order. `sort` is stable, so ties keep the API's order. */
export const connectedFirst = <T extends IntegrationItem>(items: T[]) =>
  [...items].sort((a, b) => Number(b.connected) - Number(a.connected))

/** Brand tints for the logo tile. No third-party logo files are bundled, so a
 *  coloured initial stands in for each; an unknown id falls back to ink. */
const TINT: Record<string, string> = {
  razorpay: '#0b3cc1',
  cashfree: '#5a2ac0',
  phonepe: '#5f259f',
  payu: '#0b8f3a',
  stripe: '#5b53f0',
  playo: '#00a86b',
  hudle: '#ff6a2b',
  district: '#e11d48',
}

export const tintFor = (id: string) => TINT[id] ?? '#232323'

export const relative = (iso: string) => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}
