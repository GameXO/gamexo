import type { LucideIcon } from 'lucide-react'

export default function Tile({
  label,
  value,
  icon: Icon,
  alert,
}: {
  label: string
  value: string
  icon: LucideIcon
  alert?: boolean
}) {
  return (
    <div
      className={`flex items-center gap-4 overflow-hidden rounded-xl border p-5 ${
        alert ? 'border-negative/20 bg-negative/5' : 'border-surface bg-surface'
      }`}
    >
      <div
        className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${
          alert ? 'bg-negative/10 text-negative' : 'bg-surface-muted text-ink'
        }`}
      >
        <Icon size={18} />
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-sm font-medium text-slate">{label}</p>
        <p className={`text-xl font-semibold ${alert ? 'text-negative' : 'text-ink'}`}>{value}</p>
      </div>
    </div>
  )
}
