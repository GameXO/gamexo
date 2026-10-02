import { useState } from 'react'
import { asset } from '../lib/asset'

/**
 * A sport's picture: the venue's own upload if it has one, otherwise the CDN photo
 * stock sports use (`sports/<slug>.jpg`), otherwise the sport's emoji on its colour.
 * The CDN 404s for a sport the venue invented, which is what `onError` is for.
 */
export default function SportThumb({
  sport,
  className = 'size-11',
}: {
  sport: { slug: string; name: string; image_url?: string | null; icon?: string | null; bg_color?: string | null }
  className?: string
}) {
  const [failed, setFailed] = useState(false)
  const src = sport.image_url || asset(`sports/${sport.slug}.jpg`)

  if (failed) {
    return (
      <div
        className={`flex shrink-0 items-center justify-center rounded-lg text-lg ${className}`}
        style={{ background: sport.bg_color || '#F2F2F2' }}
        aria-hidden
      >
        {sport.icon || sport.name.charAt(0).toUpperCase()}
      </div>
    )
  }

  return (
    <img
      src={src}
      alt=""
      onError={() => setFailed(true)}
      className={`shrink-0 rounded-lg border border-border-card object-cover ${className}`}
    />
  )
}
