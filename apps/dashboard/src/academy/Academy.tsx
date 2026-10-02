/**
 * Academy — students, plans and coaches, and where each student stands.
 *
 * Three tabs, because they are three different jobs:
 *
 *   **Students** — find anyone, filter by sport, and see at a glance who is attending,
 *   who owes fees and who is ready to move up. Opening a row opens that student's
 *   performance profile.
 *   **Plans** — the programmes on sale and the batches that fill them.
 *   **Coaches** — who is teaching, how much, and (for a manager) what they are paid.
 *   Opening a coach opens their page: classes, students, reviews, attendance and pay.
 *
 * The summary and the "needs attention" lists sit above the tabs because they are what
 * a manager opens this page *for*; each attention card is a shortcut into the Students
 * tab with the filter already applied, so the question and its answer are one click
 * apart.
 */
import { useState } from 'react'
import type { AttentionFlag } from '../api/hooks'
import Tabs from '../ui/Tabs'
import CoachesTab from './CoachesTab'
import CoachProfile from './CoachProfile'
import EnrollWizard from './EnrollWizard'
import { AttentionPanel, SummaryStrip } from './Overview'
import PlansTab from './PlansTab'
import StudentProfile from './StudentProfile'
import StudentsTab, { type RosterFilters } from './StudentsTab'

const TABS = ['Students', 'Plans', 'Coaches'] as const
type Tab = (typeof TABS)[number]

export default function Academy() {
  const [tab, setTab] = useState<Tab>('Students')
  const [profileId, setProfileId] = useState<string | null>(null)
  const [coachId, setCoachId] = useState<string | null>(null)
  const [filters, setFilters] = useState<RosterFilters>({ page: 1 })
  const [wizardOpen, setWizardOpen] = useState(false)

  /** Jump to the Students tab with exactly this filter, replacing any other. */
  const showStudents = (next: RosterFilters) => {
    setFilters({ page: 1, ...next })
    setTab('Students')
    setProfileId(null)
    setCoachId(null)
  }

  const viewAll = (flag: AttentionFlag) => showStudents({ attention: flag })

  return (
    <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 py-5 sm:px-6">
      {profileId ? (
        // `key` so opening a different student never carries over the previous one's
        // open drawers or half-typed state.
        <StudentProfile
          key={profileId}
          studentId={profileId}
          // Back returns to wherever the student was opened from. `coachId` outlives the
          // student's page, so a student opened from a coach's page goes back to that
          // coach rather than dumping the person on the Students tab.
          onBack={() => setProfileId(null)}
          backLabel={coachId ? 'Coach' : 'Students'}
        />
      ) : coachId ? (
        <CoachProfile
          key={coachId}
          coachId={coachId}
          onBack={() => setCoachId(null)}
          onOpenStudent={setProfileId}
          onViewStudents={(id) => showStudents({ coach_id: id })}
        />
      ) : (
        <>
          <SummaryStrip />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="w-full max-w-sm">
              <Tabs tabs={TABS} active={tab} onChange={setTab} />
            </div>
            <button
              type="button"
              onClick={() => setWizardOpen(true)}
              className="flex h-10 items-center justify-center rounded-full px-5 text-sm text-[#fefefe]"
              style={{ backgroundImage: 'linear-gradient(105deg, rgb(41,41,41) 2%, rgb(26,26,26) 100%)' }}
            >
              Enrol student
            </button>
          </div>

          {tab === 'Students' && (
            <>
              <AttentionPanel onViewAll={viewAll} onOpen={setProfileId} />
              <StudentsTab
                filters={filters}
                onFiltersChange={setFilters}
                onOpen={setProfileId}
                onEnrol={() => setWizardOpen(true)}
              />
            </>
          )}
          {tab === 'Plans' && <PlansTab onViewBatch={(batch_id) => showStudents({ batch_id })} />}
          {tab === 'Coaches' && <CoachesTab onOpen={setCoachId} />}
        </>
      )}

      {wizardOpen && (
        <EnrollWizard onClose={() => setWizardOpen(false)} onEnrolled={() => setWizardOpen(false)} />
      )}
    </div>
  )
}
