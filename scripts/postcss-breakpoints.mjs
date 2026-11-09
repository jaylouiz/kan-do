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
 * Vite plugin for the one stylesheet Tailwind compiles before PostCSS sees it: `main.css` imports `board.css`,
 * `app-nav.css` and the others, Tailwind's Lightning CSS pass inlines them and resolves `@media (--phone)` itself, so it
 * needs the definitions. Appended after the @imports (a rule before them would void them in a browser, where an
 * unknown at-rule is ignored). Registered first (`nuxt.config.ts`), because Tailwind's plugin transforms `main.css` too.
 * @returns {import('vite').Plugin}
 */
export function viteBreakpointDefinitions() {
  const definitions = Object.entries(BREAKPOINT_QUERIES).map(([name, query]) => `@custom-media --${name} ${query};`).join('\n')
  return {
    name: 'kan-do-breakpoint-definitions',
    enforce: 'pre',
    transform(code, id) {
      const [path = '', query = ''] = id.split('?')
      // not the `?raw` import of the `/ui` Tokens part, which reads the file as text
      return path.endsWith('assets/css/main.css') && !/(^|&)raw\b/.test(query) ? `${code}\n${definitions}\n` : null
    },
  }
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
