import * as db from '../lib/db'
import type { NotifChannel } from '../lib/db'
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
    <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 py-5 sm:px-6">
      <p className="text-lg text-ink">Notification Settings</p>

      <div className="w-full overflow-hidden rounded-2xl border border-border-card bg-white shadow-[0px_5px_13px_0px_rgba(0,0,0,0.05)]">
        <p className="border-b border-border-card px-5 py-4 text-sm font-semibold text-ink">
          Customer Notifications
        </p>

        {ROWS.map((row, i) => {
          const pref = prefs[row.id] || { email: false, whatsapp: false, sms: false }
          return (
            <div
              key={row.id}
              className={`flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between ${
                i < ROWS.length - 1 ? 'border-b border-border-card' : ''
              }`}
            >
              <div>
                <p className="text-sm font-semibold text-ink">{row.title}</p>
                <p className="text-xs text-muted">{row.desc}</p>
              </div>
              <div className="flex flex-wrap items-center gap-5 sm:gap-6">
                {CHANNELS.map((channel) => (
                  <label key={channel.id} className="flex items-center gap-2">
                    <Toggle
                      checked={pref[channel.id]}
                      onChange={() => db.toggleNotifPref(row.id, channel.id)}
                    />
                    <span className="text-sm text-slate">{channel.label}</span>
                  </label>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
