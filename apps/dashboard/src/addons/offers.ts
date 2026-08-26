/**
 * What an add-on can be taken as.
 *
 * One catalogue row produces up to three offers — rent by the hour, buy one, buy a
 * pack — and every shop-facing screen has to agree on which. Shared rather than
 * duplicated per screen: the booking wizard and the counter both sell the same
 * shelf, and the two drifting is how a customer ends up billed for something the
 * other screen said was not on offer.
 */
import { addOnKey, type AddOnMode, type AddOnUnit, type Equipment } from '../data/booking'

export type Offer = {
  /** Tray key — identifies the offer, not just the item. */
  key: string
  item: Equipment
  mode: AddOnMode
  unit: AddOnUnit
  label: string
  price: number
  /** Base units off the shelf per one of these. A pack of three draws three. */
  draws: number
  /** Rentals are charged per hour of play; purchases are one-off. */
  perHour: boolean
}

export function offersFor(item: Equipment): Offer[] {
  const out: Offer[] = []

  // A rent price of 0 means "not really lent" even where the flag is on — the
  // swimming kit is sold, not loaned, and should not appear as a free rental.
  if (item.forRent && item.price > 0) {
    out.push({
      key: addOnKey(item.id, 'rent', 'single'),
      item,
      mode: 'rent',
      unit: 'single',
      label: 'Rent',
      price: item.price,
      draws: 1,
      perHour: true,
    })
  }

  if (item.forSale) {
    out.push({
      key: addOnKey(item.id, 'buy', 'single'),
      item,
      mode: 'buy',
      unit: 'single',
      label: 'Buy',
      price: item.salePrice,
      draws: 1,
      perHour: false,
    })
    if (item.packSize > 1) {
      out.push({
        key: addOnKey(item.id, 'buy', 'pack'),
        item,
        mode: 'buy',
        unit: 'pack',
        label: `Pack of ${item.packSize}`,
        price: item.packPrice,
        draws: item.packSize,
        perHour: false,
      })
    }
  }

  return out
}

/**
 * How many base units an item's offers have already claimed in this tray.
 *
 * Offers share one stock pool, so buying a pack of three leaves three fewer to
 * rent. Without this each card would independently believe the whole shelf was
 * available to it.
 */
export function unitsClaimed(
  offers: Offer[],
  tray: Record<string, number>,
  itemId: string,
): number {
  return offers
    .filter((o) => o.item.id === itemId)
    .reduce((sum, o) => sum + (tray[o.key] || 0) * o.draws, 0)
}
