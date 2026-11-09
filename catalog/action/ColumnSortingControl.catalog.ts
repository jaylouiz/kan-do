import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of `components/board/ColumnSortingControl.vue` (the manifest). */
export default {
  component: 'ColumnSortingControl',
  source: 'app',
  alternatives: ['UDropdownMenu', 'UButton'],
  variants: [
    { id: 'open-column', label: 'Offen, manual', props: { visible: true, status: 0, sorting: null } },
    { id: 'done-column', label: 'Erledigt, completed last', props: { visible: true, status: 3, sorting: { field: 'dateCompleted', direction: 'desc' } } },
  ],
  states: [
    { id: 'long-text', state: 'long-text', label: 'sorted by priority: field and hint in the trigger', props: { visible: true, status: 0, sorting: { field: 'priority', direction: 'desc' } } },
    { id: 'focus', state: 'focus', props: { visible: true, status: 0, sorting: null } },
  ],
} satisfies CatalogEntry
