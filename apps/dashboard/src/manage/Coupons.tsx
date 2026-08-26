import { useState } from 'react'
import { Tag, Trash2 } from 'lucide-react'
import { toISO } from '../data/booking'
import * as db from '../lib/db'
import Toggle from './Toggle'

const randomCode = () => `XC${Math.floor(1000 + Math.random() * 9000)}`
const defaultExpiry = () => toISO(new Date(Date.now() + 30 * 86_400_000))

export default function Coupons() {
  db.useDbVersion()
  const coupons = db.getCoupons()

  const [code, setCode] = useState('')
  const [percent, setPercent] = useState(10)
  const [expiresAt, setExpiresAt] = useState('')

  const generate = () => {
    db.saveCoupon({
      id: `CP${Date.now()}`,
      code: (code.trim() || randomCode()).toUpperCase(),
      percent: Math.min(100, Math.max(1, percent)),
      expiresAt: expiresAt || defaultExpiry(),
      active: true,
    })
    setCode('')
    setPercent(10)
    setExpiresAt('')
  }

  return (
    <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 py-5 sm:px-6">
      <p className="text-lg text-ink">Discount Coupons</p>

      <div className="flex w-full flex-col gap-3 rounded-2xl border border-border-card bg-white p-5 shadow-[0px_5px_13px_0px_rgba(0,0,0,0.05)] sm:flex-row sm:items-end">
        <label className="flex flex-1 flex-col gap-1.5 text-sm">
          <span className="text-slate">Code</span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Leave blank to auto-generate"
            className="rounded-lg border border-border-input bg-surface px-3 py-2.5 uppercase text-ink outline-none focus:border-ink"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm sm:w-32">
          <span className="text-slate">Discount %</span>
          <input
            type="number"
            min={1}
            max={100}
            value={percent}
            onChange={(e) => setPercent(Number(e.target.value))}
            className="rounded-lg border border-border-input bg-surface px-3 py-2.5 text-ink outline-none focus:border-ink"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm sm:w-44">
          <span className="text-slate">Expires</span>
          <input
            type="date"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            className="rounded-lg border border-border-input bg-surface px-3 py-2.5 text-ink outline-none focus:border-ink"
          />
        </label>
        <button
          type="button"
          onClick={generate}
          className="h-[42px] shrink-0 rounded-lg bg-ink px-5 text-sm font-medium text-white"
        >
          Generate coupon
        </button>
      </div>

      <div className="w-full overflow-hidden rounded-2xl border border-border-card bg-white shadow-[0px_5px_13px_0px_rgba(0,0,0,0.05)]">
        {coupons.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted">No coupons generated yet.</p>
        ) : (
          coupons.map((c, i) => (
            <div
              key={c.id}
              className={`flex items-center justify-between gap-3 px-5 py-3.5 ${
                i < coupons.length - 1 ? 'border-b border-border-card' : ''
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-muted text-ink">
                  <Tag size={16} />
                </div>
                <div>
                  <p className="text-sm font-semibold text-ink">{c.code}</p>
                  <p className="text-xs text-muted">{c.percent}% off · expires {c.expiresAt}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Toggle checked={c.active} onChange={() => db.toggleCoupon(c.id)} />
                <button
                  type="button"
                  aria-label={`Delete ${c.code}`}
                  onClick={() => db.deleteCoupon(c.id)}
                  className="flex size-8 items-center justify-center rounded-lg text-muted hover:bg-negative/10 hover:text-negative"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
