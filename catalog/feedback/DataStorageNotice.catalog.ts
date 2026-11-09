import type { CatalogEntry } from '../types'

/**
 * Description, usage and avoid come from the doc block of `components/settings/DataStorageNotice.vue` (the manifest).
 * No samples on purpose: the notice renders only from the live data-folder status (`useDataFolder`, a desktop state), so
 * a sample would be empty. Its look is the `UAlert` "actions and close" state (horizontal, subtle, actions); the
 * notice only maps a status to colour, icon, text and actions.
 */
export default {
  component: 'DataStorageNotice',
  source: 'app',
  alternatives: ['UAlert'],
  states: [],
} satisfies CatalogEntry
