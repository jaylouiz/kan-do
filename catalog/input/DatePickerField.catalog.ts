import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of `components/task/DatePickerField.vue` (the manifest). */

/** The popover (UCalendar) opens on click; a fixed far date keeps the trigger text stable. */
export default {
  component: 'DatePickerField',
  source: 'app',
  alternatives: ['UCalendar', 'PropertyValueTrigger'],
  variants: [
    { id: 'set', props: { modelValue: { start: '2030-01-15' }, label: { $t: 'task.field.priority' } } },
    { id: 'range', props: { modelValue: { start: '2030-01-15', end: '2030-01-18' }, label: { $t: 'task.field.priority' } } },
  ],
  states: [
    { id: 'empty', state: 'empty', props: { modelValue: null, label: { $t: 'task.field.priority' } } },
    { id: 'disabled', state: 'disabled', props: { modelValue: { start: '2030-01-15' }, disabled: true, label: { $t: 'task.field.priority' } } },
    { id: 'focus', state: 'focus', props: { modelValue: { start: '2030-01-15' }, label: { $t: 'task.field.priority' } } },
  ],
} satisfies CatalogEntry
