import { useEffect, useState } from 'react'
import Sidebar from './components/Sidebar'
import Header from './components/Header'
import Dashboard from './components/Dashboard'
import BookingsPage from './components/BookingsPage'
import BookingFlow from './booking/BookingFlow'
import AddOns from './addons/AddOns'
import ActiveGames from './pos/ActiveGames'
import CourtsOverview from './facility/CourtsOverview'
import NotificationSettings from './manage/NotificationSettings'
import PaymentModes from './manage/PaymentModes'
import Integrations from './manage/Integrations'
import StaffManagement from './manage/StaffManagement'
import Coaches from './manage/Coaches'
import Users from './manage/Users'
import Membership from './manage/Membership'
import Invoices from './manage/Invoices'
import Coupons from './manage/Coupons'
import Members from './members/Members'
import Academy from './academy/Academy'
import Inventory from './inventory/Inventory'
import PublishedEquipmentBridge from './inventory/PublishedEquipmentBridge'
import SportCourtBridge from './booking/SportCourtBridge'
import SettingsPage from './settings/SettingsPage'
import { demoBookings } from './data/booking'
import * as db from './lib/db'
import { useAuth } from './auth/AuthProvider'
import AuthGate from './auth/AuthGate'
import OnboardingWizard from './onboarding/OnboardingWizard'
import dashboardSquareHeader from './assets/figma/dashboard-square-header.svg'
import bolt from './assets/figma/bolt.svg'
import calendar from './assets/figma/calendar.svg'
import shoppingCartAdd from './assets/figma/shopping-cart-add.svg'
import dices from './assets/figma/dices.svg'
import storeManagement from './assets/figma/store-management.svg'
import userPlusDark from './assets/figma/user-plus-dark.svg'
import mortarboard from './assets/figma/mortarboard.svg'
import packageDelivered from './assets/figma/package-delivered.svg'
import helpSquareRounded from './assets/figma/help-square-rounded.svg'
import settings from './assets/figma/settings.svg'
import olympicTorch from './assets/figma/olympic-torch.svg'

export type View =
  | 'dashboard'
  | 'booking'
  | 'addons'
  | 'activeCourts'
  | 'bookings'
  | 'members'
  | 'academy'
  | 'equipment'
  | 'events'
  | 'sales'
  | 'settings'
  | 'helpCenter'
  | 'manageCourts'
  | 'manageCoaches'
  | 'manageUsers'
  | 'manageMembership'
  | 'manageInvoices'
  | 'manageCoupons'
  | 'managePaymentModes'
  | 'manageIntegrations'
  | 'manageNotifications'
  | 'manageStaff'

function App() {
  const { status, me } = useAuth()

  if (status === 'checking') {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-page text-sm text-slate">
        Loading…
      </div>
    )
  }
  if (status === 'anonymous') return <AuthGate />

  const tenant = me?.tenant as { onboarding_completed?: boolean } | undefined
  if (tenant?.onboarding_completed === false) return <OnboardingWizard />

  return <Shell />
}

function Shell() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [view, setView] = useState<View>('dashboard')
  const [prefillCourtId, setPrefillCourtId] = useState<string | null>(null)

  // Screens still on localStorage need their demo rows. Migrated screens read
  // the API instead and ignore this entirely.
  useEffect(() => db.seedBookingsIfEmpty(demoBookings), [])

  const navigate = (next: View) => {
    setView(next)
    setSidebarOpen(false)
  }

  const startBookingForCourt = (courtId: string) => {
    setPrefillCourtId(courtId)
    navigate('booking')
  }

  return (
    <div className="flex h-screen w-full items-stretch overflow-hidden bg-page">
      <PublishedEquipmentBridge />
      <SportCourtBridge />
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} view={view} onNavigate={navigate} />

      <div className="flex h-screen flex-1 flex-col overflow-hidden border-l border-[#ebf0f4]">
        {view === 'dashboard' && (
          <>
            <Header onMenuClick={() => setSidebarOpen(true)} onNavigate={navigate} title="Dashboard" icon={dashboardSquareHeader} />
            <Dashboard />
          </>
        )}
        {view === 'booking' && (
          <>
            <Header onMenuClick={() => setSidebarOpen(true)} onNavigate={navigate} title="New Booking" icon={bolt} />
            <BookingFlow
              initialCourtId={prefillCourtId ?? undefined}
              onDone={() => {
                setPrefillCourtId(null)
                navigate('dashboard')
              }}
            />
          </>
        )}
        {view === 'addons' && (
          <>
            <Header onMenuClick={() => setSidebarOpen(true)} onNavigate={navigate} title="Add-ons" icon={shoppingCartAdd} />
            <AddOns />
          </>
        )}
        {view === 'bookings' && (
          <>
            <Header onMenuClick={() => setSidebarOpen(true)} onNavigate={navigate} title="Bookings" icon={calendar} />
            <BookingsPage />
          </>
        )}
        {view === 'activeCourts' && (
          <>
            <Header onMenuClick={() => setSidebarOpen(true)} onNavigate={navigate} title="Active Courts" icon={dices} />
            <ActiveGames onStartBooking={startBookingForCourt} />
          </>
        )}
        {view === 'members' && (
          <>
            <Header onMenuClick={() => setSidebarOpen(true)} onNavigate={navigate} title="Members" icon={userPlusDark} />
            <Members />
          </>
        )}
        {view === 'academy' && (
          <>
            <Header onMenuClick={() => setSidebarOpen(true)} onNavigate={navigate} title="Academy" icon={mortarboard} />
            <Academy />
          </>
        )}
        {view === 'equipment' && (
          <>
            <Header onMenuClick={() => setSidebarOpen(true)} onNavigate={navigate} title="Inventory" icon={packageDelivered} />
            <Inventory />
          </>
        )}
        {view === 'manageCourts' && (
          <>
            <Header onMenuClick={() => setSidebarOpen(true)} onNavigate={navigate} title="Courts Overview" icon={storeManagement} />
            <CourtsOverview onStartBooking={() => navigate('booking')} />
          </>
        )}
        {view === 'manageCoaches' && (
          <>
            <Header onMenuClick={() => setSidebarOpen(true)} onNavigate={navigate} title="Coaches" icon={storeManagement} />
            <Coaches />
          </>
        )}
        {view === 'manageUsers' && (
          <>
            <Header onMenuClick={() => setSidebarOpen(true)} onNavigate={navigate} title="Users" icon={storeManagement} />
            <Users />
          </>
        )}
        {view === 'manageMembership' && (
          <>
            <Header onMenuClick={() => setSidebarOpen(true)} onNavigate={navigate} title="Membership" icon={storeManagement} />
            <Membership />
          </>
        )}
        {view === 'manageInvoices' && (
          <>
            <Header onMenuClick={() => setSidebarOpen(true)} onNavigate={navigate} title="Invoices" icon={storeManagement} />
            <Invoices />
          </>
        )}
        {view === 'manageCoupons' && (
          <>
            <Header onMenuClick={() => setSidebarOpen(true)} onNavigate={navigate} title="Discount Coupons" icon={storeManagement} />
            <Coupons />
          </>
        )}
        {view === 'managePaymentModes' && (
          <>
            <Header onMenuClick={() => setSidebarOpen(true)} onNavigate={navigate} title="Payment Modes" icon={storeManagement} />
            <PaymentModes />
          </>
        )}
        {view === 'manageIntegrations' && (
          <>
            <Header onMenuClick={() => setSidebarOpen(true)} onNavigate={navigate} title="Integrations" icon={storeManagement} />
            <Integrations />
          </>
        )}
        {view === 'manageNotifications' && (
          <>
            <Header onMenuClick={() => setSidebarOpen(true)} onNavigate={navigate} title="Notification Settings" icon={storeManagement} />
            <NotificationSettings />
          </>
        )}
        {view === 'sales' && (
          <>
            <Header onMenuClick={() => setSidebarOpen(true)} onNavigate={navigate} title="Sales" icon={shoppingCartAdd} />
            <ComingSoon label="Sales" />
          </>
        )}
        {view === 'events' && (
          <>
            <Header onMenuClick={() => setSidebarOpen(true)} onNavigate={navigate} title="Events" icon={olympicTorch} />
            <ComingSoon label="Events" />
          </>
        )}
        {view === 'settings' && (
          <>
            <Header onMenuClick={() => setSidebarOpen(true)} onNavigate={navigate} title="Settings" icon={settings} />
            <SettingsPage />
          </>
        )}
        {view === 'helpCenter' && (
          <>
            <Header onMenuClick={() => setSidebarOpen(true)} onNavigate={navigate} title="Help Center" icon={helpSquareRounded} />
            <ComingSoon label="Help Center" />
          </>
        )}
        {view === 'manageStaff' && (
          <>
            <Header onMenuClick={() => setSidebarOpen(true)} onNavigate={navigate} title="Manage Staff" icon={storeManagement} />
            <StaffManagement />
          </>
        )}
      </div>
    </div>
  )
}

function ComingSoon({ label }: { label: string }) {
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="rounded-3xl border border-dashed border-border-card bg-white/80 px-10 py-12 text-center shadow-sm">
        <p className="text-xl font-semibold text-ink">{label} is coming soon</p>
        <p className="mt-3 text-sm text-slate">We’re building this experience now. Check back soon for the launch.</p>
      </div>
    </div>
  )
}

export default App
