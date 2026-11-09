/**
 * Dev-only pages (#65, epic #58 D2): `/ui` (the generated token and component catalog) and `/error-test` ship only in
 * `nuxt dev` and in the E2E build. Every other build drops their routes at build time (`nuxt.config.ts`, hook
 * `pages:extend`), so no route, no page code and no catalog string reaches `npm run generate` or `npm run build`.
 * A runtime `import.meta.dev` check would leave all of that in the bundle.
 *
 * Pure and dependency-free: `nuxt.config.ts` imports it while the config loads.
 */

/** Files below `pages/` that exist only for development. */
export const DEV_ONLY_PAGE_FILES = ['pages/ui.vue', 'pages/error-test.vue'] as const

/**
 * Whether the dev-only pages are part of the build: any non-production run (`nuxt dev`, `nuxt prepare`, typecheck),
 * or a production build with `KANDO_UI_CATALOG=1` (set only by `scripts/e2e-server.mjs`, like `NOTION_STUB_ENABLED`).
 */
export function shouldShipDevPages(env: Record<string, string | undefined>): boolean {
  return env.NODE_ENV !== 'production' || env.KANDO_UI_CATALOG === '1'
}

/** The route records Nuxt's `pages:extend` hook hands over; only the source file matters here. */
export interface PageRecord {
  file?: string
  children?: PageRecord[]
}

/** Removes the dev-only pages from `pages` in place (nested children too) unless they ship. Returns what it removed. */
export function removeDevPages(pages: PageRecord[], env: Record<string, string | undefined>): PageRecord[] {
  if (shouldShipDevPages(env)) return []
  const removed: PageRecord[] = []
  const isDevOnly = (page: PageRecord) => DEV_ONLY_PAGE_FILES.some(file => (page.file ?? '').replaceAll('\\', '/').endsWith(`/${file}`))
  const prune = (list: PageRecord[]) => {
    for (let i = list.length - 1; i >= 0; i--) {
      const page = list[i]!
      if (isDevOnly(page)) removed.push(...list.splice(i, 1))
      else if (page.children?.length) prune(page.children)
    }
  }
  prune(pages)
  return removed
}
