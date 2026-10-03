import { Check, Copy } from '../../ui/icons'
import { useCopy } from './useCopy'

/** A read-only value with its copy button beside it. `wrap` keeps every character
 *  visible — used for the one-time API key, which someone may be checking by eye. */
export default function CopyField({
  label,
  value,
  wrap,
}: {
  label: string
  value: string
  wrap?: boolean
}) {
  const { copied, copy } = useCopy(value)
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold tracking-wide text-slate uppercase">{label}</p>
      <div className="flex items-stretch gap-2">
        <code
          className={`min-w-0 flex-1 rounded-xl border border-border-input bg-white px-3.5 py-2.5 font-mono text-xs text-ink select-all ${
            wrap ? 'break-all' : 'truncate'
          }`}
        >
          {value}
        </code>
        <button
          type="button"
          onClick={() => void copy()}
          className="flex shrink-0 items-center gap-1.5 rounded-xl border border-border-input bg-white px-3.5 text-sm font-semibold text-ink hover:bg-hover"
        >
          {copied ? <Check size={14} className="text-positive" /> : <Copy size={14} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  )
}
