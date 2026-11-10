import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of `components/ui/EmptyState.vue` (the manifest). */
export default {
  component: 'EmptyState',
  source: 'app',
  alternatives: ['EmptyNote', 'UAlert'],
  variants: [
    { id: 'default', props: { icon: 'i-ph-trash-light', subline: { $t: 'trash.emptyHint' } }, slot: { $t: 'trash.empty' } },
    { id: 'no-subline', props: { icon: 'i-ph-tag-light' }, slot: { $t: 'settings.topics.emptyTopics' } },
  ],
  states: [
    { id: 'empty', state: 'empty', props: { icon: 'i-ph-tag-light', subline: { $t: 'settings.topics.emptyTopicsHint' } }, slot: { $t: 'settings.topics.emptyTopics' } },
  ],
} satisfies CatalogEntry
