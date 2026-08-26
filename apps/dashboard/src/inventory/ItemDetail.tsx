import { useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, Upload } from 'lucide-react'
import {
  stockStatus,
  useCreateInventoryItem,
  useCreateMovement,
  useDeleteInventoryItem,
  useMovementHistory,
  useUpdateInventoryItem,
  type InventoryItem,
} from '../api/hooks'
import Toggle from '../manage/Toggle'
import ConfirmDialog from '../ui/ConfirmDialog'
import { generateBarcode, itemCode } from './helpers'
import SportPickerModal from './SportPickerModal'

const inputClass =
  'w-full rounded-lg border border-border-input bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-muted focus:border-ink focus:outline-none'

const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024

const REASONS = ['Restock', 'Purchase', 'Damage', 'Correction'] as const

const STATUS_ROWS = [
  { id: 'in-stock', label: 'In Stock', dot: 'bg-positive' },
  { id: 'low-stock', label: 'Low Stock', dot: 'bg-flame' },
  { id: 'out-of-stock', label: 'Out of Stock', dot: 'bg-negative' },
] as const

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-center justify-between text-sm font-medium text-slate">
        {label}
        {hint && <span className="text-xs font-normal text-muted">{hint}</span>}
      </span>
      {children}
    </label>
  )
}

/** A rupee-prefixed amount field. Four of these now, so it stops being inline. */
function MoneyInput({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-muted">₹</span>
      <input
        className={`${inputClass} pl-7`}
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ''))}
      />
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border-card bg-white p-5">
      <p className="text-sm font-semibold text-ink">{title}</p>
      {children}
    </div>
  )
}

export default function ItemDetail({
  item,
  sportName,
  onBack,
  onSaved,
  onDeleted,
}: {
  /** null = creating a new item */
  item: InventoryItem | null
  sportName: (id: string | null) => string
  onBack: () => void
  onSaved: (id: string) => void
  onDeleted: () => void
}) {
  const isNew = item === null

  const [name, setName] = useState(item?.name ?? '')
  const [category, setCategory] = useState(item?.category ?? '')
  const [price, setPrice] = useState(String(item?.price ?? ''))
  const [deposit, setDeposit] = useState(String(item?.deposit ?? 0))
  const [salePrice, setSalePrice] = useState(String(item?.salePrice ?? 0))
  const [forRent, setForRent] = useState(item?.forRent ?? true)
  const [forSale, setForSale] = useState(item?.forSale ?? false)
  const [packSize, setPackSize] = useState(String(item?.packSize ?? 1))
  const [packPrice, setPackPrice] = useState(String(item?.packPrice ?? 0))
  const [sportId, setSportId] = useState<string | null>(item?.sportId ?? null)
  const [lowStockThreshold, setLowStockThreshold] = useState(String(item?.lowStockThreshold ?? 3))
  const [consumable, setConsumable] = useState(item?.consumable ?? true)
  // New items default to published — the exception is hiding something, not showing it.
  const [publishedToPos, setPublishedToPos] = useState(item?.publishedToPos ?? true)
  const [imageUrl, setImageUrl] = useState<string | null>(item?.imageUrl ?? null)
  const [openingStock, setOpeningStock] = useState('0')

  const [sportPickerOpen, setSportPickerOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [imageError, setImageError] = useState<string | null>(null)

  const [adjustQty, setAdjustQty] = useState(0)
  const [reason, setReason] = useState<(typeof REASONS)[number]>('Restock')

  const fileInputRef = useRef<HTMLInputElement>(null)

  const create = useCreateInventoryItem()
  const update = useUpdateInventoryItem()
  const del = useDeleteInventoryItem()
  const movement = useCreateMovement()
  const movementsQuery = useMovementHistory(item?.id ?? null)

  const priceNum = Number(price) || 0
  const depositNum = Number(deposit) || 0
  const salePriceNum = Number(salePrice) || 0
  const packSizeNum = Math.max(1, Math.round(Number(packSize) || 1))
  const packPriceNum = Number(packPrice) || 0
  const thresholdNum = Math.max(0, Math.round(Number(lowStockThreshold) || 0))

  // Mirrors the API's own rules (EquipmentBase) so the error lands before the
  // request rather than as a 422 the form has to translate back.
  const offerError = !forRent && !forSale
    ? 'An item has to be available to rent, to buy, or both.'
    : packSizeNum > 1 && !forSale
      ? 'Packs are bought, not rented — turn on "Available to buy" or set pack size to 1.'
      : null

  const valid =
    name.trim().length > 0 &&
    category.trim().length > 0 &&
    Number.isFinite(priceNum) &&
    priceNum >= 0 &&
    offerError === null
  const saving = create.isPending || update.isPending

  const status = item ? stockStatus(item) : 'in-stock'

  function pickImage(file: File) {
    setImageError(null)
    if (file.size > MAX_IMAGE_BYTES) {
      setImageError('Image is too large — please use one under 1.5 MB.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => setImageUrl(String(reader.result))
    reader.readAsDataURL(file)
  }

  async function save() {
    if (!valid) return
    setError(null)
    try {
      if (isNew) {
        const created = await create.mutateAsync({
          name: name.trim(),
          category: category.trim(),
          barcode: generateBarcode(name),
          price: priceNum,
          deposit: depositNum,
          salePrice: salePriceNum,
          forRent,
          forSale,
          packSize: packSizeNum,
          packPrice: packPriceNum,
          condition: 'good',
          lowStockThreshold: thresholdNum,
          sportId,
          publishedToPos,
          imageUrl,
          consumable,
          qtyStock: Math.max(0, Math.round(Number(openingStock) || 0)),
        })
        onSaved(created.id)
      } else {
        await update.mutateAsync({
          id: item.id,
          patch: {
            name: name.trim(),
            category: category.trim(),
            price: priceNum,
            deposit: depositNum,
            lowStockThreshold: thresholdNum,
            sportId,
            publishedToPos,
            imageUrl,
            consumable,
          },
        })
        onSaved(item.id)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this item.')
    }
  }

  async function applyAdjustment() {
    if (!item || adjustQty === 0) return
    setError(null)
    try {
      await movement.mutateAsync({
        equipmentId: item.id,
        kind: adjustQty > 0 ? 'restock' : 'write_off',
        qty: Math.abs(adjustQty),
        note: reason,
      })
      setAdjustQty(0)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not adjust stock.')
    }
  }

  async function markOutOfStock() {
    if (!item || item.qtyAvailable <= 0) return
    setError(null)
    try {
      await movement.mutateAsync({
        equipmentId: item.id,
        kind: 'write_off',
        qty: item.qtyAvailable,
        note: 'Marked out of stock',
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update stock.')
    }
  }

  async function confirmedDelete() {
    if (!item) return
    setError(null)
    try {
      await del.mutateAsync(item.id)
      onDeleted()
    } catch (err) {
      setConfirmDelete(false)
      setError(err instanceof Error ? err.message : 'Could not delete this item.')
    }
  }

  return (
    <div className="flex w-full max-w-[720px] flex-col gap-5">
      <button type="button" onClick={onBack} className="flex w-fit items-center gap-1.5 text-sm text-slate hover:text-ink">
        <ArrowLeft size={15} />
        Inventory
      </button>

      <div>
        <p className="font-display text-2xl font-semibold text-ink">{isNew ? 'New item' : item.name}</p>
        {!isNew && <p className="text-sm text-muted">{itemCode(item.id)}</p>}
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-negative/10 px-4 py-3 text-sm text-negative">
          {error}
        </p>
      )}

      <Section title="Basic Information">
        <Field label="Item name">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Football" />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Category">
            <input className={inputClass} value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Football" />
          </Field>
          <Field label="Sport">
            <button
              type="button"
              onClick={() => setSportPickerOpen(true)}
              className={`${inputClass} flex items-center justify-between text-left`}
            >
              <span>{sportName(sportId)}</span>
              <span className="text-xs text-muted">Change</span>
            </button>
          </Field>
        </div>

        {/* Rent and Sell are separate offers on the same shelf — an item can be
            either or both, and the counter shows one card per offer. */}
        <div className="flex flex-col gap-4 rounded-xl border border-border-card p-4">
          <label className="flex items-center justify-between">
            <span className="text-sm font-semibold text-ink">Available to rent</span>
            <input
              type="checkbox"
              checked={forRent}
              onChange={(e) => setForRent(e.target.checked)}
              className="size-4 accent-ink"
            />
          </label>

          {forRent && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Rent price" hint="Per hour of play">
                <MoneyInput value={price} onChange={setPrice} />
              </Field>
              <Field label="Deposit" hint="Refundable, taken at issue">
                <MoneyInput value={deposit} onChange={setDeposit} />
              </Field>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4 rounded-xl border border-border-card p-4">
          <label className="flex items-center justify-between">
            <span className="text-sm font-semibold text-ink">Available to buy</span>
            <input
              type="checkbox"
              checked={forSale}
              onChange={(e) => setForSale(e.target.checked)}
              className="size-4 accent-ink"
            />
          </label>

          {forSale && (
            <>
              <Field label="Sale price" hint="One unit, one-off charge">
                <MoneyInput value={salePrice} onChange={setSalePrice} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Pack size" hint="Units per pack; 1 means no pack option">
                  <input
                    className={inputClass}
                    inputMode="numeric"
                    value={packSize}
                    onChange={(e) => setPackSize(e.target.value.replace(/[^0-9]/g, ''))}
                  />
                </Field>
                <Field label="Pack price" hint="What one whole pack costs">
                  <MoneyInput value={packPrice} onChange={setPackPrice} />
                </Field>
              </div>
              <p className="text-xs text-muted">
                Stock is counted in single units, so selling one pack of {Math.max(1, Number(packSize) || 1)} takes{' '}
                {Math.max(1, Number(packSize) || 1)} off the shelf.
              </p>
            </>
          )}
        </div>

        {!isNew && (
          <div className="flex items-center justify-between border-t border-border-card pt-4">
            <span className="text-sm font-medium text-slate">Status</span>
            <div className="flex items-center gap-4">
              {STATUS_ROWS.map((row) => (
                <span
                  key={row.id}
                  className={`flex items-center gap-1.5 text-xs ${status === row.id ? 'font-semibold text-ink' : 'text-muted'}`}
                >
                  <span className={`size-2 rounded-full ${status === row.id ? row.dot : 'bg-border-input'}`} />
                  {row.label}
                </span>
              ))}
            </div>
          </div>
        )}
      </Section>

      <Section title="Image">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) pickImage(file)
            e.target.value = ''
          }}
        />
        {imageUrl ? (
          <div className="flex items-start gap-4">
            <img src={imageUrl} alt="" className="size-28 shrink-0 rounded-lg border border-border-card object-cover" />
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="rounded-lg border border-border-input bg-white px-3.5 py-2 text-sm text-ink"
              >
                Change image
              </button>
              <button
                type="button"
                onClick={() => setImageUrl(null)}
                className="rounded-lg border border-border-input bg-white px-3.5 py-2 text-sm text-negative"
              >
                Remove image
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex h-32 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border-input bg-surface text-muted hover:border-ink/30"
          >
            <Upload size={20} />
            <span className="text-sm">Upload image</span>
          </button>
        )}
        {imageError && <p className="text-xs text-negative">{imageError}</p>}
      </Section>

      <Section title="Inventory">
        {isNew ? (
          <Field label="Opening stock">
            <input
              className={inputClass}
              inputMode="numeric"
              value={openingStock}
              onChange={(e) => setOpeningStock(e.target.value.replace(/\D/g, ''))}
            />
          </Field>
        ) : (
          <div className="flex items-center justify-between rounded-lg bg-surface-muted px-3.5 py-2.5">
            <span className="text-sm text-slate">Current stock</span>
            <span className="text-sm font-semibold text-ink">{item.qtyAvailable} in stock</span>
          </div>
        )}

        <Field label="Minimum stock alert" hint="Flags as Low Stock at or below this">
          <input
            className={`${inputClass} max-w-[140px]`}
            inputMode="numeric"
            value={lowStockThreshold}
            onChange={(e) => setLowStockThreshold(e.target.value.replace(/\D/g, ''))}
          />
        </Field>

        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={consumable} onChange={(e) => setConsumable(e.target.checked)} className="size-4 accent-black" />
          Consumable — sold and gone, not checked in/out
        </label>
      </Section>

      <Section title="Visibility">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-ink">Publish to POS</p>
            <p className="mt-0.5 text-xs text-muted">
              {publishedToPos
                ? 'Available in POS — customers can see and buy this at the counter.'
                : 'Hidden from POS — the item stays in inventory but will not appear in Add-ons.'}
            </p>
          </div>
          <Toggle checked={publishedToPos} onChange={() => setPublishedToPos((v) => !v)} />
        </div>
      </Section>

      {!isNew && (
        <Section title="Stock Controls">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1 rounded-lg bg-surface-muted p-1">
              <button
                type="button"
                onClick={() => setAdjustQty((q) => q - 5)}
                className="flex h-9 items-center justify-center rounded-md bg-white px-3 text-sm font-medium text-ink shadow-sm"
              >
                −5
              </button>
              <input
                className="w-16 border-0 bg-transparent text-center text-sm text-ink focus:outline-none"
                inputMode="numeric"
                value={adjustQty}
                onChange={(e) => setAdjustQty(Number(e.target.value.replace(/[^-0-9]/g, '')) || 0)}
              />
              <button
                type="button"
                onClick={() => setAdjustQty((q) => q + 5)}
                className="flex h-9 items-center justify-center rounded-md bg-white px-3 text-sm font-medium text-ink shadow-sm"
              >
                +5
              </button>
            </div>

            <select
              value={reason}
              onChange={(e) => setReason(e.target.value as (typeof REASONS)[number])}
              className="h-9 rounded-lg border border-border-input bg-white px-3 text-sm text-ink"
            >
              {REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>

            <button
              type="button"
              disabled={adjustQty === 0 || movement.isPending}
              onClick={applyAdjustment}
              className="flex h-9 items-center justify-center rounded-lg bg-ink px-4 text-sm font-medium text-white disabled:opacity-40"
            >
              {movement.isPending ? 'Applying…' : `Apply ${adjustQty > 0 ? `+${adjustQty}` : adjustQty}`}
            </button>
          </div>

          {movementsQuery.data && movementsQuery.data.length > 0 && (
            <div className="flex flex-col gap-1.5 border-t border-border-card pt-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">Recent movements</p>
              {movementsQuery.data.slice(0, 5).map((m) => (
                <div key={m.id} className="flex items-center justify-between text-xs">
                  <span className="text-slate">
                    {m.note || m.kind} · {new Date(m.occurred_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                  </span>
                  <span
                    className={
                      m.kind === 'write_off' || m.kind === 'lost' || m.kind === 'issue'
                        ? 'text-negative'
                        : 'text-positive'
                    }
                  >
                    {m.kind === 'write_off' || m.kind === 'lost' || m.kind === 'issue' ? '−' : '+'}
                    {m.qty}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      <div className="flex flex-col gap-3 rounded-xl border border-border-card bg-white p-5">
        <button
          type="button"
          disabled={!valid || saving}
          onClick={save}
          className="flex h-11 items-center justify-center rounded-full text-sm text-white disabled:opacity-40"
          style={{ backgroundImage: 'linear-gradient(105deg, rgb(41,41,41) 2%, rgb(26,26,26) 100%)' }}
        >
          {saving ? 'Saving…' : 'Save Changes'}
        </button>

        {!isNew && (
          <>
            <div className="border-t border-border-card" />
            <button
              type="button"
              disabled={item.qtyAvailable <= 0 || movement.isPending}
              onClick={markOutOfStock}
              className="flex h-11 items-center justify-center rounded-full border border-border-input text-sm text-ink disabled:opacity-40"
            >
              Mark Out of Stock
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="flex h-11 items-center justify-center rounded-full border border-negative text-sm font-medium text-negative"
            >
              Delete Item
            </button>
          </>
        )}
      </div>

      {sportPickerOpen && (
        <SportPickerModal selectedId={sportId} onPick={setSportId} onClose={() => setSportPickerOpen(false)} />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete this item?"
          message="This can't be undone. Items with movement history or issued units can't be deleted — unpublish them instead."
          confirmLabel="Delete"
          danger
          onConfirm={confirmedDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  )
}
