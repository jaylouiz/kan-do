import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of `components/task/TaskPropertySelect.vue` (the manifest). */

export default {
  component: 'TaskPropertySelect',
  source: 'app',
  alternatives: ['USelectMenu', 'USelect', 'TopicPropertyPicker', 'PropertyValueTrigger'],
  variants: [
    { id: 'value', props: { label: { $t: 'task.field.priority' }, modelValue: 'red', valueKey: 'value', items: [{ label: { $t: 'topic.hue.red' }, value: 'red' }, { label: { $t: 'topic.hue.green' }, value: 'green' }] } },
    { id: 'multiple', props: { label: { $t: 'task.field.priority' }, modelValue: ['red', 'green'], multiple: true, valueKey: 'value', items: [{ label: { $t: 'topic.hue.red' }, value: 'red' }, { label: { $t: 'topic.hue.green' }, value: 'green' }] } },
  ],
  states: [
    { id: 'empty', state: 'empty', props: { label: { $t: 'task.field.priority' }, modelValue: null, placeholder: { $t: 'task.form.choose' }, valueKey: 'value', items: [{ label: { $t: 'topic.hue.red' }, value: 'red' }, { label: { $t: 'topic.hue.green' }, value: 'green' }] } },
    { id: 'disabled', state: 'disabled', props: { label: { $t: 'task.field.priority' }, modelValue: 'red', disabled: true, valueKey: 'value', items: [{ label: { $t: 'topic.hue.red' }, value: 'red' }, { label: { $t: 'topic.hue.green' }, value: 'green' }] } },
    { id: 'focus', state: 'focus', props: { label: { $t: 'task.field.priority' }, modelValue: 'red', valueKey: 'value', items: [{ label: { $t: 'topic.hue.red' }, value: 'red' }, { label: { $t: 'topic.hue.green' }, value: 'green' }] } },
    { id: 'long-text', state: 'long-text', label: 'long German value', props: { label: { $t: 'task.field.priority' }, modelValue: 'long', valueKey: 'value', items: [{ label: { $t: 'board.dropToComplete' }, value: 'long' }] } },
  ],
} satisfies CatalogEntry
