import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of `components/topic/TopicEditor.vue` (the manifest). */
export default {
  component: 'TopicEditor',
  source: 'app',
  alternatives: ['SwatchRadioGroup', 'TopicPropertyPicker'],
  sampleNote:
    'it takes focus on mount and renames through useTopicManagement; topic-management.spec.ts exercises it (its colour and symbol groups are SwatchRadioGroup).',
  states: [],
} satisfies CatalogEntry
