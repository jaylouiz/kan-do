/**
 * vue-i18n options for @nuxtjs/i18n (Composition API mode).
 * German is the fallback so a key missing in `en.json` never renders as a raw key.
 */
export default defineI18nConfig(() => ({
  legacy: false,
  fallbackLocale: 'de',
  missingWarn: import.meta.dev,
  fallbackWarn: false,
}))
