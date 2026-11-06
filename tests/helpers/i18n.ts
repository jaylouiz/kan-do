import { createI18n } from 'vue-i18n'
import de from '~/i18n/locales/de.json'
import en from '~/i18n/locales/en.json'
import type { AppLocale } from '~/utils/localeResolution'

/** Creates a vue-i18n instance (Composition API mode) backed by the real locale files. */
export function createTestI18n(locale: AppLocale = 'de') {
  return createI18n({
    legacy: false,
    locale,
    fallbackLocale: 'de',
    messages: { de, en },
  })
}

/** Shared instance installed globally by `tests/setup/i18n.ts`. */
export const testI18n = createTestI18n()

/** Switches the shared test instance to `locale`. */
export function setTestLocale(locale: AppLocale): void {
  testI18n.global.locale.value = locale
}
