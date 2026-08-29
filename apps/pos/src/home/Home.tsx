import { useState } from 'react'
import { LogOut } from 'lucide-react'
import type { View } from '../App'
import { TopBar } from '../ui/TopBar'
import { useAuth } from '../auth/AuthProvider'
import { usePosServices } from '../api/hooks'
import checkinIllustration from '../assets/figma/home/checkin-illustration.png'
import shopIllustration from '../assets/figma/home/shop-illustration.png'
import academyIllustration from '../assets/figma/home/academy-illustration.png'
import membershipIllustration from '../assets/figma/home/membership-illustration.png'
import checkoutIcon from '../assets/figma/checkin/checkout.svg'

function Tile({
  image,
  title,
  detail,
  onClick,
}: {
  image: string
  title: string
  detail: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-[238px] shrink-0 flex-col items-center gap-[clamp(1rem,2vw,1.375rem)] rounded-2xl bg-surface px-4 pb-[clamp(1.5rem,3vw,2rem)] pt-3.5 transition-transform hover:-translate-y-1 min-[850px]:w-full min-[850px]:max-w-[296px] min-[850px]:flex-1 min-[850px]:shrink"
    >
      <div className="h-[clamp(11rem,20vw,17.3125rem)] w-full">
        <img src={image} alt="" className="size-full object-contain" />
      </div>
      <div className="flex flex-col items-center gap-3.5 text-center">
        <p className="font-display text-[clamp(1.2rem,2vw,1.375rem)] font-bold text-ink">{title}</p>
        <p className="text-[clamp(0.9375rem,1.3vw,1rem)] font-medium text-muted">{detail}</p>
      </div>
    </button>
  )
}

export default function Home({ onNavigate }: { onNavigate: (view: View) => void }) {
  // Which tiles this academy offers — set by an admin in the dashboard's
  // Settings -> Counter services. Unknown and not-yet-loaded both read as enabled,
  // so the counter never flashes an empty home screen.
  const { isEnabled } = usePosServices()
  const { logout } = useAuth()
  const [showSignOut, setShowSignOut] = useState(false)

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <TopBar
        onLogoClick={() => onNavigate('home')}
        onLogoDoubleClick={() => setShowSignOut((v) => !v)}
        logoMenu={
          showSignOut && (
            <button
              type="button"
              onClick={() => {
                setShowSignOut(false)
                logout()
              }}
              className="absolute left-0 top-full z-10 mt-2 flex items-center gap-2 whitespace-nowrap rounded-xl bg-surface px-4 py-3 text-sm font-medium text-muted shadow-[0px_12px_17px_-9px_rgba(0,0,0,0.12)] hover:text-ink"
            >
              <LogOut size={16} strokeWidth={1.75} />
              Sign out
            </button>
          )
        }
        rightExtra={
          <button
            type="button"
            onClick={() => onNavigate('checkout')}
            className="flex h-full items-center gap-2 rounded-xl bg-ink px-[clamp(1rem,1.8vw,1.375rem)] py-3 text-[clamp(0.9375rem,1vw,0.9375rem)] font-bold text-white"
          >
            <img src={checkoutIcon} alt="" className="size-[clamp(1.1rem,1.4vw,1.5rem)]" />
            Checkout
          </button>
        }
      />

      <main className="flex min-h-0 flex-1 flex-col items-center justify-center-safe gap-[clamp(1.75rem,4vh,3.125rem)] overflow-y-auto px-8 py-10">
        <div className="flex flex-col items-center gap-1 text-center">
          <p className="font-display text-[clamp(1.5rem,3vw,2.25rem)] font-bold text-ink">Welcome to Xcourt</p>
          <p className="text-[clamp(0.9375rem,1.2vw,1rem)] font-medium text-muted">
            What would you like to do today?
          </p>
        </div>

        <div className="flex w-full max-w-[100%] flex-row items-stretch justify-start gap-5 overflow-x-auto px-1 pb-2 min-[850px]:justify-center min-[850px]:overflow-visible min-[850px]:px-0 min-[850px]:pb-0">
          {isEnabled('checkin') && (
            <Tile
              image={checkinIllustration}
              title="Check In"
              detail="Already have a Booking or Book now"
              onClick={() => onNavigate('checkin')}
            />
          )}
          {isEnabled('shop') && (
            <Tile
              image={shopIllustration}
              title="Shop"
              detail="Rent any equipment, shoes, and more ."
              onClick={() => onNavigate('store')}
            />
          )}
          {isEnabled('academy') && (
            <Tile
              image={academyIllustration}
              title="Academy"
              detail="Batches, coaches and student attendance"
              onClick={() => onNavigate('academy')}
            />
          )}
          {isEnabled('membership') && (
            <Tile
              image={membershipIllustration}
              title="Membership"
              detail="Passes, packages and renewals"
              onClick={() => onNavigate('academy')}
            />
          )}
        </div>
      </main>
    </div>
  )
}
