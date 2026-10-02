import * as db from '../lib/db'
import type { NotifChannel } from '../lib/db'
import { SettingsPanel } from '../settings/SettingsPanel'
import Toggle from './Toggle'

const ROWS: { id: string; title: string; desc: string }[] = [
  { id: 'bookingConfirmation', title: 'Booking Confirmation', desc: 'Send immediately after booking' },
  { id: 'bookingReminder', title: 'Booking Reminder', desc: '1 hour before booking' },
  { id: 'bookingStarted', title: 'Booking Started', desc: 'At booking start time' },
  { id: 'bookingEndingSoon', title: 'Booking Ending Soon', desc: '15 minutes before end' },
  { id: 'invoiceSent', title: 'Invoice Sent', desc: 'After payment' },
  { id: 'paymentReminder', title: 'Payment Reminder', desc: 'For pending payments' },
]

const CHANNELS: { id: NotifChannel; label: string }[] = [
  { id: 'email', label: 'Email' },
  { id: 'whatsapp', label: 'Whatsapp' },
  { id: 'sms', label: 'Sms' },
]

export default function NotificationSettings() {
  db.useDbVersion()
  const prefs = db.getNotifPrefs()

  return (
    <SettingsPanel
      title="Customer notifications"
      description="Pick the channels each message goes out on."
      flush
    >
      {ROWS.map((row) => {
        const pref = prefs[row.id] || { email: false, whatsapp: false, sms: false }
        return (
          <div
            key={row.id}
            className="flex flex-col gap-4 border-b border-dashed border-border-soft py-5 last:border-b-0 lg:flex-row lg:items-center lg:justify-between"
          >
            <div>
              <p className="text-sm font-medium text-ink">{row.title}</p>
              <p className="mt-0.5 text-[12px] text-muted">{row.desc}</p>
            </div>
            <div className="flex flex-wrap items-center gap-6">
              {CHANNELS.map((channel) => (
                <label key={channel.id} className="flex items-center gap-2.5">
                  <Toggle checked={pref[channel.id]} onChange={() => db.toggleNotifPref(row.id, channel.id)} />
                  <span className="text-sm text-slate">{channel.label}</span>
                </label>
              ))}
            </div>
          </div>
        )
      })}
    </SettingsPanel>
  )
}
