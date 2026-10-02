import { useState } from 'react'

const SIZE = {
  sm: 'size-8 text-[11px]',
  md: 'size-10 text-sm',
  lg: 'size-20 text-2xl',
} as const

/**
 * A student's photo, or their initials when there is none — or when the photo's URL
 * no longer loads. Falling back on the image's own `onError` rather than only on a
 * missing URL means a deleted upload shows a tidy circle instead of a broken-image
 * icon next to someone's name.
 */
export default function Avatar({
  name,
  initials,
  photoUrl,
  size = 'md',
}: {
  name: string
  initials?: string | null
  photoUrl?: string | null
  size?: keyof typeof SIZE
}) {
  const [failed, setFailed] = useState(false)
  const shown = initials || name.trim().slice(0, 2).toUpperCase()

  return (
    <span
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-lime/30 font-semibold text-lime-ink ${SIZE[size]}`}
    >
      {photoUrl && !failed ? (
        <img
          src={photoUrl}
          alt=""
          onError={() => setFailed(true)}
          className="size-full object-cover"
        />
      ) : (
        shown
      )}
    </span>
  )
}
