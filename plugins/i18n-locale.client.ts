/**
 * @module i18n-locale
 * @description Resolves the UI locale before the first render and applies it to vue-i18n.
 *
 * Precedence (see utils/localeResolution.ts):
 *   1a. URL query `?lang=de|en` — persisted, then removed from the URL
 *   1b. `KANDO_LOCALE` env var (runtimeConfig.public.localeOverride) — dev only, never persisted
 *   2.  localStorage `kando-locale`
 *   3.  navigator.languages — persisted
 *   4.  `de` — persisted
 *
 * Runs after the module's own plugins so its initial locale detection cannot override ours.
 * Async: Nuxt awaits it before mounting, so English mode never flashes German.
 */
import { setI18nInstance } from '~/lib/i18n'
import { LOCALE_STORAGE_KEY, resolveLocale } from '~/utils/localeResolution'

const LOCALE_QUERY_PARAM = 'lang'

function readStoredLocale(): string | null {
  try {
    return window.localStorage.getItem(LOCALE_STORAGE_KEY)
  } catch {
    return null
  }
}

function writeStoredLocale(locale: string): void {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  } catch {
    // Storage blocked (private mode, disabled site data): locale still applies for this session.
  }
}

export default defineNuxtPlugin({
  name: 'i18n-locale',
  dependsOn: ['i18n:plugin', 'i18n:plugin:route-locale-detect'],
  async setup(nuxtApp) {
    const queryParam = new URL(window.location.href).searchParams.get(LOCALE_QUERY_PARAM)
    const devOverride = import.meta.dev ? String(useRuntimeConfig().public.localeOverride ?? '') : null

    const { locale, persist } = resolveLocale({
      queryParam,
      devOverride,
      stored: readStoredLocale(),
      navigatorLanguages: window.navigator.languages ?? null,
    })

    // $i18n is vue-i18n's global Composer (legacy: false), extended by @nuxtjs/i18n.
    const i18n = nuxtApp.$i18n
    await i18n.setLocale(locale)
    if (persist) writeStoredLocale(locale)

    setI18nInstance(i18n)

    // An invalid `?lang` value is ignored by resolveLocale, but the param is still stripped below.
    // Drop `?lang` once applied. Nuxt's router performs its initial navigation (to the URL it
    // captured before this plugin ran) during `app:created`; a one-shot guard rewrites that
    // navigation instead of issuing a separate replace that could race page-level redirects.
    if (queryParam !== null) {
      const removeGuard = useRouter().beforeEach((to) => {
        removeGuard()
        const { [LOCALE_QUERY_PARAM]: langParam, ...query } = to.query
        if (langParam === undefined) return
        return { path: to.path, query, hash: to.hash, replace: true }
      })
    }
  },
})
