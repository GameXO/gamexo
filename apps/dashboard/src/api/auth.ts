/**
 * Token storage.
 *
 * Kept separate from `client.ts` so the client can read tokens without importing
 * React, and so swapping the storage backend later (in-memory + httpOnly cookie,
 * say) touches one file.
 */
import type { components } from './schema'

export type TokenPair = components['schemas']['TokenPair']
export type Me = components['schemas']['MeOut']

const STORAGE_KEY = 'gamexo.tokens'

let cached: TokenPair | null | undefined

export function getTokens(): TokenPair | null {
  if (cached !== undefined) return cached
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    cached = raw ? (JSON.parse(raw) as TokenPair) : null
  } catch {
    cached = null
  }
  return cached
}

export function setTokens(tokens: TokenPair) {
  cached = tokens
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens))
  } catch {
    /* storage blocked — the session still works, it just won't survive a reload */
  }
  notify()
}

export function clearTokens() {
  cached = null
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
  notify()
}

export const isAuthenticated = () => Boolean(getTokens()?.access_token)

/* Lets AuthProvider react when the client clears tokens after a failed refresh. */
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((fn) => fn())

export function subscribeToTokens(fn: () => void) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
