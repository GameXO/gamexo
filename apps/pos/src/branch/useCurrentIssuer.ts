import { useMemo } from 'react'
import { usePosBusinessName } from '../api/hooks'
import { useBranch } from './useBranch'
import { issuerFrom, type Issuer } from './issuer'

/**
 * Who a bill raised right now is from: the business, and the branch this tablet is set
 * to. For documents with no booking behind them yet — the payment-step preview, a
 * counter shop receipt. Once a booking exists, its own branch is used instead.
 */
export function useCurrentIssuer(): Issuer {
  const businessName = usePosBusinessName()
  const { branch } = useBranch()
  return useMemo(() => issuerFrom(businessName, branch), [businessName, branch])
}
