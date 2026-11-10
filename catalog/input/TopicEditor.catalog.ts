import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of `components/topic/TopicEditor.vue` (the manifest) (its colour and symbol groups are SwatchRadioGroup). */
export default {
  component: 'TopicEditor',
  source: 'app',
  alternatives: ['SwatchRadioGroup', 'TopicPropertyPicker'],
  host: 'board',
  screen: '/settings/topics',
  variants: [
    { id: 'topic', label: 'topic of the demo board', props: { topic: 'Baustelle Müller' } },
    { id: 'activity', label: 'activity', props: { topic: 'Vor Ort', kind: 'activity' } },
  ],
  states: [],
} satisfies CatalogEntry
