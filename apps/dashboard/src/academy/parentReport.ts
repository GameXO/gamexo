/**
 * The progress report a parent takes home.
 *
 * One A4 page: who the student is, how they are doing, what the coach said. It leaves
 * out anything a parent has no business reading off a sheet that may be shared — the
 * fee history, other students' standing figures, internal flags. Rank in the batch is
 * shown only as the student's own position, never as a list.
 */
import { jsPDF } from 'jspdf'
import type { StudentProfile } from '../api/hooks'
import { LEVEL_TITLE, formatDate, monthLabel } from './format'

const LEFT = 48
const RIGHT = 547
const INK: [number, number, number] = [26, 26, 26]
const MUTED: [number, number, number] = [110, 116, 128]
const ACCENT: [number, number, number] = [6, 57, 60]
const TRACK: [number, number, number] = [231, 235, 240]

/** The photo as a data URL, or null if it cannot be fetched (CORS, deleted, offline).
 *  A report without a photo is still a report; it must never fail because of one. */
async function loadPhoto(url: string | null | undefined): Promise<{ data: string; type: 'PNG' | 'JPEG' } | null> {
  if (!url) return null
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const blob = await res.blob()
    const type = blob.type.includes('png') ? 'PNG' : blob.type.includes('jpeg') || blob.type.includes('jpg') ? 'JPEG' : null
    if (!type) return null // WebP is not supported by jsPDF's addImage
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(blob)
    })
    return { data, type }
  } catch {
    return null
  }
}

export async function downloadParentReport(
  profile: StudentProfile,
  opts: { academyName: string; sportName: (id: string | null | undefined) => string },
): Promise<void> {
  const { row, attendance, standing, skills, assessments, promotions } = profile
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  let y = 54

  const text = (value: string, x: number, size = 10, bold = false, color = INK, align: 'left' | 'right' = 'left') => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.setFontSize(size)
    doc.setTextColor(...color)
    doc.text(value, x, y, { align })
  }
  const rule = () => {
    doc.setDrawColor(...TRACK)
    doc.line(LEFT, y, RIGHT, y)
  }
  // A4 is 842pt tall. Starting a section too low would run it off the page, so a
  // section that cannot fit moves to a fresh one instead.
  const ensure = (space: number) => {
    if (y + space > 800) {
      doc.addPage()
      y = 54
    }
  }
  const heading = (value: string) => {
    ensure(120)
    y += 22
    text(value.toUpperCase(), LEFT, 9, true, MUTED)
    y += 8
    rule()
    y += 16
  }

  // ── Header
  text(opts.academyName, LEFT, 17, true)
  text('Student progress report', RIGHT, 11, false, MUTED, 'right')
  y += 16
  text(`Prepared ${formatDate(new Date().toISOString())}`, LEFT, 9, false, MUTED)
  y += 10
  rule()
  y += 26

  // ── Student
  const photo = await loadPhoto(row.photo_url)
  const textLeft = photo ? LEFT + 74 : LEFT
  if (photo) doc.addImage(photo.data, photo.type, LEFT, y - 14, 60, 60)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.setTextColor(...INK)
  doc.text(row.name, textLeft, y)
  y += 17
  const level = row.levels.find((l) => l.sport_id === row.sport_id) ?? row.levels[0]
  const facts = [
    row.student_no,
    row.age != null ? `${row.age} yrs` : null,
    opts.sportName(row.sport_id) !== '—' ? opts.sportName(row.sport_id) : null,
    level ? LEVEL_TITLE[level.level] : null,
  ].filter(Boolean)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(...MUTED)
  doc.text(facts.join('  ·  '), textLeft, y)
  y += 14
  doc.text([row.batch_name, row.coach_name ? `Coach ${row.coach_name}` : null].filter(Boolean).join('  ·  ') || '—', textLeft, y)
  y += photo ? 36 : 14

  // ── Headline numbers
  heading('At a glance')
  const tiles: [string, string][] = [
    ['Rating', `${Number(row.rating).toFixed(1)} / 10`],
    ['Attendance (30 days)', attendance.last_30_pct != null ? `${attendance.last_30_pct}%` : '—'],
    ['Attendance (overall)', attendance.overall_pct != null ? `${attendance.overall_pct}%` : '—'],
    [
      'Position in batch',
      standing.batch_rank ? `${standing.batch_rank} of ${standing.batch_size}` : '—',
    ],
  ]
  const tileW = (RIGHT - LEFT) / tiles.length
  tiles.forEach(([label, value], i) => {
    const x = LEFT + i * tileW
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(...MUTED)
    doc.text(label, x, y)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(15)
    doc.setTextColor(...INK)
    doc.text(value, x, y + 20)
  })
  y += 34

  // ── Skills
  if (skills.length > 0) {
    heading('Skills')
    const previous = new Map(profile.previous_skills.map((s) => [s.name, s.score]))
    for (const skill of skills) {
      text(skill.name, LEFT, 10)
      const barX = LEFT + 130
      const barW = 250
      doc.setFillColor(...TRACK)
      doc.roundedRect(barX, y - 8, barW, 8, 4, 4, 'F')
      doc.setFillColor(...ACCENT)
      if (skill.score > 0) doc.roundedRect(barX, y - 8, (barW * skill.score) / 10, 8, 4, 4, 'F')
      const before = previous.get(skill.name)
      const delta = before === undefined ? '' : skill.score - before === 0 ? '' : `  (${skill.score - before > 0 ? '+' : ''}${skill.score - before})`
      text(`${skill.score}/10${delta}`, barX + barW + 12, 10, false, MUTED)
      y += 20
    }
  }

  // ── Progress over time
  if (assessments.length > 0) {
    heading('Progress')
    for (const a of assessments.slice(-5).reverse()) {
      text(formatDate(a.assessed_on), LEFT, 10, false, MUTED)
      text(`${Number(a.rating).toFixed(1)} / 10`, LEFT + 90, 10, true)
      y += 16
    }
  }

  // ── Attendance by month
  const marked = attendance.monthly.filter((m) => m.pct !== null)
  if (marked.length > 0) {
    heading('Attendance by month')
    const colW = (RIGHT - LEFT) / attendance.monthly.length
    const chartH = 56
    attendance.monthly.forEach((m, i) => {
      const x = LEFT + i * colW + colW / 2
      doc.setFillColor(...TRACK)
      doc.rect(x - 14, y, 28, chartH, 'F')
      if (m.pct !== null) {
        doc.setFillColor(...ACCENT)
        const h = (chartH * m.pct) / 100
        doc.rect(x - 14, y + chartH - h, 28, h, 'F')
      }
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8.5)
      doc.setTextColor(...MUTED)
      doc.text(monthLabel(m.month), x, y + chartH + 12, { align: 'center' })
      if (m.pct !== null) doc.text(`${Math.round(m.pct)}%`, x, y - 4, { align: 'center' })
    })
    y += chartH + 20
  }

  // ── Coach's comment
  const latest = [...assessments].reverse().find((a) => a.comment)
  if (latest?.comment) {
    heading("Coach's comment")
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10.5)
    doc.setTextColor(...INK)
    const lines = doc.splitTextToSize(latest.comment, RIGHT - LEFT) as string[]
    ensure(lines.length * 14 + 30)
    doc.text(lines, LEFT, y)
    y += lines.length * 14 + 2
    text(`${latest.assessed_by ?? 'Coach'} · ${formatDate(latest.assessed_on)}`, LEFT, 9, false, MUTED)
    y += 12
  }

  // ── Levels
  if (promotions.length > 0) {
    heading('Level history')
    for (const p of promotions.slice(0, 4)) {
      text(formatDate(p.assessed_on), LEFT, 10, false, MUTED)
      text(
        `${opts.sportName(p.sport_id)}: ${p.from_level ? `${LEVEL_TITLE[p.from_level]} → ` : ''}${LEVEL_TITLE[p.to_level]}`,
        LEFT + 90,
        10,
      )
      y += 16
    }
  }

  doc.save(`${row.student_no}-progress-report.pdf`)
}
