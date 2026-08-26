export type Trend = {
  value: string
  sentiment: 'up' | 'down'
  caption: string
}

export const statCards: { label: string; value: string; trend: Trend }[] = [
  {
    label: "Today's Revenue",
    value: '₹86.4K',
    trend: { value: '+18%', sentiment: 'up', caption: 'vs yesterday' },
  },
  {
    label: 'Active Bookings',
    value: '23',
    trend: { value: '+4', sentiment: 'up', caption: 'vs yesterday' },
  },
  {
    label: 'Available Courts',
    value: '9 / 14',
    trend: { value: '-3', sentiment: 'down', caption: 'vs yesterday' },
  },
  {
    label: 'Pending Payments',
    value: '₹18.2K',
    trend: { value: '-8%', sentiment: 'up', caption: 'vs yesterday' },
  },
]

export const monthlyRevenueTarget = {
  targetLabel: '₹20.0L',
  achievedLabel: '₹15.7L',
  target: 2000000,
  achieved: 1572000,
}

export const sportPopularity = [
  { sport: 'Badminton', revenue: 480000, label: '₹4.8L' },
  { sport: 'Turf Football', revenue: 360000, label: '₹3.6L' },
  { sport: 'Cricket Box', revenue: 290000, label: '₹2.9L' },
  { sport: 'Swimming', revenue: 170000, label: '₹1.7L' },
  { sport: 'Table Tennis', revenue: 90000, label: '₹0.9L' },
]

export const quickStats = [
  { label: 'Completed Bookings Today', value: '34' },
  { label: 'Equipment Issued', value: '21' },
  { label: 'Walk-ins Today', value: '12' },
  { label: 'Memberships Renewed', value: '6' },
]

export const revenueTrend = [
  { month: 'Jan', revenue: 8, refunds: 1.2 },
  { month: 'Feb', revenue: 9.5, refunds: 1.4 },
  { month: 'Mar', revenue: 11, refunds: 1.1 },
  { month: 'Apr', revenue: 10.2, refunds: 1.6 },
  { month: 'May', revenue: 13.5, refunds: 1.3 },
  { month: 'Jun', revenue: 12, refunds: 1.8 },
  { month: 'Jul', revenue: 14.8, refunds: 1.5 },
  { month: 'Aug', revenue: 13.9, refunds: 1.7 },
  { month: 'Sep', revenue: 15.6, refunds: 1.4 },
  { month: 'Oct', revenue: 16.8, refunds: 1.9 },
  { month: 'Nov', revenue: 15.9, refunds: 1.6 },
  { month: 'Dec', revenue: 18.2, refunds: 1.8 },
]

export const currentUser = {
  name: 'Rohan Verma',
  role: 'Owner',
  initials: 'RV',
}
