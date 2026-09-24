import { useState } from 'react'
import Home from './home/Home'
import BookingFlow from './booking/BookingFlow'
import StorePage from './store/StorePage'
import CheckInFlow from './checkin/CheckInFlow'
import CheckoutFlow from './checkout/CheckoutFlow'
import AcademyRegister from './academy/AcademyRegister'
import MembershipCounter from './academy/MembershipCounter'
import { useAuth } from './auth/AuthProvider'
import LoginPage from './auth/LoginPage'
import { useViewportHeight } from './ui/useViewportHeight'

export type View = 'home' | 'booking' | 'store' | 'checkin' | 'academy' | 'membership' | 'checkout'

function App() {
  const { status } = useAuth()
  useViewportHeight()

  if (status === 'checking') {
    return (
      <div className="flex h-full w-full items-center justify-center bg-page text-sm text-slate">Loading…</div>
    )
  }
  if (status === 'anonymous') return <LoginPage />

  return <Shell />
}

function Shell() {
  const [view, setView] = useState<View>('home')

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-page">
      {view === 'home' && <Home onNavigate={setView} />}
      {view === 'checkin' && (
        <CheckInFlow onHome={() => setView('home')} onBookNow={() => setView('booking')} onStore={() => setView('store')} />
      )}
      {view === 'academy' && <AcademyRegister onHome={() => setView('home')} />}
      {view === 'membership' && <MembershipCounter onHome={() => setView('home')} />}
      {view === 'booking' && <BookingFlow onDone={() => setView('home')} />}
      {view === 'store' && <StorePage onHome={() => setView('home')} />}
      {view === 'checkout' && <CheckoutFlow onHome={() => setView('home')} />}
    </div>
  )
}

export default App
