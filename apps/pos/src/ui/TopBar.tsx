import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { MapPin } from 'lucide-react'
import { asset } from '../lib/asset'
import { useBranch } from '../branch/useBranch'
import { getStoredLanguage, LANGUAGES, loadGoogleTranslate, setLanguage, type LangCode } from '../lib/googleTranslate'

const logoMark = asset('brand/logo-mark.svg')
const languageIcon = asset('pos/checkin/language.svg')

/** Machine-translates the whole app via Google's free Website Translator widget — this
 *  button drives its hidden <select> directly instead of showing Google's own UI. */
export function LanguagePill() {
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState<LangCode>(() => getStoredLanguage())
  const [switching, setSwitching] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void loadGoogleTranslate()
  }, [])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const pick = async (code: LangCode) => {
    setOpen(false)
    if (code === current) return
    setSwitching(true)
    try {
      await setLanguage(code)
      setCurrent(code)
    } finally {
      setSwitching(false)
    }
  }

  const label = LANGUAGES.find((l) => l.code === current)?.label ?? 'English'

  return (
    <div ref={rootRef} className="notranslate relative h-full">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={switching}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-full items-center gap-2.5 rounded-xl bg-surface px-[clamp(0.75rem,1.4vw,1.125rem)] py-3 text-ink shadow-[0px_12px_17px_-9px_rgba(0,0,0,0.12)] disabled:opacity-60"
      >
        <img src={languageIcon} alt="" className="size-[clamp(1.1rem,1.4vw,1.5rem)]" />
        <span className="whitespace-nowrap text-[clamp(0.875rem,1vw,1rem)] font-medium">
          {switching ? 'Translating…' : label}
        </span>
        <ChevronDown size={12} strokeWidth={2.5} />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute right-0 top-[calc(100%+0.5rem)] z-50 flex min-w-[9.5rem] flex-col gap-1 rounded-xl bg-surface p-1.5 shadow-[0px_20px_45px_-15px_rgba(0,0,0,0.25)]"
        >
          {LANGUAGES.map((l) => (
            <button
              key={l.code}
              type="button"
              role="option"
              aria-selected={l.code === current}
              onClick={() => void pick(l.code)}
              className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-[clamp(0.875rem,1vw,1rem)] font-medium transition-colors ${
                l.code === current ? 'bg-ink text-white' : 'text-ink hover:bg-surface-muted'
              }`}
            >
              {l.label}
              {l.code === current && <Check size={14} strokeWidth={2.5} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function TopBar({
  centerTitle,
  rightExtra,
  onLogoClick,
  onLogoDoubleClick,
  logoMenu,
}: {
  centerTitle?: string
  rightExtra?: ReactNode
  onLogoClick: () => void
  onLogoDoubleClick?: () => void
  logoMenu?: ReactNode
}) {
  const { branch, multi, switchBranch } = useBranch()
  return (
    <header className="relative flex w-full shrink-0 items-center justify-between gap-4 px-[clamp(1.25rem,3vw,3.25rem)] py-[clamp(0.625rem,1.8dvh,1.75rem)]">
      <div className="flex min-w-0 items-center gap-[clamp(0.625rem,1.2vw,1rem)]">
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={onLogoClick}
            onDoubleClick={onLogoDoubleClick}
            className="flex items-center gap-2.5"
          >
            <img src={logoMark} alt="" className="h-[clamp(1.75rem,2.3vw,2.2rem)] w-auto" />
            <span className="notranslate font-display text-[clamp(1rem,1.05vw,1.1rem)] font-bold text-ink">XCSports</span>
          </button>
          {logoMenu}
        </div>

        {branch && (
          // Which site this counter is at. Tappable only when there is another to move
          // to; a single-site academy just sees where it is.
          <button
            type="button"
            onClick={multi ? switchBranch : undefined}
            disabled={!multi}
            className="notranslate flex min-w-0 shrink items-center gap-1.5 rounded-xl bg-surface px-3 py-2 text-[clamp(0.8125rem,1vw,0.9375rem)] font-medium text-ink disabled:cursor-default"
          >
            <MapPin size={14} strokeWidth={2} className="shrink-0" />
            <span className="truncate">{branch.name}</span>
          </button>
        )}
      </div>

      {centerTitle && (
        <p className="absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 whitespace-nowrap text-[clamp(1.1rem,1.6vw,1.375rem)] font-semibold text-ink md:block">
          {centerTitle}
        </p>
      )}

      <div className="flex shrink-0 items-center gap-[clamp(0.625rem,1.2vw,1.25rem)]">
        <LanguagePill />
        {rightExtra}
      </div>
    </header>
  )
}
