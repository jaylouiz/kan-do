import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of `components/ui/EmptyNote.vue` (the manifest). */
export default {
  component: 'EmptyNote',
  source: 'app',
  alternatives: ['EmptyState', 'UAlert'],
  variants: [
    { id: 'default', slot: { $t: 'trash.empty' } },
  ],
  states: [
    { id: 'empty', state: 'empty', slot: { $t: 'whatsNew.empty' } },
    { id: 'long-text', state: 'long-text', slot: { $t: 'statistics.outliers.empty' } },
  ],
} satisfies CatalogEntry
