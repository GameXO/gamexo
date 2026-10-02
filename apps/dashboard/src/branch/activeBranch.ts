import { createContext, useContext } from 'react'

/**
 * Which branch the dashboard is currently looking at.
 *
 * `null` means every branch. It is a *view* choice, not a permission: an admin can
 * always see all of them, and the API still returns whatever the account may read.
 * What the choice changes is which courts, bookings and counts the screens show.
 */
export type ActiveBranch = {
  branchId: string | null
  setBranchId: (id: string | null) => void
  /** Whether this account may switch at all — admins, and only when there is more
   *  than one branch to switch between. */
  canSwitch: boolean
}

export const ActiveBranchContext = createContext<ActiveBranch>({
  branchId: null,
  setBranchId: () => {},
  canSwitch: false,
})

export const useActiveBranch = () => useContext(ActiveBranchContext)
export const useActiveBranchId = () => useContext(ActiveBranchContext).branchId
