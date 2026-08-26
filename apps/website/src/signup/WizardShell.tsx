/**
 * The frame every signup screen sits in: logo, illustration, card, footer.
 *
 * One component rather than repeated markup per step, because the frame is the
 * part that has to stay pixel-identical between steps — the illustration must not
 * shift by a pixel when the card's height changes, or moving between steps looks
 * like a page load.
 */
import type { ReactNode } from 'react'
import illustration from '../assets/he.png'
import { Logo, Progress } from '../ui/primitives'

export function WizardShell({
  step,
  total,
  title,
  subtitle,
  children,
  footer,
}: {
  /** Omit to render the card with no progress rail — the plan and success screens. */
  step?: number
  total?: number
  title: string
  subtitle?: string
  children: ReactNode
  /** The sticky action row. Separate from `children` so it always sits at the
   *  bottom of the card regardless of how tall the step's content is. */
  footer?: ReactNode
}) {
  return (
    <div className="flex min-h-screen flex-col bg-page px-5 py-8">
      <header className="flex justify-center">
        <Logo />
      </header>

      <main className="mx-auto flex w-full max-w-[1180px] flex-1 items-center">
        <div className="grid w-full items-center gap-8 py-8 lg:grid-cols-[1fr_minmax(0,620px)] lg:gap-16">
          {/* Decorative: it repeats nothing the card does not already say, so it is
              hidden from assistive tech rather than given invented alt text. */}
          <img
            src={illustration}
            alt=""
            aria-hidden
            className="mx-auto hidden w-full max-w-[520px] lg:block"
          />

          <section className="rounded-[28px] bg-surface p-8 shadow-[0_1px_2px_rgba(16,24,40,0.04)] sm:p-12">
            {step !== undefined && total !== undefined && (
              <div className="mb-8">
                <Progress step={step} total={total} />
              </div>
            )}

            <h1 className="text-center font-display text-[30px] leading-[1.2] font-bold tracking-tight text-ink sm:text-[34px]">
              {title}
            </h1>
            {subtitle && (
              <p className="mt-3 text-center text-[15px] text-slate">{subtitle}</p>
            )}

            <div className="mt-9">{children}</div>
            {footer && <div className="mt-8">{footer}</div>}
          </section>
        </div>
      </main>

      <footer className="pt-6 text-center text-[13px] text-muted">
        copyright @{new Date().getFullYear()} xcourt. All right Reserved
      </footer>
    </div>
  )
}
