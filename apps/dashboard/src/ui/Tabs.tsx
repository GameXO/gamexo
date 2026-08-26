export default function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: readonly T[]
  active: T
  onChange: (tab: T) => void
}) {
  return (
    <div className="flex w-full gap-1 overflow-x-auto rounded-lg border border-border-input bg-surface p-1">
      {tabs.map((tab) => (
        <button
          key={tab}
          type="button"
          onClick={() => onChange(tab)}
          className={`shrink-0 rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors ${
            active === tab ? 'bg-ink text-white' : 'text-slate hover:bg-white/60'
          }`}
        >
          {tab}
        </button>
      ))}
    </div>
  )
}
