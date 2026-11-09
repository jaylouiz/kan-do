import type { CatalogEntry } from '../types'

/**
 * Description, usage and avoid come from the doc block of `components/settings/DataExportImport.vue` (the manifest).
 * A block is registered, not refactored (epic #58): no samples, it reads the desktop data status and the stores of
 * `/settings/data`, which `/ui` does not provide. Its buttons are the `UButton` ghost neutral `sm` of the UButton entry.
 */
export default {
  component: 'DataExportImport',
  source: 'app',
  alternatives: ['UButton'],
  noSamples:
    'a block is registered, not refactored (epic #58): it reads the desktop data status and the stores of /settings/data, which /ui does not provide.',
  states: [],
} satisfies CatalogEntry
