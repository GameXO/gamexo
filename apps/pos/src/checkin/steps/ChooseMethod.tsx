import { asset } from '../../lib/asset'

const calendarCheckIn = asset('pos/checkin/calendar-check-in.svg')
const passport = asset('pos/checkin/passport.svg')

function MethodCard({
  icon,
  title,
  detail,
  onClick,
}: {
  icon: string
  title: string
  detail: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full max-w-[420px] flex-1 flex-col items-center gap-[clamp(1rem,2vw,1.5rem)] rounded-2xl bg-surface px-[clamp(1.1rem,2vw,1.5rem)] pb-[clamp(1.5rem,3vw,2.25rem)] pt-[clamp(1rem,2vw,1.5rem)] text-center transition-transform hover:-translate-y-1"
    >
      <span className="flex items-center justify-center rounded-full bg-surface-muted p-[clamp(0.75rem,1.4vw,1rem)]">
        <img src={icon} alt="" className="size-[clamp(1.5rem,2.4vw,1.75rem)]" />
      </span>
      <span className="flex flex-col gap-2.5">
        <p className="font-display text-[clamp(1.15rem,1.9vw,1.5rem)] font-bold text-ink">{title}</p>
        <p className="text-[clamp(0.9375rem,1.3vw,1.125rem)] font-medium text-muted">{detail}</p>
      </span>
    </button>
  )
}

export default function ChooseMethod({
  onHaveBooking,
  onBookNow,
}: {
  onHaveBooking: () => void
  onBookNow: () => void
}) {
  return (
    <div className="flex w-full max-w-[960px] flex-col items-center gap-[clamp(1.75rem,4vw,3.125rem)]">
      <div className="flex flex-col items-center text-center">
        <p className="font-display text-[clamp(1.5rem,3vw,2.25rem)] font-bold leading-tight text-muted">Choose a</p>
        <p className="font-display text-[clamp(1.5rem,3vw,2.25rem)] font-bold leading-tight text-ink">
          Check In Method
        </p>
      </div>

      <div className="flex w-full flex-col items-stretch gap-5 sm:flex-row sm:justify-center">
        <MethodCard
          icon={calendarCheckIn}
          title="Already have a Booking?"
          detail="Confirm your Check In"
          onClick={onHaveBooking}
        />
        <MethodCard
          icon={passport}
          title="Book a Court Now"
          detail="Choose the service as your convenience"
          onClick={onBookNow}
        />
      </div>
    </div>
  )
}
