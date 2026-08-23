/**
 * Data for Manage → Integrations.
 *
 * Kept beside the screen rather than in api/hooks.ts: nothing else in the app reads
 * a payment credential or a partner key, and the shared hooks file is already the
 * first place every other screen looks.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../../api/client'
import type { components } from '../../api/schema'

export type ProviderOut = components['schemas']['ProviderOut']
export type ProviderConfigOut = components['schemas']['ProviderConfigOut']
export type ProviderFieldOut = components['schemas']['ProviderFieldOut']
export type VerificationOut = components['schemas']['VerificationOut']
export type PartnerOut = components['schemas']['PartnerOut']
export type PartnerWithKey = components['schemas']['PartnerWithKey']
export type DialectOut = components['schemas']['DialectOut']

export type Surface = 'web' | 'pos'

export const integrationKeys = {
  gateways: ['payment-providers'] as const,
  partners: ['integration-partners'] as const,
  dialects: ['gateway-dialects'] as const,
}

/** What the gateway can speak. Rarely changes — it only moves when the API ships a
 *  new dialect — so it is cached for the session rather than refetched per render. */
export function useDialects() {
  return useQuery({
    queryKey: integrationKeys.dialects,
    queryFn: () => api.listDialects(),
    staleTime: Infinity,
  })
}

/**
 * Field-level messages from a rejected credential save.
 *
 * The API returns `details.problems` as finished sentences — "Key ID is a test
 * credential, but this gateway is set to live." — and they are rendered as-is.
 * Re-wording them here would put the same rule in two places, and the copy that
 * drifts is always the one in the browser.
 */
export function credentialProblems(error: unknown): string[] {
  if (!(error instanceof ApiError)) {
    return error instanceof Error ? [error.message] : []
  }
  const problems = error.details.problems
  if (Array.isArray(problems) && problems.length) return problems.map(String)
  return [error.message]
}

export function usePaymentProviders() {
  return useQuery({
    queryKey: integrationKeys.gateways,
    queryFn: () => api.listPaymentProviders(),
  })
}

export function useSaveGateway() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: {
      provider: string
      mode: 'test' | 'live'
      values: Record<string, string>
      verify?: boolean
    }) =>
      api.savePaymentProvider(vars.provider, {
        mode: vars.mode,
        values: vars.values,
        verify: vars.verify ?? true,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: integrationKeys.gateways }),
  })
}

export function useVerifyGateway() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (provider: string) => api.verifyPaymentProvider(provider),
    // The row's last_verified_at is written by the same call, so the card's
    // "checked just now" line comes from a refetch rather than local state.
    onSuccess: () => qc.invalidateQueries({ queryKey: integrationKeys.gateways }),
  })
}

/**
 * Point a surface at a gateway.
 *
 * Always refetches the whole list, never patches one card in place: turning a
 * surface on takes it away from whichever gateway held it, so the response for
 * *this* provider is not the only row that changed.
 */
export function useSetRouting() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { provider: string; surface: Surface; on: boolean }) =>
      api.setPaymentRouting(vars.provider, {
        [vars.surface === 'web' ? 'collect_on_web' : 'collect_on_pos']: vars.on,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: integrationKeys.gateways }),
  })
}

export function useDisconnectGateway() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (provider: string) => api.disconnectPaymentProvider(provider),
    onSuccess: () => qc.invalidateQueries({ queryKey: integrationKeys.gateways }),
  })
}

export function usePartners() {
  return useQuery({
    queryKey: integrationKeys.partners,
    queryFn: () => api.listPartners(),
  })
}

/** The result carries `api_key`, which exists in readable form exactly once. The
 *  caller must show it; there is no second chance to fetch it. */
export function useCreatePartner() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { name: string; slug: string; dialect: string }) =>
      api.createPartner(vars),
    onSuccess: () => qc.invalidateQueries({ queryKey: integrationKeys.partners }),
  })
}

export function useUpdatePartner() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { id: string; name?: string; is_active?: boolean }) =>
      api.updatePartner(vars.id, { name: vars.name, is_active: vars.is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: integrationKeys.partners }),
  })
}

/** Same one-time-only rule as creation, and the old key stops working immediately. */
export function useRotatePartnerKey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (partnerId: string) => api.rotatePartnerKey(partnerId),
    onSuccess: () => qc.invalidateQueries({ queryKey: integrationKeys.partners }),
  })
}

export function useDeletePartner() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (partnerId: string) => api.deletePartner(partnerId),
    onSuccess: () => qc.invalidateQueries({ queryKey: integrationKeys.partners }),
  })
}
