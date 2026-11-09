import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of `components/ui/PropertyValueTrigger.vue` (the manifest). */

export default {
  component: 'PropertyValueTrigger',
  source: 'app',
  alternatives: ['ChoiceChip', 'InlineEditable', 'TaskPropertySelect'],
  variants: [
    { id: 'value', props: { tone: 'value', inset: true }, slot: { $t: 'topic.hue.red' } },
    { id: 'empty', props: { tone: 'empty', inset: true }, slot: { $t: 'task.property.setValue' } },
    { id: 'action', props: { tone: 'action', inset: true }, slot: { $t: 'topic.hue.green' } },
    { id: 'picked', props: { tone: 'picked', inset: true }, slot: '30' },
  ],
  states: [
    { id: 'disabled', state: 'disabled', props: { tone: 'value', inset: true, disabled: true }, slot: { $t: 'topic.hue.red' } },
    { id: 'focus', state: 'focus', props: { tone: 'value', inset: true }, slot: { $t: 'topic.hue.red' } },
    { id: 'long-text', state: 'long-text', label: 'long German text', props: { tone: 'value', inset: true }, slot: { $t: 'board.dropToComplete' } },
  ],
} satisfies CatalogEntry
