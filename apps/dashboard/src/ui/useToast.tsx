import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, X } from 'lucide-react'

type Tone = 'success' | 'error'

/**
 * A transient message at the bottom of the screen.
 *
 * `const { toast, notify } = useToast()` — render `{toast}` once anywhere in the
 * screen and call `notify('Football added successfully')`. A newer message replaces
 * the one showing rather than stacking, and errors stay a little longer because they
 * are the ones that need reading.
 */
export function useToast() {
  const [state, setState] = useState<{ message: string; tone: Tone; id: number } | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const counter = useRef(0)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const dismiss = useCallback(() => {
    window.clearTimeout(timer.current)
    setState(null)
  }, [])

  const notify = useCallback((message: string, tone: Tone = 'success') => {
    window.clearTimeout(timer.current)
    counter.current += 1
    setState({ message, tone, id: counter.current })
    timer.current = window.setTimeout(() => setState(null), tone === 'error' ? 6000 : 3500)
  }, [])

  const toast = state ? (
    <div
      key={state.id}
      role={state.tone === 'error' ? 'alert' : 'status'}
      className="fixed bottom-6 left-1/2 z-[80] flex max-w-[92vw] -translate-x-1/2 animate-rise items-center gap-3 rounded-lg bg-ink py-3 pl-4 pr-3 text-sm text-white shadow-pop motion-reduce:animate-none"
    >
      {state.tone === 'error' ? (
        <AlertCircle size={18} className="shrink-0 text-flame" />
      ) : (
        <CheckCircle2 size={18} className="shrink-0 text-lime" />
      )}
      <span>{state.message}</span>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="flex size-6 shrink-0 items-center justify-center rounded-md text-white/60 hover:bg-white/10 hover:text-white"
      >
        <X size={14} />
      </button>
    </div>
  ) : null

  return { toast, notify }
}
