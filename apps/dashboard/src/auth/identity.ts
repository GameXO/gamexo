/**
 * Who is signed in and whose academy this is, as the shell needs to render them.
 *
 * Derived from `/auth/me`, which AuthProvider already fetches on boot — so the
 * sidebar costs no extra request. Before it lands, and for a platform operator who
 * has no tenant user, everything here degrades to something printable rather than
 * to `undefined` leaking into the DOM.
 */
import type { Me } from '../api/auth'

/** Tenant-scoped roles, most privileged first. Mirrors `app/core/security.py::Role`. */
export type Role = 'admin' | 'manager' | 'reception' | 'kiosk'

/**
 * What each role is called on screen.
 *
 * The API's four roles are the product's three levels plus one: `manager` and
 * `reception` are both "staff" as far as the spec goes — same reach, different
 * seniority — so they read differently here while being gated identically.
 */
const ROLE_LABELS: Record<Role, string> = {
  admin: 'Owner · Admin',
  manager: 'Staff · Manager',
  reception: 'Staff · Front Desk',
  kiosk: 'Counter',
}

export type Identity = {
  /** The academy's name, for the sidebar header. */
  business: string
  /** Its uploaded logo, if it has one. */
  logoUrl: string | null
  /** The signed-in person's display name. */
  name: string
  /** What they sign in with — `admin@navigo-sports`. */
  username: string
  initials: string
  role: Role | null
  roleLabel: string
  /** True for the single `ops@gamexo` account, which has no tenant user. */
  isOps: boolean
}

/** "Rahul Joshi" -> "RJ". Matches the server's `auth/service.py::initials`. */
function initialsOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function identityFrom(me: Me | null): Identity {
  const tenant = me?.tenant
  const user = me?.user
  const ops = me?.platform_admin

  // The tenant's own name, not the product's. This is a white-label dashboard —
  // an academy seeing "XCourt" in its own sidebar is seeing somebody else's brand.
  const business = tenant?.name?.trim() || 'Your venue'

  if (ops) {
    return {
      business,
      logoUrl: null,
      name: ops.full_name || 'Operations',
      username: ops.username ?? 'ops@gamexo',
      initials: initialsOf(ops.full_name || 'Operations'),
      role: null,
      roleLabel: 'gamexo Operations',
      isOps: true,
    }
  }

  const role = (user?.role as Role | undefined) ?? null
  const name = user?.full_name?.trim() || 'Signed in'

  return {
    business,
    logoUrl: null,
    name,
    username: user?.username ?? '',
    initials: user?.avatar_initials?.trim() || initialsOf(name),
    role,
    roleLabel: role ? ROLE_LABELS[role] : '',
    isOps: false,
  }
}

/* ── What each level may see ───────────────────────────────────────────────
 * The server is the authority — every one of these is guarded there too, and
 * `tests/test_usernames_roles.py` asserts the refusals. Hiding them here is so a
 * staff member is not shown a Staff page that 403s the moment they open it.
 */

/** Staff management and Integrations. Admin only. */
export function canManageAcademy(role: Role | null, isOps: boolean): boolean {
  return isOps || role === 'admin'
}

/** Inventory, courts, membership, academy — the staff level and above. */
export function canManageOperations(role: Role | null, isOps: boolean): boolean {
  return isOps || role === 'admin' || role === 'manager' || role === 'reception'
}
