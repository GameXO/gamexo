import { useMemo } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { identityFrom } from '../auth/identity'

/**
 * Manager and above. Reviewing a student, promoting them, creating a batch and
 * uploading a photo are all manager-level on the server; this only decides whether the
 * button is shown, so reception is not offered an action that would 403. The server
 * stays the authority.
 */
export function useIsManager(): boolean {
  const { me } = useAuth()
  return useMemo(() => {
    const { role, isOps } = identityFrom(me)
    return isOps || role === 'admin' || role === 'manager'
  }, [me])
}

/**
 * Admin only. Deleting a payout removes a financial record, so it is the one payroll
 * action a manager cannot take. Like `useIsManager`, this only hides the button.
 */
export function useIsAdmin(): boolean {
  const { me } = useAuth()
  return useMemo(() => {
    const { role, isOps } = identityFrom(me)
    return isOps || role === 'admin'
  }, [me])
}
