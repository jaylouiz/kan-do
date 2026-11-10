import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'MinutesField',
  source: 'app',
  alternatives: ['InlineEditable', 'UInput', 'PropertyValueTrigger'],
  variants: [
    { id: 'value', label: 'with a value', props: { 'value': 45, 'min': 0, 'aria-label': { $t: 'task.timebox' } } },
    { id: 'empty', label: 'empty with a placeholder', props: { 'value': '', 'placeholder': '—', 'aria-label': { $t: 'task.timebox' } } },
  ],
  states: [],
} satisfies CatalogEntry
