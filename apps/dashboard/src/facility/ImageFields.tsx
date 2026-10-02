/**
 * Image pickers for sports and courts.
 *
 * Uploading and attaching are two steps on the API: `POST /uploads` stores the file
 * and hands back a URL, and the URL is then saved on whatever owns the picture. These
 * fields do the first step the moment a file is chosen and report the URL upward, so
 * the form's own Save is what attaches it — cancelling the form leaves an orphan
 * upload behind, which is harmless, rather than a half-saved record.
 */
import { useRef, useState } from 'react'
import { ImagePlus, Loader2, Plus, X } from 'lucide-react'
import { ApiError } from '../api/client'
import { useUploadImage } from '../api/hooks'

const ACCEPT = 'image/png,image/jpeg,image/webp'
const MAX_BYTES = 5 * 1024 * 1024

function useImagePicker(onUrl: (url: string) => void) {
  const upload = useUploadImage()
  const [error, setError] = useState<string | null>(null)

  async function pick(file: File | undefined) {
    if (!file) return
    setError(null)
    if (!ACCEPT.split(',').includes(file.type)) {
      setError('Use a PNG, JPEG or WebP image.')
      return
    }
    if (file.size > MAX_BYTES) {
      setError('That image is over 5 MB.')
      return
    }
    try {
      const saved = await upload.mutateAsync(file)
      onUrl(saved.url)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not upload that image. Please try again.')
    }
  }

  return { pick, uploading: upload.isPending, error }
}

/** One picture — a sport's cover. */
export function ImageUploader({
  value,
  onChange,
  label = 'Upload image',
}: {
  value: string | null
  onChange: (url: string | null) => void
  label?: string
}) {
  const input = useRef<HTMLInputElement>(null)
  const { pick, uploading, error } = useImagePicker(onChange)

  return (
    <div>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        onChange={(e) => {
          void pick(e.target.files?.[0])
          e.target.value = ''
        }}
      />

      {value ? (
        <div className="flex items-center gap-4">
          <img src={value} alt="" className="size-24 rounded-lg border border-border-card object-cover" />
          <div className="flex flex-col items-start gap-2">
            <button
              type="button"
              onClick={() => input.current?.click()}
              disabled={uploading}
              className="inline-flex items-center gap-2 rounded-lg border border-border-card bg-white px-3 py-2 text-sm font-medium text-ink shadow-control hover:bg-surface-muted disabled:opacity-50"
            >
              {uploading && <Loader2 size={14} className="animate-spin" />}
              Replace
            </button>
            <button
              type="button"
              onClick={() => onChange(null)}
              className="text-sm text-slate underline-offset-2 hover:text-negative hover:underline"
            >
              Remove
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={uploading}
          className="flex w-full flex-col items-center gap-2 rounded-lg border border-dashed border-border-soft bg-surface px-4 py-8 text-sm text-slate transition-colors hover:border-ink hover:bg-white disabled:opacity-60"
        >
          {uploading ? <Loader2 size={20} className="animate-spin" /> : <ImagePlus size={20} />}
          <span className="font-medium text-ink">{uploading ? 'Uploading…' : label}</span>
          <span className="text-xs text-muted">PNG, JPEG or WebP, up to 5 MB</span>
        </button>
      )}

      {error && (
        <p role="alert" className="mt-2 text-[12px] text-negative">
          {error}
        </p>
      )}
    </div>
  )
}

/** Several pictures, with a cap. */
export function ImageGallery({
  values,
  onChange,
  max,
}: {
  values: string[]
  onChange: (urls: string[]) => void
  max: number
}) {
  const input = useRef<HTMLInputElement>(null)
  const { pick, uploading, error } = useImagePicker((url) => onChange([...values, url]))
  const full = values.length >= max

  return (
    <div>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        onChange={(e) => {
          void pick(e.target.files?.[0])
          e.target.value = ''
        }}
      />

      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 xl:grid-cols-5">
        {values.map((url, i) => (
          <div key={url + i} className="group relative aspect-square overflow-hidden rounded-lg border border-border-card">
            <img src={url} alt="" className="size-full object-cover" />
            <button
              type="button"
              onClick={() => onChange(values.filter((_, idx) => idx !== i))}
              aria-label="Remove photo"
              className="absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-md bg-black/60 text-white opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100"
            >
              <X size={13} />
            </button>
          </div>
        ))}

        {!full && (
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={uploading}
            className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border-soft bg-surface text-xs text-slate transition-colors hover:border-ink hover:bg-white disabled:opacity-60"
          >
            {uploading ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />}
            {uploading ? 'Uploading' : 'Add photo'}
          </button>
        )}
      </div>

      <p className="mt-2 text-xs text-muted">
        {values.length} of {max} · PNG, JPEG or WebP, up to 5 MB each
      </p>
      {error && (
        <p role="alert" className="mt-1 text-[12px] text-negative">
          {error}
        </p>
      )}
    </div>
  )
}
