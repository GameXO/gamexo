import { useState } from 'react'
import { GraduationCap } from 'lucide-react'
import { SPORTS, money, sportById } from '../data/booking'
import { batchesForProgram, coaches, programsForSport } from '../data/academy'
import * as db from '../lib/db'
import EnrollWizard from './EnrollWizard'

export default function Academy() {
  db.useDbVersion()
  const [wizardOpen, setWizardOpen] = useState(false)
  const roster = coaches()
  const students = db.getStudents()

  return (
    <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-4 py-5 sm:px-6">
      <div className="flex items-center justify-between">
        <p className="text-lg text-ink">Coaches, programs &amp; batches</p>
        <button
          type="button"
          onClick={() => setWizardOpen(true)}
          className="flex h-10 items-center justify-center rounded-full px-5 text-sm text-[#fefefe]"
          style={{ backgroundImage: 'linear-gradient(105deg, rgb(41,41,41) 2%, rgb(26,26,26) 100%)' }}
        >
          Enroll student
        </button>
      </div>

      <div className="flex flex-wrap gap-3">
        {roster.map((coach) => (
          <div key={coach.id} className="flex items-center gap-3 rounded-xl border border-border-card bg-white px-4 py-3">
            <div className="flex size-9 items-center justify-center rounded-full bg-surface-muted text-ink">
              <GraduationCap size={16} />
            </div>
            <div>
              <p className="text-sm font-semibold text-ink">{coach.name}</p>
              <p className="text-xs text-muted">{coach.specialty || 'Coach'}</p>
            </div>
          </div>
        ))}
        {roster.length === 0 && <p className="text-sm text-muted">No coaches on staff yet — add one from Settings.</p>}
      </div>

      <div className="flex flex-col gap-6">
        {SPORTS.map((sport) => {
          const programs = programsForSport(sport.id)
          return (
            <div key={sport.id} className="flex flex-col gap-3">
              <p className="text-sm font-semibold text-ink">{sportById(sport.id)?.name}</p>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {programs.map((program) => {
                  const batches = batchesForProgram(program.id)
                  return (
                    <div key={program.id} className="flex flex-col gap-3 rounded-xl border border-border-card bg-white p-4">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold text-ink">{program.name}</p>
                        <p className="text-sm font-medium text-positive">{money(program.total)}/mo</p>
                      </div>
                      <p className="text-xs text-muted">
                        {program.sessionsPerWeek}x/week · {program.blurb}
                      </p>
                      <div className="flex flex-col gap-1.5">
                        {batches.map((batch) => {
                          const enrolled = db.studentsInBatch(batch.id).length
                          return (
                            <div key={batch.id} className="flex items-center justify-between rounded-lg bg-surface-muted px-3 py-2 text-xs">
                              <span className="text-ink">
                                {batch.days} · {batch.time}
                              </span>
                              <span className="text-muted">
                                {enrolled}/{batch.capacity} enrolled
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      <div className="overflow-hidden rounded-xl border border-border-card bg-white">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border-card text-xs uppercase tracking-wide text-muted">
              <th className="px-4 py-3 font-medium">Student</th>
              <th className="px-4 py-3 font-medium">Program</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Sessions attended</th>
            </tr>
          </thead>
          <tbody>
            {students.map((s) => (
              <tr key={s.id} className="border-b border-border-card last:border-0">
                <td className="px-4 py-3 font-medium text-ink">{s.customer.name}</td>
                <td className="px-4 py-3 text-slate">{sportById(s.sportId)?.name}</td>
                <td className="px-4 py-3">
                  <span className="rounded-full bg-positive/15 px-2.5 py-1 text-xs font-medium capitalize text-positive">{s.status}</span>
                </td>
                <td className="px-4 py-3 text-slate">{s.sessionsAttended}</td>
              </tr>
            ))}
            {students.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-sm text-muted">
                  No students enrolled yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {wizardOpen && <EnrollWizard onClose={() => setWizardOpen(false)} onEnrolled={() => {}} />}
    </div>
  )
}
