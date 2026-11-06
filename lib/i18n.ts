/**
 * @module i18n
 * @description Access to the app's vue-i18n instance from code that runs outside a component
 * setup (error handler, plain utilities). Components and composables use `useI18n()` instead.
 *
 * The global Composer is registered once by `plugins/i18n-locale.client.ts`. Until then
 * `translate()` returns the key unchanged (with a dev warning) and `getActiveLocale()` returns
 * the default locale.
 */
import type { Composer } from 'vue-i18n'
import { DEFAULT_LOCALE, normalizeLocale, type AppLocale } from '~/utils/localeResolution'

let composer: Composer | null = null

/** Registers vue-i18n's global Composer (Composition API mode, `legacy: false`). */
export function setI18nInstance(instance: Composer): void {
  composer = instance
}

/**
 * Translates `key` with the active locale.
 * @param named - values for `{name}` placeholders
 * @param plural - count selecting the `a | b` plural branch (also available as `{count}`/`{n}`)
 */
export function translate(key: string, named?: Record<string, unknown>, plural?: number): string {
  if (!composer) {
    if (import.meta.dev) {
      console.warn(`[i18n] translate("${key}") called before the i18n instance was registered`)
    }
    return key
  }
  if (plural !== undefined) {
    return composer.t(key, plural, { named: named ?? {} })
  }
  return named ? composer.t(key, named) : composer.t(key)
}

/** The active UI locale, narrowed to a supported locale (falls back to `de`). */
export function getActiveLocale(): AppLocale {
  return normalizeLocale(composer?.locale.value) ?? DEFAULT_LOCALE
}
