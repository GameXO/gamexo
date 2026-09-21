import {
  Bell,
  Clock,
  CreditCard,
  Landmark,
  Link2,
  Lock,
  Monitor,
  Settings2,
  ShieldCheck,
  User,
  Users,
  type LucideIcon,
} from 'lucide-react'

/** Every id has a matching branch in `SettingsPage`'s `renderSection` — ids
 *  without a real screen yet render as a "coming soon" card rather than being
 *  left out of the nav, the same way Sales/Events/Help Center are full nav
 *  items elsewhere in the app before their screens exist. */
export type SettingsSectionId =
  | 'general'
  | 'account'
  | 'team'
  | 'counterServices'
  | 'bookingRules'
  | 'notifications'
  | 'billing'
  | 'payments'
  | 'password'
  | 'security'
  | 'integrations'

export type SettingsNavItem = { id: SettingsSectionId; label: string; icon: LucideIcon }
export type SettingsNavGroup = { label: string; items: SettingsNavItem[] }

export const SETTINGS_NAV: SettingsNavGroup[] = [
  {
    label: 'Workspace',
    items: [
      { id: 'general', label: 'General', icon: Settings2 },
      { id: 'account', label: 'Account', icon: User },
      { id: 'team', label: 'Team & Roles', icon: Users },
    ],
  },
  {
    label: 'Operations',
    items: [
      { id: 'counterServices', label: 'Counter Services', icon: Monitor },
      { id: 'bookingRules', label: 'Booking Rules', icon: Clock },
      { id: 'notifications', label: 'Notifications', icon: Bell },
    ],
  },
  {
    label: 'Finance',
    items: [
      { id: 'billing', label: 'Billing & Plan', icon: CreditCard },
      { id: 'payments', label: 'Payments', icon: Landmark },
    ],
  },
  {
    label: 'Security',
    items: [
      { id: 'password', label: 'Password', icon: Lock },
      { id: 'security', label: 'Security & Sessions', icon: ShieldCheck },
    ],
  },
  {
    label: 'Integrations',
    items: [{ id: 'integrations', label: 'Integrations', icon: Link2 }],
  },
]
