/**
 * The handful of shared pieces the wizard and the landing page both use.
 *
 * Not a design system — five components, no variants beyond what two screens
 * actually need. Anything used once lives at its call site instead.
 */
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'

export function Logo({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <span
        aria-hidden
        className="grid h-9 w-9 place-items-center rounded-[10px] bg-lime text-lime-ink"
      >
        {/* The mark from the mockups: an hourglass-ish X in a rounded square. */}
        <svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden>
          <path
            d="M5 3.5h10a1 1 0 0 1 .7 1.7L11.4 9.3a1 1 0 0 0 0 1.4l4.3 4.1a1 1 0 0 1-.7 1.7H5a1 1 0 0 1-.7-1.7l4.3-4.1a1 1 0 0 0 0-1.4L4.3 5.2A1 1 0 0 1 5 3.5Z"
            fill="currentColor"
          />
        </svg>
      </span>
      <span className="font-display text-[19px] font-extrabold tracking-tight text-ink">
        XCSports
      </span>
    </div>
  )
}

export function Button({
  children,
  variant = 'primary',
  loading = false,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'dark'
  loading?: boolean
}) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-xl px-6 py-3.5 font-display text-[15px] font-bold transition disabled:cursor-not-allowed disabled:opacity-55'
  const variants = {
    primary: 'bg-lime text-ink hover:bg-lime-deep',
    dark: 'bg-ink text-white hover:bg-black',
    ghost: 'border border-border-soft bg-white text-ink hover:border-ink',
  }
  return (
    <button className={`${base} ${variants[variant]} ${className}`} {...rest}>
      {loading && (
        <span
          aria-hidden
          className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      )}
      {children}
    </button>
  )
}

export function ChevronRight() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="m6 3.5 4.5 4.5L6 12.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function Field({
  label,
  required,
  error,
  hint,
  children,
}: {
  label: string
  required?: boolean
  error?: string | null
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-[15px] font-medium text-ink">
        {label}
        {required && <span className="text-negative"> *</span>}
      </span>
      {children}
      {/* aria-live so a validation message that appears after a failed submit is
          announced, not just drawn. */}
      {error ? (
        <span role="alert" className="mt-1.5 block text-[13px] text-negative">
          {error}
        </span>
      ) : hint ? (
        <span className="mt-1.5 block text-[13px] text-muted">{hint}</span>
      ) : null}
    </label>
  )
}

export function Input({
  invalid,
  className = '',
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={`w-full rounded-xl border bg-white px-4 py-3.5 text-[15px] text-ink placeholder:text-muted focus:outline-none focus-visible:border-ink ${
        invalid ? 'border-negative' : 'border-border-input'
      } ${className}`}
      {...rest}
    />
  )
}

/** The lime progress rail from the mockups, with its `n/total` counter. */
export function Progress({ step, total }: { step: number; total: number }) {
  const pct = Math.round((step / total) * 100)
  return (
    <div className="flex items-center gap-4">
      <div
        className="h-2 flex-1 overflow-hidden rounded-full bg-[#d9d9d9]"
        role="progressbar"
        aria-valuenow={step}
        aria-valuemin={1}
        aria-valuemax={total}
        aria-label={`Step ${step} of ${total}`}
      >
        <div
          className="h-full rounded-full bg-lime transition-[width] duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="font-display text-[17px] font-bold text-muted tabular-nums">
        {step}/{total}
      </span>
    </div>
  )
}

/** An error the user can act on, rendered where they were looking. */
export function Alert({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="rounded-xl border border-negative/25 bg-negative/5 px-4 py-3 text-[14px] text-negative"
    >
      {children}
    </div>
  )
}
