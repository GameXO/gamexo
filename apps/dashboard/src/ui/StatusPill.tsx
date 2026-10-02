/** A status pill: white, hairline border, a coloured bar on its leading edge. */
const BAR = {
  positive: 'bg-positive',
  warning: 'bg-amber-500',
  negative: 'bg-negative',
  neutral: 'bg-muted',
} as const

export type StatusTone = keyof typeof BAR

export default function StatusPill({
  label,
  tone = 'neutral',
}: {
  label: string
  tone?: StatusTone
}) {
  return (
    <span className="inline-flex items-center gap-2 rounded-md border border-border-card bg-white py-1 pl-1.5 pr-2.5 text-xs font-medium capitalize text-ink">
      <span className={`h-4 w-[3px] rounded-full ${BAR[tone]}`} />
      {label}
    </span>
  )
}
