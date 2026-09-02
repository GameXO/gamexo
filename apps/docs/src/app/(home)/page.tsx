import Link from 'next/link';

const entries = [
  {
    href: '/docs/integrations',
    title: 'Booking integrations',
    body: 'Sell court time through gamexo. Availability, holds, bookings and cancellation, with the same guarantees whichever wire format you speak.',
    cta: 'Read the integration guide',
  },
  {
    href: '/docs/payments',
    title: 'Payments',
    body: 'Connect a payment gateway to collect online and at the counter. Five providers, and an honest answer about which of them can be verified.',
    cta: 'Set up payments',
  },
];

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-20">
      <div className="w-full max-w-3xl">
        <p className="text-fd-muted-foreground text-sm font-medium">gamexo</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
          Developer documentation
        </h1>
        <p className="text-fd-muted-foreground mt-4 max-w-2xl text-base leading-relaxed">
          gamexo runs sports venues — bookings, a walk-in counter, memberships, an
          academy. Two parts of it are open to the outside world, and this is the
          reference for both.
        </p>

        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {entries.map((entry) => (
            <Link
              key={entry.href}
              href={entry.href}
              className="border-fd-border bg-fd-card hover:border-fd-primary/40 group rounded-xl border p-5 transition-colors"
            >
              <h2 className="font-semibold">{entry.title}</h2>
              <p className="text-fd-muted-foreground mt-2 text-sm leading-relaxed">
                {entry.body}
              </p>
              <span className="text-fd-primary mt-4 inline-block text-sm font-medium">
                {entry.cta} →
              </span>
            </Link>
          ))}
        </div>

        <p className="text-fd-muted-foreground mt-10 text-sm">
          Building a booking platform and not sure where to start? The{' '}
          <Link href="/docs/integrations/concepts" className="text-fd-foreground underline">
            core concepts
          </Link>{' '}
          page is short, and it is the part that stops a retry from selling the same
          court twice.
        </p>
      </div>
    </main>
  );
}
