export const FACILITY_PROFILE = {
  name: 'Navigo Sports Arena',
  addressLine: 'Survey 42, Kondapur, Hyderabad',
  pincode: '500084',
  gstin: '36AABCN1234K1Z9',
}

export type FacilitySport = {
  id: string
  label: string
}

export const FACILITY_SPORTS: FacilitySport[] = [
  { id: 'football', label: 'Football' },
  { id: 'cricket', label: 'Cricket' },
  { id: 'tennis', label: 'Tennis' },
  { id: 'badminton', label: 'Badminton' },
  { id: 'pickleball', label: 'Pickleball' },
  { id: 'tabletennis', label: 'Table Tennis' },
  { id: 'swimming', label: 'Swimming' },
  { id: 'gym', label: 'Gym' },
]

export type FacilityCourt = {
  id: string
  sportId: string
  name: string
  price: number
}

export const FACILITY_COURTS: FacilityCourt[] = [
  { id: 'fc-football-a', sportId: 'football', name: 'Court A', price: 800 },
  { id: 'fc-football-b', sportId: 'football', name: 'Court B', price: 1000 },
  { id: 'fc-cricket-box', sportId: 'cricket', name: 'Box Arena', price: 1200 },
  { id: 'fc-cricket-nets', sportId: 'cricket', name: 'Net 1 & 2', price: 700 },
  { id: 'fc-tennis-1', sportId: 'tennis', name: 'Court 1', price: 600 },
  { id: 'fc-tennis-2', sportId: 'tennis', name: 'Court 2', price: 600 },
  { id: 'fc-badminton-1', sportId: 'badminton', name: 'Court 1', price: 400 },
  { id: 'fc-badminton-2', sportId: 'badminton', name: 'Court 2', price: 400 },
  { id: 'fc-pickleball-1', sportId: 'pickleball', name: 'Court 1', price: 500 },
  { id: 'fc-tabletennis-1', sportId: 'tabletennis', name: 'Table 1', price: 200 },
  { id: 'fc-tabletennis-2', sportId: 'tabletennis', name: 'Table 2', price: 200 },
  { id: 'fc-swimming-pool', sportId: 'swimming', name: 'Main Pool', price: 300 },
  { id: 'fc-gym-floor', sportId: 'gym', name: 'Strength Floor', price: 250 },
]

export const facilitySportById = (id: string) => FACILITY_SPORTS.find((s) => s.id === id)
