import { tintFor } from './catalog'

/** A brand-coloured initial in a bordered tile. Sized in px so one component serves
 *  the card, the drawer header and the connect hero. */
export default function IntegrationLogo({
  id,
  name,
  size = 40,
}: {
  id: string
  name: string
  size?: number
}) {
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-xl border border-border-card bg-white p-[3px]"
      style={{ width: size, height: size }}
    >
      <div
        className="flex size-full items-center justify-center rounded-[9px] font-bold text-white"
        style={{ backgroundColor: tintFor(id), fontSize: Math.round(size * 0.38) }}
      >
        {name.slice(0, 1).toUpperCase()}
      </div>
    </div>
  )
}
