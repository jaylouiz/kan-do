/**
 * @module route-arrival
 * @description Tells `lib/routeArrival.ts` about every finished navigation, so a page can tell a cold load from an
 * arrival from another page (kd#133: the board's focus overlay waits before it appears on a return).
 */
import { noteNavigation } from '~/lib/routeArrival'

export default defineNuxtPlugin(() => {
  useRouter().afterEach((to, from, failure) => {
    if (failure) return
    // The start location matches no route record
    noteNavigation(from.matched.length > 0 ? from.path : null, to.path)
  })
})
