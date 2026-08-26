import { useEffect } from 'react'
import { useInventory } from '../api/hooks'
import { setEquipmentCatalog, type Equipment } from '../data/booking'
import { notifyChanged } from '../lib/db'

/** Renders nothing — keeps the shared shop catalogue (`data/booking.ts`) in sync
 *  with what Inventory has actually published. Add-ons, the walk-in booking
 *  flow's kit step, and Active Courts' "add kit" panel all read that catalogue
 *  through `equipmentForSport`/`equipmentInShop`/`priceEquipment`, so mounting
 *  this once near the root is enough for a publish/hide toggle to reach every
 *  one of them without touching their code. */
export default function PublishedEquipmentBridge() {
  const inventoryQuery = useInventory()

  useEffect(() => {
    if (!inventoryQuery.data) return
    const mapped: Equipment[] = inventoryQuery.data
      .filter((item) => item.publishedToPos)
      .map((item) => ({
        id: item.id,
        name: item.name,
        price: item.price,
        salePrice: item.salePrice,
        forRent: item.forRent,
        forSale: item.forSale,
        packSize: item.packSize,
        packPrice: item.packPrice,
        sports: item.sportId ? [item.sportId] : [],
        hint: item.category,
        stock: item.qtyAvailable,
        returnable: !item.consumable,
        deposit: item.deposit || undefined,
      }))
    setEquipmentCatalog(mapped)
    notifyChanged()
  }, [inventoryQuery.data])

  return null
}
