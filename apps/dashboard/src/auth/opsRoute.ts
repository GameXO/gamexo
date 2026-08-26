/**
 * `#/ops` — the operator's front door.
 *
 * Functionally the console has never needed one: the sign-in form already falls
 * back to `/platform/login` when the tenant login refuses, so `ops@gamexo` works on
 * the ordinary page. What it lacked was a *place*. An operator had no URL to
 * bookmark, and the screen they landed on told every academy owner in the world to
 * "use the username from your welcome email" — advice that is wrong for exactly one
 * account on the platform.
 *
 * A hash rather than a path because this app has no router: `App` switches on a
 * `View` in state, and `/ops` as a real path would need SPA-fallback config in dev,
 * in preview and in whatever serves the built assets. A hash costs none of that and
 * survives a refresh, which is the whole requirement.
 */

const OPS_HASH = '#/ops'

/** Is the browser pointed at the operator entrance right now? */
export function isOpsRoute(): boolean {
  return window.location.hash.replace(/\/$/, '') === OPS_HASH
}

/** Send the browser to the operator entrance, without reloading the app. */
export function goToOps(): void {
  window.location.hash = OPS_HASH.slice(1)
}

/**
 * Drop the `#/ops` marker once it has done its job.
 *
 * Called after an operator signs in. Left in place, a refresh would land them back
 * on a sign-in screen they are already past, and the hash would follow them into
 * every link they copied out of the address bar.
 */
export function clearOpsRoute(): void {
  if (!isOpsRoute()) return
  window.history.replaceState({}, '', window.location.pathname + window.location.search)
}

/** Re-render when the operator navigates to or away from `#/ops`. */
export function subscribeToOpsRoute(fn: () => void): () => void {
  window.addEventListener('hashchange', fn)
  return () => window.removeEventListener('hashchange', fn)
}
