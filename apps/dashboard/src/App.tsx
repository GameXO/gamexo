import { useEffect, useState } from 'react'
import Sidebar from './components/Sidebar'
import Header from './components/Header'
import Dashboard from './components/Dashboard'
import BookingsPage from './components/BookingsPage'
import BookingFlow from './booking/BookingFlow'
import AddOns from './addons/AddOns'
import ActiveGames from './pos/ActiveGames'
import SportsManagement from './facility/SportsManagement'
import SettingsPage from './settings/SettingsPage'
import BrandTheme from './theme/BrandTheme'
import { ActiveBranchProvider } from './branch/ActiveBranchProvider'
import { SETTINGS_NAV, type SettingsSectionId } from './settings/settingsNav'
import AllTenants from './manage/AllTenants'
import Users from './manage/Users'
import Invoices from './manage/Invoices'
import Coupons from './manage/Coupons'
import Members from './members/Members'
import Academy from './academy/Academy'
import Inventory from './inventory/Inventory'
import PublishedEquipmentBridge from './inventory/PublishedEquipmentBridge'
import SportCourtBridge from './booking/SportCourtBridge'
import { demoBookings } from './data/booking'
import * as db from './lib/db'
import { useAuth } from './auth/AuthProvider'
import LoginPage from './auth/LoginPage'
import { todayPreset, type DashboardRange } from './dashboard/insights'
import { asset } from './lib/asset'

const dashboardSquareHeader = asset('dashboard/dashboard-square-header.svg')
const bolt = asset('dashboard/bolt.svg')
const calendar = asset('dashboard/calendar.svg')
const shoppingCartAdd = asset('dashboard/shopping-cart-add.svg')
const dices = asset('dashboard/dices.svg')
const storeManagement = asset('dashboard/store-management.svg')
const userPlusDark = asset('dashboard/user-plus-dark.svg')
const mortarboard = asset('dashboard/mortarboard.svg')
const packageDelivered = asset('dashboard/package-delivered.svg')
const helpSquareRounded = asset('dashboard/help-square-rounded.svg')
const settings = asset('dashboard/settings.svg')
const olympicTorch = asset('dashboard/olympic-torch.svg')

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
  | 'manageUsers'
  | 'manageInvoices'
  | 'manageCoupons'
  | 'opsTenants'

function App() {
  const { status, needsTenantChoice } = useAuth()

  if (status === 'checking') {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-page text-sm text-slate">
        Loading…
      </div>
    )
  }
  if (status === 'anonymous') return <LoginPage />

  // A platform operator who has not stepped into an academy has no tenant, so
  // there is no dashboard to draw and every tenant-scoped request would 400.
  // The academy list *is* their home screen until they pick one.
  if (needsTenantChoice) return <OperatorHome />

  return (
    <ActiveBranchProvider>
      <Shell />
    </ActiveBranchProvider>
  )
}

/** `ops@gamexo` before choosing an academy: the list, and a way out. */
function OperatorHome() {
  const { operator, logout } = useAuth()
  return (
    <div className="flex h-screen w-full flex-col bg-page">
      <header className="flex items-center justify-between border-b border-border-soft px-6 py-4">
        <div>
          <p className="font-display text-[16px] font-semibold text-ink">gamexo Operations</p>
          <p className="text-[12px] text-slate">
            Signed in as {operator?.username ?? 'ops@gamexo'} · pick an academy to open it
          </p>
        </div>
        <button
          type="button"
          onClick={logout}
          className="rounded-lg border border-border-soft bg-white px-4 py-2 text-sm font-medium text-ink hover:border-ink"
        >
          Sign out
        </button>
      </header>
      <AllTenants />
    </div>
  )
}

function Shell() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [view, setView] = useState<View>('dashboard')
  // Held here so header search can open Settings straight on a section.
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId>('counterServices')
  const settingsLabel =
    SETTINGS_NAV.flatMap((g) => g.items).find((i) => i.id === settingsSection)?.label ?? 'Settings'
  const [prefillCourtId, setPrefillCourtId] = useState<string | null>(null)
  // Lives here rather than in Dashboard because the control that changes it is
  // in the header, which is Dashboard's sibling.
  const [range, setRange] = useState<DashboardRange>(todayPreset)

  // Screens still on localStorage need their demo rows. Migrated screens read
  // the API instead and ignore this entirely.
  useEffect(() => db.seedBookingsIfEmpty(demoBookings), [])

  const navigate = (next: View, section?: SettingsSectionId) => {
    if (section) setSettingsSection(section)
    setView(next)
    setSidebarOpen(false)
  }

  const startBookingForCourt = (courtId: string) => {
    setPrefillCourtId(courtId)
    navigate('booking')
  }

  return (
    <div className="flex h-screen w-full items-stretch overflow-hidden bg-page">
      <BrandTheme />
      <PublishedEquipmentBridge />
      <SportCourtBridge />
      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        view={view}
        section={settingsSection}
        onNavigate={navigate}
      />

      {/* `[&>*]:min-h-0` is load-bearing, not tidying.
       *
       * Every page in here is `flex-1 … overflow-y-auto` and expects to scroll
       * inside this fixed-height, overflow-hidden column. A flex item defaults to
       * `min-height: auto`, which refuses to shrink below its content — so a page
       * taller than the viewport grows instead of scrolling, `overflow-y-auto`
       * never activates, and this container simply clips whatever did not fit.
       * The bottom of a long table just disappears, with no scrollbar to say so.
       *
       * Applied here rather than as `min-h-0` on each of the twenty-odd page
       * roots, because the constraint that causes it — `h-screen` plus
       * `overflow-hidden` — lives here, and a per-page fix is one every new page
       * has to remember. The Header is `h-[72px] shrink-0`, so this is inert on it.
       */}
      {/* `key={view}` remounts the column on every navigation so each screen eases in
          instead of snapping. Only opacity and a few pixels of rise are animated, and
          only for 260ms — a drawer cannot be opened in that time, and a transform that
          has finished leaves nothing behind to trap `position: fixed` children. */}
      <div
        key={view}
        className="flex h-screen min-w-0 flex-1 animate-section-in flex-col overflow-hidden bg-page motion-reduce:animate-none [&>*]:min-h-0"
      >
        {view === 'dashboard' && (
          <>
            <Header
              onMenuClick={() => setSidebarOpen(true)}
              onNavigate={navigate}
              title="Dashboard"
              icon={dashboardSquareHeader}
              range={range}
              onRangeChange={setRange}
            />
            <Dashboard onNavigate={navigate} range={range} />
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
            <Header onMenuClick={() => setSidebarOpen(true)} onNavigate={navigate} title="Sports & Courts" crumbs={['Manage', 'Sports & Courts']} icon={storeManagement} />
            <SportsManagement />
          </>
        )}
        {view === 'manageUsers' && (
          <>
            <Header onMenuClick={() => setSidebarOpen(true)} onNavigate={navigate} title="Users" crumbs={['Manage', 'Users']} icon={storeManagement} />
            <Users />
          </>
        )}
        {view === 'manageInvoices' && (
          <>
            <Header onMenuClick={() => setSidebarOpen(true)} onNavigate={navigate} title="Invoices" crumbs={['Manage', 'Invoices']} icon={storeManagement} />
            <Invoices />
          </>
        )}
        {view === 'manageCoupons' && (
          <>
            <Header onMenuClick={() => setSidebarOpen(true)} onNavigate={navigate} title="Discount Coupons" crumbs={['Manage', 'Discount Coupons']} icon={storeManagement} />
            <Coupons />
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
            <Header onMenuClick={() => setSidebarOpen(true)} onNavigate={navigate} title="Settings" crumbs={['Settings', settingsLabel]} icon={settings} />
            <SettingsPage section={settingsSection} onSectionChange={setSettingsSection} />
          </>
        )}
        {view === 'helpCenter' && (
          <>
            <Header onMenuClick={() => setSidebarOpen(true)} onNavigate={navigate} title="Help Center" icon={helpSquareRounded} />
            <ComingSoon label="Help Center" />
          </>
        )}
        {view === 'opsTenants' && (
          <>
            <Header onMenuClick={() => setSidebarOpen(true)} onNavigate={navigate} title="All Academies" icon={storeManagement} />
            <AllTenants />
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
