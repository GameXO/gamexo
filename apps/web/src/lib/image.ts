/**
 * Shrink an image in the browser before uploading it.
 *
 * A photo taken on a phone is 3–8 MB and 4000px wide. A court card renders it at
 * roughly 600px. Uploading the original spends the owner's data, hits the API's
 * 5 MB cap on a perfectly ordinary photo, and stores something nothing will ever
 * display at full size.
 *
 * Resizing here rather than server-side keeps the API free of an image library and
 * means the slow part happens on the device that already has the pixels in memory.
 */

/** Long edge, in CSS pixels. Comfortably above the largest size any layout uses,
 *  so a court photo still looks sharp on a 2× display. */
const MAX_EDGE = 1600
const QUALITY = 0.85

/** Types worth re-encoding. A GIF would lose its animation and an SVG has no
 *  pixels to resample, so both are better left alone — the API rejects them
 *  anyway, which is the error the user should see. */
const RESIZABLE = /^image\/(jpeg|png|webp)$/

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('That file could not be read as an image.'))
    }
    img.src = url
  })
}

/**
 * A downscaled JPEG, or the original file when shrinking it would not help.
 *
 * Never throws for a reason the caller can do nothing about: if the canvas is
 * unavailable or the decode fails, the original is returned and the API gets the
 * final say on whether it is acceptable. One code path rejects bad uploads, and it
 * is the one that also runs for every other client.
 */
export async function downscaleImage(file: File): Promise<Blob> {
  if (!RESIZABLE.test(file.type)) return file

  try {
    const img = await loadImage(file)
    const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height))

    // Already small enough, and re-encoding would only lose quality.
    if (scale === 1 && file.size < 1_000_000) return file

    const canvas = document.createElement('canvas')
    canvas.width = Math.round(img.width * scale)
    canvas.height = Math.round(img.height * scale)

    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', QUALITY),
    )
    // Keep whichever is smaller: re-encoding an already-optimised PNG screenshot
    // as JPEG can genuinely make it bigger.
    return blob && blob.size < file.size ? blob : file
  } catch {
    return file
  }
}
