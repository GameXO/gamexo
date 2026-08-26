/**
 * Step 1 — the turf's name, its logo, and the terms.
 *
 * The logo uploads the moment it is chosen rather than on Next. Two reasons: the
 * owner sees whether it actually looks right in a preview while they can still
 * change it, and a 5 MB upload does not sit between them and the next screen.
 */
import { useRef, useState } from 'react'
import { ApiError, api, type Signup } from '../api/client'
import { resolveMedia } from '../lib/media'
import { Alert, Button, ChevronRight, Field, Input } from '../ui/primitives'
import { WizardShell } from './WizardShell'

const MAX_BYTES = 5 * 1024 * 1024
const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']

export function BusinessStep({
  token,
  signup,
  onSaved,
}: {
  token: string
  signup: Signup
  onSaved: (next: Signup) => void
}) {
  const [name, setName] = useState(signup.business_name ?? '')
  const [logoUrl, setLogoUrl] = useState(signup.logo_url)
  const [accepted, setAccepted] = useState(signup.accepted_terms)
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nameError, setNameError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  async function upload(file: File | undefined) {
    if (!file) return
    setError(null)

    // Checked here as well as server-side, purely so a 6 MB file fails instantly
    // instead of after it has been uploaded. The server's check is the real one.
    if (!ACCEPTED.includes(file.type)) {
      setError('That file is not an SVG, PNG or JPEG.')
      return
    }
    if (file.size > MAX_BYTES) {
      setError('Logos must be under 5 MB.')
      return
    }
    if (file.type === 'image/svg+xml') {
      // The API stores PNG, JPEG and WebP only — an SVG is a script container, and
      // serving one back from our own domain is a stored XSS. Said plainly rather
      // than letting the upload 400 with a message about magic bytes.
      setError('SVG logos are not supported yet — please upload a PNG or JPEG.')
      return
    }

    setUploading(true)
    try {
      const { url } = await api.uploadLogo(token, file)
      setLogoUrl(url)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That upload failed. Please try again.')
    } finally {
      setUploading(false)
    }
  }

  async function next() {
    const trimmed = name.trim()
    if (!trimmed) {
      setNameError('Please tell us what your turf is called.')
      return
    }
    if (!accepted) {
      setError('Please accept the Terms & Conditions to continue.')
      return
    }

    setSaving(true)
    setError(null)
    try {
      onSaved(
        await api.saveSignup(token, {
          business_name: trimmed,
          accepted_terms: true,
          ...(logoUrl ? { logo_url: logoUrl } : {}),
        }),
      )
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <WizardShell
      step={1}
      total={3}
      title="Tell us about you Business to setup the platform for you."
      subtitle="Finish this and start managing immediately."
      footer={
        <Button className="w-full" onClick={next} loading={saving} disabled={saving || uploading}>
          Next <ChevronRight />
        </Button>
      }
    >
      <div className="space-y-6">
        <Field label="Turf Name" required error={nameError}>
          <Input
            value={name}
            invalid={Boolean(nameError)}
            onChange={(e) => {
              setName(e.target.value)
              setNameError(null)
            }}
            placeholder="Xcourtsports"
            autoFocus
            maxLength={200}
          />
        </Field>

        <div>
          <span className="mb-2 block text-[15px] font-medium text-ink">Upload Logo</span>

          {/* A div, not a label wrapping the input: the whole area is a drop target
              and clicking it opens the picker, but it also has to hold a Remove
              button, and a button inside a label triggers the file dialog too. */}
          <div
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragging(false)
              void upload(e.dataTransfer.files?.[0])
            }}
            className={`rounded-xl border border-dashed px-6 py-7 text-center transition ${
              dragging ? 'border-ink bg-lime/10' : 'border-border-soft bg-white'
            }`}
          >
            {logoUrl ? (
              <div className="flex items-center justify-center gap-4">
                <img
                  src={resolveMedia(logoUrl)}
                  alt="Your uploaded logo"
                  className="h-14 w-14 rounded-lg object-contain"
                />
                <button
                  type="button"
                  onClick={() => setLogoUrl(null)}
                  className="text-[14px] font-medium text-slate underline underline-offset-2 hover:text-ink"
                >
                  Remove
                </button>
              </div>
            ) : (
              <>
                <svg
                  className="mx-auto mb-2.5 text-slate"
                  width="26"
                  height="26"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden
                >
                  <path
                    d="M14 3v4a1 1 0 0 0 1 1h4M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8M12 18v-6m0 0-2.2 2.2M12 12l2.2 2.2"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <p className="text-[14px] text-ink">
                  {uploading ? (
                    'Uploading…'
                  ) : (
                    <>
                      Drag &amp; Drop or{' '}
                      <button
                        type="button"
                        onClick={() => fileInput.current?.click()}
                        className="font-medium text-[#3b82f6] underline-offset-2 hover:underline"
                      >
                        Choose file
                      </button>{' '}
                      to upload
                    </>
                  )}
                </p>
                <p className="mt-1 text-[12px] text-muted">Svg, png, jpeg</p>
              </>
            )}
            <input
              ref={fileInput}
              type="file"
              accept={ACCEPTED.join(',')}
              className="sr-only"
              onChange={(e) => {
                void upload(e.target.files?.[0])
                // Cleared so choosing the same file twice still fires a change event
                // — otherwise a re-pick after Remove silently does nothing.
                e.target.value = ''
              }}
            />
          </div>
        </div>

        <label className="flex items-start gap-3 text-[15px] text-ink">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(e) => {
              setAccepted(e.target.checked)
              setError(null)
            }}
            className="mt-0.5 h-[18px] w-[18px] shrink-0 accent-lime"
          />
          <span>
            I have read and accept{' '}
            <a
              href="/terms"
              target="_blank"
              rel="noreferrer"
              className="text-[#3b82f6] underline-offset-2 hover:underline"
            >
              Terms &amp; Condition
            </a>
          </span>
        </label>

        {error && <Alert>{error}</Alert>}
      </div>
    </WizardShell>
  )
}
