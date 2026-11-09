import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of `components/task/TopicPropertyPicker.vue` (the manifest). */

export default {
  component: 'TopicPropertyPicker',
  source: 'app',
  alternatives: ['TaskPropertySelect', 'USelectMenu', 'TopicEditor'],
  variants: [
    { id: 'topic', props: { kind: 'topic', label: { $t: 'task.field.topic' }, modelValue: 'Design', items: ['Design', 'Backend'] } },
    { id: 'activity', props: { kind: 'activity', label: { $t: 'task.field.activity' }, modelValue: 'Review', items: ['Review', 'Planung'] } },
  ],
  states: [
    { id: 'empty', state: 'empty', props: { kind: 'topic', label: { $t: 'task.field.topic' }, modelValue: null, items: [] } },
    { id: 'focus', state: 'focus', props: { kind: 'topic', label: { $t: 'task.field.topic' }, modelValue: 'Design', items: ['Design', 'Backend'] } },
  ],
} satisfies CatalogEntry
