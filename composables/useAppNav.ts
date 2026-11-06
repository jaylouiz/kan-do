/**
 * @composable useAppNav
 * @description Which place of the app bar the current route belongs to (#470, ADR 017). A pure function of the
 * route: the open state of the Mehr panel is never an input, so an open panel can never replace the selected place.
 * @responsibility
 * - `placeOfPath`: `/tasks*` -> board (Heute), `/statistics` -> statistics, `/trash` and `/settings*` -> more (the third
 *   segment of the pill, #583: ⋯ itself is never selected), else none
 * - `thirdItemOfPath` / `thirdItem`: the page behind ⋯ the route is on (Papierkorb on `/trash*`, Einstellungen on
 *   `/settings*`, linking `/settings`), shown as a third segment in the pill and left out of the Mehr panel meanwhile
 * - `showsBar`: false for routes that opt out with `definePageMeta({ appNav: false })` (welcome, styleguide, error-test, index)
 * - Reads the live router route (`useLiveRoute`), so the selection follows the URL in the same tick
 * - `currentPlace`: the place to mark with `aria-current="page"`; `null` on a route without bar or place. `'more'`
 *   marks the third segment, never the ⋯ button
 */
import { computed } from 'vue'
import { useRouter } from 'nuxt/app'

/** The places of the bar: Heute (board), Statistik (statistics) and `more` (a page behind ⋯, shown as the third segment) */
export type AppNavPlace = 'board' | 'statistics' | 'more'

/** True when `path` is `base` itself or below it (`/tasks`, `/tasks/add`, but not `/tasksfoo`) */
const isUnder = (path: string, base: string): boolean => path === base || path.startsWith(`${base}/`)

/** Route path -> place. Query and hash are not part of `route.path`. */
export function placeOfPath(path: string): AppNavPlace | null {
  if (isUnder(path, '/tasks')) return 'board'
  if (isUnder(path, '/statistics')) return 'statistics'
  if (isUnder(path, '/trash') || isUnder(path, '/settings')) return 'more'
  return null
}

/** A page behind ⋯ that the pill shows as its third segment: where it links and the i18n key of its label */
export interface ThirdItem {
  to: '/settings' | '/settings?tab=sources' | '/settings?tab=manage' | '/trash'
  labelKey: 'nav.settings' | 'nav.trash'
}

/** Route path -> third segment, or null on Heute, Statistik and routes without a place. `/settings/*` reads "Einstellungen". */
export function thirdItemOfPath(path: string): ThirdItem | null {
  if (isUnder(path, '/trash')) return { to: '/trash', labelKey: 'nav.trash' }
  if (path === '/settings' || path === '/settings/') return { to: '/settings', labelKey: 'nav.settings' }
  // Leaving a sub-page through the bar restores the tab that holds it (#691): the Notion page sits under Aufgabenquellen, the rest under Verwaltung
  if (isUnder(path, '/settings')) {
    return { to: isUnder(path, '/settings/notion') ? '/settings?tab=sources' : '/settings?tab=manage', labelKey: 'nav.settings' }
  }
  return null
}

/**
 * The live vue-router route. Never `useRoute()` here: Nuxt's app-level route only syncs once the incoming page's
 * Suspense has resolved (`_route.sync()` in NuxtPage), so it still names the old page while the URL has already
 * changed. An async page (statistics) made the bar select the old place and close a panel opened in that gap (#507).
 */
export function useLiveRoute() {
  return useRouter().currentRoute
}

export function useAppNav() {
  const route = useLiveRoute()

  const showsBar = computed(() => route.value.meta.appNav !== false)
  const currentPlace = computed<AppNavPlace | null>(() => (showsBar.value ? placeOfPath(route.value.path) : null))
  /** The page behind ⋯ the pill shows as its third segment; null on a primary page, a route without place or without bar */
  const thirdItem = computed<ThirdItem | null>(() => (showsBar.value ? thirdItemOfPath(route.value.path) : null))
  /** The board is the current place: the Ansicht options and "Tag abschließen" exist only then */
  const onBoard = computed(() => currentPlace.value === 'board')

  return { showsBar, currentPlace, onBoard, thirdItem }
}
