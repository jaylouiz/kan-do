// @ts-check
/**

 * PostCSS plugin: `@media (--phone)` -> `@media (max-width: 767px)` (#70). A stylesheet names a breakpoint, the number
 * lives once in `lib/breakpoints.ts`. Inside a media query list, any `(--name)` whose name is a known breakpoint is
 * replaced by that query (`(pointer: coarse), (--phone)` works); an unknown `(--name)` fails the build instead of
 * shipping a media query that never matches.
 */
import { BREAKPOINT_QUERIES } from '../lib/breakpoints.ts'

/** @param {string} params */
export function expandBreakpoints(params) {
  return params.replace(/\(\s*--([\w-]+)\s*\)/g, (match, name) => {
    const query = /** @type {Record<string, string>} */ (BREAKPOINT_QUERIES)[name]
    if (!query) throw new Error(`Unknown breakpoint (--${name}) in a media query; known: ${Object.keys(BREAKPOINT_QUERIES).join(', ')} (lib/breakpoints.ts)`)
    return query
  })
}

/**
 * Vite plugin for the Tailwind-compiled CSS, which resolves `@media (--phone)` itself (Lightning CSS) and needs the
 * definitions: `main.css` gets `@custom-media` rules appended (it imports `board.css`, `app-nav.css` and the others,
 * which Tailwind inlines without Vite seeing them; appended after the @imports, because a rule before them would void
 * them in a browser). Every other CSS module, an SFC `<style>` block included (`@reference` + `@apply` makes Tailwind
 * compile it too, and the build then fails with "Custom media query --phone is not defined"), has its media queries
 * expanded in place. Registered first (`nuxt.config.ts`), because Tailwind's plugin transforms these ids too.
 * @param {string} code
 * @param {string} id
 * @returns {string | null} the new code, or null when the id is not CSS or nothing changes
 */
export function transformBreakpoints(code, id) {
  const [path = '', query = ''] = id.split('?')
  // not the `?raw` import of the `/ui` Tokens part, which reads the file as text
  if (/(^|&)raw\b/.test(query)) return null
  if (path.endsWith('assets/css/main.css')) {
    const definitions = Object.entries(BREAKPOINT_QUERIES).map(([name, query]) => `@custom-media --${name} ${query};`).join('\n')
    return `${code}\n${definitions}\n`
  }
  const isCss = /\.css$/.test(path) || /(^|&)lang\.css\b/.test(query)
  if (!isCss || !code.includes('(--')) return null
  const expanded = code.replace(/@media([^{;]*)/g, (all, params) => (params.includes('(--') ? `@media${expandBreakpoints(params)}` : all))
  return expanded === code ? null : expanded
}

/** @returns {import('vite').Plugin} */
export function viteBreakpointDefinitions() {
  return { name: 'kan-do-breakpoint-definitions', enforce: 'pre', transform: transformBreakpoints }
}

/** @returns {import('postcss').Plugin} */
export default function postcssBreakpoints() {
  return {
    postcssPlugin: 'kan-do-breakpoints',
    AtRule: {
      media(atRule) {
        if (atRule.params.includes('(--')) atRule.params = expandBreakpoints(atRule.params)
      },
    },
  }
}
postcssBreakpoints.postcss = true
