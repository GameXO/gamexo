type IconProps = { className?: string }

const base = 'size-11 shrink-0'

function FootballIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 48 48" fill="none" className={className ?? base}>
      <rect x="4" y="8" width="40" height="32" rx="1" stroke="currentColor" strokeWidth="1.25" />
      <line x1="24" y1="8" x2="24" y2="40" stroke="currentColor" strokeWidth="1.25" />
      <circle cx="24" cy="24" r="6" stroke="currentColor" strokeWidth="1.25" />
      <rect x="4" y="18" width="6" height="12" stroke="currentColor" strokeWidth="1.25" />
      <rect x="38" y="18" width="6" height="12" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  )
}

function CricketIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 48 48" fill="none" className={className ?? base}>
      <ellipse cx="24" cy="24" rx="20" ry="15" stroke="currentColor" strokeWidth="1.25" />
      <rect x="20" y="12" width="8" height="24" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  )
}

function TennisIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 48 48" fill="none" className={className ?? base}>
      <rect x="6" y="10" width="36" height="28" rx="1" stroke="currentColor" strokeWidth="1.25" />
      <line x1="24" y1="10" x2="24" y2="38" stroke="currentColor" strokeWidth="1.25" />
      <line x1="12" y1="10" x2="12" y2="38" stroke="currentColor" strokeWidth="1" />
      <line x1="36" y1="10" x2="36" y2="38" stroke="currentColor" strokeWidth="1" />
    </svg>
  )
}

function BadmintonIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 48 48" fill="none" className={className ?? base}>
      <rect x="8" y="8" width="32" height="32" rx="1" stroke="currentColor" strokeWidth="1.25" />
      <line x1="8" y1="24" x2="40" y2="24" stroke="currentColor" strokeWidth="1.25" />
      <line x1="8" y1="16" x2="40" y2="16" stroke="currentColor" strokeWidth="1" />
      <line x1="8" y1="32" x2="40" y2="32" stroke="currentColor" strokeWidth="1" />
    </svg>
  )
}

function PickleballIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 48 48" fill="none" className={className ?? base}>
      <rect x="6" y="10" width="36" height="28" rx="1" stroke="currentColor" strokeWidth="1.25" />
      <line x1="24" y1="10" x2="24" y2="38" stroke="currentColor" strokeWidth="1.25" />
      <line x1="15" y1="10" x2="15" y2="38" stroke="currentColor" strokeWidth="1" strokeDasharray="2 2" />
      <line x1="33" y1="10" x2="33" y2="38" stroke="currentColor" strokeWidth="1" strokeDasharray="2 2" />
    </svg>
  )
}

function TableTennisIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 48 48" fill="none" className={className ?? base}>
      <rect x="6" y="14" width="36" height="20" rx="1.5" stroke="currentColor" strokeWidth="1.25" />
      <line x1="24" y1="10" x2="24" y2="38" stroke="currentColor" strokeWidth="1" strokeDasharray="1.5 1.5" />
      <line x1="6" y1="24" x2="42" y2="24" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  )
}

function SwimmingIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 48 48" fill="none" className={className ?? base}>
      <rect x="4" y="10" width="40" height="28" rx="1" stroke="currentColor" strokeWidth="1.25" />
      {[17, 24, 31].map((y) => (
        <line key={y} x1="8" y1={y} x2="40" y2={y} stroke="currentColor" strokeWidth="1" strokeDasharray="2.5 2.5" />
      ))}
    </svg>
  )
}

function GymIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 48 48" fill="none" className={className ?? base}>
      <line x1="10" y1="24" x2="38" y2="24" stroke="currentColor" strokeWidth="1.5" />
      <rect x="6" y="18" width="6" height="12" rx="1" stroke="currentColor" strokeWidth="1.25" />
      <rect x="36" y="18" width="6" height="12" rx="1" stroke="currentColor" strokeWidth="1.25" />
      <rect x="14" y="20" width="4" height="8" rx="1" stroke="currentColor" strokeWidth="1" />
      <rect x="30" y="20" width="4" height="8" rx="1" stroke="currentColor" strokeWidth="1" />
    </svg>
  )
}

const ICONS: Record<string, (props: IconProps) => React.JSX.Element> = {
  football: FootballIcon,
  cricket: CricketIcon,
  tennis: TennisIcon,
  badminton: BadmintonIcon,
  pickleball: PickleballIcon,
  tabletennis: TableTennisIcon,
  swimming: SwimmingIcon,
  gym: GymIcon,
}

export default function SportIcon({ sportId, className }: { sportId: string; className?: string }) {
  const Icon = ICONS[sportId] ?? FootballIcon
  return <Icon className={className} />
}
