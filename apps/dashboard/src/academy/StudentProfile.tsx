/**
 * One student, everything at once: how they are doing, how they got here, what they owe.
 *
 * Laid out so the headline question — "is this student okay?" — is answered by the five
 * tiles under the header, and the cards below are the evidence for each: the skills
 * behind the rating, the trend behind the trend arrow, the register behind the
 * attendance figure. Nothing here is stored as a number; it is all computed from
 * reviews, registers, enrolments and payments when the page opens.
 */
import { useRef, useState } from 'react'
import {
  ArrowLeft,
  Camera,
  FileDown,
  Loader2,
  MessageSquarePlus,
  Phone,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import {
  useBusinessSettings,
  useSports,
  useStudentProfile,
  useUploadStudentPhoto,
  type StudentProfile as Profile,
} from '../api/hooks'
import { ApiError } from '../api/client'
import AssessmentDrawer from './AssessmentDrawer'
import Avatar from './Avatar'
import { LineChart, SkillRadar } from './charts'
import { LEVEL_TITLE, STATUS_CHIP, attendanceTone, formatDate, monthLabel, rupees } from './format'
import { downloadParentReport } from './parentReport'
import { useIsManager } from './permissions'
import StudentLevelPanel from './StudentLevelPanel'

const MAX_PHOTO_BYTES = 5 * 1024 * 1024

function Card({
  title,
  action,
  children,
  className = '',
}: {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={`rounded-2xl border border-border-card bg-white p-5 ${className}`}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="font-display text-base font-semibold text-ink">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

function Tile({
  label,
  value,
  sub,
  tone,
}: {
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  tone?: string
}) {
  return (
    <div className="rounded-xl border border-border-card bg-white px-4 py-3.5">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className={`mt-1 font-display text-2xl font-semibold ${tone ?? 'text-ink'}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate">{sub}</p>}
    </div>
  )
}

const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })

export default function StudentProfile({
  studentId,
  onBack,
  backLabel = 'Students',
}: {
  studentId: string
  onBack: () => void
  /** Where Back goes — "Coach" when the student was opened from a coach's page. */
  backLabel?: string
}) {
  const isManager = useIsManager()
  const { data: profile, isLoading, isError } = useStudentProfile(studentId)
  const { data: sports } = useSports(true)
  const { data: business } = useBusinessSettings()
  const uploadPhoto = useUploadStudentPhoto()
  const photoInput = useRef<HTMLInputElement>(null)

  const [reviewing, setReviewing] = useState(false)
  const [levelsOpen, setLevelsOpen] = useState(false)
  const [reporting, setReporting] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const sportName = (id: string | null | undefined) =>
    id ? ((sports ?? []).find((s) => s.id === id)?.name ?? 'Sport') : '—'

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <BackButton onBack={onBack} label={backLabel} />
        <div className="h-36 animate-pulse rounded-2xl bg-surface-muted" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-surface-muted" />
          ))}
        </div>
      </div>
    )
  }

  if (isError || !profile) {
    return (
      <div className="flex flex-col gap-4">
        <BackButton onBack={onBack} label={backLabel} />
        <p role="alert" className="rounded-xl border border-border-card bg-white p-6 text-sm text-negative">
          Could not load this student. They may have been removed.
        </p>
      </div>
    )
  }

  const { row, personal, attendance, standing, assessments, skills, promotions, fees } = profile
  const level = row.levels.find((l) => l.sport_id === row.sport_id) ?? row.levels[0]
  const last = assessments[assessments.length - 1]
  const before = assessments[assessments.length - 2]
  const delta = last && before ? Number(last.rating) - Number(before.rating) : null
  const tone30 = attendanceTone(attendance.last_30_pct)

  async function onPhoto(file: File | undefined) {
    if (!file) return
    setNotice(null)
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      setNotice('Choose a PNG, JPEG or WebP image.')
      return
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setNotice('That image is over 5 MB. Choose a smaller one.')
      return
    }
    try {
      await uploadPhoto.mutateAsync({ studentId, file })
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : 'Could not upload the photo. Please try again.')
    }
  }

  async function onReport(p: Profile) {
    setReporting(true)
    setNotice(null)
    try {
      await downloadParentReport(p, { academyName: business?.business_name ?? 'Academy', sportName })
    } catch {
      setNotice('Could not create the report. Please try again.')
    } finally {
      setReporting(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <BackButton onBack={onBack} label={backLabel} />

      {/* ── Header */}
      <section className="rounded-2xl border border-border-card bg-white p-5">
        <div className="flex flex-wrap items-start gap-5">
          <div className="relative">
            <Avatar name={row.name} initials={row.avatar_initials} photoUrl={row.photo_url} size="lg" />
            {isManager && (
              <>
                <button
                  type="button"
                  onClick={() => photoInput.current?.click()}
                  disabled={uploadPhoto.isPending}
                  aria-label="Change photo"
                  className="absolute -bottom-1 -right-1 flex size-7 items-center justify-center rounded-full border border-border-card bg-white text-slate shadow-sm hover:text-ink disabled:opacity-60"
                >
                  {uploadPhoto.isPending ? <Loader2 size={13} className="animate-spin" /> : <Camera size={13} />}
                </button>
                <input
                  ref={photoInput}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    void onPhoto(e.target.files?.[0])
                    e.target.value = '' // so choosing the same file again still fires
                  }}
                />
              </>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-2xl font-semibold text-ink">{row.name}</h2>
              <span className="rounded-full bg-surface-muted px-2.5 py-1 font-mono text-xs text-slate">{row.student_no}</span>
              <span className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize ${STATUS_CHIP[row.status] ?? ''}`}>
                {row.status}
              </span>
            </div>
            <p className="mt-1 text-sm text-slate">
              {[
                row.age != null && `${row.age} yrs`,
                personal.gender,
                row.sport_id && sportName(row.sport_id),
                level && LEVEL_TITLE[level.level],
              ]
                .filter(Boolean)
                .join(' · ') || 'No sport yet'}
            </p>
            <p className="mt-0.5 text-sm text-slate">
              {row.batch_name ? `${row.batch_name}${row.coach_name ? ` · Coach ${row.coach_name}` : ''}` : 'Not enrolled in a batch'}
            </p>
            {(row.parent_name || row.phone) && (
              <p className="mt-2 flex flex-wrap items-center gap-x-3 text-sm text-slate">
                {row.parent_name && <span>Parent: {row.parent_name}</span>}
                {row.phone && (
                  <a href={`tel:${row.phone}`} className="inline-flex items-center gap-1 text-lime-ink hover:underline">
                    <Phone size={13} /> {row.phone}
                  </a>
                )}
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {isManager && (
              <button
                type="button"
                onClick={() => setReviewing(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-3.5 py-2 text-sm font-medium text-white"
              >
                <MessageSquarePlus size={15} /> Add review
              </button>
            )}
            {isManager && (
              <button
                type="button"
                onClick={() => setLevelsOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border-card px-3.5 py-2 text-sm font-medium text-ink"
              >
                <TrendingUp size={15} /> Levels
              </button>
            )}
            <button
              type="button"
              onClick={() => void onReport(profile)}
              disabled={reporting}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border-card px-3.5 py-2 text-sm font-medium text-ink disabled:opacity-60"
            >
              {reporting ? <Loader2 size={15} className="animate-spin" /> : <FileDown size={15} />}
              Parent report
            </button>
          </div>
        </div>

        {notice && (
          <p role="alert" className="mt-4 rounded-lg bg-negative/5 px-4 py-3 text-sm text-negative">
            {notice}
          </p>
        )}
      </section>

      {/* ── Headline numbers */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Tile
          label="Rating"
          value={Number(row.rating) > 0 ? `${Number(row.rating).toFixed(1)}` : '—'}
          sub={
            delta === null ? (
              Number(row.rating) > 0 ? 'out of 10' : 'Not reviewed yet'
            ) : (
              <span className={`inline-flex items-center gap-1 ${delta >= 0 ? 'text-positive' : 'text-negative'}`}>
                {delta >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                {delta > 0 ? '+' : ''}
                {delta.toFixed(1)} since last review
              </span>
            )
          }
        />
        <Tile
          label="Attendance"
          value={attendance.last_30_pct !== null ? `${Math.round(attendance.last_30_pct)}%` : '—'}
          tone={tone30.text}
          sub={
            attendance.overall_pct !== null
              ? `last 30 days · ${Math.round(attendance.overall_pct)}% overall`
              : 'No sessions marked yet'
          }
        />
        <Tile
          label="Streak"
          value={attendance.streak}
          sub={attendance.streak === 1 ? 'session in a row' : 'sessions in a row'}
        />
        <Tile
          label="Standing"
          value={standing.batch_rank ? `#${standing.batch_rank}` : '—'}
          sub={
            standing.batch_rank
              ? `of ${standing.batch_size} in ${standing.batch_name}`
              : row.batch_id
                ? 'Not ranked while paused'
                : 'Not in a batch'
          }
        />
        <Tile
          label="Fees"
          value={row.fee_status === 'none' ? '—' : row.fee_status === 'paid' ? 'Paid' : rupees(row.pending_fee)}
          tone={row.fee_status === 'due' ? 'text-amber-700' : undefined}
          sub={
            row.fee_status === 'none'
              ? 'No plan'
              : row.fee_status === 'due'
                ? `due · term ends ${formatDate(row.renewal_date)}`
                : `term ends ${formatDate(row.renewal_date)}`
          }
        />
      </div>

      {/* ── Evidence */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Skills">
          {skills.length > 0 ? (
            <>
              <SkillRadar skills={skills} previous={profile.previous_skills} />
              {profile.previous_skills.length > 0 && (
                <p className="mt-2 text-center text-xs text-muted">Dashed line: the previous review.</p>
              )}
            </>
          ) : (
            <p className="py-10 text-center text-sm text-muted">
              No skills scored yet.{isManager ? ' Add a review to start the chart.' : ''}
            </p>
          )}
        </Card>

        <Card title="Rating over time">
          <LineChart
            points={assessments.slice(-8).map((a) => ({ label: shortDate(a.assessed_on), value: Number(a.rating) }))}
            max={10}
            ticks={[0, 5, 10]}
            emptyMessage="No reviews yet — each one adds a point to this line."
          />
        </Card>

        <Card title="Attendance">
          <LineChart
            points={attendance.monthly.map((m) => ({ label: monthLabel(m.month), value: m.pct === null ? null : Math.round(m.pct) }))}
            max={100}
            ticks={[0, 50, 100]}
            unit="%"
            emptyMessage="No sessions marked in the last six months."
          />
          {attendance.recent.length > 0 && (
            <div className="mt-4 border-t border-border-card pt-3">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Recent sessions</p>
              <ul className="flex flex-col gap-1.5">
                {attendance.recent.slice(0, 8).map((s) => (
                  <li key={s.session_id} className="flex items-center gap-2.5 text-sm">
                    <span
                      className={`size-2 rounded-full ${s.status === 'present' ? 'bg-positive' : s.status === 'late' ? 'bg-amber-400' : 'bg-negative'}`}
                      aria-hidden
                    />
                    <span className="w-20 text-slate">{shortDate(s.starts_at.slice(0, 10))}</span>
                    <span className="min-w-0 flex-1 truncate text-ink">{s.batch_name}</span>
                    <span className="text-xs capitalize text-muted">{s.status}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        <Card title="Coach reviews">
          {assessments.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted">No reviews yet.</p>
          ) : (
            <ol className="flex flex-col gap-4">
              {[...assessments].reverse().slice(0, 6).map((a) => (
                <li key={a.id} className="border-l-2 border-lime pl-3.5">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium text-ink">{formatDate(a.assessed_on)}</span>
                    <span className="rounded-full bg-lime/30 px-2 py-0.5 text-xs font-medium text-lime-ink">
                      {Number(a.rating).toFixed(1)} / 10
                    </span>
                    {a.sport_id && <span className="text-xs text-muted">{sportName(a.sport_id)}</span>}
                  </div>
                  {a.comment ? (
                    <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-slate">{a.comment}</p>
                  ) : (
                    <p className="mt-1 text-sm text-muted">No note.</p>
                  )}
                  {a.assessed_by && <p className="mt-1 text-xs text-muted">— {a.assessed_by}</p>}
                </li>
              ))}
            </ol>
          )}
        </Card>

        <Card title="Levels & promotions">
          {row.levels.length > 0 && (
            <div className="mb-4 flex flex-wrap gap-2">
              {row.levels.map((l) => (
                <span key={l.sport_id} className="rounded-full bg-surface-muted px-3 py-1 text-sm text-ink">
                  {sportName(l.sport_id)} · <span className="font-medium">{LEVEL_TITLE[l.level]}</span>
                </span>
              ))}
            </div>
          )}
          {promotions.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">No level changes recorded.</p>
          ) : (
            <ol className="flex flex-col gap-3">
              {promotions.slice(0, 6).map((p) => (
                <li key={p.id} className="flex items-start gap-3 text-sm">
                  <span className="mt-1.5 size-2 shrink-0 rounded-full bg-lime-ink" aria-hidden />
                  <div>
                    <p className="text-ink">
                      {sportName(p.sport_id)}:{' '}
                      {p.from_level ? (
                        <>
                          {LEVEL_TITLE[p.from_level]} → <span className="font-medium">{LEVEL_TITLE[p.to_level]}</span>
                        </>
                      ) : (
                        <>assessed at <span className="font-medium">{LEVEL_TITLE[p.to_level]}</span></>
                      )}
                    </p>
                    <p className="text-xs text-muted">
                      {formatDate(p.assessed_on)}
                      {p.assessed_by && ` · ${p.assessed_by}`}
                    </p>
                    {p.note && <p className="mt-0.5 text-xs text-slate">{p.note}</p>}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <Card title="Fees & enrolments">
          {fees.history.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">No enrolments yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-left text-sm">
                <thead>
                  <tr className="border-b border-border-card text-xs uppercase tracking-wide text-muted">
                    <th className="py-2 pr-3 font-medium">Plan</th>
                    <th className="py-2 pr-3 font-medium">Term</th>
                    <th className="py-2 pr-3 text-right font-medium">Fee</th>
                    <th className="py-2 text-right font-medium">Paid</th>
                  </tr>
                </thead>
                <tbody>
                  {fees.history.map((h) => (
                    <tr key={h.enrollment_id} className="border-b border-border-card last:border-0">
                      <td className="py-2.5 pr-3">
                        <p className="text-ink">{h.program_name ?? 'Plan'}</p>
                        <p className="text-xs capitalize text-muted">{h.status}</p>
                      </td>
                      <td className="py-2.5 pr-3 text-xs text-slate">
                        {formatDate(h.start_date)} – {formatDate(h.renewal_date)}
                      </td>
                      <td className="py-2.5 pr-3 text-right text-ink">{rupees(h.total_fee)}</td>
                      <td className={`py-2.5 text-right ${Number(h.pending) > 0 ? 'text-amber-700' : 'text-positive'}`}>
                        {rupees(h.paid)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {/* ── Personal */}
      <Card title="Details">
        <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['Date of birth', personal.date_of_birth ? formatDate(personal.date_of_birth) : '—'],
            ['Blood group', personal.blood_group ?? '—'],
            ['Email', personal.email ?? '—'],
            ['Joined', personal.joined_on ? formatDate(personal.joined_on) : '—'],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-muted">{k}</dt>
              <dd className="mt-0.5 break-words text-ink">{v}</dd>
            </div>
          ))}
        </dl>
        {personal.achievements.length > 0 && (
          <div className="mt-4 border-t border-border-card pt-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Achievements</p>
            <div className="flex flex-wrap gap-2">
              {personal.achievements.map((a) => (
                <span key={a} className="rounded-full bg-lime/30 px-3 py-1 text-sm text-lime-ink">
                  {a}
                </span>
              ))}
            </div>
          </div>
        )}
      </Card>

      {reviewing && (
        <AssessmentDrawer
          student={{ id: row.id, name: row.name }}
          initialSkills={skills}
          defaultSportId={row.sport_id}
          onClose={() => setReviewing(false)}
        />
      )}
      {levelsOpen && (
        <StudentLevelPanel studentId={row.id} studentName={row.name} onClose={() => setLevelsOpen(false)} />
      )}
    </div>
  )
}

function BackButton({ onBack, label }: { onBack: () => void; label: string }) {
  return (
    <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 self-start text-sm text-slate hover:text-ink">
      <ArrowLeft size={15} /> {label}
    </button>
  )
}
