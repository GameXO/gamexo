/**
 * The marketing page. One job: get a venue owner into the signup wizard.
 *
 * Prices are fetched rather than written here, from the same `GET /signup/plans`
 * the checkout prices against — a pricing page that disagrees with the amount
 * charged is the worst possible bug on a marketing site, and the only way to be
 * sure they agree is for there to be one number.
 */
import { useEffect, useState } from 'react'
import { DASHBOARD_URL_FALLBACK, api, rupees, type Plan } from '../api/client'
import illustration from '../assets/he.png'
import { Button, ChevronRight, Logo } from '../ui/primitives'

const FEATURES = [
  {
    title: 'Bookings that never double-sell',
    body: 'Court hire, open slots and walk-ins in one calendar. Overlaps are refused by the database, not by a check that can race.',
  },
  {
    title: 'A counter that keeps up',
    body: 'Check people in by booking ID, take payments, rent kit and settle tabs — on a tablet, without training anyone.',
  },
  {
    title: 'Memberships and academy',
    body: 'Passes, packages and renewals. Batches, coaches and attendance. Turned on only if you run them.',
  },
  {
    title: 'Playo, Hudle and District',
    body: 'List your courts on the platforms your customers already use. One inventory, so a slot sold there is gone here.',
  },
  {
    title: 'GST invoices out of the box',
    body: 'Numbered per venue, taxed correctly, emailed automatically. Your accountant gets a report, not a shoebox.',
  },
  {
    title: 'Numbers you can act on',
    body: 'Occupancy by hour, revenue by sport, which courts pay for themselves and which do not.',
  },
]

export function Landing({ onStart }: { onStart: () => void }) {
  const [plans, setPlans] = useState<Plan[]>([])

  useEffect(() => {
    // A pricing section that fails to load is not worth an error state — the page
    // still sells, and the wizard prices the plan again before charging anything.
    api.plans().then(setPlans).catch(() => {})
  }, [])

  return (
    <div className="min-h-screen bg-page">
      <header className="mx-auto flex max-w-[1180px] items-center justify-between px-5 py-6">
        <Logo />
        <div className="flex items-center gap-2">
          <a
            href={DASHBOARD_URL_FALLBACK}
            className="rounded-xl px-4 py-2.5 text-[14px] font-medium text-slate hover:text-ink"
          >
            Sign in
          </a>
          <Button onClick={onStart} className="px-5 py-2.5 text-[14px]">
            Get started
          </Button>
        </div>
      </header>

      <main>
        {/* ── Hero ────────────────────────────────────────────────────────── */}
        <section className="mx-auto grid max-w-[1180px] items-center gap-10 px-5 py-10 lg:grid-cols-2 lg:gap-16 lg:py-16">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-border-soft bg-white px-3.5 py-1.5 text-[13px] font-medium text-slate">
              <span className="h-2 w-2 rounded-full bg-lime" aria-hidden />
              Built for Indian turfs, courts and academies
            </span>

            <h1 className="mt-5 font-display text-[42px] leading-[1.08] font-extrabold tracking-tight text-ink sm:text-[56px]">
              Run your whole venue on one platform.
            </h1>

            <p className="mt-5 max-w-[520px] text-[17px] leading-relaxed text-slate">
              Bookings, the counter, memberships, your academy and the reports that
              tell you which court actually pays for itself. Set up in three steps —
              you'll be taking bookings this afternoon.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button onClick={onStart}>
                Set up my venue <ChevronRight />
              </Button>
              <a
                href="#pricing"
                className="rounded-xl border border-border-soft bg-white px-6 py-3.5 font-display text-[15px] font-bold text-ink hover:border-ink"
              >
                See pricing
              </a>
            </div>

            <p className="mt-4 text-[13px] text-muted">
              No card needed to look around · Cancel any time
            </p>
          </div>

          <img
            src={illustration}
            alt=""
            aria-hidden
            className="mx-auto w-full max-w-[520px]"
          />
        </section>

        {/* ── Features ────────────────────────────────────────────────────── */}
        <section className="mx-auto max-w-[1180px] px-5 py-14">
          <h2 className="max-w-[640px] font-display text-[30px] leading-tight font-bold tracking-tight text-ink sm:text-[36px]">
            Everything a venue needs, and nothing it doesn't.
          </h2>
          <p className="mt-3 max-w-[560px] text-[16px] text-slate">
            Switch on what you run. The rest stays out of your sidebar.
          </p>

          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => (
              <article
                key={feature.title}
                className="rounded-2xl border border-border-card bg-surface p-6"
              >
                <h3 className="font-display text-[17px] font-bold text-ink">{feature.title}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-slate">{feature.body}</p>
              </article>
            ))}
          </div>
        </section>

        {/* ── How it works ────────────────────────────────────────────────── */}
        <section className="mx-auto max-w-[1180px] px-5 py-14">
          <div className="rounded-[28px] bg-ink p-8 sm:p-12">
            <h2 className="font-display text-[28px] leading-tight font-bold tracking-tight text-white sm:text-[34px]">
              Live in three steps.
            </h2>
            <ol className="mt-8 grid gap-6 sm:grid-cols-3">
              {[
                ['Tell us about your venue', 'Name, logo and the sports you offer.'],
                ['Pick your POS services', 'Check-in, memberships, rental shop — your call.'],
                ['Pay and start', 'Your login lands in your inbox and the dashboard opens.'],
              ].map(([title, body], index) => (
                <li key={title}>
                  <span className="grid h-9 w-9 place-items-center rounded-[10px] bg-lime font-display text-[15px] font-bold text-lime-ink">
                    {index + 1}
                  </span>
                  <h3 className="mt-3.5 font-display text-[16px] font-bold text-white">{title}</h3>
                  <p className="mt-1.5 text-[14px] leading-relaxed text-white/65">{body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ── Pricing ─────────────────────────────────────────────────────── */}
        <section id="pricing" className="mx-auto max-w-[1180px] scroll-mt-8 px-5 py-14">
          <h2 className="text-center font-display text-[30px] leading-tight font-bold tracking-tight text-ink sm:text-[36px]">
            Simple pricing, per venue.
          </h2>
          <p className="mt-3 text-center text-[16px] text-slate">
            Pay yearly and get two months free.
          </p>

          <div className="mt-10 grid gap-4 lg:grid-cols-3">
            {plans.map((plan) => (
              <article
                key={plan.code}
                className={`flex flex-col rounded-2xl border bg-surface p-7 ${
                  plan.popular ? 'border-ink ring-1 ring-ink' : 'border-border-card'
                }`}
              >
                <div className="flex items-center gap-2">
                  <h3 className="font-display text-[19px] font-bold text-ink">{plan.name}</h3>
                  {plan.popular && (
                    <span className="rounded-full bg-lime px-2.5 py-1 text-[11px] font-semibold text-lime-ink">
                      Most popular
                    </span>
                  )}
                </div>

                <p className="mt-2 min-h-[42px] text-[14px] leading-relaxed text-slate">
                  {plan.tagline}
                </p>

                <p className="mt-5 font-display text-[34px] font-extrabold tracking-tight text-ink tabular-nums">
                  {rupees(plan.price_monthly_paise)}
                  <span className="font-sans text-[14px] font-medium text-muted">/month</span>
                </p>
                <p className="mt-1 text-[13px] text-muted">
                  or {rupees(plan.price_yearly_paise)} billed yearly
                </p>

                <ul className="mt-6 flex-1 space-y-2">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex gap-2.5 text-[14px] text-slate">
                      <span aria-hidden className="text-positive">
                        ✓
                      </span>
                      {feature}
                    </li>
                  ))}
                </ul>

                <Button
                  onClick={onStart}
                  variant={plan.popular ? 'primary' : 'ghost'}
                  className="mt-7 w-full"
                >
                  Start with {plan.name}
                </Button>
              </article>
            ))}
          </div>

          <p className="mt-6 text-center text-[13px] text-muted">
            Prices exclude GST. Payments processed by Razorpay.
          </p>
        </section>

        {/* ── Closing ─────────────────────────────────────────────────────── */}
        <section className="mx-auto max-w-[1180px] px-5 pb-16">
          <div className="rounded-[28px] border border-border-card bg-surface p-10 text-center">
            <h2 className="font-display text-[28px] leading-tight font-bold tracking-tight text-ink sm:text-[32px]">
              Ready when you are.
            </h2>
            <p className="mx-auto mt-3 max-w-[460px] text-[15px] text-slate">
              Three steps and a payment. Your admin login is emailed the moment it
              clears.
            </p>
            <Button onClick={onStart} className="mt-7">
              Set up my venue <ChevronRight />
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t border-border-soft py-8 text-center text-[13px] text-muted">
        copyright @{new Date().getFullYear()} xcourt. All right Reserved
      </footer>
    </div>
  )
}
