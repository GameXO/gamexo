/**
 * Up to five photos of one court, in order. The first is the cover.
 *
 * A strip rather than a grid: order matters (the cover is whichever is first) and
 * a horizontal row makes "this one is first" legible without a drag interaction.
 */
import { useRef, useState } from 'react'
import { ImagePlus, Loader2, Star, X } from 'lucide-react'
import { useUploadImage } from '../api/hooks'
import { mediaUrl, ApiError } from '../api/client'

export const MAX_IMAGES = 5

export default function CourtImages({
  value,
  onChange,
}: {
  value: string[]
  onChange: (next: string[]) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const upload = useUploadImage()
  const [error, setError] = useState<string | null>(null)

  const full = value.length >= MAX_IMAGES

  async function pick(files: FileList | null) {
    if (!files?.length) return
    setError(null)
    // Sequential, not Promise.all: the API caps each file at 5 MB and five
    // simultaneous uploads from a phone is how you find the connection's limit.
    const added: string[] = []
    try {
      for (const file of Array.from(files).slice(0, MAX_IMAGES - value.length)) {
        const { url } = await upload.mutateAsync(file)
        added.push(url)
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That image could not be uploaded.')
    } finally {
      // Whatever did upload is kept — losing three successful uploads because the
      // fourth failed would be the worse outcome.
      if (added.length) onChange([...value, ...added])
      if (input.current) input.current.value = ''
    }
  }

  const removeAt = (i: number) => onChange(value.filter((_, n) => n !== i))

  /** Promotes an image to the cover by moving it to the front. */
  const makeCover = (i: number) =>
    onChange([value[i], ...value.filter((_, n) => n !== i)])

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {value.map((url, i) => (
          <div
            key={`${url}-${i}`}
            className="group relative size-[72px] overflow-hidden rounded-lg border border-border-card"
          >
            <img src={mediaUrl(url)} alt="" className="size-full object-cover" />

            {i === 0 ? (
              <span className="absolute inset-x-0 bottom-0 bg-ink/70 py-0.5 text-center text-[10px] font-medium text-white">
                Cover
              </span>
            ) : (
              <button
                type="button"
                onClick={() => makeCover(i)}
                title="Make cover"
                className="absolute bottom-0.5 left-0.5 rounded-full bg-ink/70 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100"
              >
                <Star size={10} />
              </button>
            )}

            <button
              type="button"
              onClick={() => removeAt(i)}
              aria-label="Remove photo"
              className="absolute right-0.5 top-0.5 rounded-full bg-ink/70 p-1 text-white"
            >
              <X size={10} />
            </button>
          </div>
        ))}

        {!full && (
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={upload.isPending}
            className="flex size-[72px] items-center justify-center rounded-lg border border-dashed border-border-input text-muted hover:border-ink hover:text-ink disabled:opacity-50"
          >
            {upload.isPending ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <ImagePlus size={16} />
            )}
          </button>
        )}
      </div>

      <span className="text-xs text-muted">
        {value.length} of {MAX_IMAGES}. The first photo is the cover.
      </span>

      {error && (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      )}

      <input
        ref={input}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => void pick(e.target.files)}
      />
    </div>
  )
}
