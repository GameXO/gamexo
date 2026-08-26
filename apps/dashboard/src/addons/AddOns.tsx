import { useState } from 'react'
import {
  CircleDot,
  Droplet,
  Feather,
  Footprints,
  GraduationCap,
  Lock,
  Minus,
  Package,
  Plus,
  Shield,
  Shirt,
  X,
  type LucideIcon,
} from 'lucide-react'
import {
  EQUIPMENT,
  equipmentCategories,
  equipmentForCategory,
  money,
  priceEquipment,
  type Equipment,
} from '../data/booking'
import * as db from '../lib/db'
import CheckoutSheet from './CheckoutSheet'

const ICONS: Record<string, LucideIcon> = {
  shoes: Footprints,
  football: CircleDot,
  bib: Shirt,
  shuttle: Feather,
  pads: Shield,
  coach: GraduationCap,
  bottle: Droplet,
  locker: Lock,
}

function remainingStock(item: Equipment, adjustments: Record<string, number>) {
  return item.stock + (adjustments[item.id] || 0)
}

export default function AddOns() {
  db.useDbVersion()
  const [category, setCategory] = useState('all')
  const [tray, setTray] = useState<Record<string, number>>({})
  const [checkoutOpen, setCheckoutOpen] = useState(false)

  const adjustments = db.getStockAdjustments()
  const categories = equipmentCategories()
  const items = equipmentForCategory(category)

  const setQty = (id: string, qty: number) => {
    setTray((t) => {
      const next = { ...t }
      if (qty > 0) next[id] = qty
      else delete next[id]
      return next
    })
  }

  const trayItems = Object.entries(tray).filter(([, qty]) => qty > 0)
  const trayCount = trayItems.reduce((a, [, qty]) => a + qty, 0)
  const totals = priceEquipment(tray)

  const clearTray = () => setTray({})

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 py-5 sm:px-6">
        <p className="text-lg text-ink">Kit, lockers &amp; coaching</p>

        <div className="flex w-full flex-wrap gap-2">
          {categories.map((c) => {
            const active = c.id === category
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setCategory(c.id)}
                className={`rounded-full px-4 py-2 text-sm transition-colors ${
                  active ? 'bg-ink text-bone' : 'bg-surface text-slate hover:bg-surface-muted'
                }`}
              >
                {c.label}
              </button>
            )
          })}
        </div>

        <div className="grid w-full grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
          {items.map((item) => {
            const remaining = remainingStock(item, adjustments)
            const soldOut = remaining <= 0
            const qty = tray[item.id] || 0
            const active = qty > 0
            const atLimit = qty >= remaining
            const Icon = ICONS[item.id] ?? Package

            const addFirst = () => {
              if (qty === 0 && !soldOut) setQty(item.id, 1)
            }

            return (
              <div
                key={item.id}
                role="button"
                tabIndex={soldOut ? -1 : 0}
                aria-disabled={soldOut}
                aria-label={qty === 0 ? `Add ${item.name}` : undefined}
                onClick={addFirst}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    addFirst()
                  }
                }}
                className={`group relative flex flex-col items-start gap-3 rounded-xl border p-4 text-left transition-all ${
                  active ? 'border-ink bg-lime/10 shadow-sm' : 'border-border-card bg-surface hover:border-ink/25'
                } ${soldOut ? 'cursor-not-allowed opacity-50' : qty === 0 ? 'cursor-pointer' : ''}`}
              >
                {active && (
                  <span className="absolute -right-2 -top-2 flex size-6 items-center justify-center rounded-full bg-lime text-xs font-semibold text-lime-ink shadow-[0px_2px_6px_rgba(0,0,0,0.15)]">
                    {qty}
                  </span>
                )}

                <div
                  className={`flex size-10 items-center justify-center rounded-full transition-colors ${
                    active ? 'bg-lime text-lime-ink' : 'bg-surface-muted text-ink'
                  }`}
                >
                  <Icon size={18} strokeWidth={1.75} />
                </div>

                <div className="flex flex-col gap-0.5">
                  <p className="text-sm font-semibold text-ink">{item.name}</p>
                  <p className="text-xs text-muted">{item.hint}</p>
                </div>

                <div className="flex w-full items-center justify-between">
                  <span className="text-sm font-medium text-positive">{money(item.price)}</span>

                  {active ? (
                    <span
                      role="group"
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center gap-2.5 rounded-full bg-ink px-1.5 py-1 text-bone"
                    >
                      <button
                        type="button"
                        aria-label={`Remove one ${item.name}`}
                        onClick={() => setQty(item.id, qty - 1)}
                        className="flex size-5 items-center justify-center"
                      >
                        <Minus size={12} />
                      </button>
                      <span className="w-3 text-center text-xs">{qty}</span>
                      <button
                        type="button"
                        aria-label={`Add one more ${item.name}`}
                        disabled={atLimit}
                        onClick={() => setQty(item.id, qty + 1)}
                        className="flex size-5 items-center justify-center disabled:opacity-40"
                      >
                        <Plus size={12} />
                      </button>
                    </span>
                  ) : (
                    <span className={`text-xs ${soldOut ? 'text-negative' : remaining <= 5 ? 'text-flame' : 'text-muted'}`}>
                      {soldOut ? 'Sold out' : `${remaining} left`}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
        {items.every((item) => remainingStock(item, adjustments) <= 0) && (
          <p className="text-sm text-muted">Everything in this category is sold out right now.</p>
        )}
      </div>

      {trayCount > 0 && (
        <div className="flex w-full shrink-0 items-center gap-4 border-t border-border-soft bg-white px-4 py-3 sm:px-6">
          <div className="flex flex-1 items-center gap-2 overflow-x-auto">
            {trayItems.map(([id, qty]) => {
              const item = EQUIPMENT.find((e) => e.id === id)
              if (!item) return null
              return (
                <span
                  key={id}
                  className="flex shrink-0 items-center gap-1.5 rounded-full bg-surface-muted px-3 py-1.5 text-xs text-ink"
                >
                  {item.name} × {qty}
                </span>
              )
            })}
          </div>

          <button type="button" onClick={clearTray} className="flex shrink-0 items-center gap-1 text-sm text-muted hover:text-ink">
            <X size={14} /> Clear tray
          </button>

          <p className="shrink-0 text-base font-semibold text-ink">{money(totals.total)}</p>

          <button
            type="button"
            onClick={() => setCheckoutOpen(true)}
            className="flex h-10 shrink-0 items-center justify-center rounded-full px-6 text-sm text-[#fefefe] shadow-[0px_4px_10px_0px_rgba(0,0,0,0.05),0px_10px_120px_0px_rgba(15,73,106,0.1)]"
            style={{ backgroundImage: 'linear-gradient(105deg, rgb(41,41,41) 2%, rgb(26,26,26) 100%)' }}
          >
            Checkout
          </button>
        </div>
      )}

      {checkoutOpen && (
        <CheckoutSheet
          tray={tray}
          onClose={() => setCheckoutOpen(false)}
          onDone={() => {
            clearTray()
            setCheckoutOpen(false)
          }}
        />
      )}
    </div>
  )
}
