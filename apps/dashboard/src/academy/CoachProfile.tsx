/**
 * One coach, everything at once: what they teach, who they teach, how it is going, and —
 * for a manager — what they are paid.
 *
 * The tiles under the header answer "is this coach okay?"; the tabs are the evidence
 * behind each. Nothing here is stored as a number except what a person recorded (a
 * review, a payout): classes, attendance and earnings are all worked out from sessions,
 * registers and payments when the page opens, so they cannot disagree with the rest of
 * the Academy screens.
 *
 * Pay arrives only for a manager or admin. For anyone below, the server omits it and
 * zeroes the coach's pay fields, and this screen drops the Pay tab and the earnings tile
 * rather than showing blanks.
 */
import { useState } from 'react'
import {
  ArrowLeft,
  Calendar,
  MessageSquarePlus,
  Pencil,
  Phone,
  Star,
  Trash2,
  UserMinus,
  Users,
} from '../ui/icons'
import {
  useCoachProfile,
  useDeleteCoachReview,
  useDeletePayout,
  useAssignBatches,
  useSetCoachStatus,
  useSports,
  type CoachProfile as Profile,
} from '../api/hooks'
import { ApiError } from '../api/client'
import Tabs from '../ui/Tabs'
import AssignBatchesDrawer from './AssignBatchesDrawer'
import Avatar from './Avatar'
import { LineChart } from './charts'
import CoachDrawer from './CoachDrawer'
import CoachReviewDrawer from './CoachReviewDrawer'
import { PAY_MODELS, PAYOUT_STATUS_CHIP, longMonth, payTerms } from './coachFormat'
import { STATUS_CHIP, attendanceTone, formatDate, monthLabel, rupees } from './format'
import { useIsAdmin, useIsManager } from './permissions'
import PayoutDrawer from './PayoutDrawer'
import RemoveCoachDrawer from './RemoveCoachDrawer'
import Card from '../ui/Card'
import { Table, Tbody, Td, Th, Thead, Tr } from '../ui/Table'
import StatTile from '../ui/StatTile'

const TABS = ['Overview', 'Classes', 'Students', 'Reviews', 'Pay'] as const
type Tab = (typeof TABS)[number]

function Stars({ value, size = 14 }: { value: number; size?: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          size={size}
          className={n <= Math.round(value) ? 'fill-amber-400 text-amber-400' : 'text-border-input'}
        />
      ))}
    </span>
  )
}

const dayTime = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

const EMPTY = 'rounded-xl border border-dashed border-border-card px-4 py-8 text-center text-sm text-muted'

export default function CoachProfile({
  coachId,
  onBack,
  onOpenStudent,
  onViewStudents,
}: {
  coachId: string
  onBack: () => void
  onOpenStudent: (studentId: string) => void
  /** Jump to the Students tab filtered to this coach — for when the list here is cut short. */
  onViewStudents: (coachId: string) => void
}) {
  const isManager = useIsManager()
  const isAdmin = useIsAdmin()
  const { data: profile, isLoading, isError } = useCoachProfile(coachId)
  const { data: sports } = useSports(true)
  const unassign = useAssignBatches()
  const deleteReview = useDeleteCoachReview()
  const deletePayout = useDeletePayout()
  const setStatus = useSetCoachStatus()

  const [tab, setTab] = useState<Tab>('Overview')
  const [editing, setEditing] = useState(false)
  const [assigning, setAssigning] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [paying, setPaying] = useState<string | null>(null) // "YYYY-MM"
  const [confirm, setConfirm] = useState<string | null>(null) // id awaiting a second click
  const [notice, setNotice] = useState<string | null>(null)

  const sportName = (id: string) => (sports ?? []).find((s) => s.id === id)?.name ?? 'Sport'

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <BackButton onBack={onBack} />
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
        <BackButton onBack={onBack} />
        <p role="alert" className="rounded-xl border border-border-card bg-white p-6 text-sm text-negative">
          Could not load this coach. They may have been removed.
        </p>
      </div>
    )
  }

  const { coach, stats, batches, students, upcoming, recent, reviews, monthly, pay } = profile
  const tabs: readonly Tab[] = pay ? TABS : TABS.filter((t) => t !== 'Pay')
  const activeTab: Tab = tabs.includes(tab) ? tab : 'Overview'
  const rating = Number(stats.rating)
  const tone = attendanceTone(stats.student_attendance_pct ?? null)
  const inactive = coach.status === 'inactive'

  const guard = async (fn: () => Promise<unknown>, fallback: string) => {
    setNotice(null)
    try {
      await fn()
    } catch (err) {
      setNotice(
        err instanceof ApiError ? (err.isForbidden ? 'You do not have permission to do that.' : err.message) : fallback,
      )
    }
  }

  // A button that asks "sure?" on the second press, rather than a modal for a small act.
  const confirmed = (id: string) => confirm === id
  const arm = (id: string) => {
    setConfirm(id)
    setTimeout(() => setConfirm((cur) => (cur === id ? null : cur)), 4000)
  }

  const sessionPoints = monthly.map((m) => ({ label: monthLabel(m.month), value: m.sessions }))
  const sessionMax = Math.max(4, Math.ceil(Math.max(...monthly.map((m) => m.sessions)) / 4) * 4)
  const ratingPoints = monthly.map((m) => ({ label: monthLabel(m.month), value: m.rating }))

  return (
    <div className="flex flex-col gap-5">
      <BackButton onBack={onBack} />

      {/* ── Header */}
      <section className="rounded-2xl border border-border-card bg-white p-5">
        <div className="flex flex-wrap items-start gap-5">
          <Avatar name={coach.name} initials={coach.avatar_initials} size="lg" />

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-2xl font-semibold text-ink">{coach.name}</h2>
              <span className="rounded-full bg-surface-muted px-2.5 py-1 font-mono text-xs text-slate">
                {coach.coach_no}
              </span>
              <span className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize ${STATUS_CHIP[coach.status ?? 'active'] ?? ''}`}>
                {coach.status}
              </span>
              <span className="rounded-full bg-surface-muted px-2.5 py-1 text-xs capitalize text-slate">{coach.type}</span>
            </div>
            <p className="mt-1 text-sm text-slate">
              {[coach.specialization, (coach.sport_ids ?? []).map(sportName).join(', ')].filter(Boolean).join(' · ') ||
                'No specialisation recorded'}
            </p>
            <p className="mt-0.5 text-sm text-slate">
              {[
                coach.experience_years ? `${coach.experience_years} yrs experience` : null,
                coach.joining_date ? `Joined ${formatDate(coach.joining_date)}` : null,
                [coach.morning_available !== false && 'Mornings', coach.evening_available !== false && 'Evenings']
                  .filter(Boolean)
                  .join(' & ') || 'Not available',
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
            {(coach.phone || coach.email) && (
              <p className="mt-2 flex flex-wrap items-center gap-x-3 text-sm text-slate">
                {coach.phone && (
                  <a href={`tel:${coach.phone}`} className="inline-flex items-center gap-1 text-lime-ink hover:underline">
                    <Phone size={13} /> {coach.phone}
                  </a>
                )}
                {coach.email && <span>{coach.email}</span>}
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setReviewing(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border-card px-3.5 py-2 text-sm font-medium text-ink"
            >
              <MessageSquarePlus size={15} /> Add review
            </button>
            {isManager && (
              <>
                <button
                  type="button"
                  onClick={() => setAssigning(true)}
                  disabled={inactive}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-3.5 py-2 text-sm font-medium text-white disabled:opacity-40"
                >
                  <Users size={15} /> Assign batches
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border-card px-3.5 py-2 text-sm font-medium text-ink"
                >
                  <Pencil size={15} /> Edit
                </button>
                {inactive ? (
                  <button
                    type="button"
                    disabled={setStatus.isPending}
                    onClick={() =>
                      void guard(
                        () => setStatus.mutateAsync({ coachId: coach.id, status: 'active' }),
                        'Could not reactivate the coach.',
                      )
                    }
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border-card px-3.5 py-2 text-sm font-medium text-ink disabled:opacity-60"
                  >
                    Reactivate
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setRemoving(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-negative/40 px-3.5 py-2 text-sm font-medium text-negative"
                  >
                    <UserMinus size={15} /> Remove
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {notice && (
          <p role="alert" className="mt-4 rounded-lg bg-negative/5 px-4 py-3 text-sm text-negative">
            {notice}
          </p>
        )}
      </section>

      {/* ── Headline numbers */}
      <div className={`grid grid-cols-2 gap-3 ${pay ? 'lg:grid-cols-6' : 'lg:grid-cols-5'}`}>
        <StatTile
          label="Students"
          value={stats.students}
          sub={`across ${stats.batches} ${stats.batches === 1 ? 'batch' : 'batches'}`}
        />
        <StatTile
          label="Rating"
          value={rating > 0 ? rating.toFixed(1) : '—'}
          sub={stats.review_count ? `${stats.review_count} ${stats.review_count === 1 ? 'review' : 'reviews'}` : 'No reviews yet'}
        />
        <StatTile
          label="Student attendance"
          value={stats.student_attendance_pct != null ? `${Math.round(stats.student_attendance_pct)}%` : '—'}
          tone={tone.text}
          sub="last 30 days"
        />
        <StatTile
          label="Classes taught"
          value={stats.sessions_completed_30d}
          sub={`${Number(stats.hours_30d)} h · last 30 days`}
        />
        <StatTile
          label="Cancelled"
          value={stats.sessions_cancelled_30d}
          tone={stats.sessions_cancelled_30d > 2 ? 'text-amber-700' : undefined}
          sub="last 30 days"
        />
        {pay && (
          <StatTile
            label="This month"
            value={rupees(pay.current.payout?.total ?? pay.current.gross)}
            tone={pay.current.status === 'due' ? 'text-amber-700' : undefined}
            sub={pay.current.status === 'paid' ? 'paid' : pay.current.status === 'due' ? 'earned, not yet paid' : 'nothing earned'}
          />
        )}
      </div>

      <div className="max-w-xl">
        <Tabs tabs={tabs} active={activeTab} onChange={setTab} />
      </div>

      {/* ── Overview */}
      {activeTab === 'Overview' && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card title="Upcoming sessions">
            {upcoming.length === 0 ? (
              <p className={EMPTY}>Nothing scheduled.</p>
            ) : (
              <SessionList sessions={upcoming} />
            )}
          </Card>
          <Card title="Recent sessions">
            {recent.length === 0 ? <p className={EMPTY}>No sessions taught yet.</p> : <SessionList sessions={recent} showRegister />}
          </Card>
          <Card title="Classes taught, by month">
            <LineChart
              points={sessionPoints}
              max={sessionMax}
              ticks={[0, sessionMax / 2, sessionMax]}
              emptyMessage="No sessions yet."
            />
          </Card>
          <Card title="Review rating, by month">
            <LineChart
              points={ratingPoints}
              max={5}
              ticks={[1, 2, 3, 4, 5]}
              emptyMessage="No reviews in the last six months."
            />
          </Card>
          {(coach.bio || (coach.certifications ?? []).length > 0 || (coach.languages ?? []).length > 0) && (
            <Card title="About" className="lg:col-span-2">
              {coach.bio && <p className="text-sm text-slate">{coach.bio}</p>}
              <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                {(coach.certifications ?? []).length > 0 && (
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted">Certifications</dt>
                    <dd className="text-ink">{(coach.certifications ?? []).join(', ')}</dd>
                  </div>
                )}
                {(coach.languages ?? []).length > 0 && (
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted">Languages</dt>
                    <dd className="text-ink">{(coach.languages ?? []).join(', ')}</dd>
                  </div>
                )}
              </dl>
            </Card>
          )}
        </div>
      )}

      {/* ── Classes */}
      {activeTab === 'Classes' && (
        <Card
          title={`Batches (${batches.length})`}
          action={
            isManager && !inactive ? (
              <button
                type="button"
                onClick={() => setAssigning(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-white"
              >
                <Users size={14} /> Assign batches
              </button>
            ) : undefined
          }
        >
          {batches.length === 0 ? (
            <p className={EMPTY}>
              {coach.name} has no batches.{' '}
              {isManager && !inactive && (
                <button type="button" onClick={() => setAssigning(true)} className="text-lime-ink underline">
                  Assign some
                </button>
              )}
            </p>
          ) : (
            <Table inset minWidth={720}>
              <Thead>
                <Tr>
                  <Th>Batch</Th>
                  <Th>When</Th>
                  <Th>Students</Th>
                  <Th>Attendance</Th>
                  <Th>Status</Th>
                  <Th />
                </Tr>
              </Thead>
              <Tbody>
                {batches.map((b) => {
                  const t = attendanceTone(b.attendance_pct ?? null)
                  const full = b.enrolled >= b.capacity
                  return (
                    <Tr key={b.id}>
                      <Td>
                        <p className="font-medium text-ink">{b.name}</p>
                        <p className="text-xs text-muted">{b.program_name ?? '—'}</p>
                      </Td>
                      <Td className="text-slate">
                        {[b.schedule, b.time_label].filter(Boolean).join(' · ') || '—'}
                        {b.location && <span className="block text-xs text-muted">{b.location}</span>}
                      </Td>
                      <Td>
                        <span className="font-medium text-ink">
                          {b.enrolled}/{b.capacity}
                        </span>
                        <div className="mt-1 h-1.5 w-20 rounded-full bg-surface-muted">
                          <div
                            className={`h-1.5 rounded-full ${full ? 'bg-amber-400' : 'bg-lime-ink'}`}
                            style={{ width: `${Math.min(100, (b.enrolled / b.capacity) * 100)}%` }}
                          />
                        </div>
                      </Td>
                      <Td className={`font-medium ${t.text}`}>
                        {b.attendance_pct != null ? `${Math.round(b.attendance_pct)}%` : '—'}
                      </Td>
                      <Td>
                        <span className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize ${STATUS_CHIP[b.status === 'active' ? 'active' : b.status === 'upcoming' ? 'paused' : 'completed']}`}>
                          {b.status}
                        </span>
                      </Td>
                      <Td align="right">
                        {isManager && b.status !== 'completed' && (
                          <button
                            type="button"
                            disabled={unassign.isPending}
                            onClick={() => {
                              if (!confirmed(`un-${b.id}`)) return arm(`un-${b.id}`)
                              setConfirm(null)
                              void guard(
                                () => unassign.mutateAsync({ coachId: coach.id, batchIds: [b.id], unassign: true }),
                                'Could not take the batch off this coach.',
                              )
                            }}
                            className={`rounded-lg border px-2.5 py-1.5 text-xs ${
                              confirmed(`un-${b.id}`)
                                ? 'border-negative bg-negative text-white'
                                : 'border-border-card text-slate hover:text-ink'
                            }`}
                          >
                            {confirmed(`un-${b.id}`) ? 'Sure? Students move off too' : 'Unassign'}
                          </button>
                        )}
                      </Td>
                    </Tr>
                  )
                })}
              </Tbody>
            </Table>
          )}
        </Card>
      )}

      {/* ── Students */}
      {activeTab === 'Students' && (
        <Card
          title={`Students (${profile.students_total})`}
          action={
            profile.students_total > students.length ? (
              <button
                type="button"
                onClick={() => onViewStudents(coach.id)}
                className="text-sm text-lime-ink underline"
              >
                See all {profile.students_total} in the Students tab
              </button>
            ) : undefined
          }
        >
          {students.length === 0 ? (
            <p className={EMPTY}>No active students are with {coach.name} right now.</p>
          ) : (
            <Table inset minWidth={720}>
              <Thead>
                <Tr>
                  <Th>Student</Th>
                  <Th>Batch</Th>
                  <Th>Attendance</Th>
                  <Th>Rating</Th>
                  <Th>Fees</Th>
                </Tr>
              </Thead>
              <Tbody>
                {students.map((s) => {
                  const t = attendanceTone(s.attendance_pct ?? null)
                  return (
                    <Tr key={s.id} onClick={() => onOpenStudent(s.id)}>
                      <Td>
                        <div className="flex items-center gap-3">
                          <Avatar name={s.name} initials={s.avatar_initials} photoUrl={s.photo_url} />
                          <div className="min-w-0">
                            <p className="truncate font-medium text-ink">{s.name}</p>
                            <p className="text-xs text-muted">{s.student_no}</p>
                          </div>
                        </div>
                      </Td>
                      <Td className="text-slate">{s.batch_name ?? '—'}</Td>
                      <Td className={`font-medium ${t.text}`}>
                        {s.attendance_pct != null ? `${Math.round(s.attendance_pct)}%` : '—'}
                      </Td>
                      <Td className="text-ink">{Number(s.rating) > 0 ? Number(s.rating).toFixed(1) : '—'}</Td>
                      <Td>
                        {s.fee_status === 'due' ? (
                          <span className="text-amber-700">{rupees(s.pending_fee)} due</span>
                        ) : s.fee_status === 'paid' ? (
                          <span className="text-positive">Paid</span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </Td>
                    </Tr>
                  )
                })}
              </Tbody>
            </Table>
          )}
        </Card>
      )}

      {/* ── Reviews */}
      {activeTab === 'Reviews' && (
        <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
          <Card title="Rating">
            {stats.review_count === 0 ? (
              <p className={EMPTY}>No reviews recorded yet.</p>
            ) : (
              <>
                <div className="flex items-end gap-3">
                  <p className="font-display text-5xl font-semibold text-ink">{rating.toFixed(1)}</p>
                  <div className="pb-1.5">
                    <Stars value={rating} size={16} />
                    <p className="mt-0.5 text-xs text-slate">
                      {stats.review_count} {stats.review_count === 1 ? 'review' : 'reviews'}
                    </p>
                  </div>
                </div>
                <ul className="mt-4 flex flex-col gap-1.5">
                  {[5, 4, 3, 2, 1].map((n) => {
                    const count = profile.rating_breakdown[n - 1] ?? 0
                    return (
                      <li key={n} className="flex items-center gap-2 text-xs text-slate">
                        <span className="w-6 shrink-0">{n} ★</span>
                        <div className="h-2 flex-1 rounded-full bg-surface-muted">
                          <div
                            className="h-2 rounded-full bg-amber-400"
                            style={{ width: `${(count / stats.review_count) * 100}%` }}
                          />
                        </div>
                        <span className="w-5 shrink-0 text-right">{count}</span>
                      </li>
                    )
                  })}
                </ul>
              </>
            )}
            <button
              type="button"
              onClick={() => setReviewing(true)}
              className="mt-5 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-ink px-3.5 py-2 text-sm font-medium text-white"
            >
              <MessageSquarePlus size={15} /> Add a review
            </button>
          </Card>

          <Card title="What people said">
            {reviews.length === 0 ? (
              <p className={EMPTY}>Feedback from students and parents will appear here.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border-card">
                {reviews.map((r) => (
                  <li key={r.id} className="flex items-start justify-between gap-4 py-3.5 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Stars value={r.rating} />
                        <span className="text-sm font-medium text-ink">{r.reviewer_name ?? 'Anonymous'}</span>
                        <span className="text-xs text-muted">{formatDate(r.reviewed_on)}</span>
                      </div>
                      {r.comment && <p className="mt-1.5 whitespace-pre-line text-sm text-slate">{r.comment}</p>}
                    </div>
                    {isManager && (
                      <button
                        type="button"
                        disabled={deleteReview.isPending}
                        onClick={() => {
                          if (!confirmed(`rv-${r.id}`)) return arm(`rv-${r.id}`)
                          setConfirm(null)
                          void guard(() => deleteReview.mutateAsync(r.id), 'Could not delete the review.')
                        }}
                        aria-label="Delete review"
                        className={`shrink-0 rounded-lg p-1.5 ${confirmed(`rv-${r.id}`) ? 'bg-negative text-white' : 'text-muted hover:text-negative'}`}
                        title={confirmed(`rv-${r.id}`) ? 'Click again to delete' : 'Delete'}
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {/* ── Pay (manager and above) */}
      {activeTab === 'Pay' && pay && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card
            title="Pay terms"
            action={
              <button type="button" onClick={() => setEditing(true)} className="text-sm text-lime-ink underline">
                Change
              </button>
            }
          >
            <p className="font-display text-2xl font-semibold text-ink">{payTerms({ ...coach, ...pay })}</p>
            <p className="mt-1 text-sm text-slate">{PAY_MODELS.find((m) => m.value === pay.pay_model)?.hint}</p>
            <p className="mt-3 text-xs text-muted">
              Paid to date: <span className="font-medium text-ink">{rupees(pay.paid_to_date)}</span>
            </p>
          </Card>

          <Card title={`${longMonth(pay.current.period.slice(0, 7))} so far`}>
            <ul className="flex flex-col gap-2.5">
              {pay.current.lines.map((l) => (
                <li key={l.label} className="flex items-start justify-between gap-4 text-sm">
                  <span>
                    <span className="block font-medium text-ink">{l.label}</span>
                    <span className="block text-xs text-slate">{l.detail}</span>
                  </span>
                  <span className="shrink-0 font-medium text-ink">{rupees(l.amount)}</span>
                </li>
              ))}
              {pay.current.lines.length === 0 && <li className="text-sm text-muted">Nothing earned yet this month.</li>}
            </ul>
            <div className="mt-4 flex items-center justify-between border-t border-border-card pt-3">
              <span className="text-sm text-slate">Earned</span>
              <span className="font-display text-xl font-semibold text-ink">{rupees(pay.current.gross)}</span>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${PAYOUT_STATUS_CHIP[pay.current.status]}`}>
                {pay.current.status === 'paid'
                  ? `Paid ${rupees(pay.current.payout?.total ?? 0)}`
                  : pay.current.status === 'due'
                    ? 'Not paid yet'
                    : 'Nothing to pay'}
              </span>
              {pay.current.status === 'due' && (
                <button
                  type="button"
                  onClick={() => setPaying(pay.current.period.slice(0, 7))}
                  className="rounded-lg bg-ink px-3 py-1.5 text-xs font-medium text-white"
                >
                  Record payout
                </button>
              )}
            </div>
          </Card>

          <Card title="Last six months" className="lg:col-span-2">
            <Table inset minWidth={560}>
              <Thead>
                <Tr>
                  <Th>Month</Th>
                  <Th>Sessions</Th>
                  <Th>Hours</Th>
                  <Th align="right">Earned</Th>
                  <Th>Status</Th>
                  <Th />
                </Tr>
              </Thead>
              <Tbody>
                {[...monthly].reverse().map((m) => {
                  const earned = Number(m.earned ?? 0)
                  const paid = m.paid != null
                  return (
                    <Tr key={m.month}>
                      <Td className="font-medium text-ink">{longMonth(m.month)}</Td>
                      <Td className="text-slate">{m.sessions}</Td>
                      <Td className="text-slate">{Number(m.hours)}</Td>
                      <Td align="right" className="text-ink">{rupees(earned)}</Td>
                      <Td>
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-medium ${PAYOUT_STATUS_CHIP[paid ? 'paid' : earned > 0 ? 'due' : 'nothing']}`}
                        >
                          {paid ? 'Paid' : earned > 0 ? 'Due' : '—'}
                        </span>
                      </Td>
                      <Td align="right">
                        {!paid && earned > 0 && (
                          <button
                            type="button"
                            onClick={() => setPaying(m.month)}
                            className="rounded-lg border border-border-card px-2.5 py-1 text-xs text-slate hover:text-ink"
                          >
                            Record payout
                          </button>
                        )}
                      </Td>
                    </Tr>
                  )
                })}
              </Tbody>
            </Table>
          </Card>

          <Card title="Payout history" className="lg:col-span-2">
            {pay.payouts.length === 0 ? (
              <p className={EMPTY}>No payouts recorded yet.</p>
            ) : (
              <Table inset minWidth={760}>
                <Thead>
                  <Tr>
                    <Th>For</Th>
                    <Th>Breakdown</Th>
                    <Th align="right">Paid</Th>
                    <Th>How</Th>
                    <Th />
                  </Tr>
                </Thead>
                <Tbody>
                  {pay.payouts.map((p) => (
                    <Tr key={p.id} className="align-top">
                      <Td className="font-medium text-ink">{longMonth(p.period.slice(0, 7))}</Td>
                      <Td className="text-xs text-slate">
                        {Number(p.base_amount) > 0 && <span className="block">Base {rupees(p.base_amount)}</span>}
                        {Number(p.commission_amount) > 0 && (
                          <span className="block">Commission {rupees(p.commission_amount)}</span>
                        )}
                        {Number(p.adjustment) !== 0 && (
                          <span className="block">
                            {Number(p.adjustment) > 0 ? 'Bonus' : 'Deduction'} {rupees(Math.abs(Number(p.adjustment)))}
                            {p.adjustment_note && ` — ${p.adjustment_note}`}
                          </span>
                        )}
                      </Td>
                      <Td align="right" className="font-medium text-ink">{rupees(p.total)}</Td>
                      <Td className="text-xs capitalize text-slate">
                        {p.method}
                        {p.reference && ` · ${p.reference}`}
                        <span className="block normal-case text-muted">{formatDate(p.paid_on)}</span>
                      </Td>
                      <Td align="right">
                        {isAdmin && (
                          <button
                            type="button"
                            disabled={deletePayout.isPending}
                            onClick={() => {
                              if (!confirmed(`po-${p.id}`)) return arm(`po-${p.id}`)
                              setConfirm(null)
                              void guard(() => deletePayout.mutateAsync(p.id), 'Could not undo the payout.')
                            }}
                            className={`rounded-lg border px-2.5 py-1 text-xs ${
                              confirmed(`po-${p.id}`)
                                ? 'border-negative bg-negative text-white'
                                : 'border-border-card text-slate hover:text-ink'
                            }`}
                          >
                            {confirmed(`po-${p.id}`) ? 'Sure? This reopens the month' : 'Undo'}
                          </button>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            )}
          </Card>
        </div>
      )}

      {/* ── Drawers */}
      {editing && <CoachDrawer coach={coach} onClose={() => setEditing(false)} />}
      {assigning && <AssignBatchesDrawer coach={coach} onClose={() => setAssigning(false)} />}
      {reviewing && <CoachReviewDrawer coach={coach} onClose={() => setReviewing(false)} />}
      {paying && (
        <PayoutDrawer
          coach={coach}
          month={paying}
          inProgress={pay ? paying === pay.current.period.slice(0, 7) : false}
          onClose={() => setPaying(null)}
        />
      )}
      {removing && (
        <RemoveCoachDrawer
          profile={profile}
          onClose={() => setRemoving(false)}
          onRemoved={(outcome) => {
            setRemoving(false)
            if (outcome === 'deleted') onBack()
          }}
        />
      )}
    </div>
  )
}

function SessionList({
  sessions,
  showRegister,
}: {
  sessions: Profile['upcoming']
  showRegister?: boolean
}) {
  return (
    <ul className="flex flex-col divide-y divide-border-card">
      {sessions.map((s) => (
        <li key={s.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-ink">{s.batch_name}</p>
            <p className="flex items-center gap-1 text-xs text-slate">
              <Calendar size={12} /> {dayTime(s.starts_at)}
            </p>
          </div>
          <div className="shrink-0 text-right text-xs">
            {s.status === 'cancelled' ? (
              <span className="rounded-full bg-negative/10 px-2 py-0.5 text-negative">Cancelled</span>
            ) : showRegister ? (
              s.marked > 0 ? (
                <span className="text-slate">
                  {s.present}/{s.marked} present
                </span>
              ) : (
                <span className="text-amber-700">Register not taken</span>
              )
            ) : (
              <span className="capitalize text-slate">{s.status}</span>
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 self-start text-sm text-slate hover:text-ink">
      <ArrowLeft size={15} /> Coaches
    </button>
  )
}

