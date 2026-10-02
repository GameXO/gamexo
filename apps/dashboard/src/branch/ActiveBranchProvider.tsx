import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { canManageAcademy, identityFrom } from '../auth/identity'
import { useBranches } from '../api/hooks'
import { ActiveBranchContext } from './activeBranch'

const KEY = 'gamexo.activeBranch'

function readStored(): string | null {
  try {
    return window.localStorage.getItem(KEY)
  } catch {
    return null
  }
}

/**
 * Holds the branch selection for the signed-in shell.
 *
 * Remembered per browser, so a reload lands where the admin left off. Three guards
 * keep a stale choice from hiding data:
 *   - a branch that has since been closed or deleted falls back to "all";
 *   - an account that may not switch is always on "all", whatever a previous user of
 *     the same browser picked;
 *   - with a single branch there is nothing to choose.
 */
export function ActiveBranchProvider({ children }: { children: ReactNode }) {
  const { me } = useAuth()
  const identity = useMemo(() => identityFrom(me), [me])
  const { data: branches } = useBranches(false)
  const [stored, setStored] = useState<string | null>(readStored)

  const isAdmin = canManageAcademy(identity.role, identity.isOps)
  const canSwitch = isAdmin && (branches?.length ?? 0) > 1
  const valid = stored !== null && (branches ?? []).some((b) => b.id === stored)
  const branchId = canSwitch && valid ? stored : null

  const setBranchId = useCallback((id: string | null) => {
    setStored(id)
    try {
      if (id) window.localStorage.setItem(KEY, id)
      else window.localStorage.removeItem(KEY)
    } catch {
      /* private mode: the choice simply does not outlive the tab */
    }
  }, [])

  const value = useMemo(() => ({ branchId, setBranchId, canSwitch }), [branchId, setBranchId, canSwitch])

  return <ActiveBranchContext.Provider value={value}>{children}</ActiveBranchContext.Provider>
}
