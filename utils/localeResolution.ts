/**
 * @module localeResolution
 * @description Pure helpers that decide which UI locale the app starts with.
 * No browser access here: the caller (plugins/i18n-locale.client.ts) gathers the inputs.
 *
 * Precedence: URL query `?lang` > dev override (`KANDO_LOCALE`) > stored `kando-locale`
 * > `navigator.languages` > default (`de`). Invalid values at any level are ignored.
 */

export type AppLocale = 'de' | 'en'

export const SUPPORTED_LOCALES: readonly AppLocale[] = ['de', 'en'] as const
export const DEFAULT_LOCALE: AppLocale = 'de'
export const LOCALE_STORAGE_KEY = 'kando-locale'

export type LocaleSource = 'query' | 'dev' | 'stored' | 'navigator' | 'default'

export interface LocaleResolutionInput {
  queryParam?: string | null
  devOverride?: string | null
  stored?: string | null
  navigatorLanguages?: readonly string[] | null
}

export interface LocaleResolution {
  locale: AppLocale
  source: LocaleSource
  /** Whether the caller should write `locale` to storage. */
  persist: boolean
}

function isAppLocale(value: string): value is AppLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value)
}

/**
 * Normalizes a BCP 47-ish tag (`en-GB`, `DE-at`, `de_DE`) to a supported base locale.
 * Returns `null` for empty or unsupported input.
 */
export function normalizeLocale(tag: string | null | undefined): AppLocale | null {
  if (!tag) return null
  const primary = tag.trim().toLowerCase().split(/[-_]/)[0]
  if (!primary) return null
  return isAppLocale(primary) ? primary : null
}

export function resolveLocale(input: LocaleResolutionInput): LocaleResolution {
  const query = normalizeLocale(input.queryParam)
  if (query) return { locale: query, source: 'query', persist: true }

  // Dev override is forced for this run only; never persisted.
  const dev = normalizeLocale(input.devOverride)
  if (dev) return { locale: dev, source: 'dev', persist: false }

  // Already stored; no need to write it again.
  const stored = normalizeLocale(input.stored)
  if (stored) return { locale: stored, source: 'stored', persist: false }

  for (const language of input.navigatorLanguages ?? []) {
    const fromNavigator = normalizeLocale(language)
    if (fromNavigator) return { locale: fromNavigator, source: 'navigator', persist: true }
  }

  return { locale: DEFAULT_LOCALE, source: 'default', persist: true }
}
