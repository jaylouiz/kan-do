import { recordTranslation } from '~/lib/copy-editor/recorder'

/**
 * vue-i18n options for @nuxtjs/i18n (Composition API mode).
 * German is the fallback so a key missing in `en.json` never renders as a raw key.
 */
export default defineI18nConfig(() => ({
  legacy: false,
  fallbackLocale: 'de',
  missingWarn: import.meta.dev,
  fallbackWarn: false,
  // Live copy editor (#59): remembers which key rendered which text. `false` (and tree-shaken) in every other build.
  // The server bundle (Nitro) does not get the vite `define`, hence the typeof guard.
  ...(typeof __COPY_EDITOR__ !== 'undefined' && __COPY_EDITOR__ ? { postTranslation: recordTranslation } : {}),
}))
