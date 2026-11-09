import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of `components/ui/inline/InlineEditable.vue` (the manifest). */

export default {
  component: 'InlineEditable',
  source: 'app',
  alternatives: ['UInput', 'UTextarea', 'PropertyValueTrigger'],
  variants: [
    { id: 'fill', props: { modelValue: { $t: 'topic.hue.red' }, label: { $t: 'task.field.title' } } },
    { id: 'rule', props: { modelValue: { $t: 'topic.hue.red' }, label: { $t: 'task.field.title' }, affordance: 'rule' } },
    { id: 'multiline', props: { modelValue: { $t: 'board.dropToComplete' }, label: { $t: 'task.field.notes' }, multiline: true } },
  ],
  states: [
    { id: 'empty', state: 'empty', props: { modelValue: '', label: { $t: 'task.field.notes' }, placeholder: { $t: 'task.detail.notesPlaceholder' } } },
    { id: 'focus', state: 'focus', props: { modelValue: { $t: 'topic.hue.red' }, label: { $t: 'task.field.title' } } },
    { id: 'long-text', state: 'long-text', label: 'long German value', props: { modelValue: { $t: 'board.dropToComplete' }, label: { $t: 'task.field.title' } } },
  ],
} satisfies CatalogEntry
