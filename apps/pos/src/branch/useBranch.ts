/**
 * Branch selection state and its hooks. The provider component lives beside this in
 * BranchProvider.tsx; kept apart so that file exports only components.
 */
import { createContext, useContext } from 'react'
import type { api } from '../api/client'

export type Branch = Awaited<ReturnType<typeof api.listBranches>>[number]

export const STORAGE_KEY = 'gamexo.pos.branch'

export function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function writeStored(id: string | null) {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id)
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* storage blocked — the choice just will not survive a reload */
  }
}

export type BranchState = {
  /** The branch this tablet is set to; null until chosen, or if branches could not load. */
  branch: Branch | null
  branches: Branch[]
  /** More than one open branch — the only case where picking, filtering and
   *  switching mean anything. */
  multi: boolean
  /** Reopen the picker. */
  switchBranch: () => void
}

export const BranchContext = createContext<BranchState | null>(null)

/** Outside the provider (the login screen) there is simply no branch. */
const NONE: BranchState = { branch: null, branches: [], multi: false, switchBranch: () => {} }

export const useBranch = () => useContext(BranchContext) ?? NONE
export const useBranchId = () => useBranch().branch?.id
