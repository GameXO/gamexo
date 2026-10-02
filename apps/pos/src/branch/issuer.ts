/**
 * Who a bill is from: the business, and the branch it was raised at.
 *
 * Built from the server's own records — the booking's branch when there is a booking,
 * the tablet's selected branch before there is one. Nothing here is a constant baked
 * into the bundle, which is what an invoice header used to be.
 */

export type Issuer = {
  /** The business — the legal entity. */
  name: string
  /** The site; null when it only repeats the business name. */
  branchName: string | null
  addressLine: string
  phone: string | null
  /** Already resolved by the server: the branch's own, else the business's. */
  gstin: string | null
}

export type BranchLike = {
  name: string
  address?: string | null
  city?: string | null
  state?: string | null
  pincode?: string | null
  phone?: string | null
  gstin?: string | null
  /** Present on `GET /branches`; `BranchInfo` on a booking is already resolved into `gstin`. */
  effective_gstin?: string | null
}

export const NO_ISSUER: Issuer = { name: '', branchName: null, addressLine: '', phone: null, gstin: null }

/** "Survey 42, Kondapur, Hyderabad, Telangana 500084" — whatever of it exists. */
export const addressOf = (b: Pick<BranchLike, 'address' | 'city' | 'state' | 'pincode'>) =>
  [b.address, b.city, [b.state, b.pincode].filter(Boolean).join(' ')].filter(Boolean).join(', ')

export function issuerFrom(businessName: string, branch?: BranchLike | null): Issuer {
  if (!branch) return { ...NO_ISSUER, name: businessName }
  return {
    name: businessName,
    // Hidden when it just repeats the business name — a single-site academy whose only
    // branch is called after itself should not print its name twice.
    branchName: branch.name.trim().toLowerCase() === businessName.trim().toLowerCase() ? null : branch.name,
    addressLine: addressOf(branch),
    phone: branch.phone ?? null,
    gstin: branch.effective_gstin ?? branch.gstin ?? null,
  }
}

type BookedVia = 'counter' | 'office_desk' | 'partner' | null | undefined

/** How a booking's source reads on the receipt. The counter tablet is "POS". */
export function sourceLabel(via: BookedVia, platformSlug?: string | null): string | null {
  if (via === 'counter') return 'POS'
  if (via === 'office_desk') return 'Office Desk'
  if (via === 'partner') return platformSlug ? platformSlug.charAt(0).toUpperCase() + platformSlug.slice(1) : 'Partner'
  return null
}
