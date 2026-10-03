import { HugeiconsIcon } from '@hugeicons/react'
import { sportIconFor } from './sportIcons'

/** A sport's Hugeicons glyph, drawn in the current text colour. */
export default function SportGlyph({
  sport,
  size = 18,
  className,
}: {
  sport: { name: string; slug?: string }
  size?: number
  className?: string
}) {
  return <HugeiconsIcon icon={sportIconFor(sport)} size={size} strokeWidth={1.6} className={className} aria-hidden />
}
