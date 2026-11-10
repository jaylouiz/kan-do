import type { CatalogEntry } from '../types'

/** Description, usage and avoid come from the doc block of the component (the manifest). */
export default {
  component: 'TaskDetailModal',
  source: 'app',
  alternatives: ['TaskSheet', 'UModal'],
  host: 'board',
  launch: 'modelValue',
  screen: '/statistics',
  variants: [{ id: 'open-task', label: 'first Offen task of the demo board', fixture: 'firstOpenTask' }],
  states: [],
} satisfies CatalogEntry
