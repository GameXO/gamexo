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
    <div role="tablist" className="inline-flex w-fit max-w-full gap-0.5 overflow-x-auto rounded-xl bg-hover p-1">
      {tabs.map((tab) => (
        <button
          key={tab}
          type="button"
          onClick={() => onChange(tab)}
          role="tab"
          aria-selected={active === tab}
          className={`shrink-0 rounded-lg border px-4 py-1.5 text-[14px] font-medium ${
            active === tab
              ? 'border-border-input bg-white text-ink'
              : 'border-transparent text-slate hover:text-ink'
          }`}
        >
          {tab}
        </button>
      ))}
    </div>
  )
}
