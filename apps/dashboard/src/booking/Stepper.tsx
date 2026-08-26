export const STEPS = ['Select Sports & Court', 'Date & Time', 'Player Details', 'Add Ons', 'Payments'] as const

export default function Stepper({
  current,
  onSelect,
}: {
  current: number
  onSelect: (step: number) => void
}) {
  return (
    <div className="flex w-full justify-center">
      <div className="flex max-w-full items-center gap-[clamp(0.75rem,2.5vw,2rem)] overflow-x-auto rounded-xl bg-white px-[clamp(1rem,3vw,1.5rem)] py-[clamp(0.5rem,1.5vw,0.75rem)]">
        {STEPS.map((label, i) => {
          const step = i + 1
          const active = step === current
          const done = step < current

          return (
            <div
              key={label}
              onClick={() => done && onSelect(step)}
              title={label}
              className={`flex shrink-0 items-center gap-[clamp(0.375rem,1vw,0.625rem)] ${done ? 'cursor-pointer' : ''}`}
            >
              <div
                className={`flex size-[clamp(1.25rem,2.2vw,1.5rem)] shrink-0 items-center justify-center rounded-full transition-colors ${
                  active ? 'bg-ink' : done ? 'bg-lime' : 'bg-border-input'
                }`}
              >
                <p
                  className={`font-semibold leading-none ${active ? 'text-white' : done ? 'text-lime-ink' : 'text-muted'}`}
                  style={{ fontSize: 'clamp(0.65rem, 1.1vw, 0.8125rem)' }}
                >
                  {step}
                </p>
              </div>
              <p
                className={`hidden whitespace-nowrap leading-[1.2] sm:inline ${active ? 'font-semibold text-ink' : done ? 'text-slate' : 'text-muted'}`}
                style={{ fontSize: 'clamp(0.75rem, 1.3vw, 1rem)' }}
              >
                {label}
              </p>
            </div>
          )
        })}
      </div>
    </div>
  )
}
