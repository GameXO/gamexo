/**
 * The academy's brand colours, and how they reach this dashboard.
 *
 * The three colours live on the academy's settings row and already style every
 * invoice and receipt email. The dashboard borrows two of them: the accent becomes
 * `--color-lime` (highlights, the active nav item, primary buttons) and the primary
 * becomes `--color-lime-ink` (text and icons sitting on that accent).
 *
 * An academy that has never touched them keeps the stock look. The stored defaults
 * are not the same green as the dashboard's built-in ink, so applying them blindly
 * would quietly recolour every academy on the day this shipped — `isStock` is what
 * stops that.
 */

export type Brand = { primary: string; accent: string; background: string }

/** What a new academy is given (see TenantSettings in the API). */
export const STOCK_BRAND: Brand = { primary: '#002E25', accent: '#B5E770', background: '#FDFFE7' }

export type BrandPreset = { id: string; name: string; blurb: string; brand: Brand }

export const BRAND_PRESETS: BrandPreset[] = [
  { id: 'lime', name: 'Lime', blurb: 'The default look.', brand: STOCK_BRAND },
  {
    id: 'ocean',
    name: 'Ocean',
    blurb: 'Cool blue, calm and clean.',
    brand: { primary: '#0B3C5D', accent: '#7CC6FE', background: '#F2F9FF' },
  },
  {
    id: 'violet',
    name: 'Violet',
    blurb: 'Soft purple, a little bolder.',
    brand: { primary: '#2E1A5C', accent: '#C4B5FD', background: '#F7F5FF' },
  },
  {
    id: 'sunset',
    name: 'Sunset',
    blurb: 'Warm orange on cream.',
    brand: { primary: '#5C1F0B', accent: '#FDBA74', background: '#FFF7ED' },
  },
]

const HEX = /^#[0-9a-f]{6}$/i

export const isHex = (value: string) => HEX.test(value)

/** "b5e770", "#B5E770" or " #b5e770 " -> "#B5E770"; null when it is not a colour. */
export function normaliseHex(value: string): string | null {
  const v = value.trim().replace(/^#?/, '#')
  return HEX.test(v) ? v.toUpperCase() : null
}

export const sameBrand = (a: Brand, b: Brand) =>
  a.primary.toUpperCase() === b.primary.toUpperCase() &&
  a.accent.toUpperCase() === b.accent.toUpperCase() &&
  a.background.toUpperCase() === b.background.toUpperCase()

export const isStock = (brand: Brand) =>
  brand.primary.toUpperCase() === STOCK_BRAND.primary && brand.accent.toUpperCase() === STOCK_BRAND.accent

// WCAG relative luminance, so text on the accent stays readable whatever colour an
// owner picks — a pale accent with a pale "ink" would be an invisible nav item.
function luminance(hex: string) {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2)
}

export function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** The primary where it reads against the accent, otherwise plain dark. */
export const inkFor = (brand: Brand) => (contrast(brand.accent, brand.primary) >= 4.5 ? brand.primary : '#111111')

const VARS = ['--color-lime', '--color-lime-ink'] as const

/** Point the dashboard's accent tokens at the academy's colours. */
export function applyBrand(brand: Brand | null) {
  const root = document.documentElement
  if (!brand || isStock(brand)) {
    for (const name of VARS) root.style.removeProperty(name)
    return
  }
  root.style.setProperty('--color-lime', brand.accent)
  root.style.setProperty('--color-lime-ink', inkFor(brand))
}
