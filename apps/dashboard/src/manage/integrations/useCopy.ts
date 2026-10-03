import { useState } from 'react'

/** Copy-to-clipboard with a two-second acknowledgement. A copy button with no
 *  feedback leaves people clicking it twice to be sure. */
export function useCopy(value: string) {
  const [copied, setCopied] = useState(false)
  return {
    copied,
    copy: async () => {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    },
  }
}
