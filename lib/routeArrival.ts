/**
 * @module routeArrival
 * @description Whether the app has moved between pages since it loaded (kd#133). A component that mounts after that
 * was reached from another page, not by a cold load: the board then lets its focus overlay wait before it appears.
 * `plugins/route-arrival.client.ts` feeds it from the router; the state lives as long as the page load.
 */
let navigated = false

/**
 * Called for every finished navigation with the path it left (`null`: the router's start location) and the path it
 * reached. Still the cold load: leaving the start location or the empty redirect page `/`, and a navigation that
 * stays on its path (Nuxt replaces the first route with itself once the app is up; a query change). Every other counts.
 */
export function noteNavigation(fromPath: string | null, toPath: string): void {
  if (fromPath !== null && fromPath !== '/' && fromPath !== toPath) navigated = true
}

/** True once the app has left a real page: what mounts now was arrived at by in-app navigation */
export function arrivedFromAnotherPage(): boolean {
  return navigated
}

/** Tests only */
export function resetRouteArrival(): void {
  navigated = false
}
