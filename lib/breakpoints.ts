/**
 * The viewport breakpoints: the one place the phone/desktop switch (and the one `sm` step) is written as a number (#70).
 *
 * JS reads the queries from here (`useIsDesktop`, `useMediaQuery`, `matchMedia`). CSS cannot read a custom property in a
 * media query, so a stylesheet writes `@media (--phone)` and `scripts/postcss-breakpoints.mjs` (registered in
 * `nuxt.config.ts`) expands it to the query below at build time. Tailwind's `md:` / `max-md:` classes are the same
 * 768 px step (`--breakpoint-md: 48rem`), kept equal by `tests/config/breakpoints.test.ts`.
 * Written as plain data (no imports) because `nuxt.config.ts` loads it before the app exists.
 */
export const BREAKPOINT_QUERIES = {
  /** Below the desktop step: the bottom-drawer / one-column-page layout. */
  phone: '(max-width: 767px)',
  /** The desktop step: modal or slideover, all columns side by side. */
  desktop: '(min-width: 768px)',
  /** Tailwind's `sm` step (40rem, scales with the browser's text size like the `sm:` classes): the sheet's inline padding. */
  sm: '(min-width: 40rem)',
  /** The same step in px: the new-card flow measures its wider layout in px, so it ignores the text size. */
  smPx: '(min-width: 640px)',
} as const;

export type BreakpointName = keyof typeof BREAKPOINT_QUERIES;
