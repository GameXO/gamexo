/**
 * Settings — currently one section, because one section is what exists.
 *
 * The page is deliberately a list of cards rather than tabs: with a single entry,
 * tabs would be a navigation control that navigates nowhere. Adding business
 * details, taxes and branding later means adding cards here, and reaching for tabs
 * when there are genuinely too many to scan.
 */
import { useAuth } from '../auth/AuthProvider'
import { ChangePassword } from './ChangePassword'
import { ServicesPicker } from './ServicesPicker'

export default function SettingsPage() {
  const { me } = useAuth()
  const isAdmin = me?.user?.role === 'admin'

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="mx-auto w-full max-w-2xl space-y-4">
        {isAdmin ? (
          <>
            <ServicesPicker />
            <ChangePassword />
          </>
        ) : (
          /* Not an error, and not styled like one. A receptionist opening Settings
             has done nothing wrong; there is simply nothing here for them yet. */
          <div className="rounded-2xl border border-border-card bg-surface p-6">
            <h2 className="font-display text-lg font-semibold text-ink">Settings</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate">
              There's nothing here for your account yet. Ask an admin if you need
              your password changed.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
