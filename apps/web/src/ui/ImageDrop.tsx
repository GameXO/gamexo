/**
 * Pick an image, upload it, hand back its URL.
 *
 * Wraps the whole round trip — file picker, browser-side downscale, POST /uploads —
 * so a caller only ever deals in URLs. Errors are rendered inline rather than
 * thrown: a failed logo upload should not take down the form it sits in.
 */
import { useRef, useState } from 'react'
import { ImagePlus, Loader2, X } from 'lucide-react'
import { useUploadImage } from '../api/hooks'
import { mediaUrl } from '../api/client'
import { ApiError } from '../api/client'

export default function ImageDrop({
  value,
  onChange,
  label = 'Upload an image',
  className = '',
  round = false,
}: {
  value: string | null
  onChange: (url: string | null) => void
  label?: string
  className?: string
  round?: boolean
}) {
  const input = useRef<HTMLInputElement>(null)
  const upload = useUploadImage()
  const [error, setError] = useState<string | null>(null)

  async function pick(file: File | undefined) {
    if (!file) return
    setError(null)
    try {
      const { url } = await upload.mutateAsync(file)
      onChange(url)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That image could not be uploaded.')
    } finally {
      // Cleared so choosing the same file twice fires a change event again.
      if (input.current) input.current.value = ''
    }
  }

  const shape = round ? 'rounded-full' : 'rounded-xl'

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <div className="flex items-center gap-3">
        {value ? (
          <div className={`relative size-20 overflow-hidden border border-border-card ${shape}`}>
            <img src={mediaUrl(value)} alt="" className="size-full object-cover" />
            <button
              type="button"
              onClick={() => onChange(null)}
              aria-label="Remove image"
              className="absolute right-0.5 top-0.5 rounded-full bg-ink/70 p-1 text-white"
            >
              <X size={11} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={upload.isPending}
            className={`flex size-20 flex-col items-center justify-center gap-1 border border-dashed border-border-input text-muted hover:border-ink hover:text-ink disabled:opacity-50 ${shape}`}
          >
            {upload.isPending ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <ImagePlus size={18} />
            )}
          </button>
        )}

        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={upload.isPending}
            className="self-start rounded-lg border border-border-input px-3 py-1.5 text-sm font-medium text-ink hover:border-ink disabled:opacity-50"
          >
            {upload.isPending ? 'Uploading…' : value ? 'Replace' : label}
          </button>
          <span className="text-xs text-muted">PNG, JPEG or WebP.</span>
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      )}

      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => void pick(e.target.files?.[0])}
      />
    </div>
  )
}
