import { GST_RATE, SPORTS, sportById, toPaise } from './booking'
import { getStaff } from '../lib/db'

/** Coaches are staff with role 'coach' — one roster, not a second one duplicated here. */
export const coaches = () => getStaff().filter((s) => s.role === 'coach')

export function coachesForSport(sportId: string) {
  const sport = sportById(sportId)
  const all = coaches()
  const matched = all.filter((c) => c.specialty && sport?.name.toLowerCase().includes(c.specialty.toLowerCase()))
  return matched.length > 0 ? matched : all
}

export type Program = {
  id: string
  sportId: string
  name: string
  level: 'Beginner' | 'Intermediate' | 'Advanced'
  sessionsPerWeek: number
  fee: number
  gst: number
  total: number
  blurb: string
}

function buildPrograms(sportId: string, sportName: string, baseFee: number): Program[] {
  const specs: [Program['level'], number, number][] = [
    ['Beginner', 2, 1.0],
    ['Advanced', 3, 1.6],
  ]
  return specs.map(([level, sessionsPerWeek, multiple]) => {
    const fee = toPaise(baseFee * multiple)
    const gst = toPaise(fee * GST_RATE)
    return {
      id: `${sportId}-${level.toLowerCase()}`,
      sportId,
      name: `${sportName} ${level}s`,
      level,
      sessionsPerWeek,
      fee,
      gst,
      total: fee + gst,
      blurb:
        level === 'Beginner'
          ? 'Fundamentals, footwork and match rules — no experience needed.'
          : 'Drills and match play for players who already have the basics down.',
    }
  })
}

export const PROGRAMS: Program[] = SPORTS.flatMap((s) => buildPrograms(s.id, s.name, s.from * 20))

export const programById = (id: string) => PROGRAMS.find((p) => p.id === id)
export const programsForSport = (sportId: string) => PROGRAMS.filter((p) => p.sportId === sportId)

export type Batch = {
  id: string
  programId: string
  days: string
  time: string
  capacity: number
}

function buildBatches(program: Program): Batch[] {
  const early = program.level === 'Beginner' ? '7:00 – 8:00 AM' : '6:00 – 7:30 AM'
  const evening = program.level === 'Beginner' ? '5:00 – 6:00 PM' : '6:30 – 8:00 PM'
  return [
    { id: `${program.id}-morning`, programId: program.id, days: 'Mon · Wed · Fri', time: early, capacity: 12 },
    { id: `${program.id}-evening`, programId: program.id, days: 'Tue · Thu · Sat', time: evening, capacity: 10 },
  ]
}

export const BATCHES: Batch[] = PROGRAMS.flatMap(buildBatches)

export const batchById = (id: string) => BATCHES.find((b) => b.id === id)
export const batchesForProgram = (programId: string) => BATCHES.filter((b) => b.programId === programId)

export type StudentStatus = 'active' | 'paused' | 'completed'

export type Student = {
  id: string
  customer: { name: string; phone: string; email: string }
  sportId: string
  programId: string
  batchId: string
  coachId: string
  startDate: string
  fee: number
  gst: number
  total: number
  paidTotal: number
  status: StudentStatus
  sessionsAttended: number
  createdAt: string
}
