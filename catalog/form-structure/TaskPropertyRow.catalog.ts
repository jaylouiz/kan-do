import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of `components/task/TaskPropertyRow.vue` (the manifest). */

export default {
  component: 'TaskPropertyRow',
  source: 'app',
  alternatives: ['UFormField'],
  variants: [
    { id: 'default', props: { label: { $t: 'task.field.priority' } }, slot: { $t: 'topic.hue.red' } },
    { id: 'private', props: { label: { $t: 'task.field.topic' }, private: true }, slot: { $t: 'topic.hue.green' } },
  ],
  states: [
    { id: 'long-text', state: 'long-text', label: 'long German value', props: { label: { $t: 'task.field.timeSpentInMinutes' } }, slot: { $t: 'board.dropToComplete' } },
  ],
} satisfies CatalogEntry
